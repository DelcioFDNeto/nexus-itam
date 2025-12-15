// src/pages/ProjectsPage.jsx
import React, { useState, useEffect } from 'react';
import { getProjects, createProject, deleteProject } from '../services/projectService';
import { 
  FolderGit2, Plus, Calendar, MoreVertical, Trash2, ArrowRight, 
  Layout, CheckCircle2, Clock, AlertCircle, Flag, Users
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const ProjectsPage = () => {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    status: 'Planejamento',
    priority: 'Média', // Novo campo
    leader: '', // Novo campo
    deadline: ''
  });

  const loadProjects = async () => {
    setLoading(true);
    const data = await getProjects();
    setProjects(data);
    setLoading(false);
  };

  useEffect(() => {
    loadProjects();
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!formData.name) return;
    
    // Adiciona imagem de capa aleatória ou padrão para dar vida
    const enrichedData = {
        ...formData,
        coverImage: `https://ui-avatars.com/api/?name=${formData.name}&background=random&size=128`, 
    };

    await createProject(enrichedData);
    setFormData({ name: '', description: '', status: 'Planejamento', priority: 'Média', leader: '', deadline: '' });
    setIsModalOpen(false);
    loadProjects();
  };

  const handleDelete = async (id) => {
    if(confirm("Tem certeza que deseja apagar este projeto?")) {
      await deleteProject(id);
      loadProjects();
    }
  };

  // --- HELPERS VISUAIS ---
  const getStatusColor = (status) => {
    switch(status) {
      case 'Em Andamento': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'Concluído': return 'bg-green-100 text-green-700 border-green-200';
      case 'Atrasado': return 'bg-red-100 text-red-700 border-red-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const getPriorityColor = (priority) => {
      switch(priority) {
          case 'Alta': return 'text-red-600 bg-red-50';
          case 'Média': return 'text-orange-600 bg-orange-50';
          default: return 'text-green-600 bg-green-50';
      }
  };

  // Cálculos para o Header
  const stats = {
      total: projects.length,
      active: projects.filter(p => p.status === 'Em Andamento').length,
      completed: projects.filter(p => p.status === 'Concluído').length,
      planning: projects.filter(p => p.status === 'Planejamento').length
  };

  return (
    <div className="p-8 max-w-[1600px] mx-auto pb-24 space-y-8">
      
      {/* --- HEADER COM KPI (Preenche o vazio) --- */}
      <div className="flex flex-col md:flex-row justify-between items-end gap-6">
        <div>
          <h1 className="text-3xl font-black text-gray-900 flex items-center gap-3">
            <FolderGit2 className="text-shineray" size={32} /> Gestão de Projetos
          </h1>
          <p className="text-gray-500 mt-1">Portfólio de iniciativas e desenvolvimentos</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="bg-black text-white px-6 py-3 rounded-xl font-bold hover:bg-gray-800 transition flex items-center gap-2 shadow-lg hover:scale-105 transform duration-200"
        >
          <Plus size={20} /> Novo Projeto
        </button>
      </div>

      {/* Cards de Resumo */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
              <div className="p-3 bg-gray-100 rounded-lg"><Layout size={24} className="text-gray-600"/></div>
              <div><p className="text-xs font-bold text-gray-400 uppercase">Total</p><p className="text-2xl font-black text-gray-900">{stats.total}</p></div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
              <div className="p-3 bg-blue-50 rounded-lg"><Clock size={24} className="text-blue-600"/></div>
              <div><p className="text-xs font-bold text-gray-400 uppercase">Em Andamento</p><p className="text-2xl font-black text-gray-900">{stats.active}</p></div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
              <div className="p-3 bg-green-50 rounded-lg"><CheckCircle2 size={24} className="text-green-600"/></div>
              <div><p className="text-xs font-bold text-gray-400 uppercase">Concluídos</p><p className="text-2xl font-black text-gray-900">{stats.completed}</p></div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
              <div className="p-3 bg-orange-50 rounded-lg"><AlertCircle size={24} className="text-orange-600"/></div>
              <div><p className="text-xs font-bold text-gray-400 uppercase">Planejamento</p><p className="text-2xl font-black text-gray-900">{stats.planning}</p></div>
          </div>
      </div>

      {/* --- GRID DE PROJETOS --- */}
      {loading ? (
        <div className="text-center py-20 text-gray-400 animate-pulse">Carregando portfólio...</div>
      ) : projects.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-3xl border-2 border-dashed border-gray-200">
            <FolderGit2 className="mx-auto text-gray-300 mb-3" size={64} />
            <p className="text-gray-500 font-bold text-lg">Seu portfólio está vazio.</p>
            <p className="text-sm text-gray-400 mb-6">Comece criando um projeto para organizar as demandas.</p>
            <button onClick={() => setIsModalOpen(true)} className="text-blue-600 font-bold hover:underline">Criar primeiro projeto</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {projects.map(project => (
            <div key={project.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-xl transition-all duration-300 group flex flex-col h-full">
              
              {/* Header do Card */}
              <div className="p-6 pb-4 flex justify-between items-start">
                <div className="flex gap-3">
                    <img src={project.coverImage || `https://ui-avatars.com/api/?name=${project.name}`} alt="Logo" className="w-12 h-12 rounded-lg object-cover shadow-sm" />
                    <div>
                        <h3 className="text-lg font-black text-gray-900 leading-tight group-hover:text-shineray transition-colors">{project.name}</h3>
                        <div className="flex items-center gap-2 mt-1">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${getStatusColor(project.status)}`}>
                                {project.status}
                            </span>
                            <span className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase ${getPriorityColor(project.priority)}`}>
                                <Flag size={10} /> {project.priority || 'Média'}
                            </span>
                        </div>
                    </div>
                </div>
                <button onClick={() => handleDelete(project.id)} className="text-gray-300 hover:text-red-500 p-1 rounded-full hover:bg-red-50 transition-colors">
                  <Trash2 size={16} />
                </button>
              </div>

              {/* Corpo */}
              <div className="px-6 flex-1">
                <p className="text-sm text-gray-500 leading-relaxed line-clamp-3">
                    {project.description || "Sem descrição detalhada."}
                </p>
                
                {/* Progresso (Visual) */}
                <div className="mt-6">
                    <div className="flex justify-between text-xs font-bold text-gray-500 mb-1">
                        <span>Progresso</span>
                        <span>{project.progress || 0}%</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                        <div className="bg-black h-full rounded-full transition-all duration-1000" style={{ width: `${project.progress || 0}%` }}></div>
                    </div>
                </div>
              </div>

              {/* Footer */}
              <div className="p-4 mt-6 bg-gray-50 border-t border-gray-100 rounded-b-2xl flex justify-between items-center">
                <div className="flex items-center gap-3 text-xs text-gray-500 font-bold">
                    <div className="flex items-center gap-1" title="Data de Entrega">
                        <Calendar size={14} className="text-gray-400"/>
                        {project.deadline ? new Date(project.deadline).toLocaleDateString('pt-BR').slice(0,5) : '--/--'}
                    </div>
                    {project.leader && (
                        <div className="flex items-center gap-1" title={`Líder: ${project.leader}`}>
                            <Users size={14} className="text-gray-400"/>
                            {project.leader.split(' ')[0]}
                        </div>
                    )}
                </div>

                <button 
                    onClick={() => navigate(`/tasks?projectId=${project.id}`)}
                    className="flex items-center gap-1 text-xs bg-white border border-gray-200 px-3 py-1.5 rounded-lg font-bold hover:bg-black hover:text-white hover:border-black transition-all shadow-sm"
                >
                    Gerenciar <ArrowRight size={12}/>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Criar Projeto */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-8 animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-black text-gray-900">Novo Projeto</h2>
                <button onClick={() => setIsModalOpen(false)} className="p-2 bg-gray-100 rounded-full hover:bg-gray-200 text-gray-500"><Trash2 size={18} className="rotate-45"/></button>
            </div>
            
            <form onSubmit={handleCreate} className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nome do Projeto</label>
                <input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full p-3 border-2 border-gray-100 rounded-xl outline-none focus:border-black transition-colors font-bold" placeholder="Ex: Migração Cloud" />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Líder / Responsável</label>
                    <input value={formData.leader} onChange={e => setFormData({...formData, leader: e.target.value})} className="w-full p-3 border-2 border-gray-100 rounded-xl outline-none focus:border-black transition-colors text-sm" placeholder="Nome..." />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Prioridade</label>
                    <select value={formData.priority} onChange={e => setFormData({...formData, priority: e.target.value})} className="w-full p-3 border-2 border-gray-100 rounded-xl outline-none focus:border-black bg-white text-sm">
                        <option>Baixa</option>
                        <option>Média</option>
                        <option>Alta</option>
                        <option>Crítica</option>
                    </select>
                  </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Descrição</label>
                <textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="w-full p-3 border-2 border-gray-100 rounded-xl outline-none focus:border-black transition-colors text-sm" placeholder="Objetivo e escopo do projeto..." rows="3"></textarea>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Status Inicial</label>
                    <select value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})} className="w-full p-3 border-2 border-gray-100 rounded-xl outline-none focus:border-black bg-white text-sm">
                        <option>Planejamento</option>
                        <option>Em Andamento</option>
                        <option>Pausado</option>
                        <option>Concluído</option>
                    </select>
                </div>
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Deadline</label>
                    <input type="date" value={formData.deadline} onChange={e => setFormData({...formData, deadline: e.target.value})} className="w-full p-3 border-2 border-gray-100 rounded-xl outline-none focus:border-black text-sm" />
                </div>
              </div>

              <div className="flex gap-3 pt-4 border-t border-gray-50 mt-4">
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-3 bg-white border border-gray-200 rounded-xl font-bold text-gray-600 hover:bg-gray-50">Cancelar</button>
                <button type="submit" className="flex-1 py-3 bg-black text-white rounded-xl font-bold hover:bg-gray-800 shadow-lg">Criar Projeto</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectsPage;