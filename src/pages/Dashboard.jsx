// src/pages/Dashboard.jsx
import React, { useEffect, useState } from 'react';
import { 
  TrendingUp, Users, Server, DollarSign, 
  Monitor, Smartphone, Printer, CreditCard,
  Plus, ClipboardCheck, Activity, ArrowRight, Zap
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Bar, Doughnut } from 'react-chartjs-2';
import 'chart.js/auto'; 

// Services
import { getAllAssets, getRecentActivity } from '../services/assetService';
import { getEmployees } from '../services/employeeService';

// Components
import DashboardSkeleton from '../components/dashboard/DashboardSkeleton';

const Dashboard = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [greeting, setGreeting] = useState('');
  
  // Estados
  const [assets, setAssets] = useState([]);
  const [recentActivity, setRecentActivity] = useState([]);
  const [totalEmployees, setTotalEmployees] = useState(0);

  useEffect(() => {
    // Time-based greeting
    const hour = new Date().getHours();
    if (hour < 12) setGreeting('Bom dia');
    else if (hour < 18) setGreeting('Boa tarde');
    else setGreeting('Boa noite');

    const fetchData = async () => {
      try {
        setLoading(true);
        const [assetsData, employeesData, historyData] = await Promise.all([
            getAllAssets(),
            getEmployees(),
            getRecentActivity(6)
        ]);

        setAssets(assetsData);
        setTotalEmployees(employeesData.length);
        setRecentActivity(historyData);

      } catch (error) {
        console.error("Erro ao carregar dashboard:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // --- CALCULATIONS ---
  const totalValue = assets.reduce((acc, asset) => {
      if (asset.category === 'Promocional' || asset.internalId?.includes('PRM')) return acc;
      return acc + (parseFloat(asset.valor) || 0);
  }, 0);

  // --- CHARTS CONFIG ---
  const typeCounts = assets.reduce((acc, curr) => {
      const type = ['Notebook', 'Computador', 'Celular', 'Impressora'].includes(curr.type) ? curr.type : 'Outros';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
  }, {});

  const barData = {
    labels: Object.keys(typeCounts),
    datasets: [{
      label: 'Qtd',
      data: Object.values(typeCounts),
      backgroundColor: ['#18181B', '#E61E05', '#52525B', '#A1A1AA', '#E4E4E7'],
      borderRadius: 8,
      barThickness: 32,
    }],
  };

  const chartOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
          y: { display: false, grid: { display: false } },
          x: { grid: { display: false }, ticks: { font: { weight: 'bold' } } }
      }
  };

  if (loading) return <DashboardSkeleton />;

  return (
    <div className="max-w-[1600px] mx-auto space-y-6 animate-fade-in">
      
      {/* 1. HERO SECTION (WELCOME) */}
      <div className="bg-white rounded-[2.5rem] p-8 md:p-12 shadow-sm border border-gray-100 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-gray-100 to-gray-50 rounded-full blur-3xl opacity-50 -mr-20 -mt-20 group-hover:scale-110 transition-transform duration-1000"></div>
          
          <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
              <div>
                  <h1 className="text-4xl md:text-5xl font-black text-gray-900 tracking-tight mb-2">
                      {greeting}, <span className="text-transparent bg-clip-text bg-gradient-to-r from-gray-900 to-gray-600">Admin</span>.
                  </h1>
                  <p className="text-gray-500 font-medium max-w-md">Aqui está o panorama do seu parque tecnológico hoje.</p>
              </div>
              <div className="flex gap-3">
                  <button onClick={() => navigate('/assets/new')} className="bg-black text-white px-6 py-4 rounded-2xl font-bold flex items-center gap-2 hover:bg-gray-900 transition-all shadow-xl shadow-gray-200 active:scale-95">
                      <Plus size={20}/> <span className="hidden md:inline">Novo Ativo</span>
                  </button>
                  <button onClick={() => navigate('/audit')} className="bg-white border-2 border-gray-100 text-gray-900 px-6 py-4 rounded-2xl font-bold flex items-center gap-2 hover:border-black transition-all active:scale-95">
                      <ClipboardCheck size={20}/> <span className="hidden md:inline">Auditoria</span>
                  </button>
              </div>
          </div>
      </div>

      {/* 2. BENTO GRID STATS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
          
          {/* Main Stat Card - Dark */}
          <div className="bg-black text-white p-8 rounded-[2rem] shadow-xl flex flex-col justify-between h-64 relative overflow-hidden group hover:shadow-2xl transition-all cursor-pointer" onClick={() => navigate('/assets')}>
               <div className="absolute right-[-20px] top-[-20px] bg-white/10 w-32 h-32 rounded-full blur-2xl group-hover:bg-white/20 transition-all"></div>
               <div className="flex justify-between items-start">
                   <div className="p-3 bg-white/10 rounded-2xl backdrop-blur-sm"><Server size={24}/></div>
                   <ArrowRight className="text-gray-500 group-hover:text-white transition-colors"/>
               </div>
               <div>
                   <h2 className="text-5xl font-black mb-1">{assets.length}</h2>
                   <p className="text-gray-400 font-bold uppercase tracking-widest text-xs">Total de Ativos</p>
               </div>
          </div>

          {/* Value Card */}
          <div className="bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm flex flex-col justify-between h-64 hover:border-green-200 transition-colors">
               <div className="flex justify-between items-start">
                   <div className="p-3 bg-green-50 text-green-600 rounded-2xl"><DollarSign size={24}/></div>
                   <span className="bg-green-100 text-green-700 text-[10px] font-black px-2 py-1 rounded-full uppercase">Estimado</span>
               </div>
               <div>
                   <h2 className="text-4xl font-black text-gray-900 mb-1 tracking-tight">{(totalValue / 1000).toFixed(0)}k</h2>
                   <p className="text-gray-400 font-bold uppercase tracking-widest text-xs">Valor Patrimonial</p>
               </div>
          </div>

          {/* Chart Card */}
          <div className="md:col-span-2 bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm flex flex-col h-64">
               <div className="flex justify-between items-center mb-4">
                    <h3 className="font-bold text-gray-900 flex items-center gap-2"><TrendingUp size={18} className="text-brand"/> Distribuição</h3>
                    <button className="text-xs font-bold text-gray-400 hover:text-black">Relatório</button>
               </div>
               <div className="flex-1 w-full relative">
                    <Bar data={barData} options={chartOptions} />
               </div>
          </div>

      </div>

      {/* 3. LOWER SECTION */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Quick Categories */}
          <div className="bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm">
              <h3 className="font-black text-gray-900 mb-6 text-lg">Categorias</h3>
              <div className="space-y-4">
                  {[
                      { l: 'Notebooks', i: <Monitor size={18}/>, c: typeCounts['Notebook'] || 0, color: 'bg-blue-50 text-blue-600' },
                      { l: 'Celulares', i: <Smartphone size={18}/>, c: typeCounts['Celular'] || 0, color: 'bg-purple-50 text-purple-600' },
                      { l: 'Impressoras', i: <Printer size={18}/>, c: typeCounts['Impressora'] || 0, color: 'bg-orange-50 text-orange-600' },
                  ].map((cat, idx) => (
                      <div key={idx} className="flex items-center justify-between p-4 rounded-2xl border border-gray-50 hover:border-gray-200 hover:bg-gray-50 transition-all cursor-pointer group">
                          <div className="flex items-center gap-4">
                              <div className={`p-3 rounded-xl ${cat.color}`}>{cat.i}</div>
                              <span className="font-bold text-gray-700 group-hover:text-black">{cat.l}</span>
                          </div>
                          <span className="font-mono font-black text-lg text-gray-300 group-hover:text-black transition-colors">{cat.c}</span>
                      </div>
                  ))}
              </div>
          </div>

          {/* Recent Activity Feed */}
          <div className="bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm lg:col-span-2 flex flex-col">
              <div className="flex justify-between items-center mb-6">
                  <h3 className="font-black text-gray-900 text-lg flex items-center gap-2"><Zap size={20} className="text-yellow-500 fill-yellow-500"/> Atividade Recente</h3>
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Últimas 24h</span>
              </div>
              
              <div className="space-y-4 flex-1">
                  {recentActivity.map((act, i) => (
                      <div key={i} className="flex items-center gap-4 p-4 rounded-2xl hover:bg-gray-50 transition-colors border border-transparent hover:border-gray-100">
                          <div className="w-2 h-2 rounded-full bg-brand shrink-0"></div>
                          <div className="flex-1 min-w-0">
                              <p className="font-bold text-gray-900 text-sm truncate">{act.action}</p>
                              <p className="text-xs text-gray-500 truncate">{act.details || "Sem detalhes"}</p>
                          </div>
                          <span className="text-[10px] font-bold text-gray-300 bg-gray-50 px-2 py-1 rounded-lg">
                              {act.jsDate ? act.jsDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '--:--'}
                          </span>
                      </div>
                  ))}
                  {recentActivity.length === 0 && <p className="text-gray-400 text-center py-10">Tudo calmo por aqui.</p>}
              </div>
          </div>

      </div>

    </div>
  );
};

export default Dashboard;