// src/pages/ProjectDetails.jsx
import React, { useState, useEffect, useCallback, useId, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getProject, updateProject, addProjectLog, setProjectLogs } from '../services/projectService';
import { getEmployees } from '../services/employeeService';
import { useAuth } from '../contexts/AuthContext';
import { can } from '../utils/permissions';
import { useConfirm } from '../components/ConfirmDialog';
import { endOfLocalDay, formatDateBR } from '../utils/dates';
import {
  ArrowLeft, Calendar, User,
  FileText, Plus, Save, Clock, Target, Edit3, X,
  BarChart3, DollarSign, Users, Trash2,
  ChevronDown, ChevronUp, RefreshCcw, Sparkles,
  CheckCircle2, AlertCircle
} from 'lucide-react';
import { toast } from 'sonner';
import { parseBRL, formatBRL } from '../utils/currency';
import { safeImageUrl } from '../utils/sanitize';
import { captureFocusTarget, restoreFocusSafely, trapFocusWithin } from '../utils/focusTrap';
import { isTopmostModal } from '../utils/modalStack';

const editFieldClass =
  'w-full px-3.5 py-2.5 min-h-[44px] border border-slate-200 dark:border-zinc-700 bg-white dark:bg-[#111113] text-slate-900 dark:text-[#fafafa] placeholder:text-slate-400 dark:placeholder:text-zinc-500 rounded-xl transition-colors hover:border-slate-300 dark:hover:border-zinc-600 active:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:border-brand disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-zinc-900 aria-[invalid=true]:border-rose-500 aria-[invalid=true]:focus-visible:ring-rose-500';

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

const getStatusColor = (s) => {
  switch (s) {
    case 'Em Andamento':
    case 'Revisão':
      return 'bg-sky-100 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800';
    case 'Concluído':
      return 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
    case 'Pausado':
      return 'bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800';
    default:
      return 'bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 border-slate-200 dark:border-zinc-700';
  }
};

const ProjectDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const confirm = useConfirm();
  const tenantId = currentUser?.tenantId;
  const canWrite = can(currentUser, 'projects:write');

  const [project, setProject] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [isAddingLog, setIsAddingLog] = useState(false);
  const [newLog, setNewLog] = useState('');
  const [logTag, setLogTag] = useState('Marco');
  const [savingLog, setSavingLog] = useState(false);
  const [deletingLogIndex, setDeletingLogIndex] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const [showAllLogs, setShowAllLogs] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editFormData, setEditFormData] = useState({});

  const editModalTitleId = useId();
  const editModalRef = useRef(null);
  const editFirstInputRef = useRef(null);
  const previousEditFocusRef = useRef(null);
  const newLogRef = useRef(null);
  const savingEditRef = useRef(savingEdit);
  savingEditRef.current = savingEdit;
  const isMountedRef = useRef(true);
  const fetchSeqRef = useRef(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (isAddingLog) {
      requestAnimationFrame(() => newLogRef.current?.focus());
    }
  }, [isAddingLog]);

  useEffect(() => {
    if (!isEditModalOpen) return undefined;
    const container = editModalRef.current;
    previousEditFocusRef.current = captureFocusTarget(container);
    const frameId = requestAnimationFrame(() => editFirstInputRef.current?.focus());
    const handleKeyDown = (e) => {
      if (!isTopmostModal(container)) return;
      if (e.key === 'Escape') {
        if (savingEditRef.current) return;
        e.stopPropagation();
        setIsEditModalOpen(false);
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
      const previous = previousEditFocusRef.current;
      previousEditFocusRef.current = null;
      restoreFocusSafely(previous, null, container);
    };
  }, [isEditModalOpen]);

  const fetchProject = useCallback(async ({ isCancelled } = {}) => {
    const seq = ++fetchSeqRef.current;
    const stale = () => !isMountedRef.current || seq !== fetchSeqRef.current || Boolean(isCancelled?.());

    setLoading(true);
    setLoadError(null);
    try {
      const [data, empList] = await Promise.all([
        getProject(id),
        tenantId ? getEmployees(tenantId) : Promise.resolve([])
      ]);
      if (stale()) return;

      if (data) {
        if (data.tenantId && tenantId && data.tenantId !== tenantId) {
          setProject(null);
          toast.error('Acesso não autorizado a este projeto.');
          navigate('/projects');
          return;
        }
        setProject(data);
      } else {
        setProject(null);
        setLoadError('Projeto não encontrado ou indisponível.');
      }
      setEmployees(empList || []);
    } catch (error) {
      console.error('Erro ao buscar projeto:', error);
      if (stale()) return;
      setProject(null);
      setLoadError(error?.message || 'Não foi possível carregar os detalhes do projeto.');
    } finally {
      if (!stale()) {
        setLoading(false);
      }
    }
  }, [id, tenantId, navigate]);

  useEffect(() => {
    let cancelled = false;
    fetchProject({ isCancelled: () => cancelled });
    return () => {
      cancelled = true;
    };
  }, [fetchProject]);

  const handleAddLog = async () => {
    if (!newLog.trim() || savingLog || deletingLogIndex !== null) return;
    setSavingLog(true);
    try {
      const timestamp = new Date().toLocaleString('pt-BR');
      const tagPrefix = logTag ? `[${logTag}] ` : '';
      const logEntry = `v${project.version || '1.0'}: ${tagPrefix}${newLog.trim()} (${timestamp})`;
      
      await addProjectLog(id, logEntry);
      if (!isMountedRef.current) return;

      setProject(prev => (prev ? {
        ...prev,
        changelog: [...(prev.changelog || []), logEntry]
      } : prev));
      setNewLog('');
      setIsAddingLog(false);
      setShowAllLogs(true);
      toast.success('Atualização registrada no Diário de Bordo.');
    } catch (error) {
      console.error(error);
      if (isMountedRef.current) toast.error('Erro ao salvar atualização.');
    } finally {
      if (isMountedRef.current) setSavingLog(false);
    }
  };

  const handleDeleteLog = async (originalIndex) => {
    if (deletingLogIndex !== null || savingLog) return;
    const confirmed = await confirm({
      title: 'Excluir Registro',
      message: 'Tem certeza que deseja remover este registro do diário de bordo?',
      danger: true,
      confirmLabel: 'Excluir'
    });
    if (!confirmed || !isMountedRef.current) return;

    setDeletingLogIndex(originalIndex);
    try {
      const newChangelog = (project?.changelog || []).filter((_, idx) => idx !== originalIndex);
      await setProjectLogs(id, newChangelog);
      if (!isMountedRef.current) return;

      setProject(prev => (prev ? {
        ...prev,
        changelog: newChangelog
      } : prev));
      toast.success('Registro excluído com sucesso.');
    } catch (error) {
      console.error(error);
      if (isMountedRef.current) toast.error('Erro ao excluir log.');
    } finally {
      if (isMountedRef.current) setDeletingLogIndex(null);
    }
  };

  const handleSaveChanges = async (e) => {
    e.preventDefault();
    if (savingEdit) return;
    const rawCover = editFormData.coverImage?.trim() || '';
    if (rawCover && !safeImageUrl(rawCover)) {
      toast.error('URL da imagem de capa inválida.');
      return;
    }
    setSavingEdit(true);
    try {
      const payload = {
        name: editFormData.name?.trim() || project.name,
        description: editFormData.description?.trim() || '',
        status: editFormData.status || 'Planejamento',
        priority: editFormData.priority || 'Média',
        leader: editFormData.leader?.trim() || '',
        budget: editFormData.budget ? parseBRL(editFormData.budget) : '',
        coverImage: rawCover,
        deadline: editFormData.deadline || '',
        progress: Number(editFormData.progress) || 0,
        version: editFormData.version?.trim() || '1.0',
        team: editFormData.team || []
      };

      await updateProject(id, payload);
      if (!isMountedRef.current) return;
      setProject(prev => (prev ? { ...prev, ...payload } : prev));
      setIsEditModalOpen(false);
      toast.success('Projeto atualizado com sucesso.');
    } catch (error) {
      console.error(error);
      if (isMountedRef.current) toast.error('Erro ao atualizar projeto.');
    } finally {
      if (isMountedRef.current) setSavingEdit(false);
    }
  };

  const openEditModal = () => {
    setEditFormData({
      name: project.name || '',
      description: project.description || '',
      status: project.status || 'Planejamento',
      priority: project.priority || 'Média',
      leader: project.leader || '',
      budget: project.budget || '',
      coverImage: project.coverImage || '',
      deadline: project.deadline || '',
      progress: project.progress || 0,
      version: project.version || '1.0',
      team: project.team || []
    });
    setIsEditModalOpen(true);
  };

  const safeRenderLog = (log) => {
    let version = '';
    let content = '';
    let date = '';

    if (typeof log === 'string') {
      const parts = log.split(':');
      if (parts[0].includes('v')) {
        version = parts[0].trim();
        content = parts.slice(1).join(':').trim();
      } else {
        content = log.trim();
      }
      // Extrair data ou timestamp de parênteses no final da mensagem, se presente
      const dateMatch = content.match(/\(([^)]+)\)$/);
      if (dateMatch) {
        date = dateMatch[1].trim();
        content = content.replace(/\s*\([^)]+\)$/, '').trim();
      }
    } else if (typeof log === 'object' && log !== null) {
      version = log.version ? `v${log.version}` : '';
      content = log.notes || log.descricao || JSON.stringify(log);
      date = log.date || '';
    }

    return { version, content, date };
  };

  if (loading) {
    return (
      <div role="status" className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center">
          <RefreshCcw size={36} className="animate-spin text-brand-aa mb-3" aria-hidden="true" />
          <p className="text-sm font-bold text-slate-500 dark:text-zinc-400">Carregando detalhes do projeto…</p>
        </div>
      </div>
    );
  }

  if (loadError || !project) {
    return (
      <div className="p-4 md:p-8 max-w-4xl mx-auto animate-fade-in">
        <div
          role="alert"
          className="rounded-2xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        >
          <div className="flex items-start gap-3">
            <AlertCircle size={22} className="text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <h1 className="text-base font-bold text-rose-900 dark:text-rose-200">
                Erro ao carregar detalhes do projeto
              </h1>
              <p className="text-xs text-rose-700 dark:text-rose-300 mt-1">
                {loadError || 'O projeto solicitado não pôde ser exibido no momento.'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => navigate('/projects')}
              className="inline-flex items-center justify-center gap-2 px-4 min-h-[44px] rounded-xl bg-white dark:bg-[#111113] border border-slate-200 dark:border-zinc-700 text-xs font-bold text-slate-700 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <ArrowLeft size={15} aria-hidden="true" /> Voltar
            </button>
            <button
              type="button"
              onClick={fetchProject}
              className="inline-flex items-center justify-center gap-2 px-4 min-h-[44px] rounded-xl bg-white dark:bg-[#111113] border border-rose-200 dark:border-rose-800 text-xs font-bold text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-950/60 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
            >
              <RefreshCcw size={15} aria-hidden="true" /> Tentar novamente
            </button>
          </div>
        </div>
      </div>
    );
  }

  const renderLogs = () => {
    if (!project.changelog || project.changelog.length === 0) return [];
    const seenCounts = new Map();
    const entries = project.changelog.map((log, originalIndex) => {
      const baseKey = log && typeof log === 'object' ? (log.id || JSON.stringify(log)) : String(log);
      const count = seenCounts.get(baseKey) || 0;
      seenCounts.set(baseKey, count + 1);
      return {
        log,
        originalIndex,
        entryKey: `${baseKey}#${count}`,
      };
    });
    const allLogs = entries.reverse();
    return showAllLogs ? allLogs : allLogs.slice(0, 4);
  };

  const visibleLogs = renderLogs();
  const totalLogs = project.changelog?.length || 0;
  const projectInitials = (project.name || 'P').substring(0, 2).toUpperCase();
  const priorityInfo = getPriorityBadge(project.priority);
  const deadlineEnd = project.deadline ? endOfLocalDay(project.deadline) : null;
  const isDelayed = Boolean(deadlineEnd) && deadlineEnd < new Date() && project.status !== 'Concluído';
  const safeCover = safeImageUrl(project.coverImage);

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto pb-24 animate-fade-in space-y-8">

      {/* Topo com navegação e botão de edição */}
      <div className="flex justify-between items-center gap-3">
        <button
          type="button"
          onClick={() => navigate('/projects')}
          className="inline-flex items-center gap-2 min-h-[44px] px-2 -ml-2 rounded-xl text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-[#fafafa] font-bold text-sm transition-colors group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand active:scale-[0.98]"
        >
          <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform" aria-hidden="true" /> Voltar ao Portfólio
        </button>
        {canWrite && (
          <button
            type="button"
            onClick={openEditModal}
            className="inline-flex items-center gap-2 px-5 min-h-[44px] bg-white dark:bg-[#111113] border border-slate-200 dark:border-zinc-800 rounded-2xl text-xs font-bold text-slate-700 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-900 shadow-sm transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <Edit3 size={16} aria-hidden="true" /> Editar Projeto
          </button>
        )}
      </div>

      {/* Hero Banner do Projeto */}
      <div className="bg-white dark:bg-[#111113] rounded-3xl border border-slate-200/80 dark:border-zinc-800 shadow-sm overflow-hidden relative">
        {safeCover ? (
          <div className="h-40 w-full bg-cover bg-center absolute top-0 left-0 opacity-15" style={{ backgroundImage: `url("${safeCover}")` }} />
        ) : (
          <div className="h-40 w-full bg-gradient-to-r from-brand/15 via-sky-500/10 to-brand/5 absolute top-0 left-0" />
        )}

        <div className="relative z-10 p-6 md:p-10 pt-10 flex flex-col md:flex-row gap-6 md:gap-8 items-start justify-between">
          <div className="flex flex-col sm:flex-row gap-5 items-start min-w-0 flex-1">
            {safeCover ? (
              <img
                src={safeCover}
                className="w-20 h-20 md:w-24 md:h-24 rounded-2xl object-cover shadow-lg border-4 border-white dark:border-zinc-800 bg-white dark:bg-[#111113] shrink-0"
                alt=""
              />
            ) : (
              <div className="w-20 h-20 md:w-24 md:h-24 rounded-2xl shadow-lg border-4 border-white dark:border-zinc-800 bg-brand text-brand-fg flex items-center justify-center font-black text-2xl md:text-3xl shrink-0">
                {projectInitials}
              </div>
            )}

            <div className="space-y-3 min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl md:text-3xl font-black text-slate-900 dark:text-[#fafafa] tracking-tight leading-tight">
                  {project.name}
                </h1>
                <span className="px-3 py-1 bg-slate-900 dark:bg-zinc-900 text-white text-xs font-mono font-bold rounded-lg shadow-sm tabular-nums border border-transparent dark:border-zinc-700">
                  v{project.version || '1.0'}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className={`px-3 py-1 rounded-xl font-bold uppercase border ${getStatusColor(project.status)}`}>
                  {project.status}
                </span>

                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl font-bold border ${priorityInfo.bg}`}>
                  <span className={`w-2 h-2 rounded-full ${priorityInfo.dot}`} aria-hidden="true" />
                  Prioridade: {priorityInfo.label}
                </span>

                <div className="flex items-center gap-2 bg-slate-50 dark:bg-zinc-900 px-3 py-1 rounded-xl border border-slate-100 dark:border-zinc-800 text-slate-700 dark:text-zinc-200">
                  <User size={14} className="text-brand-aa" aria-hidden="true" />
                  <span className="font-bold">{project.leader || 'Líder Não Informado'}</span>
                </div>

                <div className={`flex items-center gap-2 px-3 py-1 rounded-xl border tabular-nums ${
                  isDelayed
                    ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900/60'
                    : 'bg-slate-50 dark:bg-zinc-900 border-slate-100 dark:border-zinc-800 text-slate-700 dark:text-zinc-200'
                }`}>
                  <Calendar size={14} className={isDelayed ? 'text-rose-500' : 'text-slate-400'} aria-hidden="true" />
                  <span className="font-bold">
                    {project.deadline ? formatDateBR(project.deadline) : 'Sem prazo'}
                  </span>
                  {isDelayed && <span className="font-black text-xs uppercase">(Atrasado)</span>}
                </div>
              </div>
            </div>
          </div>

          {/* Progresso Geral */}
          <div className="bg-slate-50 dark:bg-zinc-900/90 p-5 rounded-2xl border border-slate-200 dark:border-zinc-800 shadow-sm min-w-[180px] text-center w-full md:w-auto">
            <p className="text-xs font-black text-slate-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Progresso Global</p>
            <div className="flex justify-center items-end gap-1">
              <span className={`text-4xl font-black tabular-nums ${project.progress === 100 ? 'text-emerald-600 dark:text-emerald-400' : 'text-brand-aa'}`}>
                {project.progress || 0}%
              </span>
            </div>
            <div className="w-full bg-slate-200 dark:bg-zinc-800 h-2 rounded-full mt-3 overflow-hidden">
              <div
                className={`h-full transition-[width] duration-500 ${project.progress === 100 ? 'bg-emerald-500' : 'bg-brand'}`}
                style={{ width: `${project.progress || 0}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Grid de Informações e Diário de Bordo */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

        {/* Coluna Esquerda: Escopo, Finanças, Equipe */}
        <div className="lg:col-span-1 space-y-6">
          {/* Card Escopo */}
          <div className="bg-white dark:bg-[#111113] p-6 rounded-3xl border border-slate-200/80 dark:border-zinc-800 shadow-sm space-y-3">
            <h2 className="font-black text-slate-900 dark:text-[#fafafa] flex items-center gap-2 text-xs uppercase tracking-wider">
              <Target size={18} className="text-brand-aa" aria-hidden="true" /> Escopo &amp; Diretrizes
            </h2>
            <p className="text-xs text-slate-600 dark:text-zinc-300 leading-relaxed whitespace-pre-wrap">
              {project.description || 'Nenhum escopo detalhado cadastrado para esta iniciativa.'}
            </p>
          </div>

          {/* Cards Financeiro & Prioridade */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-emerald-50/60 dark:bg-emerald-950/20 p-5 rounded-3xl border border-emerald-100 dark:border-emerald-900/40">
              <div className="flex items-center gap-2 mb-2 text-emerald-800 dark:text-emerald-300">
                <DollarSign size={18} aria-hidden="true" /><span className="text-xs font-bold uppercase">Orçamento</span>
              </div>
              <p className="text-lg font-black text-emerald-900 dark:text-emerald-100 truncate tabular-nums">
                {formatBRL(project.budget)}
              </p>
            </div>

            <div className={`p-5 rounded-3xl border ${priorityInfo.bg}`}>
              <div className="flex items-center gap-2 mb-2">
                <BarChart3 size={18} aria-hidden="true" /><span className="text-xs font-bold uppercase">Prioridade</span>
              </div>
              <p className="text-lg font-black">{project.priority || 'Média'}</p>
            </div>
          </div>

          {/* Card Equipe Técnica */}
          <div className="bg-white dark:bg-[#111113] p-6 rounded-3xl border border-slate-200/80 dark:border-zinc-800 shadow-sm space-y-4">
            <h2 className="font-black text-slate-900 dark:text-[#fafafa] flex items-center gap-2 text-xs uppercase tracking-wider">
              <Users size={18} className="text-brand-aa" aria-hidden="true" /> Equipe Técnica Alocada
            </h2>

            <div className="space-y-3">
              {project.leader && (
                <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-50 dark:bg-zinc-900 border border-slate-100 dark:border-zinc-800">
                  <div className="w-9 h-9 rounded-full bg-brand/10 text-brand-aa flex items-center justify-center font-bold text-xs uppercase shrink-0">
                    {project.leader.substring(0, 2)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-900 dark:text-[#fafafa] truncate">{project.leader}</p>
                    <span className="text-xs text-brand-aa font-bold uppercase">Líder do Projeto</span>
                  </div>
                </div>
              )}

              {Array.isArray(project.team) && project.team.length > 0 ? (
                <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-zinc-800">
                  <p className="text-xs font-bold text-slate-500 dark:text-zinc-400 uppercase tabular-nums">Integrantes ({project.team.length})</p>
                  <div className="flex flex-wrap gap-2">
                    {project.team.map((m, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 text-xs font-medium"
                      >
                        <User size={12} className="text-slate-400" aria-hidden="true" />
                        {m}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-500 dark:text-zinc-400 italic">Nenhum membro adicional alocado à equipe.</p>
              )}
            </div>
          </div>
        </div>

        {/* Coluna Direita: Diário de Bordo (Changelog & Sprints) */}
        <div className="lg:col-span-2">
          <div className="bg-white dark:bg-[#111113] rounded-3xl border border-slate-200/80 dark:border-zinc-800 shadow-sm overflow-hidden flex flex-col">

            <div className="p-6 border-b border-slate-100 dark:border-zinc-800 flex flex-wrap justify-between items-center gap-3 bg-slate-50/60 dark:bg-zinc-900/60">
              <div>
                <h2 className="font-black text-slate-900 dark:text-[#fafafa] flex items-center gap-2">
                  <FileText size={20} className="text-brand-aa" aria-hidden="true" /> Diário de Bordo &amp; Histórico
                </h2>
                <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">Registro cronológico de entregas, marcos e decisões de arquitetura.</p>
              </div>

              {canWrite && !isAddingLog && (
                <button
                  type="button"
                  onClick={() => setIsAddingLog(true)}
                  className="bg-brand hover:bg-brand-dark text-brand-fg px-4 min-h-[44px] rounded-xl text-xs font-bold flex items-center gap-2 shadow-sm transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  <Plus size={16} aria-hidden="true" /> Nova Atualização
                </button>
              )}
            </div>

            {/* Formulário de Adicionar Log */}
            {isAddingLog && (
              <div className="p-6 bg-slate-50 dark:bg-zinc-900/90 border-b border-slate-200 dark:border-zinc-800 animate-slide-down space-y-3">
                <div className="flex flex-wrap justify-between items-center gap-2">
                  <p className="text-xs font-bold text-brand-aa uppercase flex items-center gap-1.5 tabular-nums">
                    <Sparkles size={14} aria-hidden="true" /> Atualização para v{project.version || '1.0'}
                  </p>

                  {/* Categoria do Log */}
                  <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold">
                    {['Marco', 'Sprint', 'Ajuste', 'Deploy', 'Decisão'].map(tg => (
                      <button
                        key={tg}
                        type="button"
                        aria-pressed={logTag === tg}
                        onClick={() => setLogTag(tg)}
                        className={`px-3 min-h-[44px] rounded-xl border transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                          logTag === tg
                            ? 'bg-brand text-brand-fg border-brand'
                            : 'bg-white dark:bg-[#111113] text-slate-700 dark:text-zinc-300 border-slate-200 dark:border-zinc-700'
                        }`}
                      >
                        {tg}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label htmlFor="new-project-log" className="sr-only">Descrição da atualização no diário de bordo</label>
                  <textarea
                    ref={newLogRef}
                    id="new-project-log"
                    name="new-project-log"
                    disabled={savingLog}
                    value={newLog}
                    onChange={e => setNewLog(e.target.value)}
                    className="w-full min-h-[44px] p-4 border border-slate-200 dark:border-zinc-700 rounded-2xl text-xs leading-relaxed bg-white dark:bg-[#111113] text-slate-900 dark:text-[#fafafa] placeholder:text-slate-400 dark:placeholder:text-zinc-500 shadow-sm transition-colors hover:border-slate-300 dark:hover:border-zinc-600 active:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:border-brand disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-zinc-900 aria-[invalid=true]:border-rose-500 aria-[invalid=true]:focus-visible:ring-rose-500"
                    rows="4"
                    placeholder="Descreva o que foi concluído nesta sprint ou marco técnico…"
                  />
                </div>

                <div className="flex justify-end gap-3 pt-1">
                  <button
                    type="button"
                    disabled={savingLog}
                    onClick={() => setIsAddingLog(false)}
                    className="px-4 min-h-[44px] rounded-xl text-xs font-bold text-slate-600 dark:text-zinc-300 hover:text-slate-900 dark:hover:text-[#fafafa] hover:bg-slate-200/50 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={savingLog || !newLog.trim()}
                    onClick={handleAddLog}
                    className="px-5 min-h-[44px] bg-brand hover:bg-brand-dark text-brand-fg rounded-xl text-xs font-bold shadow-sm flex items-center gap-2 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
                  >
                    {savingLog ? <RefreshCcw size={16} className="animate-spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
                    {savingLog ? 'Salvando…' : 'Salvar Registro'}
                  </button>
                </div>
              </div>
            )}

            {/* Linha do tempo de logs */}
            <div className="p-6 space-y-6">
              {totalLogs === 0 ? (
                <div className="text-center py-12 text-slate-500 dark:text-zinc-400">
                  <BarChart3 size={48} className="mx-auto mb-3 opacity-20" aria-hidden="true" />
                  <p className="text-sm font-bold">Nenhum marco registrado ainda.</p>
                  <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">Use o botão acima para registrar o primeiro marco do projeto.</p>
                </div>
              ) : (
                visibleLogs.map(({ log, originalIndex, entryKey }, index) => {
                  const { version, content, date } = safeRenderLog(log);
                  return (
                    <div key={entryKey} className="flex gap-4 group/item [content-visibility:auto] [contain-intrinsic-size:auto_56px]">
                      <div className="flex flex-col items-center">
                        <div className="w-9 h-9 rounded-full bg-white dark:bg-[#111113] flex items-center justify-center border-2 border-slate-200 dark:border-zinc-700 group-hover/item:border-brand group-hover/item:text-brand-aa text-slate-400 transition-colors shadow-sm z-10 shrink-0">
                          <CheckCircle2 size={18} aria-hidden="true" />
                        </div>
                        {(index !== visibleLogs.length - 1) && (
                          <div className="w-0.5 h-full bg-slate-100 dark:bg-zinc-800 -my-2 group-hover/item:bg-brand/30 transition-colors" />
                        )}
                      </div>

                      <div className="pb-6 flex-1 min-w-0">
                        <div className="bg-slate-50/80 dark:bg-zinc-900 p-5 rounded-2xl border border-slate-100 dark:border-zinc-800 group-hover/item:border-brand/40 group-hover/item:shadow-sm transition-colors relative">
                          {canWrite && (
                            <button
                              type="button"
                              disabled={deletingLogIndex !== null || savingLog}
                              onClick={() => handleDeleteLog(originalIndex)}
                              aria-label="Excluir registro do diário"
                              className="absolute top-2 right-2 min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-slate-400 dark:text-zinc-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-xl opacity-100 md:opacity-0 md:group-hover/item:opacity-100 focus-visible:opacity-100 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-50 disabled:cursor-not-allowed z-20"
                              title="Excluir Registro"
                            >
                              <Trash2 size={15} aria-hidden="true" />
                            </button>
                          )}

                          <div className="flex flex-wrap justify-between items-center mb-2 pb-2 border-b border-slate-200/60 dark:border-zinc-800 pr-12">
                            <div className="flex items-center gap-2">
                              {version && (
                                <span className="text-xs font-black bg-slate-900 dark:bg-zinc-950 text-white px-2 py-0.5 rounded tabular-nums">
                                  {version}
                                </span>
                              )}
                              <span className="text-xs font-bold text-slate-500 dark:text-zinc-400 flex items-center gap-1 font-mono tabular-nums">
                                <Clock size={12} aria-hidden="true" /> {date || 'Registro'}
                              </span>
                            </div>
                          </div>

                          <div className="text-xs text-slate-700 dark:text-zinc-200 font-medium leading-relaxed whitespace-pre-wrap">
                            {content}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Controle de expansão do painel de histórico */}
            {totalLogs > 4 && (
              <div className="p-4 border-t border-slate-100 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-900/50 flex justify-center">
                <button
                  type="button"
                  onClick={() => setShowAllLogs(!showAllLogs)}
                  className="inline-flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-zinc-300 hover:text-slate-900 dark:hover:text-[#fafafa] bg-white dark:bg-[#111113] px-4 min-h-[44px] rounded-full border border-slate-200 dark:border-zinc-800 shadow-sm transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand tabular-nums"
                >
                  {showAllLogs ? (
                    <><ChevronUp size={15} aria-hidden="true" /> Recolher Histórico ({totalLogs})</>
                  ) : (
                    <><ChevronDown size={15} aria-hidden="true" /> Ver histórico completo ({totalLogs})</>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal de Edição de Projeto */}
      {isEditModalOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overscroll-contain"
          onClick={(e) => {
            if (e.target === e.currentTarget && !savingEdit) setIsEditModalOpen(false);
          }}
        >
          <div
            ref={editModalRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby={editModalTitleId}
            className="bg-white dark:bg-[#111113] rounded-3xl shadow-2xl w-full max-w-xl p-6 md:p-8 animate-zoom-in max-h-[92vh] overflow-y-auto overscroll-contain border border-slate-200 dark:border-zinc-800"
          >
            <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-100 dark:border-zinc-800">
              <h2 id={editModalTitleId} className="text-xl font-black text-slate-900 dark:text-[#fafafa] flex items-center gap-2">
                <Edit3 size={20} className="text-brand-aa" aria-hidden="true" /> Editar Dados do Projeto
              </h2>
              <button
                type="button"
                disabled={savingEdit}
                onClick={() => setIsEditModalOpen(false)}
                aria-label="Fechar janela de edição"
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-slate-500 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-[#fafafa] hover:bg-slate-100 dark:hover:bg-zinc-800 rounded-xl transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={handleSaveChanges} className="space-y-4">
              <div>
                <label htmlFor="edit-proj-name" className="text-xs font-bold text-slate-600 dark:text-zinc-300 uppercase block mb-1">Nome do Projeto</label>
                <input
                  ref={editFirstInputRef}
                  id="edit-proj-name"
                  name="edit-proj-name"
                  required
                  value={editFormData.name}
                  onChange={e => setEditFormData({ ...editFormData, name: e.target.value })}
                  className={`${editFieldClass} font-bold text-sm`}
                />
              </div>

              <div>
                <label htmlFor="edit-proj-cover" className="text-xs font-bold text-slate-600 dark:text-zinc-300 uppercase block mb-1">URL da Imagem de Capa</label>
                <input
                  id="edit-proj-cover"
                  name="edit-proj-cover"
                  value={editFormData.coverImage}
                  onChange={e => setEditFormData({ ...editFormData, coverImage: e.target.value })}
                  className={`${editFieldClass} text-xs font-mono`}
                  placeholder="https://…"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="edit-proj-version" className="text-xs font-bold text-slate-600 dark:text-zinc-300 uppercase block mb-1">Versão</label>
                  <input
                    id="edit-proj-version"
                    name="edit-proj-version"
                    value={editFormData.version}
                    onChange={e => setEditFormData({ ...editFormData, version: e.target.value })}
                    className={`${editFieldClass} font-mono text-sm tabular-nums`}
                  />
                </div>
                <div>
                  <label htmlFor="edit-proj-progress" className="text-xs font-bold text-slate-600 dark:text-zinc-300 uppercase block mb-1">Progresso (%)</label>
                  <input
                    id="edit-proj-progress"
                    name="edit-proj-progress"
                    type="number"
                    min="0"
                    max="100"
                    value={editFormData.progress}
                    onChange={e => setEditFormData({ ...editFormData, progress: e.target.value })}
                    className={`${editFieldClass} text-sm font-bold tabular-nums`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="edit-proj-leader" className="text-xs font-bold text-slate-600 dark:text-zinc-300 uppercase block mb-1">Líder do Projeto</label>
                  <select
                    id="edit-proj-leader"
                    name="edit-proj-leader"
                    value={editFormData.leader}
                    onChange={e => setEditFormData({ ...editFormData, leader: e.target.value })}
                    className={`${editFieldClass} text-sm cursor-pointer`}
                  >
                    <option value="">Selecione…</option>
                    {employees.map(emp => <option key={emp.id} value={emp.name}>{emp.name}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="edit-proj-budget" className="text-xs font-bold text-slate-600 dark:text-zinc-300 uppercase block mb-1">Orçamento (R$)</label>
                  <input
                    id="edit-proj-budget"
                    name="edit-proj-budget"
                    type="text"
                    value={editFormData.budget}
                    onChange={e => setEditFormData({ ...editFormData, budget: e.target.value })}
                    className={`${editFieldClass} text-sm font-mono tabular-nums`}
                    placeholder="Ex: 50.000,00 ou 50000"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="edit-proj-status" className="text-xs font-bold text-slate-600 dark:text-zinc-300 uppercase block mb-1">Status</label>
                  <select
                    id="edit-proj-status"
                    name="edit-proj-status"
                    value={editFormData.status}
                    onChange={e => setEditFormData({ ...editFormData, status: e.target.value })}
                    className={`${editFieldClass} text-sm cursor-pointer`}
                  >
                    <option>Planejamento</option>
                    <option>Em Andamento</option>
                    <option>Pausado</option>
                    <option>Concluído</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="edit-proj-priority" className="text-xs font-bold text-slate-600 dark:text-zinc-300 uppercase block mb-1">Prioridade</label>
                  <select
                    id="edit-proj-priority"
                    name="edit-proj-priority"
                    value={editFormData.priority}
                    onChange={e => setEditFormData({ ...editFormData, priority: e.target.value })}
                    className={`${editFieldClass} text-sm cursor-pointer`}
                  >
                    <option>Baixa</option>
                    <option>Média</option>
                    <option>Alta</option>
                    <option>Crítica</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="edit-proj-deadline" className="text-xs font-bold text-slate-600 dark:text-zinc-300 uppercase block mb-1">Prazo de Entrega</label>
                <input
                  id="edit-proj-deadline"
                  name="edit-proj-deadline"
                  type="date"
                  value={editFormData.deadline}
                  onChange={e => setEditFormData({ ...editFormData, deadline: e.target.value })}
                  className={`${editFieldClass} text-sm tabular-nums`}
                />
              </div>

              <div>
                <span id="edit-proj-team-label" className="text-xs font-bold text-slate-600 dark:text-zinc-300 uppercase block mb-1">Equipe Técnica</span>
                <div role="group" aria-labelledby="edit-proj-team-label" className="max-h-32 overflow-y-auto border border-slate-200 dark:border-zinc-700 bg-white dark:bg-[#111113] rounded-xl p-2 space-y-1 custom-scrollbar">
                  {employees.map(emp => {
                    const isSelected = (editFormData.team || []).includes(emp.name);
                    const checkboxId = `edit-proj-team-${emp.id}`;
                    return (
                      <label htmlFor={checkboxId} key={emp.id} className="flex items-center gap-2.5 text-xs px-2 min-h-[44px] rounded-lg hover:bg-slate-50 dark:hover:bg-zinc-800 cursor-pointer text-slate-800 dark:text-zinc-200">
                        <input
                          id={checkboxId}
                          name={`edit-proj-team-${emp.id}`}
                          type="checkbox"
                          checked={isSelected}
                          onChange={e => {
                            if (e.target.checked) {
                              setEditFormData(prev => ({ ...prev, team: [...(prev.team || []), emp.name] }));
                            } else {
                              setEditFormData(prev => ({ ...prev, team: (prev.team || []).filter(n => n !== emp.name) }));
                            }
                          }}
                          className="h-4 w-4 rounded accent-brand transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60 disabled:cursor-not-allowed"
                        />
                        <span>{emp.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <label htmlFor="edit-proj-desc" className="text-xs font-bold text-slate-600 dark:text-zinc-300 uppercase block mb-1">Descrição / Escopo</label>
                <textarea
                  id="edit-proj-desc"
                  name="edit-proj-desc"
                  value={editFormData.description}
                  onChange={e => setEditFormData({ ...editFormData, description: e.target.value })}
                  className={`${editFieldClass} text-xs leading-relaxed`}
                  rows="3"
                />
              </div>

              <div className="flex gap-3 pt-3 border-t border-slate-100 dark:border-zinc-800">
                <button
                  type="button"
                  disabled={savingEdit}
                  onClick={() => setIsEditModalOpen(false)}
                  className="flex-1 min-h-[44px] bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-xl font-bold text-slate-700 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50 text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="flex-1 bg-brand hover:bg-brand-dark text-brand-fg min-h-[44px] rounded-xl font-bold shadow-sm transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand flex items-center justify-center gap-2 disabled:opacity-50 text-sm"
                >
                  {savingEdit ? <RefreshCcw size={18} className="animate-spin" aria-hidden="true" /> : null}
                  {savingEdit ? 'Salvando…' : 'Salvar Alterações'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectDetails;