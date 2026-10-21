// src/components/settings/settingsUi.jsx
// Pecas visuais das secoes de Configuracoes.
import React from 'react';

export const Card = ({ icon: Icon, title, subtitle, children, action }) => (
  <section className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 shadow-sm overflow-hidden">
    <header className="bg-gray-50 dark:bg-slate-900 px-5 py-4 border-b border-gray-100 dark:border-slate-700 flex items-center gap-3">
      {Icon && <Icon className="text-brand shrink-0" size={18} />}
      <div className="min-w-0 flex-1">
        <h2 className="font-bold text-gray-800 dark:text-white text-sm uppercase">{title}</h2>
        {subtitle && <p className="text-[11px] text-gray-500 dark:text-gray-400">{subtitle}</p>}
      </div>
      {action}
    </header>
    <div className="p-5 space-y-4">{children}</div>
  </section>
);

export const Field = ({ label, hint, htmlFor, children }) => (
  <div>
    <label htmlFor={htmlFor} className="block text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase mb-1">{label}</label>
    {children}
    {hint && <p className="mt-1 text-[10px] text-gray-400 dark:text-gray-500">{hint}</p>}
  </div>
);

/** Titulo de cada secao (acima dos cards). */
export const SectionHeader = ({ icon: Icon, title, description, children }) => (
  <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
    <div>
      <h2 className="text-xl font-black text-gray-900 dark:text-white flex items-center gap-2">
        {Icon && <Icon size={20} className="text-brand" />} {title}
      </h2>
      {description && <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{description}</p>}
    </div>
    {children}
  </div>
);
