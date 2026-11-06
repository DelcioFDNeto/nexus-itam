import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ProjectDetails from './ProjectDetails';
import * as authContext from '../contexts/AuthContext';
import * as projectService from '../services/projectService';
import * as employeeService from '../services/employeeService';

describe('ProjectDetails', () => {
  const mockUser = {
    tenantId: 'tenant-ap3htf6',
    role: 'owner',
    capabilities: ['projects:write']
  };

  const mockProject = {
    id: 'proj-1',
    tenantId: 'tenant-ap3htf6',
    name: 'Migração ERP Nuvem',
    description: 'Migração integral para infraestrutura em nuvem.',
    status: 'Em Andamento',
    priority: 'Alta',
    progress: 75,
    budget: 60000,
    leader: 'João da Silva',
    version: '2.1',
    deadline: '2026-11-30',
    team: ['João da Silva', 'Délcio Farias'],
    changelog: [
      'v2.0: Homologação do banco de dados (01/11/2026)',
      'v2.1: Início dos testes de carga (05/11/2026)'
    ]
  };

  beforeEach(() => {
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      currentUser: mockUser
    });
    vi.spyOn(projectService, 'getProject').mockResolvedValue(mockProject);
    vi.spyOn(employeeService, 'getEmployees').mockResolvedValue([
      { id: 'emp-1', name: 'João da Silva' },
      { id: 'emp-2', name: 'Délcio Farias' }
    ]);
  });

  it('renders project details, hero banner and progress meter', async () => {
    render(
      <MemoryRouter initialEntries={['/projects/proj-1']}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetails />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Migração ERP Nuvem')).toBeInTheDocument();
    });

    expect(screen.getAllByText(/2\.1/)[0]).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('Prioridade: Alta')).toBeInTheDocument();
    expect(screen.getByText(/Migração integral para infraestrutura/)).toBeInTheDocument();
    expect(screen.getByText('Diário de Bordo & Histórico')).toBeInTheDocument();
    expect(screen.getByText('01/11/2026')).toBeInTheDocument();
    expect(screen.getByText('Homologação do banco de dados')).toBeInTheDocument();
  });

  it('correctly parses Brazilian currency strings when saving project edits', async () => {
    const updateSpy = vi.spyOn(projectService, 'updateProject').mockResolvedValue(true);

    render(
      <MemoryRouter initialEntries={['/projects/proj-1']}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetails />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Migração ERP Nuvem')).toBeInTheDocument();
    });

    const editBtn = screen.getByText('Editar Projeto');
    fireEvent.click(editBtn);

    const budgetInput = screen.getByDisplayValue(60000);
    fireEvent.change(budgetInput, { target: { value: 'R$ 85.000,00' } });

    const saveBtn = screen.getByText('Salvar Alterações');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith(
        'proj-1',
        expect.objectContaining({
          budget: 85000
        })
      );
    });
  });

  it('allows opening the log addition form and saving a log', async () => {
    const addLogSpy = vi.spyOn(projectService, 'addProjectLog').mockResolvedValue(true);

    render(
      <MemoryRouter initialEntries={['/projects/proj-1']}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetails />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Migração ERP Nuvem')).toBeInTheDocument();
    });

    const addLogBtn = screen.getByText('Nova Atualização');
    fireEvent.click(addLogBtn);

    const textarea = screen.getByPlaceholderText(/Descreva o que foi concluído/i);
    fireEvent.change(textarea, { target: { value: 'Sprint 4 concluída com sucesso.' } });

    const saveBtn = screen.getByText('Salvar Registro');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(addLogSpy).toHaveBeenCalled();
    });
  });
});
