// src/utils/agentInventory.js
// -----------------------------------------------------------------------------
// Nucleo do Agente ITAM (sem Firebase: testavel e usado pelo servico e telas).
//
// O agente roda nas maquinas e manda um inventario. Aqui ele vira um registro
// confiavel: identidade da maquina (sem fundir PCs genericos com serial
// "Default string"), mudancas desde a ultima coleta, alertas de politica e
// seguranca, e sugestoes de local (pela rede) e responsavel (pelo login).
// -----------------------------------------------------------------------------

export const AGENT_VERSION = '3.1.0';

const text = (value) => String(value ?? '').trim();

const fold = (value) =>
  text(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

// -----------------------------------------------------------------------------
// Identificadores de fabrica que NAO identificam nada
// -----------------------------------------------------------------------------

/**
 * Placas genericas (comuns em PCs montados) gravam o mesmo texto em todas as
 * unidades: usar isso como numero de serie juntava maquinas diferentes num
 * unico ativo.
 */
const PLACEHOLDER_IDS = new Set([
  'NA', 'NULL', 'NONE', 'NIL', 'UNKNOWN', 'DESCONHECIDO', 'OFFLINE', 'DEFAULT', 'DEFAULTSTRING',
  'TOBEFILLEDBYOEM', 'TOBEFILLEDBYOEMTOBEFILLEDBYOEM', 'SYSTEMSERIALNUMBER', 'CHASSISSERIALNUMBER',
  'BASEBOARDSERIALNUMBER', 'SERIALNUMBER', 'SERIAL', 'NOTAPPLICABLE', 'NOTSPECIFIED', 'NOTAVAILABLE',
  'INVALID', 'OEM', 'OEMOEM', 'NOASSETTAG', 'NOASSETINFORMATION', 'ASSETTAG', 'ASSETTAGNUM', 'NOASSETTAGNUMBER',
  'ABCDEFGHIJKLMN', '123456789', '0123456789', '1234567890', '12345678', '03000200040005000006000700080009',
  'SYSTEMPRODUCTNAME', 'SYSTEMVERSION', 'NONEPROVIDED', 'EMPTY', 'BLANK', 'XXXX',
]);

/** Valor serve para identificar uma maquina? */
export const isUsableId = (value) => {
  const compact = text(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (compact.length < 4) return false;
  if (PLACEHOLDER_IDS.has(compact)) return false;
  if (/^(.)\1+$/.test(compact)) return false; // 00000000, FFFFFFFF, XXXXXXX
  return true;
};

const firstUsable = (...values) => values.map(text).find(isUsableId) || '';

/**
 * Hostname no formato de patrimonio (SHL-BEL-NTB-001): muitas empresas batizam
 * o computador com a etiqueta. Devolve o codigo em maiusculas, ou ''.
 */
const VENDORS = [
  [/^dell/i, 'Dell'], [/^(hp|hewlett)/i, 'HP'], [/^lenovo/i, 'Lenovo'], [/^samsung/i, 'Samsung'], [/^acer/i, 'Acer'],
  [/^asus/i, 'ASUS'], [/^positivo/i, 'Positivo'], [/^apple/i, 'Apple'], [/^microsoft/i, 'Microsoft'], [/^lg\b/i, 'LG'],
  [/^multilaser/i, 'Multilaser'], [/^vaio/i, 'VAIO'], [/^toshiba/i, 'Toshiba'], [/^micro-star|^msi\b/i, 'MSI'],
  [/^gigabyte/i, 'Gigabyte'], [/^avell/i, 'Avell'], [/^vmware/i, 'VMware'], [/^innotek|^oracle/i, 'VirtualBox'],
];

/** "SAMSUNG ELECTRONICS CO., LTD." -> "Samsung"; texto generico de placa -> ''. */
export const vendorName = (manufacturer) => {
  const raw = text(manufacturer);
  if (!isUsableId(raw)) return '';
  const known = VENDORS.find(([pattern]) => pattern.test(raw));
  if (known) return known[1];
  return raw.replace(/[\s,.]*(co\.?,?\s*ltd\.?|inc\.?|corporation|corp\.?|ltda\.?|limited|gmbh|s\.?\s?a\.?)$/i, '').trim();
};

export const hostnameAssetTag = (hostname) => {
  const value = text(hostname).toUpperCase();
  return /^[A-Z0-9]{2,8}(-[A-Z0-9]{2,8}){1,3}-\d{2,6}$/.test(value) ? value : '';
};

const sameId = (a, b) => isUsableId(a) && isUsableId(b) && text(a).toUpperCase().replace(/\s+/g, '') === text(b).toUpperCase().replace(/\s+/g, '');

// -----------------------------------------------------------------------------
// Tipo do equipamento
// -----------------------------------------------------------------------------

const NOTEBOOK_CHASSIS = new Set([8, 9, 10, 11, 12, 14, 18, 21, 30, 31, 32]);
const DESKTOP_CHASSIS = new Set([3, 4, 5, 6, 7, 13, 15, 16, 35, 36]);
const SERVER_CHASSIS = new Set([17, 23, 28]);

export const inferAssetType = (payload = {}) => {
  const hardware = payload.hardware || {};
  const explicit = text(payload.type || payload.assetType || payload.tipo || hardware.asset_type);
  if (explicit) return explicit;

  const os = fold(payload.os?.name || payload.sistema_operacional);
  if (os.includes('server')) return 'Servidor';

  const pcSystemType = Number(hardware.pc_system_type ?? payload.pc_system_type);
  if (pcSystemType === 4 || pcSystemType === 5 || pcSystemType === 7) return 'Servidor';
  if (pcSystemType === 2) return 'Notebook';

  const chassis = (Array.isArray(hardware.chassis_types) ? hardware.chassis_types : String(hardware.chassis_types || '').split(/[,\s|]+/))
    .map(Number)
    .filter(Boolean);
  if (chassis.some((c) => SERVER_CHASSIS.has(c))) return 'Servidor';
  if (chassis.some((c) => NOTEBOOK_CHASSIS.has(c))) return 'Notebook';
  if (Number(payload.battery?.designCapacity) > 0 || payload.battery?.present === true) return 'Notebook';
  if (chassis.some((c) => DESKTOP_CHASSIS.has(c))) return 'Computador';
  if (pcSystemType === 1 || pcSystemType === 3) return 'Computador';

  const hint = fold([payload.hostname, hardware.modelo_sistema, hardware.model, hardware.modelo_placa, hardware.fabricante].join(' '));
  if (/server|poweredge|proliant/.test(hint)) return 'Servidor';
  if (/notebook|laptop|latitude|thinkpad|vostro 14|ideapad|macbook|elitebook|probook/.test(hint)) return 'Notebook';
  return 'Computador';
};

// -----------------------------------------------------------------------------
// Normalizacao do inventario (agente 2.x e o formato 1.x, ainda em campo)
// -----------------------------------------------------------------------------

const splitList = (value) => (Array.isArray(value) ? value : text(value) ? text(value).split('||') : []);

const num = (value) => {
  const n = Number.parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

const round = (value, digits = 1) => (value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits);

const toIso = (value) => {
  if (!value) return '';
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
};

const cleanSoftware = (list) => {
  const seen = new Set();
  const out = [];
  splitList(list).forEach((entry) => {
    const item = typeof entry === 'string' ? { name: entry } : entry || {};
    const name = text(item.name || item.DisplayName);
    if (!name) return;
    const version = text(item.version || item.DisplayVersion);
    const key = `${fold(name)}|${version}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name, version, publisher: text(item.publisher || item.Publisher) });
  });
  return out.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
};

const cleanLogin = (value) => {
  const login = text(value);
  // Tarefa agendada roda como SYSTEM: isso nao e um usuario.
  if (!login || /^(nt authority\\)?system$/i.test(login) || /\$$/.test(login) || /^root$/i.test(login)) return '';
  return login;
};

const parseAntivirus = (security = {}) => {
  const raw = security.antivirus;
  if (Array.isArray(raw)) {
    return raw.map((av) => ({ name: text(av?.name), enabled: av?.enabled !== false, upToDate: av?.upToDate !== false })).filter((av) => av.name);
  }
  const names = text(raw);
  if (!names || /^nenhum/i.test(names)) return [];
  return names.split(',').map((name) => ({ name: text(name), enabled: true, upToDate: true })).filter((av) => av.name);
};

/**
 * Inventario canonico. Aceita o payload 2.x (estruturado) e o 1.x (campos em
 * portugues, listas "a||b"), que continua chegando de agentes antigos.
 */
export const normalizeInventory = (payload = {}) => {
  const hw = payload.hardware || {};
  const os = payload.os || {};
  const security = payload.security || {};
  const volumes = (payload.volumes || []).map((v) => ({
    drive: text(v.drive || v.mount),
    label: text(v.label),
    sizeGb: round(num(v.sizeGb)),
    freeGb: round(num(v.freeGb)),
    encrypted: v.encrypted === undefined || v.encrypted === null || v.encrypted === '' ? null : v.encrypted === true || v.encrypted === 'true',
  })).filter((v) => v.drive && v.sizeGb);
  const network = (payload.network || []).map((n) => ({ name: text(n.name), mac: text(n.mac).toUpperCase(), ip: text(n.ip), gateway: text(n.gateway) })).filter((n) => n.mac || n.ip);
  const primary = network.find((n) => n.gateway) || network[0] || {};

  const serialNumber = firstUsable(payload.serialNumber, payload.serial_number, hw.serial, hw.bios_serial, hw.chassis_serial, hw.placa_mae_serial);
  const assetTag = firstUsable(payload.assetTag, payload.asset_tag, hw.asset_tag);

  return {
    agentVersion: text(payload.agentVersion || payload.agent_version) || '1.x',
    deviceId: firstUsable(payload.deviceId, payload.device_id),
    smbiosUuid: firstUsable(payload.smbiosUuid, hw.smbios_uuid, hw.uuid),
    hostname: text(payload.hostname || payload.computerName || payload.computer_name),
    domain: text(payload.domain || os.domain),
    loggedUser: cleanLogin(payload.loggedUser || payload.usuario_logado || payload.user),
    collectedAt: toIso(payload.collectedAt || payload.data_coleta) || new Date().toISOString(),
    // Patrimonio informado de proposito (etiqueta gravada na BIOS ou campo do JSON).
    explicitInternalId: firstUsable(payload.internalId, payload.internal_id, payload.patrimonio),
    assetTag,
    hostnameTag: hostnameAssetTag(payload.hostname || payload.computerName || payload.computer_name),
    serialNumber,
    type: inferAssetType(payload),
    os: {
      name: text(os.name || payload.sistema_operacional),
      version: text(os.version),
      build: text(os.build),
      arch: text(os.arch),
      installDate: toIso(os.installDate),
      lastBoot: toIso(os.lastBoot),
    },
    hardware: {
      manufacturer: text(hw.manufacturer || hw.fabricante),
      model: text(hw.model || hw.modelo_sistema),
      board: text(hw.board || hw.modelo_placa),
      processor: text(hw.processor || hw.processador),
      cores: num(hw.cores),
      ramGb: round(num(hw.ramGb ?? hw.ram_gb)),
      gpu: text(hw.gpu),
      biosVersion: text(hw.biosVersion || hw.bios_version),
    },
    disks: (payload.disks || []).map((d) => ({ model: text(d.model), sizeGb: round(num(d.sizeGb), 0), serial: text(d.serial), media: text(d.media) })).filter((d) => d.model || d.serial),
    storageText: text(hw.storage || hw.discos || payload.storage),
    volumes,
    network,
    ip: text(primary.ip || payload.ip_address || payload.ipAddress),
    mac: text(primary.mac || payload.mac_address || payload.macAddress).toUpperCase(),
    security: {
      antivirus: parseAntivirus(security),
      firewall: text(Array.isArray(security.firewall) ? security.firewall.join(', ') : security.firewall),
      encryption: text(security.encryption || security.bitlocker),
      localAdmins: splitList(security.localAdmins).map(text).filter(Boolean),
      lastUpdate: toIso(security.lastUpdate),
      pendingReboot: security.pendingReboot === true || security.pendingReboot === 'true',
    },
    // Tela integrada de notebook vem sem modelo e com serial "0": nao e um monitor.
    monitors: splitList(payload.monitors)
      .map((m) => (typeof m === 'string' ? { model: text(m), serial: '', manufacturer: '' } : { model: text(m.model), serial: isUsableId(m.serial) ? text(m.serial) : '', manufacturer: text(m.manufacturer) }))
      .filter((m) => m.model || m.serial),
    battery: payload.battery && num(payload.battery.designCapacity)
      ? { healthPct: round(Math.min(100, (num(payload.battery.fullCapacity) / num(payload.battery.designCapacity)) * 100), 0) }
      : null,
    software: cleanSoftware(payload.software),
  };
};

// -----------------------------------------------------------------------------
// Identidade: qual ativo do inventario e esta maquina?
// -----------------------------------------------------------------------------

/**
 * Ordem de confianca: id do dispositivo (conferido contra serial/MAC, porque
 * imagens clonadas sem sysprep repetem o MachineGuid), patrimonio gravado,
 * numero de serie util e, por ultimo, hostname + MAC juntos.
 * @returns {{ asset: object, matchField: string } | null}
 */
export const findAgentAsset = (inventory, assets = []) => {
  const conflicts = (asset) =>
    (isUsableId(asset.serialNumber) && isUsableId(inventory.serialNumber) && !sameId(asset.serialNumber, inventory.serialNumber)) ||
    (text(asset.agent?.mac) && inventory.mac && !isUsableId(inventory.serialNumber) && text(asset.agent.mac).toUpperCase() !== inventory.mac);

  if (isUsableId(inventory.deviceId)) {
    const asset = assets.find((a) => sameId(a.agent?.deviceId, inventory.deviceId) && !conflicts(a));
    if (asset) return { asset, matchField: 'deviceId' };
  }
  for (const tag of [inventory.explicitInternalId, inventory.assetTag]) {
    if (!isUsableId(tag)) continue;
    const asset = assets.find((a) => sameId(a.internalId, tag));
    if (asset) return { asset, matchField: 'internalId' };
  }
  if (isUsableId(inventory.serialNumber)) {
    const asset = assets.find((a) => sameId(a.serialNumber, inventory.serialNumber));
    if (asset) return { asset, matchField: 'serialNumber' };
  }
  // Correspondencias fracas (nome): uma maquina substituta costuma herdar o
  // hostname da antiga. Se o ativo ja tem OUTRO dispositivo vinculado, nao e ela.
  const weakConflict = (asset) =>
    conflicts(asset) || (isUsableId(asset.agent?.deviceId) && isUsableId(inventory.deviceId) && !sameId(asset.agent.deviceId, inventory.deviceId));
  if (inventory.hostnameTag) {
    const asset = assets.find((a) => sameId(a.internalId, inventory.hostnameTag) && !weakConflict(a));
    if (asset) return { asset, matchField: 'hostname' };
  }
  if (inventory.hostname && inventory.mac) {
    const asset = assets.find((a) => fold(a.agent?.hostname) === fold(inventory.hostname) && text(a.agent?.mac).toUpperCase() === inventory.mac && !weakConflict(a));
    if (asset) return { asset, matchField: 'hostname+mac' };
  }
  return null;
};

// -----------------------------------------------------------------------------
// O que mudou desde a ultima coleta
// -----------------------------------------------------------------------------

const softwareNames = (inventory) => new Set((inventory?.software || []).map((s) => fold(s.name)));

/**
 * @returns {Array<{ kind: 'hardware'|'os'|'software'|'user'|'network', label: string, from?: string, to?: string }>}
 */
export const diffInventory = (previous, next) => {
  if (!previous) return [];
  const changes = [];
  const push = (kind, label, from, to) => {
    if (text(from) === text(to)) return;
    changes.push({ kind, label, from: text(from) || '—', to: text(to) || '—' });
  };
  const ph = previous.hardware || {};
  const nh = next.hardware || {};
  push('hardware', 'Processador', ph.processor, nh.processor);
  if (ph.ramGb && nh.ramGb && Math.abs(ph.ramGb - nh.ramGb) >= 0.5) push('hardware', 'Memória RAM', `${ph.ramGb} GB`, `${nh.ramGb} GB`);
  push('hardware', 'Número de série', previous.serialNumber, next.serialNumber);
  const diskKey = (list) => (list || []).map((d) => d.serial || `${d.model}/${d.sizeGb}`).sort().join(' | ');
  if ((previous.disks || []).length && (next.disks || []).length) push('hardware', 'Discos', diskKey(previous.disks), diskKey(next.disks));
  const monitorKey = (list) => (list || []).map((m) => m.serial || m.model).sort().join(' | ');
  push('hardware', 'Monitores', monitorKey(previous.monitors), monitorKey(next.monitors));
  push('network', 'Hostname', previous.hostname, next.hostname);
  if (previous.os?.name && next.os?.name) push('os', 'Sistema operacional', [previous.os.name, previous.os.build].filter(Boolean).join(' '), [next.os.name, next.os.build].filter(Boolean).join(' '));
  if (previous.loggedUser && next.loggedUser) push('user', 'Usuário logado', previous.loggedUser, next.loggedUser);

  const before = softwareNames(previous);
  const after = softwareNames(next);
  if (before.size && after.size) {
    const added = (next.software || []).filter((s) => !before.has(fold(s.name))).map((s) => s.name);
    const removed = (previous.software || []).filter((s) => !after.has(fold(s.name))).map((s) => s.name);
    const list = (names) => `${names.slice(0, 8).join(', ')}${names.length > 8 ? ` e mais ${names.length - 8}` : ''}`;
    if (added.length) changes.push({ kind: 'software', label: `${added.length} programa(s) instalado(s)`, to: list(added) });
    if (removed.length) changes.push({ kind: 'software', label: `${removed.length} programa(s) removido(s)`, from: list(removed) });
  }
  return changes;
};

// -----------------------------------------------------------------------------
// Rede -> local (cada loja informa suas faixas de IP)
// -----------------------------------------------------------------------------

const ipToInt = (ip) => {
  const parts = text(ip).split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  if (nums.some((n) => !Number.isInteger(n) || n > 255)) return null;
  return ((nums[0] << 24) >>> 0) + (nums[1] << 16) + (nums[2] << 8) + nums[3];
};

/** "192.168.10.0/24", "10.1.2." (prefixo) ou um IP exato. */
export const ipInNetwork = (ip, network) => {
  const target = ipToInt(ip);
  const spec = text(network);
  if (target === null || !spec) return false;
  if (spec.includes('/')) {
    const [base, bitsText] = spec.split('/');
    const bits = Number(bitsText);
    const baseInt = ipToInt(base);
    if (baseInt === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return ((target & mask) >>> 0) === ((baseInt & mask) >>> 0);
  }
  if (spec.endsWith('.')) return text(ip).startsWith(spec);
  return text(ip) === spec;
};

export const parseNetworks = (value) =>
  (Array.isArray(value) ? value : String(value ?? '').split(/[,;\s]+/)).map(text).filter(Boolean);

/** Local cujas redes contem o IP (a faixa mais especifica vence). */
export const locationForIp = (ip, locations = []) => {
  let best = null;
  locations.forEach((loc) => {
    parseNetworks(loc.networks).forEach((net) => {
      if (!ipInNetwork(ip, net)) return;
      const specificity = net.includes('/') ? Number(net.split('/')[1]) : net.endsWith('.') ? net.split('.').length * 8 - 8 : 32;
      if (!best || specificity > best.specificity) best = { location: loc, specificity };
    });
  });
  return best?.location || null;
};

// -----------------------------------------------------------------------------
// Login -> colaborador
// -----------------------------------------------------------------------------

/** "SHINERAY\\joao.silva", "joao.silva@empresa.com" -> "joao.silva" */
export const normalizeLogin = (login) => fold(text(login).split('\\').pop().split('@')[0]);

const nameTokens = (name) => fold(name).split(/[^a-z0-9]+/).filter((t) => t.length > 1);

/**
 * Colaborador dono do login: campo "login" do cadastro, parte local do e-mail
 * ou nome (joao.silva / jsilva / joaosilva -> João da Silva). So devolve
 * quando ha um unico candidato.
 */
export const matchEmployeeByLogin = (login, employees = []) => {
  const key = normalizeLogin(login);
  if (!key || key.length < 3) return null;
  const unique = (list) => (list.length === 1 ? list[0] : null);

  const byLogin = employees.filter((e) => text(e.login) && normalizeLogin(e.login) === key);
  if (byLogin.length) return unique(byLogin);
  const byEmail = employees.filter((e) => text(e.email) && normalizeLogin(e.email) === key);
  if (byEmail.length) return unique(byEmail);

  const parts = key.split(/[._-]+/).filter(Boolean);
  const byName = employees.filter((e) => {
    const tokens = nameTokens(e.name);
    if (tokens.length < 2) return false;
    const first = tokens[0];
    const last = tokens[tokens.length - 1];
    if (parts.length >= 2) return parts[0] === first && tokens.includes(parts[parts.length - 1]);
    return key === `${first}${last}` || key === `${first[0]}${last}` || key === `${first}.${last}`;
  });
  return unique(byName);
};

// -----------------------------------------------------------------------------
// Politica da empresa e alertas
// -----------------------------------------------------------------------------

export const DEFAULT_AGENT_POLICY = {
  blockedSoftware: [],
  requiredSoftware: [],
  staleDays: 15,
  diskFreeMinPct: 10,
  maxUptimeDays: 30,
  updateMaxDays: 45,
  requireEncryption: false,
};

const listSetting = (value) => (Array.isArray(value) ? value : String(value ?? '').split(/[\n,;]+/)).map(text).filter(Boolean);

const intSetting = (value, fallback, min, max) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
};

export const resolveAgentPolicy = (settings = {}) => {
  const p = settings.agentPolicy || {};
  return {
    blockedSoftware: listSetting(p.blockedSoftware),
    requiredSoftware: listSetting(p.requiredSoftware),
    staleDays: intSetting(p.staleDays, DEFAULT_AGENT_POLICY.staleDays, 1, 365),
    diskFreeMinPct: intSetting(p.diskFreeMinPct, DEFAULT_AGENT_POLICY.diskFreeMinPct, 1, 50),
    maxUptimeDays: intSetting(p.maxUptimeDays, DEFAULT_AGENT_POLICY.maxUptimeDays, 1, 365),
    updateMaxDays: intSetting(p.updateMaxDays, DEFAULT_AGENT_POLICY.updateMaxDays, 1, 365),
    requireEncryption: Boolean(p.requireEncryption),
  };
};

/**
 * Nome de programa casa com o padrao? Palavras inteiras ("office" nao casa com
 * "LibreOffice"); "*" funciona como curinga ("utorrent*", "*crack*").
 */
export const softwareMatches = (name, pattern) => {
  const target = fold(name);
  const raw = fold(pattern);
  if (!target || raw.replace(/\*/g, '').length < 3) return false;
  const escaped = raw.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  const edgeStart = raw.startsWith('*') ? '' : '(?:^|[^a-z0-9])';
  const edgeEnd = raw.endsWith('*') ? '' : '(?:[^a-z0-9]|$)';
  return new RegExp(`${edgeStart}${escaped}${edgeEnd}`).test(target);
};

const DAY_MS = 24 * 60 * 60 * 1000;
const daysSince = (iso, now) => {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? Math.floor((now.getTime() - t) / DAY_MS) : null;
};

export const ALERT_LEVELS = { high: 'Crítico', medium: 'Atenção', low: 'Info' };

/**
 * Alertas da maquina, do mais grave ao mais leve.
 * @param {{ inventory: object, asset?: object, policy?: object, locations?: object[], employees?: object[], now?: Date }} input
 * @returns {Array<{ code: string, level: 'high'|'medium'|'low', message: string, data?: object }>}
 */
export const evaluateAgentAlerts = ({ inventory, asset = null, policy = DEFAULT_AGENT_POLICY, locations = [], employees = [], now = new Date() }) => {
  const alerts = [];
  const add = (code, level, message, data) => alerts.push({ code, level, message, ...(data ? { data } : {}) });
  const isWindows = /windows/i.test(inventory.os?.name);
  const sec = inventory.security || {};

  if (asset && ['Baixado', 'Extraviado'].includes(asset.status)) {
    add('retired_reporting', 'high', `Ativo com status "${asset.status}" voltou a se comunicar.`);
  }

  const blocked = (inventory.software || []).filter((s) => policy.blockedSoftware.some((p) => softwareMatches(s.name, p)));
  if (blocked.length) add('blocked_software', 'high', `Software proibido: ${blocked.slice(0, 5).map((s) => s.name).join(', ')}.`, { names: blocked.map((s) => s.name).slice(0, 20) });

  if (isWindows) {
    const activeAv = sec.antivirus.filter((av) => av.enabled);
    if (!activeAv.length) add('av_missing', 'high', sec.antivirus.length ? 'Antivírus instalado, mas desativado.' : 'Nenhum antivírus detectado.');
    else if (activeAv.every((av) => !av.upToDate)) add('av_outdated', 'medium', `Antivírus desatualizado (${activeAv.map((a) => a.name).join(', ')}).`);
    if (sec.firewall && /desativ|off|disabled|^nenhum/i.test(sec.firewall)) add('firewall_off', 'medium', 'Firewall do Windows desativado.');
  }

  const required = policy.requiredSoftware.filter((p) => !(inventory.software || []).some((s) => softwareMatches(s.name, p)));
  if (required.length && (inventory.software || []).length) add('required_missing', 'medium', `Falta software obrigatório: ${required.join(', ')}.`, { names: required });

  if (policy.requireEncryption || inventory.type === 'Notebook') {
    const system = inventory.volumes.find((v) => /^c:?$/i.test(v.drive) || v.drive === '/') || inventory.volumes[0];
    if (system && system.encrypted === false) add('disk_unencrypted', inventory.type === 'Notebook' ? 'medium' : 'low', `Disco do sistema sem criptografia (${system.drive}).`);
  }

  inventory.volumes.forEach((v) => {
    if (!v.sizeGb || v.freeGb === null) return;
    const pct = (v.freeGb / v.sizeGb) * 100;
    if (pct < policy.diskFreeMinPct) add('disk_full', pct < policy.diskFreeMinPct / 2 ? 'high' : 'medium', `Disco ${v.drive} com ${Math.round(pct)}% livre (${v.freeGb} de ${v.sizeGb} GB).`, { drive: v.drive });
  });

  const lastUpdateDays = sec.lastUpdate ? daysSince(sec.lastUpdate, now) : null;
  if (isWindows && lastUpdateDays !== null && lastUpdateDays > policy.updateMaxDays) add('updates_stale', 'medium', `Sem atualização do Windows há ${lastUpdateDays} dias.`);
  if (/windows (7|8|xp|vista)\b|windows server 20(03|08|12)\b/i.test(inventory.os?.name)) add('os_unsupported', 'high', `Sistema sem suporte do fabricante: ${inventory.os.name}.`);

  const uptimeDays = inventory.os?.lastBoot ? daysSince(inventory.os.lastBoot, now) : null;
  if (uptimeDays !== null && uptimeDays > policy.maxUptimeDays) add('uptime_long', 'low', `Ligado há ${uptimeDays} dias sem reiniciar.`);
  else if (sec.pendingReboot) add('reboot_pending', 'low', 'Reinício pendente para concluir atualizações.');

  if (inventory.loggedUser && sec.localAdmins.some((a) => normalizeLogin(a) === normalizeLogin(inventory.loggedUser))) {
    add('user_is_admin', 'medium', `O usuário ${inventory.loggedUser} é administrador local.`);
  }

  if (inventory.battery?.healthPct !== null && inventory.battery?.healthPct !== undefined && inventory.battery.healthPct < 60) {
    add('battery_worn', 'low', `Bateria com ${inventory.battery.healthPct}% da capacidade original.`);
  }

  if (asset) {
    const byNetwork = locationForIp(inventory.ip, locations);
    if (byNetwork && asset.location && fold(byNetwork.name) !== fold(asset.location) && !asset.transit) {
      add('location_mismatch', 'medium', `A rede (${inventory.ip}) é de ${byNetwork.name}, mas o cadastro diz ${asset.location}.`, { suggested: byNetwork.name });
    }
    const employee = matchEmployeeByLogin(inventory.loggedUser, employees);
    if (employee && asset.assignedTo && fold(employee.name) !== fold(asset.assignedTo)) {
      add('user_mismatch', 'low', `Em uso por ${employee.name}; o responsável cadastrado é ${asset.assignedTo}.`, { suggested: employee.name, employeeId: employee.id });
    }
  }

  const order = { high: 0, medium: 1, low: 2 };
  return alerts.sort((a, b) => order[a.level] - order[b.level]);
};

// -----------------------------------------------------------------------------
// Licencas (SAM)
// -----------------------------------------------------------------------------

/**
 * Quais licencas o equipamento passa a consumir e quais libera. So libera
 * ativacoes que o proprio agente atribuiu (source 'agent'): atribuicao manual
 * nunca e desfeita sozinha.
 */
export const reconcileLicenses = (licenses = [], software = [], assetId) => {
  const names = software.map((s) => (typeof s === 'string' ? s : s.name)).filter(Boolean);
  const assign = [];
  const release = [];
  licenses.forEach((license) => {
    const name = text(license.softwareName || license.name);
    if (name.length < 3) return;
    const assigned = Array.isArray(license.assignedAssets) ? license.assignedAssets : [];
    const mine = assigned.find((a) => a?.id === assetId);
    const installed = names.some((n) => softwareMatches(n, name));
    if (installed && !mine) {
      const seats = Number(license.totalSeats ?? license.quantity);
      if (!(Number.isFinite(seats) && seats > 0 && assigned.length >= seats)) assign.push(license);
    } else if (!installed && mine?.source === 'agent' && names.length) {
      release.push(license);
    }
  });
  return { assign, release };
};

// -----------------------------------------------------------------------------
// Saude da frota
// -----------------------------------------------------------------------------

const AGENT_TYPES = new Set(['Computador', 'Notebook', 'Servidor', 'Desktop', 'All-in-One']);

const toDate = (value) => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** 'online' (dentro do prazo), 'stale' (sem comunicacao) ou 'never' (sem agente). */
export const agentHealth = (asset, { now = new Date(), staleDays = DEFAULT_AGENT_POLICY.staleDays } = {}) => {
  const seen = toDate(asset?.agent?.lastSeenAt) || toDate(asset?.agent?.collectedAt);
  if (!seen) return { state: 'never', days: null, seen: null };
  const days = Math.floor((now.getTime() - seen.getTime()) / DAY_MS);
  return { state: days > staleDays ? 'stale' : 'online', days, seen };
};

/** Numeros da frota para o painel do agente. */
export const summarizeFleet = (assets = [], { now = new Date(), staleDays = DEFAULT_AGENT_POLICY.staleDays, isRetired = () => false } = {}) => {
  const active = assets.filter((a) => !isRetired(a.status));
  const managed = active.filter((a) => a.agent);
  const health = managed.map((a) => agentHealth(a, { now, staleDays }));
  return {
    managed: managed.length,
    online24h: health.filter((h) => h.days !== null && h.days < 1).length,
    stale: health.filter((h) => h.state === 'stale').length,
    withAlerts: managed.filter((a) => (a.agent.alerts || []).length).length,
    critical: managed.filter((a) => (a.agent.alerts || []).some((al) => al.level === 'high')).length,
    uncovered: active.filter((a) => AGENT_TYPES.has(a.type) && !a.agent).length,
  };
};

/** Nome curto de cada alerta (filtros e relatorio da frota). */
export const ALERT_LABELS = {
  retired_reporting: 'Baixado comunicando',
  blocked_software: 'Software proibido',
  av_missing: 'Sem antivírus ativo',
  av_outdated: 'Antivírus desatualizado',
  firewall_off: 'Firewall desligado',
  required_missing: 'Falta software obrigatório',
  disk_unencrypted: 'Disco sem criptografia',
  disk_full: 'Disco quase cheio',
  updates_stale: 'Windows desatualizado',
  os_unsupported: 'Sistema sem suporte',
  uptime_long: 'Muito tempo sem reiniciar',
  reboot_pending: 'Reinício pendente',
  user_is_admin: 'Usuário é administrador',
  battery_worn: 'Bateria desgastada',
  location_mismatch: 'Local divergente',
  user_mismatch: 'Responsável divergente',
};
