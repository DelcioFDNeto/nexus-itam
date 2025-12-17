// src/pages/Dashboard.jsx
import React, { useEffect, useState } from 'react';
import { db } from '../services/firebase';
import { collection, query, getDocs, orderBy, limit } from 'firebase/firestore';
import { 
  TrendingUp, Users, Server, AlertTriangle, 
  PieChart, DollarSign, Activity, CheckCircle, Smartphone,
  Plus, ClipboardCheck, ArrowRightLeft, ExternalLink, History
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Bar, Doughnut } from 'react-chartjs-2';
import 'chart.js/auto'; 

const Dashboard = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  
  // Estados de Dados
  const [assets, setAssets] = useState([]);
  const [recentActivity, setRecentActivity] = useState([]);
  const [totalEmployees, setTotalEmployees] = useState(0);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const assetsRef = collection(db, 'assets');
        const assetsSnap = await getDocs(assetsRef);
        const assetsData = assetsSnap.docs.map(d => d.data());
        setAssets(assetsData);

        const empRef = collection(db, 'employees');
        const empSnap = await getDocs(empRef);
        setTotalEmployees(empSnap.size);

        const histRef = collection(db, 'history');
        const qHist = query(histRef, orderBy('date', 'desc'), limit(6)); // Aumentei para 6
        const histSnap = await getDocs(qHist);
        setRecentActivity(histSnap.docs.map(d => d.data()));

      } catch (error) {
        console.error("Erro ao carregar dashboard:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // --- CÁLCULOS ---
  const totalValue = assets.reduce((acc, asset) => {
      const isPromo = asset.category === 'Promocional' || asset.internalId?.includes('PRM');
      if (isPromo) return acc;
      const val = parseFloat(asset.valor) || 0;
      return acc + val;
  }, 0);

  const statusCounts = {
      disponivel: assets.filter(a => a.status === 'Disponível').length,
      emUso: assets.filter(a => a.status === 'Em Uso' || a.status === 'Entregue').length,
      manutencao: assets.filter(a => a.status === 'Manutenção').length,
      descarte: assets.filter(a => a.status === 'Descarte' || a.status === 'Baixado').length,
  };

  const typeCounts = assets.reduce((acc, curr) => {
      // Agrupar tipos menos comuns em "Outros" para limpar o gráfico
      const type = ['Notebook', 'Computador', 'Celular', 'Impressora', 'PGT'].includes(curr.type) ? curr.type : 'Outros';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
  }, {});

  // --- GRÁFICOS CONFIG ---
  const barData = {
    labels: Object.keys(typeCounts),
    datasets: [{
      label: 'Qtd',
      data: Object.values(typeCounts),
      backgroundColor: ['#10B981', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#6B7280'],
      borderRadius: 6,
      barThickness: 30,
    }],
  };

  const barOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
          y: { grid: { borderDash: [4, 4], color: '#f3f4f6' }, beginAtZero: true },
          x: { grid: { display: false } }
      }
  };

  const doughnutData = {
    labels: ['Em Uso', 'Disponível', 'Manutenção'],
    datasets: [{
      data: [statusCounts.emUso, statusCounts.disponivel, statusCounts.manutencao],
      backgroundColor: ['#10B981', '#3B82F6', '#F59E0B'],
      borderWidth: 0,
      hoverOffset: 4
    }],
  };

  // --- HELPER DE ÍCONE DE HISTÓRICO ---
  const getActivityIcon = (action) => {
      const act = action.toLowerCase();
      if (act.includes('criado') || act.includes('novo')) return <div className="p-2 bg-green-100 text-green-600 rounded-lg"><Plus size={16}/></div>;
      if (act.includes('mov') || act.includes('transf')) return <div className="p-2 bg-blue-100 text-blue-600 rounded-lg"><ArrowRightLeft size={16}/></div>;
      if (act.includes('manut') || act.includes('edit')) return <div className="p-2 bg-orange-100 text-orange-600 rounded-lg"><Activity size={16}/></div>;
      return <div className="p-2 bg-gray-100 text-gray-600 rounded-lg"><History size={16}/></div>;
  };

  if (loading) return <div className="flex h-screen items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-b-4 border-shineray"></div></div>;

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto space-y-8 pb-24">
      
      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-end gap-4">
        <div>
            <h1 className="text-3xl font-black text-gray-900 tracking-tight flex items-center gap-2">
                Dashboard <span className="text-shineray">Shineray</span>
            </h1>
            <p className="text-gray-500 font-medium">Visão geral operacional e patrimonial.</p>
        </div>
        
        {/* AÇÕES RÁPIDAS (NOVO) */}
        <div className="flex gap-2">
            <button onClick={() => navigate('/assets/new')} className="flex items-center gap-2 px-4 py-2 bg-black text-white rounded-xl font-bold hover:bg-gray-800 transition-all shadow-lg active:scale-95 text-sm">
                <Plus size={18}/> Ativo
            </button>
            <button onClick={() => navigate('/audit')} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl font-bold hover:bg-gray-50 transition-all text-sm">
                <ClipboardCheck size={18}/> Auditoria
            </button>
        </div>
      </div>

      {/* --- KPI CARDS (Clicáveis) --- */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        
        <div onClick={() => navigate('/assets')} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between hover:shadow-md transition-all cursor-pointer group">
            <div>
                <p className="text-gray-400 text-[10px] font-black uppercase tracking-widest group-hover:text-black transition-colors">Total Ativos</p>
                <h3 className="text-3xl font-black text-gray-900 mt-1">{assets.length}</h3>
                <span className="text-[10px] font-bold text-gray-400">Base total registrada</span>
            </div>
            <div className="p-4 bg-gray-50 rounded-xl text-gray-800 group-hover:bg-black group-hover:text-white transition-colors"><Server size={24}/></div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between hover:shadow-md transition-shadow group">
            <div>
                <p className="text-gray-400 text-[10px] font-black uppercase tracking-widest">Valor Patrimonial</p>
                <h3 className="text-3xl font-black text-gray-900 mt-1 tracking-tight">
                    R$ {(totalValue / 1000).toFixed(0)}k
                </h3>
                <span className="text-[10px] font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">Exclui Promocionais</span>
            </div>
            <div className="p-4 bg-green-50 rounded-xl text-green-700"><DollarSign size={24}/></div>
        </div>

        <div onClick={() => navigate('/employees')} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between hover:shadow-md transition-all cursor-pointer group">
            <div>
                <p className="text-gray-400 text-[10px] font-black uppercase tracking-widest group-hover:text-blue-600 transition-colors">Colaboradores</p>
                <h3 className="text-3xl font-black text-gray-900 mt-1">{totalEmployees}</h3>
                <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">Equipe Ativa</span>
            </div>
            <div className="p-4 bg-blue-50 rounded-xl text-blue-700"><Users size={24}/></div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between hover:shadow-md transition-shadow">
            <div>
                <p className="text-gray-400 text-[10px] font-black uppercase tracking-widest">Manutenção</p>
                <h3 className="text-3xl font-black text-gray-900 mt-1">{statusCounts.manutencao}</h3>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusCounts.manutencao > 0 ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-400'}`}>
                    {statusCounts.manutencao > 0 ? "Atenção necessária" : "Tudo operante"}
                </span>
            </div>
            <div className={`p-4 rounded-xl ${statusCounts.manutencao > 0 ? 'bg-orange-50 text-orange-600' : 'bg-gray-50 text-gray-400'}`}><AlertTriangle size={24}/></div>
        </div>
      </div>

      {/* --- SECÇÃO DE DADOS --- */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* GRÁFICO DE BARRAS (Principal) */}
          <div className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-gray-200 flex flex-col">
              <div className="flex justify-between items-center mb-6">
                  <h3 className="font-black text-gray-800 flex items-center gap-2">
                      <TrendingUp size={20} className="text-shineray"/> Distribuição por Categoria
                  </h3>
                  <button onClick={() => navigate('/assets')} className="text-xs font-bold text-gray-400 hover:text-black flex items-center gap-1">
                      Ver Relatório <ExternalLink size={12}/>
                  </button>
              </div>
              <div className="flex-1 min-h-[300px]">
                  <Bar data={barData} options={barOptions} />
              </div>
          </div>

          {/* COLUNA LATERAL (Rosca + Lista) */}
          <div className="flex flex-col gap-8">
              
              {/* STATUS (Rosca) */}
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
                  <h3 className="font-black text-gray-800 mb-2">Status da Frota</h3>
                  <p className="text-xs text-gray-400 mb-6">Proporção de uso vs. estoque</p>
                  <div className="h-48 relative flex justify-center">
                      <Doughnut data={doughnutData} options={{ responsive: true, maintainAspectRatio: false, cutout: '75%', plugins: { legend: { display: false } } }} />
                      <div className="absolute inset-0 flex items-center justify-center flex-col pointer-events-none">
                          <span className="text-3xl font-black text-gray-900">{statusCounts.emUso}</span>
                          <span className="text-[10px] font-bold text-green-600 uppercase">Em Uso</span>
                      </div>
                  </div>
                  {/* Legenda Customizada */}
                  <div className="flex justify-center gap-4 mt-6">
                      <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-emerald-500"></div><span className="text-xs font-bold text-gray-600">Em Uso</span></div>
                      <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-blue-500"></div><span className="text-xs font-bold text-gray-600">Disp.</span></div>
                      <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-orange-500"></div><span className="text-xs font-bold text-gray-600">Manut.</span></div>
                  </div>
              </div>

              {/* HISTÓRICO RECENTE (Melhorado) */}
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 flex-1">
                  <h3 className="font-black text-gray-800 mb-4 flex items-center gap-2">
                      <Activity size={18} className="text-shineray"/> Timeline
                  </h3>
                  <div className="space-y-4">
                      {recentActivity.length === 0 ? (
                          <div className="text-center py-8 text-gray-400 text-xs">Nenhuma atividade recente.</div>
                      ) : (
                          recentActivity.map((act, index) => (
                              <div key={index} className="flex gap-3 group">
                                  {getActivityIcon(act.action)}
                                  <div className="flex-1 border-b border-gray-50 pb-3 group-last:border-0 group-last:pb-0">
                                      <p className="text-xs font-bold text-gray-900">{act.action}</p>
                                      <p className="text-[10px] text-gray-500 line-clamp-1">{act.details || "Sem detalhes"}</p>
                                      <p className="text-[9px] text-gray-300 mt-0.5 font-mono">{new Date(act.date?.seconds * 1000).toLocaleString('pt-BR')}</p>
                                  </div>
                              </div>
                          ))
                      )}
                  </div>
              </div>

          </div>
      </div>
    </div>
  );
};

export default Dashboard;