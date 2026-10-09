// src/components/terms/termUi.jsx
// Pecas visuais compartilhadas pelas telas de termos.
import React from 'react';
import { FileSignature, X } from 'lucide-react';
import { KIND_ICON } from './termStyles';
import { TERM_KINDS, TERM_STATUS } from '../../utils/terms';

const TONES = {
  amber: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900',
  green: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-900',
  blue: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900',
  orange: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-900',
  slate: 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700',
};

export const TermStatusBadge = ({ status }) => {
  const meta = TERM_STATUS[status] || { label: status || '—', tone: 'slate' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-black uppercase tracking-wide whitespace-nowrap ${TONES[meta.tone]}`}>
      {meta.label}
    </span>
  );
};

export const TermKindTag = ({ kind }) => {
  const Icon = KIND_ICON[kind] || FileSignature;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wide text-gray-500 dark:text-gray-400 whitespace-nowrap">
      <Icon size={12} /> {TERM_KINDS[kind]?.short || kind}
    </span>
  );
};

/** Moldura dos modais de termo: cabecalho, rolagem e rodape fixo de acoes. */
export const TermModalFrame = ({ icon: Icon, title, subtitle, onClose, children, footer, wide = false }) => (
  <div className="fixed inset-0 z-[60] !mt-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
    <div className={`bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-3xl shadow-2xl w-full ${wide ? 'max-w-4xl' : 'max-w-2xl'} max-h-[94vh] flex flex-col overflow-hidden`}>
      <header className="flex items-start justify-between gap-4 px-6 py-5 border-b border-gray-100 dark:border-slate-800">
        <div className="flex items-start gap-3 min-w-0">
          <div className="p-2.5 rounded-xl bg-brand/10 text-brand shrink-0"><Icon size={20} /></div>
          <div className="min-w-0">
            <h2 className="text-lg font-black text-gray-900 dark:text-white leading-tight">{title}</h2>
            {subtitle && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</p>}
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Fechar" className="p-1.5 rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-slate-800 dark:hover:text-white">
          <X size={18} />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-5 space-y-5">{children}</div>
      {footer && <footer className="px-6 py-4 border-t border-gray-100 dark:border-slate-800 bg-gray-50/80 dark:bg-slate-900/80">{footer}</footer>}
    </div>
  </div>
);

export const SectionTitle = ({ children, aside }) => (
  <div className="flex items-center justify-between gap-2 mb-2">
    <h3 className="text-[11px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">{children}</h3>
    {aside}
  </div>
);
