// src/components/WriteOffModal.jsx
import React, { useState } from 'react';
import { Archive, AlertTriangle, X } from 'lucide-react';
import { RETIRED_STATUSES, WRITE_OFF_REASONS } from '../utils/assetStatus';

const hoje = () => new Date().toISOString().slice(0, 10);

/**
 * Baixa patrimonial.
 *
 * Data e motivo sao obrigatorios: e o que separa uma baixa auditavel de uma
 * exclusao silenciosa. O registro do ativo e toda a timeline permanecem.
 */
const WriteOffModal = ({ isOpen, onClose, asset, onConfirm, saving = false }) => {
  const [form, setForm] = useState({
    status: 'Baixado',
    date: hoje(),
    reason: '',
    residualValue: '',
    notes: '',
  });

  if (!isOpen) return null;

  const podeConfirmar = form.reason && form.date && !saving;

  const submit = (e) => {
    e.preventDefault();
    if (!podeConfirmar) return;
    onConfirm(form);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="max-h-[92vh] w-full overflow-y-auto custom-scrollbar rounded-t-3xl bg-white shadow-2xl dark:bg-slate-900 sm:max-w-lg sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-5 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-white dark:bg-white dark:text-slate-900">
              <Archive size={20} />
            </span>
            <div>
              <h2 className="text-lg font-black tracking-tight text-slate-900 dark:text-white">Dar baixa no ativo</h2>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {asset?.internalId} — {asset?.model}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4 p-5">
          <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/30">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-500" />
            <p className="text-xs leading-relaxed text-amber-800 dark:text-amber-400">
              O registro e todo o histórico são preservados. O ativo sai das contagens, do valor total e da auditoria,
              e o responsável atual é liberado. A baixa pode ser desfeita depois.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Situação final
              </label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-bold text-slate-900 outline-none focus:border-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                {RETIRED_STATUSES.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Data da baixa <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                required
                max={hoje()}
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-bold text-slate-900 outline-none focus:border-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Motivo <span className="text-red-500">*</span>
            </label>
            <select
              required
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-bold text-slate-900 outline-none focus:border-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            >
              <option value="">Selecione o motivo...</option>
              {WRITE_OFF_REASONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Valor residual (R$)
            </label>
            <input
              value={form.residualValue}
              onChange={(e) => setForm({ ...form, residualValue: e.target.value })}
              placeholder="0,00 — preencha em caso de venda ou sucata"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-sm text-slate-900 outline-none focus:border-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Observações
            </label>
            <textarea
              rows="3"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Nº do processo, destino do equipamento, laudo técnico…"
              className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800 outline-none focus:border-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 px-5 py-3 text-xs font-black uppercase tracking-widest text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!podeConfirmar}
              className="rounded-xl bg-slate-900 px-5 py-3 text-xs font-black uppercase tracking-widest text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-white dark:text-slate-900"
            >
              {saving ? 'Registrando…' : 'Confirmar baixa'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default WriteOffModal;
