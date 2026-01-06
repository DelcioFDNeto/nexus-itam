// src/pages/TaskManager.jsx
import React, { useState, useEffect } from 'react';
import { getTasks, addTask, updateTask, deleteTask } from '../services/taskService';
import { 
  CheckSquare, Plus, Trash2, Calendar, Square, Edit, 
  Filter, X, AlertCircle, Save 
} from 'lucide-react';

const TaskManager = () => {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Estados de Filtro
  const [filter, setFilter] = useState('active'); // 'active', 'urgent', 'completed', 'all'
  const [newTaskTitle, setNewTaskTitle] = useState('');

  // Estados de Edição (Modal)
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingTask, setEditingTask] = useState(null);

  useEffect(() => { loadTasks(); }, []);

  const loadTasks = async () => {
    const data = await getTasks();
    // Ordena: Não concluídos primeiro, depois por prioridade (Alta > Média > Baixa)
    const sorted = data.sort((a, b) => {
        if (a.status === b.status) {
            const prio = { 'Alta': 3, 'Média': 2, 'Baixa': 1 };
            return (prio[b.priority] || 0) - (prio[a.priority] || 0);
        }
        return a.status === 'Concluído' ? 1 : -1;
    });
    setTasks(sorted);
    setLoading(false);
  };

  const handleQuickAdd = async (e) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;
    
    await addTask({
        title: newTaskTitle,
        status: 'A Fazer',
        priority: 'Média',
        category: 'Geral',
        createdAt: new Date()
    });
    
    setNewTaskTitle('');
    loadTasks();
  };

  const handleUpdateTask = async (e) => {
      e.preventDefault();
      try {
          await updateTask(editingTask.id, editingTask);
          setIsEditOpen(false);
          loadTasks();
      } catch (error) { alert("Erro ao atualizar"); }
  };

  const toggleStatus = async (task) => {
      const newStatus = task.status === 'Concluído' ? 'A Fazer' : 'Concluído';
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: newStatus } : t));
      await updateTask(task.id, { status: newStatus });
  };

  const handleDelete = async (id) => {
      if(confirm("Excluir tarefa permanentemente?")) {
          await deleteTask(id);
          setTasks(prev => prev.filter(t => t.id !== id));
      }
  };

  // --- LÓGICA DE FILTRAGEM ---
  const filteredTasks = tasks.filter(t => {
      if (filter === 'active') return t.status !== 'Concluído';
      if (filter === 'completed') return t.status === 'Concluído';
      if (filter === 'urgent') return t.status !== 'Concluído' && t.priority === 'Alta';
      return true; // all
  });

  const getPriorityBadge = (p) => {
      const colors = { 'Alta': 'bg-red-100 text-red-700 border-red-200', 'Média': 'bg-yellow-100 text-yellow-700 border-yellow-200', 'Baixa': 'bg-green-100 text-green-700 border-green-200' };
      return <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${colors[p] || colors['Média']}`}>{p}</span>;
  };

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto pb-24">
      
      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-end mb-8 gap-4">
          <div>
              <h1 className="text-2xl font-black text-gray-900 flex items-center gap-2">
                  <CheckSquare className="text-shineray"/> Tarefas do Expediente
              </h1>
              <p className="text-gray-500 text-sm">Lista operacional diária.</p>
          </div>
          
          {/* BARRA DE FILTROS */}
          <div className="flex bg-gray-100 p-1 rounded-xl overflow-x-auto max-w-full">
              {[
                  { id: 'active', label: 'Pendentes' },
                  { id: 'urgent', label: 'Urgentes' },
                  { id: 'completed', label: 'Feitas' },
                  { id: 'all', label: 'Todas' }
              ].map(opt => (
                  <button 
                    key={opt.id}
                    onClick={() => setFilter(opt.id)}
                    className={`px-4 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${filter === opt.id ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                      {opt.label}
                  </button>
              ))}
          </div>
      </div>

      {/* INPUT RÁPIDO */}
      <form onSubmit={handleQuickAdd} className="mb-8 relative group">
          <input 
            value={newTaskTitle}
            onChange={e => setNewTaskTitle(e.target.value)}
            placeholder="O que precisa ser feito agora?" 
            className="w-full p-4 pl-12 bg-white border-2 border-gray-200 rounded-2xl outline-none focus:border-black font-medium shadow-sm transition-all group-hover:border-gray-300"
          />
          <Plus className="absolute left-4 top-4.5 text-gray-400 group-hover:text-black transition-colors" size={24}/>
          <button type="submit" className="absolute right-3 top-3 bg-black text-white px-4 py-1.5 rounded-lg font-bold text-xs hover:bg-gray-800 uppercase tracking-wide">
              Adicionar
          </button>
      </form>

      {/* LISTA */}
      <div className="space-y-3">
          {loading ? <p className="text-center text-gray-400 py-10">Carregando tarefas...</p> : 
           filteredTasks.length === 0 ? (
              <div className="text-center py-16 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                  <p className="text-gray-400 text-sm font-medium">Nenhuma tarefa nesta lista.</p>
              </div>
           ) : (
              filteredTasks.map(task => (
                  <div key={task.id} className={`group flex items-start gap-4 bg-white p-4 rounded-xl border transition-all shadow-sm hover:shadow-md ${task.priority === 'Alta' && task.status !== 'Concluído' ? 'border-l-4 border-l-red-500 border-gray-200' : 'border-gray-200 hover:border-gray-300'}`}>
                      
                      <button onClick={() => toggleStatus(task)} className={`mt-1 transition-colors ${task.status === 'Concluído' ? 'text-green-500' : 'text-gray-300 hover:text-black'}`}>
                          {task.status === 'Concluído' ? <CheckSquare size={24}/> : <Square size={24} strokeWidth={2}/>}
                      </button>

                      <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                              <p className={`font-bold text-sm md:text-base break-words ${task.status === 'Concluído' ? 'text-gray-400 line-through decoration-2 decoration-gray-300' : 'text-gray-800'}`}>
                                  {task.title}
                              </p>
                              {getPriorityBadge(task.priority)}
                          </div>
                          
                          {(task.description || task.category) && (
                              <div className="flex flex-wrap gap-3 text-xs text-gray-400 mt-1">
                                  {task.category && <span className="bg-gray-50 px-1.5 rounded text-gray-500 font-medium border border-gray-100">{task.category}</span>}
                                  {task.description && <span className="truncate max-w-[200px]">{task.description}</span>}
                                  <span className="flex items-center gap-1"><Calendar size={10}/> {new Date(task.createdAt?.seconds * 1000 || Date.now()).toLocaleDateString('pt-BR')}</span>
                              </div>
                          )}
                      </div>

                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => { setEditingTask(task); setIsEditOpen(true); }} className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                              <Edit size={16}/>
                          </button>
                          <button onClick={() => handleDelete(task.id)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                              <Trash2 size={16}/>
                          </button>
                      </div>
                  </div>
              ))
           )}
      </div>

      {/* MODAL DE EDIÇÃO */}
      {isEditOpen && editingTask && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 animate-in zoom-in-95">
                  <div className="flex justify-between items-center mb-4">
                      <h2 className="text-xl font-black text-gray-900 flex items-center gap-2"><Edit size={20}/> Editar Tarefa</h2>
                      <button onClick={() => setIsEditOpen(false)}><X size={20} className="text-gray-400 hover:text-black"/></button>
                  </div>
                  
                  <form onSubmit={handleUpdateTask} className="space-y-4">
                      <div>
                          <label className="text-xs font-bold text-gray-500 uppercase">Título</label>
                          <input 
                              required 
                              value={editingTask.title} 
                              onChange={e => setEditingTask({...editingTask, title: e.target.value})} 
                              className="w-full p-3 border rounded-xl font-bold outline-none focus:border-black mt-1" 
                          />
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                          <div>
                              <label className="text-xs font-bold text-gray-500 uppercase">Categoria</label>
                              <select 
                                  value={editingTask.category} 
                                  onChange={e => setEditingTask({...editingTask, category: e.target.value})} 
                                  className="w-full p-3 border rounded-xl bg-white outline-none mt-1 text-sm"
                              >
                                  <option>Geral</option>
                                  <option>Suporte</option>
                                  <option>Infra</option>
                                  <option>Compras</option>
                              </select>
                          </div>
                          <div>
                              <label className="text-xs font-bold text-gray-500 uppercase">Prioridade</label>
                              <select 
                                  value={editingTask.priority} 
                                  onChange={e => setEditingTask({...editingTask, priority: e.target.value})} 
                                  className="w-full p-3 border rounded-xl bg-white outline-none mt-1 text-sm"
                              >
                                  <option>Baixa</option>
                                  <option>Média</option>
                                  <option>Alta</option>
                              </select>
                          </div>
                      </div>

                      <div>
                          <label className="text-xs font-bold text-gray-500 uppercase">Descrição (Opcional)</label>
                          <textarea 
                              value={editingTask.description} 
                              onChange={e => setEditingTask({...editingTask, description: e.target.value})} 
                              className="w-full p-3 border rounded-xl outline-none focus:border-black mt-1 text-sm"
                              rows="3"
                          />
                      </div>

                      <button type="submit" className="w-full bg-black text-white py-3 rounded-xl font-bold hover:bg-gray-800 flex items-center justify-center gap-2 shadow-lg mt-2">
                          <Save size={18}/> Salvar Alterações
                      </button>
                  </form>
              </div>
          </div>
      )}

    </div>
  );
};

export default TaskManager;