// src/pages/ProjectsPage.jsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { getProjects, createProject, deleteProject } from '../services/projectService';
import { getEmployees } from '../services/employeeService';
import { 
  FolderGit2, Plus, Calendar, Trash2, LayoutGrid, Kanban, ListFilter,
  RefreshCcw, X, Search, CheckCircle2, Clock, AlertCircle, Users,
  TrendingUp, DollarSign, ArrowUpRight, Filter, ChevronRight, Sparkles,
  Layers, CheckCircle, BarChart3
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { can } from '../utils/permissions';
import { useConfirm } from '../components/ConfirmDialog';
import { formatDateBR } from '../utils/dates';
import { toast } from 'sonner';
import { parseBRL, formatBRL } from '../utils/currency';

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
        bg: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/60',
        dot: 'bg-amber-500'
      };
    case 'Baixa':
      return {
        label: 'Baixa',
        bg: 'bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
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
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 border-blue-200 dark:border-blue-800';
    case 'Concluído':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
    case 'Pausado':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-amber-200 dark:border-amber-800';
    case 'Planejamento':
    default:
      return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700';
  }
};

// Card de projeto na visualização Grid
const ProjectCard = ({ project, navigate, onDelete, canWrite }) => {
  const projectInitials = (project.name || 'P').substring(0, 2).toUpperCase();
  const priorityInfo = getPriorityBadge(project.priority);
  const isDelayed = project.deadline && new Date(project.deadline) < new Date() && project.status !== 'Concluído';

  return (
    <div 
      onClick={() => navigate(`/projects/${project.id}`)} 
      className="bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-200/80 dark:border-slate-700 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer group flex flex-col h-full relative"
    >
      <div className="flex justify-between items-start mb-3">
        <div className="flex gap-3 min-w-0">
          {project.coverImage ? (
            <img 
              src={project.coverImage} 
              alt="Logo" 
              className="w-11 h-11 rounded-xl object-cover shadow-sm bg-slate-100 dark:bg-slate-700 shrink-0" 
            />
          ) : (
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500 via-purple-600 to-brand flex items-center justify-center text-white font-black text-sm uppercase shadow-sm shrink-0">
              {projectInitials}
            </div>
          )}
          <div className="min-w-0">
            <h3 className="font-bold text-slate-900 dark:text-white leading-tight group-hover:text-blue-600 dark:group-hover:text-brand transition-colors truncate">
              {project.name}
            </h3>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono font-bold bg-slate-100 dark:bg-slate-700/60 px-1.5 py-0.5 rounded">
                v{project.version || '1.0'}
              </span>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border ${priorityInfo.bg}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${priorityInfo.dot}`} />
                {priorityInfo.label}
              </span>
            </div>
          </div>
        </div>

        <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wide border shrink-0 ${getStatusBadge(project.status)}`}>
          {project.status || 'Planejamento'}
        </span>
      </div>

      <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed line-clamp-2 mb-4 flex-1">
        {project.description || 'Sem descrição cadastrada para esta iniciativa.'}
      </p>

      {/* Orçamento e Metas */}
      {project.budget && (
        <div className="mb-3 px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
          <span className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1">
            <DollarSign size={12} className="text-emerald-500" /> Orçamento
          </span>
          <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
            {formatBRL(project.budget)}
          </span>
        </div>
      )}

      <div className="mt-auto space-y-3">
        {/* Barra de Progresso */}
        <div>
          <div className="flex justify-between text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1">
            <span>Progresso da Entrega</span>
            <span className="text-slate-700 dark:text-slate-300">{project.progress || 0}%</span>
          </div>
          <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-2 overflow-hidden p-0.5">
            <div 
              className={`h-full rounded-full transition-all duration-500 ${
                project.status === 'Concluído' 
                  ? 'bg-emerald-500' 
                  : 'bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600'
              }`} 
              style={{ width: `${project.progress || 0}%` }} 
            />
          </div>
        </div>

        {/* Rodapé do Card */}
        <div className="pt-3 border-t border-slate-100 dark:border-slate-700/80 flex justify-between items-center">
          <div className="flex items-center gap-1.5">
            <div className="flex -space-x-2">
              {(project.team || []).length > 0 ? (
                project.team.slice(0, 3).map((memberName, i) => (
                  <div 
                    key={i} 
                    title={memberName} 
                    className="w-6 h-6 rounded-full bg-indigo-50 dark:bg-indigo-950/60 border-2 border-white dark:border-slate-800 flex items-center justify-center text-[8px] font-black text-brand uppercase shadow-sm"
                  >
                    {memberName.substring(0,2)}
                  </div>
                ))
              ) : project.leader ? (
                <div 
                  title={`Líder: ${project.leader}`} 
                  className="w-6 h-6 rounded-full bg-indigo-50 dark:bg-indigo-950/60 border-2 border-white dark:border-slate-800 flex items-center justify-center text-[8px] font-black text-brand uppercase shadow-sm"
                >
                  {project.leader.substring(0,2)}
                </div>
              ) : (
                <div title="Sem Equipe" className="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-700 border-2 border-white dark:border-slate-800 flex items-center justify-center text-[8px] font-bold text-slate-400">
                  --
                </div>
              )}
              {(project.team || []).length > 3 && (
                <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700 border-2 border-white dark:border-slate-800 flex items-center justify-center text-[8px] font-bold text-slate-700 dark:text-slate-300">
                  +{project.team.length - 3}
                </div>
              )}
            </div>
            {project.leader && (
              <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium truncate max-w-[90px]">
                {project.leader.split(' ')[0]}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-bold flex items-center gap-1 ${
              isDelayed 
                ? 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 px-1.5 py-0.5 rounded' 
                : project.deadline 
                  ? 'text-slate-600 dark:text-slate-300' 
                  : 'text-slate-400 dark:text-slate-500'
            }`}>
              <Calendar size={12}/> {project.deadline ? formatDateBR(project.deadline) : 'S/ Prazo'}
            </span>
            {canWrite && (
              <button 
                onClick={(e) => onDelete(project.id, e)} 
                title="Excluir projeto"
                className="text-slate-300 dark:text-slate-600 hover:text-rose-500 dark:hover:text-rose-400 transition-colors p-1 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30"
              >
                <Trash2 size={13}/>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const ProjectsPage = () => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const confirm = useConfirm();
  const tenantId = currentUser?.tenantId;
  const canWrite = can(currentUser, 'projects:write');

  const [projects, setProjects] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'kanban' | 'table'
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState(initialForm);

  // Filtros de busca e categorização
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('Todos');
  const [priorityFilter, setPriorityFilter] = useState('Todas');

  const loadProjects = useCallback(async () => {
    if (!tenantId) {
      setProjects([]);
      setEmployees([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [pRes, eRes] = await Promise.allSettled([getProjects(tenantId), getEmployees(tenantId)]);
      setProjects(pRes.status === 'fulfilled' ? pRes.value || [] : []);
      setEmployees(eRes.status === 'fulfilled' ? eRes.value || [] : []);
    } catch (error) {
      console.error('Erro ao carregar projetos:', error);
      toast.error('Erro ao carregar projetos.');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (tenantId) {
      loadProjects();
    } else {
      setProjects([]);
      setEmployees([]);
      setLoading(false);
    }
  }, [tenantId, loadProjects]);

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
    if (!tenantId) {
      toast.error('Sem contexto de tenant.');
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
        coverImage: formData.coverImage.trim() || '',
        tenantId,
        changelog: [`v${formData.version.trim() || '1.0'}: Projeto iniciado. (${new Date().toLocaleDateString('pt-BR')})`],
        progress: 0
      };
      await createProject(enrichedData);
      setFormData(initialForm);
      setIsModalOpen(false);
      toast.success('Projeto criado com sucesso.');
      await loadProjects();
    } catch (err) {
      console.error(err);
      toast.error('Erro ao criar projeto.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    const confirmed = await confirm({
      title: 'Excluir Projeto',
      message: 'Tem certeza que deseja apagar este projeto e desvincular suas tarefas? Esta ação não pode ser desfeita.',
      danger: true,
      confirmLabel: 'Excluir Projeto'
    });
    if (!confirmed) return;

    try {
      await deleteProject(id, tenantId);
      toast.success('Projeto excluído com sucesso.');
      await loadProjects();
    } catch (err) {
      console.error(err);
      toast.error('Erro ao excluir projeto.');
    }
  };

  const KANBAN_COLUMNS = [
    { 
      id: 'Planejamento', 
      label: 'Planejamento & Backlog', 
      filter: (p) => p.status === 'Planejamento' || p.status === 'Pausado',
      headerBg: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700' 
    },
    { 
      id: 'Em Andamento', 
      label: 'Em Execução & Revisão', 
      filter: (p) => p.status === 'Em Andamento' || p.status === 'Revisão',
      headerBg: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-900/60' 
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
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand/10 text-brand text-xs font-black uppercase tracking-wider mb-2">
            <Sparkles size={14} /> Portfólio de Iniciativas & Entregas
          </div>
          <h1 className="text-3xl font-black text-slate-900 dark:text-white flex items-center gap-3 tracking-tight">
            <FolderGit2 className="text-brand" size={32} /> Central de Projetos
          </h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1 text-sm">
            Planejamento estratégico, acompanhamento de marcos, orçamento alocado e sprints operacionais.
          </p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          {/* Seletor de visualizações */}
          <div className="flex items-center bg-white dark:bg-slate-800 p-1 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <button 
              onClick={() => setViewMode('grid')} 
              title="Visualização em Grade"
              className={`p-2.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all ${
                viewMode === 'grid' 
                  ? 'bg-slate-900 text-white dark:bg-brand dark:text-white shadow' 
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <LayoutGrid size={18}/>
              <span className="hidden sm:inline">Grade</span>
            </button>
            <button 
              onClick={() => setViewMode('kanban')} 
              title="Visualização em Kanban"
              className={`p-2.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all ${
                viewMode === 'kanban' 
                  ? 'bg-slate-900 text-white dark:bg-brand dark:text-white shadow' 
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Kanban size={18}/>
              <span className="hidden sm:inline">Quadro</span>
            </button>
            <button 
              onClick={() => setViewMode('table')} 
              title="Visualização em Tabela"
              className={`p-2.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all ${
                viewMode === 'table' 
                  ? 'bg-slate-900 text-white dark:bg-brand dark:text-white shadow' 
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <ListFilter size={18}/>
              <span className="hidden sm:inline">Tabela</span>
            </button>
          </div>

          {canWrite && (
            <button 
              onClick={() => { setFormData(initialForm); setIsModalOpen(true); }} 
              className="bg-brand hover:opacity-95 text-white px-5 py-3 rounded-2xl font-bold flex items-center gap-2 text-sm shadow-lg shadow-brand/20 active:scale-95 transition-all"
            >
              <Plus size={18} /> Novo Projeto
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards Bar */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700 shadow-sm flex flex-col justify-between">
          <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
            <Layers size={14} className="text-brand"/> Total Iniciativas
          </span>
          <p className="text-2xl font-black text-slate-900 dark:text-white mt-2">{stats.total}</p>
          <span className="text-[10px] text-slate-400 mt-1">Portfólio cadastrado</span>
        </div>

        <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700 shadow-sm flex flex-col justify-between">
          <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider flex items-center gap-1.5">
            <Clock size={14}/> Em Execução
          </span>
          <p className="text-2xl font-black text-blue-600 dark:text-blue-400 mt-2">{stats.inProgress}</p>
          <span className="text-[10px] text-slate-400 mt-1">Sprints ativas</span>
        </div>

        <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700 shadow-sm flex flex-col justify-between">
          <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
            <CheckCircle2 size={14}/> Concluídos
          </span>
          <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-2">{stats.completed}</p>
          <span className="text-[10px] text-slate-400 mt-1">Entregas homologadas</span>
        </div>

        <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700 shadow-sm flex flex-col justify-between">
          <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Calendar size={14}/> Planejamento
          </span>
          <p className="text-2xl font-black text-slate-800 dark:text-slate-200 mt-2">{stats.planning}</p>
          <span className="text-[10px] text-slate-400 mt-1">Fase preparatória</span>
        </div>

        <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700 shadow-sm flex flex-col justify-between">
          <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider flex items-center gap-1.5">
            <TrendingUp size={14}/> Progresso Médio
          </span>
          <p className="text-2xl font-black text-indigo-600 dark:text-indigo-400 mt-2">{stats.avgProg}%</p>
          <div className="w-full bg-slate-100 dark:bg-slate-700 h-1.5 rounded-full mt-1.5 overflow-hidden">
            <div className="h-full bg-indigo-600 rounded-full" style={{ width: `${stats.avgProg}%` }} />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700 shadow-sm flex flex-col justify-between">
          <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
            <DollarSign size={14}/> Orçamento Total
          </span>
          <p className="text-lg font-black text-slate-900 dark:text-white mt-2 truncate" title={formatBRL(stats.totalBudget)}>
            {formatBRL(stats.totalBudget)}
          </p>
          <span className="text-[10px] text-slate-400 mt-1">Investimento previsto</span>
        </div>
      </div>

      {/* Barra de Filtros e Busca em Tempo Real */}
      <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700 shadow-sm flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        {/* Campo de Busca */}
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input 
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Buscar por nome do projeto, líder, versão, membro da equipe..."
            className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900 text-slate-900 dark:text-white placeholder:text-slate-400 text-sm outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
          />
          {searchTerm && (
            <button 
              onClick={() => setSearchTerm('')} 
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X size={16}/>
            </button>
          )}
        </div>

        {/* Filtros de Status e Prioridade */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-900 p-1 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300">
            {['Todos', 'Em Andamento', 'Planejamento', 'Concluído'].map(st => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  statusFilter === st 
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm' 
                    : 'hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {st}
              </button>
            ))}
          </div>

          <select 
            value={priorityFilter}
            onChange={e => setPriorityFilter(e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-xs font-bold outline-none cursor-pointer"
          >
            <option value="Todas">Prioridade: Todas</option>
            <option value="Crítica">Crítica</option>
            <option value="Alta">Alta</option>
            <option value="Média">Média</option>
            <option value="Baixa">Baixa</option>
          </select>

          {(searchTerm || statusFilter !== 'Todos' || priorityFilter !== 'Todas') && (
            <button 
              onClick={() => { setSearchTerm(''); setStatusFilter('Todos'); setPriorityFilter('Todas'); }}
              className="px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-xl transition-all"
            >
              Limpar Filtros
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center h-64 text-slate-400">
          <RefreshCcw size={32} className="animate-spin text-brand mb-3" />
          <p className="text-sm font-bold">Carregando portfólio de projetos...</p>
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
                  navigate={navigate} 
                  onDelete={handleDelete}
                  canWrite={canWrite}
                />
              ))}
              {filteredProjects.length === 0 && (
                <div className="col-span-full text-center py-20 text-slate-400 dark:text-slate-500 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl bg-white/50 dark:bg-slate-800/50">
                  <FolderGit2 size={48} className="mx-auto mb-3 opacity-30 text-brand"/>
                  <p className="font-bold text-slate-700 dark:text-slate-300">Nenhum projeto encontrado</p>
                  <p className="text-xs mt-1 text-slate-400">
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
                    className="min-w-[340px] w-[360px] flex-shrink-0 flex flex-col bg-slate-50 dark:bg-slate-900/60 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm"
                  >
                    <div className={`p-4 border-b rounded-t-2xl flex justify-between items-center sticky top-0 backdrop-blur-sm z-10 ${col.headerBg}`}>
                      <div>
                        <h3 className="font-black text-sm tracking-tight">{col.label}</h3>
                        <p className="text-[10px] opacity-75 font-mono">{formatBRL(colBudget)} alocados</p>
                      </div>
                      <span className="bg-white/80 dark:bg-slate-800 px-2.5 py-0.5 rounded-full text-xs font-black shadow-sm">
                        {colProjects.length}
                      </span>
                    </div>

                    <div className="p-3 space-y-3 overflow-y-auto max-h-[72vh] custom-scrollbar">
                      {colProjects.map(project => (
                        <div key={project.id} className="transform hover:scale-[1.01] transition-transform">
                          <ProjectCard 
                            project={project} 
                            navigate={navigate} 
                            onDelete={handleDelete}
                            canWrite={canWrite}
                          />
                        </div>
                      ))}
                      {colProjects.length === 0 && (
                        <div className="h-32 flex flex-col items-center justify-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl text-slate-400">
                          <p className="text-xs font-bold uppercase tracking-wider">Coluna Vazia</p>
                          <p className="text-[10px] mt-0.5">Nenhum projeto neste estágio</p>
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
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-700 text-[11px] font-black uppercase tracking-wider text-slate-400">
                      <th className="p-4">Iniciativa & Versão</th>
                      <th className="p-4">Status</th>
                      <th className="p-4">Prioridade</th>
                      <th className="p-4">Líder & Equipe</th>
                      <th className="p-4">Prazo</th>
                      <th className="p-4">Progresso</th>
                      <th className="p-4 text-right">Orçamento</th>
                      <th className="p-4 text-center">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700 text-xs">
                    {filteredProjects.map(project => {
                      const priorityInfo = getPriorityBadge(project.priority);
                      const isDelayed = project.deadline && new Date(project.deadline) < new Date() && project.status !== 'Concluído';

                      return (
                        <tr 
                          key={project.id} 
                          onClick={() => navigate(`/projects/${project.id}`)}
                          className="hover:bg-slate-50/80 dark:hover:bg-slate-750 transition-colors cursor-pointer group"
                        >
                          <td className="p-4">
                            <div className="flex items-center gap-3">
                              {project.coverImage ? (
                                <img src={project.coverImage} alt="" className="w-8 h-8 rounded-lg object-cover shrink-0" />
                              ) : (
                                <div className="w-8 h-8 rounded-lg bg-brand/10 text-brand font-black text-xs flex items-center justify-center shrink-0">
                                  {(project.name || 'P').substring(0,2).toUpperCase()}
                                </div>
                              )}
                              <div className="min-w-0">
                                <p className="font-bold text-slate-900 dark:text-white group-hover:text-brand transition-colors truncate">
                                  {project.name}
                                </p>
                                <span className="text-[10px] text-slate-400 font-mono">v{project.version || '1.0'}</span>
                              </div>
                            </div>
                          </td>

                          <td className="p-4">
                            <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wide border ${getStatusBadge(project.status)}`}>
                              {project.status || 'Planejamento'}
                            </span>
                          </td>

                          <td className="p-4">
                            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold border ${priorityInfo.bg}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${priorityInfo.dot}`} />
                              {priorityInfo.label}
                            </span>
                          </td>

                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-700 dark:text-slate-200">
                                {project.leader || 'Não atribuído'}
                              </span>
                              {(project.team || []).length > 0 && (
                                <span className="bg-slate-100 dark:bg-slate-700 text-slate-500 px-1.5 py-0.5 rounded text-[10px] font-mono">
                                  +{project.team.length}
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="p-4">
                            <span className={`font-mono font-bold flex items-center gap-1 ${
                              isDelayed ? 'text-rose-600 dark:text-rose-400' : 'text-slate-600 dark:text-slate-300'
                            }`}>
                              <Calendar size={13} className="text-slate-400"/>
                              {project.deadline ? formatDateBR(project.deadline) : 'S/ Prazo'}
                            </span>
                          </td>

                          <td className="p-4">
                            <div className="w-32">
                              <div className="flex justify-between text-[10px] font-bold mb-1">
                                <span className="text-slate-500">{project.progress || 0}%</span>
                              </div>
                              <div className="w-full bg-slate-100 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                                <div 
                                  className={`h-full rounded-full ${project.status === 'Concluído' ? 'bg-emerald-500' : 'bg-brand'}`} 
                                  style={{ width: `${project.progress || 0}%` }} 
                                />
                              </div>
                            </div>
                          </td>

                          <td className="p-4 text-right font-mono font-bold text-slate-800 dark:text-slate-200">
                            {formatBRL(project.budget)}
                          </td>

                          <td className="p-4 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button 
                                onClick={(e) => { e.stopPropagation(); navigate(`/projects/${project.id}`); }}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-brand hover:bg-brand/10 transition-colors"
                                title="Abrir Detalhes"
                              >
                                <ChevronRight size={16} />
                              </button>
                              {canWrite && (
                                <button 
                                  onClick={(e) => handleDelete(project.id, e)}
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                                  title="Excluir Projeto"
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredProjects.length === 0 && (
                      <tr>
                        <td colSpan="8" className="p-12 text-center text-slate-400">
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
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-xl p-6 md:p-8 animate-in zoom-in-95 border border-slate-200 dark:border-slate-700 max-h-[92vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-100 dark:border-slate-700">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-brand/10 text-brand">
                  <FolderGit2 size={24} />
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-900 dark:text-white">Iniciar Novo Projeto</h2>
                  <p className="text-xs text-slate-400">Defina metas, equipe, orçamento e entregáveis macro.</p>
                </div>
              </div>
              <button disabled={saving} onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg">
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1 block">Nome da Iniciativa *</label>
                <input 
                  required 
                  value={formData.name} 
                  onChange={e => setFormData({...formData, name: e.target.value})} 
                  className="w-full p-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-xl font-bold outline-none focus:border-brand text-sm" 
                  placeholder="Ex: Modernização do Parque de Notebooks Filial Belém" 
                />
              </div>
              
              <div>
                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1 block">Objetivo & Escopo</label>
                <textarea 
                  value={formData.description} 
                  onChange={e => setFormData({...formData, description: e.target.value})} 
                  className="w-full p-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-xl outline-none focus:border-brand text-sm leading-relaxed" 
                  rows="3" 
                  placeholder="Descreva o propósito da entrega, impactos para o negócio e premissas..."
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1 block">Versão</label>
                  <input 
                    value={formData.version} 
                    onChange={e => setFormData({...formData, version: e.target.value})} 
                    className="w-full p-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-xl outline-none focus:border-brand font-mono text-sm" 
                    placeholder="1.0" 
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1 block">Prioridade</label>
                  <select 
                    value={formData.priority}
                    onChange={e => setFormData({...formData, priority: e.target.value})}
                    className="w-full p-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-xl outline-none focus:border-brand text-sm cursor-pointer"
                  >
                    <option value="Baixa">Baixa</option>
                    <option value="Média">Média</option>
                    <option value="Alta">Alta</option>
                    <option value="Crítica">Crítica</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1 block">Status Inicial</label>
                  <select 
                    value={formData.status}
                    onChange={e => setFormData({...formData, status: e.target.value})}
                    className="w-full p-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-xl outline-none focus:border-brand text-sm cursor-pointer"
                  >
                    <option value="Planejamento">Planejamento</option>
                    <option value="Em Andamento">Em Andamento</option>
                    <option value="Pausado">Pausado</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1 block">Orçamento Estimado (R$)</label>
                  <input 
                    type="text"
                    value={formData.budget}
                    onChange={e => setFormData({...formData, budget: e.target.value})}
                    placeholder="Ex: 50.000,00 ou 50000"
                    className="w-full p-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-xl outline-none focus:border-brand text-sm font-mono"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1 block">Prazo de Entrega</label>
                  <input 
                    type="date" 
                    value={formData.deadline} 
                    onChange={e => setFormData({...formData, deadline: e.target.value})} 
                    className="w-full p-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-xl outline-none focus:border-brand text-sm" 
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1 block">Líder do Projeto</label>
                <select 
                  value={formData.leader} 
                  onChange={e => setFormData({...formData, leader: e.target.value})} 
                  className="w-full p-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-xl outline-none focus:border-brand cursor-pointer text-sm"
                >
                  <option value="">Selecione o líder responsável...</option>
                  {employees.map(emp => <option key={emp.id} value={emp.name}>{emp.name} ({emp.role || 'Colaborador'})</option>)}
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1 block">Equipe Técnica Alocada</label>
                <div className="max-h-36 overflow-y-auto border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 rounded-xl p-2 space-y-1 custom-scrollbar">
                  {employees.length === 0 ? (
                    <p className="text-xs text-slate-400 p-2">Nenhum colaborador cadastrado para alocação.</p>
                  ) : (
                    employees.map(emp => {
                      const isSelected = (formData.team || []).includes(emp.name);
                      return (
                        <label key={emp.id} className="flex items-center gap-2 text-xs p-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer text-slate-800 dark:text-slate-200">
                          <input 
                            type="checkbox" 
                            checked={isSelected}
                            onChange={e => {
                              if (e.target.checked) {
                                setFormData(prev => ({ ...prev, team: [...(prev.team || []), emp.name] }));
                              } else {
                                setFormData(prev => ({ ...prev, team: (prev.team || []).filter(n => n !== emp.name) }));
                              }
                            }}
                            className="rounded text-brand focus:ring-brand"
                          />
                          <span className="font-medium">{emp.name}</span>
                          {emp.role && <span className="text-slate-400 text-[10px]">({emp.role})</span>}
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1 block">URL da Imagem / Capa (Opcional)</label>
                <input 
                  type="url"
                  value={formData.coverImage} 
                  onChange={e => setFormData({...formData, coverImage: e.target.value})} 
                  placeholder="https://exemplo.com/imagem.png"
                  className="w-full p-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-xl outline-none focus:border-brand text-xs font-mono" 
                />
              </div>

              <div className="flex gap-3 pt-4 border-t border-slate-100 dark:border-slate-700">
                <button 
                  type="button" 
                  disabled={saving} 
                  onClick={() => setIsModalOpen(false)} 
                  className="flex-1 py-3 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 rounded-xl font-bold hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors disabled:opacity-50 text-sm"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  disabled={saving} 
                  className="flex-1 py-3 bg-brand hover:opacity-90 text-white rounded-xl font-bold shadow-lg shadow-brand/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50 text-sm"
                >
                  {saving ? <RefreshCcw size={18} className="animate-spin" /> : null}
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