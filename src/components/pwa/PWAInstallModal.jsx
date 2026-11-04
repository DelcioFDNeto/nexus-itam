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
import React, { useEffect, useCallback } from 'react';
import {
  X,
  Smartphone,
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

const INSTALL_STEPS = [
  { id: 1, title: 'Compatibilidade & Ambiente', desc: 'Verificando arquitetura PWA e Service Worker' },
  { id: 2, title: 'Pacote Offline Essencial', desc: 'Baixando rotas de inventário e assets para cache' },
  { id: 3, title: 'Configuração do Atalho Nativo', desc: 'Registrando ícone adaptativo e atalhos rápidos' },
  { id: 4, title: 'Ativação & Conclusão', desc: 'App pronto para execução em tela cheia com sensação nativa' },
];

const PWAInstallModal = () => {
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

  const handleClose = useCallback(() => {
    // Permite fechar se não estiver em instalação crítica ou se o usuário cancelar
    setIsInstallModalOpen(false);
  }, [setIsInstallModalOpen]);

  // Fecha no ESC
  useEffect(() => {
    if (!isInstallModalOpen) return undefined;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !installProgress.isInstalling) {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isInstallModalOpen, installProgress.isInstalling, handleClose]);

  if (!isInstallModalOpen) return null;

  const formattedUsage = storageDiagnostics?.usage
    ? (storageDiagnostics.usage / (1024 * 1024)).toFixed(1)
    : null;
  const formattedQuota = storageDiagnostics?.quota
    ? (storageDiagnostics.quota / (1024 * 1024)).toFixed(0)
    : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pwa-install-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && !installProgress.isInstalling) {
          handleClose();
        }
      }}
    >
      <div
        className="w-full sm:max-w-lg bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] text-slate-100 transition-all duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header com identidade executiva */}
        <div className="relative px-6 pt-6 pb-4 border-b border-slate-800/80 bg-slate-900/90">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-2xl bg-gradient-to-tr from-brand to-cyan-500 p-0.5 shadow-lg shadow-brand/20 flex items-center justify-center">
                <img
                  src="/pwa-192x192.png"
                  alt="Nexus ITAM"
                  className="h-full w-full object-cover rounded-[14px]"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 id="pwa-install-title" className="text-base sm:text-lg font-black tracking-tight text-white">
                    Nexus ITAM Mobile
                  </h3>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-brand/10 text-brand border border-brand/20">
                    <Sparkles size={10} /> Nativo
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  {isStandalone ? 'Aplicativo instalado e ativo' : 'Experiência de alta performance para smartphone'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleClose}
              disabled={installProgress.isInstalling}
              aria-label="Fechar janela"
              className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors disabled:opacity-30 disabled:pointer-events-none"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Corpo do Modal */}
        <div className="p-6 space-y-6 overflow-y-auto">
          {/* CASO 1: APLICATIVO JÁ INSTALADO (STANDALONE) */}
          {isStandalone ? (
            <div className="space-y-5">
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 sm:p-5 flex items-start gap-3.5">
                <div className="h-10 w-10 shrink-0 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                  <CheckCircle2 size={22} />
                </div>
                <div>
                  <h4 className="text-sm font-black text-emerald-300">
                    Aplicativo Instalado e Sincronizado
                  </h4>
                  <p className="mt-1 text-xs text-slate-300 leading-relaxed">
                    Você já está utilizando a versão nativa do <strong>Nexus ITAM</strong> com inicialização instantânea, atalhos rápidos e suporte a leitura de QR Code.
                  </p>
                </div>
              </div>

              {/* Status de Armazenamento e Cache */}
              <div className="rounded-2xl border border-slate-800 bg-slate-800/40 p-4 space-y-3">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <HardDrive size={14} className="text-brand" /> Armazenamento Offline
                  </span>
                  <span className="text-white font-mono">
                    {formattedUsage ? `${formattedUsage} MB` : 'Ativo'}
                    {formattedQuota ? ` / ${formattedQuota} MB` : ''}
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-500"
                    style={{ width: `${Math.max(8, storageDiagnostics?.percentage || 12)}%` }}
                  />
                </div>
                <p className="text-[11px] text-slate-400">
                  Banco de dados local e interface estão prontos para operações em campo e auditorias offline.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => checkForUpdates({ silent: false })}
                  disabled={isChecking}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-xs font-bold text-white hover:bg-slate-700 transition-colors"
                >
                  <RefreshCw size={14} className={isChecking ? 'animate-spin text-brand' : ''} />
                  {isChecking ? 'Verificando...' : 'Verificar Atualizações'}
                </button>
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex-1 rounded-xl bg-slate-800 hover:bg-slate-700 px-4 py-3 text-xs font-bold text-white transition-colors"
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
                  <span className="text-slate-300">
                    {installProgress.isComplete ? 'Instalação Concluída' : 'Preparando Aplicativo Nativo'}
                  </span>
                  <span className="text-brand font-mono text-sm">{installProgress.progress}%</span>
                </div>
                <div className="h-3 w-full rounded-full bg-slate-800 overflow-hidden p-0.5 border border-slate-700/50">
                  <div
                    role="progressbar"
                    aria-valuenow={installProgress.progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    className="h-full rounded-full bg-gradient-to-r from-brand via-indigo-500 to-cyan-400 transition-all duration-500 ease-out"
                    style={{ width: `${installProgress.progress}%` }}
                  />
                </div>
                <p className="text-xs text-slate-400 flex items-center gap-1.5 pt-1">
                  {installProgress.isInstalling && <Loader2 size={13} className="animate-spin text-brand" />}
                  {installProgress.isComplete && <CheckCircle2 size={13} className="text-emerald-400" />}
                  {installProgress.statusText}
                </p>
              </div>

              {/* Erro eventual */}
              {installProgress.error && (
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 flex items-start gap-2.5 text-xs text-rose-300">
                  <AlertCircle size={16} className="shrink-0 mt-0.5 text-rose-400" />
                  <div>
                    <p className="font-bold">Aviso no processo:</p>
                    <p className="mt-0.5 text-rose-200">{installProgress.error}</p>
                  </div>
                </div>
              )}

              {/* Lista das 4 etapas visuais */}
              <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-800/40 p-4">
                {INSTALL_STEPS.map((step) => {
                  const isDone =
                    installProgress.isComplete ||
                    installProgress.step > step.id ||
                    (installProgress.step === 4 && step.id === 4);
                  const isCurrent = installProgress.step === step.id && installProgress.isInstalling;

                  return (
                    <div
                      key={step.id}
                      className={`flex items-start gap-3 p-2 rounded-xl transition-colors ${
                        isCurrent
                          ? 'bg-brand/10 border border-brand/20'
                          : isDone
                            ? 'text-slate-300'
                            : 'text-slate-500 opacity-60'
                      }`}
                    >
                      <div className="mt-0.5 shrink-0">
                        {isDone ? (
                          <div className="h-5 w-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                            <CheckCircle2 size={14} />
                          </div>
                        ) : isCurrent ? (
                          <div className="h-5 w-5 rounded-full bg-brand/20 text-brand flex items-center justify-center">
                            <Loader2 size={14} className="animate-spin" />
                          </div>
                        ) : (
                          <div className="h-5 w-5 rounded-full border border-slate-700 flex items-center justify-center text-[10px] font-mono text-slate-500">
                            {step.id}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p
                          className={`text-xs font-bold ${
                            isCurrent ? 'text-white' : isDone ? 'text-slate-200' : 'text-slate-400'
                          }`}
                        >
                          {step.title}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5 leading-tight">{step.desc}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Guia Adicional iOS se aplicável */}
              {isIOS && (
                <div className="rounded-2xl border border-cyan-500/30 bg-cyan-950/20 p-4 space-y-2.5">
                  <h4 className="text-xs font-black uppercase tracking-wider text-cyan-300 flex items-center gap-1.5">
                    <Share2 size={14} /> Finalizar Fixação no Apple iOS
                  </h4>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    1. No Safari, toque no botão <strong>Compartilhar</strong> (ícone <Share2 size={12} className="inline mx-0.5" /> na barra inferior).
                  </p>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    2. Deslize e escolha <strong>&ldquo;Adicionar à Tela de Início&rdquo;</strong> (<PlusSquare size={12} className="inline mx-0.5" />).
                  </p>
                  <p className="text-xs text-slate-300 leading-relaxed">
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
                      className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-brand px-4 py-3 text-xs font-black uppercase tracking-wider text-white shadow-lg shadow-brand/20 hover:bg-brand-dark transition-all"
                    >
                      <RefreshCw size={14} /> Tentar Novamente
                    </button>
                    <button
                      type="button"
                      onClick={handleClose}
                      className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-xs font-bold text-slate-300 hover:bg-slate-700"
                    >
                      Fechar
                    </button>
                  </>
                ) : installProgress.isComplete ? (
                  <button
                    type="button"
                    onClick={handleClose}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3.5 text-xs font-black uppercase tracking-wider text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-500 transition-all"
                  >
                    <CheckCircle2 size={16} /> Tudo Pronto! Concluir
                  </button>
                ) : (
                  <p className="w-full text-center text-xs text-slate-400 italic">
                    Aguarde enquanto o sistema prepara o atalho nativo e assets offline...
                  </p>
                )}
              </div>
            </div>
          ) : (
            /* CASO 3: APRESENTAÇÃO DOS BENEFÍCIOS NATIVOS E BOTÃO DE INSTALAR */
            <div className="space-y-6">
              {/* Vantagens mobile nativo */}
              <div className="grid grid-cols-1 gap-3">
                <div className="flex items-start gap-3.5 p-3.5 rounded-2xl border border-slate-800 bg-slate-800/30">
                  <div className="h-9 w-9 shrink-0 rounded-xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center border border-cyan-500/20">
                    <Zap size={18} />
                  </div>
                  <div>
                    <h4 className="text-xs font-black text-white uppercase tracking-wider">Acesso Instantâneo</h4>
                    <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                      Carregamento ultrarrápido em tela cheia, sem barra de endereços do navegador e sem distrações.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3.5 p-3.5 rounded-2xl border border-slate-800 bg-slate-800/30">
                  <div className="h-9 w-9 shrink-0 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center border border-emerald-500/20">
                    <WifiOff size={18} />
                  </div>
                  <div>
                    <h4 className="text-xs font-black text-white uppercase tracking-wider">Operação Offline</h4>
                    <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                      Trabalhe e consulte inventários mesmo em áreas de galpão ou subsolo sem sinal de internet.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3.5 p-3.5 rounded-2xl border border-slate-800 bg-slate-800/30">
                  <div className="h-9 w-9 shrink-0 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center border border-purple-500/20">
                    <Bell size={18} />
                  </div>
                  <div>
                    <h4 className="text-xs font-black text-white uppercase tracking-wider">Atalhos & Notificações</h4>
                    <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
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
                  className="w-full flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-brand to-cyan-600 px-5 py-4 text-xs font-black uppercase tracking-widest text-white shadow-xl shadow-brand/25 hover:from-brand-dark hover:to-cyan-700 active:scale-[0.99] transition-all"
                >
                  <Download size={16} /> Instalar Aplicativo Nativo
                </button>

                <p className="text-[11px] text-center text-slate-400 flex items-center justify-center gap-1.5">
                  <ShieldCheck size={13} className="text-emerald-400" />
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
