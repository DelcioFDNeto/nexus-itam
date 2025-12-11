// src/pages/Dashboard.jsx
import React, { useEffect, useState } from 'react';
import { db } from '../services/firebase';
import { collection, query, getDocs, orderBy, limit } from 'firebase/firestore';
import { 
  TrendingUp, Users, Server, AlertTriangle, 
  PieChart, DollarSign, Activity, CheckCircle, Smartphone 
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

// --- CORREÇÃO DO ERRO ---
import { Bar, Doughnut } from 'react-chartjs-2';
// Usamos o 'chart.js/auto' para registrar tudo automaticamente e evitar o "Illegal constructor"
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
        // 1. Buscar Ativos
        const assetsRef = collection(db, 'assets');
        const assetsSnap = await getDocs(assetsRef);
        const assetsData = assetsSnap.docs.map(d => d.data());
        setAssets(assetsData);

        // 2. Buscar Funcionários (Apenas contagem)
        const empRef = collection(db, 'employees');
        const empSnap = await getDocs(empRef);
        setTotalEmployees(empSnap.size);

        // 3. Buscar Histórico Recente (Últimos 5)
        const histRef = collection(db, 'history');
        const qHist = query(histRef, orderBy('date', 'desc'), limit(5));
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

  // --- CÁLCULOS E MÉTRICAS ---

  // 1. Valor Patrimonial (COM FILTRO PROMOCIONAL)
  const totalValue = assets.reduce((acc, asset) => {
      // Verifica se é promocional
      const isPromo = asset.category === 'Promocional' || asset.internalId?.includes('PRM');
      
      // Se for promocional, IGNORA no cálculo financeiro
      if (isPromo) return acc;

      // Soma apenas corporativos
      const val = parseFloat(asset.valor) || 0;
      return acc + val;
  }, 0);

  // 2. Contagens por Status
  const statusCounts = {
      disponivel: assets.filter(a => a.status === 'Disponível').length,
      emUso: assets.filter(a => a.status === 'Em Uso').length,
      manutencao: assets.filter(a => a.status === 'Manutenção').length,
      descarte: assets.filter(a => a.status === 'Descarte' || a.status === 'Baixado').length,
  };

  // 3. Contagens por Tipo
  const typeCounts = assets.reduce((acc, curr) => {
      const type = curr.type || 'Outros';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
  }, {});

  // --- DADOS DOS GRÁFICOS ---
  const barData = {
    labels: Object.keys(typeCounts),
    datasets: [{
      label: 'Quantidade',
      data: Object.values(typeCounts),
      backgroundColor: '#D60000', // Vermelho Shineray
      borderRadius: 4,
    }],
  };

  const doughnutData = {
    labels: ['Em Uso', 'Disponível', 'Manutenção', 'Descarte'],
    datasets: [{
      data: [statusCounts.emUso, statusCounts.disponivel, statusCounts.manutencao, statusCounts.descarte],
      backgroundColor: ['#10B981', '#3B82F6', '#F59E0B', '#EF4444'],
      borderWidth: 0,
    }],
  };

  if (loading) return <div className="flex h-screen items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-b-4 border-black"></div></div>;

  return (
    <div className="p-8 max-w-[1600px] mx-auto space-y-8 pb-24">
      
      <div className="flex justify-between items-center">
        <div>
            <h1 className="text-3xl font-black text-gray-900 tracking-tight">Dashboard TI</h1>
            <p className="text-gray-500 font-medium">Visão geral da infraestrutura</p>
        </div>
        <p className="text-xs font-mono text-gray-400 bg-gray-100 px-3 py-1 rounded-full">
            Atualizado: {new Date().toLocaleTimeString()}
        </p>
      </div>

      {/* --- CARDS DE KPI --- */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        
        {/* Total Ativos */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between hover:shadow-md transition-shadow">
            <div>
                <p className="text-gray-400 text-xs font-bold uppercase tracking-wider">Total Ativos</p>
                <h3 className="text-3xl font-black text-gray-900 mt-1">{assets.length}</h3>
                <span className="text-xs text-green-600 font-bold bg-green-50 px-2 py-0.5 rounded-full">100% Registrado</span>
            </div>
            <div className="p-4 bg-gray-50 rounded-xl text-gray-800"><Server size={24}/></div>
        </div>

        {/* Valor Patrimonial (FILTRADO) */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between hover:shadow-md transition-shadow">
            <div>
                <p className="text-gray-400 text-xs font-bold uppercase tracking-wider">Valor Corporativo</p>
                <h3 className="text-3xl font-black text-gray-900 mt-1">
                    R$ {totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </h3>
                <span className="text-[10px] text-gray-400 font-bold bg-gray-100 px-2 py-0.5 rounded-full">Exclui Promocionais</span>
            </div>
            <div className="p-4 bg-green-50 rounded-xl text-green-700"><DollarSign size={24}/></div>
        </div>

        {/* Disponíveis */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between hover:shadow-md transition-shadow">
            <div>
                <p className="text-gray-400 text-xs font-bold uppercase tracking-wider">Estoque Disponível</p>
                <h3 className="text-3xl font-black text-gray-900 mt-1">{statusCounts.disponivel}</h3>
                <span className="text-xs text-blue-600 font-bold bg-blue-50 px-2 py-0.5 rounded-full">Prontos para uso</span>
            </div>
            <div className="p-4 bg-blue-50 rounded-xl text-blue-700"><CheckCircle size={24}/></div>
        </div>

        {/* Manutenção */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between hover:shadow-md transition-shadow">
            <div>
                <p className="text-gray-400 text-xs font-bold uppercase tracking-wider">Em Manutenção</p>
                <h3 className="text-3xl font-black text-gray-900 mt-1">{statusCounts.manutencao}</h3>
                <span className="text-xs text-orange-600 font-bold bg-orange-50 px-2 py-0.5 rounded-full">Aguardando reparo</span>
            </div>
            <div className="p-4 bg-orange-50 rounded-xl text-orange-700"><AlertTriangle size={24}/></div>
        </div>
      </div>

      {/* --- GRÁFICOS --- */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Gráfico de Barras (Tipos) */}
          <div className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
              <h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2">
                  <TrendingUp size={18} className="text-shineray"/> Distribuição por Tipo
              </h3>
              <div className="h-64">
                  <Bar data={barData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }} />
              </div>
          </div>

          {/* Gráfico de Rosca (Status) */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
              <h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2">
                  <Activity size={18} className="text-shineray"/> Status Geral
              </h3>
              <div className="h-64 relative flex justify-center">
                  <Doughnut data={doughnutData} options={{ responsive: true, maintainAspectRatio: false, cutout: '70%' }} />
                  <div className="absolute inset-0 flex items-center justify-center flex-col pointer-events-none">
                      <span className="text-3xl font-black text-gray-900">{assets.length}</span>
                      <span className="text-xs text-gray-400 uppercase">Total</span>
                  </div>
              </div>
          </div>
      </div>

      {/* --- ÚLTIMAS ATIVIDADES --- */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
          <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
              <HistorySectionHeader />
          </h3>
          <div className="space-y-4">
              {recentActivity.length === 0 ? (
                  <p className="text-gray-400 text-sm">Nenhuma atividade registrada.</p>
              ) : (
                  recentActivity.map((act, index) => (
                      <div key={index} className="flex items-start gap-4 pb-4 border-b border-gray-50 last:border-0 last:pb-0">
                          <div className="mt-1 p-2 bg-gray-50 rounded-lg text-gray-500">
                              <Activity size={16} />
                          </div>
                          <div>
                              <p className="text-sm font-bold text-gray-900">{act.action}</p>
                              <p className="text-xs text-gray-500">{new Date(act.date?.seconds * 1000).toLocaleString('pt-BR')}</p>
                              {act.details && <p className="text-xs text-gray-400 mt-1 italic">{act.details}</p>}
                          </div>
                      </div>
                  ))
              )}
          </div>
      </div>

    </div>
  );
};

// Componente simples para o título (para evitar repetição de ícone)
const HistorySectionHeader = () => (
  <div className="flex items-center gap-2">
    <Activity size={18} className="text-shineray" /> 
    Atividades Recentes
  </div>
);

export default Dashboard;