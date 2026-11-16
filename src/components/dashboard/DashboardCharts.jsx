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
  teal: '20, 184, 166',
  sky: '14, 165, 233',
  orange: '249, 115, 22',
  red: '239, 68, 68',
  rose: '244, 63, 94',
  slate: '148, 163, 184',
};

const TONE_DOT = {
  green: 'bg-green-500', blue: 'bg-blue-500', amber: 'bg-amber-500', teal: 'bg-teal-500', sky: 'bg-sky-500',
  orange: 'bg-orange-500', red: 'bg-red-500', rose: 'bg-rose-500', slate: 'bg-slate-400',
};

const toneOf = (status) => getStatus(status).tone || 'slate';

const CHART_FONT = '"IBM Plex Sans", system-ui, sans-serif';

/** Canais da cor de marca aplicada (whitelabel ou acento pessoal), no formato "r, g, b". */
const brandChannels = () => {
  if (typeof window === 'undefined') return '12, 92, 171';
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--color-brand-rgb').trim();
  return raw ? raw.replace(/,/g, ' ').trim().split(/\s+/).join(', ') : '12, 92, 171';
};

const DashboardCharts = ({ typeCounts, statusCounts, totalAssets }) => {
  const { isDark } = useTheme() || {};
  const tickColor = isDark ? '#94a3b8' : '#475569';
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
    titleFont: { family: CHART_FONT, size: 13 },
    bodyFont: { family: CHART_FONT, size: 12 },
    padding: 12,
    cornerRadius: 8,
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { ...tooltip, displayColors: false } },
    scales: {
      y: { display: false, grid: { display: false } },
      x: { grid: { display: false }, ticks: { font: { family: CHART_FONT, weight: '600', size: 12 }, color: tickColor } },
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
      <div className="rounded-xl border border-dashed border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-8 text-center">
        <BarChart3 size={28} className="mx-auto mb-2 text-slate-400 dark:text-slate-500" aria-hidden="true" />
        <p className="font-semibold text-xs text-slate-700 dark:text-slate-200">Os gráficos aparecem com o primeiro ativo cadastrado.</p>
        <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">Cadastre manualmente, importe uma planilha ou use o Agente ITAM.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Gráfico de Distribuição por Tipo (Bar) */}
        <div className="lg:col-span-2 bg-white dark:bg-[#111113] p-5 rounded-xl border border-slate-200/90 dark:border-zinc-800 shadow-sm flex flex-col min-h-[300px]">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2 text-sm tracking-tight">
                <BarChart3 size={17} className="text-brand-aa" aria-hidden="true" /> Categorias de Equipamentos
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 font-medium mt-0.5">Distribuição do parque por categoria</p>
            </div>
          </div>
          <div className="flex-1 w-full relative">
            <Bar data={barData} options={chartOptions} />
          </div>
        </div>

        {/* Gráfico de Status (Doughnut) */}
        <div className="bg-white dark:bg-[#111113] p-5 rounded-xl border border-slate-200/90 dark:border-zinc-800 shadow-sm flex flex-col min-h-[300px]">
          <div className="mb-3">
            <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2 text-sm tracking-tight">
              <PieChart size={17} className="text-emerald-600 dark:text-emerald-400" aria-hidden="true" /> Status do Inventário
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 font-medium mt-0.5">Disponibilidade e ciclo de vida</p>
          </div>

          <div className="flex-1 relative flex items-center justify-center min-h-[160px]">
            <Doughnut data={doughnutData} options={doughnutOptions} />
            {/* Texto centralizado no gráfico */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">{totalAssets}</span>
              <span className="text-xs uppercase font-semibold text-slate-600 dark:text-slate-400 tracking-wider">Total</span>
            </div>
          </div>

          {/* Legenda Customizada */}
          <div className="mt-4 grid grid-cols-2 gap-2">
            {Object.entries(statusCounts).map(([status, count]) => (
              <div key={status} className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                <div className={`w-2 h-2 rounded-full shrink-0 ${TONE_DOT[toneOf(status)] || 'bg-slate-400'}`} aria-hidden="true" />
                <span className="truncate">{status}</span>
                <span className="ml-auto font-mono text-xs text-slate-600 dark:text-slate-400 tabular-nums">{count}</span>
              </div>
            ))}
          </div>
        </div>

      </div>
  );
};

export default DashboardCharts;
