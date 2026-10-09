// src/components/settings/LocationManager.jsx
import React, { useState } from 'react';
import { ChevronDown, Download, Loader2, MapPin, Plus, Store, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  addLocation,
  deleteLocation,
  groupLocations,
  locationKind,
  LOCATION_KIND_ORDER,
  LOCATION_KINDS,
  updateLocation,
  seedLocations,
  STARTER_LOCATIONS,
} from '../../services/locationService';
import { useLocations } from '../../hooks/useLocations';

const KIND_BADGE = {
  matriz: 'bg-slate-900 text-white dark:bg-white dark:text-slate-900',
  loja: 'bg-brand/10 text-brand',
  deposito: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
  outro: 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-gray-300',
};

const fieldClass =
  'w-full rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1.5 text-xs text-gray-700 dark:text-gray-200 focus:border-brand focus:outline-none';

/**
 * CRUD de filiais e locais fisicos do inquilino.
 *
 * Substitui a lista fixa que estava escrita no JSX de quatro telas com as
 * filiais da primeira cliente — que toda empresa nova do SaaS herdava.
 * Cada local tem um tipo (matriz, loja, deposito): a matriz e a origem padrao
 * das transferencias, e endereco/responsavel da loja saem no termo de
 * transferencia e recebimento.
 */
const LocationManager = ({ showHeader = true }) => {
  const { locations, loading, reload, tenantId } = useLocations();
  const [draft, setDraft] = useState({ name: '', region: '', kind: 'loja' });
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(null);

  const groups = groupLocations(locations);
  const hasHeadquarters = locations.some((l) => locationKind(l) === 'matriz');

  const handleAdd = async (e) => {
    e?.preventDefault();
    if (!draft.name.trim()) return;
    setBusy(true);
    try {
      await addLocation({ ...draft, tenantId });
      setDraft({ name: '', region: draft.region, kind: draft.kind });
      await reload();
      toast.success('Local adicionado.');
    } catch (error) {
      console.error(error);
      toast.error(error.message || 'Erro ao adicionar local.');
    } finally {
      setBusy(false);
    }
  };

  const handleChange = async (loc, field, value) => {
    if (value === (loc[field] ?? '')) return;
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
      {showHeader && (
        <div className="flex items-center gap-2">
          <MapPin size={16} className="text-brand" />
          <h3 className="text-xs font-black text-gray-700 dark:text-gray-200 uppercase">Filiais & Locais</h3>
          <span className="ml-auto text-[10px] font-bold text-gray-400 tabular-nums">{locations.length}</span>
        </div>
      )}

      {/* div, e nao <form>: este bloco vive dentro do formulario de
          Configuracoes, e o submit do form aninhado disparava tambem o
          "Salvar Configuracoes" da pagina inteira. */}
      <div className="flex flex-wrap gap-2">
        <input
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd(e);
          }}
          placeholder="Nome do local (ex: Loja Centro)"
          aria-label="Nome do novo local"
          className="flex-1 min-w-[150px] p-2 border dark:border-slate-700 dark:bg-slate-800 rounded-lg text-xs font-bold text-gray-800 dark:text-gray-100 focus:border-brand focus:outline-none"
        />
        <select
          value={draft.kind}
          onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
          aria-label="Tipo do novo local"
          className="p-2 border dark:border-slate-700 dark:bg-slate-800 rounded-lg text-xs font-bold text-gray-600 dark:text-gray-300 focus:border-brand focus:outline-none"
        >
          {LOCATION_KIND_ORDER.map((kind) => (
            <option key={kind} value={kind}>{LOCATION_KINDS[kind].label}</option>
          ))}
        </select>
        <input
          value={draft.region}
          onChange={(e) => setDraft({ ...draft, region: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd(e);
          }}
          placeholder="Região (opcional)"
          aria-label="Região do novo local"
          className="w-36 p-2 border dark:border-slate-700 dark:bg-slate-800 rounded-lg text-xs text-gray-600 dark:text-gray-300 focus:border-brand focus:outline-none"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={busy || !draft.name.trim()}
          className="flex items-center gap-1 bg-brand text-white px-3 py-2 rounded-lg text-[10px] font-black uppercase disabled:opacity-50"
        >
          <Plus size={12} /> Adicionar
        </button>
      </div>

      {!loading && locations.length > 0 && !hasHeadquarters && (
        <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-[11px] font-bold text-amber-700 dark:text-amber-300">
          <Store size={13} className="shrink-0 mt-0.5" />
          Nenhum local está marcado como Matriz. Marque um: ele vira a origem padrão das transferências para as lojas.
        </p>
      )}

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
          </div>
        </div>
      ) : (
        <div className="space-y-3 max-h-[28rem] overflow-y-auto custom-scrollbar pr-1">
          {groups.map(({ region, items }) => (
            <div key={region}>
              <p className="mb-1 px-1 text-[10px] font-black uppercase tracking-wider text-gray-400">{region}</p>
              <div className="space-y-1.5">
                {items.map((loc) => {
                  const kind = locationKind(loc);
                  const open = expanded === loc.id;
                  return (
                    <div key={loc.id} className="rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-sm">
                      <div className="flex items-center gap-2 p-1.5">
                        <input
                          defaultValue={loc.name}
                          onBlur={(e) => handleChange(loc, 'name', e.target.value)}
                          aria-label="Nome do local"
                          className="flex-1 min-w-0 rounded p-1 text-xs font-bold text-gray-800 dark:text-gray-100 bg-transparent focus:bg-gray-50 dark:focus:bg-slate-900 focus:outline-none"
                        />
                        <select
                          value={kind}
                          onChange={(e) => handleChange(loc, 'kind', e.target.value)}
                          aria-label={`Tipo de ${loc.name}`}
                          className={`shrink-0 rounded-md px-1.5 py-1 text-[10px] font-black uppercase border-0 cursor-pointer focus:outline-none ${KIND_BADGE[kind]}`}
                        >
                          {LOCATION_KIND_ORDER.map((k) => (
                            <option key={k} value={k} className="text-gray-900 bg-white">{LOCATION_KINDS[k].label}</option>
                          ))}
                        </select>
                        <input
                          defaultValue={loc.region}
                          onBlur={(e) => handleChange(loc, 'region', e.target.value)}
                          aria-label="Região do local"
                          className="w-24 shrink-0 rounded p-1 text-[11px] text-gray-500 dark:text-gray-400 bg-transparent focus:bg-gray-50 dark:focus:bg-slate-900 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setExpanded(open ? null : loc.id)}
                          aria-expanded={open}
                          aria-label={`Detalhes de ${loc.name}`}
                          title="Endereço e responsável"
                          className="shrink-0 rounded p-1.5 text-gray-400 hover:text-brand hover:bg-gray-50 dark:hover:bg-slate-900"
                        >
                          <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(loc)}
                          className="shrink-0 rounded p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
                          aria-label={`Remover ${loc.name}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>

                      {open && (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 border-t border-gray-100 dark:border-slate-700 p-2">
                          <label className="sm:col-span-3 text-[10px] font-bold uppercase text-gray-400">
                            Endereço
                            <input defaultValue={loc.address || ''} onBlur={(e) => handleChange(loc, 'address', e.target.value)} placeholder="Rua, número, bairro, cidade" className={`${fieldClass} mt-1 normal-case font-normal`} />
                          </label>
                          <label className="sm:col-span-2 text-[10px] font-bold uppercase text-gray-400">
                            Responsável / gerente
                            <input defaultValue={loc.manager || ''} onBlur={(e) => handleChange(loc, 'manager', e.target.value)} placeholder="Quem recebe os equipamentos" className={`${fieldClass} mt-1 normal-case font-normal`} />
                          </label>
                          <label className="text-[10px] font-bold uppercase text-gray-400">
                            Telefone
                            <input defaultValue={loc.phone || ''} onBlur={(e) => handleChange(loc, 'phone', e.target.value)} placeholder="(00) 0000-0000" className={`${fieldClass} mt-1 normal-case font-normal`} />
                          </label>
                        </div>
                      )}
                    </div>
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

export default LocationManager;
