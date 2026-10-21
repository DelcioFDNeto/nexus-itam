// src/services/agentService.js
// -----------------------------------------------------------------------------
// Agente ITAM: transforma o inventario enviado pelas maquinas em registro
// patrimonial.
//
//  - A maquina e reconhecida pela identidade do dispositivo (nao por serial
//    generico de placa montada) — ver utils/agentInventory.
//  - O inventario completo (programas, discos, rede, seguranca) fica em
//    /assetInventory/{assetId}; o ativo guarda so o resumo, para a lista de
//    ativos continuar leve com centenas de maquinas.
//  - A timeline so ganha registro quando algo MUDA (hardware, sistema,
//    programas, usuario) ou na primeira coleta — e nao a cada sincronizacao.
//  - Cada envio da fila e "reservado" numa transacao antes do processamento:
//    dois administradores com o sistema aberto nao incorporam a mesma maquina
//    duas vezes.
// -----------------------------------------------------------------------------
import {
  addDoc,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import { assignLicense, getLicenses, unassignLicense } from './licenseService';
import {
  diffInventory,
  evaluateAgentAlerts,
  findAgentAsset,
  inferAssetType,
  isUsableId,
  locationForIp,
  matchEmployeeByLogin,
  normalizeInventory,
  normalizeLogin,
  reconcileLicenses,
  resolveAgentPolicy,
  vendorName,
} from '../utils/agentInventory';

const agentInboxCollection = collection(db, 'agentInbox');

// Falhar alto e melhor que gravar num inquilino generico: o antigo fallback
// 'default-tenant' juntava dados de empresas diferentes no mesmo balde.
const requireTenant = (tenantId) => {
  if (!tenantId || typeof tenantId !== 'string' || tenantId === 'default-tenant') {
    throw new Error('Operacao do agente exige um inquilino valido.');
  }
  return tenantId;
};

const text = (value) => String(value ?? '').trim();

export const inferAgentAssetType = inferAssetType;

// -----------------------------------------------------------------------------
// Nomenclatura automatica (SHL-BEL-NTB-001)
// -----------------------------------------------------------------------------

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

const parseAssetCode = (internalId) => {
  const parts = String(internalId || '').trim().toUpperCase().split('-');
  if (parts.length < 4) return null;
  const sequence = Number(parts[parts.length - 1]);
  if (!Number.isFinite(sequence)) return null;
  return { companyPrefix: parts[0], locationCode: parts[1], typeCode: parts.slice(2, -1).join('-'), sequence };
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

const sameNaming = (code, config) =>
  code && code.companyPrefix === String(config.companyPrefix).toUpperCase() && code.locationCode === String(config.locationCode).toUpperCase();

export const resolveAgentNaming = (assetType, assets = [], namingConfig = {}) => {
  const config = { ...DEFAULT_AGENT_NAMING, ...namingConfig };
  const codes = assets.filter((a) => a.type === assetType).map((a) => parseAssetCode(a.internalId)).filter((c) => sameNaming(c, config));
  const frequency = codes.reduce((acc, c) => ({ ...acc, [c.typeCode]: (acc[c.typeCode] || 0) + 1 }), {});
  const typeCode = Object.entries(frequency).sort((a, b) => b[1] - a[1])[0]?.[0] || FALLBACK_TYPE_CODES[assetType] || FALLBACK_TYPE_CODES.Outros;
  const base = { ...config, typeCode };
  const nextSequence = assets
    .map((a) => parseAssetCode(a.internalId))
    .filter((c) => sameNaming(c, base) && c.typeCode === String(typeCode).toUpperCase())
    .reduce((max, c) => Math.max(max, c.sequence), 0) + 1;
  return { assetType, namingConfig: { ...base, nextSequence }, nextInternalId: generateAgentAssetCode({ ...base, nextSequence }) };
};

// -----------------------------------------------------------------------------
// Contexto (carregado uma vez por lote: evita N+1 leituras)
// -----------------------------------------------------------------------------

const normalizeNaming = (config = {}) => ({
  ...DEFAULT_AGENT_NAMING,
  ...config,
  companyPrefix: String(config.companyPrefix || DEFAULT_AGENT_NAMING.companyPrefix).toUpperCase(),
  locationCode: String(config.locationCode || DEFAULT_AGENT_NAMING.locationCode).toUpperCase(),
  padLength: Number(config.padLength) || DEFAULT_AGENT_NAMING.padLength,
});

export const loadAgentContext = async (tenantId) => {
  requireTenant(tenantId);
  const byTenant = (name) => getDocs(query(collection(db, name), where('tenantId', '==', tenantId)));
  const [assetsSnap, licenses, locationsSnap, employeesSnap, settingsSnap] = await Promise.all([
    byTenant('assets'),
    getLicenses(tenantId).catch(() => []),
    byTenant('locations').catch(() => ({ docs: [] })),
    byTenant('employees').catch(() => ({ docs: [] })),
    getDoc(doc(db, 'settings', tenantId)).catch(() => null),
  ]);
  const settings = settingsSnap?.exists?.() ? settingsSnap.data() : {};
  const list = (snap) => (snap?.docs || []).map((d) => ({ id: d.id, ...d.data() }));
  return {
    existingAssets: list(assetsSnap),
    existingLicenses: licenses,
    locations: list(locationsSnap),
    employees: list(employeesSnap),
    settings,
    policy: resolveAgentPolicy(settings),
    namingConfig: normalizeNaming(settings.agentNaming || {}),
  };
};

// -----------------------------------------------------------------------------
// Do inventario ao ativo
// -----------------------------------------------------------------------------

const HEAVY_SPEC_KEYS = ['software', 'security', 'monitors'];

const specsFrom = (inventory, previousSpecs = {}) => {
  const kept = Object.fromEntries(Object.entries(previousSpecs || {}).filter(([key]) => !HEAVY_SPEC_KEYS.includes(key)));
  const disks = inventory.disks.length
    ? inventory.disks.map((d) => `${d.model}${d.sizeGb ? ` (${d.sizeGb} GB${d.media ? ` ${d.media}` : ''})` : ''}`).join(' | ')
    : inventory.storageText;
  const fresh = {
    ip: inventory.ip,
    mac: inventory.mac,
    os: [inventory.os.name, inventory.os.build && `build ${inventory.os.build}`].filter(Boolean).join(' '),
    processor: inventory.hardware.processor,
    ram: inventory.hardware.ramGb ? `${inventory.hardware.ramGb} GB` : '',
    storage: disks,
    manufacturer: inventory.hardware.manufacturer,
    boardModel: inventory.hardware.board,
    gpu: inventory.hardware.gpu,
  };
  return { ...kept, ...Object.fromEntries(Object.entries(fresh).filter(([, v]) => text(v))) };
};

const agentSummary = (inventory, alerts, lastChange, source) => ({
  source: text(source) || 'Agente ITAM',
  version: inventory.agentVersion,
  deviceId: inventory.deviceId,
  hostname: inventory.hostname,
  domain: inventory.domain,
  loggedUser: inventory.loggedUser,
  ip: inventory.ip,
  mac: inventory.mac,
  os: inventory.os.name,
  osBuild: inventory.os.build,
  lastBoot: inventory.os.lastBoot,
  collectedAt: inventory.collectedAt,
  lastSeenAt: serverTimestamp(),
  softwareCount: inventory.software.length,
  alerts: alerts.map(({ code, level, message, data }) => ({ code, level, message, ...(data ? { data } : {}) })),
  ...(lastChange ? { lastChange } : {}),
});

/**
 * Patrimonio de uma maquina nova: etiqueta informada, etiqueta da BIOS,
 * hostname no padrao de patrimonio (se o codigo estiver livre) ou o proximo
 * numero da sequencia.
 */
const pickInternalId = (inventory, assets, naming) => {
  const taken = (code) => assets.some((a) => text(a.internalId).toUpperCase() === code);
  if (inventory.explicitInternalId) return inventory.explicitInternalId;
  if (inventory.assetTag) return inventory.assetTag;
  if (inventory.hostnameTag && !taken(inventory.hostnameTag)) return inventory.hostnameTag;
  return naming.nextInternalId;
};

export const MATCH_LABELS = {
  deviceId: 'identificador do dispositivo',
  internalId: 'patrimônio',
  serialNumber: 'número de série',
  hostname: 'nome do computador',
  'hostname+mac': 'nome e MAC',
};

const modelFrom = (inventory) => {
  const model = [vendorName(inventory.hardware.manufacturer), isUsableId(inventory.hardware.model) ? inventory.hardware.model : '']
    .filter(Boolean)
    .join(' ')
    .trim();
  return model || inventory.hostname || 'Equipamento coletado pelo Agente ITAM';
};

/**
 * Registra (ou atualiza) o ativo a partir do inventario enviado pelo agente.
 * @param {object} payload inventario como o agente mandou
 * @param {{ tenantId: string, user?: string, namingConfig?: object, context?: object, source?: string }} options
 * @returns {Promise<{ action: 'created'|'updated', assetId: string, internalId: string, matchField?: string, alerts: number, changes: number }>}
 */
export const registerAgentAsset = async (payload, options = {}) => {
  const tenantId = requireTenant(options.tenantId);
  const ctx = options.context || (await loadAgentContext(tenantId));
  const user = text(options.user) || 'Agente ITAM';
  const inventory = normalizeInventory(payload);
  const match = findAgentAsset(inventory, ctx.existingAssets || []);
  const current = match?.asset || null;
  const assetRef = current ? doc(db, 'assets', current.id) : doc(collection(db, 'assets'));
  const inventoryRef = doc(db, 'assetInventory', assetRef.id);

  let previous = null;
  if (current) {
    const snap = await getDoc(inventoryRef).catch(() => null);
    previous = snap?.exists?.() ? snap.data().inventory || null : null;
  }

  const employee = matchEmployeeByLogin(inventory.loggedUser, ctx.employees || []);
  const networkLocation = locationForIp(inventory.ip, ctx.locations || []);
  const policy = ctx.policy || resolveAgentPolicy(ctx.settings || {});
  const alerts = evaluateAgentAlerts({
    inventory,
    asset: current,
    policy,
    locations: ctx.locations || [],
    employees: ctx.employees || [],
  });
  const changes = diffInventory(previous, inventory);
  const lastChange = changes.length
    ? { at: new Date().toISOString(), summary: changes.map((c) => c.label).join(', ') }
    : current?.agent?.lastChange || null;
  const agent = agentSummary(inventory, alerts, lastChange, payload.source || options.source);
  // Coleta sem identidade (agente antigo, sem permissao) nao apaga a ja conhecida.
  if (current?.agent) {
    if (!agent.deviceId && current.agent.deviceId) agent.deviceId = current.agent.deviceId;
    if (!agent.mac && current.agent.mac) agent.mac = current.agent.mac;
  }
  const batch = writeBatch(db);
  let result;

  if (current) {
    const patch = {
      agent,
      specs: specsFrom(inventory, current.specs),
      updatedAt: serverTimestamp(),
    };
    if (!isUsableId(current.serialNumber) && inventory.serialNumber) patch.serialNumber = inventory.serialNumber;
    if (!text(current.brand) && vendorName(inventory.hardware.manufacturer)) patch.brand = vendorName(inventory.hardware.manufacturer);
    const tag = inventory.explicitInternalId || inventory.assetTag || inventory.hostnameTag;
    if (!text(current.internalId) && tag && !(ctx.existingAssets || []).some((a) => a.id !== current.id && text(a.internalId).toUpperCase() === tag.toUpperCase())) {
      patch.internalId = tag;
    }
    if (!text(current.assignedTo) && inventory.loggedUser && !current.transit) {
      patch.assignedTo = employee?.name || normalizeLogin(inventory.loggedUser);
      if (employee) patch.employeeId = employee.id;
    }
    if (!text(current.location) && networkLocation && !current.transit) patch.location = networkLocation.name;
    batch.update(assetRef, patch);
    result = { action: 'updated', assetId: current.id, internalId: current.internalId || patch.internalId || '', matchField: match.matchField };
  } else {
    const naming = resolveAgentNaming(inventory.type, ctx.existingAssets || [], options.namingConfig || ctx.namingConfig);
    const internalId = pickInternalId(inventory, ctx.existingAssets || [], naming);
    const data = {
      tenantId,
      internalId,
      model: modelFrom(inventory),
      brand: vendorName(inventory.hardware.manufacturer),
      type: inventory.type,
      category: 'Corporativo',
      status: 'Em Uso',
      location: networkLocation?.name || '',
      assignedTo: employee?.name || (inventory.loggedUser ? normalizeLogin(inventory.loggedUser) : ''),
      ...(employee ? { employeeId: employee.id } : {}),
      serialNumber: inventory.serialNumber,
      notes: `Cadastrado automaticamente pelo Agente ITAM (${inventory.hostname || 'sem hostname'}).`,
      specs: specsFrom(inventory),
      agent,
      createdBy: user,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    batch.set(assetRef, data);
    result = { action: 'created', assetId: assetRef.id, internalId };
  }

  batch.set(inventoryRef, { tenantId, assetId: assetRef.id, inventory, updatedAt: serverTimestamp() });

  // Timeline: so o que importa (cadastro, vinculo do agente, mudancas).
  const historyDetails = !current
    ? `Cadastrado pelo Agente ITAM: ${inventory.hostname || 'sem hostname'}, ${inventory.os.name || 'sistema não informado'}.`
    : !current.agent
      ? `Agente ITAM vinculado (reconhecido pelo ${MATCH_LABELS[match.matchField] || match.matchField}).`
      : changes.length
        ? changes.map((c) => `${c.label}${c.from || c.to ? `: ${[c.from, c.to].filter(Boolean).join(' → ')}` : ''}`).join(' | ')
        : '';
  if (historyDetails) {
    batch.set(doc(collection(db, 'history')), {
      assetId: assetRef.id,
      tenantId,
      type: current ? 'agent-sync' : 'creation',
      action: !current ? 'Ativo Criado' : !current.agent ? 'Agente Vinculado' : 'Mudanças Detectadas pelo Agente',
      date: serverTimestamp(),
      user,
      details: historyDetails.slice(0, 1500),
    });
  }
  await batch.commit();

  // SAM: consome ativacoes do que esta instalado e devolve as que o agente
  // atribuiu e o programa saiu da maquina.
  try {
    const { assign, release } = reconcileLicenses(ctx.existingLicenses || [], inventory.software, assetRef.id);
    for (const license of assign) {
      await assignLicense(license.id, assetRef.id, current?.model || modelFrom(inventory), 'agent');
      license.assignedAssets = [...(license.assignedAssets || []), { id: assetRef.id, source: 'agent' }];
    }
    for (const license of release) {
      await unassignLicense(license.id, assetRef.id);
      license.assignedAssets = (license.assignedAssets || []).filter((a) => a?.id !== assetRef.id);
    }
  } catch (error) {
    console.error('Erro na conciliação automática de licenças:', error);
  }

  // Mantem o contexto do lote atualizado (nomenclatura e identidade das proximas).
  const snapshot = { id: assetRef.id, ...(current || {}), agent: { ...agent, lastSeenAt: new Date() }, internalId: result.internalId || current?.internalId, type: current?.type || inventory.type, serialNumber: current?.serialNumber || inventory.serialNumber };
  if (ctx.existingAssets) {
    const index = ctx.existingAssets.findIndex((a) => a.id === assetRef.id);
    if (index >= 0) ctx.existingAssets[index] = snapshot;
    else ctx.existingAssets.push(snapshot);
  }

  return { ...result, alerts: alerts.length, changes: changes.length };
};

/** Mostra o que aconteceria, sem gravar (simulador da tela do agente). */
export const previewAgentPayload = async (payload, options = {}) => {
  const tenantId = requireTenant(options.tenantId);
  const ctx = options.context || (await loadAgentContext(tenantId));
  const inventory = normalizeInventory(payload);
  const match = findAgentAsset(inventory, ctx.existingAssets || []);
  const naming = match ? null : resolveAgentNaming(inventory.type, ctx.existingAssets || [], options.namingConfig || ctx.namingConfig);
  return {
    inventory,
    duplicate: match ? { ...match.asset, matchField: match.matchField } : null,
    internalId: match?.asset.internalId || pickInternalId(inventory, ctx.existingAssets || [], naming),
    resolvedNaming: naming,
    alerts: evaluateAgentAlerts({ inventory, asset: match?.asset || null, policy: ctx.policy, locations: ctx.locations, employees: ctx.employees }),
    location: locationForIp(inventory.ip, ctx.locations || [])?.name || '',
    employee: matchEmployeeByLogin(inventory.loggedUser, ctx.employees || [])?.name || '',
  };
};

/** Compatibilidade: licencas que o software instalado passaria a consumir. */
export const matchLicensesForSoftware = (licenses, softwareList, assetId) =>
  reconcileLicenses(licenses, (softwareList || []).map((name) => ({ name })), assetId).assign;

// -----------------------------------------------------------------------------
// Fila de recepcao
// -----------------------------------------------------------------------------

const PROCESSING_TIMEOUT_MS = 10 * 60 * 1000;

const millis = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
};

export const getAgentSubmissions = async (tenantId, max = 100) => {
  if (!tenantId) return [];
  const snapshot = await getDocs(query(agentInboxCollection, where('tenantId', '==', tenantId), orderBy('createdAt', 'desc'), limit(max)));
  return snapshot.docs.map((submission) => ({ id: submission.id, ...submission.data() }));
};

/** Reserva o envio para este navegador. Devolve null se outro ja pegou. */
const claimSubmission = (submissionId, user) =>
  runTransaction(db, async (tx) => {
    const ref = doc(db, 'agentInbox', submissionId);
    const snap = await tx.get(ref);
    if (!snap.exists()) return null;
    const data = snap.data();
    const abandoned = data.status === 'processing' && Date.now() - millis(data.claimedAt) > PROCESSING_TIMEOUT_MS;
    if (data.status !== 'pending' && data.status !== 'error' && !abandoned) return null;
    tx.update(ref, { status: 'processing', claimedBy: user, claimedAt: serverTimestamp() });
    return { id: snap.id, ...data };
  });

/**
 * Fecha o envio. Se a maquina mandou um inventario novo no meio do caminho
 * (o documento foi regravado), deixa como esta: o novo sera processado.
 * O token do agente e apagado do documento processado.
 */
const finishSubmission = (submission, patch) =>
  runTransaction(db, async (tx) => {
    const ref = doc(db, 'agentInbox', submission.id);
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const data = snap.data();
    if (data.status !== 'processing' || millis(data.createdAt) !== millis(submission.createdAt)) return;
    tx.update(ref, { ...patch, agentToken: deleteField(), processedAt: serverTimestamp() });
  });

/**
 * Processa a fila: reserva cada envio, incorpora e fecha.
 * @param {{ tenantId: string, user: string, ids?: string[], max?: number, canCreate?: () => Promise<void>,
 *           trustedOnly?: boolean, onProgress?: (done: number, total: number) => void }} options
 *   canCreate: lanca erro quando o plano nao comporta mais ativos.
 *   trustedOnly: so processa envios de IP nas redes confiaveis (aceite automatico).
 */
export const processAgentInbox = async ({ tenantId, user, ids = null, max = 50, canCreate = null, trustedOnly = false, onProgress = null }) => {
  requireTenant(tenantId);
  const summary = { processed: 0, created: 0, updated: 0, alerts: 0, skipped: 0, errors: [] };

  let candidates;
  if (ids?.length) {
    const snaps = await Promise.all(ids.map((id) => getDoc(doc(db, 'agentInbox', id))));
    candidates = snaps.filter((s) => s.exists()).map((s) => ({ id: s.id, ...s.data() }));
  } else {
    const snap = await getDocs(query(agentInboxCollection, where('tenantId', '==', tenantId), where('status', 'in', ['pending', 'processing']), limit(max)));
    candidates = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  candidates = candidates.filter((c) => c.tenantId === tenantId);
  if (!candidates.length) return summary;

  const ctx = await loadAgentContext(tenantId);
  const trusted = String(ctx.settings.trustedIps || '').split(',').map(text).filter(Boolean);
  const isTrusted = (ip) => !trusted.length || trusted.some((range) => (range.endsWith('.') ? ip.startsWith(range) : ip === range || ip.startsWith(`${range}.`)));

  let done = 0;
  for (const candidate of candidates) {
    done += 1;
    onProgress?.(done, candidates.length);
    if (trustedOnly && !isTrusted(text(candidate.ip_address || candidate.payload?.ip_address))) {
      summary.skipped += 1;
      continue;
    }
    const claimed = await claimSubmission(candidate.id, user).catch(() => null);
    if (!claimed) {
      summary.skipped += 1;
      continue;
    }
    try {
      const inventory = normalizeInventory(claimed.payload || {});
      if (canCreate && !findAgentAsset(inventory, ctx.existingAssets)) await canCreate();
      const result = await registerAgentAsset(claimed.payload || {}, { tenantId, user, context: ctx, namingConfig: ctx.namingConfig, source: claimed.source });
      await finishSubmission(claimed, { status: 'processed', result, error: deleteField() });
      summary.processed += 1;
      summary[result.action] += 1;
      summary.alerts += result.alerts;
    } catch (error) {
      console.error('Falha ao processar envio do agente:', error);
      summary.errors.push({ id: claimed.id, hostname: claimed.hostname, message: error.message });
      await finishSubmission(claimed, { status: 'error', error: text(error.message).slice(0, 300) }).catch(() => {});
      // Limite do plano: nao adianta tentar os proximos.
      if (/limite|plano/i.test(error.message)) break;
    }
  }
  return summary;
};

/** Devolve um envio com erro para a fila. */
export const retryAgentSubmission = (submissionId) =>
  updateDoc(doc(db, 'agentInbox', submissionId), { status: 'pending', error: deleteField(), claimedBy: deleteField() });

export const markAgentSubmission = async (submissionId, data) => {
  await updateDoc(doc(db, 'agentInbox', submissionId), { ...data, processedAt: serverTimestamp() });
};

/** Envio feito pela propria aplicacao (importacao de JSON no simulador). */
export const enqueueAgentSubmission = async (payload, source = 'manual', tenantId = null) => {
  requireTenant(tenantId);
  const inventory = normalizeInventory(payload);
  return addDoc(agentInboxCollection, {
    payload,
    source,
    status: 'pending',
    tenantId,
    hostname: inventory.hostname,
    internalId: inventory.explicitInternalId,
    serialNumber: inventory.serialNumber,
    ip_address: inventory.ip,
    createdAt: serverTimestamp(),
  });
};

/** Inventario completo (programas, discos, rede, seguranca) de um ativo. */
export const getAssetInventory = async (assetId) => {
  const snap = await getDoc(doc(db, 'assetInventory', assetId));
  return snap.exists() ? snap.data() : null;
};
