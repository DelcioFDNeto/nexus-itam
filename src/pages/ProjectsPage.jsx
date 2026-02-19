// src/pages/ProjectsPage.jsx
import React, { useState, useEffect } from 'react';
import { getProjects, createProject, deleteProject } from '../services/projectService';
import { 
  FolderGit2, Plus, Calendar, Trash2, ArrowRight, 
  GitBranch, CheckSquare, Square, X, Users, LayoutGrid, List, Kanban 
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const ProjectsPage = () => {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'kanban'
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form State para NOVO projeto
  const [formData, setFormData] = useState({
    name: '', description: '', status: 'Planejamento', priority: 'Média', leader: '', deadline: '', version: '2.0'
  });

  const loadProjects = async () => {
    setLoading(true);
    const data = await getProjects();
    setProjects(data);
    setLoading(false);
  };

  useEffect(() => { loadProjects(); }, []);

  // AUTO-SEED: ITAM 2.0 Project Log
  useEffect(() => {
    const seedProject = async () => {
        const existing = await getProjects();
        if (!existing.find(p => p.name === 'Desenvolvimento ITAM 2.0')) {
            await createProject({
                name: 'Desenvolvimento ITAM 2.0',
                description: 'Refatoração completa do sistema, rebranding e melhorias de UI/UX (Versão 2.0).',
                status: 'Concluído',
                priority: 'Alta',
                leader: 'Antigravity AI',
                deadline: new Date().toISOString(),
                version: '2.0.0',
                progress: 100,
                coverImage: 'https://ui-avatars.com/api/?name=ITAM+2.0&background=000&color=fff&size=128&bold=true',
                changelog: [
                    'v2.0.0: Release oficial da versão 2.0 - UI/UX Overhaul Completo.',
                    'v2.0.0: Rebranding para BySabel ITAM (Logo, Cores, Textos).',
                    'v1.9.5: Termo de Responsabilidade Jurídico (CLT Art. 462 §1º) com assinatura.',
                    'v1.9.0: Nova tela de Detalhes do Ativo (Hero Section, Bento Grid, Timeline).',
                    'v1.8.5: Refatoração do Formulário de Ativos (Cards, Inputs Premium, Ícones).',
                    'v1.8.0: Lista de Ativos 2.0 (Filtros, Modais de Ação, Mobile Cards).',
                    'v1.7.5: Sidebar Responsiva com navegação colapsável e badges.',
                    'v1.7.0: Sistema de Backup e Restore Avançado com validação de dados.',
                    'v1.6.5: Módulo de Importação Inteligente (Excel/JSON) com análise prévia.',
                    'v1.6.0: Dashboard otimizado com Skeleton Loading e novos KPIs.',
                    'v1.5.0: Auditoria de Ativos com Scanner QR Code integrado.',
                    'v1.0.0: Versão Inicial (Legacy).'
                ]
            });
            loadProjects(); // Reload to show
        }
    };
    seedProject();
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    const enrichedData = {
        ...formData,
        coverImage: `https://ui-avatars.com/api/?name=${formData.name}&background=random&size=128&bold=true`, 
        changelog: [`v${formData.version}: Projeto iniciado.`],
        progress: 0
    };
    await createProject(enrichedData);
    setFormData({ name: '', description: '', status: 'Planejamento', priority: 'Média', leader: '', deadline: '', version: '2.0' });
    setIsModalOpen(false);
    loadProjects();
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if(confirm("Apagar projeto e todo seu histórico?")) {
      await deleteProject(id);
      loadProjects();
    }
  };

  // --- KANBAN LOGIC ---
  const KANBAN_COLUMNS = [
      { id: 'Planejamento', label: 'Planejamento', color: 'bg-gray-100 border-gray-200' },
      { id: 'Em Andamento', label: 'Em Execução', color: 'bg-blue-50 border-blue-100' },
      { id: 'Concluído', label: 'Entregue', color: 'bg-green-50 border-green-100' }
  ];

  const getProjectsByStatus = (status) => {
      // Normalização simples para matching
      return projects.filter(p => {
         if (status === 'Planejamento') return p.status === 'Planejamento' || p.status === 'Pausado';
         if (status === 'Em Andamento') return p.status === 'Em Andamento' || p.status === 'Revisão';
         if (status === 'Concluído') return p.status === 'Concluído';
         return false;
      });
  };

  // --- COMPONENTES VISUAIS ---
  const ProjectCard = ({ project }) => (
    <div 
        onClick={() => navigate(`/projects/${project.id}`)} 
        className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer group flex flex-col h-full"
    >
        <div className="flex justify-between items-start mb-4">
            <div className="flex gap-3">
                <img src={project.coverImage} alt="Logo" className="w-10 h-10 rounded-lg object-cover shadow-sm bg-gray-100" />
                <div>
                    <h3 className="font-bold text-gray-900 leading-tight group-hover:text-blue-600 transition-colors line-clamp-1">{project.name}</h3>
                    <p className="text-[10px] text-gray-500 font-mono uppercase mt-0.5">v{project.version}</p>
                </div>
            </div>
            {viewMode === 'grid' && (
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${project.status === 'Em Andamento' ? 'bg-blue-100 text-blue-700' : project.status === 'Concluído' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                    {project.status}
                </span>
            )}
        </div>

        <p className="text-xs text-gray-500 leading-relaxed line-clamp-2 mb-4 flex-1">{project.description}</p>

        <div className="mt-auto space-y-3">
            {/* Progress Bar */}
            <div>
                <div className="flex justify-between text-[10px] font-bold text-gray-400 mb-1">
                    <span>Progresso</span><span>{project.progress || 0}%</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                    <div className={`h-full rounded-full transition-all duration-500 ${project.status === 'Concluído' ? 'bg-green-500' : 'bg-gradient-to-r from-blue-600 to-purple-600'}`} style={{ width: `${project.progress || 0}%` }}></div>
                </div>
            </div>

            <div className="pt-3 border-t border-gray-100 flex justify-between items-center">
                <div className="flex -space-x-2">
                     {/* Fake Avatars para 'Equipe' */}
                    {[1,2,3].map(i => (
                        <div key={i} className="w-6 h-6 rounded-full bg-gray-200 border-2 border-white flex items-center justify-center text-[8px] font-bold text-gray-500">U{i}</div>
                    ))}
                </div>
                <div className="flex items-center gap-2">
                     <span className="text-[10px] font-bold text-gray-400 flex items-center gap-1">
                        <Calendar size={12}/> {project.deadline ? new Date(project.deadline).toLocaleDateString('pt-BR').slice(0,5) : 'ND'}
                     </span>
                     <button onClick={(e) => handleDelete(project.id, e)} className="text-gray-300 hover:text-red-500 transition-colors"><Trash2 size={14}/></button>
                </div>
            </div>
        </div>
    </div>
  );

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto pb-24 space-y-8 min-h-screen">
      
      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-end gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-900 flex items-center gap-3">
            <FolderGit2 className="text-brand" size={32} /> Central de Projetos
          </h1>
          <p className="text-gray-500 mt-1">Gerencie iniciativas, prazos e entregas de forma visual.</p>
        </div>
        
        <div className="flex items-center gap-3 bg-white p-1 rounded-xl border border-gray-200 shadow-sm">
            <button onClick={() => setViewMode('grid')} className={`p-2 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-black text-white shadow' : 'text-gray-400 hover:text-black'}`}><LayoutGrid size={20}/></button>
            <button onClick={() => setViewMode('kanban')} className={`p-2 rounded-lg transition-all ${viewMode === 'kanban' ? 'bg-black text-white shadow' : 'text-gray-400 hover:text-black'}`}><Kanban size={20}/></button>
            <div className="w-[1px] h-6 bg-gray-200 mx-1"></div>
            <button onClick={() => setIsModalOpen(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-blue-700 flex items-center gap-2 text-sm shadow-lg shadow-blue-200">
                <Plus size={18} /> Novo Projeto
            </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
             <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-black"></div>
        </div>
      ) : (
        <>
           {viewMode === 'grid' ? (
                // GRID VIEW
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {projects.map(project => <ProjectCard key={project.id} project={project} />)}
                    {projects.length === 0 && (
                        <div className="col-span-full text-center py-20 text-gray-400 border-2 border-dashed border-gray-200 rounded-3xl">
                            <FolderGit2 size={48} className="mx-auto mb-4 opacity-20"/>
                            <p>Nenhum projeto encontrado. Crie o primeiro!</p>
                        </div>
                    )}
                </div>
           ) : (
                // KANBAN VIEW
                <div className="flex gap-6 overflow-x-auto pb-4 items-start min-h-[600px]">
                    {KANBAN_COLUMNS.map(col => (
                        <div key={col.id} className="min-w-[320px] w-[350px] flex-shrink-0 flex flex-col bg-gray-50/50 rounded-2xl border border-gray-200/60 max-h-full">
                            <div className={`p-4 border-b ${col.color.split(' ')[1]} rounded-t-2xl flex justify-between items-center sticky top-0 bg-white/50 backdrop-blur-sm z-10`}>
                                <h3 className="font-bold text-gray-700">{col.label}</h3>
                                <span className="bg-white px-2 py-0.5 rounded-full text-xs font-bold border border-gray-200 text-gray-500 shadow-sm">
                                    {getProjectsByStatus(col.id).length}
                                </span>
                            </div>
                            <div className="p-3 space-y-3 overflow-y-auto max-h-[70vh] custom-scrollbar">
                                {getProjectsByStatus(col.id).map(project => (
                                    <div key={project.id} className="transform hover:scale-[1.02] transition-transform">
                                        <ProjectCard project={project} />
                                    </div>
                                ))}
                                {getProjectsByStatus(col.id).length === 0 && (
                                    <div className="h-32 flex items-center justify-center border-2 border-dashed border-gray-200 rounded-xl">
                                        <p className="text-xs text-gray-400 font-bold uppercase">Vazio</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
           )}
        </>
      )}

      {/* MODAL CRIAR */}
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