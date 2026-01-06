// src/pages/ProjectsPage.jsx
import React, { useState, useEffect } from 'react';
import { getProjects, createProject, deleteProject } from '../services/projectService';
import { 
  FolderGit2, Plus, Calendar, Trash2, ArrowRight, 
  GitBranch, CheckSquare, Square, X, Users
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const ProjectsPage = () => {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false); // Apenas para CRIAR

  // Form State para NOVO projeto
  const [formData, setFormData] = useState({
    name: '', description: '', status: 'Planejamento', priority: 'Média', leader: '', deadline: '', version: '1.0'
  });

  const loadProjects = async () => {
    setLoading(true);
    const data = await getProjects();
    setProjects(data);
    setLoading(false);
  };

  useEffect(() => { loadProjects(); }, []);

  const toggleSelect = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    const enrichedData = {
        ...formData,
        coverImage: `https://ui-avatars.com/api/?name=${formData.name}&background=random&size=128`, 
        changelog: [`v${formData.version}: Projeto iniciado.`],
        progress: 0
    };
    await createProject(enrichedData);
    setFormData({ name: '', description: '', status: 'Planejamento', priority: 'Média', leader: '', deadline: '', version: '1.0' });
    setIsModalOpen(false);
    loadProjects();
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if(confirm("Apagar projeto?")) {
      await deleteProject(id);
      loadProjects();
    }
  };

  const getStatusColor = (s) => {
      if(s === 'Em Andamento') return 'bg-blue-100 text-blue-700';
      if(s === 'Concluído') return 'bg-green-100 text-green-700';
      return 'bg-gray-100 text-gray-700';
  };

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto pb-24 space-y-8">
      
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-black text-gray-900 flex items-center gap-3">
            <FolderGit2 className="text-shineray" size={32} /> Portfólio
          </h1>
          <p className="text-gray-500 mt-1">Iniciativas e Grandes Projetos</p>
        </div>
        <button onClick={() => setIsModalOpen(true)} className="bg-black text-white px-6 py-3 rounded-xl font-bold hover:bg-gray-800 flex items-center gap-2 shadow-lg">
            <Plus size={20} /> Novo Projeto
        </button>
      </div>

      {loading ? <div className="text-center py-20 text-gray-400">Carregando...</div> : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map(project => (
            <div 
                key={project.id} 
                onClick={() => navigate(`/projects/${project.id}`)} // <--- AQUI A MÁGICA
                className="bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-xl transition-all cursor-pointer group flex flex-col h-full overflow-hidden"
            >
                <div className="p-6 pb-4 flex justify-between items-start">
                  <div className="flex gap-3">
                      <img src={project.coverImage} alt="Logo" className="w-12 h-12 rounded-lg object-cover shadow-sm" />
                      <div>
                          <h3 className="text-lg font-black text-gray-900 leading-tight group-hover:text-blue-600 transition-colors line-clamp-1">{project.name}</h3>
                          <div className="flex flex-wrap items-center gap-2 mt-1">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${getStatusColor(project.status)}`}>{project.status}</span>
                              <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-600 font-mono">v{project.version}</span>
                          </div>
                      </div>
                  </div>
                </div>

                <div className="px-6 flex-1">
                  <p className="text-sm text-gray-500 leading-relaxed line-clamp-3 mb-4">{project.description}</p>
                  
                  {/* Mini Preview do Changelog */}
                  <div className="bg-gray-50 p-3 rounded-lg border border-gray-100 mb-4 text-xs text-gray-500">
                      <p className="font-bold text-gray-400 uppercase text-[9px] mb-1">Última atualização</p>
                      <p className="line-clamp-1 italic">
                          {project.changelog && project.changelog.length > 0 
                            ? project.changelog[project.changelog.length - 1] 
                            : "Sem histórico recente."}
                      </p>
                  </div>

                  <div className="mt-auto">
                      <div className="flex justify-between text-xs font-bold text-gray-500 mb-1">
                          <span>Progresso</span><span>{project.progress || 0}%</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                          <div className={`h-full rounded-full ${project.status === 'Concluído' ? 'bg-green-500' : 'bg-black'}`} style={{ width: `${project.progress || 0}%` }}></div>
                      </div>
                  </div>
                </div>

                <div className="p-4 mt-6 bg-gray-50 border-t border-gray-100 flex justify-between items-center">
                  <div className="flex items-center gap-3 text-xs text-gray-500 font-bold">
                      <div className="flex items-center gap-1"><Calendar size={14}/> {project.deadline ? new Date(project.deadline).toLocaleDateString('pt-BR').slice(0,5) : '--'}</div>
                      {project.leader && <div className="flex items-center gap-1"><Users size={14}/> {project.leader.split(' ')[0]}</div>}
                  </div>
                  <button onClick={(e) => handleDelete(project.id, e)} className="text-gray-300 hover:text-red-500 p-2"><Trash2 size={16}/></button>
                </div>
            </div>
          ))}
        </div>
      )}

      {/* MODAL DE CRIAÇÃO SIMPLIFICADO */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-8 animate-in zoom-in-95">
            <h2 className="text-2xl font-black text-gray-900 mb-6">Iniciar Novo Projeto</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full p-3 border rounded-xl font-bold" placeholder="Nome do Projeto" />
              <textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="w-full p-3 border rounded-xl" rows="3" placeholder="Descrição macro..."></textarea>
              <div className="grid grid-cols-2 gap-4">
                  <input value={formData.version} onChange={e => setFormData({...formData, version: e.target.value})} className="w-full p-3 border rounded-xl" placeholder="Versão (1.0)" />
                  <input value={formData.leader} onChange={e => setFormData({...formData, leader: e.target.value})} className="w-full p-3 border rounded-xl" placeholder="Líder" />
              </div>
              <div className="flex gap-2 pt-4">
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-3 bg-gray-100 rounded-xl font-bold">Cancelar</button>
                <button type="submit" className="flex-1 py-3 bg-black text-white rounded-xl font-bold">Criar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectsPage;