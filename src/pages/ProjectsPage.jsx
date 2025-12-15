import React, { useState, useEffect } from 'react';
import { getProjects, createProject, deleteProject } from '../services/projectService';
import { 
  FolderGit2, Plus, Calendar, CheckCircle, Clock, 
  MoreVertical, Trash2, ArrowRight 
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
    status: 'Em Planejamento',
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
    await createProject(formData);
    setFormData({ name: '', description: '', status: 'Em Planejamento', deadline: '' });
    setIsModalOpen(false);
    loadProjects();
  };

  const handleDelete = async (id) => {
    if(confirm("Tem certeza? Isso não apaga as tarefas vinculadas, apenas o projeto.")) {
      await deleteProject(id);
      loadProjects();
    }
  };

  const getStatusColor = (status) => {
    switch(status) {
      case 'Em Andamento': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'Concluído': return 'bg-green-100 text-green-700 border-green-200';
      case 'Pausado': return 'bg-orange-100 text-orange-700 border-orange-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  return (
    <div className="p-8 max-w-[1600px] mx-auto pb-24">
      
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-black text-gray-900 flex items-center gap-3">
            <FolderGit2 className="text-shineray" size={32} /> Portfólio de Projetos
          </h1>
          <p className="text-gray-500 mt-1">Gerencie grandes iniciativas (Academy, ITAM, Infra)</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="bg-black text-white px-6 py-3 rounded-xl font-bold hover:bg-gray-800 transition flex items-center gap-2 shadow-lg"
        >
          <Plus size={20} /> Novo Projeto
        </button>
      </div>

      {/* Grid de Projetos */}
      {loading ? (
        <div className="text-center py-20 text-gray-400">Carregando projetos...</div>
      ) : projects.length === 0 ? (
        <div className="text-center py-20 bg-gray-50 rounded-2xl border border-dashed border-gray-300">
            <FolderGit2 className="mx-auto text-gray-300 mb-3" size={48} />
            <p className="text-gray-500 font-bold">Nenhum projeto criado.</p>
            <p className="text-sm text-gray-400">Crie o "Shineray Academy" para começar.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map(project => (
            <div key={project.id} className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-all group relative">
              
              <div className="flex justify-between items-start mb-4">
                <span className={`px-3 py-1 rounded-lg text-xs font-bold border ${getStatusColor(project.status)}`}>
                  {project.status}
                </span>
                <button onClick={() => handleDelete(project.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                  <Trash2 size={18} />
                </button>
              </div>

              <h3 className="text-xl font-black text-gray-900 mb-2">{project.name}</h3>
              <p className="text-sm text-gray-500 line-clamp-2 mb-6 h-10">
                {project.description || "Sem descrição definida."}
              </p>

              {/* Barra de Progresso Fictícia (Futuramente ligaremos às tarefas reais) */}
              <div className="mb-4">
                <div className="flex justify-between text-xs font-bold text-gray-500 mb-1">
                  <span>Progresso</span>
                  <span>{project.progress || 0}%</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div 
                    className="bg-shineray h-2 rounded-full transition-all duration-500" 
                    style={{ width: `${project.progress || 0}%` }}
                  ></div>
                </div>
              </div>

              <div className="pt-4 border-t border-gray-50 flex justify-between items-center text-xs text-gray-400 font-mono">
                <span className="flex items-center gap-1"><Calendar size={12}/> {project.deadline ? new Date(project.deadline).toLocaleDateString('pt-BR') : 'Sem prazo'}</span>
                {/* Botão para ver tarefas deste projeto - Vamos implementar a rota depois */}
                <button 
                    onClick={() => navigate(`/tasks?projectId=${project.id}`)}
                    className="flex items-center gap-1 text-blue-600 font-bold hover:underline"
                >
                    Ver Tarefas <ArrowRight size={12}/>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Criar Projeto */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 animate-in zoom-in-95 duration-200">
            <h2 className="text-xl font-bold mb-4">Novo Projeto</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nome do Projeto</label>
                <input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full p-3 border rounded-xl outline-none focus:ring-2 focus:ring-black" placeholder="Ex: Shineray Academy" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Descrição</label>
                <textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="w-full p-3 border rounded-xl outline-none focus:ring-2 focus:ring-black" placeholder="Objetivo do projeto..." rows="3"></textarea>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Status</label>
                    <select value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})} className="w-full p-3 border rounded-xl bg-white outline-none focus:ring-2 focus:ring-black">
                        <option>Em Planejamento</option>
                        <option>Em Andamento</option>
                        <option>Pausado</option>
                        <option>Concluído</option>
                    </select>
                </div>
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Prazo Final</label>
                    <input type="date" value={formData.deadline} onChange={e => setFormData({...formData, deadline: e.target.value})} className="w-full p-3 border rounded-xl outline-none focus:ring-2 focus:ring-black" />
                </div>
              </div>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-3 bg-gray-100 rounded-xl font-bold text-gray-600 hover:bg-gray-200">Cancelar</button>
                <button type="submit" className="flex-1 py-3 bg-black text-white rounded-xl font-bold hover:bg-gray-800">Criar Projeto</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectsPage;