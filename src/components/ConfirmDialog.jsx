// src/components/ConfirmDialog.jsx
// -----------------------------------------------------------------------------
// Substitui window.confirm / window.prompt por um modal do proprio app (tema
// escuro, mobile, nao bloqueado em PWA/WebView).
//
//   const confirm = useConfirm();
//   if (!(await confirm({ title: 'Excluir?', message: '...', danger: true }))) return;
//
//   const reason = await confirm({ title: 'Cancelar termo', input: { label: 'Motivo', required: true } });
//   if (reason === false) return;   // com `input`, devolve o texto digitado ou false
// -----------------------------------------------------------------------------
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertTriangle, HelpCircle } from 'lucide-react';
import { captureFocusTarget, restoreFocusSafely, trapFocusWithin } from '../utils/focusTrap';

const ConfirmContext = createContext(null);

export const ConfirmProvider = ({ children }) => {
  const [dialog, setDialog] = useState(null);
  const [value, setValue] = useState('');
  const resolverRef = useRef(null);
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const confirmRef = useRef(null);
  const previousFocusRef = useRef(null);
  const wasOpenRef = useRef(false);

  const confirm = useCallback((options = {}) => {
    const opts = typeof options === 'string' ? { message: options } : options;
    if (!wasOpenRef.current) {
      previousFocusRef.current = captureFocusTarget(dialogRef.current);
    }
    return new Promise((resolve) => {
      // Um dialogo novo antes do anterior fechar resolve o anterior como "nao".
      resolverRef.current?.(false);
      resolverRef.current = resolve;
      setValue(opts.input?.defaultValue ?? '');
      setDialog(opts);
    });
  }, []);

  const close = useCallback((result) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setDialog(null);
  }, []);

  useEffect(() => {
    if (!dialog) {
      if (wasOpenRef.current) {
        wasOpenRef.current = false;
        const previous = previousFocusRef.current;
        previousFocusRef.current = null;
        restoreFocusSafely(previous);
      }
      return undefined;
    }

    wasOpenRef.current = true;
    if (!previousFocusRef.current) {
      previousFocusRef.current = captureFocusTarget(dialogRef.current);
    }

    const focusTarget = dialog.input ? inputRef.current : confirmRef.current;
    focusTarget?.focus();

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(false);
        return;
      }
      if (event.key === 'Tab') {
        trapFocusWithin(event, dialogRef.current);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dialog, close]);

  // Desmontar com dialogo aberto nao deixa a Promise pendurada.
  useEffect(() => () => resolverRef.current?.(false), []);

  const submit = (event) => {
    event?.preventDefault();
    if (!dialog) return;
    if (dialog.input) {
      const text = value.trim();
      if (dialog.input.required && !text) return;
      close(text);
      return;
    }
    close(true);
  };

  const danger = Boolean(dialog?.danger);
  const Icon = danger ? AlertTriangle : HelpCircle;
  const inputMissing = Boolean(dialog?.input?.required && !value.trim());

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {dialog && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center animate-fade-in"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close(false);
          }}
        >
          <form
            ref={dialogRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            aria-describedby={dialog.message ? 'confirm-dialog-desc' : undefined}
            onSubmit={submit}
            className="w-full max-w-md max-h-[90vh] overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-zinc-800 dark:bg-[#111113] animate-zoom-in"
          >
            <div className="flex items-start gap-4">
              <div
                aria-hidden="true"
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                  danger
                    ? 'bg-rose-500/10 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400'
                    : 'bg-brand/10 text-brand-aa dark:bg-brand/15'
                }`}
              >
                <Icon size={20} aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="confirm-dialog-title" className="text-base font-black text-slate-900 dark:text-[#fafafa]">
                  {dialog.title || 'Confirmar'}
                </h2>
                {dialog.message && (
                  <p id="confirm-dialog-desc" className="mt-1 whitespace-pre-line text-sm text-slate-600 dark:text-zinc-300">
                    {dialog.message}
                  </p>
                )}
                {dialog.input && (
                  <div className="mt-4">
                    {dialog.input.label && (
                      <label
                        htmlFor="confirm-dialog-input"
                        className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-400"
                      >
                        {dialog.input.label}
                      </label>
                    )}
                    <textarea
                      id="confirm-dialog-input"
                      name="confirmDialogInput"
                      ref={inputRef}
                      rows={dialog.input.rows || 3}
                      value={value}
                      aria-label={dialog.input.label || 'Resposta'}
                      placeholder={dialog.input.placeholder || ''}
                      onChange={(event) => setValue(event.target.value)}
                      className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:border-brand dark:border-zinc-800 dark:bg-[#09090b] dark:text-[#fafafa] dark:placeholder:text-zinc-500"
                    />
                  </div>
                )}
              </div>
            </div>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => close(false)}
                className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 dark:border-zinc-800 dark:bg-[#111113] dark:text-zinc-200 dark:hover:bg-[#18181b] dark:focus-visible:ring-offset-[#111113]"
              >
                {dialog.cancelLabel || 'Cancelar'}
              </button>
              <button
                ref={confirmRef}
                type="submit"
                disabled={inputMissing}
                className={`inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 py-2.5 text-sm font-bold shadow-sm transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#111113] disabled:cursor-not-allowed disabled:opacity-50 ${
                  danger
                    ? 'bg-rose-600 text-white hover:bg-rose-700'
                    : 'bg-brand text-brand-fg hover:bg-brand-dark'
                }`}
              >
                {dialog.confirmLabel || 'Confirmar'}
              </button>
            </div>
          </form>
        </div>
      )}
    </ConfirmContext.Provider>
  );
};

/**
 * Hook do dialogo. Fora do provider (ex.: testes que renderizam a pagina
 * isolada) cai em window.confirm/prompt para nao quebrar.
 */
// eslint-disable-next-line react-refresh/only-export-components
export const useConfirm = () => {
  const ctx = useContext(ConfirmContext);
  return useCallback(
    async (options = {}) => {
      if (ctx) return ctx(options);
      const opts = typeof options === 'string' ? { message: options } : options;
      const text = [opts.title, opts.message].filter(Boolean).join('\n\n');
      if (opts.input) {
        const answer = window.prompt(text, opts.input.defaultValue ?? '');
        if (answer === null) return false;
        const trimmed = answer.trim();
        if (opts.input.required && !trimmed) return false;
        return trimmed;
      }
      return window.confirm(text);
    },
    [ctx],
  );
};

export default ConfirmProvider;
