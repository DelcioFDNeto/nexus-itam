// src/pages/ProjectDetails.jsx
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '../services/firebase';
import { doc, getDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { 
  ArrowLeft, Calendar, User, GitBranch, CheckCircle, 
  FileText, Plus, Save, Clock, Target, Edit3, X, BarChart3
} from 'lucide-react';

const ProjectDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  
  // Estados de Edição
  const [isAddingLog, setIsAddingLog] = useState(false);
  const [newLog, setNewLog] = useState('');
  const [isEditingInfo, setIsEditingInfo] = useState(false);
  const [editForm, setEditForm] = useState({});

  useEffect(() => {
    const fetchProject = async () => {
      const docRef = doc(db, 'projects', id);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = { id: docSnap.id, ...docSnap.data() };
        setProject(data);
        setEditForm(data); // Prepara form de edição
      } else {
        navigate('/projects');
      }
      setLoading(false);
    };
    fetchProject();
  }, [id, navigate]);

  const handleAddLog = async () => {
    if (!newLog.trim()) return;
    try {
      const timestamp = new Date().toLocaleString('pt-BR');
      const logEntry = `v${project.version}: ${newLog} (${timestamp})`;
      
      await updateDoc(doc(db, 'projects', id), {
        changelog: arrayUnion(logEntry)
      });

      setProject(prev => ({ ...prev, changelog: [...(prev.changelog || []), logEntry] }));
      setNewLog('');
      setIsAddingLog(false);
    } catch (error) { alert("Erro ao salvar log."); }
  };

  const handleUpdateInfo = async () => {
      try {
          await updateDoc(doc(db, 'projects', id), {
              description: editForm.description,
              status: editForm.status,
              progress: Number(editForm.progress)
          });
          setProject(prev => ({ ...prev, ...editForm }));
          setIsEditingInfo(false);
      } catch (error) { alert("Erro ao atualizar."); }
  };

  const getStatusColor = (s) => {
    if(s === 'Em Andamento') return 'bg-blue-100 text-blue-700 border-blue-200';
    if(s === 'Concluído') return 'bg-green-100 text-green-700 border-green-200';
    return 'bg-gray-100 text-gray-700 border-gray-200';
  };

  if (loading) return <div className="flex h-screen items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-b-4 border-black"></div></div>;
  if (!project) return null;

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto pb-24">
      
      {/* HEADER DE NAVEGAÇÃO */}
      <button onClick={() => navigate('/projects')} className="flex items-center gap-2 text-gray-500 hover:text-black mb-6 font-bold text-sm transition-colors">
          <ArrowLeft size={18}/> Voltar ao Portfólio
      </button>
      
      {/* CARTÃO PRINCIPAL */}
      <div className="bg-white rounded-3xl p-8 border border-gray-200 shadow-sm mb-8 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
              <GitBranch size={200} />
          </div>

          <div className="relative z-10 flex flex-col md:flex-row gap-8 items-start">
              <img src={project.coverImage} className="w-24 h-24 rounded-2xl object-cover shadow-md border-2 border-white" alt="Logo"/>
              
              <div className="flex-1 space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                      <h1 className="text-4xl font-black text-gray-900 tracking-tight">{project.name}</h1>
                      <span className="px-3 py-1 bg-black text-white text-xs font-mono font-bold rounded-lg">v{project.version}</span>
                  </div>
                  
                  <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                      <div className="flex items-center gap-2 bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-100">
                          <User size={16} className="text-gray-400"/>
                          <span className="font-bold">{project.leader || "Sem líder"}</span>
                      </div>
                      <div className="flex items-center gap-2 bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-100">
                          <Calendar size={16} className="text-gray-400"/>
                          <span className="font-bold">{project.deadline ? new Date(project.deadline).toLocaleDateString('pt-BR') : "Sem prazo"}</span>
                      </div>
                      <span className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase border ${getStatusColor(project.status)}`}>
                          {project.status}
                      </span>
                  </div>
              </div>

              {/* KPI BOX */}
              <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 min-w-[150px] text-center">
                  <p className="text-xs font-black text-gray-400 uppercase tracking-wider mb-1">Progresso</p>
                  <div className="flex justify-center items-end gap-1">
                      <span className={`text-4xl font-black ${project.progress === 100 ? 'text-green-600' : 'text-blue-600'}`}>{project.progress}%</span>
                  </div>
                  <div className="w-full bg-gray-200 h-1.5 rounded-full mt-2 overflow-hidden">
                      <div className={`h-full ${project.progress === 100 ? 'bg-green-500' : 'bg-blue-600'}`} style={{ width: `${project.progress}%` }}></div>
                  </div>
              </div>
          </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* COLUNA ESQUERDA: DETALHES E EDITÁVEIS */}
          <div className="lg:col-span-1 space-y-6">
              
              {/* Card de Escopo (Editável) */}
              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm relative group">
                  <div className="flex justify-between items-center mb-4">
                      <h3 className="font-bold text-gray-900 flex items-center gap-2">
                          <Target size={20} className="text-shineray"/> Escopo & Status
                      </h3>
                      <button onClick={() => setIsEditingInfo(!isEditingInfo)} className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                          <Edit3 size={16}/>
                      </button>
                  </div>

                  {isEditingInfo ? (
                      <div className="space-y-4 animate-in fade-in">
                          <div>
                              <label className="text-xs font-bold text-gray-400 uppercase">Descrição</label>
                              <textarea 
                                  value={editForm.description}
                                  onChange={e => setEditForm({...editForm, description: e.target.value})}
                                  className="w-full p-3 border rounded-xl text-sm mt-1 focus:ring-2 focus:ring-black outline-none"
                                  rows="4"
                              />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                              <div>
                                  <label className="text-xs font-bold text-gray-400 uppercase">Status</label>
                                  <select 
                                      value={editForm.status}
                                      onChange={e => setEditForm({...editForm, status: e.target.value})}
                                      className="w-full p-2 border rounded-lg text-sm mt-1 bg-white"
                                  >
                                      <option>Planejamento</option>
                                      <option>Em Andamento</option>
                                      <option>Pausado</option>
                                      <option>Concluído</option>
                                  </select>
                              </div>
                              <div>
                                  <label className="text-xs font-bold text-gray-400 uppercase">Progresso (%)</label>
                                  <input 
                                      type="number"
                                      value={editForm.progress}
                                      onChange={e => setEditForm({...editForm, progress: e.target.value})}
                                      className="w-full p-2 border rounded-lg text-sm mt-1"
                                  />
                              </div>
                          </div>
                          <div className="flex gap-2">
                              <button onClick={handleUpdateInfo} className="flex-1 bg-black text-white py-2 rounded-lg text-xs font-bold hover:bg-gray-800">Salvar</button>
                              <button onClick={() => setIsEditingInfo(false)} className="flex-1 bg-gray-100 text-gray-600 py-2 rounded-lg text-xs font-bold">Cancelar</button>
                          </div>
                      </div>
                  ) : (
                      <div className="space-y-4">
                          <p className="text-sm text-gray-600 leading-relaxed">
                              {project.description || "Nenhuma descrição detalhada fornecida."}
                          </p>
                          <div className="pt-4 border-t border-gray-100 grid grid-cols-2 gap-4">
                              <div>
                                  <p className="text-[10px] text-gray-400 font-bold uppercase">Prioridade</p>
                                  <p className={`font-bold text-sm ${project.priority === 'Crítica' ? 'text-red-600' : 'text-gray-800'}`}>{project.priority}</p>
                              </div>
                              <div>
                                  <p className="text-[10px] text-gray-400 font-bold uppercase">Total Logs</p>
                                  <p className="font-bold text-sm text-gray-800">{project.changelog?.length || 0}</p>
                              </div>
                          </div>
                      </div>
                  )}
              </div>
          </div>

          {/* COLUNA DIREITA: TIMELINE DE LOGS */}
          <div className="lg:col-span-2">
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex flex-col h-full">
                  <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                      <h3 className="font-black text-gray-900 flex items-center gap-2">
                          <FileText size={20} className="text-shineray"/> Histórico de Versões
                      </h3>
                      {!isAddingLog && (
                          <button onClick={() => setIsAddingLog(true)} className="bg-black text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-gray-800 flex items-center gap-2 shadow-lg hover:scale-105 transition-all">
                              <Plus size={16}/> Novo Registro
                          </button>
                      )}
                  </div>

                  {isAddingLog && (
                      <div className="p-6 bg-yellow-50 border-b border-yellow-100 animate-in slide-in-from-top-2">
                          <p className="text-xs font-bold text-yellow-800 uppercase mb-2">O que foi feito nesta versão?</p>
                          <textarea 
                              autoFocus
                              value={newLog}
                              onChange={e => setNewLog(e.target.value)}
                              className="w-full p-4 border-2 border-yellow-200 rounded-xl text-sm focus:outline-none focus:border-yellow-500 bg-white shadow-sm"
                              rows="3"
                              placeholder="Ex: Corrigido bug na tela de login..."
                          />
                          <div className="flex justify-end gap-3 mt-3">
                              <button onClick={() => setIsAddingLog(false)} className="px-4 py-2 text-xs font-bold text-gray-500 hover:text-black">Cancelar</button>
                              <button onClick={handleAddLog} className="px-5 py-2 bg-yellow-500 text-white rounded-lg text-xs font-bold hover:bg-yellow-600 shadow-md flex items-center gap-2">
                                  <Save size={16}/> Salvar no Histórico
                              </button>
                          </div>
                      </div>
                  )}

                  <div className="p-6 space-y-8 flex-1 overflow-y-auto custom-scrollbar max-h-[600px]">
                      {(!project.changelog || project.changelog.length === 0) ? (
                          <div className="text-center py-12 text-gray-400">
                              <BarChart3 size={48} className="mx-auto mb-3 opacity-20"/>
                              <p className="text-sm">Projeto iniciado. Nenhum log registrado.</p>
                          </div>
                      ) : (
                          [...project.changelog].reverse().map((log, index) => {
                              const parts = log.split(':');
                              const version = parts[0].includes('v') ? parts[0] : '';
                              const content = version ? parts.slice(1).join(':') : log;

                              return (
                                  <div key={index} className="flex gap-5 group">
                                      <div className="flex flex-col items-center">
                                          <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center border-2 border-gray-100 group-hover:border-blue-500 group-hover:text-blue-600 text-gray-300 transition-colors shadow-sm z-10">
                                              <CheckCircle size={18} />
                                          </div>
                                          {index !== project.changelog.length - 1 && <div className="w-0.5 h-full bg-gray-100 -my-2 group-hover:bg-blue-50 transition-colors"></div>}
                                      </div>
                                      <div className="pb-2 flex-1">
                                          <div className="bg-gray-50 p-4 rounded-xl border border-gray-100 group-hover:border-blue-200 group-hover:shadow-md transition-all">
                                              <div className="flex justify-between items-start mb-2">
                                                  {version && <span className="text-[10px] font-black bg-black text-white px-2 py-1 rounded shadow-sm">{version}</span>}
                                                  <span className="text-[10px] text-gray-400 font-mono flex items-center gap-1"><Clock size={10}/> Histórico</span>
                                              </div>
                                              <p className="text-sm text-gray-700 font-medium leading-relaxed">{content}</p>
                                          </div>
                                      </div>
                                  </div>
                              );
                          })
                      )}
                  </div>
              </div>
          </div>
      </div>
    </div>
  );
};

export default ProjectDetails;