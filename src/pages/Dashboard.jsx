import React, { useEffect, useMemo, useState } from 'react';
import {
  Users, Server, DollarSign, Plus, ClipboardCheck, Activity, ArrowRight, Zap, FolderGit2, ChevronDown,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { getAllAssets, getRecentActivity } from '../services/assetService';
import { getEmployees } from '../services/employeeService';
import { getProjects } from '../services/projectService';
import { useAuth } from '../contexts/AuthContext';
import { isRetired } from '../utils/assetStatus';
import { getAssetType } from '../utils/assetTypes';
import { can, isSuperadmin } from '../utils/permissions';
import { formatUsage, isModuleEnabled, usageRatio, usageTone } from '../utils/entitlements';

import DashboardSkeleton from '../components/dashboard/DashboardSkeleton';

const NexusDashboard = React.lazy(() => import('./NexusDashboard'));
const DashboardCharts = React.lazy(() => import('../components/dashboard/DashboardCharts'));

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 });

const greetingFor = (hour) => (hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite');

/** Tipos com mais itens + "Outros": cada empresa ve os proprios tipos, inclusive personalizados. */
const topTypes = (assets, limit = 6) => {
  const counts = assets.reduce((acc, asset) => {
    const type = asset.type || 'Outros';
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const top = Object.fromEntries(sorted.slice(0, limit));
  const rest = sorted.slice(limit).reduce((sum, [, n]) => sum + n, 0);
  if (rest > 0) top.Outros = (top.Outros || 0) + rest;
  return top;
};

const MetricCard = ({ icon: Icon, tone, label, value, hint, onClick }) => {
  const clickable = Boolean(onClick);
  const Tag = clickable ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={`text-left bg-white dark:bg-slate-800 p-4 md:p-6 rounded-3xl border border-gray-100 dark:border-slate-700 shadow-sm flex flex-col justify-between relative overflow-hidden group transition-all h-32 md:h-40 ${clickable ? 'cursor-pointer hover:border-brand/40 hover:shadow-md' : ''}`}
    >
      <div className="flex justify-between items-start relative z-10 w-full">
        <div className={`p-2 md:p-2.5 rounded-xl ${tone}`}><Icon size={18} className="md:w-5 md:h-5" /></div>
        {clickable && <ArrowRight size={16} className="text-gray-300 dark:text-slate-600 group-hover:text-brand transition-all group-hover:translate-x-1" />}
      </div>
      <div className="relative z-10">
        <p className="text-3xl md:text-4xl font-black text-gray-900 dark:text-white mb-0.5 tracking-tighter">{value}</p>
        <p className="text-gray-500 dark:text-gray-400 font-bold uppercase tracking-widest text-[9px] md:text-[10px]">{label}</p>
        {hint && <p className="mt-1 text-[9px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">{hint}</p>}
      </div>
    </Tag>
  );
};

const TenantDashboard = () => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const tenantId = currentUser?.tenantId;
  const [loading, setLoading] = useState(true);
  const [assets, setAssets] = useState([]);
  const [recentActivity, setRecentActivity] = useState([]);
  const [totalEmployees, setTotalEmployees] = useState(0);
  const [totalProjects, setTotalProjects] = useState(0);
  const [activityLimit, setActivityLimit] = useState(6);
  const [loadingMore, setLoadingMore] = useState(false);

  const showProjects = can(currentUser, 'projects:write') && isModuleEnabled(currentUser, 'projects');
  const showAudit = can(currentUser, 'audit:run') && isModuleEnabled(currentUser, 'audit');
  const showAgent = can(currentUser, 'agent:manage') && isModuleEnabled(currentUser, 'agent');
  const canCreate = can(currentUser, 'assets:write');
  const canSeeTeam = can(currentUser, 'employees:write');

  useEffect(() => {
    if (!tenantId) return undefined;
    let cancelled = false;
    (async () => {
      const results = await Promise.allSettled([
        getAllAssets(tenantId),
        getEmployees(tenantId),
        showProjects ? getProjects(tenantId) : Promise.resolve([]),
        getRecentActivity(tenantId, 6),
      ]);
      if (cancelled) return;
      setAssets(results[0].status === 'fulfilled' ? results[0].value : []);
      setTotalEmployees(results[1].status === 'fulfilled' ? results[1].value.length : 0);
      setTotalProjects(results[2].status === 'fulfilled' ? results[2].value.length : 0);
      setRecentActivity(results[3].status === 'fulfilled' ? results[3].value : []);
      results.forEach((r, i) => { if (r.status === 'rejected') console.error(`Falha ao carregar o painel [${i}]:`, r.reason); });
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [tenantId, showProjects]);

  // "Ver mais" carrega mais eventos — antes o botao "Ver Tudo" nao fazia nada.
  const loadMoreActivity = async () => {
    const next = activityLimit + 15;
    setLoadingMore(true);
    try {
      setRecentActivity(await getRecentActivity(tenantId, next));
      setActivityLimit(next);
    } catch (error) {
      console.error(error);
    } finally {
      setLoadingMore(false);
    }
  };

  // Ativos baixados continuam no banco pelo histórico patrimonial, mas não
  // fazem mais parte do inventário: ficam fora de contagens, valor e gráficos.
  const activeAssets = useMemo(() => assets.filter((a) => !isRetired(a.status)), [assets]);
  const retiredCount = assets.length - activeAssets.length;

  const totalValue = activeAssets.reduce((acc, asset) => {
    if (asset.category === 'Promocional' || asset.internalId?.includes('PRM')) return acc;
    return acc + (parseFloat(asset.valor) || 0);
  }, 0);

  const statusCounts = useMemo(() => activeAssets.reduce((acc, curr) => {
    const status = curr.status || 'Desconhecido';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {}), [activeAssets]);

  const typeCounts = useMemo(() => topTypes(activeAssets), [activeAssets]);
  const highlights = Object.entries(typeCounts).slice(0, 5);

  const maxAssets = currentUser?.entitlements?.maxAssets ?? null;
  const assetTone = usageTone(usageRatio(assets.length, maxAssets));

  if (loading) return <DashboardSkeleton />;

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-fade-in pb-24">
      {/* HERO */}
      <div className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-slate-900 to-black rounded-3xl p-8 md:p-10 shadow-2xl border border-white/5">
        <div className="absolute top-0 right-0 -mr-20 -mt-20 w-96 h-96 bg-brand/30 rounded-full blur-[100px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-80 h-80 bg-cyan-500/15 rounded-full blur-[80px] pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-8">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/10 text-cyan-300 text-xs font-black uppercase tracking-widest mb-4 backdrop-blur-md">
              <Zap size={14} className="fill-cyan-300" /> {currentUser?.companyName || 'Visão Geral'}
            </div>
            <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight mb-2">
              {greetingFor(new Date().getHours())}, <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 to-white">{(currentUser?.name || '').split(' ')[0] || 'time'}</span>.
            </h1>
            <p className="text-slate-300/80 font-medium text-sm max-w-lg leading-relaxed">
              Panorama atualizado da infraestrutura: inventário, equipe e últimas operações.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            {canCreate && (
              <button onClick={() => navigate('/assets/new')} className="bg-white text-slate-900 px-5 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-gray-100 transition-all shadow-lg active:scale-95 group">
                <Plus size={18} className="group-hover:rotate-90 transition-transform duration-300" /> <span>Novo Ativo</span>
              </button>
            )}
            {showAudit && (
              <button onClick={() => navigate('/audit')} className="bg-slate-800/50 backdrop-blur-md border border-white/10 text-white px-5 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-slate-800 hover:border-white/20 transition-all active:scale-95">
                <ClipboardCheck size={18} className="text-cyan-400" /> <span>Auditoria</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* MÉTRICAS — só atalhos que o perfil pode abrir */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-6">
        <MetricCard
          icon={Server}
          tone="bg-brand/10 text-brand"
          label="Ativos"
          value={activeAssets.length.toLocaleString('pt-BR')}
          hint={maxAssets !== null ? `Plano: ${formatUsage(assets.length, maxAssets)}` : retiredCount > 0 ? `+${retiredCount} baixados` : null}
          onClick={() => navigate('/assets')}
        />
        <MetricCard
          icon={DollarSign}
          tone="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"
          label="Valor estimado"
          value={brl.format(totalValue)}
        />
        {canSeeTeam && (
          <MetricCard
            icon={Users}
            tone="bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400"
            label="Equipe"
            value={totalEmployees.toLocaleString('pt-BR')}
            onClick={() => navigate('/employees')}
          />
        )}
        {showProjects && (
          <MetricCard
            icon={FolderGit2}
            tone="bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-400"
            label="Projetos"
            value={totalProjects.toLocaleString('pt-BR')}
            onClick={() => navigate('/projects')}
          />
        )}
        {showAgent && (
          <button
            onClick={() => navigate('/agent')}
            className="text-left bg-gradient-to-br from-slate-800 to-slate-900 p-4 md:p-6 rounded-3xl shadow-sm flex flex-col justify-between relative overflow-hidden group cursor-pointer border border-slate-700 h-32 md:h-40"
          >
            <div className="absolute right-0 bottom-0 opacity-10 translate-x-4 translate-y-4 group-hover:scale-110 transition-transform text-white"><Activity size={90} /></div>
            <div className="flex justify-between items-start relative z-10 w-full">
              <div className="p-2 md:p-2.5 bg-white/10 text-cyan-400 rounded-xl"><Activity size={18} className="md:w-5 md:h-5" /></div>
              <span className="flex h-2.5 w-2.5 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-cyan-500" />
              </span>
            </div>
            <div className="relative z-10">
              <p className="text-lg md:text-xl font-black text-white mb-1 tracking-tight">Agente</p>
              <p className="text-slate-400 font-bold uppercase tracking-widest text-[9px] md:text-[10px]">Inventário automático</p>
            </div>
          </button>
        )}
      </div>

      {maxAssets !== null && assetTone !== 'ok' && (
        <div className={`flex items-center gap-3 rounded-2xl border px-5 py-4 text-sm font-bold ${assetTone === 'critical' ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300' : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300'}`}>
          <Server size={18} className="shrink-0" />
          {assetTone === 'critical'
            ? `Limite de ativos do plano ${currentUser?.entitlements?.planName} atingido (${formatUsage(assets.length, maxAssets)}). Novos cadastros estão bloqueados — fale com o suporte para ampliar.`
            : `Você está usando ${formatUsage(assets.length, maxAssets)} ativos do plano ${currentUser?.entitlements?.planName}.`}
        </div>
      )}

      <React.Suspense fallback={<div className="h-[300px] w-full flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" /></div>}>
        <DashboardCharts typeCounts={typeCounts} statusCounts={statusCounts} totalAssets={activeAssets.length} />
      </React.Suspense>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Destaques: tipos reais da empresa, cada um abre a lista filtrada */}
        <div className="bg-white dark:bg-slate-800 p-6 md:p-8 rounded-3xl border border-gray-100 dark:border-slate-700 shadow-sm">
          <h3 className="font-black text-gray-900 dark:text-white mb-6 text-lg tracking-tight">Destaques do inventário</h3>
          {highlights.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500">Nenhum ativo cadastrado ainda.</p>
          ) : (
            <div className="space-y-3">
              {highlights.map(([type, count]) => {
                const def = getAssetType(type);
                const Icon = def.icon;
                return (
                  <button
                    key={type}
                    onClick={() => navigate(type === 'Outros' ? '/assets' : `/assets?type=${encodeURIComponent(type)}`)}
                    className="w-full flex items-center justify-between p-3.5 rounded-2xl border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-brand/40 hover:bg-brand/5 transition-all group"
                  >
                    <span className="flex items-center gap-3">
                      <span className="p-2.5 rounded-xl bg-gray-50 dark:bg-slate-900"><Icon size={18} className={def.tone} /></span>
                      <span className="font-bold text-gray-700 dark:text-gray-200 group-hover:text-gray-900 dark:group-hover:text-white">
                        {def.id === type ? def.label : type}
                      </span>
                    </span>
                    <span className="font-mono font-black text-lg text-gray-400 dark:text-gray-500 group-hover:text-brand transition-colors mr-1">{count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Timeline */}
        <div className="bg-white dark:bg-slate-800 p-6 md:p-8 rounded-3xl border border-gray-100 dark:border-slate-700 shadow-sm lg:col-span-2 flex flex-col">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="font-black text-gray-900 dark:text-white text-lg flex items-center gap-2 tracking-tight">
                <Activity size={20} className="text-brand" /> Log de Operações
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 font-medium mt-1">Rastreabilidade das últimas movimentações</p>
            </div>
          </div>

          <div className="relative flex-1 pl-4">
            <div className="absolute top-2 bottom-0 left-[23px] w-0.5 bg-gray-100 dark:bg-slate-700" />
            <div className="space-y-6 relative z-10 mt-2">
              {recentActivity.map((act) => (
                <div key={act.id} className="flex gap-4 items-start group">
                  <div className="w-3 h-3 rounded-full bg-brand border-4 border-white dark:border-slate-800 shadow-sm mt-1 shrink-0 relative z-10 group-hover:scale-125 transition-transform" />
                  <div
                    onClick={() => act.assetId && act.type !== 'deletion' && navigate(`/assets/${act.assetId}`)}
                    className={`flex-1 min-w-0 bg-gray-50/60 dark:bg-slate-900/50 p-3.5 rounded-2xl border border-gray-100 dark:border-slate-700 transition-colors ${act.assetId && act.type !== 'deletion' ? 'cursor-pointer hover:border-brand/30' : ''}`}
                  >
                    <div className="flex justify-between items-start gap-2 mb-1">
                      <p className="font-black text-gray-900 dark:text-white text-sm">{act.action}</p>
                      <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 px-2 py-0.5 rounded-md whitespace-nowrap">
                        {act.jsDate && !Number.isNaN(act.jsDate.getTime())
                          ? act.jsDate.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                          : '--:--'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400 font-medium break-words">{act.details || act.reason || 'Operação realizada com sucesso.'}</p>
                    {typeof act.user === 'string' && act.user && (
                      <div className="flex items-center gap-1.5 mt-2 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">
                        <Users size={10} /> {act.user.split('@')[0]}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {recentActivity.length === 0 && (
                <div className="flex flex-col items-center justify-center py-10 text-gray-400 dark:text-gray-500">
                  <ClipboardCheck size={32} className="mb-3 opacity-20" />
                  <p className="font-bold text-sm">Tudo calmo por aqui.</p>
                  <p className="text-xs mt-1">Nenhuma atividade registrada ainda.</p>
                </div>
              )}
            </div>
          </div>

          {recentActivity.length >= activityLimit && (
            <button
              onClick={loadMoreActivity}
              disabled={loadingMore}
              className="mt-6 self-center text-[11px] font-black text-brand bg-brand/10 px-4 py-2 rounded-lg uppercase tracking-widest hover:bg-brand/15 transition-colors flex items-center gap-1.5 disabled:opacity-60"
            >
              <ChevronDown size={14} /> {loadingMore ? 'Carregando...' : 'Ver mais'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * O master cai direto no console global. Antes a tela buscava TODOS os ativos,
 * colaboradores e projetos da plataforma so para, em seguida, renderizar o
 * NexusDashboard — que buscava tudo de novo.
 */
const Dashboard = () => {
  const { currentUser } = useAuth();
  if (isSuperadmin(currentUser)) {
    return (
      <React.Suspense fallback={<DashboardSkeleton />}>
        <NexusDashboard />
      </React.Suspense>
    );
  }
  return <TenantDashboard />;
};

export default Dashboard;
