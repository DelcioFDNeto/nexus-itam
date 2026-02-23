// src/pages/ServiceManager.jsx
import React, { useState, useEffect } from 'react';
import { getContracts, createContract, deleteContract } from '../services/contractService';
import { 
  Globe, Plus, Trash2, Search, Phone, Calendar, DollarSign, Briefcase 
} from 'lucide-react';
import { toast } from 'sonner';

const ServiceManager = () => {
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  const [formData, setFormData] = useState({
    provider: '',
    serviceType: 'Internet',
    monthlyCost: '',
    renewalDate: '',
    supportPhone: '',
    description: ''
  });

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await getContracts();
      setContracts(data);
    } catch (error) { console.error(error); } finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await createContract(formData);
      setIsModalOpen(false);
      setFormData({ provider: '', serviceType: 'Internet', monthlyCost: '', renewalDate: '', supportPhone: '', description: '' });
      loadData();
    } catch (error) { toast.error("Erro ao salvar."); }
  };

  const handleDelete = async (id) => {
    if(confirm("Excluir este contrato?")) { await deleteContract(id); loadData(); }
  };

  // Soma dos custos mensais
  const totalMonthly = contracts.reduce((acc, curr) => acc + (parseFloat(curr.monthlyCost) || 0), 0);

  return (
    <div className="p-8 max-w-[1600px] mx-auto">
      
      <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900 flex items-center gap-2">
            <Globe className="text-brand" /> Contas & Serviços
          </h1>
          <p className="text-sm text-gray-500">Links, Hospedagem, Outsourcing e Assinaturas.</p>
        </div>
        <button onClick={() => setIsModalOpen(true)} className="bg-black text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-gray-800 shadow-lg">
          <Plus size={20} /> Novo Contrato
        </button>
      </div>

      {/* Resumo de Custos */}
      <div className="bg-neutral-900 text-white p-6 rounded-2xl shadow-lg mb-8 flex justify-between items-center relative overflow-hidden">
          <div className="relative z-10">
              <p className="text-gray-400 text-xs font-bold uppercase mb-1">Custo Mensal Recorrente</p>
              <h2 className="text-4xl font-black">R$ {totalMonthly.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h2>
          </div>
          <div className="p-3 bg-white/10 rounded-full"><DollarSign size={32}/></div>
      </div>

      {/* Lista de Contratos */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {contracts.map(contract => (
            <div key={contract.id} className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-all group relative">
                <button onClick={() => handleDelete(contract.id)} className="absolute top-4 right-4 text-gray-300 hover:text-red-500"><Trash2 size={18}/></button>
                
                <div className="flex items-center gap-3 mb-4">
                    <div className="p-3 bg-gray-50 rounded-xl text-brand font-bold border border-gray-100">
                        {contract.serviceType === 'Internet' ? <Globe size={24}/> : <Briefcase size={24}/>}
                    </div>
                    <div>
                        <h3 className="font-bold text-gray-900 text-lg leading-tight">{contract.provider}</h3>
                        <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">{contract.serviceType}</p>
                    </div>
                </div>

                <div className="space-y-3 text-sm text-gray-600">
                    <div className="flex justify-between border-b border-gray-50 pb-2">
                        <span className="flex items-center gap-2"><DollarSign size={14}/> Valor Mensal</span>
                        <span className="font-bold text-gray-900">R$ {parseFloat(contract.monthlyCost).toLocaleString('pt-BR')}</span>
                    </div>
                    <div className="flex justify-between border-b border-gray-50 pb-2">
                        <span className="flex items-center gap-2"><Phone size={14}/> Suporte</span>
                        <span className="font-mono text-gray-800">{contract.supportPhone || "---"}</span>
                    </div>
                    <div className="flex justify-between border-b border-gray-50 pb-2">
                        <span className="flex items-center gap-2"><Calendar size={14}/> Renovação</span>
                        <span className={`font-bold ${new Date(contract.renewalDate) < new Date() ? 'text-red-500' : 'text-gray-800'}`}>
                            {contract.renewalDate ? new Date(contract.renewalDate).toLocaleDateString('pt-BR') : "Indefinido"}
                        </span>
                    </div>
                </div>
                {contract.description && (
                    <div className="mt-4 p-3 bg-gray-50 rounded-lg text-xs text-gray-500 italic">
                        "{contract.description}"
                    </div>
                )}
            </div>
        ))}
      </div>

      {/* MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in duration-200">
            <div className="bg-black p-4 text-white flex justify-between items-center">
              <h3 className="font-bold">Novo Contrato / Serviço</h3>
              <button onClick={() => setIsModalOpen(false)}>✕</button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Fornecedor / Empresa</label>
                    <input required className="w-full p-3 border rounded-xl outline-none focus:ring-2 focus:ring-black" placeholder="Ex: VIVO Fibra" value={formData.provider} onChange={e => setFormData({...formData, provider: e.target.value})} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Tipo</label>
                        <select className="w-full p-3 border rounded-xl bg-white" value={formData.serviceType} onChange={e => setFormData({...formData, serviceType: e.target.value})}>
                            <option>Internet</option>
                            <option>Hospedagem/Web</option>
                            <option>Impressão (Locação)</option>
                            <option>SaaS / Software</option>
                            <option>Telefonia</option>
                            <option>Outros</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Valor Mensal (R$)</label>
                        <input type="number" className="w-full p-3 border rounded-xl outline-none" placeholder="0.00" value={formData.monthlyCost} onChange={e => setFormData({...formData, monthlyCost: e.target.value})} />
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Telefone Suporte</label>
                        <input className="w-full p-3 border rounded-xl outline-none" placeholder="0800..." value={formData.supportPhone} onChange={e => setFormData({...formData, supportPhone: e.target.value})} />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Data Renovação</label>
                        <input type="date" className="w-full p-3 border rounded-xl outline-none" value={formData.renewalDate} onChange={e => setFormData({...formData, renewalDate: e.target.value})} />
                    </div>
                </div>
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Descrição do Plano</label>
                    <textarea className="w-full p-3 border rounded-xl outline-none" rows="2" placeholder="Ex: Link Dedicado 100MB + IP Fixo" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})}></textarea>
                </div>
                <button type="submit" className="w-full bg-brand hover:bg-red-700 text-white font-bold py-3 rounded-xl transition-colors mt-2">Salvar Contrato</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ServiceManager;