import React, { useState, useEffect } from 'react';
import { db } from '../services/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { 
  Layers, Settings, Shield, Zap, Edit3, Save, X, RefreshCcw, 
  CheckCircle, XCircle, Users, Server
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

const defaultPlans = {
  starter: {
    id: 'starter',
    name: 'Starter Plan',
    maxAssets: 100,
    maxUsers: 10,
    whitelabel: false,
    agentIntegration: false,
    monthlyPrice: 199.00
  },
  pro: {
    id: 'pro',
    name: 'Pro Plan',
    maxAssets: 1000,
    maxUsers: 50,
    whitelabel: false,
    agentIntegration: true,
    monthlyPrice: 499.00
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise Plan',
    maxAssets: 999999,
    maxUsers: 999999,
    whitelabel: true,
    agentIntegration: true,
    monthlyPrice: 1299.00
  }
};

const NexusPlansManager = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  
  const [plans, setPlans] = useState({});
  const [loading, setLoading] = useState(true);
  
  // Modal Editar
  const [editingPlan, setEditingPlan] = useState(null);
  const [editForm, setEditForm] = useState({
    name: '',
    maxAssets: 100,
    maxUsers: 10,
    whitelabel: false,
    agentIntegration: false,
    monthlyPrice: 0
  });

  useEffect(() => {
    if (currentUser?.role !== 'superadmin') {
      toast.error('Acesso negado. Área restrita à Administração Global.');
      navigate('/dashboard');
      return;
    }
    loadPlans();
  }, [currentUser, navigate]);

  const loadPlans = async () => {
    setLoading(true);
    try {
      const loadedPlans = {};
      
      // Carrega os limites de cada plano do Firestore ou inicializa com os defaults
      for (const key of Object.keys(defaultPlans)) {
        const docRef = doc(db, 'plans', key);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          loadedPlans[key] = { ...defaultPlans[key], ...docSnap.data() };
        } else {
          // Inicializa coleções caso não existam
          await setDoc(docRef, defaultPlans[key]);
          loadedPlans[key] = defaultPlans[key];
        }
      }
      
      setPlans(loadedPlans);
    } catch (error) {
      console.error("Erro ao carregar planos:", error);
      toast.error("Falha ao sincronizar limites de planos.");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenEdit = (plan) => {
    setEditingPlan(plan);
    setEditForm({
      name: plan.name,
      maxAssets: plan.maxAssets,
      maxUsers: plan.maxUsers,
      whitelabel: plan.whitelabel,
      agentIntegration: plan.agentIntegration,
      monthlyPrice: plan.monthlyPrice || 0
    });
  };

  const handleSavePlan = async (e) => {
    e.preventDefault();
    try {
      const docRef = doc(db, 'plans', editingPlan.id);
      const updateData = {
        name: editForm.name,
        maxAssets: parseInt(editForm.maxAssets),
        maxUsers: parseInt(editForm.maxUsers),
        whitelabel: editForm.whitelabel,
        agentIntegration: editForm.agentIntegration,
        monthlyPrice: parseFloat(editForm.monthlyPrice)
      };

      await setDoc(docRef, updateData, { merge: true });
      toast.success(`Plano "${editForm.name}" atualizado com sucesso.`);
      setEditingPlan(null);
      loadPlans();
    } catch (error) {
      console.error(error);
      toast.error("Erro ao salvar limites do plano.");
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh]">
        <div className="w-12 h-12 border-4 border-indigo-100 border-t-indigo-500 rounded-full animate-spin"></div>
        <p className="mt-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest animate-pulse">Sincronizando Níveis Comerciais...</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto pb-24 space-y-8">
      
      {/* 1. HEADER */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900 rounded-3xl p-6 md:p-8 shadow-xl relative overflow-hidden border border-white/5">
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/15 rounded-full blur-3xl pointer-events-none"></div>
        <div className="relative z-10 flex items-center gap-4">
          <div className="p-4 bg-white/5 backdrop-blur text-indigo-400 rounded-2xl border border-white/10">
            <Layers size={32} />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-black text-white uppercase tracking-tight">Planos & Níveis</h1>
            <p className="text-slate-400 font-medium text-sm mt-1">Configure planos de licenciamento, defina limites de ativos/usuários e libere recursos.</p>
          </div>
        </div>

        <div className="relative z-10">
          <button onClick={loadPlans} className="flex items-center justify-center w-12 h-12 bg-white/5 hover:bg-white/10 text-white rounded-xl transition-all border border-white/10" title="Recarregar">
             <RefreshCcw size={16} />
          </button>
        </div>
      </div>

      {/* 2. PLANS CARDS GRID */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {Object.values(plans).map(plan => {
          const isEnterprise = plan.id === 'enterprise';
          const isPro = plan.id === 'pro';

          return (
            <div 
              key={plan.id}
              className={`bg-white dark:bg-slate-800 rounded-3xl border ${
                isEnterprise 
                  ? 'border-amber-500/30 shadow-amber-900/5 shadow-2xl relative overflow-hidden' 
                  : 'border-gray-150 dark:border-slate-750 shadow-sm'
              } p-6 flex flex-col justify-between h-[420px] group transition-all hover:scale-[1.01]`}
            >
              {isEnterprise && (
                <div className="absolute -right-12 -top-12 bg-amber-500/10 w-24 h-24 rounded-full blur-2xl"></div>
              )}

              <div>
                {/* Header Card */}
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <span className={`px-2.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider ${
                      isEnterprise ? 'bg-amber-500/10 text-amber-500' :
                      isPro ? 'bg-purple-500/10 text-purple-500' : 'bg-slate-500/10 text-slate-400'
                    }`}>
                      {plan.name}
                    </span>
                    <div className="flex items-baseline gap-1 mt-3">
                      <span className="text-xs font-bold text-gray-400">R$</span>
                      <span className="text-3xl font-black text-gray-900 dark:text-white tracking-tight">
                        {plan.monthlyPrice.toFixed(0)}
                      </span>
                      <span className="text-xs text-gray-400 font-semibold">/ mês</span>
                    </div>
                  </div>
                  <div className="p-3 bg-gray-50 dark:bg-slate-900 rounded-2xl">
                    {isEnterprise ? <Zap className="text-amber-500 w-5 h-5" /> : 
                     isPro ? <Settings className="text-purple-500 w-5 h-5" /> : <Shield className="text-slate-400 w-5 h-5" />}
                  </div>
                </div>

                <hr className="border-gray-100 dark:border-slate-700 my-4" />

                {/* Features List */}
                <div className="space-y-3.5 mt-5">
                  <div className="flex items-center gap-3 text-xs font-semibold text-gray-700 dark:text-slate-200">
                    <Server size={16} className="text-gray-400 shrink-0"/>
                    <span>Limite de Ativos: <strong className="text-gray-900 dark:text-white">{plan.maxAssets >= 99999 ? 'Ilimitado' : plan.maxAssets}</strong></span>
                  </div>

                  <div className="flex items-center gap-3 text-xs font-semibold text-gray-700 dark:text-slate-200">
                    <Users size={16} className="text-gray-400 shrink-0"/>
                    <span>Limite de Usuários: <strong className="text-gray-900 dark:text-white">{plan.maxUsers >= 99999 ? 'Ilimitado' : plan.maxUsers}</strong></span>
                  </div>

                  <div className="flex items-center gap-3 text-xs font-semibold text-gray-700 dark:text-slate-200">
                    {plan.agentIntegration ? <CheckCircle size={16} className="text-green-500 shrink-0"/> : <XCircle size={16} className="text-gray-300 shrink-0"/>}
                    <span className={plan.agentIntegration ? 'text-gray-800 dark:text-slate-200' : 'text-gray-400 font-medium'}>
                      Monitoramento com Agente Nexus
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-xs font-semibold text-gray-700 dark:text-slate-200">
                    {plan.whitelabel ? <CheckCircle size={16} className="text-green-500 shrink-0"/> : <XCircle size={16} className="text-gray-300 shrink-0"/>}
                    <span className={plan.whitelabel ? 'text-gray-800 dark:text-slate-200' : 'text-gray-400 font-medium'}>
                      Customização Visual (Whitelabel)
                    </span>
                  </div>
                </div>
              </div>

              <button 
                onClick={() => handleOpenEdit(plan)}
                className={`w-full py-3.5 flex items-center justify-center gap-2 rounded-2xl font-black text-xs uppercase tracking-wider transition-all active:scale-97 border ${
                  isEnterprise 
                    ? 'bg-amber-600 border-amber-600 text-white hover:bg-amber-700' 
                    : 'bg-white dark:bg-slate-900 text-gray-800 dark:text-slate-250 border-gray-200 dark:border-slate-700 hover:bg-gray-50'
                }`}
              >
                <Edit3 size={14} /> Personalizar Nível
              </button>
            </div>
          );
        })}
      </div>

      {/* ════════════════ EDIT PLAN MODAL ════════════════ */}
      {editingPlan && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-[#121214] border border-white/10 rounded-3xl p-6 w-full max-w-sm shadow-2xl relative animate-[scaleUp_0.3s_ease-out]">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-indigo-500 to-transparent opacity-60"></div>
            
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-black text-white uppercase tracking-tight">Editar Limites</h2>
              <button onClick={() => setEditingPlan(null)} className="p-1 hover:bg-white/5 rounded-full text-gray-400 hover:text-white transition-colors"><X size={18} /></button>
            </div>

            <form onSubmit={handleSavePlan} className="space-y-4 text-left">
              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5 ml-1">Nome Comercial do Plano</label>
                <input 
                  type="text" 
                  value={editForm.name} 
                  onChange={e => setEditForm({ ...editForm, name: e.target.value })} 
                  required
                  className="w-full px-3 py-2.5 bg-black/50 border border-white/10 rounded-xl focus:outline-none focus:border-indigo-500 text-sm font-semibold text-white shadow-inner"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5 ml-1">Max. Ativos</label>
                  <input 
                    type="number" 
                    value={editForm.maxAssets} 
                    onChange={e => setEditForm({ ...editForm, maxAssets: e.target.value })} 
                    required
                    className="w-full px-3 py-2.5 bg-black/50 border border-white/10 rounded-xl focus:outline-none focus:border-indigo-500 text-sm font-semibold text-white shadow-inner"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5 ml-1">Max. Usuários</label>
                  <input 
                    type="number" 
                    value={editForm.maxUsers} 
                    onChange={e => setEditForm({ ...editForm, maxUsers: e.target.value })} 
                    required
                    className="w-full px-3 py-2.5 bg-black/50 border border-white/10 rounded-xl focus:outline-none focus:border-indigo-500 text-sm font-semibold text-white shadow-inner"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5 ml-1">Mensalidade (R$)</label>
                <div className="relative group">
                  <div className="absolute left-4 top-3.5 text-xs text-gray-500 font-bold">R$</div>
                  <input 
                    type="number" 
                    step="0.01"
                    value={editForm.monthlyPrice} 
                    onChange={e => setEditForm({ ...editForm, monthlyPrice: e.target.value })} 
                    required
                    className="w-full pl-10 pr-4 py-2.5 bg-black/50 border border-white/10 rounded-xl focus:outline-none focus:border-indigo-500 text-sm font-semibold text-white shadow-inner"
                  />
                </div>
              </div>

              <div className="space-y-2.5 bg-white/5 rounded-2xl p-4 border border-white/5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-300">⚙️ Integração com Agente Nexus</span>
                  <input 
                    type="checkbox"
                    checked={editForm.agentIntegration}
                    onChange={e => setEditForm({ ...editForm, agentIntegration: e.target.checked })}
                    className="rounded border-white/15 text-indigo-600 h-4 w-4 cursor-pointer focus:ring-0 bg-transparent"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-300">⚙️ Acesso Whitelabel</span>
                  <input 
                    type="checkbox"
                    checked={editForm.whitelabel}
                    onChange={e => setEditForm({ ...editForm, whitelabel: e.target.checked })}
                    className="rounded border-white/15 text-indigo-600 h-4 w-4 cursor-pointer focus:ring-0 bg-transparent"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setEditingPlan(null)} className="flex-1 px-4 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-gray-300 font-bold text-xs uppercase tracking-wider transition-colors">Cancelar</button>
                <button type="submit" className="flex-1 px-4 py-3 bg-indigo-600 text-white rounded-xl font-bold text-xs uppercase tracking-wider shadow-lg flex items-center justify-center gap-2 hover:bg-indigo-700 transition-colors">
                  <Save size={14}/> Salvar Limites
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};

export default NexusPlansManager;
