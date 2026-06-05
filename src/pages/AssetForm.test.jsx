import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import AssetForm from './AssetForm';
import { useAuth } from '../contexts/AuthContext';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn()
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
  addAsset: vi.fn().mockResolvedValue('123'),
  updateAsset: vi.fn().mockResolvedValue()
}));

describe('AssetForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({
      currentUser: { email: 'admin@test.com', tenantId: 'tenant1' }
    });
  });

  it('renders form fields correctly', () => {
    render(
      <BrowserRouter>
        <AssetForm />
      </BrowserRouter>
    );

    expect(screen.getByPlaceholderText(/Ex: Notebook/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Ex: SHL-NB-001/i)).toBeInTheDocument();
  });
});
