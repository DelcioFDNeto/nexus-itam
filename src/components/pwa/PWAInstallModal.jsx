// src/components/pwa/PWAInstallModal.jsx
// -----------------------------------------------------------------------------
// Modal & Bottom Sheet de Instalação PWA com Sensação Nativa de Smartphone
//
// Apresenta fluxo guiado com progresso real em 4 etapas:
//  1. Verificação de compatibilidade e integridade do app
//  2. Download do pacote offline e pré-aquecimento do CacheStorage
//  3. Configuração de atalho nativo e Service Worker
//  4. Instalação e ativação concluídas
//
// Também possui suporte dedicado para Safari iOS (guia passo a passo) e
// diagnóstico de armazenamento para dispositivos com PWA já instalado.
// -----------------------------------------------------------------------------
import React, { useEffect, useCallback, useRef } from 'react';
import {
  X,
  Download,
  CheckCircle2,
  Loader2,
  Sparkles,
  Zap,
  WifiOff,
  Bell,
  Share2,
  PlusSquare,
  HardDrive,
  RefreshCw,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react';
import { usePWA } from '../../contexts/PWAContext';
import {
  captureFocusTarget,
  getFocusableElements,
  restoreFocusSafely,
  trapFocusWithin,
} from '../../utils/focusTrap';

const INSTALL_STEPS = [
  { id: 1, title: 'Compatibilidade & Ambiente', desc: 'Verificando arquitetura PWA e Service Worker' },
  { id: 2, title: 'Pacote Offline Essencial', desc: 'Baixando rotas de inventário e assets para cache' },
  { id: 3, title: 'Configuração do Atalho Nativo', desc: 'Registrando ícone adaptativo e atalhos rápidos' },
  { id: 4, title: 'Ativação & Conclusão', desc: 'App pronto para execução em tela cheia com sensação nativa' },
];

const PWAInstallModal = ({ returnFocusRef } = {}) => {
  const {
    isInstallModalOpen,
    setIsInstallModalOpen,
    installProgress,
    startInstallWithProgress,
    isStandalone,
    isIOS,
    storageDiagnostics,
    checkForUpdates,
    isChecking,
  } = usePWA();

  const dialogRef = useRef(null);
  const previousFocusRef = useRef(null);
  const wasOpenRef = useRef(false);
  const returnFocusRefLatest = useRef(returnFocusRef);
  useEffect(() => {
    returnFocusRefLatest.current = returnFocusRef;
  }, [returnFocusRef]);

  const isInstalling = Boolean(installProgress?.isInstalling);
  const isInstallingRef = useRef(isInstalling);
  useEffect(() => {
    isInstallingRef.current = isInstalling;
  }, [isInstalling]);

  const handleClose = useCallback(() => {
    // Permite fechar se não estiver em instalação crítica ou se o usuário cancelar
    setIsInstallModalOpen(false);
  }, [setIsInstallModalOpen]);

  // Captura/restaura foco apenas quando o modal abre ou fecha
  useEffect(() => {
    if (!isInstallModalOpen) {
      if (wasOpenRef.current) {
        wasOpenRef.current = false;
        const previous = previousFocusRef.current;
        previousFocusRef.current = null;
        const mainContent =
          typeof document !== 'undefined' ? document.getElementById('main-content') : null;
        if (!restoreFocusSafely(previous, returnFocusRefLatest.current?.current)) {
          restoreFocusSafely(mainContent);
        }
      }
      return undefined;
    }

    wasOpenRef.current = true;
    previousFocusRef.current = captureFocusTarget(dialogRef.current);

    const focusable = getFocusableElements(dialogRef.current);
    if (focusable.length > 0) {
      focusable[0].focus();
    } else {
      dialogRef.current?.focus();
    }
    return undefined;
  }, [isInstallModalOpen]);

  // Listener de teclado (Escape + focus trap) separado da restauração de foco
  useEffect(() => {
    if (!isInstallModalOpen) return undefined;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (!isInstallingRef.current) {
          e.preventDefault();
          handleClose();
        }
        return;
      }
      if (e.key === 'Tab') {
        trapFocusWithin(e, dialogRef.current);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isInstallModalOpen, handleClose]);

  if (!isInstallModalOpen) return null;

  const formattedUsage = storageDiagnostics?.usage
    ? (storageDiagnostics.usage / (1024 * 1024)).toFixed(1)
    : null;
  const formattedQuota = storageDiagnostics?.quota
    ? (storageDiagnostics.quota / (1024 * 1024)).toFixed(0)
    : null;

  return (
    <div
      className="dark fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70 backdrop-blur-sm animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !isInstalling) {
          handleClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pwa-install-title"
        tabIndex={-1}
        className="w-full sm:max-w-lg bg-[#111113] border border-zinc-800 rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] overscroll-contain text-[#fafafa] animate-zoom-in focus:outline-none"
      >
        {/* Header com identidade executiva */}
        <div className="relative px-6 pt-6 pb-4 border-b border-zinc-800 bg-[#111113]">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-12 w-12 shrink-0 rounded-2xl bg-gradient-to-tr from-brand to-cyan-500 p-0.5 shadow-lg shadow-brand/20 flex items-center justify-center">
                <img
                  src="/pwa-192x192.png"
                  alt="Nexus ITAM"
                  className="h-full w-full object-cover rounded-[14px]"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 id="pwa-install-title" className="text-base sm:text-lg font-black tracking-tight text-[#fafafa]">
                    Nexus ITAM Mobile
                  </h2>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-brand/15 text-brand-aa border border-brand/25">
                    <Sparkles size={12} aria-hidden="true" /> Nativo
                  </span>
                </div>
                <p className="text-xs text-zinc-400 mt-0.5">
                  {isStandalone ? 'Aplicativo instalado e ativo' : 'Experiência de alta performance para smartphone'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleClose}
              disabled={installProgress.isInstalling}
              aria-label="Fechar janela"
              data-icon-button="true"
              className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl text-zinc-400 transition-colors hover:bg-[#18181b] hover:text-[#fafafa] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-30 disabled:pointer-events-none"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Corpo do Modal */}
        <div className="p-6 space-y-6 overflow-y-auto overscroll-contain">
          {/* CASO 1: APLICATIVO JÁ INSTALADO (STANDALONE) */}
          {isStandalone ? (
            <div className="space-y-5">
              <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4 sm:p-5 flex items-start gap-3.5">
                <div className="h-10 w-10 shrink-0 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center" aria-hidden="true">
                  <CheckCircle2 size={22} aria-hidden="true" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-emerald-300">
                    Aplicativo Instalado e Sincronizado
                  </h3>
                  <p className="mt-1 text-xs text-zinc-300 leading-relaxed">
                    Você já está utilizando a versão nativa do <strong>Nexus ITAM</strong> com inicialização instantânea, atalhos rápidos e suporte a leitura de QR Code.
                  </p>
                </div>
              </div>

              {/* Status de Armazenamento e Cache */}
              <div className="rounded-2xl border border-zinc-800 bg-[#18181b]/70 p-4 space-y-3">
                <div className="flex items-center justify-between text-xs font-semibold text-zinc-300">
                  <span className="flex items-center gap-1.5">
                    <HardDrive size={14} aria-hidden="true" className="text-brand-aa" /> Armazenamento Offline
                  </span>
                  <span className="text-[#fafafa] font-mono">
                    {formattedUsage ? `${formattedUsage} MB` : 'Ativo'}
                    {formattedQuota ? ` / ${formattedQuota} MB` : ''}
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-[width] duration-500"
                    style={{ width: `${Math.max(8, storageDiagnostics?.percentage || 12)}%` }}
                  />
                </div>
                <p className="text-xs text-zinc-400">
                  Banco de dados local e interface estão prontos para operações em campo e auditorias offline.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => checkForUpdates({ silent: false })}
                  disabled={isChecking}
                  className="flex-1 min-h-[44px] flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-[#18181b] px-4 py-2.5 text-xs font-bold text-[#fafafa] transition-colors hover:bg-zinc-800 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RefreshCw size={14} aria-hidden="true" className={isChecking ? 'animate-spin text-brand-aa' : ''} />
                  {isChecking ? 'Verificando…' : 'Verificar Atualizações'}
                </button>
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex-1 min-h-[44px] rounded-xl bg-zinc-800 hover:bg-zinc-700 px-4 py-2.5 text-xs font-bold text-[#fafafa] transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  Fechar
                </button>
              </div>
            </div>
          ) : installProgress.isInstalling || installProgress.step > 0 ? (
            /* CASO 2: FLUXO DE INSTALAÇÃO EM ANDAMENTO OU COM RESULTADO */
            <div className="space-y-6">
              {/* Barra de Progresso Real */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-bold">
                  <span className="text-zinc-300">
                    {installProgress.isComplete ? 'Instalação Concluída' : 'Preparando Aplicativo Nativo'}
                  </span>
                  <span className="text-brand-aa font-mono text-sm">{installProgress.progress}%</span>
                </div>
                <div className="h-3 w-full rounded-full bg-zinc-800 overflow-hidden p-0.5 border border-zinc-700/60">
                  <div
                    role="progressbar"
                    aria-valuenow={installProgress.progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    className="h-full rounded-full bg-gradient-to-r from-brand to-cyan-400 transition-[width] duration-500 ease-out"
                    style={{ width: `${installProgress.progress}%` }}
                  />
                </div>
                <p className="text-xs text-zinc-400 flex items-center gap-1.5 pt-1">
                  {installProgress.isInstalling && <Loader2 size={14} aria-hidden="true" className="animate-spin text-brand-aa" />}
                  {installProgress.isComplete && <CheckCircle2 size={14} aria-hidden="true" className="text-emerald-400" />}
                  {installProgress.statusText}
                </p>
              </div>

              {/* Erro eventual */}
              {installProgress.error && (
                <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 flex items-start gap-2.5 text-xs text-rose-300">
                  <AlertCircle size={16} aria-hidden="true" className="shrink-0 mt-0.5 text-rose-400" />
                  <div>
                    <p className="font-bold">Aviso no processo:</p>
                    <p className="mt-0.5 text-rose-200">{installProgress.error}</p>
                  </div>
                </div>
              )}

              {/* Lista das 4 etapas visuais */}
              <div className="space-y-3 rounded-2xl border border-zinc-800 bg-[#18181b]/70 p-4">
                {INSTALL_STEPS.map((step) => {
                  const isDone =
                    installProgress.isComplete ||
                    installProgress.step > step.id ||
                    (installProgress.step === 4 && step.id === 4);
                  const isCurrent = installProgress.step === step.id && installProgress.isInstalling;

                  return (
                    <div
                      key={step.id}
                      className={`flex items-start gap-3 p-2.5 rounded-xl transition-colors ${
                        isCurrent
                          ? 'bg-brand/15 border border-brand/30'
                          : isDone
                            ? 'text-zinc-200'
                            : 'text-zinc-400'
                      }`}
                    >
                      <div className="mt-0.5 shrink-0" aria-hidden="true">
                        {isDone ? (
                          <div className="h-5 w-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                            <CheckCircle2 size={14} aria-hidden="true" />
                          </div>
                        ) : isCurrent ? (
                          <div className="h-5 w-5 rounded-full bg-brand/20 text-brand-aa flex items-center justify-center">
                            <Loader2 size={14} aria-hidden="true" className="animate-spin" />
                          </div>
                        ) : (
                          <div className="h-5 w-5 rounded-full border border-zinc-700 flex items-center justify-center text-xs font-mono text-zinc-400">
                            {step.id}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p
                          className={`text-xs font-bold ${
                            isCurrent ? 'text-[#fafafa]' : isDone ? 'text-zinc-200' : 'text-zinc-400'
                          }`}
                        >
                          {step.title}
                        </p>
                        <p className="text-xs text-zinc-400 mt-0.5 leading-snug">{step.desc}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Guia Adicional iOS se aplicável */}
              {isIOS && (
                <div className="rounded-2xl border border-cyan-500/30 bg-cyan-950/20 p-4 space-y-2.5">
                  <h3 className="text-xs font-black uppercase tracking-wider text-cyan-300 flex items-center gap-1.5">
                    <Share2 size={14} aria-hidden="true" /> Finalizar Fixação no Apple iOS
                  </h3>
                  <p className="text-xs text-zinc-300 leading-relaxed">
                    1. No Safari, toque no botão <strong>Compartilhar</strong> (ícone <Share2 size={12} aria-hidden="true" className="inline mx-0.5" /> na barra inferior).
                  </p>
                  <p className="text-xs text-zinc-300 leading-relaxed">
                    2. Deslize e escolha <strong>&ldquo;Adicionar à Tela de Início&rdquo;</strong> (<PlusSquare size={12} aria-hidden="true" className="inline mx-0.5" />).
                  </p>
                  <p className="text-xs text-zinc-300 leading-relaxed">
                    3. Toque em <strong>&ldquo;Adicionar&rdquo;</strong> no canto superior direito para concluir.
                  </p>
                </div>
              )}

              {/* Ações pós progresso */}
              <div className="flex items-center gap-3 pt-2">
                {installProgress.error ? (
                  <>
                    <button
                      type="button"
                      onClick={() => startInstallWithProgress()}
                      className="flex-1 min-h-[44px] flex items-center justify-center gap-2 rounded-xl bg-brand px-4 py-3 text-xs font-black uppercase tracking-wider text-brand-fg shadow-lg shadow-brand/20 hover:bg-brand-dark active:scale-[0.98] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    >
                      <RefreshCw size={14} aria-hidden="true" /> Tentar Novamente
                    </button>
                    <button
                      type="button"
                      onClick={handleClose}
                      className="min-h-[44px] rounded-xl border border-zinc-700 bg-[#18181b] px-4 py-3 text-xs font-bold text-zinc-200 hover:bg-zinc-800 active:scale-[0.98] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    >
                      Fechar
                    </button>
                  </>
                ) : installProgress.isComplete ? (
                  <button
                    type="button"
                    onClick={handleClose}
                    className="w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-xs font-black uppercase tracking-wider text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-500 active:scale-[0.98] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    <CheckCircle2 size={16} aria-hidden="true" /> Tudo Pronto! Concluir
                  </button>
                ) : (
                  <p className="w-full text-center text-xs text-zinc-400 italic">
                    Aguarde enquanto o sistema prepara o atalho nativo e os recursos offline…
                  </p>
                )}
              </div>
            </div>
          ) : (
            /* CASO 3: APRESENTAÇÃO DOS BENEFÍCIOS NATIVOS E BOTÃO DE INSTALAR */
            <div className="space-y-6">
              {/* Vantagens mobile nativo */}
              <div className="grid grid-cols-1 gap-3">
                <div className="flex items-start gap-3.5 p-3.5 rounded-2xl border border-zinc-800 bg-[#18181b]/70">
                  <div className="h-9 w-9 shrink-0 rounded-xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center border border-cyan-500/20" aria-hidden="true">
                    <Zap size={18} aria-hidden="true" />
                  </div>
                  <div>
                    <h3 className="text-xs font-black text-[#fafafa] uppercase tracking-wider">Acesso Instantâneo</h3>
                    <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">
                      Carregamento ultrarrápido em tela cheia, sem barra de endereços do navegador e sem distrações.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3.5 p-3.5 rounded-2xl border border-zinc-800 bg-[#18181b]/70">
                  <div className="h-9 w-9 shrink-0 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center border border-emerald-500/20" aria-hidden="true">
                    <WifiOff size={18} aria-hidden="true" />
                  </div>
                  <div>
                    <h3 className="text-xs font-black text-[#fafafa] uppercase tracking-wider">Operação Offline</h3>
                    <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">
                      Trabalhe e consulte inventários mesmo em áreas de galpão ou subsolo sem sinal de internet.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3.5 p-3.5 rounded-2xl border border-zinc-800 bg-[#18181b]/70">
                  <div className="h-9 w-9 shrink-0 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center border border-amber-500/20" aria-hidden="true">
                    <Bell size={18} aria-hidden="true" />
                  </div>
                  <div>
                    <h3 className="text-xs font-black text-[#fafafa] uppercase tracking-wider">Atalhos & Notificações</h3>
                    <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">
                      Acesso em um toque para Cadastro de Ativo, Leitor de QR Code, Ordens de Serviço e Service Desk.
                    </p>
                  </div>
                </div>
              </div>

              {/* Botão de instalação com progresso */}
              <div className="space-y-3 pt-2">
                <button
                  type="button"
                  onClick={() => startInstallWithProgress()}
                  className="w-full min-h-[44px] flex items-center justify-center gap-2 rounded-2xl bg-brand px-5 py-3.5 text-xs font-black uppercase tracking-widest text-brand-fg shadow-xl shadow-brand/25 hover:bg-brand-dark active:scale-[0.98] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-[#111113]"
                >
                  <Download size={16} aria-hidden="true" /> Instalar Aplicativo Nativo
                </button>

                <p className="text-xs text-center text-zinc-400 flex items-center justify-center gap-1.5">
                  <ShieldCheck size={14} aria-hidden="true" className="text-emerald-400" />
                  Instalação corporativa segura (~2MB) direto pelo navegador
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PWAInstallModal;
