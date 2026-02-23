import React from 'react';
import { Package, CreditCard, AlertCircle, Plus, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const AssetMetrics = ({ assets = [] }) => {
  const navigate = useNavigate();

  // --- CALCULOS DO MINI-DASHBOARD ---
  const totalAssets = assets.length;
  
  const totalValue = assets.reduce((acc, curr) => {
      if (curr.category === 'Promocional' || curr.internalId?.includes('PRM')) return acc;
      return acc + (parseFloat(curr.valor) || 0);
  }, 0);
  
  const maintenanceCount = assets.filter(a => a.status === 'Manutenção').length;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 md:p-8">
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col justify-between h-32 md:h-40 relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-24 h-24 bg-gray-50 rounded-full -mr-8 -mt-8 group-hover:scale-110 transition-transform"></div>
            <div className="relative z-10 p-2 bg-black text-white w-fit rounded-xl"><Package size={20}/></div>
            <div className="relative z-10">
                <span className="text-3xl font-black text-gray-900">{totalAssets}</span>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mt-1">Total de Ativos</p>
            </div>
        </div>
        
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col justify-between h-32 md:h-40 relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-24 h-24 bg-green-50 rounded-full -mr-8 -mt-8 group-hover:scale-110 transition-transform"></div>
            <div className="relative z-10 p-2 bg-green-100 text-green-700 w-fit rounded-xl"><CreditCard size={20}/></div>
            <div className="relative z-10">
                <span className="text-2xl font-black text-gray-900">{(totalValue/1000).toFixed(0)}k</span>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mt-1">Valor Estimado (R$)</p>
            </div>
        </div>

        <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col justify-between h-32 md:h-40 relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-24 h-24 bg-orange-50 rounded-full -mr-8 -mt-8 group-hover:scale-110 transition-transform"></div>
            <div className="relative z-10 p-2 bg-orange-100 text-orange-700 w-fit rounded-xl"><AlertCircle size={20}/></div>
            <div className="relative z-10">
                <span className="text-3xl font-black text-gray-900">{maintenanceCount}</span>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mt-1">Em Manutenção</p>
            </div>
        </div>

        {/* QUICK ACTIONS CARD */}
        <div className="bg-black text-white p-6 rounded-3xl shadow-lg flex flex-col justify-between h-32 md:h-40 relative overflow-hidden md:col-span-1 col-span-2 cursor-pointer group hover:shadow-2xl transition-all" onClick={() => navigate('/assets/new')}>
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-10 -mt-10 blur-xl group-hover:bg-white/20 transition-all"></div>
            <div className="flex justify-between items-start">
                <div className="p-2 bg-white/20 w-fit rounded-xl backdrop-blur-sm"><Plus size={20}/></div>
                <ChevronRight className="opacity-50 group-hover:opacity-100 transition-opacity"/>
            </div>
            <div className="relative z-10">
                <span className="text-lg font-bold">Novo Ativo</span>
                <p className="text-xs font-medium text-gray-400 mt-1">Registrar equipamento</p>
            </div>
        </div>
    </div>
  );
};

export default AssetMetrics;
