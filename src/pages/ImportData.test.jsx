// src/pages/ImportData.test.jsx
import React, { act } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ImportData from './ImportData';
import { 
  normalizeStatus, 
  normalizePriority, 
  normalizeCategory, 
  isSystemFormat, 
  transformSystemRow,
  IMPORT_SCHEMAS
} from '../utils/importSchemas';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    currentUser: {
      uid: 'user-admin-1',
      tenantId: 'tenant-test-itam',
      name: 'Gestor TI',
      email: 'gestor@shineray.com.br',
      role: 'admin',
    },
  })),
}));

vi.mock('../components/ConfirmDialog', () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
}));

vi.mock('../services/firebase', () => ({
  db: {},
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  writeBatch: vi.fn(() => ({
    set: vi.fn(),
    commit: vi.fn().mockResolvedValue(true),
  })),
  doc: vi.fn(() => ({ id: 'mock-doc-id' })),
  serverTimestamp: vi.fn(() => ({ _methodName: 'serverTimestamp' })),
}));

vi.mock('../services/tenantService', () => ({
  assertWithinLimit: vi.fn().mockResolvedValue(true),
}));

describe('ImportData - V3 Ingestion Engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Normalizers', () => {
    it('normalizes project and task statuses correctly', () => {
      expect(normalizeStatus('Em Andamento')).toBe('Em Andamento');
      expect(normalizeStatus('in progress')).toBe('Em Andamento');
      expect(normalizeStatus('development')).toBe('Em Andamento');
      expect(normalizeStatus('concluido')).toBe('Concluído');
      expect(normalizeStatus('done')).toBe('Concluído');
      expect(normalizeStatus('completed')).toBe('Concluído');
      expect(normalizeStatus('todo')).toBe('A Fazer');
      expect(normalizeStatus('review')).toBe('Revisão');
      expect(normalizeStatus('pausado')).toBe('Pausado');
      expect(normalizeStatus(null)).toBe('Planejamento');
      expect(normalizeStatus(null, 'A Fazer')).toBe('A Fazer');
      expect(normalizeStatus('qualquer_coisa')).toBe('Planejamento');
    });

    it('normalizes priority levels correctly', () => {
      expect(normalizePriority('Crítica')).toBe('Crítica');
      expect(normalizePriority('critical')).toBe('Crítica');
      expect(normalizePriority('Alta')).toBe('Alta');
      expect(normalizePriority('high')).toBe('Alta');
      expect(normalizePriority('Baixa')).toBe('Baixa');
      expect(normalizePriority('low')).toBe('Baixa');
      expect(normalizePriority('normal')).toBe('Média');
      expect(normalizePriority(undefined)).toBe('Média');
    });

    it('normalizes task categories correctly', () => {
      expect(normalizeCategory('manutencao')).toBe('Manutenção');
      expect(normalizeCategory('inventario')).toBe('Inventário');
      expect(normalizeCategory('audit')).toBe('Auditoria');
      expect(normalizeCategory('infra')).toBe('Infraestrutura');
      expect(normalizeCategory('')).toBe('Geral');
    });
  });

  describe('System Format Detection & Transformations', () => {
    it('detects native JSON system structures vs commercial spreadsheet structures', () => {
      expect(isSystemFormat({ internalId: 'NTB-01', model: 'Dell' }, 'assets')).toBe(true);
      expect(isSystemFormat({ Patrimonio: 'NTB-01', Modelo: 'Dell' }, 'assets')).toBe(false);

      expect(isSystemFormat({ name: 'Carlos', role: 'Dev' }, 'employees')).toBe(true);
      expect(isSystemFormat({ Nome: 'Carlos', Cargo: 'Dev' }, 'employees')).toBe(false);

      expect(isSystemFormat({ name: 'Projeto X', status: 'Em Andamento' }, 'projects')).toBe(true);
      expect(isSystemFormat({ title: 'Task Y' }, 'tasks')).toBe(true);
    });

    it('transforms system row with tenantId and fallback values', () => {
      const assetRow = transformSystemRow({ internalId: 'NTB-100', model: 'Lenovo' }, 'assets', 'tenant-test');
      expect(assetRow.tenantId).toBe('tenant-test');
      expect(assetRow.internalId).toBe('NTB-100');
      expect(assetRow.type).toBe('Outros');
      expect(assetRow.status).toBe('Disponível');

      const empRow = transformSystemRow({ name: 'Maria', email: 'MARIA@TESTE.COM' }, 'employees', 'tenant-test');
      expect(empRow.tenantId).toBe('tenant-test');
      expect(empRow.name).toBe('Maria');
      expect(empRow.email).toBe('maria@teste.com');
      expect(empRow.role).toBe('Analista');
      expect(empRow.status).toBe('Ativo');
    });

    it('transforms system tasks with fallback status "A Fazer"', () => {
      const taskRow = transformSystemRow({ title: 'Configurar Switch' }, 'tasks', 'tenant-test');
      expect(taskRow.tenantId).toBe('tenant-test');
      expect(taskRow.title).toBe('Configurar Switch');
      expect(taskRow.status).toBe('A Fazer');
    });
  });

  describe('Row-Level Schema Validation Rules', () => {
    it('validates assets rows: requires Patrimonio and Modelo', () => {
      const { validateRow } = IMPORT_SCHEMAS.assets;

      const validRow = { Patrimonio: 'NTB-001', Modelo: 'Dell Latitude', Tipo: 'Notebook', Status: 'Disponível', Serial: '123' };
      const resValid = validateRow(validRow);
      expect(resValid.errors).toHaveLength(0);
      expect(resValid.warnings).toHaveLength(1); // Local missing

      const invalidRow = { Modelo: 'Sem Patrimonio' };
      const resInvalid = validateRow(invalidRow);
      expect(resInvalid.errors).toContain('Patrimônio/Tag obrigatório ausente.');

      const nullRow = validateRow(null);
      expect(nullRow.errors.length).toBeGreaterThan(0);
    });

    it('validates employees rows: validates required fields and email syntax', () => {
      const { validateRow } = IMPORT_SCHEMAS.employees;

      const validEmp = { Nome: 'João Silva', Email: 'joao.silva@empresa.com.br', Cargo: 'Engenheiro' };
      const resValid = validateRow(validEmp);
      expect(resValid.errors).toHaveLength(0);

      const badEmailEmp = { Nome: 'João', Email: 'email-invalido-sem-arroba', Cargo: 'Engenheiro' };
      const resBad = validateRow(badEmailEmp);
      expect(resBad.errors.some(e => e.includes('Formato de e-mail inválido'))).toBe(true);

      const noNameEmp = { Email: 'joao@empresa.com', Cargo: 'Analista' };
      const resNoName = validateRow(noNameEmp);
      expect(resNoName.errors).toContain('Nome do colaborador obrigatório ausente.');
    });

    it('validates projects rows: requires Nome', () => {
      const { validateRow } = IMPORT_SCHEMAS.projects;

      const validProj = { Nome: 'Projeto Titan', Status: 'Em Andamento' };
      const resValid = validateRow(validProj);
      expect(resValid.errors).toHaveLength(0);

      const emptyProj = { Status: 'Planejamento' };
      const resEmpty = validateRow(emptyProj);
      expect(resEmpty.errors).toContain('Nome do projeto obrigatório ausente.');
    });

    it('validates tasks rows: requires Titulo', () => {
      const { validateRow } = IMPORT_SCHEMAS.tasks;

      const validTask = { Titulo: 'Configurar Roteador', Status: 'A Fazer' };
      const resValid = validateRow(validTask);
      expect(resValid.errors).toHaveLength(0);

      const invalidTask = { Descricao: 'Sem título' };
      const resInvalid = validateRow(invalidTask);
      expect(resInvalid.errors).toContain('Título da tarefa obrigatório ausente.');
    });
  });

  describe('Data Transformations for Database Ingestion', () => {
    it('transforms commercial assets rows correctly', () => {
      const transformed = IMPORT_SCHEMAS.assets.transform({
        Patrimonio: 'NTB-999',
        Modelo: 'MacBook Pro M2',
        Tipo: 'Notebook',
        Status: 'Em Uso',
        Local: 'Filial Sul',
        Serial: 'C02G12345',
        Usuario: 'diretor@shineray.com.br'
      });

      expect(transformed.internalId).toBe('NTB-999');
      expect(transformed.model).toBe('MacBook Pro M2');
      expect(transformed.serialNumber).toBe('C02G12345');
      expect(transformed.assignedTo).toBe('diretor@shineray.com.br');
    });

    it('transforms commercial employees rows preserving custom status', () => {
      const transformed = IMPORT_SCHEMAS.employees.transform({
        Nome: 'Roberto Justus',
        Email: 'ROBERTO@EMPRESA.COM.BR',
        Cargo: 'Diretor',
        Setor: 'Administrativo',
        Filial: 'Sede',
        Status: 'Inativo'
      });

      expect(transformed.name).toBe('Roberto Justus');
      expect(transformed.email).toBe('roberto@empresa.com.br');
      expect(transformed.role).toBe('Diretor');
      expect(transformed.sector).toBe('Administrativo');
      expect(transformed.branch).toBe('Sede');
      expect(transformed.status).toBe('Inativo');
    });

    it('safely parses valid and invalid date strings in projects transform', () => {
      const withValidDate = IMPORT_SCHEMAS.projects.transform({
        Nome: 'Projeto A',
        DataInicio: '2026-05-20'
      });
      expect(withValidDate.createdAt).toBeInstanceOf(Date);

      const withInvalidDate = IMPORT_SCHEMAS.projects.transform({
        Nome: 'Projeto B',
        DataInicio: 'invalid-date-string'
      });
      expect(withInvalidDate.createdAt).toBeDefined();
      expect(withInvalidDate.createdAt).not.toBeInstanceOf(Date); // serverTimestamp fallback
    });
  });

  describe('UI Component Rendering & Interaction', () => {
    it('renders the V3 Ingestion Engine layout with module selectors and dropzone', async () => {
      await act(async () => {
        render(
          <MemoryRouter>
            <ImportData />
          </MemoryRouter>
        );
      });

      expect(screen.getByText(/Ingestão & Importação de Dados/i)).toBeInTheDocument();
      expect(screen.getByText(/V3 Engine/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Ativos \(Hardware\)/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/Arraste ou Selecione seu Arquivo/i)).toBeInTheDocument();
    });

    it('switches between system modules and updates required column badges', async () => {
      await act(async () => {
        render(
          <MemoryRouter>
            <ImportData />
          </MemoryRouter>
        );
      });

      // Switch to Colaboradores
      const empModuleBtn = screen.getByRole('button', { name: /Colaboradores/i });
      await act(async () => {
        fireEvent.click(empModuleBtn);
      });

      expect(screen.getByText(/Módulo de Ingestão: Colaboradores/i)).toBeInTheDocument();
      expect(screen.getByText(/Nome/i)).toBeInTheDocument();
      expect(screen.getByText(/Cargo/i)).toBeInTheDocument();

      // Switch to Tarefas
      const taskModuleBtn = screen.getByRole('button', { name: /Tarefas/i });
      await act(async () => {
        fireEvent.click(taskModuleBtn);
      });

      expect(screen.getByText(/Módulo de Ingestão: Tarefas/i)).toBeInTheDocument();
      expect(screen.getByText(/Titulo/i)).toBeInTheDocument();
    });

    it('allows toggling feedback sound', async () => {
      await act(async () => {
        render(
          <MemoryRouter>
            <ImportData />
          </MemoryRouter>
        );
      });

      const soundBtn = screen.getByTitle(/Som ativado/i);
      expect(soundBtn).toBeInTheDocument();
      
      await act(async () => {
        fireEvent.click(soundBtn);
      });

      expect(screen.getByTitle(/Som desativado/i)).toBeInTheDocument();
    });
  });
});
