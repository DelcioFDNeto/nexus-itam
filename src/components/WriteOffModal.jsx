// src/components/WriteOffModal.jsx
import React, { useEffect, useId, useRef, useState } from 'react';
import { Archive, AlertTriangle, X } from 'lucide-react';
import { RETIRED_STATUSES, WRITE_OFF_REASONS } from '../utils/assetStatus';
import { today } from '../utils/dates';
import { captureFocusTarget, restoreFocusSafely, trapFocusWithin } from '../utils/focusTrap';
import { isTopmostModal } from '../utils/modalStack';

const fieldCls =
  'w-full min-h-[44px] rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-bold text-slate-900 hover:border-slate-300 active:border-slate-400 focus-visible:outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25 disabled:opacity-50 disabled:cursor-not-allowed aria-[invalid=true]:border-rose-500 aria-[invalid=true]:focus-visible:ring-rose-500/25 dark:border-zinc-800 dark:bg-[#111113] dark:hover:border-zinc-700 dark:text-[#fafafa] dark:placeholder:text-zinc-500 transition-colors';

/**
 * Baixa patrimonial.
 *
 * Data e motivo sao obrigatorios: e o que separa uma baixa auditavel de uma
 * exclusao silenciosa. O registro do ativo e toda a timeline permanecem.
 */
const WriteOffModalBody = ({ onClose, asset, onConfirm, saving }) => {
  const [form, setForm] = useState(() => ({
    status: 'Baixado',
    date: today(),
    reason: '',
    residualValue: '',
    notes: '',
  }));
  const titleId = useId();
  const statusId = useId();
  const dateId = useId();
  const reasonId = useId();
  const residualId = useId();
  const notesId = useId();
  const dialogRef = useRef(null);
  const firstFieldRef = useRef(null);
  const previousFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const savingRef = useRef(saving);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    savingRef.current = saving;
  }, [saving]);

  useEffect(() => {
    const container = dialogRef.current;
    previousFocusRef.current = captureFocusTarget(container);
    const raf = requestAnimationFrame(() => firstFieldRef.current?.focus());
    const onKeyDown = (e) => {
      if (!isTopmostModal(container)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (!savingRef.current) onCloseRef.current?.();
        return;
      }
      if (e.key === 'Tab') {
        trapFocusWithin(e, container);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown);
      const previous = previousFocusRef.current;
      previousFocusRef.current = null;
      restoreFocusSafely(previous, null, container);
    };
  }, []);

  const podeConfirmar = form.reason && form.date && !saving;

  const submit = (e) => {
    e.preventDefault();
    if (!podeConfirmar) return;
    onConfirm(form);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4 animate-fade-in"
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[92vh] w-full overflow-y-auto overscroll-contain custom-scrollbar rounded-t-3xl bg-white shadow-2xl border border-slate-200 dark:border-zinc-800 dark:bg-[#111113] sm:max-w-lg sm:rounded-xl animate-zoom-in focus:outline-none"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-5 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-white dark:bg-zinc-900 dark:border dark:border-zinc-800 dark:text-[#fafafa]" aria-hidden="true">
              <Archive size={20} aria-hidden="true" />
            </span>
            <div>
              <h2 id={titleId} className="text-lg font-black tracking-tight text-slate-900 dark:text-[#fafafa]">Dar baixa no ativo</h2>
              <p className="text-xs font-medium text-slate-500 dark:text-zinc-400">
                {asset?.internalId} — {asset?.model}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            aria-label="Fechar"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:text-zinc-400 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4 p-5">
          <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/30">
            <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-500" />
            <p className="text-xs leading-relaxed text-amber-800 dark:text-amber-400">
              O registro e todo o histórico são preservados. O ativo sai das contagens, do valor total e da auditoria,
              e o responsável atual é liberado. A baixa pode ser desfeita depois.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={statusId} className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-zinc-400">
                Situação final
              </label>
              <select
                ref={firstFieldRef}
                id={statusId}
                name="status"
                disabled={saving}
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className={`${fieldCls} dark:[&_option]:bg-[#111113] dark:[&_option]:text-[#fafafa]`}
              >
                {RETIRED_STATUSES.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor={dateId} className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-zinc-400">
                Data da baixa <span className="text-rose-500">*</span>
              </label>
              <input
                id={dateId}
                name="date"
                type="date"
                required
                disabled={saving}
                max={today()}
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className={`${fieldCls} tabular-nums`}
              />
            </div>
          </div>

          <div>
            <label htmlFor={reasonId} className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-zinc-400">
              Motivo <span className="text-rose-500">*</span>
            </label>
            <select
              id={reasonId}
              name="reason"
              required
              disabled={saving}
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              className={`${fieldCls} dark:[&_option]:bg-[#111113] dark:[&_option]:text-[#fafafa]`}
            >
              <option value="">Selecione o motivo…</option>
              {WRITE_OFF_REASONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor={residualId} className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-zinc-400">
              Valor residual (R$)
            </label>
            <input
              id={residualId}
              name="residualValue"
              disabled={saving}
              value={form.residualValue}
              onChange={(e) => setForm({ ...form, residualValue: e.target.value })}
              placeholder="0,00 — preencha em caso de venda ou sucata"
              className={`${fieldCls} font-mono font-normal tabular-nums`}
            />
          </div>

          <div>
            <label htmlFor={notesId} className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-zinc-400">
              Observações
            </label>
            <textarea
              id={notesId}
              name="notes"
              rows="3"
              disabled={saving}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Nº do processo, destino do equipamento, laudo técnico…"
              className={`${fieldCls} resize-none font-normal`}
            />
          </div>

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="min-h-[44px] rounded-xl border border-slate-200 px-5 py-3 text-xs font-black uppercase tracking-widest text-slate-600 hover:bg-slate-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!podeConfirmar}
              className="min-h-[44px] rounded-xl bg-brand hover:bg-brand-dark px-5 py-3 text-xs font-black uppercase tracking-widest text-brand-fg disabled:opacity-50 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              {saving ? 'Registrando…' : 'Confirmar baixa'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const WriteOffModal = ({ isOpen, onClose, asset, onConfirm, saving = false }) => {
  if (!isOpen) return null;
  return (
    <WriteOffModalBody
      key={asset?.id ?? 'default'}
      onClose={onClose}
      asset={asset}
      onConfirm={onConfirm}
      saving={saving}
    />
  );
};

export default WriteOffModal;
