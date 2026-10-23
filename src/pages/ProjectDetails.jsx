// src/pages/ProjectDetails.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getProject, updateProject, addProjectLog, setProjectLogs } from '../services/projectService';
import { useAuth } from '../contexts/AuthContext';
import { can } from '../utils/permissions';
import { useConfirm } from '../components/ConfirmDialog';
import { formatDateBR } from '../utils/dates';
import { 
  ArrowLeft, Calendar, User, CheckCircle, 
  FileText, Plus, Save, Clock, Target, Edit3, X, 
  BarChart3, DollarSign, Users, ImageIcon, Trash2, 
  ChevronDown, ChevronUp, RefreshCcw
} from 'lucide-react';
import { toast } from 'sonner';

const ProjectDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const confirm = useConfirm();
  const tenantId = currentUser?.tenantId;
  const canWrite = can(currentUser, 'projects:write');

  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  
  const [isAddingLog, setIsAddingLog] = useState(false);
  const [newLog, setNewLog] = useState('');
  const [savingLog, setSavingLog] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  
  const [showAllLogs, setShowAllLogs] = useState(false); 
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editFormData, setEditFormData] = useState({});

  const fetchProject = useCallback(async () => {
    try {
      const data = await getProject(id);
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
      const logEntry = `v${project.version || '1.0'}: ${newLog.trim()} (${timestamp})`;
      
      await addProjectLog(id, logEntry);

      setProject(prev => ({
        ...prev,
        changelog: [...(prev.changelog || []), logEntry]
      }));
      setNewLog('');
      setIsAddingLog(false);
      setShowAllLogs(true);
      toast.success('Registro adicionado ao diário de bordo.');
    } catch (error) {
      console.error(error);
      toast.error('Erro ao salvar log.');
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
      toast.success('Registro excluído.');
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
        budget: editFormData.budget || '',
        coverImage: editFormData.coverImage?.trim() || '',
        deadline: editFormData.deadline || '',
        progress: Number(editFormData.progress) || 0,
        version: editFormData.version?.trim() || '1.0'
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
      version: project.version || '1.0'
    });
    setIsEditModalOpen(true);
  };

  const getLeaderName = (leader) => {
    if (typeof leader === 'string' && leader.trim()) return leader.split(' ')[0];
    return 'Indefinido';
  };

  const safeRenderLog = (log) => {
    let version = '';
    let content = '';
    let date = '';

    if (typeof log === 'string') {
      const parts = log.split(':');
      if (parts[0].includes('v')) {
        version = parts[0];
        content = parts.slice(1).join(':');
      } else {
        content = log;
      }
    } else if (typeof log === 'object' && log !== null) {
      version = log.version ? `v${log.version}` : '';
      content = log.notes || log.descricao || JSON.stringify(log);
      date = log.date || '';
    }

    return { version, content, date };
  };

  const getStatusColor = (s) => {
    switch(s) {
      case 'Em Andamento': return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800';
      case 'Concluído': return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800';
      case 'Pausado': return 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800';
      default: return 'bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-slate-600';
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-black dark:border-white"></div>
      </div>
    );
  }

  if (!project) return null;

  const renderLogs = () => {
    if (!project.changelog || project.changelog.length === 0) return [];
    const allLogs = [...project.changelog].reverse();
    return showAllLogs ? allLogs : allLogs.slice(0, 3);
  };

  const visibleLogs = renderLogs();
  const totalLogs = project.changelog?.length || 0;
  const projectInitials = (project.name || 'P').substring(0, 2).toUpperCase();

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto pb-24 animate-fade-in">
      
      {/* Topo da pagina contendo controles basicos */}
      <div className="flex justify-between items-center mb-6">
        <button 
          onClick={() => navigate('/projects')} 
          className="flex items-center gap-2 text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white font-bold text-sm transition-colors"
        >
          <ArrowLeft size={18}/> Voltar
        </button>
        {canWrite && (
          <button 
            onClick={openEditModal} 
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-xs font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-700 shadow-sm transition-all"
          >
            <Edit3 size={16}/> Editar Projeto
          </button>
        )}
      </div>
      
      {/* Quadro dinamico de apresentacao */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm mb-8 overflow-hidden relative">
        {project.coverImage ? (
          <div className="h-32 w-full bg-cover bg-center absolute top-0 left-0 opacity-10" style={{ backgroundImage: `url(${project.coverImage})` }}></div>
        ) : (
          <div className="h-32 w-full bg-gradient-to-r from-blue-600/10 via-purple-600/10 to-brand/10 absolute top-0 left-0"></div>
        )}
        <div className="relative z-10 p-6 md:p-8 pt-10 flex flex-col md:flex-row gap-6 md:gap-8 items-start">
          {project.coverImage ? (
            <img src={project.coverImage} className="w-20 h-20 md:w-24 md:h-24 rounded-2xl object-cover shadow-lg border-4 border-white dark:border-slate-700 bg-white dark:bg-slate-800" alt="Logo"/>
          ) : (
            <div className="w-20 h-20 md:w-24 md:h-24 rounded-2xl shadow-lg border-4 border-white dark:border-slate-700 bg-gradient-to-br from-indigo-500 to-purple-700 flex items-center justify-center text-white font-black text-2xl md:text-3xl shrink-0">
              {projectInitials}
            </div>
          )}
          <div className="flex-1 space-y-3 mt-1 min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl md:text-4xl font-black text-gray-900 dark:text-white tracking-tight leading-none break-words">{project.name}</h1>
              <span className="px-3 py-1 bg-black dark:bg-slate-900 text-white text-xs font-mono font-bold rounded-lg shadow-sm border border-transparent dark:border-slate-700">v{project.version || '1.0'}</span>
            </div>
            <div className="flex flex-wrap gap-3 text-sm text-gray-600 dark:text-gray-300">
              <span className={`px-3 py-1 rounded-lg text-xs font-bold uppercase border ${getStatusColor(project.status)}`}>{project.status}</span>
              <div className="flex items-center gap-2 bg-gray-50 dark:bg-slate-900 px-3 py-1 rounded-lg border border-gray-100 dark:border-slate-700 text-gray-700 dark:text-gray-200">
                <User size={14} className="text-gray-400 dark:text-gray-500"/>
                <span className="font-bold">{getLeaderName(project.leader)}</span>
              </div>
              <div className="flex items-center gap-2 bg-gray-50 dark:bg-slate-900 px-3 py-1 rounded-lg border border-gray-100 dark:border-slate-700 text-gray-700 dark:text-gray-200">
                <Calendar size={14} className="text-gray-400 dark:text-gray-500"/>
                <span className="font-bold">{project.deadline ? formatDateBR(project.deadline) : 'Sem prazo'}</span>
              </div>
            </div>
          </div>
          <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm min-w-[160px] text-center hidden md:block">
            <p className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">Progresso</p>
            <div className="flex justify-center items-end gap-1">
              <span className={`text-4xl font-black ${project.progress === 100 ? 'text-green-600 dark:text-green-400' : 'text-blue-600 dark:text-blue-400'}`}>
                {project.progress || 0}%
              </span>
            </div>
            <div className="w-full bg-gray-100 dark:bg-slate-700 h-1.5 rounded-full mt-2 overflow-hidden">
              <div className={`h-full ${project.progress === 100 ? 'bg-green-500' : 'bg-blue-600'}`} style={{ width: `${project.progress || 0}%` }}></div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-gray-200 dark:border-slate-700 shadow-sm">
            <h3 className="font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2 text-sm uppercase tracking-wide">
              <Target size={18} className="text-brand"/> Escopo
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed text-justify whitespace-pre-wrap">{project.description || 'Nenhuma descrição informada.'}</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-blue-50 dark:bg-blue-950/30 p-5 rounded-2xl border border-blue-100 dark:border-blue-900/50">
              <div className="flex items-center gap-2 mb-2 text-blue-800 dark:text-blue-300">
                <DollarSign size={18}/><span className="text-xs font-bold uppercase">Orçamento</span>
              </div>
              <p className="text-lg font-black text-blue-900 dark:text-blue-100">{project.budget ? `R$ ${project.budget}` : '--'}</p>
            </div>
            <div className={`p-5 rounded-2xl border ${project.priority === 'Crítica' ? 'bg-red-50 dark:bg-red-950/30 border-red-100 dark:border-red-900/50 text-red-900 dark:text-red-200' : 'bg-green-50 dark:bg-green-950/30 border-green-100 dark:border-green-900/50 text-green-900 dark:text-green-200'}`}>
              <div className="flex items-center gap-2 mb-2">
                <BarChart3 size={18}/><span className="text-xs font-bold uppercase">Prioridade</span>
              </div>
              <p className="text-lg font-black">{project.priority || 'Média'}</p>
            </div>
          </div>
          <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-gray-200 dark:border-slate-700 shadow-sm">
            <h3 className="font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2 text-sm uppercase tracking-wide">
              <Users size={18} className="text-brand"/> Equipe
            </h3>
            <div className="flex -space-x-2 overflow-hidden mb-2">
              <div className="h-8 w-8 rounded-full ring-2 ring-white dark:ring-slate-800 bg-gray-200 dark:bg-slate-700 flex items-center justify-center text-xs font-bold text-gray-600 dark:text-gray-200">
                {getLeaderName(project.leader).substring(0,2)}
              </div>
              {Array.isArray(project.team) && project.team.map((m, i) => (
                <div key={i} title={m} className="h-8 w-8 rounded-full ring-2 ring-white dark:ring-slate-800 bg-brand text-white flex items-center justify-center text-[10px] font-bold">
                  {m.substring(0, 2).toUpperCase()}
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500">Gerido por {project.leader || 'TI'}</p>
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 shadow-sm overflow-hidden flex flex-col">
            
            <div className="p-6 border-b border-gray-100 dark:border-slate-700 flex justify-between items-center bg-gray-50/50 dark:bg-slate-900/50">
              <h3 className="font-black text-gray-900 dark:text-white flex items-center gap-2">
                <FileText size={20} className="text-brand"/> Diário de Bordo
              </h3>
              {canWrite && !isAddingLog && (
                <button 
                  onClick={() => setIsAddingLog(true)} 
                  className="bg-black dark:bg-brand text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-gray-800 dark:hover:opacity-90 flex items-center gap-2 shadow-lg transition-all"
                >
                  <Plus size={16}/> Add Log
                </button>
              )}
            </div>

            {isAddingLog && (
              <div className="p-6 bg-yellow-50 dark:bg-yellow-950/20 border-b border-yellow-100 dark:border-yellow-900/40 animate-in slide-in-from-top-2">
                <p className="text-xs font-bold text-yellow-800 dark:text-yellow-400 uppercase mb-2">Nova atualização para v{project.version || '1.0'}</p>
                <textarea 
                  autoFocus
                  disabled={savingLog}
                  value={newLog}
                  onChange={e => setNewLog(e.target.value)}
                  className="w-full p-4 border-2 border-yellow-200 dark:border-yellow-900/60 rounded-xl text-sm focus:outline-none focus:border-yellow-500 bg-white dark:bg-slate-900 text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 shadow-sm disabled:opacity-50"
                  rows="5"
                  placeholder="Status:&#10;O que foi feito:"
                />
                <div className="flex justify-end gap-3 mt-3">
                  <button 
                    disabled={savingLog}
                    onClick={() => setIsAddingLog(false)} 
                    className="px-4 py-2 text-xs font-bold text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button 
                    disabled={savingLog || !newLog.trim()}
                    onClick={handleAddLog} 
                    className="px-5 py-2 bg-yellow-500 dark:bg-yellow-600 text-white rounded-lg text-xs font-bold hover:bg-yellow-600 dark:hover:bg-yellow-500 shadow-md flex items-center gap-2 disabled:opacity-50"
                  >
                    {savingLog ? <RefreshCcw size={16} className="animate-spin" /> : <Save size={16}/>}
                    {savingLog ? 'Salvando…' : 'Salvar'}
                  </button>
                </div>
              </div>
            )}

            {/* Linha do tempo de logs */}
            <div className="p-6 space-y-8">
              {totalLogs === 0 ? (
                <div className="text-center py-12 text-gray-400 dark:text-gray-500">
                  <BarChart3 size={48} className="mx-auto mb-3 opacity-20"/>
                  <p className="text-sm">Nenhum histórico registrado.</p>
                </div>
              ) : (
                visibleLogs.map((log, index) => {
                  const { version, content, date } = safeRenderLog(log);
                  return (
                    <div key={index} className="flex gap-5 group/item">
                      <div className="flex flex-col items-center">
                        <div className="w-10 h-10 rounded-full bg-white dark:bg-slate-800 flex items-center justify-center border-2 border-gray-100 dark:border-slate-700 group-hover/item:border-brand group-hover/item:text-brand text-gray-300 dark:text-gray-500 transition-colors shadow-sm z-10">
                          <CheckCircle size={18} />
                        </div>
                        {(index !== visibleLogs.length - 1) && (
                          <div className="w-0.5 h-full bg-gray-100 dark:bg-slate-700 -my-2 group-hover/item:bg-blue-50 dark:group-hover/item:bg-blue-900/30 transition-colors"></div>
                        )}
                      </div>

                      <div className="pb-8 flex-1 min-w-0">
                        <div className="bg-gray-50 dark:bg-slate-900 p-5 rounded-2xl border border-gray-100 dark:border-slate-700 group-hover/item:border-blue-200 dark:group-hover/item:border-blue-800 group-hover/item:shadow-md transition-all relative">
                          {canWrite && (
                            <button 
                              onClick={() => handleDeleteLog(log)}
                              className="absolute top-4 right-4 p-1.5 text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg opacity-100 md:opacity-0 md:group-hover/item:opacity-100 transition-all z-20"
                              title="Excluir Registro"
                            >
                              <Trash2 size={14}/>
                            </button>
                          )}

                          <div className="flex flex-wrap justify-between items-center mb-3 pb-3 border-b border-gray-200 dark:border-slate-700 pr-8">
                            <div className="flex items-center gap-2">
                              {version && (
                                <span className="text-[10px] font-black bg-black dark:bg-slate-800 text-white px-2 py-1 rounded shadow-sm border border-transparent dark:border-slate-700">{version}</span>
                              )}
                              <span className="text-[10px] uppercase font-bold text-gray-400 dark:text-gray-500 tracking-wider flex items-center gap-1">
                                <Clock size={12}/> {date || 'Data registrada'}
                              </span>
                            </div>
                          </div>

                          <div className="text-sm text-gray-700 dark:text-gray-200 font-medium leading-relaxed whitespace-pre-wrap font-sans">
                            {content}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Controle de expansao do painel de atividades */}
            {totalLogs > 3 && (
              <div className="p-4 border-t border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-900 flex justify-center">
                <button 
                  onClick={() => setShowAllLogs(!showAllLogs)}
                  className="flex items-center gap-2 text-xs font-bold text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white bg-white dark:bg-slate-800 px-4 py-2 rounded-full border border-gray-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-all"
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

      {isEditModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg p-6 animate-in zoom-in-95 max-h-[90vh] overflow-y-auto border border-gray-200 dark:border-slate-700">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-black text-gray-900 dark:text-white flex items-center gap-2"><Edit3 size={20}/> Editar Projeto</h2>
              <button disabled={savingEdit} onClick={() => setIsEditModalOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                <X size={20}/>
              </button>
            </div>
            
            <form onSubmit={handleSaveChanges} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">Nome do Projeto</label>
                <input 
                  required 
                  value={editFormData.name} 
                  onChange={e => setEditFormData({...editFormData, name: e.target.value})} 
                  className="w-full p-3 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-white rounded-xl font-bold mt-1 outline-none focus:border-brand" 
                />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">URL da Capa (Opcional)</label>
                <div className="flex gap-2">
                  <input 
                    value={editFormData.coverImage} 
                    onChange={e => setEditFormData({...editFormData, coverImage: e.target.value})} 
                    className="w-full p-3 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 rounded-xl mt-1 text-sm outline-none focus:border-brand" 
                    placeholder="https://..." 
                  />
                  <div className="p-3 bg-gray-100 dark:bg-slate-700 rounded-xl mt-1 border border-gray-200 dark:border-slate-600 flex items-center justify-center">
                    <ImageIcon size={20} className="text-gray-400"/>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">Versão Atual</label>
                  <input 
                    value={editFormData.version} 
                    onChange={e => setEditFormData({...editFormData, version: e.target.value})} 
                    className="w-full p-3 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-white rounded-xl mt-1 font-mono text-sm outline-none focus:border-brand" 
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">Progresso (%)</label>
                  <input 
                    type="number" 
                    min="0"
                    max="100"
                    value={editFormData.progress} 
                    onChange={e => setEditFormData({...editFormData, progress: e.target.value})} 
                    className="w-full p-3 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-white rounded-xl mt-1 text-sm outline-none focus:border-brand" 
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">Líder</label>
                  <input 
                    value={editFormData.leader} 
                    onChange={e => setEditFormData({...editFormData, leader: e.target.value})} 
                    className="w-full p-3 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-white rounded-xl mt-1 text-sm outline-none focus:border-brand" 
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">Orçamento (R$)</label>
                  <input 
                    value={editFormData.budget} 
                    onChange={e => setEditFormData({...editFormData, budget: e.target.value})} 
                    className="w-full p-3 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-white rounded-xl mt-1 text-sm outline-none focus:border-brand" 
                    placeholder="0,00" 
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">Status</label>
                  <select 
                    value={editFormData.status} 
                    onChange={e => setEditFormData({...editFormData, status: e.target.value})} 
                    className="w-full p-3 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-white rounded-xl mt-1 text-sm outline-none focus:border-brand"
                  >
                    <option>Planejamento</option>
                    <option>Em Andamento</option>
                    <option>Pausado</option>
                    <option>Concluído</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">Prioridade</label>
                  <select 
                    value={editFormData.priority} 
                    onChange={e => setEditFormData({...editFormData, priority: e.target.value})} 
                    className="w-full p-3 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-white rounded-xl mt-1 text-sm outline-none focus:border-brand"
                  >
                    <option>Baixa</option>
                    <option>Média</option>
                    <option>Alta</option>
                    <option>Crítica</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">Prazo de Entrega</label>
                <input 
                  type="date"
                  value={editFormData.deadline} 
                  onChange={e => setEditFormData({...editFormData, deadline: e.target.value})} 
                  className="w-full p-3 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-white rounded-xl mt-1 text-sm outline-none focus:border-brand" 
                />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">Descrição</label>
                <textarea 
                  value={editFormData.description} 
                  onChange={e => setEditFormData({...editFormData, description: e.target.value})} 
                  className="w-full p-3 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-white rounded-xl mt-1 text-sm outline-none focus:border-brand" 
                  rows="3"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button 
                  type="button" 
                  disabled={savingEdit} 
                  onClick={() => setIsEditModalOpen(false)} 
                  className="flex-1 py-3 bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-xl font-bold text-gray-600 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-600 transition-colors disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  disabled={savingEdit} 
                  className="flex-1 bg-black dark:bg-brand text-white py-3 rounded-xl font-bold hover:bg-gray-800 dark:hover:opacity-90 shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50"
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