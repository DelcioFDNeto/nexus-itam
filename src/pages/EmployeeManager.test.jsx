// src/pages/EmployeeManager.test.jsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  beforeEach(() => {
    vi.clearAllMocks();

    useAuth.mockReturnValue({
      currentUser: {
        uid: 'user-owner-1',
        name: 'TI Shineray',
        email: 'ti@shineraybysabel.com.br',
        role: 'owner',
        tenantId: 'tenant-ap3htf6',
      },
    });

    employeeService.getEmployees.mockResolvedValue([
      {
        id: 'emp-1',
        name: 'João da Silva',
        email: 'joao.silva@shineray.com.br',
        role: 'Consultor de Vendas',
        sector: 'Vendas Concessionária',
        branch: 'Matriz Belém',
      },
    ]);

    employeeService.getSectors.mockResolvedValue([
      { id: 'sec-1', name: 'TI & Infraestrutura', manager: 'Délcio Farias' },
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
          email: 'karen.matos@shineraybysabel.com.br',
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
        email: 'lucas.ferreira@shineraybysabel.com.br',
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
    it('renderiza as 3 abas principais: Colaboradores, Setores e Portal do Colaborador (Acessos)', async () => {
      render(<EmployeeManager />);

      expect(await screen.findByText(/Gestão de Pessoas & Áreas/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Colaboradores/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Setores \/ Deptos/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Portal do Colaborador \(Acessos\)/i })).toBeInTheDocument();
    });

    it('alterna para a aba do Portal do Colaborador e exibe banner LGPD e formulário', async () => {
      render(<EmployeeManager />);

      const portalTabBtn = await screen.findByRole('button', {
        name: /Portal do Colaborador \(Acessos\)/i,
      });
      fireEvent.click(portalTabBtn);

      expect(
        await screen.findByText(/Cadastro de Acesso ao Portal do Colaborador/i),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Aderência às Normas LGPD \(Lei 13.709\/2018 - Art. 6º e 46\)/i),
      ).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/colaborador@shineraybysabel.com.br/i)).toBeInTheDocument();
      expect(screen.getByText(/Geração de Senha Aleatória Segura/i)).toBeInTheDocument();
    });

    it('permite gerar nova senha aleatória com botão de regeneração', async () => {
      render(<EmployeeManager />);

      const portalTabBtn = await screen.findByRole('button', {
        name: /Portal do Colaborador \(Acessos\)/i,
      });
      fireEvent.click(portalTabBtn);

      const regenerateBtn = await screen.findByRole('button', { name: /Gerar Outra Senha/i });
      fireEvent.click(regenerateBtn);

      // Botão copiar senha copia para o clipboard
      const copyBtn = screen.getByRole('button', { name: /Copiar Senha/i });
      fireEvent.click(copyBtn);
      expect(navigator.clipboard.writeText).toHaveBeenCalled();
    });

    it('cadastra colaborador no Gateway via microservicesApi.createUser e abre modal de credenciais', async () => {
      render(<EmployeeManager />);

      const portalTabBtn = await screen.findByRole('button', {
        name: /Portal do Colaborador \(Acessos\)/i,
      });
      fireEvent.click(portalTabBtn);

      const nameInput = await screen.findByPlaceholderText(/Ex: Roberto Souza/i);
      const emailInput = screen.getByPlaceholderText(/colaborador@shineraybysabel.com.br/i);
      const deptInput = screen.getByPlaceholderText(/Ex: Vendas Concessionária/i);
      const jobInput = screen.getByPlaceholderText(/Ex: Consultor Comercial/i);

      fireEvent.change(nameInput, { target: { value: 'Lucas Ferreira' } });
      fireEvent.change(emailInput, { target: { value: 'lucas.ferreira@shineraybysabel.com.br' } });
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
            email: 'lucas.ferreira@shineraybysabel.com.br',
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
      expect(screen.getByText('lucas.ferreira@shineraybysabel.com.br')).toBeInTheDocument();

      const copyCredsBtn = screen.getByRole('button', { name: /Copiar Credenciais Completas/i });
      fireEvent.click(copyCredsBtn);
      expect(navigator.clipboard.writeText).toHaveBeenCalled();
    });
  });
});
