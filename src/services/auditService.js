// src/services/auditService.js
// -----------------------------------------------------------------------------
// Auditorias patrimoniais. Nada e gravado durante a leitura: ao finalizar,
// o relatorio (imutavel), a situacao de cada ativo e um registro na linha do
// tempo de cada um saem juntos. Antes cada bip ja marcava o ativo como
// "Conforme" — e sair sem salvar deixava a marca sem relatorio.
// -----------------------------------------------------------------------------
import { collection, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import { buildAuditRecord, SCAN_RESULTS } from '../utils/audit';

const ASSET_STATUS_BY_RESULT = {
  found: 'Conforme',
  missing: 'Não localizado',
  other_location: 'Local divergente',
  retired: 'Baixado encontrado',
  transit_in: 'Em trânsito (presente)',
  transit_out: 'Em trânsito (presente)',
};

// Cada ativo gera 2 escritas (ativo + historico): 220 por lote fica abaixo de 500.
const ASSETS_PER_BATCH = 220;

const toDate = (value) => (typeof value?.toDate === 'function' ? value.toDate() : value ? new Date(value) : null);

const withDates = (snap) => {
  const data = snap.data();
  return { id: snap.id, ...data, dateValue: toDate(data.date) };
};

export const listAudits = async (tenantId, max = 100) => {
  if (!tenantId) return [];
  const snap = await getDocs(query(collection(db, 'audits'), where('tenantId', '==', tenantId), orderBy('date', 'desc'), limit(max)));
  return snap.docs.map(withDates);
};

export const getAudit = async (auditId) => {
  const snap = await getDoc(doc(db, 'audits', auditId));
  return snap.exists() ? withDates(snap) : null;
};

/**
 * Finaliza a auditoria.
 * @returns {Promise<string>} id do relatorio
 */
export const saveAudit = async ({ tenantId, user, location, startedAt, expected, scans, notes }) => {
  if (!tenantId) throw new Error('Auditoria sem empresa.');
  const auditRef = doc(collection(db, 'audits'));
  const record = buildAuditRecord({
    tenantId, location, startedAt, auditedBy: user?.email, auditedByName: user?.name, expected, scans, notes,
  });

  const touched = record.items.filter((item) => item.assetId && ASSET_STATUS_BY_RESULT[item.result]);
  const chunks = [];
  for (let i = 0; i < Math.max(touched.length, 1); i += ASSETS_PER_BATCH) chunks.push(touched.slice(i, i + ASSETS_PER_BATCH));

  for (let c = 0; c < chunks.length; c += 1) {
    const batch = writeBatch(db);
    // O relatorio vai no primeiro lote: se algo falhar depois, ele ja existe.
    if (c === 0) batch.set(auditRef, { ...record, date: serverTimestamp() });
    chunks[c].forEach((item) => {
      batch.update(doc(db, 'assets', item.assetId), {
        lastAudit: serverTimestamp(),
        lastAuditId: auditRef.id,
        lastAuditLocation: location,
        auditStatus: ASSET_STATUS_BY_RESULT[item.result],
        ...(item.result !== 'found' && item.result !== 'missing' ? { auditFoundAt: location } : {}),
      });
      batch.set(doc(collection(db, 'history')), {
        assetId: item.assetId,
        tenantId,
        type: 'auditoria',
        action: `Auditoria: ${SCAN_RESULTS[item.result].label}`,
        date: serverTimestamp(),
        user: user?.email || 'Sistema',
        auditId: auditRef.id,
        details: item.result === 'missing'
          ? `Não localizado na auditoria de ${location}.`
          : item.result === 'found'
            ? `Conferido em ${location}${item.method === 'agent' ? ' (presença confirmada pelo Agente ITAM)' : ''}.`
            : `Encontrado em ${location}; cadastro diz ${item.from || 'local não informado'}.`,
      });
    });
    await batch.commit();
  }
  return auditRef.id;
};
