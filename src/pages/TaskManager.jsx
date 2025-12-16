// src/pages/TaskManager.jsx
import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getTasks, addTask, updateTask, deleteTask } from '../services/taskService';
import { getProjects } from '../services/projectService';
import { 
  Plus, Trash2, Calendar, Edit, Filter, 
  FolderGit2, ListChecks, ChevronDown, ChevronRight, X
} from 'lucide-react';

const TaskManager = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  
  // Estados de Dados
  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Filtros
  const [selectedProjectId, setSelectedProjectId] = useState(searchParams.get('projectId') || '');
  const [statusFilter, setStatusFilter] = useState('Todos'); 

  // Controle do Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState(null);

  // Formulário Seguro
  const initialFormState = { 
    title: '', description: '', status: 'A Fazer', priority: 'Média', projectId: '', category: 'Geral' 
  };
  const [formData, setFormData] = useState(initialFormState);

  // Categorias
  const categories = [
    { id: 'Levantamento', label: 'Levantamento & Análise', color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
    { id: 'Inventário', label: 'Inventário Físico', color: 'bg-blue-50 text-blue-700 border-blue-200' },
    { id: 'Manutenção', label: 'Manutenção & Suporte', color: 'bg-orange-50 text-orange-700 border-orange-200' },
    { id: 'Auditoria', label: 'Auditoria & Compliance', color: 'bg-red-50 text-red-700 border-red-200' },
    { id: 'Geral', label: 'Outras Demandas', color: 'bg-gray-50 text-gray-700 border-gray-200' }
  ];

  const [expandedSections, setExpandedSections] = useState(
    categories.reduce((acc, cat) => ({...acc, [cat.id]: true}), {})
  );

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [tasksData, projectsData] = await Promise.all([getTasks(), getProjects()]);
      setTasks(tasksData);
      setProjects(projectsData);
    } catch (error) {
      console.error("Erro ao carregar dados:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const urlId = searchParams.get('projectId');
    if (urlId) setSelectedProjectId(urlId);
  }, [searchParams]);

  const toggleSection = (catId) => {
      setExpandedSections(prev => ({...prev, [catId]: !prev[catId]}));
  };

  // --- FUNÇÕES DE CRUD CORRIGIDAS ---

  const openCreateModal = () => {
      setEditingTaskId(null);
      // Reseta form. Se tiver filtro de projeto, já preenche.
      setFormData({
          ...initialFormState,
          projectId: selectedProjectId || ''
      });
      setIsModalOpen(true);
  };

  const openEditModal = (task) => {
      setEditingTaskId(task.id);
      // Popula form com dados existentes OU valores padrão seguros
      setFormData({
          title: task.title || '',
          description: task.description || '',
          status: task.status || 'A Fazer',
          priority: task.priority || 'Média',
          projectId: task.projectId || '',
          category: task.category || 'Geral'
      });
      setIsModalOpen(true);
  };

  const handleSaveTask = async (e) => {
    e.preventDefault();
    if (!formData.title) return;

    try {
        if (editingTaskId) {
            // EDITAR
            await updateTask(editingTaskId, formData);
            // Atualiza estado local
            setTasks(prev => prev.map(t => t.id === editingTaskId ? { ...t, ...formData } : t));
        } else {
            // CRIAR
            const newTaskPayload = {
                ...formData,
                category: formData.category || 'Geral'
            };
            await addTask(newTaskPayload);
            // Recarrega para pegar ID
            const updated = await getTasks();
            setTasks(updated);
        }
        setIsModalOpen(false);
    } catch (error) {
        console.error("Erro ao salvar:", error);
        alert("Erro ao salvar tarefa. Verifique o console.");
    }
  };

  const handleDelete = async (id) => {
    if (confirm('Excluir tarefa permanentemente?')) {
      await deleteTask(id);
      setTasks(prev => prev.filter(t => t.id !== id));
    }
  };

  const handleStatusChange = async (id, newStatus) => {
      setTasks(prev => prev.map(t => t.id === id ? { ...t, status: newStatus } : t));
      await updateTask(id, { status: newStatus });
  };

  // --- HELPERS VISUAIS ---
  const getPriorityBadge = (p) => {
    const colors = { 'Alta': 'bg-red-100 text-red-700', 'Média': 'bg-yellow-100 text-yellow-700', 'Baixa': 'bg-green-100 text-green-700' };
    return <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${colors[p] || colors['Média']}`}>{p}</span>;
  };

  const getStatusColor = (s) => {
      switch(s) {
          case 'Concluído': return 'text-green-600 bg-green-50 border-green-200';
          case 'Em Progresso': return 'text-blue-600 bg-blue-50 border-blue-200';
          default: return 'text-gray-600 bg-gray-50 border-gray-200';
      }
  };

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto pb-24">
      
      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-black text-gray-900 flex items-center gap-3">
            <ListChecks className="text-shineray" size={32} /> Gestão de Tarefas
          </h1>
          <p className="text-sm text-gray-500 mt-1">Controle Operacional</p>
        </div>

        <div className="flex flex-col sm:flex-row w-full md:w-auto gap-3">
          <div className="relative group w-full sm:w-auto">
            <div className="absolute left-3 top-3 text-gray-400"><FolderGit2 size={16}/></div>
            <select 
                value={selectedProjectId}
                onChange={(e) => {
                    setSelectedProjectId(e.target.value);
                    setSearchParams(e.target.value ? { projectId: e.target.value } : {});
                }}
                className="w-full sm:w-auto pl-10 pr-8 py-3 bg-white border border-gray-300 rounded-xl outline-none focus:border-black font-bold text-sm cursor-pointer hover:bg-gray-50"
            >
                <option value="">Todos os Projetos</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          <button onClick={openCreateModal} className="bg-black text-white px-5 py-3 rounded-xl font-bold hover:bg-gray-800 flex items-center justify-center gap-2 shadow-lg w-full sm:w-auto">
            <Plus size={20} /> <span className="md:hidden lg:inline">Nova Tarefa</span>
          </button>
        </div>
      </div>

      {/* ABAS STATUS */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2 scrollbar-hide border-b border-gray-200">
          {['Todos', 'A Fazer', 'Em Progresso', 'Concluído'].map(status => (
              <button 
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-4 py-2 rounded-t-lg font-bold text-sm whitespace-nowrap transition-all border-b-2 ${
                    statusFilter === status ? 'border-black text-black bg-gray-50' : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                  {status}
              </button>
          ))}
      </div>

      {/* LISTAS POR SESSÃO */}
      <div className="space-y-6">
        {loading ? (
            <div className="text-center py-10 text-gray-400 animate-pulse">Carregando...</div>
        ) : (
            categories.map(category => {
                const categoryTasks = tasks.filter(t => {
                    const matchCat = (t.category || 'Geral') === category.id;
                    const matchProject = selectedProjectId ? t.projectId === selectedProjectId : true;
                    const matchStatus = statusFilter === 'Todos' ? true : t.status === statusFilter;
                    return matchCat && matchProject && matchStatus;
                });

                if (categoryTasks.length === 0 && statusFilter !== 'Todos') return null;

                return (
                    <div key={category.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                        <button 
                            onClick={() => toggleSection(category.id)}
                            className={`w-full flex items-center justify-between p-4 ${category.color} transition-colors hover:opacity-90`}
                        >
                            <div className="flex items-center gap-2 font-black uppercase tracking-wide text-sm">
                                {expandedSections[category.id] ? <ChevronDown size={18}/> : <ChevronRight size={18}/>}
                                {category.label}
                                <span className="ml-2 bg-white/60 px-2 py-0.5 rounded text-xs text-black/70">{categoryTasks.length}</span>
                            </div>
                        </button>

                        {expandedSections[category.id] && (
                            <div className="divide-y divide-gray-100">
                                {categoryTasks.length === 0 ? (
                                    <div className="p-8 text-center text-gray-400 text-sm italic">Nenhuma tarefa nesta sessão.</div>
                                ) : (
                                    categoryTasks.map(task => {
                                        const taskProject = projects.find(p => p.id === task.projectId);
                                        return (
                                            <div key={task.id} className="p-4 hover:bg-gray-50 transition-colors group">
                                                <div className="flex flex-col md:flex-row md:items-center gap-4">
                                                    {/* Controls Status */}
                                                    <div className="flex-1 flex flex-col md:flex-row md:items-center gap-3">
                                                        <select 
                                                            value={task.status}
                                                            onChange={(e) => handleStatusChange(task.id, e.target.value)}
                                                            className={`text-[10px] font-bold uppercase py-1.5 px-3 rounded border cursor-pointer outline-none appearance-none text-center w-full md:w-[120px] ${getStatusColor(task.status)}`}
                                                        >
                                                            <option>A Fazer</option>
                                                            <option>Em Progresso</option>
                                                            <option>Revisão</option>
                                                            <option>Concluído</option>
                                                        </select>

                                                        <div className="flex-1">
                                                            <div className="flex flex-wrap items-center gap-2 mb-1">
                                                                <span className="font-bold text-gray-900 text-sm md:text-base">{task.title}</span>
                                                                {getPriorityBadge(task.priority)}
                                                                {taskProject && (
                                                                    <span className="flex items-center gap-1 text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-bold whitespace-nowrap">
                                                                        <FolderGit2 size={10}/> {taskProject.name}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            {task.description && <p className="text-xs text-gray-500 line-clamp-2">{task.description}</p>}
                                                        </div>
                                                    </div>

                                                    {/* Actions */}
                                                    <div className="flex items-center justify-between md:justify-end gap-3 border-t border-gray-100 md:border-0 pt-3 md:pt-0">
                                                        <div className="flex items-center gap-1 text-xs text-gray-400 font-mono">
                                                            <Calendar size={12}/> {new Date(task.createdAt?.seconds * 1000 || Date.now()).toLocaleDateString('pt-BR')}
                                                        </div>
                                                        <div className="flex gap-2">
                                                            <button 
                                                                onClick={() => openEditModal(task)}
                                                                className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                                                                title="Editar"
                                                            >
                                                                <Edit size={16} />
                                                            </button>
                                                            <button 
                                                                onClick={() => handleDelete(task.id)}
                                                                className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                                                                title="Excluir"
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        )}
                    </div>
                );
            })
        )}
      </div>

      {/* MODAL UNIFICADO */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold">{editingTaskId ? 'Editar Tarefa' : 'Nova Tarefa'}</h2>
                <button onClick={() => setIsModalOpen(false)} className="p-1 rounded-full hover:bg-gray-100"><X size={20}/></button>
            </div>
            
            <form onSubmit={handleSaveTask} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Título</label>
                <input autoFocus required value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} className="w-full p-3 border-2 border-gray-100 rounded-xl outline-none focus:border-black font-bold" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Sessão (Categoria)</label>
                    <select value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})} className="w-full p-3 border-2 border-gray-100 rounded-xl outline-none focus:border-black bg-white">
                        {categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Projeto</label>
                    <select value={formData.projectId} onChange={e => setFormData({...formData, projectId: e.target.value})} className="w-full p-3 border-2 border-gray-100 rounded-xl outline-none focus:border-black bg-white">
                        <option value="">Geral (Sem Projeto)</option>
                        {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Prioridade</label>
                    <select value={formData.priority} onChange={e => setFormData({...formData, priority: e.target.value})} className="w-full p-3 border-2 border-gray-100 rounded-xl outline-none focus:border-black bg-white">
                        <option>Baixa</option>
                        <option>Média</option>
                        <option>Alta</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Status</label>
                    <select value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})} className="w-full p-3 border-2 border-gray-100 rounded-xl outline-none focus:border-black bg-white">
                        <option>A Fazer</option>
                        <option>Em Progresso</option>
                        <option>Concluído</option>
                    </select>
                  </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Descrição</label>
                <textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="w-full p-3 border-2 border-gray-100 rounded-xl outline-none focus:border-black" rows="3"></textarea>
              </div>

              <div className="flex gap-3 pt-4 border-t border-gray-50 mt-2">
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-3 bg-white border border-gray-200 rounded-xl font-bold text-gray-600 hover:bg-gray-50">Cancelar</button>
                <button type="submit" className="flex-1 py-3 bg-black text-white rounded-xl font-bold hover:bg-gray-800 shadow-lg">
                    {editingTaskId ? 'Salvar' : 'Criar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};

export default TaskManager;