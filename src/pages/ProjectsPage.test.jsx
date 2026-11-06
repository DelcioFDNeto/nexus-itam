import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import ProjectsPage from './ProjectsPage';
import * as authContext from '../contexts/AuthContext';
import * as projectService from '../services/projectService';
import * as employeeService from '../services/employeeService';

describe('ProjectsPage', () => {
  const mockUser = {
    tenantId: 'tenant-ap3htf6',
    role: 'owner',
    capabilities: ['projects:write']
  };

  const mockProjects = [
    {
      id: 'proj-1',
      name: 'Migração ERP Nuvem',
      description: 'Migração para o Microwork Cloud',
      status: 'Em Andamento',
      priority: 'Alta',
      progress: 65,
      budget: 50000,
      leader: 'João da Silva',
      version: '2.0',
      deadline: '2026-12-31',
      team: ['João da Silva', 'Délcio Farias']
    },
    {
      id: 'proj-2',
      name: 'Auditoria de Licenças 2026',
      description: 'Inventário completo e conformidade',
      status: 'Concluído',
      priority: 'Crítica',
      progress: 100,
      budget: 15000,
      leader: 'Délcio Farias',
      version: '1.0',
      deadline: '2026-05-01',
      team: ['Délcio Farias']
    },
    {
      id: 'proj-3',
      name: 'Implantação MDM Mobile',
      description: 'Gestão de frotas Android',
      status: 'Planejamento',
      priority: 'Média',
      progress: 10,
      budget: 25000,
      leader: 'Admin Shineray',
      version: '0.9',
      deadline: '2026-08-15',
      team: ['Admin Shineray']
    }
  ];

  const mockEmployees = [
    { id: 'emp-1', name: 'João da Silva', role: 'Analista' },
    { id: 'emp-2', name: 'Délcio Farias', role: 'Gestor' },
    { id: 'emp-3', name: 'Admin Shineray', role: 'Diretor' }
  ];

  beforeEach(() => {
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      currentUser: mockUser
    });
    vi.spyOn(projectService, 'getProjects').mockResolvedValue(mockProjects);
    vi.spyOn(employeeService, 'getEmployees').mockResolvedValue(mockEmployees);
  });

  it('renders executive KPIs and project cards', async () => {
    render(
      <BrowserRouter>
        <ProjectsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Migração ERP Nuvem')).toBeInTheDocument();
    });

    expect(screen.getByText('Total Iniciativas')).toBeInTheDocument();
    expect(screen.getByText('Central de Projetos')).toBeInTheDocument();
    expect(screen.getByText('Auditoria de Licenças 2026')).toBeInTheDocument();
    expect(screen.getByText('Implantação MDM Mobile')).toBeInTheDocument();
  });

  it('filters projects by real-time search term', async () => {
    render(
      <BrowserRouter>
        <ProjectsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Migração ERP Nuvem')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Buscar por nome do projeto/i);
    fireEvent.change(searchInput, { target: { value: 'MDM' } });

    expect(screen.getByText('Implantação MDM Mobile')).toBeInTheDocument();
    expect(screen.queryByText('Migração ERP Nuvem')).not.toBeInTheDocument();
    expect(screen.queryByText('Auditoria de Licenças 2026')).not.toBeInTheDocument();
  });

  it('allows switching to Kanban and Table views', async () => {
    render(
      <BrowserRouter>
        <ProjectsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Migração ERP Nuvem')).toBeInTheDocument();
    });

    // Clica no botão Kanban
    const kanbanBtn = screen.getByTitle('Visualização em Kanban');
    fireEvent.click(kanbanBtn);

    expect(screen.getByText('Planejamento & Backlog')).toBeInTheDocument();
    expect(screen.getByText('Em Execução & Revisão')).toBeInTheDocument();
    expect(screen.getByText('Entregues & Concluídos')).toBeInTheDocument();

    // Clica no botão Tabela
    const tableBtn = screen.getByTitle('Visualização em Tabela');
    fireEvent.click(tableBtn);

    expect(screen.getByText('Iniciativa & Versão')).toBeInTheDocument();
    expect(screen.getByText('Orçamento')).toBeInTheDocument();
  });

  it('correctly parses formatted budget when creating a new project', async () => {
    const createSpy = vi.spyOn(projectService, 'createProject').mockResolvedValue('new-id');

    render(
      <BrowserRouter>
        <ProjectsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Migração ERP Nuvem')).toBeInTheDocument();
    });

    const newBtn = screen.getByText('Novo Projeto');
    fireEvent.click(newBtn);

    fireEvent.change(screen.getByPlaceholderText('Ex: Modernização do Parque de Notebooks Filial Belém'), {
      target: { value: 'Renovação Data Center' }
    });
    fireEvent.change(screen.getByPlaceholderText('Ex: 50.000,00 ou 50000'), {
      target: { value: 'R$ 120.000,00' }
    });

    const submitBtn = screen.getByText('Salvar e Iniciar');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Renovação Data Center',
          budget: 120000
        })
      );
    });
  });
});
