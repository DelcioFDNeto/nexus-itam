import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
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
    expect(screen.getByPlaceholderText('Mínimo de 6 caracteres')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Repita a nova senha')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Salvar Nova Senha/i })).toBeInTheDocument();
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
});
