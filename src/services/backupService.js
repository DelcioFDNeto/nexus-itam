// src/services/backupService.js
import { db } from './firebase';
import { collection, getDocs, writeBatch, doc, getDoc, serverTimestamp, query, where } from 'firebase/firestore';
import { assertWithinLimit } from './tenantService';
import { invalidateTenantSettings } from '../hooks/useTenantSettings';

// -----------------------------------------------------------------------------
// Colecoes de dados operacionais. Todas sao escopadas por `tenantId`.
// NOTA IMPORTANTE: 'termFiles' contem arquivos pesados (fotos/PDFs em base64/chunks)
// e foi propositalmente excluida do backup JSON para preservar memoria e conexao.
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
  'locations',
  'terms',
  'termCounters',
];

// Exportadas para leitura/arquivamento, mas NUNCA restauraveis pelo cliente.
// Restaurar `users` permitiria reescrever papeis; restaurar `tenants` permitiria
// reescrever plano e limites; `settings` carrega configuracao de seguranca.
const EXPORT_ONLY_COLLECTIONS = ['settings', 'tenants', 'users'];

const COLLECTIONS_TO_BACKUP = [...TENANT_COLLECTIONS, ...EXPORT_ONLY_COLLECTIONS];

// Campos que o arquivo de backup nunca pode reescrever, mesmo em colecao valida.
const PROTECTED_FIELDS = ['tenantId', 'role', 'plan', 'limits', 'agentToken'];

const isTimestamp = (value) =>
  value && typeof value === 'object' && (
    typeof value.toDate === 'function' ||
    (typeof value.seconds === 'number' && typeof value.nanoseconds === 'number')
  );

const toIsoString = (value) => {
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000).toISOString();
  return new Date(value).toISOString();
};

export const serializeDeep = (value) => {
  if (value === null || value === undefined) return value;
  if (isTimestamp(value)) {
    return { __ts: toIsoString(value) };
  }
  if (value instanceof Date) {
    return { __ts: value.toISOString() };
  }
  if (Array.isArray(value)) {
    return value.map(serializeDeep);
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, serializeDeep(v)])
    );
  }
  return value;
};

const LEGACY_DATE_FIELDS = new Set([
  'createdAt', 'updatedAt', 'date', 'issuedAt', 'receivedAt', 'cancelledAt',
  'purchaseDate', 'acquisitionDate', 'warrantyEnd', 'expiresAt', 'deadline', 'startDate', 'endDate'
]);

export const deserializeDeep = (value, parentKey = '') => {
  if (value === null || value === undefined) return value;
  if (typeof value === 'object' && value.__ts && typeof value.__ts === 'string') {
    return new Date(value.__ts);
  }
  if (Array.isArray(value)) {
    return value.map((item) => deserializeDeep(item, parentKey));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, deserializeDeep(v, k)])
    );
  }
  if (
    typeof value === 'string' &&
    LEGACY_DATE_FIELDS.has(parentKey) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)
  ) {
    return new Date(value);
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
      version: '2.2',
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
                  ...serializeDeep(snap.data()),
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
            ...serializeDeep(snap.data()),
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
 * @param {Object} currentUser usuario logado para validacao de limites
 */
export const restoreBackup = async (backupData, onProgress, targetTenantId = null, currentUser = null) => {
  if (!backupData || !backupData.meta || !backupData.data) {
    throw new Error('Arquivo de backup invalido ou corrompido.');
  }
  if (!targetTenantId) {
    throw new Error('Restauracao exige um inquilino de destino explicito.');
  }

  // Valida limite de ativos antes de comecar
  if (currentUser && Array.isArray(backupData.data?.assets) && backupData.data.assets.length > 0) {
    await assertWithinLimit(currentUser, 'assets', backupData.data.assets.length);
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

          const deserialized = deserializeDeep(data);
          const clean = Object.entries(deserialized).reduce((acc, [key, value]) => {
            if (PROTECTED_FIELDS.includes(key)) return acc;
            acc[key] = value;
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

  // Invalida cache de settings da empresa
  if (targetTenantId) {
    invalidateTenantSettings(targetTenantId);
  }

  if (onProgress) onProgress(100, 'Restauracao finalizada.');
  return stats;
};
