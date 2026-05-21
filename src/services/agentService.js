import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from './firebase';
import { createAsset, updateAsset } from './assetService';

const assetsCollection = collection(db, 'assets');
const agentInboxCollection = collection(db, 'agentInbox');

const normalizeComparable = (value) =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');

const isUsableIdentifier = (value) => {
  const normalized = normalizeComparable(value);
  return Boolean(normalized) && !['N/A', 'NA', 'NULL', 'NONE', 'DESCONHECIDO', 'OFFLINE', '0', '00000000'].includes(normalized);
};

const firstUsable = (...values) => values.find(isUsableIdentifier) || '';

export const DEFAULT_AGENT_NAMING = {
  companyPrefix: 'SHL',
  locationCode: 'BEL',
  padLength: 3,
};

const FALLBACK_TYPE_CODES = {
  Notebook: 'NTB',
  Computador: 'CPU',
  Servidor: 'SRV',
  Impressora: 'IMP',
  Monitor: 'MON',
  Celular: 'CEL',
  PGT: 'PGT',
  Rede: 'RED',
  Outros: 'OTR',
};

const NOTEBOOK_CHASSIS_TYPES = new Set([8, 9, 10, 11, 12, 14, 18, 21, 30, 31, 32]);
const DESKTOP_CHASSIS_TYPES = new Set([3, 4, 5, 6, 7, 13, 15, 16, 35, 36]);
const SERVER_CHASSIS_TYPES = new Set([23, 28]);

export const inferAgentAssetType = (payload = {}) => {
  const hardware = payload.hardware || {};
  const explicitType = payload.type || payload.assetType || payload.tipo || hardware.asset_type;
  if (explicitType) return explicitType;

  const pcSystemType = Number(hardware.pc_system_type || payload.pc_system_type);
  if (pcSystemType === 4 || pcSystemType === 5) return 'Servidor';
  if (pcSystemType === 2) return 'Notebook';
  if (pcSystemType === 1 || pcSystemType === 3) return 'Computador';

  const chassisValues = Array.isArray(hardware.chassis_types)
    ? hardware.chassis_types
    : String(hardware.chassis_types || '')
      .split(/[,\s|]+/)
      .map((value) => Number(value))
      .filter(Boolean);

  if (chassisValues.some((value) => SERVER_CHASSIS_TYPES.has(value))) return 'Servidor';
  if (chassisValues.some((value) => NOTEBOOK_CHASSIS_TYPES.has(value))) return 'Notebook';
  if (chassisValues.some((value) => DESKTOP_CHASSIS_TYPES.has(value))) return 'Computador';

  const text = [
    payload.hostname,
    payload.model,
    hardware.modelo,
    hardware.modelo_sistema,
    hardware.modelo_placa,
    hardware.fabricante,
  ].join(' ').toLowerCase();

  if (text.includes('server') || text.includes('poweredge') || text.includes('proliant')) return 'Servidor';
  if (text.includes('notebook') || text.includes('laptop') || text.includes('latitude') || text.includes('thinkpad') || text.includes('book')) return 'Notebook';
  return 'Computador';
};

const parseAssetCode = (internalId) => {
  const parts = String(internalId || '').trim().toUpperCase().split('-');
  if (parts.length < 4) return null;
  const sequence = Number(parts[parts.length - 1]);
  if (!Number.isFinite(sequence)) return null;

  return {
    companyPrefix: parts[0],
    locationCode: parts[1],
    typeCode: parts.slice(2, -1).join('-'),
    sequence,
  };
};

export const generateAgentAssetCode = (namingConfig = DEFAULT_AGENT_NAMING) => {
  const config = { ...DEFAULT_AGENT_NAMING, ...namingConfig };
  const sequence = Number(config.nextSequence) || 1;
  const padLength = Number(config.padLength) || DEFAULT_AGENT_NAMING.padLength;
  const prefix = [config.companyPrefix, config.locationCode, config.typeCode]
    .map((part) => String(part || '').trim().toUpperCase())
    .filter(Boolean)
    .join('-');

  return `${prefix}-${String(sequence).padStart(padLength, '0')}`;
};

const resolveTypeCodeFromAssets = (assets, assetType, namingConfig) => {
  const config = { ...DEFAULT_AGENT_NAMING, ...namingConfig };
  const matches = assets
    .filter((asset) => asset.type === assetType)
    .map((asset) => parseAssetCode(asset.internalId))
    .filter((code) =>
      code &&
      code.companyPrefix === String(config.companyPrefix).toUpperCase() &&
      code.locationCode === String(config.locationCode).toUpperCase()
    );

  if (matches.length > 0) {
    const frequency = matches.reduce((acc, code) => {
      acc[code.typeCode] = (acc[code.typeCode] || 0) + 1;
      return acc;
    }, {});

    return Object.entries(frequency).sort((a, b) => b[1] - a[1])[0][0];
  }

  return FALLBACK_TYPE_CODES[assetType] || FALLBACK_TYPE_CODES.Outros;
};

const resolveNextSequenceFromAssets = (assets, namingConfig) => {
  const config = { ...DEFAULT_AGENT_NAMING, ...namingConfig };
  const maxSequence = assets
    .map((asset) => parseAssetCode(asset.internalId))
    .filter((code) =>
      code &&
      code.companyPrefix === String(config.companyPrefix).toUpperCase() &&
      code.locationCode === String(config.locationCode).toUpperCase() &&
      code.typeCode === String(config.typeCode).toUpperCase()
    )
    .reduce((max, code) => Math.max(max, code.sequence), 0);

  return maxSequence + 1;
};

export const resolveAgentNamingFromDatabase = async (payload = {}, options = {}) => {
  const tenantId = options.tenantId || 'default-tenant';
  const assetType = inferAgentAssetType(payload);
  const q = query(assetsCollection, where('tenantId', '==', tenantId));
  const snapshot = await getDocs(q);
  const assets = snapshot.docs.map((assetDoc) => ({ id: assetDoc.id, ...assetDoc.data() }));
  const typeCode = resolveTypeCodeFromAssets(assets, assetType, options.namingConfig);
  const baseConfig = {
    ...DEFAULT_AGENT_NAMING,
    ...options.namingConfig,
    typeCode,
  };
  const nextSequence = resolveNextSequenceFromAssets(assets, baseConfig);

  return {
    assetType,
    namingConfig: {
      ...baseConfig,
      nextSequence,
    },
    nextInternalId: generateAgentAssetCode({ ...baseConfig, nextSequence }),
  };
};

const resolveInternalId = (payload, hostname, namingConfig) => {
  const explicitId = firstUsable(payload.internalId, payload.internal_id, payload.patrimonio, payload.assetTag);
  if (explicitId) return explicitId;
  if (namingConfig) return generateAgentAssetCode(namingConfig);
  return hostname ? `AGT-${hostname}` : '';
};

const normalizeAgentPayload = (payload = {}, options = {}) => {
  const hardware = payload.hardware || {};
  const hostname = payload.hostname || payload.computerName || payload.computer_name || '';
  const serialNumber = firstUsable(
    payload.serialNumber,
    payload.serial_number,
    hardware.bios_serial,
    hardware.placa_mae_serial,
    hardware.serial
  );

  return {
    raw: payload,
    hostname,
    loggedUser: payload.usuario_logado || payload.loggedUser || payload.user || '',
    internalId: resolveInternalId(payload, hostname, options.namingConfig),
    type: options.assetType || inferAgentAssetType(payload),
    serialNumber,
    macAddress: payload.mac_address || payload.macAddress || '',
    ipAddress: payload.ip_address || payload.ipAddress || '',
    operatingSystem: payload.sistema_operacional || payload.operatingSystem || '',
    manufacturer: hardware.fabricante || payload.fabricante || '',
    boardModel: hardware.modelo_placa || payload.modelo_placa || '',
    processor: hardware.processador || payload.processador || '',
    ramGb: hardware.ram_gb || payload.ram_gb || '',
    storage: hardware.storage || hardware.discos || payload.storage || '',
    collectedAt: payload.data_coleta || payload.collectedAt || new Date().toISOString(),
  };
};

const toAssetData = (normalized) => ({
  model: normalized.hostname || normalized.boardModel || 'Ativo coletado pelo Agente ITAM',
  internalId: normalized.internalId,
  type: normalized.type,
  category: 'Corporativo',
  status: 'Em Uso',
  location: 'Coletado pelo Agente ITAM',
  assignedTo: normalized.loggedUser,
  serialNumber: normalized.serialNumber,
  notes: `Coletado automaticamente pelo Agente ITAM em ${normalized.collectedAt}.`,
  specs: {
    ip: normalized.ipAddress,
    mac: normalized.macAddress,
    os: normalized.operatingSystem,
    processor: normalized.processor,
    ram: normalized.ramGb ? `${normalized.ramGb} GB` : '',
    storage: normalized.storage,
    manufacturer: normalized.manufacturer,
    boardModel: normalized.boardModel,
  },
  agent: {
    source: 'Agente ITAM',
    hostname: normalized.hostname,
    loggedUser: normalized.loggedUser,
    collectedAt: normalized.collectedAt,
    raw: normalized.raw,
  },
});

export const findDuplicateAsset = async ({ internalId, serialNumber, tenantId }) => {
  const targetInternalId = normalizeComparable(internalId);
  const targetSerialNumber = normalizeComparable(serialNumber);
  const targetTenantId = tenantId || 'default-tenant';

  if (isUsableIdentifier(internalId)) {
    const byInternalId = query(
      assetsCollection,
      where('tenantId', '==', targetTenantId),
      where('internalId', '==', internalId),
      limit(1)
    );
    const snapshot = await getDocs(byInternalId);
    if (!snapshot.empty) {
      const found = snapshot.docs[0];
      return { id: found.id, matchField: 'internalId', ...found.data() };
    }
  }

  if (isUsableIdentifier(serialNumber)) {
    const bySerial = query(
      assetsCollection,
      where('tenantId', '==', targetTenantId),
      where('serialNumber', '==', serialNumber),
      limit(1)
    );
    const snapshot = await getDocs(bySerial);
    if (!snapshot.empty) {
      const found = snapshot.docs[0];
      return { id: found.id, matchField: 'serialNumber', ...found.data() };
    }
  }

  if (targetInternalId || targetSerialNumber) {
    const q = query(assetsCollection, where('tenantId', '==', targetTenantId));
    const snapshot = await getDocs(q);
    const found = snapshot.docs.find((assetDoc) => {
      const data = assetDoc.data();
      return (
        (targetInternalId && normalizeComparable(data.internalId) === targetInternalId) ||
        (targetSerialNumber && normalizeComparable(data.serialNumber) === targetSerialNumber)
      );
    });

    if (found) {
      const data = found.data();
      const matchField = targetInternalId && normalizeComparable(data.internalId) === targetInternalId
        ? 'internalId'
        : 'serialNumber';
      return { id: found.id, matchField, ...data };
    }
  }

  return null;
};

export const previewAgentPayload = async (payload, options = {}) => {
  const tenantId = options.tenantId || 'default-tenant';
  const explicitId = firstUsable(payload.internalId, payload.internal_id, payload.patrimonio, payload.assetTag);
  const resolved = explicitId ? null : await resolveAgentNamingFromDatabase(payload, options);
  const normalized = normalizeAgentPayload(payload, {
    ...options,
    assetType: resolved?.assetType,
    namingConfig: resolved?.namingConfig || options.namingConfig,
  });
  const duplicate = await findDuplicateAsset({ ...normalized, tenantId });
  return {
    normalized,
    resolvedNaming: resolved,
    assetData: toAssetData(normalized),
    duplicate,
  };
};

export const registerAgentAsset = async (payload, options = {}) => {
  const tenantId = options.tenantId || 'default-tenant';
  const explicitId = firstUsable(payload.internalId, payload.internal_id, payload.patrimonio, payload.assetTag);
  const resolved = explicitId ? null : await resolveAgentNamingFromDatabase(payload, options);
  const normalized = normalizeAgentPayload(payload, {
    ...options,
    assetType: resolved?.assetType,
    namingConfig: resolved?.namingConfig || options.namingConfig,
  });
  const assetData = toAssetData(normalized);
  const duplicate = await findDuplicateAsset({ ...normalized, tenantId });
  const user = options.user || 'Agente ITAM';

  if (duplicate) {
    const updateData = {
      serialNumber: duplicate.serialNumber || assetData.serialNumber,
      specs: {
        ...(duplicate.specs || {}),
        ...assetData.specs,
      },
      agent: assetData.agent,
    };

    if (!duplicate.internalId && assetData.internalId) updateData.internalId = assetData.internalId;
    if (!duplicate.assignedTo && assetData.assignedTo) updateData.assignedTo = assetData.assignedTo;
    if (!duplicate.location) updateData.location = assetData.location;

    await updateAsset(duplicate.id, updateData, {
      tenantId,
      type: 'agent-sync',
      action: 'Sincronização do Agente',
      details: `Ativo atualizado pelo agente. Correspondência por ${duplicate.matchField}.`,
      user,
    });

    return {
      action: 'updated',
      assetId: duplicate.id,
      duplicate,
      assetData: updateData,
    };
  }

  const docRef = await createAsset({
    ...assetData,
    tenantId,
    createdBy: user,
  });

  return {
    action: 'created',
    assetId: docRef.id,
    duplicate: null,
    resolvedNaming: resolved,
    assetData,
  };
};

export const getAgentSubmissions = async (tenantId) => {
  if (!tenantId) return [];
  const q = query(
    agentInboxCollection,
    where('tenantId', '==', tenantId),
    orderBy('createdAt', 'desc'),
    limit(50)
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((submission) => ({ id: submission.id, ...submission.data() }));
};

export const markAgentSubmission = async (submissionId, data) => {
  const submissionRef = doc(db, 'agentInbox', submissionId);
  await updateDoc(submissionRef, {
    ...data,
    processedAt: serverTimestamp(),
  });
};

export const enqueueAgentSubmission = async (payload, source = 'manual', tenantId = 'default-tenant') => {
  const normalized = normalizeAgentPayload(payload);
  return addDoc(agentInboxCollection, {
    payload,
    source,
    status: 'pending',
    tenantId,
    hostname: normalized.hostname,
    internalId: normalized.internalId,
    serialNumber: normalized.serialNumber,
    createdAt: serverTimestamp(),
  });
};
