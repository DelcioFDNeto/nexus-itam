// src/components/agent/FleetTab.jsx
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  Cpu,
  Download,
  Monitor,
  Play,
  Search,
  ShieldAlert,
  Terminal,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { toast } from 'sonner';
import { agentHealth, ALERT_LABELS } from '../../utils/agentInventory';
import { isRetired } from '../../utils/assetStatus';
import {
  findLiveDeviceForAsset,
  formatAccessId,
  isDeviceOnline,
} from '../../services/rmmService';

const AGENT_TYPES = new Set(['Computador', 'Notebook', 'Servidor', 'Desktop', 'All-in-One']);

const FILTERS = [
  { id: 'todas', label: 'Todas' },
  { id: 'online-agora', label: 'Online Ao Vivo' },
  { id: 'alertas', label: 'Com alertas' },
  { id: 'criticos', label: 'Críticos' },
  { id: 'sem-comunicacao', label: 'Sem comunicação' },
  { id: 'sem-agente', label: 'Sem agente' },
];

const norm = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

/**
 * Visao de gestor da frota + Console de Acesso Remoto (AnyDesk Web) e Telemetria RMM.
 */
const FleetTab = ({ assets = [], liveDevices = [], staleDays = 7, onOpenRemote }) => {
  const [filter, setFilter] = useState('todas');
  const [alertCode, setAlertCode] = useState('');
  const [search, setSearch] = useState('');
  const [quickConnectInput, setQuickConnectInput] = useState('');

  const active = useMemo(() => assets.filter((a) => !isRetired(a.status) || a.agent), [assets]);

  // Combina os ativos com agente e os dispositivos que ja estao transmitindo via NexusAgent.exe
  const managed = useMemo(() => {
    const matchedDeviceIds = new Set();
    const list = active
      .filter((a) => a.agent || findLiveDeviceForAsset(a, liveDevices))
      .map((a) => {
        const live = findLiveDeviceForAsset(a, liveDevices);
        if (live?.id) matchedDeviceIds.add(live.id);
        const onlineNow = isDeviceOnline(live);
        const accessId = formatAccessId(live || a.agent?.deviceKey || a.serialNumber || a.internalId);
        return {
          ...a,
          liveDevice: live,
          onlineNow,
          accessId,
          health: agentHealth(a, { staleDays }),
        };
      });

    // Dispositivos que acabaram de rodar o NexusAgent.exe e ainda nao estao na colecao de ativos
    liveDevices.forEach((dev) => {
      if (matchedDeviceIds.has(dev.id)) return;
      const onlineNow = isDeviceOnline(dev);
      list.unshift({
        id: `live-${dev.deviceKey}`,
        isStandaloneLive: true,
        internalId: dev.internalId || dev.hostname || 'NOVO-PC',
        model: dev.osCaption || 'Windows Workstation',
        location: 'Conectado via NexusAgent.exe',
        assignedTo: dev.loggedUser || '—',
        liveDevice: dev,
        onlineNow,
        accessId: formatAccessId(dev),
        agent: {
          hostname: dev.hostname,
          loggedUser: dev.loggedUser,
          ip: dev.ipAddress,
          os: dev.osCaption,
          deviceKey: dev.deviceKey,
          alerts: [],
        },
        health: { state: 'online', days: 0, seen: new Date() },
      });
    });

    return list;
  }, [active, liveDevices, staleDays]);

  const uncovered = useMemo(
    () => active.filter((a) => !a.agent && !findLiveDeviceForAsset(a, liveDevices) && !isRetired(a.status) && AGENT_TYPES.has(a.type)),
    [active, liveDevices]
  );

  const alertCounts = useMemo(() => {
    const counts = {};
    managed.forEach((a) =>
      (a.agent?.alerts || []).forEach((al) => {
        counts[al.code] = (counts[al.code] || 0) + 1;
      })
    );
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [managed]);

  const rows = useMemo(() => {
    const q = norm(search.trim());
    const base = filter === 'sem-agente' ? uncovered : managed;
    return base.filter((a) => {
      const alerts = a.agent?.alerts || [];
      if (filter === 'online-agora' && !a.onlineNow) return false;
      if (filter === 'alertas' && !alerts.length) return false;
      if (filter === 'criticos' && !alerts.some((al) => al.level === 'high')) return false;
      if (filter === 'sem-comunicacao' && a.health?.state !== 'stale') return false;
      if (alertCode && !alerts.some((al) => al.code === alertCode)) return false;
      if (!q) return true;
      return norm(
        [
          a.internalId,
          a.accessId,
          a.accessId?.replace(/\s+/g, ''),
          a.model,
          a.agent?.hostname,
          a.agent?.loggedUser,
          a.assignedTo,
          a.location,
          a.agent?.ip,
        ].join(' ')
      ).includes(q);
    });
  }, [filter, alertCode, search, managed, uncovered]);

  const handleQuickConnect = (e) => {
    e.preventDefault();
    const raw = quickConnectInput.trim();
    if (!raw) return;
    const digitsOnly = raw.replace(/\s+/g, '').toLowerCase();
    const target = managed.find(
      (item) =>
        norm(item.accessId).replace(/\s+/g, '') === digitsOnly ||
        norm(item.internalId) === digitsOnly ||
        norm(item.agent?.hostname) === digitsOnly ||
        norm(item.agent?.ip) === digitsOnly
    );
    if (!target) {
      toast.error(`Nenhuma máquina encontrada com o ID ou patrimônio "${raw}".`);
      return;
    }
    const dev =
      target.liveDevice || {
        deviceKey: target.agent?.deviceKey || target.serialNumber || target.internalId,
        accessId: target.accessId,
        hostname: target.agent?.hostname || target.internalId,
        internalId: target.internalId,
        loggedUser: target.agent?.loggedUser || target.assignedTo,
        ipAddress: target.agent?.ip,
        osCaption: target.agent?.os,
      };
    onOpenRemote?.(dev, target, 'screen');
  };

  const exportCsv = () => {
    const header = [
      'Patrimônio',
      'ID Acesso Remoto',
      'Hostname',
      'Modelo',
      'Local',
      'Responsável',
      'Usuário logado',
      'IP',
      'Sistema',
      'Última coleta',
      'Situação',
      'Alertas',
    ];
    const lines = managed.map((a) =>
      [
        a.internalId,
        a.accessId,
        a.agent?.hostname,
        a.model,
        a.location,
        a.assignedTo,
        a.agent?.loggedUser,
        a.agent?.ip,
        a.agent?.os,
        a.health.seen ? a.health.seen.toLocaleString('pt-BR') : '',
        a.onlineNow ? 'Online Ao Vivo' : a.health.state === 'stale' ? `Sem comunicação há ${a.health.days} dias` : 'Comunicando',
        (a.agent?.alerts || []).map((al) => al.message).join(' | '),
      ]
        .map(csvCell)
        .join(';')
    );
    const blob = new Blob([`\uFEFF${[header.map(csvCell).join(';'), ...lines].join('\r\n')}`], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `frota-agente-itam-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  return (
    <div className="space-y-4">
      {/* Barra de Conexao Rapida Estilo AnyDesk */}
      <form
        onSubmit={handleQuickConnect}
        className="bg-slate-900 text-white rounded-2xl p-4 border border-slate-800 shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-3"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
            <Monitor size={20} />
          </div>
          <div>
            <h3 className="font-black text-sm tracking-tight">
              Acesso Remoto Direto (Substituto AnyDesk)
            </h3>
            <p className="text-xs text-slate-400">
              Digite o <strong>ID de Acesso de 9 dígitos</strong> exibido no NexusAgent.exe da máquina, o Patrimônio ou o IP para assumir a tela.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={quickConnectInput}
            onChange={(e) => setQuickConnectInput(e.target.value)}
            placeholder="Ex: 842 910 305 ou SHL-BEL-NTB-001"
            className="w-full md:w-72 px-3.5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 font-mono text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-black text-xs whitespace-nowrap transition-colors shadow-md shadow-blue-600/20"
          >
            <Play size={14} /> Conectar
          </button>
        </div>
      </form>

      {alertCounts.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Alertas da frota">
          {alertCounts.map(([code, count]) => (
            <button
              key={code}
              type="button"
              onClick={() => setAlertCode(alertCode === code ? '' : code)}
              aria-pressed={alertCode === code}
              className={`px-3 py-1.5 rounded-xl border text-[11px] font-bold transition-colors ${
                alertCode === code
                  ? 'bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900'
                  : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300 hover:border-brand/50'
              }`}
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
              className={`px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap ${
                filter === f.id
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700'
              }`}
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
            placeholder="ID Remoto, patrimônio, usuário, IP…"
            aria-label="Buscar na frota"
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:border-brand"
          />
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={!managed.length}
          className="px-3 py-2 rounded-xl border border-gray-200 dark:border-slate-700 text-xs font-black uppercase tracking-wider text-gray-600 dark:text-gray-300 hover:text-brand flex items-center gap-1.5 disabled:opacity-40"
        >
          <Download size={14} /> CSV
        </button>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 overflow-hidden">
        {rows.length === 0 ? (
          <p className="p-10 text-center text-sm text-gray-400">
            {filter === 'sem-agente'
              ? 'Todos os computadores ativos têm o agente.'
              : managed.length
              ? 'Nenhuma máquina neste filtro.'
              : 'Nenhuma máquina com o agente ainda. Instale pela aba "Instalar".'}
          </p>
        ) : filter === 'sem-agente' ? (
          <ul className="divide-y divide-gray-100 dark:divide-slate-700/60">
            {rows.map((a) => (
              <li key={a.id} className="px-4 py-3 flex items-center gap-3 text-sm">
                <Link to={`/assets/${a.id}`} className="font-mono font-black text-gray-900 dark:text-white hover:text-brand">
                  {a.internalId || '—'}
                </Link>
                <span className="truncate text-gray-600 dark:text-gray-300">{a.model}</span>
                <span className="ml-auto text-xs text-gray-400 truncate">
                  {[a.location, a.assignedTo].filter(Boolean).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-slate-900 text-[10px] font-black uppercase tracking-widest text-gray-400">
                <tr>
                  <th className="text-left px-4 py-3">Máquina / ID Acesso</th>
                  <th className="text-left px-4 py-3">Usuário / Local</th>
                  <th className="text-left px-4 py-3">Recursos / Sistema</th>
                  <th className="text-left px-4 py-3">Conexão</th>
                  <th className="text-left px-4 py-3">Alertas</th>
                  <th className="text-right px-4 py-3">Acesso Remoto & RMM</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-700/60">
                {rows.map((a) => {
                  const alerts = a.agent?.alerts || [];
                  const top = alerts[0];
                  const metrics = a.liveDevice?.metrics;
                  const devicePayload = a.liveDevice || {
                    deviceKey: a.agent?.deviceKey || a.serialNumber || a.internalId,
                    accessId: a.accessId,
                    hostname: a.agent?.hostname || a.internalId,
                    internalId: a.internalId,
                    loggedUser: a.agent?.loggedUser || a.assignedTo,
                    ipAddress: a.agent?.ip,
                    osCaption: a.agent?.os,
                  };

                  return (
                    <tr key={a.id} className="hover:bg-gray-50/70 dark:hover:bg-slate-900/40">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                              a.onlineNow ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300 dark:bg-slate-600'
                            }`}
                            title={a.onlineNow ? 'Online Ao Vivo' : 'Sem sinal em tempo real'}
                          />
                          {a.isStandaloneLive ? (
                            <span className="font-mono font-black text-gray-900 dark:text-white">
                              {a.agent?.hostname || a.internalId}
                            </span>
                          ) : (
                            <Link
                              to={`/assets/${a.id}`}
                              className="font-mono font-black text-gray-900 dark:text-white hover:text-brand"
                            >
                              {a.agent?.hostname || a.internalId}
                            </Link>
                          )}
                          <span className="px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-mono text-[11px] font-bold">
                            {a.accessId}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-400 font-mono mt-0.5 pl-4">
                          {a.internalId} · {a.liveDevice?.ipAddress || a.agent?.ip || 'sem IP'}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-gray-800 dark:text-gray-100 truncate max-w-[200px] font-semibold">
                          {a.liveDevice?.loggedUser || a.agent?.loggedUser || a.assignedTo || '—'}
                        </p>
                        <p className="text-[11px] text-gray-400 truncate max-w-[200px]">
                          {a.location || 'Local não definido'}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {metrics ? (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="px-2 py-0.5 rounded bg-blue-50 dark:bg-slate-900 border border-blue-200 dark:border-slate-700 text-blue-700 dark:text-blue-300 font-mono text-[11px] font-bold">
                              CPU {metrics.cpuPercent ?? 0}%
                            </span>
                            <span className="px-2 py-0.5 rounded bg-emerald-50 dark:bg-slate-900 border border-emerald-200 dark:border-slate-700 text-emerald-700 dark:text-emerald-300 font-mono text-[11px] font-bold">
                              RAM {metrics.ramPercent ?? 0}%
                            </span>
                            <span className="px-2 py-0.5 rounded bg-amber-50 dark:bg-slate-900 border border-amber-200 dark:border-slate-700 text-amber-700 dark:text-amber-300 font-mono text-[11px] font-bold">
                              Disco {metrics.diskPercent ?? 0}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-gray-600 dark:text-gray-300 truncate block max-w-[200px]">
                            {a.agent?.os || '—'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs whitespace-nowrap">
                        {a.onlineNow ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-bold text-[11px]">
                            <Wifi size={11} /> Ao Vivo
                          </span>
                        ) : a.health.state === 'stale' ? (
                          <span className="inline-flex items-center gap-1 font-bold text-rose-600 dark:text-rose-400">
                            <WifiOff size={12} /> há {a.health.days} dias
                          </span>
                        ) : (
                          <span className="text-gray-600 dark:text-gray-300">
                            {a.health.days === 0 ? 'hoje' : `há ${a.health.days} dia(s)`}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {a.liveDevice?.supportRequest?.status === 'open' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 font-bold text-[11px]">
                            <AlertTriangle size={12} /> Pedindo Suporte!
                          </span>
                        ) : top ? (
                          <span
                            className={`inline-flex items-start gap-1 ${
                              top.level === 'high'
                                ? 'text-rose-600 dark:text-rose-400'
                                : top.level === 'medium'
                                ? 'text-amber-700 dark:text-amber-300'
                                : 'text-gray-500'
                            }`}
                          >
                            {top.level === 'high' ? (
                              <ShieldAlert size={13} className="shrink-0 mt-px" />
                            ) : (
                              <AlertTriangle size={13} className="shrink-0 mt-px" />
                            )}
                            <span className="line-clamp-2">
                              {top.message}
                              {alerts.length > 1 ? ` (+${alerts.length - 1})` : ''}
                            </span>
                          </span>
                        ) : (
                          <span className="text-green-600 font-bold">OK</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onOpenRemote?.(devicePayload, a, 'screen')}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-sm transition-colors"
                            title="Abrir Tela Remota Interativa (Mouse e Teclado)"
                          >
                            <Monitor size={13} />
                            Conectar
                          </button>
                          <button
                            type="button"
                            onClick={() => onOpenRemote?.(devicePayload, a, 'terminal')}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-gray-700 dark:text-slate-200 font-bold text-xs transition-colors"
                            title="Abrir Terminal PowerShell Remoto"
                          >
                            <Terminal size={13} />
                          </button>
                        </div>
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
