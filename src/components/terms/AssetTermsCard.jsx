// src/components/terms/AssetTermsCard.jsx
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileSignature, Printer } from 'lucide-react';
import { listTermsForAsset } from '../../services/termService';
import { useTermPrinter } from '../../hooks/useTermPrinter';
import { TermKindTag, TermStatusBadge } from './termUi';

/**
 * Termos em que o ativo aparece (responsabilidade, devolucao, transferencia),
 * do mais recente ao mais antigo. `refreshKey` recarrega apos uma emissao.
 */
const AssetTermsCard = ({ tenantId, assetId, refreshKey }) => {
  const { printTerm } = useTermPrinter();
  const [state, setState] = useState({ key: null, terms: [], error: false });
  const requestKey = `${tenantId}:${assetId}:${refreshKey}`;

  useEffect(() => {
    if (!tenantId || !assetId) return undefined;
    let active = true;
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
    <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 border border-gray-100 dark:border-slate-700 shadow-sm">
      <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
        <FileSignature size={20} /> Termos e documentos
      </h3>
      {loading ? (
        <p className="text-sm text-gray-400">Carregando…</p>
      ) : state.error ? (
        <p className="text-sm text-gray-400">Não foi possível carregar os termos.</p>
      ) : state.terms.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 italic">Nenhum termo emitido para este ativo.</p>
      ) : (
        <ul className="space-y-2">
          {state.terms.slice(0, 8).map((term) => (
            <li key={term.id} className="flex items-center gap-3 rounded-2xl border border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-900 px-3 py-2.5">
              <Link to={`/termos/${term.id}`} className="min-w-0 flex-1">
                <p className="font-mono text-sm font-black text-gray-900 dark:text-white">{term.number}</p>
                <div className="flex flex-wrap items-center gap-2 mt-0.5">
                  <TermKindTag kind={term.kind} />
                  <span className="text-[10px] text-gray-400">{term.issuedAtDate ? term.issuedAtDate.toLocaleDateString('pt-BR') : ''}</span>
                </div>
              </Link>
              <TermStatusBadge status={term.status} />
              <button
                type="button"
                onClick={() => printTerm(term)}
                aria-label={`Imprimir ${term.number}`}
                title="Imprimir"
                className="p-2 rounded-lg text-gray-400 hover:text-brand hover:bg-white dark:hover:bg-slate-800"
              >
                <Printer size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default AssetTermsCard;
