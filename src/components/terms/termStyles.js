// src/components/terms/termStyles.js
// Constantes visuais das telas de termos (fora dos arquivos de componente,
// como pede o Fast Refresh).
import { FileSignature, Truck, Undo2 } from 'lucide-react';

export const KIND_ICON = {
  responsabilidade: FileSignature,
  devolucao: Undo2,
  transferencia: Truck,
};

export const fieldClass =
  'w-full min-h-[44px] px-3 py-2.5 bg-white hover:border-slate-300 active:border-slate-400 focus-visible:outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25 disabled:opacity-50 disabled:cursor-not-allowed aria-[invalid=true]:border-rose-500 aria-[invalid=true]:focus-visible:ring-rose-500/25 dark:bg-[#111113] dark:border-zinc-800 dark:hover:border-zinc-700 dark:text-[#fafafa] dark:placeholder:text-zinc-500 dark:[&_option]:bg-[#111113] dark:[&_option]:text-[#fafafa] border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 placeholder:text-slate-400 transition-colors';

export const labelClass = 'block text-xs font-bold text-slate-600 dark:text-zinc-400 uppercase tracking-wider mb-1.5';
