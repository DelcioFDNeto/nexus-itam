// src/services/rmmService.js
// -----------------------------------------------------------------------------
// Servico de RMM (Remote Monitoring & Management) e Acesso Remoto em Tempo Real
// Comunica-se com o executavel nativo NexusAgent.exe por meio do par full-duplex:
//  - agentDevices/{tenantId}_{deviceKey}  (Agente -> Nuvem: telemetria, tela, output)
//  - agentControl/{tenantId}_{deviceKey}  (Nuvem -> Agente: sessao remota, mouse/teclado, comandos)
// -----------------------------------------------------------------------------

import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from './firebase';

export const ONLINE_THRESHOLD_MS = 65 * 1000;

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

/**
 * Verifica se o agente enviou sinal de vida recentemente.
 */
export const isDeviceOnline = (device, nowMs = Date.now()) => {
  if (!device) return false;
  const seenMs = toMs(device.lastSeenAt || device.updatedAt);
  if (!seenMs) return false;
  return nowMs - seenMs <= ONLINE_THRESHOLD_MS;
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

/**
 * Inicia uma sessao de controle remoto (nao supervisionada ou com consentimento do usuario).
 */
export const startRemoteSession = async ({
  tenantId,
  deviceKey,
  mode = 'unattended',
  quality = 'balanced',
  requestedBy = 'Equipe de TI',
}) => {
  if (!tenantId || !deviceKey) throw new Error('Dispositivo inválido para acesso remoto.');
  const docId = buildAgentDocId(tenantId, deviceKey);
  const sessionId = `rem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await setDoc(
    doc(db, 'agentControl', docId),
    {
      tenantId,
      deviceKey,
      updatedAt: serverTimestamp(),
      remoteSession: {
        sessionId,
        status: 'requesting',
        mode,
        quality,
        requestedBy,
        startedAt: new Date().toISOString(),
        inputEvents: [],
      },
    },
    { merge: true }
  );
  return sessionId;
};

/**
 * Encerra a sessao de acesso remoto ativa.
 */
export const stopRemoteSession = async ({ tenantId, deviceKey }) => {
  if (!tenantId || !deviceKey) return;
  const docId = buildAgentDocId(tenantId, deviceKey);
  await setDoc(
    doc(db, 'agentControl', docId),
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
};

/**
 * Altera a qualidade de transmissao de imagem durante a sessao remota.
 */
export const updateRemoteQuality = async ({ tenantId, deviceKey, sessionId, mode, quality, requestedBy, inputEvents = [] }) => {
  if (!tenantId || !deviceKey) return;
  const docId = buildAgentDocId(tenantId, deviceKey);
  await setDoc(
    doc(db, 'agentControl', docId),
    {
      tenantId,
      deviceKey,
      updatedAt: serverTimestamp(),
      remoteSession: {
        sessionId,
        status: 'active',
        mode: mode || 'unattended',
        quality,
        requestedBy: requestedBy || 'Equipe de TI',
        inputEvents: inputEvents.slice(-15),
      },
    },
    { merge: true }
  );
};

/**
 * Envia lote de eventos de mouse e teclado para o agente executar.
 */
export const sendRemoteInputEvents = async ({
  tenantId,
  deviceKey,
  sessionId,
  mode = 'unattended',
  quality = 'balanced',
  requestedBy = 'Equipe de TI',
  events = [],
}) => {
  if (!tenantId || !deviceKey || !sessionId) return;
  const docId = buildAgentDocId(tenantId, deviceKey);
  await setDoc(
    doc(db, 'agentControl', docId),
    {
      tenantId,
      deviceKey,
      updatedAt: serverTimestamp(),
      remoteSession: {
        sessionId,
        status: 'active',
        mode,
        quality,
        requestedBy,
        inputEvents: events.slice(-16),
      },
    },
    { merge: true }
  );
};

/**
 * Dispara um comando remoto (PowerShell, Kill Process, Mensagem na Tela, Lock, Restart, Winget, etc.).
 */
export const dispatchRemoteCommand = async ({
  tenantId,
  deviceKey,
  type,
  command = '',
  title = 'Mensagem da TI - Nexus ITAM',
  requestedBy = 'Equipe de TI',
}) => {
  if (!tenantId || !deviceKey || !type) throw new Error('Parâmetros insuficientes para o comando remoto.');
  const docId = buildAgentDocId(tenantId, deviceKey);
  const cmdId = `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const payload = {
    id: cmdId,
    type,
    command: String(command),
    title: String(title),
    requestedBy,
    createdAt: new Date().toISOString(),
  };
  await setDoc(
    doc(db, 'agentControl', docId),
    {
      tenantId,
      deviceKey,
      updatedAt: serverTimestamp(),
      pendingCommand: payload,
    },
    { merge: true }
  );
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
