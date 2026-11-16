// src/pages/TaskManager.jsx
import React, { useState, useEffect, useCallback, useMemo, useRef, useId } from 'react';
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
  AlertTriangle,
  FolderGit2,
  SlidersHorizontal,
  Flame,
  CheckCheck,
  CircleDot,
  Layers,
} from 'lucide-react';
import { toast } from 'sonner';
import { captureFocusTarget, restoreFocusSafely, trapFocusWithin } from '../utils/focusTrap';
import { isTopmostModal } from '../utils/modalStack';

const fieldBaseClass =
  'min-h-[44px] border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] text-slate-800 dark:text-[#fafafa] placeholder:text-slate-400 dark:placeholder:text-zinc-500 transition-colors hover:border-slate-300 dark:hover:border-zinc-700 active:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:border-brand disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-zinc-900 aria-[invalid=true]:border-rose-500 aria-[invalid=true]:focus-visible:ring-rose-500';

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
    badge: 'bg-slate-500/10 text-slate-700 dark:text-zinc-400 border-slate-500/20',
    dot: 'bg-slate-400',
    cardBorder: 'border-l-4 border-l-slate-400',
  },
};

const COLUMN_COLORS = {
  slate: {
    header: 'bg-slate-100 dark:bg-zinc-900 text-slate-800 dark:text-zinc-200 border-slate-200 dark:border-zinc-800',
    dropHighlight: 'border-slate-400 bg-slate-50/70 dark:bg-zinc-900/60',
    chip: 'bg-slate-200 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300',
  },
  blue: {
    header: 'bg-sky-50/80 dark:bg-sky-950/40 text-sky-900 dark:text-sky-200 border-sky-200/70 dark:border-sky-900/40',
    dropHighlight: 'border-sky-400 bg-sky-50/50 dark:bg-sky-950/30',
    chip: 'bg-sky-100 dark:bg-sky-900/60 text-sky-700 dark:text-sky-300',
  },
  violet: {
    header: 'bg-teal-50/80 dark:bg-teal-950/40 text-teal-900 dark:text-teal-200 border-teal-200/70 dark:border-teal-900/40',
    dropHighlight: 'border-teal-400 bg-teal-50/50 dark:bg-teal-950/30',
    chip: 'bg-teal-100 dark:bg-teal-900/60 text-teal-700 dark:text-teal-300',
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
  const [loadError, setLoadError] = useState('');
  const [savingQuick, setSavingQuick] = useState(false);
  const [savingModal, setSavingModal] = useState(false);
  const [deletingTaskId, setDeletingTaskId] = useState(null);

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

  const drawerTitleId = useId();
  const modalTitleId = useId();
  const drawerRef = useRef(null);
  const modalRef = useRef(null);
  const drawerCloseBtnRef = useRef(null);
  const modalFirstInputRef = useRef(null);
  const previousDrawerFocusRef = useRef(null);
  const previousModalFocusRef = useRef(null);
  const savingModalRef = useRef(savingModal);
  savingModalRef.current = savingModal;
  const isMountedRef = useRef(true);
  const tasksSeqRef = useRef(0);
  const auxSeqRef = useRef(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const isDrawerOpen = Boolean(drawerTask);

  useEffect(() => {
    if (!isDrawerOpen) return undefined;
    const container = drawerRef.current;
    previousDrawerFocusRef.current = captureFocusTarget(container);
    const raf = requestAnimationFrame(() => drawerCloseBtnRef.current?.focus());
    const onKeyDown = (e) => {
      if (!isTopmostModal(container)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        setDrawerTask(null);
        return;
      }
      if (e.key === 'Tab') {
        trapFocusWithin(e, container);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown);
      const previous = previousDrawerFocusRef.current;
      previousDrawerFocusRef.current = null;
      restoreFocusSafely(previous, null, container);
    };
  }, [isDrawerOpen]);

  useEffect(() => {
    if (!isModalOpen) return undefined;
    const container = modalRef.current;
    previousModalFocusRef.current = captureFocusTarget(container);
    const raf = requestAnimationFrame(() => modalFirstInputRef.current?.focus());
    const onKeyDown = (e) => {
      if (!isTopmostModal(container)) return;
      if (e.key === 'Escape') {
        if (savingModalRef.current) return;
        e.preventDefault();
        setIsModalOpen(false);
        return;
      }
      if (e.key === 'Tab') {
        trapFocusWithin(e, container);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown);
      const previous = previousModalFocusRef.current;
      previousModalFocusRef.current = null;
      restoreFocusSafely(previous, null, container);
    };
  }, [isModalOpen]);

  // Mapeamento id -> nome do projeto
  const projectMap = useMemo(() => {
    const map = new Map();
    projects.forEach((p) => map.set(p.id, p.name || 'Projeto sem nome'));
    return map;
  }, [projects]);

  // Carrega Tarefas
  const loadTasks = useCallback(async ({ isCancelled } = {}) => {
    const seq = ++tasksSeqRef.current;
    const stale = () => !isMountedRef.current || seq !== tasksSeqRef.current || Boolean(isCancelled?.());

    if (!tenantId) {
      if (!stale()) {
        setTasks([]);
        setLoadError('');
        setLoading(false);
      }
      return;
    }
    setLoading(true);
    setLoadError('');
    try {
      const data = await getTasks(tenantId);
      if (stale()) return;
      setTasks(data);
    } catch (err) {
      console.error(err);
      if (stale()) return;
      setLoadError('Não foi possível sincronizar as tarefas.');
      toast.error('Erro ao carregar tarefas.');
    } finally {
      if (!stale()) {
        setLoading(false);
      }
    }
  }, [tenantId]);

  // Carrega Recursos Auxiliares (Projetos e Colaboradores)
  const loadAuxData = useCallback(async ({ isCancelled } = {}) => {
    if (!tenantId) return;
    const seq = ++auxSeqRef.current;
    const stale = () => !isMountedRef.current || seq !== auxSeqRef.current || Boolean(isCancelled?.());

    try {
      const [projData, empData] = await Promise.all([
        getProjects(tenantId).catch(() => []),
        getEmployees(tenantId).catch(() => []),
      ]);
      if (stale()) return;
      setProjects(projData || []);
      setEmployees(empData || []);
    } catch {
      // Silencioso em caso de falha opcional
    }
  }, [tenantId]);

  useEffect(() => {
    let cancelled = false;
    if (tenantId) {
      loadTasks({ isCancelled: () => cancelled });
      loadAuxData({ isCancelled: () => cancelled });
    } else {
      setTasks([]);
      setLoading(false);
    }
    return () => {
      cancelled = true;
    };
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
    if (savingQuick) return;
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
      if (!isMountedRef.current) return;
      setQuickTitle('');
      toast.success('Tarefa adicionada à fila.');
      await loadTasks();
    } catch (err) {
      console.error(err);
      if (isMountedRef.current) toast.error('Erro ao adicionar tarefa.');
    } finally {
      if (isMountedRef.current) setSavingQuick(false);
    }
  };

  // Handler: Mudar Status (Kanban Dnd ou Botões)
  const handleMoveTask = async (taskId, newStatus) => {
    if (!canWrite) return;
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === newStatus) return;

    const prevTask = task;
    const patch = statusPatch(newStatus);
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...patch } : t)));

    if (drawerTask?.id === taskId) {
      setDrawerTask((prev) => (prev?.id === taskId ? { ...prev, ...patch } : prev));
    }

    try {
      await updateTask(taskId, patch);
      if (isMountedRef.current) toast.success(`Tarefa movida para "${newStatus}".`);
    } catch (err) {
      console.error(err);
      if (!isMountedRef.current) return;
      setTasks((prev) => prev.map((t) => (t.id === taskId ? prevTask : t)));
      setDrawerTask((prev) => (prev?.id === taskId ? prevTask : prev));
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
      setDrawerTask((prev) => (prev?.id === task.id ? { ...prev, checklist: updatedList } : prev));
    }

    try {
      await updateTask(task.id, { checklist: updatedList });
      if (isMountedRef.current && allDone && !isDone(task)) {
        toast.info('Todos os itens foram concluídos!');
      }
    } catch (err) {
      console.error(err);
      if (!isMountedRef.current) return;
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, checklist: currentList } : t)),
      );
      setDrawerTask((prev) => (prev?.id === task.id ? { ...prev, checklist: currentList } : prev));
      toast.error('Erro ao salvar checklist.');
      await loadTasks();
    }
  };

  // Handler: Excluir Tarefa
  const handleDeleteTask = async (taskId) => {
    if (!canWrite || deletingTaskId) return;
    const confirmed = await confirm({
      title: 'Excluir Tarefa',
      message: 'Tem certeza que deseja excluir esta tarefa permanentemente?',
      danger: true,
      confirmLabel: 'Excluir Tarefa',
    });
    if (!confirmed || !isMountedRef.current) return;

    setDeletingTaskId(taskId);
    try {
      await deleteTask(taskId);
      if (!isMountedRef.current) return;
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      if (drawerTask?.id === taskId) setDrawerTask(null);
      toast.success('Tarefa excluída.');
    } catch (err) {
      console.error(err);
      if (isMountedRef.current) toast.error('Erro ao excluir tarefa.');
    } finally {
      if (isMountedRef.current) setDeletingTaskId(null);
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
    if (savingModal) return;
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
        if (!isMountedRef.current) return;
        toast.success('Nova tarefa criada com sucesso.');
      } else {
        const patch = {
          ...sanitized,
          ...(isDone(sanitized) ? { completedAt: new Date().toISOString() } : {}),
        };
        await updateTask(taskForm.id, patch);
        if (!isMountedRef.current) return;
        toast.success('Tarefa atualizada.');
      }

      setIsModalOpen(false);
      await loadTasks();
    } catch (err) {
      console.error(err);
      if (isMountedRef.current) toast.error('Erro ao salvar tarefa.');
    } finally {
      if (isMountedRef.current) setSavingModal(false);
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
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-slate-200/80 dark:border-zinc-800 pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand-aa">
            <span aria-hidden="true" className="flex h-2 w-2 rounded-full bg-emerald-500" />
            <span>Fluxo Operacional • Gestão de Tarefas & Demandas</span>
          </div>
          <h1 className="mt-1 text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-[#fafafa] flex items-center gap-2.5">
            <CheckSquare className="text-brand-aa" size={28} aria-hidden="true" />
            <span>Gestão de Tarefas</span>
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-slate-500 dark:text-zinc-400 max-w-2xl">
            Planejamento diário de infraestrutura, atendimento a chamados técnicos e acompanhamento de entregas de TI.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Alternador de Visualização (Kanban vs Lista) */}
          <div className="inline-flex items-center p-1 rounded-xl bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 shadow-sm">
            <button
              type="button"
              onClick={() => setViewMode('kanban')}
              aria-pressed={viewMode === 'kanban'}
              className={`min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                viewMode === 'kanban'
                  ? 'bg-white dark:bg-[#111113] text-slate-900 dark:text-[#fafafa] shadow-sm'
                  : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-[#fafafa]'
              }`}
            >
              <Kanban size={14} aria-hidden="true" />
              <span>Quadro</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              aria-pressed={viewMode === 'list'}
              className={`min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                viewMode === 'list'
                  ? 'bg-white dark:bg-[#111113] text-slate-900 dark:text-[#fafafa] shadow-sm'
                  : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-[#fafafa]'
              }`}
            >
              <List size={14} aria-hidden="true" />
              <span>Lista</span>
            </button>
          </div>

          <button
            type="button"
            onClick={loadTasks}
            className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand shadow-sm"
            title="Recarregar tarefas"
          >
            <RefreshCcw size={13} aria-hidden="true" className={loading ? 'animate-spin text-brand-aa' : ''} />
            <span className="hidden sm:inline">Atualizar</span>
          </button>

          {canWrite && (
            <button
              type="button"
              onClick={handleOpenCreateModal}
              className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl bg-brand hover:bg-brand-dark px-4 py-2 text-xs font-bold text-brand-fg shadow-sm transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <Plus size={15} aria-hidden="true" />
              <span>Nova Tarefa</span>
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards Ribbon */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Ativas */}
        <div className="surface-card p-4 border-l-4 border-l-slate-500 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-zinc-400">
            <span>Demandas em Aberto</span>
            <Layers size={15} className="text-slate-400 dark:text-zinc-400" aria-hidden="true" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-black text-slate-900 dark:text-[#fafafa] tabular-nums">
              {summary.open}
            </span>
            <span className="text-xs text-slate-500 dark:text-zinc-400 font-mono tabular-nums">
              {tasks.length} total
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
            Fila de atividades pendentes
          </p>
        </div>

        {/* Em Andamento */}
        <div className="surface-card p-4 border-l-4 border-l-brand flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-zinc-400">
            <span>Em Execução / Revisão</span>
            <CircleDot size={15} className="text-brand-aa" aria-hidden="true" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-black text-slate-900 dark:text-[#fafafa] tabular-nums">
              {summary.inProgress}
            </span>
            <span className="text-xs font-semibold text-brand-aa tabular-nums">
              {summary.open > 0 ? Math.round((summary.inProgress / summary.open) * 100) : 0}% da fila
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
            Tarefas sendo trabalhadas agora
          </p>
        </div>

        {/* Alertas & Atrasadas */}
        <div
          className={`surface-card p-4 flex flex-col justify-between border-l-4 ${
            summary.overdue > 0 ? 'border-l-rose-500' : 'border-l-amber-500'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-zinc-400">
            <span>Atenção & Prazos</span>
            <AlertTriangle
              size={15}
              aria-hidden="true"
              className={summary.overdue > 0 ? 'text-rose-500' : 'text-amber-500'}
            />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-slate-900 dark:text-[#fafafa] tabular-nums">
                {summary.overdue}
              </span>
              <span className="text-xs font-semibold text-rose-600 dark:text-rose-400">
                Atrasadas
              </span>
            </div>
            {summary.dueToday > 0 && (
              <span className="text-xs font-bold text-amber-600 dark:text-amber-400 tabular-nums">
                {summary.dueToday} para hoje
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
            Prazos com necessidade de ação imediata
          </p>
        </div>

        {/* Concluídas */}
        <div className="surface-card p-4 border-l-4 border-l-emerald-500 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-zinc-400">
            <span>Concluídas</span>
            <CheckCheck size={15} className="text-emerald-500" aria-hidden="true" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-black text-slate-900 dark:text-[#fafafa] tabular-nums">
              {summary.done}
            </span>
            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
              {tasks.length > 0 ? Math.round((summary.done / tasks.length) * 100) : 0}% taxa
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
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
              aria-pressed={quickFilter === 'all'}
              className={`min-h-[44px] px-3.5 py-2 rounded-lg font-bold transition-colors tabular-nums active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                quickFilter === 'all'
                  ? 'bg-slate-900 text-white dark:bg-[#fafafa] dark:text-zinc-900 shadow-sm'
                  : 'bg-slate-100 dark:bg-zinc-900 text-slate-600 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-800'
              }`}
            >
              Todas ({tasks.length})
            </button>
            <button
              type="button"
              onClick={() => setQuickFilter('mine')}
              aria-pressed={quickFilter === 'mine'}
              className={`min-h-[44px] px-3.5 py-2 rounded-lg font-bold transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                quickFilter === 'mine'
                  ? 'bg-slate-900 text-white dark:bg-[#fafafa] dark:text-zinc-900 shadow-sm'
                  : 'bg-slate-100 dark:bg-zinc-900 text-slate-600 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-800'
              }`}
            >
              Minhas Tarefas
            </button>
            <button
              type="button"
              onClick={() => setQuickFilter('overdue')}
              aria-pressed={quickFilter === 'overdue'}
              className={`min-h-[44px] px-3.5 py-2 rounded-lg font-bold transition-colors tabular-nums flex items-center gap-1.5 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                quickFilter === 'overdue'
                  ? 'bg-rose-600 text-white shadow-sm'
                  : 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-950/60'
              }`}
            >
              <Flame size={12} aria-hidden="true" />
              <span>Atrasadas ({summary.overdue})</span>
            </button>
            <button
              type="button"
              onClick={() => setQuickFilter('critical')}
              aria-pressed={quickFilter === 'critical'}
              className={`min-h-[44px] px-3.5 py-2 rounded-lg font-bold transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                quickFilter === 'critical'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950/60'
              }`}
            >
              Críticas & Altas
            </button>
            <button
              type="button"
              onClick={() => setQuickFilter('done')}
              aria-pressed={quickFilter === 'done'}
              className={`min-h-[44px] px-3.5 py-2 rounded-lg font-bold transition-colors tabular-nums active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                quickFilter === 'done'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-950/60'
              }`}
            >
              Concluídas ({summary.done})
            </button>
          </div>

          {/* Busca & Botão de Filtros Avançados */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 sm:w-64">
              <label htmlFor="task-search" className="sr-only">
                Buscar tarefa
              </label>
              <Search size={14} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-zinc-400" />
              <input
                id="task-search"
                name="search"
                type="text"
                value={filters.search}
                onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))}
                placeholder="Buscar tarefa…"
                className={`${fieldBaseClass} w-full pl-9 pr-10 py-2 rounded-xl text-xs`}
              />
              {filters.search && (
                <button
                  type="button"
                  onClick={() => setFilters((p) => ({ ...p, search: '' }))}
                  aria-label="Limpar busca"
                  className="absolute right-0 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 dark:text-zinc-400 hover:text-slate-600 dark:hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-xl"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowFiltersPanel((p) => !p)}
              aria-expanded={showFiltersPanel}
              className={`min-h-[44px] px-3 py-2 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                hasActiveFilters(filters) || showFiltersPanel
                  ? 'bg-brand/10 border-brand text-brand-aa'
                  : 'border-slate-200 dark:border-zinc-800 text-slate-600 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800'
              }`}
              title="Filtros avançados"
            >
              <SlidersHorizontal size={14} aria-hidden="true" />
              <span className="hidden sm:inline">Filtros</span>
            </button>

            {/* Ordenador */}
            <label htmlFor="task-sort" className="sr-only">
              Ordenar tarefas
            </label>
            <select
              id="task-sort"
              name="sortBy"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className={`${fieldBaseClass} rounded-xl px-3 py-2 text-xs font-medium cursor-pointer`}
            >
              <option value="smart">Ordenar: Inteligente</option>
              <option value="due">Ordenar: Prazo Próximo</option>
              <option value="recent">Ordenar: Mais Recentes</option>
            </select>
          </div>
        </div>

        {/* Painel Expansível de Filtros Avançados */}
        {showFiltersPanel && (
          <div className="pt-3 border-t border-slate-100 dark:border-zinc-800 grid gap-3 sm:grid-cols-4 animate-slide-down">
            <div>
              <label
                htmlFor="filter-priority"
                className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-1"
              >
                Prioridade
              </label>
              <select
                id="filter-priority"
                name="filterPriority"
                value={filters.priority}
                onChange={(e) => setFilters((p) => ({ ...p, priority: e.target.value }))}
                className={`${fieldBaseClass} w-full rounded-lg p-2 text-xs cursor-pointer`}
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
              <label
                htmlFor="filter-assignee"
                className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-1"
              >
                Responsável
              </label>
              <select
                id="filter-assignee"
                name="filterAssignee"
                value={filters.assignee}
                onChange={(e) => setFilters((p) => ({ ...p, assignee: e.target.value }))}
                className={`${fieldBaseClass} w-full rounded-lg p-2 text-xs cursor-pointer`}
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
              <label
                htmlFor="filter-project"
                className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-1"
              >
                Projeto
              </label>
              <select
                id="filter-project"
                name="filterProject"
                value={filters.projectId}
                onChange={(e) => setFilters((p) => ({ ...p, projectId: e.target.value }))}
                className={`${fieldBaseClass} w-full rounded-lg p-2 text-xs cursor-pointer`}
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
                className="min-h-[44px] w-full p-2 rounded-lg border border-slate-200 dark:border-zinc-800 hover:bg-slate-100 dark:hover:bg-zinc-800 text-xs font-semibold text-slate-600 dark:text-zinc-300 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
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
          className="surface-card p-2 sm:p-2.5 flex flex-wrap items-center gap-2 border-dashed border-2 border-slate-300 dark:border-zinc-800 hover:border-brand/60 transition-colors"
        >
          <div className="flex-1 min-w-[220px] relative">
            <label htmlFor="quick-task-title" className="sr-only">
              Adicionar tarefa rápida
            </label>
            <input
              id="quick-task-title"
              name="quickTitle"
              type="text"
              value={quickTitle}
              onChange={(e) => setQuickTitle(e.target.value)}
              placeholder="+ Adicionar tarefa rápida à fila (Pressione Enter)…"
              disabled={savingQuick}
              className="min-h-[44px] w-full pl-3 pr-3 py-2 rounded-lg text-xs sm:text-sm bg-transparent dark:bg-[#111113] border border-transparent text-slate-900 dark:text-[#fafafa] placeholder:text-slate-400 dark:placeholder:text-zinc-500 transition-colors hover:border-slate-300 dark:hover:border-zinc-700 active:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:border-brand disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-zinc-900 aria-[invalid=true]:border-rose-500 aria-[invalid=true]:focus-visible:ring-rose-500"
            />
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="quick-task-priority" className="sr-only">
              Prioridade da tarefa rápida
            </label>
            <select
              id="quick-task-priority"
              name="quickPriority"
              value={quickPriority}
              onChange={(e) => setQuickPriority(e.target.value)}
              className={`${fieldBaseClass} rounded-lg px-2.5 py-2 text-xs cursor-pointer`}
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
              className="min-h-[44px] inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-[#fafafa] text-white dark:text-zinc-900 px-3.5 py-2 text-xs font-bold hover:opacity-90 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-40"
            >
              {savingQuick ? <RefreshCcw size={13} aria-hidden="true" className="animate-spin" /> : <Plus size={13} aria-hidden="true" />}
              <span>Adicionar</span>
            </button>
          </div>
        </form>
      )}

      {/* Conteúdo Principal: Quadro Kanban vs Lista */}
      {loading ? (
        <div role="status" className="surface-card p-16 text-center space-y-3">
          <RefreshCcw size={28} aria-hidden="true" className="animate-spin text-brand-aa mx-auto" />
          <p className="text-xs font-medium text-slate-500 dark:text-zinc-400">
            Sincronizando tarefas com o banco de dados…
          </p>
        </div>
      ) : loadError ? (
        <div role="alert" className="surface-card p-12 text-center space-y-4">
          <AlertTriangle size={28} aria-hidden="true" className="text-rose-500 mx-auto" />
          <p className="text-sm font-semibold text-slate-800 dark:text-[#fafafa]">{loadError}</p>
          <button
            type="button"
            onClick={loadTasks}
            className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-brand hover:bg-brand-dark text-brand-fg px-4 py-2 text-xs font-bold transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <RefreshCcw size={14} aria-hidden="true" />
            <span>Tentar Novamente</span>
          </button>
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
                className={`rounded-2xl border transition-colors duration-200 flex flex-col bg-slate-50/70 dark:bg-[#111113] min-h-[580px] ${
                  isDropActive
                    ? `${theme.dropHighlight} border-2 border-dashed shadow-md scale-[1.01]`
                    : 'border-slate-200/90 dark:border-zinc-800'
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
                    className={`text-xs font-bold px-2 py-0.5 rounded-full tabular-nums ${theme.chip}`}
                  >
                    {colTasks.length}
                  </span>
                </div>

                {/* Cards Container */}
                <div className="p-2.5 space-y-2.5 flex-1 overflow-y-auto max-h-[72vh] custom-scrollbar">
                  {colTasks.length === 0 ? (
                    <div className="h-32 flex flex-col items-center justify-center border border-dashed border-slate-300 dark:border-zinc-800 rounded-xl text-center p-3">
                      <p className="text-xs font-semibold text-slate-500 dark:text-zinc-400">Nenhuma tarefa</p>
                      <p className="text-xs text-slate-400 dark:text-zinc-400">Arraste tarefas para cá</p>
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
                        <article
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
                          className={`relative [content-visibility:auto] [contain-intrinsic-size:auto_150px] surface-card p-3.5 space-y-2.5 hover:border-brand/40 hover:shadow-md transition-colors group ${
                            priorityInfo.cardBorder
                          } ${isTaskDragging ? 'opacity-40 scale-95' : ''}`}
                        >
                          {/* Top Tag Bar */}
                          <div className="flex items-center justify-between gap-1.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span
                                className={`text-xs font-bold px-2 py-0.5 rounded-full border uppercase flex items-center gap-1 ${priorityInfo.badge}`}
                              >
                                <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${priorityInfo.dot}`} />
                                {task.priority || 'Média'}
                              </span>

                              {offStatus && (
                                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 dark:bg-zinc-900 dark:text-zinc-300 border border-slate-200 dark:border-zinc-800">
                                  {offStatus}
                                </span>
                              )}

                              {task.category && task.category !== 'Geral' && (
                                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 dark:bg-zinc-900 text-slate-600 dark:text-zinc-400">
                                  {task.category}
                                </span>
                              )}
                            </div>

                            {/* Quick edit / delete actions on hover/focus */}
                            {canWrite && (
                              <div className="relative z-10 flex items-center gap-0.5 opacity-80 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                                <button
                                  type="button"
                                  onClick={() => handleOpenEditModal(task)}
                                  aria-label={`Editar tarefa ${task.title}`}
                                  className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-slate-400 dark:text-zinc-400 hover:text-brand-aa hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                                  title="Editar tarefa"
                                >
                                  <Edit3 size={14} aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  disabled={Boolean(deletingTaskId)}
                                  onClick={() => handleDeleteTask(task.id)}
                                  aria-label={`Excluir tarefa ${task.title}`}
                                  className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-slate-400 dark:text-zinc-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50 disabled:cursor-not-allowed"
                                  title="Excluir tarefa"
                                >
                                  <Trash2 size={14} aria-hidden="true" />
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Title & Description */}
                          <div>
                            <h4 className="text-xs sm:text-sm font-bold leading-snug">
                              <button
                                type="button"
                                onClick={() => setDrawerTask(task)}
                                className={`text-left w-full rounded after:absolute after:inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                                  isDone(task)
                                    ? 'line-through text-slate-400 dark:text-zinc-400'
                                    : 'text-slate-900 dark:text-[#fafafa]'
                                }`}
                              >
                                {task.title}
                              </button>
                            </h4>
                            {task.description && (
                              <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400 line-clamp-2 leading-relaxed">
                                {task.description}
                              </p>
                            )}
                          </div>

                          {/* Project Tag */}
                          {task.projectId && projectMap.has(task.projectId) && (
                            <div className="inline-flex items-center gap-1 text-xs font-semibold text-brand-aa font-mono bg-brand/5 dark:bg-brand/15 px-2 py-0.5 rounded-md">
                              <FolderGit2 size={12} aria-hidden="true" />
                              <span className="truncate max-w-[180px]">
                                {projectMap.get(task.projectId)}
                              </span>
                            </div>
                          )}

                          {/* Checklist preview */}
                          {chkProgress.total > 0 && (
                            <div className="bg-slate-50 dark:bg-zinc-900 rounded-lg p-2 border border-slate-100 dark:border-zinc-800 text-xs space-y-1.5">
                              <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-zinc-400">
                                <span className="flex items-center gap-1">
                                  <CheckSquare size={12} className="text-brand-aa" aria-hidden="true" /> Checklist
                                </span>
                                <span className="tabular-nums">
                                  {chkProgress.done}/{chkProgress.total}
                                </span>
                              </div>
                              <div className="w-full bg-slate-200 dark:bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-brand rounded-full transition-colors"
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
                          <div className="pt-2 border-t border-slate-100 dark:border-zinc-800 flex items-center justify-between gap-2 text-xs">
                            <div className="flex items-center gap-2">
                              {/* Due Date Badge */}
                              {dText && (
                                <span
                                  className={`inline-flex items-center gap-1 font-mono text-xs font-bold px-2 py-0.5 rounded-full tabular-nums ${
                                    dState === 'overdue'
                                      ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                                      : dState === 'today'
                                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                                      : 'bg-slate-100 text-slate-600 dark:bg-zinc-900 dark:text-zinc-400'
                                  }`}
                                >
                                  <Calendar size={11} aria-hidden="true" />
                                  <span>{dText}</span>
                                </span>
                              )}

                              {/* Assignee Avatar */}
                              {task.assignee && (
                                <span
                                  className="w-7 h-7 rounded-full bg-brand text-brand-fg flex items-center justify-center font-bold text-xs uppercase shadow-sm"
                                  title={`Responsável: ${task.assignee}`}
                                >
                                  {initialsOf(task.assignee)}
                                </span>
                              )}
                            </div>

                            {/* Stepper buttons (prev/next column) */}
                            {canWrite && (
                              <div className="relative z-10 flex items-center gap-1">
                                {prevCol && (
                                  <button
                                    type="button"
                                    onClick={() => handleMoveTask(task.id, prevCol.id)}
                                    aria-label={`Mover ${task.title} para ${prevCol.label}`}
                                    className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-zinc-900 dark:hover:bg-zinc-800 text-slate-500 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-[#fafafa] transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                                    title={`Mover para ${prevCol.label}`}
                                  >
                                    <ArrowLeft size={13} aria-hidden="true" />
                                  </button>
                                )}
                                {nextCol && (
                                  <button
                                    type="button"
                                    onClick={() => handleMoveTask(task.id, nextCol.id)}
                                    aria-label={`Mover ${task.title} para ${nextCol.label}`}
                                    className={`min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                                      nextCol.id === DONE_STATUS
                                        ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:hover:bg-emerald-950/80'
                                        : 'bg-slate-100 hover:bg-slate-200 dark:bg-zinc-900 dark:hover:bg-zinc-800 text-slate-500 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-[#fafafa]'
                                    }`}
                                    title={`Mover para ${nextCol.label}`}
                                  >
                                    {nextCol.id === DONE_STATUS ? (
                                      <Check size={13} aria-hidden="true" />
                                    ) : (
                                      <ArrowRight size={13} aria-hidden="true" />
                                    )}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </article>
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
              <CheckSquare size={36} aria-hidden="true" className="mx-auto text-slate-300 dark:text-zinc-700" />
              <p className="text-xs font-semibold text-slate-500 dark:text-zinc-400">Nenhuma tarefa encontrada.</p>
              <p className="text-xs text-slate-400 dark:text-zinc-400">
                Tente alterar os filtros ou cadastre uma nova tarefa.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-zinc-800">
              {processedTasks.map((task) => {
                const priorityInfo = PRIORITY_THEMES[task.priority] || PRIORITY_THEMES.Média;
                const dState = dueState(task);
                const dText = dueLabel(task);
                const chkProgress = checklistProgress(task);
                const done = isDone(task);

                return (
                  <div
                    key={task.id}
                    className={`relative [content-visibility:auto] [contain-intrinsic-size:auto_76px] p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/80 dark:hover:bg-zinc-800/40 transition-colors group ${
                      done ? 'opacity-65' : ''
                    }`}
                  >
                    <div className="flex items-start sm:items-center gap-3 flex-1 min-w-0">
                      {/* Checkbox toggle */}
                      <button
                        type="button"
                        onClick={() => handleToggleDone(task)}
                        disabled={!canWrite}
                        aria-label={done ? `Reabrir tarefa ${task.title}` : `Concluir tarefa ${task.title}`}
                        className={`relative z-10 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg transition-colors shrink-0 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                          done
                            ? 'text-emerald-500'
                            : 'text-slate-400 dark:text-zinc-400 hover:text-brand-aa'
                        }`}
                      >
                        {done ? <CheckSquare size={20} aria-hidden="true" /> : <Square size={20} aria-hidden="true" />}
                      </button>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setDrawerTask(task)}
                            className={`text-left text-xs sm:text-sm font-bold truncate rounded after:absolute after:inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                              done
                                ? 'line-through text-slate-400 dark:text-zinc-400'
                                : 'text-slate-900 dark:text-[#fafafa]'
                            }`}
                          >
                            {task.title}
                          </button>

                          <span
                            className={`text-xs font-bold px-2 py-0.5 rounded-full border uppercase ${priorityInfo.badge}`}
                          >
                            {task.priority || 'Média'}
                          </span>

                          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-zinc-900 text-slate-700 dark:text-zinc-300">
                            {task.status}
                          </span>
                        </div>

                        {task.description && (
                          <p className="mt-0.5 text-xs text-slate-500 dark:text-zinc-400 truncate">
                            {task.description}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Metadata & Actions */}
                    <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                      {/* Project */}
                      {task.projectId && projectMap.has(task.projectId) && (
                        <span className="hidden md:inline-flex items-center gap-1 text-xs font-semibold text-brand-aa bg-brand/5 dark:bg-brand/15 px-2 py-0.5 rounded truncate max-w-[160px]">
                          <FolderGit2 size={12} aria-hidden="true" />
                          {projectMap.get(task.projectId)}
                        </span>
                      )}

                      {/* Checklist count */}
                      {chkProgress.total > 0 && (
                        <span className="text-xs font-mono text-slate-500 dark:text-zinc-400 font-semibold flex items-center gap-1 tabular-nums">
                          <CheckSquare size={12} className="text-brand-aa" aria-hidden="true" />
                          <span>
                            {chkProgress.done}/{chkProgress.total}
                          </span>
                        </span>
                      )}

                      {/* Due date */}
                      {dText && (
                        <span
                          className={`font-mono text-xs font-bold px-2 py-0.5 rounded-full tabular-nums ${
                            dState === 'overdue'
                              ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                              : dState === 'today'
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                              : 'bg-slate-100 text-slate-600 dark:bg-zinc-900 dark:text-zinc-400'
                          }`}
                        >
                          {dText}
                        </span>
                      )}

                      {/* Assignee Avatar */}
                      {task.assignee ? (
                        <span
                          className="w-7 h-7 rounded-full bg-brand text-brand-fg flex items-center justify-center font-bold text-xs uppercase shadow-sm"
                          title={`Responsável: ${task.assignee}`}
                        >
                          {initialsOf(task.assignee)}
                        </span>
                      ) : (
                        <span className="w-7 h-7 rounded-full border border-dashed border-slate-300 dark:border-zinc-700 text-slate-400 dark:text-zinc-400 flex items-center justify-center text-xs">
                          --
                        </span>
                      )}

                      {/* Edit / Delete actions */}
                      {canWrite && (
                        <div className="relative z-10 flex items-center gap-1 opacity-80 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={() => handleOpenEditModal(task)}
                            aria-label={`Editar ${task.title}`}
                            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-slate-400 dark:text-zinc-400 hover:text-brand-aa hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                            title="Editar"
                          >
                            <Edit3 size={15} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(deletingTaskId)}
                            onClick={() => handleDeleteTask(task.id)}
                            aria-label={`Excluir ${task.title}`}
                            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-slate-400 dark:text-zinc-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Excluir"
                          >
                            <Trash2 size={15} aria-hidden="true" />
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
          className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm animate-fade-in overscroll-contain"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDrawerTask(null);
          }}
        >
          <div
            ref={drawerRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby={drawerTitleId}
            className="w-full max-w-lg bg-white dark:bg-[#111113] h-full shadow-2xl p-6 overflow-y-auto overscroll-contain space-y-5 border-l border-slate-200 dark:border-zinc-800"
          >
            {/* Drawer Header */}
            <div className="flex items-center justify-between border-b border-slate-200/80 dark:border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs font-bold px-2.5 py-0.5 rounded-full border uppercase ${
                    (PRIORITY_THEMES[drawerTask.priority] || PRIORITY_THEMES.Média).badge
                  }`}
                >
                  {drawerTask.priority || 'Média'}
                </span>
                <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-zinc-900 text-slate-700 dark:text-zinc-300">
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
                    aria-label="Editar em formulário completo"
                    className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-slate-500 dark:text-zinc-400 hover:text-brand-aa hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    title="Editar em formulário completo"
                  >
                    <Edit3 size={16} aria-hidden="true" />
                  </button>
                )}
                <button
                  ref={drawerCloseBtnRef}
                  type="button"
                  onClick={() => setDrawerTask(null)}
                  aria-label="Fechar detalhes da tarefa"
                  className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-slate-400 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-[#fafafa] hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* Title & Description */}
            <div className="space-y-2">
              <h2 id={drawerTitleId} className="text-lg font-extrabold text-slate-900 dark:text-[#fafafa] leading-snug">
                {drawerTask.title}
              </h2>
              {drawerTask.description ? (
                <p className="text-xs text-slate-600 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed bg-slate-50 dark:bg-zinc-900 p-3 rounded-xl border border-slate-200/60 dark:border-zinc-800">
                  {drawerTask.description}
                </p>
              ) : (
                <p className="text-xs text-slate-400 dark:text-zinc-400 italic">Sem descrição detalhada.</p>
              )}
            </div>

            {/* Metadados: Projeto, Responsável, Prazo */}
            <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 dark:bg-zinc-900 p-3.5 rounded-xl border border-slate-200/60 dark:border-zinc-800">
              <div>
                <span className="text-xs font-bold uppercase text-slate-500 dark:text-zinc-400 block mb-0.5">
                  Projeto
                </span>
                <span className="font-semibold text-slate-800 dark:text-zinc-200 truncate block">
                  {drawerTask.projectId && projectMap.has(drawerTask.projectId)
                    ? projectMap.get(drawerTask.projectId)
                    : 'Nenhum projeto vinculado'}
                </span>
              </div>

              <div>
                <span className="text-xs font-bold uppercase text-slate-500 dark:text-zinc-400 block mb-0.5">
                  Responsável
                </span>
                <span className="font-semibold text-slate-800 dark:text-zinc-200 truncate block">
                  {drawerTask.assignee || 'Não atribuído'}
                </span>
              </div>

              <div>
                <span className="text-xs font-bold uppercase text-slate-500 dark:text-zinc-400 block mb-0.5">
                  Prazo de Entrega
                </span>
                <span className="font-semibold text-slate-800 dark:text-zinc-200 block tabular-nums">
                  {drawerTask.dueDate ? formatDateBR(drawerTask.dueDate) : 'Sem prazo'}
                </span>
              </div>

              <div>
                <span className="text-xs font-bold uppercase text-slate-500 dark:text-zinc-400 block mb-0.5">
                  Categoria
                </span>
                <span className="font-semibold text-slate-800 dark:text-zinc-200 block">
                  {drawerTask.category || 'Geral'}
                </span>
              </div>
            </div>

            {/* Checklist Interativo */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-zinc-300 flex items-center gap-1.5">
                  <CheckSquare size={14} className="text-brand-aa" aria-hidden="true" />
                  <span>Subtarefas / Checklist</span>
                </h4>
                <span className="text-xs font-bold text-slate-500 dark:text-zinc-400 font-mono tabular-nums">
                  {checklistProgress(drawerTask).done}/{checklistProgress(drawerTask).total}
                </span>
              </div>

              <div className="space-y-1.5">
                {checklistOf(drawerTask).length === 0 ? (
                  <p className="text-xs text-slate-400 dark:text-zinc-400 italic py-2">
                    Nenhum item de checklist configurado nesta tarefa.
                  </p>
                ) : (
                  checklistOf(drawerTask).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleToggleChecklistItem(drawerTask, item.id)}
                      aria-pressed={Boolean(item.done)}
                      className={`min-h-[44px] w-full text-left p-2.5 rounded-lg border text-xs flex items-center gap-2 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                        item.done
                          ? 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/50 text-slate-500 dark:text-zinc-400 line-through'
                          : 'bg-white dark:bg-zinc-900 border-slate-200 dark:border-zinc-800 text-slate-800 dark:text-zinc-100 hover:border-brand'
                      }`}
                    >
                      <span className={item.done ? 'text-emerald-500' : 'text-slate-400 dark:text-zinc-400'}>
                        {item.done ? <CheckSquare size={15} aria-hidden="true" /> : <Square size={15} aria-hidden="true" />}
                      </span>
                      <span className="flex-1">{item.text}</span>
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Mover Status Rápido no Drawer */}
            {canWrite && (
              <div className="space-y-2 pt-3 border-t border-slate-200/80 dark:border-zinc-800">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 block">
                  Mover para Coluna:
                </span>
                <div className="grid grid-cols-2 gap-2">
                  {TASK_STATUSES.map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => handleMoveTask(drawerTask.id, st)}
                      aria-pressed={drawerTask.status === st}
                      className={`min-h-[44px] py-2 px-3 rounded-xl text-xs font-bold transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                        drawerTask.status === st
                          ? 'bg-slate-900 text-white dark:bg-[#fafafa] dark:text-zinc-900 shadow-sm'
                          : 'border border-slate-200 dark:border-zinc-800 hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-700 dark:text-zinc-300'
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
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in overscroll-contain"
          onClick={(e) => {
            if (e.target === e.currentTarget && !savingModal) setIsModalOpen(false);
          }}
        >
          <div
            ref={modalRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby={modalTitleId}
            className="bg-white dark:bg-[#111113] rounded-2xl shadow-2xl w-full max-w-xl p-6 sm:p-7 space-y-5 border border-slate-200/90 dark:border-zinc-800 max-h-[92vh] overflow-y-auto overscroll-contain animate-zoom-in"
          >
            <div className="flex items-center justify-between border-b border-slate-200/80 dark:border-zinc-800 pb-3">
              <h2 id={modalTitleId} className="text-lg font-extrabold text-slate-900 dark:text-[#fafafa] flex items-center gap-2">
                {modalMode === 'create' ? <Plus size={18} className="text-brand-aa" aria-hidden="true" /> : <Edit3 size={18} className="text-brand-aa" aria-hidden="true" />}
                <span>{modalMode === 'create' ? 'Nova Tarefa Operacional' : 'Editar Tarefa'}</span>
              </h2>
              <button
                type="button"
                disabled={savingModal}
                onClick={() => setIsModalOpen(false)}
                aria-label="Fechar modal"
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-slate-400 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-[#fafafa] hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={handleSaveModal} className="space-y-4">
              <div>
                <label
                  htmlFor="task-title-input"
                  className="block text-xs font-bold text-slate-700 dark:text-zinc-300 mb-1"
                >
                  Título da Tarefa *
                </label>
                <input
                  ref={modalFirstInputRef}
                  id="task-title-input"
                  name="title"
                  type="text"
                  required
                  value={taskForm.title}
                  onChange={(e) => setTaskForm((p) => ({ ...p, title: e.target.value }))}
                  placeholder="Ex.: Instalar switch gerenciável no rack 2"
                  className={`${fieldBaseClass} w-full rounded-xl border-slate-300 px-3.5 py-2 text-xs sm:text-sm text-slate-900`}
                />
              </div>

              <div>
                <label
                  htmlFor="task-description-input"
                  className="block text-xs font-bold text-slate-700 dark:text-zinc-300 mb-1"
                >
                  Descrição e Orientações Técnicas
                </label>
                <textarea
                  id="task-description-input"
                  name="description"
                  rows={3}
                  value={taskForm.description}
                  onChange={(e) => setTaskForm((p) => ({ ...p, description: e.target.value }))}
                  placeholder="Instruções de execução, requisitos, links ou detalhes adicionais…"
                  className={`${fieldBaseClass} w-full rounded-xl border-slate-300 px-3.5 py-2 text-xs sm:text-sm text-slate-900`}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="task-status-select" className="block text-xs font-bold text-slate-700 dark:text-zinc-300 mb-1">
                    Status
                  </label>
                  <select
                    id="task-status-select"
                    name="status"
                    value={taskForm.status}
                    onChange={(e) => setTaskForm((p) => ({ ...p, status: e.target.value }))}
                    className={`${fieldBaseClass} w-full rounded-xl border-slate-300 p-2 text-xs text-slate-800 dark:text-zinc-100 cursor-pointer`}
                  >
                    {TASK_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="task-priority-select" className="block text-xs font-bold text-slate-700 dark:text-zinc-300 mb-1">
                    Prioridade
                  </label>
                  <select
                    id="task-priority-select"
                    name="priority"
                    value={taskForm.priority}
                    onChange={(e) => setTaskForm((p) => ({ ...p, priority: e.target.value }))}
                    className={`${fieldBaseClass} w-full rounded-xl border-slate-300 p-2 text-xs text-slate-800 dark:text-zinc-100 cursor-pointer`}
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
                  <label htmlFor="task-category-select" className="block text-xs font-bold text-slate-700 dark:text-zinc-300 mb-1">
                    Categoria
                  </label>
                  <select
                    id="task-category-select"
                    name="category"
                    value={taskForm.category}
                    onChange={(e) => setTaskForm((p) => ({ ...p, category: e.target.value }))}
                    className={`${fieldBaseClass} w-full rounded-xl border-slate-300 p-2 text-xs text-slate-800 dark:text-zinc-100 cursor-pointer`}
                  >
                    {TASK_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="task-due-date-input" className="block text-xs font-bold text-slate-700 dark:text-zinc-300 mb-1">
                    Prazo de Entrega
                  </label>
                  <input
                    id="task-due-date-input"
                    name="dueDate"
                    type="date"
                    value={taskForm.dueDate}
                    onChange={(e) => setTaskForm((p) => ({ ...p, dueDate: e.target.value }))}
                    className={`${fieldBaseClass} w-full rounded-xl border-slate-300 p-2 text-xs text-slate-800 dark:text-zinc-100 tabular-nums`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="task-assignee-select" className="block text-xs font-bold text-slate-700 dark:text-zinc-300 mb-1">
                    Responsável
                  </label>
                  <select
                    id="task-assignee-select"
                    name="assignee"
                    value={taskForm.assignee}
                    onChange={(e) => setTaskForm((p) => ({ ...p, assignee: e.target.value }))}
                    className={`${fieldBaseClass} w-full rounded-xl border-slate-300 p-2 text-xs text-slate-800 dark:text-zinc-100 cursor-pointer`}
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
                  <label htmlFor="task-project-select" className="block text-xs font-bold text-slate-700 dark:text-zinc-300 mb-1">
                    Vincular a Projeto
                  </label>
                  <select
                    id="task-project-select"
                    name="projectId"
                    value={taskForm.projectId}
                    onChange={(e) => setTaskForm((p) => ({ ...p, projectId: e.target.value }))}
                    className={`${fieldBaseClass} w-full rounded-xl border-slate-300 p-2 text-xs text-slate-800 dark:text-zinc-100 cursor-pointer`}
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
              <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-zinc-800">
                <label htmlFor="task-new-checklist-input" className="block text-xs font-bold text-slate-700 dark:text-zinc-300">
                  Subtarefas (Checklist)
                </label>

                <div className="flex gap-2">
                  <input
                    id="task-new-checklist-input"
                    name="newChecklistText"
                    type="text"
                    value={newChecklistText}
                    onChange={(e) => setNewChecklistText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddChecklistItemModal();
                      }
                    }}
                    placeholder="Adicionar item à checklist…"
                    className={`${fieldBaseClass} flex-1 rounded-xl border-slate-300 px-3 py-2 text-xs text-slate-800 dark:text-zinc-100`}
                  />
                  <button
                    type="button"
                    onClick={handleAddChecklistItemModal}
                    className="min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-zinc-900 hover:bg-slate-200 dark:hover:bg-zinc-800 text-xs font-bold text-slate-700 dark:text-zinc-200 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    + Item
                  </button>
                </div>

                <div className="space-y-1.5 max-h-36 overflow-y-auto">
                  {taskForm.checklist.map((item) => (
                    <div
                      key={item.id}
                      className="p-1.5 rounded-lg bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 text-xs flex items-center justify-between gap-2"
                    >
                      <button
                        type="button"
                        onClick={() => handleToggleChecklistItemModal(item.id)}
                        className="min-h-[44px] px-2 flex items-center gap-2 flex-1 text-left rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                      >
                        <span className={item.done ? 'text-emerald-500' : 'text-slate-400 dark:text-zinc-400'}>
                          {item.done ? <CheckSquare size={14} aria-hidden="true" /> : <Square size={14} aria-hidden="true" />}
                        </span>
                        <span
                          className={
                            item.done
                              ? 'line-through text-slate-400 dark:text-zinc-400'
                              : 'text-slate-800 dark:text-zinc-200'
                          }
                        >
                          {item.text}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveChecklistItemModal(item.id)}
                        aria-label={`Remover item ${item.text}`}
                        className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-md text-slate-400 dark:text-zinc-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-3 border-t border-slate-200/80 dark:border-zinc-800">
                <button
                  type="button"
                  disabled={savingModal}
                  onClick={() => setIsModalOpen(false)}
                  className="min-h-[44px] flex-1 py-2.5 rounded-xl border border-slate-300 dark:border-zinc-800 text-xs font-bold text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingModal}
                  className="min-h-[44px] flex-1 py-2.5 rounded-xl bg-brand hover:bg-brand-dark text-brand-fg text-xs font-bold uppercase tracking-wider transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  {savingModal ? <RefreshCcw size={14} aria-hidden="true" className="animate-spin" /> : <Save size={14} aria-hidden="true" />}
                  <span>{savingModal ? 'Salvando…' : 'Salvar Tarefa'}</span>
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
