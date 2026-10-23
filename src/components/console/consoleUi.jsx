// src/components/console/consoleUi.jsx
// Pecas visuais compartilhadas pelo console Nexus Master.
import React from 'react';
import { TENANT_STATUSES, formatUsage, usageRatio, usageTone } from '../../utils/entitlements';

const STATUS_STYLE = {
  green: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400',
  blue: 'bg-blue-500/10 text-blue-600 border-blue-500/20 dark:text-blue-400',
  amber: 'bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400',
  rose: 'bg-rose-500/10 text-rose-600 border-rose-500/20 dark:text-rose-400',
  slate: 'bg-slate-500/10 text-slate-500 border-slate-500/20 dark:text-slate-400',
};

export const TenantStatusBadge = ({ tenant }) => {
  if (tenant.legacy) {
    return (
      <span className={`px-2 py-0.5 text-[10px] font-semibold uppercase rounded-md border whitespace-nowrap ${STATUS_STYLE.slate}`} title="Empresa sem cadastro em /tenants">
        Legada
      </span>
    );
  }
  const status = TENANT_STATUSES[tenant.status] || { label: tenant.status || 'Ativa', tone: 'slate' };
  return (
    <span className={`px-2 py-0.5 text-[10px] font-semibold uppercase rounded-md border whitespace-nowrap ${STATUS_STYLE[status.tone] || STATUS_STYLE.slate}`}>
      {status.label}
    </span>
  );
};

const PLAN_STYLE = {
  enterprise: 'bg-amber-600 text-white',
  pro: 'bg-indigo-600 text-white',
  starter: 'bg-slate-700 text-slate-100 dark:bg-slate-700',
};

export const PlanBadge = ({ tenant }) => {
  if (tenant.legacy || !tenant.plan) {
    return <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700">Sem plano</span>;
  }
  const id = String(tenant.plan).toLowerCase();
  const custom = tenant.overrides && Object.keys(tenant.overrides).some((k) => {
    const v = tenant.overrides[k];
    return k === 'features' ? v && Object.keys(v).length > 0 : v !== undefined && v !== null && v !== '';
  });
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider ${PLAN_STYLE[id] || PLAN_STYLE.starter}`}>
        {tenant.entitlements?.planName?.replace(/ plan$/i, '') || id}
      </span>
      {custom && (
        <span className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold uppercase bg-brand/10 text-brand border border-brand/20" title="Limites ou recursos ajustados para esta empresa">
          Sob medida
        </span>
      )}
    </span>
  );
};

const BAR = { ok: 'bg-brand', warning: 'bg-amber-500', critical: 'bg-rose-500' };

export const UsageBar = ({ current, limit, compact = false }) => {
  const known = current !== null && current !== undefined;
  const ratio = usageRatio(current || 0, limit);
  const tone = usageTone(ratio);
  return (
    <div className={compact ? 'min-w-[90px]' : ''}>
      <p className={`font-semibold tabular-nums ${compact ? 'text-[10px]' : 'text-xs'} ${tone === 'critical' ? 'text-rose-600 dark:text-rose-400' : tone === 'warning' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-slate-300'}`}>
        {known ? formatUsage(current, limit) : '—'}
      </p>
      {limit !== null && limit !== undefined && known && (
        <div className="mt-1 h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
          <div className={`h-full rounded-full ${BAR[tone]}`} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
        </div>
      )}
    </div>
  );
};

export const KpiTile = ({ icon: Icon, label, value, hint, tone = 'text-brand bg-brand/10', onClick }) => {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={`text-left bg-white dark:bg-slate-900 p-4 md:p-5 rounded-xl border border-slate-200/90 dark:border-slate-800 shadow-sm flex flex-col justify-between gap-3 min-h-[110px] transition-colors ${onClick ? 'hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50/50 dark:hover:bg-slate-800/40' : ''}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{label}</span>
        <div className={`w-fit p-1.5 rounded-lg ${tone}`}>
          <Icon size={16} />
        </div>
      </div>
      <div>
        <p className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white tracking-tight tabular-nums">{value}</p>
        {hint && <p className="mt-1 text-xs text-slate-400 dark:text-slate-500 font-medium truncate">{hint}</p>}
      </div>
    </Tag>
  );
};
