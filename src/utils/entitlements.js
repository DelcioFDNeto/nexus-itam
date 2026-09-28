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
  { id: 'agent', label: 'Agente ITAM', description: 'Inventário automático via script (Windows, Linux e macOS).', planKey: 'agentIntegration', module: true },
  { id: 'whitelabel', label: 'Whitelabel completo', description: 'Remove a marca Nexus do menu, das etiquetas e dos termos.', planKey: 'whitelabel' },
  { id: 'projects', label: 'Projetos & Tarefas', description: 'Kanban de projetos e gestão de tarefas da equipe.', module: true },
  { id: 'licenses', label: 'Licenças (SAM)', description: 'Chaves, ativações e dedução automática de licenças.', module: true },
  { id: 'contracts', label: 'Contratos', description: 'Contratos e serviços recorrentes de TI.', module: true },
  { id: 'audit', label: 'Auditoria com QR Code', description: 'Conferência física de inventário por local.', module: true },
  { id: 'import', label: 'Importação em massa', description: 'Carga de planilhas Excel/CSV e JSON.' },
];

export const FEATURE_IDS = FEATURES.map((f) => f.id);
export const MODULE_IDS = FEATURES.filter((f) => f.module).map((f) => f.id);

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
      overrides: {},
    };
  }

  const planId = String(tenant.plan).toLowerCase();
  const base = { ...(DEFAULT_PLANS[planId] || DEFAULT_PLANS.starter), ...(plan || {}) };
  const overrides = tenant.overrides && typeof tenant.overrides === 'object' ? tenant.overrides : {};

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

  return {
    legacy: false,
    planId,
    planName: base.name || planId,
    maxAssets: limit('maxAssets'),
    maxUsers: limit('maxUsers'),
    features,
    monthlyPrice: hasCustomPrice ? Number(customPrice) : Number(base.monthlyPrice) || 0,
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
