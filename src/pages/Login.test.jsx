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

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn()
  }
}));

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

    expect(screen.getByRole('heading', { level: 1, name: /Nexus\s*ITAM/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('nome@empresa.com.br')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('••••••••')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mostrar senha/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Autenticar/i })).toBeInTheDocument();
  });

  it('mantem ordem logica de tabulacao entre e-mail, senha, visibilidade, recuperacao e envio', () => {
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

    const emailInput = screen.getByLabelText('E-mail corporativo');
    const passwordInput = screen.getByLabelText('Senha');
    const toggleBtn = screen.getByRole('button', { name: /Mostrar senha/i });
    const forgotBtn = screen.getByRole('button', { name: /Esqueceu a senha\?/i });
    const submitBtn = screen.getByRole('button', { name: /Autenticar/i });

    const ordered = [emailInput, passwordInput, toggleBtn, forgotBtn, submitBtn];
    for (let i = 0; i < ordered.length - 1; i++) {
      expect(ordered[i].compareDocumentPosition(ordered[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }

    expect(passwordInput).toHaveAttribute('type', 'password');
    fireEvent.click(toggleBtn);
    expect(passwordInput).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: /Ocultar senha/i })).toHaveAttribute('aria-pressed', 'true');
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

    fireEvent.change(screen.getByPlaceholderText('nome@empresa.com.br'), { target: { value: 'admin@test.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /Autenticar/i }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('admin@test.com', 'password123');
    });
  });

  it('shows error toast when login fails', async () => {
    const mockLogin = vi.fn().mockRejectedValueOnce(new Error('Invalid credentials'));
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

    fireEvent.change(screen.getByPlaceholderText('nome@empresa.com.br'), { target: { value: 'admin@test.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'wrongpass' } });
    fireEvent.click(screen.getByRole('button', { name: /Autenticar/i }));

    await waitFor(() => {
      expect(screen.getByText('Acesso negado. Verifique suas credenciais.')).toBeInTheDocument();
    });
  });

  it('valida formulario inline sem recarregar quando e-mail e invalido', () => {
    const mockLogin = vi.fn();
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

    fireEvent.change(screen.getByLabelText('E-mail corporativo'), { target: { value: 'invalido' } });
    fireEvent.click(screen.getByRole('button', { name: /Autenticar/i }));

    expect(screen.getByRole('alert')).toHaveTextContent('Informe um e-mail corporativo válido.');
    expect(screen.getByLabelText('E-mail corporativo')).toHaveAttribute('aria-invalid', 'true');
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('renders elegant splash screen when session is loading', () => {
    useAuth.mockReturnValue({
      login: vi.fn(),
      currentUser: null,
      loading: true
    });

    render(
      <BrowserRouter>
        <Login />
      </BrowserRouter>
    );

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('Abrindo o sistema…')).toBeInTheDocument();
    expect(screen.getByText('Gestão Inteligente de Ativos')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('nome@empresa.com.br')).not.toBeInTheDocument();
  });

  it('abre modal de redefinicao de senha, valida e-mail, zera estado ao reabrir e fecha no Escape ou backdrop', async () => {
    const mockResetPassword = vi.fn().mockResolvedValueOnce();
    useAuth.mockReturnValue({
      login: vi.fn(),
      resetPassword: mockResetPassword,
      currentUser: null,
      loading: false,
    });

    render(
      <BrowserRouter>
        <Login />
      </BrowserRouter>,
    );

    const forgotBtn = screen.getByRole('button', { name: /Esqueceu a senha\?/i });
    forgotBtn.focus();
    fireEvent.click(forgotBtn);

    const dialog = screen.getByRole('dialog', { name: /Redefinir Senha/i });
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    const resetInput = screen.getByLabelText('E-mail cadastrado');
    await waitFor(() => {
      expect(document.activeElement).toBe(resetInput);
    });

    // Validação inline com e-mail inválido
    fireEvent.change(resetInput, { target: { value: 'invalido' } });
    fireEvent.click(screen.getByRole('button', { name: /Enviar link de recuperação/i }));
    expect(screen.getByRole('alert')).toHaveTextContent('Informe um e-mail válido para recuperar.');
    expect(resetInput).toHaveAttribute('aria-invalid', 'true');
    expect(mockResetPassword).not.toHaveBeenCalled();

    // Fecha no Escape e restaura foco ao gatilho
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(forgotBtn);

    // Reabre sem manter erro anterior e envia com e-mail válido
    fireEvent.click(forgotBtn);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    const reopenedInput = screen.getByLabelText('E-mail cadastrado');
    fireEvent.change(reopenedInput, { target: { value: 'ana@empresa.com.br' } });
    fireEvent.click(screen.getByRole('button', { name: /Enviar link de recuperação/i }));

    await waitFor(() => {
      expect(mockResetPassword).toHaveBeenCalledWith('ana@empresa.com.br');
      expect(screen.getByRole('status')).toHaveTextContent(
        'E-mail de recuperação enviado! Verifique sua caixa de entrada.',
      );
    });

    // Fecha por mouseDown no backdrop e ao reabrir exibe o formulário limpo
    const backdrop = screen.getByRole('dialog').parentElement;
    fireEvent.mouseDown(backdrop);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(forgotBtn);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Enviar link de recuperação/i })).toBeInTheDocument();
  });
});
