// src/components/settings/settingsStyles.js
// Classes compartilhadas pelas secoes de Configuracoes (fora dos arquivos de
// componente, como pede o Fast Refresh).

export const inputClass =
  'w-full min-h-[44px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111113] rounded-lg px-3 py-2 font-semibold text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-colors hover:border-slate-300 dark:hover:border-slate-600 active:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:border-brand disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-900 read-only:bg-slate-50 dark:read-only:bg-slate-900/60 aria-[invalid=true]:border-rose-500 aria-[invalid=true]:focus-visible:ring-rose-500';

export const buttonPrimaryClass =
  'min-h-[44px] px-4 py-2 rounded-lg bg-brand text-brand-fg font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors hover:bg-brand-dark active:scale-[0.98] active:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#111113] disabled:opacity-60 disabled:cursor-not-allowed';

export const buttonSecondaryClass =
  'min-h-[44px] px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111113] text-slate-700 dark:text-slate-200 font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors hover:bg-slate-50 dark:hover:bg-zinc-800 active:bg-slate-100 dark:active:bg-zinc-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#111113] disabled:opacity-60 disabled:cursor-not-allowed';

export const NEXUS_DEFAULT_COLOR = '#0C5CAB';
