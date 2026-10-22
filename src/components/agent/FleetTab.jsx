// src/components/agent/FleetTab.jsx
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowUpCircle,
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
import { useConfirm } from '../ConfirmDialog';
import { AGENT_VERSION, agentHealth, ALERT_LABELS, isAgentOutdated } from '../../utils/agentInventory';
import { isRetired } from '../../utils/assetStatus';
import {
  dispatchAgentUpdate,
  dispatchBatchAgentUpdate,
  findLiveDeviceForAsset,
  formatAccessId,
  isDeviceOnline,
} from '../../services/rmmService';

const AGENT_TYPES = new Set(['Computador', 'Notebook', 'Servidor', 'Desktop', 'All-in-One']);

const FILTERS = [
  { id: 'todas', label: 'Todas' },
  { id: 'online-agora', label: 'Online Ao Vivo' },
  { id: 'desatualizados', label: 'Desatualizados' },
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
 * Visao de gestor da frota + Console de Acesso Remoto (NexusDesk), Atualizacao OTA e Telemetria RMM.
 */
const FleetTab = ({
  assets = [],
  liveDevices = [],
  staleDays = 7,
  tenantId = '',
  currentUser = null,
  onOpenRemote,
}) => {
  const confirm = useConfirm();
  const [filter, setFilter] = useState('todas');
  const [alertCode, setAlertCode] = useState('');
  const [search, setSearch] = useState('');
  const [quickConnectInput, setQuickConnectInput] = useState('');
  const [updatingKey, setUpdatingKey] = useState('');
  const [batchUpdating, setBatchUpdating] = useState(false);

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
        const agentVersion = live?.agentVersion || a.agent?.version || '';
        const outdated = Boolean(live?.deviceKey || a.agent?.deviceKey) && isAgentOutdated(agentVersion);
        return {
          ...a,
          liveDevice: live,
          onlineNow,
          accessId,
          agentVersion,
          outdated,
          health: agentHealth(a, { staleDays }),
        };
      });

    // Dispositivos que acabaram de rodar o NexusAgent.exe e ainda nao estao na colecao de ativos
    liveDevices.forEach((dev) => {
      if (matchedDeviceIds.has(dev.id)) return;
      const onlineNow = isDeviceOnline(dev);
      const agentVersion = dev.agentVersion || '';
      const outdated = Boolean(dev.deviceKey) && isAgentOutdated(agentVersion);
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
        agentVersion,
        outdated,
        agent: {
          hostname: dev.hostname,
          loggedUser: dev.loggedUser,
          ip: dev.ipAddress,
          os: dev.osCaption,
          deviceKey: dev.deviceKey,
          version: agentVersion,
          alerts: [],
        },
        health: { state: 'online', days: 0, seen: new Date() },
      });
    });

    return list;
  }, [active, liveDevices, staleDays]);

  const outdatedItems = useMemo(
    () => managed.filter((a) => a.outdated && (a.liveDevice?.deviceKey || a.agent?.deviceKey)),
    [managed]
  );

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
      if (filter === 'desatualizados' && !a.outdated) return false;
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
          a.agentVersion,
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
      toast.error(`Nenhuma máquina encontrada com o ID NexusDesk ou patrimônio "${raw}".`);
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
        agentVersion: target.agentVersion,
      };
    onOpenRemote?.(dev, target, 'screen');
  };

  const handleSingleUpdate = async (item) => {
    const deviceKey = item.liveDevice?.deviceKey || item.agent?.deviceKey;
    if (!tenantId || !deviceKey) {
      toast.error('Esta máquina ainda não possui matrícula ativa do NexusAgent.exe para atualização remota.');
      return;
    }
    const host = item.agent?.hostname || item.internalId;
    const ok = await confirm({
      title: `Atualizar Agente em ${host} para v${AGENT_VERSION}?`,
      message: `O comando OTA será enviado para ${host}. A máquina baixará o pacote oficial v${AGENT_VERSION} e reiniciará o serviço NexusITAMAgent automaticamente mantendo sua matrícula.`,
      confirmLabel: `Atualizar p/ v${AGENT_VERSION}`,
    });
    if (!ok) return;
    setUpdatingKey(deviceKey);
    try {
      await dispatchAgentUpdate({
        tenantId,
        deviceKey,
        hostname: host,
        targetVersion: AGENT_VERSION,
        user: currentUser,
      });
      toast.success(`Atualização v${AGENT_VERSION} enviada para ${host}!`);
    } catch (e) {
      toast.error(e?.message || 'Erro ao enviar atualização para a máquina.');
    } finally {
      setUpdatingKey('');
    }
  };

  const handleBatchUpdate = async () => {
    if (!tenantId || !outdatedItems.length) return;
    const ok = await confirm({
      title: `Atualizar ${outdatedItems.length} máquina(s) para v${AGENT_VERSION}?`,
      message: `Todas as ${outdatedItems.length} máquinas com versão anterior receberão o comando OTA assinado para atualizar silenciosamente para o NexusAgent v${AGENT_VERSION} (com NexusDesk).`,
      confirmLabel: `Atualizar ${outdatedItems.length} máquina(s)`,
    });
    if (!ok) return;
    setBatchUpdating(true);
    try {
      const devicesToUpdate = outdatedItems.map((a) => ({
        deviceKey: a.liveDevice?.deviceKey || a.agent?.deviceKey,
        hostname: a.agent?.hostname || a.internalId,
      }));
      const res = await dispatchBatchAgentUpdate({
        tenantId,
        devices: devicesToUpdate,
        targetVersion: AGENT_VERSION,
        user: currentUser,
      });
      if (res.updated > 0) {
        toast.success(`Comando de atualização v${AGENT_VERSION} enviado para ${res.updated} máquina(s)!`);
      }
      if (res.failed > 0) {
        toast.warning(`${res.failed} máquina(s) não puderam receber o comando.`);
      }
    } catch (e) {
      toast.error(e?.message || 'Falha na atualização em lote.');
    } finally {
      setBatchUpdating(false);
    }
  };

  const exportCsv = () => {
    const header = [
      'Patrimônio',
      'ID NexusDesk',
      'Versão Agente',
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
        a.agentVersion ? `v${a.agentVersion}` : '',
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
    link.download = `frota-nexusdesk-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  return (
    <div className="space-y-4">
      {/* Barra de Conexao Rapida NexusDesk */}
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
              NexusDesk — Acesso Remoto Direto (Desktop & Mobile)
            </h3>
            <p className="text-xs text-slate-400">
              Digite o <strong>ID NexusDesk de 9 dígitos</strong> exibido no agente da máquina, o Patrimônio ou o IP para assumir a tela.
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

      {/* Banner de Atualizacao OTA em Lote quando ha agentes desatualizados */}
      {outdatedItems.length > 0 && (
        <div className="p-4 rounded-2xl bg-gradient-to-r from-indigo-50 to-blue-50 dark:from-indigo-950/50 dark:to-slate-900 border border-indigo-200 dark:border-indigo-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0">
              <ArrowUpCircle size={18} />
            </div>
            <div>
              <h4 className="font-black text-xs sm:text-sm text-gray-900 dark:text-white">
                Nova versão do Agente & NexusDesk disponível (v{AGENT_VERSION})
              </h4>
              <p className="text-xs text-gray-600 dark:text-slate-300">
                <strong>{outdatedItems.length}</strong> máquina(s) da frota estão em versão anterior e podem ser atualizadas remotamente em 1 clique pela nuvem.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setFilter(filter === 'desatualizados' ? 'todas' : 'desatualizados')}
              className="px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-indigo-200 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 font-bold text-xs"
            >
              {filter === 'desatualizados' ? 'Ver todas' : 'Filtrar desatualizadas'}
            </button>
            <button
              type="button"
              onClick={handleBatchUpdate}
              disabled={batchUpdating}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-black text-xs shadow-sm transition-colors"
            >
              <ArrowUpCircle size={14} className={batchUpdating ? 'animate-bounce' : ''} />
              {batchUpdating ? 'Enviando OTA...' : `Atualizar ${outdatedItems.length} máquina(s)`}
            </button>
          </div>
        </div>
      )}

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
        <div className="flex gap-1 overflow-x-auto no-scrollbar">
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
              {f.id === 'desatualizados' && outdatedItems.length > 0 ? ` (${outdatedItems.length})` : ''}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 md:ml-auto">
          <div className="relative flex-1 md:w-72">
            <Search size={15} className="absolute left-3 top-2.5 text-gray-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ID NexusDesk, patrimônio, usuário, IP…"
              aria-label="Buscar na frota"
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:border-brand"
            />
          </div>
          <button
            type="button"
            onClick={exportCsv}
            disabled={!managed.length}
            className="px-3 py-2 rounded-xl border border-gray-200 dark:border-slate-700 text-xs font-black uppercase tracking-wider text-gray-600 dark:text-gray-300 hover:text-brand flex items-center gap-1.5 disabled:opacity-40 shrink-0"
          >
            <Download size={14} /> CSV
          </button>
        </div>
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
          <>
            {/* Visao Mobile em Cards (Otimizada para Celular) */}
            <div className="md:hidden divide-y divide-gray-100 dark:divide-slate-700/60">
              {rows.map((a) => {
                const metrics = a.liveDevice?.metrics;
                const devKey = a.liveDevice?.deviceKey || a.agent?.deviceKey;
                const devicePayload = a.liveDevice || {
                  deviceKey: devKey || a.serialNumber || a.internalId,
                  accessId: a.accessId,
                  hostname: a.agent?.hostname || a.internalId,
                  internalId: a.internalId,
                  loggedUser: a.agent?.loggedUser || a.assignedTo,
                  ipAddress: a.agent?.ip,
                  osCaption: a.agent?.os,
                  agentVersion: a.agentVersion,
                };

                return (
                  <div key={a.id} className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                              a.onlineNow ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300 dark:bg-slate-600'
                            }`}
                          />
                          {a.isStandaloneLive ? (
                            <span className="font-mono font-black text-sm text-gray-900 dark:text-white truncate">
                              {a.agent?.hostname || a.internalId}
                            </span>
                          ) : (
                            <Link
                              to={`/assets/${a.id}`}
                              className="font-mono font-black text-sm text-gray-900 dark:text-white hover:text-brand truncate"
                            >
                              {a.agent?.hostname || a.internalId}
                            </Link>
                          )}
                          <span className="px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-mono text-[11px] font-bold">
                            {a.accessId}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
                          {a.liveDevice?.loggedUser || a.agent?.loggedUser || a.assignedTo || 'Sem usuário'} ·{' '}
                          {a.liveDevice?.ipAddress || a.agent?.ip || 'sem IP'}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        {a.onlineNow ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-bold text-[10px]">
                            <Wifi size={10} /> Ao Vivo
                          </span>
                        ) : (
                          <span className="text-[11px] text-gray-400">
                            {a.health.days === 0 ? 'hoje' : `${a.health.days}d`}
                          </span>
                        )}
                        {a.agentVersion && (
                          <span
                            className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-bold ${
                              a.outdated
                                ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'
                                : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300'
                            }`}
                          >
                            v{a.agentVersion}
                          </span>
                        )}
                      </div>
                    </div>

                    {metrics && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="px-2 py-0.5 rounded bg-blue-50 dark:bg-slate-900 border border-blue-200 dark:border-slate-700 text-blue-700 dark:text-blue-300 font-mono text-[10px] font-bold">
                          CPU {metrics.cpuPercent ?? 0}%
                        </span>
                        <span className="px-2 py-0.5 rounded bg-emerald-50 dark:bg-slate-900 border border-emerald-200 dark:border-slate-700 text-emerald-700 dark:text-emerald-300 font-mono text-[10px] font-bold">
                          RAM {metrics.ramPercent ?? 0}%
                        </span>
                        <span className="px-2 py-0.5 rounded bg-amber-50 dark:bg-slate-900 border border-amber-200 dark:border-slate-700 text-amber-700 dark:text-amber-300 font-mono text-[10px] font-bold">
                          Disco {metrics.diskPercent ?? 0}%
                        </span>
                      </div>
                    )}

                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => onOpenRemote?.(devicePayload, a, 'screen')}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-sm"
                      >
                        <Monitor size={14} />
                        NexusDesk
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenRemote?.(devicePayload, a, 'terminal')}
                        className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 font-bold text-xs"
                        title="Terminal PowerShell"
                      >
                        <Terminal size={14} />
                        PS
                      </button>
                      {a.outdated && devKey && (
                        <button
                          type="button"
                          onClick={() => handleSingleUpdate(a)}
                          disabled={updatingKey === devKey}
                          className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold text-xs"
                          title={`Atualizar para v${AGENT_VERSION}`}
                        >
                          <ArrowUpCircle size={14} />
                          v{AGENT_VERSION}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Visao Desktop em Tabela */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-slate-900 text-[10px] font-black uppercase tracking-widest text-gray-400">
                  <tr>
                    <th className="text-left px-4 py-3">Máquina / ID NexusDesk</th>
                    <th className="text-left px-4 py-3">Usuário / Local</th>
                    <th className="text-left px-4 py-3">Recursos / Sistema</th>
                    <th className="text-left px-4 py-3">Conexão & Versão</th>
                    <th className="text-left px-4 py-3">Alertas</th>
                    <th className="text-right px-4 py-3">NexusDesk & RMM</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-700/60">
                  {rows.map((a) => {
                    const alerts = a.agent?.alerts || [];
                    const top = alerts[0];
                    const metrics = a.liveDevice?.metrics;
                    const devKey = a.liveDevice?.deviceKey || a.agent?.deviceKey;
                    const devicePayload = a.liveDevice || {
                      deviceKey: devKey || a.serialNumber || a.internalId,
                      accessId: a.accessId,
                      hostname: a.agent?.hostname || a.internalId,
                      internalId: a.internalId,
                      loggedUser: a.agent?.loggedUser || a.assignedTo,
                      ipAddress: a.agent?.ip,
                      osCaption: a.agent?.os,
                      agentVersion: a.agentVersion,
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
                          <div className="flex items-center gap-1.5">
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
                            {a.agentVersion && (
                              <span
                                className={`px-2 py-0.5 rounded-full font-mono text-[10px] font-bold ${
                                  a.outdated
                                    ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'
                                    : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300'
                                }`}
                                title={a.outdated ? `Desatualizado (última: v${AGENT_VERSION})` : 'Agente atualizado'}
                              >
                                v{a.agentVersion}
                              </span>
                            )}
                          </div>
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
                            {a.outdated && devKey && (
                              <button
                                type="button"
                                onClick={() => handleSingleUpdate(a)}
                                disabled={updatingKey === devKey}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 font-bold text-xs transition-colors"
                                title={`Atualizar remotamente para v${AGENT_VERSION}`}
                              >
                                <ArrowUpCircle size={13} className={updatingKey === devKey ? 'animate-bounce' : ''} />
                                v{AGENT_VERSION}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => onOpenRemote?.(devicePayload, a, 'screen')}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-sm transition-colors"
                              title="Abrir NexusDesk (Tela Remota Interativa)"
                            >
                              <Monitor size={13} />
                              NexusDesk
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
          </>
        )}
      </div>
    </div>
  );
};

export default FleetTab;
