// src/pages/TaskManager.jsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { getTasks, addTask, updateTask, deleteTask } from '../services/taskService';
import { getProjects } from '../services/projectService';
import { getEmployees } from '../services/employeeService';
import { useAuth } from '../contexts/AuthContext';
import { can } from '../utils/permissions';
import { useConfirm } from '../components/ConfirmDialog';
import { formatDateBR, today } from '../utils/dates';
import {
  TASK_COLUMNS,
  TASK_STATUSES,
  TASK_PRIORITIES,
  TASK_CATEGORIES,
  DONE_STATUS,
  isDone,
  columnOf,
  offFlowStatus,
  dueState,
  dueLabel,
  checklistOf,
  checklistProgress,
  createChecklistItem,
  initialsOf,
  EMPTY_FILTERS,
  hasActiveFilters,
  filterTasks,
  sortTasks,
  summarizeTasks,
  statusPatch,
  sanitizeTaskDraft,
} from '../utils/tasks';
import {
  CheckSquare,
  Square,
  Plus,
  Trash2,
  Calendar,
  Edit3,
  X,
  Save,
  Kanban,
  List,
  RefreshCcw,
  ArrowLeft,
  ArrowRight,
  Check,
  Search,
  Filter,
  AlertTriangle,
  Clock,
  User,
  FolderGit2,
  Tag,
  CheckCircle2,
  SlidersHorizontal,
  Flame,
  CheckCheck,
  CircleDot,
  GripVertical,
  Layers,
} from 'lucide-react';
import { toast } from 'sonner';

const PRIORITY_THEMES = {
  Crítica: {
    badge: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20',
    dot: 'bg-rose-500',
    cardBorder: 'border-l-4 border-l-rose-500',
  },
  Alta: {
    badge: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
    dot: 'bg-amber-500',
    cardBorder: 'border-l-4 border-l-amber-500',
  },
  Média: {
    badge: 'bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20',
    dot: 'bg-sky-500',
    cardBorder: 'border-l-4 border-l-sky-500',
  },
  Baixa: {
    badge: 'bg-slate-500/10 text-slate-700 dark:text-slate-400 border-slate-500/20',
    dot: 'bg-slate-400',
    cardBorder: 'border-l-4 border-l-slate-400',
  },
};

const COLUMN_COLORS = {
  slate: {
    header: 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-700',
    dropHighlight: 'border-slate-400 bg-slate-50/70 dark:bg-slate-900/60',
    chip: 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300',
  },
  blue: {
    header: 'bg-blue-50/80 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200 border-blue-200/70 dark:border-blue-900/40',
    dropHighlight: 'border-blue-400 bg-blue-50/50 dark:bg-blue-950/30',
    chip: 'bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300',
  },
  violet: {
    header: 'bg-purple-50/80 dark:bg-purple-950/40 text-purple-900 dark:text-purple-200 border-purple-200/70 dark:border-purple-900/40',
    dropHighlight: 'border-purple-400 bg-purple-50/50 dark:bg-purple-950/30',
    chip: 'bg-purple-100 dark:bg-purple-900/60 text-purple-700 dark:text-purple-300',
  },
  emerald: {
    header: 'bg-emerald-50/80 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 border-emerald-200/70 dark:border-emerald-900/40',
    dropHighlight: 'border-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/30',
    chip: 'bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300',
  },
};

const INITIAL_TASK_FORM = {
  title: '',
  description: '',
  status: 'A Fazer',
  priority: 'Média',
  category: 'Geral',
  dueDate: '',
  assignee: '',
  projectId: '',
  checklist: [],
};

const TaskManager = () => {
  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingQuick, setSavingQuick] = useState(false);
  const [savingModal, setSavingModal] = useState(false);

  const { currentUser } = useAuth();
  const confirm = useConfirm();
  const tenantId = currentUser?.tenantId;
  const canWrite = can(currentUser, 'tasks:write');

  // Visualização e Filtros
  const [viewMode, setViewMode] = useState('kanban'); // 'kanban' | 'list'
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [quickFilter, setQuickFilter] = useState('all'); // 'all' | 'mine' | 'overdue' | 'critical' | 'done'
  const [sortBy, setSortBy] = useState('smart'); // 'smart' | 'due' | 'recent'
  const [showFiltersPanel, setShowFiltersPanel] = useState(false);

  // Quick Add
  const [quickTitle, setQuickTitle] = useState('');
  const [quickPriority, setQuickPriority] = useState('Média');

  // Drag & Drop
  const [draggedTaskId, setDraggedTaskId] = useState(null);
  const [dragOverColId, setDragOverColId] = useState(null);

  // Modal / Drawer de Edição e Criação
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('create'); // 'create' | 'edit'
  const [taskForm, setTaskForm] = useState(INITIAL_TASK_FORM);
  const [newChecklistText, setNewChecklistText] = useState('');

  // Drawer de Detalhes Rápido
  const [drawerTask, setDrawerTask] = useState(null);

  // Mapeamento id -> nome do projeto
  const projectMap = useMemo(() => {
    const map = new Map();
    projects.forEach((p) => map.set(p.id, p.name || 'Projeto sem nome'));
    return map;
  }, [projects]);

  // Carrega Tarefas
  const loadTasks = useCallback(async () => {
    if (!tenantId) {
      setTasks([]);
      setLoading(false);
      return;
    }
    try {
      const data = await getTasks(tenantId);
      setTasks(data);
    } catch (err) {
      console.error(err);
      toast.error('Erro ao carregar tarefas.');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  // Carrega Recursos Auxiliares (Projetos e Colaboradores)
  const loadAuxData = useCallback(async () => {
    if (!tenantId) return;
    try {
      const [projData, empData] = await Promise.all([
        getProjects(tenantId).catch(() => []),
        getEmployees(tenantId).catch(() => []),
      ]);
      setProjects(projData || []);
      setEmployees(empData || []);
    } catch {
      // Silencioso em caso de falha opcional
    }
  }, [tenantId]);

  useEffect(() => {
    if (tenantId) {
      loadTasks();
      loadAuxData();
    } else {
      setTasks([]);
      setLoading(false);
    }
  }, [tenantId, loadTasks, loadAuxData]);

  // Aplicação dos Filtros e Ordenação
  const processedTasks = useMemo(() => {
    let list = [...tasks];

    // Quick filter presetting
    if (quickFilter === 'mine') {
      const myName = currentUser?.name?.toLowerCase() || '';
      const myEmail = currentUser?.email?.toLowerCase() || '';
      list = list.filter((t) => {
        const a = (t.assignee || '').toLowerCase();
        return (myName && a.includes(myName)) || (myEmail && a === myEmail);
      });
    } else if (quickFilter === 'overdue') {
      list = list.filter((t) => dueState(t) === 'overdue');
    } else if (quickFilter === 'critical') {
      list = list.filter((t) => t.priority === 'Crítica' || t.priority === 'Alta');
    } else if (quickFilter === 'done') {
      list = list.filter((t) => isDone(t));
    }

    // Filtros avançados
    const filtered = filterTasks(list, filters);

    // Ordenação
    return sortTasks(filtered, sortBy);
  }, [tasks, filters, quickFilter, sortBy, currentUser]);

  // Resumo de KPIs do Topo
  const summary = useMemo(() => summarizeTasks(tasks), [tasks]);

  // Handler: Adição Rápida
  const handleQuickAdd = async (e) => {
    e.preventDefault();
    const title = quickTitle.trim();
    if (!title) return;
    if (!tenantId) {
      toast.error('Sem contexto de organização ativo.');
      return;
    }

    setSavingQuick(true);
    try {
      await addTask({
        title,
        status: 'A Fazer',
        priority: quickPriority,
        category: 'Geral',
        dueDate: '',
        assignee: '',
        projectId: '',
        checklist: [],
        tenantId,
      });
      setQuickTitle('');
      toast.success('Tarefa adicionada à fila.');
      await loadTasks();
    } catch (err) {
      console.error(err);
      toast.error('Erro ao adicionar tarefa.');
    } finally {
      setSavingQuick(false);
    }
  };

  // Handler: Mudar Status (Kanban Dnd ou Botões)
  const handleMoveTask = async (taskId, newStatus) => {
    if (!canWrite) return;
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === newStatus) return;

    const patch = statusPatch(newStatus);
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...patch } : t)));

    if (drawerTask?.id === taskId) {
      setDrawerTask((prev) => ({ ...prev, ...patch }));
    }

    try {
      await updateTask(taskId, patch);
      toast.success(`Tarefa movida para "${newStatus}".`);
    } catch (err) {
      console.error(err);
      toast.error('Erro ao atualizar status da tarefa.');
      await loadTasks();
    }
  };

  // Handler: Alternar Conclusão Rápida
  const handleToggleDone = async (task) => {
    if (!canWrite) return;
    const nextStatus = isDone(task) ? 'A Fazer' : DONE_STATUS;
    await handleMoveTask(task.id, nextStatus);
  };

  // Handler: Toggle de Item de Checklist (direto no card ou drawer)
  const handleToggleChecklistItem = async (task, itemId) => {
    if (!canWrite) return;
    const currentList = checklistOf(task);
    const updatedList = currentList.map((item) =>
      item.id === itemId ? { ...item, done: !item.done } : item,
    );

    // Se todos foram concluídos e a tarefa ainda não está concluída, sugere mover
    const allDone = updatedList.length > 0 && updatedList.every((i) => i.done);

    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, checklist: updatedList } : t)),
    );
    if (drawerTask?.id === task.id) {
      setDrawerTask((prev) => ({ ...prev, checklist: updatedList }));
    }

    try {
      await updateTask(task.id, { checklist: updatedList });
      if (allDone && !isDone(task)) {
        toast.info('Todos os itens foram concluídos!');
      }
    } catch (err) {
      console.error(err);
      toast.error('Erro ao salvar checklist.');
      await loadTasks();
    }
  };

  // Handler: Excluir Tarefa
  const handleDeleteTask = async (taskId) => {
    if (!canWrite) return;
    const confirmed = await confirm({
      title: 'Excluir Tarefa',
      message: 'Tem certeza que deseja excluir esta tarefa permanentemente?',
      danger: true,
      confirmLabel: 'Excluir Tarefa',
    });
    if (!confirmed) return;

    try {
      await deleteTask(taskId);
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      if (drawerTask?.id === taskId) setDrawerTask(null);
      toast.success('Tarefa excluída.');
    } catch (err) {
      console.error(err);
      toast.error('Erro ao excluir tarefa.');
    }
  };

  // Abrir Modal para Criar
  const handleOpenCreateModal = () => {
    setModalMode('create');
    setTaskForm({
      ...INITIAL_TASK_FORM,
      dueDate: today(),
    });
    setNewChecklistText('');
    setIsModalOpen(true);
  };

  // Abrir Modal para Editar
  const handleOpenEditModal = (task) => {
    setModalMode('edit');
    setTaskForm({
      id: task.id,
      title: task.title || '',
      description: task.description || '',
      status: task.status || 'A Fazer',
      priority: task.priority || 'Média',
      category: task.category || 'Geral',
      dueDate: task.dueDate || '',
      assignee: task.assignee || '',
      projectId: task.projectId || '',
      checklist: checklistOf(task),
    });
    setNewChecklistText('');
    setIsModalOpen(true);
  };

  // Salvar Modal (Criar ou Atualizar)
  const handleSaveModal = async (e) => {
    e.preventDefault();
    if (!taskForm.title.trim()) {
      toast.error('O título da tarefa é obrigatório.');
      return;
    }

    setSavingModal(true);
    try {
      const sanitized = sanitizeTaskDraft(taskForm);

      if (modalMode === 'create') {
        await addTask({
          ...sanitized,
          tenantId,
        });
        toast.success('Nova tarefa criada com sucesso.');
      } else {
        const patch = {
          ...sanitized,
          ...(isDone(sanitized) ? { completedAt: new Date().toISOString() } : {}),
        };
        await updateTask(taskForm.id, patch);
        toast.success('Tarefa atualizada.');
      }

      setIsModalOpen(false);
      await loadTasks();
    } catch (err) {
      console.error(err);
      toast.error('Erro ao salvar tarefa.');
    } finally {
      setSavingModal(false);
    }
  };

  // Adicionar item no checklist do Modal
  const handleAddChecklistItemModal = () => {
    const text = newChecklistText.trim();
    if (!text) return;
    const newItem = createChecklistItem(text);
    setTaskForm((prev) => ({
      ...prev,
      checklist: [...prev.checklist, newItem],
    }));
    setNewChecklistText('');
  };

  // Remover item no checklist do Modal
  const handleRemoveChecklistItemModal = (itemId) => {
    setTaskForm((prev) => ({
      ...prev,
      checklist: prev.checklist.filter((i) => i.id !== itemId),
    }));
  };

  // Toggle item no checklist do Modal
  const handleToggleChecklistItemModal = (itemId) => {
    setTaskForm((prev) => ({
      ...prev,
      checklist: prev.checklist.map((i) =>
        i.id === itemId ? { ...i, done: !i.done } : i,
      ),
    }));
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1700px] mx-auto pb-24 min-h-screen space-y-6">
      {/* Header Executivo & Ações Principais */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-slate-200/80 dark:border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-brand">
            <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Fluxo Operacional • Gestão de Tarefas & Demandas</span>
          </div>
          <h1 className="mt-1 text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white flex items-center gap-2.5">
            <CheckSquare className="text-brand" size={28} />
            <span>Gestão de Tarefas</span>
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-2xl">
            Planejamento diário de infraestrutura, atendimento a chamados técnicos e acompanhamento de entregas de TI.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Alternador de Visualização (Kanban vs Lista) */}
          <div className="inline-flex items-center p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 shadow-2xs">
            <button
              type="button"
              onClick={() => setViewMode('kanban')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                viewMode === 'kanban'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Kanban size={14} />
              <span>Quadro</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                viewMode === 'list'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <List size={14} />
              <span>Lista</span>
            </button>
          </div>

          <button
            type="button"
            onClick={loadTasks}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-2xs"
            title="Recarregar tarefas"
          >
            <RefreshCcw size={13} className={loading ? 'animate-spin text-brand' : ''} />
            <span className="hidden sm:inline">Atualizar</span>
          </button>

          {canWrite && (
            <button
              type="button"
              onClick={handleOpenCreateModal}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-brand to-indigo-600 hover:from-brand-dark hover:to-indigo-700 px-4 py-2 text-xs font-bold text-white shadow-sm transition-all"
            >
              <Plus size={15} />
              <span>Nova Tarefa</span>
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards Ribbon */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Ativas */}
        <div className="surface-card p-4 border-l-4 border-l-slate-500 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Demandas em Aberto</span>
            <Layers size={15} className="text-slate-400" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-black text-slate-900 dark:text-white">
              {summary.open}
            </span>
            <span className="text-xs text-slate-400 font-mono">
              {tasks.length} total
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            Fila de atividades pendentes
          </p>
        </div>

        {/* Em Andamento */}
        <div className="surface-card p-4 border-l-4 border-l-brand flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Em Execução / Revisão</span>
            <CircleDot size={15} className="text-brand" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-black text-slate-900 dark:text-white">
              {summary.inProgress}
            </span>
            <span className="text-xs font-semibold text-brand">
              {summary.open > 0 ? Math.round((summary.inProgress / summary.open) * 100) : 0}% da fila
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            Tarefas sendo trabalhadas agora
          </p>
        </div>

        {/* Alertas & Atrasadas */}
        <div
          className={`surface-card p-4 flex flex-col justify-between border-l-4 ${
            summary.overdue > 0 ? 'border-l-rose-500' : 'border-l-amber-500'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Atenção & Prazos</span>
            <AlertTriangle
              size={15}
              className={summary.overdue > 0 ? 'text-rose-500 animate-pulse' : 'text-amber-500'}
            />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-slate-900 dark:text-white">
                {summary.overdue}
              </span>
              <span className="text-xs font-semibold text-rose-600 dark:text-rose-400">
                Atrasadas
              </span>
            </div>
            {summary.dueToday > 0 && (
              <span className="text-xs font-bold text-amber-600 dark:text-amber-400">
                {summary.dueToday} para hoje
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            Prazos com necessidade de ação imediata
          </p>
        </div>

        {/* Concluídas */}
        <div className="surface-card p-4 border-l-4 border-l-emerald-500 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Concluídas</span>
            <CheckCheck size={15} className="text-emerald-500" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-black text-slate-900 dark:text-white">
              {summary.done}
            </span>
            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
              {tasks.length > 0 ? Math.round((summary.done / tasks.length) * 100) : 0}% taxa
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            Histórico de entregas finalizadas
          </p>
        </div>
      </div>

      {/* Barra de Filtros Rápidos & Busca */}
      <div className="surface-card p-3 sm:p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Quick View Pills */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <button
              type="button"
              onClick={() => setQuickFilter('all')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                quickFilter === 'all'
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-2xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
              }`}
            >
              Todas ({tasks.length})
            </button>
            <button
              type="button"
              onClick={() => setQuickFilter('mine')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                quickFilter === 'mine'
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-2xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
              }`}
            >
              Minhas Tarefas
            </button>
            <button
              type="button"
              onClick={() => setQuickFilter('overdue')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1 ${
                quickFilter === 'overdue'
                  ? 'bg-rose-600 text-white shadow-2xs'
                  : 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 hover:bg-rose-100'
              }`}
            >
              <Flame size={12} />
              <span>Atrasadas ({summary.overdue})</span>
            </button>
            <button
              type="button"
              onClick={() => setQuickFilter('critical')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                quickFilter === 'critical'
                  ? 'bg-amber-600 text-white shadow-2xs'
                  : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 hover:bg-amber-100'
              }`}
            >
              Críticas & Altas
            </button>
            <button
              type="button"
              onClick={() => setQuickFilter('done')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                quickFilter === 'done'
                  ? 'bg-emerald-600 text-white shadow-2xs'
                  : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 hover:bg-emerald-100'
              }`}
            >
              Concluídas ({summary.done})
            </button>
          </div>

          {/* Busca & Botão de Filtros Avançados */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 sm:w-64">
              <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                value={filters.search}
                onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))}
                placeholder="Buscar tarefa..."
                className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:border-brand focus:outline-none"
              />
              {filters.search && (
                <button
                  type="button"
                  onClick={() => setFilters((p) => ({ ...p, search: '' }))}
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowFiltersPanel((p) => !p)}
              className={`p-2 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                hasActiveFilters(filters) || showFiltersPanel
                  ? 'bg-brand/10 border-brand text-brand'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
              title="Filtros avançados"
            >
              <SlidersHorizontal size={14} />
              <span className="hidden sm:inline">Filtros</span>
            </button>

            {/* Ordenador */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-300 font-medium focus:border-brand focus:outline-none cursor-pointer"
            >
              <option value="smart">Ordenar: Inteligente</option>
              <option value="due">Ordenar: Prazo Próximo</option>
              <option value="recent">Ordenar: Mais Recentes</option>
            </select>
          </div>
        </div>

        {/* Painel Expansível de Filtros Avançados */}
        {showFiltersPanel && (
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 grid gap-3 sm:grid-cols-4 animate-in fade-in duration-200">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Prioridade
              </label>
              <select
                value={filters.priority}
                onChange={(e) => setFilters((p) => ({ ...p, priority: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 text-xs text-slate-700 dark:text-slate-200"
              >
                <option value="">Todas as prioridades</option>
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Responsável
              </label>
              <select
                value={filters.assignee}
                onChange={(e) => setFilters((p) => ({ ...p, assignee: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 text-xs text-slate-700 dark:text-slate-200"
              >
                <option value="">Todos os responsáveis</option>
                <option value="__none__">Sem atribuição</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.name}>
                    {emp.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Projeto
              </label>
              <select
                value={filters.projectId}
                onChange={(e) => setFilters((p) => ({ ...p, projectId: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 text-xs text-slate-700 dark:text-slate-200"
              >
                <option value="">Todos os projetos</option>
                {projects.map((proj) => (
                  <option key={proj.id} value={proj.id}>
                    {proj.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-end">
              <button
                type="button"
                onClick={() => {
                  setFilters(EMPTY_FILTERS);
                  setQuickFilter('all');
                }}
                className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-300 transition-colors"
              >
                Limpar Todos os Filtros
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Formulário Rápido de Criação Inline */}
      {canWrite && (
        <form
          onSubmit={handleQuickAdd}
          className="surface-card p-2 sm:p-2.5 flex flex-wrap items-center gap-2 border-dashed border-2 border-slate-300 dark:border-slate-700 hover:border-brand/60 transition-colors"
        >
          <div className="flex-1 min-w-[220px] relative">
            <input
              type="text"
              value={quickTitle}
              onChange={(e) => setQuickTitle(e.target.value)}
              placeholder="+ Adicionar tarefa rápida à fila (Pressione Enter)..."
              disabled={savingQuick}
              className="w-full pl-3 pr-3 py-2 text-xs sm:text-sm bg-transparent border-none text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <select
              value={quickPriority}
              onChange={(e) => setQuickPriority(e.target.value)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-300"
            >
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>

            <button
              type="submit"
              disabled={savingQuick || !quickTitle.trim()}
              className="inline-flex items-center gap-1 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-3 py-1.5 text-xs font-bold hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              {savingQuick ? <RefreshCcw size={13} className="animate-spin" /> : <Plus size={13} />}
              <span>Adicionar</span>
            </button>
          </div>
        </form>
      )}

      {/* Conteúdo Principal: Quadro Kanban vs Lista */}
      {loading ? (
        <div className="surface-card p-16 text-center space-y-3">
          <RefreshCcw size={28} className="animate-spin text-brand mx-auto" />
          <p className="text-xs font-medium text-slate-500">
            Sincronizando tarefas com o banco de dados...
          </p>
        </div>
      ) : viewMode === 'kanban' ? (
        /* Visualização em Quadro Kanban */
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 items-start">
          {TASK_COLUMNS.map((col) => {
            const colTasks = processedTasks.filter((t) => columnOf(t.status) === col.id);
            const isDropActive = dragOverColId === col.id;
            const theme = COLUMN_COLORS[col.accent] || COLUMN_COLORS.slate;

            return (
              <div
                key={col.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragOverColId !== col.id) setDragOverColId(col.id);
                }}
                onDragLeave={() => {
                  if (dragOverColId === col.id) setDragOverColId(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const taskId = e.dataTransfer.getData('text/plain') || draggedTaskId;
                  if (taskId) handleMoveTask(taskId, col.id);
                  setDragOverColId(null);
                  setDraggedTaskId(null);
                }}
                className={`rounded-2xl border transition-all duration-200 flex flex-col bg-slate-50/70 dark:bg-slate-900/40 min-h-[580px] ${
                  isDropActive
                    ? `${theme.dropHighlight} border-2 border-dashed shadow-md scale-[1.01]`
                    : 'border-slate-200/90 dark:border-slate-800'
                }`}
              >
                {/* Column Header */}
                <div
                  className={`p-3.5 rounded-t-2xl border-b flex items-center justify-between ${theme.header}`}
                >
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-black uppercase tracking-wider">{col.label}</h3>
                  </div>
                  <span
                    className={`text-xs font-bold px-2 py-0.5 rounded-full ${theme.chip}`}
                  >
                    {colTasks.length}
                  </span>
                </div>

                {/* Cards Container */}
                <div className="p-2.5 space-y-2.5 flex-1 overflow-y-auto max-h-[72vh] custom-scrollbar">
                  {colTasks.length === 0 ? (
                    <div className="h-32 flex flex-col items-center justify-center border border-dashed border-slate-300 dark:border-slate-800 rounded-xl text-center p-3">
                      <p className="text-[11px] font-semibold text-slate-400">Nenhuma tarefa</p>
                      <p className="text-[10px] text-slate-400">Arraste tarefas para cá</p>
                    </div>
                  ) : (
                    colTasks.map((task) => {
                      const priorityInfo = PRIORITY_THEMES[task.priority] || PRIORITY_THEMES.Média;
                      const dState = dueState(task);
                      const dText = dueLabel(task);
                      const chkProgress = checklistProgress(task);
                      const offStatus = offFlowStatus(task.status);
                      const isTaskDragging = draggedTaskId === task.id;

                      const colIndex = TASK_COLUMNS.findIndex((c) => c.id === col.id);
                      const prevCol = colIndex > 0 ? TASK_COLUMNS[colIndex - 1] : null;
                      const nextCol = colIndex < TASK_COLUMNS.length - 1 ? TASK_COLUMNS[colIndex + 1] : null;

                      return (
                        <div
                          key={task.id}
                          draggable={canWrite}
                          onDragStart={(e) => {
                            e.dataTransfer.setData('text/plain', task.id);
                            setDraggedTaskId(task.id);
                          }}
                          onDragEnd={() => {
                            setDraggedTaskId(null);
                            setDragOverColId(null);
                          }}
                          onClick={() => setDrawerTask(task)}
                          className={`surface-card p-3.5 space-y-2.5 cursor-pointer hover:border-brand/40 hover:shadow-md transition-all group ${
                            priorityInfo.cardBorder
                          } ${isTaskDragging ? 'opacity-40 scale-95' : ''}`}
                        >
                          {/* Top Tag Bar */}
                          <div className="flex items-center justify-between gap-1.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase flex items-center gap-1 ${priorityInfo.badge}`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${priorityInfo.dot}`} />
                                {task.priority || 'Média'}
                              </span>

                              {offStatus && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200">
                                  {offStatus}
                                </span>
                              )}

                              {task.category && task.category !== 'Geral' && (
                                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                                  {task.category}
                                </span>
                              )}
                            </div>

                            {/* Quick edit / delete actions on hover */}
                            {canWrite && (
                              <div
                                className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  onClick={() => handleOpenEditModal(task)}
                                  className="p-1 rounded text-slate-400 hover:text-brand hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                  title="Editar tarefa"
                                >
                                  <Edit3 size={13} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteTask(task.id)}
                                  className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                                  title="Excluir tarefa"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Title & Description */}
                          <div>
                            <h4
                              className={`text-xs sm:text-sm font-bold leading-snug ${
                                isDone(task)
                                  ? 'line-through text-slate-400 dark:text-slate-500'
                                  : 'text-slate-900 dark:text-white'
                              }`}
                            >
                              {task.title}
                            </h4>
                            {task.description && (
                              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
                                {task.description}
                              </p>
                            )}
                          </div>

                          {/* Project Tag */}
                          {task.projectId && projectMap.has(task.projectId) && (
                            <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand font-mono bg-brand/5 dark:bg-brand/15 px-2 py-0.5 rounded-md">
                              <FolderGit2 size={11} />
                              <span className="truncate max-w-[180px]">
                                {projectMap.get(task.projectId)}
                              </span>
                            </div>
                          )}

                          {/* Checklist preview */}
                          {chkProgress.total > 0 && (
                            <div
                              className="bg-slate-50 dark:bg-slate-800/80 rounded-lg p-2 border border-slate-100 dark:border-slate-800 text-xs space-y-1.5"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="flex items-center justify-between text-[10px] font-bold text-slate-500">
                                <span className="flex items-center gap-1">
                                  <CheckSquare size={11} className="text-brand" /> Checklist
                                </span>
                                <span>
                                  {chkProgress.done}/{chkProgress.total}
                                </span>
                              </div>
                              <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-brand rounded-full transition-all"
                                  style={{
                                    width: `${Math.round(
                                      (chkProgress.done / chkProgress.total) * 100,
                                    )}%`,
                                  }}
                                />
                              </div>
                            </div>
                          )}

                          {/* Footer: Due date + Assignee + Quick move buttons */}
                          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 text-xs">
                            <div className="flex items-center gap-2">
                              {/* Due Date Badge */}
                              {dText && (
                                <span
                                  className={`inline-flex items-center gap-1 font-mono text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                    dState === 'overdue'
                                      ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                                      : dState === 'today'
                                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                                      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                                  }`}
                                >
                                  <Calendar size={10} />
                                  <span>{dText}</span>
                                </span>
                              )}

                              {/* Assignee Avatar */}
                              {task.assignee && (
                                <span
                                  className="w-5 h-5 rounded-full bg-gradient-to-tr from-brand to-indigo-600 text-white flex items-center justify-center font-bold text-[9px] uppercase shadow-2xs"
                                  title={`Responsável: ${task.assignee}`}
                                >
                                  {initialsOf(task.assignee)}
                                </span>
                              )}
                            </div>

                            {/* Stepper buttons (prev/next column) */}
                            {canWrite && (
                              <div
                                className="flex items-center gap-1"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {prevCol && (
                                  <button
                                    type="button"
                                    onClick={() => handleMoveTask(task.id, prevCol.id)}
                                    className="p-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-500 hover:text-slate-900 transition-colors"
                                    title={`Mover para ${prevCol.label}`}
                                  >
                                    <ArrowLeft size={11} />
                                  </button>
                                )}
                                {nextCol && (
                                  <button
                                    type="button"
                                    onClick={() => handleMoveTask(task.id, nextCol.id)}
                                    className={`p-1 rounded transition-colors ${
                                      nextCol.id === DONE_STATUS
                                        ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300'
                                        : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-500 hover:text-slate-900'
                                    }`}
                                    title={`Mover para ${nextCol.label}`}
                                  >
                                    {nextCol.id === DONE_STATUS ? (
                                      <Check size={11} />
                                    ) : (
                                      <ArrowRight size={11} />
                                    )}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Visualização em Lista Estruturada */
        <div className="surface-card overflow-hidden">
          {processedTasks.length === 0 ? (
            <div className="p-16 text-center space-y-2">
              <CheckSquare size={36} className="mx-auto text-slate-300 dark:text-slate-700" />
              <p className="text-xs font-semibold text-slate-500">Nenhuma tarefa encontrada.</p>
              <p className="text-[11px] text-slate-400">
                Tente alterar os filtros ou cadastre uma nova tarefa.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {processedTasks.map((task) => {
                const priorityInfo = PRIORITY_THEMES[task.priority] || PRIORITY_THEMES.Média;
                const dState = dueState(task);
                const dText = dueLabel(task);
                const chkProgress = checklistProgress(task);
                const done = isDone(task);

                return (
                  <div
                    key={task.id}
                    onClick={() => setDrawerTask(task)}
                    className={`p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors cursor-pointer group ${
                      done ? 'opacity-65' : ''
                    }`}
                  >
                    <div className="flex items-start sm:items-center gap-3 flex-1 min-w-0">
                      {/* Checkbox toggle */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleDone(task);
                        }}
                        disabled={!canWrite}
                        className={`mt-0.5 sm:mt-0 transition-colors shrink-0 ${
                          done
                            ? 'text-emerald-500'
                            : 'text-slate-300 dark:text-slate-600 hover:text-brand'
                        }`}
                      >
                        {done ? <CheckSquare size={20} /> : <Square size={20} />}
                      </button>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`text-xs sm:text-sm font-bold truncate ${
                              done
                                ? 'line-through text-slate-400 dark:text-slate-500'
                                : 'text-slate-900 dark:text-white'
                            }`}
                          >
                            {task.title}
                          </span>

                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase ${priorityInfo.badge}`}
                          >
                            {task.priority || 'Média'}
                          </span>

                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                            {task.status}
                          </span>
                        </div>

                        {task.description && (
                          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 truncate">
                            {task.description}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Metadata & Actions */}
                    <div
                      className="flex items-center justify-between sm:justify-end gap-3 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* Project */}
                      {task.projectId && projectMap.has(task.projectId) && (
                        <span className="hidden md:inline-flex items-center gap-1 text-[11px] font-semibold text-brand bg-brand/5 dark:bg-brand/15 px-2 py-0.5 rounded truncate max-w-[140px]">
                          <FolderGit2 size={11} />
                          {projectMap.get(task.projectId)}
                        </span>
                      )}

                      {/* Checklist count */}
                      {chkProgress.total > 0 && (
                        <span className="text-[11px] font-mono text-slate-500 font-semibold flex items-center gap-1">
                          <CheckSquare size={12} className="text-brand" />
                          <span>
                            {chkProgress.done}/{chkProgress.total}
                          </span>
                        </span>
                      )}

                      {/* Due date */}
                      {dText && (
                        <span
                          className={`font-mono text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            dState === 'overdue'
                              ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                              : dState === 'today'
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                          }`}
                        >
                          {dText}
                        </span>
                      )}

                      {/* Assignee Avatar */}
                      {task.assignee ? (
                        <span
                          className="w-6 h-6 rounded-full bg-gradient-to-tr from-brand to-indigo-600 text-white flex items-center justify-center font-bold text-[10px] uppercase shadow-2xs"
                          title={`Responsável: ${task.assignee}`}
                        >
                          {initialsOf(task.assignee)}
                        </span>
                      ) : (
                        <span className="w-6 h-6 rounded-full border border-dashed border-slate-300 dark:border-slate-700 text-slate-400 flex items-center justify-center text-[9px]">
                          --
                        </span>
                      )}

                      {/* Edit / Delete actions */}
                      {canWrite && (
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={() => handleOpenEditModal(task)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-brand hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            title="Editar"
                          >
                            <Edit3 size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteTask(task.id)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                            title="Excluir"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Drawer Lateral de Detalhes da Tarefa */}
      {drawerTask && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-xs animate-in fade-in duration-200"
          onClick={() => setDrawerTask(null)}
        >
          <div
            className="w-full max-w-lg bg-white dark:bg-slate-900 h-full shadow-2xl p-6 overflow-y-auto space-y-5 border-l border-slate-200 dark:border-slate-800"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div className="flex items-center justify-between border-b border-slate-200/80 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <span
                  className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border uppercase ${
                    (PRIORITY_THEMES[drawerTask.priority] || PRIORITY_THEMES.Média).badge
                  }`}
                >
                  {drawerTask.priority || 'Média'}
                </span>
                <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                  {drawerTask.status}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {canWrite && (
                  <button
                    type="button"
                    onClick={() => {
                      const t = drawerTask;
                      setDrawerTask(null);
                      handleOpenEditModal(t);
                    }}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-brand hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    title="Editar em formulário completo"
                  >
                    <Edit3 size={16} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setDrawerTask(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Title & Description */}
            <div className="space-y-2">
              <h2 className="text-lg font-extrabold text-slate-900 dark:text-white leading-snug">
                {drawerTask.title}
              </h2>
              {drawerTask.description ? (
                <p className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap leading-relaxed bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-200/60 dark:border-slate-800">
                  {drawerTask.description}
                </p>
              ) : (
                <p className="text-xs text-slate-400 italic">Sem descrição detalhada.</p>
              )}
            </div>

            {/* Metadados: Projeto, Responsável, Prazo */}
            <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 dark:bg-slate-800/40 p-3.5 rounded-xl border border-slate-200/60 dark:border-slate-800">
              <div>
                <span className="text-[10px] font-bold uppercase text-slate-400 block mb-0.5">
                  Projeto
                </span>
                <span className="font-semibold text-slate-800 dark:text-slate-200 truncate block">
                  {drawerTask.projectId && projectMap.has(drawerTask.projectId)
                    ? projectMap.get(drawerTask.projectId)
                    : 'Nenhum projeto vinculado'}
                </span>
              </div>

              <div>
                <span className="text-[10px] font-bold uppercase text-slate-400 block mb-0.5">
                  Responsável
                </span>
                <span className="font-semibold text-slate-800 dark:text-slate-200 truncate block">
                  {drawerTask.assignee || 'Não atribuído'}
                </span>
              </div>

              <div>
                <span className="text-[10px] font-bold uppercase text-slate-400 block mb-0.5">
                  Prazo de Entrega
                </span>
                <span className="font-semibold text-slate-800 dark:text-slate-200 block">
                  {drawerTask.dueDate ? formatDateBR(drawerTask.dueDate) : 'Sem prazo'}
                </span>
              </div>

              <div>
                <span className="text-[10px] font-bold uppercase text-slate-400 block mb-0.5">
                  Categoria
                </span>
                <span className="font-semibold text-slate-800 dark:text-slate-200 block">
                  {drawerTask.category || 'Geral'}
                </span>
              </div>
            </div>

            {/* Checklist Interativo */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <CheckSquare size={14} className="text-brand" />
                  <span>Subtarefas / Checklist</span>
                </h4>
                <span className="text-xs font-bold text-slate-500 font-mono">
                  {checklistProgress(drawerTask).done}/{checklistProgress(drawerTask).total}
                </span>
              </div>

              <div className="space-y-1.5">
                {checklistOf(drawerTask).length === 0 ? (
                  <p className="text-xs text-slate-400 italic py-2">
                    Nenhum item de checklist configurado nesta tarefa.
                  </p>
                ) : (
                  checklistOf(drawerTask).map((item) => (
                    <div
                      key={item.id}
                      onClick={() => handleToggleChecklistItem(drawerTask, item.id)}
                      className={`p-2 rounded-lg border text-xs flex items-center gap-2 cursor-pointer transition-colors ${
                        item.done
                          ? 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-200 text-slate-500 line-through'
                          : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 hover:border-brand'
                      }`}
                    >
                      <span className={item.done ? 'text-emerald-500' : 'text-slate-400'}>
                        {item.done ? <CheckSquare size={15} /> : <Square size={15} />}
                      </span>
                      <span className="flex-1">{item.text}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Mover Status Rápido no Drawer */}
            {canWrite && (
              <div className="space-y-2 pt-3 border-t border-slate-200/80 dark:border-slate-800">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                  Mover para Coluna:
                </span>
                <div className="grid grid-cols-2 gap-2">
                  {TASK_STATUSES.map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => handleMoveTask(drawerTask.id, st)}
                      className={`py-2 px-3 rounded-xl text-xs font-bold transition-all ${
                        drawerTask.status === st
                          ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-2xs'
                          : 'border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal Completo: Criar ou Editar Tarefa */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-xl p-6 sm:p-7 space-y-5 border border-slate-200/90 dark:border-slate-800 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200/80 dark:border-slate-800 pb-3">
              <h2 className="text-lg font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                {modalMode === 'create' ? <Plus size={18} className="text-brand" /> : <Edit3 size={18} className="text-brand" />}
                <span>{modalMode === 'create' ? 'Nova Tarefa Operacional' : 'Editar Tarefa'}</span>
              </h2>
              <button
                type="button"
                disabled={savingModal}
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveModal} className="space-y-4">
              <div>
                <label
                  htmlFor="task-title-input"
                  className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1"
                >
                  Título da Tarefa *
                </label>
                <input
                  id="task-title-input"
                  type="text"
                  required
                  value={taskForm.title}
                  onChange={(e) => setTaskForm((p) => ({ ...p, title: e.target.value }))}
                  placeholder="Ex.: Instalar switch gerenciável no rack 2"
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs sm:text-sm text-slate-900 dark:text-white focus:border-brand focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="task-description-input"
                  className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1"
                >
                  Descrição e Orientações Técnicas
                </label>
                <textarea
                  id="task-description-input"
                  rows={3}
                  value={taskForm.description}
                  onChange={(e) => setTaskForm((p) => ({ ...p, description: e.target.value }))}
                  placeholder="Instruções de execução, requisitos, links ou detalhes adicionais..."
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs sm:text-sm text-slate-900 dark:text-white focus:border-brand focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Status
                  </label>
                  <select
                    value={taskForm.status}
                    onChange={(e) => setTaskForm((p) => ({ ...p, status: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-xs text-slate-800 dark:text-slate-100"
                  >
                    {TASK_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Prioridade
                  </label>
                  <select
                    value={taskForm.priority}
                    onChange={(e) => setTaskForm((p) => ({ ...p, priority: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-xs text-slate-800 dark:text-slate-100"
                  >
                    {TASK_PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Categoria
                  </label>
                  <select
                    value={taskForm.category}
                    onChange={(e) => setTaskForm((p) => ({ ...p, category: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-xs text-slate-800 dark:text-slate-100"
                  >
                    {TASK_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Prazo de Entrega
                  </label>
                  <input
                    type="date"
                    value={taskForm.dueDate}
                    onChange={(e) => setTaskForm((p) => ({ ...p, dueDate: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-xs text-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Responsável
                  </label>
                  <select
                    value={taskForm.assignee}
                    onChange={(e) => setTaskForm((p) => ({ ...p, assignee: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-xs text-slate-800 dark:text-slate-100"
                  >
                    <option value="">Não atribuído</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.name}>
                        {emp.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Vincular a Projeto
                  </label>
                  <select
                    value={taskForm.projectId}
                    onChange={(e) => setTaskForm((p) => ({ ...p, projectId: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-xs text-slate-800 dark:text-slate-100"
                  >
                    <option value="">Sem projeto vinculado</option>
                    {projects.map((proj) => (
                      <option key={proj.id} value={proj.id}>
                        {proj.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Checklist Builder */}
              <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                  Subtarefas (Checklist)
                </label>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newChecklistText}
                    onChange={(e) => setNewChecklistText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddChecklistItemModal();
                      }
                    }}
                    placeholder="Adicionar item à checklist..."
                    className="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs text-slate-800 dark:text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={handleAddChecklistItemModal}
                    className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-xs font-bold text-slate-700 dark:text-slate-200 transition-colors"
                  >
                    + Item
                  </button>
                </div>

                <div className="space-y-1.5 max-h-36 overflow-y-auto">
                  {taskForm.checklist.map((item) => (
                    <div
                      key={item.id}
                      className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs flex items-center justify-between gap-2"
                    >
                      <button
                        type="button"
                        onClick={() => handleToggleChecklistItemModal(item.id)}
                        className="flex items-center gap-2 flex-1 text-left"
                      >
                        <span className={item.done ? 'text-emerald-500' : 'text-slate-400'}>
                          {item.done ? <CheckSquare size={14} /> : <Square size={14} />}
                        </span>
                        <span
                          className={
                            item.done
                              ? 'line-through text-slate-400'
                              : 'text-slate-800 dark:text-slate-200'
                          }
                        >
                          {item.text}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveChecklistItemModal(item.id)}
                        className="text-slate-400 hover:text-red-500"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-3 border-t border-slate-200/80 dark:border-slate-800">
                <button
                  type="button"
                  disabled={savingModal}
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingModal}
                  className="flex-1 py-2.5 rounded-xl bg-brand hover:bg-brand-dark text-white text-xs font-bold uppercase tracking-wider transition-colors shadow-sm disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {savingModal ? <RefreshCcw size={14} className="animate-spin" /> : <Save size={14} />}
                  <span>{savingModal ? 'Salvando...' : 'Salvar Tarefa'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default TaskManager;
