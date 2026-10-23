// src/contexts/PWAContext.test.jsx
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PWAProvider, usePWA } from './PWAContext';
import { APP_VERSION } from '../utils/appVersion';
import PWAUpdatePrompt from '../components/PWAUpdatePrompt';

vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const TestConsumer = () => {
  const { appVersion, isStandalone, checkForUpdates, forceHardReset } = usePWA();
  return (
    <div>
      <span data-testid="version">{appVersion}</span>
      <span data-testid="standalone">{String(isStandalone)}</span>
      <button onClick={() => checkForUpdates({ silent: false })}>Checar</button>
      <button onClick={forceHardReset}>Reset</button>
    </div>
  );
};

describe('PWAContext & PWAUpdatePrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fornece fallback seguro com a versao correta mesmo fora do provider', () => {
    render(<TestConsumer />);
    expect(screen.getByTestId('version').textContent).toBe(APP_VERSION);
  });

  it('renderiza o provider e permite chamadas de verificacao sem quebrar', async () => {
    render(
      <PWAProvider>
        <TestConsumer />
      </PWAProvider>,
    );
    expect(screen.getByTestId('version').textContent).toBe(APP_VERSION);
    await act(async () => {
      fireEvent.click(screen.getByText('Checar'));
    });
  });

  it('PWAUpdatePrompt permanece oculto quando nao ha atualizacao pendente', () => {
    render(
      <PWAProvider>
        <PWAUpdatePrompt />
      </PWAProvider>,
    );
    expect(screen.queryByLabelText('Atualização disponível')).toBeNull();
  });
});
