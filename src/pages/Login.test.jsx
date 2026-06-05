import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import Login from './Login';
import { useAuth } from '../contexts/AuthContext';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn()
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate
  };
});

describe('Login Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders login form correctly', () => {
    useAuth.mockReturnValue({
      login: vi.fn(),
      currentUser: null,
      loading: false
    });

    render(
      <BrowserRouter>
        <Login />
      </BrowserRouter>
    );

    expect(screen.getByPlaceholderText('acesso@nexusitam.com')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('••••••••')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Autenticar/i })).toBeInTheDocument();
  });

  it('calls login function on submit', async () => {
    const mockLogin = vi.fn().mockResolvedValueOnce();
    useAuth.mockReturnValue({
      login: mockLogin,
      currentUser: null,
      loading: false
    });

    render(
      <BrowserRouter>
        <Login />
      </BrowserRouter>
    );

    fireEvent.change(screen.getByPlaceholderText('acesso@nexusitam.com'), { target: { value: 'admin@test.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /Autenticar/i }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('admin@test.com', 'password123');
    });
  });
});
