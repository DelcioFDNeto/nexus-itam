// src/utils/customPlan.test.js
import { describe, expect, it } from 'vitest';
import {
  BILLING_CYCLES,
  CUSTOM_PLAN_ID,
  DEFAULT_PRICING_MATRIX,
  UNLIMITED,
  buildCustomContractPayload,
  calculateCustomPlanQuote,
  resolveEntitlements,
  sanitizePricingMatrix,
} from './entitlements';

describe('custom plan & contract builder utilities', () => {
  it('normaliza matriz de custos preservando chaves padrao e protegendo contra negativos', () => {
    const sanitized = sanitizePricingMatrix({
      baseFee: -50,
      assetUnitPrice: 0.75,
      userUnitPrice: 12,
      annualDiscountPct: 120,
      quarterlyDiscountPct: 10,
      featurePrices: {
        whitelabel: -99,
        audit: 45,
      },
    });

    expect(sanitized.baseFee).toBe(DEFAULT_PRICING_MATRIX.baseFee);
    expect(sanitized.assetUnitPrice).toBe(0.75);
    expect(sanitized.userUnitPrice).toBe(12);
    expect(sanitized.annualDiscountPct).toBeLessThanOrEqual(80);
    expect(sanitized.quarterlyDiscountPct).toBe(10);
    expect(sanitized.featurePrices.whitelabel).toBe(DEFAULT_PRICING_MATRIX.featurePrices.whitelabel);
    expect(sanitized.featurePrices.audit).toBe(45);
    expect(sanitized.featurePrices.agent).toBe(DEFAULT_PRICING_MATRIX.featurePrices.agent);
  });

  it('calcula cotacao modular para quotas finitas e aplica desconto de ciclo anual', () => {
    const monthlyQuote = calculateCustomPlanQuote({
      maxAssets: 200,
      maxUsers: 10,
      features: { audit: true, projects: true },
      billingCycle: 'monthly',
    });

    const annualQuote = calculateCustomPlanQuote({
      maxAssets: 200,
      maxUsers: 10,
      features: { audit: true, projects: true },
      billingCycle: 'annual',
    });

    expect(monthlyQuote.subtotalMonthly).toBeGreaterThan(0);
    expect(monthlyQuote.effectiveDiscountPct).toBe(0);
    expect(monthlyQuote.finalMonthlyPrice).toBe(monthlyQuote.subtotalMonthly);

    expect(annualQuote.billingCycle).toBe('annual');
    expect(annualQuote.cycleMonths).toBe(BILLING_CYCLES.annual.months);
    expect(annualQuote.effectiveDiscountPct).toBe(DEFAULT_PRICING_MATRIX.annualDiscountPct);
    expect(annualQuote.finalMonthlyPrice).toBeLessThan(monthlyQuote.finalMonthlyPrice);
    expect(annualQuote.annualSavings).toBeGreaterThan(0);
  });

  it('precifica cotas ilimitadas e prioriza preco negociado manual no payload', () => {
    const unlimitedQuote = calculateCustomPlanQuote({
      maxAssets: UNLIMITED,
      maxUsers: UNLIMITED,
      features: { whitelabel: true },
      billingCycle: 'monthly',
    });

    expect(unlimitedQuote.assetsUnlimited).toBe(true);
    expect(unlimitedQuote.usersUnlimited).toBe(true);
    expect(unlimitedQuote.assetsCost).toBe(DEFAULT_PRICING_MATRIX.unlimitedAssetsFee);
    expect(unlimitedQuote.usersCost).toBe(DEFAULT_PRICING_MATRIX.unlimitedUsersFee);

    const payload = buildCustomContractPayload({
      planId: CUSTOM_PLAN_ID,
      maxAssets: UNLIMITED,
      maxUsers: 20,
      features: { audit: true, whitelabel: true },
      billingCycle: 'quarterly',
      manualMonthlyPrice: 499.9,
      configuredBy: 'master',
      notes: 'Acordo comercial anual Q4',
    });

    expect(payload.plan).toBe(CUSTOM_PLAN_ID);
    expect(payload.overrides.maxAssets).toBe(UNLIMITED);
    expect(payload.overrides.maxUsers).toBe(20);
    expect(payload.overrides.monthlyPrice).toBe(499.9);
    expect(payload.overrides.billingCycle).toBe('quarterly');
    expect(payload.overrides.features.whitelabel).toBe(true);
    expect(payload.overrides.features.agent).toBe(false);
    expect(payload.customContract.mode).toBe('negotiated');
    expect(payload.customContract.notes).toBe('Acordo comercial anual Q4');
  });

  it('resolveEntitlements interpreta contrato sob medida com ciclo, breakdown e metadados', () => {
    const payload = buildCustomContractPayload({
      planId: CUSTOM_PLAN_ID,
      maxAssets: 350,
      maxUsers: 18,
      features: { audit: true, agent: true, whitelabel: false },
      billingCycle: 'annual',
      configuredBy: 'owner',
      notes: 'Plano montado no autoatendimento',
    });

    const ent = resolveEntitlements({
      tenant: {
        status: 'active',
        ...payload,
      },
      plan: null,
    });

    expect(ent.legacy).toBe(false);
    expect(ent.planId).toBe(CUSTOM_PLAN_ID);
    expect(ent.isCustomPlan).toBe(true);
    expect(ent.billingCycle).toBe('annual');
    expect(ent.maxAssets).toBe(350);
    expect(ent.maxUsers).toBe(18);
    expect(ent.features.audit).toBe(true);
    expect(ent.features.agent).toBe(true);
    expect(ent.features.whitelabel).toBe(false);
    expect(ent.contractNotes).toBe('Plano montado no autoatendimento');
    expect(ent.pricingBreakdown).toBeTruthy();
  });
});
