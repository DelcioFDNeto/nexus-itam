// src/pages/EmployeeManager.test.jsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import EmployeeManager from './EmployeeManager';
import { generateRandomSecurePassword } from '../utils/passwords';
import { useAuth } from '../contexts/AuthContext';
import { microservicesApi } from '../services/microservicesClient';
import * as employeeService from '../services/employeeService';
import * as assetService from '../services/assetService';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../components/ConfirmDialog', () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('../services/employeeService', () => ({
  getEmployees: vi.fn(),
  addEmployee: vi.fn(),
  updateEmployee: vi.fn(),
  deleteEmployee: vi.fn(),
  getSectors: vi.fn(),
  addSector: vi.fn(),
  updateSector: vi.fn(),
  deleteSector: vi.fn(),
}));

vi.mock('../services/assetService', () => ({
  getAssets: vi.fn(),
  getAssetsAssignedTo: vi.fn(),
}));

describe('EmployeeManager & Gerador de Senhas Seguras (Portal do Colaborador)', () => {
  let originalClipboardDescriptor;

  beforeEach(() => {
    vi.clearAllMocks();
    originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

    useAuth.mockReturnValue({
      currentUser: {
        uid: 'user-owner-1',
        name: 'TI Corporativa',
        email: 'ti@empresa-exemplo.com.br',
        role: 'owner',
        tenantId: 'tenant-ap3htf6',
      },
    });

    employeeService.getEmployees.mockResolvedValue([
      {
        id: 'emp-1',
        name: 'João da Silva',
        email: 'joao.silva@empresa-exemplo.com.br',
        role: 'Consultor de Vendas',
        sector: 'Vendas Concessionária',
        branch: 'Matriz Belém',
      },
    ]);

    employeeService.getSectors.mockResolvedValue([
      { id: 'sec-1', name: 'TI & Infraestrutura', manager: 'Marcos Almeida' },
      { id: 'sec-2', name: 'Vendas Concessionária', manager: 'João da Silva' },
    ]);

    employeeService.addEmployee.mockResolvedValue('emp-new');
    assetService.getAssets.mockResolvedValue([]);

    vi.spyOn(microservicesApi, 'listUsers').mockResolvedValue({
      total: 1,
      items: [
        {
          id: 'u-colab-1',
          name: 'Karen Matos',
          email: 'karen.matos@empresa-exemplo.com.br',
          role: 'collaborator',
          department: 'Vendas & Pós-Vendas',
          job_title: 'Consultora Comercial',
          active: true,
        },
      ],
    });

    vi.spyOn(microservicesApi, 'createUser').mockResolvedValue({
      user: {
        id: 'u-colab-new',
        name: 'Lucas Ferreira',
        email: 'lucas.ferreira@empresa-exemplo.com.br',
        role: 'collaborator',
        department: 'Vendas Concessionária',
        job_title: 'Consultor de Vendas',
        active: true,
      },
    });

    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalClipboardDescriptor) {
      Object.defineProperty(navigator, 'clipboard', originalClipboardDescriptor);
    } else {
      delete navigator.clipboard;
    }
  });

  describe('generateRandomSecurePassword', () => {
    it('gera senhas com comprimento padrão de 14 caracteres', () => {
      const pwd = generateRandomSecurePassword();
      expect(pwd).toHaveLength(14);
    });

    it('gera senhas com comprimento personalizado', () => {
      const pwd18 = generateRandomSecurePassword(18);
      expect(pwd18).toHaveLength(18);
    });

    it('contém maiúsculas, minúsculas, números e caracteres especiais', () => {
      for (let i = 0; i < 20; i++) {
        const pwd = generateRandomSecurePassword(14);
        expect(/[A-Z]/.test(pwd)).toBe(true);
        expect(/[a-z]/.test(pwd)).toBe(true);
        expect(/[0-9]/.test(pwd)).toBe(true);
        expect(/[@#$!%&*+=?]/.test(pwd)).toBe(true);
      }
    });

    it('possui entropia e gera strings diferentes a cada invocação', () => {
      const set = new Set();
      for (let i = 0; i < 50; i++) {
        set.add(generateRandomSecurePassword(14));
      }
      expect(set.size).toBe(50);
    });
  });

  describe('Interface e Aba do Portal do Colaborador', () => {
    const renderPage = () => render(
      <MemoryRouter>
        <EmployeeManager />
      </MemoryRouter>,
    );

    it('renderiza as 3 abas principais: Colaboradores, Setores e Portal do Colaborador (Acessos)', async () => {
      renderPage();

      expect(await screen.findByText(/Gestão de Pessoas & Áreas/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Colaboradores/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Setores \/ Deptos/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Portal do Colaborador \(Acessos\)/i })).toBeInTheDocument();
    });

    it('exibe estado de erro com retry quando o carregamento falha', async () => {
      employeeService.getEmployees.mockRejectedValueOnce(new Error('Network error'));
      renderPage();

      expect(await screen.findByRole('alert')).toBeInTheDocument();
      const retryBtn = screen.getByRole('button', { name: /Tentar novamente/i });
      fireEvent.click(retryBtn);

      expect(await screen.findByText('João da Silva')).toBeInTheDocument();
    });

    it('alterna para a aba do Portal do Colaborador e exibe banner LGPD e formulário', async () => {
      renderPage();

      const portalTabBtn = await screen.findByRole('button', {
        name: /Portal do Colaborador \(Acessos\)/i,
      });
      fireEvent.click(portalTabBtn);

      expect(
        await screen.findByText(/Cadastro de Acesso ao Portal do Colaborador/i),
      ).toBeInTheDocument();
      expect(await screen.findByText('Karen Matos')).toBeInTheDocument();
      expect(
        screen.getByText(/Aderência às Normas LGPD \(Lei 13.709\/2018 - Art. 6º e 46\)/i),
      ).toBeInTheDocument();
      expect(screen.getByLabelText(/E-mail Corporativo/i)).toBeInTheDocument();
      expect(screen.getByText(/Geração de Senha Aleatória Segura/i)).toBeInTheDocument();
    });

    it('permite gerar nova senha aleatória com botão de regeneração', async () => {
      renderPage();

      const portalTabBtn = await screen.findByRole('button', {
        name: /Portal do Colaborador \(Acessos\)/i,
      });
      fireEvent.click(portalTabBtn);

      expect(await screen.findByText('Karen Matos')).toBeInTheDocument();

      const regenerateBtn = await screen.findByRole('button', { name: /Gerar Outra Senha/i });
      fireEvent.click(regenerateBtn);

      // Botão copiar senha copia para o clipboard
      const copyBtn = screen.getByRole('button', { name: /Copiar Senha/i });
      fireEvent.click(copyBtn);
      await waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalled();
        expect(screen.getByRole('status')).toHaveTextContent(/Senha copiada/i);
      });
    });

    it('cadastra colaborador no Gateway via microservicesApi.createUser e abre modal de credenciais', async () => {
      renderPage();

      const portalTabBtn = await screen.findByRole('button', {
        name: /Portal do Colaborador \(Acessos\)/i,
      });
      fireEvent.click(portalTabBtn);

      expect(await screen.findByText('Karen Matos')).toBeInTheDocument();

      const nameInput = await screen.findByPlaceholderText(/Ex: Roberto Souza/i);
      const emailInput = screen.getByLabelText(/E-mail Corporativo/i);
      const deptInput = screen.getByPlaceholderText(/Ex: Operações \/ Vendas/i);
      const jobInput = screen.getByPlaceholderText(/Ex: Consultor Comercial/i);

      fireEvent.change(nameInput, { target: { value: 'Lucas Ferreira' } });
      fireEvent.change(emailInput, { target: { value: 'lucas.ferreira@empresa-exemplo.com.br' } });
      fireEvent.change(deptInput, { target: { value: 'Vendas Concessionária' } });
      fireEvent.change(jobInput, { target: { value: 'Consultor de Vendas' } });

      const submitBtn = screen.getByRole('button', {
        name: /Cadastrar e Liberar Acesso ao Portal/i,
      });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(microservicesApi.createUser).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'Lucas Ferreira',
            email: 'lucas.ferreira@empresa-exemplo.com.br',
            role: 'collaborator',
            department: 'Vendas Concessionária',
            jobTitle: 'Consultor de Vendas',
            active: true,
          }),
        );
      });

      // Modal de credenciais geradas é exibido com botão para copiar credenciais completas
      expect(await screen.findByText(/Acesso Criado com Sucesso!/i)).toBeInTheDocument();
      expect(screen.getByText('Lucas Ferreira')).toBeInTheDocument();
      expect(screen.getByText('lucas.ferreira@empresa-exemplo.com.br')).toBeInTheDocument();

      const copyCredsBtn = screen.getByRole('button', { name: /Copiar Credenciais Completas/i });
      fireEvent.click(copyCredsBtn);
      await waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalled();
        expect(screen.getByRole('status')).toHaveTextContent(/Credenciais completas copiadas!/i);
      });
    });

    it('permite revogar acesso de um colaborador da lista do portal', async () => {
      vi.spyOn(microservicesApi, 'deleteUser').mockResolvedValue({ success: true });

      renderPage();

      const portalTab = await screen.findByRole('button', {
        name: /Portal do Colaborador \(Acessos\)/i,
      });
      fireEvent.click(portalTab);

      const revokeBtn = await screen.findByTitle(/Revogar acesso deste colaborador/i);
      expect(revokeBtn).toBeInTheDocument();
      fireEvent.click(revokeBtn);

      await waitFor(() => {
        expect(microservicesApi.deleteUser).toHaveBeenCalledWith('u-colab-1');
        expect(screen.getByRole('status')).toHaveTextContent(/revogado com sucesso/i);
      });
    });
  });
});
