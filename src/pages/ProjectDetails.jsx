import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '../services/firebase';
import { doc, getDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { 
  ArrowLeft, Calendar, User, GitBranch, CheckCircle, 
  FileText, Plus, Save, Clock, Target, Edit3, X, 
  BarChart3, DollarSign, Users, ImageIcon, Trash2, 
  ChevronDown, ChevronUp
} from 'lucide-react';

const ProjectDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  
  // Estados de Interação
  const [isAddingLog, setIsAddingLog] = useState(false);
  const [newLog, setNewLog] = useState('');
  
  // Estado para controlar a expansão dos logs
  const [showAllLogs, setShowAllLogs] = useState(false); 

  // Modal de Edição Geral
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editFormData, setEditFormData] = useState({});

  useEffect(() => {
    const fetchProject = async () => {
      try {
        const docRef = doc(db, 'projects', id);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setProject({ id: docSnap.id, ...docSnap.data() });
        } else {
          navigate('/projects');
        }
      } catch (error) {
        console.error("Erro ao buscar projeto:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchProject();
  }, [id, navigate]);

  // --- ACTIONS ---

  const handleAddLog = async () => {
    if (!newLog.trim()) return;
    try {
      const timestamp = new Date().toLocaleString('pt-BR');
      const logEntry = `v${project.version || '1.0'}: ${newLog} (${timestamp})`;
      
      await updateDoc(doc(db, 'projects', id), {
        changelog: arrayUnion(logEntry)
      });

      setProject(prev => ({
        ...prev,
        changelog: [...(prev.changelog || []), logEntry]
      }));
      setNewLog('');
      setIsAddingLog(false);
      setShowAllLogs(true); 
    } catch (error) {
      alert("Erro ao salvar log.");
    }
  };

  const handleDeleteLog = async (logToDelete) => {
    if (!confirm("Tem certeza que deseja excluir este registro?")) return;

    try {
        const newChangelog = project.changelog.filter(log => log !== logToDelete);

        await updateDoc(doc(db, 'projects', id), {
            changelog: newChangelog
        });

        setProject(prev => ({
            ...prev,
            changelog: newChangelog
        }));

    } catch (error) {
        console.error(error);
        alert("Erro ao excluir log.");
    }
  };

  const handleSaveChanges = async (e) => {
      e.preventDefault();
      try {
          await updateDoc(doc(db, 'projects', id), editFormData);
          setProject(prev => ({ ...prev, ...editFormData }));
          setIsEditModalOpen(false);
      } catch (error) {
          alert("Erro ao atualizar projeto.");
      }
  };

  const openEditModal = () => {
      setEditFormData({
          name: project.name,
          description: project.description || '',
          status: project.status,
          priority: project.priority,
          leader: project.leader || '',
          budget: project.budget || '',
          coverImage: project.coverImage || '',
          deadline: project.deadline || '',
          progress: project.progress || 0,
          version: project.version || '1.0'
      });
      setIsEditModalOpen(true);
  };

  // --- HELPERS ---
  
  const getLeaderName = (leader) => {
      if (typeof leader === 'string') return leader.split(' ')[0];
      return "Indefinido";
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
      case 'Em Andamento': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'Concluído': return 'bg-green-100 text-green-700 border-green-200';
      case 'Pausado': return 'bg-orange-100 text-orange-700 border-orange-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  // --- RENDER CHECKS (CRUCIAL: ISTO DEVE VIR ANTES DE ACESSAR project.*) ---
  
  if (loading) return <div className="flex h-screen items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-b-4 border-black"></div></div>;
  if (!project) return null;

  // --- LOGIC EXECUTION (AGORA É SEGURO ACESSAR O PROJECT) ---

  const renderLogs = () => {
      if (!project.changelog || project.changelog.length === 0) return [];
      const allLogs = [...project.changelog].reverse();
      return showAllLogs ? allLogs : allLogs.slice(0, 3);
  };

  const visibleLogs = renderLogs();
  const totalLogs = project.changelog?.length || 0;

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto pb-24">
      
      {/* HEADER */}
      <div className="flex justify-between items-center mb-6">
        <button onClick={() => navigate('/projects')} className="flex items-center gap-2 text-gray-500 hover:text-black font-bold text-sm transition-colors">
            <ArrowLeft size={18}/> Voltar
        </button>
        <button onClick={openEditModal} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-xs font-bold hover:bg-gray-50 shadow-sm transition-all">
            <Edit3 size={16}/> Editar Projeto
        </button>
      </div>
      
      {/* BANNER */}
      <div className="bg-white rounded-3xl border border-gray-200 shadow-sm mb-8 overflow-hidden relative">
          <div className="h-32 w-full bg-cover bg-center absolute top-0 left-0 opacity-10" style={{ backgroundImage: `url(${project.coverImage || 'https://ui-avatars.com/api/?background=random'})` }}></div>
          <div className="relative z-10 p-8 pt-12 flex flex-col md:flex-row gap-8 items-start">
              <img src={project.coverImage || `https://ui-avatars.com/api/?name=${project.name}&background=random`} className="w-24 h-24 rounded-2xl object-cover shadow-lg border-4 border-white bg-white" alt="Logo"/>
              <div className="flex-1 space-y-3 mt-2">
                  <div className="flex flex-wrap items-center gap-3">
                      <h1 className="text-3xl md:text-4xl font-black text-gray-900 tracking-tight leading-none">{project.name}</h1>
                      <span className="px-3 py-1 bg-black text-white text-xs font-mono font-bold rounded-lg shadow-sm">v{project.version || '1.0'}</span>
                  </div>
                  <div className="flex flex-wrap gap-3 text-sm text-gray-600">
                      <span className={`px-3 py-1 rounded-lg text-xs font-bold uppercase border ${getStatusColor(project.status)}`}>{project.status}</span>
                      <div className="flex items-center gap-2 bg-gray-50 px-3 py-1 rounded-lg border border-gray-100"><User size={14} className="text-gray-400"/><span className="font-bold">{getLeaderName(project.leader)}</span></div>
                      <div className="flex items-center gap-2 bg-gray-50 px-3 py-1 rounded-lg border border-gray-100"><Calendar size={14} className="text-gray-400"/><span className="font-bold">{project.deadline ? new Date(project.deadline).toLocaleDateString('pt-BR') : "Sem prazo"}</span></div>
                  </div>
              </div>
              <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm min-w-[160px] text-center hidden md:block">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1">Progresso</p>
                  <div className="flex justify-center items-end gap-1"><span className={`text-4xl font-black ${project.progress === 100 ? 'text-green-600' : 'text-blue-600'}`}>{project.progress || 0}%</span></div>
                  <div className="w-full bg-gray-100 h-1.5 rounded-full mt-2 overflow-hidden"><div className={`h-full ${project.progress === 100 ? 'bg-green-500' : 'bg-blue-600'}`} style={{ width: `${project.progress || 0}%` }}></div></div>
              </div>
          </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          <div className="lg:col-span-1 space-y-6">
              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                  <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2 text-sm uppercase tracking-wide"><Target size={18} className="text-shineray"/> Escopo</h3>
                  <p className="text-sm text-gray-600 leading-relaxed text-justify">{project.description || "Nenhuma descrição."}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                  <div className="bg-blue-50 p-5 rounded-2xl border border-blue-100">
                      <div className="flex items-center gap-2 mb-2 text-blue-800"><DollarSign size={18}/><span className="text-xs font-bold uppercase">Orçamento</span></div>
                      <p className="text-lg font-black text-blue-900">{project.budget ? `R$ ${project.budget}` : '--'}</p>
                  </div>
                  <div className={`p-5 rounded-2xl border ${project.priority === 'Crítica' ? 'bg-red-50 border-red-100 text-red-900' : 'bg-green-50 border-green-100 text-green-900'}`}>
                      <div className="flex items-center gap-2 mb-2"><BarChart3 size={18}/><span className="text-xs font-bold uppercase">Prioridade</span></div>
                      <p className="text-lg font-black">{project.priority || 'Média'}</p>
                  </div>
              </div>
              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                  <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2 text-sm uppercase tracking-wide"><Users size={18} className="text-shineray"/> Equipe</h3>
                  <div className="flex -space-x-2 overflow-hidden mb-2">
                      <div className="inline-block h-8 w-8 rounded-full ring-2 ring-white bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-600">{getLeaderName(project.leader).substring(0,2)}</div>
                      <div className="inline-block h-8 w-8 rounded-full ring-2 ring-white bg-gray-800 flex items-center justify-center text-xs font-bold text-white">+</div>
                  </div>
                  <p className="text-xs text-gray-400">Gerido por {project.leader || 'TI'}</p>
              </div>
          </div>

          <div className="lg:col-span-2">
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">
                  
                  <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                      <h3 className="font-black text-gray-900 flex items-center gap-2">
                          <FileText size={20} className="text-shineray"/> Diário de Bordo
                      </h3>
                      {!isAddingLog && (
                          <button onClick={() => setIsAddingLog(true)} className="bg-black text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-gray-800 flex items-center gap-2 shadow-lg transition-all">
                              <Plus size={16}/> Add Log
                          </button>
                      )}
                  </div>

                  {isAddingLog && (
                      <div className="p-6 bg-yellow-50 border-b border-yellow-100 animate-in slide-in-from-top-2">
                          <p className="text-xs font-bold text-yellow-800 uppercase mb-2">Nova atualização para v{project.version}</p>
                          <textarea 
                              autoFocus
                              value={newLog}
                              onChange={e => setNewLog(e.target.value)}
                              className="w-full p-4 border-2 border-yellow-200 rounded-xl text-sm focus:outline-none focus:border-yellow-500 bg-white shadow-sm"
                              rows="5"
                              placeholder="Status:&#10;O que foi feito:"
                          />
                          <div className="flex justify-end gap-3 mt-3">
                              <button onClick={() => setIsAddingLog(false)} className="px-4 py-2 text-xs font-bold text-gray-500 hover:text-black">Cancelar</button>
                              <button onClick={handleAddLog} className="px-5 py-2 bg-yellow-500 text-white rounded-lg text-xs font-bold hover:bg-yellow-600 shadow-md flex items-center gap-2">
                                  <Save size={16}/> Salvar
                              </button>
                          </div>
                      </div>
                  )}

                  {/* LISTA DE LOGS */}
                  <div className="p-6 space-y-8">
                      {totalLogs === 0 ? (
                          <div className="text-center py-12 text-gray-400">
                              <BarChart3 size={48} className="mx-auto mb-3 opacity-20"/>
                              <p className="text-sm">Nenhum histórico registrado.</p>
                          </div>
                      ) : (
                          visibleLogs.map((log, index) => {
                              const { version, content, date } = safeRenderLog(log);
                              return (
                                  <div key={index} className="flex gap-5 group/item">
                                      <div className="flex flex-col items-center">
                                          <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center border-2 border-gray-100 group-hover/item:border-blue-500 group-hover/item:text-blue-600 text-gray-300 transition-colors shadow-sm z-10">
                                              <CheckCircle size={18} />
                                          </div>
                                          {/* Linha conectora: Só mostra se NÃO for o último item visualizado */}
                                          {(index !== visibleLogs.length - 1) && <div className="w-0.5 h-full bg-gray-100 -my-2 group-hover/item:bg-blue-50 transition-colors"></div>}
                                      </div>

                                      <div className="pb-8 flex-1 min-w-0">
                                          <div className="bg-gray-50 p-5 rounded-2xl border border-gray-100 group-hover/item:border-blue-200 group-hover/item:shadow-md transition-all relative">
                                              <button 
                                                  onClick={() => handleDeleteLog(log)}
                                                  className="absolute top-4 right-4 p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover/item:opacity-100 transition-all z-20"
                                                  title="Excluir Registro"
                                              >
                                                  <Trash2 size={14}/>
                                              </button>

                                              <div className="flex flex-wrap justify-between items-center mb-3 pb-3 border-b border-gray-200 pr-8">
                                                  <div className="flex items-center gap-2">
                                                      {version && <span className="text-[10px] font-black bg-black text-white px-2 py-1 rounded shadow-sm">{version}</span>}
                                                      <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider flex items-center gap-1">
                                                          <Clock size={12}/> {date || "Data desconhecida"}
                                                      </span>
                                                  </div>
                                              </div>

                                              <div className="text-sm text-gray-700 font-medium leading-relaxed whitespace-pre-wrap font-sans">
                                                  {content}
                                              </div>
                                          </div>
                                      </div>
                                  </div>
                              );
                          })
                      )}
                  </div>

                  {/* BOTÃO VER MAIS / VER MENOS */}
                  {totalLogs > 3 && (
                      <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-center">
                          <button 
                              onClick={() => setShowAllLogs(!showAllLogs)}
                              className="flex items-center gap-2 text-xs font-bold text-gray-500 hover:text-black bg-white px-4 py-2 rounded-full border border-gray-200 shadow-sm hover:shadow-md transition-all"
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
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-black text-gray-900 flex items-center gap-2"><Edit3 size={20}/> Editar Projeto</h2>
                <button onClick={() => setIsEditModalOpen(false)}><X size={20}/></button>
            </div>
            
            <form onSubmit={handleSaveChanges} className="space-y-4">
              <div>
                  <label className="text-xs font-bold text-gray-500 uppercase">Nome do Projeto</label>
                  <input required value={editFormData.name} onChange={e => setEditFormData({...editFormData, name: e.target.value})} className="w-full p-3 border rounded-xl font-bold mt-1 outline-none focus:border-black" />
              </div>
              <div>
                  <label className="text-xs font-bold text-gray-500 uppercase">URL da Capa (Logo)</label>
                  <div className="flex gap-2">
                      <input value={editFormData.coverImage} onChange={e => setEditFormData({...editFormData, coverImage: e.target.value})} className="w-full p-3 border rounded-xl mt-1 text-sm text-blue-600 outline-none focus:border-black" placeholder="https://..." />
                      <div className="p-3 bg-gray-100 rounded-xl mt-1 border border-gray-200"><ImageIcon size={20} className="text-gray-400"/></div>
                  </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                  <div>
                      <label className="text-xs font-bold text-gray-500 uppercase">Versão Atual</label>
                      <input value={editFormData.version} onChange={e => setEditFormData({...editFormData, version: e.target.value})} className="w-full p-3 border rounded-xl mt-1 font-mono text-sm" />
                  </div>
                  <div>
                      <label className="text-xs font-bold text-gray-500 uppercase">Progresso (%)</label>
                      <input type="number" value={editFormData.progress} onChange={e => setEditFormData({...editFormData, progress: e.target.value})} className="w-full p-3 border rounded-xl mt-1 text-sm" />
                  </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                  <div>
                      <label className="text-xs font-bold text-gray-500 uppercase">Líder</label>
                      <input value={editFormData.leader} onChange={e => setEditFormData({...editFormData, leader: e.target.value})} className="w-full p-3 border rounded-xl mt-1 text-sm" />
                  </div>
                  <div>
                      <label className="text-xs font-bold text-gray-500 uppercase">Orçamento (R$)</label>
                      <input value={editFormData.budget} onChange={e => setEditFormData({...editFormData, budget: e.target.value})} className="w-full p-3 border rounded-xl mt-1 text-sm" placeholder="0,00" />
                  </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                  <div>
                      <label className="text-xs font-bold text-gray-500 uppercase">Status</label>
                      <select value={editFormData.status} onChange={e => setEditFormData({...editFormData, status: e.target.value})} className="w-full p-3 border rounded-xl mt-1 bg-white text-sm">
                          <option>Planejamento</option>
                          <option>Em Andamento</option>
                          <option>Pausado</option>
                          <option>Concluído</option>
                      </select>
                  </div>
                  <div>
                      <label className="text-xs font-bold text-gray-500 uppercase">Prioridade</label>
                      <select value={editFormData.priority} onChange={e => setEditFormData({...editFormData, priority: e.target.value})} className="w-full p-3 border rounded-xl mt-1 bg-white text-sm">
                          <option>Baixa</option>
                          <option>Média</option>
                          <option>Alta</option>
                          <option>Crítica</option>
                      </select>
                  </div>
              </div>
              <div>
                  <label className="text-xs font-bold text-gray-500 uppercase">Descrição</label>
                  <textarea value={editFormData.description} onChange={e => setEditFormData({...editFormData, description: e.target.value})} className="w-full p-3 border rounded-xl mt-1 text-sm" rows="3"></textarea>
              </div>
              <div className="pt-2">
                  <button type="submit" className="w-full bg-black text-white py-3 rounded-xl font-bold hover:bg-gray-800 shadow-lg">Salvar Alterações</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectDetails;