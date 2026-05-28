import React, { useEffect, useState } from 'react';
import { 
  TrendingUp, Users, Server, DollarSign, 
  Monitor, Smartphone, Printer, CreditCard,
  Plus, ClipboardCheck, Activity, ArrowRight, Zap,
  Key, CheckSquare, Laptop, HardDrive, Wifi,
  BarChart3, PieChart
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Bar, Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement
} from 'chart.js';

// Registrando componentes do Chart.js
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement
);

// Services
import { getAllAssets, getRecentActivity, getGlobalAssets, getGlobalActivity } from '../services/assetService';
import { getEmployees, getGlobalEmployees } from '../services/employeeService';
import { getProjects, getGlobalProjects } from '../services/projectService';
import { useAuth } from '../contexts/AuthContext';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../services/firebase';

// Components
import DashboardSkeleton from '../components/dashboard/DashboardSkeleton';
import SaaSDashboard from './SaaSDashboard';

const Dashboard = () => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const tenantId = currentUser?.tenantId;
  const [loading, setLoading] = useState(true);
  const [greeting, setGreeting] = useState('');
  
  // Estados
  const [assets, setAssets] = useState([]);
  const [recentActivity, setRecentActivity] = useState([]);
  const [totalEmployees, setTotalEmployees] = useState(0);
  const [totalProjects, setTotalProjects] = useState(0);
  const [totalTenants, setTotalTenants] = useState(0);
  const [tenantMap, setTenantMap] = useState({});

  useEffect(() => {
    // Time-based greeting
    const hour = new Date().getHours();
    if (hour < 12) setGreeting('Bom dia');
    else if (hour < 18) setGreeting('Boa tarde');
    else setGreeting('Boa noite');

    const fetchData = async () => {
      try {
        setLoading(true);
        const isSuperadmin = currentUser?.role === 'superadmin';

        if (isSuperadmin) {
          const results = await Promise.allSettled([
              getGlobalAssets(),
              getGlobalEmployees(),
              getGlobalProjects(),
              getGlobalActivity(6),
              getDocs(collection(db, 'tenants'))
          ]);
          setAssets(results[0].status === 'fulfilled' ? results[0].value : []);
          setTotalEmployees(results[1].status === 'fulfilled' ? results[1].value.length : 0);
          setTotalProjects(results[2].status === 'fulfilled' ? results[2].value.length : 0);
          setRecentActivity(results[3].status === 'fulfilled' ? results[3].value : []);
          setTotalTenants(results[4].status === 'fulfilled' ? results[4].value.docs.length : 0);

          if (results[4].status === 'fulfilled') {
            const tMap = {};
            results[4].value.docs.forEach(doc => {
              tMap[doc.id] = doc.data().companyName || 'Empresa Desconhecida';
            });
            setTenantMap(tMap);
          }
          
          // Log errors for debugging
          results.forEach((r, i) => { if (r.status === 'rejected') console.error(`Global Fetch Error [${i}]:`, r.reason); });
          
        } else if (tenantId) {
          const results = await Promise.allSettled([
              getAllAssets(tenantId),
              getEmployees(tenantId),
              getProjects(tenantId),
              getRecentActivity(tenantId, 6)
          ]);
          setAssets(results[0].status === 'fulfilled' ? results[0].value : []);
          setTotalEmployees(results[1].status === 'fulfilled' ? results[1].value.length : 0);
          setTotalProjects(results[2].status === 'fulfilled' ? results[2].value.length : 0);
          setRecentActivity(results[3].status === 'fulfilled' ? results[3].value : []);
          
          results.forEach((r, i) => { if (r.status === 'rejected') console.error(`Tenant Fetch Error [${i}]:`, r.reason); });
        }
      } catch (error) {
        console.error("Erro ao carregar dashboard:", error);
      } finally {
        setLoading(false);
      }
    };

    if (tenantId || currentUser?.role === 'superadmin') {
      fetchData();
    } else {
      setLoading(false);
    }
  }, [tenantId, currentUser]);

  // Cálculos baseados nos dados carregados para alimentar os quadros de estatísticas
  const totalValue = assets.reduce((acc, asset) => {
      if (asset.category === 'Promocional' || asset.internalId?.includes('PRM')) return acc;
      return acc + (parseFloat(asset.valor) || 0);
  }, 0);

  // Status de Saúde (Em uso, Manutenção, Disponível)
  const statusCounts = assets.reduce((acc, curr) => {
    const status = curr.status || 'Desconhecido';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  // Configurações e soma agrupada de valores para gerar os gráficos visuais
  const typeCounts = assets.reduce((acc, curr) => {
      const type = ['Notebook', 'Computador', 'Celular', 'Impressora', 'Servidor', 'Monitor'].includes(curr.type) ? curr.type : 'Outros';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
  }, {});

  const barData = {
    labels: Object.keys(typeCounts),
    datasets: [{
      label: 'Quantidade',
      data: Object.values(typeCounts),
      backgroundColor: 'rgba(99, 102, 241, 0.8)', // Indigo-500
      hoverBackgroundColor: 'rgba(79, 70, 229, 1)', // Indigo-600
      borderRadius: 6,
      borderSkipped: false,
      barThickness: 24,
    }],
  };

  const doughnutData = {
    labels: Object.keys(statusCounts),
    datasets: [{
      data: Object.values(statusCounts),
      backgroundColor: [
        'rgba(34, 197, 94, 0.8)', // Green (Em Uso)
        'rgba(245, 158, 11, 0.8)', // Amber (Manutenção)
        'rgba(59, 130, 246, 0.8)', // Blue (Disponível)
        'rgba(156, 163, 175, 0.8)' // Gray (Outros)
      ],
      borderWidth: 0,
      hoverOffset: 4,
    }],
  };

  const chartOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { 
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.9)',
          titleFont: { family: 'Inter', size: 13 },
          bodyFont: { family: 'Inter', size: 12 },
          padding: 12,
          cornerRadius: 8,
          displayColors: false,
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
        titleFont: { family: 'Inter', size: 13 },
        bodyFont: { family: 'Inter', size: 12 },
        padding: 12,
        cornerRadius: 8,
        displayColors: true,
      }
    }
  };

  if (loading) return <DashboardSkeleton />;

  if (currentUser?.role === 'superadmin') {
    return <SaaSDashboard />;
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-fade-in pb-24">
      
      {/* HEADER HERO (Glassmorphism & Gradients) */}
      <div className="relative overflow-hidden bg-gradient-to-br from-indigo-900 via-slate-900 to-black rounded-3xl p-8 md:p-10 shadow-2xl shadow-indigo-900/20 border border-indigo-500/20">
        {/* Abstract Glow Background */}
        <div className="absolute top-0 right-0 -mr-20 -mt-20 w-96 h-96 bg-indigo-500/30 rounded-full blur-[100px] pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-80 h-80 bg-cyan-500/20 rounded-full blur-[80px] pointer-events-none"></div>

        <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-8">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/10 text-cyan-300 text-xs font-black uppercase tracking-widest mb-4 backdrop-blur-md">
              <Zap size={14} className="fill-cyan-300"/> {currentUser?.role === 'superadmin' ? 'Controle Global (SaaS)' : 'Visão Geral'}
            </div>
            <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight mb-2">
              {greeting}, <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-indigo-400">{currentUser?.name || 'Admin'}</span>.
            </h1>
            <p className="text-indigo-200/80 font-medium text-sm max-w-lg leading-relaxed">
              Aqui está o panorama atualizado em tempo real da sua infraestrutura corporativa. Tudo sob controle.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button onClick={() => navigate('/assets/new')} className="bg-white dark:bg-slate-800 text-slate-900 px-5 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-gray-100 transition-all shadow-lg shadow-white/10 active:scale-95 group">
              <Plus size={18} className="group-hover:rotate-90 transition-transform duration-300"/> <span>Novo Ativo</span>
            </button>
            <button onClick={() => navigate('/audit')} className="bg-slate-800/50 backdrop-blur-md border border-white/10 text-white px-5 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-slate-800 hover:border-white/20 transition-all active:scale-95">
              <ClipboardCheck size={18} className="text-cyan-400"/> <span>Auditoria</span>
            </button>
          </div>
        </div>
      </div>

      {/* MÉTRICAS VITAIS (Bento Grid) */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-6">
          
        {/* Ativos Totais (Highlight) */}
        <div 
          className="bg-white dark:bg-slate-800 p-4 md:p-6 rounded-3xl border border-gray-100 dark:border-slate-700 shadow-sm flex flex-col justify-between relative overflow-hidden group hover:border-indigo-200 transition-all cursor-pointer h-32 md:h-40"
          onClick={() => navigate('/assets')}
        >
          <div className="absolute -right-6 -top-6 bg-indigo-50 w-20 h-20 md:w-24 md:h-24 rounded-full blur-2xl group-hover:bg-indigo-100 transition-colors"></div>
          <div className="flex justify-between items-start relative z-10">
            <div className="p-2 md:p-2.5 bg-indigo-50 text-indigo-600 rounded-xl"><Server size={18} className="md:w-5 md:h-5"/></div>
            <ArrowRight size={16} className="text-gray-300 group-hover:text-indigo-600 transition-colors group-hover:translate-x-1 md:w-[18px] md:h-[18px]"/>
          </div>
          <div className="relative z-10">
            <h2 className="text-3xl md:text-4xl font-black text-gray-900 dark:text-white mb-0.5 tracking-tighter">{assets.length}</h2>
            <p className="text-gray-500 dark:text-gray-400 font-bold uppercase tracking-widest text-[9px] md:text-[10px]">Ativos</p>
          </div>
        </div>

        {/* Valor Financeiro Estimado ou Tenants */}
        {currentUser?.role === 'superadmin' ? (
          <div className="bg-white dark:bg-slate-800 p-4 md:p-6 rounded-3xl border border-gray-100 dark:border-slate-700 shadow-sm flex flex-col justify-between relative overflow-hidden group hover:border-emerald-200 transition-all h-32 md:h-40" onClick={() => navigate('/tenants')}>
            <div className="flex justify-between items-start relative z-10">
              <div className="p-2 md:p-2.5 bg-emerald-50 text-emerald-600 rounded-xl"><Server size={18} className="md:w-5 md:h-5"/></div>
            </div>
            <div className="relative z-10">
              <h2 className="text-3xl md:text-4xl font-black text-gray-900 dark:text-white mb-0.5 tracking-tighter">{totalTenants}</h2>
              <p className="text-gray-500 dark:text-gray-400 font-bold uppercase tracking-widest text-[9px] md:text-[10px]">Empresas</p>
            </div>
          </div>
        ) : (
          <div className="bg-white dark:bg-slate-800 p-4 md:p-6 rounded-3xl border border-gray-100 dark:border-slate-700 shadow-sm flex flex-col justify-between relative overflow-hidden group hover:border-emerald-200 transition-all h-32 md:h-40">
            <div className="flex justify-between items-start relative z-10">
              <div className="p-2 md:p-2.5 bg-emerald-50 text-emerald-600 rounded-xl"><DollarSign size={18} className="md:w-5 md:h-5"/></div>
              <span className="bg-emerald-100 text-emerald-700 text-[8px] md:text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider">Estimado</span>
            </div>
            <div className="relative z-10">
              <div className="flex items-baseline gap-1 mb-0.5">
                <span className="text-xs md:text-sm font-bold text-gray-400 dark:text-gray-500">R$</span>
                <h2 className="text-3xl md:text-4xl font-black text-gray-900 dark:text-white tracking-tighter">{(totalValue / 1000).toFixed(0)}k</h2>
              </div>
              <p className="text-gray-500 dark:text-gray-400 font-bold uppercase tracking-widest text-[9px] md:text-[10px]">Valor</p>
            </div>
          </div>
        )}

        {/* Colaboradores / Usuários */}
        <div className="bg-white dark:bg-slate-800 p-4 md:p-6 rounded-3xl border border-gray-100 dark:border-slate-700 shadow-sm flex flex-col justify-between relative overflow-hidden group hover:border-blue-200 transition-all h-32 md:h-40 cursor-pointer" onClick={() => navigate('/employees')}>
          <div className="flex justify-between items-start relative z-10">
            <div className="p-2 md:p-2.5 bg-blue-50 text-blue-600 rounded-xl"><Users size={18} className="md:w-5 md:h-5"/></div>
            <ArrowRight size={16} className="text-gray-300 group-hover:text-blue-600 transition-colors group-hover:translate-x-1 md:w-[18px] md:h-[18px]"/>
          </div>
          <div className="relative z-10">
            <h2 className="text-3xl md:text-4xl font-black text-gray-900 dark:text-white mb-0.5 tracking-tighter">{totalEmployees}</h2>
            <p className="text-gray-500 dark:text-gray-400 font-bold uppercase tracking-widest text-[9px] md:text-[10px]">Equipe</p>
          </div>
        </div>

        {/* Projetos Totais */}
        <div className="bg-white dark:bg-slate-800 p-4 md:p-6 rounded-3xl border border-gray-100 dark:border-slate-700 shadow-sm flex flex-col justify-between relative overflow-hidden group hover:border-purple-200 transition-all h-32 md:h-40 cursor-pointer" onClick={() => navigate('/projects')}>
          <div className="flex justify-between items-start relative z-10">
            <div className="p-2 md:p-2.5 bg-purple-50 text-purple-600 rounded-xl"><ClipboardCheck size={18} className="md:w-5 md:h-5"/></div>
            <ArrowRight size={16} className="text-gray-300 group-hover:text-purple-600 transition-colors group-hover:translate-x-1 md:w-[18px] md:h-[18px]"/>
          </div>
          <div className="relative z-10">
            <h2 className="text-3xl md:text-4xl font-black text-gray-900 dark:text-white mb-0.5 tracking-tighter">{totalProjects}</h2>
            <p className="text-gray-500 dark:text-gray-400 font-bold uppercase tracking-widest text-[9px] md:text-[10px]">Projetos</p>
          </div>
        </div>

        {/* Agente ITAM e Tarefas Rápidas */}
        <div className="bg-gradient-to-br from-slate-800 to-slate-900 p-4 md:p-6 rounded-3xl shadow-sm flex flex-col justify-between relative overflow-hidden group cursor-pointer border border-slate-700 h-32 md:h-40" onClick={() => navigate('/agent')}>
          <div className="absolute right-0 bottom-0 opacity-10 transform translate-x-4 translate-y-4 group-hover:scale-110 transition-transform"><Activity size={80} className="md:w-[100px] md:h-[100px]"/></div>
          <div className="flex justify-between items-start relative z-10">
            <div className="p-2 md:p-2.5 bg-white/10 text-cyan-400 rounded-xl backdrop-blur-sm"><Activity size={18} className="md:w-5 md:h-5"/></div>
            <span className="flex h-2.5 w-2.5 md:h-3 md:w-3 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 md:h-3 md:w-3 bg-cyan-500"></span>
            </span>
          </div>
          <div className="relative z-10">
            <h2 className="text-lg md:text-xl font-black text-white mb-1 tracking-tight">Agente</h2>
            <p className="text-slate-400 font-bold uppercase tracking-widest text-[9px] md:text-[10px]">Automação</p>
          </div>
        </div>

      </div>

      {/* DASHBOARDS CHARTS SECTION */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Gráfico de Distribuição por Tipo (Bar) */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-800 p-6 md:p-8 rounded-3xl border border-gray-100 dark:border-slate-700 shadow-sm flex flex-col min-h-[300px]">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="font-black text-gray-900 dark:text-white flex items-center gap-2 text-lg tracking-tight">
                <BarChart3 size={20} className="text-indigo-500"/> Categorias de Ativos
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 font-medium mt-1">Volume por tipo de hardware</p>
            </div>
            <div className="bg-indigo-50 text-indigo-700 px-3 py-1 rounded-lg text-xs font-black uppercase tracking-wider">
              Volume
            </div>
          </div>
          <div className="flex-1 w-full relative">
            <Bar data={barData} options={chartOptions} />
          </div>
        </div>

        {/* Gráfico de Status (Doughnut) */}
        <div className="bg-white dark:bg-slate-800 p-6 md:p-8 rounded-3xl border border-gray-100 dark:border-slate-700 shadow-sm flex flex-col min-h-[300px]">
          <div className="mb-4">
            <h3 className="font-black text-gray-900 dark:text-white flex items-center gap-2 text-lg tracking-tight">
              <PieChart size={20} className="text-emerald-500"/> Status Operacional
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 font-medium mt-1">Disponibilidade do parque</p>
          </div>
          
          <div className="flex-1 relative flex items-center justify-center min-h-[160px]">
            <Doughnut data={doughnutData} options={doughnutOptions} />
            {/* Texto centralizado no gráfico */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-3xl font-black text-gray-900 dark:text-white">{assets.length}</span>
              <span className="text-[10px] uppercase font-bold text-gray-400 dark:text-gray-500 tracking-widest">Total</span>
            </div>
          </div>

          {/* Legenda Customizada */}
          <div className="mt-4 grid grid-cols-2 gap-2">
            {Object.entries(statusCounts).map(([status, count]) => (
              <div key={status} className="flex items-center gap-2 text-xs font-bold text-gray-600">
                <div className={`w-2.5 h-2.5 rounded-full ${
                  status === 'Em Uso' ? 'bg-green-500' : 
                  status === 'Manutenção' ? 'bg-amber-500' : 
                  status === 'Disponível' ? 'bg-blue-500' : 'bg-gray-400'
                }`}></div>
                <span className="truncate">{status}</span>
                <span className="ml-auto text-gray-400 dark:text-gray-500">{count}</span>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* FEED DE ATIVIDADES E LISTAGEM DE CATEGORIAS RÁPIDAS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Categorias - Quick Access */}
        <div className="bg-white dark:bg-slate-800 p-6 md:p-8 rounded-3xl border border-gray-100 dark:border-slate-700 shadow-sm">
          <h3 className="font-black text-gray-900 dark:text-white mb-6 text-lg tracking-tight">Destaques</h3>
          <div className="space-y-3">
            {[
              { l: 'Notebooks', i: <Laptop size={18}/>, c: typeCounts['Notebook'] || 0, color: 'bg-indigo-50 text-indigo-600 border-indigo-100' },
              { l: 'Desktops', i: <Monitor size={18}/>, c: typeCounts['Computador'] || 0, color: 'bg-blue-50 text-blue-600 border-blue-100' },
              { l: 'Móveis', i: <Smartphone size={18}/>, c: typeCounts['Celular'] || 0, color: 'bg-emerald-50 text-emerald-600 border-emerald-100' },
              { l: 'Rede/Serv.', i: <Server size={18}/>, c: (typeCounts['Servidor'] || 0) + (typeCounts['Outros'] || 0), color: 'bg-purple-50 text-purple-600 border-purple-100' },
            ].map((cat, idx) => (
              <div key={idx} className={`flex items-center justify-between p-3.5 rounded-2xl border hover:shadow-md transition-all cursor-pointer group ${cat.color.replace('text-', 'hover:bg-').replace('50', '100')} bg-white dark:bg-slate-800`}>
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-xl ${cat.color.split(' ').slice(0,2).join(' ')}`}>{cat.i}</div>
                  <span className="font-bold text-gray-700 dark:text-gray-200 group-hover:text-gray-900 dark:text-white">{cat.l}</span>
                </div>
                <span className="font-mono font-black text-lg text-gray-400 dark:text-gray-500 group-hover:text-gray-900 dark:text-white transition-colors mr-2">{cat.c}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Timeline de Atividades Recentes */}
        <div className="bg-white dark:bg-slate-800 p-6 md:p-8 rounded-3xl border border-gray-100 dark:border-slate-700 shadow-sm lg:col-span-2 flex flex-col">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="font-black text-gray-900 dark:text-white text-lg flex items-center gap-2 tracking-tight">
                <Activity size={20} className="text-brand"/> Log de Operações
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 font-medium mt-1">Rastreabilidade em tempo real</p>
            </div>
            <button className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-lg uppercase tracking-widest hover:bg-indigo-100 transition-colors">
              Ver Tudo
            </button>
          </div>
          
          <div className="relative flex-1 pl-4">
            {/* Linha vertical da timeline */}
            <div className="absolute top-2 bottom-0 left-[23px] w-0.5 bg-gray-100"></div>
            
            <div className="space-y-6 relative z-10 mt-2">
              {recentActivity.map((act, i) => (
                <div key={i} className="flex gap-4 items-start group">
                  {/* Ponto da timeline */}
                  <div className="w-3 h-3 rounded-full bg-indigo-500 border-4 border-white shadow-sm mt-1 shrink-0 relative z-10 group-hover:scale-125 transition-transform"></div>
                  
                  <div className="flex-1 min-w-0 bg-gray-50/50 p-3.5 rounded-2xl border border-gray-100 dark:border-slate-700 group-hover:border-indigo-100 group-hover:bg-indigo-50/30 transition-colors">
                    <div className="flex justify-between items-start gap-2 mb-1">
                      <p className="font-black text-gray-900 dark:text-white text-sm">{act.action}</p>
                      <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 px-2 py-0.5 rounded-md whitespace-nowrap shadow-sm">
                        {act.jsDate ? act.jsDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '--:--'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 font-medium">{act.details || "Operação realizada com sucesso."}</p>
                    
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {act.user && (
                        <div className="flex items-center gap-1.5 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 px-2 py-0.5 rounded-md">
                          <Users size={10}/> {act.user.split('@')[0]}
                        </div>
                      )}
                      
                      {currentUser?.role === 'superadmin' && act.tenantId && (
                        <div className="flex items-center gap-1.5 text-[10px] font-bold text-indigo-500 uppercase tracking-widest bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-md">
                          <Server size={10}/> {tenantMap[act.tenantId] || act.tenantId}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              
              {recentActivity.length === 0 && (
                <div className="flex flex-col items-center justify-center py-10 text-gray-400 dark:text-gray-500">
                  <ClipboardCheck size={32} className="mb-3 opacity-20"/>
                  <p className="font-bold text-sm">Tudo calmo por aqui.</p>
                  <p className="text-xs mt-1">Nenhuma atividade registrada hoje.</p>
                </div>
              )}
            </div>
          </div>
        </div>

      </div>

    </div>
  );
};

export default Dashboard;