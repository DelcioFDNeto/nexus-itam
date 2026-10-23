// src/components/PWAUpdatePrompt.jsx
// Componente de Notificacao e Atualizacao de PWA
import React, { useState } from 'react';
import { RefreshCw, ArrowUpCircle, X } from 'lucide-react';
import { usePWA } from '../contexts/PWAContext';

const PWAUpdatePrompt = () => {
  const { needRefresh, applyUpdate, bannerDismissed, setBannerDismissed } = usePWA();
  const [updating, setUpdating] = useState(false);

  if (!needRefresh) return null;

  const handleUpdate = async () => {
    setUpdating(true);
    await applyUpdate();
  };

  // Se o usuario minimizou o banner principal, mostra uma pilula discreta no topo
  if (bannerDismissed) {
    return (
      <aside
        aria-label="Aviso de atualização pendente"
        className="fixed top-3 right-3 z-50 cursor-pointer safe-area-pt animate-fade-in"
        onClick={handleUpdate}
      >
        <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow-lg hover:bg-slate-800 transition-colors">
          <span className="w-2 h-2 rounded-full bg-brand" />
          <RefreshCw size={13} className={updating ? 'animate-spin' : ''} />
          <span>Atualização pendente · Toque para aplicar</span>
        </div>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Atualização disponível"
      className="fixed inset-x-3 bottom-20 z-50 sm:bottom-4 sm:left-auto sm:right-4 sm:w-96 animate-slide-up"
    >
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-white shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand text-white shadow-sm">
              <ArrowUpCircle size={18} />
            </div>
            <div>
              <h4 className="text-xs sm:text-sm font-bold text-white">
                Nova versão disponível
              </h4>
              <p className="mt-0.5 text-xs text-slate-300">
                Uma nova versão do sistema está pronta. Atualize agora para carregar as melhorias.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setBannerDismissed(true)}
            aria-label="Minimizar aviso"
            title="Minimizar aviso"
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        <div className="mt-3 flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
          <button
            type="button"
            onClick={() => setBannerDismissed(true)}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            Depois
          </button>
          <button
            type="button"
            onClick={handleUpdate}
            disabled={updating}
            className="flex items-center gap-1.5 rounded-lg bg-brand hover:bg-brand-dark px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors disabled:opacity-50"
          >
            <RefreshCw size={13} className={updating ? 'animate-spin' : ''} />
            <span>{updating ? 'Atualizando…' : 'Atualizar agora'}</span>
          </button>
        </div>
      </div>
    </aside>
  );
};

export default PWAUpdatePrompt;
