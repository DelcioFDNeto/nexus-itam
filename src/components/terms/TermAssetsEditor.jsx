// src/components/terms/TermAssetsEditor.jsx
import React, { useId, useMemo, useState } from 'react';
import { AlertTriangle, Plus, Search, Trash2 } from 'lucide-react';
import { useAssets } from '../../hooks/useAssets';
import { isRetired } from '../../utils/assetStatus';
import { ASSET_CONDITIONS, MAX_TERM_ASSETS } from '../../utils/terms';
import AssetIcon from '../AssetIcon';
import { SectionTitle } from './termUi';
import { fieldClass } from './termStyles';

const norm = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** Busca no inventario da empresa. So monta (e assina o inventario) quando aberto. */
const AssetSearch = ({ selectedIds, filter, blockReason, onPick }) => {
  const { assets, loading } = useAssets();
  const [term, setTerm] = useState('');
  const searchInputId = useId();

  const matches = useMemo(() => {
    const q = norm(term.trim());
    return assets
      .filter((a) => !selectedIds.has(a.id) && !isRetired(a.status) && (!filter || filter(a)))
      .filter((a) => !q || norm(`${a.internalId} ${a.model} ${a.serialNumber} ${a.assignedTo} ${a.location}`).includes(q))
      .slice(0, 8);
  }, [assets, term, selectedIds, filter]);

  return (
    <div className="rounded-2xl border border-brand/30 bg-brand/5 dark:bg-brand/10 p-3 space-y-2">
      <div className="relative">
        <label htmlFor={searchInputId} className="sr-only">
          Buscar ativo para adicionar
        </label>
        <Search size={14} className="absolute left-3 top-3.5 text-slate-400 dark:text-zinc-500 pointer-events-none" aria-hidden="true" />
        <input
          id={searchInputId}
          name="assetSearch"
          autoFocus
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Patrimônio, modelo, série, responsável ou local…"
          aria-label="Buscar ativo para adicionar"
          className={`${fieldClass} pl-9`}
        />
      </div>
      {loading ? (
        <p role="status" className="text-xs text-slate-500 dark:text-zinc-400 px-1">Carregando inventário…</p>
      ) : matches.length === 0 ? (
        <p className="text-xs text-slate-500 dark:text-zinc-400 px-1">Nenhum ativo disponível com esse filtro.</p>
      ) : (
        <ul className="space-y-1">
          {matches.map((asset) => {
            const blocked = blockReason?.(asset);
            return (
              <li key={asset.id}>
                <button
                  type="button"
                  disabled={Boolean(blocked)}
                  onClick={() => onPick(asset)}
                  className="w-full min-h-[44px] flex items-center gap-3 rounded-xl px-3 py-2 text-left bg-white dark:bg-[#111113] border border-slate-200/70 dark:border-zinc-800 hover:border-brand/40 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <AssetIcon type={asset.type} category={asset.category} model={asset.model} internalId={asset.internalId} size={16} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-slate-900 dark:text-[#fafafa] truncate">{asset.model || asset.internalId}</span>
                    <span className="block text-xs text-slate-500 dark:text-zinc-400 truncate">
                      {[asset.internalId, asset.location, asset.assignedTo].filter(Boolean).join(' · ')}
                      {blocked ? ` — ${blocked}` : ''}
                    </span>
                  </span>
                  {!blocked && <Plus size={14} className="text-brand-aa shrink-0" aria-hidden="true" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

/**
 * Itens do termo: lista com o estado de cada equipamento, remocao e busca
 * para incluir outros ativos.
 */
const TermAssetsEditor = ({
  assets,
  onChange,
  conditions,
  onConditionsChange,
  conditionLabel = 'Estado',
  filter,
  blockReason,
  emptyText = 'Nenhum ativo selecionado.',
}) => {
  const [searching, setSearching] = useState(false);
  const conditionIdPrefix = useId();
  const selectedIds = useMemo(() => new Set(assets.map((a) => a.id)), [assets]);
  const full = assets.length >= MAX_TERM_ASSETS;

  const add = (asset) => {
    if (full) return;
    onChange([...assets, asset]);
  };

  const remove = (id) => onChange(assets.filter((a) => a.id !== id));

  return (
    <div>
      <SectionTitle
        aside={
          <button
            type="button"
            onClick={() => setSearching((v) => !v)}
            disabled={full}
            className="min-h-[44px] px-2.5 rounded-xl text-xs font-bold uppercase tracking-wider text-brand-aa hover:bg-brand/10 flex items-center gap-1 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-40"
          >
            <Plus size={13} aria-hidden="true" /> {searching ? 'Fechar busca' : 'Adicionar ativos'}
          </button>
        }
      >
        <span className="tabular-nums">Itens ({assets.length})</span>
      </SectionTitle>

      {searching && (
        <div className="mb-3">
          <AssetSearch selectedIds={selectedIds} filter={filter} blockReason={blockReason} onPick={add} />
        </div>
      )}

      {assets.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-200 dark:border-zinc-800 py-6 text-center text-sm text-slate-500 dark:text-zinc-400">
          {emptyText}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-zinc-800 rounded-2xl border border-slate-200 dark:border-zinc-800 overflow-hidden">
          {assets.map((asset) => {
            const blocked = blockReason?.(asset);
            return (
              <li
                key={asset.id}
                className={`flex items-center gap-3 px-3 py-2.5 ${
                  blocked ? 'bg-rose-50 dark:bg-rose-950/20' : 'bg-white dark:bg-[#111113]'
                }`}
              >
                <AssetIcon type={asset.type} category={asset.category} model={asset.model} internalId={asset.internalId} size={18} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-900 dark:text-[#fafafa] truncate">{asset.model || '—'}</p>
                  <p className="text-xs text-slate-500 dark:text-zinc-400 truncate font-mono tabular-nums">
                    {asset.internalId}{asset.serialNumber ? ` · SN ${asset.serialNumber}` : ''}{asset.location ? ` · ${asset.location}` : ''}
                  </p>
                  {blocked && (
                    <p className="text-xs font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1 mt-0.5">
                      <AlertTriangle size={12} aria-hidden="true" /> Este ativo {blocked} — remova-o para continuar.
                    </p>
                  )}
                </div>
                {onConditionsChange && (
                  <>
                    <label htmlFor={`${conditionIdPrefix}-${asset.id}`} className="sr-only">
                      {conditionLabel} de {asset.internalId}
                    </label>
                    <select
                      id={`${conditionIdPrefix}-${asset.id}`}
                      name={`condition-${asset.id}`}
                      value={conditions?.[asset.id] || 'Bom'}
                      onChange={(e) => onConditionsChange({ ...conditions, [asset.id]: e.target.value })}
                      aria-label={`${conditionLabel} de ${asset.internalId}`}
                      title={conditionLabel}
                      className="shrink-0 min-h-[44px] rounded-lg border border-slate-200 bg-white hover:border-slate-300 active:border-slate-400 focus-visible:outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25 disabled:opacity-50 disabled:cursor-not-allowed aria-[invalid=true]:border-rose-500 aria-[invalid=true]:focus-visible:ring-rose-500/25 dark:border-zinc-800 dark:bg-[#111113] dark:hover:border-zinc-700 dark:text-[#fafafa] dark:[&_option]:bg-[#111113] dark:[&_option]:text-[#fafafa] px-2.5 py-1.5 text-xs font-bold text-slate-700 transition-colors"
                    >
                      {ASSET_CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => remove(asset.id)}
                  aria-label={`Remover ${asset.internalId}`}
                  className="shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                >
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default TermAssetsEditor;
