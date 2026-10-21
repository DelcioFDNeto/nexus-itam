// src/components/audit/AuditHome.jsx
import React, { useMemo } from 'react';
import { CalendarClock, ClipboardCheck, History, MapPin, PlayCircle, Search, Target, XCircle } from 'lucide-react';
import { auditCoverage, AUDIT_COVERAGE_DAYS, auditsInLastDays, expectedAt } from '../../utils/audit';

const formatDate = (date) => (date ? date.toLocaleDateString('pt-BR') : '—');

const Kpi = ({ icon: Icon, label, value, tone }) => (
  <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-4 shadow-sm flex items-center gap-3">
    <span className={`p-2.5 rounded-xl ${tone}`}><Icon size={18} /></span>
    <span>
      <span className="block text-2xl font-black text-gray-900 dark:text-white tabular-nums">{value}</span>
      <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{label}</span>
    </span>
  </div>
);

const accuracyTone = (value) => (value >= 98 ? 'text-green-600 dark:text-green-400' : value >= 90 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400');

/**
 * Inicio da auditoria: cobertura por local (quem esta vencido), indicadores e
 * historico das auditorias ja feitas.
 */
const AuditHome = ({ assets, locationNames, audits, auditsLoading, draft, canRun, onStart, onResume, onOpenReport }) => {
  const [search, setSearch] = React.useState('');
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
          <h1 className="text-2xl font-black text-gray-900 dark:text-white flex items-center gap-2"><ClipboardCheck className="text-brand" /> Auditoria patrimonial</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Inventário físico por local: o que o cadastro diz contra o que está lá. Recomendado a cada {AUDIT_COVERAGE_DAYS} dias.</p>
        </div>
      </div>

      {draft && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl border border-brand/40 bg-brand/5 p-4">
          <PlayCircle size={22} className="text-brand shrink-0" />
          <p className="text-sm text-gray-800 dark:text-gray-100 flex-1">
            Conferência de <strong>{draft.location}</strong> em andamento ({draft.scans.length} leitura(s), iniciada em {new Date(draft.startedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}).
          </p>
          <button type="button" onClick={onResume} className="px-4 py-2.5 rounded-xl bg-brand text-white text-xs font-black uppercase tracking-wider">Retomar</button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={Target} label={`Locais em dia (${AUDIT_COVERAGE_DAYS}d)`} value={`${kpis.upToDate}/${kpis.total}`} tone="text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 dark:text-indigo-300" />
        <Kpi icon={ClipboardCheck} label="Acuracidade média" value={kpis.accuracy === null ? '—' : `${kpis.accuracy}%`} tone="text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300" />
        <Kpi icon={XCircle} label="Não localizados (últimas)" value={kpis.missing} tone="text-rose-600 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-300" />
        <Kpi icon={CalendarClock} label="Auditorias em 30 dias" value={kpis.lastMonth} tone="text-blue-600 bg-blue-50 dark:bg-blue-950/40 dark:text-blue-300" />
      </div>

      <section className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="text-sm font-black uppercase tracking-widest text-gray-500 dark:text-gray-400 flex items-center gap-2"><MapPin size={15} /> Locais</h2>
          <div className="relative sm:w-72">
            <Search size={15} className="absolute left-3 top-2.5 text-gray-400" />
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar local…" aria-label="Buscar local" className="w-full pl-9 pr-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:border-brand" />
          </div>
        </div>
        {cards.length === 0 ? (
          <p className="text-center py-12 text-sm text-gray-400">Nenhum local cadastrado. Cadastre em Configurações → Filiais e locais.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {cards.map((c) => (
              <div key={c.name} className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-4 shadow-sm flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-black text-gray-900 dark:text-white leading-tight">{c.name}</h3>
                  {c.overdue && (
                    <span className="shrink-0 px-2 py-0.5 rounded-md border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300 text-[10px] font-black uppercase">
                      {c.last ? 'Vencida' : 'Nunca auditado'}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  <strong className="text-gray-800 dark:text-gray-100">{c.expected}</strong> ativo(s) esperado(s)
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {c.last ? (
                    <>Última: {formatDate(c.last.dateValue)} · <span className={`font-black ${accuracyTone(c.last.stats?.accuracy ?? 0)}`}>{c.last.stats?.accuracy ?? '—'}%</span>{c.last.stats?.missing ? ` · ${c.last.stats.missing} não localizado(s)` : ''}</>
                  ) : 'Sem auditoria registrada'}
                </p>
                <div className="flex gap-2 mt-auto">
                  {canRun && (
                    <button type="button" onClick={() => onStart(c.name)} className="flex-1 px-3 py-2 rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-xs font-black uppercase tracking-wider">
                      Auditar
                    </button>
                  )}
                  {c.last && (
                    <button type="button" onClick={() => onOpenReport(c.last.id)} className="px-3 py-2 rounded-xl border border-gray-200 dark:border-slate-700 text-xs font-black uppercase tracking-wider text-gray-600 dark:text-gray-300">
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
        <h2 className="text-sm font-black uppercase tracking-widest text-gray-500 dark:text-gray-400 flex items-center gap-2"><History size={15} /> Histórico</h2>
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 overflow-hidden">
          {auditsLoading ? (
            <p className="p-8 text-center text-sm text-gray-400">Carregando…</p>
          ) : audits.length === 0 ? (
            <p className="p-8 text-center text-sm text-gray-400">Nenhuma auditoria registrada ainda.</p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-slate-700/60">
              {audits.map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => onOpenReport(a.id)} className="w-full text-left px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 hover:bg-gray-50 dark:hover:bg-slate-900/40">
                    <span className="sm:w-32 text-xs font-bold text-gray-500 dark:text-gray-400">{a.dateValue ? a.dateValue.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</span>
                    <span className="flex-1 min-w-0 font-bold text-sm text-gray-900 dark:text-white truncate">{a.location}</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400 truncate sm:w-48">{a.auditedByName || a.auditedBy}</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400 sm:w-40">
                      {a.stats?.found ?? 0}/{a.stats?.expected ?? 0}{a.stats?.missing ? ` · ${a.stats.missing} faltando` : ''}
                    </span>
                    <span className={`text-sm font-black sm:w-14 sm:text-right ${accuracyTone(a.stats?.accuracy ?? (a.stats?.expected ? Math.round((a.stats.found / a.stats.expected) * 100) : 100))}`}>
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
