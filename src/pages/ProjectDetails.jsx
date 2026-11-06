// src/pages/ProjectDetails.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getProject, updateProject, addProjectLog, setProjectLogs } from '../services/projectService';
import { getEmployees } from '../services/employeeService';
import { useAuth } from '../contexts/AuthContext';
import { can } from '../utils/permissions';
import { useConfirm } from '../components/ConfirmDialog';
import { formatDateBR } from '../utils/dates';
import { 
  ArrowLeft, Calendar, User, CheckCircle, 
  FileText, Plus, Save, Clock, Target, Edit3, X, 
  BarChart3, DollarSign, Users, ImageIcon, Trash2, 
  ChevronDown, ChevronUp, RefreshCcw, Sparkles, AlertCircle,
  TrendingUp, CheckCircle2, ShieldCheck, Tag
} from 'lucide-react';
import { toast } from 'sonner';
import { parseBRL, formatBRL } from '../utils/currency';

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

const getStatusColor = (s) => {
  switch(s) {
    case 'Em Andamento': 
    case 'Revisão':
      return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800';
    case 'Concluído': 
      return 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
    case 'Pausado': 
      return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800';
    default: 
      return 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-600';
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
  
  const [isAddingLog, setIsAddingLog] = useState(false);
  const [newLog, setNewLog] = useState('');
  const [logTag, setLogTag] = useState('Marco');
  const [savingLog, setSavingLog] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  
  const [showAllLogs, setShowAllLogs] = useState(false); 
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editFormData, setEditFormData] = useState({});

  const fetchProject = useCallback(async () => {
    try {
      const [data, empList] = await Promise.all([
        getProject(id),
        tenantId ? getEmployees(tenantId) : Promise.resolve([])
      ]);

      if (data) {
        if (data.tenantId && tenantId && data.tenantId !== tenantId) {
          toast.error('Acesso não autorizado a este projeto.');
          navigate('/projects');
          return;
        }
        setProject(data);
      } else {
        toast.error('Projeto não encontrado.');
        navigate('/projects');
      }
      setEmployees(empList || []);
    } catch (error) {
      console.error('Erro ao buscar projeto:', error);
      toast.error('Erro ao carregar detalhes do projeto.');
      navigate('/projects');
    } finally {
      setLoading(false);
    }
  }, [id, tenantId, navigate]);

  useEffect(() => {
    fetchProject();
  }, [fetchProject]);

  const handleAddLog = async () => {
    if (!newLog.trim()) return;
    setSavingLog(true);
    try {
      const timestamp = new Date().toLocaleString('pt-BR');
      const tagPrefix = logTag ? `[${logTag}] ` : '';
      const logEntry = `v${project.version || '1.0'}: ${tagPrefix}${newLog.trim()} (${timestamp})`;
      
      await addProjectLog(id, logEntry);

      setProject(prev => ({
        ...prev,
        changelog: [...(prev.changelog || []), logEntry]
      }));
      setNewLog('');
      setIsAddingLog(false);
      setShowAllLogs(true);
      toast.success('Atualização registrada no Diário de Bordo.');
    } catch (error) {
      console.error(error);
      toast.error('Erro ao salvar atualização.');
    } finally {
      setSavingLog(false);
    }
  };

  const handleDeleteLog = async (logToDelete) => {
    const confirmed = await confirm({
      title: 'Excluir Registro',
      message: 'Tem certeza que deseja remover este registro do diário de bordo?',
      danger: true,
      confirmLabel: 'Excluir'
    });
    if (!confirmed) return;

    try {
      const newChangelog = (project.changelog || []).filter(log => log !== logToDelete);
      await setProjectLogs(id, newChangelog);

      setProject(prev => ({
        ...prev,
        changelog: newChangelog
      }));
      toast.success('Registro excluído com sucesso.');
    } catch (error) {
      console.error(error);
      toast.error('Erro ao excluir log.');
    }
  };

  const handleSaveChanges = async (e) => {
    e.preventDefault();
    setSavingEdit(true);
    try {
      const payload = {
        name: editFormData.name?.trim() || project.name,
        description: editFormData.description?.trim() || '',
        status: editFormData.status || 'Planejamento',
        priority: editFormData.priority || 'Média',
        leader: editFormData.leader?.trim() || '',
        budget: editFormData.budget ? parseBRL(editFormData.budget) : '',
        coverImage: editFormData.coverImage?.trim() || '',
        deadline: editFormData.deadline || '',
        progress: Number(editFormData.progress) || 0,
        version: editFormData.version?.trim() || '1.0',
        team: editFormData.team || []
      };

      await updateProject(id, payload);
      setProject(prev => ({ ...prev, ...payload }));
      setIsEditModalOpen(false);
      toast.success('Projeto atualizado com sucesso.');
    } catch (error) {
      console.error(error);
      toast.error('Erro ao atualizar projeto.');
    } finally {
      setSavingEdit(false);
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
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center">
          <RefreshCcw size={36} className="animate-spin text-brand mb-3" />
          <p className="text-sm font-bold text-slate-400">Carregando detalhes do projeto...</p>
        </div>
      </div>
    );
  }

  if (!project) return null;

  const renderLogs = () => {
    if (!project.changelog || project.changelog.length === 0) return [];
    const allLogs = [...project.changelog].reverse();
    return showAllLogs ? allLogs : allLogs.slice(0, 4);
  };

  const visibleLogs = renderLogs();
  const totalLogs = project.changelog?.length || 0;
  const projectInitials = (project.name || 'P').substring(0, 2).toUpperCase();
  const priorityInfo = getPriorityBadge(project.priority);
  const isDelayed = project.deadline && new Date(project.deadline) < new Date() && project.status !== 'Concluído';

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto pb-24 animate-fade-in space-y-8">
      
      {/* Topo com navegação e botão de edição */}
      <div className="flex justify-between items-center">
        <button 
          onClick={() => navigate('/projects')} 
          className="flex items-center gap-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white font-bold text-sm transition-colors group"
        >
          <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform" /> Voltar ao Portfólio
        </button>
        {canWrite && (
          <button 
            onClick={openEditModal} 
            className="flex items-center gap-2 px-5 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 shadow-sm transition-all"
          >
            <Edit3 size={16}/> Editar Projeto
          </button>
        )}
      </div>
      
      {/* Hero Banner do Projeto */}
      <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-200/80 dark:border-slate-700 shadow-sm overflow-hidden relative">
        {project.coverImage ? (
          <div className="h-40 w-full bg-cover bg-center absolute top-0 left-0 opacity-15" style={{ backgroundImage: `url(${project.coverImage})` }} />
        ) : (
          <div className="h-40 w-full bg-gradient-to-r from-blue-600/15 via-purple-600/15 to-brand/15 absolute top-0 left-0" />
        )}
        
        <div className="relative z-10 p-6 md:p-10 pt-10 flex flex-col md:flex-row gap-6 md:gap-8 items-start justify-between">
          <div className="flex flex-col sm:flex-row gap-5 items-start min-w-0 flex-1">
            {project.coverImage ? (
              <img 
                src={project.coverImage} 
                className="w-20 h-20 md:w-24 md:h-24 rounded-2xl object-cover shadow-lg border-4 border-white dark:border-slate-700 bg-white dark:bg-slate-800 shrink-0" 
                alt="Logo"
              />
            ) : (
              <div className="w-20 h-20 md:w-24 md:h-24 rounded-2xl shadow-lg border-4 border-white dark:border-slate-700 bg-gradient-to-br from-indigo-500 via-purple-600 to-brand flex items-center justify-center text-white font-black text-2xl md:text-3xl shrink-0">
                {projectInitials}
              </div>
            )}

            <div className="space-y-3 min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl md:text-3xl font-black text-slate-900 dark:text-white tracking-tight leading-tight">
                  {project.name}
                </h1>
                <span className="px-3 py-1 bg-slate-900 dark:bg-slate-950 text-white text-xs font-mono font-bold rounded-lg shadow-sm">
                  v{project.version || '1.0'}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className={`px-3 py-1 rounded-xl font-bold uppercase border ${getStatusColor(project.status)}`}>
                  {project.status}
                </span>

                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl font-bold border ${priorityInfo.bg}`}>
                  <span className={`w-2 h-2 rounded-full ${priorityInfo.dot}`} />
                  Prioridade: {priorityInfo.label}
                </span>

                <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-900 px-3 py-1 rounded-xl border border-slate-100 dark:border-slate-700 text-slate-700 dark:text-slate-200">
                  <User size={14} className="text-brand"/>
                  <span className="font-bold">{project.leader || 'Líder Não Informado'}</span>
                </div>

                <div className={`flex items-center gap-2 px-3 py-1 rounded-xl border ${
                  isDelayed 
                    ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300' 
                    : 'bg-slate-50 dark:bg-slate-900 border-slate-100 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                }`}>
                  <Calendar size={14} className={isDelayed ? 'text-rose-500' : 'text-slate-400'}/>
                  <span className="font-bold">
                    {project.deadline ? formatDateBR(project.deadline) : 'Sem prazo'}
                  </span>
                  {isDelayed && <span className="font-black text-[10px] uppercase">(Atrasado)</span>}
                </div>
              </div>
            </div>
          </div>

          {/* Progresso Geral */}
          <div className="bg-slate-50 dark:bg-slate-900/90 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm min-w-[180px] text-center w-full md:w-auto">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1">Progresso Global</p>
            <div className="flex justify-center items-end gap-1">
              <span className={`text-4xl font-black ${project.progress === 100 ? 'text-emerald-600 dark:text-emerald-400' : 'text-brand'}`}>
                {project.progress || 0}%
              </span>
            </div>
            <div className="w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full mt-3 overflow-hidden">
              <div 
                className={`h-full transition-all duration-500 ${project.progress === 100 ? 'bg-emerald-500' : 'bg-brand'}`} 
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
          <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-700 shadow-sm space-y-3">
            <h3 className="font-black text-slate-900 dark:text-white flex items-center gap-2 text-xs uppercase tracking-wider">
              <Target size={18} className="text-brand"/> Escopo & Diretrizes
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
              {project.description || 'Nenhum escopo detalhado cadastrado para esta iniciativa.'}
            </p>
          </div>

          {/* Cards Financeiro & Prioridade */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-emerald-50/60 dark:bg-emerald-950/20 p-5 rounded-3xl border border-emerald-100 dark:border-emerald-900/40">
              <div className="flex items-center gap-2 mb-2 text-emerald-800 dark:text-emerald-300">
                <DollarSign size={18}/><span className="text-xs font-bold uppercase">Orçamento</span>
              </div>
              <p className="text-lg font-black text-emerald-900 dark:text-emerald-100 truncate">
                {formatBRL(project.budget)}
              </p>
            </div>

            <div className={`p-5 rounded-3xl border ${priorityInfo.bg}`}>
              <div className="flex items-center gap-2 mb-2">
                <BarChart3 size={18}/><span className="text-xs font-bold uppercase">Prioridade</span>
              </div>
              <p className="text-lg font-black">{project.priority || 'Média'}</p>
            </div>
          </div>

          {/* Card Equipe Técnica */}
          <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-700 shadow-sm space-y-4">
            <h3 className="font-black text-slate-900 dark:text-white flex items-center gap-2 text-xs uppercase tracking-wider">
              <Users size={18} className="text-brand"/> Equipe Técnica Alocada
            </h3>
            
            <div className="space-y-3">
              {project.leader && (
                <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
                  <div className="w-9 h-9 rounded-full bg-brand/10 text-brand flex items-center justify-center font-bold text-xs uppercase">
                    {project.leader.substring(0,2)}
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-900 dark:text-white">{project.leader}</p>
                    <span className="text-[10px] text-brand font-bold uppercase">Líder do Projeto</span>
                  </div>
                </div>
              )}

              {Array.isArray(project.team) && project.team.length > 0 ? (
                <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-700">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Integrantes ({project.team.length})</p>
                  <div className="flex flex-wrap gap-2">
                    {project.team.map((m, i) => (
                      <span 
                        key={i}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-100 dark:bg-slate-700/60 text-slate-700 dark:text-slate-200 text-xs font-medium"
                      >
                        <User size={12} className="text-slate-400" />
                        {m}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-400 italic">Nenhum membro adicional alocado à equipe.</p>
              )}
            </div>
          </div>
        </div>

        {/* Coluna Direita: Diário de Bordo (Changelog & Sprints) */}
        <div className="lg:col-span-2">
          <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-200/80 dark:border-slate-700 shadow-sm overflow-hidden flex flex-col">
            
            <div className="p-6 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50/60 dark:bg-slate-900/60">
              <div>
                <h3 className="font-black text-slate-900 dark:text-white flex items-center gap-2">
                  <FileText size={20} className="text-brand"/> Diário de Bordo & Histórico
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">Registro cronológico de entregas, marcos e decisões de arquitetura.</p>
              </div>

              {canWrite && !isAddingLog && (
                <button 
                  onClick={() => setIsAddingLog(true)} 
                  className="bg-brand text-white px-4 py-2 rounded-xl text-xs font-bold hover:opacity-90 flex items-center gap-2 shadow-md shadow-brand/20 transition-all"
                >
                  <Plus size={16}/> Nova Atualização
                </button>
              )}
            </div>

            {/* Formulário de Adicionar Log */}
            {isAddingLog && (
              <div className="p-6 bg-slate-50 dark:bg-slate-900/90 border-b border-slate-200 dark:border-slate-700 animate-in slide-in-from-top-2 space-y-3">
                <div className="flex flex-wrap justify-between items-center gap-2">
                  <p className="text-xs font-bold text-brand uppercase flex items-center gap-1.5">
                    <Sparkles size={14} /> Atualização para v{project.version || '1.0'}
                  </p>
                  
                  {/* Categoria do Log */}
                  <div className="flex items-center gap-1 text-[10px] font-bold">
                    {['Marco', 'Sprint', 'Ajuste', 'Deploy', 'Decisão'].map(tg => (
                      <button
                        key={tg}
                        type="button"
                        onClick={() => setLogTag(tg)}
                        className={`px-2 py-0.5 rounded-lg border transition-all ${
                          logTag === tg 
                            ? 'bg-brand text-white border-brand' 
                            : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        {tg}
                      </button>
                    ))}
                  </div>
                </div>

                <textarea 
                  autoFocus
                  disabled={savingLog}
                  value={newLog}
                  onChange={e => setNewLog(e.target.value)}
                  className="w-full p-4 border border-slate-200 dark:border-slate-700 rounded-2xl text-xs leading-relaxed focus:outline-none focus:border-brand bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder:text-slate-400 shadow-sm disabled:opacity-50"
                  rows="4"
                  placeholder="Descreva o que foi concluído nesta sprint ou marco técnico..."
                />

                <div className="flex justify-end gap-3 pt-1">
                  <button 
                    disabled={savingLog}
                    onClick={() => setIsAddingLog(false)} 
                    className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-900 dark:hover:text-white disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button 
                    disabled={savingLog || !newLog.trim()}
                    onClick={handleAddLog} 
                    className="px-5 py-2 bg-brand text-white rounded-xl text-xs font-bold hover:opacity-90 shadow-md flex items-center gap-2 disabled:opacity-50"
                  >
                    {savingLog ? <RefreshCcw size={16} className="animate-spin" /> : <Save size={16}/>}
                    {savingLog ? 'Salvando…' : 'Salvar Registro'}
                  </button>
                </div>
              </div>
            )}

            {/* Linha do tempo de logs */}
            <div className="p-6 space-y-6">
              {totalLogs === 0 ? (
                <div className="text-center py-12 text-slate-400 dark:text-slate-500">
                  <BarChart3 size={48} className="mx-auto mb-3 opacity-20"/>
                  <p className="text-sm font-bold">Nenhum marco registrado ainda.</p>
                  <p className="text-xs text-slate-400 mt-1">Use o botão acima para registrar o primeiro marco do projeto.</p>
                </div>
              ) : (
                visibleLogs.map((log, index) => {
                  const { version, content, date } = safeRenderLog(log);
                  return (
                    <div key={index} className="flex gap-4 group/item">
                      <div className="flex flex-col items-center">
                        <div className="w-9 h-9 rounded-full bg-white dark:bg-slate-800 flex items-center justify-center border-2 border-slate-200 dark:border-slate-700 group-hover/item:border-brand group-hover/item:text-brand text-slate-400 transition-colors shadow-sm z-10 shrink-0">
                          <CheckCircle2 size={18} />
                        </div>
                        {(index !== visibleLogs.length - 1) && (
                          <div className="w-0.5 h-full bg-slate-100 dark:bg-slate-700 -my-2 group-hover/item:bg-brand/30 transition-colors" />
                        )}
                      </div>

                      <div className="pb-6 flex-1 min-w-0">
                        <div className="bg-slate-50/80 dark:bg-slate-900 p-5 rounded-2xl border border-slate-100 dark:border-slate-800 group-hover/item:border-brand/40 group-hover/item:shadow-md transition-all relative">
                          {canWrite && (
                            <button 
                              onClick={() => handleDeleteLog(log)}
                              className="absolute top-4 right-4 p-1.5 text-slate-300 dark:text-slate-600 hover:text-rose-500 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg opacity-100 md:opacity-0 md:group-hover/item:opacity-100 transition-all z-20"
                              title="Excluir Registro"
                            >
                              <Trash2 size={14}/>
                            </button>
                          )}

                          <div className="flex flex-wrap justify-between items-center mb-2 pb-2 border-b border-slate-200/60 dark:border-slate-800 pr-8">
                            <div className="flex items-center gap-2">
                              {version && (
                                <span className="text-[10px] font-black bg-slate-900 dark:bg-slate-950 text-white px-2 py-0.5 rounded">
                                  {version}
                                </span>
                              )}
                              <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1 font-mono">
                                <Clock size={12}/> {date || 'Registro'}
                              </span>
                            </div>
                          </div>

                          <div className="text-xs text-slate-700 dark:text-slate-200 font-medium leading-relaxed whitespace-pre-wrap">
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
              <div className="p-4 border-t border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50 flex justify-center">
                <button 
                  onClick={() => setShowAllLogs(!showAllLogs)}
                  className="flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white bg-white dark:bg-slate-800 px-4 py-2 rounded-full border border-slate-200 dark:border-slate-700 shadow-sm transition-all"
                >
                  {showAllLogs ? (
                    <><ChevronUp size={14}/> Recolher Histórico ({totalLogs})</>
                  ) : (
                    <><ChevronDown size={14}/> Ver histórico completo ({totalLogs})</>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal de Edição de Projeto */}
      {isEditModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-xl p-6 md:p-8 animate-in zoom-in-95 max-h-[92vh] overflow-y-auto border border-slate-200 dark:border-slate-700">
            <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-100 dark:border-slate-700">
              <h2 className="text-xl font-black text-slate-900 dark:text-white flex items-center gap-2">
                <Edit3 size={20} className="text-brand"/> Editar Dados do Projeto
              </h2>
              <button disabled={savingEdit} onClick={() => setIsEditModalOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1">
                <X size={20}/>
              </button>
            </div>
            
            <form onSubmit={handleSaveChanges} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1">Nome do Projeto</label>
                <input 
                  required 
                  value={editFormData.name} 
                  onChange={e => setEditFormData({...editFormData, name: e.target.value})} 
                  className="w-full p-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-xl font-bold outline-none focus:border-brand text-sm" 
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1">URL da Imagem de Capa</label>
                <input 
                  value={editFormData.coverImage} 
                  onChange={e => setEditFormData({...editFormData, coverImage: e.target.value})} 
                  className="w-full p-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-xl text-xs font-mono outline-none focus:border-brand" 
                  placeholder="https://..." 
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1">Versão</label>
                  <input 
                    value={editFormData.version} 
                    onChange={e => setEditFormData({...editFormData, version: e.target.value})} 
                    className="w-full p-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-xl font-mono text-sm outline-none focus:border-brand" 
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1">Progresso (%)</label>
                  <input 
                    type="number" 
                    min="0"
                    max="100"
                    value={editFormData.progress} 
                    onChange={e => setEditFormData({...editFormData, progress: e.target.value})} 
                    className="w-full p-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-xl text-sm outline-none focus:border-brand font-bold" 
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1">Líder do Projeto</label>
                  <select 
                    value={editFormData.leader} 
                    onChange={e => setEditFormData({...editFormData, leader: e.target.value})} 
                    className="w-full p-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-xl text-sm outline-none focus:border-brand cursor-pointer"
                  >
                    <option value="">Selecione...</option>
                    {employees.map(emp => <option key={emp.id} value={emp.name}>{emp.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1">Orçamento (R$)</label>
                  <input 
                    type="text"
                    value={editFormData.budget} 
                    onChange={e => setEditFormData({...editFormData, budget: e.target.value})} 
                    className="w-full p-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-xl text-sm outline-none focus:border-brand font-mono" 
                    placeholder="Ex: 50.000,00 ou 50000" 
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1">Status</label>
                  <select 
                    value={editFormData.status} 
                    onChange={e => setEditFormData({...editFormData, status: e.target.value})} 
                    className="w-full p-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-xl text-sm outline-none focus:border-brand"
                  >
                    <option>Planejamento</option>
                    <option>Em Andamento</option>
                    <option>Pausado</option>
                    <option>Concluído</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1">Prioridade</label>
                  <select 
                    value={editFormData.priority} 
                    onChange={e => setEditFormData({...editFormData, priority: e.target.value})} 
                    className="w-full p-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-xl text-sm outline-none focus:border-brand"
                  >
                    <option>Baixa</option>
                    <option>Média</option>
                    <option>Alta</option>
                    <option>Crítica</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1">Prazo de Entrega</label>
                <input 
                  type="date"
                  value={editFormData.deadline} 
                  onChange={e => setEditFormData({...editFormData, deadline: e.target.value})} 
                  className="w-full p-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-xl text-sm outline-none focus:border-brand" 
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1">Equipe Técnica</label>
                <div className="max-h-32 overflow-y-auto border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 rounded-xl p-2 space-y-1 custom-scrollbar">
                  {employees.map(emp => {
                    const isSelected = (editFormData.team || []).includes(emp.name);
                    return (
                      <label key={emp.id} className="flex items-center gap-2 text-xs p-1 rounded hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={isSelected}
                          onChange={e => {
                            if (e.target.checked) {
                              setEditFormData(prev => ({ ...prev, team: [...(prev.team || []), emp.name] }));
                            } else {
                              setEditFormData(prev => ({ ...prev, team: (prev.team || []).filter(n => n !== emp.name) }));
                            }
                          }}
                          className="rounded text-brand focus:ring-brand"
                        />
                        <span>{emp.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase block mb-1">Descrição / Escopo</label>
                <textarea 
                  value={editFormData.description} 
                  onChange={e => setEditFormData({...editFormData, description: e.target.value})} 
                  className="w-full p-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-xl text-xs outline-none focus:border-brand leading-relaxed" 
                  rows="3" 
                />
              </div>

              <div className="flex gap-3 pt-3 border-t border-slate-100 dark:border-slate-700">
                <button 
                  type="button" 
                  disabled={savingEdit} 
                  onClick={() => setIsEditModalOpen(false)} 
                  className="flex-1 py-3 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-slate-600 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors disabled:opacity-50 text-sm"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  disabled={savingEdit} 
                  className="flex-1 bg-brand text-white py-3 rounded-xl font-bold hover:opacity-90 shadow-lg shadow-brand/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50 text-sm"
                >
                  {savingEdit ? <RefreshCcw size={18} className="animate-spin" /> : null}
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