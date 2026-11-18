// src/pages/NexusPlansManager.jsx
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  Building2,
  Calculator,
  Check,
  CircleDollarSign,
  Edit3,
  Layers,
  Plus,
  RefreshCcw,
  Save,
  Search,
  Sliders,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { collection, getDocs } from 'firebase/firestore';
import { toast } from 'sonner';
import { db } from '../services/firebase';
import {
  BILLING_CYCLES,
  DEFAULT_PRICING_MATRIX,
  FEATURES,
  UNLIMITED,
  calculateCustomPlanQuote,
  isUnlimited,
  resolveEntitlements,
  sanitizePricingMatrix,
} from '../utils/entitlements';
import { brl } from '../utils/consoleMetrics';
import {
  deletePlanTemplate,
  describeFirebaseError,
  loadPlans,
  loadPricingMatrix,
  savePlanTemplate,
  savePricingMatrix,
} from '../services/tenantService';
import { KpiTile, PlanBadge, TenantStatusBadge } from '../components/console/consoleUi';
import { useConfirm } from '../components/ConfirmDialog';
import { captureFocusTarget, restoreFocusSafely, trapFocusWithin } from '../utils/focusTrap';
import { isTopmostModal } from '../utils/modalStack';

const VALID_TABS = new Set(['catalog', 'pricing', 'customs']);
const VALID_CYCLES = new Set(['ALL', ...Object.keys(BILLING_CYCLES)]);
const CORE_PLAN_IDS = new Set(['starter', 'pro', 'enterprise']);

const fieldClass =
  'min-h-[44px] w-full px-3.5 py-2.5 bg-white dark:bg-[#111113] border border-slate-200 dark:border-zinc-800 rounded-xl text-sm font-semibold text-slate-900 dark:text-[#fafafa] placeholder:text-slate-400 dark:placeholder:text-zinc-500 transition-colors hover:border-slate-300 dark:hover:border-zinc-700 active:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:border-brand disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-zinc-900 aria-[invalid=true]:border-rose-500 aria-[invalid=true]:focus-visible:ring-rose-500';
const labelClass =
  'block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-400 mb-1.5';
const btnPrimaryClass =
  'min-h-[44px] px-4 py-2.5 rounded-xl bg-brand hover:bg-brand-dark text-brand-fg font-bold text-xs inline-flex items-center justify-center gap-2 shadow-sm transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#111113] disabled:opacity-60 disabled:cursor-not-allowed';
const btnSecondaryClass =
  'min-h-[44px] px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] text-slate-700 dark:text-[#fafafa] font-bold text-xs inline-flex items-center justify-center gap-2 transition-colors hover:bg-slate-50 dark:hover:bg-zinc-800 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#111113] disabled:opacity-60 disabled:cursor-not-allowed';
const btnIconClass =
  'min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] text-slate-600 dark:text-zinc-300 transition-colors hover:bg-slate-50 dark:hover:bg-zinc-800 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60 disabled:cursor-not-allowed';

const emptyPlanForm = () => ({
  id: '',
  isNew: true,
  name: '',
  maxAssets: 250,
  maxUsers: 20,
  monthlyPrice: 399,
  billingCycle: 'monthly',
  features: Object.fromEntries(FEATURES.map((f) => [f.id, true])),
});

const parseLimit = (raw) => {
  const clean = String(raw ?? '').trim().toLowerCase();
  if (!clean || clean === 'unlimited' || clean === 'ilimitado' || clean === '-1') return UNLIMITED;
  const n = Number(clean);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
};

const NexusPlansManager = () => {
  const confirm = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();

  const rawTab = searchParams.get('aba') || 'catalog';
  const activeTab = VALID_TABS.has(rawTab) ? rawTab : 'catalog';
  const searchTerm = searchParams.get('q') || '';
  const rawCycle = searchParams.get('ciclo') || 'ALL';
  const cycleFilter = VALID_CYCLES.has(rawCycle) ? rawCycle : 'ALL';

  const [plans, setPlans] = useState({});
  const [tenants, setTenants] = useState([]);
  const [pricingMatrix, setPricingMatrix] = useState(DEFAULT_PRICING_MATRIX);
  const [loading, setLoading] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [loadError, setLoadError] = useState('');

  const [editing, setEditing] = useState(null);
  const [planErrors, setPlanErrors] = useState({});
  const [planFormError, setPlanFormError] = useState('');
  const [savingPlan, setSavingPlan] = useState(false);
  const [savingPricing, setSavingPricing] = useState(false);
  const [deletingPlanId, setDeletingPlanId] = useState(null);

  const [simAssets, setSimAssets] = useState(250);
  const [simUsers, setSimUsers] = useState(15);
  const [simCycle, setSimCycle] = useState('annual');
  const [simFeatures, setSimFeatures] = useState({
    agent: true,
    whitelabel: false,
    projects: true,
    licenses: true,
    contracts: true,
    audit: true,
    import: true,
    cloud_storage: false,
  });

  const modalTitleId = useId();
  const modalRef = useRef(null);
  const firstInputRef = useRef(null);
  const previousFocusRef = useRef(null);
  const isMountedRef = useRef(true);
  const loadSeqRef = useRef(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const updateParam = useCallback((key, value, defaultVal = '') => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value === null || value === undefined || value === '' || value === defaultVal) {
        next.delete(key);
      } else {
        next.set(key, value);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setActiveTab = (tab) => updateParam('aba', tab, 'catalog');
  const setSearchTerm = (q) => updateParam('q', q, '');
  const setCycleFilter = (cycle) => updateParam('ciclo', cycle, 'ALL');
  const clearFilters = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('q');
      next.delete('ciclo');
      return next;
    }, { replace: true });
  };

  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setLoadError('');
    try {
      const [loadedPlans, loadedPricing, tenantsSnap] = await Promise.all([
        loadPlans(),
        loadPricingMatrix(),
        getDocs(collection(db, 'tenants')),
      ]);
      if (!isMountedRef.current || seq !== loadSeqRef.current) return;
      setPlans(loadedPlans);
      setPricingMatrix(loadedPricing);
      setTenants(tenantsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoadedOnce(true);
    } catch (error) {
      console.error('Erro ao carregar planos:', error);
      if (!isMountedRef.current || seq !== loadSeqRef.current) return;
      setLoadError(describeFirebaseError(error, 'Falha ao carregar o catálogo de planos e custos.'));
      toast.error('Falha ao carregar o catálogo de planos e custos.');
    } finally {
      if (isMountedRef.current && seq === loadSeqRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const closePlanModal = useCallback(() => {
    if (savingPlan) return;
    setEditing(null);
    setPlanErrors({});
    setPlanFormError('');
  }, [savingPlan]);

  const savingPlanRef = useRef(savingPlan);
  savingPlanRef.current = savingPlan;
  const closePlanModalRef = useRef(closePlanModal);
  closePlanModalRef.current = closePlanModal;
  const editingModalKey = editing ? (editing.isNew ? 'new' : `edit:${editing.id}`) : '';

  useEffect(() => {
    if (!editingModalKey) return undefined;
    const container = modalRef.current;
    previousFocusRef.current = captureFocusTarget(container);

    const raf = requestAnimationFrame(() => {
      if (firstInputRef.current) {
        firstInputRef.current.focus();
      } else {
        container?.focus();
      }
    });

    const onKeyDown = (event) => {
      if (!isTopmostModal(container)) return;
      if (event.key === 'Escape') {
        if (savingPlanRef.current) return;
        event.preventDefault();
        closePlanModalRef.current?.();
        return;
      }
      if (event.key === 'Tab') {
        trapFocusWithin(event, container);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown);
      const previous = previousFocusRef.current;
      previousFocusRef.current = null;
      restoreFocusSafely(previous, null, container);
    };
  }, [editingModalKey]);

  const stats = useMemo(() => {
    const acc = {};
    Object.keys(plans).forEach((id) => {
      acc[id] = { count: 0, customCount: 0, mrr: 0, blocked: 0 };
    });
    acc.custom = { count: 0, customCount: 0, mrr: 0, blocked: 0 };

    tenants.forEach((t) => {
      const id = String(t.plan || '').toLowerCase();
      if (!acc[id]) acc[id] = { count: 0, customCount: 0, mrr: 0, blocked: 0 };
      acc[id].count += 1;
      const ent = resolveEntitlements({ tenant: t, plan: plans[id] });
      if (ent.isCustomPlan) acc[id].customCount += 1;
      if (['suspended', 'cancelled'].includes(t.status)) acc[id].blocked += 1;
      else acc[id].mrr += ent.monthlyPrice;
    });
    return acc;
  }, [tenants, plans]);

  const totalMrr = useMemo(
    () =>
      tenants.reduce((sum, t) => {
        if (['suspended', 'cancelled'].includes(t.status)) return sum;
        const id = String(t.plan || '').toLowerCase();
        return sum + resolveEntitlements({ tenant: t, plan: plans[id] }).monthlyPrice;
      }, 0),
    [tenants, plans],
  );

  const startEdit = (plan) => {
    const featureMap = {};
    FEATURES.forEach((f) => {
      const val = plan.features?.[f.id] ?? (f.planKey ? plan[f.planKey] : true);
      featureMap[f.id] = val !== false;
    });
    setPlanErrors({});
    setPlanFormError('');
    setEditing({
      id: plan.id,
      isNew: false,
      name: plan.name || plan.id,
      maxAssets: isUnlimited(plan.maxAssets) ? 'unlimited' : String(plan.maxAssets ?? ''),
      maxUsers: isUnlimited(plan.maxUsers) ? 'unlimited' : String(plan.maxUsers ?? ''),
      monthlyPrice: plan.monthlyPrice ?? 0,
      billingCycle: plan.billingCycle || 'monthly',
      features: featureMap,
    });
  };

  const startCreate = () => {
    setPlanErrors({});
    setPlanFormError('');
    setEditing(emptyPlanForm());
  };

  const handleSavePlan = async (e) => {
    e.preventDefault();
    if (!editing || savingPlan) return;

    const cleanId = editing.isNew
      ? String(editing.id || editing.name)
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
      : editing.id;

    const nextErrors = {};
    if (!cleanId) nextErrors.id = true;
    if (!String(editing.name || '').trim()) nextErrors.name = true;
    const maxAssets = parseLimit(editing.maxAssets);
    const maxUsers = parseLimit(editing.maxUsers);
    const monthlyPrice = Number(editing.monthlyPrice);
    if (maxAssets === null) nextErrors.maxAssets = true;
    if (maxUsers === null) nextErrors.maxUsers = true;
    if (!Number.isFinite(monthlyPrice) || monthlyPrice < 0) nextErrors.monthlyPrice = true;

    if (Object.keys(nextErrors).length > 0) {
      setPlanErrors(nextErrors);
      const msg = !cleanId
        ? 'Informe um identificador válido para o plano.'
        : 'Preencha valores válidos para nome, cotas e mensalidade (use "unlimited" para ilimitado).';
      setPlanFormError(msg);
      toast.error(msg);
      return;
    }

    setPlanErrors({});
    setPlanFormError('');
    setSavingPlan(true);
    try {
      await savePlanTemplate(cleanId, {
        name: String(editing.name || cleanId).trim(),
        maxAssets,
        maxUsers,
        monthlyPrice,
        billingCycle: editing.billingCycle || 'monthly',
        whitelabel: Boolean(editing.features?.whitelabel),
        agentIntegration: Boolean(editing.features?.agent),
        cloudStorage: Boolean(editing.features?.cloud_storage),
        features: editing.features,
      });
      if (!isMountedRef.current) return;
      toast.success(editing.isNew ? `Plano "${editing.name}" criado no catálogo.` : `Plano "${editing.name}" atualizado.`);
      setEditing(null);
      load();
    } catch (error) {
      console.error('Erro ao salvar plano:', error);
      if (!isMountedRef.current) return;
      const msg = describeFirebaseError(error, 'Falha ao gravar o plano.');
      setPlanFormError(msg);
      toast.error(msg);
    } finally {
      if (isMountedRef.current) setSavingPlan(false);
    }
  };

  const handleDeletePlan = async (plan) => {
    if (CORE_PLAN_IDS.has(plan.id) || deletingPlanId) return;
    const ok = await confirm({
      title: 'Excluir Modelo de Plano',
      message: `Remover o modelo "${plan.name}" do catálogo? Empresas que já usam esse plano manterão suas cotas.`,
      danger: true,
      confirmLabel: 'Excluir',
    });
    if (!ok || !isMountedRef.current) return;
    setDeletingPlanId(plan.id);
    try {
      await deletePlanTemplate(plan.id);
      if (!isMountedRef.current) return;
      toast.success(`Modelo "${plan.name}" removido.`);
      load();
    } catch (error) {
      console.error(error);
      if (isMountedRef.current) toast.error(describeFirebaseError(error, 'Falha ao remover modelo.'));
    } finally {
      if (isMountedRef.current) setDeletingPlanId(null);
    }
  };

  const handleSavePricing = async (e) => {
    e.preventDefault();
    if (savingPricing) return;
    setSavingPricing(true);
    try {
      const normalized = sanitizePricingMatrix(pricingMatrix);
      await savePricingMatrix(normalized);
      if (!isMountedRef.current) return;
      setPricingMatrix(normalized);
      toast.success('Tabela de custos unitários atualizada! Todas as empresas verão os novos valores.');
    } catch (error) {
      console.error('Erro ao salvar tabela de custos:', error);
      if (isMountedRef.current) toast.error(describeFirebaseError(error, 'Falha ao gravar tabela de custos.'));
    } finally {
      if (isMountedRef.current) setSavingPricing(false);
    }
  };

  const customTenants = useMemo(
    () =>
      tenants
        .map((t) => ({
          ...t,
          ent: resolveEntitlements({ tenant: t, plan: plans[String(t.plan || '').toLowerCase()] }),
        }))
        .filter((t) => t.ent.isCustomPlan),
    [tenants, plans],
  );

  const filteredPlans = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return Object.values(plans).filter((plan) => {
      if (cycleFilter !== 'ALL' && (plan.billingCycle || 'monthly') !== cycleFilter) return false;
      if (term) {
        const haystack = [plan.name, plan.id, BILLING_CYCLES[plan.billingCycle || 'monthly']?.label]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [plans, searchTerm, cycleFilter]);

  const filteredCustomTenants = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return customTenants.filter((t) => {
      if (cycleFilter !== 'ALL' && t.ent.billingCycle !== cycleFilter) return false;
      if (term) {
        const haystack = [t.companyName, t.id, t.ent.planName, t.owner?.email, t.owner?.name]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [customTenants, searchTerm, cycleFilter]);

  const hasActiveFilters = Boolean(searchTerm.trim()) || cycleFilter !== 'ALL';

  const simulatorQuote = useMemo(
    () =>
      calculateCustomPlanQuote({
        maxAssets: simAssets,
        maxUsers: simUsers,
        features: simFeatures,
        billingCycle: simCycle,
        pricing: pricingMatrix,
      }),
    [simAssets, simUsers, simFeatures, simCycle, pricingMatrix],
  );

  const invalidNonNeg = (val) => !Number.isFinite(Number(val)) || Number(val) < 0;
  const invalidDiscount = (val) => !Number.isFinite(Number(val)) || Number(val) < 0 || Number(val) > 80;

  return (
    <div className="max-w-7xl mx-auto pb-24 space-y-6 animate-fade-in">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-[#111113] rounded-2xl p-5 border border-slate-200/90 dark:border-zinc-800 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand/10 border border-brand/20 text-brand-aa flex items-center justify-center shrink-0">
            <Layers size={20} aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-900 dark:text-[#fafafa] tracking-tight">
              Planos, Contratos &amp; Matriz de Custos
            </h1>
            <p className="text-xs text-slate-600 dark:text-zinc-400 mt-0.5">
              Gerencie os modelos de assinatura, regras de cálculo modular sob medida e descontos por ciclo.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={startCreate}
            className={btnPrimaryClass}
          >
            <Plus size={15} aria-hidden="true" />
            <span>Novo Modelo de Plano</span>
          </button>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className={btnIconClass}
            title="Recarregar"
            aria-label="Recarregar catálogo de planos"
          >
            <RefreshCcw size={15} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* RESUMO KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiTile
          icon={Layers}
          label="Modelos no catálogo"
          value={Object.keys(plans).length.toLocaleString('pt-BR')}
          hint="Starter, Pro, Enterprise e extras"
        />
        <KpiTile
          icon={Building2}
          tone="bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400"
          label="Empresas monitoradas"
          value={tenants.length.toLocaleString('pt-BR')}
          hint={`${tenants.filter((t) => !['suspended', 'cancelled'].includes(t.status)).length} ativas ou em teste`}
        />
        <KpiTile
          icon={Sparkles}
          tone="bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400"
          label="Contratos sob medida"
          value={customTenants.length.toLocaleString('pt-BR')}
          hint="Ver empresas com ajustes"
          onClick={() => setActiveTab('customs')}
        />
        <KpiTile
          icon={CircleDollarSign}
          tone="bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400"
          label="MRR consolidado"
          value={brl.format(totalMrr)}
          hint="Receita recorrente estimada"
        />
      </div>

      {/* ESTADO DE ERRO + RETRY */}
      {loadError && (
        <div
          role="alert"
          className="rounded-2xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-bold text-rose-900 dark:text-rose-200">Erro ao carregar catálogo de planos</h2>
              <p className="text-xs text-rose-700 dark:text-rose-300 mt-0.5">{loadError}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-white dark:bg-[#111113] border border-rose-200 dark:border-rose-800 text-xs font-bold text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-60 disabled:cursor-not-allowed shrink-0"
          >
            <RefreshCcw size={14} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
            <span>Tentar novamente</span>
          </button>
        </div>
      )}

      {/* NAVEGAÇÃO POR ABAS */}
      <div
        role="tablist"
        aria-label="Seções do gestor de planos"
        className="flex flex-wrap gap-2 bg-white dark:bg-[#111113] p-1.5 rounded-2xl border border-slate-200 dark:border-zinc-800 w-fit shadow-sm"
      >
        {[
          { id: 'catalog', label: 'Modelos do Catálogo', icon: Layers },
          { id: 'pricing', label: 'Custos Unitários (Sob Medida)', icon: Calculator },
          { id: 'customs', label: `Contratos Sob Medida (${customTenants.length})`, icon: Sparkles },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(tab.id)}
              className={`min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold tabular-nums transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                active
                  ? 'bg-brand text-brand-fg shadow-sm'
                  : 'text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800'
              }`}
            >
              <Icon size={14} aria-hidden="true" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* BARRA DE BUSCA & FILTRO SINCRONIZADA NA URL */}
      {(activeTab === 'catalog' || activeTab === 'customs') && (
        <div className="bg-white dark:bg-[#111113] rounded-2xl border border-slate-200/90 dark:border-zinc-800 p-4 shadow-sm flex flex-col md:flex-row gap-3 items-stretch md:items-center">
          <div className="relative w-full md:flex-1">
            <label htmlFor="plans-search" className="sr-only">
              Buscar modelos de planos ou contratos sob medida
            </label>
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-zinc-500" aria-hidden="true" />
            <input
              id="plans-search"
              name="q"
              type="search"
              placeholder={
                activeTab === 'catalog'
                  ? 'Buscar modelo por nome ou identificador…'
                  : 'Buscar empresa, plano, ID ou responsável…'
              }
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className={`${fieldClass} pl-10`}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div>
              <label htmlFor="plans-cycle-filter" className="sr-only">Filtrar por ciclo de faturamento</label>
              <select
                id="plans-cycle-filter"
                name="ciclo"
                value={cycleFilter}
                onChange={(e) => setCycleFilter(e.target.value)}
                className={`${fieldClass} md:w-52 cursor-pointer`}
              >
                <option value="ALL">Todos os ciclos</option>
                {Object.values(BILLING_CYCLES).map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className={btnSecondaryClass}
              >
                <X size={14} aria-hidden="true" />
                <span>Limpar filtros</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* ESTADO DE LOADING INICIAL */}
      {loading && !loadedOnce ? (
        <div role="status" aria-label="Carregando catálogo de planos…" className="grid grid-cols-1 md:grid-cols-3 gap-5 animate-pulse">
          <span className="sr-only">Carregando catálogo de planos…</span>
          {[0, 1, 2].map((idx) => (
            <div
              key={idx}
              className="bg-white dark:bg-[#111113] rounded-2xl border border-slate-200 dark:border-zinc-800 p-6 space-y-4 h-80"
            >
              <div className="h-5 w-32 bg-slate-200 dark:bg-zinc-800 rounded" />
              <div className="h-8 w-40 bg-slate-200 dark:bg-zinc-800 rounded" />
              <div className="grid grid-cols-2 gap-2">
                <div className="h-14 bg-slate-100 dark:bg-zinc-900 rounded-xl" />
                <div className="h-14 bg-slate-100 dark:bg-zinc-900 rounded-xl" />
              </div>
              <div className="space-y-2">
                <div className="h-4 w-full bg-slate-100 dark:bg-zinc-900 rounded" />
                <div className="h-4 w-3/4 bg-slate-100 dark:bg-zinc-900 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* ABA 1 — MODELOS DE PLANOS */}
          {activeTab === 'catalog' && (
            filteredPlans.length === 0 ? (
              <div className="bg-white dark:bg-[#111113] rounded-2xl border-2 border-dashed border-slate-200 dark:border-zinc-800 p-12 text-center space-y-3">
                <Layers size={36} className="mx-auto text-slate-400 dark:text-zinc-500" aria-hidden="true" />
                <h2 className="text-base font-bold text-slate-900 dark:text-[#fafafa]">
                  {Object.keys(plans).length === 0 ? 'Nenhum modelo cadastrado' : 'Nenhum modelo corresponde aos filtros'}
                </h2>
                <p className="text-xs text-slate-600 dark:text-zinc-400 max-w-md mx-auto">
                  {hasActiveFilters
                    ? 'Ajuste a busca ou o ciclo selecionado para visualizar os modelos disponíveis.'
                    : 'Crie o primeiro modelo de assinatura no catálogo para atribuir às empresas.'}
                </p>
                <div className="pt-1 flex justify-center gap-2">
                  {hasActiveFilters ? (
                    <button type="button" onClick={clearFilters} className={btnSecondaryClass}>
                      Limpar filtros
                    </button>
                  ) : (
                    <button type="button" onClick={startCreate} className={btnPrimaryClass}>
                      <Plus size={14} aria-hidden="true" /> Novo Modelo de Plano
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {filteredPlans.map((plan) => {
                  const s = stats[plan.id] || { count: 0, customCount: 0, mrr: 0, blocked: 0 };
                  const isCore = CORE_PLAN_IDS.has(plan.id);
                  const resolved = resolveEntitlements({ tenant: { plan: plan.id }, plan });
                  return (
                    <div
                      key={plan.id}
                      className="[content-visibility:auto] [contain-intrinsic-size:auto_56px] bg-white dark:bg-[#111113] rounded-2xl border border-slate-200 dark:border-zinc-800 p-6 shadow-sm flex flex-col justify-between gap-5"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className="text-xs font-black uppercase tracking-wider text-brand-aa">
                              {plan.id}
                            </span>
                            <h2 className="text-lg font-black text-slate-900 dark:text-[#fafafa]">{plan.name}</h2>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => startEdit(plan)}
                              className={btnIconClass}
                              title="Editar modelo"
                              aria-label={`Editar ${plan.name}`}
                            >
                              <Edit3 size={15} aria-hidden="true" />
                            </button>
                            {!isCore && (
                              <button
                                type="button"
                                disabled={deletingPlanId === plan.id}
                                onClick={() => handleDeletePlan(plan)}
                                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl border border-rose-200 dark:border-rose-900/50 bg-white dark:bg-[#111113] text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-60 disabled:cursor-not-allowed"
                                title="Excluir modelo customizado"
                                aria-label={`Excluir ${plan.name}`}
                              >
                                <Trash2 size={15} aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        </div>

                        <p className="mt-4 flex items-baseline gap-1.5">
                          <span className="text-3xl font-black text-slate-900 dark:text-[#fafafa] tracking-tight tabular-nums">
                            {brl.format(Number(plan.monthlyPrice) || 0)}
                          </span>
                          <span className="text-xs font-bold text-slate-500 dark:text-zinc-400">/mês base</span>
                        </p>

                        <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
                          <div className="rounded-xl bg-slate-50 dark:bg-[#09090b] p-2.5 border border-slate-200/70 dark:border-zinc-800">
                            <dt className="text-xs font-bold uppercase text-slate-500 dark:text-zinc-400">Ativos</dt>
                            <dd className="font-black text-slate-900 dark:text-[#fafafa] tabular-nums mt-0.5">
                              {isUnlimited(plan.maxAssets) ? 'Ilimitado' : Number(plan.maxAssets).toLocaleString('pt-BR')}
                            </dd>
                          </div>
                          <div className="rounded-xl bg-slate-50 dark:bg-[#09090b] p-2.5 border border-slate-200/70 dark:border-zinc-800">
                            <dt className="text-xs font-bold uppercase text-slate-500 dark:text-zinc-400">Gestores</dt>
                            <dd className="font-black text-slate-900 dark:text-[#fafafa] tabular-nums mt-0.5">
                              {isUnlimited(plan.maxUsers) ? 'Ilimitado' : Number(plan.maxUsers).toLocaleString('pt-BR')}
                            </dd>
                          </div>
                        </dl>

                        <ul className="mt-4 space-y-2">
                          {FEATURES.map((f) => {
                            const on = Boolean(resolved.features?.[f.id]);
                            return (
                              <li
                                key={f.id}
                                className={`flex items-center gap-2 text-xs font-semibold ${
                                  on ? 'text-slate-700 dark:text-zinc-200' : 'text-slate-400 dark:text-zinc-500 line-through'
                                }`}
                              >
                                <span
                                  aria-hidden="true"
                                  className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${
                                    on
                                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
                                      : 'bg-slate-100 text-slate-400 dark:bg-zinc-800 dark:text-zinc-500'
                                  }`}
                                >
                                  {on ? <Check size={10} aria-hidden="true" /> : <X size={10} aria-hidden="true" />}
                                </span>
                                <span>{f.label}</span>
                              </li>
                            );
                          })}
                        </ul>
                      </div>

                      <div className="border-t border-slate-100 dark:border-zinc-800 pt-4 flex items-center justify-between text-xs">
                        <div>
                          <span className="font-bold text-slate-700 dark:text-zinc-300 tabular-nums">
                            {s.count} {s.count === 1 ? 'empresa' : 'empresas'}
                          </span>
                          {s.customCount > 0 && (
                            <span className="ml-1.5 text-xs font-bold text-brand-aa tabular-nums">
                              ({s.customCount} sob medida)
                            </span>
                          )}
                        </div>
                        <span className="font-black text-slate-900 dark:text-[#fafafa] tabular-nums">
                          MRR {brl.format(s.mrr)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}

          {/* ABA 2 — MATRIZ DE CUSTOS UNITÁRIOS & SIMULADOR */}
          {activeTab === 'pricing' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <form
                onSubmit={handleSavePricing}
                className="lg:col-span-7 bg-white dark:bg-[#111113] rounded-2xl border border-slate-200 dark:border-zinc-800 p-6 shadow-sm space-y-5"
              >
                <div>
                  <h2 className="text-base font-black text-slate-900 dark:text-[#fafafa] flex items-center gap-2">
                    <Sliders size={16} className="text-brand-aa" aria-hidden="true" /> Regra de Precificação Modular (/plans/_pricing)
                  </h2>
                  <p className="text-xs text-slate-600 dark:text-zinc-400 mt-0.5">
                    Define o custo unitário que as empresas visualizam ao montar seu próprio plano sob medida.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className={labelClass} htmlFor="pm-base">Taxa Base Plataforma (R$/mês)</label>
                    <input
                      id="pm-base"
                      name="baseFee"
                      type="number"
                      min="0"
                      step="0.01"
                      value={pricingMatrix.baseFee}
                      aria-invalid={invalidNonNeg(pricingMatrix.baseFee) ? 'true' : undefined}
                      onChange={(e) => setPricingMatrix({ ...pricingMatrix, baseFee: Number(e.target.value) })}
                      className={`${fieldClass} tabular-nums`}
                    />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="pm-qdisc">Desconto Trimestral (%)</label>
                    <input
                      id="pm-qdisc"
                      name="quarterlyDiscountPct"
                      type="number"
                      min="0"
                      max="80"
                      value={pricingMatrix.quarterlyDiscountPct}
                      aria-invalid={invalidDiscount(pricingMatrix.quarterlyDiscountPct) ? 'true' : undefined}
                      onChange={(e) => setPricingMatrix({ ...pricingMatrix, quarterlyDiscountPct: Number(e.target.value) })}
                      className={`${fieldClass} tabular-nums`}
                    />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="pm-adisc">Desconto Anual (%)</label>
                    <input
                      id="pm-adisc"
                      name="annualDiscountPct"
                      type="number"
                      min="0"
                      max="80"
                      value={pricingMatrix.annualDiscountPct}
                      aria-invalid={invalidDiscount(pricingMatrix.annualDiscountPct) ? 'true' : undefined}
                      onChange={(e) => setPricingMatrix({ ...pricingMatrix, annualDiscountPct: Number(e.target.value) })}
                      className={`${fieldClass} tabular-nums`}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-100 dark:border-zinc-800">
                  <div>
                    <label className={labelClass} htmlFor="pm-inc-assets">Ativos inclusos na base</label>
                    <input
                      id="pm-inc-assets"
                      name="includedAssets"
                      type="number"
                      min="0"
                      value={pricingMatrix.includedAssets}
                      aria-invalid={invalidNonNeg(pricingMatrix.includedAssets) ? 'true' : undefined}
                      onChange={(e) => setPricingMatrix({ ...pricingMatrix, includedAssets: Number(e.target.value) })}
                      className={`${fieldClass} tabular-nums`}
                    />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="pm-unit-asset">Valor por ativo extra (R$)</label>
                    <input
                      id="pm-unit-asset"
                      name="assetUnitPrice"
                      type="number"
                      min="0"
                      step="0.05"
                      value={pricingMatrix.assetUnitPrice}
                      aria-invalid={invalidNonNeg(pricingMatrix.assetUnitPrice) ? 'true' : undefined}
                      onChange={(e) => setPricingMatrix({ ...pricingMatrix, assetUnitPrice: Number(e.target.value) })}
                      className={`${fieldClass} tabular-nums`}
                    />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="pm-unlim-asset">Pacote Ativos Ilimitados (R$)</label>
                    <input
                      id="pm-unlim-asset"
                      name="unlimitedAssetsFee"
                      type="number"
                      min="0"
                      step="1"
                      value={pricingMatrix.unlimitedAssetsFee}
                      aria-invalid={invalidNonNeg(pricingMatrix.unlimitedAssetsFee) ? 'true' : undefined}
                      onChange={(e) => setPricingMatrix({ ...pricingMatrix, unlimitedAssetsFee: Number(e.target.value) })}
                      className={`${fieldClass} tabular-nums`}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-100 dark:border-zinc-800">
                  <div>
                    <label className={labelClass} htmlFor="pm-inc-users">Gestores inclusos na base</label>
                    <input
                      id="pm-inc-users"
                      name="includedUsers"
                      type="number"
                      min="0"
                      value={pricingMatrix.includedUsers}
                      aria-invalid={invalidNonNeg(pricingMatrix.includedUsers) ? 'true' : undefined}
                      onChange={(e) => setPricingMatrix({ ...pricingMatrix, includedUsers: Number(e.target.value) })}
                      className={`${fieldClass} tabular-nums`}
                    />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="pm-unit-user">Valor por gestor extra (R$)</label>
                    <input
                      id="pm-unit-user"
                      name="userUnitPrice"
                      type="number"
                      min="0"
                      step="0.5"
                      value={pricingMatrix.userUnitPrice}
                      aria-invalid={invalidNonNeg(pricingMatrix.userUnitPrice) ? 'true' : undefined}
                      onChange={(e) => setPricingMatrix({ ...pricingMatrix, userUnitPrice: Number(e.target.value) })}
                      className={`${fieldClass} tabular-nums`}
                    />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="pm-unlim-user">Pacote Gestores Ilimitados (R$)</label>
                    <input
                      id="pm-unlim-user"
                      name="unlimitedUsersFee"
                      type="number"
                      min="0"
                      step="1"
                      value={pricingMatrix.unlimitedUsersFee}
                      aria-invalid={invalidNonNeg(pricingMatrix.unlimitedUsersFee) ? 'true' : undefined}
                      onChange={(e) => setPricingMatrix({ ...pricingMatrix, unlimitedUsersFee: Number(e.target.value) })}
                      className={`${fieldClass} tabular-nums`}
                    />
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-100 dark:border-zinc-800 space-y-3">
                  <p className={labelClass}>Preço mensal por módulo avulso (R$/mês)</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {FEATURES.map((f) => {
                      const val = pricingMatrix.featurePrices?.[f.id] ?? f.defaultPrice;
                      return (
                        <div key={f.id} className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-[#09090b] border border-slate-200/80 dark:border-zinc-800">
                          <label htmlFor={`pm-feat-${f.id}`} className="text-xs font-bold text-slate-700 dark:text-zinc-200 truncate">
                            {f.label}
                          </label>
                          <input
                            id={`pm-feat-${f.id}`}
                            name={`featurePrice_${f.id}`}
                            type="number"
                            min="0"
                            step="1"
                            value={val}
                            aria-invalid={invalidNonNeg(val) ? 'true' : undefined}
                            onChange={(e) =>
                              setPricingMatrix({
                                ...pricingMatrix,
                                featurePrices: {
                                  ...(pricingMatrix.featurePrices || {}),
                                  [f.id]: Number(e.target.value),
                                },
                              })
                            }
                            className="min-h-[44px] w-24 px-2.5 py-1.5 text-right font-mono font-bold text-xs tabular-nums rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] text-slate-900 dark:text-[#fafafa] placeholder:text-slate-400 dark:placeholder:text-zinc-500 transition-colors hover:border-slate-300 dark:hover:border-zinc-700 active:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:border-brand disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-zinc-900 aria-[invalid=true]:border-rose-500 aria-[invalid=true]:focus-visible:ring-rose-500"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={savingPricing}
                    className={`${btnPrimaryClass} uppercase tracking-wider`}
                  >
                    <Save size={14} aria-hidden="true" />
                    <span>{savingPricing ? 'Salvando matriz…' : 'Salvar Tabela de Custos'}</span>
                  </button>
                </div>
              </form>

              {/* SIMULADOR RÁPIDO MASTER */}
              <div className="lg:col-span-5 bg-white dark:bg-[#111113] rounded-2xl border border-slate-200 dark:border-zinc-800 p-6 shadow-sm space-y-4">
                <h3 className="text-sm font-black text-slate-900 dark:text-[#fafafa] flex items-center gap-2">
                  <Calculator size={16} className="text-brand-aa" aria-hidden="true" /> Simulador em Tempo Real
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass} htmlFor="sim-assets">Ativos</label>
                    <input
                      id="sim-assets"
                      name="simAssets"
                      type="number"
                      min="1"
                      value={simAssets}
                      aria-invalid={simAssets < 1 ? 'true' : undefined}
                      onChange={(e) => setSimAssets(Number(e.target.value) || 1)}
                      className={`${fieldClass} tabular-nums`}
                    />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="sim-users">Gestores</label>
                    <input
                      id="sim-users"
                      name="simUsers"
                      type="number"
                      min="1"
                      value={simUsers}
                      aria-invalid={simUsers < 1 ? 'true' : undefined}
                      onChange={(e) => setSimUsers(Number(e.target.value) || 1)}
                      className={`${fieldClass} tabular-nums`}
                    />
                  </div>
                </div>
                <div>
                  <label className={labelClass} htmlFor="sim-cycle">Ciclo</label>
                  <select
                    id="sim-cycle"
                    name="simCycle"
                    value={simCycle}
                    onChange={(e) => setSimCycle(e.target.value)}
                    className={`${fieldClass} cursor-pointer`}
                  >
                    {Object.values(BILLING_CYCLES).map((c) => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-wrap gap-2">
                  {FEATURES.map((f) => {
                    const on = Boolean(simFeatures[f.id]);
                    return (
                      <button
                        key={f.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setSimFeatures((prev) => ({ ...prev, [f.id]: !prev[f.id] }))}
                        className={`min-h-[44px] px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                          on
                            ? 'bg-brand text-brand-fg border-brand'
                            : 'bg-slate-50 dark:bg-[#09090b] text-slate-600 dark:text-zinc-300 border-slate-200 dark:border-zinc-800 hover:bg-slate-100 dark:hover:bg-zinc-800'
                        }`}
                      >
                        {f.label}
                      </button>
                    );
                  })}
                </div>
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#09090b] border border-slate-200 dark:border-zinc-800 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-600 dark:text-zinc-400">Subtotal bruto</span>
                    <span className="font-mono font-bold text-slate-900 dark:text-[#fafafa] tabular-nums">{brl.format(simulatorQuote.subtotalMonthly)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600 dark:text-zinc-400">Desconto do ciclo</span>
                    <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">-{brl.format(simulatorQuote.discountAmount)}</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-slate-200 dark:border-zinc-800 text-base font-black text-slate-900 dark:text-[#fafafa]">
                    <span>Mensalidade final</span>
                    <span className="font-mono text-brand-aa tabular-nums">{brl.format(simulatorQuote.finalMonthlyPrice)}/mês</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ABA 3 — EMPRESAS COM CONTRATOS SOB MEDIDA */}
          {activeTab === 'customs' && (
            <div className="bg-white dark:bg-[#111113] rounded-2xl border border-slate-200 dark:border-zinc-800 overflow-hidden shadow-sm">
              {filteredCustomTenants.length === 0 ? (
                <div className="p-12 text-center space-y-3">
                  <Sparkles size={32} className="mx-auto text-slate-400 dark:text-zinc-500" aria-hidden="true" />
                  <h2 className="text-base font-bold text-slate-900 dark:text-[#fafafa]">
                    {customTenants.length === 0 ? 'Nenhum contrato sob medida' : 'Nenhum contrato corresponde aos filtros'}
                  </h2>
                  <p className="text-xs text-slate-600 dark:text-zinc-400">
                    {hasActiveFilters
                      ? 'Limpe ou ajuste os filtros para visualizar todas as empresas com ajustes.'
                      : 'Nenhuma empresa configurou ajustes ou contrato personalizado até o momento.'}
                  </p>
                  {hasActiveFilters && (
                    <div className="pt-1">
                      <button type="button" onClick={clearFilters} className={btnSecondaryClass}>
                        Limpar filtros
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-zinc-800">
                  {filteredCustomTenants.map((t) => (
                    <li
                      key={t.id}
                      className="[content-visibility:auto] [contain-intrinsic-size:auto_56px] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-black text-slate-900 dark:text-[#fafafa] text-sm">
                            {t.companyName || t.id}
                          </span>
                          <TenantStatusBadge tenant={t} />
                          <PlanBadge tenant={{ ...t, entitlements: t.ent }} />
                          <span className="text-xs font-bold uppercase px-2 py-0.5 rounded bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300">
                            {BILLING_CYCLES[t.ent.billingCycle]?.label || 'Mensal'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 dark:text-zinc-400 mt-1 tabular-nums">
                          {t.ent.maxAssets === null ? 'Ativos ilimitados' : `${t.ent.maxAssets} ativos`} •{' '}
                          {t.ent.maxUsers === null ? 'Usuários ilimitados' : `${t.ent.maxUsers} gestores`} •{' '}
                          {FEATURES.filter((f) => t.ent.features?.[f.id]).length}/{FEATURES.length} módulos
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-lg font-black text-slate-900 dark:text-[#fafafa] font-mono tabular-nums">
                          {brl.format(t.ent.monthlyPrice)}<span className="text-xs text-slate-500 dark:text-zinc-400 font-normal">/mês</span>
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      {/* MODAL DE CRIAÇÃO OU EDIÇÃO DE MODELO */}
      {editing && (
        <div
          className="fixed inset-0 !mt-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 overscroll-contain animate-fade-in"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !savingPlan) closePlanModal();
          }}
        >
          <div
            ref={modalRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby={modalTitleId}
            className="bg-white dark:bg-[#111113] rounded-2xl border border-slate-200 dark:border-zinc-800 w-full max-w-2xl p-6 shadow-2xl space-y-5 max-h-[92vh] overflow-y-auto overscroll-contain animate-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-zinc-800">
              <div>
                <h2 id={modalTitleId} className="text-base font-black text-slate-900 dark:text-[#fafafa] flex items-center gap-2">
                  {editing.isNew ? <Plus size={16} className="text-brand-aa" aria-hidden="true" /> : <Edit3 size={16} className="text-brand-aa" aria-hidden="true" />}
                  <span>{editing.isNew ? 'Criar Novo Modelo de Plano' : `Editando: ${editing.name} (${editing.id})`}</span>
                </h2>
                <p className="text-xs text-slate-600 dark:text-zinc-400 mt-0.5">
                  Use &quot;unlimited&quot; nas cotas para pacotes sem limite.
                </p>
              </div>
              <button
                type="button"
                disabled={savingPlan}
                onClick={closePlanModal}
                aria-label="Fechar janela de modelo de plano"
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-[#fafafa] hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            {planFormError && (
              <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-bold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
                {planFormError}
              </p>
            )}

            <form onSubmit={handleSavePlan} className="space-y-5" noValidate>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                {editing.isNew && (
                  <div>
                    <label className={labelClass} htmlFor="plan-id">Identificador (slug)</label>
                    <input
                      ref={firstInputRef}
                      id="plan-id"
                      name="planId"
                      value={editing.id}
                      aria-invalid={planErrors.id ? 'true' : undefined}
                      onChange={(e) => {
                        setEditing({ ...editing, id: e.target.value });
                        if (planErrors.id) setPlanErrors((prev) => ({ ...prev, id: false }));
                      }}
                      placeholder="ex: growth"
                      className={`${fieldClass} font-mono`}
                    />
                  </div>
                )}
                <div className="md:col-span-2">
                  <label className={labelClass} htmlFor="plan-name">Nome de exibição</label>
                  <input
                    ref={editing.isNew ? undefined : firstInputRef}
                    id="plan-name"
                    name="planName"
                    value={editing.name}
                    aria-invalid={planErrors.name ? 'true' : undefined}
                    onChange={(e) => {
                      setEditing({ ...editing, name: e.target.value });
                      if (planErrors.name) setPlanErrors((prev) => ({ ...prev, name: false }));
                    }}
                    placeholder="Ex: Multi-Filial Flex"
                    required
                    className={fieldClass}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="plan-price">Mensalidade base (R$)</label>
                  <input
                    id="plan-price"
                    name="monthlyPrice"
                    type="number"
                    step="0.01"
                    min="0"
                    value={editing.monthlyPrice}
                    aria-invalid={planErrors.monthlyPrice ? 'true' : undefined}
                    onChange={(e) => {
                      setEditing({ ...editing, monthlyPrice: e.target.value });
                      if (planErrors.monthlyPrice) setPlanErrors((prev) => ({ ...prev, monthlyPrice: false }));
                    }}
                    required
                    className={`${fieldClass} tabular-nums`}
                  />
                </div>
                <div className={editing.isNew ? '' : 'md:col-span-2'}>
                  <label className={labelClass} htmlFor="plan-cycle">Ciclo padrão</label>
                  <select
                    id="plan-cycle"
                    name="billingCycle"
                    value={editing.billingCycle || 'monthly'}
                    onChange={(e) => setEditing({ ...editing, billingCycle: e.target.value })}
                    className={`${fieldClass} cursor-pointer`}
                  >
                    {Object.values(BILLING_CYCLES).map((c) => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass} htmlFor="plan-assets">Limite de ativos</label>
                  <input
                    id="plan-assets"
                    name="maxAssets"
                    value={editing.maxAssets}
                    aria-invalid={planErrors.maxAssets ? 'true' : undefined}
                    onChange={(e) => {
                      setEditing({ ...editing, maxAssets: e.target.value });
                      if (planErrors.maxAssets) setPlanErrors((prev) => ({ ...prev, maxAssets: false }));
                    }}
                    placeholder="unlimited ou nº"
                    required
                    className={`${fieldClass} tabular-nums`}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="plan-users">Limite de gestores / usuários</label>
                  <input
                    id="plan-users"
                    name="maxUsers"
                    value={editing.maxUsers}
                    aria-invalid={planErrors.maxUsers ? 'true' : undefined}
                    onChange={(e) => {
                      setEditing({ ...editing, maxUsers: e.target.value });
                      if (planErrors.maxUsers) setPlanErrors((prev) => ({ ...prev, maxUsers: false }));
                    }}
                    placeholder="unlimited ou nº"
                    required
                    className={`${fieldClass} tabular-nums`}
                  />
                </div>
              </div>

              <div>
                <p className={labelClass}>Módulos incluídos por padrão neste plano</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {FEATURES.map((f) => {
                    const checked = Boolean(editing.features?.[f.id]);
                    const checkboxId = `plan-feat-${f.id}`;
                    return (
                      <label
                        key={f.id}
                        htmlFor={checkboxId}
                        className={`min-h-[44px] flex items-center gap-2.5 p-3 rounded-xl border text-xs font-bold cursor-pointer transition-colors ${
                          checked
                            ? 'border-brand/50 bg-brand/5 text-slate-900 dark:text-[#fafafa]'
                            : 'border-slate-200 dark:border-zinc-800 text-slate-600 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-900'
                        }`}
                      >
                        <input
                          id={checkboxId}
                          name={`feature_${f.id}`}
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setEditing({
                              ...editing,
                              features: { ...editing.features, [f.id]: e.target.checked },
                            })
                          }
                          className="h-4 w-4 rounded accent-[var(--color-brand)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                        <span className="truncate">{f.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  disabled={savingPlan}
                  onClick={closePlanModal}
                  className={btnSecondaryClass}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingPlan}
                  className={`${btnPrimaryClass} uppercase tracking-wider`}
                >
                  <Save size={14} aria-hidden="true" />
                  <span>{savingPlan ? 'Salvando…' : 'Salvar Modelo'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default NexusPlansManager;
