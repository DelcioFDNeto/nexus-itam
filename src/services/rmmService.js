// src/services/rmmService.js
// -----------------------------------------------------------------------------
// Servico de RMM (Remote Monitoring & Management) e Acesso Remoto em Tempo Real
// Comunica-se com o executavel nativo NexusAgent.exe por meio do par full-duplex:
//  - agentDevices/{tenantId}_{deviceKey}  (Agente -> Nuvem: telemetria, tela, output)
//  - agentControl/{tenantId}_{deviceKey}  (Nuvem -> Agente: sessao remota, mouse/teclado, comandos)
//
// Regras que o console precisa cumprir (firestore.rules, secao AGENTE ITAM):
//  - Comando novo e sessao nova vao no MESMO batch que o registro em
//    /agentAudit (ID do registro = ID do comando/sessao), assinados por quem
//    esta logado e com a hora do servidor.
//  - A politica da empresa (/agentPolicies) decide se ha acesso remoto, se pode
//    ser sem consentimento do colaborador e se comandos remotos estao liberados.
//  - O agente nao fica consultando o canal: o console o "acorda" gravando
//    consoleWakeAt em agentDevices; a maquina percebe no proximo sinal de vida.
// -----------------------------------------------------------------------------

import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';

export const ONLINE_THRESHOLD_MS = 65 * 1000;

export const REMOTE_ACCESS_MODES = {
  disabled: 'Desligado',
  consent: 'Com consentimento do colaborador',
  unattended: 'Sem supervisão (servidores e quiosques)',
};

/** Politica de execucao das maquinas quando a empresa ainda nao gravou a sua. */
export const DEFAULT_RUNTIME_POLICY = {
  remoteAccess: 'consent',
  commandsEnabled: true,
  heartbeatSeconds: 120,
};

export const REMOTE_COMMANDS = {
  POWERSHELL: 'powershell',
  KILL_PROCESS: 'kill_process',
  MSGBOX: 'msgbox',
  LOCK_SCREEN: 'lock_screen',
  RESTART: 'restart',
  SHUTDOWN: 'shutdown',
  FORCE_INVENTORY: 'force_inventory',
  INSTALL_WINGET: 'install_winget',
  UNINSTALL_SOFTWARE: 'uninstall_software',
};

/** Limite do agente para o texto de um comando (linha de comando do Windows). */
export const MAX_COMMAND_LENGTH = 8000;

export const QUICK_POWERSHELL_ACTIONS = [
  {
    id: 'flush_dns',
    label: 'Limpar Cache DNS',
    description: 'Executa ipconfig /flushdns e exibe configuracao de rede',
    command: 'ipconfig /flushdns; ipconfig /all | Select-String -Pattern "IPv4|Gateway|DNS"',
  },
  {
    id: 'restart_spooler',
    label: 'Reiniciar Fila de Impressão',
    description: 'Limpa trabalhos travados e reinicia o servico Spooler',
    command: 'Restart-Service -Name Spooler -Force; Get-Service -Name Spooler | Format-Table Status, Name, DisplayName -AutoSize',
  },
  {
    id: 'clean_temp',
    label: 'Limpar Arquivos Temporários',
    description: 'Remove arquivos temporarios antigos da pasta TEMP',
    command: 'Get-ChildItem -Path $env:TEMP -Recurse -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue; Write-Output "Limpeza da pasta TEMP concluida com sucesso."',
  },
  {
    id: 'gpupdate',
    label: 'Forçar Políticas (GPUpdate)',
    description: 'Atualiza politicas de grupo do Windows imediatamente',
    command: 'gpupdate /force',
  },
  {
    id: 'system_health',
    label: 'Diagnóstico Rápido de Sistema',
    description: 'Lista uptime, memoria livre, discos e servicos criticos',
    command: 'Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, LastBootUpTime, FreePhysicalMemory; Get-PSDrive -PSProvider FileSystem | Select-Object Name, @{N="Usado(GB)";E={[math]::Round($_.Used/1GB,1)}}, @{N="Livre(GB)";E={[math]::Round($_.Free/1GB,1)}}',
  },
  {
    id: 'network_ping',
    label: 'Testar Conectividade Internet',
    description: 'Testa ping e latencia para 8.8.8.8 e 1.1.1.1',
    command: 'Test-Connection -ComputerName 8.8.8.8, 1.1.1.1 -Count 2 | Select-Object Address, IPV4Address, ResponseTime',
  },
];

const toMs = (value) => {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? 0 : parsed;
};

/** Tolerancia de 2,5 sinais de vida: o intervalo vem da politica da empresa. */
export const onlineThresholdMs = (device) =>
  Math.max(ONLINE_THRESHOLD_MS, (Number(device?.heartbeatSeconds) || 0) * 2500);

/**
 * Verifica se o agente enviou sinal de vida recentemente.
 */
export const isDeviceOnline = (device, nowMs = Date.now()) => {
  if (!device || ['offline', 'uninstalled', 'revoked'].includes(device.status)) return false;
  const seenMs = toMs(device.lastSeenAt || device.updatedAt);
  if (!seenMs) return false;
  return nowMs - seenMs <= onlineThresholdMs(device);
};

/**
 * Formata ou deriva um ID de Acesso estilo AnyDesk (9 digitos: XXX XXX XXX).
 */
export const formatAccessId = (deviceOrKey) => {
  if (!deviceOrKey) return '--- --- ---';
  if (typeof deviceOrKey === 'object' && deviceOrKey.accessId) {
    return String(deviceOrKey.accessId);
  }
  const raw = typeof deviceOrKey === 'string'
    ? deviceOrKey
    : (deviceOrKey.deviceKey || deviceOrKey.serialNumber || deviceOrKey.hostname || '');
  if (!raw) return '--- --- ---';
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const num = ((hash >>> 0) % 900000000) + 100000000;
  const s = String(num).padStart(9, '0');
  return `${s.slice(0, 3)} ${s.slice(3, 6)} ${s.slice(6, 9)}`;
};

export const buildAgentDocId = (tenantId, deviceKey) => `${tenantId}_${deviceKey}`;

const newId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const operatorOf = (user) => ({
  uid: user?.uid || '',
  name: user?.name || user?.email || 'Equipe de TI',
});

/**
 * Localiza o dispositivo RMM ao vivo correspondente a um ativo patrimonial.
 */
export const findLiveDeviceForAsset = (asset, liveDevices = []) => {
  if (!asset || !Array.isArray(liveDevices) || !liveDevices.length) return null;
  const normStr = (v) => String(v || '').trim().toUpperCase();
  const assetKey = normStr(asset.agent?.deviceKey || asset.agentDeviceKey);
  const assetSn = normStr(asset.serialNumber);
  const assetDid = normStr(asset.agent?.deviceId || asset.deviceId);
  const assetInternal = normStr(asset.internalId);
  const assetHost = normStr(asset.agent?.hostname || asset.hostname);

  return (
    liveDevices.find((d) => {
      if (d.assetId && d.assetId === asset.id) return true;
      if (assetKey && normStr(d.deviceKey) === assetKey) return true;
      if (assetDid && normStr(d.deviceId) === assetDid) return true;
      if (assetSn && assetSn.length > 3 && normStr(d.serialNumber) === assetSn) return true;
      if (assetInternal && normStr(d.internalId) === assetInternal) return true;
      if (assetHost && normStr(d.hostname) === assetHost) return true;
      return false;
    }) || null
  );
};

/**
 * Escuta em tempo real todos os dispositivos com agente instalado no tenant.
 */
export const subscribeAgentDevices = (tenantId, onUpdate, onError) => {
  if (!tenantId) return () => {};
  const q = query(collection(db, 'agentDevices'), where('tenantId', '==', tenantId));
  return onSnapshot(
    q,
    (snapshot) => {
      const devices = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      onUpdate(devices);
    },
    (err) => {
      if (onError) onError(err);
    }
  );
};

/**
 * Agentes 3.0 gravavam o token da empresa em agentDevices (legivel pela
 * gestao). O 3.1 grava em outro documento, entao os antigos ficariam com o
 * token para sempre: a gestao apaga o campo ao abrir a frota.
 */
export const stripLegacyDeviceTokens = (devices = []) =>
  Promise.all(
    devices
      .filter((d) => d?.id && 'agentToken' in d)
      .map((d) => updateDoc(doc(db, 'agentDevices', d.id), { agentToken: deleteField() }).catch(() => {})),
  );

/**
 * Escuta em tempo real um unico dispositivo (ideal para sessao de tela remota de baixa latencia).
 */
export const subscribeAgentDevice = (tenantId, deviceKey, onUpdate, onError) => {
  if (!tenantId || !deviceKey) return () => {};
  const docId = buildAgentDocId(tenantId, deviceKey);
  return onSnapshot(
    doc(db, 'agentDevices', docId),
    (snap) => {
      if (!snap.exists()) {
        onUpdate(null);
        return;
      }
      onUpdate({ id: snap.id, ...snap.data() });
    },
    (err) => {
      if (onError) onError(err);
    }
  );
};

// -----------------------------------------------------------------------------
// Politica de execucao (lida pelas maquinas)
// -----------------------------------------------------------------------------

export const resolveRuntimePolicy = (data = {}) => ({
  remoteAccess: ['disabled', 'consent', 'unattended'].includes(data?.remoteAccess) ? data.remoteAccess : DEFAULT_RUNTIME_POLICY.remoteAccess,
  commandsEnabled: typeof data?.commandsEnabled === 'boolean' ? data.commandsEnabled : DEFAULT_RUNTIME_POLICY.commandsEnabled,
  heartbeatSeconds: Math.min(900, Math.max(30, Number(data?.heartbeatSeconds) || DEFAULT_RUNTIME_POLICY.heartbeatSeconds)),
});

export const subscribeRuntimePolicy = (tenantId, onUpdate) => {
  if (!tenantId) return () => {};
  return onSnapshot(
    doc(db, 'agentPolicies', tenantId),
    (snap) => onUpdate(resolveRuntimePolicy(snap.exists() ? snap.data() : {})),
    () => onUpdate(resolveRuntimePolicy({})),
  );
};

export const saveRuntimePolicy = (tenantId, policy, user) => {
  const resolved = resolveRuntimePolicy(policy);
  return setDoc(doc(db, 'agentPolicies', tenantId), {
    ...resolved,
    heartbeatSeconds: Math.round(resolved.heartbeatSeconds),
    updatedAt: serverTimestamp(),
    updatedBy: operatorOf(user).name,
    updatedByUid: operatorOf(user).uid,
  });
};

// -----------------------------------------------------------------------------
// Trilha de acessos (/agentAudit)
// -----------------------------------------------------------------------------

const auditData = ({ tenantId, deviceKey, hostname, action, detail = '', mode = '', user }) => {
  const op = operatorOf(user);
  return {
    tenantId,
    deviceKey,
    hostname: String(hostname || '').slice(0, 255),
    action,
    detail: String(detail || '').slice(0, 500),
    mode,
    byUid: op.uid,
    byName: op.name,
    at: serverTimestamp(),
  };
};

export const AUDIT_ACTION_LABELS = {
  remote_request: 'Pediu acesso remoto',
  remote_end: 'Encerrou acesso remoto',
  command: 'Enviou comando',
  revoke: 'Revogou o agente',
};

/** Ultimos registros de acesso/comando (owner e admin). */
export const listAgentAudit = async (tenantId, max = 50) => {
  if (!tenantId) return [];
  const snap = await getDocs(query(collection(db, 'agentAudit'), where('tenantId', '==', tenantId), orderBy('at', 'desc'), limit(max)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

// -----------------------------------------------------------------------------
// Canal de controle
// -----------------------------------------------------------------------------

/**
 * Pede atencao a maquina: ela le o campo no proximo sinal de vida e passa a
 * consultar o canal a cada 2 s por 3 minutos.
 */
export const wakeAgentDevice = async ({ tenantId, deviceKey }) => {
  if (!tenantId || !deviceKey) return;
  await updateDoc(doc(db, 'agentDevices', buildAgentDocId(tenantId, deviceKey)), { consoleWakeAt: serverTimestamp() });
};

/** Mantem a transmissao: sem este sinal por 45 s o agente pausa a tela; por 3 min, encerra. */
export const pingRemoteViewer = ({ tenantId, deviceKey }) =>
  setDoc(doc(db, 'agentControl', buildAgentDocId(tenantId, deviceKey)), {
    tenantId,
    deviceKey,
    viewerSeenAt: serverTimestamp(),
  }, { merge: true });

/**
 * Inicia uma sessao de controle remoto. Com consentimento (padrao), o
 * colaborador aceita ou recusa na tela; sem supervisao so se a politica deixar.
 */
export const startRemoteSession = async ({
  tenantId,
  deviceKey,
  hostname = '',
  mode = 'attended',
  quality = 'balanced',
  user,
}) => {
  if (!tenantId || !deviceKey) throw new Error('Dispositivo inválido para acesso remoto.');
  const op = operatorOf(user);
  const sessionId = newId('rem');
  const batch = writeBatch(db);
  batch.set(doc(db, 'agentAudit', sessionId), auditData({
    tenantId,
    deviceKey,
    hostname,
    action: 'remote_request',
    mode,
    detail: mode === 'unattended' ? 'Sessão sem supervisão' : 'Sessão com consentimento do colaborador',
    user,
  }));
  batch.set(doc(db, 'agentControl', buildAgentDocId(tenantId, deviceKey)), {
    tenantId,
    deviceKey,
    updatedAt: serverTimestamp(),
    viewerSeenAt: serverTimestamp(),
    remoteSession: {
      sessionId,
      status: 'requesting',
      mode,
      quality,
      requestedBy: op.name,
      requestedByUid: op.uid,
      startedAt: new Date().toISOString(),
      inputEvents: [],
    },
  }, { merge: true });
  await batch.commit();
  await wakeAgentDevice({ tenantId, deviceKey }).catch(() => {});
  return sessionId;
};

/**
 * Encerra a sessao de acesso remoto ativa.
 */
export const stopRemoteSession = async ({ tenantId, deviceKey, hostname = '', user = null }) => {
  if (!tenantId || !deviceKey) return;
  await setDoc(
    doc(db, 'agentControl', buildAgentDocId(tenantId, deviceKey)),
    {
      tenantId,
      deviceKey,
      updatedAt: serverTimestamp(),
      remoteSession: {
        sessionId: '',
        status: 'closed',
        inputEvents: [],
        endedAt: new Date().toISOString(),
      },
    },
    { merge: true }
  );
  if (user) {
    await setDoc(doc(db, 'agentAudit', newId('end')), auditData({ tenantId, deviceKey, hostname, action: 'remote_end', user })).catch(() => {});
  }
};

const sessionPatch = ({ tenantId, deviceKey, sessionId, mode, quality, user, inputEvents }) => {
  const op = operatorOf(user);
  return setDoc(
    doc(db, 'agentControl', buildAgentDocId(tenantId, deviceKey)),
    {
      tenantId,
      deviceKey,
      updatedAt: serverTimestamp(),
      remoteSession: {
        sessionId,
        status: 'active',
        mode: mode || 'attended',
        quality,
        requestedBy: op.name,
        requestedByUid: op.uid,
        inputEvents,
      },
    },
    { merge: true }
  );
};

/**
 * Altera a qualidade de transmissao de imagem durante a sessao remota.
 */
export const updateRemoteQuality = async ({ tenantId, deviceKey, sessionId, mode, quality, user, inputEvents = [] }) => {
  if (!tenantId || !deviceKey || !sessionId) return;
  await sessionPatch({ tenantId, deviceKey, sessionId, mode, quality, user, inputEvents: inputEvents.slice(-15) });
};

/**
 * Envia lote de eventos de mouse e teclado para o agente executar.
 */
export const sendRemoteInputEvents = async ({
  tenantId,
  deviceKey,
  sessionId,
  mode = 'attended',
  quality = 'balanced',
  user,
  events = [],
}) => {
  if (!tenantId || !deviceKey || !sessionId) return;
  await sessionPatch({ tenantId, deviceKey, sessionId, mode, quality, user, inputEvents: events.slice(-16) });
};

/**
 * Dispara um comando remoto (PowerShell, Kill Process, Mensagem na Tela, Lock,
 * Restart, Winget, etc.), auditado no mesmo batch.
 */
export const dispatchRemoteCommand = async ({
  tenantId,
  deviceKey,
  hostname = '',
  type,
  command = '',
  title = 'Mensagem da TI - Nexus ITAM',
  user,
}) => {
  if (!tenantId || !deviceKey || !type) throw new Error('Parâmetros insuficientes para o comando remoto.');
  const text = String(command);
  if (text.length > MAX_COMMAND_LENGTH) throw new Error(`Comando longo demais (máximo de ${MAX_COMMAND_LENGTH} caracteres).`);
  const op = operatorOf(user);
  const cmdId = newId('cmd');
  const payload = {
    id: cmdId,
    type,
    command: text,
    title: String(title),
    requestedBy: op.name,
    requestedByUid: op.uid,
    issuedAt: serverTimestamp(),
  };
  const batch = writeBatch(db);
  batch.set(doc(db, 'agentAudit', cmdId), auditData({ tenantId, deviceKey, hostname, action: 'command', detail: `${type}: ${text}`, user }));
  batch.set(
    doc(db, 'agentControl', buildAgentDocId(tenantId, deviceKey)),
    {
      tenantId,
      deviceKey,
      updatedAt: serverTimestamp(),
      pendingCommand: payload,
    },
    { merge: true }
  );
  await batch.commit();
  await wakeAgentDevice({ tenantId, deviceKey }).catch(() => {});
  return payload;
};

/**
 * Marca um chamado de suporte aberto pelo colaborador no agente como resolvido.
 */
export const resolveSupportRequest = async ({ tenantId, deviceKey, resolvedBy = 'TI' }) => {
  if (!tenantId || !deviceKey) return;
  const docId = buildAgentDocId(tenantId, deviceKey);
  await updateDoc(doc(db, 'agentDevices', docId), {
    'supportRequest.status': 'resolved',
    'supportRequest.resolvedBy': resolvedBy,
    'supportRequest.resolvedAt': new Date().toISOString(),
  });
};

/**
 * Revoga o agente da maquina (owner/admin): apaga as matriculas, e a maquina
 * perde o acesso na hora. Para voltar, reinstale com o token da empresa.
 */
export const revokeAgentDevice = async ({ tenantId, deviceKey, hostname = '', user }) => {
  if (!tenantId || !deviceKey) throw new Error('Dispositivo inválido.');
  const snap = await getDocs(query(collection(db, 'agentEnrollments'), where('tenantId', '==', tenantId), where('deviceKey', '==', deviceKey)));
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  await setDoc(doc(db, 'agentAudit', newId('rev')), auditData({ tenantId, deviceKey, hostname, action: 'revoke', detail: `${snap.size} matrícula(s) removida(s)`, user }));
  await updateDoc(doc(db, 'agentDevices', buildAgentDocId(tenantId, deviceKey)), { status: 'revoked', screenFrame: deleteField() }).catch(() => {});
  return snap.size;
};
