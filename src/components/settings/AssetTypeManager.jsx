// src/components/settings/AssetTypeManager.jsx
import React, { useState } from 'react';
import { Boxes, Plus, Trash2 } from 'lucide-react';
import { ASSET_TYPES, SPEC_FIELDS } from '../../utils/assetTypes';

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
    <div className="rounded-xl border border-gray-200 dark:border-slate-600 bg-gray-50 dark:bg-slate-900 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Boxes size={16} className="text-brand" />
        <h3 className="text-xs font-black text-gray-700 dark:text-gray-200 uppercase">Tipos de Equipamento</h3>
        <span className="ml-auto text-[10px] font-bold text-gray-400 tabular-nums">
          {ASSET_TYPES.length} base + {types.length}
        </span>
      </div>

      <p className="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
        O catálogo base já cobre computadores, mobilidade, impressão, infraestrutura e apoio. Use este espaço para
        tipos específicos do seu negócio.
      </p>

      <div className="flex flex-wrap gap-1.5">
        {ASSET_TYPES.map((t) => (
          <span
            key={t.id}
            className="inline-flex items-center gap-1 rounded-full border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-gray-500 dark:text-gray-400"
          >
            <t.icon size={11} className={t.tone} />
            {t.label}
          </span>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Novo tipo (ex: Coletor de dados)"
          className="flex-1 min-w-[170px] p-2 border dark:border-slate-700 dark:bg-slate-800 rounded-lg text-xs font-bold text-gray-800 dark:text-gray-100 focus:border-brand focus:outline-none"
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim() || duplicado}
          className="flex items-center gap-1 bg-brand text-white px-3 py-2 rounded-lg text-[10px] font-black uppercase disabled:opacity-50"
        >
          <Plus size={12} /> Adicionar
        </button>
      </div>

      {duplicado && (
        <p className="text-[11px] font-bold text-amber-600 dark:text-amber-500">Este tipo já existe.</p>
      )}

      {types.length > 0 && (
        <div className="space-y-2">
          {types.map((t, idx) => (
            <div
              key={t.id}
              className="rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 p-2.5 shadow-sm"
            >
              <div className="flex items-center gap-2">
                <span className="flex-1 text-xs font-bold text-gray-800 dark:text-gray-100">{t.label}</span>
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  className="rounded p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
                  aria-label={`Remover ${t.label}`}
                >
                  <Trash2 size={14} />
                </button>
              </div>

              <div className="mt-2 flex flex-wrap gap-1">
                {Object.entries(SPEC_FIELDS).map(([field, def]) => {
                  const on = (t.specs || []).includes(field);
                  return (
                    <button
                      key={field}
                      type="button"
                      onClick={() => toggleSpec(idx, field)}
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-bold transition-colors ${
                        on
                          ? 'border-brand bg-brand text-white'
                          : 'border-gray-200 dark:border-slate-600 text-gray-500 dark:text-gray-400 hover:border-brand/50'
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
