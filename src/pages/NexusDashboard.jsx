// src/pages/NexusDashboard.jsx
// -----------------------------------------------------------------------------
// Console do dono da plataforma (Nexus Master).
//
// Antes: os graficos importavam react-chartjs-2 sem registrar escalas e
// elementos do Chart.js — a tela quebrava ("category is not a registered
// scale") sempre que o master abria o painel. Quando nao havia dados, os
// graficos exibiam numeros FICTICIOS (15 notebooks, 3 empresas Starter...), os
// limites dos planos eram texto fixo e a receita nao aparecia em lugar nenhum.
// Agora tudo vem do banco: empresas (inclusive legadas), plano efetivo,
// receita recorrente, uso de limites e alertas acionaveis.
// -----------------------------------------------------------------------------
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS, ArcElement, BarElement, CategoryScale, LinearScale, Legend, Tooltip,
} from 'chart.js';
import {
  Activity, AlertTriangle, ArrowRight, Building2, CircleDollarSign, Layers, PlusSquare, RefreshCcw,
  Server, ShieldAlert, Sparkles, UserCheck, Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { getGlobalActivity } from '../services/assetService';
import { loadConsoleSnapshot } from '../services/tenantService';
import { useTheme } from '../contexts/ThemeContext';
import { KpiTile, PlanBadge, TenantStatusBadge, UsageBar } from '../components/console/consoleUi';
import { ALERT_STYLE, brl, brlCompact, daysSince, relativeDays, tenantAlerts } from '../utils/consoleMetrics';
import { isUnlimited } from '../utils/entitlements';

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Legend, Tooltip);

const PLAN_COLORS = {
  starter: 'rgba(100, 116, 139, 0.85)',
  pro: 'rgba(147, 51, 234, 0.85)',
  enterprise: 'rgba(245, 158, 11, 0.9)',
};
const EXTRA_COLORS = ['rgba(16, 185, 129, 0.85)', 'rgba(59, 130, 246, 0.85)', 'rgba(236, 72, 153, 0.85)'];

const LEVEL_ORDER = { critical: 0, warning: 1, info: 2 };

const Section = ({ title, subtitle, icon: Icon, action, children, className = '' }) => (
  <section className={`bg-white dark:bg-slate-800 p-6 rounded-3xl border border-gray-100 dark:border-slate-700 shadow-sm flex flex-col ${className}`}>
    <div className="flex items-start justify-between gap-3 mb-5">
      <div>
        <h3 className="font-black text-gray-900 dark:text-white flex items-center gap-2 text-lg tracking-tight">
          <Icon size={20} className="text-brand" /> {title}
        </h3>
        {subtitle && <p className="text-xs text-gray-500 dark:text-gray-400 font-medium mt-1">{subtitle}</p>}
      </div>
      {action}
    </div>
    {children}
  </section>
);

const NexusDashboard = () => {
  const navigate = useNavigate();
  const { isDark } = useTheme() || {};
  const [snapshot, setSnapshot] = useState(null);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    try {
      const [snap, logs] = await Promise.all([
        loadConsoleSnapshot(),
        getGlobalActivity(8).catch(() => []),
      ]);
      setSnapshot(snap);
      setActivity(logs);
    } catch (error) {
      console.error('Erro ao carregar o console:', error);
      toast.error('Falha ao carregar as métricas da plataforma.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const tenants = useMemo(() => snapshot?.tenants || [], [snapshot]);

  const metrics = useMemo(() => {
    const live = tenants.filter((t) => !t.legacy && ['active', 'trial'].includes(t.status));
    const mrr = tenants.reduce((sum, t) => sum + (t.mrr || 0), 0);
    const members = tenants.reduce((sum, t) => sum + t.usersCount, 0);
    const activeMembers = tenants.reduce(
      (sum, t) => sum + t.members.filter((u) => daysSince(u.lastLoginAt?.toDate ? u.lastLoginAt.toDate() : null) <= 30).length,
      0,
    );
    return {
      mrr,
      live: live.length,
      blocked: tenants.filter((t) => ['suspended', 'cancelled'].includes(t.status)).length,
      legacy: tenants.filter((t) => t.legacy).length,
      members,
      activeMembers,
      assets: tenants.reduce((sum, t) => sum + (t.assetsCount || 0), 0),
      newThisMonth: tenants.filter((t) => daysSince(t.createdAtDate) <= 30).length,
      avgTicket: live.length ? mrr / live.length : 0,
    };
  }, [tenants]);

  const attention = useMemo(
    () =>
      tenants
        .flatMap((t) => tenantAlerts(t).map((alert) => ({ ...alert, tenant: t })))
        .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level])
        .slice(0, 8),
    [tenants],
  );

  const plans = useMemo(() => snapshot?.plans || {}, [snapshot]);

  const revenueByPlan = useMemo(() => {
    const acc = {};
    tenants.forEach((t) => {
      if (!t.mrr) return;
      const key = t.entitlements?.planId || 'outros';
      acc[key] = (acc[key] || 0) + t.mrr;
    });
    return acc;
  }, [tenants]);

  const topByAssets = useMemo(
    () => [...tenants].filter((t) => t.assetsCount).sort((a, b) => b.assetsCount - a.assetsCount).slice(0, 8),
    [tenants],
  );

  const tenantName = useCallback(
    (id) => tenants.find((t) => t.id === id)?.companyName || id,
    [tenants],
  );

  const openTenant = (id) => navigate(`/admin/tenants?empresa=${encodeURIComponent(id)}`);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh]">
        <div className="w-12 h-12 border-4 border-brand/20 border-t-brand rounded-full animate-spin" />
        <p className="mt-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest">Carregando console...</p>
      </div>
    );
  }

  const tickColor = isDark ? '#94a3b8' : '#64748b';
  const revenueKeys = Object.keys(revenueByPlan);
  const doughnutData = {
    labels: revenueKeys.map((k) => plans[k]?.name || k),
    datasets: [{
      data: revenueKeys.map((k) => revenueByPlan[k]),
      backgroundColor: revenueKeys.map((k, i) => PLAN_COLORS[k] || EXTRA_COLORS[i % EXTRA_COLORS.length]),
      borderWidth: 0,
      hoverOffset: 6,
    }],
  };
  const barData = {
    labels: topByAssets.map((t) => (t.companyName || t.id).slice(0, 18)),
    datasets: [{
      label: 'Ativos',
      data: topByAssets.map((t) => t.assetsCount),
      backgroundColor: 'rgba(99, 102, 241, 0.8)',
      hoverBackgroundColor: 'rgba(79, 70, 229, 1)',
      borderRadius: 8,
      barThickness: 22,
    }],
  };
  const tooltip = { backgroundColor: 'rgba(15, 23, 42, 0.92)', padding: 12, cornerRadius: 8 };

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-fade-in pb-24">
      {/* HERO */}
      <div className="relative overflow-hidden bg-gradient-to-br from-indigo-950 via-slate-900 to-black rounded-3xl p-8 md:p-10 border border-indigo-500/10 shadow-2xl">
        <div className="absolute top-0 right-0 -mr-20 -mt-20 w-96 h-96 bg-indigo-500/10 rounded-full blur-[100px] pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-indigo-300 text-xs font-black uppercase tracking-widest mb-4">
              <ShieldAlert size={14} /> Nexus Master Console
            </div>
            <h1 className="text-3xl md:text-5xl font-black text-white tracking-tight mb-2">Visão do dono</h1>
            <p className="text-slate-400 font-medium text-sm max-w-xl leading-relaxed">
              Receita, saúde das contas, uso de limites e o que precisa da sua atenção — em tempo real, direto do banco.
            </p>
            <p className="mt-3 text-[11px] font-bold text-slate-500">
              Atualizado {snapshot?.loadedAt ? snapshot.loadedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button onClick={() => navigate('/admin/tenants?novo=1')} className="bg-white hover:bg-gray-100 text-black px-5 py-3 rounded-2xl font-black text-xs uppercase tracking-wider flex items-center gap-2 transition-all active:scale-95 shadow-lg">
              <PlusSquare size={16} /> Nova empresa
            </button>
            <button onClick={() => load(true)} disabled={refreshing} className="bg-slate-800/80 hover:bg-slate-800 border border-white/10 text-white px-4 py-3 rounded-2xl font-black text-xs uppercase tracking-wider flex items-center gap-2 transition-all active:scale-95 disabled:opacity-60">
              <RefreshCcw size={16} className={refreshing ? 'animate-spin' : ''} /> Atualizar
            </button>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <KpiTile icon={CircleDollarSign} tone="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400" label="Receita mensal (MRR)" value={brlCompact.format(metrics.mrr)} hint={`ARR ${brlCompact.format(metrics.mrr * 12)}`} />
        <KpiTile icon={Building2} label="Empresas ativas" value={metrics.live} hint={metrics.blocked ? `${metrics.blocked} suspensas/encerradas` : `${tenants.length} no total`} onClick={() => navigate('/admin/tenants')} />
        <KpiTile icon={Sparkles} tone="bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400" label="Novas em 30 dias" value={metrics.newThisMonth} hint={`Ticket médio ${brl.format(metrics.avgTicket)}`} />
        <KpiTile icon={Users} tone="bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-400" label="Usuários" value={metrics.members} hint={`${metrics.activeMembers} ativos em 30 dias`} onClick={() => navigate('/admin/users')} />
        <KpiTile icon={Server} tone="bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400" label="Ativos gerenciados" value={metrics.assets.toLocaleString('pt-BR')} />
        <KpiTile
          icon={AlertTriangle}
          tone={metrics.legacy ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400' : 'bg-gray-50 text-gray-500 dark:bg-slate-900 dark:text-gray-400'}
          label="Sem cadastro (legadas)"
          value={metrics.legacy}
          hint={metrics.legacy ? 'Regularize para cobrar e limitar' : 'Tudo regularizado'}
          onClick={metrics.legacy ? () => navigate('/admin/tenants?status=legacy') : undefined}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Atencao */}
        <Section
          icon={AlertTriangle}
          title="Precisa de atenção"
          subtitle="Limites, contas legadas, inatividade e bloqueios"
          className="lg:col-span-2"
          action={<button onClick={() => navigate('/admin/tenants?alertas=1')} className="text-[10px] font-black uppercase tracking-widest text-brand bg-brand/10 px-3 py-1.5 rounded-lg">Ver todas</button>}
        >
          {attention.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-gray-400 dark:text-gray-500">
              <UserCheck size={32} className="mb-3 opacity-40" />
              <p className="font-bold text-sm">Nenhuma pendência. Todas as contas estão saudáveis.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {attention.map(({ level, text, tenant }, i) => (
                <li key={`${tenant.id}-${i}`}>
                  <button onClick={() => openTenant(tenant.id)} className={`w-full text-left flex items-center gap-3 rounded-2xl border px-4 py-3 transition-transform hover:translate-x-0.5 ${ALERT_STYLE[level]}`}>
                    <span className="font-black text-sm truncate max-w-[40%]">{tenant.companyName || tenant.id}</span>
                    <span className="text-xs font-semibold flex-1 min-w-0 truncate">{text}</span>
                    <ArrowRight size={14} className="shrink-0 opacity-60" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Receita por plano */}
        <Section icon={CircleDollarSign} title="Receita por plano" subtitle="Empresas ativas, com preços sob medida">
          {revenueKeys.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 py-10 text-center">Nenhuma receita recorrente registrada ainda.</p>
          ) : (
            <>
              <div className="relative h-44">
                <Doughnut data={doughnutData} options={{ responsive: true, maintainAspectRatio: false, cutout: '72%', plugins: { legend: { display: false }, tooltip: { ...tooltip, callbacks: { label: (ctx) => ` ${brl.format(ctx.raw)}` } } } }} />
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-xl font-black text-gray-900 dark:text-white">{brlCompact.format(metrics.mrr)}</span>
                  <span className="text-[10px] uppercase font-bold text-gray-400 tracking-widest">por mês</span>
                </div>
              </div>
              <ul className="mt-4 space-y-2">
                {revenueKeys.map((k, i) => (
                  <li key={k} className="flex items-center gap-2 text-xs font-bold text-gray-600 dark:text-gray-300">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: PLAN_COLORS[k] || EXTRA_COLORS[i % EXTRA_COLORS.length] }} />
                    <span className="truncate">{plans[k]?.name || k}</span>
                    <span className="ml-auto tabular-nums">{brl.format(revenueByPlan[k])}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Top empresas por volume */}
        <Section icon={Server} title="Maiores parques" subtitle="Empresas com mais ativos cadastrados" className="lg:col-span-2 min-h-[320px]">
          {topByAssets.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 py-10 text-center">Nenhum ativo cadastrado na plataforma ainda.</p>
          ) : (
            <div className="relative flex-1 min-h-[220px]">
              <Bar
                data={barData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  onClick: (_, elements) => elements[0] && openTenant(topByAssets[elements[0].index].id),
                  plugins: { legend: { display: false }, tooltip },
                  scales: {
                    y: { display: false, grid: { display: false } },
                    x: { grid: { display: false }, ticks: { color: tickColor, font: { weight: '600' } } },
                  },
                }}
              />
            </div>
          )}
        </Section>

        {/* Planos */}
        <Section
          icon={Layers}
          title="Planos"
          subtitle="Limites e preços vigentes"
          action={<button onClick={() => navigate('/admin/plans')} className="text-[10px] font-black uppercase tracking-widest text-brand bg-brand/10 px-3 py-1.5 rounded-lg">Ajustar</button>}
        >
          <ul className="space-y-3">
            {Object.values(plans).map((plan) => {
              const count = tenants.filter((t) => !t.legacy && t.entitlements?.planId === plan.id).length;
              return (
                <li key={plan.id} className="p-3.5 rounded-2xl border border-gray-100 dark:border-slate-700 bg-gray-50/60 dark:bg-slate-900/50">
                  <div className="flex justify-between items-center">
                    <p className="font-extrabold text-sm text-gray-900 dark:text-white">{plan.name}</p>
                    <p className="text-xs font-black text-gray-700 dark:text-gray-200">{brl.format(Number(plan.monthlyPrice) || 0)}<span className="text-gray-400 font-bold">/mês</span></p>
                  </div>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                    {isUnlimited(plan.maxAssets) ? 'Ativos ilimitados' : `${Number(plan.maxAssets).toLocaleString('pt-BR')} ativos`} ·{' '}
                    {isUnlimited(plan.maxUsers) ? 'usuários ilimitados' : `${plan.maxUsers} usuários`} · <strong>{count}</strong> {count === 1 ? 'empresa' : 'empresas'}
                  </p>
                </li>
              );
            })}
          </ul>
        </Section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Empresas recentes */}
        <Section
          icon={Building2}
          title="Empresas recentes"
          subtitle="Últimos cadastros na plataforma"
          action={<button onClick={() => navigate('/admin/tenants')} className="text-[10px] font-black uppercase tracking-widest text-brand bg-brand/10 px-3 py-1.5 rounded-lg">Todas</button>}
        >
          <ul className="divide-y divide-gray-100 dark:divide-slate-700">
            {tenants.slice(0, 6).map((t) => (
              <li key={t.id}>
                <button onClick={() => openTenant(t.id)} className="w-full text-left py-3 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-slate-900/50 rounded-xl px-2 -mx-2 transition-colors">
                  <div className="w-9 h-9 rounded-xl bg-brand/10 text-brand flex items-center justify-center font-black shrink-0">
                    {(t.companyName || t.id).substring(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-sm text-gray-900 dark:text-white truncate">{t.companyName || t.id}</p>
                    <p className="text-[11px] text-gray-400 dark:text-gray-500">
                      {t.createdAtDate ? `Criada ${relativeDays(t.createdAtDate)}` : 'Data de criação desconhecida'} · último acesso {relativeDays(t.lastActivity)}
                    </p>
                  </div>
                  <div className="hidden sm:flex flex-col items-end gap-1">
                    <PlanBadge tenant={t} />
                    <TenantStatusBadge tenant={t} />
                  </div>
                  <div className="w-24 hidden md:block">
                    <UsageBar compact current={t.assetsCount} limit={t.entitlements?.maxAssets} />
                  </div>
                </button>
              </li>
            ))}
            {tenants.length === 0 && <li className="py-8 text-center text-sm text-gray-400">Nenhuma empresa cadastrada.</li>}
          </ul>
        </Section>

        {/* Atividade global */}
        <Section icon={Activity} title="Atividade recente" subtitle="Últimas operações registradas pelas empresas">
          <ul className="space-y-3">
            {activity.map((act) => (
              <li key={act.id} className="p-3 rounded-2xl border border-gray-100 dark:border-slate-700 bg-gray-50/60 dark:bg-slate-900/40">
                <div className="flex justify-between gap-2">
                  <p className="font-black text-sm text-gray-900 dark:text-white">{act.action}</p>
                  <span className="text-[10px] font-bold text-gray-400 whitespace-nowrap">
                    {act.jsDate && !Number.isNaN(act.jsDate.getTime()) ? act.jsDate.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '--'}
                  </span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{act.details || act.reason || 'Operação registrada.'}</p>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  {act.tenantId && (
                    <button onClick={() => openTenant(act.tenantId)} className="text-[9px] font-black text-brand uppercase tracking-widest bg-brand/10 px-2 py-0.5 rounded">
                      {tenantName(act.tenantId)}
                    </button>
                  )}
                  {typeof act.user === 'string' && act.user && (
                    <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">{act.user.split('@')[0]}</span>
                  )}
                </div>
              </li>
            ))}
            {activity.length === 0 && <li className="py-8 text-center text-sm text-gray-400">Nenhuma atividade registrada ainda.</li>}
          </ul>
        </Section>
      </div>
    </div>
  );
};

export default NexusDashboard;
