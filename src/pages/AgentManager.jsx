// src/pages/AgentManager.jsx
// -----------------------------------------------------------------------------
// Agente ITAM: frota de maquinas inventariadas, fila de recepcao, instalacao,
// politicas e simulador. O agente roda nas maquinas; aqui o administrador
// acompanha o parque como um gestor de ativos: quem comunica, quem sumiu,
// o que esta fora da politica e quais computadores ainda nao tem agente.
// -----------------------------------------------------------------------------
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Activity, AlertTriangle, Cpu, Inbox, Laptop, Loader2, ShieldAlert, WifiOff, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { useAssets } from '../hooks/useAssets';
import { useTenantSettings } from '../hooks/useTenantSettings';
import { migrateLegacyAgentToken } from '../services/tenantSecretService';
import { getAgentSubmissions, processAgentInbox } from '../services/agentService';
import { assertWithinLimit } from '../services/tenantService';
import { resolveAgentPolicy, summarizeFleet } from '../utils/agentInventory';
import { isRetired } from '../utils/assetStatus';
import FleetTab from '../components/agent/FleetTab';
import InboxTab from '../components/agent/InboxTab';
import InstallTab from '../components/agent/InstallTab';
import PoliciesTab from '../components/agent/PoliciesTab';
import SimulatorTab from '../components/agent/SimulatorTab';

const TABS = [
  { id: 'frota', label: 'Frota' },
  { id: 'fila', label: 'Fila' },
  { id: 'instalar', label: 'Instalar' },
  { id: 'politicas', label: 'Políticas e segurança' },
  { id: 'simulador', label: 'Simulador' },
];

const Kpi = ({ icon: Icon, label, value, tone, onClick }) => (
  <button type="button" onClick={onClick} className="text-left bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-4 shadow-sm flex items-center gap-3">
    <span className={`p-2.5 rounded-xl ${tone}`}><Icon size={18} /></span>
    <span>
      <span className="block text-2xl font-black text-gray-900 dark:text-white tabular-nums">{value}</span>
      <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{label}</span>
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
  const [loadingInbox, setLoadingInbox] = useState(true);
  const [processing, setProcessing] = useState(false);

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
    if (!tenantId) return;
    migrateLegacyAgentToken(tenantId)
      .then((token) => setAgentToken(token || ''))
      .catch((error) => console.error('Falha ao ler o token do agente:', error));
  }, [tenantId]);

  const fleet = useMemo(() => summarizeFleet(assets, { staleDays: policy.staleDays, isRetired }), [assets, policy.staleDays]);
  const pending = submissions.filter((s) => s.status === 'pending' || s.status === 'error').length;

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
          ? `${summary.processed} processado(s): ${summary.created} novo(s), ${summary.updated} atualizado(s)${summary.errors.length ? `, ${summary.errors.length} com erro` : ''}.`
          : 'Fila vazia.',
      );
      await loadInbox();
    } catch (error) {
      toast.error(error.message || 'Erro ao processar a fila.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto pb-24 space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-gradient-to-br from-indigo-500 to-indigo-600 text-white rounded-xl shadow-lg shadow-indigo-500/20"><Cpu size={26} /></div>
          <div>
            <h1 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">Agente ITAM</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Inventário automático das máquinas: hardware, segurança, programas, local e responsável.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-[11px] font-black uppercase tracking-wider ${settings.autoAcceptEnabled ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300' : 'border-gray-200 bg-white text-gray-500 dark:border-slate-700 dark:bg-slate-800'}`}>
            <Zap size={13} /> Aceite automático {settings.autoAcceptEnabled ? 'ligado' : 'desligado'}
          </span>
          <button type="button" onClick={processNow} disabled={processing || !pending} className="px-4 py-2.5 rounded-xl bg-brand text-white text-xs font-black uppercase tracking-wider flex items-center gap-2 shadow-md shadow-brand/30 disabled:opacity-40 disabled:shadow-none">
            {processing ? <Loader2 size={15} className="animate-spin" /> : <Inbox size={15} />} Processar fila ({pending})
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi icon={Laptop} label="Com agente" value={fleet.managed} tone="text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 dark:text-indigo-300" onClick={() => setTab('frota')} />
        <Kpi icon={Activity} label="Comunicaram em 24h" value={fleet.online24h} tone="text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300" onClick={() => setTab('frota')} />
        <Kpi icon={WifiOff} label={`Sem comunicação (+${policy.staleDays}d)`} value={fleet.stale} tone="text-rose-600 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-300" onClick={() => setTab('frota')} />
        <Kpi icon={ShieldAlert} label={`Com alertas (${fleet.critical} críticos)`} value={fleet.withAlerts} tone="text-amber-600 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300" onClick={() => setTab('frota')} />
        <Kpi icon={AlertTriangle} label="Computadores sem agente" value={fleet.uncovered} tone="text-slate-600 bg-slate-100 dark:bg-slate-900 dark:text-slate-300" onClick={() => setTab('frota')} />
        <Kpi icon={Inbox} label="Na fila" value={pending} tone="text-blue-600 bg-blue-50 dark:bg-blue-950/40 dark:text-blue-300" onClick={() => setTab('fila')} />
      </div>

      <div className="flex gap-1 overflow-x-auto scrollbar-hide border-b border-gray-200 dark:border-slate-700" role="tablist" aria-label="Seções do agente">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-bold whitespace-nowrap border-b-2 -mb-px transition-colors ${tab === t.id ? 'border-brand text-brand' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'}`}
          >
            {t.label}{t.id === 'fila' && pending ? ` (${pending})` : ''}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'frota' && <FleetTab assets={assets} staleDays={policy.staleDays} />}
        {tab === 'fila' && <InboxTab tenantId={tenantId} currentUser={currentUser} submissions={submissions} loading={loadingInbox} onReload={loadInbox} />}
        {tab === 'instalar' && <InstallTab tenantId={tenantId} agentToken={agentToken} />}
        {tab === 'politicas' && <PoliciesTab tenantId={tenantId} currentUser={currentUser} agentToken={agentToken} onTokenChange={setAgentToken} />}
        {tab === 'simulador' && <SimulatorTab tenantId={tenantId} onQueued={loadInbox} />}
      </div>
    </div>
  );
};

export default AgentManager;
