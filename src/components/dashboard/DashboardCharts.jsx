import React from 'react';
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
import { BarChart3, PieChart } from 'lucide-react';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement
);

const DashboardCharts = ({ typeCounts, statusCounts, totalAssets }) => {
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

  return (
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
              <span className="text-3xl font-black text-gray-900 dark:text-white">{totalAssets}</span>
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
  );
};

export default DashboardCharts;
