import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import CollaboratorAssetsPage from './CollaboratorAssetsPage';
import * as authContext from '../contexts/AuthContext';
import * as employeeService from '../services/employeeService';
import * as assetService from '../services/assetService';

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

describe('CollaboratorAssetsPage', () => {
  const mockUser = {
    tenantId: 'tenant-ap3htf6',
    displayName: 'João da Silva',
    name: 'João da Silva',
    email: 'joao.silva@empresa.com.br',
    role: 'user'
  };

  const mockEmployees = [
    {
      id: 'emp-1',
      name: 'João da Silva',
      role: 'Analista de Suporte',
      sector: 'TI & Operações',
      branch: 'Filial Belém',
      email: 'joao.silva@empresa.com.br'
    }
  ];

  const mockAssets = [
    {
      id: 'ast-1',
      internalId: 'NXS-BEL-NTB-001',
      model: 'Latitude 3420',
      brand: 'Dell',
      type: 'Notebook',
      serialNumber: 'BRG1234567',
      assignedTo: 'João da Silva',
      status: 'Em Uso',
      valor: '4500.00',
      location: 'Filial Belém'
    },
    {
      id: 'ast-2',
      internalId: 'NXS-BEL-CEL-001',
      model: 'Galaxy A15',
      brand: 'Samsung',
      type: 'Smartphone',
      serialNumber: 'SM-A15-9988',
      assignedTo: 'João da Silva',
      status: 'Em Uso',
      valor: '1200.00',
      location: 'Filial Belém'
    }
  ];

  beforeEach(() => {
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      currentUser: mockUser
    });
    vi.spyOn(employeeService, 'getEmployees').mockResolvedValue(mockEmployees);
    vi.spyOn(assetService, 'getAssets').mockResolvedValue(mockAssets);
  });

  afterEach(() => {
    if (originalClipboardDescriptor) {
      Object.defineProperty(navigator, 'clipboard', originalClipboardDescriptor);
    } else {
      delete navigator.clipboard;
    }
    vi.restoreAllMocks();
  });

  it('renders collaborator profile, KPIs and assigned equipment', async () => {
    render(
      <BrowserRouter>
        <CollaboratorAssetsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('João da Silva')).toBeInTheDocument();
    });

    expect(screen.getByText('Total de Ativos')).toBeInTheDocument();
    expect(screen.getByText('NXS-BEL-NTB-001')).toBeInTheDocument();
    expect(screen.getByText('NXS-BEL-CEL-001')).toBeInTheDocument();
  });

  it('filters equipment via category pills', async () => {
    render(
      <BrowserRouter>
        <CollaboratorAssetsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('NXS-BEL-NTB-001')).toBeInTheDocument();
    });

    // Clica no filtro Smartphones
    const smartBtn = screen.getByText('Smartphones');
    fireEvent.click(smartBtn);

    expect(screen.getByText('NXS-BEL-CEL-001')).toBeInTheDocument();
    expect(screen.queryByText('NXS-BEL-NTB-001')).not.toBeInTheDocument();
  });

  it('allows confirming asset inspection with visual feedback', async () => {
    render(
      <BrowserRouter>
        <CollaboratorAssetsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('NXS-BEL-NTB-001')).toBeInTheDocument();
    });

    const confirmBtns = screen.getAllByText('Confirmar Posse / Vistoria');
    fireEvent.click(confirmBtns[0]);

    await waitFor(() => {
      expect(screen.getByText(/Posse verificada hoje às/)).toBeInTheDocument();
    });
  });

  it('matches compound names between employee and asset assignedTo field', async () => {
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      currentUser: {
        tenantId: 'tenant-ap3htf6',
        name: 'Délcio Farias',
        email: 'delcio@empresa.com.br',
        role: 'user'
      }
    });

    vi.spyOn(employeeService, 'getEmployees').mockResolvedValue([
      { id: 'emp-2', name: 'Délcio Farias', email: 'delcio@empresa.com.br', role: 'Gestor' }
    ]);

    vi.spyOn(assetService, 'getAssets').mockResolvedValue([
      {
        id: 'ast-compound',
        internalId: 'NXS-BEL-NTB-017',
        model: 'Galaxy Book 2',
        brand: 'Samsung',
        type: 'Notebook',
        assignedTo: 'Délcio Farias Dias Neto',
        status: 'Em Uso',
        valor: '3800.00'
      }
    ]);

    render(
      <BrowserRouter>
        <CollaboratorAssetsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('NXS-BEL-NTB-017')).toBeInTheDocument();
    });
    expect(screen.getByText('Galaxy Book 2')).toBeInTheDocument();
  });

  it('abre Ficha Técnica como dialog acessível e fecha com Escape restaurando foco', async () => {
    render(
      <BrowserRouter>
        <CollaboratorAssetsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('NXS-BEL-NTB-001')).toBeInTheDocument();
    });

    const triggers = screen.getAllByRole('button', { name: /Ficha Técnica/i });
    triggers[0].focus();
    fireEvent.click(triggers[0]);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(triggers[0]).toHaveFocus();
  });

  it('exibe estado de erro com retry acessível quando falha ao carregar ativos', async () => {
    vi.spyOn(assetService, 'getAssets')
      .mockRejectedValueOnce(new Error('Falha de rede no catálogo'))
      .mockResolvedValueOnce(mockAssets);

    render(
      <BrowserRouter>
        <CollaboratorAssetsPage />
      </BrowserRouter>
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Falha de rede no catálogo');

    fireEvent.click(screen.getByRole('button', { name: /Tentar novamente/i }));

    await waitFor(() => {
      expect(screen.getByText('NXS-BEL-NTB-001')).toBeInTheDocument();
    });
  });

  it('não fecha Ficha Técnica ao pressionar Escape quando existe alertdialog empilhado acima', async () => {
    render(
      <BrowserRouter>
        <CollaboratorAssetsPage />
        <div role="alertdialog" aria-modal="true">
          <button type="button">Cancelar</button>
        </div>
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('NXS-BEL-NTB-001')).toBeInTheDocument();
    });

    const triggers = screen.getAllByRole('button', { name: /Ficha Técnica/i });
    fireEvent.click(triggers[0]);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
