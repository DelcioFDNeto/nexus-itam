// src/components/agent/InboxTab.jsx
import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle, Loader2, MapPin, RefreshCcw, RotateCcw, User } from 'lucide-react';
import { toast } from 'sonner';
import { loadAgentContext, previewAgentPayload, processAgentInbox, retryAgentSubmission } from '../../services/agentService';
import { assertWithinLimit } from '../../services/tenantService';

const STATUS = {
  pending: { label: 'Novo', className: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900' },
  processing: { label: 'Processando', className: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900' },
  processed: { label: 'Incorporado', className: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900' },
  error: { label: 'Erro', className: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900' },
};

const formatDate = (value) => {
  if (!value) return '—';
  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

/**
 * Fila de recepcao: o que as maquinas mandaram e ainda nao virou ativo (ou
 * deu erro). Com o aceite automatico ligado, quase sempre fica vazia.
 */
const InboxTab = ({ tenantId, currentUser, submissions, loading, onReload }) => {
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [preview, setPreview] = useState(null);

  const open = useMemo(() => submissions.filter((s) => s.status !== 'processed'), [submissions]);

  const toggle = (id) => setSelected((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));

  const run = async (ids) => {
    setBusy(true);
    setProgress({ done: 0, total: ids?.length || open.length });
    try {
      const summary = await processAgentInbox({
        tenantId,
        user: currentUser?.email || 'Agente ITAM',
        ids,
        canCreate: () => assertWithinLimit(currentUser, 'assets', 1),
        onProgress: (done, total) => setProgress({ done, total }),
      });
      if (summary.processed) toast.success(`${summary.processed} máquina(s) incorporada(s): ${summary.created} nova(s), ${summary.updated} atualizada(s).`);
      if (summary.errors.length) toast.error(`${summary.errors.length} envio(s) com erro.`, { description: summary.errors[0].message });
      if (!summary.processed && !summary.errors.length) toast.info('Nada para processar (outro administrador pode ter acabado de processar).');
      setSelected([]);
      setPreview(null);
      await onReload();
    } catch (error) {
      console.error(error);
      toast.error(error.message || 'Erro ao processar a fila.');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const showPreview = async (submission) => {
    setPreview({ id: submission.id, loading: true });
    try {
      const ctx = await loadAgentContext(tenantId);
      const result = await previewAgentPayload(submission.payload || {}, { tenantId, context: ctx });
      setPreview({ id: submission.id, submission, ...result });
    } catch (error) {
      setPreview({ id: submission.id, error: error.message });
    }
  };

  const retry = async (submission) => {
    try {
      await retryAgentSubmission(submission.id);
      await onReload();
    } catch (error) {
      toast.error(error.message || 'Não foi possível devolver para a fila.');
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
      <section className="xl:col-span-3 bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 overflow-hidden">
        <header className="p-4 border-b border-gray-100 dark:border-slate-700 flex flex-wrap items-center gap-2">
          <p className="text-sm font-black text-gray-900 dark:text-white mr-auto">{open.length} envio(s) aguardando</p>
          <button type="button" onClick={onReload} disabled={loading} aria-label="Recarregar fila" className="p-2 rounded-xl border border-gray-200 dark:border-slate-700 text-gray-500 hover:text-brand">
            <RefreshCcw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
          <button type="button" onClick={() => run(selected)} disabled={!selected.length || busy} className="px-3 py-2 rounded-xl border border-gray-200 dark:border-slate-700 text-xs font-black uppercase tracking-wider text-gray-700 dark:text-gray-200 disabled:opacity-40">
            Incorporar selecionados ({selected.length})
          </button>
          <button type="button" onClick={() => run(null)} disabled={!open.length || busy} className="px-3 py-2 rounded-xl bg-brand text-white text-xs font-black uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-40">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
            {busy && progress ? `${progress.done}/${progress.total}` : 'Processar tudo'}
          </button>
        </header>
        <ul className="divide-y divide-gray-100 dark:divide-slate-700/60 max-h-[560px] overflow-y-auto">
          {submissions.length === 0 && <li className="p-10 text-center text-sm text-gray-400">Nenhum envio recebido ainda.</li>}
          {submissions.map((s) => {
            const status = STATUS[s.status] || STATUS.pending;
            const selectable = s.status === 'pending' || s.status === 'error';
            return (
              <li key={s.id} className={`px-4 py-3 flex items-start gap-3 ${preview?.id === s.id ? 'bg-brand/5' : ''}`}>
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={selected.includes(s.id)}
                  onChange={() => toggle(s.id)}
                  disabled={!selectable}
                  aria-label={`Selecionar ${s.hostname || s.id}`}
                />
                <button type="button" onClick={() => showPreview(s)} className="min-w-0 flex-1 text-left">
                  <p className="font-mono text-sm font-black text-gray-900 dark:text-white truncate">{s.hostname || 'Sem hostname'}</p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                    {formatDate(s.createdAt)} · {s.ip_address || 'sem IP'} · {s.source || 'Agente'} {s.agentVersion ? `v${s.agentVersion}` : 'v1.x'}
                  </p>
                  {s.status === 'error' && s.error && <p className="text-[11px] font-bold text-rose-600 dark:text-rose-400">{s.error}</p>}
                  {s.status === 'processed' && s.result && (
                    <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                      {s.result.action === 'created' ? 'Cadastrado' : 'Atualizado'} como {s.result.internalId || s.result.assetId}{s.result.alerts ? ` · ${s.result.alerts} alerta(s)` : ''}
                    </p>
                  )}
                </button>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className={`px-2 py-0.5 rounded-md border text-[10px] font-black uppercase ${status.className}`}>{status.label}</span>
                  {s.status === 'error' && (
                    <button type="button" onClick={() => retry(s)} className="text-[10px] font-black uppercase text-brand flex items-center gap-1"><RotateCcw size={11} /> Tentar de novo</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <aside className="xl:col-span-2 bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-5 space-y-4 self-start">
        {!preview ? (
          <p className="text-sm text-gray-400">Clique num envio para ver o que acontece ao incorporar: se cria ou atualiza um ativo, o local e o responsável sugeridos e os alertas.</p>
        ) : preview.loading ? (
          <p className="text-sm text-gray-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Analisando…</p>
        ) : preview.error ? (
          <p className="text-sm text-rose-600">{preview.error}</p>
        ) : (
          <>
            <div className={`rounded-2xl p-4 border ${preview.duplicate ? 'bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-900/50' : 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-900/50'}`}>
              <p className="font-black text-sm text-gray-900 dark:text-white">{preview.duplicate ? `Atualiza ${preview.duplicate.internalId || 'ativo existente'}` : `Cria ${preview.internalId}`}</p>
              <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                {preview.duplicate ? `Reconhecido por ${({ deviceId: 'identidade do dispositivo', internalId: 'patrimônio', serialNumber: 'número de série', hostname: 'nome do computador (patrimônio)', 'hostname+mac': 'hostname e MAC' })[preview.duplicate.matchField] || preview.duplicate.matchField}.` : 'Nenhuma máquina igual no inventário.'}
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-xs">
              <div><dt className="text-[10px] font-black uppercase text-gray-400">Tipo</dt><dd className="font-bold text-gray-900 dark:text-white">{preview.inventory.type}</dd></div>
              <div><dt className="text-[10px] font-black uppercase text-gray-400">Serial</dt><dd className="font-mono font-bold text-gray-900 dark:text-white">{preview.inventory.serialNumber || 'genérico / ausente'}</dd></div>
              <div><dt className="text-[10px] font-black uppercase text-gray-400 flex items-center gap-1"><MapPin size={10} /> Local pela rede</dt><dd className="font-bold text-gray-900 dark:text-white">{preview.location || 'rede não cadastrada'}</dd></div>
              <div><dt className="text-[10px] font-black uppercase text-gray-400 flex items-center gap-1"><User size={10} /> Colaborador</dt><dd className="font-bold text-gray-900 dark:text-white">{preview.employee || preview.inventory.loggedUser || '—'}</dd></div>
              <div><dt className="text-[10px] font-black uppercase text-gray-400">Sistema</dt><dd className="font-bold text-gray-900 dark:text-white">{preview.inventory.os.name || '—'}</dd></div>
              <div><dt className="text-[10px] font-black uppercase text-gray-400">Programas</dt><dd className="font-bold text-gray-900 dark:text-white">{preview.inventory.software.length}</dd></div>
            </dl>
            {preview.alerts.length > 0 && (
              <ul className="space-y-1.5">
                {preview.alerts.map((a) => (
                  <li key={a.code} className={`text-xs flex items-start gap-1.5 ${a.level === 'high' ? 'text-rose-600' : a.level === 'medium' ? 'text-amber-700 dark:text-amber-300' : 'text-gray-500'}`}>
                    <AlertTriangle size={12} className="shrink-0 mt-0.5" /> {a.message}
                  </li>
                ))}
              </ul>
            )}
            {(preview.submission?.status === 'pending' || preview.submission?.status === 'error') && (
              <button type="button" onClick={() => run([preview.id])} disabled={busy} className="w-full px-4 py-3 rounded-xl bg-brand text-white text-xs font-black uppercase tracking-wider disabled:opacity-40">
                {preview.duplicate ? 'Atualizar ativo' : 'Cadastrar ativo'}
              </button>
            )}
          </>
        )}
      </aside>
    </div>
  );
};

export default InboxTab;
