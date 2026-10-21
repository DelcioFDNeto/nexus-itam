// src/components/settings/AssetCatalogSection.jsx
import React from 'react';
import { Database, Plus, Trash2 } from 'lucide-react';
import AssetTypeManager from './AssetTypeManager';
import { Card, SectionHeader } from './settingsUi';

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
          <button type="button" onClick={add} className="text-[10px] flex items-center gap-1 bg-brand text-white px-2.5 py-1.5 rounded-lg font-bold hover:bg-brand-dark transition-colors disabled:opacity-50">
            <Plus size={12} /> Campo
          </button>
        }
      >
        <div className="space-y-2">
          {fields.map((cf, idx) => (
            <div key={cf.id} className="flex items-center gap-2 bg-gray-50 dark:bg-slate-900 p-2 border border-gray-200 dark:border-slate-700 rounded-lg">
              <input
                value={cf.label}
                onChange={(e) => update(idx, 'label', e.target.value)}
                placeholder="Nome do campo"
                aria-label="Nome do campo customizado"
                className="flex-1 min-w-0 p-1.5 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded text-xs font-bold text-gray-800 dark:text-gray-100 focus:border-brand focus:outline-none"
              />
              <select
                value={cf.type}
                onChange={(e) => update(idx, 'type', e.target.value)}
                aria-label="Tipo do campo customizado"
                className="p-1.5 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded text-xs font-bold text-gray-600 dark:text-gray-300 focus:border-brand focus:outline-none"
              >
                <option value="text">Texto curto</option>
                <option value="textarea">Texto longo</option>
                <option value="date">Data</option>
                <option value="number">Número</option>
              </select>
              <button type="button" onClick={() => remove(idx)} aria-label="Remover campo" className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 rounded transition-colors">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {fields.length === 0 && <p className="text-xs text-center text-gray-400 dark:text-gray-500 font-medium py-2">Nenhum campo personalizado.</p>}
        </div>
      </Card>

      <Card icon={Database} title="Tipos de equipamento" subtitle="Somam-se aos tipos padrão (Notebook, Computador, Celular...)">
        <AssetTypeManager types={config.assetTypes || []} onChange={(assetTypes) => set('assetTypes', assetTypes)} />
      </Card>
    </div>
  );
};

export default AssetCatalogSection;
