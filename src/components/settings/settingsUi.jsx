// src/components/settings/settingsUi.jsx
// Pecas visuais das secoes de Configuracoes.
import React from 'react';

export const Card = ({ icon: Icon, title, subtitle, children, action }) => (
  <section className="bg-white dark:bg-[#111113] rounded-2xl border border-slate-200 dark:border-zinc-800 shadow-sm overflow-hidden">
    <header className="bg-slate-50 dark:bg-zinc-900/80 px-5 py-4 border-b border-slate-100 dark:border-zinc-800 flex items-center gap-3">
      {Icon && <Icon className="text-brand-aa shrink-0" size={18} aria-hidden="true" />}
      <div className="min-w-0 flex-1">
        <h2 className="font-bold text-slate-900 dark:text-white text-sm uppercase">{title}</h2>
        {subtitle && <p className="text-xs text-slate-600 dark:text-slate-400">{subtitle}</p>}
      </div>
      {action}
    </header>
    <div className="p-5 space-y-4">{children}</div>
  </section>
);

export const Field = ({ label, hint, htmlFor, children }) => (
  <div>
    <label htmlFor={htmlFor} className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1.5">{label}</label>
    {children}
    {hint && <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400">{hint}</p>}
  </div>
);

/** Titulo de cada secao (acima dos cards). */
export const SectionHeader = ({ icon: Icon, title, description, children }) => (
  <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
    <div>
      <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
        {Icon && <Icon size={20} className="text-brand-aa shrink-0" aria-hidden="true" />} {title}
      </h2>
      {description && <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">{description}</p>}
    </div>
    {children}
  </div>
);
