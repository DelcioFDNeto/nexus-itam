// src/components/settings/AssetTypeManager.jsx
import React, { useState } from 'react';
import { Boxes, Plus, Trash2 } from 'lucide-react';
import { ASSET_TYPES, SPEC_FIELDS } from '../../utils/assetTypes';
import { buttonPrimaryClass, inputClass } from './settingsStyles';

/**
 * Tipos de equipamento proprios da empresa, somados ao catalogo base.
 *
 * Modelo hibrido: o catalogo base traz icone, cor e campos tecnicos definidos;
 * os tipos criados aqui recebem o icone generico, mas podem declarar quais
 * campos tecnicos exibem no cadastro do ativo.
 */
const AssetTypeManager = ({ types = [], onChange }) => {
  const [draft, setDraft] = useState('');

  const baseIds = new Set(ASSET_TYPES.map((t) => t.id.toLowerCase()));
  const customIds = new Set(types.map((t) => t.id.toLowerCase()));

  const add = () => {
    const label = draft.trim();
    if (!label) return;
    if (baseIds.has(label.toLowerCase())) return; // ja existe no catalogo base
    if (customIds.has(label.toLowerCase())) return;
    onChange([...types, { id: label, label, specs: [] }]);
    setDraft('');
  };

  const toggleSpec = (index, field) => {
    const next = types.map((t, i) => {
      if (i !== index) return t;
      const specs = t.specs || [];
      return { ...t, specs: specs.includes(field) ? specs.filter((f) => f !== field) : [...specs, field] };
    });
    onChange(next);
  };

  const remove = (index) => onChange(types.filter((_, i) => i !== index));

  const duplicado = draft.trim() && (baseIds.has(draft.trim().toLowerCase()) || customIds.has(draft.trim().toLowerCase()));

  return (
    <div className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900/60 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Boxes size={16} className="text-brand-aa" aria-hidden="true" />
        <h3 className="text-xs font-black text-slate-800 dark:text-[#fafafa] uppercase">Tipos de Equipamento</h3>
        <span className="ml-auto text-xs font-bold text-slate-500 dark:text-zinc-400 tabular-nums">
          {ASSET_TYPES.length} base + {types.length}
        </span>
      </div>

      <p className="text-xs leading-relaxed text-slate-600 dark:text-zinc-400">
        O catálogo base já cobre computadores, mobilidade, impressão, infraestrutura e apoio. Use este espaço para
        tipos específicos do seu negócio.
      </p>

      <div className="flex flex-wrap gap-1.5">
        {ASSET_TYPES.map((t) => (
          <span
            key={t.id}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] px-2.5 py-1 text-xs font-bold text-slate-600 dark:text-zinc-300"
          >
            <t.icon size={12} className={t.tone} aria-hidden="true" />
            {t.label}
          </span>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <label htmlFor="custom-asset-type-draft" className="sr-only">Novo tipo de equipamento</label>
        <input
          id="custom-asset-type-draft"
          name="custom-asset-type-draft"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Novo tipo (ex: Coletor de dados)"
          className={`${inputClass} flex-1 min-w-[180px]`}
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim() || duplicado}
          className={`${buttonPrimaryClass} min-h-[44px] text-xs uppercase`}
        >
          <Plus size={14} aria-hidden="true" /> Adicionar
        </button>
      </div>

      {duplicado && (
        <p className="text-xs font-bold text-amber-600 dark:text-amber-400">Este tipo já existe.</p>
      )}

      {types.length > 0 && (
        <div className="space-y-2">
          {types.map((t, idx) => (
            <div
              key={t.id}
              className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-3 shadow-sm"
            >
              <div className="flex items-center gap-2">
                <span className="flex-1 text-sm font-bold text-slate-900 dark:text-[#fafafa]">{t.label}</span>
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                  aria-label={`Remover ${t.label}`}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {Object.entries(SPEC_FIELDS).map(([field, def]) => {
                  const on = (t.specs || []).includes(field);
                  return (
                    <button
                      key={field}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleSpec(idx, field)}
                      className={`min-h-[44px] rounded-full border px-3.5 text-xs font-bold transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                        on
                          ? 'border-brand bg-brand text-brand-fg'
                          : 'border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:border-brand/50'
                      }`}
                    >
                      {def.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AssetTypeManager;
