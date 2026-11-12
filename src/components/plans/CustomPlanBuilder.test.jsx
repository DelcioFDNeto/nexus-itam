// src/components/plans/CustomPlanBuilder.test.jsx
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CustomPlanBuilder from './CustomPlanBuilder';
import { DEFAULT_PLANS, DEFAULT_PRICING_MATRIX } from '../../utils/entitlements';

describe('CustomPlanBuilder', () => {
  it('permite alternar modulos, trocar ciclo de faturamento e enviar contrato personalizado', () => {
    const onApplyContract = vi.fn().mockResolvedValue(undefined);

    render(
      <CustomPlanBuilder
        mode="tenant"
        plans={DEFAULT_PLANS}
        pricing={DEFAULT_PRICING_MATRIX}
        initialPlanId="starter"
        usage={{ assets: 25, users: 3 }}
        onApplyContract={onApplyContract}
      />,
    );

    const whitelabelSwitch = screen.getByRole('switch', { name: /Whitelabel completo/i });
    expect(whitelabelSwitch).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(whitelabelSwitch);
    expect(whitelabelSwitch).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByRole('button', { name: /Anual/i }));

    const submitBtn = screen.getByRole('button', { name: /Salvar e Aplicar Plano Personalizado/i });
    expect(submitBtn).not.toBeDisabled();
    fireEvent.click(submitBtn);

    expect(onApplyContract).toHaveBeenCalledTimes(1);
    const payload = onApplyContract.mock.calls[0][0];
    expect(payload.plan).toBe('custom');
    expect(payload.overrides.features.whitelabel).toBe(true);
    expect(payload.overrides.billingCycle).toBe('annual');
    expect(payload.customContract.billingCycle).toBe('annual');
  });

  it('bloqueia envio quando o uso atual de ativos supera a cota selecionada', () => {
    const onApplyContract = vi.fn();

    render(
      <CustomPlanBuilder
        mode="tenant"
        plans={DEFAULT_PLANS}
        pricing={DEFAULT_PRICING_MATRIX}
        initialPlanId="starter"
        initialOverrides={{ maxAssets: 50, maxUsers: 5 }}
        usage={{ assets: 90, users: 2 }}
        onApplyContract={onApplyContract}
      />,
    );

    expect(screen.getByText(/Sua empresa já possui 90 ativos cadastrados/i)).toBeInTheDocument();
    const submitBtn = screen.getByRole('button', { name: /Salvar e Aplicar Plano Personalizado/i });
    expect(submitBtn).toBeDisabled();
  });
});
