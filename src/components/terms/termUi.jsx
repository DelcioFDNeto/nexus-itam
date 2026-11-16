// src/components/terms/termUi.jsx
// Pecas visuais compartilhadas pelas telas de termos.
import React, { useEffect, useId, useRef } from 'react';
import { FileSignature, X } from 'lucide-react';
import { KIND_ICON } from './termStyles';
import { TERM_KINDS, TERM_STATUS } from '../../utils/terms';
import { captureFocusTarget, restoreFocusSafely, trapFocusWithin } from '../../utils/focusTrap';
import { isTopmostModal } from '../../utils/modalStack';

const TONES = {
  amber: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900',
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900',
  blue: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900',
  orange: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-900',
  slate: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700',
};

export const TermStatusBadge = ({ status }) => {
  const meta = TERM_STATUS[status] || { label: status || '—', tone: 'slate' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-xs font-bold uppercase tracking-wide whitespace-nowrap ${TONES[meta.tone]}`}>
      {meta.label}
    </span>
  );
};

export const TermKindTag = ({ kind }) => {
  const Icon = KIND_ICON[kind] || FileSignature;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-zinc-400 whitespace-nowrap">
      <Icon size={12} aria-hidden="true" /> {TERM_KINDS[kind]?.short || kind}
    </span>
  );
};

/** Moldura dos modais de termo: cabecalho, rolagem e rodape fixo de acoes. */
export const TermModalFrame = ({ icon: Icon, title, subtitle, onClose, busy = false, children, footer, wide = false }) => {
  const titleId = useId();
  const subtitleId = useId();
  const dialogRef = useRef(null);
  const previousFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    const container = dialogRef.current;
    previousFocusRef.current = captureFocusTarget(container);
    const raf = requestAnimationFrame(() => {
      if (container && !container.contains(document.activeElement)) {
        container.focus();
      }
    });
    const onKeyDown = (event) => {
      if (!isTopmostModal(container)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!busyRef.current) onCloseRef.current?.();
        return;
      }
      if (event.key === 'Tab') {
        trapFocusWithin(event, container);
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

  return (
    <div
      className="fixed inset-0 z-[60] !mt-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-fade-in"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose?.();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
        className={`bg-white dark:bg-[#111113] border border-slate-200 dark:border-zinc-800 rounded-xl shadow-2xl w-full ${wide ? 'max-w-4xl' : 'max-w-2xl'} max-h-[94vh] flex flex-col overflow-hidden focus:outline-none animate-zoom-in`}
      >
        <header className="flex items-start justify-between gap-4 px-6 py-5 border-b border-slate-200/80 dark:border-zinc-800">
          <div className="flex items-start gap-3 min-w-0">
            <div className="p-2.5 rounded-xl bg-brand/10 text-brand-aa shrink-0" aria-hidden="true">
              <Icon size={20} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 id={titleId} className="text-lg font-black text-slate-900 dark:text-[#fafafa] leading-tight">
                {title}
              </h2>
              {subtitle && (
                <p id={subtitleId} className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
                  {subtitle}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => { if (!busy) onClose?.(); }}
            aria-label="Fechar"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-[#fafafa] transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto overscroll-contain custom-scrollbar px-6 py-5 space-y-5">{children}</div>
        {footer && (
          <footer className="px-6 py-4 border-t border-slate-200/80 dark:border-zinc-800 bg-slate-50/80 dark:bg-zinc-900/80">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
};

export const SectionTitle = ({ children, aside }) => (
  <div className="flex items-center justify-between gap-2 mb-2">
    <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400">{children}</h3>
    {aside}
  </div>
);
