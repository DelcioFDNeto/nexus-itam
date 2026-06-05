import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import AssetForm from './AssetForm';
import { useAuth } from '../contexts/AuthContext';
import { createAsset } from '../services/assetService';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn()
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: vi.fn().mockResolvedValue({
    exists: () => true,
    data: () => ({ locations: ['HQ'], departments: ['IT'] })
  })
}));

vi.mock('../services/firebase', () => ({
  db: {}
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({})
  };
});

vi.mock('../services/assetService', () => ({
  getAssetById: vi.fn().mockResolvedValue(null),
  createAsset: vi.fn().mockResolvedValue('123'),
  updateAsset: vi.fn().mockResolvedValue()
}));

vi.mock('../services/employeeService', () => ({
  getEmployees: vi.fn().mockResolvedValue([{ id: 'e1', name: 'John Doe' }])
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn()
  }
}));

describe('AssetForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({
      currentUser: { email: 'admin@test.com', tenantId: 'tenant1' }
    });
  });

  it('renders form fields correctly and avoids act warning', async () => {
    render(
      <BrowserRouter>
        <AssetForm />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Ex: Notebook/i)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/Ex: SHL-NB-001/i)).toBeInTheDocument();
    });
  });

  it('submits a new asset successfully', async () => {
    render(
      <BrowserRouter>
        <AssetForm />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Ex: Notebook/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText(/Ex: Notebook/i), { target: { value: 'MacBook Pro' } });
    fireEvent.change(screen.getByPlaceholderText(/Ex: SHL-NB-001/i), { target: { value: 'DEV-001' } });
    
    // Click the "Celular" button to change type
    fireEvent.click(screen.getByText('Celular'));
    
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Ex: 3569.../i)).toBeInTheDocument();
    });
    
    fireEvent.change(screen.getByPlaceholderText(/Ex: 3569.../i), { target: { value: '123456789012345' } });

    fireEvent.click(screen.getByRole('button', { name: /Cadastrar Ativo/i }));

    await waitFor(() => {
      expect(createAsset).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/assets');
    });
  });
});
