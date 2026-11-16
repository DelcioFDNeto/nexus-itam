import React, { useEffect, useMemo, useState } from 'react';
import {
  Users, Server, DollarSign, Plus, ClipboardCheck, Activity, FolderGit2, ChevronDown, CheckCircle2, AlertTriangle, RefreshCw,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

import { collection, getCountFromServer, query, where } from 'firebase/firestore';
import { db } from '../services/firebase';
import { getAllAssets, getRecentActivity } from '../services/assetService';
import { getEmployees } from '../services/employeeService';
import { useAuth } from '../contexts/AuthContext';
import { isRetired } from '../utils/assetStatus';
import { getAssetType } from '../utils/assetTypes';
import { can, isSuperadmin } from '../utils/permissions';
import { formatUsage, isModuleEnabled, usageRatio, usageTone } from '../utils/entitlements';
import { parseMoney } from '../utils/terms';

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
      type={clickable ? 'button' : undefined}
      onClick={onClick}
      className={`text-left bg-white dark:bg-[#111113] p-4 md:p-5 rounded-xl border border-slate-200/90 dark:border-zinc-800 shadow-sm flex flex-col justify-between transition-colors ${clickable ? 'min-h-[44px] cursor-pointer hover:border-slate-300 dark:hover:border-zinc-700 hover:bg-slate-50/50 dark:hover:bg-zinc-900 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand' : ''}`}
    >
      <div className="flex justify-between items-center mb-3">
        <span className="text-xs font-semibold text-slate-500 dark:text-zinc-400">{label}</span>
        <div className={`p-1.5 rounded-lg ${tone}`} aria-hidden="true">
          <Icon size={16} aria-hidden="true" />
        </div>
      </div>
      <div>
        <p className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-[#fafafa] tracking-tight tabular-nums">{value}</p>
        {hint ? (
          <p className="mt-1 text-xs font-medium text-slate-500 dark:text-zinc-400 truncate">{hint}</p>
        ) : (
          <p className="mt-1 text-xs text-transparent select-none" aria-hidden="true">—</p>
        )}
      </div>
    </Tag>
  );
};

const TenantDashboard = () => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const tenantId = currentUser?.tenantId;
  const isGateway = currentUser?.authSource === 'gateway';

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
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
      const countEmployees = async (tId) => {
        if (isGateway) {
          const empList = await getEmployees(tId);
          return empList.length;
        }
        const snap = await getCountFromServer(query(collection(db, 'employees'), where('tenantId', '==', tId)));
        return snap.data().count;
      };
      const countProjects = async (tId) => {
        if (isGateway) return 0;
        const snap = await getCountFromServer(query(collection(db, 'projects'), where('tenantId', '==', tId)));
        return snap.data().count;
      };

      const results = await Promise.allSettled([
        getAllAssets(tenantId),
        countEmployees(tenantId),
        showProjects ? countProjects(tenantId) : Promise.resolve(0),
        getRecentActivity(tenantId, 6),
      ]);
      if (cancelled) return;
      setAssets(results[0].status === 'fulfilled' ? results[0].value : []);
      setTotalEmployees(results[1].status === 'fulfilled' ? results[1].value : 0);
      setTotalProjects(results[2].status === 'fulfilled' ? results[2].value : 0);
      setRecentActivity(results[3].status === 'fulfilled' ? results[3].value : []);
      const failedCount = results.filter((r) => r.status === 'rejected').length;
      results.forEach((r, i) => { if (r.status === 'rejected') console.error(`Falha ao carregar o painel [${i}]:`, r.reason); });
      setLoadError(results[0].status === 'rejected' || failedCount === results.length
        ? 'Não foi possível carregar os indicadores do inventário.'
        : '');
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [tenantId, showProjects, isGateway, reloadKey]);

  const handleRetry = () => {
    setLoading(true);
    setLoadError('');
    setReloadKey((k) => k + 1);
  };

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

  const activeAssets = useMemo(() => assets.filter((a) => !isRetired(a.status)), [assets]);
  const retiredCount = assets.length - activeAssets.length;

  const totalValue = activeAssets.reduce((acc, asset) => {
    if (asset.category === 'Promocional' || asset.internalId?.includes('PRM')) return acc;
    const val = parseMoney(asset.valor ?? asset.value);
    return acc + (Number.isFinite(val) && val > 0 ? val : 0);
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
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in pb-16">
      {/* COMANDO OPERACIONAL (HERO ENGENHEIRADO) */}
      <div className="bg-white dark:bg-[#111113] border border-slate-200/90 dark:border-zinc-800 rounded-xl p-5 md:p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-slate-100 dark:bg-zinc-900 text-slate-700 dark:text-zinc-300 font-mono text-xs font-semibold mb-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden="true" />
            <span>{currentUser?.companyName || 'Visão Geral'}</span>
          </div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-[#fafafa] tracking-tight">
            {greetingFor(new Date().getHours())}, {(currentUser?.name || '').split(' ')[0] || 'Gestor'}.
          </h1>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1 max-w-xl">
            Inventário consolidado de hardware, colaboradores e telemetria operacional.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {canCreate && (
            <button
              type="button"
              onClick={() => navigate('/assets/new')}
              className="min-h-[44px] bg-brand hover:bg-brand-dark text-brand-fg text-xs font-semibold px-4 py-2.5 rounded-lg flex items-center gap-1.5 shadow-sm transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <Plus size={16} aria-hidden="true" /> <span>Novo Ativo</span>
            </button>
          )}
          {showAudit && (
            <button
              type="button"
              onClick={() => navigate('/audit')}
              className="min-h-[44px] bg-slate-100 hover:bg-slate-200 text-slate-800 dark:bg-zinc-900 dark:hover:bg-zinc-800 dark:text-zinc-200 text-xs font-semibold px-4 py-2.5 rounded-lg flex items-center gap-1.5 border border-slate-200/80 dark:border-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <ClipboardCheck size={16} className="text-slate-600 dark:text-zinc-300" aria-hidden="true" /> <span>Auditoria</span>
            </button>
          )}
        </div>
      </div>

      {loadError && (
        <div
          role="alert"
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300"
        >
          <div className="flex items-center gap-2.5">
            <AlertTriangle size={16} className="shrink-0" aria-hidden="true" />
            <span>{loadError}</span>
          </div>
          <button
            type="button"
            onClick={handleRetry}
            className="min-h-[44px] inline-flex items-center gap-1.5 self-start sm:self-auto px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
          >
            <RefreshCw size={14} aria-hidden="true" /> Tentar novamente
          </button>
        </div>
      )}

      {/* TILES DE TELEMETRIA */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3.5">
        <MetricCard
          icon={Server}
          tone="bg-brand/10 text-brand-aa"
          label="Total de Ativos"
          value={activeAssets.length.toLocaleString('pt-BR')}
          hint={maxAssets !== null ? `Plano: ${formatUsage(assets.length, maxAssets)}` : retiredCount > 0 ? `+${retiredCount} baixados` : null}
          onClick={() => navigate('/assets')}
        />
        <MetricCard
          icon={DollarSign}
          tone="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"
          label="Valor Patrimonial"
          value={brl.format(totalValue)}
        />
        {canSeeTeam && (
          <MetricCard
            icon={Users}
            tone="bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400"
            label="Equipe Ativa"
            value={totalEmployees.toLocaleString('pt-BR')}
            onClick={() => navigate('/employees')}
          />
        )}
        {showProjects && (
          <MetricCard
            icon={FolderGit2}
            tone="bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400"
            label="Projetos"
            value={totalProjects.toLocaleString('pt-BR')}
            onClick={() => navigate('/projects')}
          />
        )}
        {showAgent && (
          <button
            type="button"
            onClick={() => navigate('/agent')}
            className="min-h-[44px] text-left bg-white dark:bg-[#111113] p-4 md:p-5 rounded-xl border border-slate-200/90 dark:border-zinc-800 shadow-sm flex flex-col justify-between transition-colors hover:border-slate-300 dark:hover:border-zinc-700 hover:bg-slate-50/50 dark:hover:bg-zinc-900 cursor-pointer active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <div className="flex justify-between items-center mb-3">
              <span className="text-xs font-semibold text-slate-500 dark:text-zinc-400">NexusDesk & Agente</span>
              <div className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400" aria-hidden="true">
                <Activity size={16} aria-hidden="true" />
              </div>
            </div>
            <div>
              <p className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-[#fafafa] tracking-tight">RMM</p>
              <p className="mt-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                <span>Telemetria em tempo real</span>
              </p>
            </div>
          </button>
        )}
      </div>

      {maxAssets !== null && assetTone !== 'ok' && (
        <div className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-xs font-semibold ${assetTone === 'critical' ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300' : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300'}`}>
          <Server size={16} className="shrink-0" aria-hidden="true" />
          {assetTone === 'critical'
            ? `Limite de ativos do plano ${currentUser?.entitlements?.planName} atingido (${formatUsage(assets.length, maxAssets)}). Novos cadastros estão bloqueados — contate o suporte.`
            : `Você está usando ${formatUsage(assets.length, maxAssets)} ativos do plano ${currentUser?.entitlements?.planName}.`}
        </div>
      )}

      <React.Suspense
        fallback={(
          <div
            role="status"
            aria-label="Carregando gráficos…"
            className="h-[280px] w-full flex items-center justify-center"
          >
            <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-brand" aria-hidden="true" />
            <span className="sr-only">Carregando gráficos…</span>
          </div>
        )}
      >
        <DashboardCharts typeCounts={typeCounts} statusCounts={statusCounts} totalAssets={activeAssets.length} />
      </React.Suspense>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Destaques do Inventário */}
        <div className="bg-white dark:bg-[#111113] p-5 rounded-xl border border-slate-200/90 dark:border-zinc-800 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-slate-900 dark:text-[#fafafa] text-sm">Distribuição por Categoria</h2>
            <span className="text-xs text-slate-500 dark:text-zinc-400 font-mono tabular-nums">{activeAssets.length} total</span>
          </div>

          {highlights.length === 0 ? (
            <div className="py-6 text-center space-y-2">
              <p className="text-xs text-slate-500 dark:text-zinc-400">Nenhum ativo cadastrado ainda.</p>
              {canCreate && (
                <Link
                  to="/assets/new"
                  className="min-h-[44px] px-2 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-aa hover:underline active:opacity-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded"
                >
                  <Plus size={14} aria-hidden="true" /> Cadastrar primeiro ativo
                </Link>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {highlights.map(([type, count]) => {
                const def = getAssetType(type);
                const Icon = def.icon;
                return (
                  <button
                    type="button"
                    key={type}
                    onClick={() => navigate(type === 'Outros' ? '/assets' : `/assets?type=${encodeURIComponent(type)}`)}
                    className="min-h-[44px] w-full flex items-center justify-between p-2.5 rounded-lg border border-slate-200/70 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-900/50 hover:border-slate-300 dark:hover:border-zinc-700 hover:bg-white dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand group"
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <span className="p-1.5 rounded-md bg-white dark:bg-[#111113] border border-slate-200/80 dark:border-zinc-800 text-slate-600 dark:text-zinc-300" aria-hidden="true">
                        <Icon size={15} aria-hidden="true" />
                      </span>
                      <span className="text-xs font-semibold text-slate-700 dark:text-zinc-200 truncate">
                        {def.id === type ? def.label : type}
                      </span>
                    </span>
                    <span className="font-mono text-xs font-bold text-slate-500 dark:text-zinc-400 tabular-nums">{count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Timeline de Operações */}
        <div className="bg-white dark:bg-[#111113] p-5 rounded-xl border border-slate-200/90 dark:border-zinc-800 shadow-sm lg:col-span-2 flex flex-col">
          <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-100 dark:border-zinc-800">
            <div>
              <h2 className="font-bold text-slate-900 dark:text-[#fafafa] text-sm flex items-center gap-2">
                <Activity size={16} className="text-brand-aa" aria-hidden="true" /> Registro de Operações
              </h2>
              <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">Auditoria e rastreabilidade dos ativos</p>
            </div>
          </div>

          <div className="space-y-3 flex-1">
            {recentActivity.map((act) => {
              const canOpenAsset = Boolean(act.assetId && act.type !== 'deletion');
              const rowClass = `p-3 rounded-lg border border-slate-200/70 dark:border-zinc-800 bg-slate-50/40 dark:bg-zinc-900/40 flex items-start justify-between gap-3 transition-colors ${canOpenAsset ? 'hover:border-slate-300 dark:hover:border-zinc-700 hover:bg-slate-50 dark:hover:bg-zinc-800/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand' : ''}`;
              const rowBody = (
                <>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-xs font-bold text-slate-900 dark:text-[#fafafa]">{act.action}</span>
                      {typeof act.user === 'string' && act.user && (
                        <span className="text-xs font-mono text-slate-500 dark:text-zinc-400">
                          por {act.user.split('@')[0]}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-600 dark:text-zinc-400 truncate">
                      {act.details || act.reason || 'Operação realizada com sucesso.'}
                    </p>
                  </div>

                  <span className="font-mono text-xs tabular-nums text-slate-500 dark:text-zinc-400 shrink-0">
                    {act.jsDate && !Number.isNaN(act.jsDate.getTime())
                      ? act.jsDate.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                      : '--:--'}
                  </span>
                </>
              );

              if (canOpenAsset) {
                return (
                  <Link key={act.id} to={`/assets/${act.assetId}`} className={rowClass}>
                    {rowBody}
                  </Link>
                );
              }
              return (
                <div key={act.id} className={rowClass}>
                  {rowBody}
                </div>
              );
            })}

            {recentActivity.length === 0 && (
              <div className="flex flex-col items-center justify-center py-10 text-slate-500 dark:text-zinc-400">
                <CheckCircle2 size={24} className="mb-2 text-slate-300 dark:text-zinc-600" aria-hidden="true" />
                <p className="text-xs font-medium">Nenhum evento registrado no período.</p>
              </div>
            )}
          </div>

          {recentActivity.length >= activityLimit && (
            <button
              type="button"
              onClick={loadMoreActivity}
              disabled={loadingMore}
              className="mt-4 min-h-[44px] self-center text-xs font-semibold text-slate-700 dark:text-zinc-200 bg-slate-100 hover:bg-slate-200 dark:bg-zinc-900 dark:hover:bg-zinc-800 border border-slate-200/80 dark:border-zinc-800 px-3 py-1.5 rounded-md transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand flex items-center gap-1.5 disabled:opacity-60"
            >
              <ChevronDown size={14} aria-hidden="true" /> {loadingMore ? 'Carregando…' : 'Carregar mais'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

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
