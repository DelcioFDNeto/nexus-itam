// src/components/terms/TermAssetsEditor.jsx
import React, { useMemo, useState } from 'react';
import { AlertTriangle, Plus, Search, Trash2 } from 'lucide-react';
import { useAssets } from '../../hooks/useAssets';
import { isRetired } from '../../utils/assetStatus';
import { ASSET_CONDITIONS, MAX_TERM_ASSETS } from '../../utils/terms';
import AssetIcon from '../AssetIcon';
import { SectionTitle } from './termUi';

const norm = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** Busca no inventario da empresa. So monta (e assina o inventario) quando aberto. */
const AssetSearch = ({ selectedIds, filter, blockReason, onPick }) => {
  const { assets, loading } = useAssets();
  const [term, setTerm] = useState('');

  const matches = useMemo(() => {
    const q = norm(term.trim());
    return assets
      .filter((a) => !selectedIds.has(a.id) && !isRetired(a.status) && (!filter || filter(a)))
      .filter((a) => !q || norm(`${a.internalId} ${a.model} ${a.serialNumber} ${a.assignedTo} ${a.location}`).includes(q))
      .slice(0, 8);
  }, [assets, term, selectedIds, filter]);

  return (
    <div className="rounded-2xl border border-brand/30 bg-brand/5 p-3 space-y-2">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-3 text-gray-400" />
        <input
          autoFocus
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Patrimônio, modelo, série, responsável ou local..."
          aria-label="Buscar ativo para adicionar"
          className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:border-brand"
        />
      </div>
      {loading ? (
        <p className="text-xs text-gray-400 px-1">Carregando inventário…</p>
      ) : matches.length === 0 ? (
        <p className="text-xs text-gray-400 px-1">Nenhum ativo disponível com esse filtro.</p>
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
                  className="w-full flex items-center gap-3 rounded-xl px-3 py-2 text-left bg-white dark:bg-slate-900 border border-transparent hover:border-brand/40 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <AssetIcon type={asset.type} category={asset.category} model={asset.model} internalId={asset.internalId} size={16} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-gray-900 dark:text-white truncate">{asset.model || asset.internalId}</span>
                    <span className="block text-[11px] text-gray-500 dark:text-gray-400 truncate">
                      {[asset.internalId, asset.location, asset.assignedTo].filter(Boolean).join(' · ')}
                      {blocked ? ` — ${blocked}` : ''}
                    </span>
                  </span>
                  {!blocked && <Plus size={14} className="text-brand shrink-0" />}
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
            className="text-[11px] font-black uppercase tracking-wider text-brand flex items-center gap-1 disabled:opacity-40"
          >
            <Plus size={12} /> {searching ? 'Fechar busca' : 'Adicionar ativos'}
          </button>
        }
      >
        Itens ({assets.length})
      </SectionTitle>

      {searching && (
        <div className="mb-3">
          <AssetSearch selectedIds={selectedIds} filter={filter} blockReason={blockReason} onPick={add} />
        </div>
      )}

      {assets.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-gray-200 dark:border-slate-700 py-6 text-center text-sm text-gray-400">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
          {assets.map((asset) => {
            const blocked = blockReason?.(asset);
            return (
              <li key={asset.id} className={`flex items-center gap-3 px-3 py-2.5 ${blocked ? 'bg-rose-50 dark:bg-rose-950/20' : 'bg-white dark:bg-slate-900'}`}>
                <AssetIcon type={asset.type} category={asset.category} model={asset.model} internalId={asset.internalId} size={18} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{asset.model || '—'}</p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate font-mono">
                    {asset.internalId}{asset.serialNumber ? ` · SN ${asset.serialNumber}` : ''}{asset.location ? ` · ${asset.location}` : ''}
                  </p>
                  {blocked && (
                    <p className="text-[11px] font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1">
                      <AlertTriangle size={11} /> Este ativo {blocked} — remova-o para continuar.
                    </p>
                  )}
                </div>
                {onConditionsChange && (
                  <select
                    value={conditions?.[asset.id] || 'Bom'}
                    onChange={(e) => onConditionsChange({ ...conditions, [asset.id]: e.target.value })}
                    aria-label={`${conditionLabel} de ${asset.internalId}`}
                    title={conditionLabel}
                    className="shrink-0 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5 text-xs font-bold text-gray-700 dark:text-gray-200 focus:outline-none focus:border-brand"
                  >
                    {ASSET_CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                )}
                <button
                  type="button"
                  onClick={() => remove(asset.id)}
                  aria-label={`Remover ${asset.internalId}`}
                  className="shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                >
                  <Trash2 size={14} />
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
