// src/pages/CollaboratorAccessManager.test.jsx
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CollaboratorAccessManager from './CollaboratorAccessManager';
import { microservicesApi } from '../services/microservicesClient';
import { getEmployees, getSectors } from '../services/employeeService';

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

const confirmMock = vi.hoisted(() => vi.fn().mockResolvedValue(true));

vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('../components/ConfirmDialog', () => ({ useConfirm: () => confirmMock }));
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    currentUser: {
      uid: 'mgr-1',
      email: 'gestor@shineraybysabel.com.br',
      role: 'manager',
      tenantId: 'tenant-ap3htf6',
      companyName: 'Shineray By Sabel',
      primaryColor: '#E11D48',
      entitlements: { features: { whitelabel: true } },
    },
  }),
}));

vi.mock('../services/employeeService', () => ({
  getEmployees: vi.fn(),
  getSectors: vi.fn(),
}));

vi.mock('../services/microservicesClient', () => ({
  resolvePortalUrl: () => 'https://portal.shinerayitam.com.br',
  microservicesApi: {
    listUsers: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    deleteUser: vi.fn(),
  },
}));

describe('CollaboratorAccessManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirmMock.mockResolvedValue(true);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });

    getEmployees.mockResolvedValue([
      {
        id: 'emp-1',
        name: 'Marina Silva',
        email: 'marina.silva@shineraybysabel.com.br',
        sector: 'Vendas',
        role: 'Consultora',
      },
      {
        id: 'emp-2',
        name: 'Carlos Pereira',
        email: 'carlos.pereira@shineraybysabel.com.br',
        sector: 'Pos-Vendas',
        role: 'Analista',
      },
    ]);
    getSectors.mockResolvedValue([{ id: 'sec-1', name: 'Vendas' }]);
    microservicesApi.listUsers.mockResolvedValue({
      items: [
        {
          id: 'u-1',
          name: 'Carlos Pereira',
          email: 'carlos.pereira@shineraybysabel.com.br',
          role: 'collaborator',
          department: 'Pos-Vendas',
          job_title: 'Analista',
          active: true,
        },
      ],
    });
    microservicesApi.createUser.mockResolvedValue({
      user: {
        id: 'u-2',
        name: 'Marina Silva',
        email: 'marina.silva@shineraybysabel.com.br',
        role: 'collaborator',
        department: 'Vendas',
        job_title: 'Consultora',
        active: true,
      },
    });
    microservicesApi.updateUser.mockResolvedValue({
      user: {
        id: 'u-1',
        name: 'Carlos Pereira',
        email: 'carlos.pereira@shineraybysabel.com.br',
        role: 'collaborator',
        active: false,
      },
    });
  });

  it('carrega KPIs, importa colaborador do RH, cadastra acesso e permite suspender/redefinir senha', async () => {
    render(
      <MemoryRouter>
        <CollaboratorAccessManager />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Acessos do Portal do Colaborador')).toBeInTheDocument();
    });

    // Link Whitelabel carrega marca da empresa para o Portal Vue 3
    const portalLink = screen.getByRole('link', { name: /Abrir Portal/i });
    expect(portalLink.getAttribute('href')).toContain('empresa=Shineray+By+Sabel');
    expect(portalLink.getAttribute('href')).toContain('cor=%23E11D48');

    // Seleciona colaborador do RH ainda sem acesso (quick chip)
    const quickChip = await screen.findByRole('button', { name: /Marina Silva/i });
    fireEvent.click(quickChip);

    expect(screen.getByLabelText(/Nome Completo/i)).toHaveValue('Marina Silva');
    expect(screen.getByLabelText(/E-mail Corporativo/i)).toHaveValue('marina.silva@shineraybysabel.com.br');

    // Libera o acesso e verifica modal com link Whitelabel
    fireEvent.click(screen.getByRole('button', { name: /Cadastrar e Liberar Acesso ao Portal/i }));

    await waitFor(() => {
      expect(microservicesApi.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Marina Silva',
          email: 'marina.silva@shineraybysabel.com.br',
          role: 'collaborator',
        }),
      );
    });

    expect(await screen.findByText(/Acesso Criado com Sucesso!/i)).toBeInTheDocument();

    // Fecha modal e suspende usuario existente
    fireEvent.click(screen.getByRole('button', { name: /Fechar/i }));

    const suspendBtn = screen.getByTitle('Suspender acesso temporariamente');
    fireEvent.click(suspendBtn);

    await waitFor(() => {
      expect(microservicesApi.updateUser).toHaveBeenCalledWith('u-1', { active: false });
    });
  });
});
