// src/components/AssetTimeline.jsx
import React from 'react';
import { Circle, User, RefreshCw, PlusCircle, Clock } from 'lucide-react';

const AssetTimeline = ({ history }) => {
  if (!history || history.length === 0) {
    return <div className="text-gray-400 dark:text-gray-500 text-sm italic p-4">Nenhum histórico registrado.</div>;
  }

  const getIcon = (action) => {
    if (action === 'Criação') return <PlusCircle size={16} aria-hidden="true" className="text-emerald-600 dark:text-emerald-400" />;
    if (action === 'Transferência') return <User size={16} aria-hidden="true" className="text-sky-600 dark:text-sky-400" />;
    if (action === 'Mudança de Status') return <RefreshCw size={16} aria-hidden="true" className="text-amber-600 dark:text-amber-400" />;
    return <Circle size={16} aria-hidden="true" className="text-gray-400 dark:text-zinc-500" />;
  };

  // Função para formatar data do Firestore (Timestamp)
  const formatDate = (timestamp) => {
      if (!timestamp) return "Data pendente…";
      // Se for Timestamp do Firestore, converte. Se for Date JS, usa direto.
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      return new Intl.DateTimeFormat('pt-BR', { 
          day: '2-digit', month: '2-digit', year: '2-digit', 
          hour: '2-digit', minute: '2-digit' 
      }).format(date);
  };

  return (
    <div className="relative border-l-2 border-gray-200 dark:border-zinc-800 ml-3 space-y-6 my-6">
      {history.map((log) => (
        <div key={log.id} className="relative pl-6">
          {/* Bolinha na linha do tempo */}
          <div className="absolute -left-[9px] top-0 bg-white dark:bg-[#111113] p-1 rounded-full border border-gray-200 dark:border-zinc-800" aria-hidden="true">
            {getIcon(log.action)}
          </div>
          
          <div className="bg-gray-50 dark:bg-[#111113] p-3 rounded-lg border border-gray-100 dark:border-zinc-800 shadow-sm">
            <div className="flex justify-between items-start gap-2">
                <span className="font-bold text-gray-800 dark:text-[#fafafa] text-sm">{log.action}</span>
                <span className="text-xs font-mono tabular-nums text-gray-500 dark:text-zinc-400 flex items-center gap-1 shrink-0">
                    <Clock size={12} aria-hidden="true" /> {formatDate(log.date)}
                </span>
            </div>
            <p className="text-sm text-gray-600 dark:text-zinc-300 mt-1">{log.details}</p>
            <p className="text-xs text-gray-500 dark:text-zinc-400 mt-2 text-right">por: {log.user}</p>
          </div>
        </div>
      ))}
    </div>
  );
};

export default AssetTimeline;