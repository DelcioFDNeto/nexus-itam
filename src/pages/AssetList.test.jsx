import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import AssetList from './AssetList';
import { useAuth } from '../contexts/AuthContext';

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
    data: () => ({ companyName: 'Shineray By Sabel' })
  })
}));

vi.mock('../services/firebase', () => ({
  db: {}
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
});

