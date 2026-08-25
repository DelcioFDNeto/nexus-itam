// src/components/settings/LocationManager.jsx
import React, { useState } from 'react';
import { MapPin, Plus, Trash2, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  addLocation,
  deleteLocation,
  groupLocations,
  updateLocation,
  seedLocations,
  LEGACY_LOCATIONS,
  STARTER_LOCATIONS,
} from '../../services/locationService';
import { useLocations } from '../../hooks/useLocations';

/**
 * CRUD de filiais e locais fisicos do inquilino.
 *
 * Substitui a lista fixa que estava escrita no JSX de quatro telas com as
 * filiais da Shineray — que toda empresa nova do SaaS herdava.
 */
const LocationManager = () => {
  const { locations, loading, reload, tenantId } = useLocations();
  const [draft, setDraft] = useState({ name: '', region: '' });
  const [busy, setBusy] = useState(false);

  const groups = groupLocations(locations);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!draft.name.trim()) return;
    setBusy(true);
    try {
      await addLocation({ ...draft, tenantId });
      setDraft({ name: '', region: draft.region });
      await reload();
      toast.success('Local adicionado.');
    } catch (error) {
      console.error(error);
      toast.error(error.message || 'Erro ao adicionar local.');
    } finally {
      setBusy(false);
    }
  };

  const handleRename = async (loc, field, value) => {
    if (value === loc[field]) return;
    try {
      await updateLocation(loc.id, { [field]: value });
      await reload();
    } catch (error) {
      console.error(error);
      toast.error('Erro ao salvar o local.');
    }
  };

  const handleDelete = async (loc) => {
    // Ativos guardam o nome do local; apagar aqui nao apaga o historico deles.
    if (!confirm(`Remover "${loc.name}"? Os ativos que já apontam para este local mantêm o nome registrado.`)) return;
    try {
      await deleteLocation(loc.id);
      await reload();
      toast.success('Local removido.');
    } catch (error) {
      console.error(error);
      toast.error('Erro ao remover.');
    }
  };

  const handleSeed = async (preset, rotulo) => {
    setBusy(true);
    try {
      const added = await seedLocations(tenantId, preset);
      await reload();
      toast.success(added ? `${added} locais de ${rotulo} importados.` : 'Nada novo a importar.');
    } catch (error) {
      console.error(error);
      toast.error('Erro ao importar locais.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-600 bg-gray-50 dark:bg-slate-900 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <MapPin size={16} className="text-brand" />
        <h3 className="text-xs font-black text-gray-700 dark:text-gray-200 uppercase">Filiais & Locais</h3>
        <span className="ml-auto text-[10px] font-bold text-gray-400 tabular-nums">{locations.length}</span>
      </div>

      <form onSubmit={handleAdd} className="flex flex-wrap gap-2">
        <input
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="Nome do local (ex: Matriz)"
          className="flex-1 min-w-[150px] p-2 border dark:border-slate-700 dark:bg-slate-800 rounded-lg text-xs font-bold text-gray-800 dark:text-gray-100 focus:border-brand focus:outline-none"
        />
        <input
          value={draft.region}
          onChange={(e) => setDraft({ ...draft, region: e.target.value })}
          placeholder="Região (opcional)"
          className="w-36 p-2 border dark:border-slate-700 dark:bg-slate-800 rounded-lg text-xs text-gray-600 dark:text-gray-300 focus:border-brand focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !draft.name.trim()}
          className="flex items-center gap-1 bg-brand text-white px-3 py-2 rounded-lg text-[10px] font-black uppercase disabled:opacity-50"
        >
          <Plus size={12} /> Adicionar
        </button>
      </form>

      {loading ? (
        <p className="flex items-center justify-center gap-2 py-4 text-xs text-gray-400">
          <Loader2 size={14} className="animate-spin" /> Carregando…
        </p>
      ) : locations.length === 0 ? (
        <div className="py-3 text-center space-y-3">
          <p className="text-xs font-medium text-gray-400 dark:text-gray-500">
            Nenhum local cadastrado. Os seletores de localização ficam vazios até você criar o primeiro.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => handleSeed(STARTER_LOCATIONS, 'exemplo')}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-slate-600 px-3 py-1.5 text-[10px] font-black uppercase text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-slate-800 disabled:opacity-50"
            >
              <Download size={12} /> Locais de exemplo
            </button>
            <button
              type="button"
              onClick={() => handleSeed(LEGACY_LOCATIONS, 'Shineray')}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-slate-600 px-3 py-1.5 text-[10px] font-black uppercase text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-slate-800 disabled:opacity-50"
            >
              <Download size={12} /> Filiais legadas
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 max-h-72 overflow-y-auto custom-scrollbar pr-1">
          {groups.map(({ region, items }) => (
            <div key={region}>
              <p className="mb-1 px-1 text-[10px] font-black uppercase tracking-wider text-gray-400">{region}</p>
              <div className="space-y-1.5">
                {items.map((loc) => (
                  <div
                    key={loc.id}
                    className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 p-1.5 shadow-sm"
                  >
                    <input
                      defaultValue={loc.name}
                      onBlur={(e) => handleRename(loc, 'name', e.target.value)}
                      className="flex-1 min-w-0 rounded p-1 text-xs font-bold text-gray-800 dark:text-gray-100 bg-transparent focus:bg-gray-50 dark:focus:bg-slate-900 focus:outline-none"
                    />
                    <input
                      defaultValue={loc.region}
                      onBlur={(e) => handleRename(loc, 'region', e.target.value)}
                      className="w-28 shrink-0 rounded p-1 text-[11px] text-gray-500 dark:text-gray-400 bg-transparent focus:bg-gray-50 dark:focus:bg-slate-900 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => handleDelete(loc)}
                      className="shrink-0 rounded p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
                      aria-label={`Remover ${loc.name}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default LocationManager;
