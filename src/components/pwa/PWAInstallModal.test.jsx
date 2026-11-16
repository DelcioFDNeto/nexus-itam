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

  it('expõe diálogo acessível com aria-modal, aria-labelledby e fecha ao pressionar Escape', () => {
    render(<PWAInstallModal />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'pwa-install-title');
    expect(screen.getByRole('heading', { name: 'Nexus ITAM Mobile' })).toHaveAttribute('id', 'pwa-install-title');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(mockContextValue.setIsInstallModalOpen).toHaveBeenCalledWith(false);
  });

  it('alternar isInstalling nao rouba foco de volta para o topo/botao fechar', () => {
    mockContextValue.isStandalone = true;
    const { rerender } = render(<PWAInstallModal />);

    const footerCloseBtn = screen.getByRole('button', { name: 'Fechar' });
    const topCloseBtn = screen.getByRole('button', { name: 'Fechar janela' });
    footerCloseBtn.focus();
    expect(document.activeElement).toBe(footerCloseBtn);

    mockContextValue = {
      ...mockContextValue,
      installProgress: { ...mockContextValue.installProgress, isInstalling: true },
    };
    rerender(<PWAInstallModal />);
    expect(document.activeElement).toBe(footerCloseBtn);
    expect(document.activeElement).not.toBe(topCloseBtn);

    mockContextValue = {
      ...mockContextValue,
      installProgress: { ...mockContextValue.installProgress, isInstalling: false },
    };
    rerender(<PWAInstallModal />);
    expect(document.activeElement).toBe(footerCloseBtn);
    expect(document.activeElement).not.toBe(topCloseBtn);
  });

  it('bloqueia Escape e mouseDown no backdrop enquanto isInstalling for true', () => {
    mockContextValue.installProgress = {
      isInstalling: true,
      progress: 45,
      step: 2,
      statusText: 'Instalando...',
      isComplete: false,
      error: null,
    };

    const { rerender } = render(<PWAInstallModal />);
    const dialog = screen.getByRole('dialog');
    const backdrop = dialog.parentElement;

    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.mouseDown(backdrop);
    expect(mockContextValue.setIsInstallModalOpen).not.toHaveBeenCalled();

    mockContextValue = {
      ...mockContextValue,
      installProgress: {
        isInstalling: false,
        progress: 100,
        step: 4,
        statusText: 'Concluído',
        isComplete: true,
        error: null,
      },
    };
    rerender(<PWAInstallModal />);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(mockContextValue.setIsInstallModalOpen).toHaveBeenCalledWith(false);
  });

  it('mantem Tab e Shift+Tab presos dentro do modal e restaura foco via fallback seguro', () => {
    const inertAside = document.createElement('aside');
    inertAside.setAttribute('inert', '');
    const inertBtn = document.createElement('button');
    inertBtn.textContent = 'Trigger inerte';
    inertAside.appendChild(inertBtn);

    const safeFallback = document.createElement('button');
    safeFallback.textContent = 'Fallback seguro';
    document.body.appendChild(inertAside);
    document.body.appendChild(safeFallback);

    const returnFocusRef = { current: safeFallback };
    mockContextValue.isStandalone = true;

    const { rerender } = render(<PWAInstallModal returnFocusRef={returnFocusRef} />);

    const topCloseBtn = screen.getByRole('button', { name: 'Fechar janela' });
    const footerCloseBtn = screen.getByRole('button', { name: 'Fechar' });

    expect(document.activeElement).toBe(topCloseBtn);

    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(footerCloseBtn);

    fireEvent.keyDown(window, { key: 'Tab' });
    expect(document.activeElement).toBe(topCloseBtn);

    mockContextValue = { ...mockContextValue, isInstallModalOpen: false };
    rerender(<PWAInstallModal returnFocusRef={returnFocusRef} />);
    expect(document.activeElement).toBe(safeFallback);

    inertAside.remove();
    safeFallback.remove();
  });
});
