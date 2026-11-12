// src/components/plans/CustomPlanBuilder.jsx
import React, { useMemo, useState } from 'react';
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
  readOnly = false,
  saving = false,
  onApplyContract,
  onResetToPlan,
  compact = false,
}) => {
  const matrix = useMemo(() => sanitizePricingMatrix(pricing), [pricing]);
  const isMasterMode = mode === 'master';

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

  const [selectedPreset, setSelectedPreset] = useState(
    normalizedInitialPlanId || CUSTOM_PLAN_ID,
  );
  const [assetsUnlimited, setAssetsUnlimited] = useState(isUnlimited(initialAssetsRaw));
  const [maxAssets, setMaxAssets] = useState(
    isUnlimited(initialAssetsRaw) ? 1000 : Number(initialAssetsRaw) || 100,
  );
  const [usersUnlimited, setUsersUnlimited] = useState(isUnlimited(initialUsersRaw));
  const [maxUsers, setMaxUsers] = useState(
    isUnlimited(initialUsersRaw) ? 50 : Number(initialUsersRaw) || 10,
  );
  const [features, setFeatures] = useState(() =>
    normalizeInitialFeatures(initialOverrides, initialBasePlan),
  );
  const [billingCycle, setBillingCycle] = useState(
    initialOverrides?.billingCycle || initialCustomContract?.billingCycle || 'monthly',
  );
  const [customDiscountPct, setCustomDiscountPct] = useState(
    Number(initialCustomContract?.negotiatedDiscountPct || 0),
  );
  const [manualPrice, setManualPrice] = useState(
    initialCustomContract?.mode === 'negotiated' && initialOverrides?.monthlyPrice !== undefined
      ? String(initialOverrides.monthlyPrice)
      : '',
  );
  const [notes, setNotes] = useState(String(initialCustomContract?.notes || ''));

  const quote = useMemo(
    () =>
      calculateCustomPlanQuote({
        maxAssets: assetsUnlimited ? UNLIMITED : maxAssets,
        maxUsers: usersUnlimited ? UNLIMITED : maxUsers,
        features,
        billingCycle,
        pricing: matrix,
        customDiscountPct: isMasterMode ? customDiscountPct : 0,
      }),
    [assetsUnlimited, maxAssets, usersUnlimited, maxUsers, features, billingCycle, matrix, isMasterMode, customDiscountPct],
  );

  const hasManualPrice =
    isMasterMode && manualPrice !== '' && Number.isFinite(Number(manualPrice));
  const finalMonthlyPrice = hasManualPrice
    ? Math.max(0, Number(manualPrice))
    : quote.finalMonthlyPrice;

  const assetsConflict =
    !assetsUnlimited && usage?.assets > 0 && Number(maxAssets) < usage.assets;
  const usersConflict =
    !usersUnlimited && usage?.users > 0 && Number(maxUsers) < usage.users;
  const hasConflict = assetsConflict || usersConflict;

  const currentPrice = Number(currentEntitlements?.monthlyPrice ?? 0);
  const priceDelta = finalMonthlyPrice - currentPrice;

  const applyPresetTemplate = (planId) => {
    setSelectedPreset(planId);
    if (planId === CUSTOM_PLAN_ID) return;
    const tpl = plans?.[planId] || DEFAULT_PLANS[planId];
    if (!tpl) return;

    const tplAssetsUnlim = isUnlimited(tpl.maxAssets);
    const tplUsersUnlim = isUnlimited(tpl.maxUsers);
    setAssetsUnlimited(tplAssetsUnlim);
    if (!tplAssetsUnlim) setMaxAssets(Number(tpl.maxAssets) || 100);
    setUsersUnlimited(tplUsersUnlim);
    if (!tplUsersUnlim) setMaxUsers(Number(tpl.maxUsers) || 10);
    setFeatures(normalizeInitialFeatures({}, tpl));
    if (tpl.billingCycle && BILLING_CYCLES[tpl.billingCycle]) {
      setBillingCycle(tpl.billingCycle);
    }
    setManualPrice('');
  };

  const toggleFeature = (featureId) => {
    if (readOnly) return;
    setSelectedPreset(CUSTOM_PLAN_ID);
    setFeatures((prev) => ({ ...prev, [featureId]: !prev[featureId] }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (readOnly || hasConflict || saving || !onApplyContract) return;
    const payload = buildCustomContractPayload({
      planId: selectedPreset === CUSTOM_PLAN_ID ? CUSTOM_PLAN_ID : selectedPreset,
      maxAssets: assetsUnlimited ? UNLIMITED : maxAssets,
      maxUsers: usersUnlimited ? UNLIMITED : maxUsers,
      features,
      billingCycle,
      manualMonthlyPrice: hasManualPrice ? Number(manualPrice) : null,
      customDiscountPct: isMasterMode ? customDiscountPct : 0,
      pricing: matrix,
      notes,
      configuredBy: isMasterMode ? 'master' : 'tenant',
    });
    if (isMasterMode) {
      payload.customContract.negotiatedDiscountPct = Number(customDiscountPct) || 0;
    }
    onApplyContract(payload, quote);
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
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                <Sparkles size={16} className="text-brand" /> Ponto de Partida do Contrato
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Comece por um modelo sugerido ou monte livremente no modo Sob Medida.
              </p>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-brand/10 text-brand border border-brand/20">
              {selectedPreset === CUSTOM_PLAN_ID ? 'Contrato Sob Medida' : `Base: ${selectedPreset}`}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
            {orderedPlans.map((p) => {
              const active = selectedPreset === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={readOnly}
                  onClick={() => applyPresetTemplate(p.id)}
                  className={`text-left p-3 rounded-xl border transition-all disabled:opacity-60 ${
                    active
                      ? 'border-brand bg-brand/5 dark:bg-brand/10 ring-1 ring-brand shadow-sm'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-slate-50/50 dark:bg-slate-950/40'
                  }`}
                >
                  <p className="text-xs font-black text-slate-900 dark:text-white truncate">
                    {String(p.name || p.id).replace(/ plan$/i, '')}
                  </p>
                  <p className="text-[11px] font-mono font-bold text-brand mt-0.5 tabular-nums">
                    {formatBrl(p.monthlyPrice || 0)}/mês
                  </p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 truncate">
                    {isUnlimited(p.maxAssets) ? '∞ ativos' : `${p.maxAssets} ativos`} •{' '}
                    {isUnlimited(p.maxUsers) ? '∞ usuários' : `${p.maxUsers} usu.`}
                  </p>
                </button>
              );
            })}

            <button
              type="button"
              disabled={readOnly}
              onClick={() => applyPresetTemplate(CUSTOM_PLAN_ID)}
              className={`text-left p-3 rounded-xl border transition-all disabled:opacity-60 ${
                selectedPreset === CUSTOM_PLAN_ID
                  ? 'border-brand bg-brand/5 dark:bg-brand/10 ring-1 ring-brand shadow-sm'
                  : 'border-dashed border-slate-300 dark:border-slate-700 hover:border-brand/50 bg-slate-50/50 dark:bg-slate-950/40'
              }`}
            >
              <p className="text-xs font-black text-slate-900 dark:text-white flex items-center gap-1">
                Sob Medida
              </p>
              <p className="text-[11px] font-mono font-bold text-emerald-600 dark:text-emerald-400 mt-0.5 tabular-nums">
                Custo modular
              </p>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 truncate">
                Pague apenas pelo que usar
              </p>
            </button>
          </div>
        </section>

        {/* 2. Escala de Ativos e Usuarios */}
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-5 shadow-sm">
          <div>
            <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
              <Layers size={16} className="text-brand" /> Capacidade & Assentos
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Ajuste cotas sob demanda. Os primeiros {matrix.includedAssets} ativos e{' '}
              {matrix.includedUsers} gestores já estão inclusos na plataforma base.
            </p>
          </div>

          {/* Ativos */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-brand/10 text-brand">
                  <Laptop size={15} />
                </span>
                <div>
                  <label htmlFor="builder-max-assets" className="text-xs font-bold text-slate-900 dark:text-white block">
                    Cota de Ativos de TI Monitorados
                  </label>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
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
                    type="number"
                    min="1"
                    max="100000"
                    disabled={readOnly}
                    value={maxAssets}
                    onChange={(e) => {
                      setSelectedPreset(CUSTOM_PLAN_ID);
                      setMaxAssets(Math.max(1, Number(e.target.value) || 1));
                    }}
                    className="w-24 px-2.5 py-1.5 text-right font-mono font-bold text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white tabular-nums focus:outline-none focus:border-brand"
                  />
                )}
                <button
                  type="button"
                  disabled={readOnly}
                  onClick={() => {
                    setSelectedPreset(CUSTOM_PLAN_ID);
                    setAssetsUnlimited((v) => !v);
                  }}
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                    assetsUnlimited
                      ? 'bg-brand text-white border-brand'
                      : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-brand/50'
                  }`}
                >
                  <InfinityIcon size={14} /> Ilimitado
                </button>
              </div>
            </div>

            {!assetsUnlimited && (
              <>
                <input
                  type="range"
                  aria-label="Controle deslizante de ativos"
                  min={Math.max(10, usage?.assets || 10)}
                  max="3000"
                  step="10"
                  disabled={readOnly}
                  value={Math.min(3000, Number(maxAssets) || 10)}
                  onChange={(e) => {
                    setSelectedPreset(CUSTOM_PLAN_ID);
                    setMaxAssets(Number(e.target.value));
                  }}
                  className="w-full accent-[var(--color-brand)] cursor-pointer"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    {ASSET_PRESETS.map((qty) => (
                      <button
                        key={qty}
                        type="button"
                        disabled={readOnly}
                        onClick={() => {
                          setSelectedPreset(CUSTOM_PLAN_ID);
                          setAssetsUnlimited(false);
                          setMaxAssets(qty);
                        }}
                        className={`px-2 py-0.5 rounded text-[11px] font-semibold tabular-nums transition-colors ${
                          Number(maxAssets) === qty
                            ? 'bg-brand/15 text-brand border border-brand/30'
                            : 'bg-white dark:bg-slate-900 text-slate-500 border border-slate-200 dark:border-slate-700 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        {qty.toLocaleString('pt-BR')} ativos
                      </button>
                    ))}
                  </div>
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-200 tabular-nums">
                    + {formatBrl(quote.assetsCost)}/mês
                  </span>
                </div>
              </>
            )}

            {assetsConflict && (
              <p className="text-xs font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
                <AlertTriangle size={14} /> Sua empresa já possui {usage.assets} ativos cadastrados. Defina ao menos {usage.assets} ativos.
              </p>
            )}
          </div>

          {/* Usuarios / Gestores */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-brand/10 text-brand">
                  <Users size={15} />
                </span>
                <div>
                  <label htmlFor="builder-max-users" className="text-xs font-bold text-slate-900 dark:text-white block">
                    Assentos da Equipe de Gestão & Operação
                  </label>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
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
                    type="number"
                    min="1"
                    max="10000"
                    disabled={readOnly}
                    value={maxUsers}
                    onChange={(e) => {
                      setSelectedPreset(CUSTOM_PLAN_ID);
                      setMaxUsers(Math.max(1, Number(e.target.value) || 1));
                    }}
                    className="w-24 px-2.5 py-1.5 text-right font-mono font-bold text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white tabular-nums focus:outline-none focus:border-brand"
                  />
                )}
                <button
                  type="button"
                  disabled={readOnly}
                  onClick={() => {
                    setSelectedPreset(CUSTOM_PLAN_ID);
                    setUsersUnlimited((v) => !v);
                  }}
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                    usersUnlimited
                      ? 'bg-brand text-white border-brand'
                      : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-brand/50'
                  }`}
                >
                  <InfinityIcon size={14} /> Ilimitado
                </button>
              </div>
            </div>

            {!usersUnlimited && (
              <>
                <input
                  type="range"
                  aria-label="Controle deslizante de usuários"
                  min={Math.max(2, usage?.users || 2)}
                  max="200"
                  step="1"
                  disabled={readOnly}
                  value={Math.min(200, Number(maxUsers) || 2)}
                  onChange={(e) => {
                    setSelectedPreset(CUSTOM_PLAN_ID);
                    setMaxUsers(Number(e.target.value));
                  }}
                  className="w-full accent-[var(--color-brand)] cursor-pointer"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    {USER_PRESETS.map((qty) => (
                      <button
                        key={qty}
                        type="button"
                        disabled={readOnly}
                        onClick={() => {
                          setSelectedPreset(CUSTOM_PLAN_ID);
                          setUsersUnlimited(false);
                          setMaxUsers(qty);
                        }}
                        className={`px-2 py-0.5 rounded text-[11px] font-semibold tabular-nums transition-colors ${
                          Number(maxUsers) === qty
                            ? 'bg-brand/15 text-brand border border-brand/30'
                            : 'bg-white dark:bg-slate-900 text-slate-500 border border-slate-200 dark:border-slate-700 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        {qty} usuários
                      </button>
                    ))}
                  </div>
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-200 tabular-nums">
                    + {formatBrl(quote.usersCost)}/mês
                  </span>
                </div>
              </>
            )}

            {usersConflict && (
              <p className="text-xs font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
                <AlertTriangle size={14} /> Sua empresa já possui {usage.users} membros ativos. Defina ao menos {usage.users} usuários.
              </p>
            )}
          </div>
        </section>

        {/* 3. Módulos sob Demanda */}
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                <ShieldCheck size={16} className="text-brand" /> Módulos & Recursos Avançados
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Ative exatamente os módulos necessários para sua operação ({activeFeaturesCount} de {FEATURES.length} ativos).
              </p>
            </div>
            <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-full">
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
                  className={`text-left p-3.5 rounded-xl border transition-all flex items-start justify-between gap-3 disabled:opacity-60 ${
                    enabled
                      ? 'border-brand/50 bg-brand/5 dark:bg-brand/10 shadow-sm'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-slate-50/40 dark:bg-slate-950/30'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-black text-slate-900 dark:text-white">
                        {f.label}
                      </span>
                      <span
                        className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded tabular-nums ${
                          enabled
                            ? 'bg-brand text-white'
                            : 'bg-slate-200/80 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        + {formatBrl(price)}/mês
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                      {f.description}
                    </p>
                  </div>
                  <span
                    className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                      enabled
                        ? 'bg-brand border-brand text-white'
                        : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900'
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
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4 shadow-sm">
          <div>
            <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
              <CalendarClock size={16} className="text-brand" /> Ciclo de Faturamento & Condições
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
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
                  disabled={readOnly}
                  onClick={() => setBillingCycle(cycle.id)}
                  className={`p-3 rounded-xl border text-left transition-all disabled:opacity-60 ${
                    active
                      ? 'border-brand bg-brand/5 dark:bg-brand/10 ring-1 ring-brand'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-black text-slate-900 dark:text-white">
                      {cycle.label}
                    </span>
                    {disc > 0 && (
                      <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                        -{disc}%
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    {cycle.months === 1 ? 'Cobrança mês a mês' : `Compromisso de ${cycle.months} meses`}
                  </p>
                </button>
              );
            })}
          </div>

          {isMasterMode && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div>
                <label htmlFor="builder-discount" className="block text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400 mb-1">
                  Desconto comercial extra (%)
                </label>
                <input
                  id="builder-discount"
                  type="number"
                  min="0"
                  max="80"
                  step="1"
                  value={customDiscountPct}
                  onChange={(e) => setCustomDiscountPct(Math.min(80, Math.max(0, Number(e.target.value) || 0)))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-brand"
                />
              </div>
              <div>
                <label htmlFor="builder-manual-price" className="block text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400 mb-1">
                  Fechar valor fixo negociado (R$/mês, opcional)
                </label>
                <input
                  id="builder-manual-price"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={`Calculado: ${formatBrl(quote.finalMonthlyPrice)}`}
                  value={manualPrice}
                  onChange={(e) => setManualPrice(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-brand"
                />
              </div>
            </div>
          )}

          <div>
            <label htmlFor="builder-notes" className="block text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400 mb-1">
              Observações do contrato / centro de custo (opcional)
            </label>
            <textarea
              id="builder-notes"
              rows={2}
              disabled={readOnly}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex: Contrato corporativo matriz + 3 filiais, faturamento via boleto 15º dia..."
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-brand disabled:opacity-60"
            />
          </div>
        </section>
      </div>

      {/* COLUNA DIREITA — RESUMO FINANCEIRO EM TEMPO REAL */}
      <aside className={`${compact ? '' : 'lg:col-span-5 xl:col-span-4 lg:sticky lg:top-6'} rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-lg overflow-hidden`}>
        <div className="h-1.5 w-full bg-gradient-to-r from-brand via-brand-dark to-brand" />
        <div className="p-5 space-y-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-brand flex items-center gap-1.5">
                <Receipt size={13} /> Resumo do Contrato
              </p>
              <h4 className="text-base font-black text-slate-900 dark:text-white mt-0.5">
                Custo Mensal Personalizado
              </h4>
            </div>
            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
              {quote.cycleLabel}
            </span>
          </div>

          <div className="space-y-2 text-xs border-y border-slate-100 dark:border-slate-800 py-3.5">
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
              <span>Plataforma Base ({matrix.includedAssets} atv • {matrix.includedUsers} usu)</span>
              <span className="font-mono font-bold tabular-nums">{formatBrl(quote.monthlyBase)}</span>
            </div>

            <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
              <span>
                {quote.assetsUnlimited
                  ? 'Ativos Ilimitados'
                  : `Ativos excedentes (${quote.extraAssetsCount} × ${formatBrl(matrix.assetUnitPrice)})`}
              </span>
              <span className="font-mono font-bold tabular-nums">{formatBrl(quote.assetsCost)}</span>
            </div>

            <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
              <span>
                {quote.usersUnlimited
                  ? 'Gestores Ilimitados'
                  : `Gestores extras (${quote.extraUsersCount} × ${formatBrl(matrix.userUnitPrice)})`}
              </span>
              <span className="font-mono font-bold tabular-nums">{formatBrl(quote.usersCost)}</span>
            </div>

            {quote.moduleBreakdown.filter((m) => m.enabled).length > 0 && (
              <div className="pt-2 border-t border-dashed border-slate-200 dark:border-slate-800 space-y-1.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Módulos Selecionados
                </p>
                {quote.moduleBreakdown
                  .filter((m) => m.enabled)
                  .map((m) => (
                    <div key={m.id} className="flex items-center justify-between text-slate-700 dark:text-slate-200">
                      <span className="truncate pr-2">{m.label}</span>
                      <span className="font-mono font-bold tabular-nums shrink-0">
                        {formatBrl(m.cost)}
                      </span>
                    </div>
                  ))}
              </div>
            )}

            {quote.effectiveDiscountPct > 0 && !hasManualPrice && (
              <div className="pt-2 border-t border-dashed border-slate-200 dark:border-slate-800 flex items-center justify-between text-emerald-600 dark:text-emerald-400 font-bold">
                <span>Desconto ({quote.effectiveDiscountPct}%)</span>
                <span className="font-mono tabular-nums">-{formatBrl(quote.discountAmount)}</span>
              </div>
            )}

            {hasManualPrice && (
              <div className="pt-2 border-t border-dashed border-amber-200 dark:border-amber-900/50 flex items-center justify-between text-amber-600 dark:text-amber-400 font-bold">
                <span>Valor negociado pelo Master</span>
                <span className="font-mono tabular-nums">{formatBrl(finalMonthlyPrice)}</span>
              </div>
            )}
          </div>

          {/* Preço Final Destacado */}
          <div className="space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                Total mensal efetivo
              </span>
              <span className="text-3xl font-black text-slate-900 dark:text-white tracking-tight tabular-nums font-mono">
                {formatBrl(finalMonthlyPrice)}
                <span className="text-xs font-normal text-slate-400">/mês</span>
              </span>
            </div>

            {quote.cycleMonths > 1 && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400 text-right tabular-nums">
                Fatura {quote.cycleLabel.toLowerCase()}:{' '}
                <strong className="text-slate-700 dark:text-slate-200">
                  {formatBrl(finalMonthlyPrice * quote.cycleMonths)}
                </strong>
                {quote.annualSavings > 0 && !hasManualPrice && (
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                    {' '}• Economia de {formatBrl(quote.annualSavings)}/ano
                  </span>
                )}
              </p>
            )}

            {currentEntitlements && !currentEntitlements.legacy && (
              <p className="text-[11px] text-slate-400 dark:text-slate-500 text-right tabular-nums">
                Contrato atual: {formatBrl(currentPrice)}/mês{' '}
                {Math.abs(priceDelta) >= 0.01 && (
                  <span className={priceDelta > 0 ? 'text-amber-600 dark:text-amber-400 font-bold' : 'text-emerald-600 dark:text-emerald-400 font-bold'}>
                    ({priceDelta > 0 ? '+' : ''}{formatBrl(priceDelta)})
                  </span>
                )}
              </p>
            )}
          </div>

          {/* Resumo de Cotas */}
          <div className="grid grid-cols-3 gap-2 pt-1">
            <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200/70 dark:border-slate-800 text-center">
              <p className="text-[10px] font-bold uppercase text-slate-400">Ativos</p>
              <p className="text-xs font-black text-slate-900 dark:text-white tabular-nums mt-0.5">
                {assetsUnlimited ? 'Ilimitado' : maxAssets.toLocaleString('pt-BR')}
              </p>
            </div>
            <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200/70 dark:border-slate-800 text-center">
              <p className="text-[10px] font-bold uppercase text-slate-400">Gestores</p>
              <p className="text-xs font-black text-slate-900 dark:text-white tabular-nums mt-0.5">
                {usersUnlimited ? 'Ilimitado' : maxUsers.toLocaleString('pt-BR')}
              </p>
            </div>
            <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200/70 dark:border-slate-800 text-center">
              <p className="text-[10px] font-bold uppercase text-slate-400">Módulos</p>
              <p className="text-xs font-black text-slate-900 dark:text-white tabular-nums mt-0.5">
                {activeFeaturesCount}/{FEATURES.length}
              </p>
            </div>
          </div>

          <div className="pt-2 space-y-2">
            <button
              type="submit"
              disabled={readOnly || saving || hasConflict}
              className="w-full py-3 px-4 rounded-xl bg-brand hover:bg-brand-dark text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-md shadow-brand/20 transition-all disabled:opacity-50"
            >
              {saving ? (
                <span>Salvando contrato...</span>
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
                className="w-full py-2 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-center gap-1.5"
              >
                <RotateCcw size={13} /> Seguir só o plano padrão
              </button>
            )}

            {readOnly && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1.5 font-semibold">
                <AlertTriangle size={13} className="shrink-0" />
                Apenas o proprietário da empresa pode alterar o contrato de uso.
              </p>
            )}

            {!readOnly && (
              <p className="text-[11px] text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
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
