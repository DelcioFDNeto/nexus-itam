// src/components/AssetTimeline.jsx
import React from 'react';
import { Circle, User, RefreshCw, PlusCircle, Clock } from 'lucide-react';

const AssetTimeline = ({ history }) => {
  if (!history || history.length === 0) {
    return <div className="text-gray-400 dark:text-gray-500 text-sm italic p-4">Nenhum histórico registrado.</div>;
  }

  const getIcon = (action) => {
    if (action === 'Criação') return <PlusCircle size={16} className="text-green-600" />;
    if (action === 'Transferência') return <User size={16} className="text-blue-600" />;
    if (action === 'Mudança de Status') return <RefreshCw size={16} className="text-orange-600" />;
    return <Circle size={16} className="text-gray-400 dark:text-gray-500" />;
  };

  // Função para formatar data do Firestore (Timestamp)
  const formatDate = (timestamp) => {
      if (!timestamp) return "Data pendente...";
      // Se for Timestamp do Firestore, converte. Se for Date JS, usa direto.
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      return new Intl.DateTimeFormat('pt-BR', { 
          day: '2-digit', month: '2-digit', year: '2-digit', 
          hour: '2-digit', minute: '2-digit' 
      }).format(date);
  };

  return (
    <div className="relative border-l-2 border-gray-200 dark:border-slate-600 ml-3 space-y-6 my-6">
      {history.map((log) => (
        <div key={log.id} className="relative pl-6">
          {/* Bolinha na linha do tempo */}
          <div className="absolute -left-[9px] top-0 bg-white dark:bg-slate-800 p-1 rounded-full border border-gray-200 dark:border-slate-600">
            {getIcon(log.action)}
          </div>
          
          <div className="bg-gray-50 dark:bg-slate-900 p-3 rounded-lg border border-gray-100 dark:border-slate-700 shadow-sm">
            <div className="flex justify-between items-start">
                <span className="font-bold text-gray-800 dark:text-gray-100 text-sm">{log.action}</span>
                <span className="text-[10px] text-gray-400 dark:text-gray-500 flex items-center gap-1">
                    <Clock size={10} /> {formatDate(log.date)}
                </span>
            </div>
            <p className="text-sm text-gray-600 mt-1">{log.details}</p>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-2 text-right">por: {log.user}</p>
          </div>
        </div>
      ))}
    </div>
  );
};

export default AssetTimeline;