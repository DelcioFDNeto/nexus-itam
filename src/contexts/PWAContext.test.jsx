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
  const {
    appVersion,
    isStandalone,
    canInstall,
    isInstallModalOpen,
    setIsInstallModalOpen,
    installProgress,
    startInstallWithProgress,
    checkForUpdates,
    forceHardReset,
    installApp,
    storageDiagnostics,
  } = usePWA();

  return (
    <div>
      <span data-testid="version">{appVersion}</span>
      <span data-testid="standalone">{String(isStandalone)}</span>
      <span data-testid="can-install">{String(canInstall)}</span>
      <span data-testid="modal-open">{String(isInstallModalOpen)}</span>
      <span data-testid="progress">{String(installProgress?.progress ?? 0)}</span>
      <span data-testid="step">{String(installProgress?.step ?? 0)}</span>
      <span data-testid="installing">{String(installProgress?.isInstalling ?? false)}</span>
      <span data-testid="status">{installProgress?.statusText || ''}</span>
      <span data-testid="storage-percent">{String(storageDiagnostics?.percentage ?? 0)}</span>

      <button onClick={() => checkForUpdates({ silent: false })}>Checar</button>
      <button onClick={forceHardReset}>Reset</button>
      <button onClick={() => setIsInstallModalOpen(true)}>AbrirModal</button>
      <button onClick={() => setIsInstallModalOpen(false)}>FecharModal</button>
      <button onClick={() => startInstallWithProgress()}>InstalarComProgresso</button>
      <button onClick={() => installApp()}>InstallApp</button>
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
    expect(screen.getByTestId('modal-open').textContent).toBe('false');
    expect(screen.getByTestId('progress').textContent).toBe('0');
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

  it('controla a abertura e fechamento do modal de instalação', () => {
    render(
      <PWAProvider>
        <TestConsumer />
      </PWAProvider>,
    );
    expect(screen.getByTestId('modal-open').textContent).toBe('false');

    act(() => {
      fireEvent.click(screen.getByText('AbrirModal'));
    });
    expect(screen.getByTestId('modal-open').textContent).toBe('true');

    act(() => {
      fireEvent.click(screen.getByText('FecharModal'));
    });
    expect(screen.getByTestId('modal-open').textContent).toBe('false');
  });

  it('executa startInstallWithProgress e atualiza o estado com as etapas', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(
      <PWAProvider>
        <TestConsumer />
      </PWAProvider>,
    );

    const installBtn = screen.getByText('InstalarComProgresso');

    act(() => {
      fireEvent.click(installBtn);
    });

    expect(screen.getByTestId('modal-open').textContent).toBe('true');

    // Avança timers para completar etapas
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(Number(screen.getByTestId('progress').textContent)).toBeGreaterThanOrEqual(80);
    vi.useRealTimers();
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
