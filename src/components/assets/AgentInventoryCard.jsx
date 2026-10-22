// src/components/assets/AgentInventoryCard.jsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, Battery, CheckCircle2, Cpu, HardDrive, Monitor, Network, Package, Search, ShieldAlert, ShieldCheck, Terminal, UserCheck, Users, Wifi,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantSettings } from '../../hooks/useTenantSettings';
import { getAssetInventory } from '../../services/agentService';
import { moveAsset } from '../../services/assetService';
import {
  findLiveDeviceForAsset,
  formatAccessId,
  isDeviceOnline,
  subscribeAgentDevices,
} from '../../services/rmmService';
import { agentHealth, ALERT_LEVELS, resolveAgentPolicy } from '../../utils/agentInventory';
import { lifecycleBlocker } from '../../utils/assetStatus';
import { can } from '../../utils/permissions';
import RemoteControlModal from '../agent/RemoteControlModal';

const LEVEL_STYLE = {
  high: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300',
  medium: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300',
  low: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
};

const formatDate = (value) => {
  if (!value) return '—';
  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

const Fact = ({ label, value, mono = false }) => (
  <div className="min-w-0">
    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">{label}</p>
    <p className={`text-sm font-bold text-gray-900 dark:text-white truncate ${mono ? 'font-mono text-xs' : ''}`} title={typeof value === 'string' ? value : undefined}>{value || '—'}</p>
  </div>
);

const SectionTitle = ({ icon: Icon, children }) => (
  <h4 className="text-[11px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1.5"><Icon size={13} /> {children}</h4>
);

/**
 * Inventario coletado pelo Agente ITAM: saude da comunicacao, alertas com
 * acao de um clique, seguranca, discos, monitores e programas instalados.
 */
const AgentInventoryCard = ({ asset }) => {
  const { currentUser } = useAuth();
  const { settings } = useTenantSettings();
  const policy = resolveAgentPolicy(settings);
  const canWrite = can(currentUser, 'assets:write');
  const canRemote = can(currentUser, 'agent:remote');
  // Inventario detalhado e dado da empresa (LGPD): fora dela (ex.: master), nem consulta.
  const ownTenant = Boolean(currentUser?.tenantId) && currentUser.tenantId === asset.tenantId;
  const [state, setState] = useState({ assetId: null, inventory: null, error: false });
  const [search, setSearch] = useState('');
  const [showAllSoftware, setShowAllSoftware] = useState(false);
  const [busy, setBusy] = useState(false);
  const [liveDevices, setLiveDevices] = useState([]);
  const [remoteModal, setRemoteModal] = useState({ open: false, tab: 'screen' });
  const lastSeenKey = String(asset.agent?.collectedAt || '');

  useEffect(() => {
    if (!currentUser?.tenantId || !canRemote) return undefined;
    const unsub = subscribeAgentDevices(currentUser.tenantId, (list) => {
      setLiveDevices(list);
    });
    return () => unsub();
  }, [currentUser?.tenantId, canRemote]);

  useEffect(() => {
    if (!ownTenant) return undefined;
    let active = true;
    getAssetInventory(asset.id)
      .then((doc) => active && setState({ assetId: asset.id, inventory: doc?.inventory || null, error: false }))
      .catch((error) => {
        console.error('Falha ao carregar inventário do agente:', error);
        if (active) setState({ assetId: asset.id, inventory: null, error: true });
      });
    return () => {
      active = false;
    };
  }, [asset.id, lastSeenKey, ownTenant]);

  const inventory = state.assetId === asset.id ? state.inventory : null;
  const health = agentHealth(asset, { staleDays: policy.staleDays });
  const alerts = asset.agent?.alerts || [];
  const software = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = inventory?.software || [];
    return q ? list.filter((s) => `${s.name} ${s.publisher}`.toLowerCase().includes(q)) : list;
  }, [inventory, search]);

  const apply = async (alert) => {
    const suggested = alert.data?.suggested;
    if (!suggested) return;
    setBusy(true);
    try {
      const isLocation = alert.code === 'location_mismatch';
      await moveAsset(asset.id, asset, {
        newLocation: isLocation ? suggested : asset.location,
        newResponsible: isLocation ? asset.assignedTo || '' : suggested,
        newCpf: isLocation ? asset.clientCpf || '' : '',
        reason: isLocation ? `Local corrigido pela rede detectada pelo Agente ITAM (${asset.agent?.ip})` : `Responsável corrigido pelo login detectado pelo Agente ITAM (${asset.agent?.loggedUser})`,
      }, currentUser?.email || 'Sistema');
      toast.success(isLocation ? `Local atualizado para ${suggested}.` : `Responsável atualizado para ${suggested}.`);
    } catch (error) {
      toast.error(error.message || 'Não foi possível atualizar o ativo.');
    } finally {
      setBusy(false);
    }
  };

  const liveDevice = useMemo(() => findLiveDeviceForAsset(asset, liveDevices), [asset, liveDevices]);
  const onlineNow = isDeviceOnline(liveDevice);
  const accessId = formatAccessId(liveDevice || asset.agent?.deviceKey || asset.serialNumber || asset.internalId);

  const healthBadge = onlineNow
    ? <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-black uppercase text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"><Wifi size={11} /> Online Ao Vivo (.EXE)</span>
    : health.state === 'online'
    ? <span className="inline-flex items-center gap-1 rounded-md border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-black uppercase text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300"><Activity size={11} /> Comunicando</span>
    : <span className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-black uppercase text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"><AlertTriangle size={11} /> Sem comunicação há {health.days} dias</span>;

  const sec = inventory?.security;
  const antivirus = sec?.antivirus?.length ? sec.antivirus.map((av) => `${av.name}${av.enabled ? '' : ' (desativado)'}${av.enabled && !av.upToDate ? ' (desatualizado)' : ''}`).join(', ') : inventory ? 'Nenhum' : '—';

  const remoteDevicePayload = liveDevice || {
    deviceKey: asset.agent?.deviceKey || asset.serialNumber || asset.internalId,
    accessId,
    hostname: asset.agent?.hostname || asset.internalId,
    internalId: asset.internalId,
    loggedUser: asset.agent?.loggedUser || asset.assignedTo,
    ipAddress: asset.agent?.ip,
    osCaption: asset.agent?.os,
  };

  return (
    <section className="bg-white dark:bg-slate-800 rounded-3xl p-6 md:p-8 border border-gray-100 dark:border-slate-700 shadow-sm space-y-6" aria-label="Inventário do Agente ITAM">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2"><Cpu size={20} /> Agente ITAM & NexusDesk</h3>
            <span className="px-2.5 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 font-mono text-xs font-bold">
              NexusDesk: {accessId}
            </span>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Última coleta {formatDate(asset.agent?.collectedAt)} · agente {liveDevice?.agentVersion || asset.agent?.version || '1.x'} · {asset.agent?.source || 'Agente ITAM'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {healthBadge}
          {canRemote && (
            <>
              <button
                type="button"
                onClick={() => setRemoteModal({ open: true, tab: 'screen' })}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-black text-xs shadow-sm transition-colors"
              >
                <Monitor size={14} /> NexusDesk
              </button>
              <button
                type="button"
                onClick={() => setRemoteModal({ open: true, tab: 'terminal' })}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-gray-700 dark:text-slate-200 font-bold text-xs transition-colors"
              >
                <Terminal size={13} /> Terminal
              </button>
            </>
          )}
        </div>
      </header>

      {alerts.length > 0 ? (
        <ul className="space-y-2">
          {alerts.map((alert) => (
            <li key={alert.code} className={`flex flex-col sm:flex-row sm:items-center gap-2 rounded-2xl border px-4 py-3 text-xs ${LEVEL_STYLE[alert.level] || LEVEL_STYLE.low}`}>
              <span className="flex items-start gap-2 flex-1 min-w-0">
                {alert.level === 'high' ? <ShieldAlert size={15} className="shrink-0" /> : <AlertTriangle size={15} className="shrink-0" />}
                <span><strong className="uppercase text-[10px] tracking-wider mr-1">{ALERT_LEVELS[alert.level]}</strong>{alert.message}</span>
              </span>
              {canWrite && alert.data?.suggested && ['location_mismatch', 'user_mismatch'].includes(alert.code) && !lifecycleBlocker(asset) && (
                <button
                  type="button"
                  onClick={() => apply(alert)}
                  disabled={busy}
                  className="shrink-0 rounded-xl bg-white/80 dark:bg-slate-900/70 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider hover:bg-white disabled:opacity-50"
                >
                  {alert.code === 'location_mismatch' ? `Mudar para ${alert.data.suggested}` : `Definir ${alert.data.suggested}`}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-2 rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-xs font-bold text-green-700 dark:border-green-900/60 dark:bg-green-950/20 dark:text-green-300">
          <ShieldCheck size={15} /> Nenhum alerta na última coleta.
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 rounded-2xl bg-gray-50 dark:bg-slate-900 border border-gray-100 dark:border-slate-700 p-4">
        <Fact label="Hostname" value={asset.agent?.hostname} mono />
        <Fact label="Usuário logado" value={asset.agent?.loggedUser} />
        <Fact label="IP / MAC" value={[asset.agent?.ip, asset.agent?.mac].filter(Boolean).join(' · ')} mono />
        <Fact label="Domínio" value={asset.agent?.domain} />
        <Fact label="Sistema" value={[asset.agent?.os, asset.agent?.osBuild && `build ${asset.agent.osBuild}`].filter(Boolean).join(' ')} />
        <Fact label="Ligado desde" value={formatDate(asset.agent?.lastBoot)} />
        <Fact label="Antivírus" value={antivirus} />
        <Fact label="Firewall" value={sec?.firewall || '—'} />
        <Fact label="Última atualização" value={formatDate(sec?.lastUpdate)} />
        <Fact label="Reinício pendente" value={sec ? (sec.pendingReboot ? 'Sim' : 'Não') : '—'} />
        <Fact label="Programas" value={String(asset.agent?.softwareCount ?? inventory?.software?.length ?? '—')} />
        <Fact label="Última mudança" value={asset.agent?.lastChange ? `${formatDate(asset.agent.lastChange.at)}: ${asset.agent.lastChange.summary}` : 'Nenhuma'} />
      </div>

      {!ownTenant && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          O inventário detalhado coletado pelo agente é visível apenas para a gestão da empresa dona do ativo.
        </p>
      )}
      {state.error && <p className="text-xs text-rose-600">Não foi possível carregar o inventário completo.</p>}

      {inventory && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {inventory.volumes?.length > 0 && (
            <div>
              <SectionTitle icon={HardDrive}>Volumes</SectionTitle>
              <ul className="space-y-2">
                {inventory.volumes.map((v) => {
                  const used = v.sizeGb ? Math.round(((v.sizeGb - (v.freeGb ?? 0)) / v.sizeGb) * 100) : 0;
                  return (
                    <li key={v.drive} className="text-xs">
                      <div className="flex justify-between font-bold text-gray-700 dark:text-gray-200">
                        <span>{v.drive} {v.label && <span className="font-normal text-gray-400">{v.label}</span>} {v.encrypted === true && <span className="text-green-600">· criptografado</span>}{v.encrypted === false && <span className="text-amber-600">· sem criptografia</span>}</span>
                        <span>{v.freeGb} GB livres de {v.sizeGb} GB</span>
                      </div>
                      <div className="mt-1 h-2 rounded-full bg-gray-100 dark:bg-slate-700 overflow-hidden" role="meter" aria-valuenow={used} aria-valuemin={0} aria-valuemax={100} aria-label={`Uso de ${v.drive}`}>
                        <div className={`h-full ${used >= 100 - policy.diskFreeMinPct ? 'bg-rose-500' : used >= 75 ? 'bg-amber-500' : 'bg-brand'}`} style={{ width: `${Math.min(100, used)}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {inventory.disks?.length > 0 && (
            <div>
              <SectionTitle icon={HardDrive}>Discos físicos</SectionTitle>
              <ul className="space-y-1 text-xs text-gray-700 dark:text-gray-200">
                {inventory.disks.map((d) => (
                  <li key={`${d.serial}-${d.model}`} className="flex justify-between gap-2"><span className="truncate">{d.model} {d.media && <span className="text-gray-400">({d.media})</span>}</span><span className="font-mono text-gray-400 shrink-0">{d.sizeGb} GB · {d.serial || 's/ serial'}</span></li>
                ))}
              </ul>
            </div>
          )}

          {inventory.monitors?.length > 0 && (
            <div>
              <SectionTitle icon={Monitor}>Monitores conectados</SectionTitle>
              <ul className="space-y-1 text-xs text-gray-700 dark:text-gray-200">
                {inventory.monitors.map((m) => (
                  <li key={`${m.serial}-${m.model}`} className="flex justify-between gap-2"><span className="truncate">{[m.manufacturer, m.model].filter(Boolean).join(' ')}</span><span className="font-mono text-gray-400 shrink-0">{m.serial || 's/ serial'}</span></li>
                ))}
              </ul>
            </div>
          )}

          {inventory.network?.length > 0 && (
            <div>
              <SectionTitle icon={Network}>Rede</SectionTitle>
              <ul className="space-y-1 text-xs text-gray-700 dark:text-gray-200">
                {inventory.network.map((n) => (
                  <li key={`${n.mac}-${n.ip}`} className="flex justify-between gap-2"><span className="truncate">{n.name}</span><span className="font-mono text-gray-400 shrink-0">{n.ip || '—'} · {n.mac}</span></li>
                ))}
              </ul>
            </div>
          )}

          {inventory.security?.localAdmins?.length > 0 && (
            <div>
              <SectionTitle icon={Users}>Administradores locais</SectionTitle>
              <p className="text-xs text-gray-700 dark:text-gray-200">{inventory.security.localAdmins.join(', ')}</p>
            </div>
          )}

          {inventory.battery?.healthPct != null && (
            <div>
              <SectionTitle icon={Battery}>Bateria</SectionTitle>
              <p className="text-xs text-gray-700 dark:text-gray-200">{inventory.battery.healthPct}% da capacidade original</p>
            </div>
          )}
        </div>
      )}

      {inventory?.software?.length > 0 && (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <SectionTitle icon={Package}>Programas instalados ({inventory.software.length})</SectionTitle>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-2.5 text-gray-400" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar programa…"
                aria-label="Buscar programa instalado"
                className="pl-8 pr-3 py-1.5 rounded-xl bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-xs text-gray-800 dark:text-gray-100 focus:outline-none focus:border-brand"
              />
            </div>
          </div>
          <ul className="divide-y divide-gray-100 dark:divide-slate-700 rounded-2xl border border-gray-100 dark:border-slate-700 text-xs">
            {(showAllSoftware || search ? software : software.slice(0, 12)).map((s) => (
              <li key={`${s.name}-${s.version}`} className="flex justify-between gap-3 px-3 py-2">
                <span className="truncate text-gray-800 dark:text-gray-100">{s.name}</span>
                <span className="shrink-0 text-gray-400 font-mono">{s.version}</span>
              </li>
            ))}
            {software.length === 0 && <li className="px-3 py-2 text-gray-400">Nenhum programa com esse nome.</li>}
          </ul>
          {!search && software.length > 12 && (
            <button type="button" onClick={() => setShowAllSoftware((v) => !v)} className="mt-2 text-[11px] font-black uppercase tracking-wider text-brand">
              {showAllSoftware ? 'Mostrar menos' : `Ver todos os ${software.length}`}
            </button>
          )}
        </div>
      )}

      {!inventory && !state.error && state.assetId === asset.id && (
        <p className="flex items-center gap-2 text-xs text-gray-400"><CheckCircle2 size={13} /> Inventário detalhado disponível a partir da próxima coleta do agente 2.x.</p>
      )}
      {alerts.some((a) => a.code === 'user_mismatch') && !canWrite && (
        <p className="flex items-center gap-2 text-xs text-gray-400"><UserCheck size={13} /> Peça a um operador para corrigir o responsável.</p>
      )}

      <RemoteControlModal
        isOpen={remoteModal.open}
        onClose={() => setRemoteModal((prev) => ({ ...prev, open: false }))}
        tenantId={currentUser?.tenantId}
        initialDevice={remoteDevicePayload}
        asset={asset}
        currentUser={currentUser}
        initialTab={remoteModal.tab}
      />
    </section>
  );
};

export default AgentInventoryCard;
