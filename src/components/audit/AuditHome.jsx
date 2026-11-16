// src/components/audit/AuditHome.jsx
import React, { useId, useMemo } from 'react';
import { CalendarClock, ClipboardCheck, History, MapPin, PlayCircle, Search, Target, XCircle } from 'lucide-react';
import { auditCoverage, AUDIT_COVERAGE_DAYS, auditsInLastDays, expectedAt } from '../../utils/audit';

const formatDate = (date) => (date ? date.toLocaleDateString('pt-BR') : '—');

const Kpi = ({ icon: Icon, label, value, tone }) => (
  <div className="bg-white dark:bg-[#111113] rounded-2xl border border-slate-200/90 dark:border-zinc-800 p-4 shadow-sm flex items-center gap-3">
    <span className={`p-2.5 rounded-xl shrink-0 ${tone}`}>
      <Icon size={18} aria-hidden="true" />
    </span>
    <span>
      <span className="block text-2xl font-black text-slate-900 dark:text-[#fafafa] tabular-nums">{value}</span>
      <span className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">{label}</span>
    </span>
  </div>
);

const accuracyTone = (value) => (value >= 98 ? 'text-emerald-700 dark:text-emerald-400' : value >= 90 ? 'text-amber-700 dark:text-amber-400' : 'text-rose-700 dark:text-rose-400');

/**
 * Inicio da auditoria: cobertura por local (quem esta vencido), indicadores e
 * historico das auditorias ja feitas.
 */
const AuditHome = ({ assets, locationNames, audits, auditsLoading, auditsError, onRetryAudits, draft, canRun, onStart, onResume, onOpenReport }) => {
  const [search, setSearch] = React.useState('');
  const searchInputId = useId();
  const coverage = useMemo(() => auditCoverage(locationNames, audits), [locationNames, audits]);

  const kpis = useMemo(() => {
    const latest = coverage.filter((c) => c.last);
    const avg = latest.length ? Math.round(latest.reduce((sum, c) => sum + (c.last.stats?.accuracy ?? 0), 0) / latest.length) : null;
    return {
      upToDate: coverage.filter((c) => !c.overdue).length,
      total: coverage.length,
      accuracy: avg,
      missing: latest.reduce((sum, c) => sum + (c.last.stats?.missing ?? 0), 0),
      lastMonth: auditsInLastDays(audits, 30),
    };
  }, [coverage, audits]);

  const cards = useMemo(() => {
    const q = search.trim().toLowerCase();
    return coverage
      .map((c) => ({ ...c, expected: expectedAt(assets, c.name).length }))
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.name.localeCompare(b.name, 'pt-BR'));
  }, [coverage, assets, search]);

  return (
    <div className="max-w-7xl mx-auto pb-24 space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-[#fafafa] flex items-center gap-2">
            <ClipboardCheck className="text-brand-aa" aria-hidden="true" /> Auditoria patrimonial
          </h1>
          <p className="text-sm text-slate-600 dark:text-zinc-400 tabular-nums">
            Inventário físico por local: o que o cadastro diz contra o que está lá. Recomendado a cada {AUDIT_COVERAGE_DAYS} dias.
          </p>
        </div>
      </div>

      {draft && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl border border-brand/40 bg-brand/5 dark:bg-brand/10 p-4">
          <PlayCircle size={22} className="text-brand-aa shrink-0" aria-hidden="true" />
          <p className="text-sm text-slate-800 dark:text-zinc-100 flex-1 tabular-nums">
            Conferência de <strong>{draft.location}</strong> em andamento ({draft.scans.length} leitura(s), iniciada em {new Date(draft.startedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}).
          </p>
          <button
            type="button"
            onClick={onResume}
            className="min-h-[44px] px-4 py-2.5 rounded-xl bg-brand hover:bg-brand-dark text-brand-fg text-xs font-black uppercase tracking-wider transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            Retomar
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={Target} label={`Locais em dia (${AUDIT_COVERAGE_DAYS}d)`} value={`${kpis.upToDate}/${kpis.total}`} tone="text-brand-aa bg-brand/10 dark:bg-brand/15" />
        <Kpi icon={ClipboardCheck} label="Acuracidade média" value={kpis.accuracy === null ? '—' : `${kpis.accuracy}%`} tone="text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300" />
        <Kpi icon={XCircle} label="Não localizados (últimas)" value={kpis.missing} tone="text-rose-700 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-300" />
        <Kpi icon={CalendarClock} label="Auditorias em 30 dias" value={kpis.lastMonth} tone="text-sky-700 bg-sky-50 dark:bg-sky-950/40 dark:text-sky-300" />
      </div>

      <section className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="text-sm font-black uppercase tracking-widest text-slate-600 dark:text-zinc-400 flex items-center gap-2">
            <MapPin size={15} aria-hidden="true" /> Locais
          </h2>
          <div className="relative sm:w-72">
            <label htmlFor={searchInputId} className="sr-only">
              Buscar local
            </label>
            <Search size={15} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-zinc-400 pointer-events-none" />
            <input
              id={searchInputId}
              name="locationSearch"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar local…"
              aria-label="Buscar local"
              className="w-full min-h-[44px] pl-9 pr-3 py-2 rounded-xl bg-white hover:border-slate-400 active:border-slate-500 focus-visible:outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25 disabled:opacity-50 disabled:cursor-not-allowed aria-[invalid=true]:border-rose-500 aria-[invalid=true]:focus-visible:ring-rose-500/25 dark:bg-[#111113] dark:border-zinc-800 dark:hover:border-zinc-700 border border-slate-300 text-sm text-slate-900 dark:text-[#fafafa] placeholder:text-slate-400 dark:placeholder:text-zinc-500 transition-colors"
            />
          </div>
        </div>
        {cards.length === 0 ? (
          <p className="text-center py-12 text-sm text-slate-500 dark:text-zinc-400">Nenhum local cadastrado. Cadastre em Configurações → Filiais e locais.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {cards.map((c) => (
              <div key={c.name} className="bg-white dark:bg-[#111113] rounded-2xl border border-slate-200/90 dark:border-zinc-800 p-4 shadow-sm flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-black text-slate-900 dark:text-[#fafafa] leading-tight">{c.name}</h3>
                  {c.overdue && (
                    <span className="shrink-0 px-2 py-0.5 rounded-md border border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300 text-xs font-black uppercase">
                      {c.last ? 'Vencida' : 'Nunca auditado'}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-600 dark:text-zinc-400 tabular-nums">
                  <strong className="text-slate-900 dark:text-zinc-100">{c.expected}</strong> ativo(s) esperado(s)
                </p>
                <p className="text-xs text-slate-600 dark:text-zinc-400 tabular-nums">
                  {c.last ? (
                    <>Última: {formatDate(c.last.dateValue)} · <span className={`font-black ${accuracyTone(c.last.stats?.accuracy ?? 0)}`}>{c.last.stats?.accuracy ?? '—'}%</span>{c.last.stats?.missing ? ` · ${c.last.stats.missing} não localizado(s)` : ''}</>
                  ) : 'Sem auditoria registrada'}
                </p>
                <div className="flex gap-2 mt-auto">
                  {canRun && (
                    <button
                      type="button"
                      onClick={() => onStart(c.name)}
                      className="min-h-[44px] flex-1 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white dark:bg-[#fafafa] dark:hover:bg-zinc-200 dark:text-[#09090b] text-xs font-black uppercase tracking-wider transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    >
                      Auditar
                    </button>
                  )}
                  {c.last && (
                    <button
                      type="button"
                      onClick={() => onOpenReport(c.last.id)}
                      className="min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 hover:bg-slate-50 dark:hover:bg-zinc-800 text-xs font-black uppercase tracking-wider text-slate-700 dark:text-zinc-300 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    >
                      Relatório
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-black uppercase tracking-widest text-slate-600 dark:text-zinc-400 flex items-center gap-2">
          <History size={15} aria-hidden="true" /> Histórico
        </h2>
        <div className="bg-white dark:bg-[#111113] rounded-2xl border border-slate-200/90 dark:border-zinc-800 overflow-hidden shadow-sm">
          {auditsLoading ? (
            <p role="status" className="p-8 text-center text-sm text-slate-500 dark:text-zinc-400">Carregando…</p>
          ) : auditsError ? (
            <div role="alert" className="p-8 text-center space-y-3">
              <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">{auditsError}</p>
              {onRetryAudits && (
                <button
                  type="button"
                  onClick={onRetryAudits}
                  className="min-h-[44px] px-4 py-2 rounded-xl bg-brand hover:bg-brand-dark text-brand-fg text-xs font-bold uppercase tracking-wider transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  Tentar novamente
                </button>
              )}
            </div>
          ) : audits.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-500 dark:text-zinc-400">Nenhuma auditoria registrada ainda.</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-zinc-800">
              {audits.map((a) => (
                <li key={a.id} className="[content-visibility:auto] [contain-intrinsic-size:auto_56px]">
                  <button
                    type="button"
                    onClick={() => onOpenReport(a.id)}
                    className="w-full min-h-[44px] text-left px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 hover:bg-slate-50 dark:hover:bg-zinc-900/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
                  >
                    <span className="sm:w-32 text-xs font-bold text-slate-500 dark:text-zinc-400 tabular-nums">
                      {a.dateValue ? a.dateValue.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                    </span>
                    <span className="flex-1 min-w-0 font-bold text-sm text-slate-900 dark:text-[#fafafa] truncate">{a.location}</span>
                    <span className="text-xs text-slate-600 dark:text-zinc-400 truncate sm:w-48">{a.auditedByName || a.auditedBy}</span>
                    <span className="text-xs text-slate-600 dark:text-zinc-400 sm:w-40 tabular-nums">
                      {a.stats?.found ?? 0}/{a.stats?.expected ?? 0}{a.stats?.missing ? ` · ${a.stats.missing} faltando` : ''}
                    </span>
                    <span className={`text-sm font-black sm:w-14 sm:text-right tabular-nums ${accuracyTone(a.stats?.accuracy ?? (a.stats?.expected ? Math.round((a.stats.found / a.stats.expected) * 100) : 100))}`}>
                      {a.stats?.accuracy ?? (a.stats?.expected ? Math.round((a.stats.found / a.stats.expected) * 100) : 100)}%
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
};

export default AuditHome;
