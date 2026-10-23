// src/components/agent/RemoteControlModal.jsx
import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpCircle,
  Camera,
  Cpu,
  Hand,
  HardDrive,
  Keyboard,
  Lock,
  Maximize2,
  MessageSquare,
  Minimize2,
  Monitor,
  MousePointer,
  Package,
  Play,
  Power,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  ShieldOff,
  Smartphone,
  Square,
  Terminal,
  Trash2,
  X,
  Zap,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { toast } from 'sonner';
import { useConfirm } from '../ConfirmDialog';
import {
  DEFAULT_RUNTIME_POLICY,
  MAX_COMMAND_LENGTH,
  QUICK_POWERSHELL_ACTIONS,
  REMOTE_COMMANDS,
  clearRemoteInputEvents,
  dispatchAgentUpdate,
  dispatchRemoteCommand,
  formatAccessId,
  isDeviceOnline,
  pingRemoteViewer,
  resolveSupportRequest,
  revokeAgentDevice,
  sendRemoteInputEvents,
  startRemoteSession,
  stopRemoteSession,
  subscribeAgentDevice,
  subscribeRuntimePolicy,
  updateRemoteQuality,
  wakeAgentDevice,
} from '../../services/rmmService';
import { AGENT_VERSION, isAgentOutdated } from '../../utils/agentInventory';
import { can } from '../../utils/permissions';

// Estados finais que o agente publica em remoteState.state.
const SESSION_END_MESSAGES = {
  rejected: 'O colaborador recusou o acesso NexusDesk (ou não respondeu em 30 s).',
  refused_policy: 'A política da empresa desligou o acesso remoto.',
  ended_by_user: 'O colaborador encerrou o acesso remoto.',
  timeout: 'Sessão encerrada pelo agente por inatividade ou tempo limite.',
  ended: 'Sessão NexusDesk encerrada.',
};

const WINGET_PRESETS = [
  { label: 'Google Chrome', pkg: 'Google.Chrome' },
  { label: 'Mozilla Firefox', pkg: 'Mozilla.Firefox' },
  { label: '7-Zip', pkg: '7zip.7zip' },
  { label: 'Adobe Acrobat Reader', pkg: 'Adobe.Acrobat.Reader.64-bit' },
  { label: 'LibreOffice', pkg: 'TheDocumentFoundation.LibreOffice' },
];

export default function RemoteControlModal({
  isOpen,
  onClose,
  tenantId,
  initialDevice,
  asset,
  currentUser,
  initialTab = 'screen',
}) {
  const confirm = useConfirm();
  const [activeTab, setActiveTab] = useState(initialTab);
  const [liveDevice, setLiveDevice] = useState(initialDevice || null);

  // Estado da Sessao Remota NexusDesk
  const [sessionMode, setSessionMode] = useState('attended');
  const [quality, setQuality] = useState('balanced');
  const [sessionId, setSessionId] = useState('');
  const [lastSessionId, setLastSessionId] = useState('');
  const [policy, setPolicy] = useState(DEFAULT_RUNTIME_POLICY);
  const [connecting, setConnecting] = useState(false);
  const [controlEnabled, setControlEnabled] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [textToType, setTextToType] = useState('');

  // Controles Mobile & Touch (NexusDesk Mobile)
  const [touchMode, setTouchMode] = useState('direct'); // 'direct' | 'trackpad'
  const [rightClickArmed, setRightClickArmed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [virtualCursor, setVirtualCursor] = useState({ x: 0.5, y: 0.5 });
  const [mobileKbOpen, setMobileKbOpen] = useState(false);
  const [updatingAgent, setUpdatingAgent] = useState(false);

  // Estado do Terminal PowerShell
  const [psInput, setPsInput] = useState('');
  const [commandHistory, setCommandHistory] = useState([]);
  const [runningCmdId, setRunningCmdId] = useState('');

  // Estado de Processos
  const [procFilter, setProcFilter] = useState('');

  // Estado de Mensagens e Software
  const [msgTitle, setMsgTitle] = useState('Aviso da Equipe de TI');
  const [msgBody, setMsgBody] = useState('');
  const [wingetPkg, setWingetPkg] = useState('');
  const [uninstallName, setUninstallName] = useState('');

  const viewportRef = useRef(null);
  const screenImgRef = useRef(null);
  const mobileKeyboardInputRef = useRef(null);
  const inputSeqRef = useRef(1);
  const inputQueueRef = useRef([]);
  const lastClearedAckRef = useRef(0);
  const flushTimerRef = useRef(null);
  const lastMouseMoveAtRef = useRef(0);
  const sessionIdRef = useRef('');
  const touchStateRef = useRef({
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    moved: false,
    pinchStartDist: 0,
    pinchStartZoom: 1,
    longPressTimer: null,
  });

  const deviceKey =
    liveDevice?.deviceKey ||
    initialDevice?.deviceKey ||
    asset?.agentDeviceKey ||
    '';

  const operatorName =
    currentUser?.name || currentUser?.email || 'Técnico de TI';
  const hostLabel = liveDevice?.hostname || asset?.internalId || '';
  // "Sem supervisao" so existe se a empresa liberou na politica.
  const effectiveMode = policy.remoteAccess === 'unattended' ? sessionMode : 'attended';

  useEffect(() => {
    setActiveTab(initialTab || 'screen');
  }, [initialTab, isOpen]);

  useEffect(() => {
    setLiveDevice(initialDevice || null);
  }, [initialDevice]);

  useEffect(() => {
    if (!isOpen || !tenantId || !deviceKey) return undefined;
    const unsub = subscribeAgentDevice(tenantId, deviceKey, (data) => {
      if (!data) return;
      setLiveDevice(data);
      // O agente encerrou do lado de la (recusa, colaborador, ninguem assistindo).
      const state = data.remoteState?.state;
      if (sessionIdRef.current && data.remoteState?.sessionId === sessionIdRef.current && SESSION_END_MESSAGES[state]) {
        toast.info(SESSION_END_MESSAGES[state]);
        sessionIdRef.current = '';
        setSessionId('');
        inputQueueRef.current = [];
        stopRemoteSession({ tenantId, deviceKey }).catch(() => {});
      }
    });
    return () => unsub();
  }, [isOpen, tenantId, deviceKey]);

  // Limpa da fila e do Firestore os eventos de input ja processados pelo agente
  // para evitar retencao de teclas/cliques no documento agentControl.
  useEffect(() => {
    const ackSeq = Number(liveDevice?.remoteState?.lastInputSeq) || 0;
    if (!sessionId || ackSeq <= 0) return;
    if (inputQueueRef.current.length > 0) {
      inputQueueRef.current = inputQueueRef.current.filter((ev) => ev.seq > ackSeq);
    }
    if (inputQueueRef.current.length === 0 && ackSeq > lastClearedAckRef.current) {
      lastClearedAckRef.current = ackSeq;
      clearRemoteInputEvents({
        tenantId,
        deviceKey,
        sessionId,
        mode: effectiveMode,
        quality,
        user: currentUser,
      }).catch(() => {});
    }
  }, [liveDevice?.remoteState?.lastInputSeq, sessionId, tenantId, deviceKey, effectiveMode, quality, currentUser]);

  useEffect(() => {
    if (!isOpen || !tenantId) return undefined;
    return subscribeRuntimePolicy(tenantId, setPolicy);
  }, [isOpen, tenantId]);

  // A maquina so consulta o canal quando acordada (janela de 3 min no agente):
  // o console renova o pedido enquanto estiver aberto.
  useEffect(() => {
    if (!isOpen || !tenantId || !deviceKey) return undefined;
    const wake = () => wakeAgentDevice({ tenantId, deviceKey }).catch(() => {});
    wake();
    const timer = setInterval(wake, 90_000);
    return () => clearInterval(timer);
  }, [isOpen, tenantId, deviceKey]);

  // Sem este sinal o agente pausa e limpa a tela em 35 s e encerra a sessao em 90 s.
  useEffect(() => {
    if (!sessionId || !tenantId || !deviceKey) return undefined;
    const timer = setInterval(() => pingRemoteViewer({ tenantId, deviceKey }).catch(() => {}), 15_000);
    return () => clearInterval(timer);
  }, [sessionId, tenantId, deviceKey]);

  // Registra chegada de resultado de comando no historico do terminal
  useEffect(() => {
    const res = liveDevice?.lastCommandResult;
    if (!res?.commandId) return;
    setCommandHistory((prev) => {
      if (prev.some((item) => item.commandId === res.commandId)) return prev;
      return [res, ...prev].slice(0, 30);
    });
    if (runningCmdId && res.commandId === runningCmdId) {
      setRunningCmdId('');
      toast.success('Resposta recebida do computador remoto.');
    }
  }, [liveDevice?.lastCommandResult, runningCmdId]);

  // Encerra sessao e limpa frame ao desmontar, fechar modal ou fechar aba do navegador
  useEffect(() => {
    const handleUnload = () => {
      if (sessionIdRef.current && tenantId && deviceKey) {
        stopRemoteSession({ tenantId, deviceKey }).catch(() => {});
      }
    };
    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('pagehide', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      window.removeEventListener('pagehide', handleUnload);
      if (sessionId && tenantId && deviceKey) {
        stopRemoteSession({ tenantId, deviceKey }).catch(() => {});
      }
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    };
  }, [sessionId, tenantId, deviceKey]);

  if (!isOpen) return null;

  const online = isDeviceOnline(liveDevice);
  const accessId = formatAccessId(liveDevice || deviceKey || asset?.internalId);
  const hostname = liveDevice?.hostname || asset?.hostname || asset?.internalId || ' Computador';
  const patrimony = liveDevice?.internalId || asset?.internalId || hostname;
  const loggedUser = liveDevice?.loggedUser || asset?.assignedTo || 'Não identificado';
  const ipAddress = liveDevice?.ipAddress || asset?.ipAddress || '—';
  const osCaption = liveDevice?.osCaption || asset?.operatingSystem || 'Windows';
  const currentAgentVer = liveDevice?.agentVersion || asset?.agent?.version || '';
  const agentOutdated = isAgentOutdated(currentAgentVer);
  const metrics = liveDevice?.metrics || {};
  const topProcesses = Array.isArray(liveDevice?.topProcesses) ? liveDevice.topProcesses : [];
  const rawFrame = liveDevice?.screenFrame || null;
  // Exibe apenas quadros pertencentes a sessao ativa atual (protecao contra vazamento entre sessoes)
  const screenFrame =
    rawFrame && (!rawFrame.sessionId || rawFrame.sessionId === sessionId) ? rawFrame : null;
  const remoteState = liveDevice?.remoteState || {};
  const ownState = sessionId && remoteState.sessionId === sessionId ? remoteState.state : '';
  const isSessionActive = ownState === 'active';
  const isWaitingConsent = ownState === 'awaiting_consent';
  const isWaitingAgent = Boolean(sessionId) && !ownState;
  const endedState = !sessionId && lastSessionId && remoteState.sessionId === lastSessionId ? remoteState.state : '';
  const responseSeconds = Number(liveDevice?.heartbeatSeconds) || policy.heartbeatSeconds;
  const isAdmin = can(currentUser, 'agent:manage');

  const queueInputEvent = (ev) => {
    if (!sessionId || !controlEnabled) return;
    const seq = inputSeqRef.current;
    inputSeqRef.current += 1;
    inputQueueRef.current = [...inputQueueRef.current.slice(-14), { ...ev, seq }];

    if (flushTimerRef.current) return;
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      const batch = [...inputQueueRef.current];
      sendRemoteInputEvents({
        tenantId,
        deviceKey,
        sessionId,
        mode: effectiveMode,
        quality,
        user: currentUser,
        events: batch,
      }).catch(() => {});
    }, 120);
  };

  const handleStartRemote = async () => {
    if (!deviceKey) {
      toast.error('Este ativo ainda não possui o Agente Nativo (NexusAgent.exe) vinculado.');
      return;
    }
    if (policy.remoteAccess === 'disabled') {
      toast.error('Acesso remoto desligado pela política da empresa (Agente ITAM > Políticas e segurança).');
      return;
    }
    setConnecting(true);
    try {
      inputSeqRef.current = 1;
      inputQueueRef.current = [];
      lastClearedAckRef.current = 0;
      const newSessionId = await startRemoteSession({
        tenantId,
        deviceKey,
        hostname: hostLabel,
        mode: effectiveMode,
        quality,
        user: currentUser,
      });
      sessionIdRef.current = newSessionId;
      setSessionId(newSessionId);
      setLastSessionId(newSessionId);
      toast.success(
        effectiveMode === 'attended'
          ? `Pedido NexusDesk enviado. A máquina responde em até ${responseSeconds} s e o colaborador precisa aceitar na tela.`
          : `Pedido NexusDesk enviado. A transmissão começa quando a máquina responder (até ${responseSeconds} s).`
      );
    } catch (e) {
      toast.error(e?.message || 'Falha ao iniciar sessão NexusDesk.');
    } finally {
      setConnecting(false);
    }
  };

  const handleStopRemote = async () => {
    const activeId = sessionId;
    sessionIdRef.current = '';
    setSessionId('');
    inputQueueRef.current = [];
    setZoom(1);
    setPan({ x: 0, y: 0 });
    if (activeId && tenantId && deviceKey) {
      try {
        await stopRemoteSession({ tenantId, deviceKey, hostname: hostLabel, user: currentUser });
        toast.info('Sessão NexusDesk encerrada e captura limpa.');
      } catch {
        // Ignora erro ao fechar
      }
    }
  };

  const handleQualityChange = async (newQuality) => {
    setQuality(newQuality);
    if (sessionId && tenantId && deviceKey) {
      await updateRemoteQuality({
        tenantId,
        deviceKey,
        sessionId,
        mode: effectiveMode,
        quality: newQuality,
        user: currentUser,
        inputEvents: inputQueueRef.current,
      }).catch(() => {});
    }
  };

  const getRelativeCoordsFromClient = (clientX, clientY) => {
    const img = screenImgRef.current;
    if (!img) return { x: 0.5, y: 0.5 };
    const rect = img.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: 0.5, y: 0.5 };
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    return { x: Number(x.toFixed(4)), y: Number(y.toFixed(4)) };
  };

  const getRelativeCoords = (e) => getRelativeCoordsFromClient(e.clientX, e.clientY);

  const handleScreenClick = (e) => {
    if (!sessionId || !controlEnabled) return;
    const coords = touchMode === 'trackpad' ? virtualCursor : getRelativeCoords(e);
    if (rightClickArmed) {
      queueInputEvent({ type: 'rightclick', ...coords });
      setRightClickArmed(false);
      toast.info('Clique direito enviado.');
      return;
    }
    queueInputEvent({ type: 'click', ...coords });
  };

  const handleScreenDoubleClick = (e) => {
    if (!sessionId || !controlEnabled) return;
    const coords = touchMode === 'trackpad' ? virtualCursor : getRelativeCoords(e);
    queueInputEvent({ type: 'dblclick', ...coords });
  };

  const handleScreenContextMenu = (e) => {
    e.preventDefault();
    if (!sessionId || !controlEnabled) return;
    const coords = touchMode === 'trackpad' ? virtualCursor : getRelativeCoords(e);
    queueInputEvent({ type: 'rightclick', ...coords });
  };

  const handleScreenMouseMove = (e) => {
    if (!sessionId || !controlEnabled || touchMode === 'trackpad') return;
    const now = Date.now();
    if (now - lastMouseMoveAtRef.current < 240) return;
    lastMouseMoveAtRef.current = now;
    const coords = getRelativeCoords(e);
    setVirtualCursor(coords);
    queueInputEvent({ type: 'mousemove', ...coords });
  };

  const handleScreenWheel = (e) => {
    if (!sessionId || !controlEnabled) return;
    const coords = getRelativeCoords(e);
    queueInputEvent({
      type: 'wheel',
      ...coords,
      deltaY: e.deltaY > 0 ? -120 : 120,
    });
  };

  // Gestos Touch Mobile (Pinch-to-Zoom, Pan, Toque Direto e Trackpad Virtual)
  const handleTouchStart = (e) => {
    if (!sessionId) return;
    const ts = touchStateRef.current;
    if (ts.longPressTimer) {
      clearTimeout(ts.longPressTimer);
      ts.longPressTimer = null;
    }
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      ts.pinchStartDist = Math.hypot(dx, dy);
      ts.pinchStartZoom = zoom;
      ts.moved = true;
      return;
    }
    if (e.touches.length === 1) {
      const t = e.touches[0];
      ts.startX = t.clientX;
      ts.startY = t.clientY;
      ts.lastX = t.clientX;
      ts.lastY = t.clientY;
      ts.moved = false;
      if (controlEnabled && touchMode === 'direct') {
        const coords = getRelativeCoordsFromClient(t.clientX, t.clientY);
        ts.longPressTimer = setTimeout(() => {
          ts.moved = true;
          queueInputEvent({ type: 'rightclick', ...coords });
          toast.info('Clique direito enviado (toque longo).');
        }, 550);
      }
    }
  };

  const handleTouchMove = (e) => {
    if (!sessionId) return;
    const ts = touchStateRef.current;
    if (e.touches.length === 2 && ts.pinchStartDist > 0) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const nextZoom = Math.max(1, Math.min(3, Number((ts.pinchStartZoom * (dist / ts.pinchStartDist)).toFixed(2))));
      setZoom(nextZoom);
      if (nextZoom === 1) setPan({ x: 0, y: 0 });
      return;
    }
    if (e.touches.length === 1) {
      const t = e.touches[0];
      const dx = t.clientX - ts.lastX;
      const dy = t.clientY - ts.lastY;
      if (Math.hypot(t.clientX - ts.startX, t.clientY - ts.startY) > 8) {
        ts.moved = true;
        if (ts.longPressTimer) {
          clearTimeout(ts.longPressTimer);
          ts.longPressTimer = null;
        }
      }
      ts.lastX = t.clientX;
      ts.lastY = t.clientY;

      if (touchMode === 'trackpad' && controlEnabled) {
        e.preventDefault();
        setVirtualCursor((prev) => {
          const next = {
            x: Number(Math.max(0, Math.min(1, prev.x + dx / 260)).toFixed(4)),
            y: Number(Math.max(0, Math.min(1, prev.y + dy / 200)).toFixed(4)),
          };
          const now = Date.now();
          if (now - lastMouseMoveAtRef.current >= 180) {
            lastMouseMoveAtRef.current = now;
            queueInputEvent({ type: 'mousemove', ...next });
          }
          return next;
        });
      } else if (zoom > 1) {
        e.preventDefault();
        setPan((prev) => ({
          x: Math.max(-320, Math.min(320, prev.x + dx)),
          y: Math.max(-240, Math.min(240, prev.y + dy)),
        }));
      }
    }
  };

  const handleTouchEnd = () => {
    const ts = touchStateRef.current;
    if (ts.longPressTimer) {
      clearTimeout(ts.longPressTimer);
      ts.longPressTimer = null;
    }
    ts.pinchStartDist = 0;
  };

  const handleScreenKeyDown = (e) => {
    if (!sessionId || !controlEnabled) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName)) return;
    e.preventDefault();
    queueInputEvent({ type: 'key', key: e.key });
  };

  const handleSendSpecialKey = (keyCombo) => {
    if (!sessionId) {
      toast.warning('Inicie a sessão NexusDesk primeiro para enviar atalhos.');
      return;
    }
    queueInputEvent({ type: 'key', key: keyCombo });
    toast.success(`Atalho ${keyCombo} enviado.`);
  };

  const handleSendTextToRemote = (e) => {
    e.preventDefault();
    if (!textToType.trim() || !sessionId) return;
    queueInputEvent({ type: 'text', text: textToType });
    setTextToType('');
    toast.success('Texto enviado para a máquina remota.');
  };

  const toggleMobileKeyboard = () => {
    if (!mobileKeyboardInputRef.current) return;
    if (mobileKbOpen) {
      mobileKeyboardInputRef.current.blur();
      setMobileKbOpen(false);
    } else {
      mobileKeyboardInputRef.current.focus();
      setMobileKbOpen(true);
    }
  };

  const handleDownloadScreenshot = () => {
    if (!screenFrame?.data) return;
    const a = document.createElement('a');
    a.href = `data:image/jpeg;base64,${screenFrame.data}`;
    a.download = `nexusdesk-${patrimony}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jpg`;
    a.click();
  };

  const toggleFullscreen = () => {
    const el = viewportRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen?.().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  const handleCycleZoom = () => {
    const steps = [1, 1.5, 2, 2.5];
    const next = steps[(steps.indexOf(zoom) + 1) % steps.length] || 1;
    setZoom(next);
    if (next === 1) setPan({ x: 0, y: 0 });
  };

  const handleSendCommand = async (type, command, title = '') => {
    if (!deviceKey) {
      toast.error('Dispositivo sem chave de agente.');
      return;
    }
    if (!policy.commandsEnabled) {
      toast.error('Comandos remotos desligados pela política da empresa (Agente ITAM > Políticas e segurança).');
      return;
    }
    try {
      const sent = await dispatchRemoteCommand({
        tenantId,
        deviceKey,
        hostname: hostLabel,
        type,
        command,
        title,
        user: currentUser,
      });
      setRunningCmdId(sent.id);
      toast.success(`Comando enviado. A máquina executa em até ${responseSeconds} s.`);
    } catch (e) {
      toast.error(e?.message || 'Erro ao enviar comando remoto.');
    }
  };

  const handleUpdateAgentRemote = async () => {
    if (!deviceKey) return;
    if (!policy.commandsEnabled) {
      toast.error('Ative os comandos remotos na aba Políticas para atualizar o agente remotamente.');
      return;
    }
    const ok = await confirm({
      title: `Atualizar Agente em ${patrimony} para v${AGENT_VERSION}?`,
      message: `O computador baixará o pacote oficial NexusAgent v${AGENT_VERSION}, substituirá o serviço e o NexusDesk preservando a matrícula atual e voltará online automaticamente em poucos segundos.`,
      confirmLabel: `Atualizar para v${AGENT_VERSION}`,
    });
    if (!ok) return;
    setUpdatingAgent(true);
    try {
      const sent = await dispatchAgentUpdate({
        tenantId,
        deviceKey,
        hostname: hostLabel,
        targetVersion: AGENT_VERSION,
        user: currentUser,
      });
      setRunningCmdId(sent.id);
      toast.success(`Atualização v${AGENT_VERSION} enviada para ${patrimony}! O serviço reiniciará em instantes.`);
    } catch (e) {
      toast.error(e?.message || 'Não foi possível enviar a atualização do agente.');
    } finally {
      setUpdatingAgent(false);
    }
  };

  const handleRunPowerShell = async (e) => {
    e?.preventDefault();
    if (!psInput.trim()) return;
    const cmd = psInput.trim();
    setPsInput('');
    await handleSendCommand(REMOTE_COMMANDS.POWERSHELL, cmd);
  };

  const handleKillProcess = async (proc) => {
    const ok = await confirm({
      title: `Finalizar processo ${proc.name}?`,
      message: `O processo "${proc.name}" (PID ${proc.pid}, ocupando ${proc.memoryMb} MB) será encerrado imediatamente na máquina ${patrimony}.`,
      danger: true,
      confirmLabel: 'Finalizar Processo',
    });
    if (!ok) return;
    await handleSendCommand(REMOTE_COMMANDS.KILL_PROCESS, String(proc.pid));
  };

  const handlePowerAction = async (actionType, label) => {
    const ok = await confirm({
      title: `${label} (${patrimony})?`,
      message: `Tem certeza que deseja executar "${label}" remotamente no computador de ${loggedUser}?`,
      danger: actionType !== REMOTE_COMMANDS.LOCK_SCREEN,
      confirmLabel: label,
    });
    if (!ok) return;
    await handleSendCommand(actionType, label);
  };

  const handleRevoke = async () => {
    const ok = await confirm({
      title: `Revogar o agente de ${patrimony}?`,
      message: 'A máquina perde o acesso à empresa na hora: para de enviar inventário e não recebe mais comandos nem acesso remoto. Para voltar, reinstale o agente com o token da empresa.',
      danger: true,
      confirmLabel: 'Revogar agente',
    });
    if (!ok) return;
    try {
      await handleStopRemote();
      const removed = await revokeAgentDevice({ tenantId, deviceKey, hostname: hostLabel, user: currentUser });
      toast.success(removed ? 'Agente revogado.' : 'Nenhuma matrícula ativa: a máquina já estava sem acesso.');
    } catch (e) {
      toast.error(e?.code === 'permission-denied' ? 'Só owner e administradores revogam agentes.' : (e?.message || 'Erro ao revogar.'));
    }
  };

  const handleResolveSupport = async () => {
    try {
      await resolveSupportRequest({ tenantId, deviceKey, resolvedBy: operatorName });
      toast.success('Chamado de suporte marcado como atendido!');
    } catch {
      toast.error('Não foi possível atualizar o chamado.');
    }
  };

  const filteredProcesses = topProcesses.filter((p) =>
    !procFilter.trim() ||
    String(p.name || '').toLowerCase().includes(procFilter.trim().toLowerCase()) ||
    String(p.pid || '').includes(procFilter.trim())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-sm p-0 md:p-4">
      <div className="bg-white dark:bg-slate-900 border-0 md:border border-gray-200 dark:border-slate-800 rounded-none md:rounded-xl shadow-2xl w-full max-w-7xl h-[100dvh] md:h-[92vh] flex flex-col overflow-hidden">
        {/* Top Bar Responsiva */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 md:px-5 py-2.5 md:py-3.5 bg-slate-900 text-white border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={`w-9 h-9 md:w-10 md:h-10 rounded-xl flex items-center justify-center font-black text-sm shrink-0 ${online ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800 text-slate-400'}`}>
              <Monitor className="w-4 h-4 md:w-5 md:h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 md:gap-2.5 flex-wrap">
                <h2 className="font-black text-sm md:text-base tracking-tight truncate">{patrimony}</h2>
                <span className="px-2 py-0.5 rounded-md bg-blue-500/20 border border-blue-400/30 text-blue-300 font-mono text-[11px] font-bold">
                  NexusDesk: {accessId}
                </span>
                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] md:text-[11px] font-bold ${online ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                  {online ? 'Online' : 'Standby'}
                </span>
                {currentAgentVer && (
                  <span className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-bold ${agentOutdated ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-slate-800 text-slate-400'}`}>
                    v{currentAgentVer}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                Host: <span className="text-slate-200 font-semibold">{hostname}</span> • Usuário:{' '}
                <span className="text-slate-200 font-semibold">{loggedUser}</span>
                <span className="hidden sm:inline">
                  {' '}• IP: <span className="font-mono text-slate-200">{ipAddress}</span> • {osCaption}
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 md:gap-2 ml-auto">
            {agentOutdated && (
              <button
                onClick={handleUpdateAgentRemote}
                disabled={updatingAgent}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold text-[11px] transition-colors"
                title={`Atualizar agente remotamente de v${currentAgentVer} para v${AGENT_VERSION}`}
              >
                <ArrowUpCircle className={`w-3.5 h-3.5 ${updatingAgent ? 'animate-bounce' : ''}`} />
                <span className="hidden sm:inline">Atualizar p/</span> v{AGENT_VERSION}
              </button>
            )}
            {liveDevice?.supportRequest?.status === 'open' && (
              <button
                onClick={handleResolveSupport}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-[11px] transition-colors"
                title={liveDevice.supportRequest.message}
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Concluir Chamado</span>
              </button>
            )}
            <button
              onClick={async () => {
                await handleStopRemote();
                onClose();
              }}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              title="Fechar NexusDesk"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Banner de chamado de suporte aberto pelo colaborador */}
        {liveDevice?.supportRequest?.status === 'open' && (
          <div className="px-4 py-2 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800/60 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2 text-xs text-amber-900 dark:text-amber-200 min-w-0">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span className="truncate">
                <strong>Suporte ({liveDevice.supportRequest.priority || 'Normal'}):</strong>{' '}
                &ldquo;{liveDevice.supportRequest.message}&rdquo; —{' '}
                <strong>{liveDevice.supportRequest.user || loggedUser}</strong>
              </span>
            </div>
            <button
              onClick={handleResolveSupport}
              className="text-xs font-bold text-amber-800 dark:text-amber-300 underline shrink-0"
            >
              Resolver
            </button>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 px-3 md:px-5 pt-1.5 bg-gray-50 dark:bg-slate-900/80 border-b border-gray-200 dark:border-slate-800 overflow-x-auto no-scrollbar shrink-0">
          {[
            { id: 'screen', label: 'NexusDesk (Tela Remota)', shortLabel: 'NexusDesk', icon: Monitor },
            { id: 'terminal', label: 'Terminal PowerShell', shortLabel: 'PowerShell', icon: Terminal },
            { id: 'processes', label: `Processos (${topProcesses.length})`, shortLabel: `Proc. (${topProcesses.length})`, icon: Activity },
            { id: 'actions', label: 'Ações, OTA & Winget', shortLabel: 'Ações & OTA', icon: Zap },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-1.5 px-3 md:px-4 py-2 text-xs font-bold border-b-2 transition-colors whitespace-nowrap ${
                  active
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400 bg-white dark:bg-slate-800/70 rounded-t-lg'
                    : 'border-transparent text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5 md:w-4 md:h-4" />
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden">{tab.shortLabel}</span>
              </button>
            );
          })}
        </div>

        {/* Main Tab Content */}
        <div className="flex-1 overflow-y-auto flex flex-col min-h-0">
          {/* TAB 1: TELA REMOTA INTERATIVA NEXUSDESK */}
          {activeTab === 'screen' && (
            <div className="flex-1 flex flex-col bg-slate-950 text-white overflow-hidden min-h-0">
              {/* Input oculto para acionar o teclado nativo do celular */}
              <input
                ref={mobileKeyboardInputRef}
                type="text"
                inputMode="text"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                aria-label="Teclado virtual remoto"
                className="sr-only"
                onChange={(e) => {
                  const val = e.target.value;
                  if (val && sessionId) {
                    queueInputEvent({ type: 'text', text: val });
                  }
                  e.target.value = '';
                }}
                onKeyDown={(e) => {
                  if (!sessionId) return;
                  if (e.key === 'Backspace' || e.key === 'Enter' || e.key === 'Tab' || e.key === 'Escape') {
                    e.preventDefault();
                    queueInputEvent({ type: 'key', key: e.key });
                  }
                }}
                onBlur={() => setMobileKbOpen(false)}
              />

              {/* Remote Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-2 px-3 md:px-4 py-2 bg-slate-900 border-b border-slate-800 text-xs shrink-0">
                <div className="flex flex-wrap items-center gap-1.5 md:gap-2">
                  {!sessionId ? (
                    <>
                      <select
                        value={effectiveMode}
                        onChange={(e) => setSessionMode(e.target.value)}
                        className="px-2 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 font-semibold text-xs max-w-[200px] sm:max-w-none"
                        title="A política da empresa define se o acesso sem supervisão é permitido"
                      >
                        <option value="attended">Com permissão (30 s)</option>
                        <option value="unattended" disabled={policy.remoteAccess !== 'unattended'}>
                          Sem supervisão{policy.remoteAccess !== 'unattended' ? ' (bloqueado)' : ''}
                        </option>
                      </select>
                      <button
                        onClick={handleStartRemote}
                        disabled={connecting}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold shadow-sm transition-colors"
                      >
                        <Play className="w-3.5 h-3.5" />
                        {connecting ? 'Conectando...' : 'Conectar NexusDesk'}
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={handleStopRemote}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold transition-colors"
                    >
                      <Square className="w-3.5 h-3.5" />
                      Encerrar
                    </button>
                  )}

                  <select
                    value={quality}
                    onChange={(e) => handleQualityChange(e.target.value)}
                    className="px-2 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 text-xs"
                    title="Qualidade de Imagem"
                  >
                    <option value="low">Rápida (860p)</option>
                    <option value="balanced">Padrão (1152p)</option>
                    <option value="high">Alta HD (1366p)</option>
                  </select>

                  <button
                    onClick={() => setControlEnabled((v) => !v)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                      controlEnabled
                        ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                        : 'bg-slate-800 border-slate-700 text-slate-400'
                    }`}
                    title="Ativar/Desativar controle de mouse e teclado"
                  >
                    <MousePointer className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">{controlEnabled ? 'Controle Ativo' : 'Só Visualizar'}</span>
                  </button>

                  {/* Controles exclusivos para facilitar uso no celular / tablet */}
                  <button
                    onClick={() => setTouchMode((m) => (m === 'direct' ? 'trackpad' : 'direct'))}
                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                      touchMode === 'trackpad'
                        ? 'bg-purple-500/25 border-purple-400/50 text-purple-200'
                        : 'bg-slate-800 border-slate-700 text-slate-300'
                    }`}
                    title="Alternar entre Toque Direto na tela ou Trackpad Virtual (arraste para mover o cursor)"
                  >
                    <Hand className="w-3.5 h-3.5" />
                    {touchMode === 'trackpad' ? 'Trackpad' : 'Toque Direto'}
                  </button>

                  <button
                    onClick={() => setRightClickArmed((v) => !v)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                      rightClickArmed
                        ? 'bg-amber-500/25 border-amber-400/50 text-amber-200'
                        : 'bg-slate-800 border-slate-700 text-slate-300'
                    }`}
                    title="Armar Clique Direito para o próximo toque"
                  >
                    Clique Dir.
                  </button>

                  <button
                    onClick={handleCycleZoom}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-mono"
                    title="Alternar Zoom na tela remota (ou faça pinça com 2 dedos no celular)"
                  >
                    {zoom > 1 ? <ZoomOut className="w-3.5 h-3.5 text-blue-400" /> : <ZoomIn className="w-3.5 h-3.5" />}
                    {zoom}x
                  </button>

                  <button
                    onClick={toggleMobileKeyboard}
                    disabled={!sessionId}
                    className={`sm:hidden inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-semibold ${
                      mobileKbOpen
                        ? 'bg-blue-600 border-blue-400 text-white'
                        : 'bg-slate-800 border-slate-700 text-slate-200 disabled:opacity-40'
                    }`}
                    title="Abrir teclado nativo do celular"
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                    Teclado
                  </button>
                </div>

                {/* Special Keys & Screenshot (Rolavel horizontalmente no celular) */}
                <div className="flex items-center gap-1 overflow-x-auto no-scrollbar max-w-full py-0.5">
                  {[
                    { key: 'Win', label: 'Win' },
                    { key: 'Alt+Tab', label: 'Alt+Tab' },
                    { key: 'Ctrl+Shift+Esc', label: 'TaskMgr' },
                    { key: 'Win+D', label: 'Desktop' },
                    { key: 'Win+R', label: 'Win+R' },
                    { key: 'Alt+F4', label: 'Alt+F4' },
                    { key: 'Ctrl+C', label: 'Ctrl+C' },
                    { key: 'Ctrl+V', label: 'Ctrl+V' },
                    { key: 'Escape', label: 'Esc' },
                    { key: 'Tab', label: 'Tab' },
                    { key: 'Backspace', label: 'Bksp' },
                    { key: 'Enter', label: 'Enter' },
                  ].map((item) => (
                    <button
                      key={item.key}
                      onClick={() => handleSendSpecialKey(item.key)}
                      className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-[11px] shrink-0"
                    >
                      {item.label}
                    </button>
                  ))}
                  {screenFrame?.data && (
                    <button
                      onClick={handleDownloadScreenshot}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] shrink-0"
                      title="Salvar captura de tela em JPG"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      Foto
                    </button>
                  )}
                  <button
                    onClick={toggleFullscreen}
                    className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 shrink-0"
                    title="Alternar Tela Cheia"
                  >
                    {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Screen Canvas Area */}
              <div
                ref={viewportRef}
                tabIndex={0}
                onKeyDown={handleScreenKeyDown}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                className="flex-1 flex items-center justify-center relative bg-slate-950 overflow-hidden select-none outline-none p-1 md:p-2 touch-none"
              >
                {isSessionActive && screenFrame?.data ? (
                  <div
                    className="relative inline-block max-w-full max-h-full shadow-2xl border border-slate-800 rounded-lg overflow-hidden transition-transform duration-75"
                    style={{
                      transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                      transformOrigin: 'center center',
                    }}
                  >
                    <img
                      ref={screenImgRef}
                      src={`data:image/jpeg;base64,${screenFrame.data}`}
                      alt="Tela Remota NexusDesk"
                      draggable={false}
                      onClick={handleScreenClick}
                      onDoubleClick={handleScreenDoubleClick}
                      onContextMenu={handleScreenContextMenu}
                      onMouseMove={handleScreenMouseMove}
                      onWheel={handleScreenWheel}
                      className={`max-w-full max-h-[68dvh] md:max-h-[68vh] object-contain block ${
                        controlEnabled ? 'cursor-crosshair' : 'cursor-default'
                      }`}
                    />
                    {/* Cursor virtual visivel no modo Trackpad Mobile */}
                    {touchMode === 'trackpad' && controlEnabled && (
                      <div
                        className="absolute w-4 h-4 -ml-2 -mt-2 rounded-full border-2 border-white bg-purple-500/80 shadow-lg pointer-events-none"
                        style={{
                          left: `${virtualCursor.x * 100}%`,
                          top: `${virtualCursor.y * 100}%`,
                        }}
                      />
                    )}
                    <div className="absolute top-2 right-2 px-2 py-0.5 rounded-md bg-slate-950/80 backdrop-blur text-[10px] font-mono text-slate-300 flex items-center gap-1.5 pointer-events-none">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                      <span>
                        {screenFrame.screenWidth || screenFrame.width}×{screenFrame.screenHeight || screenFrame.height}
                      </span>
                      <span>• #{screenFrame.seq || 1}</span>
                      <span className="text-emerald-300 font-sans font-bold">• Seguro</span>
                    </div>
                  </div>
                ) : (
                  <div className="max-w-md text-center p-5 md:p-6 rounded-xl bg-slate-900/90 border border-slate-800 mx-3">
                    <Monitor className="w-12 h-12 text-blue-400 mx-auto mb-3 opacity-80" />
                    {SESSION_END_MESSAGES[endedState] ? (
                      <>
                        <h3 className={`font-bold text-base mb-1 ${endedState === 'rejected' || endedState === 'refused_policy' ? 'text-red-400' : 'text-slate-200'}`}>
                          {endedState === 'rejected' ? 'Acesso recusado' : 'Sessão encerrada'}
                        </h3>
                        <p className="text-xs text-slate-400 mb-4">{SESSION_END_MESSAGES[endedState]}</p>
                      </>
                    ) : isWaitingAgent ? (
                      <>
                        <RefreshCw className="w-6 h-6 text-blue-400 animate-spin mx-auto mb-2" />
                        <h3 className="font-bold text-base text-white mb-1">Chamando a máquina via NexusDesk...</h3>
                        <p className="text-xs text-slate-400">
                          O agente confere o canal no próximo sinal de vida (até {responseSeconds} s).
                          {effectiveMode === 'attended' ? ' Depois, o colaborador precisa aceitar na tela.' : ''}
                        </p>
                      </>
                    ) : isWaitingConsent ? (
                      <>
                        <h3 className="font-bold text-base text-amber-300 mb-1">
                          Aguardando Permissão na Tela do Usuário...
                        </h3>
                        <p className="text-xs text-slate-400 mb-4">
                          Uma janela de confirmação do <strong>NexusDesk</strong> apareceu na tela de <strong>{loggedUser}</strong> com contagem regressiva de 30 segundos.
                        </p>
                      </>
                    ) : sessionId ? (
                      <>
                        <RefreshCw className="w-6 h-6 text-blue-400 animate-spin mx-auto mb-2" />
                        <h3 className="font-bold text-base text-white mb-1">
                          Estabelecendo Captura de Tela...
                        </h3>
                        <p className="text-xs text-slate-400">
                          Aguardando o primeiro quadro de vídeo do <strong>NexusAgent.exe</strong> na máquina {patrimony}.
                        </p>
                      </>
                    ) : (
                      <>
                        <h3 className="font-bold text-base text-white mb-1">
                          NexusDesk Pronto ({accessId})
                        </h3>
                        <p className="text-xs text-slate-400 mb-4">
                          Acesse a área de trabalho em tempo real pelo computador ou celular com sessão auditada, consentimento do colaborador e descarte automático de capturas ao encerrar.
                        </p>
                        <button
                          onClick={handleStartRemote}
                          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-lg transition-colors"
                        >
                          <Play className="w-4 h-4" />
                          Iniciar NexusDesk Agora
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Quick Text Input Bar for Remote Keyboard */}
              <form
                onSubmit={handleSendTextToRemote}
                className="flex items-center gap-2 px-3 md:px-4 py-2 bg-slate-900 border-t border-slate-800 shrink-0"
              >
                <Keyboard className="w-4 h-4 text-slate-400 shrink-0" />
                <input
                  type="text"
                  value={textToType}
                  onChange={(e) => setTextToType(e.target.value)}
                  placeholder="Enviar texto para digitar na máquina remota (não envie senhas por aqui)"
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
                <button
                  type="submit"
                  disabled={!sessionId || !textToType.trim()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-bold text-xs shrink-0"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Digitar</span>
                </button>
              </form>
            </div>
          )}

          {/* TAB 2: TERMINAL POWERSHELL REMOTO */}
          {activeTab === 'terminal' && (
            <div className="flex-1 flex flex-col p-4 md:p-6 gap-4 bg-gray-50 dark:bg-slate-950">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-slate-400 mb-2">
                  Comandos Rápidos de Diagnóstico e Reparo (1 Clique)
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {QUICK_POWERSHELL_ACTIONS.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => handleSendCommand(REMOTE_COMMANDS.POWERSHELL, item.command)}
                      className="flex flex-col items-start p-3 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 hover:border-blue-500 dark:hover:border-blue-500 text-left transition-all"
                    >
                      <span className="font-bold text-xs text-gray-900 dark:text-white flex items-center gap-1.5">
                        <Terminal className="w-3.5 h-3.5 text-blue-500" />
                        {item.label}
                      </span>
                      <span className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">
                        {item.description}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Console Output */}
              <div className="flex-1 bg-slate-900 border border-slate-800 rounded-xl p-4 font-mono text-xs text-slate-200 overflow-y-auto min-h-[240px] space-y-4">
                {runningCmdId && (
                  <div className="flex items-center gap-2 text-amber-300 animate-pulse">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Executando comando no computador remoto ({patrimony})...</span>
                  </div>
                )}

                {commandHistory.length === 0 ? (
                  <div className="text-slate-500">
                    PS C:\Windows\system32&gt; Digite um comando PowerShell abaixo ou escolha uma ação rápida acima.
                  </div>
                ) : (
                  commandHistory.map((entry) => (
                    <div key={entry.commandId} className="border-b border-slate-800 pb-3 last:border-none">
                      <div className="flex items-center justify-between text-[11px] text-blue-400 mb-1">
                        <span className="truncate max-w-[75%]">PS {hostname}&gt; {entry.command}</span>
                        <span className="text-slate-500 shrink-0">
                          {entry.completedAt ? new Date(entry.completedAt).toLocaleTimeString('pt-BR') : ''}
                        </span>
                      </div>
                      <pre className="whitespace-pre-wrap text-emerald-300 bg-slate-950/70 p-3 rounded-lg overflow-x-auto">
                        {entry.output || '(Sem saída)'}
                      </pre>
                    </div>
                  ))
                )}
              </div>

              {/* Command Input */}
              <form onSubmit={handleRunPowerShell} className="flex items-center gap-2">
                <div className="flex-1 flex items-center bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5">
                  <span className="font-mono text-xs text-blue-400 mr-2">PS&gt;</span>
                  <input
                    type="text"
                    value={psInput}
                    maxLength={MAX_COMMAND_LENGTH}
                    onChange={(e) => setPsInput(e.target.value)}
                    placeholder="Ex: Get-Service | Where-Object {$_.Status -eq 'Running'} | Select -First 15"
                    className="flex-1 bg-transparent font-mono text-xs text-white placeholder-slate-500 focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!psInput.trim()}
                  className="inline-flex items-center gap-2 px-4 md:px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-bold text-xs shrink-0"
                >
                  <Play className="w-4 h-4" />
                  Executar
                </button>
              </form>
            </div>
          )}

          {/* TAB 3: PROCESSOS E RECURSOS EM TEMPO REAL */}
          {activeTab === 'processes' && (
            <div className="flex-1 p-4 md:p-6 space-y-5 bg-gray-50 dark:bg-slate-950">
              {/* Resource Gauges */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800">
                  <div className="flex items-center justify-between text-xs font-bold text-gray-500 dark:text-slate-400 mb-2">
                    <span className="flex items-center gap-1.5">
                      <Cpu className="w-4 h-4 text-blue-500" /> USO DE CPU
                    </span>
                    <span className="text-base font-black text-gray-900 dark:text-white">
                      {metrics.cpuPercent ?? '—'}%
                    </span>
                  </div>
                  <div className="w-full h-2.5 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-600 rounded-full transition-all"
                      style={{ width: `${Math.min(100, metrics.cpuPercent || 0)}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-2">
                    Uptime ativo: <strong>{metrics.uptimeHours ?? '—'} horas</strong>
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800">
                  <div className="flex items-center justify-between text-xs font-bold text-gray-500 dark:text-slate-400 mb-2">
                    <span className="flex items-center gap-1.5">
                      <Activity className="w-4 h-4 text-emerald-500" /> MEMÓRIA RAM
                    </span>
                    <span className="text-base font-black text-gray-900 dark:text-white">
                      {metrics.ramPercent ?? '—'}%
                    </span>
                  </div>
                  <div className="w-full h-2.5 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full transition-all"
                      style={{ width: `${Math.min(100, metrics.ramPercent || 0)}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-2">
                    Em uso: <strong>{metrics.ramUsedGb ?? '—'} GB</strong> de {metrics.ramTotalGb ?? '—'} GB
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800">
                  <div className="flex items-center justify-between text-xs font-bold text-gray-500 dark:text-slate-400 mb-2">
                    <span className="flex items-center gap-1.5">
                      <HardDrive className="w-4 h-4 text-amber-500" /> DISCO PRINCIPAL (C:)
                    </span>
                    <span className="text-base font-black text-gray-900 dark:text-white">
                      {metrics.diskPercent ?? '—'}%
                    </span>
                  </div>
                  <div className="w-full h-2.5 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-500 rounded-full transition-all"
                      style={{ width: `${Math.min(100, metrics.diskPercent || 0)}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-2">
                    Espaço livre: <strong>{metrics.diskFreeGb ?? '—'} GB</strong> de {metrics.diskTotalGb ?? '—'} GB
                  </p>
                </div>
              </div>

              {/* Process Manager Table */}
              <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-gray-200 dark:border-slate-800">
                  <h4 className="font-bold text-xs uppercase tracking-wider text-gray-700 dark:text-slate-300">
                    Principais Processos em Execução na Estação
                  </h4>
                  <input
                    type="text"
                    value={procFilter}
                    onChange={(e) => setProcFilter(e.target.value)}
                    placeholder="Filtrar por nome ou PID..."
                    className="px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-xs text-gray-900 dark:text-white"
                  />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-gray-50 dark:bg-slate-800/60 text-gray-500 dark:text-slate-400 uppercase text-[11px]">
                      <tr>
                        <th className="px-4 py-2.5">PID</th>
                        <th className="px-4 py-2.5">Processo</th>
                        <th className="px-4 py-2.5">Memória RAM</th>
                        <th className="px-4 py-2.5">Contexto</th>
                        <th className="px-4 py-2.5 text-right">Ação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                      {filteredProcesses.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-8 text-center text-gray-400 dark:text-slate-500">
                            Nenhum processo listado ainda. Certifique-se de que o NexusAgent.exe está ativo nesta máquina.
                          </td>
                        </tr>
                      ) : (
                        filteredProcesses.map((proc) => (
                          <tr key={proc.pid} className="hover:bg-gray-50 dark:hover:bg-slate-800/40">
                            <td className="px-4 py-2.5 font-mono text-gray-500 dark:text-slate-400">{proc.pid}</td>
                            <td className="px-4 py-2.5 font-bold text-gray-900 dark:text-white">{proc.name}.exe</td>
                            <td className="px-4 py-2.5 font-mono text-gray-700 dark:text-slate-300">{proc.memoryMb} MB</td>
                            <td className="px-4 py-2.5">
                              {proc.session === 0 ? (
                                <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold text-[11px]">
                                  Sistema
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-semibold text-[11px]">
                                  Usuário
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <button
                                onClick={() => handleKillProcess(proc)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100 dark:bg-red-950/50 dark:hover:bg-red-900/60 text-red-600 dark:text-red-300 font-bold text-[11px] transition-colors"
                              >
                                <Trash2 className="w-3 h-3" />
                                Finalizar
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: ACOES, ATUALIZACAO OTA, MENSAGENS NA TELA E WINGET */}
          {activeTab === 'actions' && (
            <div className="flex-1 p-4 md:p-6 grid grid-cols-1 lg:grid-cols-2 gap-5 bg-gray-50 dark:bg-slate-950">
              {/* Atualizacao Remota do Agente (OTA) */}
              <div className="lg:col-span-2 p-5 rounded-xl bg-slate-900 border border-slate-800 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0">
                    <ArrowUpCircle className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-sm text-gray-900 dark:text-white">
                        Atualização Remota do Agente & NexusDesk (OTA)
                      </h3>
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 font-mono">
                        Instalado: {currentAgentVer ? `v${currentAgentVer}` : '—'} • Última: v{AGENT_VERSION}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-slate-300 mt-1">
                      Atualiza silenciosamente o executável <code>NexusAgent.exe</code> e o coletor desta máquina pela nuvem sem precisar ir até o computador ou redigitar o token.
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleUpdateAgentRemote}
                  disabled={updatingAgent}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold text-xs shadow-sm transition-colors shrink-0"
                >
                  <ArrowUpCircle className={`w-4 h-4 ${updatingAgent ? 'animate-bounce' : ''}`} />
                  {updatingAgent
                    ? 'Enviando atualização...'
                    : agentOutdated
                      ? `Atualizar para v${AGENT_VERSION}`
                      : `Reinstalar / Forçar v${AGENT_VERSION}`}
                </button>
              </div>

              {/* Pop-up Message to User */}
              <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 space-y-3">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-blue-600" />
                  <h3 className="font-bold text-sm text-gray-900 dark:text-white">
                    Enviar Alerta Pop-up na Tela do Colaborador
                  </h3>
                </div>
                <p className="text-xs text-gray-500 dark:text-slate-400">
                  Exibe imediatamente uma caixa de diálogo nativa em primeiro plano na tela de <strong>{loggedUser}</strong>.
                </p>
                <input
                  type="text"
                  value={msgTitle}
                  onChange={(e) => setMsgTitle(e.target.value)}
                  placeholder="Título da janela"
                  className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-xs text-gray-900 dark:text-white"
                />
                <textarea
                  rows={3}
                  value={msgBody}
                  onChange={(e) => setMsgBody(e.target.value)}
                  placeholder="Digite a mensagem para o colaborador (ex: Por favor, salve seus arquivos. A TI iniciará a manutenção em 5 minutos)..."
                  className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-xs text-gray-900 dark:text-white"
                />
                <button
                  onClick={() => {
                    if (!msgBody.trim()) return;
                    handleSendCommand(REMOTE_COMMANDS.MSGBOX, msgBody.trim(), msgTitle.trim());
                    setMsgBody('');
                  }}
                  disabled={!msgBody.trim()}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-bold text-xs"
                >
                  <Send className="w-3.5 h-3.5" />
                  Exibir Alerta na Tela Agora
                </button>
              </div>

              {/* Power & Security Controls */}
              <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 space-y-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-600" />
                  <h3 className="font-bold text-sm text-gray-900 dark:text-white">
                    Energia, Bloqueio e Inventário
                  </h3>
                </div>
                <p className="text-xs text-gray-500 dark:text-slate-400">
                  Comandos imediatos de segurança patrimonial e sincronização forçada.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                  <button
                    onClick={() => handleSendCommand(REMOTE_COMMANDS.FORCE_INVENTORY, 'sync')}
                    className="flex items-center gap-2.5 p-3 rounded-xl bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-bold text-xs transition-colors"
                  >
                    <RefreshCw className="w-4 h-4 shrink-0" />
                    Forçar Coleta de Inventário
                  </button>
                  <button
                    onClick={() => handlePowerAction(REMOTE_COMMANDS.LOCK_SCREEN, 'Bloquear Tela do Windows')}
                    className="flex items-center gap-2.5 p-3 rounded-xl bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 dark:hover:bg-amber-900/50 text-amber-800 dark:text-amber-300 font-bold text-xs transition-colors"
                  >
                    <Lock className="w-4 h-4 shrink-0" />
                    Bloquear Estação (Lock)
                  </button>
                  <button
                    onClick={() => handlePowerAction(REMOTE_COMMANDS.RESTART, 'Reiniciar Computador')}
                    className="flex items-center gap-2.5 p-3 rounded-xl bg-orange-50 hover:bg-orange-100 dark:bg-orange-950/40 dark:hover:bg-orange-900/50 text-orange-700 dark:text-orange-300 font-bold text-xs transition-colors"
                  >
                    <RotateCcw className="w-4 h-4 shrink-0" />
                    Reiniciar Máquina (30s)
                  </button>
                  <button
                    onClick={() => handlePowerAction(REMOTE_COMMANDS.SHUTDOWN, 'Desligar Computador')}
                    className="flex items-center gap-2.5 p-3 rounded-xl bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300 font-bold text-xs transition-colors"
                  >
                    <Power className="w-4 h-4 shrink-0" />
                    Desligar Máquina (30s)
                  </button>
                </div>
              </div>

              {isAdmin && (
                <div className="lg:col-span-2 p-5 rounded-xl bg-white dark:bg-slate-900 border border-red-200 dark:border-red-900/60 flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="flex items-start gap-2">
                    <ShieldOff className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                    <div>
                      <h3 className="font-bold text-sm text-gray-900 dark:text-white">Revogar o agente desta máquina</h3>
                      <p className="text-xs text-gray-500 dark:text-slate-400">
                        Para equipamento perdido, roubado ou devolvido: a máquina perde o acesso à empresa na hora.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleRevoke}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs shrink-0"
                  >
                    <ShieldOff className="w-3.5 h-3.5" />
                    Revogar agente
                  </button>
                </div>
              )}

              {/* Silent Software Management (Winget) */}
              <div className="lg:col-span-2 p-5 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 space-y-4">
                <div className="flex items-center gap-2">
                  <Package className="w-5 h-5 text-purple-600" />
                  <h3 className="font-bold text-sm text-gray-900 dark:text-white">
                    Instalação e Remoção Silenciosa de Softwares (Winget)
                  </h3>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-gray-500 dark:text-slate-400 font-semibold">
                    Instalar pacote padrão em 1 clique:
                  </span>
                  {WINGET_PRESETS.map((preset) => (
                    <button
                      key={preset.pkg}
                      onClick={() => handleSendCommand(REMOTE_COMMANDS.INSTALL_WINGET, preset.pkg)}
                      className="px-3 py-1.5 rounded-lg bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/50 dark:hover:bg-purple-900/60 text-purple-700 dark:text-purple-300 font-bold text-xs transition-colors"
                    >
                      + {preset.label}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={wingetPkg}
                      onChange={(e) => setWingetPkg(e.target.value)}
                      placeholder="ID Winget para instalar (ex: VideoLAN.VLC)"
                      className="flex-1 px-3 py-2 rounded-xl bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-xs text-gray-900 dark:text-white"
                    />
                    <button
                      onClick={() => {
                        if (!wingetPkg.trim()) return;
                        handleSendCommand(REMOTE_COMMANDS.INSTALL_WINGET, wingetPkg.trim());
                        setWingetPkg('');
                      }}
                      disabled={!wingetPkg.trim()}
                      className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-bold text-xs shrink-0"
                    >
                      Instalar
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={uninstallName}
                      onChange={(e) => setUninstallName(e.target.value)}
                      placeholder="Nome do software para remover (ex: TeamViewer)"
                      className="flex-1 px-3 py-2 rounded-xl bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-xs text-gray-900 dark:text-white"
                    />
                    <button
                      onClick={() => {
                        if (!uninstallName.trim()) return;
                        handleSendCommand(REMOTE_COMMANDS.UNINSTALL_SOFTWARE, uninstallName.trim());
                        setUninstallName('');
                      }}
                      disabled={!uninstallName.trim()}
                      className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white font-bold text-xs shrink-0"
                    >
                      Desinstalar
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
