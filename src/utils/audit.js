// src/utils/audit.js
// -----------------------------------------------------------------------------
// Auditoria patrimonial (inventario fisico por local), sem Firebase.
//
// Uma auditoria compara o que DEVERIA estar num local (cadastro) com o que foi
// LIDO la (etiqueta, digitacao ou confirmacao do Agente ITAM). Cada leitura e
// classificada e o resultado vira um relatorio imutavel.
// -----------------------------------------------------------------------------
import { isRetired } from './assetStatus';
import { ipInNetwork, parseNetworks } from './agentInventory';

const text = (value) => String(value ?? '').trim();

const fold = (value) =>
  text(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

export const sameLocation = (a, b) => Boolean(text(a)) && fold(a) === fold(b);

/** Locais sem auditoria ha mais que isto ficam "vencidos". */
export const AUDIT_COVERAGE_DAYS = 90;

/**
 * Entra na contagem? Inventario vivo, fora do comodato promocional (que fica
 * com o cliente/vendedor e nao no local).
 */
export const isAuditable = (asset) =>
  !isRetired(asset?.status) && asset?.category !== 'Promocional' && !text(asset?.internalId).toUpperCase().includes('PRM');

export const normalizeCode = (value) => text(value).toUpperCase().replace(/\s+/g, '');

const usableSerial = (value) => {
  const code = normalizeCode(value).replace(/[^A-Z0-9]/g, '');
  return code.length >= 4 && !/^(.)\1+$/.test(code) && !['DEFAULTSTRING', 'TOBEFILLEDBYOEM', 'NA', 'NONE'].includes(code);
};

/** Indice para achar o ativo pelo que foi lido. */
export const buildAssetIndex = (assets = []) => {
  const byCode = new Map();
  const bySerial = new Map();
  const byId = new Map();
  assets.forEach((asset) => {
    byId.set(asset.id, asset);
    if (text(asset.internalId)) byCode.set(normalizeCode(asset.internalId), asset);
    if (usableSerial(asset.serialNumber)) bySerial.set(normalizeCode(asset.serialNumber), asset);
  });
  return { byCode, bySerial, byId };
};

/**
 * Ativo correspondente ao codigo lido: patrimonio (QR da etiqueta), numero de
 * serie (etiqueta do fabricante) ou link do ativo (".../assets/{id}").
 */
export const resolveScan = (raw, index) => {
  const value = text(raw);
  if (!value) return null;
  const link = value.match(/\/assets\/([A-Za-z0-9_-]+)/);
  if (link) return index.byId.get(link[1]) || null;
  const code = normalizeCode(value);
  return index.byCode.get(code) || index.bySerial.get(code) || null;
};

export const SCAN_RESULTS = {
  found: { label: 'Encontrado', tone: 'green' },
  missing: { label: 'Não localizado', tone: 'rose' },
  other_location: { label: 'De outro local', tone: 'amber' },
  retired: { label: 'Baixado, mas presente', tone: 'rose' },
  transit_in: { label: 'Em trânsito para cá', tone: 'blue' },
  transit_out: { label: 'Transferido, mas ainda aqui', tone: 'amber' },
  unknown: { label: 'Não cadastrado', tone: 'slate' },
};

/** Classifica uma leitura feita no local auditado. */
export const classifyScan = (asset, location) => {
  if (!asset) return 'unknown';
  if (isRetired(asset.status)) return 'retired';
  if (asset.transit?.termId) return sameLocation(asset.transit.to, location) ? 'transit_in' : 'transit_out';
  return sameLocation(asset.location, location) ? 'found' : 'other_location';
};

/** O que o cadastro diz que esta no local (fora de transferencia em andamento). */
export const expectedAt = (assets = [], location) =>
  assets.filter((a) => sameLocation(a.location, location) && isAuditable(a) && !a.transit?.termId);

const HOUR_MS = 60 * 60 * 1000;

const toDate = (value) => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Maquina que o Agente ITAM viu na rede deste local nas ultimas horas: a
 * presenca pode ser confirmada sem ir ate ela.
 */
export const seenByAgentAt = (asset, location, { now = new Date(), hours = 24 } = {}) => {
  const seen = toDate(asset?.agent?.lastSeenAt);
  if (!seen || now.getTime() - seen.getTime() > hours * HOUR_MS) return false;
  const networks = parseNetworks(location?.networks);
  return networks.length > 0 && networks.some((net) => ipInNetwork(asset.agent.ip, net));
};

/**
 * Resultado da conferencia.
 * @param {object[]} expected ativos esperados no local
 * @param {Array<{assetId?: string, code: string, result: string, method: string}>} scans
 */
export const summarizeAudit = (expected = [], scans = []) => {
  const foundIds = new Set(scans.filter((s) => s.result === 'found').map((s) => s.assetId));
  const foundAssets = expected.filter((a) => foundIds.has(a.id));
  const missingAssets = expected.filter((a) => !foundIds.has(a.id));
  const count = (...results) => scans.filter((s) => results.includes(s.result)).length;
  return {
    expected: expected.length,
    found: foundAssets.length,
    missing: missingAssets.length,
    otherLocation: count('other_location'),
    retired: count('retired'),
    transit: count('transit_in', 'transit_out'),
    unknown: count('unknown'),
    byAgent: scans.filter((s) => s.method === 'agent').length,
    accuracy: expected.length ? Math.round((foundAssets.length / expected.length) * 100) : 100,
    foundAssets,
    missingAssets,
  };
};

const MAX_REPORT_ITEMS = 800;

/** Registro imutavel da auditoria (fotografia dos itens no momento). */
export const buildAuditRecord = ({ tenantId, location, startedAt, auditedBy, auditedByName, expected, scans, notes }) => {
  const summary = summarizeAudit(expected, scans);
  const snap = (asset) => ({ assetId: asset.id, internalId: text(asset.internalId), model: text(asset.model), from: text(asset.location) });
  const scanById = new Map(scans.filter((s) => s.assetId).map((s) => [s.assetId, s]));
  const items = [
    ...summary.missingAssets.map((a) => ({ ...snap(a), result: 'missing', method: '' })),
    ...scans
      .filter((s) => s.result !== 'found')
      .map((s) => ({ assetId: s.assetId || '', internalId: text(s.internalId || s.code), model: text(s.model), from: text(s.from), result: s.result, method: s.method })),
    ...summary.foundAssets.map((a) => ({ ...snap(a), result: 'found', method: scanById.get(a.id)?.method || 'qr' })),
  ].slice(0, MAX_REPORT_ITEMS);
  return {
    tenantId,
    location,
    startedAt: toDate(startedAt)?.toISOString() || '',
    auditedBy: text(auditedBy),
    auditedByName: text(auditedByName) || text(auditedBy),
    notes: text(notes),
    status: summary.missing === 0 ? 'Completa' : 'Parcial',
    stats: {
      expected: summary.expected,
      found: summary.found,
      missing: summary.missing,
      intruders: summary.otherLocation,
      retired: summary.retired,
      transit: summary.transit,
      unknown: summary.unknown,
      byAgent: summary.byAgent,
      accuracy: summary.accuracy,
    },
    items,
    // compatibilidade com relatorios antigos
    missingItems: summary.missingAssets.map((a) => a.internalId),
    intruderItems: scans.filter((s) => s.result === 'other_location').map((s) => s.internalId || s.code),
  };
};

const DAY_MS = 24 * HOUR_MS;

/**
 * Cobertura: ultima auditoria de cada local e quais estao vencidas.
 * @param {string[]} locationNames
 * @param {object[]} audits mais recentes primeiro
 */
export const auditCoverage = (locationNames = [], audits = [], { now = new Date(), days = AUDIT_COVERAGE_DAYS } = {}) =>
  locationNames.map((name) => {
    const last = audits.find((a) => sameLocation(a.location, name)) || null;
    const date = toDate(last?.date);
    const daysSince = date ? Math.floor((now.getTime() - date.getTime()) / DAY_MS) : null;
    return { name, last, daysSince, overdue: daysSince === null || daysSince > days };
  });

/** Quantas auditorias foram feitas nos ultimos `days` dias. */
export const auditsInLastDays = (audits = [], days = 30, now = new Date()) =>
  audits.filter((a) => {
    const date = toDate(a.dateValue || a.date);
    return date && now.getTime() - date.getTime() <= days * DAY_MS;
  }).length;
