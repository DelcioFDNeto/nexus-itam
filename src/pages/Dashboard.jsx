// src/pages/Dashboard.jsx
import React, { useEffect, useState } from 'react';
import { db } from '../services/firebase';
import { collection, query, getDocs, orderBy, limit } from 'firebase/firestore';
import { 
  TrendingUp, Users, Server, AlertTriangle, 
  DollarSign, Activity, CheckCircle, Smartphone,
  Plus, ClipboardCheck, ArrowRightLeft, ExternalLink, 
  Wrench, FileText, Monitor, Printer, CreditCard
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Bar, Doughnut } from 'react-chartjs-2';
import 'chart.js/auto'; 

const Dashboard = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  
  // Estados
  const [assets, setAssets] = useState([]);
  const [recentActivity, setRecentActivity] = useState([]);
  const [totalEmployees, setTotalEmployees] = useState(0);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Busca paralela para performance
        const [assetsSnap, empSnap, histSnap] = await Promise.all([
            getDocs(collection(db, 'assets')),
            getDocs(collection(db, 'employees')),
            getDocs(query(collection(db, 'history'), orderBy('date', 'desc'), limit(8))) // Aumentei para 8 itens
        ]);

        setAssets(assetsSnap.docs.map(d => d.data()));
        setTotalEmployees(empSnap.size);
        
        // Tratamento do histórico para garantir datas válidas
        const historyData = histSnap.docs.map(d => {
            const data = d.data();
            return {
                ...data,
                // Garante que temos um objeto Date válido, seja do Firestore Timestamp ou string
                jsDate: data.date?.toDate ? data.date.toDate() : new Date(data.date)
            };
        });
        setRecentActivity(historyData);

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
      if (asset.category === 'Promocional' || asset.internalId?.includes('PRM')) return acc;
      return acc + (parseFloat(asset.valor) || 0);
  }, 0);

  const statusCounts = {
      disponivel: assets.filter(a => a.status === 'Disponível').length,
      emUso: assets.filter(a => a.status === 'Em Uso' || a.status === 'Entregue').length,
      manutencao: assets.filter(a => a.status === 'Manutenção').length,
      descarte: assets.filter(a => a.status === 'Descarte' || a.status === 'Baixado').length,
  };

  const typeCounts = assets.reduce((acc, curr) => {
      const type = ['Notebook', 'Computador', 'Celular', 'Impressora'].includes(curr.type) ? curr.type : 'Outros';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
  }, {});

  // --- CONFIG GRÁFICOS ---
  const barData = {
    labels: Object.keys(typeCounts),
    datasets: [{
      label: 'Qtd',
      data: Object.values(typeCounts),
      backgroundColor: ['#10B981', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6'],
      borderRadius: 6,
      barThickness: 40,
    }],
  };

  const barOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
          y: { grid: { borderDash: [4, 4], color: '#f3f4f6' }, beginAtZero: true, ticks: { precision: 0 } },
          x: { grid: { display: false } }
      }
  };

  const doughnutData = {
    labels: ['Em Uso', 'Disponível', 'Manutenção'],
    datasets: [{
      data: [statusCounts.emUso, statusCounts.disponivel, statusCounts.manutencao],
      backgroundColor: ['#10B981', '#3B82F6', '#F59E0B'],
      borderWidth: 0,
      hoverOffset: 10
    }],
  };

  // --- HELPER VISUAL PARA TIMELINE ---
  const getEventStyle = (type, action) => {
      const t = (type || '').toLowerCase();
      const a = (action || '').toLowerCase();

      if (t === 'creation' || a.includes('criado')) return { icon: <Plus size={18}/>, color: 'bg-green-100 text-green-700', label: 'Cadastro' };
      if (t === 'movimentacao' || a.includes('transf')) return { icon: <ArrowRightLeft size={18}/>, color: 'bg-blue-100 text-blue-700', label: 'Movimentação' };
      if (t === 'manutencao' || a.includes('manut')) return { icon: <Wrench size={18}/>, color: 'bg-orange-100 text-orange-700', label: 'Manutenção' };
      if (t === 'update' || a.includes('edit')) return { icon: <FileText size={18}/>, color: 'bg-gray-100 text-gray-700', label: 'Edição' };
      
      return { icon: <Activity size={18}/>, color: 'bg-purple-100 text-purple-700', label: 'Atividade' };
  };

  if (loading) return <div className="flex h-screen items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-b-4 border-shineray"></div></div>;

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto space-y-8 pb-24">
      
      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-end gap-4">
        <div>
            <h1 className="text-2xl md:text-3xl font-black text-gray-900 tracking-tight flex items-center gap-2">
                Visão Geral <span className="text-shineray">ITAM</span>
            </h1>
            <p className="text-gray-500 text-sm font-medium">Indicadores de performance e patrimônio.</p>
        </div>
        
        <div className="flex gap-2">
            <button onClick={() => navigate('/assets/new')} className="flex items-center gap-2 px-4 py-2 bg-black text-white rounded-xl font-bold hover:bg-gray-800 transition-all shadow-lg active:scale-95 text-xs md:text-sm">
                <Plus size={16}/> <span className="hidden md:inline">Novo Ativo</span>
            </button>
            <button onClick={() => navigate('/audit')} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl font-bold hover:bg-gray-50 transition-all text-xs md:text-sm shadow-sm">
                <ClipboardCheck size={16}/> Auditoria
            </button>
        </div>
      </div>

      {/* --- KPI CARDS --- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        <KpiCard title="Total Ativos" value={assets.length} subtitle="Base Registrada" icon={<Server size={24}/>} color="gray" onClick={() => navigate('/assets')}/>
        <KpiCard title="Valor Patrimonial" value={`R$ ${(totalValue / 1000).toFixed(0)}k`} subtitle="Corporativo" icon={<DollarSign size={24}/>} color="green" />
        <KpiCard title="Colaboradores" value={totalEmployees} subtitle="Ativos no sistema" icon={<Users size={24}/>} color="blue" onClick={() => navigate('/employees')}/>
        <KpiCard title="Manutenção" value={statusCounts.manutencao} subtitle="Em reparo" icon={<Wrench size={24}/>} color="orange" isAlert={statusCounts.manutencao > 0}/>
      </div>

      {/* --- CONTEÚDO PRINCIPAL --- */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* COLUNA ESQUERDA (GRÁFICOS) */}
          <div className="lg:col-span-2 space-y-8">
              
              {/* Gráfico de Barras */}
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 flex flex-col">
                  <div className="flex justify-between items-center mb-6">
                      <h3 className="font-black text-gray-800 flex items-center gap-2">
                          <TrendingUp size={20} className="text-shineray"/> Distribuição por Tipo
                      </h3>
                  </div>
                  <div className="h-64 w-full">
                      <Bar data={barData} options={barOptions} />
                  </div>
              </div>

              {/* Status (Rosca) e Info Extra */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
                      <h3 className="font-black text-gray-800 mb-2">Disponibilidade</h3>
                      <div className="h-48 relative flex justify-center">
                          <Doughnut data={doughnutData} options={{ responsive: true, maintainAspectRatio: false, cutout: '75%', plugins: { legend: { display: false } } }} />
                          <div className="absolute inset-0 flex items-center justify-center flex-col pointer-events-none">
                              <span className="text-3xl font-black text-gray-900">{statusCounts.emUso}</span>
                              <span className="text-[10px] font-bold text-green-600 uppercase">Em Uso</span>
                          </div>
                      </div>
                  </div>

                  {/* Lista Rápida de Categorias */}
                  <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 flex flex-col justify-center space-y-4">
                      <CategoryRow label="Notebooks" count={typeCounts['Notebook'] || 0} icon={<Monitor size={16}/>} />
                      <CategoryRow label="Celulares" count={typeCounts['Celular'] || 0} icon={<Smartphone size={16}/>} />
                      <CategoryRow label="Impressoras" count={typeCounts['Impressora'] || 0} icon={<Printer size={16}/>} />
                      <CategoryRow label="PGTs" count={typeCounts['PGT'] || 0} icon={<CreditCard size={16}/>} />
                  </div>
              </div>
          </div>

          {/* COLUNA DIREITA (TIMELINE MELHORADA) */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 flex flex-col h-full max-h-[800px]">
              <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50 rounded-t-2xl">
                  <h3 className="font-black text-gray-900 flex items-center gap-2">
                      <Activity size={20} className="text-shineray"/> Atividades Recentes
                  </h3>
              </div>
              
              <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-2">
                  {recentActivity.length === 0 ? (
                      <div className="text-center py-10 text-gray-400">Nenhuma atividade registrada.</div>
                  ) : (
                      recentActivity.map((act, index) => {
                          const style = getEventStyle(act.type, act.action);
                          return (
                              <div key={index} className="flex gap-3 p-3 hover:bg-gray-50 rounded-xl transition-colors group">
                                  <div className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${style.color}`}>
                                      {style.icon}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                      <div className="flex justify-between items-start">
                                          <p className="text-xs font-black text-gray-800 uppercase tracking-wide">{style.label}</p>
                                          <span className="text-[10px] text-gray-400 font-mono whitespace-nowrap ml-2">
                                              {act.jsDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} • {act.jsDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                          </span>
                                      </div>
                                      <p className="text-sm font-medium text-gray-700 mt-0.5 truncate">
                                          {act.action}
                                      </p>
                                      <p className="text-xs text-gray-500 mt-1 line-clamp-2 leading-relaxed">
                                          {act.details || act.reason || act.description || "Detalhes não informados."}
                                      </p>
                                      {/* Mostra quem fez a ação se disponível */}
                                      {act.user && <p className="text-[10px] text-gray-300 mt-1">Por: {act.user}</p>}
                                  </div>
                              </div>
                          );
                      })
                  )}
              </div>
              <div className="p-3 border-t border-gray-100 text-center">
                  <button onClick={() => navigate('/assets')} className="text-xs font-bold text-blue-600 hover:underline">Ver todos os ativos</button>
              </div>
          </div>

      </div>
    </div>
  );
};

// Componentes Auxiliares para Limpeza do Código
const KpiCard = ({ title, value, subtitle, icon, color, isAlert, onClick }) => (
    <div onClick={onClick} className={`bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between hover:shadow-md transition-all group ${onClick ? 'cursor-pointer' : ''}`}>
        <div>
            <p className="text-gray-400 text-[10px] font-black uppercase tracking-widest group-hover:text-black transition-colors">{title}</p>
            <h3 className="text-3xl font-black text-gray-900 mt-1">{value}</h3>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isAlert ? 'bg-red-100 text-red-600' : `bg-${color}-50 text-${color}-600`}`}>
                {subtitle}
            </span>
        </div>
        <div className={`p-4 rounded-xl ${isAlert ? 'bg-red-50 text-red-600' : `bg-${color}-50 text-${color}-600 group-hover:bg-${color}-100`}`}>
            {icon}
        </div>
    </div>
);

const CategoryRow = ({ label, count, icon }) => (
    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100">
        <div className="flex items-center gap-3">
            <div className="text-gray-500">{icon}</div>
            <span className="font-bold text-sm text-gray-700">{label}</span>
        </div>
        <span className="font-mono font-black text-gray-900">{count}</span>
    </div>
);

export default Dashboard;