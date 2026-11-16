import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import AssetList from './AssetList';
import { ConfirmProvider } from '../components/ConfirmDialog';
import { useAuth } from '../contexts/AuthContext';
import { updateAsset } from '../services/assetService';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn()
}));

const mockUnsubscribe = vi.fn();
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  orderBy: vi.fn(),
  where: vi.fn(),
  onSnapshot: vi.fn((q, callback) => {
    callback({
      docs: [
        {
          id: 'asset-1',
          data: () => ({
            internalId: 'PAT-001',
            model: 'Dell Latitude 3420',
            type: 'Notebook',
            status: 'Em Uso',
            location: 'Matriz - TI',
            assignedTo: 'Carlos Silva',
            createdAt: '2026-01-10T10:00:00.000Z'
          })
        },
        {
          id: 'asset-2',
          data: () => ({
            internalId: 'PAT-002',
            model: 'Samsung Galaxy A15',
            type: 'Celular',
            status: 'Baixado',
            location: 'Depósito',
            assignedTo: '',
            createdAt: '2026-01-15T10:00:00.000Z'
          })
        }
      ]
    });
    return mockUnsubscribe;
  }),
  doc: vi.fn(),
  getDoc: vi.fn().mockResolvedValue({
    exists: () => true,
    data: () => ({ companyName: 'Empresa Exemplo Ltda' })
  })
}));

vi.mock('../services/firebase', () => ({
  db: {}
}));

vi.mock('../services/assetService', () => ({
  getAllAssets: vi.fn().mockResolvedValue([]),
  updateAsset: vi.fn().mockResolvedValue(),
}));

describe('AssetList Page', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
    useAuth.mockReturnValue({
      currentUser: { email: 'admin@test.com', tenantId: 'tenant-123' }
    });
  });

  it('renders without crashing and displays active assets', async () => {
    render(
      <BrowserRouter>
        <AssetList />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText(/PAT-001/)[0]).toBeInTheDocument();
      expect(screen.getAllByText('Dell Latitude 3420')[0]).toBeInTheDocument();
    });

    // Baixado should be hidden by default
    expect(screen.queryByText(/PAT-002/)).not.toBeInTheDocument();
  });

  it('toggles retired assets visibility when clicking the Baixados button', async () => {
    render(
      <BrowserRouter>
        <AssetList />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText(/PAT-001/)[0]).toBeInTheDocument();
    });

    const baixadosBtn = screen.getByTitle(/Incluir ativos baixados/i);
    expect(baixadosBtn).toBeInTheDocument();

    fireEvent.click(baixadosBtn);

    await waitFor(() => {
      expect(screen.getAllByText(/PAT-002/)[0]).toBeInTheDocument();
      expect(screen.getAllByText('Samsung Galaxy A15')[0]).toBeInTheDocument();
    });
  });

  it('clears search input when clear button is clicked', async () => {
    render(
      <BrowserRouter>
        <AssetList />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText(/PAT-001/)[0]).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Buscar por tag, modelo, serial ou responsável/i);
    fireEvent.change(searchInput, { target: { value: 'Dell' } });
    expect(searchInput.value).toBe('Dell');

    const clearBtn = screen.getByLabelText(/Limpar busca/i);
    expect(clearBtn).toBeInTheDocument();

    fireEvent.click(clearBtn);
    expect(searchInput.value).toBe('');
  });

  it('opens and closes mobile filter bottom sheet drawer', async () => {
    render(
      <BrowserRouter>
        <AssetList />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText(/PAT-001/)[0]).toBeInTheDocument();
    });

    const filterBtn = screen.getByLabelText(/Filtros avançados/i);
    fireEvent.click(filterBtn);

    expect(await screen.findByText('Filtros do Inventário')).toBeInTheDocument();
    expect(screen.getByText('Status Operacional')).toBeInTheDocument();
    expect(screen.getByText('Localização / Setor')).toBeInTheDocument();

    const closeBtn = screen.getByLabelText(/Fechar filtros/i);
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByText('Filtros do Inventário')).not.toBeInTheDocument();
    });
  });

  it('shows error state and retries when asset snapshot fails', async () => {
    const { onSnapshot } = await import('firebase/firestore');
    onSnapshot
      .mockImplementationOnce((_q, _onNext, onError) => {
        onError(new Error('network error'));
        return mockUnsubscribe;
      });

    render(
      <BrowserRouter>
        <AssetList />
      </BrowserRouter>
    );

    expect(await screen.findByText('Falha ao carregar o inventário')).toBeInTheDocument();

    const retryBtn = screen.getByRole('button', { name: /Tentar novamente/i });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getAllByText(/PAT-001/)[0]).toBeInTheDocument();
    });
  });

  it('mantem ConfirmDialog acima do modal de status em massa, ignora Escape enquanto ConfirmDialog esta no topo e restaura foco para busca', async () => {
    useAuth.mockReturnValue({
      currentUser: { email: 'admin@test.com', tenantId: 'tenant-123', role: 'admin' },
    });
    updateAsset.mockResolvedValue();

    render(
      <ConfirmProvider>
        <BrowserRouter>
          <AssetList />
        </BrowserRouter>
      </ConfirmProvider>
    );

    await waitFor(() => {
      expect(screen.getAllByText(/PAT-001/)[0]).toBeInTheDocument();
    });

    const selectBtn = screen.getAllByRole('button', { name: /Selecionar PAT-001/i })[0];
    fireEvent.click(selectBtn);

    const bulkStatusBtn = await screen.findByRole('button', { name: /Status/i });
    bulkStatusBtn.focus();
    fireEvent.click(bulkStatusBtn);

    const statusDialog = await screen.findByRole('dialog');
    expect(statusDialog.parentElement.className).toContain('z-[90]');

    fireEvent.click(within(statusDialog).getByRole('button', { name: 'Disponível' }));

    const confirmAlert = await screen.findByRole('alertdialog');
    expect(confirmAlert.parentElement.className).toContain('z-[100]');

    // Escape fecha apenas o ConfirmDialog no topo, mantendo o modal de status aberto
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Confirma alteracao em massa -> limpa selecao e restaura foco ao campo de busca
    fireEvent.click(within(statusDialog).getByRole('button', { name: 'Disponível' }));
    const confirmBtn = await screen.findByRole('button', { name: /Confirmar Alteração/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(updateAsset).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Buscar por tag, modelo, serial ou responsável/i);
    expect(document.activeElement).toBe(searchInput);
  });
});
