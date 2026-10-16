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

const ConfirmContext = createContext(null);

export const ConfirmProvider = ({ children }) => {
  const [dialog, setDialog] = useState(null);
  const [value, setValue] = useState('');
  const resolverRef = useRef(null);
  const inputRef = useRef(null);
  const confirmRef = useRef(null);

  const confirm = useCallback((options = {}) => {
    const opts = typeof options === 'string' ? { message: options } : options;
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
    if (!dialog) return undefined;
    const focusTarget = dialog.input ? inputRef.current : confirmRef.current;
    focusTarget?.focus();
    const onKey = (event) => {
      if (event.key === 'Escape') close(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close(false);
          }}
        >
          <form
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            onSubmit={submit}
            className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-800"
          >
            <div className="flex items-start gap-4">
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                  danger
                    ? 'bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400'
                    : 'bg-blue-100 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400'
                }`}
              >
                <Icon size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="confirm-dialog-title" className="text-base font-black text-gray-900 dark:text-white">
                  {dialog.title || 'Confirmar'}
                </h2>
                {dialog.message && (
                  <p className="mt-1 whitespace-pre-line text-sm text-gray-600 dark:text-gray-300">{dialog.message}</p>
                )}
                {dialog.input && (
                  <label className="mt-4 block">
                    {dialog.input.label && (
                      <span className="text-xs font-bold uppercase text-gray-500 dark:text-gray-400">
                        {dialog.input.label}
                      </span>
                    )}
                    <textarea
                      ref={inputRef}
                      rows={dialog.input.rows || 3}
                      value={value}
                      placeholder={dialog.input.placeholder || ''}
                      onChange={(event) => setValue(event.target.value)}
                      className="mt-1 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    />
                  </label>
                )}
              </div>
            </div>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => close(false)}
                className="rounded-xl px-4 py-2.5 text-sm font-bold text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-slate-700"
              >
                {dialog.cancelLabel || 'Cancelar'}
              </button>
              <button
                ref={confirmRef}
                type="submit"
                disabled={inputMissing}
                className={`rounded-xl px-4 py-2.5 text-sm font-bold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50 ${
                  danger ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-900 hover:bg-gray-800 dark:bg-blue-600 dark:hover:bg-blue-500'
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
