import React, { useEffect, useState } from 'react';
import { 
  Building2, Users, Server, Activity, ShieldAlert,
  ArrowRight, TrendingUp, AlertTriangle, Layers, PlusSquare, 
  BarChart3, PieChart, DollarSign, Calendar
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Bar, Doughnut } from 'react-chartjs-2';
import { db } from '../services/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { getGlobalAssets, getGlobalActivity } from '../services/assetService';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'sonner';

const NexusDashboard = () => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    tenantsCount: 0,
    activeTenants: 0,
    suspendedTenants: 0,
    usersCount: 0,
    assetsCount: 0,
    totalValue: 0
  });
  const [assetsByType, setAssetsByType] = useState({});
  const [tenantsByPlan, setTenantsByPlan] = useState({});
  const [recentLogs, setRecentLogs] = useState([]);
  const [tenantsList, setTenantsList] = useState([]);

  useEffect(() => {
    const fetchNexusData = async () => {
      try {
        setLoading(true);
        // 1. Fetch tenants
        const tenantsSnap = await getDocs(collection(db, 'tenants'));
        const tenants = tenantsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setTenantsList(tenants);

        // 2. Fetch users
        const usersSnap = await getDocs(collection(db, 'users'));
        const users = usersSnap.docs.map(doc => doc.data());

        // 3. Fetch assets globally
        const globalAssets = await getGlobalAssets();
        
        // 4. Fetch global history log
        const globalLogs = await getGlobalActivity(6);
        setRecentLogs(globalLogs);

        // --- Calculate stats ---
        const active = tenants.filter(t => t.status === 'active').length;
        const suspended = tenants.filter(t => t.status === 'suspended').length;
        
        const val = globalAssets.reduce((acc, curr) => {
          if (curr.category === 'Promocional') return acc;
          return acc + (parseFloat(curr.valor) || 0);
        }, 0);

        setStats({
          tenantsCount: tenants.length,
          activeTenants: active,
          suspendedTenants: suspended,
          usersCount: users.length,
          assetsCount: globalAssets.length,
          totalValue: val
        });

        // Group assets by category or type
        const types = globalAssets.reduce((acc, curr) => {
          const t = curr.type || 'Outros';
          acc[t] = (acc[t] || 0) + 1;
          return acc;
        }, {});
        setAssetsByType(types);

        // Group tenants by plan
        const plans = tenants.reduce((acc, curr) => {
          const p = curr.plan ? curr.plan.toUpperCase() : 'STARTER';
          acc[p] = (acc[p] || 0) + 1;
          return acc;
        }, {});
        setTenantsByPlan(plans);

      } catch (error) {
        console.error("Erro ao carregar dados globais:", error);
        toast.error("Falha ao carregar métricas da infraestrutura.");
      } finally {
        setLoading(false);
      }
    };

    fetchNexusData();
  }, []);

  const barData = {
    labels: Object.keys(assetsByType).length ? Object.keys(assetsByType) : ['Notebook', 'Celular', 'Impressora', 'Monitor', 'Outros'],
    datasets: [{
      label: 'Quantidade',
      data: Object.keys(assetsByType).length ? Object.values(assetsByType) : [15, 8, 4, 12, 5],
      backgroundColor: 'rgba(99, 102, 241, 0.8)',
      hoverBackgroundColor: 'rgba(79, 70, 229, 1)',
      borderRadius: 8,
      barThickness: 24,
    }],
  };

  const planCounts = Object.keys(tenantsByPlan).length ? Object.values(tenantsByPlan) : [3, 2, 1];
  const doughnutData = {
    labels: Object.keys(tenantsByPlan).length ? Object.keys(tenantsByPlan) : ['STARTER', 'PRO', 'ENTERPRISE'],
    datasets: [{
      data: planCounts,
      backgroundColor: [
        'rgba(59, 130, 246, 0.8)', // Blue (Starter)
        'rgba(147, 51, 234, 0.8)', // Purple (Pro)
        'rgba(245, 158, 11, 0.8)', // Amber (Enterprise)
        'rgba(16, 185, 129, 0.8)'  // Emerald (Custom)
      ],
      borderWidth: 0,
      hoverOffset: 6,
    }],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { 
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(15, 23, 42, 0.9)',
        padding: 12,
        cornerRadius: 8
      }
    },
    scales: {
      y: { display: false, grid: { display: false } },
      x: { grid: { display: false }, ticks: { font: { family: 'Inter', weight: '600' }, color: '#64748b' } }
    }
  };

  const doughnutOptions = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '75%',
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(15, 23, 42, 0.9)',
        padding: 12,
        cornerRadius: 8
      }
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh]">
        <div className="w-12 h-12 border-4 border-indigo-100 border-t-indigo-500 rounded-full animate-spin"></div>
        <p className="mt-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest animate-pulse">Carregando Plataforma Nexus...</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-fade-in pb-24">
      
      {/* 1. HERO HEADER */}
      <div className="relative overflow-hidden bg-gradient-to-br from-indigo-950 via-slate-900 to-black rounded-3xl p-8 md:p-10 border border-indigo-500/10 shadow-2xl">
        <div className="absolute top-0 right-0 -mr-20 -mt-20 w-96 h-96 bg-indigo-500/10 rounded-full blur-[100px] pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-80 h-80 bg-cyan-500/10 rounded-full blur-[80px] pointer-events-none"></div>

        <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-indigo-400 text-xs font-black uppercase tracking-widest mb-4">
              <ShieldAlert size={14}/> Nexus Master Console
            </div>
            <h1 className="text-3xl md:text-5xl font-black text-white tracking-tight mb-2">
              Gestão Global <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-indigo-400">Nexus ITAM</span>
            </h1>
            <p className="text-slate-400 font-medium text-sm max-w-lg leading-relaxed">
              Painel analítico consolidado para monitoramento de inquilinos, volume de ativos, licenças contratadas e atividades da rede.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button onClick={() => navigate('/admin/tenants')} className="bg-white hover:bg-gray-100 text-black px-5 py-3 rounded-2xl font-black text-xs uppercase tracking-wider flex items-center gap-2 transition-all active:scale-95 shadow-lg">
              <PlusSquare size={16}/> <span>Nova Empresa</span>
            </button>
            <button onClick={() => navigate('/admin/users')} className="bg-slate-800/80 hover:bg-slate-800 border border-white/10 text-white px-5 py-3 rounded-2xl font-black text-xs uppercase tracking-wider flex items-center gap-2 transition-all active:scale-95">
              <Users size={16}/> <span>Acessos Global</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. BENTO GRID METRICS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
        
        {/* Total Tenants */}
        <div className="bg-white dark:bg-slate-800 p-5 rounded-3xl border border-gray-150 dark:border-slate-700 shadow-sm flex flex-col justify-between h-36 relative overflow-hidden group hover:border-indigo-200 transition-all cursor-pointer" onClick={() => navigate('/admin/tenants')}>
          <div className="absolute -right-6 -top-6 bg-indigo-50 w-16 h-16 rounded-full blur-2xl group-hover:bg-indigo-100 transition-colors"></div>
          <div className="flex justify-between items-start relative z-10">
            <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl"><Building2 size={18}/></div>
            <ArrowRight size={16} className="text-gray-300 group-hover:text-indigo-600 transition-transform group-hover:translate-x-1"/>
          </div>
          <div>
            <h2 className="text-3xl font-black text-gray-900 dark:text-white mb-0.5 tracking-tight">{stats.tenantsCount}</h2>
            <p className="text-gray-500 font-bold uppercase tracking-widest text-[10px]">Empresas</p>
          </div>
        </div>

        {/* Active vs Suspended */}
        <div className="bg-white dark:bg-slate-800 p-5 rounded-3xl border border-gray-150 dark:border-slate-700 shadow-sm flex flex-col justify-between h-36 relative overflow-hidden group hover:border-emerald-200 transition-all">
          <div className="flex justify-between items-start">
            <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl"><TrendingUp size={18}/></div>
            <div className="flex gap-1.5">
              <span className="bg-green-100 text-green-700 text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider">{stats.activeTenants} Ativas</span>
              {stats.suspendedTenants > 0 && (
                <span className="bg-red-100 text-red-700 text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider">{stats.suspendedTenants} Bloq</span>
              )}
            </div>
          </div>
          <div>
            <h2 className="text-3xl font-black text-gray-900 dark:text-white mb-0.5 tracking-tight">
              {stats.tenantsCount > 0 ? ((stats.activeTenants / stats.tenantsCount) * 100).toFixed(0) : 0}%
            </h2>
            <p className="text-gray-500 font-bold uppercase tracking-widest text-[10px]">Taxa de Atividade</p>
          </div>
        </div>

        {/* Total Users */}
        <div className="bg-white dark:bg-slate-800 p-5 rounded-3xl border border-gray-150 dark:border-slate-700 shadow-sm flex flex-col justify-between h-36 relative overflow-hidden group hover:border-purple-200 transition-all cursor-pointer" onClick={() => navigate('/admin/users')}>
          <div className="flex justify-between items-start">
            <div className="p-2.5 bg-purple-50 text-purple-600 rounded-xl"><Users size={18}/></div>
            <ArrowRight size={16} className="text-gray-300 group-hover:text-purple-600 transition-transform group-hover:translate-x-1"/>
          </div>
          <div>
            <h2 className="text-3xl font-black text-gray-900 dark:text-white mb-0.5 tracking-tight">{stats.usersCount}</h2>
            <p className="text-gray-500 font-bold uppercase tracking-widest text-[10px]">Usuários Total</p>
          </div>
        </div>

        {/* Total Global Assets */}
        <div className="bg-white dark:bg-slate-800 p-5 rounded-3xl border border-gray-150 dark:border-slate-700 shadow-sm flex flex-col justify-between h-36 relative overflow-hidden group hover:border-amber-200 transition-all">
          <div className="flex justify-between items-start">
            <div className="p-2.5 bg-amber-50 text-amber-600 rounded-xl"><Server size={18}/></div>
            <div className="flex items-baseline gap-1 text-gray-400">
              <span className="text-[9px] font-black uppercase bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded border border-amber-100">Global</span>
            </div>
          </div>
          <div>
            <h2 className="text-3xl font-black text-gray-900 dark:text-white mb-0.5 tracking-tight">{stats.assetsCount}</h2>
            <p className="text-gray-500 font-bold uppercase tracking-widest text-[10px]">Ativos Registrados</p>
          </div>
        </div>

      </div>

      {/* 3. NEXUS CHARTS SECTION */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Assets Global Distribution (Bar Chart) */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-800 p-6 md:p-8 rounded-3xl border border-gray-150 dark:border-slate-700 shadow-sm flex flex-col min-h-[320px]">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="font-black text-gray-900 dark:text-white flex items-center gap-2 text-lg tracking-tight">
                <BarChart3 size={20} className="text-indigo-500"/> Tipos de Ativos Registrados
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 font-medium mt-1">Soma global de equipamentos monitorados</p>
            </div>
            <div className="bg-indigo-50 text-indigo-700 px-3 py-1 rounded-lg text-xs font-black uppercase tracking-wider">
              Categorias
            </div>
          </div>
          <div className="flex-1 w-full relative">
            <Bar data={barData} options={chartOptions} />
          </div>
        </div>

        {/* Plan Distribution (Doughnut Chart) */}
        <div className="bg-white dark:bg-slate-800 p-6 md:p-8 rounded-3xl border border-gray-150 dark:border-slate-700 shadow-sm flex flex-col min-h-[320px]">
          <div className="mb-4">
            <h3 className="font-black text-gray-900 dark:text-white flex items-center gap-2 text-lg tracking-tight">
              <PieChart size={20} className="text-emerald-500"/> Distribuição de Planos
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 font-medium mt-1">Inquilinos por tier comercial</p>
          </div>
          
          <div className="flex-1 relative flex items-center justify-center min-h-[160px]">
            <Doughnut data={doughnutData} options={doughnutOptions} />
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-3xl font-black text-gray-900 dark:text-white">{stats.tenantsCount}</span>
              <span className="text-[10px] uppercase font-bold text-gray-400 dark:text-gray-500 tracking-widest">Empresas</span>
            </div>
          </div>

          {/* Legend Tiers */}
          <div className="mt-4 grid grid-cols-2 gap-2">
            {Object.keys(tenantsByPlan).map((plan, idx) => {
              const colors = ['bg-blue-500', 'bg-purple-500', 'bg-amber-500', 'bg-emerald-500'];
              return (
                <div key={plan} className="flex items-center gap-2 text-xs font-bold text-gray-600">
                  <div className={`w-2.5 h-2.5 rounded-full ${colors[idx % colors.length]}`}></div>
                  <span className="truncate">{plan}</span>
                  <span className="ml-auto text-gray-400">{tenantsByPlan[plan]}</span>
                </div>
              );
            })}
          </div>
        </div>

      </div>

      {/* 4. RECENT GLOBAL ACTIVITY FEED */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Tier Pricing Quick View */}
        <div className="bg-white dark:bg-slate-800 p-6 md:p-8 rounded-3xl border border-gray-150 dark:border-slate-700 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="font-black text-gray-900 dark:text-white mb-6 text-lg tracking-tight flex items-center gap-2">
              <Layers size={20} className="text-indigo-500"/> Resumo de Limites
            </h3>
            <div className="space-y-3">
              {[
                { title: 'Starter Plan', users: '10 users', assets: '100 assets', color: 'border-blue-100 bg-blue-50/20 text-blue-700' },
                { title: 'Pro Plan', users: '50 users', assets: '1000 assets', color: 'border-purple-100 bg-purple-50/20 text-purple-700' },
                { title: 'Enterprise', users: 'Unlimited', assets: 'Unlimited', color: 'border-amber-100 bg-amber-50/20 text-amber-700' },
              ].map((tier, idx) => (
                <div key={idx} className={`p-3.5 rounded-2xl border ${tier.color} flex justify-between items-center`}>
                  <div>
                    <p className="font-extrabold text-sm">{tier.title}</p>
                    <p className="text-xs opacity-85">{tier.users} • {tier.assets}</p>
                  </div>
                  <TrendingUp size={16} className="opacity-80"/>
                </div>
              ))}
            </div>
          </div>
          <button onClick={() => navigate('/admin/plans')} className="w-full mt-4 py-3 bg-slate-900 text-white font-bold text-xs uppercase tracking-wider rounded-xl hover:bg-slate-800 active:scale-97 transition-all">
            Ajustar Limites
          </button>
        </div>

        {/* Global Operations Logs */}
        <div className="bg-white dark:bg-slate-800 p-6 md:p-8 rounded-3xl border border-gray-150 dark:border-slate-700 shadow-sm lg:col-span-2 flex flex-col">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="font-black text-gray-900 dark:text-white text-lg flex items-center gap-2 tracking-tight">
                <Activity size={20} className="text-indigo-500"/> Atividade Nexus em Tempo Real
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 font-medium mt-1">Auditoria de operações efetuadas pelos inquilinos</p>
            </div>
            <div className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-2.5 py-1.5 rounded-lg uppercase tracking-wider">
              Monitor Global
            </div>
          </div>
          
          <div className="relative flex-1 pl-4">
            <div className="absolute top-2 bottom-0 left-[23px] w-0.5 bg-gray-100 dark:bg-slate-700"></div>
            
            <div className="space-y-6 relative z-10 mt-2">
              {recentLogs.map((act, i) => (
                <div key={i} className="flex gap-4 items-start group">
                  <div className="w-3 h-3 rounded-full bg-indigo-500 border-4 border-white dark:border-slate-800 shadow-sm mt-1 shrink-0 relative z-10 group-hover:scale-125 transition-transform"></div>
                  
                  <div className="flex-1 min-w-0 bg-gray-50/50 dark:bg-slate-900/40 p-3.5 rounded-2xl border border-gray-100 dark:border-slate-700 hover:border-indigo-100 transition-colors">
                    <div className="flex justify-between items-start gap-2 mb-1">
                      <p className="font-black text-gray-900 dark:text-white text-sm">{act.action}</p>
                      <span className="text-[10px] font-bold text-gray-400 bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 px-2 py-0.5 rounded-md whitespace-nowrap">
                        {act.jsDate ? act.jsDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '--:--'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400 font-medium">{act.details || "Operação efetuada na instância."}</p>
                    
                    <div className="flex items-center gap-2 mt-2">
                      {act.user && (
                        <div className="text-[9px] font-black text-gray-400 uppercase tracking-widest bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 px-2 py-0.5 rounded">
                          User: {act.user.split('@')[0]}
                        </div>
                      )}
                      
                      {act.tenantId && (
                        <div className="text-[9px] font-black text-indigo-500 uppercase tracking-widest bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded">
                          Tenant: {act.tenantId}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              
              {recentLogs.length === 0 && (
                <div className="flex flex-col items-center justify-center py-10 text-gray-400">
                  <Activity size={32} className="mb-3 opacity-20"/>
                  <p className="font-bold text-sm">Nenhum evento registrado hoje.</p>
                  <p className="text-xs mt-1">Aguardando operações no ecossistema.</p>
                </div>
              )}
            </div>
          </div>
        </div>

      </div>

    </div>
  );
};

export default NexusDashboard;
