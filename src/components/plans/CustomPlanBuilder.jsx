// src/components/plans/CustomPlanBuilder.jsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CheckCircle2,
  Infinity as InfinityIcon,
  Layers,
  Laptop,
  Receipt,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import {
  BILLING_CYCLES,
  CUSTOM_PLAN_ID,
  DEFAULT_PLANS,
  DEFAULT_PRICING_MATRIX,
  FEATURES,
  UNLIMITED,
  buildCustomContractPayload,
  calculateCustomPlanQuote,
  isUnlimited,
  sanitizePricingMatrix,
} from '../../utils/entitlements';

const formatBrl = (value) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);

const normalizeInitialFeatures = (initialOverrides = {}, basePlan = null) => {
  const result = {};
  FEATURES.forEach((f) => {
    const over = initialOverrides?.features?.[f.id];
    if (typeof over === 'boolean') {
      result[f.id] = over;
    } else if (basePlan) {
      const fromPlan =
        basePlan.features?.[f.id] ?? (f.planKey ? basePlan[f.planKey] : undefined);
      result[f.id] = fromPlan === undefined ? true : Boolean(fromPlan);
    } else {
      result[f.id] = true;
    }
  });
  return result;
};

const ASSET_PRESETS = [50, 150, 350, 1000, 2500];
const USER_PRESETS = [5, 15, 30, 50, 100];

const clampMaxAssets = (value) => Math.min(100000, Math.max(1, Math.floor(Number(value) || 1)));
const clampMaxUsers = (value) => Math.min(10000, Math.max(1, Math.floor(Number(value) || 1)));
const clampDiscountPct = (value) => Math.min(80, Math.max(0, Number(value) || 0));

const deriveBuilderState = ({
  plans,
  initialPlanId,
  initialOverrides,
  initialCustomContract,
}) => {
  const normalizedInitialPlanId = String(initialPlanId || CUSTOM_PLAN_ID).toLowerCase();
  const initialBasePlan =
    plans?.[normalizedInitialPlanId] ||
    DEFAULT_PLANS[normalizedInitialPlanId] ||
    null;

  const initialAssetsRaw =
    initialOverrides?.maxAssets !== undefined
      ? initialOverrides.maxAssets
      : initialBasePlan?.maxAssets ?? 100;
  const initialUsersRaw =
    initialOverrides?.maxUsers !== undefined
      ? initialOverrides.maxUsers
      : initialBasePlan?.maxUsers ?? 10;

  const selectedPreset = normalizedInitialPlanId || CUSTOM_PLAN_ID;
  const assetsUnlimited = isUnlimited(initialAssetsRaw);
  const maxAssets = assetsUnlimited ? 1000 : clampMaxAssets(Number(initialAssetsRaw) || 100);
  const usersUnlimited = isUnlimited(initialUsersRaw);
  const maxUsers = usersUnlimited ? 50 : clampMaxUsers(Number(initialUsersRaw) || 10);
  const features = normalizeInitialFeatures(initialOverrides, initialBasePlan);
  const rawCycle =
    initialOverrides?.billingCycle ||
    initialCustomContract?.billingCycle ||
    initialBasePlan?.billingCycle ||
    'monthly';
  const billingCycle = BILLING_CYCLES[rawCycle] ? rawCycle : 'monthly';
  const customDiscountPct = clampDiscountPct(initialCustomContract?.negotiatedDiscountPct || 0);
  const manualPrice =
    initialCustomContract?.mode === 'negotiated' && initialOverrides?.monthlyPrice !== undefined
      ? String(initialOverrides.monthlyPrice)
      : '';
  const notes = String(initialCustomContract?.notes || '');

  return {
    selectedPreset,
    assetsUnlimited,
    maxAssets,
    usersUnlimited,
    maxUsers,
    features,
    billingCycle,
    customDiscountPct,
    manualPrice,
    notes,
  };
};

const buildStateSnapshot = ({
  selectedPreset,
  assetsUnlimited,
  maxAssets,
  usersUnlimited,
  maxUsers,
  features,
  billingCycle,
  customDiscountPct,
  manualPrice,
  notes,
  isMasterMode = false,
}) => {
  const normalizedManual =
    isMasterMode && manualPrice !== '' && Number.isFinite(Number(manualPrice))
      ? Math.max(0, Number(manualPrice))
      : '';
  return JSON.stringify({
    selectedPreset: String(selectedPreset || CUSTOM_PLAN_ID).toLowerCase(),
    assetsUnlimited: Boolean(assetsUnlimited),
    maxAssets: assetsUnlimited ? UNLIMITED : clampMaxAssets(maxAssets),
    usersUnlimited: Boolean(usersUnlimited),
    maxUsers: usersUnlimited ? UNLIMITED : clampMaxUsers(maxUsers),
    features: FEATURES.map((f) => [f.id, Boolean(features[f.id])]),
    billingCycle: BILLING_CYCLES[billingCycle] ? billingCycle : 'monthly',
    customDiscountPct: isMasterMode ? clampDiscountPct(customDiscountPct) : 0,
    manualPrice: normalizedManual,
    notes: String(notes ?? ''),
  });
};

/**
 * Montador interativo de Planos & Contratos Personalizados (compartilhado entre
 * a tela da empresa cliente e o Console Nexus Master).
 */
const CustomPlanBuilder = ({
  mode = 'tenant',
  plans = DEFAULT_PLANS,
  pricing = DEFAULT_PRICING_MATRIX,
  initialPlanId = 'starter',
  initialOverrides = {},
  initialCustomContract = {},
  currentEntitlements = null,
  usage = null,
  usageUnavailable = false,
  readOnly = false,
  saving = false,
  onApplyContract,
  onResetToPlan,
  compact = false,
}) => {
  const matrix = useMemo(() => sanitizePricingMatrix(pricing), [pricing]);
  const isMasterMode = mode === 'master';

  const propsState = useMemo(
    () =>
      deriveBuilderState({
        plans,
        initialPlanId,
        initialOverrides,
        initialCustomContract,
      }),
    [plans, initialPlanId, initialOverrides, initialCustomContract],
  );

  const propsSnapshot = useMemo(
    () => buildStateSnapshot({ ...propsState, isMasterMode }),
    [propsState, isMasterMode],
  );

  const [draft, setDraft] = useState(null);
  const [savedOverride, setSavedOverride] = useState(null);

  const baseState = useMemo(
    () =>
      savedOverride && savedOverride.forPropsSnapshot === propsSnapshot
        ? savedOverride.state
        : propsState,
    [savedOverride, propsSnapshot, propsState],
  );

  const savedSnapshot = useMemo(
    () => buildStateSnapshot({ ...baseState, isMasterMode }),
    [baseState, isMasterMode],
  );

  const activeDraftValid = Boolean(
    draft &&
      (draft.forSavedSnapshot === savedSnapshot ||
        buildStateSnapshot({ ...draft.state, isMasterMode }) !== draft.baselineSnapshot),
  );
  const activeState = activeDraftValid ? draft.state : baseState;

  const {
    selectedPreset,
    assetsUnlimited,
    maxAssets,
    usersUnlimited,
    maxUsers,
    features,
    billingCycle,
    customDiscountPct,
    manualPrice,
    notes,
  } = activeState;

  const updateDraft = (updater) => {
    setDraft((prev) => {
      const prevValid = Boolean(
        prev &&
          (prev.forSavedSnapshot === savedSnapshot ||
            buildStateSnapshot({ ...prev.state, isMasterMode }) !== prev.baselineSnapshot),
      );
      const current = prevValid ? prev.state : baseState;
      const next = typeof updater === 'function' ? updater(current) : { ...current, ...updater };
      return {
        forSavedSnapshot: savedSnapshot,
        baselineSnapshot: savedSnapshot,
        state: next,
      };
    });
  };

  const currentSnapshot = useMemo(
    () =>
      buildStateSnapshot({
        selectedPreset,
        assetsUnlimited,
        maxAssets,
        usersUnlimited,
        maxUsers,
        features,
        billingCycle,
        customDiscountPct,
        manualPrice,
        notes,
        isMasterMode,
      }),
    [
      selectedPreset,
      assetsUnlimited,
      maxAssets,
      usersUnlimited,
      maxUsers,
      features,
      billingCycle,
      customDiscountPct,
      manualPrice,
      notes,
      isMasterMode,
    ],
  );

  const isDirty = !readOnly && currentSnapshot !== savedSnapshot;

  useEffect(() => {
    if (!isDirty) return undefined;
    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const effectiveMaxAssets = assetsUnlimited
    ? UNLIMITED
    : clampMaxAssets(maxAssets);
  const effectiveMaxUsers = usersUnlimited
    ? UNLIMITED
    : clampMaxUsers(maxUsers);
  const effectiveDiscountPct = isMasterMode ? clampDiscountPct(customDiscountPct) : 0;

  const quote = useMemo(
    () =>
      calculateCustomPlanQuote({
        maxAssets: effectiveMaxAssets,
        maxUsers: effectiveMaxUsers,
        features,
        billingCycle,
        pricing: matrix,
        customDiscountPct: effectiveDiscountPct,
      }),
    [effectiveMaxAssets, effectiveMaxUsers, features, billingCycle, matrix, effectiveDiscountPct],
  );

  const hasManualPrice =
    isMasterMode && manualPrice !== '' && Number.isFinite(Number(manualPrice));
  const finalMonthlyPrice = hasManualPrice
    ? Math.max(0, Number(manualPrice))
    : quote.finalMonthlyPrice;

  const assetsUsageUnavailable =
    typeof usageUnavailable === 'boolean' ? usageUnavailable : Boolean(usageUnavailable?.assets);
  const usersUsageUnavailable =
    typeof usageUnavailable === 'boolean' ? usageUnavailable : Boolean(usageUnavailable?.users);

  const currentAssetsQuota = currentEntitlements?.maxAssets;
  const currentUsersQuota = currentEntitlements?.maxUsers;

  const assetsDownsizeBlocked =
    assetsUsageUnavailable &&
    !assetsUnlimited &&
    (!currentEntitlements ||
      currentAssetsQuota === null ||
      currentAssetsQuota === undefined ||
      Number(effectiveMaxAssets) < Number(currentAssetsQuota));
  const usersDownsizeBlocked =
    usersUsageUnavailable &&
    !usersUnlimited &&
    (!currentEntitlements ||
      currentUsersQuota === null ||
      currentUsersQuota === undefined ||
      Number(effectiveMaxUsers) < Number(currentUsersQuota));

  const assetsExceededUsage =
    !assetsUnlimited && usage?.assets > 0 && Number(effectiveMaxAssets) < usage.assets;
  const usersExceededUsage =
    !usersUnlimited && usage?.users > 0 && Number(effectiveMaxUsers) < usage.users;

  const assetsConflict = assetsExceededUsage || assetsDownsizeBlocked;
  const usersConflict = usersExceededUsage || usersDownsizeBlocked;
  const hasConflict = assetsConflict || usersConflict;

  const currentPrice = Number(currentEntitlements?.monthlyPrice ?? 0);
  const priceDelta = finalMonthlyPrice - currentPrice;

  const applyPresetTemplate = (planId) => {
    if (planId === CUSTOM_PLAN_ID) {
      updateDraft((prev) => ({ ...prev, selectedPreset: planId }));
      return;
    }
    const tpl = plans?.[planId] || DEFAULT_PLANS[planId];
    if (!tpl) {
      updateDraft((prev) => ({ ...prev, selectedPreset: planId }));
      return;
    }

    const tplAssetsUnlim = isUnlimited(tpl.maxAssets);
    const tplUsersUnlim = isUnlimited(tpl.maxUsers);
    updateDraft((prev) => ({
      ...prev,
      selectedPreset: planId,
      assetsUnlimited: tplAssetsUnlim,
      maxAssets: tplAssetsUnlim ? prev.maxAssets : clampMaxAssets(tpl.maxAssets || 100),
      usersUnlimited: tplUsersUnlim,
      maxUsers: tplUsersUnlim ? prev.maxUsers : clampMaxUsers(tpl.maxUsers || 10),
      features: normalizeInitialFeatures({}, tpl),
      billingCycle:
        tpl.billingCycle && BILLING_CYCLES[tpl.billingCycle] ? tpl.billingCycle : prev.billingCycle,
      manualPrice: '',
    }));
  };

  const toggleFeature = (featureId) => {
    if (readOnly) return;
    updateDraft((prev) => ({
      ...prev,
      selectedPreset: CUSTOM_PLAN_ID,
      features: { ...prev.features, [featureId]: !prev.features[featureId] },
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (readOnly || hasConflict || saving || !onApplyContract) return;

    const normalizedAssets = assetsUnlimited ? UNLIMITED : clampMaxAssets(maxAssets);
    const normalizedUsers = usersUnlimited ? UNLIMITED : clampMaxUsers(maxUsers);
    const normalizedDiscount = isMasterMode ? clampDiscountPct(customDiscountPct) : 0;
    const normalizedManual =
      isMasterMode && manualPrice !== '' && Number.isFinite(Number(manualPrice))
        ? String(Math.max(0, Number(manualPrice)))
        : '';
    const normalizedNotes = String(notes ?? '').trim().slice(0, 600);

    const submittedState = {
      selectedPreset,
      assetsUnlimited,
      maxAssets: assetsUnlimited ? activeState.maxAssets : normalizedAssets,
      usersUnlimited,
      maxUsers: usersUnlimited ? activeState.maxUsers : normalizedUsers,
      features,
      billingCycle,
      customDiscountPct: isMasterMode ? normalizedDiscount : activeState.customDiscountPct,
      manualPrice: isMasterMode ? normalizedManual : activeState.manualPrice,
      notes: normalizedNotes,
    };
    updateDraft(submittedState);

    const payload = buildCustomContractPayload({
      planId: selectedPreset === CUSTOM_PLAN_ID ? CUSTOM_PLAN_ID : selectedPreset,
      maxAssets: normalizedAssets,
      maxUsers: normalizedUsers,
      features,
      billingCycle,
      manualMonthlyPrice: normalizedManual !== '' ? Number(normalizedManual) : null,
      customDiscountPct: normalizedDiscount,
      pricing: matrix,
      notes: normalizedNotes,
      configuredBy: isMasterMode ? 'master' : 'tenant',
    });
    if (isMasterMode) {
      payload.customContract.negotiatedDiscountPct = normalizedDiscount;
    }

    Promise.resolve(onApplyContract(payload, quote))
      .then(() => {
        setSavedOverride({ forPropsSnapshot: propsSnapshot, state: submittedState });
        setDraft(null);
      })
      .catch(() => {});
  };

  const orderedPlans = useMemo(() => {
    const list = Object.values(plans || DEFAULT_PLANS).filter(
      (p) => p && p.id && p.id !== '_pricing',
    );
    return list;
  }, [plans]);

  const activeFeaturesCount = useMemo(
    () => FEATURES.filter((f) => features[f.id]).length,
    [features],
  );

  return (
    <form
      onSubmit={handleSubmit}
      className={`grid grid-cols-1 ${compact ? 'gap-5' : 'lg:grid-cols-12 gap-6 items-start'}`}
    >
      {/* COLUNA ESQUERDA — CONFIGURADOR MODULAR */}
      <div className={`${compact ? '' : 'lg:col-span-7 xl:col-span-8'} space-y-5`}>
        {/* 1. Modelos Base / Modo Personalizado */}
        <section className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-5 space-y-3 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-black text-slate-900 dark:text-[#fafafa] flex items-center gap-2">
                <Sparkles size={16} className="text-brand-aa" /> Ponto de Partida do Contrato
              </h2>
              <p className="text-xs text-slate-500 dark:text-zinc-400">
                Comece por um modelo sugerido ou monte livremente no modo Sob Medida.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {isDirty && (
                <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                  Alterações não salvas
                </span>
              )}
              <span className="text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-brand/10 text-brand-aa border border-brand/20">
                {selectedPreset === CUSTOM_PLAN_ID ? 'Contrato Sob Medida' : `Base: ${selectedPreset}`}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
            {orderedPlans.map((p) => {
              const active = selectedPreset === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={active}
                  disabled={readOnly}
                  onClick={() => applyPresetTemplate(p.id)}
                  className={`min-h-[44px] text-left p-3 rounded-xl border transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60 ${
                    active
                      ? 'border-brand bg-brand/5 dark:bg-brand/10 ring-1 ring-brand shadow-sm'
                      : 'border-slate-200 dark:border-zinc-800 hover:border-slate-300 dark:hover:border-zinc-700 bg-slate-50/50 dark:bg-[#18181b]'
                  }`}
                >
                  <p className="text-xs font-black text-slate-900 dark:text-[#fafafa] truncate">
                    {String(p.name || p.id).replace(/ plan$/i, '')}
                  </p>
                  <p className="text-xs font-mono font-bold text-brand-aa mt-0.5 tabular-nums">
                    {formatBrl(p.monthlyPrice || 0)}/mês
                  </p>
                  <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1 truncate tabular-nums">
                    {isUnlimited(p.maxAssets) ? '∞ ativos' : `${p.maxAssets} ativos`} •{' '}
                    {isUnlimited(p.maxUsers) ? '∞ usuários' : `${p.maxUsers} usu.`}
                  </p>
                </button>
              );
            })}

            <button
              type="button"
              aria-pressed={selectedPreset === CUSTOM_PLAN_ID}
              disabled={readOnly}
              onClick={() => applyPresetTemplate(CUSTOM_PLAN_ID)}
              className={`min-h-[44px] text-left p-3 rounded-xl border transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60 ${
                selectedPreset === CUSTOM_PLAN_ID
                  ? 'border-brand bg-brand/5 dark:bg-brand/10 ring-1 ring-brand shadow-sm'
                  : 'border-dashed border-slate-300 dark:border-zinc-700 hover:border-brand/50 bg-slate-50/50 dark:bg-[#18181b]'
              }`}
            >
              <p className="text-xs font-black text-slate-900 dark:text-[#fafafa] flex items-center gap-1">
                Sob Medida
              </p>
              <p className="text-xs font-mono font-bold text-emerald-700 dark:text-emerald-400 mt-0.5 tabular-nums">
                Custo modular
              </p>
              <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1 truncate">
                Pague apenas pelo que usar
              </p>
            </button>
          </div>
        </section>

        {/* 2. Escala de Ativos e Usuarios */}
        <section className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-5 space-y-5 shadow-sm">
          <div>
            <h2 className="text-sm font-black text-slate-900 dark:text-[#fafafa] flex items-center gap-2">
              <Layers size={16} className="text-brand-aa" /> Capacidade & Assentos
            </h2>
            <p className="text-xs text-slate-500 dark:text-zinc-400 tabular-nums">
              Ajuste cotas sob demanda. Os primeiros {matrix.includedAssets} ativos e{' '}
              {matrix.includedUsers} gestores já estão inclusos na plataforma base.
            </p>
          </div>

          {/* Ativos */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#18181b] border border-slate-200/80 dark:border-zinc-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-brand/10 text-brand-aa">
                  <Laptop size={15} />
                </span>
                <div>
                  {assetsUnlimited ? (
                    <span className="text-xs font-bold text-slate-900 dark:text-[#fafafa] block">
                      Cota de Ativos de TI Monitorados
                    </span>
                  ) : (
                    <label htmlFor="builder-max-assets" className="text-xs font-bold text-slate-900 dark:text-[#fafafa] block">
                      Cota de Ativos de TI Monitorados
                    </label>
                  )}
                  <span className="text-xs text-slate-500 dark:text-zinc-400 tabular-nums">
                    {assetsUnlimited
                      ? `Pacote ilimitado (${formatBrl(matrix.unlimitedAssetsFee)}/mês)`
                      : `+${formatBrl(matrix.assetUnitPrice)} por ativo além dos ${matrix.includedAssets} inclusos`}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {!assetsUnlimited && (
                  <input
                    id="builder-max-assets"
                    name="maxAssets"
                    type="number"
                    min="1"
                    max="100000"
                    disabled={readOnly}
                    value={maxAssets}
                    onChange={(e) => {
                      const val = e.target.value;
                      updateDraft((prev) => ({
                        ...prev,
                        selectedPreset: CUSTOM_PLAN_ID,
                        maxAssets: val,
                      }));
                    }}
                    onBlur={() =>
                      updateDraft((prev) => ({
                        ...prev,
                        maxAssets: clampMaxAssets(prev.maxAssets),
                      }))
                    }
                    className="w-24 min-h-[44px] px-2.5 py-1.5 text-right font-mono font-bold text-sm rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-[#111113] text-slate-900 dark:text-[#fafafa] tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  />
                )}
                <button
                  type="button"
                  aria-pressed={assetsUnlimited}
                  disabled={readOnly}
                  onClick={() =>
                    updateDraft((prev) => ({
                      ...prev,
                      selectedPreset: CUSTOM_PLAN_ID,
                      assetsUnlimited: !prev.assetsUnlimited,
                    }))
                  }
                  className={`inline-flex min-h-[44px] items-center gap-1 px-3 py-2 rounded-lg text-xs font-bold border transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                    assetsUnlimited
                      ? 'bg-brand hover:bg-brand-dark text-brand-fg border-brand'
                      : 'bg-white dark:bg-[#111113] text-slate-700 dark:text-zinc-200 border-slate-200 dark:border-zinc-700 hover:border-brand/50'
                  }`}
                >
                  <InfinityIcon size={14} aria-hidden="true" /> Ilimitado
                </button>
              </div>
            </div>

            {!assetsUnlimited && (
              <>
                <label htmlFor="builder-assets-range" className="sr-only">
                  Controle deslizante de cota de ativos
                </label>
                <input
                  id="builder-assets-range"
                  name="maxAssetsRange"
                  type="range"
                  aria-label="Controle deslizante de ativos"
                  min={Math.max(10, usage?.assets || 10)}
                  max="3000"
                  step="10"
                  disabled={readOnly}
                  value={Math.min(3000, Number(maxAssets) || 10)}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    updateDraft((prev) => ({
                      ...prev,
                      selectedPreset: CUSTOM_PLAN_ID,
                      maxAssets: val,
                    }));
                  }}
                  className="w-full min-h-[44px] accent-[var(--color-brand)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    {ASSET_PRESETS.map((qty) => (
                      <button
                        key={qty}
                        type="button"
                        aria-pressed={Number(maxAssets) === qty}
                        disabled={readOnly}
                        onClick={() =>
                          updateDraft((prev) => ({
                            ...prev,
                            selectedPreset: CUSTOM_PLAN_ID,
                            assetsUnlimited: false,
                            maxAssets: qty,
                          }))
                        }
                        className={`min-h-[44px] px-3 py-2 rounded-lg text-xs font-semibold tabular-nums transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                          Number(maxAssets) === qty
                            ? 'bg-brand/15 text-brand-aa border border-brand/30'
                            : 'bg-white dark:bg-[#111113] text-slate-600 dark:text-zinc-300 border border-slate-200 dark:border-zinc-700 hover:text-slate-900 dark:hover:text-[#fafafa]'
                        }`}
                      >
                        {qty.toLocaleString('pt-BR')} ativos
                      </button>
                    ))}
                  </div>
                  <span className="text-xs font-bold text-slate-700 dark:text-zinc-200 tabular-nums">
                    + {formatBrl(quote.assetsCost)}/mês
                  </span>
                </div>
              </>
            )}

            {assetsConflict && (
              <p role="alert" className="text-xs font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1.5 tabular-nums">
                <AlertTriangle size={14} aria-hidden="true" />{' '}
                {assetsExceededUsage
                  ? `Sua empresa já possui ${usage.assets} ativos cadastrados. Defina ao menos ${usage.assets} ativos.`
                  : 'Não foi possível verificar o consumo atual de ativos. Redução de cota bloqueada até validar o uso real.'}
              </p>
            )}
          </div>

          {/* Usuarios / Gestores */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#18181b] border border-slate-200/80 dark:border-zinc-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-brand/10 text-brand-aa">
                  <Users size={15} aria-hidden="true" />
                </span>
                <div>
                  {usersUnlimited ? (
                    <span className="text-xs font-bold text-slate-900 dark:text-[#fafafa] block">
                      Assentos da Equipe de Gestão & Operação
                    </span>
                  ) : (
                    <label htmlFor="builder-max-users" className="text-xs font-bold text-slate-900 dark:text-[#fafafa] block">
                      Assentos da Equipe de Gestão & Operação
                    </label>
                  )}
                  <span className="text-xs text-slate-500 dark:text-zinc-400 tabular-nums">
                    {usersUnlimited
                      ? `Pacote ilimitado (${formatBrl(matrix.unlimitedUsersFee)}/mês)`
                      : `+${formatBrl(matrix.userUnitPrice)} por usuário extra além dos ${matrix.includedUsers} inclusos • Portal do Colaborador incluso`}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {!usersUnlimited && (
                  <input
                    id="builder-max-users"
                    name="maxUsers"
                    type="number"
                    min="1"
                    max="10000"
                    disabled={readOnly}
                    value={maxUsers}
                    onChange={(e) => {
                      const val = e.target.value;
                      updateDraft((prev) => ({
                        ...prev,
                        selectedPreset: CUSTOM_PLAN_ID,
                        maxUsers: val,
                      }));
                    }}
                    onBlur={() =>
                      updateDraft((prev) => ({
                        ...prev,
                        maxUsers: clampMaxUsers(prev.maxUsers),
                      }))
                    }
                    className="w-24 min-h-[44px] px-2.5 py-1.5 text-right font-mono font-bold text-sm rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-[#111113] text-slate-900 dark:text-[#fafafa] tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  />
                )}
                <button
                  type="button"
                  aria-pressed={usersUnlimited}
                  disabled={readOnly}
                  onClick={() =>
                    updateDraft((prev) => ({
                      ...prev,
                      selectedPreset: CUSTOM_PLAN_ID,
                      usersUnlimited: !prev.usersUnlimited,
                    }))
                  }
                  className={`inline-flex min-h-[44px] items-center gap-1 px-3 py-2 rounded-lg text-xs font-bold border transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                    usersUnlimited
                      ? 'bg-brand hover:bg-brand-dark text-brand-fg border-brand'
                      : 'bg-white dark:bg-[#111113] text-slate-700 dark:text-zinc-200 border-slate-200 dark:border-zinc-700 hover:border-brand/50'
                  }`}
                >
                  <InfinityIcon size={14} aria-hidden="true" /> Ilimitado
                </button>
              </div>
            </div>

            {!usersUnlimited && (
              <>
                <label htmlFor="builder-users-range" className="sr-only">
                  Controle deslizante de assentos de usuários
                </label>
                <input
                  id="builder-users-range"
                  name="maxUsersRange"
                  type="range"
                  aria-label="Controle deslizante de usuários"
                  min={Math.max(2, usage?.users || 2)}
                  max="200"
                  step="1"
                  disabled={readOnly}
                  value={Math.min(200, Number(maxUsers) || 2)}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    updateDraft((prev) => ({
                      ...prev,
                      selectedPreset: CUSTOM_PLAN_ID,
                      maxUsers: val,
                    }));
                  }}
                  className="w-full min-h-[44px] accent-[var(--color-brand)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    {USER_PRESETS.map((qty) => (
                      <button
                        key={qty}
                        type="button"
                        aria-pressed={Number(maxUsers) === qty}
                        disabled={readOnly}
                        onClick={() =>
                          updateDraft((prev) => ({
                            ...prev,
                            selectedPreset: CUSTOM_PLAN_ID,
                            usersUnlimited: false,
                            maxUsers: qty,
                          }))
                        }
                        className={`min-h-[44px] px-3 py-2 rounded-lg text-xs font-semibold tabular-nums transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                          Number(maxUsers) === qty
                            ? 'bg-brand/15 text-brand-aa border border-brand/30'
                            : 'bg-white dark:bg-[#111113] text-slate-600 dark:text-zinc-300 border border-slate-200 dark:border-zinc-700 hover:text-slate-900 dark:hover:text-[#fafafa]'
                        }`}
                      >
                        {qty} usuários
                      </button>
                    ))}
                  </div>
                  <span className="text-xs font-bold text-slate-700 dark:text-zinc-200 tabular-nums">
                    + {formatBrl(quote.usersCost)}/mês
                  </span>
                </div>
              </>
            )}

            {usersConflict && (
              <p role="alert" className="text-xs font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1.5 tabular-nums">
                <AlertTriangle size={14} aria-hidden="true" />{' '}
                {usersExceededUsage
                  ? `Sua empresa já possui ${usage.users} membros ativos. Defina ao menos ${usage.users} usuários.`
                  : 'Não foi possível verificar o consumo atual de assentos. Redução de cota bloqueada até validar o uso real.'}
              </p>
            )}
          </div>
        </section>

        {/* 3. Módulos sob Demanda */}
        <section className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-5 space-y-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-black text-slate-900 dark:text-[#fafafa] flex items-center gap-2">
                <ShieldCheck size={16} className="text-brand-aa" /> Módulos & Recursos Avançados
              </h2>
              <p className="text-xs text-slate-500 dark:text-zinc-400 tabular-nums">
                Ative exatamente os módulos necessários para sua operação ({activeFeaturesCount} de {FEATURES.length} ativos).
              </p>
            </div>
            <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-full">
              Portal Colaborador, Service Desk & Termos CLT inclusos na base
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {FEATURES.map((f) => {
              const enabled = Boolean(features[f.id]);
              const price = matrix.featurePrices[f.id] ?? 0;
              return (
                <button
                  key={f.id}
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  disabled={readOnly}
                  onClick={() => toggleFeature(f.id)}
                  className={`min-h-[44px] text-left p-3.5 rounded-xl border transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand flex items-start justify-between gap-3 disabled:opacity-60 ${
                    enabled
                      ? 'border-brand/50 bg-brand/5 dark:bg-brand/10 shadow-sm'
                      : 'border-slate-200 dark:border-zinc-800 hover:border-slate-300 dark:hover:border-zinc-700 bg-slate-50/40 dark:bg-[#18181b]'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-black text-slate-900 dark:text-[#fafafa]">
                        {f.label}
                      </span>
                      <span
                        className={`text-xs font-mono font-bold px-2 py-0.5 rounded tabular-nums ${
                          enabled
                            ? 'bg-brand text-brand-fg'
                            : 'bg-slate-200/80 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300'
                        }`}
                      >
                        + {formatBrl(price)}/mês
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1 leading-relaxed">
                      {f.description}
                    </p>
                  </div>
                  <span
                    className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                      enabled
                        ? 'bg-brand border-brand text-brand-fg'
                        : 'border-slate-300 dark:border-zinc-600 bg-white dark:bg-[#111113]'
                    }`}
                  >
                    {enabled && <Check size={13} />}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* 4. Ciclo de Faturamento & Negociação */}
        <section className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-5 space-y-4 shadow-sm">
          <div>
            <h2 className="text-sm font-black text-slate-900 dark:text-[#fafafa] flex items-center gap-2">
              <CalendarClock size={16} className="text-brand-aa" /> Ciclo de Faturamento & Condições
            </h2>
            <p className="text-xs text-slate-500 dark:text-zinc-400">
              Escolha a periodicidade de cobrança para aplicar descontos automáticos de fidelidade.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {Object.values(BILLING_CYCLES).map((cycle) => {
              const disc =
                cycle.id === 'annual'
                  ? matrix.annualDiscountPct
                  : cycle.id === 'quarterly'
                    ? matrix.quarterlyDiscountPct
                    : 0;
              const active = billingCycle === cycle.id;
              return (
                <button
                  key={cycle.id}
                  type="button"
                  aria-pressed={active}
                  disabled={readOnly}
                  onClick={() => updateDraft((prev) => ({ ...prev, billingCycle: cycle.id }))}
                  className={`min-h-[44px] p-3 rounded-xl border text-left transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60 ${
                    active
                      ? 'border-brand bg-brand/5 dark:bg-brand/10 ring-1 ring-brand'
                      : 'border-slate-200 dark:border-zinc-800 hover:border-slate-300 dark:hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-black text-slate-900 dark:text-[#fafafa]">
                      {cycle.label}
                    </span>
                    {disc > 0 && (
                      <span className="text-xs font-black px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 tabular-nums">
                        -{disc}%
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1 tabular-nums">
                    {cycle.months === 1 ? 'Cobrança mês a mês' : `Compromisso de ${cycle.months} meses`}
                  </p>
                </button>
              );
            })}
          </div>

          {isMasterMode && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100 dark:border-zinc-800">
              <div>
                <label htmlFor="builder-discount" className="block text-xs font-bold uppercase text-slate-500 dark:text-zinc-400 mb-1">
                  Desconto comercial extra (%)
                </label>
                <input
                  id="builder-discount"
                  name="customDiscountPct"
                  type="number"
                  min="0"
                  max="80"
                  step="1"
                  value={customDiscountPct}
                  onChange={(e) => {
                    const val = e.target.value;
                    updateDraft((prev) => ({ ...prev, customDiscountPct: val }));
                  }}
                  onBlur={() =>
                    updateDraft((prev) => ({
                      ...prev,
                      customDiscountPct: clampDiscountPct(prev.customDiscountPct),
                    }))
                  }
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-[#18181b] text-sm font-semibold text-slate-900 dark:text-[#fafafa] tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                />
              </div>
              <div>
                <label htmlFor="builder-manual-price" className="block text-xs font-bold uppercase text-slate-500 dark:text-zinc-400 mb-1">
                  Fechar valor fixo negociado (R$/mês, opcional)
                </label>
                <input
                  id="builder-manual-price"
                  name="manualPrice"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={`Calculado: ${formatBrl(quote.finalMonthlyPrice)}`}
                  value={manualPrice}
                  onChange={(e) => {
                    const val = e.target.value;
                    updateDraft((prev) => ({ ...prev, manualPrice: val }));
                  }}
                  onBlur={() =>
                    updateDraft((prev) => ({
                      ...prev,
                      manualPrice:
                        prev.manualPrice === '' || !Number.isFinite(Number(prev.manualPrice))
                          ? ''
                          : String(Math.max(0, Number(prev.manualPrice))),
                    }))
                  }
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-[#18181b] text-sm font-semibold text-slate-900 dark:text-[#fafafa] tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                />
              </div>
            </div>
          )}

          <div>
            <label htmlFor="builder-notes" className="block text-xs font-bold uppercase text-slate-500 dark:text-zinc-400 mb-1">
              Observações do contrato / centro de custo (opcional)
            </label>
            <textarea
              id="builder-notes"
              name="contractNotes"
              rows={2}
              disabled={readOnly}
              value={notes}
              onChange={(e) => {
                const val = e.target.value;
                updateDraft((prev) => ({ ...prev, notes: val }));
              }}
              placeholder="Ex: Contrato corporativo matriz + 3 filiais, faturamento via boleto 15º dia…"
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-[#18181b] text-xs text-slate-900 dark:text-[#fafafa] placeholder-slate-400 dark:placeholder-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60"
            />
          </div>
        </section>
      </div>

      {/* COLUNA DIREITA — RESUMO FINANCEIRO EM TEMPO REAL */}
      <aside className={`${compact ? '' : 'lg:col-span-5 xl:col-span-4 lg:sticky lg:top-6'} rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] shadow-lg overflow-hidden`}>
        <div className="h-1.5 w-full bg-brand" />
        <div className="p-5 space-y-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-brand-aa flex items-center gap-1.5">
                <Receipt size={13} /> Resumo do Contrato
              </p>
              <h3 className="text-base font-black text-slate-900 dark:text-[#fafafa] mt-0.5">
                Custo Mensal Personalizado
              </h3>
            </div>
            <span className="px-2 py-0.5 rounded-md text-xs font-bold uppercase bg-slate-100 dark:bg-[#18181b] text-slate-700 dark:text-zinc-200 border border-slate-200 dark:border-zinc-700">
              {quote.cycleLabel}
            </span>
          </div>

          <div className="space-y-2 text-xs border-y border-slate-100 dark:border-zinc-800 py-3.5">
            <div className="flex items-center justify-between text-slate-600 dark:text-zinc-300">
              <span className="tabular-nums">Plataforma Base ({matrix.includedAssets} atv • {matrix.includedUsers} usu)</span>
              <span className="font-mono font-bold tabular-nums">{formatBrl(quote.monthlyBase)}</span>
            </div>

            <div className="flex items-center justify-between text-slate-600 dark:text-zinc-300">
              <span className="tabular-nums">
                {quote.assetsUnlimited
                  ? 'Ativos Ilimitados'
                  : `Ativos excedentes (${quote.extraAssetsCount} × ${formatBrl(matrix.assetUnitPrice)})`}
              </span>
              <span className="font-mono font-bold tabular-nums">{formatBrl(quote.assetsCost)}</span>
            </div>

            <div className="flex items-center justify-between text-slate-600 dark:text-zinc-300">
              <span className="tabular-nums">
                {quote.usersUnlimited
                  ? 'Gestores Ilimitados'
                  : `Gestores extras (${quote.extraUsersCount} × ${formatBrl(matrix.userUnitPrice)})`}
              </span>
              <span className="font-mono font-bold tabular-nums">{formatBrl(quote.usersCost)}</span>
            </div>

            {quote.moduleBreakdown.filter((m) => m.enabled).length > 0 && (
              <div className="pt-2 border-t border-dashed border-slate-200 dark:border-zinc-800 space-y-1.5">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                  Módulos Selecionados
                </p>
                {quote.moduleBreakdown
                  .filter((m) => m.enabled)
                  .map((m) => (
                    <div key={m.id} className="flex items-center justify-between text-slate-700 dark:text-zinc-200">
                      <span className="truncate pr-2">{m.label}</span>
                      <span className="font-mono font-bold tabular-nums shrink-0">
                        {formatBrl(m.cost)}
                      </span>
                    </div>
                  ))}
              </div>
            )}

            {quote.effectiveDiscountPct > 0 && !hasManualPrice && (
              <div className="pt-2 border-t border-dashed border-slate-200 dark:border-zinc-800 flex items-center justify-between text-emerald-700 dark:text-emerald-400 font-bold tabular-nums">
                <span>Desconto ({quote.effectiveDiscountPct}%)</span>
                <span className="font-mono tabular-nums">-{formatBrl(quote.discountAmount)}</span>
              </div>
            )}

            {hasManualPrice && (
              <div className="pt-2 border-t border-dashed border-amber-200 dark:border-amber-900/50 flex items-center justify-between text-amber-700 dark:text-amber-400 font-bold tabular-nums">
                <span>Valor negociado pelo Master</span>
                <span className="font-mono tabular-nums">{formatBrl(finalMonthlyPrice)}</span>
              </div>
            )}
          </div>

          {/* Preço Final Destacado */}
          <div className="space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-bold text-slate-500 dark:text-zinc-400">
                Total mensal efetivo
              </span>
              <span className="text-3xl font-black text-slate-900 dark:text-[#fafafa] tracking-tight tabular-nums font-mono">
                {formatBrl(finalMonthlyPrice)}
                <span className="text-xs font-normal text-slate-500 dark:text-zinc-400">/mês</span>
              </span>
            </div>

            {quote.cycleMonths > 1 && (
              <p className="text-xs text-slate-500 dark:text-zinc-400 text-right tabular-nums">
                Fatura {quote.cycleLabel.toLowerCase()}:{' '}
                <strong className="text-slate-700 dark:text-zinc-200">
                  {formatBrl(finalMonthlyPrice * quote.cycleMonths)}
                </strong>
                {quote.annualSavings > 0 && !hasManualPrice && (
                  <span className="text-emerald-700 dark:text-emerald-400 font-bold">
                    {' '}• Economia de {formatBrl(quote.annualSavings)}/ano
                  </span>
                )}
              </p>
            )}

            {currentEntitlements && !currentEntitlements.legacy && (
              <p className="text-xs text-slate-500 dark:text-zinc-400 text-right tabular-nums">
                Contrato atual: {formatBrl(currentPrice)}/mês{' '}
                {Math.abs(priceDelta) >= 0.01 && (
                  <span className={priceDelta > 0 ? 'text-amber-700 dark:text-amber-400 font-bold' : 'text-emerald-700 dark:text-emerald-400 font-bold'}>
                    ({priceDelta > 0 ? '+' : ''}{formatBrl(priceDelta)})
                  </span>
                )}
              </p>
            )}
          </div>

          {/* Resumo de Cotas */}
          <div className="grid grid-cols-3 gap-2 pt-1">
            <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#18181b] border border-slate-200/70 dark:border-zinc-800 text-center">
              <p className="text-xs font-bold uppercase text-slate-500 dark:text-zinc-400">Ativos</p>
              <p className="text-xs font-black text-slate-900 dark:text-[#fafafa] tabular-nums mt-0.5">
                {assetsUnlimited ? 'Ilimitado' : effectiveMaxAssets.toLocaleString('pt-BR')}
              </p>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#18181b] border border-slate-200/70 dark:border-zinc-800 text-center">
              <p className="text-xs font-bold uppercase text-slate-500 dark:text-zinc-400">Gestores</p>
              <p className="text-xs font-black text-slate-900 dark:text-[#fafafa] tabular-nums mt-0.5">
                {usersUnlimited ? 'Ilimitado' : effectiveMaxUsers.toLocaleString('pt-BR')}
              </p>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#18181b] border border-slate-200/70 dark:border-zinc-800 text-center">
              <p className="text-xs font-bold uppercase text-slate-500 dark:text-zinc-400">Módulos</p>
              <p className="text-xs font-black text-slate-900 dark:text-[#fafafa] tabular-nums mt-0.5">
                {activeFeaturesCount}/{FEATURES.length}
              </p>
            </div>
          </div>

          <div className="pt-2 space-y-2">
            <button
              type="submit"
              disabled={readOnly || saving || hasConflict}
              className="w-full min-h-[44px] py-3 px-4 rounded-xl bg-brand hover:bg-brand-dark text-brand-fg font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-md shadow-brand/20 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
            >
              {saving ? (
                <span>Salvando contrato…</span>
              ) : (
                <>
                  <Save size={15} />
                  <span>
                    {isMasterMode ? 'Aplicar Contrato à Empresa' : 'Salvar e Aplicar Plano Personalizado'}
                  </span>
                </>
              )}
            </button>

            {onResetToPlan && (
              <button
                type="button"
                disabled={saving}
                onClick={onResetToPlan}
                className="w-full min-h-[44px] py-2.5 px-3 rounded-xl border border-slate-200 dark:border-zinc-700 text-xs font-bold text-slate-700 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-[#18181b] transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand flex items-center justify-center gap-1.5"
              >
                <RotateCcw size={13} /> Seguir só o plano padrão
              </button>
            )}

            {readOnly && (
              <p className="text-xs text-amber-700 dark:text-amber-400 flex items-center gap-1.5 font-semibold">
                <AlertTriangle size={13} className="shrink-0" />
                Apenas o proprietário da empresa pode alterar o contrato de uso.
              </p>
            )}

            {!readOnly && (
              <p className="text-xs text-slate-500 dark:text-zinc-400 flex items-center gap-1.5">
                <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
                Alteração imediata de cotas e módulos após confirmação.
              </p>
            )}
          </div>
        </div>
      </aside>
    </form>
  );
};

export default CustomPlanBuilder;
