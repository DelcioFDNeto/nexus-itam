// src/pages/AgentManager.jsx
// -----------------------------------------------------------------------------
// Agente ITAM & RMM: frota de maquinas inventariadas, acesso remoto ao vivo
// (substituto do AnyDesk), terminal remoto, fila de recepcao, instalador do
// executavel NexusAgent.exe, politicas e simulador.
// -----------------------------------------------------------------------------
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  Cpu,
  Inbox,
  Laptop,
  Loader2,
  Monitor,
  ShieldAlert,
  Wifi,
  WifiOff,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { useAssets } from '../hooks/useAssets';
import { useTenantSettings } from '../hooks/useTenantSettings';
import { migrateLegacyAgentToken } from '../services/tenantSecretService';
import { getAgentSubmissions, processAgentInbox } from '../services/agentService';
import {
  formatAccessId,
  isDeviceOnline,
  resolveSupportRequest,
  stripLegacyDeviceTokens,
  subscribeAgentDevices,
} from '../services/rmmService';
import { assertWithinLimit } from '../services/tenantService';
import { resolveAgentPolicy, summarizeFleet } from '../utils/agentInventory';
import { isRetired } from '../utils/assetStatus';
import FleetTab from '../components/agent/FleetTab';
import InboxTab from '../components/agent/InboxTab';
import InstallTab from '../components/agent/InstallTab';
import PoliciesTab from '../components/agent/PoliciesTab';
import SimulatorTab from '../components/agent/SimulatorTab';
import RemoteControlModal from '../components/agent/RemoteControlModal';

const TABS = [
  { id: 'frota', label: 'Frota & Acesso Remoto' },
  { id: 'fila', label: 'Fila' },
  { id: 'instalar', label: 'Instalar (.EXE / Scripts)' },
  { id: 'politicas', label: 'Políticas e segurança' },
  { id: 'simulador', label: 'Simulador' },
];

const Kpi = ({ icon: Icon, label, value, tone, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="text-left bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-4 shadow-sm flex items-center gap-3"
  >
    <span className={`p-2.5 rounded-xl ${tone}`}>
      <Icon size={18} />
    </span>
    <span>
      <span className="block text-2xl font-black text-gray-900 dark:text-white tabular-nums">{value}</span>
      <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {label}
      </span>
    </span>
  </button>
);

const AgentManager = () => {
  const { currentUser } = useAuth();
  const tenantId = currentUser?.tenantId;
  const { assets } = useAssets();
  const { settings } = useTenantSettings();
  const policy = resolveAgentPolicy(settings);
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.id === params.get('aba')) ? params.get('aba') : 'frota';
  const setTab = (id) => setParams(id === 'frota' ? {} : { aba: id }, { replace: true });

  const [agentToken, setAgentToken] = useState('');
  const [submissions, setSubmissions] = useState([]);
  const [liveDevices, setLiveDevices] = useState([]);
  const [loadingInbox, setLoadingInbox] = useState(true);
  const [processing, setProcessing] = useState(false);

  // Estado do Modal de Acesso Remoto / RMM
  const [remoteModal, setRemoteModal] = useState({
    open: false,
    device: null,
    asset: null,
    tab: 'screen',
  });

  const loadInbox = useCallback(async () => {
    if (!tenantId) return;
    setLoadingInbox(true);
    try {
      setSubmissions(await getAgentSubmissions(tenantId));
    } catch (error) {
      console.error(error);
      toast.error('Erro ao carregar a fila do agente.');
    } finally {
      setLoadingInbox(false);
    }
  }, [tenantId]);

  useEffect(() => {
    loadInbox();
  }, [loadInbox]);

  useEffect(() => {
    if (!tenantId) return undefined;
    const unsub = subscribeAgentDevices(tenantId, (devices) => {
      setLiveDevices(devices);
      stripLegacyDeviceTokens(devices);
    });
    return () => unsub();
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    migrateLegacyAgentToken(tenantId)
      .then((token) => setAgentToken(token || ''))
      .catch((error) => console.error('Falha ao ler o token do agente:', error));
  }, [tenantId]);

  const fleet = useMemo(
    () => summarizeFleet(assets, { staleDays: policy.staleDays, isRetired }),
    [assets, policy.staleDays]
  );
  const pending = submissions.filter((s) => s.status === 'pending' || s.status === 'error').length;
  const liveOnlineCount = useMemo(
    () => liveDevices.filter((d) => isDeviceOnline(d)).length,
    [liveDevices]
  );
  const openSupportRequests = useMemo(
    () => liveDevices.filter((d) => d.supportRequest?.status === 'open'),
    [liveDevices]
  );

  const processNow = async () => {
    setProcessing(true);
    try {
      const summary = await processAgentInbox({
        tenantId,
        user: currentUser?.email || 'Agente ITAM',
        canCreate: () => assertWithinLimit(currentUser, 'assets', 1),
      });
      toast[summary.errors.length ? 'error' : 'success'](
        summary.processed || summary.errors.length
          ? `${summary.processed} processado(s): ${summary.created} novo(s), ${summary.updated} atualizado(s)${
              summary.errors.length ? `, ${summary.errors.length} com erro` : ''
            }.`
          : 'Fila vazia.'
      );
      await loadInbox();
    } catch (error) {
      toast.error(error.message || 'Erro ao processar a fila.');
    } finally {
      setProcessing(false);
    }
  };

  const handleOpenRemote = (device, asset = null, initialTab = 'screen') => {
    setRemoteModal({
      open: true,
      device,
      asset,
      tab: initialTab,
    });
  };

  return (
    <div className="max-w-7xl mx-auto pb-24 space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-gradient-to-br from-indigo-500 to-indigo-600 text-white rounded-xl shadow-lg shadow-indigo-500/20">
            <Cpu size={26} />
          </div>
          <div>
            <h1 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">
              Agente ITAM & Acesso Remoto
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Controle remoto em tempo real (substituto AnyDesk), terminal PowerShell, monitoramento de recursos e inventário automático.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-[11px] font-black uppercase tracking-wider ${
              settings.autoAcceptEnabled
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
                : 'border-gray-200 bg-white text-gray-500 dark:border-slate-700 dark:bg-slate-800'
            }`}
          >
            <Zap size={13} /> Aceite automático {settings.autoAcceptEnabled ? 'ligado' : 'desligado'}
          </span>
          <button
            type="button"
            onClick={processNow}
            disabled={processing || !pending}
            className="px-4 py-2.5 rounded-xl bg-brand text-white text-xs font-black uppercase tracking-wider flex items-center gap-2 shadow-md shadow-brand/30 disabled:opacity-40 disabled:shadow-none"
          >
            {processing ? <Loader2 size={15} className="animate-spin" /> : <Inbox size={15} />} Processar fila (
            {pending})
          </button>
        </div>
      </div>

      {/* Alertas de Chamados de Suporte Abertos pelo Executavel NexusAgent.exe */}
      {openSupportRequests.length > 0 && (
        <div className="space-y-2">
          {openSupportRequests.map((dev) => (
            <div
              key={dev.id}
              className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-800 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-sm"
            >
              <div className="flex items-start gap-3">
                <div className="p-2.5 rounded-xl bg-amber-500 text-slate-950 shrink-0">
                  <AlertTriangle size={18} />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-black text-sm text-amber-950 dark:text-amber-100">
                      Solicitação de Suporte em Tempo Real • {dev.internalId || dev.hostname}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-amber-200/80 dark:bg-amber-900 text-amber-900 dark:text-amber-200 font-mono text-xs font-bold">
                      ID: {formatAccessId(dev)}
                    </span>
                    <span className="text-xs font-bold text-amber-700 dark:text-amber-300">
                      ({dev.supportRequest?.priority || 'Normal'})
                    </span>
                  </div>
                  <p className="text-xs text-amber-900 dark:text-amber-200 mt-0.5">
                    Colaborador <strong>{dev.supportRequest?.user || dev.loggedUser}</strong>: &ldquo;
                    {dev.supportRequest?.message}&rdquo;
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handleOpenRemote(dev, null, 'screen')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-black text-xs shadow-sm"
                >
                  <Monitor size={14} /> Atender via Acesso Remoto
                </button>
                <button
                  type="button"
                  onClick={() =>
                    resolveSupportRequest({
                      tenantId,
                      deviceKey: dev.deviceKey,
                      resolvedBy: currentUser?.email || 'TI',
                    })
                  }
                  className="px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 font-bold text-xs"
                >
                  Concluir
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi
          icon={Wifi}
          label="Online Ao Vivo (.EXE)"
          value={liveOnlineCount}
          tone="text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300"
          onClick={() => setTab('frota')}
        />
        <Kpi
          icon={Laptop}
          label="Com agente"
          value={Math.max(fleet.managed, liveDevices.length)}
          tone="text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 dark:text-indigo-300"
          onClick={() => setTab('frota')}
        />
        <Kpi
          icon={Activity}
          label="Comunicaram em 24h"
          value={Math.max(fleet.online24h, liveOnlineCount)}
          tone="text-cyan-600 bg-cyan-50 dark:bg-cyan-950/40 dark:text-cyan-300"
          onClick={() => setTab('frota')}
        />
        <Kpi
          icon={WifiOff}
          label={`Sem comunicação (+${policy.staleDays}d)`}
          value={fleet.stale}
          tone="text-rose-600 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-300"
          onClick={() => setTab('frota')}
        />
        <Kpi
          icon={ShieldAlert}
          label={`Com alertas (${fleet.critical} críticos)`}
          value={fleet.withAlerts}
          tone="text-amber-600 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300"
          onClick={() => setTab('frota')}
        />
        <Kpi
          icon={Inbox}
          label="Na fila"
          value={pending}
          tone="text-blue-600 bg-blue-50 dark:bg-blue-950/40 dark:text-blue-300"
          onClick={() => setTab('fila')}
        />
      </div>

      <div
        className="flex gap-1 overflow-x-auto scrollbar-hide border-b border-gray-200 dark:border-slate-700"
        role="tablist"
        aria-label="Seções do agente"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-bold whitespace-nowrap border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? 'border-brand text-brand'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
            }`}
          >
            {t.label}
            {t.id === 'fila' && pending ? ` (${pending})` : ''}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'frota' && (
          <FleetTab
            assets={assets}
            liveDevices={liveDevices}
            staleDays={policy.staleDays}
            onOpenRemote={handleOpenRemote}
          />
        )}
        {tab === 'fila' && (
          <InboxTab
            tenantId={tenantId}
            currentUser={currentUser}
            submissions={submissions}
            loading={loadingInbox}
            onReload={loadInbox}
          />
        )}
        {tab === 'instalar' && <InstallTab tenantId={tenantId} agentToken={agentToken} />}
        {tab === 'politicas' && (
          <PoliciesTab
            tenantId={tenantId}
            currentUser={currentUser}
            agentToken={agentToken}
            onTokenChange={setAgentToken}
          />
        )}
        {tab === 'simulador' && <SimulatorTab tenantId={tenantId} onQueued={loadInbox} />}
      </div>

      <RemoteControlModal
        isOpen={remoteModal.open}
        onClose={() => setRemoteModal((prev) => ({ ...prev, open: false }))}
        tenantId={tenantId}
        initialDevice={remoteModal.device}
        asset={remoteModal.asset}
        currentUser={currentUser}
        initialTab={remoteModal.tab}
      />
    </div>
  );
};

export default AgentManager;
