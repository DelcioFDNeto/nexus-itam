// src/pages/NexusPlansManager.jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calculator,
  Check,
  Edit3,
  Layers,
  Plus,
  RefreshCcw,
  Save,
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
import { useConfirm } from '../components/ConfirmDialog';

const fieldClass =
  'w-full px-3 py-2.5 bg-gray-50 dark:bg-slate-950 border border-gray-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-brand text-sm font-semibold text-gray-900 dark:text-white';
const labelClass =
  'block text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5';

const CORE_PLAN_IDS = new Set(['starter', 'pro', 'enterprise']);

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

const NexusPlansManager = () => {
  const confirm = useConfirm();
  const [activeTab, setActiveTab] = useState('catalog');
  const [plans, setPlans] = useState({});
  const [tenants, setTenants] = useState([]);
  const [pricingMatrix, setPricingMatrix] = useState(DEFAULT_PRICING_MATRIX);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [savingPlan, setSavingPlan] = useState(false);
  const [savingPricing, setSavingPricing] = useState(false);

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
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [loadedPlans, loadedPricing, tenantsSnap] = await Promise.all([
        loadPlans(),
        loadPricingMatrix(),
        getDocs(collection(db, 'tenants')),
      ]);
      setPlans(loadedPlans);
      setPricingMatrix(loadedPricing);
      setTenants(tenantsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (error) {
      console.error('Erro ao carregar planos:', error);
      toast.error('Falha ao carregar o catálogo de planos e custos.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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

  const startEdit = (plan) => {
    const featureMap = {};
    FEATURES.forEach((f) => {
      const val = plan.features?.[f.id] ?? (f.planKey ? plan[f.planKey] : true);
      featureMap[f.id] = val !== false;
    });
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
    setEditing(emptyPlanForm());
  };

  const parseLimit = (raw) => {
    const clean = String(raw ?? '').trim().toLowerCase();
    if (!clean || clean === 'unlimited' || clean === 'ilimitado' || clean === '-1') return UNLIMITED;
    const n = Number(clean);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
  };

  const handleSavePlan = async (e) => {
    e.preventDefault();
    if (!editing) return;

    const cleanId = editing.isNew
      ? String(editing.id || editing.name)
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
      : editing.id;

    if (!cleanId) {
      toast.error('Informe um identificador válido para o plano.');
      return;
    }

    const maxAssets = parseLimit(editing.maxAssets);
    const maxUsers = parseLimit(editing.maxUsers);
    const monthlyPrice = Number(editing.monthlyPrice);
    if (maxAssets === null || maxUsers === null || !Number.isFinite(monthlyPrice) || monthlyPrice < 0) {
      toast.error('Preencha valores válidos para cotas e mensalidade (use "unlimited" para ilimitado).');
      return;
    }

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
        features: editing.features,
      });
      toast.success(editing.isNew ? `Plano "${editing.name}" criado no catálogo.` : `Plano "${editing.name}" atualizado.`);
      setEditing(null);
      load();
    } catch (error) {
      console.error('Erro ao salvar plano:', error);
      toast.error(describeFirebaseError(error, 'Falha ao gravar o plano.'));
    } finally {
      setSavingPlan(false);
    }
  };

  const handleDeletePlan = async (plan) => {
    if (CORE_PLAN_IDS.has(plan.id)) return;
    const ok = await confirm({
      title: 'Excluir Modelo de Plano',
      message: `Remover o modelo "${plan.name}" do catálogo? Empresas que já usam esse plano manterão suas cotas.`,
      danger: true,
      confirmLabel: 'Excluir',
    });
    if (!ok) return;
    try {
      await deletePlanTemplate(plan.id);
      toast.success(`Modelo "${plan.name}" removido.`);
      load();
    } catch (error) {
      console.error(error);
      toast.error(describeFirebaseError(error, 'Falha ao remover modelo.'));
    }
  };

  const handleSavePricing = async (e) => {
    e.preventDefault();
    setSavingPricing(true);
    try {
      const normalized = sanitizePricingMatrix(pricingMatrix);
      await savePricingMatrix(normalized);
      setPricingMatrix(normalized);
      toast.success('Tabela de custos unitários atualizada! Todas as empresas verão os novos valores.');
    } catch (error) {
      console.error('Erro ao salvar tabela de custos:', error);
      toast.error(describeFirebaseError(error, 'Falha ao gravar tabela de custos.'));
    } finally {
      setSavingPricing(false);
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

  return (
    <div className="max-w-7xl mx-auto pb-24 space-y-6">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200/90 dark:border-slate-800 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand/10 border border-brand/20 text-brand flex items-center justify-center shrink-0">
            <Layers size={20} />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
              Planos, Contratos & Matriz de Custos
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Gerencie os modelos de assinatura, regras de cálculo modular sob medida e descontos por ciclo.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={startCreate}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-brand hover:bg-brand-dark text-white rounded-xl font-bold text-xs shadow-sm transition-colors"
          >
            <Plus size={15} /> Novo Modelo de Plano
          </button>
          <button
            type="button"
            onClick={load}
            className="flex items-center gap-1.5 p-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl transition-colors border border-slate-200/80 dark:border-slate-700"
            title="Recarregar"
            aria-label="Recarregar"
          >
            <RefreshCcw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* NAVEGAÇÃO POR ABAS */}
      <div className="flex flex-wrap gap-2 bg-white dark:bg-slate-900 p-1.5 rounded-2xl border border-slate-200 dark:border-slate-800 w-fit shadow-sm">
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
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                active
                  ? 'bg-brand text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Icon size={14} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* MODAL / CARD DE CRIAÇÃO OU EDIÇÃO DE MODELO */}
      {editing && (
        <form
          onSubmit={handleSavePlan}
          className="bg-white dark:bg-slate-900 rounded-2xl border-2 border-brand/40 p-6 shadow-xl space-y-5 animate-fade-in"
        >
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-gray-100 dark:border-slate-800">
            <div>
              <h2 className="text-base font-black text-gray-900 dark:text-white flex items-center gap-2">
                {editing.isNew ? <Plus size={16} className="text-brand" /> : <Edit3 size={16} className="text-brand" />}
                {editing.isNew ? 'Criar Novo Modelo de Plano' : `Editando: ${editing.name} (${editing.id})`}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Use &quot;unlimited&quot; nas cotas para pacotes sem limite.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="p-2 rounded-xl text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X size={16} />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {editing.isNew && (
              <div>
                <label className={labelClass} htmlFor="plan-id">Identificador (slug)</label>
                <input
                  id="plan-id"
                  value={editing.id}
                  onChange={(e) => setEditing({ ...editing, id: e.target.value })}
                  placeholder="ex: growth"
                  className={`${fieldClass} font-mono`}
                />
              </div>
            )}
            <div className={editing.isNew ? 'md:col-span-2' : 'md:col-span-2'}>
              <label className={labelClass} htmlFor="plan-name">Nome de exibição</label>
              <input
                id="plan-name"
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="Ex: Multi-Filial Flex"
                required
                className={fieldClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="plan-price">Mensalidade base (R$)</label>
              <input
                id="plan-price"
                type="number"
                step="0.01"
                min="0"
                value={editing.monthlyPrice}
                onChange={(e) => setEditing({ ...editing, monthlyPrice: e.target.value })}
                required
                className={fieldClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="plan-cycle">Ciclo padrão</label>
              <select
                id="plan-cycle"
                value={editing.billingCycle || 'monthly'}
                onChange={(e) => setEditing({ ...editing, billingCycle: e.target.value })}
                className={fieldClass}
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
                value={editing.maxAssets}
                onChange={(e) => setEditing({ ...editing, maxAssets: e.target.value })}
                placeholder="unlimited ou nº"
                required
                className={fieldClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="plan-users">Limite de gestores / usuários</label>
              <input
                id="plan-users"
                value={editing.maxUsers}
                onChange={(e) => setEditing({ ...editing, maxUsers: e.target.value })}
                placeholder="unlimited ou nº"
                required
                className={fieldClass}
              />
            </div>
          </div>

          <div>
            <p className={labelClass}>Módulos incluídos por padrão neste plano</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {FEATURES.map((f) => {
                const checked = Boolean(editing.features?.[f.id]);
                return (
                  <label
                    key={f.id}
                    className={`flex items-center gap-2.5 p-3 rounded-xl border text-xs font-bold cursor-pointer transition-colors ${
                      checked
                        ? 'border-brand/50 bg-brand/5 text-slate-900 dark:text-white'
                        : 'border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          features: { ...editing.features, [f.id]: e.target.checked },
                        })
                      }
                      className="rounded accent-[var(--color-brand)]"
                    />
                    <span className="truncate">{f.label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="px-4 py-2.5 rounded-xl text-xs font-black uppercase text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={savingPlan}
              className="px-5 py-2.5 rounded-xl bg-brand hover:bg-brand-dark text-white text-xs font-black uppercase flex items-center gap-2 disabled:opacity-60 shadow-sm"
            >
              <Save size={14} /> {savingPlan ? 'Salvando...' : 'Salvar Modelo'}
            </button>
          </div>
        </form>
      )}

      {/* ABA 1 — MODELOS DE PLANOS */}
      {activeTab === 'catalog' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {Object.values(plans).map((plan) => {
            const s = stats[plan.id] || { count: 0, customCount: 0, mrr: 0, blocked: 0 };
            const isCore = CORE_PLAN_IDS.has(plan.id);
            const resolved = resolveEntitlements({ tenant: { plan: plan.id }, plan });
            return (
              <div
                key={plan.id}
                className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm flex flex-col justify-between gap-5"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-widest text-brand">
                        {plan.id}
                      </span>
                      <h2 className="text-lg font-black text-gray-900 dark:text-white">{plan.name}</h2>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => startEdit(plan)}
                        className="p-2 rounded-xl border border-gray-200 dark:border-slate-700 text-gray-500 hover:text-brand hover:border-brand/40"
                        title="Editar modelo"
                        aria-label={`Editar ${plan.name}`}
                      >
                        <Edit3 size={14} />
                      </button>
                      {!isCore && (
                        <button
                          type="button"
                          onClick={() => handleDeletePlan(plan)}
                          className="p-2 rounded-xl border border-rose-200 dark:border-rose-900/50 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                          title="Excluir modelo customizado"
                          aria-label={`Excluir ${plan.name}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>

                  <p className="mt-4 flex items-baseline gap-1">
                    <span className="text-3xl font-black text-gray-900 dark:text-white tracking-tight tabular-nums">
                      {brl.format(Number(plan.monthlyPrice) || 0)}
                    </span>
                    <span className="text-xs font-bold text-gray-400">/mês base</span>
                  </p>

                  <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-xl bg-gray-50 dark:bg-slate-950/70 p-2.5 border border-slate-100 dark:border-slate-800">
                      <dt className="text-[10px] font-bold uppercase text-gray-400">Ativos</dt>
                      <dd className="font-black text-gray-800 dark:text-gray-100 tabular-nums">
                        {isUnlimited(plan.maxAssets) ? 'Ilimitado' : Number(plan.maxAssets).toLocaleString('pt-BR')}
                      </dd>
                    </div>
                    <div className="rounded-xl bg-gray-50 dark:bg-slate-950/70 p-2.5 border border-slate-100 dark:border-slate-800">
                      <dt className="text-[10px] font-bold uppercase text-gray-400">Gestores</dt>
                      <dd className="font-black text-gray-800 dark:text-gray-100 tabular-nums">
                        {isUnlimited(plan.maxUsers) ? 'Ilimitado' : Number(plan.maxUsers).toLocaleString('pt-BR')}
                      </dd>
                    </div>
                  </dl>

                  <ul className="mt-4 space-y-1.5">
                    {FEATURES.map((f) => {
                      const on = Boolean(resolved.features?.[f.id]);
                      return (
                        <li
                          key={f.id}
                          className={`flex items-center gap-2 text-xs font-semibold ${
                            on ? 'text-gray-700 dark:text-gray-200' : 'text-gray-400 dark:text-gray-600 line-through'
                          }`}
                        >
                          <span
                            className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${
                              on
                                ? 'bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400'
                                : 'bg-gray-100 text-gray-400 dark:bg-slate-800'
                            }`}
                          >
                            {on ? <Check size={10} /> : <X size={10} />}
                          </span>
                          <span>{f.label}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                <div className="border-t border-gray-100 dark:border-slate-800 pt-4 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-bold text-gray-600 dark:text-gray-300">
                      {s.count} {s.count === 1 ? 'empresa' : 'empresas'}
                    </span>
                    {s.customCount > 0 && (
                      <span className="ml-1.5 text-[10px] font-bold text-brand">
                        ({s.customCount} sob medida)
                      </span>
                    )}
                  </div>
                  <span className="font-black text-gray-900 dark:text-white tabular-nums">
                    MRR {brl.format(s.mrr)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ABA 2 — MATRIZ DE CUSTOS UNITÁRIOS & SIMULADOR */}
      {activeTab === 'pricing' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <form
            onSubmit={handleSavePricing}
            className="lg:col-span-7 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm space-y-5"
          >
            <div>
              <h2 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                <Sliders size={16} className="text-brand" /> Regra de Precificação Modular (/plans/_pricing)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Define o custo unitário que as empresas visualizam ao montar seu próprio plano sob medida.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className={labelClass} htmlFor="pm-base">Taxa Base Plataforma (R$/mês)</label>
                <input
                  id="pm-base"
                  type="number"
                  min="0"
                  step="0.01"
                  value={pricingMatrix.baseFee}
                  onChange={(e) => setPricingMatrix({ ...pricingMatrix, baseFee: Number(e.target.value) })}
                  className={fieldClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="pm-qdisc">Desconto Trimestral (%)</label>
                <input
                  id="pm-qdisc"
                  type="number"
                  min="0"
                  max="80"
                  value={pricingMatrix.quarterlyDiscountPct}
                  onChange={(e) => setPricingMatrix({ ...pricingMatrix, quarterlyDiscountPct: Number(e.target.value) })}
                  className={fieldClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="pm-adisc">Desconto Anual (%)</label>
                <input
                  id="pm-adisc"
                  type="number"
                  min="0"
                  max="80"
                  value={pricingMatrix.annualDiscountPct}
                  onChange={(e) => setPricingMatrix({ ...pricingMatrix, annualDiscountPct: Number(e.target.value) })}
                  className={fieldClass}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div>
                <label className={labelClass} htmlFor="pm-inc-assets">Ativos inclusos na base</label>
                <input
                  id="pm-inc-assets"
                  type="number"
                  min="0"
                  value={pricingMatrix.includedAssets}
                  onChange={(e) => setPricingMatrix({ ...pricingMatrix, includedAssets: Number(e.target.value) })}
                  className={fieldClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="pm-unit-asset">Valor por ativo extra (R$)</label>
                <input
                  id="pm-unit-asset"
                  type="number"
                  min="0"
                  step="0.05"
                  value={pricingMatrix.assetUnitPrice}
                  onChange={(e) => setPricingMatrix({ ...pricingMatrix, assetUnitPrice: Number(e.target.value) })}
                  className={fieldClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="pm-unlim-asset">Pacote Ativos Ilimitados (R$)</label>
                <input
                  id="pm-unlim-asset"
                  type="number"
                  min="0"
                  step="1"
                  value={pricingMatrix.unlimitedAssetsFee}
                  onChange={(e) => setPricingMatrix({ ...pricingMatrix, unlimitedAssetsFee: Number(e.target.value) })}
                  className={fieldClass}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div>
                <label className={labelClass} htmlFor="pm-inc-users">Gestores inclusos na base</label>
                <input
                  id="pm-inc-users"
                  type="number"
                  min="0"
                  value={pricingMatrix.includedUsers}
                  onChange={(e) => setPricingMatrix({ ...pricingMatrix, includedUsers: Number(e.target.value) })}
                  className={fieldClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="pm-unit-user">Valor por gestor extra (R$)</label>
                <input
                  id="pm-unit-user"
                  type="number"
                  min="0"
                  step="0.5"
                  value={pricingMatrix.userUnitPrice}
                  onChange={(e) => setPricingMatrix({ ...pricingMatrix, userUnitPrice: Number(e.target.value) })}
                  className={fieldClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="pm-unlim-user">Pacote Gestores Ilimitados (R$)</label>
                <input
                  id="pm-unlim-user"
                  type="number"
                  min="0"
                  step="1"
                  value={pricingMatrix.unlimitedUsersFee}
                  onChange={(e) => setPricingMatrix({ ...pricingMatrix, unlimitedUsersFee: Number(e.target.value) })}
                  className={fieldClass}
                />
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-3">
              <p className={labelClass}>Preço mensal por módulo avulso (R$/mês)</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {FEATURES.map((f) => (
                  <div key={f.id} className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800">
                    <label htmlFor={`pm-feat-${f.id}`} className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">
                      {f.label}
                    </label>
                    <input
                      id={`pm-feat-${f.id}`}
                      type="number"
                      min="0"
                      step="1"
                      value={pricingMatrix.featurePrices?.[f.id] ?? f.defaultPrice}
                      onChange={(e) =>
                        setPricingMatrix({
                          ...pricingMatrix,
                          featurePrices: {
                            ...(pricingMatrix.featurePrices || {}),
                            [f.id]: Number(e.target.value),
                          },
                        })
                      }
                      className="w-24 px-2.5 py-1.5 text-right font-mono font-bold text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={savingPricing}
                className="px-5 py-2.5 rounded-xl bg-brand hover:bg-brand-dark text-white text-xs font-black uppercase flex items-center gap-2 shadow-sm disabled:opacity-60"
              >
                <Save size={14} /> {savingPricing ? 'Salvando matriz...' : 'Salvar Tabela de Custos'}
              </button>
            </div>
          </form>

          {/* SIMULADOR RÁPIDO MASTER */}
          <div className="lg:col-span-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
              <Calculator size={16} className="text-brand" /> Simulador em Tempo Real
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass} htmlFor="sim-assets">Ativos</label>
                <input
                  id="sim-assets"
                  type="number"
                  min="1"
                  value={simAssets}
                  onChange={(e) => setSimAssets(Number(e.target.value) || 1)}
                  className={fieldClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="sim-users">Gestores</label>
                <input
                  id="sim-users"
                  type="number"
                  min="1"
                  value={simUsers}
                  onChange={(e) => setSimUsers(Number(e.target.value) || 1)}
                  className={fieldClass}
                />
              </div>
            </div>
            <div>
              <label className={labelClass} htmlFor="sim-cycle">Ciclo</label>
              <select
                id="sim-cycle"
                value={simCycle}
                onChange={(e) => setSimCycle(e.target.value)}
                className={fieldClass}
              >
                {Object.values(BILLING_CYCLES).map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FEATURES.map((f) => {
                const on = Boolean(simFeatures[f.id]);
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setSimFeatures((prev) => ({ ...prev, [f.id]: !prev[f.id] }))}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors ${
                      on
                        ? 'bg-brand text-white border-brand'
                        : 'bg-slate-50 dark:bg-slate-950 text-slate-500 border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Subtotal bruto</span>
                <span className="font-mono font-bold tabular-nums">{brl.format(simulatorQuote.subtotalMonthly)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Desconto do ciclo</span>
                <span className="font-mono font-bold text-emerald-600 tabular-nums">-{brl.format(simulatorQuote.discountAmount)}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-slate-200 dark:border-slate-800 text-base font-black text-slate-900 dark:text-white">
                <span>Mensalidade final</span>
                <span className="font-mono text-brand tabular-nums">{brl.format(simulatorQuote.finalMonthlyPrice)}/mês</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ABA 3 — EMPRESAS COM CONTRATOS SOB MEDIDA */}
      {activeTab === 'customs' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
          {customTenants.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-400">
              Nenhuma empresa configurou ajustes ou contrato personalizado até o momento.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {customTenants.map((t) => (
                <div key={t.id} className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-black text-slate-900 dark:text-white text-sm">
                        {t.companyName || t.id}
                      </span>
                      <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-brand/10 text-brand border border-brand/20">
                        {t.ent.planName}
                      </span>
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                        {BILLING_CYCLES[t.ent.billingCycle]?.label || 'Mensal'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      {t.ent.maxAssets === null ? 'Ativos ilimitados' : `${t.ent.maxAssets} ativos`} •{' '}
                      {t.ent.maxUsers === null ? 'Usuários ilimitados' : `${t.ent.maxUsers} gestores`} •{' '}
                      {FEATURES.filter((f) => t.ent.features?.[f.id]).length}/{FEATURES.length} módulos
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-black text-slate-900 dark:text-white font-mono tabular-nums">
                      {brl.format(t.ent.monthlyPrice)}<span className="text-xs text-slate-400 font-normal">/mês</span>
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default NexusPlansManager;
