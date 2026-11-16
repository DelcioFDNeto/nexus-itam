// src/components/settings/AppSettingsSection.jsx
// -----------------------------------------------------------------------------
// Secao de Informacoes do Aplicativo, Cache e Atualizacoes do PWA
//
// Permite ao usuario verificar atualizacoes do sistema e limpar o cache
// local caso note algum comportamento desatualizado, sem ter que desinstalar
// o PWA do seu celular ou computador.
// -----------------------------------------------------------------------------
import React from 'react';
import {
  Smartphone,
  RefreshCw,
  Trash2,
  CheckCircle,
  Download,
  Wifi,
  Clock,
  Sparkles,
  Info,
  ShieldCheck,
} from 'lucide-react';
import { usePWA } from '../../contexts/PWAContext';
import { useConfirm } from '../ConfirmDialog';
import { Card, SectionHeader } from './settingsUi';
import { buttonPrimaryClass, buttonSecondaryClass } from './settingsStyles';

const AppSettingsSection = () => {
  const {
    appVersion,
    needRefresh,
    isChecking,
    lastChecked,
    isStandalone,
    canInstall,
    checkForUpdates,
    applyUpdate,
    forceHardReset,
    installApp,
    setIsInstallModalOpen,
  } = usePWA();
  const confirm = useConfirm();

  const handleManualCheck = () => {
    checkForUpdates({ silent: false });
  };

  const handleHardReset = async () => {
    const ok = await confirm({
      title: 'Forçar Atualização e Limpar Cache',
      message:
        'Isso irá descarregar caches temporários e registrar a versão mais recente do servidor imediatamente. Nenhum dado cadastrado da sua empresa será perdido. Deseja continuar?',
      confirmLabel: 'Limpar e Atualizar',
      danger: true,
    });
    if (ok) {
      forceHardReset();
    }
  };

  const formattedLastChecked = lastChecked
    ? new Date(lastChecked).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—';

  return (
    <div className="space-y-6">
      <SectionHeader
        icon={Smartphone}
        title="Aplicativo & Atualizações (PWA)"
        description="Gerencie o funcionamento no seu dispositivo, verifique novas versões e limpe caches locais."
      />

      <Card icon={Smartphone} title="Diagnóstico do dispositivo" subtitle="Versão instalada e estado da conexão">
        {/* Banner de Atualização Disponível (se houver) */}
        {needRefresh && (
          <div className="rounded-2xl border border-brand/40 bg-brand/5 p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand text-brand-fg shadow-sm">
                  <Sparkles size={20} aria-hidden="true" />
                </div>
                <div>
                  <h4 className="text-sm font-black text-slate-900 dark:text-[#fafafa]">
                    Nova versão pronta para ser aplicada!
                  </h4>
                  <p className="mt-0.5 text-xs text-slate-600 dark:text-zinc-300">
                    O download das melhorias já foi concluído em segundo plano. Toque no botão para recarregar o app.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={applyUpdate}
                className={`${buttonPrimaryClass} shrink-0 min-h-[44px] text-xs font-black uppercase tracking-wider`}
              >
                <RefreshCw size={14} aria-hidden="true" /> Atualizar Agora
              </button>
            </div>
          </div>
        )}

        {/* Diagnóstico do Dispositivo */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 dark:border-zinc-800 dark:bg-zinc-900/60 p-4">
            <div className="flex items-center gap-2 text-slate-500 dark:text-zinc-400 text-xs font-bold uppercase tracking-wider mb-1">
              <ShieldCheck size={14} className="text-brand-aa" aria-hidden="true" /> Versão da Plataforma
            </div>
            <p className="text-lg font-black text-slate-900 dark:text-[#fafafa] font-mono tabular-nums">
              v{appVersion}
            </p>
            <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
              Build de produção otimizada
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 dark:border-zinc-800 dark:bg-zinc-900/60 p-4">
            <div className="flex items-center gap-2 text-slate-500 dark:text-zinc-400 text-xs font-bold uppercase tracking-wider mb-1">
              <Smartphone size={14} className="text-sky-600 dark:text-sky-400" aria-hidden="true" /> Modo de Execução
            </div>
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold ${
                isStandalone
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300'
              }`}>
                <CheckCircle size={12} aria-hidden="true" />
                {isStandalone ? 'PWA Instalado (App)' : 'Navegador Web'}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">
              {isStandalone ? 'Tela cheia nativa sem barra de navegação' : 'Acessado via aba do navegador'}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 dark:border-zinc-800 dark:bg-zinc-900/60 p-4 sm:col-span-2 lg:col-span-1">
            <div className="flex items-center gap-2 text-slate-500 dark:text-zinc-400 text-xs font-bold uppercase tracking-wider mb-1">
              <Clock size={14} className="text-amber-500" aria-hidden="true" /> Última Verificação
            </div>
            <p className="text-lg font-black text-slate-900 dark:text-[#fafafa] font-mono tabular-nums">
              {formattedLastChecked}
            </p>
            <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5 flex items-center gap-1">
              <Wifi size={12} className="text-emerald-500" aria-hidden="true" /> Conectado ao servidor
            </p>
          </div>
        </div>
      </Card>

      {/* Ações de Atualização e Resgate */}
      <Card icon={RefreshCw} title="Ações de atualização" subtitle="Verificação manual, instalação e recuperação de cache">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleManualCheck}
            disabled={isChecking}
            className={`${buttonSecondaryClass} min-h-[44px]`}
          >
            <RefreshCw size={14} className={isChecking ? 'animate-spin text-brand-aa' : ''} aria-hidden="true" />
            {isChecking ? 'Verificando…' : 'Verificar Atualizações Agora'}
          </button>

          {canInstall && !isStandalone && (
            <button
              type="button"
              onClick={installApp}
              className={`${buttonPrimaryClass} min-h-[44px] text-xs font-black uppercase tracking-wider`}
            >
              <Download size={14} aria-hidden="true" /> Instalar Aplicativo no Dispositivo
            </button>
          )}

          {isStandalone && (
            <button
              type="button"
              onClick={() => setIsInstallModalOpen(true)}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 min-h-[44px] text-xs font-bold text-emerald-700 dark:text-emerald-300 transition-colors hover:bg-emerald-500/20 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <Smartphone size={14} aria-hidden="true" /> Diagnóstico & Cache do App
            </button>
          )}

          <button
            type="button"
            onClick={handleHardReset}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50/70 px-4 min-h-[44px] text-xs font-bold text-rose-700 transition-colors hover:bg-rose-100 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-300 dark:hover:bg-rose-950/40"
            title="Limpa caches residuais e força recarregamento do servidor sem precisar desinstalar o PWA"
          >
            <Trash2 size={14} aria-hidden="true" /> Forçar Atualização e Limpar Cache
          </button>
        </div>

        <div className="rounded-xl bg-slate-50 dark:bg-zinc-900/60 border border-slate-200/80 dark:border-zinc-800 p-3.5 flex items-start gap-2.5 text-xs text-slate-600 dark:text-zinc-300">
          <Info size={16} className="text-brand-aa shrink-0 mt-0.5" aria-hidden="true" />
          <p>
            O <strong>Nexus ITAM</strong> verifica novidades e atualiza automaticamente em segundo plano.
            Caso note que uma nova funcionalidade recém-lançada ainda não apareceu no seu dispositivo, basta clicar em <strong>&ldquo;Verificar Atualizações&rdquo;</strong> ou em <strong>&ldquo;Forçar Atualização e Limpar Cache&rdquo;</strong>. Você nunca precisa desinstalar e reinstalar o aplicativo da sua tela de início.
          </p>
        </div>
      </Card>
    </div>
  );
};

export default AppSettingsSection;
