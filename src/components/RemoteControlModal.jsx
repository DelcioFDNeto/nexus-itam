// src/components/RemoteControlModal.jsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpCircle,
  Camera,
  ChevronDown,
  ChevronUp,
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
  Move
} from 'lucide-react';
import { toast } from 'sonner';
import { useConfirm } from './ConfirmDialog';
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
} from '../services/rmmService';
import { processAgentInbox } from '../services/agentService';
import { microservicesApi } from '../services/microservicesClient';
import { AGENT_VERSION, isAgentOutdated } from '../utils/agentInventory';
import { can } from '../utils/permissions';
import {
  QUALITY_LABELS,
  SESSION_END_MESSAGES,
  WINGET_PRESETS,
} from '../utils/remoteControlConstants';
import {
  captureFocusTarget,
  getFocusableElements,
  restoreFocusSafely,
  trapFocusWithin,
} from '../utils/focusTrap';
import { isTopmostModal } from '../utils/modalStack';

const closeBitmapSafely = (bmp) => {
  if (bmp && typeof bmp.close === 'function') {
    try {
      bmp.close();
    } catch {
      /* noop */
    }
  }
};

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

  // Estado da Sessão Remota NexusDesk
  const [sessionMode, setSessionMode] = useState('attended');
  const [quality, setQuality] = useState('low'); // Padrão Turbo para fluidez móvel imediata
  const [sessionId, setSessionId] = useState('');
  const [lastSessionId, setLastSessionId] = useState('');
  const [policy, setPolicy] = useState(DEFAULT_RUNTIME_POLICY);
  const [connecting, setConnecting] = useState(false);
  const [controlEnabled, setControlEnabled] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [textToType, setTextToType] = useState('');
  const [relayFrame, setRelayFrame] = useState(null);
  const [streamFps, setStreamFps] = useState(0);
  const [transportMode, setTransportMode] = useState('ws-relay');
  const [latencyMs, setLatencyMs] = useState(18);

  // Controles Mobile & Touch UX (NexusDesk PWA Mobile AnyDesk-like)
  const [touchMode, setTouchMode] = useState('trackpad'); // 'trackpad' | 'direct'
  const [rightClickArmed, setRightClickArmed] = useState(false);
  const [dragLock, setDragLock] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [virtualCursor, setVirtualCursor] = useState({ x: 0.5, y: 0.5 });
  const [mobileKbOpen, setMobileKbOpen] = useState(false);
  const [updatingAgent, setUpdatingAgent] = useState(false);
  const [floatingToolbarOpen, setFloatingToolbarOpen] = useState(true);
  const [dismissLandscapeTip, setDismissLandscapeTip] = useState(false);
  const [isPortraitMobile, setIsPortraitMobile] = useState(false);

  // Terminal e Ordens Remotas
  const [psInput, setPsInput] = useState('');
  const [commandHistory, setCommandHistory] = useState([]);
  const [runningCmdId, setRunningCmdId] = useState('');
  const [runningCmdLabel, setRunningCmdLabel] = useState('');
  const [syncingInventory, setSyncingInventory] = useState(false);

  // Processos
  const [procFilter, setProcFilter] = useState('');

  // Mensagens e Softwares
  const [msgTitle, setMsgTitle] = useState('Aviso da Equipe de TI');
  const [msgBody, setMsgBody] = useState('');
  const [wingetPkg, setWingetPkg] = useState('');
  const [uninstallName, setUninstallName] = useState('');

  // Refs de Diálogo, Pipeline Canvas e Touch
  const dialogRef = useRef(null);
  const returnFocusRef = useRef(null);
  const wasOpenRef = useRef(false);
  const closeModalRef = useRef(null);
  const viewportRef = useRef(null);
  const canvasRef = useRef(null);
  const latestBitmapRef = useRef(null);
  const rafIdRef = useRef(null);
  const mobileKeyboardInputRef = useRef(null);
  
  const inputSeqRef = useRef(1);
  const inputQueueRef = useRef([]);
  const lastClearedAckRef = useRef(0);
  const flushTimerRef = useRef(null);
  const syncTimersRef = useRef([]);
  const lastProcessedCmdIdRef = useRef('');
  const lastMouseMoveAtRef = useRef(0);
  const sessionIdRef = useRef('');
  const qualityRef = useRef(quality);
  const wsClientRef = useRef(null);
  const frameTimestampsRef = useRef([]);
  const lastFrameSeqRef = useRef(0);
  const lastDecodedSeqRef = useRef(0);
  const pingStartRef = useRef(Date.now());

  const touchStateRef = useRef({
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    moved: false,
    pinchStartDist: 0,
    pinchStartZoom: 1,
    twoFingerStartScrollY: 0,
    longPressTimer: null,
  });

  const deviceKey =
    liveDevice?.deviceKey ||
    liveDevice?.device_key ||
    initialDevice?.deviceKey ||
    initialDevice?.device_key ||
    asset?.agentDeviceKey ||
    '';

  const operatorName = currentUser?.name || currentUser?.email || 'Gestor de TI';
  const hostLabel = liveDevice?.hostname || asset?.internalId || '';
  const effectiveMode = policy.remoteAccess === 'unattended' ? sessionMode : 'attended';

  const tenantIdRef = useRef(tenantId);
  const deviceKeyRef = useRef(deviceKey);
  const isOpenRef = useRef(isOpen);

  useEffect(() => {
    tenantIdRef.current = tenantId;
    deviceKeyRef.current = deviceKey;
    isOpenRef.current = isOpen;
  }, [tenantId, deviceKey, isOpen]);

  const setLatestBitmap = useCallback((nextBitmap = null) => {
    if (latestBitmapRef.current && latestBitmapRef.current !== nextBitmap) {
      closeBitmapSafely(latestBitmapRef.current);
    }
    latestBitmapRef.current = nextBitmap;
  }, []);

  const stopActiveSessionIfNeeded = useCallback(() => {
    const activeId = sessionIdRef.current;
    const activeTenantId = tenantIdRef.current;
    const activeDeviceKey = deviceKeyRef.current;
    if (!activeId || !activeTenantId || !activeDeviceKey) return;
    sessionIdRef.current = '';
    stopRemoteSession({ tenantId: activeTenantId, deviceKey: activeDeviceKey }).catch(() => {});
  }, []);

  // Detecção de orientação em smartphones
  useEffect(() => {
    const checkOrientation = () => {
      const isMobile = window.innerWidth < 768;
      const isPortrait = window.innerHeight > window.innerWidth;
      setIsPortraitMobile(isMobile && isPortrait);
    };
    checkOrientation();
    window.addEventListener('resize', checkOrientation);
    window.addEventListener('orientationchange', checkOrientation);
    return () => {
      window.removeEventListener('resize', checkOrientation);
      window.removeEventListener('orientationchange', checkOrientation);
    };
  }, []);

  // Sincroniza estado de tela cheia caso o usuário saia pelo gesto nativo ou tecla Esc
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    document.addEventListener('webkitfullscreenchange', handleFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFsChange);
      document.removeEventListener('webkitfullscreenchange', handleFsChange);
    };
  }, []);

  const clearSyncTimers = useCallback(() => {
    syncTimersRef.current.forEach((t) => clearTimeout(t));
    syncTimersRef.current = [];
  }, []);

  const incorporatePendingInventory = useCallback(
    async (targetCmdId = '', notifyWhenEmpty = false) => {
      if (!tenantId) return null;
      try {
        setSyncingInventory(true);
        const summary = await processAgentInbox({
          tenantId,
          user: currentUser?.email || operatorName,
        });
        if (summary?.processed > 0) {
          const itemInfo =
            summary.items?.find(
              (it) =>
                String(it.hostname || '').toUpperCase() === String(hostLabel || '').toUpperCase() ||
                String(it.internalId || '').toUpperCase() === String(hostLabel || '').toUpperCase(),
            ) || summary.items?.[0];
          const tagLabel = itemInfo?.internalId || hostLabel || 'Equipamento';
          const actionLabel = itemInfo?.action === 'created' ? 'cadastrado no patrimônio' : 'atualizado no patrimônio';
          const note = `\n[Inventário Incorporado] ${tagLabel} ${actionLabel} (${summary.created} novo(s), ${summary.updated} atualizado(s)).`;
          if (targetCmdId) {
            setCommandHistory((prev) =>
              prev.map((entry) =>
                entry.commandId === targetCmdId && !String(entry.output || '').includes('[Inventário Incorporado]')
                  ? { ...entry, output: `${entry.output || ''}${note}`.trim() }
                  : entry,
              ),
            );
          }
          toast.success(`Inventário de ${tagLabel} incorporado com sucesso na base de ativos!`);
          return summary;
        }
        if (notifyWhenEmpty) {
          toast.info('Nenhum envio pendente na fila de inventário neste momento.');
        }
      } catch (err) {
        console.warn('Falha ao incorporar fila do agente:', err);
      } finally {
        setSyncingInventory(false);
      }
      return null;
    },
    [tenantId, currentUser?.email, operatorName, hostLabel],
  );

  const scheduleInventoryIncorporation = useCallback(
    (cmdId = '') => {
      clearSyncTimers();
      incorporatePendingInventory(cmdId, false);
      [5_000, 14_000, 25_000, 38_000].forEach((delayMs) => {
        const timer = setTimeout(() => {
          incorporatePendingInventory(cmdId, false);
        }, delayMs);
        syncTimersRef.current.push(timer);
      });
    },
    [clearSyncTimers, incorporatePendingInventory],
  );

  useEffect(() => {
    setActiveTab(initialTab || 'screen');
  }, [initialTab, isOpen]);

  // Captura/restauração de foco, Escape seguro e focus trap dentro do diálogo
  useEffect(() => {
    if (!isOpen) return undefined;

    const dialogEl = dialogRef.current;
    if (!wasOpenRef.current) {
      wasOpenRef.current = true;
      returnFocusRef.current = captureFocusTarget(dialogEl);
    }

    if (dialogEl && !dialogEl.contains(document.activeElement)) {
      const focusables = getFocusableElements(dialogEl).filter((el) => el !== viewportRef.current);
      if (focusables.length > 0) {
        focusables[0].focus();
      } else {
        dialogEl.focus();
      }
    }

    return () => {
      if (wasOpenRef.current) {
        wasOpenRef.current = false;
        const target = returnFocusRef.current;
        returnFocusRef.current = null;
        restoreFocusSafely(target, null, dialogEl);
      }
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleDialogKeyDown = (e) => {
      const dialogEl = dialogRef.current;
      if (!dialogEl || !isTopmostModal(dialogEl)) return;

      const isLiveCanvasTarget =
        activeTab === 'screen' &&
        Boolean(sessionIdRef.current) &&
        controlEnabled &&
        (e.target === viewportRef.current ||
          e.target === canvasRef.current ||
          e.target === mobileKeyboardInputRef.current);

      if (e.key === 'Escape') {
        if (document.fullscreenElement || isLiveCanvasTarget) return;
        e.preventDefault();
        closeModalRef.current?.();
        return;
      }

      if (e.key === 'Tab') {
        if (isLiveCanvasTarget && document.fullscreenElement) return;
        trapFocusWithin(e, dialogEl);
      }
    };

    document.addEventListener('keydown', handleDialogKeyDown);
    return () => document.removeEventListener('keydown', handleDialogKeyDown);
  }, [isOpen, activeTab, controlEnabled]);

  useEffect(() => {
    setLiveDevice(initialDevice || null);
  }, [initialDevice]);

  useEffect(() => {
    if (!isOpen || !tenantId) return undefined;
    incorporatePendingInventory('', false);
    return () => clearSyncTimers();
  }, [isOpen, tenantId, incorporatePendingInventory, clearSyncTimers]);

  useEffect(() => {
    if (!isOpen || !tenantId || !deviceKey) return undefined;
    const unsub = subscribeAgentDevice(tenantId, deviceKey, (data) => {
      if (!data) return;
      setLiveDevice(data);
      const state = data.remoteState?.state;
      if (sessionIdRef.current && data.remoteState?.sessionId === sessionIdRef.current && SESSION_END_MESSAGES[state]) {
        toast.info(SESSION_END_MESSAGES[state]);
        sessionIdRef.current = '';
        setSessionId('');
        setLatestBitmap(null);
        lastDecodedSeqRef.current = 0;
        inputQueueRef.current = [];
        stopRemoteSession({ tenantId, deviceKey }).catch(() => {});
      }
    });
    return () => unsub();
  }, [isOpen, tenantId, deviceKey, setLatestBitmap]);

  useEffect(() => {
    qualityRef.current = quality;
  }, [quality]);

  // Limpa da fila eventos processados
  useEffect(() => {
    const ackSeq = Number(
      relayFrame?.remoteState?.lastInputSeq ||
      liveDevice?.remoteState?.lastInputSeq
    ) || 0;
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
        quality: qualityRef.current,
        user: currentUser,
      }).catch(() => {});
    }
  }, [
    liveDevice?.remoteState?.lastInputSeq,
    relayFrame?.remoteState?.lastInputSeq,
    sessionId,
    tenantId,
    deviceKey,
    effectiveMode,
    currentUser,
  ]);

  // Canal WebSocket de ultra baixa latência (NexusDesk Relay RFC 6455 na VPS)
  useEffect(() => {
    if (!isOpen || !tenantId || !deviceKey) return undefined;
    const wsClient = microservicesApi.openNexusDeskSocket(
      tenantId,
      (packet) => {
        if (!packet) return;
        if (packet.event === 'pong') {
          const now = Date.now();
          setLatencyMs(Math.max(5, now - pingStartRef.current));
          return;
        }
        const packetData = packet.data || packet;
        const packetDeviceKey = packet.deviceKey || packetData.deviceKey;
        if (packetDeviceKey && packetDeviceKey !== deviceKey) return;

        if (packet.event === 'remote.frame') {
          const incomingFrame = packetData.frame || packet.frame || packetData;
          const incomingSessionId = packetData.sessionId || packet.sessionId || incomingFrame?.sessionId;
          if (incomingFrame?.data) {
            if (sessionIdRef.current && (!incomingSessionId || incomingSessionId === sessionIdRef.current)) {
              setTransportMode('ws-relay');
              setRelayFrame({
                ...incomingFrame,
                remoteState: packetData.remoteState || packet.remoteState || null,
              });
            }
          }
        }
      },
      () => {},
    );
    wsClientRef.current = wsClient;
    return () => {
      wsClientRef.current = null;
      wsClient.close();
    };
  }, [isOpen, tenantId, deviceKey]);

  useEffect(() => {
    if (!isOpen || !tenantId) return undefined;
    return subscribeRuntimePolicy(tenantId, setPolicy);
  }, [isOpen, tenantId]);

  useEffect(() => {
    if (!isOpen || !tenantId || !deviceKey) return undefined;
    const wake = () => wakeAgentDevice({ tenantId, deviceKey }).catch(() => {});
    wake();
    const timer = setInterval(wake, 45_000);
    return () => clearInterval(timer);
  }, [isOpen, tenantId, deviceKey]);

  useEffect(() => {
    if (!sessionId || !tenantId || !deviceKey) return undefined;
    const ping = () => {
      pingStartRef.current = Date.now();
      pingRemoteViewer({ tenantId, deviceKey }).catch(() => {});
      wsClientRef.current?.pushRemoteControl({
        deviceKey,
        sessionId,
        status: 'active',
        quality: qualityRef.current,
        targetFps: 30,
      });
      wsClientRef.current?.ping?.();
    };
    ping();
    const timer = setInterval(ping, 6_000);
    return () => clearInterval(timer);
  }, [sessionId, tenantId, deviceKey]);

  useEffect(() => {
    const res = liveDevice?.lastCommandResult;
    if (!res?.commandId) return;
    setCommandHistory((prev) => {
      if (prev.some((item) => item.commandId === res.commandId)) return prev;
      return [res, ...prev].slice(0, 30);
    });
    const isNewCompletion = lastProcessedCmdIdRef.current !== res.commandId;
    if (isNewCompletion) {
      lastProcessedCmdIdRef.current = res.commandId;
      if (
        res.type === REMOTE_COMMANDS.FORCE_INVENTORY ||
        res.command === 'sync' ||
        /inventario/i.test(String(res.output || ''))
      ) {
        scheduleInventoryIncorporation(res.commandId);
      }
    }
    if (runningCmdId && res.commandId === runningCmdId) {
      setRunningCmdId('');
      setRunningCmdLabel('');
      if (Number(res.exitCode) && Number(res.exitCode) !== 0) {
        toast.error(res.output || 'O agente reportou falha ao executar o comando.');
      } else {
        toast.success(
          res.type === REMOTE_COMMANDS.FORCE_INVENTORY || res.command === 'sync'
            ? 'Coleta recebida pelo agente! Incorporando dados no inventário…'
            : 'Ordem executada com sucesso pelo computador remoto!',
        );
      }
    }
  }, [liveDevice?.lastCommandResult, runningCmdId, scheduleInventoryIncorporation]);

  // Limpa sessão ativa e timers apenas no fechamento do modal / unload / unmount
  useEffect(() => {
    if (!isOpen) return undefined;
    const touchState = touchStateRef.current;
    return () => {
      stopActiveSessionIfNeeded();
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      if (touchState.longPressTimer) {
        clearTimeout(touchState.longPressTimer);
        touchState.longPressTimer = null;
      }
      clearSyncTimers();
      setLatestBitmap(null);
      setSessionId('');
    };
  }, [isOpen, stopActiveSessionIfNeeded, clearSyncTimers, setLatestBitmap]);

  useEffect(() => {
    const handleUnload = () => {
      stopActiveSessionIfNeeded();
    };
    const touchState = touchStateRef.current;
    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('pagehide', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      window.removeEventListener('pagehide', handleUnload);
      stopActiveSessionIfNeeded();
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      if (touchState.longPressTimer) {
        clearTimeout(touchState.longPressTimer);
        touchState.longPressTimer = null;
      }
      clearSyncTimers();
      setLatestBitmap(null);
    };
  }, [stopActiveSessionIfNeeded, clearSyncTimers, setLatestBitmap]);

  const rawFirestoreFrame = liveDevice?.screenFrame || null;
  const validFirestoreFrame =
    rawFirestoreFrame && (!rawFirestoreFrame.sessionId || rawFirestoreFrame.sessionId === sessionId)
      ? rawFirestoreFrame
      : null;
  const validRelayFrame =
    relayFrame && (!relayFrame.sessionId || relayFrame.sessionId === sessionId)
      ? relayFrame
      : null;
  const latestCandidateFrame =
    (Number(validRelayFrame?.seq) || 0) >= (Number(validFirestoreFrame?.seq) || 0)
      ? (validRelayFrame || validFirestoreFrame)
      : validFirestoreFrame;
  const candidateFrameSeq = Number(latestCandidateFrame?.seq) || 0;
  const candidateFrameData = latestCandidateFrame?.data || '';

  // PIPELINE DE DECODIFICAÇÃO E RENDERIZAÇÃO EM CANVAS (30+ FPS com requestAnimationFrame e buffer duplo)
  useEffect(() => {
    if (!isOpen || !sessionId || !candidateFrameData) {
      setLatestBitmap(null);
      setStreamFps(0);
      frameTimestampsRef.current = [];
      lastFrameSeqRef.current = 0;
      lastDecodedSeqRef.current = 0;
      return undefined;
    }

    const seq = candidateFrameSeq;
    if (seq > 0 && lastFrameSeqRef.current === seq) return undefined;
    lastFrameSeqRef.current = seq;

    // Cálculo instantâneo e contínuo de FPS
    const now = performance.now();
    const recent = [...frameTimestampsRef.current.filter((t) => now - t <= 2000), now];
    frameTimestampsRef.current = recent;
    if (recent.length >= 2) {
      const elapsedSec = (recent[recent.length - 1] - recent[0]) / 1000;
      if (elapsedSec > 0.1) {
        const measuredFps = Number(((recent.length - 1) / elapsedSec).toFixed(1));
        setStreamFps(measuredFps);
      }
    } else {
      setStreamFps(30);
    }

    const rawData = String(candidateFrameData || '');
    let dataUri = rawData;
    if (!rawData.startsWith('data:')) {
      const isPng = rawData.startsWith('iVBORw0KGgo');
      dataUri = `data:${isPng ? 'image/png' : 'image/jpeg'};base64,${rawData}`;
    }

    let cancelled = false;
    const activeSessionId = sessionId;
    const currentSeq = seq;

    const loadFallbackImage = () => {
      if (cancelled || sessionIdRef.current !== activeSessionId) return;
      const img = new Image();
      img.onload = () => {
        if (cancelled || sessionIdRef.current !== activeSessionId) return;
        if (currentSeq === 0 || currentSeq >= lastDecodedSeqRef.current) {
          lastDecodedSeqRef.current = Math.max(lastDecodedSeqRef.current, currentSeq);
          setLatestBitmap(img);
        }
      };
      img.src = dataUri;
    };

    // Decodificação rápida via ImageBitmap ou fallback Image com controle estrito de ordem (anti-jitter)
    if (typeof createImageBitmap !== 'undefined' && typeof fetch !== 'undefined') {
      fetch(dataUri)
        .then((res) => res.blob())
        .then((blob) => createImageBitmap(blob))
        .then((bmp) => {
          if (
            cancelled ||
            sessionIdRef.current !== activeSessionId ||
            (currentSeq > 0 && currentSeq < lastDecodedSeqRef.current)
          ) {
            closeBitmapSafely(bmp);
            return;
          }
          lastDecodedSeqRef.current = Math.max(lastDecodedSeqRef.current, currentSeq);
          setLatestBitmap(bmp);
        })
        .catch(() => {
          loadFallbackImage();
        });
    } else {
      loadFallbackImage();
    }

    return () => {
      cancelled = true;
    };
  }, [isOpen, sessionId, candidateFrameSeq, candidateFrameData, setLatestBitmap]);

  // Loop requestAnimationFrame Contínuo no Canvas (Double-Buffer) apenas enquanto o modal está aberto
  useEffect(() => {
    if (!isOpen) {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      return undefined;
    }

    let running = true;

    const renderLoop = () => {
      if (!running) return;
      const canvas = canvasRef.current;
      const bitmap = latestBitmapRef.current;

      if (canvas && bitmap) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const w = bitmap.width || bitmap.naturalWidth || 1280;
          const h = bitmap.height || bitmap.naturalHeight || 720;
          if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
          }
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'medium';
          ctx.drawImage(bitmap, 0, 0, w, h);
        }
      }
      rafIdRef.current = requestAnimationFrame(renderLoop);
    };

    rafIdRef.current = requestAnimationFrame(renderLoop);
    return () => {
      running = false;
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [isOpen]);

  const queueInputEvent = useCallback((ev) => {
    if (!sessionId || !controlEnabled) return;
    const seq = inputSeqRef.current;
    inputSeqRef.current += 1;
    const eventWithSeq = { ...ev, seq };
    inputQueueRef.current = [...inputQueueRef.current.slice(-20), eventWithSeq];

    const currentQuality = qualityRef.current;
    wsClientRef.current?.pushRemoteControl({
      deviceKey,
      sessionId,
      status: 'active',
      mode: effectiveMode,
      quality: currentQuality,
      targetFps: 30,
      inputEvents: [eventWithSeq],
    });

    if (flushTimerRef.current) return;
    const delayMs = ev.type === 'mousemove' ? 33 : 10;
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      const batch = [...inputQueueRef.current];
      const latestQuality = qualityRef.current;
      microservicesApi
        .updateRemoteControlRelay({
          tenantId,
          deviceKey,
          sessionId,
          status: 'active',
          mode: effectiveMode,
          quality: latestQuality,
          targetFps: 30,
          inputEvents: batch,
        })
        .catch(() => {});
      sendRemoteInputEvents({
        tenantId,
        deviceKey,
        sessionId,
        mode: effectiveMode,
        quality: latestQuality,
        user: currentUser,
        events: batch,
      }).catch(() => {});
    }, delayMs);
  }, [sessionId, controlEnabled, deviceKey, effectiveMode, tenantId, currentUser]);

  const handleStartRemote = async () => {
    if (!deviceKey) {
      toast.error('Este ativo ainda não possui o Agente Nativo (NexusAgent.exe) vinculado.');
      return;
    }
    if (policy.remoteAccess === 'disabled') {
      toast.error('Acesso remoto desligado pela política da empresa.');
      return;
    }
    setConnecting(true);
    try {
      inputSeqRef.current = 1;
      inputQueueRef.current = [];
      lastClearedAckRef.current = 0;
      setRelayFrame(null);
      setLatestBitmap(null);
      setStreamFps(0);
      frameTimestampsRef.current = [];
      lastFrameSeqRef.current = 0;
      lastDecodedSeqRef.current = 0;
      const currentQuality = qualityRef.current;
      const newSessionId = await startRemoteSession({
        tenantId,
        deviceKey,
        hostname: hostLabel,
        mode: effectiveMode,
        quality: currentQuality,
        user: currentUser,
      });
      if (!isOpenRef.current) {
        stopRemoteSession({ tenantId, deviceKey, hostname: hostLabel, user: currentUser }).catch(() => {});
        return;
      }
      sessionIdRef.current = newSessionId;
      setSessionId(newSessionId);
      setLastSessionId(newSessionId);
      wsClientRef.current?.pushRemoteControl({
        deviceKey,
        sessionId: newSessionId,
        status: 'active',
        mode: effectiveMode,
        quality: currentQuality,
        targetFps: 30,
      });
      microservicesApi
        .updateRemoteControlRelay({
          tenantId,
          deviceKey,
          sessionId: newSessionId,
          status: 'active',
          mode: effectiveMode,
          quality: currentQuality,
          targetFps: 30,
        })
        .catch(() => {});
      toast.success(
        effectiveMode === 'attended'
          ? `Solicitação NexusDesk enviada! Aguardando o colaborador aceitar na tela…`
          : `Sessão NexusDesk iniciada! Streaming a 30+ FPS conectando…`
      );
    } catch (e) {
      toast.error(e?.message || 'Falha ao iniciar sessão NexusDesk.');
    } finally {
      setConnecting(false);
    }
  };

  const handleStopRemote = async () => {
    const activeId = sessionIdRef.current || sessionId;
    sessionIdRef.current = '';
    setSessionId('');
    setRelayFrame(null);
    setLatestBitmap(null);
    setStreamFps(0);
    frameTimestampsRef.current = [];
    lastFrameSeqRef.current = 0;
    lastDecodedSeqRef.current = 0;
    inputQueueRef.current = [];
    setZoom(1);
    setPan({ x: 0, y: 0 });
    if (activeId && tenantId && deviceKey) {
      wsClientRef.current?.pushRemoteControl({
        deviceKey,
        sessionId: activeId,
        status: 'closed',
      });
      microservicesApi
        .updateRemoteControlRelay({
          tenantId,
          deviceKey,
          sessionId: activeId,
          status: 'closed',
        })
        .catch(() => {});
      try {
        await stopRemoteSession({ tenantId, deviceKey, hostname: hostLabel, user: currentUser });
        toast.info('Sessão NexusDesk encerrada com sucesso.');
      } catch {
        // Ignora erro ao fechar
      }
    }
  };

  closeModalRef.current = async () => {
    await handleStopRemote();
    onClose();
  };

  const handleQualityChange = async (newQuality) => {
    qualityRef.current = newQuality;
    setQuality(newQuality);
    if (sessionId && tenantId && deviceKey) {
      wsClientRef.current?.pushRemoteControl({
        deviceKey,
        sessionId,
        status: 'active',
        mode: effectiveMode,
        quality: newQuality,
        targetFps: 30,
      });
      microservicesApi
        .updateRemoteControlRelay({
          tenantId,
          deviceKey,
          sessionId,
          status: 'active',
          mode: effectiveMode,
          quality: newQuality,
          targetFps: 30,
        })
        .catch(() => {});
      await updateRemoteQuality({
        tenantId,
        deviceKey,
        sessionId,
        mode: effectiveMode,
        quality: newQuality,
        user: currentUser,
        inputEvents: inputQueueRef.current,
      }).catch(() => {});
      toast.info(`Qualidade alterada para: ${QUALITY_LABELS[newQuality] || newQuality}`);
    }
  };

  // Cálculo de coordenadas relativas normalizadas (0.0 a 1.0)
  const getRelativeCoordsFromClient = (clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0.5, y: 0.5 };
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: 0.5, y: 0.5 };
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    return { x: Number(x.toFixed(4)), y: Number(y.toFixed(4)) };
  };

  // INTERAÇÕES TOUCH PARA SMARTPHONES & PWA MOBILE (AnyDesk-style)
  const handleTouchStart = (e) => {
    if (!sessionId) return;
    const ts = touchStateRef.current;
    if (ts.longPressTimer) {
      clearTimeout(ts.longPressTimer);
      ts.longPressTimer = null;
    }

    // Gesto de 2 dedos (Pinch-to-zoom ou Scroll com 2 dedos)
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      ts.pinchStartDist = Math.hypot(dx, dy);
      ts.pinchStartZoom = zoom;
      ts.twoFingerStartScrollY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      ts.moved = true;
      return;
    }

    // Toque com 1 dedo
    if (e.touches.length === 1) {
      const t = e.touches[0];
      ts.startX = t.clientX;
      ts.startY = t.clientY;
      ts.lastX = t.clientX;
      ts.lastY = t.clientY;
      ts.moved = false;

      // No modo toque direto, long-press aciona clique direito com vibração tátil
      if (controlEnabled && touchMode === 'direct') {
        const coords = getRelativeCoordsFromClient(t.clientX, t.clientY);
        ts.longPressTimer = setTimeout(() => {
          ts.moved = true;
          try { navigator?.vibrate?.(40); } catch { /* noop */ }
          queueInputEvent({ type: 'rightclick', ...coords });
          toast.info('Clique direito enviado (toque longo).');
        }, 450);
      }
    }
  };

  const handleTouchMove = (e) => {
    if (!sessionId) return;
    const ts = touchStateRef.current;

    // Gesto de 2 dedos (Pinch-to-zoom ou Scroll com 2 dedos)
    if (e.touches.length === 2) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const distChange = Math.abs(dist - ts.pinchStartDist);

      const currentScrollY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const scrollDiff = currentScrollY - ts.twoFingerStartScrollY;

      // Pinch to zoom tem prioridade quando a distância entre os dedos altera significativamente
      if (ts.pinchStartDist > 0 && distChange > 14) {
        const nextZoom = Math.max(1, Math.min(4, Number((ts.pinchStartZoom * (dist / ts.pinchStartDist)).toFixed(2))));
        setZoom(nextZoom);
        if (nextZoom === 1) setPan({ x: 0, y: 0 });
        return;
      }

      // Scroll de página (scroll wheel AnyDesk) quando a distância é mantida e ambos deslizam juntos
      if (Math.abs(scrollDiff) > 15 && controlEnabled) {
        ts.twoFingerStartScrollY = currentScrollY;
        const coords = touchMode === 'trackpad' ? virtualCursor : { x: 0.5, y: 0.5 };
        queueInputEvent({
          type: 'wheel',
          ...coords,
          deltaY: scrollDiff > 0 ? 120 : -120,
        });
        return;
      }
      return;
    }

    // Movimento com 1 dedo
    if (e.touches.length === 1) {
      const t = e.touches[0];
      const dx = t.clientX - ts.lastX;
      const dy = t.clientY - ts.lastY;

      if (Math.hypot(t.clientX - ts.startX, t.clientY - ts.startY) > 6) {
        ts.moved = true;
        if (ts.longPressTimer) {
          clearTimeout(ts.longPressTimer);
          ts.longPressTimer = null;
        }
      }
      ts.lastX = t.clientX;
      ts.lastY = t.clientY;

      // Modo Trackpad Virtual (AnyDesk mobile)
      if (touchMode === 'trackpad' && controlEnabled) {
        e.preventDefault();
        setVirtualCursor((prev) => {
          // Aceleração suave de cursor adaptada para tela mobile
          const sensitivity = 220;
          const next = {
            x: Number(Math.max(0, Math.min(1, prev.x + dx / sensitivity)).toFixed(4)),
            y: Number(Math.max(0, Math.min(1, prev.y + dy / sensitivity)).toFixed(4)),
          };
          const now = Date.now();
          if (now - lastMouseMoveAtRef.current >= 45) {
            lastMouseMoveAtRef.current = now;
            queueInputEvent({
              type: dragLock ? 'mousedrag' : 'mousemove',
              ...next
            });
          }
          return next;
        });
      } else if (zoom > 1) {
        // Panning em tela aproximada
        e.preventDefault();
        setPan((prev) => ({
          x: Math.max(-450, Math.min(450, prev.x + dx)),
          y: Math.max(-350, Math.min(350, prev.y + dy)),
        }));
      }
    }
  };

  const handleTouchEnd = (e) => {
    const ts = touchStateRef.current;
    if (ts.longPressTimer) {
      clearTimeout(ts.longPressTimer);
      ts.longPressTimer = null;
    }

    // Se ainda restar 1 dedo na tela após gesto de pinça, reancora as coordenadas para evitar saltos do cursor
    if (e.touches && e.touches.length === 1) {
      const remaining = e.touches[0];
      ts.lastX = remaining.clientX;
      ts.lastY = remaining.clientY;
      ts.startX = remaining.clientX;
      ts.startY = remaining.clientY;
      ts.moved = true; // evita disparo falso de tap
      ts.pinchStartDist = 0;
      return;
    }

    // Se foi apenas um toque rápido (tap) sem arrasto:
    if (!ts.moved && sessionId && controlEnabled) {
      if (touchMode === 'trackpad') {
        // No modo trackpad, toque leve = clique esquerdo onde está o cursor virtual
        if (rightClickArmed) {
          queueInputEvent({ type: 'rightclick', ...virtualCursor });
          setRightClickArmed(false);
          toast.info('Clique direito enviado.');
        } else {
          queueInputEvent({ type: 'click', ...virtualCursor });
        }
      } else if (touchMode === 'direct' && e.changedTouches?.[0]) {
        // No modo toque direto, clica nas coordenadas do toque
        const t = e.changedTouches[0];
        const coords = getRelativeCoordsFromClient(t.clientX, t.clientY);
        if (rightClickArmed) {
          queueInputEvent({ type: 'rightclick', ...coords });
          setRightClickArmed(false);
          toast.info('Clique direito enviado.');
        } else {
          queueInputEvent({ type: 'click', ...coords });
        }
      }
    }

    ts.pinchStartDist = 0;
  };

  // Cliques via Mouse Convencional
  const handleCanvasClick = (e) => {
    if (!sessionId || !controlEnabled) return;
    const coords = touchMode === 'trackpad' ? virtualCursor : getRelativeCoordsFromClient(e.clientX, e.clientY);
    if (rightClickArmed) {
      queueInputEvent({ type: 'rightclick', ...coords });
      setRightClickArmed(false);
      toast.info('Clique direito enviado.');
      return;
    }
    queueInputEvent({ type: 'click', ...coords });
  };

  const handleCanvasDoubleClick = (e) => {
    if (!sessionId || !controlEnabled) return;
    const coords = touchMode === 'trackpad' ? virtualCursor : getRelativeCoordsFromClient(e.clientX, e.clientY);
    queueInputEvent({ type: 'dblclick', ...coords });
  };

  const handleCanvasContextMenu = (e) => {
    e.preventDefault();
    if (!sessionId || !controlEnabled) return;
    const coords = touchMode === 'trackpad' ? virtualCursor : getRelativeCoordsFromClient(e.clientX, e.clientY);
    queueInputEvent({ type: 'rightclick', ...coords });
  };

  const handleCanvasMouseMove = (e) => {
    if (!sessionId || !controlEnabled || touchMode === 'trackpad') return;
    const now = Date.now();
    if (now - lastMouseMoveAtRef.current < 50) return;
    lastMouseMoveAtRef.current = now;
    const coords = getRelativeCoordsFromClient(e.clientX, e.clientY);
    setVirtualCursor(coords);
    queueInputEvent({ type: 'mousemove', ...coords });
  };

  const handleCanvasWheel = (e) => {
    if (!sessionId || !controlEnabled) return;
    const coords = getRelativeCoordsFromClient(e.clientX, e.clientY);
    queueInputEvent({
      type: 'wheel',
      ...coords,
      deltaY: e.deltaY > 0 ? -120 : 120,
    });
  };

  const handleScreenKeyDown = (e) => {
    if (!sessionId || !controlEnabled) return;
    const target = e.target;
    if (
      target &&
      target !== viewportRef.current &&
      target !== canvasRef.current
    ) {
      if (['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      const interactiveAncestor = target.closest?.(
        'button, a[href], input, textarea, select, [role="button"], [tabindex]:not([tabindex="-1"])',
      );
      if (interactiveAncestor && interactiveAncestor !== viewportRef.current) return;
    }
    if (e.key === 'Tab' && !document.fullscreenElement) return;
    e.preventDefault();
    queueInputEvent({ type: 'key', key: e.key });
  };

  const handleSendSpecialKey = (keyCombo) => {
    if (!sessionId) {
      toast.warning('Inicie a sessão NexusDesk para enviar atalhos.');
      return;
    }
    queueInputEvent({ type: 'key', key: keyCombo });
    toast.success(`Atalho ${keyCombo} despachado.`);
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
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement('a');
    a.download = `nexusdesk-${hostLabel || 'remoto'}-${Date.now()}.jpg`;
    a.href = canvas.toDataURL('image/jpeg', 0.92);
    a.click();
  };

  const toggleFullscreen = () => {
    const el = viewportRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().then(() => {
        setIsFullscreen(true);
        // Sugere trava horizontal em mobile
        try {
          if (window.screen?.orientation?.lock) {
            window.screen.orientation.lock('landscape').catch(() => {});
          }
        } catch { /* noop */ }
      }).catch(() => {});
    } else {
      document.exitFullscreen?.().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  const handleCycleZoom = () => {
    const steps = [1, 1.5, 2, 2.5, 3];
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
      toast.error('Comandos remotos desligados pela política da empresa.');
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
      setRunningCmdLabel(title || `${type}: ${String(command).slice(0, 80)}`);
      if (type === REMOTE_COMMANDS.FORCE_INVENTORY) {
        scheduleInventoryIncorporation(sent.id);
        toast.success(`Coleta forçada em ${hostLabel}! Dados serão incorporados.`);
      } else {
        toast.success(`Ordem despachada para ${hostLabel}.`);
      }
    } catch (e) {
      toast.error(e?.message || 'Erro ao enviar comando remoto.');
    }
  };

  const handleUpdateAgentRemote = async () => {
    if (!deviceKey) return;
    const ok = await confirm({
      title: `Atualizar Agente em ${hostLabel} para v${AGENT_VERSION}?`,
      message: `O notebook baixará a compilação NexusAgent v${AGENT_VERSION} com suporte a streaming 30+ FPS e reconectará automaticamente.`,
      confirmLabel: `Atualizar OTA para v${AGENT_VERSION}`,
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
      setRunningCmdLabel(`Atualização OTA NexusAgent v${AGENT_VERSION}`);
      toast.success(`Ordem de atualização v${AGENT_VERSION} enviada!`);
    } catch (e) {
      toast.error(e?.message || 'Erro ao enviar atualização.');
    } finally {
      setUpdatingAgent(false);
    }
  };

  const handleRunPowerShell = async (e) => {
    e?.preventDefault();
    if (!psInput.trim()) return;
    const cmd = psInput.trim();
    setPsInput('');
    if (cmd.toLowerCase() === 'sync') {
      await handleSendCommand(REMOTE_COMMANDS.FORCE_INVENTORY, 'sync', 'Sincronização Completa de Inventário');
      return;
    }
    await handleSendCommand(REMOTE_COMMANDS.POWERSHELL, cmd);
  };

  const handleKillProcess = async (proc) => {
    const ok = await confirm({
      title: `Finalizar processo ${proc.name}?`,
      message: `O processo "${proc.name}" (PID ${proc.pid}, ${proc.memoryMb} MB) será encerrado na estação remota.`,
      danger: true,
      confirmLabel: 'Finalizar Processo',
    });
    if (!ok) return;
    await handleSendCommand(REMOTE_COMMANDS.KILL_PROCESS, String(proc.pid), `Finalizar ${proc.name} (PID ${proc.pid})`);
  };

  const handlePowerAction = async (actionType, label) => {
    const ok = await confirm({
      title: `${label} (${hostLabel})?`,
      message: `Tem certeza que deseja executar "${label}" remotamente na estação de trabalho?`,
      danger: actionType !== REMOTE_COMMANDS.LOCK_SCREEN,
      confirmLabel: label,
    });
    if (!ok) return;
    await handleSendCommand(actionType, label, label);
  };

  const handleRevoke = async () => {
    const ok = await confirm({
      title: `Revogar agente de ${hostLabel}?`,
      message: 'O computador perderá imediatamente a matrícula e o acesso remoto.',
      danger: true,
      confirmLabel: 'Revogar agente',
    });
    if (!ok) return;
    try {
      await handleStopRemote();
      const removed = await revokeAgentDevice({ tenantId, deviceKey, hostname: hostLabel, user: currentUser });
      toast.success(removed ? 'Agente revogado com sucesso.' : 'Máquina já estava revogada.');
    } catch (e) {
      toast.error(e?.message || 'Erro ao revogar.');
    }
  };

  const handleResolveSupport = async () => {
    try {
      await resolveSupportRequest({ tenantId, deviceKey, resolvedBy: operatorName });
      toast.success('Chamado de suporte técnico marcado como resolvido!');
    } catch {
      toast.error('Não foi possível atualizar o chamado.');
    }
  };

  if (!isOpen) return null;

  const online = isDeviceOnline(liveDevice);
  const accessId = formatAccessId(liveDevice || deviceKey || asset?.internalId);
  const hostname = liveDevice?.hostname || asset?.hostname || asset?.internalId || 'Notebook';
  const patrimony = liveDevice?.internalId || asset?.internalId || hostname;
  const loggedUser = liveDevice?.loggedUser || asset?.assignedTo || 'Colaborador';
  const currentAgentVer = liveDevice?.agentVersion || asset?.agent?.version || '';
  const agentOutdated = isAgentOutdated(currentAgentVer);
  const metrics = liveDevice?.metrics || {};
  const topProcesses = Array.isArray(liveDevice?.topProcesses) ? liveDevice.topProcesses : [];

  const remoteState = relayFrame?.remoteState || liveDevice?.remoteState || {};
  const ownState = sessionId && remoteState.sessionId === sessionId ? remoteState.state : '';
  const isSessionActive = ownState === 'active' || Boolean(sessionId && latestCandidateFrame?.data);
  const isWaitingConsent = ownState === 'awaiting_consent';
  const isWaitingAgent = Boolean(sessionId) && !ownState && !latestCandidateFrame?.data;
  const endedState = !sessionId && lastSessionId && remoteState.sessionId === lastSessionId ? remoteState.state : '';
  const isAdmin = can(currentUser, 'agent:manage');

  const filteredProcesses = topProcesses.filter((p) =>
    !procFilter.trim() ||
    String(p.name || '').toLowerCase().includes(procFilter.trim().toLowerCase()) ||
    String(p.pid || '').includes(procFilter.trim())
  );

  return (
    <div className="dark fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-0 md:p-3 overflow-hidden overscroll-contain">
      
      {/* Container Principal */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="remote-control-modal-title"
        tabIndex={-1}
        className="bg-[#111113] border-0 md:border border-zinc-800 rounded-none md:rounded-2xl shadow-2xl w-full max-w-7xl h-[100dvh] md:h-[94vh] flex flex-col overflow-hidden text-[#fafafa] overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        
        {/* Top Bar Responsiva */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 md:px-5 py-2.5 bg-[#09090b] border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={`w-9 h-9 md:w-10 md:h-10 rounded-xl flex items-center justify-center font-black text-sm shrink-0 ${
              online ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
            }`}>
              <Monitor className="w-4 h-4 md:w-5 md:h-5" />
            </div>
            
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 md:gap-2 flex-wrap">
                <h2
                  id="remote-control-modal-title"
                  className="font-black text-sm md:text-base tracking-tight truncate text-[#fafafa]"
                >
                  {patrimony}
                </h2>
                <span className="px-2 py-0.5 rounded-md bg-brand/15 border border-brand/30 text-brand-aa font-mono text-xs font-bold tabular-nums">
                  ID {accessId}
                </span>
                {agentOutdated && (
                  <span className="px-2 py-0.5 rounded-md font-mono text-xs font-bold tabular-nums bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    OTA v{AGENT_VERSION}
                  </span>
                )}
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                  online ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                  {online ? 'Online' : 'Standby'}
                </span>
                {streamFps > 0 && isSessionActive && (
                  <span className={`px-2 py-0.5 rounded-full font-mono text-xs font-bold tabular-nums border ${
                    streamFps >= 28
                      ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                      : streamFps >= 18
                      ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                      : 'bg-cyan-500/15 border-cyan-500/30 text-cyan-300'
                  }`}>
                    {streamFps} FPS • {latencyMs}ms
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-400 truncate">
                Colaborador: <span className="text-zinc-200 font-semibold">{loggedUser}</span> • Host:{' '}
                <span className="font-mono text-zinc-300">{hostname}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 md:gap-2 ml-auto">
            {liveDevice?.supportRequest?.status === 'open' && (
              <button
                type="button"
                onClick={handleResolveSupport}
                className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Resolver Chamado</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => closeModalRef.current?.()}
              aria-label="Fechar NexusDesk"
              title="Fechar NexusDesk"
              className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center p-2 rounded-xl text-zinc-400 hover:text-[#fafafa] hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Banner de Rotação Automática / Dica Mobile Landscape */}
        {isPortraitMobile && !dismissLandscapeTip && isSessionActive && (
          <div className="px-3 py-2 bg-brand/10 border-b border-brand/30 text-xs flex items-center justify-between gap-2 shrink-0 animate-slide-down">
            <div className="flex items-center gap-2 text-zinc-200 text-xs">
              <Smartphone className="w-4 h-4 text-brand-aa rotate-90 shrink-0" />
              <span>
                <strong>Dica:</strong> Gire o smartphone na <strong>horizontal</strong> para tela cheia fluída a 30+ FPS.
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={toggleFullscreen}
                className="px-3 py-2 min-h-[44px] rounded-lg bg-brand hover:bg-brand-dark text-brand-fg font-bold text-xs transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                Tela Cheia
              </button>
              <button
                type="button"
                onClick={() => setDismissLandscapeTip(true)}
                aria-label="Dispensar dica de orientação"
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-zinc-400 hover:text-[#fafafa] transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        )}

        {/* Abas de Navegação */}
        <div
          role="tablist"
          aria-label="Seções do NexusDesk"
          className="flex items-center gap-1 px-3 md:px-5 pt-1.5 bg-[#09090b] border-b border-zinc-800 overflow-x-auto no-scrollbar shrink-0"
        >
          {[
            { id: 'screen', label: 'NexusDesk Mobile (Tela 30+ FPS)', shortLabel: 'Tela Remota', icon: Monitor },
            { id: 'terminal', label: 'Terminal PowerShell', shortLabel: 'PowerShell', icon: Terminal },
            { id: 'processes', label: `Processos (${topProcesses.length})`, shortLabel: `Processos`, icon: Activity },
            { id: 'actions', label: 'Ações, OTA & Energia', shortLabel: 'Ações', icon: Zap },
          ].map((tab, idx, allTabs) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                id={`remote-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`remote-tabpanel-${tab.id}`}
                tabIndex={active ? 0 : -1}
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={(e) => {
                  const keyMap = {
                    ArrowRight: (idx + 1) % allTabs.length,
                    ArrowLeft: (idx - 1 + allTabs.length) % allTabs.length,
                    Home: 0,
                    End: allTabs.length - 1,
                  };
                  if (keyMap[e.key] === undefined) return;
                  e.preventDefault();
                  const nextTab = allTabs[keyMap[e.key]];
                  setActiveTab(nextTab.id);
                  document.getElementById(`remote-tab-${nextTab.id}`)?.focus();
                }}
                className={`inline-flex items-center gap-1.5 px-3 md:px-4 py-2 min-h-[44px] text-xs font-bold border-b-2 transition-colors whitespace-nowrap active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                  active
                    ? 'border-brand text-brand-aa bg-zinc-900/90 rounded-t-xl'
                    : 'border-transparent text-zinc-400 hover:text-[#fafafa]'
                }`}
              >
                <Icon className="w-3.5 h-3.5 md:w-4 md:h-4" />
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden">{tab.shortLabel}</span>
              </button>
            );
          })}
        </div>

        {/* Conteúdo da Aba */}
        <div className="flex-1 overflow-y-auto overscroll-contain flex flex-col min-h-0 relative bg-[#09090b]">
          
          {/* TAB 1: TELA REMOTA INTERATIVA NEXUSDESK COM RENDERIZAÇÃO EM CANVAS (30+ FPS) */}
          {activeTab === 'screen' && (
            <div
              id="remote-tabpanel-screen"
              role="tabpanel"
              aria-labelledby="remote-tab-screen"
              className="flex-1 flex flex-col bg-[#09090b] overflow-hidden min-h-0 relative"
            >
              
              {/* Input Invisível para o Teclado Nativo do Smartphone */}
              <input
                ref={mobileKeyboardInputRef}
                type="text"
                tabIndex={-1}
                inputMode="text"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                aria-label="Teclado remoto mobile"
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
                  if (['Backspace', 'Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                    e.preventDefault();
                    queueInputEvent({ type: 'key', key: e.key });
                  }
                }}
                onBlur={() => setMobileKbOpen(false)}
              />

              {/* Barra de Ferramentas Superior do NexusDesk (Desktop & Mobile) */}
              <div className="flex flex-wrap items-center justify-between gap-1.5 px-3 py-2 bg-[#111113] border-b border-zinc-800 text-xs shrink-0 z-20">
                <div className="flex flex-wrap items-center gap-1.5">
                  {!sessionId ? (
                    <>
                      <label htmlFor="remote-session-mode" className="sr-only">
                        Modo da sessão remota
                      </label>
                      <select
                        id="remote-session-mode"
                        name="sessionMode"
                        value={effectiveMode}
                        onChange={(e) => setSessionMode(e.target.value)}
                        className="px-2.5 py-2 min-h-[44px] rounded-lg bg-zinc-800 border border-zinc-700 text-[#fafafa] font-semibold text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                      >
                        <option value="attended">Com permissão (30 s)</option>
                        <option value="unattended" disabled={policy.remoteAccess !== 'unattended'}>
                          Sem supervisão{policy.remoteAccess !== 'unattended' ? ' (bloqueado)' : ''}
                        </option>
                      </select>
                      
                      <button
                        type="button"
                        onClick={handleStartRemote}
                        disabled={connecting}
                        className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[44px] rounded-lg bg-brand hover:bg-brand-dark disabled:opacity-50 disabled:cursor-not-allowed text-brand-fg font-bold shadow-md shadow-brand/25 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        {connecting ? 'Conectando…' : 'Conectar NexusDesk'}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={handleStopRemote}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                    >
                      <Square className="w-3.5 h-3.5 fill-current" />
                      Encerrar
                    </button>
                  )}

                  {/* Seletor de Qualidade / FPS Turbo */}
                  <label htmlFor="remote-stream-quality" className="sr-only">
                    Modo de Transmissão
                  </label>
                  <select
                    id="remote-stream-quality"
                    name="quality"
                    value={quality}
                    onChange={(e) => handleQualityChange(e.target.value)}
                    className="px-2.5 py-2 min-h-[44px] rounded-lg bg-zinc-800 border border-zinc-700 text-[#fafafa] text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    title="Modo de Transmissão"
                  >
                    <option value="low">Turbo 30+ FPS (Fluído)</option>
                    <option value="balanced">Padrão Equilibrado</option>
                    <option value="high">Alta Definição (HD)</option>
                  </select>

                  {/* Alternador de Controle Ativo */}
                  <button
                    type="button"
                    aria-pressed={controlEnabled}
                    onClick={() => setControlEnabled(v => !v)}
                    className={`inline-flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-lg border text-xs font-semibold transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                      controlEnabled
                        ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                        : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:text-[#fafafa]'
                    }`}
                    title="Ativar/Desativar controle"
                  >
                    <MousePointer className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">{controlEnabled ? 'Controle' : 'Visualizar'}</span>
                  </button>

                  {/* Alternador de Modo Touch: Trackpad Virtual vs Toque Direto */}
                  <button
                    type="button"
                    aria-pressed={touchMode === 'trackpad'}
                    onClick={() => setTouchMode(m => (m === 'trackpad' ? 'direct' : 'trackpad'))}
                    className={`inline-flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-lg border text-xs font-semibold transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                      touchMode === 'trackpad'
                        ? 'bg-sky-500/20 border-sky-400/50 text-sky-200'
                        : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:text-[#fafafa]'
                    }`}
                    title="Alternar entre Trackpad Virtual e Toque Direto"
                  >
                    <Hand className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">
                      {touchMode === 'trackpad' ? 'Modo Trackpad' : 'Toque Direto'}
                    </span>
                    <span className="sm:hidden">
                      {touchMode === 'trackpad' ? 'Trackpad' : 'Direto'}
                    </span>
                  </button>

                  {/* Armar Clique Direito */}
                  <button
                    type="button"
                    aria-pressed={rightClickArmed}
                    onClick={() => setRightClickArmed(v => !v)}
                    className={`inline-flex items-center gap-1 px-3 py-2 min-h-[44px] rounded-lg border text-xs font-semibold transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                      rightClickArmed
                        ? 'bg-amber-500/25 border-amber-400/50 text-amber-200'
                        : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:text-[#fafafa]'
                    }`}
                    title="Armar Clique Direito para o próximo toque"
                  >
                    Botão Dir.
                  </button>

                  {/* Zoom Rápido */}
                  <button
                    type="button"
                    onClick={handleCycleZoom}
                    className="inline-flex items-center gap-1 px-3 py-2 min-h-[44px] rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-xs font-mono tabular-nums transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    title="Zoom na tela remota (ou use pinça de 2 dedos no celular)"
                  >
                    {zoom > 1 ? <ZoomOut className="w-3.5 h-3.5 text-brand-aa" /> : <ZoomIn className="w-3.5 h-3.5" />}
                    {zoom}x
                  </button>

                  {/* Teclado Mobile */}
                  <button
                    type="button"
                    aria-pressed={mobileKbOpen}
                    onClick={toggleMobileKeyboard}
                    disabled={!sessionId}
                    className={`inline-flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-lg border text-xs font-semibold transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-40 disabled:cursor-not-allowed ${
                      mobileKbOpen
                        ? 'bg-brand border-brand text-brand-fg'
                        : 'bg-zinc-800 border-zinc-700 text-zinc-200 hover:bg-zinc-700'
                    }`}
                    title="Abrir teclado do celular"
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                    Teclado
                  </button>
                </div>

                {/* Atalhos de Sistema do Windows */}
                <div className="flex items-center gap-1 overflow-x-auto no-scrollbar max-w-full py-0.5">
                  {[
                    { key: 'Ctrl+Alt+Del', label: 'Ctrl+Alt+Del' },
                    { key: 'Alt+Tab', label: 'Alt+Tab' },
                    { key: 'Win', label: 'Win' },
                    { key: 'Win+D', label: 'Desktop' },
                    { key: 'Win+R', label: 'Executar' },
                    { key: 'Escape', label: 'Esc' },
                    { key: 'Tab', label: 'Tab' },
                    { key: 'Enter', label: 'Enter' },
                  ].map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => handleSendSpecialKey(item.key)}
                      className="px-2.5 py-2 min-h-[44px] rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-mono text-xs shrink-0 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    >
                      {item.label}
                    </button>
                  ))}

                  {isSessionActive && (
                    <button
                      type="button"
                      onClick={handleDownloadScreenshot}
                      aria-label="Captura de Tela"
                      className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-2.5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs shrink-0 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                      title="Captura de Tela"
                    >
                      <Camera className="w-4 h-4" aria-hidden="true" />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={toggleFullscreen}
                    aria-label={isFullscreen ? 'Sair da tela cheia' : 'Alternar Tela Cheia'}
                    className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 shrink-0 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    title="Alternar Tela Cheia"
                  >
                    {isFullscreen ? <Minimize2 className="w-4 h-4" aria-hidden="true" /> : <Maximize2 className="w-4 h-4" aria-hidden="true" />}
                  </button>
                </div>
              </div>

              {/* ÁREA DO CANVAS DE RENDERIZAÇÃO DE ALTA VELOCIDADE */}
              <div
                ref={viewportRef}
                tabIndex={0}
                aria-label="Tela remota interativa"
                onKeyDown={handleScreenKeyDown}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                className="flex-1 flex items-center justify-center relative bg-[#09090b] overflow-hidden select-none outline-none p-1 md:p-2 touch-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
              >
                {isSessionActive ? (
                  <div
                    className="relative inline-block max-w-full max-h-full shadow-2xl border border-zinc-800 rounded-xl overflow-hidden transition-transform duration-75"
                    style={{
                      transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                      transformOrigin: 'center center',
                    }}
                  >
                    {/* Elemento Canvas com Renderização via Double-Buffer / rAF */}
                    <canvas
                      ref={canvasRef}
                      width={1280}
                      height={720}
                      onClick={handleCanvasClick}
                      onDoubleClick={handleCanvasDoubleClick}
                      onContextMenu={handleCanvasContextMenu}
                      onMouseMove={handleCanvasMouseMove}
                      onWheel={handleCanvasWheel}
                      className={`max-w-full max-h-[72dvh] md:max-h-[74vh] object-contain block ${
                        controlEnabled ? 'cursor-crosshair' : 'cursor-default'
                      }`}
                    />

                    {/* Cursor Virtual NexusDesk para Modo Trackpad Mobile */}
                    {touchMode === 'trackpad' && controlEnabled && (
                      <div
                        className="absolute w-5 h-5 -ml-2.5 -mt-2.5 rounded-full border-2 border-white bg-brand/90 shadow-2xl pointer-events-none flex items-center justify-center"
                        style={{
                          left: `${virtualCursor.x * 100}%`,
                          top: `${virtualCursor.y * 100}%`,
                        }}
                      >
                        <div className="w-1.5 h-1.5 rounded-full bg-white" />
                      </div>
                    )}

                    {/* HUD de Desempenho e Telemetria em Tempo Real */}
                    <div className="absolute top-2 right-2 px-2.5 py-1 rounded-lg bg-[#09090b]/90 backdrop-blur-md border border-zinc-800 text-xs font-mono tabular-nums text-zinc-200 flex items-center gap-2 pointer-events-none shadow-xl">
                      <span className="w-2 h-2 rounded-full bg-cyan-400" />
                      <span className="font-bold text-[#fafafa]">
                        {canvasRef.current ? `${canvasRef.current.width}×${canvasRef.current.height}` : '1280×720'}
                      </span>
                      <span className="text-emerald-300 font-bold">
                        {streamFps > 0 ? `${streamFps} FPS` : '30+ FPS'}
                      </span>
                      <span className="text-cyan-300">
                        {latencyMs}ms
                      </span>
                      <span className="px-1.5 py-0.5 rounded font-sans font-bold bg-brand/20 text-brand-aa">
                        {transportMode === 'ws-relay' ? 'Turbo WS' : 'Seguro'}
                      </span>
                    </div>
                  </div>
                ) : (
                  
                  /* Tela de Espera / Início da Sessão Remota */
                  <div className="max-w-md text-center p-6 rounded-2xl bg-[#111113] border border-zinc-800 shadow-2xl mx-3">
                    <div className="w-16 h-16 rounded-2xl bg-brand/15 border border-brand/30 text-brand-aa flex items-center justify-center mx-auto mb-4">
                      <Monitor className="w-8 h-8" />
                    </div>

                    {SESSION_END_MESSAGES[endedState] ? (
                      <>
                        <h3 className={`font-bold text-base mb-1 ${
                          endedState === 'rejected' ? 'text-rose-400' : 'text-zinc-200'
                        }`}>
                          {endedState === 'rejected' ? 'Acesso Recusado' : 'Sessão Encerrada'}
                        </h3>
                        <p className="text-xs text-zinc-400 mb-4">{SESSION_END_MESSAGES[endedState]}</p>
                      </>
                    ) : isWaitingAgent ? (
                      <>
                        <RefreshCw className="w-6 h-6 text-brand-aa animate-spin mx-auto mb-2" />
                        <h3 className="font-bold text-base text-[#fafafa] mb-1">Conectando via NexusDesk Relay…</h3>
                        <p className="text-xs text-zinc-400">
                          Sinalizando o notebook de {loggedUser} via WebSocket de baixa latência…
                        </p>
                      </>
                    ) : isWaitingConsent ? (
                      <>
                        <div className="inline-flex p-2 rounded-xl bg-amber-500/20 text-amber-300 mb-2">
                          <AlertTriangle className="w-6 h-6" />
                        </div>
                        <h3 className="font-bold text-base text-amber-300 mb-1">
                          Aguardando Autorização na Tela do Colaborador…
                        </h3>
                        <p className="text-xs text-zinc-400 mb-4">
                          Uma janela de consentimento do <strong>NexusDesk</strong> foi exibida na tela de <strong>{loggedUser}</strong> com contagem regressiva de 30 segundos.
                        </p>
                      </>
                    ) : (
                      <>
                        <h3 className="font-bold text-lg text-[#fafafa] mb-1 tabular-nums">
                          NexusDesk Pronto ({accessId})
                        </h3>
                        <p className="text-xs text-zinc-400 mb-5 leading-relaxed">
                          Controle remoto corporativo a <strong>30+ FPS</strong> otimizado para celulares e computadores com buffer duplo e aceleração gráfica.
                        </p>
                        
                        <button
                          type="button"
                          onClick={handleStartRemote}
                          disabled={connecting}
                          className="inline-flex items-center gap-2 px-6 py-3 min-h-[44px] rounded-xl bg-brand hover:bg-brand-dark text-brand-fg font-bold text-xs shadow-lg shadow-brand/25 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Play className="w-4 h-4 fill-current" />
                          Iniciar Controle Remoto Agora
                        </button>
                      </>
                    )}
                  </div>
                )}

                {/* DOCK FLUTUANTE DE CONTROLES TOUCH MOBILE (Para uso ágil em smartphones) */}
                {isSessionActive && (
                  <div
                    onTouchStart={(e) => e.stopPropagation()}
                    onTouchMove={(e) => e.stopPropagation()}
                    onTouchEnd={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key !== 'Escape' && e.key !== 'Tab') {
                        e.stopPropagation();
                      }
                    }}
                    className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 p-1.5 rounded-2xl bg-[#111113]/95 backdrop-blur-md border border-zinc-800 shadow-2xl"
                  >
                    <button
                      type="button"
                      aria-expanded={floatingToolbarOpen}
                      aria-label={floatingToolbarOpen ? 'Recolher dock mobile' : 'Expandir dock mobile'}
                      onClick={() => setFloatingToolbarOpen((v) => !v)}
                      className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center p-2 rounded-xl bg-zinc-800 text-zinc-300 hover:text-[#fafafa] transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                      title={floatingToolbarOpen ? 'Recolher dock mobile' : 'Expandir dock mobile'}
                    >
                      {floatingToolbarOpen ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronUp size={16} aria-hidden="true" />}
                    </button>

                    {floatingToolbarOpen && (
                      <>
                        <button
                          type="button"
                          aria-pressed={touchMode === 'trackpad'}
                          onClick={() => setTouchMode((m) => (m === 'trackpad' ? 'direct' : 'trackpad'))}
                          className={`px-3 py-2 min-h-[44px] rounded-xl font-bold text-xs transition-colors flex items-center gap-1 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                            touchMode === 'trackpad' ? 'bg-sky-600 text-white shadow-md' : 'bg-zinc-800 text-zinc-300 hover:text-[#fafafa]'
                          }`}
                          title="Modo Trackpad / Modo Toque Direto"
                        >
                          <Hand size={14} aria-hidden="true" />
                          <span>{touchMode === 'trackpad' ? 'Trackpad' : 'Toque Direto'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            queueInputEvent({ type: 'click', ...virtualCursor });
                            try { navigator?.vibrate?.(25); } catch { /* noop */ }
                          }}
                          className="px-3 py-2 min-h-[44px] rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold text-xs transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                          title="Clique Esquerdo"
                        >
                          Esq.
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            queueInputEvent({ type: 'rightclick', ...virtualCursor });
                            try { navigator?.vibrate?.(35); } catch { /* noop */ }
                          }}
                          className="px-3 py-2 min-h-[44px] rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold text-xs transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                          title="Clique Direito"
                        >
                          Dir.
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            queueInputEvent({ type: 'dblclick', ...virtualCursor });
                          }}
                          className="px-3 py-2 min-h-[44px] rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold text-xs transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                          title="Duplo Clique"
                        >
                          2x
                        </button>

                        <button
                          type="button"
                          aria-pressed={dragLock}
                          aria-label="Trava de Arraste"
                          onClick={() => setDragLock((v) => !v)}
                          className={`min-h-[44px] min-w-[44px] inline-flex items-center justify-center px-3 py-2 rounded-xl font-bold text-xs transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                            dragLock ? 'bg-amber-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:text-[#fafafa]'
                          }`}
                          title="Trava de Arraste (Arrastar Janelas / Selecionar Texto)"
                        >
                          <Move size={15} aria-hidden="true" />
                        </button>

                        <button
                          type="button"
                          aria-pressed={mobileKbOpen}
                          aria-label="Teclado Virtual"
                          onClick={toggleMobileKeyboard}
                          className={`min-h-[44px] min-w-[44px] inline-flex items-center justify-center p-2 rounded-xl transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                            mobileKbOpen ? 'bg-brand text-brand-fg' : 'bg-zinc-800 text-zinc-300 hover:text-[#fafafa]'
                          }`}
                          title="Teclado Virtual"
                        >
                          <Keyboard size={16} aria-hidden="true" />
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Barra de Digitação Rápida */}
              <form
                onSubmit={handleSendTextToRemote}
                className="flex items-center gap-2 px-3 md:px-4 py-2 bg-[#111113] border-t border-zinc-800 shrink-0"
              >
                <Keyboard className="w-4 h-4 text-zinc-400 shrink-0" aria-hidden="true" />
                <label htmlFor="remote-quick-type" className="sr-only">
                  Digitar texto no notebook remoto
                </label>
                <input
                  id="remote-quick-type"
                  name="textToType"
                  type="text"
                  value={textToType}
                  onChange={(e) => setTextToType(e.target.value)}
                  placeholder="Digitar texto no notebook remoto…"
                  className="flex-1 min-h-[44px] bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-[#fafafa] placeholder-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                />
                <button
                  type="submit"
                  disabled={!sessionId || !textToType.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[44px] rounded-xl bg-brand hover:bg-brand-dark disabled:opacity-40 disabled:cursor-not-allowed text-brand-fg font-bold text-xs shrink-0 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Enviar</span>
                </button>
              </form>
            </div>
          )}

          {/* TAB 2: TERMINAL POWERSHELL REMOTO */}
          {activeTab === 'terminal' && (
            <div
              id="remote-tabpanel-terminal"
              role="tabpanel"
              aria-labelledby="remote-tab-terminal"
              className="flex-1 flex flex-col p-4 md:p-6 gap-4 bg-[#09090b]"
            >
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2">
                  Ações Rápidas PowerShell (1 Clique)
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {QUICK_POWERSHELL_ACTIONS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSendCommand(REMOTE_COMMANDS.POWERSHELL, item.command, item.label)}
                      className="flex flex-col items-start p-3 min-h-[44px] rounded-xl bg-[#111113] border border-zinc-800 hover:border-brand text-left transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    >
                      <span className="font-bold text-xs text-[#fafafa] flex items-center gap-1.5">
                        <Terminal className="w-3.5 h-3.5 text-brand-aa" />
                        {item.label}
                      </span>
                      <span className="text-xs text-zinc-400 mt-0.5">
                        {item.description}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Console Output */}
              <div className="flex-1 bg-[#111113] border border-zinc-800 rounded-xl p-4 font-mono text-xs text-zinc-200 overflow-y-auto overscroll-contain min-h-[240px] space-y-4">
                {runningCmdId && (
                  <div role="status" className="flex items-center gap-2 text-amber-300">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Executando comando no notebook ({patrimony}) {runningCmdLabel ? `[${runningCmdLabel}]` : ''}…</span>
                  </div>
                )}

                {commandHistory.length === 0 ? (
                  <div className="text-zinc-500">
                    PS C:\Windows\system32&gt; Pronto para receber comandos PowerShell remotos.
                  </div>
                ) : (
                  commandHistory.map((entry) => (
                    <div key={entry.commandId} className="border-b border-zinc-800 pb-3 last:border-none">
                      <div className="flex items-center justify-between text-xs text-brand-aa mb-1">
                        <span className="truncate max-w-[75%]">PS {hostname}&gt; {entry.command}</span>
                        <span className="text-zinc-500 shrink-0 tabular-nums">
                          {entry.completedAt ? new Date(entry.completedAt).toLocaleTimeString('pt-BR') : ''}
                        </span>
                      </div>
                      <pre className="whitespace-pre-wrap text-emerald-300 bg-[#09090b] p-3 rounded-lg overflow-x-auto select-text">
                        {entry.output || '(Sem saída)'}
                      </pre>
                    </div>
                  ))
                )}
              </div>

              {/* Input PowerShell */}
              <form onSubmit={handleRunPowerShell} className="flex items-center gap-2">
                <div className="flex-1 flex items-center bg-[#111113] border border-zinc-700 rounded-xl px-3.5 py-1.5 min-h-[44px] focus-within:ring-2 focus-within:ring-brand">
                  <span className="font-mono text-xs text-brand-aa mr-2">PS&gt;</span>
                  <label htmlFor="remote-ps-input" className="sr-only">
                    Comando PowerShell remoto
                  </label>
                  <input
                    id="remote-ps-input"
                    name="psInput"
                    type="text"
                    value={psInput}
                    maxLength={MAX_COMMAND_LENGTH}
                    onChange={(e) => setPsInput(e.target.value)}
                    placeholder="Comando PowerShell remoto…"
                    className="flex-1 bg-transparent font-mono text-xs text-[#fafafa] placeholder-zinc-500 focus:outline-none min-h-[36px]"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!psInput.trim()}
                  className="inline-flex items-center gap-2 px-5 py-2.5 min-h-[44px] rounded-xl bg-brand hover:bg-brand-dark disabled:opacity-40 disabled:cursor-not-allowed text-brand-fg font-bold text-xs shrink-0 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  <Play className="w-4 h-4 fill-current" />
                  Executar
                </button>
              </form>
            </div>
          )}

          {/* TAB 3: PROCESSOS E RECURSOS */}
          {activeTab === 'processes' && (
            <div
              id="remote-tabpanel-processes"
              role="tabpanel"
              aria-labelledby="remote-tab-processes"
              className="flex-1 p-4 md:p-6 space-y-5 bg-[#09090b]"
            >
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-xl bg-[#111113] border border-zinc-800">
                  <div className="flex items-center justify-between text-xs font-bold text-zinc-400 mb-2">
                    <span className="flex items-center gap-1.5">
                      <Cpu className="w-4 h-4 text-brand-aa" /> USO DE CPU
                    </span>
                    <span className="text-base font-black text-[#fafafa] tabular-nums">
                      {metrics.cpuPercent ?? '—'}%
                    </span>
                  </div>
                  <div className="w-full h-2.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-brand rounded-full transition-[width] duration-200"
                      style={{ width: `${Math.min(100, metrics.cpuPercent || 0)}%` }}
                    />
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-[#111113] border border-zinc-800">
                  <div className="flex items-center justify-between text-xs font-bold text-zinc-400 mb-2">
                    <span className="flex items-center gap-1.5">
                      <Activity className="w-4 h-4 text-emerald-400" /> MEMÓRIA RAM
                    </span>
                    <span className="text-base font-black text-[#fafafa] tabular-nums">
                      {metrics.ramPercent ?? '—'}%
                    </span>
                  </div>
                  <div className="w-full h-2.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full transition-[width] duration-200"
                      style={{ width: `${Math.min(100, metrics.ramPercent || 0)}%` }}
                    />
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-[#111113] border border-zinc-800">
                  <div className="flex items-center justify-between text-xs font-bold text-zinc-400 mb-2">
                    <span className="flex items-center gap-1.5">
                      <HardDrive className="w-4 h-4 text-amber-400" /> DISCO (C:)
                    </span>
                    <span className="text-base font-black text-[#fafafa] tabular-nums">
                      {metrics.diskPercent ?? '—'}%
                    </span>
                  </div>
                  <div className="w-full h-2.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-500 rounded-full transition-[width] duration-200"
                      style={{ width: `${Math.min(100, metrics.diskPercent || 0)}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Tabela de Processos */}
              <div className="bg-[#111113] border border-zinc-800 rounded-xl overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-zinc-800">
                  <h4 className="font-bold text-xs uppercase tracking-wider text-zinc-300">
                    Processos Ativos na Estação
                  </h4>
                  <label htmlFor="remote-proc-filter" className="sr-only">
                    Filtrar processos por nome ou PID
                  </label>
                  <input
                    id="remote-proc-filter"
                    name="procFilter"
                    type="text"
                    value={procFilter}
                    onChange={(e) => setProcFilter(e.target.value)}
                    placeholder="Filtrar por nome ou PID…"
                    className="px-3 py-2 min-h-[44px] rounded-lg bg-zinc-900 border border-zinc-700 text-xs text-[#fafafa] placeholder-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-zinc-900/90 text-zinc-400 uppercase text-xs">
                      <tr>
                        <th className="px-4 py-2.5">PID</th>
                        <th className="px-4 py-2.5">Processo</th>
                        <th className="px-4 py-2.5">Memória</th>
                        <th className="px-4 py-2.5 text-right">Ação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800">
                      {filteredProcesses.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-4 py-8 text-center text-zinc-500">
                            Nenhum processo listado no momento.
                          </td>
                        </tr>
                      ) : (
                        filteredProcesses.map((proc) => (
                          <tr key={proc.pid} className="hover:bg-zinc-900/60">
                            <td className="px-4 py-2.5 font-mono text-zinc-400 tabular-nums">{proc.pid}</td>
                            <td className="px-4 py-2.5 font-bold text-[#fafafa]">{proc.name}.exe</td>
                            <td className="px-4 py-2.5 font-mono text-zinc-300 tabular-nums">{proc.memoryMb} MB</td>
                            <td className="px-4 py-2.5 text-right">
                              <button
                                type="button"
                                onClick={() => handleKillProcess(proc)}
                                className="inline-flex items-center gap-1 px-3 py-2 min-h-[44px] rounded-lg bg-rose-950/60 hover:bg-rose-900/70 text-rose-300 font-bold text-xs transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
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

          {/* TAB 4: AÇÕES, ATUALIZAÇÃO OTA E ENERGIA */}
          {activeTab === 'actions' && (
            <div
              id="remote-tabpanel-actions"
              role="tabpanel"
              aria-labelledby="remote-tab-actions"
              className="flex-1 p-4 md:p-6 grid grid-cols-1 lg:grid-cols-2 gap-5 bg-[#09090b]"
            >
              
              {/* Atualização OTA */}
              <div className="lg:col-span-2 p-5 rounded-xl bg-[#111113] border border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-brand text-brand-fg flex items-center justify-center shrink-0">
                    <ArrowUpCircle className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-[#fafafa]">
                      Atualização Remota OTA do NexusAgent &amp; NexusDesk
                    </h3>
                    <p className="text-xs text-zinc-400 mt-1 tabular-nums">
                      Versão instalada: <strong>{currentAgentVer ? `v${currentAgentVer}` : 'v3.1'}</strong> • Versão mais recente disponível: <strong>v{AGENT_VERSION}</strong>
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleUpdateAgentRemote}
                  disabled={updatingAgent}
                  className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl bg-brand hover:bg-brand-dark disabled:opacity-50 disabled:cursor-not-allowed text-brand-fg font-bold text-xs transition-colors shrink-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  {updatingAgent ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ArrowUpCircle className="w-4 h-4" />}
                  Atualizar para v{AGENT_VERSION}
                </button>
              </div>

              {/* Controles de Energia e Bloqueio */}
              <div className="p-5 rounded-xl bg-[#111113] border border-zinc-800 space-y-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  <h3 className="font-bold text-sm text-[#fafafa]">
                    Energia e Bloqueio Remoto
                  </h3>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handlePowerAction(REMOTE_COMMANDS.LOCK_SCREEN, 'Bloquear Tela')}
                    className="p-3 min-h-[44px] rounded-xl bg-zinc-800 hover:bg-zinc-700 text-[#fafafa] font-bold text-xs flex items-center gap-2 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    <Lock size={14} className="text-amber-400" /> Bloquear Estação
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePowerAction(REMOTE_COMMANDS.RESTART, 'Reiniciar Computador')}
                    className="p-3 min-h-[44px] rounded-xl bg-zinc-800 hover:bg-zinc-700 text-[#fafafa] font-bold text-xs flex items-center gap-2 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    <RotateCcw size={14} className="text-orange-400" /> Reiniciar (30s)
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePowerAction(REMOTE_COMMANDS.SHUTDOWN, 'Desligar Computador')}
                    className="p-3 min-h-[44px] rounded-xl bg-zinc-800 hover:bg-zinc-700 text-[#fafafa] font-bold text-xs flex items-center gap-2 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    <Power size={14} className="text-rose-400" /> Desligar (30s)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSendCommand(REMOTE_COMMANDS.FORCE_INVENTORY, 'sync', 'Forçar Inventário')}
                    disabled={syncingInventory}
                    className="p-3 min-h-[44px] rounded-xl bg-brand/15 hover:bg-brand/25 border border-brand/30 text-brand-aa font-bold text-xs flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    <RefreshCw size={14} className={`text-brand-aa ${syncingInventory ? 'animate-spin' : ''}`} />
                    <span>{syncingInventory ? 'Sincronizando…' : 'Forçar Coleta'}</span>
                  </button>
                </div>
              </div>

              {/* Mensagem na Tela do Usuário */}
              <div className="p-5 rounded-xl bg-[#111113] border border-zinc-800 space-y-3">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-brand-aa" />
                  <h3 className="font-bold text-sm text-[#fafafa]">
                    Mensagem Pop-up na Tela
                  </h3>
                </div>
                <label htmlFor="remote-msg-title" className="sr-only">
                  Título do aviso
                </label>
                <input
                  id="remote-msg-title"
                  name="msgTitle"
                  type="text"
                  value={msgTitle}
                  onChange={(e) => setMsgTitle(e.target.value)}
                  placeholder="Título do aviso"
                  className="w-full px-3 py-2 min-h-[44px] rounded-xl bg-zinc-900 border border-zinc-700 text-xs text-[#fafafa] placeholder-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                />
                <label htmlFor="remote-msg-body" className="sr-only">
                  Mensagem para o colaborador
                </label>
                <textarea
                  id="remote-msg-body"
                  name="msgBody"
                  rows={2}
                  value={msgBody}
                  onChange={(e) => setMsgBody(e.target.value)}
                  placeholder="Mensagem para o colaborador…"
                  className="w-full px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-700 text-xs text-[#fafafa] placeholder-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!msgBody.trim()) return;
                    handleSendCommand(REMOTE_COMMANDS.MSGBOX, msgBody.trim(), msgTitle.trim());
                    setMsgBody('');
                  }}
                  disabled={!msgBody.trim()}
                  className="px-4 py-2 min-h-[44px] rounded-xl bg-brand hover:bg-brand-dark disabled:opacity-40 disabled:cursor-not-allowed text-brand-fg font-bold text-xs transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  Exibir Pop-up
                </button>
              </div>

              {/* Gerenciamento de Softwares Winget */}
              <div className="lg:col-span-2 p-5 rounded-xl bg-[#111113] border border-zinc-800 space-y-4">
                <div className="flex items-center gap-2">
                  <Package className="w-5 h-5 text-brand-aa" />
                  <h3 className="font-bold text-sm text-[#fafafa]">
                    Instalação e Remoção Remota de Softwares (Winget)
                  </h3>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-zinc-400 font-semibold">
                    Instalar pacote padrão em 1 clique:
                  </span>
                  {WINGET_PRESETS.map((preset) => (
                    <button
                      key={preset.pkg}
                      type="button"
                      onClick={() => handleSendCommand(REMOTE_COMMANDS.INSTALL_WINGET, preset.pkg, `Instalar ${preset.label}`)}
                      className="px-3 py-2 min-h-[44px] rounded-lg bg-brand/15 hover:bg-brand/25 border border-brand/30 text-brand-aa font-bold text-xs transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    >
                      + {preset.label}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="flex items-center gap-2">
                    <label htmlFor="remote-winget-pkg" className="sr-only">
                      ID Winget para instalar
                    </label>
                    <input
                      id="remote-winget-pkg"
                      name="wingetPkg"
                      type="text"
                      value={wingetPkg}
                      onChange={(e) => setWingetPkg(e.target.value)}
                      placeholder="ID Winget para instalar (ex: Google.Chrome)"
                      className="flex-1 px-3 py-2 min-h-[44px] rounded-xl bg-zinc-900 border border-zinc-700 text-xs text-[#fafafa] placeholder-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!wingetPkg.trim()) return;
                        handleSendCommand(REMOTE_COMMANDS.INSTALL_WINGET, wingetPkg.trim(), `Instalar ${wingetPkg.trim()}`);
                        setWingetPkg('');
                      }}
                      disabled={!wingetPkg.trim()}
                      className="px-4 py-2 min-h-[44px] rounded-xl bg-brand hover:bg-brand-dark disabled:opacity-40 disabled:cursor-not-allowed text-brand-fg font-bold text-xs shrink-0 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    >
                      Instalar
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <label htmlFor="remote-uninstall-name" className="sr-only">
                      Nome do software para remover
                    </label>
                    <input
                      id="remote-uninstall-name"
                      name="uninstallName"
                      type="text"
                      value={uninstallName}
                      onChange={(e) => setUninstallName(e.target.value)}
                      placeholder="Nome do software para remover (ex: TeamViewer)"
                      className="flex-1 px-3 py-2 min-h-[44px] rounded-xl bg-zinc-900 border border-zinc-700 text-xs text-[#fafafa] placeholder-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!uninstallName.trim()) return;
                        handleSendCommand(REMOTE_COMMANDS.UNINSTALL_SOFTWARE, uninstallName.trim(), `Desinstalar ${uninstallName.trim()}`);
                        setUninstallName('');
                      }}
                      disabled={!uninstallName.trim()}
                      className="px-4 py-2 min-h-[44px] rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs shrink-0 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                    >
                      Desinstalar
                    </button>
                  </div>
                </div>
              </div>

              {/* Revogação */}
              {isAdmin && (
                <div className="lg:col-span-2 p-4 rounded-xl bg-rose-950/20 border border-rose-900/40 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-rose-300 text-xs">
                    <ShieldOff size={16} />
                    <span>Revogar acesso e matrícula desta estação remotamente.</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleRevoke}
                    className="px-4 py-2 min-h-[44px] rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                  >
                    Revogar Agente
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
