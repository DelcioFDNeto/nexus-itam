// src/components/terms/AssetTermsCard.jsx
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileCheck2, FileSignature, Printer, RefreshCcw } from 'lucide-react';
import { listTermsForAsset } from '../../services/termService';
import { isGatewayActiveSession, microservicesApi } from '../../services/microservicesClient';
import { useTermPrinter } from '../../hooks/useTermPrinter';
import { TermKindTag, TermStatusBadge } from './termUi';
import SignedCopyViewer from './SignedCopyViewer';

/**
 * Termos em que o ativo aparece (responsabilidade, devolucao, transferencia),
 * do mais recente ao mais antigo. `refreshKey` recarrega apos uma emissao.
 */
const AssetTermsCard = ({ tenantId, assetId, refreshKey }) => {
  const { printTerm } = useTermPrinter();
  const [reloadCount, setReloadCount] = useState(0);
  const [state, setState] = useState({ key: null, terms: [], error: false });
  const [viewing, setViewing] = useState(null);
  const requestKey = `${tenantId}:${assetId}:${refreshKey}:${reloadCount}`;

  useEffect(() => {
    if (!tenantId || !assetId) return undefined;
    let active = true;

    if (isGatewayActiveSession()) {
      microservicesApi
        .listTerms()
        .then((res) => {
          if (!active) return;
          const matching = (res.items || [])
            .filter((t) => {
              const snap = Array.isArray(t.assets_snapshot) ? t.assets_snapshot : [];
              return snap.some((item) => item.id === assetId || item.internalId === assetId);
            })
            .map((t) => ({
              id: t.id,
              number: `TR-CLT-${t.id.slice(0, 8).toUpperCase()}`,
              kind: t.term_type || 'responsabilidade',
              status: t.status === 'signed' ? 'assinado' : 'pendente',
              issuedAtDate: t.created_at ? new Date(t.created_at) : new Date(),
              employeeName: t.employee_name,
              documentHash: t.document_hash,
            }));
          setState({ key: requestKey, terms: matching, error: false });
        })
        .catch(() => {
          if (active) setState({ key: requestKey, terms: [], error: false });
        });
      return () => {
        active = false;
      };
    }

    listTermsForAsset(tenantId, assetId)
      .then((terms) => active && setState({ key: requestKey, terms, error: false }))
      .catch((error) => {
        console.error('Falha ao carregar termos do ativo:', error);
        if (active) setState({ key: requestKey, terms: [], error: true });
      });
    return () => {
      active = false;
    };
  }, [tenantId, assetId, requestKey]);

  const loading = state.key !== requestKey;

  return (
    <div className="bg-white dark:bg-[#111113] rounded-xl p-6 border border-slate-200/80 dark:border-zinc-800 shadow-sm">
      <h3 className="text-lg font-bold text-slate-900 dark:text-[#fafafa] mb-4 flex items-center gap-2">
        <FileSignature size={20} aria-hidden="true" /> Termos e documentos
      </h3>
      {loading ? (
        <p role="status" className="text-sm text-slate-500 dark:text-zinc-400">Carregando…</p>
      ) : state.error ? (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-semibold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
          <span>Não foi possível carregar os termos.</span>
          <button
            type="button"
            onClick={() => setReloadCount((c) => c + 1)}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
          >
            <RefreshCcw size={13} aria-hidden="true" /> Tentar novamente
          </button>
        </div>
      ) : state.terms.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-zinc-400 italic">Nenhum termo emitido para este ativo.</p>
      ) : (
        <ul className="space-y-2">
          {state.terms.slice(0, 8).map((term) => (
            <li key={term.id} className="flex items-center gap-2 rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900/70 px-3 py-2.5">
              <Link
                to={`/termos/${term.id}`}
                className="min-w-0 flex-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <p className="font-mono text-sm font-black text-slate-900 dark:text-[#fafafa] tabular-nums">{term.number}</p>
                <div className="flex flex-wrap items-center gap-2 mt-0.5">
                  <TermKindTag kind={term.kind} />
                  <span className="text-xs text-slate-500 dark:text-zinc-400 tabular-nums">
                    {term.issuedAtDate ? term.issuedAtDate.toLocaleDateString('pt-BR') : ''}
                  </span>
                </div>
              </Link>
              <TermStatusBadge status={term.status} />
              {term.signedCopy && (
                <button
                  type="button"
                  onClick={() => setViewing(term)}
                  aria-label={`Ver ${term.number} assinado`}
                  title="Ver termo assinado"
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-emerald-600 dark:text-emerald-400 hover:bg-white dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  <FileCheck2 size={16} aria-hidden="true" />
                </button>
              )}
              <button
                type="button"
                onClick={() => printTerm(term)}
                aria-label={`Imprimir ${term.number}`}
                title="Imprimir"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 dark:text-zinc-400 hover:text-brand-aa hover:bg-white dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <Printer size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {viewing && <SignedCopyViewer term={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
};

export default AssetTermsCard;
