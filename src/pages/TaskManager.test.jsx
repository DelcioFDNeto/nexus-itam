// src/pages/TaskManager.test.jsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import TaskManager from './TaskManager';
import * as taskService from '../services/taskService';
import * as projectService from '../services/projectService';
import * as employeeService from '../services/employeeService';
import * as authContext from '../contexts/AuthContext';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('../components/ConfirmDialog', () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
}));

describe('TaskManager Page', () => {
  const mockTasks = [
    {
      id: 'task-1',
      title: 'Configurar Switch Core L3',
      description: 'VLANs corporativas e trunking.',
      status: 'A Fazer',
      priority: 'Alta',
      category: 'Infraestrutura',
      dueDate: '2026-11-10',
      assignee: 'Ricardo Almeida',
      projectId: 'proj-1',
      checklist: [{ id: 'chk-1', text: 'Instalar no rack', done: true }],
      tenantId: 'tenant-test',
    },
    {
      id: 'task-2',
      title: 'Inventariar notebooks da filial',
      description: 'Coleta de dados patrimoniais.',
      status: 'Em Andamento',
      priority: 'Crítica',
      category: 'Inventário',
      dueDate: '2026-11-05',
      assignee: 'Mariana Costa',
      projectId: 'proj-1',
      checklist: [],
      tenantId: 'tenant-test',
    },
    {
      id: 'task-3',
      title: 'Renovação de licenças Microsoft',
      description: 'Contratos e faturas do ano.',
      status: 'Concluído',
      priority: 'Baixa',
      category: 'Geral',
      dueDate: '2026-10-20',
      assignee: '',
      projectId: '',
      checklist: [],
      tenantId: 'tenant-test',
    },
  ];

  const mockProjects = [
    { id: 'proj-1', name: 'Migração Data Center' },
  ];

  const mockEmployees = [
    { id: 'emp-1', name: 'Ricardo Almeida', email: 'ricardo@nexuscorp.com.br' },
    { id: 'emp-2', name: 'Mariana Costa', email: 'mariana@nexuscorp.com.br' },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();

    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      currentUser: {
        id: 'user-1',
        name: 'Ricardo Almeida',
        email: 'ricardo@nexuscorp.com.br',
        role: 'admin',
        tenantId: 'tenant-test',
      },
    });

    vi.spyOn(taskService, 'getTasks').mockResolvedValue(mockTasks);
    vi.spyOn(taskService, 'addTask').mockResolvedValue('task-new');
    vi.spyOn(taskService, 'updateTask').mockResolvedValue();
    vi.spyOn(taskService, 'deleteTask').mockResolvedValue();

    vi.spyOn(projectService, 'getProjects').mockResolvedValue(mockProjects);
    vi.spyOn(employeeService, 'getEmployees').mockResolvedValue(mockEmployees);
  });

  it('renderiza o header executivo, KPIs e tarefas nas colunas do Kanban', async () => {
    render(<TaskManager />);

    // Título e KPIs
    expect(await screen.findByText('Gestão de Tarefas')).toBeInTheDocument();
    expect(screen.getByText('Demandas em Aberto')).toBeInTheDocument();
    expect(screen.getByText('Em Execução / Revisão')).toBeInTheDocument();
    expect(screen.getByText('Atenção & Prazos')).toBeInTheDocument();

    // Tarefas nas colunas
    expect(screen.getByText('Configurar Switch Core L3')).toBeInTheDocument();
    expect(screen.getByText('Inventariar notebooks da filial')).toBeInTheDocument();
    expect(screen.getByText('Renovação de licenças Microsoft')).toBeInTheDocument();
  });

  it('permite alternar entre visualização Kanban e Lista Estruturada', async () => {
    render(<TaskManager />);

    await screen.findByText('Configurar Switch Core L3');

    // Clica no botão Lista
    const listBtn = screen.getByRole('button', { name: /lista/i });
    fireEvent.click(listBtn);

    // Na lista, os itens devem estar visíveis
    expect(screen.getByText('Configurar Switch Core L3')).toBeInTheDocument();
    expect(screen.getByText('Inventariar notebooks da filial')).toBeInTheDocument();

    // Volta para o Kanban
    const kanbanBtn = screen.getByRole('button', { name: /quadro/i });
    fireEvent.click(kanbanBtn);

    expect(screen.getByText('Configurar Switch Core L3')).toBeInTheDocument();
  });

  it('permite filtrar tarefas por busca textual', async () => {
    render(<TaskManager />);

    await screen.findByText('Configurar Switch Core L3');

    const searchInput = screen.getByPlaceholderText(/buscar tarefa/i);
    fireEvent.change(searchInput, { target: { value: 'Switch' } });

    expect(screen.getByText('Configurar Switch Core L3')).toBeInTheDocument();
    expect(screen.queryByText('Inventariar notebooks da filial')).not.toBeInTheDocument();
  });

  it('adiciona tarefa rápida através do input inline', async () => {
    render(<TaskManager />);

    await screen.findByText('Gestão de Tarefas');

    const input = screen.getByPlaceholderText(/adicionar tarefa rápida/i);
    fireEvent.change(input, { target: { value: 'Nova tarefa de teste' } });

    const submitBtn = screen.getByRole('button', { name: /adicionar/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(taskService.addTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Nova tarefa de teste',
          status: 'A Fazer',
          priority: 'Média',
          tenantId: 'tenant-test',
        })
      );
    });
  });

  it('abre o modal completo de criação de tarefa', async () => {
    render(<TaskManager />);

    await screen.findByText('Gestão de Tarefas');

    const newBtn = screen.getByRole('button', { name: /nova tarefa/i });
    fireEvent.click(newBtn);

    expect(screen.getByText('Nova Tarefa Operacional')).toBeInTheDocument();
    expect(screen.getByLabelText(/título da tarefa \*/i)).toBeInTheDocument();
  });

  it('abre o drawer lateral de detalhes ao clicar na tarefa', async () => {
    render(<TaskManager />);

    const card = await screen.findByText('Configurar Switch Core L3');
    fireEvent.click(card);

    expect(screen.getByText('Subtarefas / Checklist')).toBeInTheDocument();
    expect(screen.getAllByText('Migração Data Center').length).toBeGreaterThanOrEqual(1);
  });
});
