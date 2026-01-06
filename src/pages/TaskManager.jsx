// src/pages/TaskManager.jsx
import React, { useState, useEffect } from 'react';
import { getTasks, addTask, updateTask, deleteTask } from '../services/taskService';
import { 
  CheckSquare, Plus, Trash2, Calendar, MoreHorizontal, Square
} from 'lucide-react';

const TaskManager = () => {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newTaskTitle, setNewTaskTitle] = useState(''); // Input rápido

  useEffect(() => {
    const load = async () => {
      const data = await getTasks();
      setTasks(data);
      setLoading(false);
    };
    load();
  }, []);

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
    const data = await getTasks();
    setTasks(data);
  };

  const toggleStatus = async (task) => {
      const newStatus = task.status === 'Concluído' ? 'A Fazer' : 'Concluído';
      // Atualiza visualmente instantâneo (Optimistic UI)
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: newStatus } : t));
      await updateTask(task.id, { status: newStatus });
  };

  const handleDelete = async (id) => {
      if(confirm("Excluir tarefa?")) {
          await deleteTask(id);
          setTasks(prev => prev.filter(t => t.id !== id));
      }
  };

  // Agrupar tarefas
  const pendingTasks = tasks.filter(t => t.status !== 'Concluído');
  const completedTasks = tasks.filter(t => t.status === 'Concluído');

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto pb-24">
      
      <div className="mb-8">
          <h1 className="text-2xl font-black text-gray-900 flex items-center gap-2">
              <CheckSquare className="text-shineray"/> Tarefas do Expediente
          </h1>
          <p className="text-gray-500 text-sm">Lista operacional diária e demandas rápidas.</p>
      </div>

      {/* INPUT RÁPIDO (Estilo Todoist) */}
      <form onSubmit={handleQuickAdd} className="mb-8 relative">
          <input 
            value={newTaskTitle}
            onChange={e => setNewTaskTitle(e.target.value)}
            placeholder="Adicionar nova tarefa..." 
            className="w-full p-4 pl-12 bg-white border-2 border-gray-200 rounded-2xl outline-none focus:border-black font-medium shadow-sm transition-all"
          />
          <Plus className="absolute left-4 top-4.5 text-gray-400" size={24}/>
          <button type="submit" className="absolute right-3 top-3 bg-black text-white px-4 py-1.5 rounded-lg font-bold text-sm hover:bg-gray-800">
              Adicionar
          </button>
      </form>

      {/* LISTA PENDENTES */}
      <div className="space-y-3">
          {loading ? <p className="text-center text-gray-400">Carregando...</p> : 
           pendingTasks.map(task => (
              <div key={task.id} className="group flex items-center gap-3 bg-white p-4 rounded-xl border border-gray-200 hover:border-blue-400 transition-all shadow-sm">
                  <button onClick={() => toggleStatus(task)} className="text-gray-300 hover:text-blue-500 transition-colors">
                      <Square size={24} strokeWidth={2.5}/>
                  </button>
                  <div className="flex-1">
                      <p className="font-bold text-gray-800 text-sm md:text-base">{task.title}</p>
                      <div className="flex gap-2 text-xs text-gray-400 mt-0.5">
                          <span>{task.category || 'Geral'}</span>
                          <span>•</span>
                          <span>{new Date(task.createdAt?.seconds * 1000 || Date.now()).toLocaleDateString('pt-BR')}</span>
                      </div>
                  </div>
                  <button onClick={() => handleDelete(task.id)} className="opacity-0 group-hover:opacity-100 p-2 text-gray-300 hover:text-red-500 transition-all">
                      <Trash2 size={18}/>
                  </button>
              </div>
          ))}
          {pendingTasks.length === 0 && !loading && (
              <div className="text-center py-10 text-gray-400">
                  <p>Tudo limpo por aqui! 🎉</p>
              </div>
          )}
      </div>

      {/* LISTA CONCLUÍDAS (Accordion simples) */}
      {completedTasks.length > 0 && (
          <div className="mt-8">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Concluídas ({completedTasks.length})</h3>
              <div className="space-y-2 opacity-60">
                  {completedTasks.map(task => (
                      <div key={task.id} className="flex items-center gap-3 p-3 rounded-lg border border-transparent hover:bg-gray-50">
                          <button onClick={() => toggleStatus(task)} className="text-green-500">
                              <CheckSquare size={20}/>
                          </button>
                          <span className="text-sm line-through text-gray-500 flex-1">{task.title}</span>
                          <button onClick={() => handleDelete(task.id)} className="text-gray-300 hover:text-red-500"><Trash2 size={14}/></button>
                      </div>
                  ))}
              </div>
          </div>
      )}

    </div>
  );
};

export default TaskManager;