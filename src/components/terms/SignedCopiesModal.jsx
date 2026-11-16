// src/components/terms/SignedCopiesModal.jsx
import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileText, Loader2, ScanLine, Trash2, UploadCloud, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantSettings } from '../../hooks/useTenantSettings';
import { concludeTerm, getTerm } from '../../services/termService';
import { prepareSignedCopy } from '../../services/termFileService';
import { readTermQr } from '../../services/termScanService';
import { attachOutcome, canAttachSignedCopy, matchSignedCopy, resolveTermOptions, TERM_KINDS } from '../../utils/terms';
import FileDrop from './FileDrop';
import { TermModalFrame } from './termUi';
import { fieldClass } from './termStyles';

const VIA_LABEL = { qr: 'identificado pelo QR', nome: 'identificado pelo nome do arquivo', manual: 'escolhido manualmente' };

const counterpart = (term) =>
  term.kind === 'transferencia' ? `${term.origin?.name || '—'} → ${term.destination?.name || '—'}` : term.holder?.name || '—';

/**
 * Anexo em lote: solte todos os termos assinados que voltaram (PDF ou fotos).
 * Cada arquivo e identificado pelo QR impresso no termo (ou pelo numero no
 * nome do arquivo) e, ao confirmar, cada termo e concluido com o recebimento
 * padrao — sem conferir item por item.
 */
const SignedCopiesModal = ({ terms, onClose, onDone }) => {
  const { currentUser } = useAuth();
  const { settings } = useTenantSettings();
  const options = resolveTermOptions(settings);
  const [rows, setRows] = useState([]);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const extraTerms = useRef({}); // termos fora da lista carregada, achados pelo QR
  const rowSeq = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const candidates = terms.filter(canAttachSignedCopy);
  const patch = (key, values) => {
    if (!mountedRef.current) return;
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...values } : r)));
  };

  const identify = async (row) => {
    const qrText = await readTermQr(row.file);
    if (!mountedRef.current) return;
    let match = matchSignedCopy({ qrText, fileName: row.file.name }, candidates);
    if (match && !match.term) {
      const known = terms.find((t) => t.id === match.termId) || (await getTerm(match.termId).catch(() => null));
      if (!mountedRef.current) return;
      if (!known || known.tenantId !== currentUser?.tenantId) {
        patch(row.key, { state: 'sem-termo', message: 'O QR é de um termo que não existe nesta empresa. Escolha o termo.' });
        return;
      }
      if (!canAttachSignedCopy(known)) {
        patch(row.key, { state: 'ignorado', term: known, message: known.signedCopy ? 'já tem o termo assinado anexado' : 'termo cancelado' });
        return;
      }
      extraTerms.current[known.id] = known;
      match = { term: known, via: 'qr' };
    }
    patch(
      row.key,
      match
        ? { state: 'pronto', term: match.term, via: match.via }
        : { state: 'sem-termo', message: qrText ? 'QR lido, mas não é de um termo.' : 'QR não encontrado. Escolha o termo.' },
    );
  };

  const addFiles = (files) => {
    const added = files.map((file) => {
      rowSeq.current += 1;
      return { key: `f${rowSeq.current}`, file, state: 'lendo' };
    });
    setFinished(false);
    setRows((prev) => [...prev, ...added]);
    added.forEach(identify);
  };

  const chooseTerm = (key, termId) => {
    const term = candidates.find((t) => t.id === termId) || extraTerms.current[termId];
    patch(key, term ? { state: 'pronto', term, via: 'manual', message: '' } : { state: 'sem-termo', term: null });
  };

  // O mesmo termo em dois arquivos: so o primeiro conta.
  const firstRowOfTerm = {};
  rows.forEach((r) => {
    if (r.state === 'pronto' && r.term && !firstRowOfTerm[r.term.id]) firstRowOfTerm[r.term.id] = r.key;
  });
  const isDuplicate = (r) => r.state === 'pronto' && r.term && firstRowOfTerm[r.term.id] !== r.key;
  const ready = rows.filter((r) => r.state === 'pronto' && !isDuplicate(r));
  const reading = rows.some((r) => r.state === 'lendo');
  const done = rows.filter((r) => r.state === 'feito').length;
  const failed = rows.filter((r) => r.state === 'erro').length;

  const run = async () => {
    if (!ready.length || running) return;
    setRunning(true);
    let ok = 0;
    for (const row of ready) {
      if (!mountedRef.current) break;
      patch(row.key, { state: 'enviando' });
      try {
        const signedCopy = await prepareSignedCopy(row.file);
        if (!mountedRef.current) break;
        await concludeTerm({ term: row.term, user: currentUser, signedCopy, options });
        if (!mountedRef.current) break;
        patch(row.key, { state: 'feito', message: '' });
        ok += 1;
      } catch (error) {
        if (!mountedRef.current) break;
        console.error(error);
        patch(row.key, { state: 'erro', message: error?.code === 'permission-denied' ? 'sem permissão' : error.message || 'falhou' });
      }
    }
    if (!mountedRef.current) return;
    setRunning(false);
    setFinished(true);
    if (ok) toast.success(`${ok} termo(s) concluído(s) com o assinado anexado.`);
    if (ok < ready.length) toast.error(`${ready.length - ok} arquivo(s) não foram anexados. Veja a lista.`);
    if (ok) onDone?.();
  };

  return (
    <TermModalFrame
      icon={UploadCloud}
      wide
      title="Anexar termos assinados"
      subtitle="Solte todos os termos que voltaram assinados. O QR impresso identifica cada um e o processo é concluído sozinho."
      busy={running}
      onClose={running ? undefined : onClose}
      footer={
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-xs font-bold text-slate-600 dark:text-zinc-400 tabular-nums">
            {reading
              ? 'Lendo os QR codes…'
              : finished && !ready.length
                ? `${done} concluído(s)${failed ? ` · ${failed} com erro` : ''}`
                : `${ready.length} pronto(s) para concluir${rows.length - ready.length - done ? ` · ${rows.length - ready.length - done} sem ação` : ''}`}
          </p>
          {finished && !ready.length ? (
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-5 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white dark:bg-zinc-100 dark:hover:bg-white dark:text-zinc-900 text-xs font-black uppercase tracking-wider transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              Fechar
            </button>
          ) : (
            <button
              type="button"
              onClick={run}
              disabled={!ready.length || running || reading}
              className="min-h-[44px] px-5 py-3 rounded-xl bg-brand hover:bg-brand-dark text-brand-fg text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-40 disabled:cursor-not-allowed tabular-nums"
            >
              {running ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <CheckCircle2 size={15} aria-hidden="true" />}
              {running ? 'Concluindo…' : `Concluir ${ready.length || ''} termo(s)`}
            </button>
          )}
        </div>
      }
    >
      <FileDrop
        id="signed-copies-bulk"
        multiple
        compact={rows.length > 0}
        onFiles={addFiles}
        label={rows.length ? 'Adicionar mais arquivos' : 'Solte aqui os PDFs ou fotos dos termos assinados'}
        hint="Um arquivo por termo. Digitalização ou foto nítida, com o QR do cabeçalho visível. Até 5 MB cada."
      />

      {rows.length > 0 && (
        <ul className="divide-y divide-slate-100 dark:divide-zinc-800 rounded-2xl border border-slate-200 dark:border-zinc-800 overflow-hidden">
          {rows.map((row) => {
            const duplicate = isDuplicate(row);
            return (
              <li
                key={row.key}
                className="[content-visibility:auto] [contain-intrinsic-size:auto_64px] p-3 bg-white dark:bg-[#111113] flex flex-col md:flex-row md:items-center gap-3"
                data-file={row.file.name}
              >
                <div className="flex items-center gap-3 min-w-0 md:w-64 shrink-0">
                  <span className="p-2 rounded-xl bg-slate-100 dark:bg-zinc-900 text-slate-500 dark:text-zinc-400" aria-hidden="true">
                    <FileText size={16} aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-900 dark:text-[#fafafa] truncate" title={row.file.name}>{row.file.name}</p>
                    <p className="text-xs text-slate-500 dark:text-zinc-400 tabular-nums">{Math.max(1, Math.round(row.file.size / 1024))} KB</p>
                  </div>
                </div>

                <div className="min-w-0 flex-1 text-xs">
                  {row.state === 'lendo' && (
                    <p role="status" className="flex items-center gap-2 font-bold text-slate-500 dark:text-zinc-400">
                      <Loader2 size={13} className="animate-spin" aria-hidden="true" /> Lendo o QR…
                    </p>
                  )}
                  {['pronto', 'enviando', 'feito', 'erro'].includes(row.state) && row.term && (
                    <>
                      <p className="font-black text-slate-900 dark:text-[#fafafa]">
                        <span className="font-mono tabular-nums">{row.term.number}</span> · {TERM_KINDS[row.term.kind]?.short} · {counterpart(row.term)}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-zinc-400 flex items-center gap-1">
                        {row.via === 'qr' && <ScanLine size={12} className="text-emerald-600 dark:text-emerald-400" aria-hidden="true" />}
                        {VIA_LABEL[row.via]} · {row.state === 'feito' ? 'concluído' : 'ao concluir'}: <strong>{attachOutcome(row.term)}</strong>
                      </p>
                    </>
                  )}
                  {row.state === 'sem-termo' && (
                    <div className="space-y-1.5">
                      <p className="font-bold text-amber-700 dark:text-amber-300 flex items-center gap-1">
                        <AlertTriangle size={12} aria-hidden="true" /> {row.message}
                      </p>
                      <label htmlFor={`signed-copy-term-${row.key}`} className="sr-only">
                        Termo de {row.file.name}
                      </label>
                      <select
                        id={`signed-copy-term-${row.key}`}
                        name={`term-${row.key}`}
                        aria-label={`Termo de ${row.file.name}`}
                        value=""
                        onChange={(e) => chooseTerm(row.key, e.target.value)}
                        className={fieldClass}
                      >
                        <option value="">Escolha o termo…</option>
                        {candidates.map((t) => (
                          <option key={t.id} value={t.id}>{t.number} — {counterpart(t)}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {row.state === 'ignorado' && (
                    <p className="font-bold text-slate-500 dark:text-zinc-400">{row.term?.number}: {row.message}. Nada a fazer.</p>
                  )}
                  {duplicate && <p className="font-bold text-amber-700 dark:text-amber-300">Mesmo termo de outro arquivo da lista — este será ignorado.</p>}
                  {row.state === 'erro' && <p className="font-bold text-rose-600 dark:text-rose-400">{row.message}</p>}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {row.state === 'enviando' && <Loader2 size={16} className="animate-spin text-brand-aa" aria-label="Enviando" />}
                  {row.state === 'feito' && (
                    <span className="flex items-center gap-1 text-xs font-bold uppercase text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 size={14} aria-hidden="true" /> Concluído
                    </span>
                  )}
                  {row.state === 'erro' && <XCircle size={16} className="text-rose-600 dark:text-rose-400" aria-label="Erro" />}
                  {!running && !['feito', 'enviando'].includes(row.state) && (
                    <button
                      type="button"
                      onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                      aria-label={`Remover ${row.file.name}`}
                      className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {candidates.length === 0 && rows.length === 0 && (
        <p className="text-center text-xs text-slate-500 dark:text-zinc-400">Nenhum termo aguardando o assinado no momento.</p>
      )}
    </TermModalFrame>
  );
};

export default SignedCopiesModal;
