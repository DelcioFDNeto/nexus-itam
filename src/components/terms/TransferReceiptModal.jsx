// src/components/terms/TransferReceiptModal.jsx
import React, { useState } from 'react';
import { CheckCheck, PackageCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../contexts/AuthContext';
import { useTermPrinter } from '../../hooks/useTermPrinter';
import { confirmTransferReceipt } from '../../services/termService';
import { RECEIPT_OUTCOMES, receiptStatus } from '../../utils/terms';
import { SectionTitle, TermModalFrame } from './termUi';
import { fieldClass, labelClass } from './termStyles';

const OUTCOME_STYLE = {
  ok: 'bg-green-600 text-white border-green-600',
  ressalva: 'bg-orange-500 text-white border-orange-500',
  nao_recebido: 'bg-rose-600 text-white border-rose-600',
};

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Conferencia na loja. Cada item e marcado como recebido, recebido com
 * ressalva (avaria, falta de acessorio...) ou nao recebido. Os recebidos
 * passam para o local de destino; os faltantes continuam em transito.
 */
const TransferReceiptModal = ({ term, onClose, onConfirmed }) => {
  const { currentUser } = useAuth();
  const { printTerm } = useTermPrinter();
  const [items, setItems] = useState(() => term.assets.map((a) => ({ id: a.id, outcome: 'ok', note: '' })));
  const [receivedByName, setReceivedByName] = useState(term.receiver?.name || currentUser?.name || '');
  const [receivedAt, setReceivedAt] = useState(today());
  const [newStatus, setNewStatus] = useState('Disponível');
  const [assignToReceiver, setAssignToReceiver] = useState(false);
  const [busy, setBusy] = useState(false);

  const setItem = (id, patch) => setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const markAllOk = () => setItems((prev) => prev.map((i) => ({ ...i, outcome: 'ok', note: '' })));

  const issues = items.filter((i) => i.outcome !== 'ok');
  const missingNote = items.some((i) => i.outcome !== 'ok' && !i.note.trim());
  const canSubmit = receivedByName.trim() && receivedAt && !missingNote && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const { status, outcomes } = await confirmTransferReceipt({
        term,
        user: currentUser,
        receivedByName,
        receivedAt,
        items,
        newStatus,
        assignToReceiver,
      });
      const updated = {
        ...term,
        status,
        receipt: { receivedByName, receivedAt, confirmedByName: currentUser?.name, confirmedBy: currentUser?.email, items: outcomes, newStatus },
      };
      toast.success(
        status === 'recebido' ? `${term.number}: recebimento confirmado em ${term.destination.name}.` : `${term.number}: recebido com ${issues.length} ressalva(s).`,
        { action: { label: 'Imprimir termo', onClick: () => printTerm(updated) }, duration: 10000 },
      );
      onConfirmed?.(updated);
      onClose();
    } catch (error) {
      console.error(error);
      toast.error(error?.code === 'permission-denied' ? 'Seu perfil não pode confirmar recebimentos.' : error.message || 'Erro ao confirmar o recebimento.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <TermModalFrame
      icon={PackageCheck}
      wide
      title={`Conferir recebimento · ${term.number}`}
      subtitle={`${term.origin?.name} → ${term.destination?.name} · ${term.assets.length} item(ns)`}
      onClose={onClose}
      footer={
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-xs font-bold text-gray-500 dark:text-gray-400">
            Resultado: {receiptStatus(items) === 'recebido' ? 'tudo conferido' : `${issues.length} item(ns) com ressalva ou falta`}
          </p>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="px-5 py-3 rounded-xl bg-brand text-white text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 shadow-md shadow-brand/30 disabled:opacity-40 disabled:shadow-none"
          >
            <PackageCheck size={15} /> {busy ? 'Confirmando…' : 'Confirmar recebimento'}
          </button>
        </div>
      }
    >
      <section>
        <SectionTitle
          aside={
            <button type="button" onClick={markAllOk} className="text-[11px] font-black uppercase tracking-wider text-brand flex items-center gap-1">
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
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="receipt-by" className={labelClass}>Recebido por *</label>
          <input id="receipt-by" value={receivedByName} onChange={(e) => setReceivedByName(e.target.value)} className={fieldClass} />
        </div>
        <div>
          <label htmlFor="receipt-date" className={labelClass}>Data do recebimento *</label>
          <input id="receipt-date" type="date" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} className={fieldClass} />
        </div>
        <div>
          <label htmlFor="receipt-status" className={labelClass}>Situação dos itens recebidos</label>
          <select id="receipt-status" value={newStatus} onChange={(e) => setNewStatus(e.target.value)} className={fieldClass}>
            <option value="Disponível">Disponível (estoque da loja)</option>
            <option value="Em Uso">Em Uso</option>
          </select>
        </div>
        <label className="flex items-center gap-2 self-end pb-2 text-xs font-bold text-gray-600 dark:text-gray-300 cursor-pointer">
          <input type="checkbox" checked={assignToReceiver} onChange={(e) => setAssignToReceiver(e.target.checked)} className="h-4 w-4" />
          Registrar o recebedor como responsável pelos itens
        </label>
      </section>

      {issues.some((i) => i.outcome === 'nao_recebido') && (
        <p className="rounded-xl bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-xs font-bold text-rose-700 dark:text-rose-300">
          Itens marcados como "Faltou" continuam em trânsito e aparecem como pendência na tela Termos até serem localizados ou baixados.
        </p>
      )}
    </TermModalFrame>
  );
};

export default TransferReceiptModal;
