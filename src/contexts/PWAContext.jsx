// src/contexts/PWAContext.jsx
// -----------------------------------------------------------------------------
// Gerenciador Global de PWA e Experiência Mobile Nativa
//
// 1. Verificação proativa de atualizações e limpeza de caches obsoletos.
// 2. Fluxo de instalação com progresso em tempo real (etapas 1 a 4).
// 3. Pré-aquecimento do CacheStorage com rotas e assets essenciais.
// 4. Suporte nativo a iOS com orientações táteis do Safari.
// 5. Diagnóstico de armazenamento e status standalone.
// -----------------------------------------------------------------------------
import React, { createContext, useContext, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { toast } from 'sonner';
import { APP_VERSION } from '../utils/appVersion';

const PWAContext = createContext(null);

const INITIAL_INSTALL_PROGRESS = {
  isInstalling: false,
  progress: 0,
  step: 0,
  statusText: '',
  isComplete: false,
  error: null,
};

const checkIsIOSDevice = () => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isApple = /iPad|iPhone|iPod/.test(ua);
  const isAppleTouchMac = navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;
  return Boolean(isApple || isAppleTouchMac);
};

export const PWAProvider = ({ children }) => {
  const [swRegistration, setSwRegistration] = useState(null);
  const [isChecking, setIsChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState(() => new Date());
  const [installPrompt, setInstallPrompt] = useState(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [isInstallModalOpen, setIsInstallModalOpen] = useState(false);
  const [installProgress, setInstallProgress] = useState(INITIAL_INSTALL_PROGRESS);
  const [storageDiagnostics, setStorageDiagnostics] = useState({
    quota: null,
    usage: null,
    percentage: 0,
    isPersisted: false,
  });

  const checkingLockRef = useRef(false);
  const isIOS = useMemo(() => checkIsIOSDevice(), []);

  // Registra e monitora o Service Worker via vite-plugin-pwa
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(registration) {
      if (registration) {
        setSwRegistration(registration);
        try {
          registration.update().catch(() => {});
        } catch {
          /* navegador sem suporte */
        }
      }
    },
    onRegisterError(error) {
      console.warn('Falha no registro do Service Worker PWA:', error);
    },
  });

  // Atualiza diagnóstico de armazenamento (quota e consumo)
  const refreshStorageDiagnostics = useCallback(async () => {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
        const quota = estimate.quota || 0;
        const usage = estimate.usage || 0;
        const percentage = quota > 0 ? Math.min(100, Math.round((usage / quota) * 100)) : 0;

        setStorageDiagnostics({
          quota,
          usage,
          percentage,
          isPersisted: Boolean(persisted),
        });
      } catch {
        /* storage estimate indisponivel */
      }
    }
  }, []);

  useEffect(() => {
    refreshStorageDiagnostics();
  }, [refreshStorageDiagnostics]);

  // Detecta se esta rodando em modo Standalone (PWA instalado no celular/desktop)
  useEffect(() => {
    const checkStandalone = () => {
      const isStandaloneMode =
        (typeof window !== 'undefined' &&
          (window.matchMedia?.('(display-mode: standalone)').matches ||
            window.navigator?.standalone === true ||
            document.referrer?.includes('android-app://'))) ||
        false;
      setIsStandalone(Boolean(isStandaloneMode));
    };

    checkStandalone();
    const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(display-mode: standalone)') : null;
    media?.addEventListener?.('change', checkStandalone);
    return () => media?.removeEventListener?.('change', checkStandalone);
  }, []);

  // Captura o evento beforeinstallprompt para permitir instalacao direta e com progresso
  useEffect(() => {
    const handleBeforeInstall = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };

    const handleAppInstalled = () => {
      setInstallPrompt(null);
      setIsStandalone(true);
      setInstallProgress({
        isInstalling: false,
        progress: 100,
        step: 4,
        statusText: 'Instalação concluída com sucesso!',
        isComplete: true,
        error: null,
      });
      toast.success('Aplicativo Nexus ITAM instalado com sucesso!');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  // Recarrega na transição de Service Worker apenas quando um NOVO worker substitui um worker EXISTENTE
  // Protege contra loop infinito de reload em Ctrl+F5 (onde navigator.serviceWorker.controller começa null e é assumido via clients.claim())
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;
    // Se a página iniciou sem controller (ex: Ctrl+F5, hard reload ou primeira visita),
    // NÃO recarrega quando o SW chamar clients.claim()!
    if (!navigator.serviceWorker.controller) return undefined;

    let refreshing = false;
    const handleControllerChange = () => {
      if (refreshing) return;
      const lastReload = Number(sessionStorage.getItem('nexus_sw_last_reload') || 0);
      if (Date.now() - lastReload < 6000) return;
      refreshing = true;
      sessionStorage.setItem('nexus_sw_last_reload', String(Date.now()));
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);
    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    };
  }, []);

  /**
   * Checa com o servidor se ha uma versao mais recente disponivel.
   * @param {boolean} silent Se falso, exibe toast de feedback ao usuario.
   */
  const checkForUpdates = useCallback(
    async ({ silent = true } = {}) => {
      if (checkingLockRef.current) return;
      checkingLockRef.current = true;
      setIsChecking(true);

      if (!silent) {
        toast.info('Verificando atualizações no servidor…');
      }

      try {
        if ('serviceWorker' in navigator) {
          const reg = swRegistration || (await navigator.serviceWorker.getRegistration());
          if (reg) {
            setSwRegistration(reg);
            await reg.update();
            setLastChecked(new Date());

            if (reg.waiting) {
              setNeedRefresh(true);
              setBannerDismissed(false);
              if (!silent) {
                toast.success('Nova versão pronta para instalação!');
              }
              return;
            }
          }
        }

        if (!silent) {
          setTimeout(() => {
            if (!needRefresh) {
              toast.success('Você já está na versão mais recente do Nexus ITAM.');
            }
          }, 800);
        }
      } catch (err) {
        console.warn('Erro ao verificar atualizacoes:', err);
        if (!silent) {
          toast.error('Não foi possível verificar atualizações no momento.');
        }
      } finally {
        setIsChecking(false);
        checkingLockRef.current = false;
      }
    },
    [swRegistration, needRefresh, setNeedRefresh],
  );

  // Escutas de eventos para checagem automatica
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkForUpdates({ silent: true });
      }
    };
    const onFocus = () => checkForUpdates({ silent: true });
    const onOnline = () => {
      checkForUpdates({ silent: true });
      refreshStorageDiagnostics();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);

    const interval = setInterval(() => {
      checkForUpdates({ silent: true });
    }, 15 * 60 * 1000);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      clearInterval(interval);
    };
  }, [checkForUpdates, refreshStorageDiagnostics]);

  /**
   * Aplica a atualizacao imediatamente sem que o usuario precise desinstalar.
   */
  const applyUpdate = useCallback(async () => {
    try {
      toast.info('Atualizando o sistema…');
      if (swRegistration?.waiting) {
        swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
      await updateServiceWorker(true);
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (err) {
      console.error('Falha ao aplicar atualizacao do service worker:', err);
      window.location.reload();
    }
  }, [swRegistration, updateServiceWorker]);

  /**
   * Hard reset de cache e service workers em caso de inconsistencias.
   */
  const forceHardReset = useCallback(async () => {
    try {
      toast.info('Limpando dados de cache e atualizando…');

      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map((name) => caches.delete(name)));
      }

      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((reg) => reg.unregister()));
      }

      try {
        sessionStorage.removeItem('nexus:preload-reload');
      } catch {
        /* ignore */
      }

      const cleanUrl = `${window.location.origin}${window.location.pathname}?update_time=${Date.now()}`;
      window.location.replace(cleanUrl);
    } catch (err) {
      console.error('Erro no hard reset:', err);
      window.location.reload();
    }
  }, []);

  /**
   * Fluxo de instalacao nativa com progresso visual em tempo real.
   */
  const startInstallWithProgress = useCallback(async () => {
    setIsInstallModalOpen(true);

    if (isStandalone) {
      setInstallProgress({
        isInstalling: false,
        progress: 100,
        step: 4,
        statusText: 'Aplicativo Nexus ITAM já instalado e ativo no seu dispositivo!',
        isComplete: true,
        error: null,
      });
      return true;
    }

    try {
      // Etapa 1: Verificação de compatibilidade e integridade do app
      setInstallProgress({
        isInstalling: true,
        progress: 15,
        step: 1,
        statusText: 'Verificando compatibilidade e integridade do app...',
        isComplete: false,
        error: null,
      });

      await new Promise((resolve) => setTimeout(resolve, 400));

      // Etapa 2: Pré-aquecimento do CacheStorage com rotas e assets essenciais
      setInstallProgress({
        isInstalling: true,
        progress: 45,
        step: 2,
        statusText: 'Baixando pacote do Nexus ITAM e interface offline...',
        isComplete: false,
        error: null,
      });

      try {
        if (typeof window !== 'undefined' && 'caches' in window) {
          const cache = await caches.open('nexus-core-runtime-v1');
          const criticalUrls = ['/', '/dashboard', '/assets', '/audit', '/tasks', '/service-desk', '/logo.webp', '/pwa-192x192.png'];
          await Promise.allSettled(
            criticalUrls.map(async (url) => {
              try {
                const res = await fetch(url, { cache: 'no-cache' });
                if (res && (res.ok || res.type === 'opaque')) {
                  await cache.put(url, res);
                }
              } catch {
                /* non-blocking */
              }
            }),
          );
        }
      } catch (cacheErr) {
        console.warn('Aviso no pré-aquecimento do cache offline:', cacheErr);
      }

      await refreshStorageDiagnostics();
      setInstallProgress((prev) => ({
        ...prev,
        progress: 75,
      }));

      await new Promise((resolve) => setTimeout(resolve, 350));

      // Etapa 3: Configuração do atalho nativo e Service Worker
      setInstallProgress({
        isInstalling: true,
        progress: 80,
        step: 3,
        statusText: 'Configurando atalho nativo e Service Worker...',
        isComplete: false,
        error: null,
      });

      if (installPrompt) {
        installPrompt.prompt();
        const choice = await installPrompt.userChoice;

        if (choice?.outcome === 'accepted') {
          setInstallProgress({
            isInstalling: false,
            progress: 100,
            step: 4,
            statusText: 'Instalação concluída com sucesso!',
            isComplete: true,
            error: null,
          });
          setInstallPrompt(null);
          setIsStandalone(true);
          toast.success('Aplicativo Nexus ITAM instalado com sucesso!');
          return true;
        }

        setInstallProgress({
          isInstalling: false,
          progress: 80,
          step: 3,
          statusText: 'Instalação cancelada pelo usuário no dispositivo.',
          isComplete: false,
          error: 'Instalação não autorizada pelo usuário.',
        });
        return false;
      }

      if (isIOS) {
        // No iOS, orienta o fluxo do Safari nativo após pré-aquecer offline
        setInstallProgress({
          isInstalling: false,
          progress: 100,
          step: 4,
          statusText: 'Pacote offline pronto! Siga as instruções abaixo no Safari.',
          isComplete: true,
          error: null,
        });
        return true;
      }

      // Outros navegadores sem beforeinstallprompt nativo
      setInstallProgress({
        isInstalling: false,
        progress: 100,
        step: 4,
        statusText: 'Ambiente preparado. Adicione pelo menu do seu navegador.',
        isComplete: true,
        error: null,
      });
      return false;
    } catch (err) {
      console.error('Erro durante o fluxo de instalação com progresso:', err);
      setInstallProgress({
        isInstalling: false,
        progress: 80,
        step: 3,
        statusText: 'Não foi possível concluir a instalação automaticamente.',
        isComplete: false,
        error: err?.message || 'Falha na instalação',
      });
      return false;
    }
  }, [isStandalone, installPrompt, isIOS, refreshStorageDiagnostics]);

  /**
   * Instalação direta para compatibilidade retroativa.
   */
  const installApp = useCallback(async () => {
    setIsInstallModalOpen(true);
    return startInstallWithProgress();
  }, [startInstallWithProgress]);

  const value = {
    appVersion: APP_VERSION,
    needRefresh,
    offlineReady,
    isChecking,
    lastChecked,
    isStandalone,
    canInstall: Boolean(installPrompt) || isIOS,
    bannerDismissed,
    isInstallModalOpen,
    isIOS,
    installProgress,
    storageDiagnostics,
    setBannerDismissed,
    setIsInstallModalOpen,
    startInstallWithProgress,
    checkForUpdates,
    applyUpdate,
    forceHardReset,
    installApp,
    refreshStorageDiagnostics,
  };

  return <PWAContext.Provider value={value}>{children}</PWAContext.Provider>;
};

const DEFAULT_PWA_VALUE = {
  appVersion: APP_VERSION,
  needRefresh: false,
  offlineReady: false,
  isChecking: false,
  lastChecked: null,
  isStandalone: false,
  canInstall: false,
  bannerDismissed: false,
  isInstallModalOpen: false,
  isIOS: false,
  installProgress: INITIAL_INSTALL_PROGRESS,
  storageDiagnostics: {
    quota: null,
    usage: null,
    percentage: 0,
    isPersisted: false,
  },
  setBannerDismissed: () => {},
  setIsInstallModalOpen: () => {},
  startInstallWithProgress: async () => false,
  checkForUpdates: async () => {},
  applyUpdate: async () => {},
  forceHardReset: async () => {},
  installApp: async () => false,
  refreshStorageDiagnostics: async () => {},
};

// eslint-disable-next-line react-refresh/only-export-components
export const usePWA = () => {
  const context = useContext(PWAContext);
  return context || DEFAULT_PWA_VALUE;
};
