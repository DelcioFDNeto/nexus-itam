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
import { useTheme } from '../../contexts/ThemeContext';
import { getStatus } from '../../utils/assetStatus';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement
);

// Cor de cada status vem do catalogo de ciclo de vida (mesmo tom do badge).
// Antes as fatias eram coloridas pela ORDEM de chegada, entao "Em Uso" podia
// sair laranja e "Manutenção" verde.
const TONE_RGB = {
  green: '34, 197, 94',
  blue: '59, 130, 246',
  amber: '245, 158, 11',
  purple: '168, 85, 247',
  orange: '249, 115, 22',
  red: '239, 68, 68',
  rose: '244, 63, 94',
  slate: '148, 163, 184',
};

const TONE_DOT = {
  green: 'bg-green-500', blue: 'bg-blue-500', amber: 'bg-amber-500', purple: 'bg-purple-500',
  orange: 'bg-orange-500', red: 'bg-red-500', rose: 'bg-rose-500', slate: 'bg-slate-400',
};

const toneOf = (status) => getStatus(status).tone || 'slate';

/** Canais da cor de marca aplicada (whitelabel ou acento pessoal), no formato "r, g, b". */
const brandChannels = () => {
  if (typeof window === 'undefined') return '79, 70, 229';
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--color-brand-rgb').trim();
  return raw ? raw.split(/s+/).join(', ') : '79, 70, 229';
};

const DashboardCharts = ({ typeCounts, statusCounts, totalAssets }) => {
  const { isDark } = useTheme() || {};
  const tickColor = isDark ? '#94a3b8' : '#64748b';
  const brand = brandChannels();

  const barData = {
    labels: Object.keys(typeCounts),
    datasets: [{
      label: 'Quantidade',
      data: Object.values(typeCounts),
      backgroundColor: `rgba(${brand}, 0.8)`,
      hoverBackgroundColor: `rgba(${brand}, 1)`,
      borderRadius: 6,
      borderSkipped: false,
      barThickness: 24,
    }],
  };

  const statusLabels = Object.keys(statusCounts);
  const doughnutData = {
    labels: statusLabels,
    datasets: [{
      data: Object.values(statusCounts),
      backgroundColor: statusLabels.map((status) => `rgba(${TONE_RGB[toneOf(status)] || TONE_RGB.slate}, 0.85)`),
      borderWidth: 0,
      hoverOffset: 4,
    }],
  };

  const tooltip = {
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    titleFont: { family: 'Inter', size: 13 },
    bodyFont: { family: 'Inter', size: 12 },
    padding: 12,
    cornerRadius: 8,
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { ...tooltip, displayColors: false } },
    scales: {
      y: { display: false, grid: { display: false } },
      x: { grid: { display: false }, ticks: { font: { family: 'Inter', weight: '600' }, color: tickColor } },
    },
  };

  const doughnutOptions = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '75%',
    plugins: { legend: { display: false }, tooltip: { ...tooltip, displayColors: true } },
  };

  if (!totalAssets) {
    return (
      <div className="rounded-3xl border border-dashed border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-10 text-center">
        <BarChart3 size={32} className="mx-auto mb-3 text-gray-300 dark:text-slate-600" />
        <p className="font-bold text-gray-700 dark:text-gray-200">Os gráficos aparecem com o primeiro ativo cadastrado.</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Cadastre manualmente, importe uma planilha ou use o Agente ITAM.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Gráfico de Distribuição por Tipo (Bar) */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-800 p-6 md:p-8 rounded-3xl border border-gray-100 dark:border-slate-700 shadow-sm flex flex-col min-h-[300px]">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="font-black text-gray-900 dark:text-white flex items-center gap-2 text-lg tracking-tight">
                <BarChart3 size={20} className="text-brand"/> Categorias de Ativos
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 font-medium mt-1">Volume por tipo de equipamento</p>
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
              <div key={status} className="flex items-center gap-2 text-xs font-bold text-gray-600 dark:text-gray-300">
                <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${TONE_DOT[toneOf(status)] || 'bg-slate-400'}`}></div>
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
