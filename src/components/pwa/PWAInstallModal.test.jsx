// src/components/pwa/PWAInstallModal.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import PWAInstallModal from './PWAInstallModal';
import * as PWAContextModule from '../../contexts/PWAContext';

describe('PWAInstallModal Component', () => {
  let mockContextValue;

  beforeEach(() => {
    vi.clearAllMocks();

    mockContextValue = {
      isInstallModalOpen: true,
      setIsInstallModalOpen: vi.fn(),
      installProgress: {
        isInstalling: false,
        progress: 0,
        step: 0,
        statusText: '',
        isComplete: false,
        error: null,
      },
      startInstallWithProgress: vi.fn(),
      isStandalone: false,
      isIOS: false,
      storageDiagnostics: {
        quota: 100 * 1024 * 1024,
        usage: 12 * 1024 * 1024,
        percentage: 12,
        isPersisted: true,
      },
      checkForUpdates: vi.fn(),
      isChecking: false,
    };

    vi.spyOn(PWAContextModule, 'usePWA').mockImplementation(() => mockContextValue);
  });

  it('não renderiza nada se isInstallModalOpen for false', () => {
    mockContextValue.isInstallModalOpen = false;
    const { container } = render(<PWAInstallModal />);
    expect(container.firstChild).toBeNull();
  });

  it('renderiza os recursos destacados e botão de instalação no estado inicial', () => {
    render(<PWAInstallModal />);

    expect(screen.getByText('Nexus ITAM Mobile')).toBeInTheDocument();
    expect(screen.getByText('Nativo')).toBeInTheDocument();
    expect(screen.getByText('Acesso Instantâneo')).toBeInTheDocument();
    expect(screen.getByText('Operação Offline')).toBeInTheDocument();
    expect(screen.getByText('Atalhos & Notificações')).toBeInTheDocument();

    const installButton = screen.getByRole('button', { name: /Instalar Aplicativo Nativo/i });
    expect(installButton).toBeInTheDocument();

    fireEvent.click(installButton);
    expect(mockContextValue.startInstallWithProgress).toHaveBeenCalledTimes(1);
  });

  it('exibe a barra de progresso e as etapas durante a instalação', () => {
    mockContextValue.installProgress = {
      isInstalling: true,
      progress: 45,
      step: 2,
      statusText: 'Baixando pacote do Nexus ITAM e interface offline...',
      isComplete: false,
      error: null,
    };

    render(<PWAInstallModal />);

    expect(screen.getByText('45%')).toBeInTheDocument();
    expect(screen.getByText('Baixando pacote do Nexus ITAM e interface offline...')).toBeInTheDocument();

    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toHaveAttribute('aria-valuenow', '45');
    expect(screen.getByText('Pacote Offline Essencial')).toBeInTheDocument();
  });

  it('exibe o status de saúde e armazenamento quando isStandalone for true', () => {
    mockContextValue.isStandalone = true;
    render(<PWAInstallModal />);

    expect(screen.getByText('Aplicativo Instalado e Sincronizado')).toBeInTheDocument();
    expect(screen.getByText(/12.0 MB/)).toBeInTheDocument();

    const checkUpdatesBtn = screen.getByRole('button', { name: /Verificar Atualizações/i });
    fireEvent.click(checkUpdatesBtn);
    expect(mockContextValue.checkForUpdates).toHaveBeenCalledWith({ silent: false });
  });

  it('exibe orientações do Safari quando isIOS for true e estiver no fluxo com progresso', () => {
    mockContextValue.isIOS = true;
    mockContextValue.installProgress = {
      isInstalling: false,
      progress: 100,
      step: 4,
      statusText: 'Pacote offline pronto!',
      isComplete: true,
      error: null,
    };

    render(<PWAInstallModal />);

    expect(screen.getByText(/Finalizar Fixação no Apple iOS/i)).toBeInTheDocument();
    expect(screen.getByText(/Adicionar à Tela de Início/i)).toBeInTheDocument();
  });

  it('fecha a janela ao clicar no botão fechar (X)', () => {
    render(<PWAInstallModal />);

    const closeButton = screen.getByRole('button', { name: /Fechar janela/i });
    fireEvent.click(closeButton);
    expect(mockContextValue.setIsInstallModalOpen).toHaveBeenCalledWith(false);
  });
});
