import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PLANS,
  FEATURE_IDS,
  UNLIMITED,
  formatUsage,
  hasFeature,
  isModuleEnabled,
  isTenantBlocked,
  isUserBlocked,
  resolveEntitlements,
  usageRatio,
  usageTone,
  withinLimit,
} from './entitlements';

describe('resolveEntitlements', () => {
  it('empresa legada (sem cadastro) nao e bloqueada', () => {
    // Empresas anteriores ao modulo de planos continuam operando ate o master
    // regularizar o cadastro no console.
    const e = resolveEntitlements({ tenant: null });
    expect(e.legacy).toBe(true);
    expect(e.maxAssets).toBeNull();
    expect(e.maxUsers).toBeNull();
    FEATURE_IDS.forEach((id) => expect(e.features[id]).toBe(true));
  });

  it('aplica os limites do plano', () => {
    const e = resolveEntitlements({ tenant: { plan: 'starter' } });
    expect(e.legacy).toBe(false);
    expect(e.maxAssets).toBe(DEFAULT_PLANS.starter.maxAssets);
    expect(e.maxUsers).toBe(DEFAULT_PLANS.starter.maxUsers);
    expect(e.features.agent).toBe(false);
    expect(e.features.whitelabel).toBe(false);
    expect(e.features.projects).toBe(true);
  });

  it('o documento do plano no banco vence o padrao embutido', () => {
    const e = resolveEntitlements({
      tenant: { plan: 'starter' },
      plan: { maxAssets: 250, agentIntegration: true, monthlyPrice: 99 },
    });
    expect(e.maxAssets).toBe(250);
    expect(e.features.agent).toBe(true);
    expect(e.monthlyPrice).toBe(99);
  });

  it('ajuste individual da empresa vence o plano', () => {
    const e = resolveEntitlements({
      tenant: {
        plan: 'starter',
        overrides: { maxAssets: 500, features: { agent: true, contracts: false }, monthlyPrice: 150 },
      },
    });
    expect(e.maxAssets).toBe(500);
    expect(e.maxUsers).toBe(DEFAULT_PLANS.starter.maxUsers);
    expect(e.features.agent).toBe(true);
    expect(e.features.contracts).toBe(false);
    expect(e.monthlyPrice).toBe(150);
  });

  it('limite gravado como ilimitado vira null', () => {
    const e = resolveEntitlements({ tenant: { plan: 'enterprise' } });
    expect(e.maxAssets).toBeNull();
    const custom = resolveEntitlements({ tenant: { plan: 'starter', overrides: { maxUsers: UNLIMITED } } });
    expect(custom.maxUsers).toBeNull();
  });

  it('ignora ajuste invalido e cai no plano', () => {
    const e = resolveEntitlements({ tenant: { plan: 'pro', overrides: { maxAssets: 'abc', monthlyPrice: '' } } });
    expect(e.maxAssets).toBe(DEFAULT_PLANS.pro.maxAssets);
    expect(e.monthlyPrice).toBe(DEFAULT_PLANS.pro.monthlyPrice);
  });

  it('plano desconhecido usa o starter como base', () => {
    const e = resolveEntitlements({ tenant: { plan: 'PLATINUM' } });
    expect(e.maxAssets).toBe(DEFAULT_PLANS.starter.maxAssets);
    expect(e.planId).toBe('platinum');
  });
});

describe('hasFeature / isModuleEnabled', () => {
  const withFeatures = (features, extra = {}) => ({
    role: 'owner',
    tenantId: 'acme-1234',
    entitlements: { features },
    ...extra,
  });

  it('bloqueia recurso fora do plano', () => {
    expect(hasFeature(withFeatures({ agent: false }), 'agent')).toBe(false);
    expect(hasFeature(withFeatures({ agent: true }), 'agent')).toBe(true);
  });

  it('perfil sem entitlements nunca e bloqueado por falta de dado', () => {
    expect(hasFeature({ role: 'owner', tenantId: 'acme-1234' }, 'agent')).toBe(true);
  });

  it('master sempre tem acesso', () => {
    expect(hasFeature({ role: 'superadmin', tenantId: 'nexus-master', entitlements: { features: { agent: false } } }, 'agent')).toBe(true);
  });

  it('modulo oculto pela empresa some mesmo liberado no plano', () => {
    const user = withFeatures({ projects: true }, { hiddenModules: ['projects'] });
    expect(isModuleEnabled(user, 'projects')).toBe(false);
    expect(isModuleEnabled(withFeatures({ projects: true }), 'projects')).toBe(true);
  });

  it('sem usuario nada e liberado', () => {
    expect(hasFeature(null, 'agent')).toBe(false);
  });
});

describe('limites e uso', () => {
  it('withinLimit trata null como ilimitado', () => {
    expect(withinLimit(null, 10_000, 1)).toBe(true);
    expect(withinLimit(100, 99, 1)).toBe(true);
    expect(withinLimit(100, 100, 1)).toBe(false);
    expect(withinLimit(100, 90, 20)).toBe(false);
  });

  it('usageTone sinaliza proximidade do limite', () => {
    expect(usageTone(usageRatio(50, 100))).toBe('ok');
    expect(usageTone(usageRatio(90, 100))).toBe('warning');
    expect(usageTone(usageRatio(100, 100))).toBe('critical');
    expect(usageRatio(10, null)).toBe(0);
  });

  it('formatUsage descreve ilimitado', () => {
    expect(formatUsage(320, 1000)).toBe('320 / 1.000');
    expect(formatUsage(5, null)).toBe('5 · ilimitado');
  });
});

describe('status que cortam acesso', () => {
  it('empresa suspensa ou encerrada', () => {
    expect(isTenantBlocked('suspended')).toBe(true);
    expect(isTenantBlocked('cancelled')).toBe(true);
    expect(isTenantBlocked('active')).toBe(false);
    expect(isTenantBlocked(undefined)).toBe(false);
  });

  it('usuario suspenso', () => {
    expect(isUserBlocked('suspended')).toBe(true);
    expect(isUserBlocked('active')).toBe(false);
  });
});
