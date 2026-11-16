// src/components/plans/CustomPlanBuilder.test.jsx
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CustomPlanBuilder from './CustomPlanBuilder';
import { DEFAULT_PLANS, DEFAULT_PRICING_MATRIX } from '../../utils/entitlements';

describe('CustomPlanBuilder', () => {
  it('permite alternar modulos, trocar ciclo de faturamento e enviar contrato personalizado', async () => {
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

    await waitFor(() => {
      expect(onApplyContract).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(/Alterações não salvas/i)).not.toBeInTheDocument();
    });
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

  it('ativa guarda beforeunload quando há alterações não salvas e limpa após salvar', async () => {
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

    const cleanEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanEvent);
    expect(cleanEvent.defaultPrevented).toBe(false);

    fireEvent.click(screen.getByRole('switch', { name: /Whitelabel completo/i }));
    expect(screen.getByText(/Alterações não salvas/i)).toBeInTheDocument();

    const dirtyEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /Salvar e Aplicar Plano Personalizado/i }));

    await waitFor(() => {
      expect(screen.queryByText(/Alterações não salvas/i)).not.toBeInTheDocument();
    });

    const afterSaveEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(afterSaveEvent);
    expect(afterSaveEvent.defaultPrevented).toBe(false);
  });

  it('mantém estado dirty quando onApplyContract falha', async () => {
    const onApplyContract = vi.fn().mockRejectedValue(new Error('Falha ao gravar'));

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

    fireEvent.click(screen.getByRole('switch', { name: /Whitelabel completo/i }));
    expect(screen.getByText(/Alterações não salvas/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Salvar e Aplicar Plano Personalizado/i }));

    await waitFor(() => {
      expect(onApplyContract).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText(/Alterações não salvas/i)).toBeInTheDocument();
  });

  it('permite limpar input numérico durante digitação e normaliza no blur', () => {
    render(
      <CustomPlanBuilder
        mode="tenant"
        plans={DEFAULT_PLANS}
        pricing={DEFAULT_PRICING_MATRIX}
        initialPlanId="starter"
        usage={{ assets: 25, users: 3 }}
        onApplyContract={vi.fn()}
      />,
    );

    const assetsInput = screen.getByLabelText(/Cota de Ativos de TI Monitorados/i);
    fireEvent.change(assetsInput, { target: { value: '' } });
    expect(assetsInput).toHaveValue(null);

    fireEvent.blur(assetsInput);
    expect(assetsInput).toHaveValue(1);
  });

  it('bloqueia redução de cota abaixo do limite atual quando usageUnavailable está ativo', () => {
    render(
      <CustomPlanBuilder
        mode="tenant"
        plans={DEFAULT_PLANS}
        pricing={DEFAULT_PRICING_MATRIX}
        initialPlanId="starter"
        initialOverrides={{ maxAssets: 100, maxUsers: 10 }}
        currentEntitlements={{ maxAssets: 100, maxUsers: 10 }}
        usage={{ assets: 0, users: 0 }}
        usageUnavailable={{ assets: true, users: false }}
        onApplyContract={vi.fn()}
      />,
    );

    const assetsInput = screen.getByLabelText(/Cota de Ativos de TI Monitorados/i);
    fireEvent.change(assetsInput, { target: { value: '50' } });
    fireEvent.blur(assetsInput);

    expect(screen.getByText(/Não foi possível verificar o consumo atual de ativos/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Salvar e Aplicar Plano Personalizado/i })).toBeDisabled();
  });

  it('sincroniza com novas props do servidor quando limpo e preserva edições quando dirty', () => {
    const { rerender } = render(
      <CustomPlanBuilder
        mode="tenant"
        plans={DEFAULT_PLANS}
        pricing={DEFAULT_PRICING_MATRIX}
        initialPlanId="starter"
        initialOverrides={{ maxAssets: 100, maxUsers: 10 }}
        usage={{ assets: 25, users: 3 }}
        onApplyContract={vi.fn()}
      />,
    );

    const assetsInput = screen.getByLabelText(/Cota de Ativos de TI Monitorados/i);
    expect(assetsInput).toHaveValue(100);

    // Enquanto não há alterações locais, novas props sincronizam o formulário
    rerender(
      <CustomPlanBuilder
        mode="tenant"
        plans={DEFAULT_PLANS}
        pricing={DEFAULT_PRICING_MATRIX}
        initialPlanId="pro"
        initialOverrides={{ maxAssets: 500, maxUsers: 20 }}
        usage={{ assets: 25, users: 3 }}
        onApplyContract={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/Cota de Ativos de TI Monitorados/i)).toHaveValue(500);
    expect(screen.queryByText(/Alterações não salvas/i)).not.toBeInTheDocument();

    // Se o usuário editar e ficar dirty, atualizações de props não sobrescrevem o rascunho
    fireEvent.change(screen.getByLabelText(/Cota de Ativos de TI Monitorados/i), {
      target: { value: '750' },
    });
    expect(screen.getByText(/Alterações não salvas/i)).toBeInTheDocument();

    rerender(
      <CustomPlanBuilder
        mode="tenant"
        plans={DEFAULT_PLANS}
        pricing={DEFAULT_PRICING_MATRIX}
        initialPlanId="starter"
        initialOverrides={{ maxAssets: 200, maxUsers: 10 }}
        usage={{ assets: 25, users: 3 }}
        onApplyContract={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/Cota de Ativos de TI Monitorados/i)).toHaveValue(750);
    expect(screen.getByText(/Alterações não salvas/i)).toBeInTheDocument();
  });
});
