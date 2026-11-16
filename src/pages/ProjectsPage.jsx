// src/pages/ProjectsPage.jsx
import React, { useState, useEffect, useCallback, useMemo, useId, useRef } from 'react';
import { getProjects, createProject, deleteProject } from '../services/projectService';
import { getEmployees } from '../services/employeeService';
import {
  FolderGit2, Plus, Calendar, Trash2, LayoutGrid, Kanban, ListFilter,
  RefreshCcw, X, Search, CheckCircle2, Clock, AlertCircle,
  TrendingUp, DollarSign, ChevronRight, Sparkles,
  Layers
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { can } from '../utils/permissions';
import { useConfirm } from '../components/ConfirmDialog';
import { endOfLocalDay, formatDateBR } from '../utils/dates';
import { toast } from 'sonner';
import { parseBRL, formatBRL } from '../utils/currency';
import { safeImageUrl } from '../utils/sanitize';
import { captureFocusTarget, restoreFocusSafely, trapFocusWithin } from '../utils/focusTrap';
import { isTopmostModal } from '../utils/modalStack';

const modalFieldClass =
  'w-full px-3.5 py-2.5 min-h-[44px] border border-slate-200 dark:border-zinc-700 bg-white dark:bg-[#111113] text-slate-900 dark:text-[#fafafa] placeholder:text-slate-400 dark:placeholder:text-zinc-500 rounded-xl transition-colors hover:border-slate-300 dark:hover:border-zinc-600 active:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:border-brand disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-zinc-900 aria-[invalid=true]:border-rose-500 aria-[invalid=true]:focus-visible:ring-rose-500';

const initialForm = {
  name: '',
  description: '',
  status: 'Planejamento',
  priority: 'Média',
  leader: '',
  deadline: '',
  version: '1.0',
  budget: '',
  coverImage: '',
  team: []
};

// Badges de prioridade com semântica visual precisa
const getPriorityBadge = (priority) => {
  switch (priority) {
    case 'Crítica':
      return {
        label: 'Crítica',
        bg: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900/60',
        dot: 'bg-rose-500'
      };
    case 'Alta':
      return {
        label: 'Alta',
        bg: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/60',
        dot: 'bg-amber-500'
      };
    case 'Baixa':
      return {
        label: 'Baixa',
        bg: 'bg-slate-50 text-slate-700 border-slate-200 dark:bg-zinc-900 dark:text-zinc-300 dark:border-zinc-700',
        dot: 'bg-slate-400'
      };
    case 'Média':
    default:
      return {
        label: 'Média',
        bg: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900/60',
        dot: 'bg-sky-500'
      };
  }
};

const getStatusBadge = (status) => {
  switch (status) {
    case 'Em Andamento':
    case 'Revisão':
      return 'bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300 border-sky-200 dark:border-sky-800';
    case 'Concluído':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
    case 'Pausado':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 border-amber-200 dark:border-amber-800';
    case 'Planejamento':
    default:
      return 'bg-slate-100 text-slate-700 dark:bg-zinc-800 dark:text-zinc-300 border-slate-200 dark:border-zinc-700';
  }
};

// Card de projeto na visualização Grid/Kanban (sem div onClick: Link esticado semântico)
const ProjectCard = ({ project, onDelete, canWrite, deletingId }) => {
  const projectInitials = (project.name || 'P').substring(0, 2).toUpperCase();
  const priorityInfo = getPriorityBadge(project.priority);
  const deadlineEnd = project.deadline ? endOfLocalDay(project.deadline) : null;
  const isDelayed = Boolean(deadlineEnd) && deadlineEnd < new Date() && project.status !== 'Concluído';
  const safeCover = safeImageUrl(project.coverImage);

  return (
    <article className="bg-white dark:bg-[#111113] rounded-2xl p-5 border border-slate-200/80 dark:border-zinc-800 shadow-sm hover:border-brand/40 hover:shadow-md transition-colors group flex flex-col h-full relative [content-visibility:auto] [contain-intrinsic-size:auto_120px]">
      <div className="flex justify-between items-start mb-3 gap-2">
        <div className="flex gap-3 min-w-0">
          {safeCover ? (
            <img
              src={safeCover}
              alt=""
              className="w-11 h-11 rounded-xl object-cover shadow-sm bg-slate-100 dark:bg-zinc-800 shrink-0"
            />
          ) : (
            <div className="w-11 h-11 rounded-xl bg-brand text-brand-fg flex items-center justify-center font-black text-sm uppercase shadow-sm shrink-0">
              {projectInitials}
            </div>
          )}
          <div className="min-w-0">
            <h3 className="font-bold text-slate-900 dark:text-[#fafafa] leading-tight truncate">
              <Link
                to={`/projects/${project.id}`}
                className="group-hover:text-brand-aa transition-colors after:absolute after:inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded"
              >
                {project.name}
              </Link>
            </h3>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <span className="text-xs text-slate-600 dark:text-zinc-300 font-mono font-bold bg-slate-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded tabular-nums">
                v{project.version || '1.0'}
              </span>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold border ${priorityInfo.bg}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${priorityInfo.dot}`} aria-hidden="true" />
                {priorityInfo.label}
              </span>
            </div>
          </div>
        </div>

        <span className={`px-2.5 py-1 rounded-lg text-xs font-black uppercase tracking-wide border shrink-0 ${getStatusBadge(project.status)}`}>
          {project.status || 'Planejamento'}
        </span>
      </div>

      <p className="text-xs text-slate-600 dark:text-zinc-300 leading-relaxed line-clamp-2 mb-4 flex-1">
        {project.description || 'Sem descrição cadastrada para esta iniciativa.'}
      </p>

      {/* Orçamento e Metas */}
      {parseBRL(project.budget) > 0 && (
        <div className="mb-3 px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-zinc-900/60 border border-slate-100 dark:border-zinc-800 flex items-center justify-between text-xs">
          <span className="text-xs uppercase font-bold text-slate-500 dark:text-zinc-400 flex items-center gap-1">
            <DollarSign size={13} className="text-emerald-500" aria-hidden="true" /> Orçamento
          </span>
          <span className="font-mono font-bold text-slate-800 dark:text-zinc-200 tabular-nums">
            {formatBRL(project.budget)}
          </span>
        </div>
      )}

      <div className="mt-auto space-y-3">
        {/* Barra de Progresso */}
        <div>
          <div className="flex justify-between text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-1">
            <span>Progresso da Entrega</span>
            <span className="text-slate-700 dark:text-zinc-200 tabular-nums">{project.progress || 0}%</span>
          </div>
          <div className="w-full bg-slate-100 dark:bg-zinc-800 rounded-full h-2 overflow-hidden p-0.5">
            <div
              className={`h-full rounded-full transition-colors ${
                project.status === 'Concluído'
                  ? 'bg-emerald-500'
                  : 'bg-brand'
              }`}
              style={{ width: `${project.progress || 0}%` }}
            />
          </div>
        </div>

        {/* Rodapé do Card */}
        <div className="pt-3 border-t border-slate-100 dark:border-zinc-800 flex justify-between items-center gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex -space-x-2">
              {(project.team || []).length > 0 ? (
                project.team.slice(0, 3).map((memberName, i) => (
                  <div
                    key={i}
                    title={memberName}
                    className="w-7 h-7 rounded-full bg-brand/10 dark:bg-brand/20 border-2 border-white dark:border-[#111113] flex items-center justify-center text-xs font-black text-brand-aa uppercase shadow-sm"
                  >
                    {memberName.substring(0, 2)}
                  </div>
                ))
              ) : project.leader ? (
                <div
                  title={`Líder: ${project.leader}`}
                  className="w-7 h-7 rounded-full bg-brand/10 dark:bg-brand/20 border-2 border-white dark:border-[#111113] flex items-center justify-center text-xs font-black text-brand-aa uppercase shadow-sm"
                >
                  {project.leader.substring(0, 2)}
                </div>
              ) : (
                <div title="Sem Equipe" className="w-7 h-7 rounded-full bg-slate-100 dark:bg-zinc-800 border-2 border-white dark:border-[#111113] flex items-center justify-center text-xs font-bold text-slate-400">
                  --
                </div>
              )}
              {(project.team || []).length > 3 && (
                <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-zinc-800 border-2 border-white dark:border-[#111113] flex items-center justify-center text-xs font-bold text-slate-700 dark:text-zinc-300 tabular-nums">
                  +{project.team.length - 3}
                </div>
              )}
            </div>
            {project.leader && (
              <span className="text-xs text-slate-600 dark:text-zinc-400 font-medium truncate max-w-[100px]">
                {project.leader.split(' ')[0]}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 relative z-10 shrink-0">
            <span className={`text-xs font-bold flex items-center gap-1 tabular-nums ${
              isDelayed
                ? 'text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 px-2 py-0.5 rounded'
                : project.deadline
                  ? 'text-slate-600 dark:text-zinc-300'
                  : 'text-slate-400 dark:text-zinc-500'
            }`}>
              <Calendar size={13} aria-hidden="true" /> {project.deadline ? formatDateBR(project.deadline) : 'S/ Prazo'}
            </span>
            {canWrite && (
              <button
                type="button"
                disabled={Boolean(deletingId)}
                onClick={(e) => onDelete(project.id, e)}
                title="Excluir projeto"
                aria-label={`Excluir projeto ${project.name}`}
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-slate-400 dark:text-zinc-500 hover:text-rose-600 dark:hover:text-rose-400 transition-colors rounded-xl hover:bg-rose-50 dark:hover:bg-rose-950/30 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
};

const ProjectsPage = () => {
  const { currentUser } = useAuth();
  const confirm = useConfirm();
  const tenantId = currentUser?.tenantId;
  const canWrite = can(currentUser, 'projects:write');

  const [projects, setProjects] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'kanban' | 'table'
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState(initialForm);

  const modalTitleId = useId();
  const modalRef = useRef(null);
  const firstInputRef = useRef(null);
  const previousFocusRef = useRef(null);
  const savingRef = useRef(saving);
  savingRef.current = saving;
  const isMountedRef = useRef(true);
  const loadSeqRef = useRef(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Filtros de busca e categorização
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('Todos');
  const [priorityFilter, setPriorityFilter] = useState('Todas');

  useEffect(() => {
    if (!isModalOpen) return undefined;
    const container = modalRef.current;
    previousFocusRef.current = captureFocusTarget(container);
    const frameId = requestAnimationFrame(() => firstInputRef.current?.focus());
    const handleKeyDown = (e) => {
      if (!isTopmostModal(container)) return;
      if (e.key === 'Escape') {
        if (savingRef.current) return;
        e.stopPropagation();
        setIsModalOpen(false);
        return;
      }
      if (e.key === 'Tab') {
        trapFocusWithin(e, container);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('keydown', handleKeyDown);
      const previous = previousFocusRef.current;
      previousFocusRef.current = null;
      restoreFocusSafely(previous, null, container);
    };
  }, [isModalOpen]);

  const loadProjects = useCallback(async ({ isCancelled } = {}) => {
    const seq = ++loadSeqRef.current;
    const stale = () => !isMountedRef.current || seq !== loadSeqRef.current || Boolean(isCancelled?.());

    if (!tenantId) {
      if (!stale()) {
        setProjects([]);
        setEmployees([]);
        setLoading(false);
      }
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const [pRes, eRes] = await Promise.allSettled([getProjects(tenantId), getEmployees(tenantId)]);
      if (stale()) return;
      if (pRes.status === 'fulfilled') {
        setProjects(pRes.value || []);
      } else {
        setProjects([]);
        setLoadError('Não foi possível carregar o portfólio de projetos.');
      }
      setEmployees(eRes.status === 'fulfilled' ? eRes.value || [] : []);
    } catch (error) {
      console.error('Erro ao carregar projetos:', error);
      if (stale()) return;
      setLoadError('Erro ao carregar projetos.');
      toast.error('Erro ao carregar projetos.');
    } finally {
      if (!stale()) {
        setLoading(false);
      }
    }
  }, [tenantId]);

  useEffect(() => {
    let cancelled = false;
    loadProjects({ isCancelled: () => cancelled });
    return () => {
      cancelled = true;
    };
  }, [loadProjects]);

  // Métricas executivas consolidadas
  const stats = useMemo(() => {
    const total = projects.length;
    const inProgress = projects.filter(p => p.status === 'Em Andamento' || p.status === 'Revisão').length;
    const completed = projects.filter(p => p.status === 'Concluído').length;
    const planning = projects.filter(p => p.status === 'Planejamento' || p.status === 'Pausado').length;
    const avgProg = total > 0 
      ? Math.round(projects.reduce((acc, p) => acc + (Number(p.progress) || 0), 0) / total)
      : 0;
    const totalBudget = projects.reduce((acc, p) => acc + parseBRL(p.budget), 0);

    return { total, inProgress, completed, planning, avgProg, totalBudget };
  }, [projects]);

  // Filtragem reativa
  const filteredProjects = useMemo(() => {
    return projects.filter(p => {
      const q = searchTerm.toLowerCase().trim();
      const matchSearch = !q || 
        (p.name || '').toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q) ||
        (p.leader || '').toLowerCase().includes(q) ||
        (p.version || '').toLowerCase().includes(q) ||
        (p.team || []).some(m => String(m).toLowerCase().includes(q));

      const matchStatus = statusFilter === 'Todos' || p.status === statusFilter;
      const matchPriority = priorityFilter === 'Todas' || p.priority === priorityFilter;

      return matchSearch && matchStatus && matchPriority;
    });
  }, [projects, searchTerm, statusFilter, priorityFilter]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (saving) return;
    if (!tenantId) {
      toast.error('Sem contexto de tenant.');
      return;
    }
    const rawCover = formData.coverImage.trim();
    if (rawCover && !safeImageUrl(rawCover)) {
      toast.error('URL da imagem de capa inválida.');
      return;
    }
    setSaving(true);
    try {
      const enrichedData = {
        name: formData.name.trim(),
        description: formData.description.trim(),
        status: formData.status || 'Planejamento',
        priority: formData.priority || 'Média',
        leader: formData.leader || '',
        budget: formData.budget ? parseBRL(formData.budget) : '',
        deadline: formData.deadline || '',
        version: formData.version.trim() || '1.0',
        team: formData.team || [],
        coverImage: rawCover || '',
        tenantId,
        changelog: [`v${formData.version.trim() || '1.0'}: Projeto iniciado. (${new Date().toLocaleDateString('pt-BR')})`],
        progress: 0
      };
      await createProject(enrichedData);
      if (!isMountedRef.current) return;
      setFormData(initialForm);
      setIsModalOpen(false);
      toast.success('Projeto criado com sucesso.');
      await loadProjects();
    } catch (err) {
      console.error(err);
      if (isMountedRef.current) toast.error('Erro ao criar projeto.');
    } finally {
      if (isMountedRef.current) setSaving(false);
    }
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (deletingId || saving) return;
    const confirmed = await confirm({
      title: 'Excluir Projeto',
      message: 'Tem certeza que deseja apagar este projeto e desvincular suas tarefas? Esta ação não pode ser desfeita.',
      danger: true,
      confirmLabel: 'Excluir Projeto'
    });
    if (!confirmed || !isMountedRef.current) return;

    setDeletingId(id);
    try {
      await deleteProject(id, tenantId);
      if (!isMountedRef.current) return;
      toast.success('Projeto excluído com sucesso.');
      await loadProjects();
    } catch (err) {
      console.error(err);
      if (isMountedRef.current) toast.error('Erro ao excluir projeto.');
    } finally {
      if (isMountedRef.current) setDeletingId(null);
    }
  };

  const KANBAN_COLUMNS = [
    {
      id: 'Planejamento',
      label: 'Planejamento & Backlog',
      filter: (p) => p.status === 'Planejamento' || p.status === 'Pausado',
      headerBg: 'bg-slate-100 dark:bg-zinc-900 text-slate-700 dark:text-zinc-200 border-slate-200 dark:border-zinc-800'
    },
    {
      id: 'Em Andamento',
      label: 'Em Execução & Revisão',
      filter: (p) => p.status === 'Em Andamento' || p.status === 'Revisão',
      headerBg: 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-900/60'
    },
    {
      id: 'Concluído',
      label: 'Entregues & Concluídos',
      filter: (p) => p.status === 'Concluído',
      headerBg: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900/60'
    }
  ];

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto pb-24 space-y-8 min-h-screen animate-fade-in">

      {/* Faixa superior com o título, KPIs e controles */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand/10 text-brand-aa text-xs font-black uppercase tracking-wider mb-2">
            <Sparkles size={14} aria-hidden="true" /> Portfólio de Iniciativas &amp; Entregas
          </div>
          <h1 className="text-3xl font-black text-slate-900 dark:text-[#fafafa] flex items-center gap-3 tracking-tight">
            <FolderGit2 className="text-brand-aa" size={32} aria-hidden="true" /> Central de Projetos
          </h1>
          <p className="text-slate-500 dark:text-zinc-400 mt-1 text-sm">
            Planejamento estratégico, acompanhamento de marcos, orçamento alocado e sprints operacionais.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Seletor de visualizações */}
          <div className="flex items-center bg-white dark:bg-[#111113] p-1 rounded-2xl border border-slate-200 dark:border-zinc-800 shadow-sm">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              aria-pressed={viewMode === 'grid'}
              title="Visualização em Grade"
              className={`px-3 min-h-[44px] rounded-xl font-bold text-xs flex items-center gap-1.5 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                viewMode === 'grid'
                  ? 'bg-slate-900 text-white dark:bg-brand dark:text-brand-fg shadow-sm'
                  : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-[#fafafa]'
              }`}
            >
              <LayoutGrid size={18} aria-hidden="true" />
              <span className="hidden sm:inline">Grade</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('kanban')}
              aria-pressed={viewMode === 'kanban'}
              title="Visualização em Kanban"
              className={`px-3 min-h-[44px] rounded-xl font-bold text-xs flex items-center gap-1.5 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                viewMode === 'kanban'
                  ? 'bg-slate-900 text-white dark:bg-brand dark:text-brand-fg shadow-sm'
                  : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-[#fafafa]'
              }`}
            >
              <Kanban size={18} aria-hidden="true" />
              <span className="hidden sm:inline">Quadro</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('table')}
              aria-pressed={viewMode === 'table'}
              title="Visualização em Tabela"
              className={`px-3 min-h-[44px] rounded-xl font-bold text-xs flex items-center gap-1.5 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                viewMode === 'table'
                  ? 'bg-slate-900 text-white dark:bg-brand dark:text-brand-fg shadow-sm'
                  : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-[#fafafa]'
              }`}
            >
              <ListFilter size={18} aria-hidden="true" />
              <span className="hidden sm:inline">Tabela</span>
            </button>
          </div>

          {canWrite && (
            <button
              type="button"
              onClick={() => { setFormData(initialForm); setIsModalOpen(true); }}
              className="bg-brand hover:bg-brand-dark text-brand-fg px-5 min-h-[44px] rounded-2xl font-bold flex items-center gap-2 text-sm shadow-sm active:scale-[0.98] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <Plus size={18} aria-hidden="true" /> Novo Projeto
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards Bar */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="bg-white dark:bg-[#111113] p-4 rounded-2xl border border-slate-200/80 dark:border-zinc-800 shadow-sm flex flex-col justify-between">
          <span className="text-xs font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
            <Layers size={14} className="text-brand-aa" aria-hidden="true" /> Total Iniciativas
          </span>
          <p className="text-2xl font-black text-slate-900 dark:text-[#fafafa] mt-2 tabular-nums">{stats.total}</p>
          <span className="text-xs text-slate-500 dark:text-zinc-400 mt-1">Portfólio cadastrado</span>
        </div>

        <div className="bg-white dark:bg-[#111113] p-4 rounded-2xl border border-slate-200/80 dark:border-zinc-800 shadow-sm flex flex-col justify-between">
          <span className="text-xs font-bold text-sky-700 dark:text-sky-400 uppercase tracking-wider flex items-center gap-1.5">
            <Clock size={14} aria-hidden="true" /> Em Execução
          </span>
          <p className="text-2xl font-black text-sky-700 dark:text-sky-400 mt-2 tabular-nums">{stats.inProgress}</p>
          <span className="text-xs text-slate-500 dark:text-zinc-400 mt-1">Sprints ativas</span>
        </div>

        <div className="bg-white dark:bg-[#111113] p-4 rounded-2xl border border-slate-200/80 dark:border-zinc-800 shadow-sm flex flex-col justify-between">
          <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
            <CheckCircle2 size={14} aria-hidden="true" /> Concluídos
          </span>
          <p className="text-2xl font-black text-emerald-700 dark:text-emerald-400 mt-2 tabular-nums">{stats.completed}</p>
          <span className="text-xs text-slate-500 dark:text-zinc-400 mt-1">Entregas homologadas</span>
        </div>

        <div className="bg-white dark:bg-[#111113] p-4 rounded-2xl border border-slate-200/80 dark:border-zinc-800 shadow-sm flex flex-col justify-between">
          <span className="text-xs font-bold text-slate-600 dark:text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
            <Calendar size={14} aria-hidden="true" /> Planejamento
          </span>
          <p className="text-2xl font-black text-slate-800 dark:text-zinc-200 mt-2 tabular-nums">{stats.planning}</p>
          <span className="text-xs text-slate-500 dark:text-zinc-400 mt-1">Fase preparatória</span>
        </div>

        <div className="bg-white dark:bg-[#111113] p-4 rounded-2xl border border-slate-200/80 dark:border-zinc-800 shadow-sm flex flex-col justify-between">
          <span className="text-xs font-bold text-sky-700 dark:text-sky-400 uppercase tracking-wider flex items-center gap-1.5">
            <TrendingUp size={14} aria-hidden="true" /> Progresso Médio
          </span>
          <p className="text-2xl font-black text-sky-700 dark:text-sky-400 mt-2 tabular-nums">{stats.avgProg}%</p>
          <div className="w-full bg-slate-100 dark:bg-zinc-800 h-1.5 rounded-full mt-1.5 overflow-hidden">
            <div className="h-full bg-brand rounded-full" style={{ width: `${stats.avgProg}%` }} />
          </div>
        </div>

        <div className="bg-white dark:bg-[#111113] p-4 rounded-2xl border border-slate-200/80 dark:border-zinc-800 shadow-sm flex flex-col justify-between">
          <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
            <DollarSign size={14} aria-hidden="true" /> Orçamento Total
          </span>
          <p className="text-lg font-black text-slate-900 dark:text-[#fafafa] mt-2 truncate tabular-nums" title={formatBRL(stats.totalBudget)}>
            {formatBRL(stats.totalBudget)}
          </p>
          <span className="text-xs text-slate-500 dark:text-zinc-400 mt-1">Investimento previsto</span>
        </div>
      </div>

      {/* Barra de Filtros e Busca em Tempo Real */}
      <div className="bg-white dark:bg-[#111113] p-4 rounded-2xl border border-slate-200/80 dark:border-zinc-800 shadow-sm flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        {/* Campo de Busca */}
        <div className="relative flex-1">
          <label htmlFor="projects-search" className="sr-only">Buscar projetos</label>
          <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            id="projects-search"
            name="projects-search"
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Buscar por nome do projeto, líder, versão, membro da equipe…"
            className="w-full pl-10 pr-11 min-h-[44px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50/50 dark:bg-[#111113] text-slate-900 dark:text-[#fafafa] placeholder:text-slate-400 dark:placeholder:text-zinc-500 text-sm transition-colors hover:border-slate-300 dark:hover:border-zinc-600 active:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:border-brand disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-zinc-900 aria-[invalid=true]:border-rose-500 aria-[invalid=true]:focus-visible:ring-rose-500"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              aria-label="Limpar busca"
              className="absolute right-1 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-[#fafafa] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Filtros de Status e Prioridade */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1 bg-slate-100 dark:bg-zinc-900 p-1 rounded-xl text-xs font-bold text-slate-600 dark:text-zinc-300">
            {['Todos', 'Em Andamento', 'Planejamento', 'Concluído'].map(st => (
              <button
                key={st}
                type="button"
                aria-pressed={statusFilter === st}
                onClick={() => setStatusFilter(st)}
                className={`px-3 min-h-[44px] rounded-lg transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                  statusFilter === st
                    ? 'bg-white dark:bg-[#111113] text-slate-900 dark:text-[#fafafa] shadow-sm'
                    : 'hover:text-slate-900 dark:hover:text-[#fafafa]'
                }`}
              >
                {st}
              </button>
            ))}
          </div>

          <label htmlFor="projects-priority-filter" className="sr-only">Filtrar por prioridade</label>
          <select
            id="projects-priority-filter"
            name="projects-priority-filter"
            value={priorityFilter}
            onChange={e => setPriorityFilter(e.target.value)}
            className="px-3 min-h-[44px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-[#111113] text-slate-700 dark:text-zinc-200 text-xs font-bold cursor-pointer transition-colors hover:border-slate-300 dark:hover:border-zinc-600 active:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:border-brand disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-zinc-900 aria-[invalid=true]:border-rose-500 aria-[invalid=true]:focus-visible:ring-rose-500"
          >
            <option value="Todas">Prioridade: Todas</option>
            <option value="Crítica">Crítica</option>
            <option value="Alta">Alta</option>
            <option value="Média">Média</option>
            <option value="Baixa">Baixa</option>
          </select>

          {(searchTerm || statusFilter !== 'Todos' || priorityFilter !== 'Todas') && (
            <button
              type="button"
              onClick={() => { setSearchTerm(''); setStatusFilter('Todos'); setPriorityFilter('Todas'); }}
              className="px-3 min-h-[44px] text-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-xl transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
            >
              Limpar Filtros
            </button>
          )}
        </div>
      </div>

      {loadError ? (
        <div role="alert" className="rounded-2xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertCircle size={22} className="text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <h2 className="text-base font-bold text-rose-900 dark:text-rose-200">Erro ao carregar projetos</h2>
              <p className="text-xs text-rose-700 dark:text-rose-300 mt-1">{loadError}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={loadProjects}
            className="inline-flex items-center justify-center gap-2 px-4 min-h-[44px] rounded-xl bg-white dark:bg-[#111113] border border-rose-200 dark:border-rose-800 text-xs font-bold text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-950/60 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 shrink-0"
          >
            <RefreshCcw size={15} aria-hidden="true" /> Tentar novamente
          </button>
        </div>
      ) : loading ? (
        <div role="status" className="flex flex-col items-center justify-center h-64 text-slate-500 dark:text-zinc-400">
          <RefreshCcw size={32} className="animate-spin text-brand-aa mb-3" aria-hidden="true" />
          <p className="text-sm font-bold">Carregando portfólio de projetos…</p>
        </div>
      ) : (
        <>
          {/* VISUALIZAÇÃO EM GRADE */}
          {viewMode === 'grid' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {filteredProjects.map(project => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onDelete={handleDelete}
                  canWrite={canWrite}
                  deletingId={deletingId}
                />
              ))}
              {filteredProjects.length === 0 && (
                <div className="col-span-full text-center py-20 text-slate-500 dark:text-zinc-400 border-2 border-dashed border-slate-200 dark:border-zinc-800 rounded-2xl bg-white/50 dark:bg-[#111113]/50">
                  <FolderGit2 size={48} className="mx-auto mb-3 opacity-30 text-brand-aa" aria-hidden="true" />
                  <p className="font-bold text-slate-700 dark:text-zinc-200">Nenhum projeto encontrado</p>
                  <p className="text-xs mt-1 text-slate-500 dark:text-zinc-400">
                    {searchTerm || statusFilter !== 'Todos' || priorityFilter !== 'Todas'
                      ? 'Tente ajustar os filtros ou a busca acima.'
                      : canWrite ? 'Clique em "Novo Projeto" para iniciar sua primeira iniciativa.' : 'Nenhum projeto cadastrado.'}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* VISUALIZAÇÃO EM KANBAN */}
          {viewMode === 'kanban' && (
            <div className="flex gap-6 overflow-x-auto pb-6 items-start min-h-[600px]">
              {KANBAN_COLUMNS.map(col => {
                const colProjects = filteredProjects.filter(col.filter);
                const colBudget = colProjects.reduce((acc, p) => acc + parseBRL(p.budget), 0);

                return (
                  <div
                    key={col.id}
                    className="min-w-[340px] w-[360px] shrink-0 flex flex-col bg-slate-50 dark:bg-zinc-900/60 rounded-2xl border border-slate-200/80 dark:border-zinc-800 shadow-sm"
                  >
                    <div className={`p-4 border-b rounded-t-2xl flex justify-between items-center sticky top-0 backdrop-blur-sm z-10 ${col.headerBg}`}>
                      <div>
                        <h3 className="font-black text-sm tracking-tight">{col.label}</h3>
                        <p className="text-xs opacity-80 font-mono tabular-nums">{formatBRL(colBudget)} alocados</p>
                      </div>
                      <span className="bg-white/90 dark:bg-[#111113] px-2.5 py-0.5 rounded-full text-xs font-black shadow-sm tabular-nums">
                        {colProjects.length}
                      </span>
                    </div>

                    <div className="p-3 space-y-3 overflow-y-auto max-h-[72vh] custom-scrollbar">
                      {colProjects.map(project => (
                        <div key={project.id}>
                          <ProjectCard
                            project={project}
                            onDelete={handleDelete}
                            canWrite={canWrite}
                            deletingId={deletingId}
                          />
                        </div>
                      ))}
                      {colProjects.length === 0 && (
                        <div className="h-32 flex flex-col items-center justify-center border-2 border-dashed border-slate-200 dark:border-zinc-800 rounded-xl text-slate-500 dark:text-zinc-400">
                          <p className="text-xs font-bold uppercase tracking-wider">Coluna Vazia</p>
                          <p className="text-xs mt-0.5">Nenhum projeto neste estágio</p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* VISUALIZAÇÃO EM TABELA EXECUTIVA */}
          {viewMode === 'table' && (
            <div className="bg-white dark:bg-[#111113] rounded-2xl border border-slate-200/80 dark:border-zinc-800 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-zinc-900/80 border-b border-slate-200 dark:border-zinc-800 text-xs font-black uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                      <th className="p-4">Iniciativa &amp; Versão</th>
                      <th className="p-4">Status</th>
                      <th className="p-4">Prioridade</th>
                      <th className="p-4">Líder &amp; Equipe</th>
                      <th className="p-4">Prazo</th>
                      <th className="p-4">Progresso</th>
                      <th className="p-4 text-right">Orçamento</th>
                      <th className="p-4 text-center">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-zinc-800 text-xs">
                    {filteredProjects.map(project => {
                      const priorityInfo = getPriorityBadge(project.priority);
                      const deadlineEnd = project.deadline ? endOfLocalDay(project.deadline) : null;
                      const isDelayed = Boolean(deadlineEnd) && deadlineEnd < new Date() && project.status !== 'Concluído';
                      const safeCover = safeImageUrl(project.coverImage);

                      return (
                        <tr
                          key={project.id}
                          className="hover:bg-slate-50/80 dark:hover:bg-zinc-900/60 transition-colors group"
                        >
                          <td className="p-4">
                            <div className="flex items-center gap-3">
                              {safeCover ? (
                                <img src={safeCover} alt="" className="w-8 h-8 rounded-lg object-cover shrink-0" />
                              ) : (
                                <div className="w-8 h-8 rounded-lg bg-brand/10 text-brand-aa font-black text-xs flex items-center justify-center shrink-0">
                                  {(project.name || 'P').substring(0, 2).toUpperCase()}
                                </div>
                              )}
                              <div className="min-w-0">
                                <Link
                                  to={`/projects/${project.id}`}
                                  className="font-bold text-slate-900 dark:text-[#fafafa] hover:text-brand-aa transition-colors truncate block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded"
                                >
                                  {project.name}
                                </Link>
                                <span className="text-xs text-slate-500 dark:text-zinc-400 font-mono tabular-nums">v{project.version || '1.0'}</span>
                              </div>
                            </div>
                          </td>

                          <td className="p-4">
                            <span className={`px-2.5 py-1 rounded-lg text-xs font-black uppercase tracking-wide border ${getStatusBadge(project.status)}`}>
                              {project.status || 'Planejamento'}
                            </span>
                          </td>

                          <td className="p-4">
                            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-bold border ${priorityInfo.bg}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${priorityInfo.dot}`} aria-hidden="true" />
                              {priorityInfo.label}
                            </span>
                          </td>

                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-700 dark:text-zinc-200">
                                {project.leader || 'Não atribuído'}
                              </span>
                              {(project.team || []).length > 0 && (
                                <span className="bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 px-1.5 py-0.5 rounded text-xs font-mono tabular-nums">
                                  +{project.team.length}
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="p-4">
                            <span className={`font-mono font-bold flex items-center gap-1 tabular-nums ${
                              isDelayed ? 'text-rose-600 dark:text-rose-400' : 'text-slate-600 dark:text-zinc-300'
                            }`}>
                              <Calendar size={13} className="text-slate-400" aria-hidden="true" />
                              {project.deadline ? formatDateBR(project.deadline) : 'S/ Prazo'}
                            </span>
                          </td>

                          <td className="p-4">
                            <div className="w-32">
                              <div className="flex justify-between text-xs font-bold mb-1">
                                <span className="text-slate-600 dark:text-zinc-300 tabular-nums">{project.progress || 0}%</span>
                              </div>
                              <div className="w-full bg-slate-100 dark:bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${project.status === 'Concluído' ? 'bg-emerald-500' : 'bg-brand'}`}
                                  style={{ width: `${project.progress || 0}%` }}
                                />
                              </div>
                            </div>
                          </td>

                          <td className="p-4 text-right font-mono font-bold text-slate-800 dark:text-zinc-200 tabular-nums">
                            {formatBRL(project.budget)}
                          </td>

                          <td className="p-4 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <Link
                                to={`/projects/${project.id}`}
                                aria-label={`Abrir detalhes de ${project.name}`}
                                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl text-slate-500 hover:text-brand-aa hover:bg-brand/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                                title="Abrir Detalhes"
                              >
                                <ChevronRight size={18} aria-hidden="true" />
                              </Link>
                              {canWrite && (
                                <button
                                  type="button"
                                  disabled={Boolean(deletingId)}
                                  onClick={(e) => handleDelete(project.id, e)}
                                  aria-label={`Excluir projeto ${project.name}`}
                                  className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-50 disabled:cursor-not-allowed"
                                  title="Excluir Projeto"
                                >
                                  <Trash2 size={16} aria-hidden="true" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredProjects.length === 0 && (
                      <tr>
                        <td colSpan="8" className="p-12 text-center text-slate-500 dark:text-zinc-400">
                          Nenhum projeto encontrado com os filtros selecionados.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Modal de Criação de Novo Projeto com Metas e Orçamento */}
      {isModalOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overscroll-contain"
          onClick={(e) => {
            if (e.target === e.currentTarget && !saving) setIsModalOpen(false);
          }}
        >
          <div
            ref={modalRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby={modalTitleId}
            className="bg-white dark:bg-[#111113] rounded-3xl shadow-2xl w-full max-w-xl p-6 md:p-8 animate-zoom-in border border-slate-200 dark:border-zinc-800 max-h-[92vh] overflow-y-auto overscroll-contain"
          >
            <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-100 dark:border-zinc-800">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-brand/10 text-brand-aa">
                  <FolderGit2 size={24} aria-hidden="true" />
                </div>
                <div>
                  <h2 id={modalTitleId} className="text-xl font-black text-slate-900 dark:text-[#fafafa]">Iniciar Novo Projeto</h2>
                  <p className="text-xs text-slate-500 dark:text-zinc-400">Defina metas, equipe, orçamento e entregáveis macro.</p>
                </div>
              </div>
              <button
                type="button"
                disabled={saving}
                onClick={() => setIsModalOpen(false)}
                aria-label="Fechar janela de novo projeto"
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-slate-500 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-[#fafafa] hover:bg-slate-100 dark:hover:bg-zinc-800 rounded-xl transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label htmlFor="proj-name" className="text-xs font-bold text-slate-600 dark:text-zinc-300 uppercase mb-1 block">Nome da Iniciativa *</label>
                <input
                  ref={firstInputRef}
                  id="proj-name"
                  name="proj-name"
                  required
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className={`${modalFieldClass} font-bold text-sm`}
                  placeholder="Ex: Modernização do Parque de Notebooks Filial Belém"
                />
              </div>

              <div>
                <label htmlFor="proj-desc" className="text-xs font-bold text-slate-600 dark:text-zinc-300 uppercase mb-1 block">Objetivo &amp; Escopo</label>
                <textarea
                  id="proj-desc"
                  name="proj-desc"
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                  className={`${modalFieldClass} text-sm leading-relaxed`}
                  rows="3"
                  placeholder="Descreva o propósito da entrega, impactos para o negócio e premissas…"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="proj-version" className="text-xs font-bold text-slate-600 dark:text-zinc-300 uppercase mb-1 block">Versão</label>
                  <input
                    id="proj-version"
                    name="proj-version"
                    value={formData.version}
                    onChange={e => setFormData({ ...formData, version: e.target.value })}
                    className={`${modalFieldClass} font-mono text-sm tabular-nums`}
                    placeholder="1.0"
                  />
                </div>

                <div>
                  <label htmlFor="proj-priority" className="text-xs font-bold text-slate-600 dark:text-zinc-300 uppercase mb-1 block">Prioridade</label>
                  <select
                    id="proj-priority"
                    name="proj-priority"
                    value={formData.priority}
                    onChange={e => setFormData({ ...formData, priority: e.target.value })}
                    className={`${modalFieldClass} text-sm cursor-pointer`}
                  >
                    <option value="Baixa">Baixa</option>
                    <option value="Média">Média</option>
                    <option value="Alta">Alta</option>
                    <option value="Crítica">Crítica</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="proj-status" className="text-xs font-bold text-slate-600 dark:text-zinc-300 uppercase mb-1 block">Status Inicial</label>
                  <select
                    id="proj-status"
                    name="proj-status"
                    value={formData.status}
                    onChange={e => setFormData({ ...formData, status: e.target.value })}
                    className={`${modalFieldClass} text-sm cursor-pointer`}
                  >
                    <option value="Planejamento">Planejamento</option>
                    <option value="Em Andamento">Em Andamento</option>
                    <option value="Pausado">Pausado</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="proj-budget" className="text-xs font-bold text-slate-600 dark:text-zinc-300 uppercase mb-1 block">Orçamento Estimado (R$)</label>
                  <input
                    id="proj-budget"
                    name="proj-budget"
                    type="text"
                    value={formData.budget}
                    onChange={e => setFormData({ ...formData, budget: e.target.value })}
                    placeholder="Ex: 50.000,00 ou 50000"
                    className={`${modalFieldClass} text-sm font-mono tabular-nums`}
                  />
                </div>

                <div>
                  <label htmlFor="proj-deadline" className="text-xs font-bold text-slate-600 dark:text-zinc-300 uppercase mb-1 block">Prazo de Entrega</label>
                  <input
                    id="proj-deadline"
                    name="proj-deadline"
                    type="date"
                    value={formData.deadline}
                    onChange={e => setFormData({ ...formData, deadline: e.target.value })}
                    className={`${modalFieldClass} text-sm tabular-nums`}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="proj-leader" className="text-xs font-bold text-slate-600 dark:text-zinc-300 uppercase mb-1 block">Líder do Projeto</label>
                <select
                  id="proj-leader"
                  name="proj-leader"
                  value={formData.leader}
                  onChange={e => setFormData({ ...formData, leader: e.target.value })}
                  className={`${modalFieldClass} cursor-pointer text-sm`}
                >
                  <option value="">Selecione o líder responsável…</option>
                  {employees.map(emp => <option key={emp.id} value={emp.name}>{emp.name} ({emp.role || 'Colaborador'})</option>)}
                </select>
              </div>

              <div>
                <span id="proj-team-label" className="text-xs font-bold text-slate-600 dark:text-zinc-300 uppercase mb-1 block">Equipe Técnica Alocada</span>
                <div role="group" aria-labelledby="proj-team-label" className="max-h-36 overflow-y-auto border border-slate-200 dark:border-zinc-700 bg-white dark:bg-[#111113] rounded-xl p-2 space-y-1 custom-scrollbar">
                  {employees.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-zinc-400 p-2">Nenhum colaborador cadastrado para alocação.</p>
                  ) : (
                    employees.map(emp => {
                      const isSelected = (formData.team || []).includes(emp.name);
                      const checkboxId = `proj-team-${emp.id}`;
                      return (
                        <label htmlFor={checkboxId} key={emp.id} className="flex items-center gap-2.5 text-xs px-2 min-h-[44px] rounded-lg hover:bg-slate-50 dark:hover:bg-zinc-800 cursor-pointer text-slate-800 dark:text-zinc-200">
                          <input
                            id={checkboxId}
                            name={`proj-team-${emp.id}`}
                            type="checkbox"
                            checked={isSelected}
                            onChange={e => {
                              if (e.target.checked) {
                                setFormData(prev => ({ ...prev, team: [...(prev.team || []), emp.name] }));
                              } else {
                                setFormData(prev => ({ ...prev, team: (prev.team || []).filter(n => n !== emp.name) }));
                              }
                            }}
                            className="h-4 w-4 rounded accent-brand transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60 disabled:cursor-not-allowed"
                          />
                          <span className="font-medium">{emp.name}</span>
                          {emp.role && <span className="text-slate-500 dark:text-zinc-400 text-xs">({emp.role})</span>}
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              <div>
                <label htmlFor="proj-cover" className="text-xs font-bold text-slate-600 dark:text-zinc-300 uppercase mb-1 block">URL da Imagem / Capa (Opcional)</label>
                <input
                  id="proj-cover"
                  name="proj-cover"
                  type="url"
                  value={formData.coverImage}
                  onChange={e => setFormData({ ...formData, coverImage: e.target.value })}
                  placeholder="https://exemplo.com/imagem.png"
                  className={`${modalFieldClass} text-xs font-mono`}
                />
              </div>

              <div className="flex gap-3 pt-4 border-t border-slate-100 dark:border-zinc-800">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 min-h-[44px] bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 text-slate-700 dark:text-zinc-200 rounded-xl font-bold hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50 text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 min-h-[44px] bg-brand hover:bg-brand-dark text-brand-fg rounded-xl font-bold shadow-sm transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand flex items-center justify-center gap-2 disabled:opacity-50 text-sm"
                >
                  {saving ? <RefreshCcw size={18} className="animate-spin" aria-hidden="true" /> : null}
                  {saving ? 'Criando Projeto…' : 'Salvar e Iniciar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectsPage;