// src/components/PWAUpdatePrompt.jsx
// -----------------------------------------------------------------------------
// Componente de Notificacao e Atualizacao Instantanea de PWA
//
// Permite ao usuario atualizar o sistema com 1 toque no celular ou desktop,
// sem perder o trabalho e sem precisar desinstalar o app.
// -----------------------------------------------------------------------------
import React, { useState } from 'react';
import { RefreshCw, Sparkles, X, ChevronUp } from 'lucide-react';
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
        className="fixed top-3 right-3 z-50 animate-bounce cursor-pointer safe-area-pt"
        onClick={handleUpdate}
      >
        <div className="flex items-center gap-2 rounded-full border border-indigo-400/40 bg-slate-900/95 px-3 py-1.5 text-xs font-bold text-white shadow-xl backdrop-blur-md hover:bg-slate-800 active:scale-95">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500" />
          </span>
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
      <div className="relative overflow-hidden rounded-2xl border border-indigo-500/30 bg-slate-900/95 p-4 text-white shadow-2xl shadow-indigo-950/50 backdrop-blur-xl">
        {/* Glow decorativo de fundo */}
        <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-indigo-600/20 blur-2xl" />

        <div className="relative z-10 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 text-white shadow-md shadow-indigo-500/30">
              <Sparkles size={20} />
            </div>
            <div>
              <h4 className="text-sm font-black tracking-tight text-white">
                Nova versão do Nexus ITAM
              </h4>
              <p className="mt-0.5 text-xs text-slate-300">
                Uma atualização do sistema está pronta. Atualize agora para carregar as melhorias.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setBannerDismissed(true)}
            aria-label="Minimizar aviso"
            title="Minimizar aviso"
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        <div className="relative z-10 mt-3 flex items-center justify-end gap-2 pt-2 border-t border-white/10">
          <button
            type="button"
            onClick={() => setBannerDismissed(true)}
            className="rounded-xl px-3 py-2 text-xs font-bold text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            Depois
          </button>
          <button
            type="button"
            onClick={handleUpdate}
            disabled={updating}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-indigo-600 px-4 py-2 text-xs font-black uppercase tracking-wider text-white shadow-md shadow-indigo-500/30 transition-transform active:scale-95 disabled:opacity-50"
          >
            <RefreshCw size={13} className={updating ? 'animate-spin' : ''} />
            {updating ? 'Atualizando…' : 'Atualizar agora'}
          </button>
        </div>
      </div>
    </aside>
  );
};

export default PWAUpdatePrompt;
