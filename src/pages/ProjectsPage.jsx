// src/pages/ProjectsPage.jsx
import React, { useState, useEffect } from 'react';
import { getProjects, createProject, deleteProject, updateProject } from '../services/projectService';
import { 
  FolderGit2, Plus, Calendar, Trash2, ArrowRight, 
  FileText, GitBranch, CheckSquare, Square, X, Users, Edit, Save
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const ProjectsPage = () => {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Controle de Seleção
  const [selectedIds, setSelectedIds] = useState([]);

  // Controle do Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null); 

  // Form State
  const initialFormState = {
    name: '', description: '', status: 'Planejamento', priority: 'Média', 
    leader: '', deadline: '', version: '1.0', newLog: '' 
  };
  const [formData, setFormData] = useState(initialFormState);

  const loadProjects = async () => {
    setLoading(true);
    try {
        const data = await getProjects();
        setProjects(data);
    } catch (error) {
        console.error("Erro ao carregar projetos:", error);
    } finally {
        setLoading(false);
    }
  };

  useEffect(() => { loadProjects(); }, []);

  // --- SELEÇÃO ---
  const toggleSelect = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleSelectAll = () => {
    setSelectedIds(selectedIds.length === projects.length ? [] : projects.map(p => p.id));
  };

  // --- CRUD ---
  const openNewProject = () => {
      setEditingId(null);
      setFormData(initialFormState);
      setIsModalOpen(true);
  };

  const openEditProject = (project) => {
      setEditingId(project.id);
      setFormData({
          name: project.name,
          description: project.description || '',
          status: project.status,
          priority: project.priority,
          leader: project.leader || '',
          deadline: project.deadline || '',
          version: project.version || '1.0',
          newLog: '' 
      });
      setIsModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!formData.name) return;
    
    setLoading(true);

    if (editingId) {
        const projectToUpdate = projects.find(p => p.id === editingId);
        
        let updatedChangelog = projectToUpdate.changelog || [];
        if (formData.newLog.trim()) {
            const timestamp = new Date().toLocaleDateString('pt-BR');
            // Salvamos como string simples para evitar erros futuros
            const entry = `v${formData.version}: ${formData.newLog} (${timestamp})`;
            updatedChangelog = [...updatedChangelog, entry];
        }

        const dataToUpdate = {
            name: formData.name,
            description: formData.description,
            status: formData.status,
            priority: formData.priority,
            leader: formData.leader,
            deadline: formData.deadline,
            version: formData.version,
            changelog: updatedChangelog,
            progress: formData.status === 'Concluído' ? 100 : (formData.status === 'Em Andamento' ? 50 : projectToUpdate.progress)
        };

        await updateProject(editingId, dataToUpdate);

    } else {
        const enrichedData = {
            ...formData,
            coverImage: `https://ui-avatars.com/api/?name=${formData.name}&background=random&size=128`, 
            changelog: [`v${formData.version}: Projeto criado.`],
            progress: 0
        };
        delete enrichedData.newLog;
        await createProject(enrichedData);
    }

    setFormData(initialFormState);
    setIsModalOpen(false);
    await loadProjects();
  };

  const handleDelete = async (id) => {
    if(confirm("Tem certeza que deseja apagar este projeto?")) {
      await deleteProject(id);
      setSelectedIds(prev => prev.filter(itemId => itemId !== id));
      loadProjects();
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.length === 0) return;
    if(confirm(`Excluir ${selectedIds.length} projetos selecionados?`)) {
      setLoading(true);
      await Promise.all(selectedIds.map(id => deleteProject(id)));
      setSelectedIds([]);
      await loadProjects();
    }
  };

  // --- RENDERIZAÇÃO SEGURA DO LOG (CORREÇÃO DO ERRO #31) ---
  const renderLogItem = (log) => {
    if (typeof log === 'string') return log;
    if (typeof log === 'object' && log !== null) {
        // Tenta extrair campos comuns ou converte para texto
        const v = log.version || log.versao || '';
        const n = log.notes || log.notas || log.descricao || JSON.stringify(log);
        return v ? `v${v}: ${n}` : n;
    }
    return String(log);
  };

  const getStatusColor = (s) => {
    switch(s) {
      case 'Em Andamento': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'Concluído': return 'bg-green-100 text-green-700 border-green-200';
      case 'Pausado': return 'bg-orange-100 text-orange-700 border-orange-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const getPriorityColor = (p) => {
      switch(p) {
          case 'Crítica': return 'text-purple-600 bg-purple-50 border-purple-200';
          case 'Alta': return 'text-red-600 bg-red-50 border-red-200';
          case 'Média': return 'text-orange-600 bg-orange-50 border-orange-200';
          default: return 'text-green-600 bg-green-50 border-green-200';
      }
  };

  const stats = {
      total: projects.length,
      active: projects.filter(p => p.status === 'Em Andamento').length,
      completed: projects.filter(p => p.status === 'Concluído').length,
      planning: projects.filter(p => p.status === 'Planejamento').length
  };

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto pb-24 space-y-8">
      
      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-end gap-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-black text-gray-900 flex items-center gap-3">
            <FolderGit2 className="text-shineray" size={32} /> Portfólio de Projetos
          </h1>
          <p className="text-gray-500 mt-1">
            {selectedIds.length > 0 ? `${selectedIds.length} selecionado(s)` : "Iniciativas estratégicas e versões"}
          </p>
        </div>
        
        <div className="flex gap-3">
          {selectedIds.length > 0 ? (
            <>
              <button onClick={() => setSelectedIds([])} className="bg-white text-gray-500 px-4 py-3 rounded-xl font-bold border border-gray-200 hover:bg-gray-50 flex items-center gap-2">
                <X size={18} /> Cancelar
              </button>
              <button onClick={handleBatchDelete} className="bg-red-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-red-700 flex items-center gap-2 shadow-lg animate-in zoom-in-95">
                <Trash2 size={20} /> Excluir ({selectedIds.length})
              </button>
            </>
          ) : (
            <>
              <button onClick={handleSelectAll} className="bg-white text-gray-600 px-4 py-3 rounded-xl font-bold border border-gray-200 hover:bg-gray-50 hidden md:flex items-center gap-2" title="Selecionar Todos">
                <CheckSquare size={20} /> Todos
              </button>
              <button onClick={openNewProject} className="bg-black text-white px-6 py-3 rounded-xl font-bold hover:bg-gray-800 transition flex items-center gap-2 shadow-lg">
                <Plus size={20} /> Novo Projeto
              </button>
            </>
          )}
        </div>
      </div>

      {/* KPI CARDS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
              <p className="text-[10px] font-bold text-gray-400 uppercase">Total</p>
              <p className="text-2xl font-black text-gray-900">{stats.total}</p>
          </div>
          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
              <p className="text-[10px] font-bold text-blue-600 uppercase">Em Andamento</p>
              <p className="text-2xl font-black text-gray-900">{stats.active}</p>
          </div>
          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
              <p className="text-[10px] font-bold text-green-600 uppercase">Concluídos</p>
              <p className="text-2xl font-black text-gray-900">{stats.completed}</p>
          </div>
          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
              <p className="text-[10px] font-bold text-orange-600 uppercase">Planejamento</p>
              <p className="text-2xl font-black text-gray-900">{stats.planning}</p>
          </div>
      </div>

      {/* GRID */}
      {loading ? (
        <div className="text-center py-20 text-gray-400 animate-pulse">Carregando portfólio...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map(project => {
            const isSelected = selectedIds.includes(project.id);
            return (
              <div key={project.id} className={`bg-white rounded-2xl border transition-all duration-200 group flex flex-col h-full overflow-hidden relative ${isSelected ? 'border-red-500 ring-1 ring-red-500 shadow-red-100' : 'border-gray-200 shadow-sm hover:shadow-xl'}`}>
                
                {/* Checkbox Overlay */}
                <div className="absolute top-4 right-4 z-10 flex gap-2">
                    <button 
                        onClick={(e) => { e.stopPropagation(); openEditProject(project); }}
                        className="p-1 rounded-lg bg-white/90 text-gray-400 hover:text-blue-600 hover:bg-blue-50 border border-gray-200 backdrop-blur-sm"
                    >
                        <Edit size={20} />
                    </button>
                    <button 
                        onClick={(e) => { e.stopPropagation(); toggleSelect(project.id); }}
                        className={`p-1 rounded-lg transition-colors ${isSelected ? 'bg-red-500 text-white' : 'bg-white/90 text-gray-300 hover:text-gray-500 border border-gray-200'}`}
                    >
                        {isSelected ? <CheckSquare size={20} /> : <Square size={20} />}
                    </button>
                </div>

                <div className="p-6 pb-4 flex justify-between items-start cursor-pointer" onClick={() => openEditProject(project)}>
                  <div className="flex gap-3 pr-16">
                      <img src={project.coverImage || `https://ui-avatars.com/api/?name=${project.name}&background=random`} alt="Logo" className="w-12 h-12 rounded-lg object-cover shadow-sm" />
                      <div>
                          <h3 className="text-lg font-black text-gray-900 leading-tight group-hover:text-shineray transition-colors line-clamp-1">{project.name}</h3>
                          <div className="flex flex-wrap items-center gap-2 mt-1">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${getStatusColor(project.status)}`}>{project.status}</span>
                              {project.version && <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-600 border border-gray-200 font-mono"><GitBranch size={10} /> v{project.version}</span>}
                          </div>
                      </div>
                  </div>
                </div>

                <div className="px-6 flex-1 cursor-pointer" onClick={() => openEditProject(project)}>
                  <p className="text-sm text-gray-500 leading-relaxed line-clamp-3 mb-4">{project.description || "Sem descrição."}</p>
                  
                  {project.changelog && project.changelog.length > 0 && (
                      <div className="bg-gray-50 p-3 rounded-lg border border-gray-100 mb-4">
                          <p className="text-[10px] font-bold text-gray-400 uppercase mb-1 flex items-center gap-1"><FileText size={10}/> Últimas Alterações</p>
                          <ul className="text-xs text-gray-600 space-y-1 list-disc pl-3">
                              {project.changelog.slice(-2).map((log, i) => (
                                  // --- AQUI ESTAVA O ERRO ---
                                  // Agora usamos renderLogItem para garantir que seja string
                                  <li key={i} className="line-clamp-1">{renderLogItem(log)}</li>
                              ))}
                          </ul>
                      </div>
                  )}

                  <div className="mt-auto">
                      <div className="flex justify-between text-xs font-bold text-gray-500 mb-1">
                          <span>Progresso</span>
                          <span>{project.progress || 0}%</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                          <div className={`h-full rounded-full transition-all duration-1000 ${project.status === 'Concluído' ? 'bg-green-500' : 'bg-black'}`} style={{ width: `${project.progress || 0}%` }}></div>
                      </div>
                  </div>
                </div>

                <div className="p-4 mt-6 bg-gray-50 border-t border-gray-100 flex justify-between items-center">
                  <div className="flex items-center gap-3 text-xs text-gray-500 font-bold">
                      <div className="flex items-center gap-1" title="Data de Entrega"><Calendar size={14} className="text-gray-400"/>{project.deadline ? new Date(project.deadline).toLocaleDateString('pt-BR').slice(0,5) : '--'}</div>
                      {project.leader && <div className="flex items-center gap-1" title={`Líder: ${project.leader}`}><Users size={14} className="text-gray-400"/>{project.leader.split(' ')[0]}</div>}
                  </div>
                  <div className="flex gap-2">
                      <button onClick={() => handleDelete(project.id)} className="p-2 bg-white border border-gray-200 rounded-lg text-gray-400 hover:text-red-500 hover:border-red-200 transition-colors"><Trash2 size={14} /></button>
                      <button onClick={() => navigate(`/tasks?projectId=${project.id}`)} className="flex items-center gap-1 text-xs bg-black text-white px-3 py-1.5 rounded-lg font-bold hover:bg-gray-800 transition-all shadow-sm">Gerenciar <ArrowRight size={12}/></button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* MODAL MANTIDO IGUAL */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-8 animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
            <h2 className="text-2xl font-black text-gray-900 mb-6 flex items-center gap-2">
                {editingId ? <><Edit className="text-shineray"/> Editar Projeto</> : <><Plus className="text-shineray"/> Novo Projeto</>}
            </h2>
            <form onSubmit={handleSave} className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nome do Projeto</label>
                <input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full p-3 border-2 border-gray-100 rounded-xl outline-none focus:border-black font-bold" />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Versão Atual</label>
                    <input value={formData.version} onChange={e => setFormData({...formData, version: e.target.value})} className="w-full p-3 border-2 border-gray-100 rounded-xl outline-none focus:border-black text-sm" placeholder="1.0" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Prioridade</label>
                    <select value={formData.priority} onChange={e => setFormData({...formData, priority: e.target.value})} className="w-full p-3 border-2 border-gray-100 rounded-xl outline-none focus:border-black bg-white text-sm">
                        <option>Baixa</option><option>Média</option><option>Alta</option><option>Crítica</option>
                    </select>
                  </div>
              </div>

              {editingId && (
                  <div className="bg-blue-50 p-3 rounded-xl border border-blue-100">
                      <label className="block text-xs font-bold text-blue-700 uppercase mb-1 flex items-center gap-1"><FileText size={12}/> O que mudou nesta versão?</label>
                      <input value={formData.newLog} onChange={e => setFormData({...formData, newLog: e.target.value})} className="w-full p-2 border border-blue-200 rounded-lg outline-none focus:border-blue-500 text-sm bg-white" placeholder="Ex: Adicionado módulo de relatórios..." />
                  </div>
              )}

              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Descrição</label>
                <textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="w-full p-3 border-2 border-gray-100 rounded-xl outline-none focus:border-black" rows="3"></textarea>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Líder</label>
                    <input value={formData.leader} onChange={e => setFormData({...formData, leader: e.target.value})} className="w-full p-3 border-2 border-gray-100 rounded-xl outline-none focus:border-black text-sm" placeholder="Nome" />
                </div>
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Status</label>
                    <select value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})} className="w-full p-3 border-2 border-gray-100 rounded-xl outline-none focus:border-black bg-white text-sm">
                        <option>Planejamento</option><option>Em Andamento</option><option>Pausado</option><option>Concluído</option>
                    </select>
                </div>
              </div>

              <div className="flex gap-3 pt-4 border-t border-gray-50">
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-3 bg-white border border-gray-200 rounded-xl font-bold text-gray-600 hover:bg-gray-50">Cancelar</button>
                <button type="submit" className="flex-1 py-3 bg-black text-white rounded-xl font-bold hover:bg-gray-800 shadow-lg flex justify-center items-center gap-2"><Save size={18}/> Salvar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectsPage;