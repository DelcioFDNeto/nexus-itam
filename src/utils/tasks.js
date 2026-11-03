// src/utils/tasks.js
// -----------------------------------------------------------------------------
// Regras puras do modulo de tarefas (sem React, sem Firestore) para que o
// quadro, a lista e os indicadores usem exatamente a mesma logica.
//
// Modelo do documento /tasks/{id} (todos os campos alem de title/status/tenantId
// sao opcionais, para manter compatibilidade com tarefas antigas e importadas):
//   title, description, status, priority, category, dueDate ("AAAA-MM-DD"),
//   assignee (nome), projectId, checklist [{ id, text, done }], completedAt
// -----------------------------------------------------------------------------
import { toLocalDate } from './dates';

export const TASK_COLUMNS = [
  { id: 'A Fazer', label: 'A fazer', accent: 'slate' },
  { id: 'Em Andamento', label: 'Em andamento', accent: 'blue' },
  { id: 'Revisão', label: 'Em revisão', accent: 'violet' },
  { id: 'Concluído', label: 'Concluído', accent: 'emerald' },
];

export const TASK_STATUSES = TASK_COLUMNS.map((c) => c.id);

export const TASK_PRIORITIES = ['Crítica', 'Alta', 'Média', 'Baixa'];

const PRIORITY_WEIGHT = { 'Crítica': 0, 'Alta': 1, 'Média': 2, 'Baixa': 3 };

export const TASK_CATEGORIES = [
  'Geral',
  'Suporte',
  'Manutenção',
  'Inventário',
  'Auditoria',
  'Infraestrutura',
];

export const DONE_STATUS = 'Concluído';

export const isDone = (task) => task?.status === DONE_STATUS;

/**
 * Coluna do quadro em que a tarefa aparece. Status fora do fluxo (ex.:
 * "Planejamento" ou "Pausado", vindos do importador) caem em "A Fazer" para
 * nunca sumirem do quadro.
 */
export const columnOf = (status) => (TASK_STATUSES.includes(status) ? status : 'A Fazer');

/** Status original que nao corresponde a uma coluna (exibido como etiqueta). */
export const offFlowStatus = (status) =>
  status && !TASK_STATUSES.includes(status) && status !== 'Planejamento' ? status : null;

export const priorityWeight = (priority) => PRIORITY_WEIGHT[priority] ?? PRIORITY_WEIGHT['Média'];

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

/**
 * Situacao do prazo: 'none' (sem prazo ou concluida), 'overdue', 'today',
 * 'soon' (ate 2 dias) ou 'later'.
 */
export const dueState = (task, now = new Date()) => {
  if (!task?.dueDate || isDone(task)) return 'none';
  const due = toLocalDate(task.dueDate);
  if (!due) return 'none';
  const diffDays = Math.round((startOfDay(due) - startOfDay(now)) / 86400000);
  if (diffDays < 0) return 'overdue';
  if (diffDays === 0) return 'today';
  if (diffDays <= 2) return 'soon';
  return 'later';
};

/** Texto curto do prazo ("Atrasada 3d", "Hoje", "Amanhã", "12/11"). */
export const dueLabel = (task, now = new Date()) => {
  const due = toLocalDate(task?.dueDate);
  if (!due) return '';
  const diffDays = Math.round((startOfDay(due) - startOfDay(now)) / 86400000);
  if (!isDone(task)) {
    if (diffDays < 0) return `Atrasada ${Math.abs(diffDays)}d`;
    if (diffDays === 0) return 'Hoje';
    if (diffDays === 1) return 'Amanhã';
  }
  return due.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};

export const checklistOf = (task) => (Array.isArray(task?.checklist) ? task.checklist : []);

export const checklistProgress = (task) => {
  const items = checklistOf(task);
  return { done: items.filter((i) => i.done).length, total: items.length };
};

export const createChecklistItem = (text) => ({
  id: `chk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
  text: String(text || '').trim(),
  done: false,
});

export const initialsOf = (name) => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
};

const normalize = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

export const EMPTY_FILTERS = {
  search: '',
  priority: '',
  assignee: '',
  projectId: '',
  onlyOverdue: false,
};

export const hasActiveFilters = (filters) =>
  Boolean(
    filters.search?.trim() ||
      filters.priority ||
      filters.assignee ||
      filters.projectId ||
      filters.onlyOverdue,
  );

/** Aplica busca textual (sem acentos) e filtros. */
export const filterTasks = (tasks, filters = EMPTY_FILTERS, now = new Date()) => {
  const term = normalize(filters.search).trim();
  return tasks.filter((task) => {
    if (filters.priority && (task.priority || 'Média') !== filters.priority) return false;
    if (filters.assignee) {
      if (filters.assignee === '__none__' ? task.assignee : task.assignee !== filters.assignee) {
        return false;
      }
    }
    if (filters.projectId && task.projectId !== filters.projectId) return false;
    if (filters.onlyOverdue && dueState(task, now) !== 'overdue') return false;
    if (term) {
      const haystack = normalize(
        [task.title, task.description, task.assignee, task.category].filter(Boolean).join(' '),
      );
      if (!haystack.includes(term)) return false;
    }
    return true;
  });
};

const createdMillis = (task) => toLocalDate(task?.createdAt)?.getTime() || 0;
const dueMillis = (task) => toLocalDate(task?.dueDate)?.getTime() ?? Number.POSITIVE_INFINITY;

/**
 * Ordenacao: 'smart' (prioridade, depois prazo, depois mais recente),
 * 'due' (prazo mais proximo primeiro), 'recent' (criadas por ultimo primeiro).
 */
export const sortTasks = (tasks, sortBy = 'smart') => {
  const list = [...tasks];
  if (sortBy === 'recent') return list.sort((a, b) => createdMillis(b) - createdMillis(a));
  if (sortBy === 'due') {
    return list.sort((a, b) => dueMillis(a) - dueMillis(b) || createdMillis(b) - createdMillis(a));
  }
  return list.sort(
    (a, b) =>
      priorityWeight(a.priority) - priorityWeight(b.priority) ||
      dueMillis(a) - dueMillis(b) ||
      createdMillis(b) - createdMillis(a),
  );
};

/** Indicadores do topo, calculados apenas a partir das tarefas reais. */
export const summarizeTasks = (tasks, now = new Date()) => {
  const summary = { open: 0, inProgress: 0, overdue: 0, dueToday: 0, done: 0 };
  tasks.forEach((task) => {
    if (isDone(task)) {
      summary.done += 1;
      return;
    }
    summary.open += 1;
    if (task.status === 'Em Andamento' || task.status === 'Revisão') summary.inProgress += 1;
    const state = dueState(task, now);
    if (state === 'overdue') summary.overdue += 1;
    if (state === 'today') summary.dueToday += 1;
  });
  return summary;
};

/** Campos a gravar ao mudar o status (registra quando a tarefa foi concluida). */
export const statusPatch = (newStatus, now = new Date()) => ({
  status: newStatus,
  completedAt: newStatus === DONE_STATUS ? now.toISOString() : null,
});

/** Limpa o rascunho do formulario antes de gravar. */
export const sanitizeTaskDraft = (draft) => ({
  title: String(draft.title || '').trim(),
  description: String(draft.description || '').trim(),
  // Status fora do fluxo (ex.: "Pausado" importado) e preservado ate o usuario trocar.
  status: draft.status || 'A Fazer',
  priority: TASK_PRIORITIES.includes(draft.priority) ? draft.priority : 'Média',
  category: draft.category || 'Geral',
  dueDate: draft.dueDate || '',
  assignee: String(draft.assignee || '').trim(),
  projectId: draft.projectId || '',
  checklist: checklistOf(draft)
    .map((item) => ({ id: item.id, text: String(item.text || '').trim(), done: Boolean(item.done) }))
    .filter((item) => item.text),
});
