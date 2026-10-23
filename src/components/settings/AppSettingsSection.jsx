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
    <Card>
      <SectionHeader
        icon={Smartphone}
        title="Aplicativo & Atualizações (PWA)"
        subtitle="Gerencie o funcionamento no seu dispositivo, verifique novas versões e limpe caches locais."
      />

      <div className="space-y-6 pt-2">
        {/* Banner de Atualização Disponível (se houver) */}
        {needRefresh && (
          <div className="rounded-2xl border border-indigo-500/40 bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-indigo-500/10 p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-md shadow-indigo-600/30">
                  <Sparkles size={20} />
                </div>
                <div>
                  <h4 className="text-sm font-black text-gray-900 dark:text-white">
                    Nova versão pronta para ser aplicada!
                  </h4>
                  <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-300">
                    O download das melhorias já foi concluído em segundo plano. Toque no botão para recarregar o app.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={applyUpdate}
                className="flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-black uppercase tracking-wider text-white shadow-md shadow-indigo-600/30 hover:bg-indigo-700 active:scale-95"
              >
                <RefreshCw size={14} /> Atualizar Agora
              </button>
            </div>
          </div>
        )}

        {/* Diagnóstico do Dispositivo */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="rounded-2xl border border-gray-100 bg-gray-50/80 dark:border-slate-800 dark:bg-slate-900/60 p-4">
            <div className="flex items-center gap-2 text-gray-400 dark:text-gray-500 text-[10px] font-black uppercase tracking-wider mb-1">
              <ShieldCheck size={14} className="text-brand" /> Versão da Plataforma
            </div>
            <p className="text-lg font-black text-gray-900 dark:text-white font-mono">
              v{appVersion}
            </p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
              Build de produção otimizada
            </p>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-gray-50/80 dark:border-slate-800 dark:bg-slate-900/60 p-4">
            <div className="flex items-center gap-2 text-gray-400 dark:text-gray-500 text-[10px] font-black uppercase tracking-wider mb-1">
              <Smartphone size={14} className="text-cyan-500" /> Modo de Execução
            </div>
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold ${
                isStandalone
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
              }`}>
                <CheckCircle size={12} />
                {isStandalone ? 'PWA Instalado (App)' : 'Navegador Web'}
              </span>
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
              {isStandalone ? 'Tela cheia nativa sem barra de navegação' : 'Acessado via aba do navegador'}
            </p>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-gray-50/80 dark:border-slate-800 dark:bg-slate-900/60 p-4 sm:col-span-2 lg:col-span-1">
            <div className="flex items-center gap-2 text-gray-400 dark:text-gray-500 text-[10px] font-black uppercase tracking-wider mb-1">
              <Clock size={14} className="text-amber-500" /> Última Verificação
            </div>
            <p className="text-lg font-black text-gray-900 dark:text-white font-mono">
              {formattedLastChecked}
            </p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-1">
              <Wifi size={11} className="text-emerald-500" /> Conectado ao servidor
            </p>
          </div>
        </div>

        {/* Ações de Atualização e Resgate */}
        <div className="rounded-2xl border border-gray-100 dark:border-slate-800 p-5 space-y-4">
          <h4 className="text-xs font-black uppercase tracking-wider text-gray-700 dark:text-gray-200">
            Ações de Atualização
          </h4>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleManualCheck}
              disabled={isChecking}
              className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-xs font-bold text-gray-700 shadow-sm transition-all hover:border-brand/40 hover:text-brand dark:border-slate-700 dark:bg-slate-800 dark:text-gray-200 dark:hover:border-slate-600 disabled:opacity-50"
            >
              <RefreshCw size={14} className={isChecking ? 'animate-spin text-brand' : ''} />
              {isChecking ? 'Verificando…' : 'Verificar Atualizações Agora'}
            </button>

            {canInstall && !isStandalone && (
              <button
                type="button"
                onClick={installApp}
                className="flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-xs font-black uppercase tracking-wider text-white shadow-md shadow-brand/20 transition-all hover:bg-brand-dark active:scale-95"
              >
                <Download size={14} /> Instalar Aplicativo no Dispositivo
              </button>
            )}

            <button
              type="button"
              onClick={handleHardReset}
              className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50/50 px-4 py-2.5 text-xs font-bold text-rose-700 transition-all hover:bg-rose-100 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-300 dark:hover:bg-rose-950/40"
              title="Limpa caches residuais e força recarregamento do servidor sem precisar desinstalar o PWA"
            >
              <Trash2 size={14} /> Forçar Atualização e Limpar Cache
            </button>
          </div>

          <div className="rounded-xl bg-gray-50 dark:bg-slate-900/50 p-3.5 flex items-start gap-2.5 text-xs text-gray-500 dark:text-gray-400">
            <Info size={16} className="text-brand shrink-0 mt-0.5" />
            <p>
              O <strong>Nexus ITAM</strong> verifica novidades e atualiza automaticamente em segundo plano.
              Caso note que uma nova funcionalidade recém-lançada ainda não apareceu no seu dispositivo, basta clicar em <strong>&ldquo;Verificar Atualizações&rdquo;</strong> ou em <strong>&ldquo;Forçar Atualização e Limpar Cache&rdquo;</strong>. Você nunca precisa desinstalar e reinstalar o aplicativo da sua tela de início.
            </p>
          </div>
        </div>
      </div>
    </Card>
  );
};

export default AppSettingsSection;
