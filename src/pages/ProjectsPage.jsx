// src/pages/ProjectsPage.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { getProjects, createProject, deleteProject } from '../services/projectService';
import { getEmployees } from '../services/employeeService';
import { 
  FolderGit2, Plus, Calendar, Trash2, LayoutGrid, Kanban, RefreshCcw, X 
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { can } from '../utils/permissions';
import { useConfirm } from '../components/ConfirmDialog';
import { formatDateBR } from '../utils/dates';
import { toast } from 'sonner';

const initialForm = {
  name: '', 
  description: '', 
  status: 'Planejamento', 
  priority: 'Média', 
  leader: '', 
  deadline: '', 
  version: '1.0', 
  team: []
};

// Peças visuais isoladas construídas para serem replicadas na tela
const ProjectCard = ({ project, navigate, viewMode, onDelete, canWrite }) => {
  const projectInitials = (project.name || 'P').substring(0, 2).toUpperCase();

  return (
    <div 
      onClick={() => navigate(`/projects/${project.id}`)} 
      className="bg-white dark:bg-slate-800 rounded-2xl p-5 border border-gray-200 dark:border-slate-700 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer group flex flex-col h-full"
    >
      <div className="flex justify-between items-start mb-4">
        <div className="flex gap-3 min-w-0">
          {project.coverImage ? (
            <img src={project.coverImage} alt="Logo" className="w-10 h-10 rounded-lg object-cover shadow-sm bg-gray-100 dark:bg-slate-700 shrink-0" />
          ) : (
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-black text-xs uppercase shadow-sm shrink-0">
              {projectInitials}
            </div>
          )}
          <div className="min-w-0">
            <h3 className="font-bold text-gray-900 dark:text-white leading-tight group-hover:text-blue-600 dark:group-hover:text-brand transition-colors truncate">{project.name}</h3>
            <p className="text-[10px] text-gray-500 dark:text-gray-400 font-mono uppercase mt-0.5">v{project.version || '1.0'}</p>
          </div>
        </div>
        {viewMode === 'grid' && (
          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase shrink-0 ${project.status === 'Em Andamento' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' : project.status === 'Concluído' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-gray-300'}`}>
            {project.status}
          </span>
        )}
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed line-clamp-2 mb-4 flex-1">{project.description || 'Sem descrição.'}</p>

      <div className="mt-auto space-y-3">
        {/* Termometro pintado dinamicamente que corre de 0 a 100% */}
        <div>
          <div className="flex justify-between text-[10px] font-bold text-gray-400 dark:text-gray-500 mb-1">
            <span>Progresso</span><span>{project.progress || 0}%</span>
          </div>
          <div className="w-full bg-gray-100 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-500 ${project.status === 'Concluído' ? 'bg-green-500' : 'bg-gradient-to-r from-blue-600 to-purple-600'}`} style={{ width: `${project.progress || 0}%` }}></div>
          </div>
        </div>

        <div className="pt-3 border-t border-gray-100 dark:border-slate-700 flex justify-between items-center">
          <div className="flex -space-x-2">
            {(project.team || []).length > 0 ? (
              project.team.slice(0, 3).map((memberName, i) => (
                <div key={i} title={memberName} className="w-6 h-6 rounded-full bg-indigo-50 dark:bg-indigo-950/60 border-2 border-white dark:border-slate-800 flex items-center justify-center text-[8px] font-black text-brand uppercase shadow-sm">
                  {memberName.substring(0,2)}
                </div>
              ))
            ) : project.leader ? (
              <div title={project.leader} className="w-6 h-6 rounded-full bg-indigo-50 dark:bg-indigo-950/60 border-2 border-white dark:border-slate-800 flex items-center justify-center text-[8px] font-black text-brand uppercase shadow-sm">
                {project.leader.substring(0,2)}
              </div>
            ) : (
              <div title="Sem Equipe" className="w-6 h-6 rounded-full bg-gray-100 dark:bg-slate-700 border-2 border-white dark:border-slate-800 flex items-center justify-center text-[8px] font-black text-gray-400 dark:text-gray-500 uppercase shadow-sm">--</div>
            )}
            {(project.team || []).length > 3 && (
              <div className="w-6 h-6 rounded-full bg-gray-200 dark:bg-slate-700 border-2 border-white dark:border-slate-800 flex items-center justify-center text-[8px] font-bold text-gray-600 dark:text-gray-300">
                +{project.team.length - 3}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-bold flex items-center gap-1 ${project.deadline ? 'text-gray-600 dark:text-gray-300' : 'text-gray-400 dark:text-gray-500'}`}>
              <Calendar size={12}/> {project.deadline ? formatDateBR(project.deadline) : 'S/ Data'}
            </span>
            {canWrite && (
              <button 
                onClick={(e) => onDelete(project.id, e)} 
                title="Excluir projeto"
                className="text-gray-300 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors p-1"
              >
                <Trash2 size={14}/>
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
  const [viewMode, setViewMode] = useState('grid');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState(initialForm);

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
        deadline: formData.deadline || '',
        version: formData.version.trim() || '1.0',
        team: formData.team || [],
        tenantId,
        coverImage: '',
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
    { id: 'Planejamento', label: 'Planejamento', color: 'bg-gray-100 dark:bg-slate-800/80 border-gray-200 dark:border-slate-700' },
    { id: 'Em Andamento', label: 'Em Execução', color: 'bg-blue-50 dark:bg-blue-950/20 border-blue-100 dark:border-blue-900/40' },
    { id: 'Concluído', label: 'Entregue', color: 'bg-green-50 dark:bg-green-950/20 border-green-100 dark:border-green-900/40' }
  ];

  const getProjectsByStatus = (status) => {
    return projects.filter(p => {
      if (status === 'Planejamento') return p.status === 'Planejamento' || p.status === 'Pausado';
      if (status === 'Em Andamento') return p.status === 'Em Andamento' || p.status === 'Revisão';
      if (status === 'Concluído') return p.status === 'Concluído';
      return false;
    });
  };

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto pb-24 space-y-8 min-h-screen animate-fade-in">
      
      {/* Faixa superior master com o titulo e as chaves de troca de visao */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-900 dark:text-white flex items-center gap-3">
            <FolderGit2 className="text-brand" size={32} /> Central de Projetos
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Gerencie iniciativas, prazos e entregas de forma visual.</p>
        </div>
        
        <div className="flex items-center gap-3 bg-white dark:bg-slate-800 p-1 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm">
          <button 
            onClick={() => setViewMode('grid')} 
            title="Visualização em Grade"
            className={`p-2 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-black text-white dark:bg-brand shadow' : 'text-gray-400 hover:text-black dark:hover:text-white'}`}
          >
            <LayoutGrid size={20}/>
          </button>
          <button 
            onClick={() => setViewMode('kanban')} 
            title="Visualização em Kanban"
            className={`p-2 rounded-lg transition-all ${viewMode === 'kanban' ? 'bg-black text-white dark:bg-brand shadow' : 'text-gray-400 hover:text-black dark:hover:text-white'}`}
          >
            <Kanban size={20}/>
          </button>
          {canWrite && (
            <>
              <div className="w-[1px] h-6 bg-gray-200 dark:bg-slate-700 mx-1"></div>
              <button 
                onClick={() => { setFormData(initialForm); setIsModalOpen(true); }} 
                className="bg-black dark:bg-brand hover:bg-gray-800 dark:hover:opacity-90 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 text-sm shadow-lg transition-all"
              >
                <Plus size={18} /> Novo Projeto
              </button>
            </>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-gray-400">
          <RefreshCcw size={28} className="animate-spin mr-2" /> Carregando projetos...
        </div>
      ) : (
        <>
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {projects.map(project => (
                <ProjectCard 
                  key={project.id} 
                  project={project} 
                  navigate={navigate} 
                  viewMode={viewMode} 
                  onDelete={handleDelete}
                  canWrite={canWrite}
                />
              ))}
              {projects.length === 0 && (
                <div className="col-span-full text-center py-20 text-gray-400 dark:text-gray-500 border-2 border-dashed border-gray-200 dark:border-slate-700 rounded-3xl">
                  <FolderGit2 size={48} className="mx-auto mb-4 opacity-20"/>
                  <p className="font-bold">Nenhum projeto encontrado.</p>
                  <p className="text-sm mt-1">{canWrite ? 'Inicie um novo projeto para organizar os trabalhos.' : 'Nenhum projeto cadastrado nesta empresa.'}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="flex gap-6 overflow-x-auto pb-4 items-start min-h-[600px]">
              {KANBAN_COLUMNS.map(col => (
                <div key={col.id} className="min-w-[320px] w-[350px] flex-shrink-0 flex flex-col bg-gray-50/50 dark:bg-slate-900/50 rounded-2xl border border-gray-200 dark:border-slate-700 max-h-full">
                  <div className={`p-4 border-b ${col.color.split(' ')[1]} rounded-t-2xl flex justify-between items-center sticky top-0 bg-white/50 dark:bg-slate-800/60 backdrop-blur-sm z-10`}>
                    <h3 className="font-bold text-gray-700 dark:text-gray-200">{col.label}</h3>
                    <span className="bg-white dark:bg-slate-800 px-2 py-0.5 rounded-full text-xs font-bold border border-gray-200 dark:border-slate-600 text-gray-500 dark:text-gray-400 shadow-sm">
                      {getProjectsByStatus(col.id).length}
                    </span>
                  </div>
                  <div className="p-3 space-y-3 overflow-y-auto max-h-[70vh] custom-scrollbar">
                    {getProjectsByStatus(col.id).map(project => (
                      <div key={project.id} className="transform hover:scale-[1.01] transition-transform">
                        <ProjectCard 
                          project={project} 
                          navigate={navigate} 
                          viewMode={viewMode} 
                          onDelete={handleDelete}
                          canWrite={canWrite}
                        />
                      </div>
                    ))}
                    {getProjectsByStatus(col.id).length === 0 && (
                      <div className="h-32 flex items-center justify-center border-2 border-dashed border-gray-200 dark:border-slate-700 rounded-xl">
                        <p className="text-xs text-gray-400 dark:text-gray-500 font-bold uppercase">Vazio</p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Janela modal para criar novo projeto */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg p-6 md:p-8 animate-in zoom-in-95 border border-gray-200 dark:border-slate-700 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-black text-gray-900 dark:text-white">Iniciar Novo Projeto</h2>
              <button disabled={saving} onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1 block">Nome do Projeto</label>
                <input 
                  required 
                  value={formData.name} 
                  onChange={e => setFormData({...formData, name: e.target.value})} 
                  className="w-full p-3 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-white rounded-xl font-bold outline-none focus:border-brand" 
                  placeholder="Ex: Migração ERP Nuvem" 
                />
              </div>
              
              <div>
                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1 block">Descrição</label>
                <textarea 
                  value={formData.description} 
                  onChange={e => setFormData({...formData, description: e.target.value})} 
                  className="w-full p-3 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-white rounded-xl outline-none focus:border-brand text-sm" 
                  rows="3" 
                  placeholder="Objetivo e escopo macro do projeto..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1 block">Versão</label>
                  <input 
                    value={formData.version} 
                    onChange={e => setFormData({...formData, version: e.target.value})} 
                    className="w-full p-3 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-white rounded-xl outline-none focus:border-brand font-mono text-sm" 
                    placeholder="1.0" 
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1 block">Prazo de Entrega</label>
                  <input 
                    type="date" 
                    value={formData.deadline} 
                    onChange={e => setFormData({...formData, deadline: e.target.value})} 
                    className="w-full p-3 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-white rounded-xl outline-none focus:border-brand text-sm" 
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1 block">Líder do Projeto</label>
                <select 
                  value={formData.leader} 
                  onChange={e => setFormData({...formData, leader: e.target.value})} 
                  className="w-full p-3 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-white rounded-xl outline-none focus:border-brand cursor-pointer text-sm"
                >
                  <option value="">Selecione um colaborador...</option>
                  {employees.map(emp => <option key={emp.id} value={emp.name}>{emp.name}</option>)}
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1 block">Equipe Técnica</label>
                <div className="max-h-36 overflow-y-auto border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 rounded-xl p-2 space-y-1 custom-scrollbar">
                  {employees.length === 0 ? (
                    <p className="text-xs text-gray-400 p-2">Nenhum colaborador cadastrado</p>
                  ) : (
                    employees.map(emp => {
                      const isSelected = (formData.team || []).includes(emp.name);
                      return (
                        <label key={emp.id} className="flex items-center gap-2 text-xs p-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer text-gray-800 dark:text-gray-200">
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
                          {emp.role && <span className="text-gray-400 text-[10px]">({emp.role})</span>}
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button 
                  type="button" 
                  disabled={saving} 
                  onClick={() => setIsModalOpen(false)} 
                  className="flex-1 py-3 bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600 text-gray-700 dark:text-gray-200 rounded-xl font-bold hover:bg-gray-50 dark:hover:bg-slate-600 transition-colors disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  disabled={saving} 
                  className="flex-1 py-3 bg-black text-white dark:bg-brand dark:hover:opacity-90 rounded-xl font-bold hover:bg-gray-800 shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {saving ? <RefreshCcw size={18} className="animate-spin" /> : null}
                  {saving ? 'Criando…' : 'Criar Projeto'}
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