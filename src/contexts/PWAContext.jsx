// src/contexts/PWAContext.jsx
// -----------------------------------------------------------------------------
// Gerenciador Global de PWA e Atualizacoes
//
// Resolve de forma definitiva o problema de o usuario ter que "desinstalar e
// instalar" o aplicativo para receber atualizacoes:
//  1. Verificacao proativa em pontos-chave: inicio, foco da janela, retorno do
//     app ao primeiro plano (visibilitychange), reconexao de internet e a cada
//     15 minutos.
//  2. Aviso de atualizacao persistente e amigavel (nao depende de toast fugaz).
//  3. Metodo de "Forcar Atualizacao e Limpar Cache" acessivel no app para
//     purgar qualquer cache antigo/corrompido sem precisar desinstalar o icone.
//  4. Captura de evento beforeinstallprompt para instalacao direta em 1 toque.
// -----------------------------------------------------------------------------
import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { toast } from 'sonner';
import { APP_VERSION } from '../utils/appVersion';

const PWAContext = createContext(null);

export const PWAProvider = ({ children }) => {
  const [swRegistration, setSwRegistration] = useState(null);
  const [isChecking, setIsChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState(() => new Date());
  const [installPrompt, setInstallPrompt] = useState(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const checkingLockRef = useRef(false);

  // Registra e monitora o Service Worker via vite-plugin-pwa
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(registration) {
      if (registration) {
        setSwRegistration(registration);
        // Verificacao inicial imediata no registro
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

  // Detecta se esta rodando em modo Standalone (PWA instalado no celular/desktop)
  useEffect(() => {
    const checkStandalone = () => {
      const isStandaloneMode =
        window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true ||
        document.referrer.includes('android-app://');
      setIsStandalone(Boolean(isStandaloneMode));
    };
    checkStandalone();
    const media = window.matchMedia('(display-mode: standalone)');
    media.addEventListener?.('change', checkStandalone);
    return () => media.removeEventListener?.('change', checkStandalone);
  }, []);

  // Captura o evento beforeinstallprompt para permitir instalacao direta no painel
  useEffect(() => {
    const handleBeforeInstall = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    const handleAppInstalled = () => {
      setInstallPrompt(null);
      setIsStandalone(true);
      toast.success('Aplicativo Nexus ITAM instalado com sucesso!');
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  // Quando o novo Service Worker assume o controle (controllerchange), recarrega
  // a pagina de forma limpa para garantir que todos os chunks correspondam a nova versao.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;
    let refreshing = false;
    const handleControllerChange = () => {
      if (refreshing) return;
      refreshing = true;
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

            // Se ja tem um worker esperando ativacao
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

        // Se checou e nao ha worker esperando
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

  // Escutas de eventos para checagem automatica (app resume, foco e conexao online)
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkForUpdates({ silent: true });
      }
    };
    const onFocus = () => checkForUpdates({ silent: true });
    const onOnline = () => checkForUpdates({ silent: true });

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);

    // Checagem periodica a cada 15 minutos enquanto o app estiver aberto
    const interval = setInterval(() => {
      checkForUpdates({ silent: true });
    }, 15 * 60 * 1000);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      clearInterval(interval);
    };
  }, [checkForUpdates]);

  /**
   * Aplica a atualizacao imediatamente sem que o usuario precise fechar ou
   * reinstalar o app.
   */
  const applyUpdate = useCallback(async () => {
    try {
      toast.info('Atualizando o sistema…');
      if (swRegistration?.waiting) {
        swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
      await updateServiceWorker(true);
      // Fallback: se por algum motivo controllerchange nao disparar em 1.5s
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (err) {
      console.error('Falha ao aplicar atualizacao do service worker:', err);
      window.location.reload();
    }
  }, [swRegistration, updateServiceWorker]);

  /**
   * Solucao definitiva para cache travado: purga todas as caches do navegador,
   * desregistra todos os Service Workers e recarrega a pagina com cache-buster.
   * Evita 100% que o usuario precise desinstalar o aplicativo.
   */
  const forceHardReset = useCallback(async () => {
    try {
      toast.info('Limpando dados de cache e atualizando…');

      // 1. Apaga todas as caches do CacheStorage
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map((name) => caches.delete(name)));
      }

      // 2. Desregistra todos os Service Workers ativos
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((reg) => reg.unregister()));
      }

      // 3. Limpa storage de recarga temporario
      try {
        sessionStorage.removeItem('nexus:preload-reload');
      } catch {
        /* ignore */
      }

      // 4. Redireciona com parametro de tempo para forcar download limpo do servidor
      const cleanUrl = `${window.location.origin}${window.location.pathname}?update_time=${Date.now()}`;
      window.location.replace(cleanUrl);
    } catch (err) {
      console.error('Erro no hard reset:', err);
      window.location.reload();
    }
  }, []);

  /**
   * Dispara o prompt de instalacao do PWA se estiver no navegador.
   */
  const installApp = useCallback(async () => {
    if (!installPrompt) {
      toast.info('Para instalar, use o menu do navegador: "Adicionar à Tela de Início" ou "Instalar Aplicativo".');
      return false;
    }
    try {
      installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setInstallPrompt(null);
        return true;
      }
      return false;
    } catch (err) {
      console.error(err);
      return false;
    }
  }, [installPrompt]);

  const value = {
    appVersion: APP_VERSION,
    needRefresh,
    offlineReady,
    isChecking,
    lastChecked,
    isStandalone,
    canInstall: Boolean(installPrompt),
    bannerDismissed,
    setBannerDismissed,
    checkForUpdates,
    applyUpdate,
    forceHardReset,
    installApp,
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
  setBannerDismissed: () => {},
  checkForUpdates: async () => {},
  applyUpdate: async () => {},
  forceHardReset: async () => {},
  installApp: async () => false,
};

// eslint-disable-next-line react-refresh/only-export-components
export const usePWA = () => {
  const context = useContext(PWAContext);
  return context || DEFAULT_PWA_VALUE;
};
