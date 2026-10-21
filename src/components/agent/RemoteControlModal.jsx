// src/components/agent/RemoteControlModal.jsx
import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Camera,
  CheckCircle2,
  Cpu,
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
  Square,
  Terminal,
  Trash2,
  UserCheck,
  Wifi,
  X,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { useConfirm } from '../ConfirmDialog';
import {
  QUICK_POWERSHELL_ACTIONS,
  REMOTE_COMMANDS,
  dispatchRemoteCommand,
  formatAccessId,
  isDeviceOnline,
  resolveSupportRequest,
  sendRemoteInputEvents,
  startRemoteSession,
  stopRemoteSession,
  subscribeAgentDevice,
  updateRemoteQuality,
} from '../../services/rmmService';

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

  // Estado da Sessao Remota
  const [sessionMode, setSessionMode] = useState('unattended');
  const [quality, setQuality] = useState('balanced');
  const [sessionId, setSessionId] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [controlEnabled, setControlEnabled] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [textToType, setTextToType] = useState('');

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
  const inputSeqRef = useRef(1);
  const inputQueueRef = useRef([]);
  const flushTimerRef = useRef(null);
  const lastMouseMoveAtRef = useRef(0);

  const deviceKey =
    liveDevice?.deviceKey ||
    initialDevice?.deviceKey ||
    asset?.agentDeviceKey ||
    '';

  const operatorName =
    currentUser?.name || currentUser?.email || 'Técnico de TI';

  useEffect(() => {
    setActiveTab(initialTab || 'screen');
  }, [initialTab, isOpen]);

  useEffect(() => {
    setLiveDevice(initialDevice || null);
  }, [initialDevice]);

  useEffect(() => {
    if (!isOpen || !tenantId || !deviceKey) return undefined;
    const unsub = subscribeAgentDevice(tenantId, deviceKey, (data) => {
      if (data) setLiveDevice(data);
    });
    return () => unsub();
  }, [isOpen, tenantId, deviceKey]);

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

  // Encerra sessao ao desmontar ou fechar modal
  useEffect(() => {
    return () => {
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
  const metrics = liveDevice?.metrics || {};
  const topProcesses = Array.isArray(liveDevice?.topProcesses) ? liveDevice.topProcesses : [];
  const screenFrame = liveDevice?.screenFrame || null;
  const remoteState = liveDevice?.remoteState || {};
  const isSessionActive = Boolean(sessionId) && (remoteState.state === 'active' || Boolean(screenFrame?.data));
  const isWaitingConsent = Boolean(sessionId) && sessionMode === 'attended' && remoteState.state !== 'active' && remoteState.state !== 'rejected';

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
        mode: sessionMode,
        quality,
        requestedBy: operatorName,
        events: batch,
      }).catch(() => {});
    }, 140);
  };

  const handleStartRemote = async () => {
    if (!deviceKey) {
      toast.error('Este ativo ainda não possui o Agente Nativo (NexusAgent.exe) vinculado.');
      return;
    }
    setConnecting(true);
    try {
      inputSeqRef.current = 1;
      inputQueueRef.current = [];
      const newSessionId = await startRemoteSession({
        tenantId,
        deviceKey,
        mode: sessionMode,
        quality,
        requestedBy: operatorName,
      });
      setSessionId(newSessionId);
      toast.success(
        sessionMode === 'attended'
          ? 'Solicitação enviada! Aguardando o usuário aceitar na tela...'
          : 'Iniciando transmissão da área de trabalho remota...'
      );
    } catch (e) {
      toast.error(e?.message || 'Falha ao iniciar sessão remota.');
    } finally {
      setConnecting(false);
    }
  };

  const handleStopRemote = async () => {
    const activeId = sessionId;
    setSessionId('');
    inputQueueRef.current = [];
    if (activeId && tenantId && deviceKey) {
      try {
        await stopRemoteSession({ tenantId, deviceKey });
        toast.info('Sessão remota encerrada.');
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
        mode: sessionMode,
        quality: newQuality,
        requestedBy: operatorName,
        inputEvents: inputQueueRef.current,
      }).catch(() => {});
    }
  };

  const getRelativeCoords = (e) => {
    const img = screenImgRef.current;
    if (!img) return { x: 0.5, y: 0.5 };
    const rect = img.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: 0.5, y: 0.5 };
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    return { x: Number(x.toFixed(4)), y: Number(y.toFixed(4)) };
  };

  const handleScreenClick = (e) => {
    if (!sessionId || !controlEnabled) return;
    const coords = getRelativeCoords(e);
    queueInputEvent({ type: 'click', ...coords });
  };

  const handleScreenDoubleClick = (e) => {
    if (!sessionId || !controlEnabled) return;
    const coords = getRelativeCoords(e);
    queueInputEvent({ type: 'dblclick', ...coords });
  };

  const handleScreenContextMenu = (e) => {
    e.preventDefault();
    if (!sessionId || !controlEnabled) return;
    const coords = getRelativeCoords(e);
    queueInputEvent({ type: 'rightclick', ...coords });
  };

  const handleScreenMouseMove = (e) => {
    if (!sessionId || !controlEnabled) return;
    const now = Date.now();
    if (now - lastMouseMoveAtRef.current < 260) return;
    lastMouseMoveAtRef.current = now;
    const coords = getRelativeCoords(e);
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

  const handleScreenKeyDown = (e) => {
    if (!sessionId || !controlEnabled) return;
    // Ignora se o foco estiver em um input normal fora do canvas
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName)) return;
    e.preventDefault();
    queueInputEvent({ type: 'key', key: e.key });
  };

  const handleSendSpecialKey = (keyCombo) => {
    if (!sessionId) {
      toast.warning('Inicie a sessão remota primeiro para enviar atalhos de teclado.');
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
    toast.success('Texto digitado na máquina remota.');
  };

  const handleDownloadScreenshot = () => {
    if (!screenFrame?.data) return;
    const a = document.createElement('a');
    a.href = `data:image/jpeg;base64,${screenFrame.data}`;
    a.download = `captura-${patrimony}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jpg`;
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

  const handleSendCommand = async (type, command, title = '') => {
    if (!deviceKey) {
      toast.error('Dispositivo sem chave de agente.');
      return;
    }
    try {
      const sent = await dispatchRemoteCommand({
        tenantId,
        deviceKey,
        type,
        command,
        title,
        requestedBy: operatorName,
      });
      setRunningCmdId(sent.id);
      toast.success('Comando enviado para o agente!');
    } catch (e) {
      toast.error(e?.message || 'Erro ao enviar comando remoto.');
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-2 md:p-5">
      <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-6xl h-[92vh] flex flex-col overflow-hidden">
        {/* Top Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 bg-slate-900 text-white border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm ${online ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800 text-slate-400'}`}>
              <Monitor className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="font-black text-base tracking-tight">{patrimony}</h2>
                <span className="px-2.5 py-0.5 rounded-md bg-blue-500/20 border border-blue-400/30 text-blue-300 font-mono text-xs font-bold">
                  ID: {accessId}
                </span>
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${online ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>
                  <span className={`w-2 h-2 rounded-full ${online ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                  {online ? 'Online Ao Vivo' : 'Offline / Standby'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Host: <span className="text-slate-200 font-semibold">{hostname}</span> • Usuário:{' '}
                <span className="text-slate-200 font-semibold">{loggedUser}</span> • IP:{' '}
                <span className="font-mono text-slate-200">{ipAddress}</span> • {osCaption}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {liveDevice?.supportRequest?.status === 'open' && (
              <button
                onClick={handleResolveSupport}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs transition-colors"
                title={liveDevice.supportRequest.message}
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                Concluir Chamado do Usuário
              </button>
            )}
            <button
              onClick={async () => {
                await handleStopRemote();
                onClose();
              }}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              title="Fechar Console Remoto"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Banner de chamado de suporte aberto pelo colaborador */}
        {liveDevice?.supportRequest?.status === 'open' && (
          <div className="px-5 py-2.5 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800/60 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-amber-900 dark:text-amber-200">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                <strong>Pedido de Suporte ({liveDevice.supportRequest.priority || 'Normal'}):</strong>{' '}
                &ldquo;{liveDevice.supportRequest.message}&rdquo; — enviado por{' '}
                <strong>{liveDevice.supportRequest.user || loggedUser}</strong>
              </span>
            </div>
            <button
              onClick={handleResolveSupport}
              className="text-xs font-bold text-amber-800 dark:text-amber-300 underline shrink-0"
            >
              Marcar como resolvido
            </button>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 px-5 pt-2 bg-gray-50 dark:bg-slate-900/80 border-b border-gray-200 dark:border-slate-800 overflow-x-auto">
          {[
            { id: 'screen', label: 'Tela Remota (AnyDesk Web)', icon: Monitor },
            { id: 'terminal', label: 'Terminal PowerShell', icon: Terminal },
            { id: 'processes', label: `Processos & Recursos (${topProcesses.length})`, icon: Activity },
            { id: 'actions', label: 'Ações, Alertas & Winget', icon: Zap },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition-colors whitespace-nowrap ${
                  active
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400 bg-white dark:bg-slate-800/70 rounded-t-lg'
                    : 'border-transparent text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Main Tab Content */}
        <div className="flex-1 overflow-y-auto flex flex-col">
          {/* TAB 1: TELA REMOTA INTERATIVA */}
          {activeTab === 'screen' && (
            <div className="flex-1 flex flex-col bg-slate-950 text-white overflow-hidden">
              {/* Remote Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-slate-900 border-b border-slate-800 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  {!sessionId ? (
                    <>
                      <select
                        value={sessionMode}
                        onChange={(e) => setSessionMode(e.target.value)}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 font-semibold text-xs"
                      >
                        <option value="unattended">Acesso Direto (Não Supervisionado)</option>
                        <option value="attended">Pedir Permissão ao Usuário (30s)</option>
                      </select>
                      <button
                        onClick={handleStartRemote}
                        disabled={connecting}
                        className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold shadow-sm transition-colors"
                      >
                        <Play className="w-3.5 h-3.5" />
                        {connecting ? 'Conectando...' : 'Conectar à Tela Agora'}
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={handleStopRemote}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold transition-colors"
                    >
                      <Square className="w-3.5 h-3.5" />
                      Desconectar
                    </button>
                  )}

                  <select
                    value={quality}
                    onChange={(e) => handleQualityChange(e.target.value)}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 text-xs"
                    title="Qualidade de Imagem"
                  >
                    <option value="low">Rápida (860p - Baixa Banda)</option>
                    <option value="balanced">Equilibrada (1152p - Padrão)</option>
                    <option value="high">Alta Nitidez (1366p - HD)</option>
                  </select>

                  <button
                    onClick={() => setControlEnabled((v) => !v)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                      controlEnabled
                        ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                        : 'bg-slate-800 border-slate-700 text-slate-400'
                    }`}
                    title="Ativar/Desativar clique de mouse e teclado"
                  >
                    <MousePointer className="w-3.5 h-3.5" />
                    {controlEnabled ? 'Mouse & Teclado Ativos' : 'Somente Visualização'}
                  </button>
                </div>

                {/* Special Keys & Screenshot */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    onClick={() => handleSendSpecialKey('Win')}
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-[11px]"
                    title="Abrir Menu Iniciar no computador remoto"
                  >
                    Win
                  </button>
                  <button
                    onClick={() => handleSendSpecialKey('Alt+Tab')}
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-[11px]"
                    title="Alternar Janela (Alt+Tab)"
                  >
                    Alt+Tab
                  </button>
                  <button
                    onClick={() => handleSendSpecialKey('Ctrl+Shift+Esc')}
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-[11px]"
                    title="Abrir Gerenciador de Tarefas"
                  >
                    TaskMgr
                  </button>
                  <button
                    onClick={() => handleSendSpecialKey('Win+D')}
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-[11px]"
                    title="Mostrar Área de Trabalho (Win+D)"
                  >
                    Desktop
                  </button>
                  <button
                    onClick={() => handleSendSpecialKey('Win+R')}
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-[11px]"
                    title="Abrir Executar (Win+R)"
                  >
                    Win+R
                  </button>
                  {screenFrame?.data && (
                    <button
                      onClick={handleDownloadScreenshot}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px]"
                      title="Salvar captura de tela em JPG"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      Foto
                    </button>
                  )}
                  <button
                    onClick={toggleFullscreen}
                    className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
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
                className="flex-1 flex items-center justify-center relative bg-slate-950 overflow-auto select-none outline-none p-2"
              >
                {isSessionActive && screenFrame?.data ? (
                  <div className="relative inline-block max-w-full max-h-full shadow-2xl border border-slate-800 rounded-lg overflow-hidden">
                    <img
                      ref={screenImgRef}
                      src={`data:image/jpeg;base64,${screenFrame.data}`}
                      alt="Tela Remota"
                      draggable={false}
                      onClick={handleScreenClick}
                      onDoubleClick={handleScreenDoubleClick}
                      onContextMenu={handleScreenContextMenu}
                      onMouseMove={handleScreenMouseMove}
                      onWheel={handleScreenWheel}
                      className={`max-w-full max-h-[68vh] object-contain block ${
                        controlEnabled ? 'cursor-crosshair' : 'cursor-default'
                      }`}
                    />
                    <div className="absolute top-2 right-2 px-2.5 py-1 rounded-md bg-slate-950/80 backdrop-blur text-[11px] font-mono text-slate-300 flex items-center gap-2 pointer-events-none">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                      <span>
                        {screenFrame.screenWidth || screenFrame.width}×{screenFrame.screenHeight || screenFrame.height}
                      </span>
                      <span>• Frame #{screenFrame.seq || 1}</span>
                    </div>
                  </div>
                ) : (
                  <div className="max-w-md text-center p-6 rounded-2xl bg-slate-900/90 border border-slate-800">
                    <Monitor className="w-12 h-12 text-blue-400 mx-auto mb-3 opacity-80" />
                    {remoteState.state === 'rejected' ? (
                      <>
                        <h3 className="font-bold text-base text-red-400 mb-1">
                          Acesso Recusado pelo Usuário
                        </h3>
                        <p className="text-xs text-slate-400 mb-4">
                          O colaborador recusou ou o tempo de 30 segundos expirou na estação de trabalho.
                        </p>
                      </>
                    ) : isWaitingConsent ? (
                      <>
                        <h3 className="font-bold text-base text-amber-300 mb-1">
                          Aguardando Permissão na Tela do Usuário...
                        </h3>
                        <p className="text-xs text-slate-400 mb-4">
                          Uma janela de confirmação apareceu na tela de <strong>{loggedUser}</strong> com contagem regressiva de 30 segundos.
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
                          Pronto para Acesso Remoto ({accessId})
                        </h3>
                        <p className="text-xs text-slate-400 mb-4">
                          Visualize a área de trabalho em tempo real e controle o mouse e teclado diretamente pelo navegador, sem precisar de AnyDesk.
                        </p>
                        <button
                          onClick={handleStartRemote}
                          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-lg transition-colors"
                        >
                          <Play className="w-4 h-4" />
                          Iniciar Acesso Remoto Agora
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Quick Text Input Bar for Remote Keyboard */}
              <form
                onSubmit={handleSendTextToRemote}
                className="flex items-center gap-2 px-4 py-2 bg-slate-900 border-t border-slate-800"
              >
                <Keyboard className="w-4 h-4 text-slate-400 shrink-0" />
                <input
                  type="text"
                  value={textToType}
                  onChange={(e) => setTextToType(e.target.value)}
                  placeholder="Digite um texto, senha ou comando aqui para enviar direto ao teclado remoto..."
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
                <button
                  type="submit"
                  disabled={!sessionId || !textToType.trim()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-bold text-xs"
                >
                  <Send className="w-3.5 h-3.5" />
                  Digitar Remotamente
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
              <div className="flex-1 bg-slate-900 border border-slate-800 rounded-xl p-4 font-mono text-xs text-slate-200 overflow-y-auto min-h-[260px] space-y-4">
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
                        <span>PS {hostname}&gt; {entry.command}</span>
                        <span className="text-slate-500">
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
                    onChange={(e) => setPsInput(e.target.value)}
                    placeholder="Ex: Get-Service | Where-Object {$_.Status -eq 'Running'} | Select -First 15"
                    className="flex-1 bg-transparent font-mono text-xs text-white placeholder-slate-500 focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!psInput.trim()}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-bold text-xs"
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
                        <th className="px-4 py-2.5">Estado</th>
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
                              {proc.responding !== false ? (
                                <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-semibold text-[11px]">
                                  Respondendo
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300 font-semibold text-[11px]">
                                  Não responde
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

          {/* TAB 4: ACOES, MENSAGENS NA TELA E WINGET */}
          {activeTab === 'actions' && (
            <div className="flex-1 p-4 md:p-6 grid grid-cols-1 lg:grid-cols-2 gap-5 bg-gray-50 dark:bg-slate-950">
              {/* Pop-up Message to User */}
              <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 space-y-3">
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
              <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 space-y-3">
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
                    Reiniciar Máquina (15s)
                  </button>
                  <button
                    onClick={() => handlePowerAction(REMOTE_COMMANDS.SHUTDOWN, 'Desligar Computador')}
                    className="flex items-center gap-2.5 p-3 rounded-xl bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300 font-bold text-xs transition-colors"
                  >
                    <Power className="w-4 h-4 shrink-0" />
                    Desligar Máquina (15s)
                  </button>
                </div>
              </div>

              {/* Silent Software Management (Winget) */}
              <div className="lg:col-span-2 p-5 rounded-2xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 space-y-4">
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
                      placeholder="Nome do software para remover (ex: AnyDesk)"
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
