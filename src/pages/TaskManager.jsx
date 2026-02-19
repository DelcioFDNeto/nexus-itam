// src/pages/TaskManager.jsx
import React, { useState, useEffect } from 'react';
import { getTasks, addTask, updateTask, deleteTask } from '../services/taskService';
import { 
  CheckSquare, Plus, Trash2, Calendar, Square, Edit, 
  LayoutGrid, X, AlertCircle, Save, Kanban, List 
} from 'lucide-react';

const TaskManager = () => {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('kanban'); // 'list' | 'kanban'
  const [newTaskTitle, setNewTaskTitle] = useState('');
  
  // Estados de Edição (Modal)
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingTask, setEditingTask] = useState(null);

  useEffect(() => { loadTasks(); }, []);

  const loadTasks = async () => {
    const data = await getTasks();
    const sorted = data.sort((a, b) => b.createdAt?.seconds - a.createdAt?.seconds);
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
      // Local update for instant feedback
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: newStatus } : t));
      await updateTask(task.id, { status: newStatus });
  };

  const moveTask = async (task, newStatus) => {
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: newStatus } : t));
      await updateTask(task.id, { status: newStatus });
  };

  const handleDelete = async (id) => {
      if(confirm("Excluir tarefa permanentemente?")) {
          await deleteTask(id);
          setTasks(prev => prev.filter(t => t.id !== id));
      }
  };

  // --- KANBAN CONFIG ---
  const KANBAN_COLS = [
      { id: 'A Fazer', label: 'A Fazer', color: 'bg-gray-100 border-gray-200' },
      { id: 'Em Andamento', label: 'Fazendo', color: 'bg-blue-50 border-blue-100' },
      { id: 'Revisão', label: 'Revisão', color: 'bg-purple-50 border-purple-100' },
      { id: 'Concluído', label: 'Feito', color: 'bg-green-50 border-green-100' }
  ];

  const getTasksByStatus = (status) => {
      return tasks.filter(t => {
          if (status === 'A Fazer') return t.status === 'A Fazer' || t.status === 'Planejamento';
          if (status === 'Concluído') return t.status === 'Concluído';
          return t.status === status;
      });
  };

  const TaskCard = ({ task }) => (
      <div className={`bg-white p-4 rounded-xl border shadow-sm group hover:shadow-md transition-all ${task.priority === 'Alta' && task.status !== 'Concluído' ? 'border-l-4 border-l-red-500 border-gray-200' : 'border-gray-200'}`}>
          <div className="flex justify-between items-start mb-2">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${task.priority === 'Alta' ? 'bg-red-100 text-red-700 border-red-200' : 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                  {task.priority || 'Média'}
              </span>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => { setEditingTask(task); setIsEditOpen(true); }} className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-blue-600"><Edit size={14}/></button>
                  <button onClick={() => handleDelete(task.id)} className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-red-600"><Trash2 size={14}/></button>
              </div>
          </div>
          
          <p className={`font-bold text-sm mb-3 ${task.status === 'Concluído' ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{task.title}</p>
          
          <div className="flex items-center justify-between mt-auto pt-3 border-t border-gray-50">
             <span className="text-[10px] text-gray-400 flex items-center gap-1">
                 <Calendar size={10}/> {new Date(task.createdAt?.seconds * 1000 || Date.now()).toLocaleDateString()}
             </span>
             
             {/* Quick Actions (Arrows) */}
             <div className="flex gap-1">
                 {task.status !== 'A Fazer' && (
                     <button onClick={() => moveTask(task, 'A Fazer')} className="w-6 h-6 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-[10px] text-gray-500" title="Mover para A Fazer">←</button>
                 )}
                 {task.status !== 'Concluído' && (
                     <button onClick={() => moveTask(task, 'Concluído')} className="w-6 h-6 rounded-full bg-green-100 hover:bg-green-200 flex items-center justify-center text-[10px] text-green-700 font-bold" title="Concluir">✓</button>
                 )}
             </div>
          </div>
      </div>
  );

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto pb-24 min-h-screen">
      
      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-end mb-8 gap-4">
          <div>
              <h1 className="text-2xl font-black text-gray-900 flex items-center gap-2">
                  <CheckSquare className="text-brand"/> Gestão de Tarefas
              </h1>
              <p className="text-gray-500 text-sm">Organize o fluxo de trabalho diário.</p>
          </div>
          
          <div className="flex items-center gap-2 bg-white p-1 rounded-xl border border-gray-200 shadow-sm">
             <button onClick={() => setViewMode('list')} className={`p-2 rounded-lg transition-all ${viewMode === 'list' ? 'bg-black text-white shadow' : 'text-gray-400 hover:text-black'}`}><List size={20}/></button>
             <button onClick={() => setViewMode('kanban')} className={`p-2 rounded-lg transition-all ${viewMode === 'kanban' ? 'bg-black text-white shadow' : 'text-gray-400 hover:text-black'}`}><Kanban size={20}/></button>
          </div>
      </div>

      {/* INPUT RÁPIDO */}
      <form onSubmit={handleQuickAdd} className="mb-8 relative group max-w-2xl mx-auto">
          <input 
            value={newTaskTitle}
            onChange={e => setNewTaskTitle(e.target.value)}
            placeholder="Nova tarefa rápida..." 
            className="w-full p-4 pl-12 bg-white border-2 border-gray-200 rounded-2xl outline-none focus:border-black font-medium shadow-sm transition-all group-hover:border-gray-300"
          />
          <Plus className="absolute left-4 top-4.5 text-gray-400 group-hover:text-black transition-colors" size={24}/>
          <button type="submit" className="absolute right-3 top-3 bg-black text-white px-4 py-1.5 rounded-lg font-bold text-xs hover:bg-gray-800 uppercase tracking-wide">
              Adicionar
          </button>
      </form>

      {/* VIEW CONTENT */}
      {loading ? <p className="text-center text-gray-400 py-10">Carregando...</p> : (
          viewMode === 'kanban' ? (
              // KANBAN VIEW
              <div className="flex gap-4 overflow-x-auto pb-4 items-start h-full min-h-[500px]">
                  {KANBAN_COLS.map(col => (
                      <div key={col.id} className="min-w-[280px] w-full flex-1 flex flex-col bg-gray-50/80 rounded-2xl border border-gray-200">
                          <div className={`p-3 border-b ${col.color.split(' ')[1]} rounded-t-2xl flex justify-between items-center bg-white/50 backdrop-blur-sm`}>
                              <h3 className="font-bold text-gray-700 text-sm uppercase tracking-wide">{col.label}</h3>
                              <span className="bg-white px-2 py-0.5 rounded text-xs font-bold border border-gray-200 text-gray-500">{getTasksByStatus(col.id).length}</span>
                          </div>
                          <div className="p-2 space-y-2 overflow-y-auto max-h-[60vh] custom-scrollbar">
                              {getTasksByStatus(col.id).map(task => <TaskCard key={task.id} task={task} />)}
                              {getTasksByStatus(col.id).length === 0 && (
                                  <div className="h-24 flex items-center justify-center border-2 border-dashed border-gray-200 rounded-xl m-2 opactiy-50">
                                      <span className="text-xs text-gray-400 font-bold uppercase">Vazio</span>
                                  </div>
                              )}
                          </div>
                      </div>
                  ))}
              </div>
          ) : (
              // LIST VIEW (LEGACY STYLE UPDATED)
              <div className="space-y-3 max-w-4xl mx-auto">
                  {tasks.length === 0 ? (
                      <div className="text-center py-16 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                          <p className="text-gray-400 text-sm font-medium">Nenhuma tarefa encontrada.</p>
                      </div>
                   ) : (
                      tasks.map(task => (
                          <div key={task.id} className={`group flex items-center gap-4 bg-white p-4 rounded-xl border transition-all hover:shadow-md ${task.status === 'Concluído' ? 'opacity-60' : ''}`}>
                              <button onClick={() => toggleStatus(task)} className={`transition-colors ${task.status === 'Concluído' ? 'text-green-500' : 'text-gray-300 hover:text-black'}`}>
                                  {task.status === 'Concluído' ? <CheckSquare size={24}/> : <Square size={24}/>}
                              </button>
                              <div className="flex-1">
                                  <p className={`font-bold text-sm ${task.status === 'Concluído' ? 'line-through text-gray-400' : 'text-gray-800'}`}>{task.title}</p>
                                  <div className="flex gap-2 mt-1">
                                      <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 rounded">{task.priority}</span>
                                      <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 rounded">{task.category || 'Geral'}</span>
                                  </div>
                              </div>
                              <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button onClick={() => { setEditingTask(task); setIsEditOpen(true); }} className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"><Edit size={16}/></button>
                                  <button onClick={() => handleDelete(task.id)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={16}/></button>
                              </div>
                          </div>
                      ))
                   )}
              </div>
          )
      )}

      {/* MODAL EDITAR */}
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
                          <input required value={editingTask.title} onChange={e => setEditingTask({...editingTask, title: e.target.value})} className="w-full p-3 border rounded-xl font-bold outline-none focus:border-black mt-1" />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                          <div>
                              <label className="text-xs font-bold text-gray-500 uppercase">Status</label>
                              <select value={editingTask.status} onChange={e => setEditingTask({...editingTask, status: e.target.value})} className="w-full p-3 border rounded-xl bg-white outline-none mt-1 text-sm">
                                  <option>A Fazer</option>
                                  <option>Em Andamento</option>
                                  <option>Revisão</option>
                                  <option>Concluído</option>
                              </select>
                          </div>
                          <div>
                              <label className="text-xs font-bold text-gray-500 uppercase">Prioridade</label>
                              <select value={editingTask.priority} onChange={e => setEditingTask({...editingTask, priority: e.target.value})} className="w-full p-3 border rounded-xl bg-white outline-none mt-1 text-sm">
                                  <option>Baixa</option>
                                  <option>Média</option>
                                  <option>Alta</option>
                              </select>
                          </div>
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