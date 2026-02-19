// src/components/MaintenanceModal.jsx
import React, { useState } from 'react';
import { X, Wrench, DollarSign, AlertTriangle, Save } from 'lucide-react';
import AssetIcon from '../components/AssetIcon';

const MaintenanceModal = ({ isOpen, onClose, asset, onConfirm }) => {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    defect: '',
    provider: '',
    cost: '',
    description: ''
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    await onConfirm(formData);
    setLoading(false);
    onClose();
  };

  // Formata moeda simples
  const handleCostChange = (e) => {
    let value = e.target.value.replace(/\D/g, "");
    value = (Number(value) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
    setFormData({ ...formData, cost: value });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200">
        
        {/* Header de Alerta */}
        <div className="bg-orange-600 p-4 flex justify-between items-center text-white">
          <h3 className="font-bold text-lg flex items-center gap-2">
            <Wrench className="text-white" /> Registrar Manutenção
          </h3>
          <button onClick={onClose} className="hover:bg-orange-700 p-1 rounded transition">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          
          <div className="bg-orange-50 p-3 rounded-lg border border-orange-100 flex gap-3">
             <AlertTriangle className="text-orange-500 shrink-0" size={20} />
             <p className="text-xs text-orange-800">
                Ao confirmar, o status do ativo <span className="inline-flex items-center gap-1 mx-1 align-bottom rounded bg-white px-1 border border-orange-200"><AssetIcon type={asset.type} category={asset.category} model={asset.model} internalId={asset.internalId} size={14} /> <strong>{asset.internalId}</strong></span> mudará automaticamente para <strong>EM MANUTENÇÃO</strong>.
             </p>
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Defeito Apresentado</label>
            <input 
                type="text" required
                placeholder="Ex: Tela piscando, HD queimado..."
                className="w-full p-2 border rounded focus:ring-2 focus:ring-orange-500 outline-none"
                value={formData.defect}
                onChange={e => setFormData({...formData, defect: e.target.value})}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Fornecedor / Técnico</label>
                <input 
                    type="text" required
                    placeholder="Ex: Dell Support, Assistência Local"
                    className="w-full p-2 border rounded focus:ring-2 focus:ring-orange-500 outline-none"
                    value={formData.provider}
                    onChange={e => setFormData({...formData, provider: e.target.value})}
                />
            </div>
            <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Custo (R$)</label>
                <div className="relative">
                    <input 
                        type="text"
                        placeholder="0,00"
                        className="w-full p-2 pl-8 border rounded focus:ring-2 focus:ring-orange-500 outline-none font-mono"
                        value={formData.cost}
                        onChange={handleCostChange}
                    />
                    <DollarSign size={16} className="absolute left-2.5 top-2.5 text-gray-400" />
                </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Relatório Técnico / Observações</label>
            <textarea 
                className="w-full p-2 border rounded focus:ring-2 focus:ring-orange-500 outline-none h-24 text-sm"
                placeholder="Detalhes do serviço realizado..."
                value={formData.description}
                onChange={e => setFormData({...formData, description: e.target.value})}
            ></textarea>
          </div>

          <button 
            type="submit" disabled={loading}
            className="w-full py-3 bg-orange-600 text-white font-bold rounded-lg hover:bg-orange-700 transition flex items-center justify-center gap-2"
          >
            {loading ? "Salvando..." : <><Save size={18} /> Confirmar Entrada em Manutenção</>}
          </button>

        </form>
      </div>
    </div>
  );
};

export default MaintenanceModal;