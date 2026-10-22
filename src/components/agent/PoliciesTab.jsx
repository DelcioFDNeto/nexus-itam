// src/components/agent/PoliciesTab.jsx
import React, { useEffect, useState } from 'react';
import { CheckCircle, Copy, Eye, EyeOff, History, MonitorSmartphone, RefreshCcw, ShieldCheck, Tag, Zap } from 'lucide-react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { toast } from 'sonner';
import { db } from '../../services/firebase';
import { rotateAgentToken } from '../../services/tenantSecretService';
import { DEFAULT_AGENT_NAMING, generateAgentAssetCode } from '../../services/agentService';
import { invalidateTenantSettings } from '../../hooks/useTenantSettings';
import { useConfirm } from '../ConfirmDialog';
import { DEFAULT_AGENT_POLICY, resolveAgentPolicy } from '../../utils/agentInventory';
import {
  AUDIT_ACTION_LABELS,
  REMOTE_ACCESS_MODES,
  listAgentAudit,
  resolveRuntimePolicy,
  saveRuntimePolicy,
} from '../../services/rmmService';

// Intervalo do sinal de vida = tempo maximo para a maquina atender o console.
// No plano Spark (20 mil gravacoes/dia para o projeto todo) cada maquina gasta
// 86.400 / intervalo gravacoes por dia so com o sinal.
const HEARTBEAT_OPTIONS = [30, 60, 120, 300, 600];

const REMOTE_ACCESS_HELP = {
  disabled: 'Ninguém vê nem controla a tela das máquinas.',
  consent: 'O colaborador aceita ou recusa na tela; durante a sessão um aviso fica fixo no topo e ele pode encerrar quando quiser.',
  unattended: 'Para servidores e quiosques sem ninguém na frente. O aviso na tela continua aparecendo.',
};

const formatWhen = (value) => {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString('pt-BR') : '—';
};

const field = 'w-full rounded-xl border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm font-semibold text-gray-900 dark:text-white outline-none focus:border-brand';
const label = 'block text-[10px] font-black uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1';
const card = 'bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-6 space-y-4';

const toLines = (list) => (Array.isArray(list) ? list.join('\n') : String(list || ''));
const fromLines = (value) => String(value || '').split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);

/** Token, aceite automatico, politica de software/seguranca e nomenclatura. */
const PoliciesTab = ({ tenantId, currentUser, agentToken, onTokenChange }) => {
  const confirm = useConfirm();
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tokenVisible, setTokenVisible] = useState(false);
  const [autoAccept, setAutoAccept] = useState(false);
  const [trustedIps, setTrustedIps] = useState('');
  const [naming, setNaming] = useState(DEFAULT_AGENT_NAMING);
  const [policy, setPolicy] = useState({ ...DEFAULT_AGENT_POLICY, blockedSoftware: '', requiredSoftware: '' });
  const [runtime, setRuntime] = useState(resolveRuntimePolicy({}));
  const [audit, setAudit] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const loadAudit = async () => {
    setAuditLoading(true);
    try {
      setAudit(await listAgentAudit(tenantId));
    } catch (error) {
      console.error(error);
      toast.error('Não foi possível carregar o registro de acessos.');
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => {
    if (!tenantId) return undefined;
    let active = true;
    getDoc(doc(db, 'agentPolicies', tenantId))
      .then((snap) => {
        if (active) setRuntime(resolveRuntimePolicy(snap.exists() ? snap.data() : {}));
      })
      .catch(() => {});
    listAgentAudit(tenantId)
      .then((entries) => {
        if (active) setAudit(entries);
      })
      .catch(() => {});
    getDoc(doc(db, 'settings', tenantId))
      .then((snap) => {
        if (!active) return;
        const data = snap.exists() ? snap.data() : {};
        const resolved = resolveAgentPolicy(data);
        setAutoAccept(Boolean(data.autoAcceptEnabled));
        setTrustedIps(data.trustedIps || '');
        setNaming({ ...DEFAULT_AGENT_NAMING, ...(data.agentNaming || {}) });
        setPolicy({ ...resolved, blockedSoftware: toLines(resolved.blockedSoftware), requiredSoftware: toLines(resolved.requiredSoftware) });
        setLoaded(true);
      })
      .catch((error) => {
        console.error(error);
        toast.error('Não foi possível carregar as configurações do agente.');
      });
    return () => {
      active = false;
    };
  }, [tenantId]);

  const save = async () => {
    setSaving(true);
    try {
      await setDoc(doc(db, 'settings', tenantId), {
        autoAcceptEnabled: autoAccept,
        trustedIps: trustedIps.trim(),
        agentNaming: {
          companyPrefix: String(naming.companyPrefix || '').toUpperCase().trim() || DEFAULT_AGENT_NAMING.companyPrefix,
          locationCode: String(naming.locationCode || '').toUpperCase().trim() || DEFAULT_AGENT_NAMING.locationCode,
          padLength: Number(naming.padLength) || DEFAULT_AGENT_NAMING.padLength,
        },
        agentPolicy: {
          blockedSoftware: fromLines(policy.blockedSoftware),
          requiredSoftware: fromLines(policy.requiredSoftware),
          staleDays: Number(policy.staleDays) || DEFAULT_AGENT_POLICY.staleDays,
          diskFreeMinPct: Number(policy.diskFreeMinPct) || DEFAULT_AGENT_POLICY.diskFreeMinPct,
          maxUptimeDays: Number(policy.maxUptimeDays) || DEFAULT_AGENT_POLICY.maxUptimeDays,
          updateMaxDays: Number(policy.updateMaxDays) || DEFAULT_AGENT_POLICY.updateMaxDays,
          requireEncryption: Boolean(policy.requireEncryption),
        },
      }, { merge: true });
      await saveRuntimePolicy(tenantId, runtime, currentUser);
      invalidateTenantSettings(tenantId);
      toast.success('Configurações do agente salvas. Valem a partir da próxima coleta de cada máquina.');
    } catch (error) {
      console.error(error);
      toast.error(error?.code === 'permission-denied' ? 'Só administradores alteram o agente.' : 'Erro ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  const rotate = async () => {
    const ok = await confirm({
      title: agentToken ? 'Gerar novo token' : 'Gerar token',
      message: agentToken
        ? 'O token atual deixa de valer para novas instalações e para os scripts de coleta (PowerShell avulso, Linux e macOS), que param até receberem o script novo. Máquinas com o NexusAgent.exe 3.1 já matriculadas continuam funcionando; para tirar uma máquina específica, revogue-a no console remoto. Continuar?'
        : 'O token autoriza a instalação do agente e os scripts de coleta a enviar inventário para a sua empresa.',
      danger: Boolean(agentToken),
      confirmLabel: 'Gerar token',
    });
    if (!ok) return;
    try {
      const token = await rotateAgentToken(tenantId, currentUser?.email || 'sistema');
      onTokenChange(token);
      toast.success('Token gerado. Baixe os scripts novamente.');
    } catch (error) {
      console.error(error);
      toast.error('Erro ao gerar o token.');
    }
  };

  const setP = (key) => (e) => setPolicy((prev) => ({ ...prev, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      <section className={card}>
        <h3 className="font-black text-gray-900 dark:text-white flex items-center gap-2"><ShieldCheck size={18} className="text-amber-500" /> Token de segurança</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">Matricula as máquinas na sua empresa e autoriza os scripts de coleta. No NexusAgent.exe ele só é usado na instalação e depois sai do disco. Se vazar, gere outro.</p>
        <div className="rounded-xl bg-amber-50 dark:bg-slate-900 border border-amber-100 dark:border-slate-700 p-3 flex flex-wrap items-center gap-2">
          <code className="font-mono text-sm font-black text-gray-900 dark:text-white break-all flex-1 min-w-0">
            {agentToken ? (tokenVisible ? agentToken : `${agentToken.slice(0, 4)}${'•'.repeat(16)}${agentToken.slice(-4)}`) : 'Nenhum token: o agente não funciona até você gerar um.'}
          </code>
          {agentToken && (
            <>
              <button type="button" onClick={() => setTokenVisible((v) => !v)} className="px-2.5 py-1.5 rounded-lg border border-amber-200 dark:border-slate-600 text-xs font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1">
                {tokenVisible ? <EyeOff size={13} /> : <Eye size={13} />} {tokenVisible ? 'Ocultar' : 'Revelar'}
              </button>
              <button type="button" onClick={() => navigator.clipboard.writeText(agentToken).then(() => toast.success('Token copiado.'))} className="px-2.5 py-1.5 rounded-lg border border-amber-200 dark:border-slate-600 text-xs font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1">
                <Copy size={13} /> Copiar
              </button>
            </>
          )}
        </div>
        <button type="button" onClick={rotate} className="px-4 py-2 rounded-xl bg-amber-500 text-white text-xs font-black uppercase tracking-wider flex items-center gap-1.5">
          <RefreshCcw size={13} /> {agentToken ? 'Gerar novo token' : 'Gerar token'}
        </button>
      </section>

      <section className={card}>
        <h3 className="font-black text-gray-900 dark:text-white flex items-center gap-2"><Zap size={18} className="text-emerald-500" /> Aceite automático</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Ligado, o sistema incorpora sozinho o que as máquinas mandam: enquanto um administrador estiver com o Nexus aberto, a fila é processada a cada 10 minutos.
        </p>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={autoAccept} onChange={(e) => setAutoAccept(e.target.checked)} className="h-5 w-5" disabled={!loaded} />
          <span className="text-sm font-bold text-gray-800 dark:text-gray-100">Incorporar automaticamente</span>
        </label>
        <div>
          <label htmlFor="agent-trusted" className={label}>Só destas redes (opcional)</label>
          <input id="agent-trusted" value={trustedIps} onChange={(e) => setTrustedIps(e.target.value)} placeholder="Ex.: 10.20., 192.168.0." className={`${field} font-mono`} disabled={!loaded} />
          <p className="mt-1 text-[11px] text-gray-400">Em branco: aceita de qualquer rede. Envios de fora ficam na fila para aprovação manual.</p>
        </div>
      </section>

      <section className={`${card} xl:col-span-2`}>
        <h3 className="font-black text-gray-900 dark:text-white flex items-center gap-2"><MonitorSmartphone size={18} className="text-violet-500" /> Acesso remoto e privacidade</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          O que o agente coleta e a tela das máquinas são dados da sua empresa (e dos seus colaboradores). Só a gestão da empresa acessa; o Nexus, como fornecedor, não lê nem comanda as máquinas. Se precisar do nosso suporte, convide-o como membro e remova ao final.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3" role="radiogroup" aria-label="Acesso remoto">
          {Object.entries(REMOTE_ACCESS_MODES).map(([id, title]) => (
            <label
              key={id}
              className={`rounded-xl border p-3 cursor-pointer ${runtime.remoteAccess === id ? 'border-brand bg-brand/5' : 'border-gray-200 dark:border-slate-600'}`}
            >
              <span className="flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-white">
                <input
                  type="radio"
                  name="agent-remote-access"
                  checked={runtime.remoteAccess === id}
                  onChange={() => setRuntime((prev) => ({ ...prev, remoteAccess: id }))}
                  disabled={!loaded}
                />
                {title}
              </span>
              <span className="block mt-1 text-[11px] text-gray-500 dark:text-gray-400">{REMOTE_ACCESS_HELP[id]}</span>
            </label>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          <label className="flex items-start gap-2 text-sm font-bold text-gray-700 dark:text-gray-200 cursor-pointer">
            <input
              type="checkbox"
              checked={runtime.commandsEnabled}
              onChange={(e) => setRuntime((prev) => ({ ...prev, commandsEnabled: e.target.checked }))}
              className="h-4 w-4 mt-0.5"
              disabled={!loaded}
            />
            <span>
              Permitir comandos remotos
              <span className="block text-[11px] font-normal text-gray-500 dark:text-gray-400">
                PowerShell, finalizar processo, reiniciar, instalar via winget. Rodam como SYSTEM; cada envio fica no registro abaixo.
              </span>
            </span>
          </label>
          <div>
            <label htmlFor="agent-heartbeat" className={label}>Tempo de resposta das máquinas</label>
            <select
              id="agent-heartbeat"
              value={runtime.heartbeatSeconds}
              onChange={(e) => setRuntime((prev) => ({ ...prev, heartbeatSeconds: Number(e.target.value) }))}
              className={field}
              disabled={!loaded}
            >
              {HEARTBEAT_OPTIONS.map((seconds) => (
                <option key={seconds} value={seconds}>
                  {seconds < 60 ? `${seconds} s` : `${seconds / 60} min`} ({Math.round(86400 / seconds)} gravações/dia por máquina)
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-gray-400">Quanto menor, mais rápido a máquina atende o console e mais cota do Firestore consome.</p>
          </div>
        </div>
      </section>

      <section className={`${card} xl:col-span-2`}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-black text-gray-900 dark:text-white flex items-center gap-2"><History size={18} className="text-slate-500" /> Registro de acessos remotos</h3>
          <button type="button" onClick={loadAudit} disabled={auditLoading} className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-600 text-xs font-bold text-gray-600 dark:text-gray-300 flex items-center gap-1.5 disabled:opacity-40">
            <RefreshCcw size={13} className={auditLoading ? 'animate-spin' : ''} /> Atualizar
          </button>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">Quem pediu acesso à tela, enviou comando ou revogou cada máquina. Ninguém edita nem apaga estes registros.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">
              <tr>
                <th className="py-2 pr-3">Quando</th>
                <th className="py-2 pr-3">Quem</th>
                <th className="py-2 pr-3">Ação</th>
                <th className="py-2 pr-3">Máquina</th>
                <th className="py-2">Detalhe</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
              {audit.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-gray-400">Nenhum acesso remoto registrado.</td>
                </tr>
              ) : (
                audit.map((entry) => (
                  <tr key={entry.id} className="text-gray-700 dark:text-gray-200">
                    <td className="py-2 pr-3 whitespace-nowrap">{formatWhen(entry.at)}</td>
                    <td className="py-2 pr-3">{entry.byName}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{AUDIT_ACTION_LABELS[entry.action] || entry.action}</td>
                    <td className="py-2 pr-3 font-mono">{entry.hostname || entry.deviceKey}</td>
                    <td className="py-2 font-mono text-[11px] text-gray-500 dark:text-gray-400 break-all">{entry.detail}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className={`${card} xl:col-span-2`}>
        <h3 className="font-black text-gray-900 dark:text-white flex items-center gap-2"><ShieldCheck size={18} className="text-brand" /> Política da empresa</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">Cada coleta é comparada com estas regras; o que estiver fora vira alerta na máquina e no painel da frota.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="agent-blocked" className={label}>Software proibido (um por linha)</label>
            <textarea id="agent-blocked" rows={4} value={policy.blockedSoftware} onChange={setP('blockedSoftware')} className={`${field} font-mono`} placeholder={'utorrent\nanydesk\n*crack*'} disabled={!loaded} />
            <p className="mt-1 text-[11px] text-gray-400">Palavra inteira: "office" não pega "LibreOffice". Use * como curinga.</p>
          </div>
          <div>
            <label htmlFor="agent-required" className={label}>Software obrigatório (um por linha)</label>
            <textarea id="agent-required" rows={4} value={policy.requiredSoftware} onChange={setP('requiredSoftware')} className={`${field} font-mono`} placeholder={'Kaspersky\nGoogle Chrome'} disabled={!loaded} />
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label htmlFor="agent-stale" className={label}>Sem comunicação após (dias)</label>
            <input id="agent-stale" type="number" min={1} max={365} value={policy.staleDays} onChange={setP('staleDays')} className={field} disabled={!loaded} />
          </div>
          <div>
            <label htmlFor="agent-disk" className={label}>Disco livre mínimo (%)</label>
            <input id="agent-disk" type="number" min={1} max={50} value={policy.diskFreeMinPct} onChange={setP('diskFreeMinPct')} className={field} disabled={!loaded} />
          </div>
          <div>
            <label htmlFor="agent-uptime" className={label}>Reiniciar a cada (dias)</label>
            <input id="agent-uptime" type="number" min={1} max={365} value={policy.maxUptimeDays} onChange={setP('maxUptimeDays')} className={field} disabled={!loaded} />
          </div>
          <div>
            <label htmlFor="agent-updates" className={label}>Windows Update em até (dias)</label>
            <input id="agent-updates" type="number" min={1} max={365} value={policy.updateMaxDays} onChange={setP('updateMaxDays')} className={field} disabled={!loaded} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm font-bold text-gray-700 dark:text-gray-200 cursor-pointer">
          <input type="checkbox" checked={Boolean(policy.requireEncryption)} onChange={setP('requireEncryption')} className="h-4 w-4" disabled={!loaded} />
          Exigir disco criptografado também em desktops (notebooks sempre são verificados)
        </label>
      </section>

      <section className={`${card} xl:col-span-2`}>
        <h3 className="font-black text-gray-900 dark:text-white flex items-center gap-2"><Tag size={18} className="text-indigo-500" /> Patrimônio das máquinas novas</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">Máquina sem etiqueta gravada na BIOS recebe o próximo número desta sequência.</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
          <div>
            <label htmlFor="agent-prefix" className={label}>Prefixo da empresa</label>
            <input id="agent-prefix" maxLength={6} value={naming.companyPrefix} onChange={(e) => setNaming({ ...naming, companyPrefix: e.target.value.toUpperCase() })} className={`${field} font-mono`} disabled={!loaded} />
          </div>
          <div>
            <label htmlFor="agent-loc" className={label}>Sigla do local</label>
            <input id="agent-loc" maxLength={6} value={naming.locationCode} onChange={(e) => setNaming({ ...naming, locationCode: e.target.value.toUpperCase() })} className={`${field} font-mono`} disabled={!loaded} />
          </div>
          <div>
            <label htmlFor="agent-pad" className={label}>Dígitos</label>
            <input id="agent-pad" type="number" min={2} max={8} value={naming.padLength} onChange={(e) => setNaming({ ...naming, padLength: Number(e.target.value) })} className={field} disabled={!loaded} />
          </div>
          <div>
            <p className={label}>Exemplo</p>
            <p className="rounded-xl border border-gray-200 dark:border-slate-600 px-3 py-2.5 font-mono text-sm font-black text-indigo-600">{generateAgentAssetCode({ ...naming, typeCode: 'NTB', nextSequence: 1 })}</p>
          </div>
        </div>
      </section>

      <div className="xl:col-span-2 flex justify-end">
        <button type="button" onClick={save} disabled={saving || !loaded} className="px-5 py-3 rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-xs font-black uppercase tracking-wider flex items-center gap-2 disabled:opacity-40">
          {saving ? <RefreshCcw size={14} className="animate-spin" /> : <CheckCircle size={14} />} Salvar configurações do agente
        </button>
      </div>
    </div>
  );
};

export default PoliciesTab;
