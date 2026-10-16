// src/pages/TaskManager.jsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { getTasks, addTask, updateTask, deleteTask } from '../services/taskService';
import { useAuth } from '../contexts/AuthContext';
import { 
  CheckSquare, Plus, Trash2, Calendar, Square, Edit, 
  X, Save, Kanban, List, RefreshCcw, ArrowLeft, ArrowRight, Check 
} from 'lucide-react';
import { toast } from 'sonner';
import { can } from '../utils/permissions';
import { useConfirm } from '../components/ConfirmDialog';
import { formatDateBR } from '../utils/dates';

const KANBAN_COLS = [
  { id: 'A Fazer', label: 'A Fazer', color: 'bg-gray-100 dark:bg-slate-800/80 border-gray-200 dark:border-slate-700' },
  { id: 'Em Andamento', label: 'Fazendo', color: 'bg-blue-50 dark:bg-blue-950/20 border-blue-100 dark:border-blue-900/40' },
  { id: 'Revisão', label: 'Revisão', color: 'bg-purple-50 dark:bg-purple-950/20 border-purple-100 dark:border-purple-900/40' },
  { id: 'Concluído', label: 'Feito', color: 'bg-green-50 dark:bg-green-950/20 border-green-100 dark:border-green-900/40' }
];

const TaskManager = () => {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingQuick, setSavingQuick] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const { currentUser } = useAuth();
  const confirm = useConfirm();
  const tenantId = currentUser?.tenantId;
  const canWrite = can(currentUser, 'tasks:write');

  const [viewMode, setViewMode] = useState('kanban');
  const [newTaskTitle, setNewTaskTitle] = useState('');
  
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingTask, setEditingTask] = useState(null);

  const loadTasks = useCallback(async () => {
    if (!tenantId) {
      setTasks([]);
      setLoading(false);
      return;
    }
    try {
      const data = await getTasks(tenantId);
      const sorted = [...data].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setTasks(sorted);
    } catch (err) {
      console.error(err);
      toast.error('Erro ao carregar tarefas.');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (tenantId) {
      loadTasks();
    } else {
      setTasks([]);
      setLoading(false);
    }
  }, [tenantId, loadTasks]);

  const handleQuickAdd = async (e) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;
    if (!tenantId) {
      toast.error('Sem contexto de tenant.');
      return;
    }
    
    setSavingQuick(true);
    try {
      await addTask({
        title: newTaskTitle.trim(),
        status: 'A Fazer',
        priority: 'Média',
        category: 'Geral',
        tenantId
      });
      setNewTaskTitle('');
      toast.success('Tarefa adicionada.');
      await loadTasks();
    } catch (err) {
      console.error(err);
      toast.error('Erro ao adicionar tarefa.');
    } finally {
      setSavingQuick(false);
    }
  };

  const handleUpdateTask = async (e) => {
    e.preventDefault();
    if (!editingTask) return;
    setSavingEdit(true);
    try {
      await updateTask(editingTask.id, {
        title: editingTask.title.trim(),
        status: editingTask.status,
        priority: editingTask.priority
      });
      setIsEditOpen(false);
      toast.success('Tarefa atualizada.');
      await loadTasks();
    } catch (err) {
      console.error(err);
      toast.error('Erro ao atualizar tarefa.');
    } finally {
      setSavingEdit(false);
    }
  };

  const toggleStatus = async (task) => {
    if (!canWrite) return;
    const newStatus = task.status === 'Concluído' ? 'A Fazer' : 'Concluído';
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: newStatus } : t));
    try {
      await updateTask(task.id, { status: newStatus });
    } catch (err) {
      console.error(err);
      toast.error('Erro ao atualizar status da tarefa.');
      await loadTasks();
    }
  };

  const moveTask = async (task, newStatus) => {
    if (!canWrite) return;
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: newStatus } : t));
    try {
      await updateTask(task.id, { status: newStatus });
    } catch (err) {
      console.error(err);
      toast.error('Erro ao mover tarefa.');
      await loadTasks();
    }
  };

  const handleDelete = async (id) => {
    const confirmed = await confirm({
      title: 'Excluir Tarefa',
      message: 'Tem certeza que deseja remover esta tarefa permanentemente?',
      danger: true,
      confirmLabel: 'Excluir Tarefa'
    });
    if (!confirmed) return;

    try {
      await deleteTask(id);
      setTasks(prev => prev.filter(t => t.id !== id));
      toast.success('Tarefa excluída.');
    } catch (err) {
      console.error(err);
      toast.error('Erro ao excluir tarefa.');
    }
  };

  const colIds = useMemo(() => KANBAN_COLS.map(c => c.id), []);

  const getTasksByStatus = (status) => {
    return tasks.filter(t => {
      if (status === 'A Fazer') return t.status === 'A Fazer' || t.status === 'Planejamento';
      if (status === 'Concluído') return t.status === 'Concluído';
      return t.status === status;
    });
  };

  const TaskCard = ({ task }) => {
    const currentColIndex = colIds.indexOf(task.status === 'Planejamento' ? 'A Fazer' : task.status);
    const prevCol = currentColIndex > 0 ? colIds[currentColIndex - 1] : null;
    const nextCol = currentColIndex >= 0 && currentColIndex < colIds.length - 1 ? colIds[currentColIndex + 1] : null;

    const taskDate = task.createdAt?.toDate 
      ? task.createdAt.toDate() 
      : (task.createdAt?.seconds ? new Date(task.createdAt.seconds * 1000) : null);

    return (
      <div className={`bg-white dark:bg-slate-800 p-4 rounded-xl border shadow-sm group hover:shadow-md transition-all ${task.priority === 'Alta' && task.status !== 'Concluído' ? 'border-l-4 border-l-red-500 border-gray-200 dark:border-slate-700' : 'border-gray-200 dark:border-slate-700'}`}>
        <div className="flex justify-between items-start mb-2">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${task.priority === 'Alta' ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300 border-red-200 dark:border-red-900/50' : 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-gray-300 border-gray-200 dark:border-slate-600'}`}>
            {task.priority || 'Média'}
          </span>
          {canWrite && (
            <div className="flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
              <button 
                onClick={() => { setEditingTask(task); setIsEditOpen(true); }} 
                title="Editar tarefa"
                className="p-1 hover:bg-gray-100 dark:hover:bg-slate-700 rounded text-gray-400 hover:text-blue-600 dark:hover:text-blue-400"
              >
                <Edit size={14}/>
              </button>
              <button 
                onClick={() => handleDelete(task.id)} 
                title="Excluir tarefa"
                className="p-1 hover:bg-gray-100 dark:hover:bg-slate-700 rounded text-gray-400 hover:text-red-600 dark:hover:text-red-400"
              >
                <Trash2 size={14}/>
              </button>
            </div>
          )}
        </div>
        
        <p className={`font-bold text-sm mb-3 ${task.status === 'Concluído' ? 'text-gray-400 dark:text-gray-500 line-through' : 'text-gray-800 dark:text-gray-100'}`}>{task.title}</p>
        
        <div className="flex items-center justify-between mt-auto pt-3 border-t border-gray-100 dark:border-slate-700">
          <span className="text-[10px] text-gray-400 dark:text-gray-400 flex items-center gap-1">
            <Calendar size={10}/> {taskDate ? formatDateBR(taskDate) : 'Hoje'}
          </span>
          
          {canWrite && (
            <div className="flex items-center gap-1">
              {prevCol && (
                <button 
                  onClick={() => moveTask(task, prevCol)} 
                  className="w-6 h-6 rounded-full bg-gray-100 hover:bg-gray-200 dark:bg-slate-700 dark:hover:bg-slate-600 flex items-center justify-center text-[10px] text-gray-600 dark:text-gray-300 transition-colors" 
                  title={`Mover para ${prevCol}`}
                >
                  <ArrowLeft size={11} />
                </button>
              )}
              {nextCol && (
                <button 
                  onClick={() => moveTask(task, nextCol)} 
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] transition-colors ${nextCol === 'Concluído' ? 'bg-green-100 hover:bg-green-200 dark:bg-green-900/30 dark:hover:bg-green-900/50 text-green-700 dark:text-green-300' : 'bg-gray-100 hover:bg-gray-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-gray-600 dark:text-gray-300'}`} 
                  title={`Mover para ${nextCol}`}
                >
                  {nextCol === 'Concluído' ? <Check size={11} /> : <ArrowRight size={11} />}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto pb-24 min-h-screen animate-fade-in">
      
      {/* Faixa superior com o titulo principal e as alavancas de visualizacao */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900 dark:text-white flex items-center gap-2">
            <CheckSquare className="text-brand"/> Gestão de Tarefas
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Organize o fluxo de trabalho diário.</p>
        </div>
        
        <div className="flex items-center gap-2 bg-white dark:bg-slate-800 p-1 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm">
          <button 
            onClick={() => setViewMode('list')} 
            title="Visualização em Lista"
            className={`p-2 rounded-lg transition-all ${viewMode === 'list' ? 'bg-black text-white dark:bg-brand shadow' : 'text-gray-400 hover:text-black dark:hover:text-white'}`}
          >
            <List size={20}/>
          </button>
          <button 
            onClick={() => setViewMode('kanban')} 
            title="Visualização em Quadro Kanban"
            className={`p-2 rounded-lg transition-all ${viewMode === 'kanban' ? 'bg-black text-white dark:bg-brand shadow' : 'text-gray-400 hover:text-black dark:hover:text-white'}`}
          >
            <Kanban size={20}/>
          </button>
        </div>
      </div>

      {/* Campo rapido para adicionar tarefas */}
      {canWrite && (
        <form onSubmit={handleQuickAdd} className="mb-8 relative group max-w-2xl mx-auto">
          <input 
            value={newTaskTitle}
            onChange={e => setNewTaskTitle(e.target.value)}
            disabled={savingQuick}
            placeholder="Nova tarefa rápida..." 
            className="w-full p-4 pl-12 pr-32 bg-white dark:bg-slate-800 border-2 border-gray-200 dark:border-slate-700 text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 rounded-2xl outline-none focus:border-black dark:focus:border-brand font-medium shadow-sm transition-all group-hover:border-gray-300 dark:group-hover:border-slate-600 disabled:opacity-50"
          />
          <Plus className="absolute left-4 top-4.5 text-gray-400 group-hover:text-black dark:group-hover:text-white transition-colors" size={24}/>
          <button 
            type="submit" 
            disabled={savingQuick || !newTaskTitle.trim()}
            className="absolute right-3 top-3 bg-black text-white dark:bg-brand dark:hover:opacity-90 px-4 py-2 rounded-xl font-bold text-xs hover:bg-gray-800 uppercase tracking-wide transition-all disabled:opacity-50 flex items-center gap-1.5"
          >
            {savingQuick ? <RefreshCcw size={14} className="animate-spin" /> : null}
            {savingQuick ? 'Salvando…' : 'Adicionar'}
          </button>
        </form>
      )}

      {/* Conteudo principal */}
      {loading ? (
        <div className="flex justify-center items-center py-20 text-gray-400">
          <RefreshCcw size={24} className="animate-spin mr-2" /> Carregando tarefas...
        </div>
      ) : (
        viewMode === 'kanban' ? (
          <div className="flex gap-4 overflow-x-auto pb-4 items-start h-full min-h-[500px]">
            {KANBAN_COLS.map(col => (
              <div key={col.id} className="min-w-[280px] w-full flex-1 flex flex-col bg-gray-50/80 dark:bg-slate-900/60 rounded-2xl border border-gray-200 dark:border-slate-700">
                <div className={`p-3 border-b ${col.color.split(' ')[1]} rounded-t-2xl flex justify-between items-center bg-white/50 dark:bg-slate-800/60 backdrop-blur-sm`}>
                  <h3 className="font-bold text-gray-700 dark:text-gray-200 text-sm uppercase tracking-wide">{col.label}</h3>
                  <span className="bg-white dark:bg-slate-800 px-2 py-0.5 rounded text-xs font-bold border border-gray-200 dark:border-slate-600 text-gray-500 dark:text-gray-400">
                    {getTasksByStatus(col.id).length}
                  </span>
                </div>
                <div className="p-2 space-y-2 overflow-y-auto max-h-[60vh] custom-scrollbar">
                  {getTasksByStatus(col.id).map(task => <TaskCard key={task.id} task={task} />)}
                  {getTasksByStatus(col.id).length === 0 && (
                    <div className="h-24 flex items-center justify-center border-2 border-dashed border-gray-200 dark:border-slate-700 rounded-xl m-2 opacity-50">
                      <span className="text-xs text-gray-400 font-bold uppercase">Vazio</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3 max-w-4xl mx-auto">
            {tasks.length === 0 ? (
              <div className="text-center py-16 bg-gray-50 dark:bg-slate-900 rounded-2xl border border-dashed border-gray-200 dark:border-slate-700">
                <CheckSquare size={40} className="mx-auto mb-2 text-gray-300 dark:text-slate-600" />
                <p className="text-gray-400 text-sm font-medium">Nenhuma tarefa encontrada.</p>
              </div>
            ) : (
              tasks.map(task => {
                const taskDate = task.createdAt?.toDate 
                  ? task.createdAt.toDate() 
                  : (task.createdAt?.seconds ? new Date(task.createdAt.seconds * 1000) : null);

                return (
                  <div key={task.id} className={`group flex items-center gap-4 bg-white dark:bg-slate-800 p-4 rounded-xl border border-gray-200 dark:border-slate-700 transition-all hover:shadow-md ${task.status === 'Concluído' ? 'opacity-60' : ''}`}>
                    <button 
                      onClick={() => toggleStatus(task)} 
                      disabled={!canWrite}
                      className={`transition-colors ${task.status === 'Concluído' ? 'text-green-500 dark:text-green-400' : 'text-gray-300 dark:text-gray-600 hover:text-black dark:hover:text-white'} disabled:cursor-not-allowed`}
                    >
                      {task.status === 'Concluído' ? <CheckSquare size={24}/> : <Square size={24}/>}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className={`font-bold text-sm truncate ${task.status === 'Concluído' ? 'line-through text-gray-400 dark:text-gray-500' : 'text-gray-800 dark:text-gray-100'}`}>{task.title}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-gray-300 px-1.5 py-0.5 rounded font-bold uppercase">{task.priority}</span>
                        <span className="text-[10px] bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-gray-300 px-1.5 py-0.5 rounded">{task.category || 'Geral'}</span>
                        {taskDate && (
                          <span className="text-[10px] text-gray-400 flex items-center gap-1">
                            <Calendar size={10} /> {formatDateBR(taskDate)}
                          </span>
                        )}
                      </div>
                    </div>
                    {canWrite && (
                      <div className="flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => { setEditingTask(task); setIsEditOpen(true); }} 
                          title="Editar tarefa"
                          className="p-2 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-slate-700 rounded-lg transition-colors"
                        >
                          <Edit size={16}/>
                        </button>
                        <button 
                          onClick={() => handleDelete(task.id)} 
                          title="Excluir tarefa"
                          className="p-2 text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-slate-700 rounded-lg transition-colors"
                        >
                          <Trash2 size={16}/>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )
      )}

      {/* Modal de edicao de tarefa */}
      {isEditOpen && editingTask && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md p-6 animate-in zoom-in-95 border border-gray-100 dark:border-slate-700">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-black text-gray-900 dark:text-white flex items-center gap-2">
                <Edit size={20}/> Editar Tarefa
              </h2>
              <button disabled={savingEdit} onClick={() => setIsEditOpen(false)}>
                <X size={20} className="text-gray-400 hover:text-black dark:hover:text-white transition-colors"/>
              </button>
            </div>
            
            <form onSubmit={handleUpdateTask} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">Título</label>
                <input 
                  required 
                  value={editingTask.title} 
                  onChange={e => setEditingTask({...editingTask, title: e.target.value})} 
                  className="w-full p-3 border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-white rounded-xl font-bold outline-none focus:border-black dark:focus:border-brand mt-1 transition-colors" 
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">Status</label>
                  <select 
                    value={editingTask.status} 
                    onChange={e => setEditingTask({...editingTask, status: e.target.value})} 
                    className="w-full p-3 border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-white rounded-xl outline-none mt-1 text-sm focus:border-black dark:focus:border-brand cursor-pointer"
                  >
                    <option>A Fazer</option>
                    <option>Em Andamento</option>
                    <option>Revisão</option>
                    <option>Concluído</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">Prioridade</label>
                  <select 
                    value={editingTask.priority} 
                    onChange={e => setEditingTask({...editingTask, priority: e.target.value})} 
                    className="w-full p-3 border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-white rounded-xl outline-none mt-1 text-sm focus:border-black dark:focus:border-brand cursor-pointer"
                  >
                    <option>Baixa</option>
                    <option>Média</option>
                    <option>Alta</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button 
                  type="button" 
                  disabled={savingEdit} 
                  onClick={() => setIsEditOpen(false)} 
                  className="flex-1 py-3 bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-xl font-bold text-gray-600 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-600 transition-colors disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  disabled={savingEdit} 
                  className="flex-1 bg-black text-white dark:bg-brand dark:hover:opacity-90 py-3 rounded-xl font-bold hover:bg-gray-800 flex items-center justify-center gap-2 shadow-lg transition-colors disabled:opacity-50"
                >
                  {savingEdit ? <RefreshCcw size={18} className="animate-spin" /> : <Save size={18}/>}
                  {savingEdit ? 'Salvando…' : 'Salvar Alterações'}
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