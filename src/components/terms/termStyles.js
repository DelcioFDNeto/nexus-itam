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
  'w-full px-3 py-2.5 bg-white dark:bg-slate-950 border border-gray-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-gray-800 dark:text-gray-100 focus:outline-none focus:border-brand disabled:opacity-60';

export const labelClass = 'block text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1';
