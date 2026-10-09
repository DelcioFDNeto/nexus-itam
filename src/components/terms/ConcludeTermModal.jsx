// src/components/terms/ConcludeTermModal.jsx
import React, { useRef, useState } from 'react';
import { AlertTriangle, CheckCheck, CheckCircle2, FileText, Loader2, Paperclip, ScanLine, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantSettings } from '../../hooks/useTenantSettings';
import { concludeTerm } from '../../services/termService';
import { prepareSignedCopy } from '../../services/termFileService';
import { readTermQr } from '../../services/termScanService';
import { can } from '../../utils/permissions';
import {
  ARRIVAL_STATUSES,
  defaultReceipt,
  OPEN_TERM_STATUSES,
  RECEIPT_OUTCOMES,
  RECEIVER_FROM_PAPER,
  receiptStatus,
  resolveTermOptions,
  TERM_STATUS,
  termIdFromQr,
} from '../../utils/terms';
import FileDrop from './FileDrop';
import { SectionTitle, TermModalFrame } from './termUi';
import { fieldClass, labelClass } from './termStyles';

const OUTCOME_STYLE = {
  ok: 'bg-green-600 text-white border-green-600',
  ressalva: 'bg-orange-500 text-white border-orange-500',
  nao_recebido: 'bg-rose-600 text-white border-rose-600',
};

const sizeLabel = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/**
 * Conclusao com o termo assinado. Anexar o PDF/foto conclui sozinho:
 *   transferencia em transito -> recebida (itens vao para a loja)
 *   termo aguardando assinatura -> assinado
 *   termo ja concluido -> o assinado fica arquivado
 * A conferencia item a item so aparece quando a loja anotou ressalva ou falta.
 */
const ConcludeTermModal = ({ term, onClose, onConcluded }) => {
  const { currentUser } = useAuth();
  const { settings } = useTenantSettings();
  const options = resolveTermOptions(settings);
  const canManage = can(currentUser, 'terms:cancel');
  const isTransfer = term.status === 'em_transito';
  const isOpen = OPEN_TERM_STATUSES.includes(term.status);

  const [file, setFile] = useState(null);
  const [check, setCheck] = useState({ state: 'idle', otherId: '' });
  const latestFile = useRef(null);
  const [adjust, setAdjust] = useState({}); // ajustes sobre o recebimento padrao
  const [showIssues, setShowIssues] = useState(false);
  const [withoutCopy, setWithoutCopy] = useState(false);
  const [busy, setBusy] = useState(false);

  const receipt = { ...defaultReceipt(term, options), ...adjust };
  const items = receipt.items;
  const issues = items.filter((i) => i.outcome !== 'ok');
  const missingNote = issues.some((i) => !String(i.note || '').trim());

  const setItem = (id, patch) => setAdjust((prev) => ({ ...prev, items: items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
  const setField = (key, value) => setAdjust((prev) => ({ ...prev, [key]: value }));

  const pickFile = async ([chosen]) => {
    latestFile.current = chosen;
    setFile(chosen);
    setWithoutCopy(false);
    setCheck({ state: 'lendo', otherId: '' });
    const qr = await readTermQr(chosen);
    if (latestFile.current !== chosen) return; // trocou de arquivo no meio da leitura
    const id = termIdFromQr(qr);
    setCheck(!id ? { state: 'sem-qr', otherId: '' } : id === term.id ? { state: 'ok', otherId: '' } : { state: 'outro', otherId: id });
  };

  const clearFile = () => {
    latestFile.current = null;
    setFile(null);
    setCheck({ state: 'idle', otherId: '' });
  };

  const hasPaper = Boolean(file) || (withoutCopy && canManage && isOpen);
  const canSubmit = hasPaper && !busy && check.state !== 'lendo' && check.state !== 'outro' && !(isTransfer && (missingNote || !String(receipt.receivedByName).trim() || !receipt.receivedAt));

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const signedCopy = file ? await prepareSignedCopy(file) : null;
      const status = await concludeTerm({
        term,
        user: currentUser,
        signedCopy,
        options,
        receipt: isTransfer ? receipt : {},
      });
      const what =
        status === 'recebido'
          ? `recebido em ${term.destination?.name}`
          : status === 'recebido_ressalvas'
            ? `recebido com ${issues.length} ressalva(s)`
            : status === 'assinado' && isOpen
              ? 'assinado'
              : 'termo assinado arquivado';
      toast.success(`${term.number}: ${what}.`);
      onConcluded?.();
      onClose();
    } catch (error) {
      console.error(error);
      toast.error(error?.code === 'permission-denied' ? 'Seu perfil não pode concluir este termo.' : error.message || 'Erro ao concluir o termo.');
    } finally {
      setBusy(false);
    }
  };

  const action = !file && withoutCopy ? 'Concluir sem anexo' : isOpen ? 'Anexar e concluir' : 'Anexar termo assinado';

  return (
    <TermModalFrame
      icon={Paperclip}
      wide={isTransfer && showIssues}
      title={`${isOpen ? 'Concluir' : 'Anexar assinado'} · ${term.number}`}
      subtitle={isTransfer ? `${term.origin?.name} → ${term.destination?.name} · ${term.assets.length} item(ns)` : `${term.holder?.name || ''} · ${term.assets.length} item(ns)`}
      onClose={onClose}
      footer={
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-xs font-bold text-gray-500 dark:text-gray-400">
            {isTransfer
              ? receiptStatus(items) === 'recebido'
                ? 'Todos os itens conferidos'
                : `${issues.length} item(ns) com ressalva ou falta`
              : isOpen
                ? `Fica: ${TERM_STATUS.assinado.label}`
                : `Status mantido: ${TERM_STATUS[term.status]?.label || term.status}`}
          </p>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="px-5 py-3 rounded-xl bg-brand text-white text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 shadow-md shadow-brand/30 disabled:opacity-40 disabled:shadow-none"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} {busy ? 'Concluindo…' : action}
          </button>
        </div>
      }
    >
      <section>
        <SectionTitle>Termo assinado</SectionTitle>
        {file ? (
          <div className="rounded-2xl border border-gray-200 dark:border-slate-700 p-3 space-y-2">
            <div className="flex items-center gap-3">
              <span className="p-2 rounded-xl bg-gray-100 dark:bg-slate-800 text-gray-500"><FileText size={18} /></span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{file.name}</p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">{sizeLabel(file.size)}</p>
              </div>
              <button type="button" onClick={clearFile} aria-label="Remover arquivo" className="p-2 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40">
                <X size={16} />
              </button>
            </div>
            {check.state === 'lendo' && (
              <p className="flex items-center gap-2 text-xs font-bold text-gray-500"><Loader2 size={13} className="animate-spin" /> Lendo o QR do termo…</p>
            )}
            {check.state === 'ok' && (
              <p className="flex items-center gap-2 text-xs font-bold text-green-700 dark:text-green-400"><ScanLine size={13} /> QR confere: este é o {term.number}.</p>
            )}
            {check.state === 'sem-qr' && (
              <p className="flex items-center gap-2 text-xs font-bold text-amber-700 dark:text-amber-300"><AlertTriangle size={13} /> QR não encontrado no arquivo. Confira se é o {term.number} antes de concluir.</p>
            )}
            {check.state === 'outro' && (
              <p className="flex items-center gap-2 text-xs font-bold text-rose-700 dark:text-rose-300"><AlertTriangle size={13} /> Este arquivo é de OUTRO termo. Escolha a digitalização do {term.number}.</p>
            )}
          </div>
        ) : (
          <FileDrop
            id={`signed-copy-${term.id}`}
            onFiles={pickFile}
            label="Solte aqui o PDF ou a foto do termo assinado"
            hint="Ou clique para escolher (no celular, dá para fotografar). Até 5 MB."
          />
        )}
      </section>

      <section className="rounded-2xl bg-gray-50 dark:bg-slate-800/60 p-4 text-xs text-gray-600 dark:text-gray-300 space-y-1.5">
        <p className="text-[11px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">Ao concluir</p>
        {isTransfer ? (
          <>
            <p>
              <strong>{term.assets.length - issues.filter((i) => i.outcome === 'nao_recebido').length} item(ns)</strong> passam para{' '}
              <strong>{term.destination?.name}</strong> como <strong>{receipt.newStatus}</strong>
              {receipt.assignToReceiver ? <> e ficam com <strong>{term.receiver?.name}</strong></> : null}.
            </p>
            <p>
              {receipt.receivedByName === RECEIVER_FROM_PAPER
                ? 'Quem recebeu fica identificado no termo assinado'
                : <>Recebido por <strong>{receipt.receivedByName}</strong></>}
              ; o termo sai das pendências.
            </p>
          </>
        ) : isOpen ? (
          <p>O termo passa para <strong>Assinado</strong> e o arquivo fica guardado no registro.</p>
        ) : (
          <p>O arquivo assinado fica guardado junto com o termo. Nada mais muda.</p>
        )}
      </section>

      {isTransfer && (
        <section>
          <button
            type="button"
            onClick={() => setShowIssues((v) => !v)}
            aria-expanded={showIssues}
            className="text-xs font-black uppercase tracking-wider text-brand hover:underline"
          >
            {showIssues ? 'Ocultar conferência' : 'A loja anotou ressalva ou falta? Registrar'}
          </button>
          {showIssues && (
            <div className="mt-3 space-y-4">
              <div>
                <SectionTitle
                  aside={
                    <button type="button" onClick={() => setField('items', items.map((i) => ({ ...i, outcome: 'ok', note: '' })))} className="text-[11px] font-black uppercase tracking-wider text-brand flex items-center gap-1">
                      <CheckCheck size={13} /> Tudo OK
                    </button>
                  }
                >
                  Conferência dos itens
                </SectionTitle>
                <ul className="divide-y divide-gray-100 dark:divide-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
                  {term.assets.map((asset) => {
                    const item = items.find((i) => i.id === asset.id);
                    return (
                      <li key={asset.id} className="p-3 bg-white dark:bg-slate-900 space-y-2">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{asset.model || '—'}</p>
                            <p className="text-[11px] font-mono text-gray-500 dark:text-gray-400 truncate">
                              {asset.internalId}{asset.serialNumber ? ` · SN ${asset.serialNumber}` : ''}{asset.accessories ? ` · ${asset.accessories}` : ''} · enviado: {asset.condition}
                            </p>
                          </div>
                          <div className="flex rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden shrink-0" role="radiogroup" aria-label={`Conferência de ${asset.internalId}`}>
                            {Object.entries(RECEIPT_OUTCOMES).map(([value, text]) => (
                              <button
                                key={value}
                                type="button"
                                role="radio"
                                aria-checked={item.outcome === value}
                                onClick={() => setItem(asset.id, { outcome: value })}
                                className={`px-2.5 py-1.5 text-[10px] font-black uppercase border-l first:border-l-0 border-gray-200 dark:border-slate-700 ${item.outcome === value ? OUTCOME_STYLE[value] : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-slate-800'}`}
                              >
                                {value === 'ok' ? 'OK' : value === 'ressalva' ? 'Ressalva' : 'Faltou'}
                                <span className="sr-only"> — {text}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                        {item.outcome !== 'ok' && (
                          <input
                            value={item.note}
                            onChange={(e) => setItem(asset.id, { note: e.target.value })}
                            placeholder={item.outcome === 'ressalva' ? 'Descreva a ressalva (ex.: sem carregador, tela riscada) *' : 'O que aconteceu? (ex.: não veio na caixa) *'}
                            aria-label={`Observação de ${asset.internalId}`}
                            className={`${fieldClass} text-xs`}
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="receipt-by" className={labelClass}>Recebido por *</label>
                  <input id="receipt-by" value={receipt.receivedByName} onChange={(e) => setField('receivedByName', e.target.value)} className={fieldClass} />
                </div>
                <div>
                  <label htmlFor="receipt-date" className={labelClass}>Data do recebimento *</label>
                  <input id="receipt-date" type="date" value={receipt.receivedAt} onChange={(e) => setField('receivedAt', e.target.value)} className={fieldClass} />
                </div>
                <div>
                  <label htmlFor="receipt-status" className={labelClass}>Situação dos itens recebidos</label>
                  <select id="receipt-status" value={receipt.newStatus} onChange={(e) => setField('newStatus', e.target.value)} className={fieldClass}>
                    {ARRIVAL_STATUSES.map((s) => <option key={s} value={s}>{s === 'Disponível' ? 'Disponível (estoque da loja)' : s}</option>)}
                  </select>
                </div>
                <label className="flex items-center gap-2 self-end pb-2 text-xs font-bold text-gray-600 dark:text-gray-300 cursor-pointer">
                  <input type="checkbox" checked={receipt.assignToReceiver} onChange={(e) => setField('assignToReceiver', e.target.checked)} disabled={!term.receiver?.name} className="h-4 w-4" />
                  Registrar o recebedor como responsável pelos itens
                </label>
              </div>

              {issues.some((i) => i.outcome === 'nao_recebido') && (
                <p className="rounded-xl bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-xs font-bold text-rose-700 dark:text-rose-300">
                  Itens marcados como "Faltou" continuam em trânsito e aparecem como pendência na tela Termos até serem localizados ou baixados.
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {canManage && isOpen && !file && (
        <label className="flex items-start gap-2 text-xs text-gray-500 dark:text-gray-400 cursor-pointer">
          <input type="checkbox" checked={withoutCopy} onChange={(e) => setWithoutCopy(e.target.checked)} className="h-4 w-4 mt-0.5" />
          <span><strong>Concluir sem anexar</strong> (só gestores — use quando o papel se perdeu; o registro mostra que não há assinado).</span>
        </label>
      )}
    </TermModalFrame>
  );
};

export default ConcludeTermModal;
