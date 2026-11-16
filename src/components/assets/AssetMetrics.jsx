import React from 'react';
import { Package, CreditCard, AlertCircle, Plus, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { parseMoney } from '../../utils/terms';

const AssetMetrics = ({ assets = [] }) => {
  const navigate = useNavigate();

  const totalAssets = assets.length;
  
  const totalValue = assets.reduce((acc, curr) => {
    if (curr.category === 'Promocional' || curr.internalId?.includes('PRM')) return acc;
    const val = parseMoney(curr.valor ?? curr.value);
    return acc + (Number.isFinite(val) && val > 0 ? val : 0);
  }, 0);
  
  const maintenanceCount = assets.filter(a => a.status === 'Manutenção').length;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 p-4 md:px-8 md:py-4">
      <div className="bg-white dark:bg-[#111113] p-4 rounded-xl shadow-sm border border-slate-200/90 dark:border-zinc-800 flex flex-col justify-between transition-colors">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-500 dark:text-zinc-400">Total de Ativos</span>
          <div className="p-1.5 bg-slate-100 text-slate-700 dark:bg-zinc-900 dark:text-zinc-300 rounded-lg" aria-hidden="true"><Package size={16} aria-hidden="true" /></div>
        </div>
        <div>
          <span className="text-2xl font-bold text-slate-900 dark:text-[#fafafa] tabular-nums">{totalAssets}</span>
          <p className="text-xs font-medium text-slate-500 dark:text-zinc-400 mt-0.5">Equipamentos no parque</p>
        </div>
      </div>
      
      <div className="bg-white dark:bg-[#111113] p-4 rounded-xl shadow-sm border border-slate-200/90 dark:border-zinc-800 flex flex-col justify-between transition-colors">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-500 dark:text-zinc-400">Valor Estimado</span>
          <div className="p-1.5 bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400 rounded-lg" aria-hidden="true"><CreditCard size={16} aria-hidden="true" /></div>
        </div>
        <div>
          <span className="text-2xl font-bold text-slate-900 dark:text-[#fafafa] tabular-nums">R$ {(totalValue/1000).toFixed(0)}k</span>
          <p className="text-xs font-medium text-slate-500 dark:text-zinc-400 mt-0.5">Patrimônio ativo</p>
        </div>
      </div>

      <div className="bg-white dark:bg-[#111113] p-4 rounded-xl shadow-sm border border-slate-200/90 dark:border-zinc-800 flex flex-col justify-between transition-colors">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-500 dark:text-zinc-400">Em Manutenção</span>
          <div className="p-1.5 bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400 rounded-lg" aria-hidden="true"><AlertCircle size={16} aria-hidden="true" /></div>
        </div>
        <div>
          <span className="text-2xl font-bold text-slate-900 dark:text-[#fafafa] tabular-nums">{maintenanceCount}</span>
          <p className="text-xs font-medium text-slate-500 dark:text-zinc-400 mt-0.5">Aguardando reparo</p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => navigate('/assets/new')}
        className="bg-brand hover:bg-brand-dark text-brand-fg p-4 rounded-xl shadow-sm flex flex-col justify-between md:col-span-1 col-span-2 cursor-pointer transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand text-left"
      >
        <div className="flex justify-between items-start mb-2">
          <div className="p-1.5 bg-white/20 rounded-lg" aria-hidden="true"><Plus size={16} aria-hidden="true" /></div>
          <ChevronRight size={16} className="opacity-70" aria-hidden="true" />
        </div>
        <div>
          <span className="text-sm font-bold block">Cadastrar Novo Ativo</span>
          <p className="text-xs text-white/80 mt-0.5">Adicionar equipamento ao inventário</p>
        </div>
      </button>
    </div>
  );
};

export default AssetMetrics;
