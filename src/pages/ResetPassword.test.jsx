import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import ResetPassword from './ResetPassword';
import * as firebaseAuth from 'firebase/auth';

vi.mock('firebase/auth', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    verifyPasswordResetCode: vi.fn(),
    confirmPasswordReset: vi.fn(),
  };
});

describe('ResetPassword Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exibe erro amigavel quando acessado sem oobCode', async () => {
    render(
      <MemoryRouter initialEntries={['/reset-password']}>
        <ResetPassword />
      </MemoryRouter>
    );

    expect(await screen.findByText(/Link de redefinição incompleto ou inválido/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Voltar para o Login/i })).toBeInTheDocument();
  });

  it('valida o codigo oobCode e renderiza o formulario com o e-mail da conta', async () => {
    vi.mocked(firebaseAuth.verifyPasswordResetCode).mockResolvedValueOnce('colaborador@empresa.com.br');

    render(
      <MemoryRouter initialEntries={['/reset-password?mode=resetPassword&oobCode=valid_code_123']}>
        <ResetPassword />
      </MemoryRouter>
    );

    expect(await screen.findByText('colaborador@empresa.com.br')).toBeInTheDocument();
    const newPassInput = screen.getByLabelText('Nova Senha');
    const confirmPassInput = screen.getByLabelText('Confirmar Senha');
    expect(newPassInput).toHaveAttribute('type', 'password');
    expect(confirmPassInput).toHaveAttribute('type', 'password');
    expect(screen.getByPlaceholderText('Mínimo de 6 caracteres')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Repita a nova senha')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Mostrar nova senha/i }));
    expect(newPassInput).toHaveAttribute('type', 'text');

    expect(screen.getByRole('button', { name: /Salvar Nova Senha/i })).toBeInTheDocument();
  });

  it('exibe feedback inline role="alert" quando senhas nao coincidem', async () => {
    vi.mocked(firebaseAuth.verifyPasswordResetCode).mockResolvedValueOnce('colaborador@empresa.com.br');

    render(
      <MemoryRouter initialEntries={['/reset-password?mode=resetPassword&oobCode=valid_code_123']}>
        <ResetPassword />
      </MemoryRouter>
    );

    await screen.findByText('colaborador@empresa.com.br');

    fireEvent.change(screen.getByLabelText('Nova Senha'), { target: { value: 'SenhaForte1' } });
    fireEvent.change(screen.getByLabelText('Confirmar Senha'), { target: { value: 'Diferente1' } });
    fireEvent.click(screen.getByRole('button', { name: /Salvar Nova Senha/i }));

    expect(screen.getByRole('alert')).toHaveTextContent('As senhas digitadas não coincidem.');
    expect(screen.getByLabelText('Confirmar Senha')).toHaveAttribute('aria-invalid', 'true');
    expect(firebaseAuth.confirmPasswordReset).not.toHaveBeenCalled();
  });

  it('chama confirmPasswordReset e exibe estado de sucesso ao salvar nova senha', async () => {
    vi.mocked(firebaseAuth.verifyPasswordResetCode).mockResolvedValueOnce('colaborador@empresa.com.br');
    vi.mocked(firebaseAuth.confirmPasswordReset).mockResolvedValueOnce();

    render(
      <MemoryRouter initialEntries={['/reset-password?mode=resetPassword&oobCode=valid_code_123']}>
        <ResetPassword />
      </MemoryRouter>
    );

    await screen.findByText('colaborador@empresa.com.br');

    fireEvent.change(screen.getByPlaceholderText('Mínimo de 6 caracteres'), {
      target: { value: 'NovaSenhaForte@2026' },
    });
    fireEvent.change(screen.getByPlaceholderText('Repita a nova senha'), {
      target: { value: 'NovaSenhaForte@2026' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Salvar Nova Senha/i }));

    await waitFor(() => {
      expect(firebaseAuth.confirmPasswordReset).toHaveBeenCalledWith(
        expect.anything(),
        'valid_code_123',
        'NovaSenhaForte@2026'
      );
    });

    expect(await screen.findByText(/Senha Atualizada!/i)).toBeInTheDocument();
  });

  it('cancela verificacao pendente ao mudar oobCode e limpa erro anterior', async () => {
    let rejectFirst;
    const firstPromise = new Promise((_, reject) => {
      rejectFirst = reject;
    });
    vi.mocked(firebaseAuth.verifyPasswordResetCode)
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValueOnce('novo@empresa.com.br');

    const SwitchCodeButton = () => {
      const navigate = useNavigate();
      return (
        <button
          type="button"
          onClick={() => navigate('/reset-password?mode=resetPassword&oobCode=new_code')}
        >
          Trocar código
        </button>
      );
    };

    render(
      <MemoryRouter initialEntries={['/reset-password?mode=resetPassword&oobCode=old_code']}>
        <SwitchCodeButton />
        <ResetPassword />
      </MemoryRouter>,
    );

    expect(screen.getByRole('status')).toHaveTextContent(/Verificando link de segurança/i);

    fireEvent.click(screen.getByRole('button', { name: 'Trocar código' }));

    expect(await screen.findByText('novo@empresa.com.br')).toBeInTheDocument();

    // Rejeição tardia do primeiro código não sobrescreve o novo estado nem exibe erro
    rejectFirst({ code: 'auth/expired-action-code' });
    await Promise.resolve();
    expect(screen.queryByText(/Este link de redefinição já expirou/i)).not.toBeInTheDocument();
    expect(screen.getByText('novo@empresa.com.br')).toBeInTheDocument();
  });
});
