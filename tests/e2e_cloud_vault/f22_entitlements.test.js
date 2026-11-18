// tests/e2e_cloud_vault/f22_entitlements.test.js
// =============================================================================
// E2E-M3 F-22: Commercial Module `cloud_storage` (`src/utils/entitlements.js`)
// Tier 1 (Unit/Contract: 5) + Tier 2 (Overrides/Visibility/Edge: 5)
// =============================================================================

import { describe, expect, it } from 'vitest';
import { requireModuleOrFail } from './helpers/uiTestHarness.js';

describe('F-22: Commercial Module cloud_storage (src/utils/entitlements.js)', () => {
  describe('Tier 1 — Feature Registration, Plan Defaults & Custom Quoting', () => {
    it('F22-T1-01: registers cloud_storage in FEATURES, MODULE_IDS, and DEFAULT_PRICING_MATRIX', async () => {
      const ent = await requireModuleOrFail('src/utils/entitlements.js', 'M1');

      const feat = ent.FEATURES.find((f) => f.id === 'cloud_storage');
      expect(feat).toBeDefined();
      expect(feat.module).toBe(true);
      expect(feat.planKey).toBe('cloudStorage');
      expect(feat.category).toBe('infrastructure');
      expect(feat.defaultPrice).toBe(79);

      expect(ent.FEATURE_IDS).toContain('cloud_storage');
      expect(ent.MODULE_IDS).toContain('cloud_storage');
      expect(ent.DEFAULT_PRICING_MATRIX.featurePrices.cloud_storage).toBe(79);
    });

    it('F22-T1-02: starter plan excludes cloud_storage by default', async () => {
      const ent = await requireModuleOrFail('src/utils/entitlements.js', 'M1');

      expect(ent.DEFAULT_PLANS.starter.cloudStorage).toBe(false);
      const resolved = ent.resolveEntitlements({ tenant: { plan: 'starter' } });
      expect(resolved.legacy).toBe(false);
      expect(resolved.planId).toBe('starter');
      expect(resolved.features.cloud_storage).toBe(false);
      expect(resolved.maxAssets).toBe(100);
      expect(resolved.maxUsers).toBe(10);
    });

    it('F22-T1-03: pro and enterprise plans include cloud_storage by default', async () => {
      const ent = await requireModuleOrFail('src/utils/entitlements.js', 'M1');

      expect(ent.DEFAULT_PLANS.pro.cloudStorage).toBe(true);
      expect(ent.DEFAULT_PLANS.enterprise.cloudStorage).toBe(true);

      const pro = ent.resolveEntitlements({ tenant: { plan: 'pro' } });
      expect(pro.planId).toBe('pro');
      expect(pro.features.cloud_storage).toBe(true);
      expect(pro.maxAssets).toBe(1000);
      expect(pro.maxUsers).toBe(50);

      const enterprise = ent.resolveEntitlements({ tenant: { plan: 'enterprise' } });
      expect(enterprise.planId).toBe('enterprise');
      expect(enterprise.features.cloud_storage).toBe(true);
      expect(enterprise.maxAssets).toBeNull();
      expect(enterprise.maxUsers).toBeNull();
    });

    it('F22-T1-04: custom plan defaults cloud_storage to false and supports R$ 79 add-on quote + contract round-trip', async () => {
      const ent = await requireModuleOrFail('src/utils/entitlements.js', 'M1');

      const defaultCustom = ent.resolveEntitlements({ tenant: { plan: 'custom' } });
      expect(defaultCustom.isCustomPlan).toBe(true);
      expect(defaultCustom.features.cloud_storage).toBe(false);

      const quoteWithout = ent.calculateCustomPlanQuote({
        maxAssets: 100,
        maxUsers: 10,
        features: {},
        billingCycle: 'monthly',
      });
      const quoteWith = ent.calculateCustomPlanQuote({
        maxAssets: 100,
        maxUsers: 10,
        features: { cloud_storage: true },
        billingCycle: 'monthly',
      });

      expect(quoteWith.modulesCost - quoteWithout.modulesCost).toBe(79);
      expect(quoteWith.subtotalMonthly - quoteWithout.subtotalMonthly).toBe(79);
      const breakdownItem = quoteWith.moduleBreakdown.find((m) => m.id === 'cloud_storage');
      expect(breakdownItem).toMatchObject({ id: 'cloud_storage', enabled: true, unitPrice: 79, cost: 79 });

      const contract = ent.buildCustomContractPayload({
        planId: 'custom',
        maxAssets: 250,
        maxUsers: 20,
        features: { cloud_storage: true },
        billingCycle: 'monthly',
      });
      expect(contract.overrides.features.cloud_storage).toBe(true);
      const resolvedCustom = ent.resolveEntitlements({ tenant: contract });
      expect(resolvedCustom.features.cloud_storage).toBe(true);
      expect(resolvedCustom.isCustomPlan).toBe(true);
    });

    it('F22-T1-05: hasFeature enforces entitlements and preserves legacy tenants without plan', async () => {
      const ent = await requireModuleOrFail('src/utils/entitlements.js', 'M1');

      const enabledUser = { role: 'owner', tenantId: 't1', entitlements: { features: { cloud_storage: true } } };
      const disabledUser = { role: 'owner', tenantId: 't1', entitlements: { features: { cloud_storage: false } } };
      const noEntitlementsUser = { role: 'owner', tenantId: 't1' };

      expect(ent.hasFeature(enabledUser, 'cloud_storage')).toBe(true);
      expect(ent.hasFeature(disabledUser, 'cloud_storage')).toBe(false);
      expect(ent.hasFeature(noEntitlementsUser, 'cloud_storage')).toBe(true);

      const legacy = ent.resolveEntitlements({ tenant: null });
      expect(legacy.legacy).toBe(true);
      expect(legacy.features.cloud_storage).toBe(true);
    });
  });

  describe('Tier 2 — Override Precedence, Visibility, Sanitization & Quota Tone', () => {
    it('F22-T2-01: tenant.overrides beats DB plan which beats DEFAULT_PLANS for cloud_storage', async () => {
      const ent = await requireModuleOrFail('src/utils/entitlements.js', 'M1');

      // Starter upgraded via override
      const starterOverridden = ent.resolveEntitlements({
        tenant: { plan: 'starter', overrides: { features: { cloud_storage: true } } },
      });
      expect(starterOverridden.features.cloud_storage).toBe(true);

      // Pro / Enterprise disabled via override
      const proDisabled = ent.resolveEntitlements({
        tenant: { plan: 'pro', overrides: { features: { cloud_storage: false } } },
      });
      expect(proDisabled.features.cloud_storage).toBe(false);

      const entDisabled = ent.resolveEntitlements({
        tenant: { plan: 'enterprise', overrides: { features: { cloud_storage: false } } },
      });
      expect(entDisabled.features.cloud_storage).toBe(false);

      // DB plan beats DEFAULT_PLANS, and overrides beat DB plan
      const dbPlanEnabled = ent.resolveEntitlements({
        tenant: { plan: 'starter' },
        plan: { id: 'starter', cloudStorage: true },
      });
      expect(dbPlanEnabled.features.cloud_storage).toBe(true);

      const overrideBeatsDb = ent.resolveEntitlements({
        tenant: { plan: 'starter', overrides: { features: { cloud_storage: false } } },
        plan: { id: 'starter', cloudStorage: true },
      });
      expect(overrideBeatsDb.features.cloud_storage).toBe(false);
    });

    it('F22-T2-02: hiddenModules suppresses isModuleEnabled while keeping commercial hasFeature intact', async () => {
      const ent = await requireModuleOrFail('src/utils/entitlements.js', 'M1');

      const ownerHidden = {
        role: 'owner',
        tenantId: 't-acme',
        entitlements: { features: { cloud_storage: true } },
        hiddenModules: ['cloud_storage'],
      };

      expect(ent.hasFeature(ownerHidden, 'cloud_storage')).toBe(true);
      expect(ent.isModuleHidden(ownerHidden, 'cloud_storage')).toBe(true);
      expect(ent.isModuleEnabled(ownerHidden, 'cloud_storage')).toBe(false);

      const ownerVisible = { ...ownerHidden, hiddenModules: ['projects'] };
      expect(ent.isModuleHidden(ownerVisible, 'cloud_storage')).toBe(false);
      expect(ent.isModuleEnabled(ownerVisible, 'cloud_storage')).toBe(true);
    });

    it('F22-T2-03: master superadmin retains commercial module visibility while planted superadmin does not', async () => {
      const ent = await requireModuleOrFail('src/utils/entitlements.js', 'M1');

      const master = {
        role: 'superadmin',
        tenantId: 'nexus-master',
        entitlements: { features: { cloud_storage: false } },
        hiddenModules: ['cloud_storage'],
      };
      const planted = {
        role: 'superadmin',
        tenantId: 'acme-spoof',
        entitlements: { features: { cloud_storage: false } },
        hiddenModules: ['cloud_storage'],
      };

      expect(ent.hasFeature(master, 'cloud_storage')).toBe(true);
      expect(ent.isModuleEnabled(master, 'cloud_storage')).toBe(true);

      expect(ent.hasFeature(planted, 'cloud_storage')).toBe(false);
      expect(ent.isModuleEnabled(planted, 'cloud_storage')).toBe(false);
    });

    it('F22-T2-04: unknown plans fallback to starter and sanitizePricingMatrix guards negative/excessive inputs', async () => {
      const ent = await requireModuleOrFail('src/utils/entitlements.js', 'M1');

      const unknownPlan = ent.resolveEntitlements({ tenant: { plan: 'DIAMOND_VIP' } });
      expect(unknownPlan.legacy).toBe(false);
      expect(unknownPlan.planId).toBe('diamond_vip');
      expect(unknownPlan.features.cloud_storage).toBe(false);

      const emptyPlan = ent.resolveEntitlements({ tenant: { plan: '' } });
      expect(emptyPlan.legacy).toBe(true);

      const sanitized = ent.sanitizePricingMatrix({
        featurePrices: { cloud_storage: -50 },
        annualDiscountPct: 99,
        quarterlyDiscountPct: -10,
      });
      expect(sanitized.featurePrices.cloud_storage).toBe(79);
      expect(sanitized.annualDiscountPct).toBe(80);
      expect(sanitized.quarterlyDiscountPct).toBe(5);

      const quote = ent.calculateCustomPlanQuote({
        maxAssets: 'bad-value',
        features: { cloud_storage: 1 },
        billingCycle: 'annual',
        customDiscountPct: 95,
      });
      expect(quote.effectiveDiscountPct).toBe(90);
      expect(quote.finalMonthlyPrice).toBeGreaterThanOrEqual(0);
    });

    it('F22-T2-05: null users, blocked tenant/user statuses, usageTone thresholds & formatUsage pt-BR', async () => {
      const ent = await requireModuleOrFail('src/utils/entitlements.js', 'M1');

      expect(ent.hasFeature(null, 'cloud_storage')).toBe(false);
      expect(ent.isModuleEnabled(null, 'cloud_storage')).toBe(false);

      expect(ent.isTenantBlocked('suspended')).toBe(true);
      expect(ent.isTenantBlocked('cancelled')).toBe(true);
      expect(ent.isTenantBlocked('active')).toBe(false);

      expect(ent.isUserBlocked('suspended')).toBe(true);
      expect(ent.isUserBlocked('blocked')).toBe(true);
      expect(ent.isUserBlocked('disabled')).toBe(true);
      expect(ent.isUserBlocked('active')).toBe(false);

      expect(ent.usageTone(ent.usageRatio(84, 100))).toBe('ok');
      expect(ent.usageTone(ent.usageRatio(85, 100))).toBe('warning');
      expect(ent.usageTone(ent.usageRatio(100, 100))).toBe('critical');

      // Explicit 15_000 ms timeout for cold pt-BR Intl initialization in happy-dom
      expect(ent.formatUsage(320, 1000)).toBe('320 / 1.000');
      expect(ent.formatUsage(320, ent.UNLIMITED)).toContain('ilimitado');
    }, 15_000);
  });
});
