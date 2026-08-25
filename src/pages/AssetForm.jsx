// src/pages/AssetForm.jsx
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getEmployees } from '../services/employeeService';
import { createAsset, updateAsset, getAssetById } from '../services/assetService';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'sonner';
import { Save, ArrowLeft, Search, Server, Box, User, MapPin, Building2, Tag, DollarSign, FileText, Database, ShieldCheck, Archive } from 'lucide-react';
import AssetIcon from '../components/AssetIcon';
import { buildAssetCatalog, SPEC_FIELDS, isRootSpec } from '../utils/assetTypes';
import LocationSelect from '../components/LocationSelect';
import StatusBadge from '../components/StatusBadge';
import {
  ACTIVE_STATUSES,
  isRetired,
  statusDotClass,
  warrantyStatus,
  WARRANTY_BADGE,
  WARRANTY_LABEL,
} from '../utils/assetStatus';

const AssetForm = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [employees, setEmployees] = useState([]); 
  const [initialData, setInitialData] = useState(null);
  const [customFieldsDef, setCustomFieldsDef] = useState([]);
  // Tipos proprios da empresa, somados ao catalogo base.
  const [customTypes, setCustomTypes] = useState([]);

  const [formData, setFormData] = useState({
    model: '',
    internalId: '',
    type: localStorage.getItem('itam_last_type') || 'Computador',
    category: localStorage.getItem('itam_last_category') || 'Corporativo', // 'Corporativo', 'Promocional', 'Infra'
    status: 'Em Uso',
    location: localStorage.getItem('itam_last_location') || '',
    assignedTo: '', 
    clientCpf: '',
    sector: '',
    vendedor: '', 
    employeeId: '', 
    purchaseDate: '',
    warrantyEnd: '',
    supplier: '',
    invoiceNumber: '',
    costCenter: '',
    serialNumber: '',
    imei1: '', 
    imei2: '', 
    valor: '',
    notes: '', 
    // Armazena especificações técnicas flexíveis dependendo do tipo do ativo
    specs: { ip: '', ram: '', storage: '', pageCount: '', processor: '' },
    customData: {},
    writeOffDate: '',
    writeOffReason: '',
    writeOffNotes: ''
  });

  useEffect(() => {
    const init = async () => {
        try {
            const empList = await getEmployees(currentUser?.tenantId);
            setEmployees(empList);

            if (currentUser?.tenantId) {
                const settingsSnap = await getDoc(doc(db, 'settings', currentUser.tenantId));
                if (settingsSnap.exists()) {
                    const cfg = settingsSnap.data();
                    if (cfg.customFields) setCustomFieldsDef(cfg.customFields);
                    if (cfg.assetTypes) setCustomTypes(cfg.assetTypes);
                }
            }

            if (id) {
                const data = await getAssetById(id, currentUser?.role === 'superadmin' ? null : currentUser?.tenantId);
                if (data) {
                    const loadedData = { 
                        model: data.model || '',
                        internalId: data.internalId || '',
                        type: data.type || 'Computador',
                        category: data.category || 'Corporativo',
                        status: data.status || 'Em Uso',
                        location: data.location || '',
                        assignedTo: data.assignedTo || '', 
                        clientCpf: data.clientCpf || '',
                        sector: data.sector || '',
                        vendedor: data.vendedor || '', 
                        employeeId: data.employeeId || '', 
                        purchaseDate: data.purchaseDate || '',
                        warrantyEnd: data.warrantyEnd || '',
                        supplier: data.supplier || '',
                        invoiceNumber: data.invoiceNumber || '',
                        costCenter: data.costCenter || '',
                        serialNumber: data.serialNumber || '',
                        imei1: data.imei1 || '', 
                        imei2: data.imei2 || '', 
                        valor: data.valor || '',
                        notes: data.notes || '', 
                        specs: {
                            ip: data.specs?.ip || '',
                            ram: data.specs?.ram || '',
                            storage: data.specs?.storage || '',
                            pageCount: data.specs?.pageCount || '',
                            processor: data.specs?.processor || ''
                        },
                        customData: data.customData || {},
                        // Campos de baixa: so leitura no form, mas precisam
                        // sobreviver ao salvamento.
                        writeOffDate: data.writeOffDate || '',
                        writeOffReason: data.writeOffReason || '',
                        writeOffNotes: data.writeOffNotes || ''
                    };
                    setFormData(loadedData);
                    setInitialData(loadedData);
                }
            }
        } catch (error) { console.error(error); }
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const handleCustomDataChange = (fieldId, value) => {
    setFormData(prev => ({ ...prev, customData: { ...prev.customData, [fieldId]: value } }));
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
                // Mapeia os campos para gerar um log legível no histórico de alterações
                const fieldsMap = {
                    model: 'Modelo', internalId: 'Patrimônio', type: 'Tipo', category: 'Categoria',
                    status: 'Status', location: 'Localização', assignedTo: 'Responsável',
                    sector: 'Setor', vendedor: 'Vendedor', purchaseDate: 'Data de Aquisição',
                    serialNumber: 'Serial Number', valor: 'Valor', warrantyEnd: 'Fim da Garantia',
                    supplier: 'Fornecedor', invoiceNumber: 'Nota Fiscal', costCenter: 'Centro de Custo'
                };
                
                Object.keys(fieldsMap).forEach(key => {
                    if (initialData[key] !== cleanData[key]) {
                        diffs.push(`Alterou ${fieldsMap[key]} de '${initialData[key] || 'Vazio'}' para '${cleanData[key] || 'Vazio'}'`);
                    }
                });
            }

            const detailsText = diffs.length > 0 ? diffs.join(', ') : 'Dados atualizados sem modificações rastreadas.';
            const tenantId = currentUser?.tenantId;

            await updateAsset(id, { 
                ...cleanData,
                tenantId 
            }, {
                action: 'Edição de Ativo',
                details: detailsText,
                user: userEmail,
                tenantId
            });
        }
        else {
            const tenantId = currentUser?.tenantId;
            await createAsset({ 
                ...cleanData, 
                createdBy: userEmail,
                tenantId
            });
            // Salva as escolhas globais de batch (lote) para a próxima inserção
            localStorage.setItem('itam_last_type', cleanData.type);
            localStorage.setItem('itam_last_category', cleanData.category);
            localStorage.setItem('itam_last_location', cleanData.location);
        }
        
        toast.success(id ? "Ativo atualizado com sucesso!" : "Ativo cadastrado com sucesso!");
        navigate('/assets');
    } catch (error) { 
        console.error(error);
        toast.error("Erro ao salvar! Verifique sua conexão."); 
    } finally { setLoading(false); }
  };
 
  const isPromotional = formData.category === 'Promocional';

  // Catalogo base + tipos da empresa. Os campos tecnicos exibidos vem dele,
  // nao de booleanos por tipo espalhados pelo JSX.
  const catalog = buildAssetCatalog(customTypes);
  const garantia = warrantyStatus(formData.warrantyEnd);
  // Ativo baixado nao volta ao inventario por um <select>: a reativacao e um
  // evento registrado na timeline, feita na tela de detalhe.
  const baixado = isRetired(formData.status);
  const activeSpecs = catalog.find(t => t.id === formData.type)?.specs || [];

  return (
    <div className="max-w-5xl mx-auto pb-24 animate-fade-in relative">
        
        {/* Cabeçalho da página de formulário com botão de retorno e título dinâmico */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
            <button onClick={() => navigate('/assets')} className="group flex items-center text-gray-500 dark:text-gray-400 hover:text-black transition-colors font-bold text-sm">
                <div className="p-2 rounded-full group-hover:bg-gray-100 transition-all mr-2"><ArrowLeft size={20} /></div>
                Cancelar
            </button>
            <div className="flex items-center gap-3">
                 <div className="text-right hidden md:block">
                     <h1 className="text-2xl font-black text-gray-900 dark:text-white">{id ? 'Editar Ativo' : 'Novo Ativo'}</h1>
                     <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">{id ? `ID: ${id}` : 'Cadastro no Inventário'}</p>
                 </div>
                 <div className="w-12 h-12 bg-black text-white rounded-2xl flex items-center justify-center shadow-lg">
                     {id ? <AssetIcon type={formData.type} size={24} className="text-white"/> : <Box size={24}/>}
                 </div>
            </div>
        </div>

        <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* Coluna principal contendo os campos vitais do equipamento (Esquerda e Centro) */}
            <div className="lg:col-span-2 space-y-8">
                
                {/* Agrupamento de campos para identificação primária (Nome, Tag, Serial) */}
                <div className="bg-white dark:bg-slate-800 p-6 md:p-8 rounded-[2rem] shadow-sm border border-gray-100 dark:border-slate-700">
                    <h3 className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-6 flex items-center gap-2 border-b border-gray-100 dark:border-slate-700 pb-2"><Tag size={16}/> Identificação & Classificação</h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="md:col-span-2">
                             <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5 block">Nome / Modelo do Ativo</label>
                             <input name="model" value={formData.model} onChange={handleChange} className="w-full p-4 bg-gray-50 dark:bg-slate-900 border-2 border-transparent focus:bg-white dark:focus:bg-slate-800 focus:border-black rounded-xl outline-none font-bold text-lg transition-all placeholder:font-normal" required placeholder="Ex: Notebook Dell Latitude 3420" />
                        </div>

                        <div>
                             <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5 block">Patrimônio (Tag)</label>
                             <div className="relative">
                                 <Tag size={18} className="absolute left-4 top-4 text-gray-400 dark:text-gray-500"/>
                                 <input name="internalId" value={formData.internalId} onChange={handleChange} className="w-full pl-11 pr-4 py-3.5 bg-gray-50 dark:bg-slate-900 border-2 border-transparent focus:bg-white dark:focus:bg-slate-800 focus:border-black rounded-xl outline-none font-mono font-bold text-gray-900 dark:text-white transition-all uppercase" required placeholder="Ex: SHL-NB-001" />
                             </div>
                        </div>

                        <div>
                             <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5 block">Serial Number</label>
                             <input name="serialNumber" value={formData.serialNumber} onChange={handleChange} className="w-full p-3.5 bg-gray-50 dark:bg-slate-900 border-2 border-transparent focus:bg-white dark:focus:bg-slate-800 focus:border-black rounded-xl outline-none font-mono text-sm font-bold text-gray-900 dark:text-white transition-all" placeholder="N/A" />
                        </div>
                    </div>

                    <div className="mt-8">
                        <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3 block">Tipo de Equipamento</label>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                            {catalog.map(t => {
                                const Icon = t.icon;
                                const isSelected = formData.type === t.id;
                                return (
                                    <button type="button" key={t.id} onClick={() => setFormData({...formData, type: t.id})} className={`flex flex-col items-center justify-center gap-2 p-3 rounded-xl border-2 transition-all ${isSelected ? 'border-black bg-black text-white shadow-lg scale-105' : 'border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-500 dark:text-gray-400 hover:border-gray-200 dark:hover:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-900'}`}>
                                        <Icon size={20} />
                                        <span className="text-xs font-bold">{t.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* Seção de dados técnicos que muda dinamicamente baseada no tipo escolhido acima */}
                <div className="bg-white dark:bg-slate-800 p-6 md:p-8 rounded-[2rem] shadow-sm border border-gray-100 dark:border-slate-700">
                     <h3 className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-6 flex items-center gap-2 border-b border-gray-100 dark:border-slate-700 pb-2"><Server size={16}/> Especificações Técnicas</h3>
                     
                     {activeSpecs.length > 0 ? (
                       <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          {activeSpecs.map((field) => {
                            const def = SPEC_FIELDS[field];
                            // IMEI mora na raiz do documento; o resto vive em `specs`.
                            const name = isRootSpec(field) ? field : `specs.${field}`;
                            const value = isRootSpec(field)
                              ? formData[field] || ''
                              : formData.specs?.[field] || '';
                            return (
                              <div key={field}>
                                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5 block">
                                  {def.label}
                                </label>
                                <input
                                  type={def.type || 'text'}
                                  name={name}
                                  value={value}
                                  onChange={handleChange}
                                  placeholder={def.placeholder}
                                  className={`w-full p-3 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-600 rounded-xl focus:border-black outline-none text-sm text-gray-900 dark:text-white ${def.mono ? 'font-mono' : ''}`}
                                />
                              </div>
                            );
                          })}
                       </div>
                     ) : (
                       <p className="text-sm text-gray-400 dark:text-gray-500 italic text-center py-4">
                         Sem campos específicos para este tipo de ativo.
                       </p>
                     )}
                </div>

                {/* Campos Customizados Dinâmicos */}
                {customFieldsDef.length > 0 && (
                    <div className="bg-white dark:bg-slate-800 p-6 md:p-8 rounded-[2rem] shadow-sm border border-brand/20">
                         <h3 className="text-xs font-bold text-brand uppercase tracking-widest mb-6 flex items-center gap-2 border-b border-gray-100 dark:border-slate-700 pb-2"><Database size={16}/> Informações Adicionais</h3>
                         <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {customFieldsDef.map(cf => (
                                <div key={cf.id}>
                                    <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5 block">{cf.label}</label>
                                    {cf.type === 'textarea' ? (
                                        <textarea 
                                            value={formData.customData[cf.id] || ''} 
                                            onChange={e => handleCustomDataChange(cf.id, e.target.value)} 
                                            className="w-full p-3 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-600 rounded-xl focus:border-black outline-none text-sm resize-none h-24"
                                        />
                                    ) : (
                                        <input 
                                            type={cf.type === 'number' ? 'number' : cf.type === 'date' ? 'date' : 'text'}
                                            value={formData.customData[cf.id] || ''} 
                                            onChange={e => handleCustomDataChange(cf.id, e.target.value)} 
                                            className="w-full p-3 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-600 rounded-xl focus:border-black outline-none text-sm" 
                                        />
                                    )}
                                </div>
                            ))}
                         </div>
                    </div>
                )}

                {/* Campo de notas em formato livre para registrar informações adicionais e histórico manual */}
                <div className="bg-yellow-50 p-6 md:p-8 rounded-[2rem] border border-yellow-100">
                    <h3 className="text-xs font-bold text-yellow-700 uppercase tracking-widest mb-4 flex items-center gap-2"><FileText size={16}/> Notas & Observações</h3>
                    <textarea name="notes" value={formData.notes} onChange={handleChange} rows="4" className="w-full p-4 bg-white dark:bg-slate-800 border border-yellow-200 rounded-xl outline-none focus:ring-2 focus:ring-yellow-400 text-gray-700 dark:text-gray-200 leading-relaxed resize-none" placeholder="Detalhes adicionais, histórico breve, avarias conhecidas..." />
                </div>
            </div>

            {/* Coluna lateral menor para definições gerenciais (Status, Responsável, Financeiro) */}
            <div className="space-y-6">
                
                {/* Definição do estado de uso e a classificação contábil */}
                <div className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] shadow-sm border border-gray-100 dark:border-slate-700">
                     <h3 className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-4">Status & Categoria</h3>
                     
                     <div className="mb-4">
                         <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5 block">Status Atual</label>

                         {baixado ? (
                           <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-3">
                             <div className="flex items-center gap-2">
                               <Archive size={15} className="text-slate-400" />
                               <StatusBadge status={formData.status} />
                             </div>
                             {formData.writeOffReason && (
                               <p className="mt-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                                 {formData.writeOffReason}
                                 {formData.writeOffDate && ` · ${formData.writeOffDate}`}
                               </p>
                             )}
                             <p className="mt-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                               Reative pela tela do ativo
                             </p>
                           </div>
                         ) : (
                           <div className="relative">
                             <select name="status" value={formData.status} onChange={handleChange} className="w-full p-3 pl-3 pr-8 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-600 rounded-xl appearance-none font-bold text-sm text-gray-900 dark:text-white outline-none focus:border-black cursor-pointer">
                                 {ACTIVE_STATUSES.map(st => (
                                   <option key={st.id} value={st.id}>{st.label}</option>
                                 ))}
                             </select>
                             <div className={`absolute right-3 top-3.5 w-2 h-2 rounded-full ${statusDotClass(formData.status)}`}></div>
                           </div>
                         )}
                     </div>

                     <div>
                         <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5 block">Categoria Contábil</label>
                         <select name="category" value={formData.category} onChange={handleChange} className="w-full p-3 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-600 rounded-xl font-bold text-sm outline-none focus:border-black cursor-pointer">
                             <option value="Corporativo">Corporativo (Patrimônio)</option>
                             <option value="Promocional">Promocional (Comodato)</option>
                             <option value="Infra">Infraestrutura</option>
                         </select>
                     </div>
                </div>

                {/* Associação do equipamento a um colaborador, setor e local específico */}
                <div className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] shadow-sm border border-gray-100 dark:border-slate-700">
                     <h3 className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-4 flex items-center gap-2"><User size={16}/> Responsabilidade</h3>
                     
                     <div className="mb-4">
                         <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5 flex justify-between">
                             {isPromotional ? "Cliente / Beneficiário" : "Colaborador"}
                             <button type="button" onClick={() => navigate('/employees')} className="text-brand hover:underline text-[10px]">+ Gerenciar</button>
                         </label>
                         <div className="relative">
                            <select name="assignedTo" value={formData.assignedTo} onChange={handleEmployeeSelect} className="w-full p-3 pl-3 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-600 rounded-xl appearance-none font-bold text-sm outline-none focus:border-black cursor-pointer text-gray-700 dark:text-gray-200">
                                <option value="">Selecione...</option>
                                {employees.map(emp => (<option key={emp.id} value={emp.name}>{emp.name}</option>))}
                            </select>
                            <Search size={16} className="absolute right-3 top-3 text-gray-400 dark:text-gray-500 pointer-events-none" />
                         </div>
                         {/*
                             Havia um <select> e um <input> com o mesmo name="assignedTo"
                             no mesmo formulario: digitar limpava CPF e setor preenchidos
                             pela selecao, sem aviso. Agora o campo livre e explicito e
                             so aparece quando o nome nao esta no cadastro.
                         */}
                         {formData.assignedTo && !employees.some(e => e.name === formData.assignedTo) && (
                            <div className="mt-2 p-2 bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-100 dark:border-yellow-900/50 rounded-lg text-xs text-yellow-700 dark:text-yellow-500">
                                <span className="font-bold">Fora do cadastro:</span> {formData.assignedTo}
                            </div>
                         )}
                         <input
                            value={formData.assignedTo}
                            onChange={e => setFormData(prev => ({ ...prev, assignedTo: e.target.value, employeeId: '' }))}
                            placeholder="Ou digite um nome fora do cadastro..."
                            className="w-full mt-2 p-2 text-xs border-b border-gray-200 dark:border-slate-600 focus:border-black outline-none bg-transparent"
                         />
                     </div>

                     <div className="mb-4">
                         <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5 block">{isPromotional ? "Campanha" : "Setor"}</label>
                         <div className="relative">
                            <Building2 size={16} className="absolute left-3 top-3 text-gray-400 dark:text-gray-500"/>
                            <input name="sector" value={formData.sector} onChange={handleChange} className="w-full pl-9 p-2.5 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-600 rounded-xl text-sm font-medium focus:border-black outline-none" placeholder="Ex: Financeiro" />
                         </div>
                     </div>

                     {isPromotional && (
                         <div className="bg-pink-50 p-3 rounded-xl border border-pink-100 mb-4">
                             <label className="text-[10px] font-bold text-pink-700 uppercase mb-1 block">Vendedor Responsável</label>
                             <input name="vendedor" value={formData.vendedor} onChange={handleChange} className="w-full p-2 bg-white dark:bg-slate-800 border border-pink-200 rounded-lg text-sm focus:ring-2 focus:ring-pink-500 outline-none" placeholder="Nome do Vendedor..." />
                         </div>
                     )}

                     <div>
                        <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5 block">Localização Física</label>
                        <div className="relative">
                            <MapPin size={16} className="absolute left-3 top-3 text-gray-400 dark:text-gray-500"/>
                            <LocationSelect
                                value={formData.location}
                                onChange={handleChange}
                                showManageLink
                                className="w-full pl-9 p-2.5 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-600 rounded-xl text-sm font-bold text-gray-900 dark:text-white focus:border-black outline-none cursor-pointer"
                            />
                        </div>
                     </div>
                </div>

                {/* Registro do valor de custo e data da compra */}
                <div className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] shadow-sm border border-gray-100 dark:border-slate-700">
                     <h3 className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-4 flex items-center gap-2"><DollarSign size={16}/> Aquisição & Garantia</h3>

                     <div className="grid grid-cols-2 gap-3">
                         <div>
                             <label className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase mb-1 block">Valor (R$)</label>
                             <input name="valor" value={formData.valor} onChange={handleChange} inputMode="decimal" className="w-full p-2.5 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-600 rounded-lg text-sm text-gray-900 dark:text-white focus:border-black outline-none font-mono" placeholder="0,00" />
                         </div>
                         <div>
                             <label className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase mb-1 block">Data da compra</label>
                             <input type="date" name="purchaseDate" value={formData.purchaseDate} onChange={handleChange} className="w-full p-2.5 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-600 rounded-lg text-sm text-gray-900 dark:text-white focus:border-black outline-none" />
                         </div>

                         <div className="col-span-2">
                             <label className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase mb-1 block">Fim da garantia</label>
                             <input type="date" name="warrantyEnd" value={formData.warrantyEnd} onChange={handleChange} className="w-full p-2.5 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-600 rounded-lg text-sm text-gray-900 dark:text-white focus:border-black outline-none" />
                             {garantia && (
                                 <span className={`mt-1.5 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase ${WARRANTY_BADGE[garantia.state]}`}>
                                     <ShieldCheck size={11} />
                                     {WARRANTY_LABEL[garantia.state]}
                                     {garantia.state !== 'expirada' && ` · ${garantia.days}d`}
                                 </span>
                             )}
                         </div>

                         <div className="col-span-2">
                             <label className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase mb-1 block">Fornecedor</label>
                             <input name="supplier" value={formData.supplier} onChange={handleChange} className="w-full p-2.5 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-600 rounded-lg text-sm text-gray-900 dark:text-white focus:border-black outline-none" placeholder="Ex: Dell Brasil" />
                         </div>
                         <div>
                             <label className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase mb-1 block">Nota fiscal</label>
                             <input name="invoiceNumber" value={formData.invoiceNumber} onChange={handleChange} className="w-full p-2.5 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-600 rounded-lg text-sm text-gray-900 dark:text-white focus:border-black outline-none font-mono" placeholder="Nº" />
                         </div>
                         <div>
                             <label className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase mb-1 block">Centro de custo</label>
                             <input name="costCenter" value={formData.costCenter} onChange={handleChange} className="w-full p-2.5 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-600 rounded-lg text-sm text-gray-900 dark:text-white focus:border-black outline-none" placeholder="Ex: TI-001" />
                         </div>
                     </div>
                </div>

                {/* Botão final que efetiva o salvamento das informações digitadas */}
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