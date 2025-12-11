// src/pages/AssetForm.jsx
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getEmployees } from '../services/employeeService';
import { createAsset, updateAsset, getAssetById } from '../services/assetService';
import { Save, ArrowLeft, Search, Smartphone, Monitor, Printer, Network, CreditCard, Megaphone } from 'lucide-react';

const AssetForm = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [employees, setEmployees] = useState([]); 

  // ESTADO INICIAL: Todos os campos começam como string vazia ''
  const [formData, setFormData] = useState({
    model: '',
    internalId: '',
    type: 'Computador',
    category: 'Corporativo',
    status: 'Em Uso',
    location: 'Matriz - Belém',
    assignedTo: '', 
    clientCpf: '',
    sector: '',
    vendedor: '', 
    employeeId: '', 
    purchaseDate: '',
    serialNumber: '',
    imei1: '', 
    imei2: '', 
    valor: '',
    notes: '', 
    specs: { ip: '', ram: '', storage: '' }
  });

  useEffect(() => {
    const init = async () => {
        try {
            const empList = await getEmployees();
            setEmployees(empList);

            if (id) {
                const data = await getAssetById(id);
                
                if (data) {
                    // --- A CORREÇÃO DO ERRO ESTÁ AQUI ---
                    // Usamos || '' para garantir que NENHUM campo seja undefined
                    setFormData({ 
                        model: data.model || '',
                        internalId: data.internalId || '',
                        type: data.type || 'Computador',
                        category: data.category || 'Corporativo',
                        status: data.status || 'Em Uso',
                        location: data.location || 'Matriz - Belém',
                        assignedTo: data.assignedTo || '', 
                        clientCpf: data.clientCpf || '',
                        sector: data.sector || '',
                        vendedor: data.vendedor || '', 
                        employeeId: data.employeeId || '', 
                        purchaseDate: data.purchaseDate || '',
                        serialNumber: data.serialNumber || '',
                        imei1: data.imei1 || '', 
                        imei2: data.imei2 || '', 
                        valor: data.valor || '',
                        notes: data.notes || '', 
                        specs: data.specs || { ip: '', ram: '', storage: '' } 
                    });
                } else {
                    alert("Ativo não encontrado.");
                    navigate('/assets');
                }
            }
        } catch (error) {
            console.error("Erro ao carregar dados:", error);
        }
    };
    init();
  }, [id, navigate]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name.startsWith('specs.')) {
        const field = name.split('.')[1];
        setFormData(prev => ({ ...prev, specs: { ...prev.specs, [field]: value } }));
    } else {
        setFormData(prev => ({ ...prev, [name]: value }));
    }
  };

  const handleEmployeeSelect = (e) => {
    const selectedName = e.target.value;
    if (!selectedName) {
        // Se limpou o campo, limpa os dados vinculados
        setFormData(prev => ({ ...prev, assignedTo: '', clientCpf: '', sector: '', employeeId: '' }));
        return;
    }
    
    const emp = employees.find(ep => ep.name === selectedName);
    if (emp) {
        setFormData(prev => ({
            ...prev,
            assignedTo: emp.name,
            clientCpf: emp.cpf || '',
            sector: emp.sector || '',
            location: emp.branch || prev.location, 
            employeeId: emp.id
        }));
    } else {
        setFormData(prev => ({ ...prev, assignedTo: selectedName }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    try {
        const cleanData = JSON.parse(JSON.stringify(formData));

        if (id) {
            await updateAsset(id, cleanData); // Aguarda o update
        } else {
            await createAsset(cleanData); // Aguarda o create
        }
        
        navigate('/assets'); // Só sai depois de salvar
        
    } catch (error) {
        console.error("Erro ao salvar:", error);
        alert("Erro ao salvar.");
    } finally {
        setLoading(false);
    }
  };

  const getTypeIcon = () => {
      if (formData.category === 'Promocional') return <Megaphone size={24} className="text-pink-500"/>;
      switch(formData.type) {
          case 'Celular': return <Smartphone size={24} />;
          case 'Impressora': return <Printer size={24} />;
          case 'Rede': return <Network size={24} />;
          case 'PGT': return <CreditCard size={24} />;
          default: return <Monitor size={24} />;
      }
  };

  const isPromotional = formData.category === 'Promocional';

  return (
    <div className="p-8 max-w-4xl mx-auto">
        <button onClick={() => navigate('/assets')} className="mb-6 flex items-center gap-2 text-gray-500 hover:text-black font-bold uppercase text-sm">
            <ArrowLeft size={18} /> Voltar para Lista
        </button>

        <div className="flex items-center gap-3 mb-6">
            <div className="p-3 bg-black text-shineray rounded-lg">{getTypeIcon()}</div>
            <h1 className="text-2xl font-bold text-gray-900">{id ? 'Editar Ativo' : 'Novo Ativo'}</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8 bg-white p-8 rounded-2xl shadow-sm border border-gray-200">
            
            {/* Bloco 1: Identificação */}
            <div>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 border-b pb-2">Identificação</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">Modelo / Nome</label>
                        <input name="model" value={formData.model} onChange={handleChange} className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-black outline-none" required placeholder="Ex: Galaxy A32" />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">Patrimônio (Tag)</label>
                        <input name="internalId" value={formData.internalId} onChange={handleChange} className="w-full p-2 border border-gray-300 rounded bg-gray-50 font-mono font-bold" required placeholder="Ex: SHL-CEL-001" />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">Categoria</label>
                        <select name="category" value={formData.category} onChange={handleChange} className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-black outline-none bg-white">
                            <option value="Corporativo">Corporativo (Uso Interno)</option>
                            <option value="Promocional">Promocional (Campanha/Cliente)</option>
                            <option value="Infra">Infraestrutura</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">Tipo</label>
                        <select name="type" value={formData.type} onChange={handleChange} className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-black outline-none bg-white">
                            <option>Computador</option>
                            <option>Notebook</option>
                            <option>Celular</option>
                            <option>Impressora</option>
                            <option>Rede</option>
                            <option>PGT</option>
                            <option>Monitor</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Bloco 2: Vínculo com Usuário */}
            <div>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 border-b pb-2">Responsabilidade & Local</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    
                    <div className="md:col-span-2">
                        <label className="block text-sm font-bold text-gray-700 mb-1 flex justify-between">
                            {isPromotional ? "Cliente / Beneficiário" : "Colaborador Responsável"}
                            <span className="text-xs font-bold text-blue-600 cursor-pointer hover:underline" onClick={() => navigate('/employees')}>+ Gerenciar Equipe</span>
                        </label>
                        <div className="relative">
                            <select name="assignedTo" value={formData.assignedTo} onChange={handleEmployeeSelect} className="w-full p-2 pl-3 border border-gray-300 rounded appearance-none bg-white focus:ring-2 focus:ring-black outline-none">
                                <option value="">Selecione ou deixe vazio...</option>
                                {employees.map(emp => (<option key={emp.id} value={emp.name}>{emp.name} - {emp.sector}</option>))}
                            </select>
                            <Search size={16} className="absolute right-3 top-3 text-gray-400 pointer-events-none" />
                        </div>
                        {(!formData.assignedTo || !employees.find(e => e.name === formData.assignedTo)) && (
                             <input name="assignedTo" value={formData.assignedTo} onChange={handleChange} placeholder="Ou digite o nome manualmente..." className="w-full p-2 border border-gray-300 rounded mt-2 text-sm bg-gray-50"/>
                        )}
                    </div>

                    {isPromotional && (
                        <div className="md:col-span-2 bg-pink-50 p-4 rounded-lg border border-pink-100">
                            <label className="block text-sm font-bold text-pink-700 mb-1">Vendedor Vinculado</label>
                            <input 
                                name="vendedor" 
                                value={formData.vendedor} 
                                onChange={handleChange} 
                                placeholder="Nome do Vendedor da Campanha..."
                                className="w-full p-2 border border-pink-200 rounded focus:ring-2 focus:ring-pink-500 outline-none"
                            />
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">{isPromotional ? "Campanha" : "Setor"}</label>
                        <input name="sector" value={formData.sector} onChange={handleChange} className="w-full p-2 border border-gray-300 rounded bg-gray-50" placeholder="Automático ou Digite" />
                    </div>
                    
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">Localização Física</label>
                         <select name="location" value={formData.location} onChange={handleChange} className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-black outline-none bg-white">
                            <optgroup label="Pará - Região Metropolitana">
                                <option value="Matriz - Belém">Matriz - Belém</option>
                                <option value="Fábrica / CD - Ananindeua">Fábrica / CD - Ananindeua</option>
                                <option value="Filial Ananindeua">Filial Ananindeua</option>
                                <option value="Filial Castanhal">Filial Castanhal</option>
                                <option value="Icoaraci">Icoaraci</option>
                                <option value="Barcarena">Barcarena</option>
                            </optgroup>
                            <optgroup label="Pará - Interior">
                                <option value="Acará">Acará</option>
                                <option value="Bragança">Bragança</option>
                                <option value="Breves">Breves</option>
                                <option value="Capanema">Capanema</option>
                                <option value="Capitão Poço">Capitão Poço</option>
                                <option value="Concórdia">Concórdia</option>
                                <option value="Curuçá">Curuçá</option>
                                <option value="Moju">Moju</option>
                                <option value="Igarapé Mirim">Igarapé Mirim</option>
                                <option value="São Miguel">São Miguel</option>
                                <option value="Soure">Soure</option>
                                <option value="Tailândia">Tailândia</option>
                                <option value="Tomé-Açu">Tomé-Açu</option>
                            </optgroup>
                            <optgroup label="Ceará">
                                <option value="Aldeota (CE)">Aldeota (CE)</option>
                                <option value="Demócrito Rocha (CE)">Demócrito Rocha (CE)</option>
                                <option value="Parangaba (CE)">Parangaba (CE)</option>
                            </optgroup>
                            <optgroup label="Outros">
                                <option value="Home Office">Home Office</option>
                                <option value="Em Trânsito">Em Trânsito</option>
                            </optgroup>
                        </select>
                    </div>

                    <div><label className="block text-sm font-bold text-gray-700 mb-1">CPF</label><input name="clientCpf" value={formData.clientCpf} onChange={handleChange} className="w-full p-2 border border-gray-300 rounded bg-gray-50" placeholder="Automático..." /></div>
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">Status Atual</label>
                        <select name="status" value={formData.status} onChange={handleChange} className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-black outline-none bg-white">
                            <option>Em Uso</option><option>Disponível</option><option>Em Transferência</option><option>Manutenção</option><option>Entregue</option><option>Defeito</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Bloco 3: Detalhes Técnicos */}
            <div>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 border-b pb-2">Especificações Técnicas</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div><label className="block text-sm font-bold text-gray-700 mb-1">Serial Number</label><input name="serialNumber" value={formData.serialNumber} onChange={handleChange} className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-black outline-none" /></div>
                    <div><label className="block text-sm font-bold text-gray-700 mb-1">IMEI 1 (Celulares)</label><input name="imei1" value={formData.imei1} onChange={handleChange} className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-black outline-none font-mono" placeholder="Ex: 3569..." /></div>
                    <div><label className="block text-sm font-bold text-gray-700 mb-1">IMEI 2 (Opcional)</label><input name="imei2" value={formData.imei2} onChange={handleChange} className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-black outline-none font-mono" /></div>
                    <div><label className="block text-sm font-bold text-gray-700 mb-1">Endereço IP</label><input name="specs.ip" value={formData.specs.ip} onChange={handleChange} className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-black outline-none" placeholder="192.168..." /></div>
                    <div><label className="block text-sm font-bold text-gray-700 mb-1">Valor do Ativo (R$)</label><input name="valor" value={formData.valor} onChange={handleChange} className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-black outline-none" placeholder="R$ 0,00" /></div>
                    <div><label className="block text-sm font-bold text-gray-700 mb-1">Data de Aquisição</label><input type="date" name="purchaseDate" value={formData.purchaseDate} onChange={handleChange} className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-black outline-none" /></div>
                </div>
            </div>

            {/* Bloco 4: Observações */}
            <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Observações</label>
                <textarea name="notes" value={formData.notes} onChange={handleChange} rows="3" className="w-full p-2 border border-gray-300 rounded outline-none focus:ring-2 focus:ring-black" placeholder="Detalhes adicionais..." />
            </div>

            <div className="pt-4">
                <button disabled={loading} className="w-full bg-black text-white py-4 rounded-lg font-bold hover:bg-gray-800 transition flex items-center justify-center gap-2 shadow-lg">
                    {loading ? "Processando..." : <><Save size={20} /> Salvar Dados do Ativo</>}
                </button>
            </div>
        </form>
    </div>
  );
};

export default AssetForm;