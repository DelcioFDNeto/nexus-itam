import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '../services/firebase';
import { doc, getDoc, updateDoc, arrayUnion, Timestamp } from 'firebase/firestore';
import { 
  ArrowLeft, Calendar, User, GitBranch, CheckCircle, 
  FileText, Plus, Save, Clock, Target 
} from 'lucide-react';

const ProjectDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  
  // Estado para adicionar novo Log/Changelog
  const [newLog, setNewLog] = useState('');
  const [isAddingLog, setIsAddingLog] = useState(false);

  useEffect(() => {
    const fetchProject = async () => {
      const docRef = doc(db, 'projects', id);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setProject({ id: docSnap.id, ...docSnap.data() });
      } else {
        alert("Projeto não encontrado");
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
      
      const projectRef = doc(db, 'projects', id);
      await updateDoc(projectRef, {
        changelog: arrayUnion(logEntry)
      });

      // Atualiza localmente
      setProject(prev => ({
        ...prev,
        changelog: [...(prev.changelog || []), logEntry]
      }));
      setNewLog('');
      setIsAddingLog(false);
    } catch (error) {
      alert("Erro ao salvar log.");
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

  if (loading) return <div className="p-10 text-center">Carregando detalhes...</div>;
  if (!project) return null;

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto pb-24">
      
      {/* HEADER */}
      <div className="mb-8">
        <button onClick={() => navigate('/projects')} className="flex items-center gap-2 text-gray-500 hover:text-black mb-4 font-bold text-sm">
            <ArrowLeft size={18}/> Voltar para Projetos
        </button>
        
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="flex items-center gap-4">
                <img src={project.coverImage} alt="Cover" className="w-16 h-16 rounded-xl object-cover shadow-sm border border-gray-200"/>
                <div>
                    <h1 className="text-3xl font-black text-gray-900">{project.name}</h1>
                    <div className="flex items-center gap-3 mt-1">
                        <span className={`px-3 py-0.5 rounded-full text-xs font-bold uppercase border ${getStatusColor(project.status)}`}>
                            {project.status}
                        </span>
                        <span className="flex items-center gap-1 text-xs font-mono font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                            <GitBranch size={12}/> v{project.version}
                        </span>
                    </div>
                </div>
            </div>
            
            <div className="flex gap-4 text-sm text-gray-600 bg-white p-3 rounded-xl border border-gray-200 shadow-sm">
                <div className="flex flex-col items-center px-4 border-r border-gray-100">
                    <span className="text-[10px] uppercase font-bold text-gray-400">Progresso</span>
                    <span className="font-black text-lg text-green-600">{project.progress}%</span>
                </div>
                <div className="flex flex-col items-center px-4 border-r border-gray-100">
                    <span className="text-[10px] uppercase font-bold text-gray-400">Líder</span>
                    <span className="font-bold">{project.leader?.split(' ')[0]}</span>
                </div>
                <div className="flex flex-col items-center px-4">
                    <span className="text-[10px] uppercase font-bold text-gray-400">Deadline</span>
                    <span className="font-bold">{project.deadline ? new Date(project.deadline).toLocaleDateString('pt-BR').slice(0,5) : '--'}</span>
                </div>
            </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* COLUNA ESQUERDA: DESCRIÇÃO E METAS */}
          <div className="lg:col-span-1 space-y-6">
              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                  <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                      <Target size={18} className="text-shineray"/> Escopo
                  </h3>
                  <p className="text-sm text-gray-600 leading-relaxed">
                      {project.description || "Sem descrição definida."}
                  </p>
              </div>

              <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100">
                  <h3 className="font-bold text-blue-900 mb-3 text-sm uppercase tracking-wide">Prioridade</h3>
                  <div className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded-full ${project.priority === 'Crítica' ? 'bg-red-500' : project.priority === 'Alta' ? 'bg-orange-500' : 'bg-green-500'}`}></div>
                      <span className="font-bold text-blue-800">{project.priority}</span>
                  </div>
              </div>
          </div>

          {/* COLUNA DIREITA: CHANGELOG (O CORAÇÃO DA PÁGINA) */}
          <div className="lg:col-span-2">
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                      <h3 className="font-black text-gray-900 flex items-center gap-2">
                          <FileText size={20} className="text-shineray"/> Registro de Alterações (Logs)
                      </h3>
                      {!isAddingLog && (
                          <button onClick={() => setIsAddingLog(true)} className="text-xs bg-black text-white px-3 py-1.5 rounded-lg font-bold hover:bg-gray-800 flex items-center gap-1">
                              <Plus size={14}/> Add Log
                          </button>
                      )}
                  </div>

                  {/* AREA DE NOVO LOG */}
                  {isAddingLog && (
                      <div className="p-4 bg-yellow-50 border-b border-yellow-100">
                          <textarea 
                              autoFocus
                              value={newLog}
                              onChange={e => setNewLog(e.target.value)}
                              placeholder={`O que foi feito na versão ${project.version}?`}
                              className="w-full p-3 border border-yellow-200 rounded-xl text-sm focus:outline-none focus:border-yellow-400 bg-white"
                              rows="3"
                          />
                          <div className="flex justify-end gap-2 mt-2">
                              <button onClick={() => setIsAddingLog(false)} className="px-3 py-1.5 text-xs font-bold text-gray-500 hover:text-gray-800">Cancelar</button>
                              <button onClick={handleAddLog} className="px-4 py-1.5 bg-black text-white rounded-lg text-xs font-bold hover:bg-gray-800 flex items-center gap-1">
                                  <Save size={14}/> Salvar Registro
                              </button>
                          </div>
                      </div>
                  )}

                  {/* LISTA DE LOGS */}
                  <div className="p-6 space-y-6">
                      {(!project.changelog || project.changelog.length === 0) ? (
                          <div className="text-center text-gray-400 py-10 text-sm">Nenhuma alteração registrada ainda.</div>
                      ) : (
                          // Inverte a ordem para mostrar o mais recente primeiro
                          [...project.changelog].reverse().map((log, index) => {
                              // Tenta separar a versão do texto se estiver formatado "v1.0: texto (data)"
                              const parts = log.split(':');
                              const version = parts[0].includes('v') ? parts[0] : '';
                              const content = version ? parts.slice(1).join(':') : log;

                              return (
                                  <div key={index} className="flex gap-4 group">
                                      <div className="flex flex-col items-center">
                                          <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center border border-gray-200 group-hover:border-blue-300 group-hover:bg-blue-50 transition-colors">
                                              <CheckCircle size={14} className="text-gray-400 group-hover:text-blue-500"/>
                                          </div>
                                          {index !== project.changelog.length - 1 && <div className="w-px h-full bg-gray-100 my-1"></div>}
                                      </div>
                                      <div className="pb-6">
                                          {version && <span className="text-[10px] font-bold bg-black text-white px-1.5 py-0.5 rounded mb-1 inline-block">{version}</span>}
                                          <p className="text-sm text-gray-700 leading-relaxed font-medium">{content}</p>
                                          {/* Tenta extrair data se estiver no formato (dd/mm/aaaa) no final */}
                                          <p className="text-[10px] text-gray-400 mt-1 flex items-center gap-1">
                                              <Clock size={10}/> Registro histórico
                                          </p>
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