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
        className="dark fixed top-3 right-3 z-50 safe-area-pt animate-fade-in"
      >
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-1 rounded-xl border border-zinc-800 bg-[#111113] p-1 text-[#fafafa] shadow-lg"
        >
          <button
            type="button"
            onClick={handleUpdate}
            disabled={updating}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-[#fafafa] transition-colors hover:bg-[#18181b] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <span className="h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden="true" />
            <RefreshCw size={14} aria-hidden="true" className={updating ? 'animate-spin' : ''} />
            <span>{updating ? 'Atualizando…' : 'Atualização pendente · Atualizar'}</span>
          </button>
          <button
            type="button"
            onClick={() => setBannerDismissed(false)}
            aria-label="Expandir aviso de atualização"
            title="Expandir aviso de atualização"
            data-icon-button="true"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-[#18181b] hover:text-[#fafafa] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <ArrowUpCircle size={16} aria-hidden="true" />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Atualização disponível"
      className="dark fixed inset-x-3 bottom-20 z-50 sm:bottom-4 sm:left-auto sm:right-4 sm:w-96 animate-fade-in"
    >
      <div
        role="status"
        aria-live="polite"
        className="rounded-xl border border-zinc-800 bg-[#111113] p-4 text-[#fafafa] shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-fg shadow-sm"
            >
              <ArrowUpCircle size={18} aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-xs sm:text-sm font-bold text-[#fafafa]">
                Nova versão disponível
              </h2>
              <p className="mt-0.5 text-xs text-zinc-300">
                Uma nova versão do sistema está pronta. Atualize agora para carregar as melhorias.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setBannerDismissed(true)}
            aria-label="Dispensar aviso"
            title="Dispensar aviso"
            data-icon-button="true"
            className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-[#18181b] hover:text-[#fafafa] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="mt-3 flex items-center justify-end gap-2 border-t border-zinc-800 pt-3">
          <button
            type="button"
            onClick={() => setBannerDismissed(true)}
            className="min-h-[44px] rounded-lg px-3.5 py-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-[#18181b] hover:text-[#fafafa] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            Depois
          </button>
          <button
            type="button"
            onClick={handleUpdate}
            disabled={updating}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-brand-fg shadow-sm transition-colors hover:bg-brand-dark active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-[#111113] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw size={14} aria-hidden="true" className={updating ? 'animate-spin' : ''} />
            <span>{updating ? 'Atualizando…' : 'Atualizar agora'}</span>
          </button>
        </div>
      </div>
    </aside>
  );
};

export default PWAUpdatePrompt;
