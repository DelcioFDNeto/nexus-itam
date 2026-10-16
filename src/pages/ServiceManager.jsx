// src/pages/ServiceManager.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { getContracts, createContract, updateContract, deleteContract } from '../services/contractService';
import { useAuth } from '../contexts/AuthContext';
import ManagerSkeleton from '../components/dashboard/ManagerSkeleton';
import { 
  Globe, Plus, Trash2, Search, Phone, Calendar, DollarSign, Briefcase, Edit, RefreshCcw, X 
} from 'lucide-react';
import { toast } from 'sonner';
import { can } from '../utils/permissions';
import { useConfirm } from '../components/ConfirmDialog';
import { formatDateBR, toLocalDate } from '../utils/dates';

const initialForm = {
  provider: '',
  serviceType: 'Internet',
  monthlyCost: '',
  renewalDate: '',
  supportPhone: '',
  description: ''
};

const ServiceManager = () => {
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [formData, setFormData] = useState(initialForm);

  const { currentUser } = useAuth();
  const confirm = useConfirm();
  const tenantId = currentUser?.tenantId;
  const canWrite = can(currentUser, 'contracts:write');

  const loadData = async () => {
    if (!tenantId) {
      setContracts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await getContracts(tenantId);
      setContracts(data);
    } catch (error) {
      console.error(error);
      toast.error('Erro ao carregar contratos.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (tenantId) {
      loadData();
    } else {
      setContracts([]);
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const openCreateModal = () => {
    setEditingId(null);
    setFormData(initialForm);
    setIsModalOpen(true);
  };

  const openEditModal = (contract) => {
    setEditingId(contract.id);
    setFormData({
      provider: contract.provider || '',
      serviceType: contract.serviceType || 'Internet',
      monthlyCost: contract.monthlyCost !== undefined && contract.monthlyCost !== null ? String(contract.monthlyCost) : '',
      renewalDate: contract.renewalDate || '',
      supportPhone: contract.supportPhone || '',
      description: contract.description || ''
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!tenantId) {
      toast.error('Sem contexto de tenant.');
      return;
    }

    const costNum = parseFloat(formData.monthlyCost);
    if (isNaN(costNum) || costNum < 0) {
      toast.error('Informe um valor mensal válido.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        provider: formData.provider.trim(),
        serviceType: formData.serviceType,
        monthlyCost: costNum,
        renewalDate: formData.renewalDate || '',
        supportPhone: formData.supportPhone.trim(),
        description: formData.description.trim()
      };

      if (editingId) {
        await updateContract(editingId, payload);
        toast.success('Contrato atualizado com sucesso.');
      } else {
        await createContract({ ...payload, tenantId });
        toast.success('Contrato criado com sucesso.');
      }

      setIsModalOpen(false);
      setFormData(initialForm);
      setEditingId(null);
      await loadData();
    } catch (error) {
      console.error(error);
      toast.error('Erro ao salvar contrato.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    const confirmed = await confirm({
      title: 'Excluir Contrato',
      message: 'Tem certeza que deseja remover este contrato? Esta ação não pode ser desfeita.',
      danger: true,
      confirmLabel: 'Excluir Contrato'
    });
    if (!confirmed) return;

    try {
      await deleteContract(id);
      toast.success('Contrato excluído com sucesso.');
      await loadData();
    } catch (error) {
      console.error(error);
      toast.error('Erro ao excluir contrato.');
    }
  };

  const filteredContracts = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return contracts;
    return contracts.filter(c => 
      (c.provider && c.provider.toLowerCase().includes(term)) ||
      (c.serviceType && c.serviceType.toLowerCase().includes(term)) ||
      (c.description && c.description.toLowerCase().includes(term)) ||
      (c.supportPhone && c.supportPhone.toLowerCase().includes(term))
    );
  }, [contracts, searchTerm]);

  // Soma automatica de todos os custos recorrentes para exibir no painel principal
  const totalMonthly = useMemo(() => {
    return contracts.reduce((acc, curr) => acc + (parseFloat(curr.monthlyCost) || 0), 0);
  }, [contracts]);

  if (loading) return <ManagerSkeleton />;

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto animate-fade-in pb-24">
      
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900 dark:text-white flex items-center gap-2">
            <Globe className="text-brand" /> Contas & Serviços
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Links, Hospedagem, Outsourcing e Assinaturas.</p>
        </div>
        
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input 
              type="text" 
              placeholder="Buscar contratos..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-gray-900 dark:text-white outline-none focus:border-brand"
            />
          </div>
          {canWrite && (
            <button 
              onClick={openCreateModal} 
              className="bg-black dark:bg-brand text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 hover:bg-gray-800 dark:hover:opacity-90 shadow-lg transition-colors shrink-0"
            >
              <Plus size={18} /> Novo Contrato
            </button>
          )}
        </div>
      </div>

      {/* Painel de destaque financeiro exibindo o escoamento mensal em servicos */}
      <div className="bg-neutral-900 dark:bg-slate-900 border border-neutral-800 dark:border-slate-800 text-white p-6 rounded-2xl shadow-lg mb-8 flex justify-between items-center relative overflow-hidden">
        <div className="relative z-10">
          <p className="text-gray-400 dark:text-gray-400 text-xs font-bold uppercase mb-1">Custo Mensal Recorrente</p>
          <h2 className="text-4xl font-black">R$ {totalMonthly.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h2>
        </div>
        <div className="p-3 bg-white/10 dark:bg-white/5 rounded-full"><DollarSign size={32}/></div>
      </div>

      {/* Grade exibindo cada contrato como um cartao individual */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredContracts.map(contract => {
          const cost = parseFloat(contract.monthlyCost) || 0;
          const isExpired = contract.renewalDate ? toLocalDate(contract.renewalDate) < new Date() : false;

          return (
            <div key={contract.id} className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-gray-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-all group relative">
              {canWrite && (
                <div className="absolute top-4 right-4 flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                  <button 
                    onClick={() => openEditModal(contract)} 
                    title="Editar contrato"
                    className="p-1.5 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-slate-700 rounded-lg transition-colors"
                  >
                    <Edit size={16} />
                  </button>
                  <button 
                    onClick={() => handleDelete(contract.id)} 
                    title="Excluir contrato"
                    className="p-1.5 text-gray-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-slate-700 rounded-lg transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              )}
              
              <div className="flex items-center gap-3 mb-4 pr-16">
                <div className="p-3 bg-gray-50 dark:bg-slate-900 rounded-xl text-brand font-bold border border-gray-100 dark:border-slate-700">
                  {contract.serviceType === 'Internet' ? <Globe size={24}/> : <Briefcase size={24}/>}
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 dark:text-white text-lg leading-tight truncate" title={contract.provider}>{contract.provider}</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wider">{contract.serviceType}</p>
                </div>
              </div>

              <div className="space-y-3 text-sm text-gray-600 dark:text-gray-300">
                <div className="flex justify-between border-b border-gray-100 dark:border-slate-700 pb-2">
                  <span className="flex items-center gap-2"><DollarSign size={14}/> Valor Mensal</span>
                  <span className="font-bold text-gray-900 dark:text-white">R$ {cost.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between border-b border-gray-100 dark:border-slate-700 pb-2">
                  <span className="flex items-center gap-2"><Phone size={14}/> Suporte</span>
                  <span className="font-mono text-gray-800 dark:text-gray-200">{contract.supportPhone || '---'}</span>
                </div>
                <div className="flex justify-between border-b border-gray-100 dark:border-slate-700 pb-2">
                  <span className="flex items-center gap-2"><Calendar size={14}/> Renovação</span>
                  <span className={`font-bold ${isExpired ? 'text-red-500 dark:text-red-400' : 'text-gray-800 dark:text-gray-200'}`}>
                    {contract.renewalDate ? formatDateBR(contract.renewalDate) : 'Indefinido'}
                  </span>
                </div>
              </div>
              {contract.description && (
                <div className="mt-4 p-3 bg-gray-50 dark:bg-slate-900/60 border border-gray-100 dark:border-slate-700/60 rounded-lg text-xs text-gray-500 dark:text-gray-400 italic">
                  &ldquo;{contract.description}&rdquo;
                </div>
              )}
            </div>
          );
        })}
      </div>

      {filteredContracts.length === 0 && (
        <div className="py-16 text-center text-gray-400 dark:text-gray-500 border-2 border-dashed border-gray-200 dark:border-slate-700 rounded-2xl">
          <Globe size={40} className="mx-auto mb-3 opacity-40" />
          <p className="font-bold text-base">Nenhum contrato encontrado</p>
          <p className="text-sm mt-1">{searchTerm ? 'Tente ajustar os termos da busca.' : 'Cadastre os contratos de internet, serviços ou licenças terceiras.'}</p>
        </div>
      )}

      {/* Formulario modal para registrar ou editar contrato */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden border border-gray-100 dark:border-slate-700 animate-in zoom-in duration-200">
            <div className="bg-black dark:bg-slate-900 p-4 text-white flex justify-between items-center border-b dark:border-slate-700">
              <h3 className="font-bold flex items-center gap-2">
                {editingId ? <Edit size={18} /> : <Plus size={18} />}
                {editingId ? 'Editar Contrato / Serviço' : 'Novo Contrato / Serviço'}
              </h3>
              <button disabled={saving} onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-white transition-colors">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Fornecedor / Empresa</label>
                <input 
                  required 
                  className="w-full p-3 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-white rounded-xl outline-none focus:ring-2 focus:ring-brand" 
                  placeholder="Ex: VIVO Fibra" 
                  value={formData.provider} 
                  onChange={e => setFormData({...formData, provider: e.target.value})} 
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Tipo</label>
                  <select 
                    className="w-full p-3 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-white rounded-xl outline-none focus:ring-2 focus:ring-brand" 
                    value={formData.serviceType} 
                    onChange={e => setFormData({...formData, serviceType: e.target.value})}
                  >
                    <option>Internet</option>
                    <option>Hospedagem/Web</option>
                    <option>Impressão (Locação)</option>
                    <option>SaaS / Software</option>
                    <option>Telefonia</option>
                    <option>Outros</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Valor Mensal (R$)</label>
                  <input 
                    type="number" 
                    step="0.01"
                    min="0"
                    required
                    className="w-full p-3 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-white rounded-xl outline-none focus:ring-2 focus:ring-brand" 
                    placeholder="0.00" 
                    value={formData.monthlyCost} 
                    onChange={e => setFormData({...formData, monthlyCost: e.target.value})} 
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Telefone Suporte</label>
                  <input 
                    className="w-full p-3 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-white rounded-xl outline-none focus:ring-2 focus:ring-brand" 
                    placeholder="0800..." 
                    value={formData.supportPhone} 
                    onChange={e => setFormData({...formData, supportPhone: e.target.value})} 
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Data Renovação</label>
                  <input 
                    type="date" 
                    className="w-full p-3 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-white rounded-xl outline-none focus:ring-2 focus:ring-brand" 
                    value={formData.renewalDate} 
                    onChange={e => setFormData({...formData, renewalDate: e.target.value})} 
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Descrição do Plano</label>
                <textarea 
                  className="w-full p-3 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-white rounded-xl outline-none focus:ring-2 focus:ring-brand" 
                  rows="2" 
                  placeholder="Ex: Link Dedicado 100MB + IP Fixo" 
                  value={formData.description} 
                  onChange={e => setFormData({...formData, description: e.target.value})}
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button 
                  type="button" 
                  disabled={saving} 
                  onClick={() => setIsModalOpen(false)} 
                  className="flex-1 py-3 bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-xl font-bold text-gray-600 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-600 transition-colors disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  disabled={saving} 
                  className="flex-1 bg-black hover:bg-gray-800 dark:bg-brand dark:hover:opacity-90 text-white font-bold py-3 rounded-xl transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {saving ? <RefreshCcw className="animate-spin" size={18} /> : null}
                  {saving ? 'Salvando…' : (editingId ? 'Salvar Alterações' : 'Salvar Contrato')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ServiceManager;