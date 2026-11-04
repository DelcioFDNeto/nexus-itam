import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });
});
