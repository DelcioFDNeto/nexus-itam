// src/components/terms/SignedCopyViewer.jsx
import React, { useEffect, useState } from 'react';
import { Download, FileCheck2 } from 'lucide-react';
import { downloadBlob, loadSignedCopy } from '../../services/termFileService';
import { renderPdfPages } from '../../services/termScanService';
import { TermModalFrame } from './termUi';

const MAX_PREVIEW_PAGES = 10;

const toDate = (value) => (typeof value?.toDate === 'function' ? value.toDate() : value instanceof Date ? value : null);

const sizeLabel = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

const canvasToUrl = (canvas) =>
  new Promise((resolve) => canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : ''), 'image/png'));

/**
 * Mostra o termo assinado dentro do app (PDF renderizado em paginas, ou a
 * foto) — sem abrir blob em outra aba, que a CSP do app bloquearia para PDF.
 */
const SignedCopyViewer = ({ term, onClose }) => {
  const copy = term.signedCopy;
  const [state, setState] = useState({ loading: true, pages: [], blob: null, error: '', truncated: false });

  useEffect(() => {
    let active = true;
    let urls = [];
    (async () => {
      try {
        const blob = await loadSignedCopy(copy);
        let truncated = false;
        if (blob.type === 'application/pdf') {
          const { canvases, numPages } = await renderPdfPages(await blob.arrayBuffer(), { width: 1100, maxPages: MAX_PREVIEW_PAGES });
          urls = await Promise.all(canvases.map(canvasToUrl));
          truncated = numPages > MAX_PREVIEW_PAGES;
        } else {
          urls = [URL.createObjectURL(blob)];
        }
        if (active) setState({ loading: false, pages: urls, blob, error: '', truncated });
        else urls.forEach((u) => URL.revokeObjectURL(u));
      } catch (error) {
        console.error('Falha ao abrir o termo assinado:', error);
        if (active) setState({ loading: false, pages: [], blob: null, error: error.message || 'Não foi possível abrir o arquivo.', truncated: false });
      }
    })();
    return () => {
      active = false;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [copy]);

  const uploadedAt = toDate(copy?.uploadedAt);

  return (
    <TermModalFrame
      icon={FileCheck2}
      wide
      title={`Termo assinado · ${term.number}`}
      subtitle={[copy?.name, copy?.size ? sizeLabel(copy.size) : '', copy?.uploadedByName && `anexado por ${copy.uploadedByName}`, uploadedAt && `em ${uploadedAt.toLocaleDateString('pt-BR')}`].filter(Boolean).join(' · ')}
      onClose={onClose}
      footer={
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => state.blob && downloadBlob(state.blob, copy?.name || `${term.number}.pdf`)}
            disabled={!state.blob}
            className="min-h-[44px] px-5 py-3 rounded-xl bg-brand hover:bg-brand-dark text-brand-fg text-xs font-black uppercase tracking-wider flex items-center gap-2 shadow-sm transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download size={15} aria-hidden="true" /> Baixar arquivo
          </button>
        </div>
      }
    >
      {state.loading ? (
        <p role="status" className="py-16 text-center text-sm text-slate-500 dark:text-zinc-400">Carregando o termo assinado…</p>
      ) : state.error ? (
        <p role="alert" className="py-16 text-center text-sm font-bold text-rose-600 dark:text-rose-400">{state.error}</p>
      ) : (
        <div className="space-y-3">
          {state.pages.map((url, index) => (
            <img
              key={url}
              src={url}
              alt={`${term.number} — página ${index + 1}`}
              className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-white"
            />
          ))}
          {state.truncated && (
            <p className="text-center text-xs text-slate-500 dark:text-zinc-400 tabular-nums">
              Mostrando as {MAX_PREVIEW_PAGES} primeiras páginas. Baixe o arquivo para ver todas.
            </p>
          )}
        </div>
      )}
    </TermModalFrame>
  );
};

export default SignedCopyViewer;
