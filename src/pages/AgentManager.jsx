// src/pages/AgentManager.jsx
// -----------------------------------------------------------------------------
// Agente ITAM, RMM & NexusDesk: frota de maquinas inventariadas, acesso remoto
// ao vivo (NexusDesk desktop e mobile), atualizacao OTA remota, terminal
// PowerShell, fila de recepcao, instalador do NexusAgent.exe, politicas e simulador.
// -----------------------------------------------------------------------------
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { useAssets } from '../hooks/useAssets';
import { useTenantSettings } from '../hooks/useTenantSettings';
import { migrateLegacyAgentToken } from '../services/tenantSecretService';
import {
  getAgentSubmissions,
  processAgentInbox,
  subscribeAgentSubmissions,
} from '../services/agentService';
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
  { id: 'frota', label: 'Frota & NexusDesk' },
  { id: 'fila', label: 'Fila' },
  { id: 'instalar', label: 'Instalar & Atualizar (.EXE)' },
  { id: 'politicas', label: 'Políticas e segurança' },
  { id: 'simulador', label: 'Simulador' },
];

const Kpi = ({ icon: Icon, label, value, tone, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="min-h-[44px] text-left bg-white dark:bg-[#111113] rounded-xl border border-slate-200/90 dark:border-zinc-800 p-3.5 shadow-sm flex items-center gap-3 transition-colors active:scale-[0.98] hover:border-slate-300 dark:hover:border-zinc-700 hover:bg-slate-50/50 dark:hover:bg-[#18181b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
  >
    <span className={`p-2 rounded-lg shrink-0 ${tone}`}>
      <Icon size={17} aria-hidden="true" />
    </span>
    <div className="min-w-0">
      <span className="block text-xl md:text-2xl font-bold text-slate-900 dark:text-[#fafafa] tabular-nums">{value}</span>
      <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
        {label}
      </span>
    </div>
  </button>
);

const AgentManager = () => {
  const { currentUser } = useAuth();
  const tenantId = currentUser?.tenantId;
  const { assets } = useAssets();
  const { settings } = useTenantSettings();
  const policy = resolveAgentPolicy(settings);
  const autoAcceptEnabled = settings?.autoAcceptEnabled !== false;
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.id === params.get('aba')) ? params.get('aba') : 'frota';
  const setTab = (id) => setParams(id === 'frota' ? {} : { aba: id }, { replace: true });
  const tabRefs = useRef({});

  const handleTabKeyDown = (event, currentIndex) => {
    let nextIndex = null;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = TABS.length - 1;
    if (nextIndex !== null) {
      event.preventDefault();
      const targetTab = TABS[nextIndex];
      setTab(targetTab.id);
      tabRefs.current[targetTab.id]?.focus();
    }
  };

  const [agentToken, setAgentToken] = useState('');
  const [submissions, setSubmissions] = useState([]);
  const [liveDevices, setLiveDevices] = useState([]);
  const [loadingInbox, setLoadingInbox] = useState(true);
  const [processing, setProcessing] = useState(false);

  // Estado do Modal de Acesso Remoto NexusDesk / RMM
  const [remoteModal, setRemoteModal] = useState({
    open: false,
    device: null,
    asset: null,
    tab: 'screen',
  });

  const inboxReqSeqRef = useRef(0);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadInbox = useCallback(async () => {
    if (!tenantId) {
      setSubmissions([]);
      setLoadingInbox(false);
      return;
    }
    const reqSeq = ++inboxReqSeqRef.current;
    setLoadingInbox(true);
    try {
      const items = await getAgentSubmissions(tenantId);
      if (!isMountedRef.current || reqSeq !== inboxReqSeqRef.current) return;
      setSubmissions(items);
    } catch (error) {
      if (!isMountedRef.current || reqSeq !== inboxReqSeqRef.current) return;
      console.error(error);
      toast.error('Erro ao carregar a fila do agente.');
    } finally {
      if (isMountedRef.current && reqSeq === inboxReqSeqRef.current) {
        setLoadingInbox(false);
      }
    }
  }, [tenantId]);

  useEffect(() => {
    loadInbox();
    if (!tenantId) return undefined;
    let active = true;
    const unsub = subscribeAgentSubmissions(tenantId, (items) => {
      if (!active) return;
      inboxReqSeqRef.current += 1;
      setSubmissions(items);
      setLoadingInbox(false);
    });
    return () => {
      active = false;
      inboxReqSeqRef.current += 1;
      if (typeof unsub === 'function') unsub();
    };
  }, [loadInbox, tenantId]);

  useEffect(() => {
    if (!tenantId) return undefined;
    const unsub = subscribeAgentDevices(tenantId, (devices) => {
      setLiveDevices(devices);
      stripLegacyDeviceTokens(devices);
    });
    return () => unsub();
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) {
      setAgentToken('');
      return undefined;
    }
    let active = true;
    migrateLegacyAgentToken(tenantId)
      .then((token) => {
        if (active) setAgentToken(token || '');
      })
      .catch((error) => {
        if (active) console.error('Falha ao ler o token do agente:', error);
      });
    return () => {
      active = false;
    };
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

  const handleResolveSupport = async (dev) => {
    try {
      await resolveSupportRequest({
        tenantId,
        deviceKey: dev.deviceKey,
        resolvedBy: currentUser?.email || 'TI',
      });
      toast.success('Solicitação de suporte concluída.');
    } catch (error) {
      console.error(error);
      toast.error(error?.message || 'Não foi possível concluir a solicitação de suporte.');
    }
  };

  return (
    <div className="max-w-7xl mx-auto pb-24 space-y-6">
      <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white dark:bg-[#111113] border border-slate-200/90 dark:border-zinc-800 rounded-xl p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-brand/10 border border-brand/20 text-brand-aa flex items-center justify-center shrink-0">
            <Cpu size={22} aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-[#fafafa] tracking-tight">
              Agente ITAM & NexusDesk
            </h1>
            <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
              Acesso remoto seguro NexusDesk (desktop e mobile), atualização remota OTA e inventário automático de hardware.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex min-h-[44px] items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold ${
              autoAcceptEnabled
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
                : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-zinc-700 dark:bg-[#18181b] dark:text-zinc-300'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${autoAcceptEnabled ? 'bg-emerald-500' : 'bg-slate-400'}`} />
            <span>Aceite automático {autoAcceptEnabled ? 'ligado' : 'desligado'}</span>
          </span>
          <button
            type="button"
            onClick={processNow}
            disabled={processing || !pending}
            className="min-h-[44px] px-3.5 py-2 rounded-lg bg-brand hover:bg-brand-dark text-brand-fg text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-40 tabular-nums"
          >
            {processing ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Inbox size={14} aria-hidden="true" />}
            <span>Processar fila ({pending})</span>
          </button>
        </div>
      </header>

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
                  <AlertTriangle size={18} aria-hidden="true" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-black text-sm text-amber-950 dark:text-amber-100">
                      Solicitação de Suporte em Tempo Real • {dev.internalId || dev.hostname}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-amber-200/80 dark:bg-amber-900 text-amber-900 dark:text-amber-200 font-mono text-xs font-bold">
                      NexusDesk: {formatAccessId(dev)}
                    </span>
                    <span className="text-xs font-bold text-amber-800 dark:text-amber-300">
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
                  className="inline-flex min-h-[44px] items-center gap-1.5 px-4 py-2 rounded-xl bg-brand hover:bg-brand-dark text-brand-fg font-black text-xs shadow-sm transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  <Monitor size={14} aria-hidden="true" /> Atender via NexusDesk
                </button>
                <button
                  type="button"
                  onClick={() => handleResolveSupport(dev)}
                  className="min-h-[44px] px-3.5 py-2 rounded-xl bg-white dark:bg-[#18181b] border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 font-bold text-xs transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
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
          tone="text-brand-aa bg-brand/10"
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
        className="flex gap-1 overflow-x-auto no-scrollbar border-b border-gray-200 dark:border-zinc-800"
        role="tablist"
        aria-label="Seções do agente"
      >
        {TABS.map((t, index) => {
          const isSelected = tab === t.id;
          return (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              id={`agent-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-controls={`agent-tabpanel-${t.id}`}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => handleTabKeyDown(e, index)}
              className={`min-h-[44px] px-4 py-2.5 text-sm font-bold whitespace-nowrap border-b-2 -mb-px transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-t-lg tabular-nums ${
                isSelected
                  ? 'border-brand text-brand-aa'
                  : 'border-transparent text-gray-600 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-[#fafafa]'
              }`}
            >
              {t.label}
              {t.id === 'fila' && pending ? ` (${pending})` : ''}
            </button>
          );
        })}
      </div>

      <div
        id={`agent-tabpanel-${tab}`}
        role="tabpanel"
        aria-labelledby={`agent-tab-${tab}`}
        tabIndex={0}
        className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-xl"
      >
        {tab === 'frota' && (
          <FleetTab
            assets={assets}
            liveDevices={liveDevices}
            staleDays={policy.staleDays}
            tenantId={tenantId}
            currentUser={currentUser}
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
        {tab === 'instalar' && (
          <InstallTab
            tenantId={tenantId}
            agentToken={agentToken}
            liveDevices={liveDevices}
            currentUser={currentUser}
          />
        )}
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
