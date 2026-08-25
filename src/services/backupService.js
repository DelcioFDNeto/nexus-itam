import { db } from './firebase';
import { collection, getDocs, writeBatch, doc, getDoc, serverTimestamp, query, where } from 'firebase/firestore';

// -----------------------------------------------------------------------------
// Colecoes de dados operacionais. Todas sao escopadas por `tenantId`.
// -----------------------------------------------------------------------------
const TENANT_COLLECTIONS = [
  'assets',
  'employees',
  'history',
  'projects',
  'tasks',
  'sectors',
  'licenses',
  'contracts',
  'agentInbox',
  'serviceOrders',
  'audits',
];

// Exportadas para leitura/arquivamento, mas NUNCA restauraveis pelo cliente.
// Restaurar `users` permitiria reescrever papeis; restaurar `tenants` permitiria
// reescrever plano e limites; `settings` carrega configuracao de seguranca.
const EXPORT_ONLY_COLLECTIONS = ['settings', 'tenants', 'users'];

const COLLECTIONS_TO_BACKUP = [...TENANT_COLLECTIONS, ...EXPORT_ONLY_COLLECTIONS];

// Campos que o arquivo de backup nunca pode reescrever, mesmo em colecao valida.
// `status` saiu da lista: users/tenants/settings ja nao sao restauraveis, entao
// a protecao so alcancava ativos — e apagava o estado de baixa na restauracao.
const PROTECTED_FIELDS = ['tenantId', 'role', 'plan', 'limits', 'agentToken'];

const serializeValue = (value) => {
  if (value && typeof value === 'object' && typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  if (value && typeof value === 'object' && typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000).toISOString();
  }
  return value;
};

/**
 * Gera um objeto JSON com os dados do inquilino.
 * @param {string} tenantId
 * @param {boolean} isSuperAdmin
 */
export const generateFullBackup = async (tenantId, isSuperAdmin = false) => {
  if (!tenantId && !isSuperAdmin) {
    throw new Error('Backup exige um inquilino valido.');
  }

  const backupData = {
    meta: {
      version: '2.1',
      date: new Date().toISOString(),
      type: isSuperAdmin ? 'global_backup' : 'tenant_backup',
      tenantId: isSuperAdmin ? null : tenantId,
      generator: 'Nexus ITAM Backup Service',
    },
    data: {},
  };

  const results = await Promise.all(
    COLLECTIONS_TO_BACKUP.map(async (colName) => {
      try {
        let q;
        if (isSuperAdmin) {
          q = collection(db, colName);
        } else if (colName === 'settings' || colName === 'tenants') {
          // Documentos cujo ID e o proprio tenantId: leitura direta, sem varrer
          // a colecao inteira (que as regras negariam de qualquer forma).
          const snap = await getDoc(doc(db, colName, tenantId));
          return {
            name: colName,
            docs: snap.exists()
              ? [{
                  _id: snap.id,
                  ...Object.fromEntries(
                    Object.entries(snap.data()).map(([k, v]) => [k, serializeValue(v)]),
                  ),
                }]
              : [],
          };
        } else {
          q = query(collection(db, colName), where('tenantId', '==', tenantId));
        }

        const snapshot = await getDocs(q);
        return {
          name: colName,
          docs: snapshot.docs.map((snap) => ({
            _id: snap.id,
            ...Object.fromEntries(Object.entries(snap.data()).map(([k, v]) => [k, serializeValue(v)])),
          })),
        };
      } catch (err) {
        console.warn(`Sem permissao ou erro ao ler ${colName}`, err);
        return { name: colName, docs: [] };
      }
    }),
  );

  results.forEach((res) => {
    backupData.data[res.name] = res.docs;
  });

  // O token do agente e credencial: nunca sai no arquivo exportado.
  (backupData.data.settings || []).forEach((entry) => {
    delete entry.agentToken;
  });

  return backupData;
};

/**
 * Restaura dados a partir de um arquivo de backup.
 *
 * Regras de seguranca aplicadas a cada documento:
 *  - so colecoes operacionais (users/tenants/settings sao ignoradas);
 *  - `tenantId` e sempre reescrito para o inquilino do usuario logado;
 *  - documentos que ja existem e pertencem a OUTRO inquilino sao recusados,
 *    impedindo que um arquivo forjado sobrescreva dados alheios por ID;
 *  - campos protegidos (role, plan, limits, agentToken...) sao descartados.
 *
 * @param {Object} backupData
 * @param {Function} onProgress callback (percentual, mensagem)
 * @param {string} targetTenantId inquilino de destino — obrigatorio
 */
export const restoreBackup = async (backupData, onProgress, targetTenantId = null) => {
  if (!backupData || !backupData.meta || !backupData.data) {
    throw new Error('Arquivo de backup invalido ou corrompido.');
  }
  if (!targetTenantId) {
    throw new Error('Restauracao exige um inquilino de destino explicito.');
  }

  const stats = {
    totalDocsProcessed: 0,
    collectionsUpdated: [],
    skippedCollections: [],
    rejectedDocs: 0,
    errors: [],
  };

  const collections = Object.keys(backupData.data);
  const restorable = collections.filter((c) => TENANT_COLLECTIONS.includes(c));
  stats.skippedCollections = collections.filter((c) => !TENANT_COLLECTIONS.includes(c));

  let processedCollections = 0;

  for (const colName of restorable) {
    const docs = backupData.data[colName];
    if (!Array.isArray(docs) || docs.length === 0) {
      processedCollections++;
      continue;
    }

    if (onProgress) {
      onProgress(
        Math.round((processedCollections / restorable.length) * 100),
        `Restaurando ${colName}... (${docs.length} itens)`,
      );
    }

    const CHUNK_SIZE = 200;
    for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
      const chunk = docs.slice(i, i + CHUNK_SIZE);

      // Verifica a posse de cada ID ANTES de gravar. Um arquivo forjado que
      // aponte para documentos de outro inquilino e recusado aqui.
      const checked = await Promise.all(
        chunk.map(async (docItem) => {
          const { _id, ...data } = docItem;
          if (!_id || typeof _id !== 'string') return null;

          try {
            const existing = await getDoc(doc(db, colName, _id));
            if (existing.exists() && existing.data().tenantId !== targetTenantId) {
              return null; // documento pertence a outro inquilino
            }
          } catch {
            return null;
          }

          const clean = Object.entries(data).reduce((acc, [key, value]) => {
            if (PROTECTED_FIELDS.includes(key)) return acc;
            acc[key] =
              typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)
                ? new Date(value)
                : value;
            return acc;
          }, {});

          clean.tenantId = targetTenantId;
          clean.restoredAt = serverTimestamp();
          return { id: _id, data: clean };
        }),
      );

      const accepted = checked.filter(Boolean);
      stats.rejectedDocs += chunk.length - accepted.length;
      if (accepted.length === 0) continue;

      const batch = writeBatch(db);
      accepted.forEach((item) => batch.set(doc(db, colName, item.id), item.data, { merge: true }));

      try {
        await batch.commit();
        stats.totalDocsProcessed += accepted.length;
      } catch (err) {
        console.error(`Erro ao gravar lote em ${colName}:`, err);
        stats.errors.push(`Erro no lote ${i} da colecao ${colName}`);
      }
    }

    stats.collectionsUpdated.push(colName);
    processedCollections++;
  }

  if (onProgress) onProgress(100, 'Restauracao finalizada.');
  return stats;
};
