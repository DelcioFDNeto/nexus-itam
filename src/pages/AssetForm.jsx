// src/pages/AssetForm.jsx
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getEmployees } from '../services/employeeService';
import { createAsset, updateAsset, getAssetById } from '../services/assetService';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'sonner';
import { Save, ArrowLeft, Search, Check, Smartphone, Monitor, Printer, Wifi, Server, Box, User, MapPin, Building2, Tag, Calendar, DollarSign, FileText } from 'lucide-react';
import AssetIcon from '../components/AssetIcon';

const AssetForm = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [employees, setEmployees] = useState([]); 
  const [initialData, setInitialData] = useState(null);

  const [formData, setFormData] = useState({
    model: '',
    internalId: '',
    type: 'Computador',
    category: 'Corporativo', // 'Corporativo', 'Promocional', 'Infra'
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
    // Specs dinâmicas
    specs: { ip: '', ram: '', storage: '', pageCount: '' }
  });

  useEffect(() => {
    const init = async () => {
        try {
            const empList = await getEmployees();
            setEmployees(empList);

            if (id) {
                const data = await getAssetById(id);
                if (data) {
                    const loadedData = { 
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
                        specs: { 
                            ip: data.specs?.ip || '', 
                            ram: data.specs?.ram || '', 
                            storage: data.specs?.storage || '',
                            pageCount: data.specs?.pageCount || '' 
                        } 
                    };
                    setFormData(loadedData);
                    setInitialData(loadedData);
                }
            }
        } catch (error) { console.error(error); }
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
    if (!selectedName) { setFormData(prev => ({ ...prev, assignedTo: '', clientCpf: '', sector: '', employeeId: '' })); return; }
    const emp = employees.find(ep => ep.name === selectedName);
    if (emp) { setFormData(prev => ({ ...prev, assignedTo: emp.name, clientCpf: emp.cpf || '', sector: emp.sector || '', location: emp.branch || prev.location, employeeId: emp.id })); } 
    else { setFormData(prev => ({ ...prev, assignedTo: selectedName })); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
        const cleanData = JSON.parse(JSON.stringify(formData));
        const userEmail = currentUser?.email || 'Usuário Desconhecido';
        
        if (id) {
            let diffs = [];
            if (initialData) {
                // Fields to compare
                const fieldsMap = {
                    model: 'Modelo', internalId: 'Patrimônio', type: 'Tipo', category: 'Categoria',
                    status: 'Status', location: 'Localização', assignedTo: 'Responsável',
                    sector: 'Setor', vendor: 'Vendedor', purchaseDate: 'Data de Aquisição',
                    serialNumber: 'Serial Number', valor: 'Valor'
                };
                
                Object.keys(fieldsMap).forEach(key => {
                    if (initialData[key] !== cleanData[key]) {
                        diffs.push(`Alterou ${fieldsMap[key]} de '${initialData[key] || 'Vazio'}' para '${cleanData[key] || 'Vazio'}'`);
                    }
                });
            }

            const detailsText = diffs.length > 0 ? diffs.join(', ') : 'Dados atualizados sem modificações rastreadas.';

            await updateAsset(id, cleanData, {
                action: 'Edição de Ativo',
                details: detailsText,
                user: userEmail
            });
        }
        else {
            await createAsset({ ...cleanData, createdBy: userEmail });
        }
        
        toast.success(id ? "Ativo atualizado com sucesso!" : "Ativo cadastrado com sucesso!");
        navigate('/assets');
    } catch (error) { 
        console.error(error);
        toast.error("Erro ao salvar! Verifique sua conexão."); 
    } finally { setLoading(false); }
  };
 
  const isPromotional = formData.category === 'Promocional';
  const isMobile = formData.type === 'Celular' || formData.type === 'PGT';
  const isPrinter = formData.type === 'Impressora';
  const isPC = formData.type === 'Computador' || formData.type === 'Notebook' || formData.type === 'Servidor';

  // Opções de Tipo com Ícones
  const assetTypes = [
      { id: 'Computador', label: 'Computador', icon: Monitor },
      { id: 'Notebook', label: 'Notebook', icon: Monitor },
      { id: 'Celular', label: 'Celular', icon: Smartphone },
      { id: 'Impressora', label: 'Impressora', icon: Printer },
      { id: 'Rede', label: 'Rede', icon: Wifi },
      { id: 'Monitor', label: 'Monitor', icon: Monitor },
      { id: 'PGT', label: 'PGT', icon: Smartphone },
      { id: 'Servidor', label: 'Servidor', icon: Server },
      { id: 'Outros', label: 'Outros', icon: Box },
  ];

  return (
    <div className="max-w-5xl mx-auto pb-24 animate-fade-in relative">
        
        {/* HEADER */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
            <button onClick={() => navigate('/assets')} className="group flex items-center text-gray-500 hover:text-black transition-colors font-bold text-sm">
                <div className="p-2 rounded-full group-hover:bg-gray-100 transition-all mr-2"><ArrowLeft size={20} /></div>
                Cancelar
            </button>
            <div className="flex items-center gap-3">
                 <div className="text-right hidden md:block">
                     <h1 className="text-2xl font-black text-gray-900">{id ? 'Editar Ativo' : 'Novo Ativo'}</h1>
                     <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{id ? `ID: ${id}` : 'Cadastro no Inventário'}</p>
                 </div>
                 <div className="w-12 h-12 bg-black text-white rounded-2xl flex items-center justify-center shadow-lg">
                     {id ? <AssetIcon type={formData.type} size={24} className="text-white"/> : <Box size={24}/>}
                 </div>
            </div>
        </div>

        <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* ======================== MAIN COLUMN (LEFT) ======================== */}
            <div className="lg:col-span-2 space-y-8">
                
                {/* CARD 1: IDENTIFICAÇÃO BÁSICA */}
                <div className="bg-white p-6 md:p-8 rounded-[2rem] shadow-sm border border-gray-100">
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-6 flex items-center gap-2 border-b border-gray-100 pb-2"><Tag size={16}/> Identificação & Classificação</h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="md:col-span-2">
                             <label className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 block">Nome / Modelo do Ativo</label>
                             <input name="model" value={formData.model} onChange={handleChange} className="w-full p-4 bg-gray-50 border-2 border-transparent focus:bg-white focus:border-black rounded-xl outline-none font-bold text-lg transition-all placeholder:font-normal" required placeholder="Ex: Notebook Dell Latitude 3420" />
                        </div>

                        <div>
                             <label className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 block">Patrimônio (Tag)</label>
                             <div className="relative">
                                 <Tag size={18} className="absolute left-4 top-4 text-gray-400"/>
                                 <input name="internalId" value={formData.internalId} onChange={handleChange} className="w-full pl-11 pr-4 py-3.5 bg-gray-50 border-2 border-transparent focus:bg-white focus:border-black rounded-xl outline-none font-mono font-bold text-gray-900 transition-all uppercase" required placeholder="Ex: SHL-NB-001" />
                             </div>
                        </div>

                        <div>
                             <label className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 block">Serial Number</label>
                             <input name="serialNumber" value={formData.serialNumber} onChange={handleChange} className="w-full p-3.5 bg-gray-50 border-2 border-transparent focus:bg-white focus:border-black rounded-xl outline-none font-mono text-sm font-bold text-gray-900 transition-all" placeholder="N/A" />
                        </div>
                    </div>

                    <div className="mt-8">
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3 block">Tipo de Equipamento</label>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                            {assetTypes.map(t => {
                                const Icon = t.icon;
                                const isSelected = formData.type === t.id;
                                return (
                                    <button type="button" key={t.id} onClick={() => setFormData({...formData, type: t.id})} className={`flex flex-col items-center justify-center gap-2 p-3 rounded-xl border-2 transition-all ${isSelected ? 'border-black bg-black text-white shadow-lg scale-105' : 'border-gray-100 bg-white text-gray-500 hover:border-gray-200 hover:bg-gray-50'}`}>
                                        <Icon size={20} />
                                        <span className="text-xs font-bold">{t.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* CARD 2: DETALHES TÉCNICOS (CONDICIONAL) */}
                <div className="bg-white p-6 md:p-8 rounded-[2rem] shadow-sm border border-gray-100">
                     <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-6 flex items-center gap-2 border-b border-gray-100 pb-2"><Server size={16}/> Especificações Técnicas</h3>
                     
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {isMobile && (
                            <>
                                <div><label className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 block">IMEI 1</label><input name="imei1" value={formData.imei1} onChange={handleChange} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-black outline-none font-mono text-sm" placeholder="Ex: 3569..." /></div>
                                <div><label className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 block">IMEI 2 (Opcional)</label><input name="imei2" value={formData.imei2} onChange={handleChange} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-black outline-none font-mono text-sm" /></div>
                            </>
                        )}

                        {isPrinter && (
                            <div><label className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 block">Contador de Páginas</label><input type="number" name="specs.pageCount" value={formData.specs.pageCount} onChange={handleChange} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-black outline-none font-bold" placeholder="Ex: 15000" /></div>
                        )}

                        {(isPC || formData.type === 'Rede' || isPrinter) && (
                            <div><label className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 block">Endereço IP</label><input name="specs.ip" value={formData.specs.ip} onChange={handleChange} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-black outline-none font-mono text-sm" placeholder="192.168..." /></div>
                        )}
                        
                        {(isPC) && (
                            <>
                                <div><label className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 block">Processador</label><input name="specs.processor" value={formData.specs?.processor || ''} onChange={handleChange} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-black outline-none text-sm" placeholder="Ex: i5 1135G7" /></div>
                                <div><label className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 block">Memória RAM</label><input name="specs.ram" value={formData.specs.ram} onChange={handleChange} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-black outline-none text-sm" placeholder="Ex: 16GB" /></div>
                                <div><label className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 block">Armazenamento</label><input name="specs.storage" value={formData.specs.storage} onChange={handleChange} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-black outline-none text-sm" placeholder="Ex: SSD 512GB" /></div>
                            </>
                        )}
                     </div>
                     
                     {!isMobile && !isPrinter && !isPC && (
                         <p className="text-sm text-gray-400 italic text-center py-4">Sem campos específicos para este tipo de ativo.</p>
                     )}
                </div>

                {/* CARD 3: OBSERVAÇÕES */}
                <div className="bg-yellow-50 p-6 md:p-8 rounded-[2rem] border border-yellow-100">
                    <h3 className="text-xs font-bold text-yellow-700 uppercase tracking-widest mb-4 flex items-center gap-2"><FileText size={16}/> Notas & Observações</h3>
                    <textarea name="notes" value={formData.notes} onChange={handleChange} rows="4" className="w-full p-4 bg-white border border-yellow-200 rounded-xl outline-none focus:ring-2 focus:ring-yellow-400 text-gray-700 leading-relaxed resize-none" placeholder="Detalhes adicionais, histórico breve, avarias conhecidas..." />
                </div>
            </div>

            {/* ======================== SIDEBAR COLUMN (RIGHT) ======================== */}
            <div className="space-y-6">
                
                {/* STATUS & CATEGORIA */}
                <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100">
                     <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Status & Categoria</h3>
                     
                     <div className="mb-4">
                         <label className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 block">Status Atual</label>
                         <div className="relative">
                             <select name="status" value={formData.status} onChange={handleChange} className="w-full p-3 pl-3 pr-8 bg-gray-50 border border-gray-200 rounded-xl appearance-none font-bold text-sm outline-none focus:border-black cursor-pointer">
                                 <option>Em Uso</option><option>Disponível</option><option>Manutenção</option><option>Entregue</option><option>Defeito</option>
                             </select>
                             <div className={`absolute right-3 top-3.5 w-2 h-2 rounded-full ${formData.status === 'Em Uso' ? 'bg-green-500' : formData.status === 'Disponível' ? 'bg-blue-500' : 'bg-gray-400'}`}></div>
                         </div>
                     </div>

                     <div>
                         <label className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 block">Categoria Contábil</label>
                         <select name="category" value={formData.category} onChange={handleChange} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-bold text-sm outline-none focus:border-black cursor-pointer">
                             <option value="Corporativo">Corporativo (Patrimônio)</option>
                             <option value="Promocional">Promocional (Comodato)</option>
                             <option value="Infra">Infraestrutura</option>
                         </select>
                     </div>
                </div>

                {/* RESPONSABILIDADE */}
                <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100">
                     <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2"><User size={16}/> Responsabilidade</h3>
                     
                     <div className="mb-4">
                         <label className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 flex justify-between">
                             {isPromotional ? "Cliente / Beneficiário" : "Colaborador"}
                             <button type="button" onClick={() => navigate('/employees')} className="text-brand hover:underline text-[10px]">+ Gerenciar</button>
                         </label>
                         <div className="relative">
                            <select name="assignedTo" value={formData.assignedTo} onChange={handleEmployeeSelect} className="w-full p-3 pl-3 bg-gray-50 border border-gray-200 rounded-xl appearance-none font-bold text-sm outline-none focus:border-black cursor-pointer text-gray-700">
                                <option value="">Selecione...</option>
                                {employees.map(emp => (<option key={emp.id} value={emp.name}>{emp.name}</option>))}
                            </select>
                            <Search size={16} className="absolute right-3 top-3 text-gray-400 pointer-events-none" />
                         </div>
                         {/* Fallback input se não selecionar da lista */}
                         {(!formData.assignedTo || !employees.find(e => e.name === formData.assignedTo)) && formData.assignedTo !== '' && (
                            <div className="mt-2 p-2 bg-yellow-50 border border-yellow-100 rounded-lg text-xs text-yellow-700 flex items-center gap-2">
                                <span className="font-bold">Nome manual:</span> {formData.assignedTo}
                            </div>
                         )}
                         <input name="assignedTo" value={formData.assignedTo} onChange={handleChange} placeholder="Ou digite o nome..." className="w-full mt-2 p-2 text-xs border-b border-gray-200 focus:border-black outline-none bg-transparent" />
                     </div>

                     <div className="mb-4">
                         <label className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 block">{isPromotional ? "Campanha" : "Setor"}</label>
                         <div className="relative">
                            <Building2 size={16} className="absolute left-3 top-3 text-gray-400"/>
                            <input name="sector" value={formData.sector} onChange={handleChange} className="w-full pl-9 p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium focus:border-black outline-none" placeholder="Ex: Financeiro" />
                         </div>
                     </div>

                     {isPromotional && (
                         <div className="bg-pink-50 p-3 rounded-xl border border-pink-100 mb-4">
                             <label className="text-[10px] font-bold text-pink-700 uppercase mb-1 block">Vendedor Responsável</label>
                             <input name="vendedor" value={formData.vendedor} onChange={handleChange} className="w-full p-2 bg-white border border-pink-200 rounded-lg text-sm focus:ring-2 focus:ring-pink-500 outline-none" placeholder="Nome do Vendedor..." />
                         </div>
                     )}

                     <div>
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 block">Localização Física</label>
                        <div className="relative">
                            <MapPin size={16} className="absolute left-3 top-3 text-gray-400"/>
                            <select name="location" value={formData.location} onChange={handleChange} className="w-full pl-9 p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold focus:border-black outline-none cursor-pointer">
                                <optgroup label="Pará - R. Metropolitana"><option value="Matriz - Belém">Matriz - Belém</option><option value="Fábrica / CD - Ananindeua">Fábrica / CD - Ananindeua</option><option value="Filial Ananindeua">Filial Ananindeua</option><option value="Filial Castanhal">Filial Castanhal</option><option value="Icoaraci">Icoaraci</option><option value="Barcarena">Barcarena</option></optgroup>
                                <optgroup label="Pará - Interior"><option value="Acará">Acará</option><option value="Bragança">Bragança</option><option value="Breves">Breves</option><option value="Cametá">Cametá</option><option value="Capanema">Capanema</option><option value="Capitão Poço">Capitão Poço</option><option value="Concórdia">Concórdia</option><option value="Curuçá">Curuçá</option><option value="Moju">Moju</option><option value="Igarapé Mirim">Igarapé Mirim</option><option value="São Miguel">São Miguel</option><option value="Soure">Soure</option><option value="Tailândia">Tailândia</option><option value="Tomé-Açu">Tomé-Açu</option></optgroup>
                                <optgroup label="Ceará"><option value="Aldeota (CE)">Aldeota (CE)</option><option value="Demócrito Rocha (CE)">Demócrito Rocha (CE)</option><option value="Fortaleza (CE)">Fortaleza (CE)</option><option value="Parangaba (CE)">Parangaba (CE)</option></optgroup>
                                <optgroup label="Outros"><option value="Home Office">Home Office</option><option value="Em Trânsito">Em Trânsito</option></optgroup>
                            </select>
                        </div>
                     </div>
                </div>

                {/* FINANCEIRO */}
                <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100">
                     <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2"><DollarSign size={16}/> Aquisição</h3>
                     
                     <div className="grid grid-cols-2 gap-4">
                         <div>
                             <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Valor (R$)</label>
                             <input name="valor" value={formData.valor} onChange={handleChange} className="w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-mono focus:border-black outline-none" placeholder="0,00" />
                         </div>
                         <div>
                             <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Data</label>
                             <input type="date" name="purchaseDate" value={formData.purchaseDate} onChange={handleChange} className="w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:border-black outline-none" />
                         </div>
                     </div>
                </div>

                {/* ACTION BUTTON */}
                <button disabled={loading} className="w-full py-4 bg-black text-white rounded-2xl font-black text-lg hover:bg-gray-800 transition-all shadow-xl hover:shadow-2xl hover:-translate-y-1 active:scale-95 flex items-center justify-center gap-3">
                    {loading ? (
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
                    ) : (
                        <>
                            <Save size={24} />
                            {id ? 'Salvar Alterações' : 'Cadastrar Ativo'}
                        </>
                    )}
                </button>

            </div>

        </form>
    </div>
  );
};

export default AssetForm;