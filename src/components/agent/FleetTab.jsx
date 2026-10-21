// src/components/agent/FleetTab.jsx
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Download, Search, ShieldAlert, WifiOff } from 'lucide-react';
import { agentHealth, ALERT_LABELS } from '../../utils/agentInventory';
import { isRetired } from '../../utils/assetStatus';

const AGENT_TYPES = new Set(['Computador', 'Notebook', 'Servidor', 'Desktop', 'All-in-One']);

const FILTERS = [
  { id: 'todas', label: 'Todas' },
  { id: 'alertas', label: 'Com alertas' },
  { id: 'criticos', label: 'Críticos' },
  { id: 'sem-comunicacao', label: 'Sem comunicação' },
  { id: 'sem-agente', label: 'Sem agente' },
];

const norm = (value) => String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

/**
 * Visao de gestor da frota: quem comunica, quem sumiu, quem tem problema e
 * quais computadores ainda estao sem agente.
 */
const FleetTab = ({ assets, staleDays }) => {
  const [filter, setFilter] = useState('todas');
  const [alertCode, setAlertCode] = useState('');
  const [search, setSearch] = useState('');

  const active = useMemo(() => assets.filter((a) => !isRetired(a.status) || a.agent), [assets]);
  const managed = useMemo(() => active.filter((a) => a.agent).map((a) => ({ ...a, health: agentHealth(a, { staleDays }) })), [active, staleDays]);
  const uncovered = useMemo(() => active.filter((a) => !a.agent && !isRetired(a.status) && AGENT_TYPES.has(a.type)), [active]);

  const alertCounts = useMemo(() => {
    const counts = {};
    managed.forEach((a) => (a.agent.alerts || []).forEach((al) => { counts[al.code] = (counts[al.code] || 0) + 1; }));
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [managed]);

  const rows = useMemo(() => {
    const q = norm(search.trim());
    const base = filter === 'sem-agente' ? uncovered : managed;
    return base.filter((a) => {
      const alerts = a.agent?.alerts || [];
      if (filter === 'alertas' && !alerts.length) return false;
      if (filter === 'criticos' && !alerts.some((al) => al.level === 'high')) return false;
      if (filter === 'sem-comunicacao' && a.health?.state !== 'stale') return false;
      if (alertCode && !alerts.some((al) => al.code === alertCode)) return false;
      if (!q) return true;
      return norm([a.internalId, a.model, a.agent?.hostname, a.agent?.loggedUser, a.assignedTo, a.location, a.agent?.ip].join(' ')).includes(q);
    });
  }, [filter, alertCode, search, managed, uncovered]);

  const exportCsv = () => {
    const header = ['Patrimônio', 'Hostname', 'Modelo', 'Local', 'Responsável', 'Usuário logado', 'IP', 'Sistema', 'Última coleta', 'Situação', 'Alertas'];
    const lines = managed.map((a) => [
      a.internalId, a.agent.hostname, a.model, a.location, a.assignedTo, a.agent.loggedUser, a.agent.ip, a.agent.os,
      a.health.seen ? a.health.seen.toLocaleString('pt-BR') : '', a.health.state === 'stale' ? `Sem comunicação há ${a.health.days} dias` : 'Comunicando',
      (a.agent.alerts || []).map((al) => al.message).join(' | '),
    ].map(csvCell).join(';'));
    const blob = new Blob([`\uFEFF${[header.map(csvCell).join(';'), ...lines].join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `frota-agente-itam-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  return (
    <div className="space-y-4">
      {alertCounts.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Alertas da frota">
          {alertCounts.map(([code, count]) => (
            <button
              key={code}
              type="button"
              onClick={() => setAlertCode(alertCode === code ? '' : code)}
              aria-pressed={alertCode === code}
              className={`px-3 py-1.5 rounded-xl border text-[11px] font-bold transition-colors ${alertCode === code ? 'bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900' : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300 hover:border-brand/50'}`}
            >
              {ALERT_LABELS[code] || code} <span className="ml-1 tabular-nums opacity-70">{count}</span>
            </button>
          ))}
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-3 flex flex-col md:flex-row gap-3 md:items-center">
        <div className="flex gap-1 overflow-x-auto scrollbar-hide">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              className={`px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap ${filter === f.id ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative md:ml-auto md:w-72">
          <Search size={15} className="absolute left-3 top-2.5 text-gray-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Hostname, patrimônio, usuário, IP…"
            aria-label="Buscar na frota"
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:border-brand"
          />
        </div>
        <button type="button" onClick={exportCsv} disabled={!managed.length} className="px-3 py-2 rounded-xl border border-gray-200 dark:border-slate-700 text-xs font-black uppercase tracking-wider text-gray-600 dark:text-gray-300 hover:text-brand flex items-center gap-1.5 disabled:opacity-40">
          <Download size={14} /> CSV
        </button>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 overflow-hidden">
        {rows.length === 0 ? (
          <p className="p-10 text-center text-sm text-gray-400">
            {filter === 'sem-agente' ? 'Todos os computadores ativos têm o agente.' : managed.length ? 'Nenhuma máquina neste filtro.' : 'Nenhuma máquina com o agente ainda. Instale pela aba "Instalar".'}
          </p>
        ) : filter === 'sem-agente' ? (
          <ul className="divide-y divide-gray-100 dark:divide-slate-700/60">
            {rows.map((a) => (
              <li key={a.id} className="px-4 py-3 flex items-center gap-3 text-sm">
                <Link to={`/assets/${a.id}`} className="font-mono font-black text-gray-900 dark:text-white hover:text-brand">{a.internalId || '—'}</Link>
                <span className="truncate text-gray-600 dark:text-gray-300">{a.model}</span>
                <span className="ml-auto text-xs text-gray-400 truncate">{[a.location, a.assignedTo].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-slate-900 text-[10px] font-black uppercase tracking-widest text-gray-400">
                <tr>
                  <th className="text-left px-4 py-3">Máquina</th>
                  <th className="text-left px-4 py-3">Usuário / local</th>
                  <th className="text-left px-4 py-3">Sistema</th>
                  <th className="text-left px-4 py-3">Última coleta</th>
                  <th className="text-left px-4 py-3">Alertas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-700/60">
                {rows.map((a) => {
                  const alerts = a.agent.alerts || [];
                  const top = alerts[0];
                  return (
                    <tr key={a.id} className="hover:bg-gray-50/70 dark:hover:bg-slate-900/40">
                      <td className="px-4 py-3">
                        <Link to={`/assets/${a.id}`} className="font-mono font-black text-gray-900 dark:text-white hover:text-brand">{a.agent.hostname || a.internalId}</Link>
                        <p className="text-[11px] text-gray-400 font-mono">{a.internalId} · {a.agent.ip || 'sem IP'}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-gray-800 dark:text-gray-100 truncate max-w-[220px]">{a.agent.loggedUser || a.assignedTo || '—'}</p>
                        <p className="text-[11px] text-gray-400 truncate max-w-[220px]">{a.location || 'Local não definido'}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-300 max-w-[200px] truncate">{a.agent.os || '—'}</td>
                      <td className="px-4 py-3 text-xs whitespace-nowrap">
                        {a.health.state === 'stale' ? (
                          <span className="inline-flex items-center gap-1 font-bold text-rose-600 dark:text-rose-400"><WifiOff size={12} /> há {a.health.days} dias</span>
                        ) : (
                          <span className="text-gray-600 dark:text-gray-300">{a.health.days === 0 ? 'hoje' : `há ${a.health.days} dia(s)`}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {top ? (
                          <span className={`inline-flex items-start gap-1 ${top.level === 'high' ? 'text-rose-600 dark:text-rose-400' : top.level === 'medium' ? 'text-amber-700 dark:text-amber-300' : 'text-gray-500'}`}>
                            {top.level === 'high' ? <ShieldAlert size={13} className="shrink-0 mt-px" /> : <AlertTriangle size={13} className="shrink-0 mt-px" />}
                            <span className="line-clamp-2">{top.message}{alerts.length > 1 ? ` (+${alerts.length - 1})` : ''}</span>
                          </span>
                        ) : (
                          <span className="text-green-600 font-bold">OK</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default FleetTab;
