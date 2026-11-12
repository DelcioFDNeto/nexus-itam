// src/utils/entitlements.js
// -----------------------------------------------------------------------------
// O que cada empresa pode usar: plano comercial + ajustes individuais do master.
//
// Antes os planos existiam so como vitrine: `maxAssets`, `maxUsers`,
// `whitelabel` e `agentIntegration` eram editados no console mas nenhuma tela os
// consultava, e o TenantManager ainda usava uma tabela de limites propria,
// escrita no codigo. Aqui fica a fonte unica — o console e o app do inquilino
// leem a mesma resposta.
//
// Camadas, da mais fraca para a mais forte:
//   1. DEFAULT_PLANS          padrao embutido (quando /plans ainda nao existe)
//   2. /plans/{planId}        o que o master configurou para o plano
//   3. tenant.overrides       ajuste individual daquela empresa (so o master grava)
// -----------------------------------------------------------------------------
import { isSuperadmin } from './permissions';

/** Valor gravado no banco para "sem limite". */
export const UNLIMITED = 999999;

/**
 * Recursos liberaveis por plano ou por empresa. `planKey` aponta para o campo
 * booleano legado do documento de plano; os demais nascem liberados.
 * `module: true` = aparece no menu e pode ser ocultado pelo proprio inquilino.
 */
export const FEATURES = [
  { id: 'agent', label: 'Agente ITAM & RMM', description: 'Inventário automático e acesso remoto via script/agente (Windows, Linux e macOS).', planKey: 'agentIntegration', module: true, category: 'telemetry', defaultPrice: 99 },
  { id: 'whitelabel', label: 'Whitelabel completo', description: 'Remove a marca Nexus do menu, etiquetas, termos e Portal do Colaborador.', planKey: 'whitelabel', category: 'branding', defaultPrice: 149 },
  { id: 'projects', label: 'Projetos & Tarefas', description: 'Kanban de projetos e gestão de demandas da equipe.', module: true, category: 'operations', defaultPrice: 49 },
  { id: 'licenses', label: 'Licenças (SAM)', description: 'Cofre de chaves, ativações e dedução automática de licenças.', module: true, category: 'compliance', defaultPrice: 59 },
  { id: 'contracts', label: 'Contratos & SLAs', description: 'Contratos recorrentes de TI, renovações e SLAs.', module: true, category: 'governance', defaultPrice: 49 },
  { id: 'audit', label: 'Auditoria com QR Code', description: 'Conferência física de inventário por local com leitura móvel.', module: true, category: 'governance', defaultPrice: 39 },
  { id: 'import', label: 'Importação em massa', description: 'Ingestão de planilhas Excel/CSV e JSON.', category: 'operations', defaultPrice: 29 },
];

export const FEATURE_IDS = FEATURES.map((f) => f.id);
export const MODULE_IDS = FEATURES.filter((f) => f.module).map((f) => f.id);
export const CUSTOM_PLAN_ID = 'custom';
export const PRICING_DOC_ID = '_pricing';

export const BILLING_CYCLES = {
  monthly: { id: 'monthly', label: 'Mensal', months: 1, defaultDiscountPct: 0 },
  quarterly: { id: 'quarterly', label: 'Trimestral', months: 3, defaultDiscountPct: 5 },
  annual: { id: 'annual', label: 'Anual', months: 12, defaultDiscountPct: 15 },
};

export const DEFAULT_PRICING_MATRIX = {
  baseFee: 79,
  includedAssets: 25,
  assetUnitPrice: 1.1,
  unlimitedAssetsFee: 690,
  includedUsers: 3,
  userUnitPrice: 15,
  unlimitedUsersFee: 390,
  quarterlyDiscountPct: 5,
  annualDiscountPct: 15,
  featurePrices: Object.fromEntries(FEATURES.map((f) => [f.id, f.defaultPrice])),
};

const roundMoney = (val) => Math.round((Number(val) || 0) * 100) / 100;
const nonNeg = (val, fallback = 0) => {
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/** Normaliza a tabela de custos unitarios de planos sob medida (lida do banco ou padrao). */
export const sanitizePricingMatrix = (raw = null) => {
  const src = raw && typeof raw === 'object' ? raw : {};
  const rawFeatures = src.featurePrices && typeof src.featurePrices === 'object' ? src.featurePrices : {};
  const featurePrices = {};
  FEATURES.forEach((f) => {
    featurePrices[f.id] = nonNeg(rawFeatures[f.id], DEFAULT_PRICING_MATRIX.featurePrices[f.id]);
  });
  return {
    baseFee: nonNeg(src.baseFee, DEFAULT_PRICING_MATRIX.baseFee),
    includedAssets: Math.floor(nonNeg(src.includedAssets, DEFAULT_PRICING_MATRIX.includedAssets)),
    assetUnitPrice: nonNeg(src.assetUnitPrice, DEFAULT_PRICING_MATRIX.assetUnitPrice),
    unlimitedAssetsFee: nonNeg(src.unlimitedAssetsFee, DEFAULT_PRICING_MATRIX.unlimitedAssetsFee),
    includedUsers: Math.floor(nonNeg(src.includedUsers, DEFAULT_PRICING_MATRIX.includedUsers)),
    userUnitPrice: nonNeg(src.userUnitPrice, DEFAULT_PRICING_MATRIX.userUnitPrice),
    unlimitedUsersFee: nonNeg(src.unlimitedUsersFee, DEFAULT_PRICING_MATRIX.unlimitedUsersFee),
    quarterlyDiscountPct: Math.min(80, nonNeg(src.quarterlyDiscountPct, DEFAULT_PRICING_MATRIX.quarterlyDiscountPct)),
    annualDiscountPct: Math.min(80, nonNeg(src.annualDiscountPct, DEFAULT_PRICING_MATRIX.annualDiscountPct)),
    featurePrices,
  };
};

export const DEFAULT_PLANS = {
  starter: {
    id: 'starter',
    name: 'Starter Plan',
    maxAssets: 100,
    maxUsers: 10,
    whitelabel: false,
    agentIntegration: false,
    monthlyPrice: 199,
  },
  pro: {
    id: 'pro',
    name: 'Pro Plan',
    maxAssets: 1000,
    maxUsers: 50,
    whitelabel: false,
    agentIntegration: true,
    monthlyPrice: 499,
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise Plan',
    maxAssets: UNLIMITED,
    maxUsers: UNLIMITED,
    whitelabel: true,
    agentIntegration: true,
    monthlyPrice: 1299,
  },
};

export const PLAN_IDS = Object.keys(DEFAULT_PLANS);

/**
 * Calcula cotacao em tempo real de um contrato modular personalizado.
 * Trata `maxAssets: null` e `maxUsers: null` (ou `'unlimited'`) como pacotes ilimitados.
 */
export const calculateCustomPlanQuote = ({
  maxAssets = 100,
  maxUsers = 10,
  features = {},
  billingCycle = 'monthly',
  pricing = null,
  customDiscountPct = 0,
} = {}) => {
  const matrix = sanitizePricingMatrix(pricing);
  const assetsUnlimited = maxAssets === null || maxAssets === UNLIMITED || maxAssets === '';
  const usersUnlimited = maxUsers === null || maxUsers === UNLIMITED || maxUsers === '';

  const assetQty = assetsUnlimited ? null : Math.max(1, Math.floor(nonNeg(maxAssets, matrix.includedAssets)));
  const userQty = usersUnlimited ? null : Math.max(1, Math.floor(nonNeg(maxUsers, matrix.includedUsers)));

  const extraAssetsCount = assetsUnlimited ? 0 : Math.max(0, assetQty - matrix.includedAssets);
  const extraUsersCount = usersUnlimited ? 0 : Math.max(0, userQty - matrix.includedUsers);

  const assetsCost = roundMoney(assetsUnlimited ? matrix.unlimitedAssetsFee : extraAssetsCount * matrix.assetUnitPrice);
  const usersCost = roundMoney(usersUnlimited ? matrix.unlimitedUsersFee : extraUsersCount * matrix.userUnitPrice);

  const moduleBreakdown = FEATURES.map((feature) => {
    const enabled = Boolean(features?.[feature.id]);
    const unitPrice = roundMoney(matrix.featurePrices[feature.id] ?? 0);
    return {
      id: feature.id,
      label: feature.label,
      enabled,
      unitPrice,
      cost: enabled ? unitPrice : 0,
    };
  });
  const modulesCost = roundMoney(moduleBreakdown.reduce((acc, item) => acc + item.cost, 0));

  const subtotalMonthly = roundMoney(matrix.baseFee + assetsCost + usersCost + modulesCost);
  const cycleSpec = BILLING_CYCLES[billingCycle] || BILLING_CYCLES.monthly;
  const cycleDiscountPct =
    cycleSpec.id === 'annual'
      ? matrix.annualDiscountPct
      : cycleSpec.id === 'quarterly'
        ? matrix.quarterlyDiscountPct
        : 0;
  const negotiatedDiscountPct = Math.min(80, nonNeg(customDiscountPct, 0));
  const effectiveDiscountPct = Math.min(90, roundMoney(cycleDiscountPct + negotiatedDiscountPct));
  const discountAmount = roundMoney(subtotalMonthly * (effectiveDiscountPct / 100));
  const finalMonthlyPrice = roundMoney(Math.max(0, subtotalMonthly - discountAmount));
  const totalCyclePrice = roundMoney(finalMonthlyPrice * cycleSpec.months);
  const annualSavings = roundMoney(Math.max(0, subtotalMonthly * 12 - finalMonthlyPrice * 12));

  return {
    monthlyBase: matrix.baseFee,
    includedAssets: matrix.includedAssets,
    assetUnitPrice: matrix.assetUnitPrice,
    assetsUnlimited,
    assetQty,
    extraAssetsCount,
    assetsCost,
    includedUsers: matrix.includedUsers,
    userUnitPrice: matrix.userUnitPrice,
    usersUnlimited,
    userQty,
    extraUsersCount,
    usersCost,
    moduleBreakdown,
    modulesCost,
    subtotalMonthly,
    billingCycle: cycleSpec.id,
    cycleLabel: cycleSpec.label,
    cycleMonths: cycleSpec.months,
    cycleDiscountPct,
    negotiatedDiscountPct,
    effectiveDiscountPct,
    discountAmount,
    finalMonthlyPrice,
    totalCyclePrice,
    annualSavings,
  };
};

/** Monta o payload estruturado para gravar um contrato personalizado em /tenants/{id}. */
export const buildCustomContractPayload = ({
  planId = CUSTOM_PLAN_ID,
  maxAssets = 100,
  maxUsers = 10,
  features = {},
  billingCycle = 'monthly',
  manualMonthlyPrice = null,
  customDiscountPct = 0,
  pricing = null,
  notes = '',
  configuredBy = 'tenant',
} = {}) => {
  const quote = calculateCustomPlanQuote({ maxAssets, maxUsers, features, billingCycle, pricing, customDiscountPct });
  const normalizedFeatures = Object.fromEntries(FEATURE_IDS.map((id) => [id, Boolean(features?.[id])]));
  const hasManualPrice = manualMonthlyPrice !== null && manualMonthlyPrice !== '' && Number.isFinite(Number(manualMonthlyPrice));
  const finalMonthlyPrice = hasManualPrice ? roundMoney(Math.max(0, Number(manualMonthlyPrice))) : quote.finalMonthlyPrice;

  return {
    plan: String(planId || CUSTOM_PLAN_ID).toLowerCase(),
    overrides: {
      maxAssets: quote.assetsUnlimited ? UNLIMITED : quote.assetQty,
      maxUsers: quote.usersUnlimited ? UNLIMITED : quote.userQty,
      features: normalizedFeatures,
      monthlyPrice: finalMonthlyPrice,
      billingCycle: quote.billingCycle,
    },
    customContract: {
      enabled: true,
      mode: hasManualPrice ? 'negotiated' : 'modular',
      billingCycle: quote.billingCycle,
      configuredBy,
      notes: String(notes || '').trim().slice(0, 600),
      discountPct: quote.effectiveDiscountPct,
      calculatedMonthlyPrice: quote.finalMonthlyPrice,
      monthlyPrice: finalMonthlyPrice,
      pricingBreakdown: {
        monthlyBase: quote.monthlyBase,
        assetsCost: quote.assetsCost,
        usersCost: quote.usersCost,
        modulesCost: quote.modulesCost,
        subtotalMonthly: quote.subtotalMonthly,
        discountAmount: quote.discountAmount,
        finalMonthlyPrice,
      },
    },
  };
};

// -----------------------------------------------------------------------------
// Status comerciais
// -----------------------------------------------------------------------------

export const TENANT_STATUSES = {
  active: { label: 'Ativa', tone: 'green' },
  trial: { label: 'Em teste', tone: 'blue' },
  suspended: { label: 'Suspensa', tone: 'amber' },
  cancelled: { label: 'Encerrada', tone: 'rose' },
};

/** Status de empresa que cortam o acesso. Espelha `tenantBlocked()` em firestore.rules. */
export const BLOCKED_TENANT_STATUSES = ['suspended', 'cancelled'];

/** Status de usuario que cortam o acesso. Espelha `memberBlocked()` em firestore.rules. */
export const BLOCKED_USER_STATUSES = ['suspended', 'blocked', 'disabled'];

export const isTenantBlocked = (status) => BLOCKED_TENANT_STATUSES.includes(status);
export const isUserBlocked = (status) => BLOCKED_USER_STATUSES.includes(status);

// -----------------------------------------------------------------------------
// Resolucao
// -----------------------------------------------------------------------------

export const isUnlimited = (value) => {
  if (value === null || value === undefined || value === '') return true;
  const n = Number(value);
  return !Number.isFinite(n) || n >= UNLIMITED;
};

const toLimit = (value) => {
  if (value === null || value === undefined || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return isUnlimited(n) ? null : Math.floor(n);
};

const ALL_FEATURES_ON = () => Object.fromEntries(FEATURE_IDS.map((id) => [id, true]));

/**
 * Resolve o que a empresa pode usar.
 *
 * @param {{ tenant?: object|null, plan?: object|null }} input
 *   tenant — documento /tenants/{id}; `null` quando a empresa e legada (sem cadastro)
 *   plan   — documento /plans/{tenant.plan}; `null` usa o padrao embutido
 * @returns {{
 *   legacy: boolean, planId: string|null, planName: string,
 *   maxAssets: number|null, maxUsers: number|null,
 *   features: Record<string, boolean>, monthlyPrice: number, overrides: object
 * }} `null` em um limite significa ilimitado.
 */
export const resolveEntitlements = ({ tenant = null, plan = null } = {}) => {
  // Empresa anterior ao modulo de planos: nada e bloqueado ate o master
  // regularizar o cadastro no console. Cortar quem ja operava seria pior.
  if (!tenant || !tenant.plan) {
    return {
      legacy: true,
      planId: null,
      planName: 'Sem plano definido',
      maxAssets: null,
      maxUsers: null,
      features: ALL_FEATURES_ON(),
      monthlyPrice: 0,
      billingCycle: 'monthly',
      isCustomPlan: false,
      contractNotes: '',
      pricingBreakdown: null,
      overrides: {},
    };
  }

  const planId = String(tenant.plan).toLowerCase();
  const customFallback = planId === CUSTOM_PLAN_ID
    ? { id: CUSTOM_PLAN_ID, name: 'Plano Sob Medida', maxAssets: 100, maxUsers: 10, whitelabel: false, agentIntegration: true, monthlyPrice: 199 }
    : null;
  const base = { ...(customFallback || DEFAULT_PLANS[planId] || DEFAULT_PLANS.starter), ...(plan || {}) };
  const overrides = tenant.overrides && typeof tenant.overrides === 'object' ? tenant.overrides : {};
  const customContract = tenant.customContract && typeof tenant.customContract === 'object' ? tenant.customContract : {};

  const limit = (key) => {
    const custom = toLimit(overrides[key]);
    if (custom !== undefined) return custom;
    const fromPlan = toLimit(base[key]);
    return fromPlan === undefined ? null : fromPlan;
  };

  const features = Object.fromEntries(
    FEATURES.map((feature) => {
      const override = overrides.features?.[feature.id];
      if (typeof override === 'boolean') return [feature.id, override];
      const fromPlan = base.features?.[feature.id] ?? (feature.planKey ? base[feature.planKey] : undefined);
      return [feature.id, fromPlan === undefined ? true : Boolean(fromPlan)];
    }),
  );

  const customPrice = overrides.monthlyPrice;
  const hasCustomPrice = customPrice !== undefined && customPrice !== null && customPrice !== '' && Number.isFinite(Number(customPrice));
  const rawCycle = overrides.billingCycle || customContract.billingCycle || base.billingCycle || 'monthly';
  const billingCycle = BILLING_CYCLES[rawCycle] ? rawCycle : 'monthly';
  const hasFeatureOverrides = Boolean(overrides.features && Object.keys(overrides.features).length > 0);
  const isCustomPlan = Boolean(
    planId === CUSTOM_PLAN_ID ||
    customContract.enabled ||
    toLimit(overrides.maxAssets) !== undefined ||
    toLimit(overrides.maxUsers) !== undefined ||
    hasCustomPrice ||
    hasFeatureOverrides
  );

  return {
    legacy: false,
    planId,
    planName: base.name || planId,
    maxAssets: limit('maxAssets'),
    maxUsers: limit('maxUsers'),
    features,
    monthlyPrice: hasCustomPrice ? Number(customPrice) : Number(base.monthlyPrice) || 0,
    billingCycle,
    isCustomPlan,
    contractNotes: String(customContract.notes || overrides.contractNotes || ''),
    pricingBreakdown: customContract.pricingBreakdown || null,
    overrides,
  };
};

/**
 * A empresa do usuario tem o recurso liberado?
 * Master sempre passa; perfil sem `entitlements` (sessoes antigas, testes) tambem,
 * para nunca bloquear por ausencia de dado.
 */
export const hasFeature = (user, featureId) => {
  if (!user) return false;
  if (isSuperadmin(user)) return true;
  const features = user.entitlements?.features;
  if (!features) return true;
  return features[featureId] !== false;
};

/** Modulo oculto pelo proprio inquilino em Configuracoes? */
export const isModuleHidden = (user, moduleId) =>
  Array.isArray(user?.hiddenModules) && user.hiddenModules.includes(moduleId);

/** Modulo disponivel E visivel para a empresa do usuario. */
export const isModuleEnabled = (user, moduleId) =>
  hasFeature(user, moduleId) && (isSuperadmin(user) || !isModuleHidden(user, moduleId));

/** Cabem mais `extra` itens dentro do limite? `null` = ilimitado. */
export const withinLimit = (limit, current, extra = 1) =>
  limit === null || limit === undefined || Number(current) + Number(extra) <= Number(limit);

/** Fracao usada do limite (0..n). Ilimitado conta como 0. */
export const usageRatio = (current, limit) => {
  if (limit === null || limit === undefined || isUnlimited(limit)) return 0;
  if (Number(limit) <= 0) return Number(current) > 0 ? 1 : 0;
  return Number(current) / Number(limit);
};

/** 'ok' | 'warning' (>= 85%) | 'critical' (limite atingido). */
export const usageTone = (ratio) => (ratio >= 1 ? 'critical' : ratio >= 0.85 ? 'warning' : 'ok');

/** Texto curto de uso: "320 / 1.000" ou "320 · ilimitado". */
export const formatUsage = (current, limit) => {
  const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');
  return limit === null || limit === undefined || isUnlimited(limit)
    ? `${fmt(current)} · ilimitado`
    : `${fmt(current)} / ${fmt(limit)}`;
};
