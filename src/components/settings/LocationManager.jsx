// src/components/settings/LocationManager.jsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ChevronDown, Download, Loader2, MapPin, Plus, RefreshCw, Store, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  addLocation,
  deleteLocation,
  getLocations,
  groupLocations,
  locationKind,
  LOCATION_KIND_ORDER,
  LOCATION_KINDS,
  updateLocation,
  seedLocations,
  STARTER_LOCATIONS,
} from '../../services/locationService';
import { invalidateLocationsCache } from '../../hooks/useLocations';
import { useAuth } from '../../contexts/AuthContext';
import { useConfirm } from '../ConfirmDialog';
import { buttonPrimaryClass, buttonSecondaryClass, inputClass } from './settingsStyles';

const fieldClass = inputClass;

const LocationRow = ({ loc, busy, open, onToggleExpand, onChangeField, onDelete }) => {
  const kind = locationKind(loc);
  const [draftOverrides, setDraftOverrides] = useState(null);

  const valueOf = (field) => {
    if (draftOverrides && Object.prototype.hasOwnProperty.call(draftOverrides, field)) {
      return draftOverrides[field];
    }
    return loc[field] || '';
  };

  const setField = (field, value) => {
    setDraftOverrides((prev) => ({ ...(prev || {}), [field]: value }));
  };

  const clearField = (field) => {
    setDraftOverrides((prev) => {
      if (!prev) return null;
      const next = { ...prev };
      delete next[field];
      return Object.keys(next).length > 0 ? next : null;
    });
  };

  const commitField = async (field) => {
    if (!draftOverrides || !Object.prototype.hasOwnProperty.call(draftOverrides, field)) return;
    const nextValue = draftOverrides[field];
    const currentValue = loc[field] ?? '';
    if ((field === 'name' && !nextValue.trim()) || nextValue === currentValue) {
      clearField(field);
      return;
    }
    await onChangeField(loc, field, nextValue);
    clearField(field);
  };

  const preventParentSubmitOnEnter = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur();
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] shadow-sm">
      <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 p-2">
        <label htmlFor={`loc-name-${loc.id}`} className="sr-only">Nome do local {loc.name}</label>
        <input
          id={`loc-name-${loc.id}`}
          name={`loc-name-${loc.id}`}
          aria-label={`Nome do local ${loc.name}`}
          value={valueOf('name')}
          disabled={busy}
          onChange={(e) => setField('name', e.target.value)}
          onBlur={() => commitField('name')}
          onKeyDown={preventParentSubmitOnEnter}
          className={`${inputClass} !w-auto flex-1 min-w-[120px] px-2.5 py-1.5 text-xs font-bold`}
        />
        <label htmlFor={`loc-kind-${loc.id}`} className="sr-only">Tipo de {loc.name}</label>
        <select
          id={`loc-kind-${loc.id}`}
          name={`loc-kind-${loc.id}`}
          aria-label={`Tipo de ${loc.name}`}
          value={kind}
          disabled={busy}
          onChange={(e) => onChangeField(loc, 'kind', e.target.value)}
          className={`${inputClass} !w-auto shrink-0 px-2.5 py-1.5 text-xs font-black uppercase cursor-pointer`}
        >
          {LOCATION_KIND_ORDER.map((k) => (
            <option key={k} value={k}>{LOCATION_KINDS[k].label}</option>
          ))}
        </select>
        <label htmlFor={`loc-region-${loc.id}`} className="sr-only">Região de {loc.name}</label>
        <input
          id={`loc-region-${loc.id}`}
          name={`loc-region-${loc.id}`}
          aria-label={`Região de ${loc.name}`}
          value={valueOf('region')}
          disabled={busy}
          onChange={(e) => setField('region', e.target.value)}
          onBlur={() => commitField('region')}
          onKeyDown={preventParentSubmitOnEnter}
          className={`${inputClass} !w-28 shrink-0 px-2.5 py-1.5 text-xs`}
        />
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={open}
          aria-label={`Detalhes de ${loc.name}`}
          title="Endereço e responsável"
          className="shrink-0 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl text-slate-500 hover:text-brand-aa hover:bg-slate-50 dark:text-zinc-400 dark:hover:bg-zinc-900 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <ChevronDown size={16} className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onDelete(loc)}
          className="shrink-0 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-60 disabled:cursor-not-allowed"
          aria-label={`Remover ${loc.name}`}
        >
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </div>

      {open && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 border-t border-slate-100 dark:border-zinc-800 p-3">
          <div className="sm:col-span-3">
            <label htmlFor={`loc-addr-${loc.id}`} className="block text-xs font-bold uppercase text-slate-500 dark:text-zinc-400">
              Endereço
            </label>
            <input
              id={`loc-addr-${loc.id}`}
              name={`loc-addr-${loc.id}`}
              value={valueOf('address')}
              disabled={busy}
              onChange={(e) => setField('address', e.target.value)}
              onBlur={() => commitField('address')}
              onKeyDown={preventParentSubmitOnEnter}
              placeholder="Rua, número, bairro, cidade"
              className={`${fieldClass} mt-1`}
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={`loc-mgr-${loc.id}`} className="block text-xs font-bold uppercase text-slate-500 dark:text-zinc-400">
              Responsável / gerente
            </label>
            <input
              id={`loc-mgr-${loc.id}`}
              name={`loc-mgr-${loc.id}`}
              value={valueOf('manager')}
              disabled={busy}
              onChange={(e) => setField('manager', e.target.value)}
              onBlur={() => commitField('manager')}
              onKeyDown={preventParentSubmitOnEnter}
              placeholder="Quem recebe os equipamentos"
              className={`${fieldClass} mt-1`}
            />
          </div>
          <div>
            <label htmlFor={`loc-phone-${loc.id}`} className="block text-xs font-bold uppercase text-slate-500 dark:text-zinc-400">
              Telefone
            </label>
            <input
              id={`loc-phone-${loc.id}`}
              name={`loc-phone-${loc.id}`}
              value={valueOf('phone')}
              disabled={busy}
              onChange={(e) => setField('phone', e.target.value)}
              onBlur={() => commitField('phone')}
              onKeyDown={preventParentSubmitOnEnter}
              placeholder="(00) 0000-0000"
              className={`${fieldClass} mt-1 tabular-nums`}
            />
          </div>
          <div className="sm:col-span-3">
            <label htmlFor={`loc-net-${loc.id}`} className="block text-xs font-bold uppercase text-slate-500 dark:text-zinc-400">
              Redes do local (Agente ITAM)
            </label>
            <input
              id={`loc-net-${loc.id}`}
              name={`loc-net-${loc.id}`}
              value={valueOf('networks')}
              disabled={busy}
              onChange={(e) => setField('networks', e.target.value)}
              onBlur={() => commitField('networks')}
              onKeyDown={preventParentSubmitOnEnter}
              placeholder="Ex.: 10.20.1.0/24, 192.168.5."
              className={`${fieldClass} mt-1 font-mono`}
            />
            <span className="mt-1 block text-xs text-slate-500 dark:text-zinc-400">
              O agente identifica a loja pelo IP da máquina: cadastra no local certo e avisa quando um equipamento aparece em outra loja.
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

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
  const { currentUser } = useAuth();
  const tenantId = currentUser?.tenantId;
  const confirmDialog = useConfirm();
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(Boolean(tenantId));
  const [loadError, setLoadError] = useState('');
  const [draft, setDraft] = useState({ name: '', region: '', kind: 'loja' });
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const isMountedRef = useRef(true);
  const loadSeqRef = useRef(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadLocations = useCallback(async ({ ignoreCheck } = {}) => {
    const seq = ++loadSeqRef.current;
    const isIgnored = () => !isMountedRef.current || seq !== loadSeqRef.current || Boolean(ignoreCheck?.());

    if (!tenantId) {
      if (!isIgnored()) {
        setLocations([]);
        setLoading(false);
        setLoadError('');
      }
      return;
    }

    if (!isIgnored()) {
      setLoading(true);
      setLoadError('');
    }

    try {
      const data = await getLocations(tenantId);
      if (!isIgnored()) {
        setLocations(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Falha ao carregar locais:', error);
      if (!isIgnored()) {
        setLocations([]);
        setLoadError('Não foi possível carregar as unidades e locais.');
      }
    } finally {
      if (!isIgnored()) {
        setLoading(false);
      }
    }
  }, [tenantId]);

  useEffect(() => {
    let cancelled = false;
    loadLocations({ ignoreCheck: () => cancelled });
    return () => {
      cancelled = true;
    };
  }, [loadLocations]);

  const reload = useCallback(async () => {
    invalidateLocationsCache(tenantId);
    await loadLocations();
  }, [loadLocations, tenantId]);

  const groups = groupLocations(locations);
  const hasHeadquarters = locations.some((l) => locationKind(l) === 'matriz');

  const handleAdd = async (e) => {
    e?.preventDefault();
    if (busy || !draft.name.trim()) return;
    setBusy(true);
    try {
      await addLocation({ ...draft, tenantId });
      if (!isMountedRef.current) return;
      setDraft({ name: '', region: draft.region, kind: draft.kind });
      await reload();
      if (isMountedRef.current) toast.success('Local adicionado.');
    } catch (error) {
      console.error(error);
      if (isMountedRef.current) toast.error(error.message || 'Erro ao adicionar local.');
    } finally {
      if (isMountedRef.current) setBusy(false);
    }
  };

  const handleChange = async (loc, field, value) => {
    if (busy) return false;
    if (value === (loc[field] ?? '')) return true;
    setBusy(true);
    try {
      await updateLocation(loc.id, { [field]: value });
      await reload();
      return true;
    } catch (error) {
      console.error(error);
      if (isMountedRef.current) toast.error('Erro ao salvar o local.');
      return false;
    } finally {
      if (isMountedRef.current) setBusy(false);
    }
  };

  const handleDelete = async (loc) => {
    if (busy) return;
    // Ativos guardam o nome do local; apagar aqui nao apaga o historico deles.
    const ok = await confirmDialog({
      title: 'Remover local',
      message: `Remover "${loc.name}"? Os ativos que já apontam para este local mantêm o nome registrado.`,
      confirmLabel: 'Remover',
      danger: true,
    });
    if (!ok || !isMountedRef.current) return;
    setBusy(true);
    try {
      await deleteLocation(loc.id);
      await reload();
      if (isMountedRef.current) toast.success('Local removido.');
    } catch (error) {
      console.error(error);
      if (isMountedRef.current) toast.error('Erro ao remover.');
    } finally {
      if (isMountedRef.current) setBusy(false);
    }
  };

  const handleSeed = async (preset, rotulo) => {
    if (busy) return;
    setBusy(true);
    try {
      const added = await seedLocations(tenantId, preset);
      await reload();
      if (isMountedRef.current) {
        toast.success(added ? `${added} locais de ${rotulo} importados.` : 'Nada novo a importar.');
      }
    } catch (error) {
      console.error(error);
      if (isMountedRef.current) toast.error('Erro ao importar locais.');
    } finally {
      if (isMountedRef.current) setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900/60 p-4 space-y-3">
      {showHeader && (
        <div className="flex items-center gap-2">
          <MapPin size={16} className="text-brand-aa" aria-hidden="true" />
          <h3 className="text-xs font-black text-slate-800 dark:text-[#fafafa] uppercase">Filiais &amp; Locais</h3>
          <span className="ml-auto text-xs font-bold text-slate-500 dark:text-zinc-400 tabular-nums">{locations.length}</span>
        </div>
      )}

      {/* div, e nao <form>: este bloco vive dentro do formulario de
          Configuracoes, e o submit do form aninhado disparava tambem o
          "Salvar Configuracoes" da pagina inteira. */}
      <div className="flex flex-wrap gap-2">
        <label htmlFor="loc-new-name" className="sr-only">Nome do novo local</label>
        <input
          id="loc-new-name"
          name="loc-new-name"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (!busy && draft.name.trim()) handleAdd(e);
            }
          }}
          placeholder="Nome do local (ex: Loja Centro)"
          className={`${inputClass} flex-1 min-w-[160px]`}
        />
        <label htmlFor="loc-new-kind" className="sr-only">Tipo do novo local</label>
        <select
          id="loc-new-kind"
          name="loc-new-kind"
          value={draft.kind}
          onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
          className={`${inputClass} sm:w-40`}
        >
          {LOCATION_KIND_ORDER.map((kind) => (
            <option key={kind} value={kind}>{LOCATION_KINDS[kind].label}</option>
          ))}
        </select>
        <label htmlFor="loc-new-region" className="sr-only">Região do novo local</label>
        <input
          id="loc-new-region"
          name="loc-new-region"
          value={draft.region}
          onChange={(e) => setDraft({ ...draft, region: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (!busy && draft.name.trim()) handleAdd(e);
            }
          }}
          placeholder="Região (opcional)"
          className={`${inputClass} sm:w-40`}
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={busy || !draft.name.trim()}
          className={`${buttonPrimaryClass} min-h-[44px] text-xs uppercase`}
        >
          <Plus size={14} aria-hidden="true" /> Adicionar
        </button>
      </div>

      {!loading && locations.length > 0 && !hasHeadquarters && (
        <p className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs font-bold text-amber-800 dark:text-amber-300">
          <Store size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
          Nenhum local está marcado como Matriz. Marque um: ele vira a origem padrão das transferências para as lojas.
        </p>
      )}

      {loading ? (
        <p role="status" className="flex items-center justify-center gap-2 py-4 text-xs text-slate-500 dark:text-zinc-400">
          <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Carregando…
        </p>
      ) : loadError ? (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 p-4 text-center space-y-3"
        >
          <p className="flex items-center justify-center gap-2 text-xs font-bold text-rose-700 dark:text-rose-300">
            <AlertCircle size={15} className="shrink-0" aria-hidden="true" />
            {loadError}
          </p>
          <button
            type="button"
            onClick={reload}
            className={`${buttonSecondaryClass} min-h-[44px] text-xs uppercase`}
          >
            <RefreshCw size={14} aria-hidden="true" /> Tentar novamente
          </button>
        </div>
      ) : locations.length === 0 ? (
        <div className="py-3 text-center space-y-3">
          <p className="text-xs font-medium text-slate-500 dark:text-zinc-400">
            Nenhum local cadastrado. Os seletores de localização ficam vazios até você criar o primeiro.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => handleSeed(STARTER_LOCATIONS, 'exemplo')}
              disabled={busy}
              className={`${buttonSecondaryClass} min-h-[44px] text-xs uppercase`}
            >
              <Download size={14} aria-hidden="true" /> Locais de exemplo
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 max-h-[28rem] overflow-y-auto custom-scrollbar pr-1">
          {groups.map(({ region, items }) => (
            <div key={region}>
              <p className="mb-1 px-1 text-xs font-black uppercase tracking-wider text-slate-500 dark:text-zinc-400">{region}</p>
              <div className="space-y-1.5">
                {items.map((loc) => (
                  <LocationRow
                    key={loc.id}
                    loc={loc}
                    busy={busy}
                    open={expanded === loc.id}
                    onToggleExpand={() => setExpanded(expanded === loc.id ? null : loc.id)}
                    onChangeField={handleChange}
                    onDelete={handleDelete}
                  />
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
