// src/components/settings/AssetCatalogSection.jsx
import React from 'react';
import { Database, Plus, Trash2 } from 'lucide-react';
import AssetTypeManager from './AssetTypeManager';
import { Card, SectionHeader } from './settingsUi';
import { buttonPrimaryClass, inputClass } from './settingsStyles';

/** Campos e tipos de ativo proprios da empresa. */
const AssetCatalogSection = ({ config, set }) => {
  const fields = config.customFields || [];
  const add = () => set('customFields', [...fields, { id: `cf_${Date.now()}`, label: '', type: 'text' }]);
  const update = (index, key, value) => set('customFields', fields.map((cf, i) => (i === index ? { ...cf, [key]: value } : cf)));
  const remove = (index) => set('customFields', fields.filter((_, i) => i !== index));

  return (
    <div className="space-y-6">
      <SectionHeader icon={Database} title="Cadastro de ativos" description="Campos extras no formulário de ativo e tipos de equipamento próprios da empresa." />

      <Card
        icon={Database}
        title="Campos personalizados"
        subtitle="Aparecem no formulário de todos os ativos"
        action={
          <button type="button" onClick={add} className={`${buttonPrimaryClass} min-h-[44px] px-3 py-2 text-xs`}>
            <Plus size={14} aria-hidden="true" /> Campo
          </button>
        }
      >
        <div className="space-y-2">
          {fields.map((cf, idx) => (
            <div key={cf.id} className="flex flex-wrap sm:flex-nowrap items-center gap-2 bg-slate-50 dark:bg-zinc-900/60 p-2.5 border border-slate-200 dark:border-zinc-800 rounded-xl">
              <label htmlFor={`cf-label-${cf.id}`} className="sr-only">Nome do campo customizado {idx + 1}</label>
              <input
                id={`cf-label-${cf.id}`}
                name={`cf-label-${cf.id}`}
                value={cf.label}
                onChange={(e) => update(idx, 'label', e.target.value)}
                placeholder="Nome do campo"
                className={`${inputClass} flex-1 min-w-[160px]`}
              />
              <label htmlFor={`cf-type-${cf.id}`} className="sr-only">Tipo do campo customizado {idx + 1}</label>
              <select
                id={`cf-type-${cf.id}`}
                name={`cf-type-${cf.id}`}
                value={cf.type}
                onChange={(e) => update(idx, 'type', e.target.value)}
                className={`${inputClass} sm:w-44`}
              >
                <option value="text">Texto curto</option>
                <option value="textarea">Texto longo</option>
                <option value="date">Data</option>
                <option value="number">Número</option>
              </select>
              <button
                type="button"
                onClick={() => remove(idx)}
                aria-label={`Remover campo ${cf.label || idx + 1}`}
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40 rounded-xl transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </div>
          ))}
          {fields.length === 0 && <p className="text-xs text-center text-slate-500 dark:text-zinc-400 font-medium py-2">Nenhum campo personalizado.</p>}
        </div>
      </Card>

      <Card icon={Database} title="Tipos de equipamento" subtitle="Somam-se aos tipos padrão (Notebook, Computador, Celular…)">
        <AssetTypeManager types={config.assetTypes || []} onChange={(assetTypes) => set('assetTypes', assetTypes)} />
      </Card>
    </div>
  );
};

export default AssetCatalogSection;
