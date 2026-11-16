import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useAuth } from '../contexts/AuthContext';

const mockUsePWA = vi.fn();

vi.mock('../contexts/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../contexts/ThemeContext', () => ({
  useTheme: () => ({ isDark: false, setTheme: vi.fn() }),
}));
vi.mock('../contexts/PWAContext', () => ({
  usePWA: () => mockUsePWA(),
}));

const renderSidebar = (props = {}, user = { uid: 'u1', name: 'Ana Souza', role: 'admin', companyName: 'Acme Corp' }) => {
  useAuth.mockReturnValue({ currentUser: user, logout: vi.fn(), loading: false });
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Sidebar {...props} />
    </MemoryRouter>,
  );
};

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePWA.mockReturnValue({
      needRefresh: false,
      applyUpdate: vi.fn(),
      canInstall: true,
      isStandalone: false,
      setIsInstallModalOpen: vi.fn(),
    });
  });

  afterEach(() => {
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });

  it('renderiza o drawer mobile aberto com o card executivo do aplicativo nativo', () => {
    const onClose = vi.fn();
    const setIsInstallModalOpen = vi.fn();
    mockUsePWA.mockReturnValue({
      needRefresh: false,
      applyUpdate: vi.fn(),
      canInstall: true,
      isStandalone: false,
      setIsInstallModalOpen,
    });

    renderSidebar({ isOpen: true, onClose });

    expect(screen.getByText('Aplicativo Nexus ITAM Nativo')).toBeTruthy();
    expect(screen.getByText('Instalar no smartphone')).toBeTruthy();

    const installBtn = screen.getByRole('button', { name: /instalar aplicativo/i });
    fireEvent.click(installBtn);

    expect(setIsInstallModalOpen).toHaveBeenCalledWith(true);
    expect(onClose).toHaveBeenCalled();
  });

  it('exibe status Instalado no card quando isStandalone for true', () => {
    mockUsePWA.mockReturnValue({
      needRefresh: false,
      applyUpdate: vi.fn(),
      canInstall: false,
      isStandalone: true,
      setIsInstallModalOpen: vi.fn(),
    });

    renderSidebar({ isOpen: true });

    expect(screen.getByText('Aplicativo Nexus ITAM Nativo')).toBeTruthy();
    expect(screen.getByText('Instalado')).toBeTruthy();
  });

  it('permite fechar o menu mobile ao clicar no botão de fechar (X)', () => {
    const onClose = vi.fn();
    renderSidebar({ isOpen: true, onClose });

    const closeBtn = screen.getByLabelText('Fechar menu');
    expect(document.activeElement).toBe(closeBtn);
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('aplica inert quando o drawer mobile está fechado e remove ao abrir', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Sidebar isOpen={false} onClose={onClose} />
      </MemoryRouter>,
    );

    const aside = screen.getByLabelText('Navegação corporativa', { hidden: true });
    expect(aside).toHaveAttribute('inert');

    rerender(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Sidebar isOpen={true} onClose={onClose} />
      </MemoryRouter>,
    );

    expect(aside).not.toHaveAttribute('inert');
    expect(document.activeElement).toBe(screen.getByLabelText('Fechar menu'));
  });

  it('nao anima RefreshCw antes do clique em Atualizar versão e desabilita ao atualizar', async () => {
    let resolveUpdate;
    const applyUpdate = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    mockUsePWA.mockReturnValue({
      needRefresh: true,
      applyUpdate,
      canInstall: false,
      isStandalone: false,
      setIsInstallModalOpen: vi.fn(),
    });

    renderSidebar({ isCollapsed: false });

    const updateBtn = screen.getByRole('button', { name: /Atualizar versão/i });
    const iconBefore = updateBtn.querySelector('svg');
    expect(updateBtn).not.toBeDisabled();
    expect(iconBefore?.getAttribute('class') || '').not.toContain('animate-spin');

    fireEvent.click(updateBtn);
    expect(applyUpdate).toHaveBeenCalledTimes(1);
    expect(updateBtn).toBeDisabled();
    const iconDuring = updateBtn.querySelector('svg');
    expect(iconDuring?.getAttribute('class') || '').toContain('animate-spin');

    resolveUpdate();
  });

  it('limpa cursor, userSelect e listeners de redimensionamento ao desmontar', () => {
    const onWidthChange = vi.fn();
    const { container, unmount } = renderSidebar({
      isCollapsed: false,
      width: 280,
      onWidthChange,
    });

    const resizer = container.querySelector('[title*="Arraste para ajustar largura"]');
    expect(resizer).toBeTruthy();

    fireEvent.mouseDown(resizer);
    expect(document.body.style.cursor).toBe('col-resize');
    expect(document.body.style.userSelect).toBe('none');

    fireEvent.mouseMove(window, { clientX: 314 });
    expect(onWidthChange).toHaveBeenCalledWith(300);

    unmount();
    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('');

    fireEvent.mouseMove(window, { clientX: 350 });
    expect(onWidthChange).toHaveBeenCalledTimes(1);
  });

  it('nao rouba foco de um modal [aria-modal="true"] aberto ao fechar o drawer mobile', async () => {
    const triggerBtn = document.createElement('button');
    triggerBtn.textContent = 'Abrir';
    document.body.appendChild(triggerBtn);
    const returnFocusRef = { current: triggerBtn };

    const modal = document.createElement('div');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const modalBtn = document.createElement('button');
    modalBtn.textContent = 'Dentro do modal';
    modal.appendChild(modalBtn);

    const { rerender } = render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Sidebar isOpen={true} onClose={vi.fn()} returnFocusRef={returnFocusRef} />
      </MemoryRouter>,
    );

    // Simula abertura de um modal (ex.: PWAInstallModal) no mesmo ciclo de fechamento do drawer
    document.body.appendChild(modal);
    modalBtn.focus();

    rerender(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Sidebar isOpen={false} onClose={vi.fn()} returnFocusRef={returnFocusRef} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(document.activeElement).toBe(modalBtn);
    });

    modal.remove();
    triggerBtn.remove();
  });
});
