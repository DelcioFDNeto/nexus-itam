// src/pages/EmployeeManager.jsx
import React, { useState, useEffect } from 'react';
import { 
  getEmployees, addEmployee, updateEmployee, deleteEmployee, 
  getSectors, addSector, updateSector, deleteSector 
} from '../services/employeeService';
import { 
  Users, Briefcase, Plus, Trash2, Search, Edit,
  UserCircle, Building2, MapPin, Mail, Save, X, CreditCard, FileSignature, Undo2, RefreshCcw
} from 'lucide-react';
import { getAssetsAssignedTo } from '../services/assetService';
import { isRetired } from '../utils/assetStatus';
import { can } from '../utils/permissions';
import { useConfirm } from '../components/ConfirmDialog';
import TermIssueModal from '../components/terms/TermIssueModal';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import ManagerSkeleton from '../components/dashboard/ManagerSkeleton';
import LocationSelect from '../components/LocationSelect';

const EmployeeManager = () => {
  const { currentUser } = useAuth();
  const confirm = useConfirm();
  const tenantId = currentUser?.tenantId;
  const canWrite = can(currentUser, 'employees:write');
  const canIssueTerms = can(currentUser, 'terms:issue');
  const [saving, setSaving] = useState(false);
  // { kind, assets, holder } — termo do colaborador com os ativos que estao no nome dele
  const [termModal, setTermModal] = useState(null);
  const [loadingTermFor, setLoadingTermFor] = useState(null);

  const openEmployeeTerm = async (emp, kind) => {
    setLoadingTermFor(`${emp.id}-${kind}`);
    try {
      const assets = (await getAssetsAssignedTo(tenantId, emp.name)).filter((a) => !isRetired(a.status) && !a.transit);
      if (kind === 'devolucao' && assets.length === 0) {
        toast.info(`Nenhum ativo está sob responsabilidade de ${emp.name}.`);
        return;
      }
      setTermModal({
        kind,
        assets,
        holder: { name: emp.name || '', cpf: emp.cpf || '', role: emp.role || '', sector: emp.sector || '', branch: emp.branch || '', employeeId: emp.id },
      });
    } catch (error) {
      console.error(error);
      toast.error('Não foi possível carregar os ativos do colaborador.');
    } finally {
      setLoadingTermFor(null);
    }
  };

  // Armazena as listas puxadas do banco de dados
  const [employees, setEmployees] = useState([]);
  const [sectors, setSectors] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Controla o que o usuário está interagindo no momento (abas ativas, buscas, janelas suspensas)
  const [activeTab, setActiveTab] = useState('employees'); 
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null); // Identifica se a janela foi aberta para salvar um novo item (null) ou consertar um já existente (ID)
  const [searchTerm, setSearchTerm] = useState('');

  // Molde padrão para dar reset no formulário sem precisar limpar campo por campo
  const initialForm = {
    name: '', role: '', email: '', login: '', cpf: '', branch: '', sectorId: '',
    sectorName: '', manager: '', description: ''
  };
  const [formData, setFormData] = useState(initialForm);

  // Puxa colaboradores e departamentos simultaneamente para tornar a tela mais rápida
  const loadData = async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
        const [empRes, secRes] = await Promise.allSettled([
          getEmployees(tenantId), 
          getSectors(tenantId)
        ]);
        if (empRes.status === 'fulfilled') {
          setEmployees(empRes.value || []);
        } else {
          console.error("Erro ao carregar colaboradores:", empRes.reason);
        }
        if (secRes.status === 'fulfilled') {
          setSectors(secRes.value || []);
        } else {
          console.error("Erro ao carregar setores:", secRes.reason);
        }
    } catch (error) {
        console.error("Erro ao carregar:", error);
    } finally {
        setLoading(false);
    }
  };

  useEffect(() => {
    if (tenantId) {
      loadData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  // Funções que preparam ou limpam a janela flutuante antes que ela surja na tela
  
  const openCreateModal = () => {
      setEditingId(null);
      setFormData(initialForm);
      setIsModalOpen(true);
  };

  const openEditModal = (item) => {
      setEditingId(item.id);
      
      if (activeTab === 'employees') {
          // Extrai e transporta os dados atuais do colaborador para dentro dos campos do formulário
          setFormData({
              ...initialForm,
              name: item.name,
              role: item.role,
              email: item.email,
              login: item.login || '',
              cpf: item.cpf,
              branch: item.branch,
              sectorId: item.sector // Transporta o setor em que o cara trabalha; como às vezes vem apenas o nome, acopla no ID mesmo assim
          });
      } else {
          // Transfere o resumo atual e responsável do setor em questão para os campos abertos
          setFormData({
              ...initialForm,
              sectorName: item.name,
              manager: item.manager,
              description: item.description
          });
      }
      setIsModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
        if (activeTab === 'employees') {
            const payload = {
                name: formData.name.trim(),
                role: formData.role.trim(),
                email: formData.email.trim(),
                login: (formData.login || '').trim(),
                cpf: formData.cpf.trim(),
                branch: formData.branch,
                sector: formData.sectorId || 'Geral',
                tenantId: tenantId,
            };

            if (editingId) {
                const oldName = employees.find(emp => emp.id === editingId)?.name || null;
                const res = await updateEmployee(editingId, payload, oldName, tenantId);
                if (res?.updatedAssetsCount > 0) {
                  toast.success(`Colaborador atualizado! ${res.updatedAssetsCount} ativo(s) vinculado(s) foram atualizados em cascata.`);
                } else {
                  toast.success('Colaborador atualizado com sucesso!');
                }
            } else {
                await addEmployee(payload);
                toast.success('Colaborador cadastrado com sucesso!');
            }
        } else {
            const payload = {
                name: formData.sectorName.trim(),
                manager: formData.manager.trim(),
                description: formData.description.trim(),
                tenantId: tenantId,
            };

            if (editingId) {
                const oldName = sectors.find(sec => sec.id === editingId)?.name || null;
                const res = await updateSector(editingId, payload, oldName, tenantId);
                const total = (res?.updatedEmployeesCount || 0) + (res?.updatedAssetsCount || 0);
                if (total > 0) {
                  toast.success(`Setor atualizado! Vínculos em cascata atualizados (${res.updatedEmployeesCount} colaborador(es), ${res.updatedAssetsCount} ativo(s)).`);
                } else {
                  toast.success('Setor atualizado com sucesso!');
                }
            } else {
                await addSector(payload);
                toast.success('Setor cadastrado com sucesso!');
            }
        }
        setIsModalOpen(false);
        loadData();
    } catch (err) {
        console.error(err);
        toast.error("Erro ao salvar.");
    } finally {
        setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (activeTab === 'employees') {
      const emp = employees.find(e => e.id === id);
      const assignedAssets = (emp?.name && tenantId) ? await getAssetsAssignedTo(tenantId, emp.name) : [];
      const msg = assignedAssets.length > 0
        ? `Este colaborador possui ${assignedAssets.length} ativo(s) vinculado(s) sob sua responsabilidade. A exclusão não apagará os ativos, mas removerá o vínculo. Deseja excluir "${emp?.name || ''}"?`
        : `Tem certeza que deseja excluir o colaborador "${emp?.name || ''}"?`;

      const ok = await confirm({
        title: 'Excluir Colaborador',
        message: msg,
        danger: true,
        confirmLabel: 'Excluir Colaborador'
      });
      if (!ok) return;

      try {
        await deleteEmployee(id);
        toast.success('Colaborador excluído com sucesso.');
        loadData();
      } catch (err) {
        console.error(err);
        toast.error('Erro ao excluir colaborador.');
      }
    } else {
      const sec = sectors.find(s => s.id === id);
      const ok = await confirm({
        title: 'Excluir Setor',
        message: `Tem certeza que deseja excluir o setor "${sec?.name || ''}"?`,
        danger: true,
        confirmLabel: 'Excluir Setor'
      });
      if (!ok) return;

      try {
        await deleteSector(id);
        toast.success('Setor excluído com sucesso.');
        loadData();
      } catch (err) {
        console.error(err);
        toast.error('Erro ao excluir setor.');
      }
    }
  };

  // O filtro ocorre localmente varrendo o nome sem bater no servidor novamente
  const filteredList = activeTab === 'employees' 
    ? employees.filter(e => (e.name || '').toLowerCase().includes(searchTerm.toLowerCase()) || (e.role || '').toLowerCase().includes(searchTerm.toLowerCase()))
    : sectors.filter(s => (s.name || '').toLowerCase().includes(searchTerm.toLowerCase()));

  if (loading) return <ManagerSkeleton />;

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto animate-fade-in pb-24">
      
      {/* Titulação da página com botão de nova ação que muda o contexto conforme a aba atual */}
      <div className="flex flex-col md:flex-row justify-between items-end gap-6 mb-8">
        <div>
            <h1 className="text-2xl font-black text-gray-900 dark:text-white flex items-center gap-2">
                <Users className="text-brand" size={28}/> Gestão de Pessoas & Áreas
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Mantenha a estrutura organizacional atualizada</p>
        </div>
        {canWrite && (
          <button onClick={openCreateModal} className="bg-black text-white dark:bg-white dark:text-slate-900 px-5 py-2.5 rounded-xl font-bold hover:bg-gray-800 dark:hover:bg-gray-100 flex items-center gap-2 shadow-lg transition-all active:scale-95">
              <Plus size={20}/> {activeTab === 'employees' ? 'Novo Colaborador' : 'Novo Setor'}
          </button>
        )}
      </div>

      {/* Chaves principais que alternam a visão entre pessoas ou a visão por hierarquia */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-full md:w-fit mb-6">
          <button 
            onClick={() => setActiveTab('employees')} 
            className={`px-6 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${activeTab === 'employees' ? 'bg-white text-black shadow-sm dark:bg-slate-700 dark:text-white' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
          >
              <UserCircle size={18}/> Colaboradores
          </button>
          <button 
            onClick={() => setActiveTab('sectors')} 
            className={`px-6 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${activeTab === 'sectors' ? 'bg-white text-black shadow-sm dark:bg-slate-700 dark:text-white' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
          >
              <Briefcase size={18}/> Setores / Deptos
          </button>
      </div>

      {/* Campo que reage tecla por tecla sem ter que fazer a tabela piscar ou ir na nuvem */}
      <div className="relative mb-6">
          <Search className="absolute left-3 top-3 text-gray-400 dark:text-gray-500" size={20}/>
          <input 
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder={activeTab === 'employees' ? "Buscar por nome, cargo, email..." : "Buscar setor..."}
            className="w-full pl-10 pr-4 py-3 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-xl outline-none focus:border-black focus:ring-1 focus:ring-black transition-all"
          />
      </div>

      {/* Área flexível que injeta os cartões da aba selecionada */}
      {loading ? (
          <div className="text-center py-20 text-gray-400 dark:text-gray-500 animate-pulse">Carregando dados...</div>
      ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              
              {/* Mapeia a lista de funcionários em pequenos cartões estilo crachá de contato */}
              {activeTab === 'employees' && filteredList.map(emp => (
                  <div key={emp.id} className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-gray-200 dark:border-slate-600 shadow-sm hover:shadow-md transition-all group relative flex flex-col">
                      <div className="flex justify-between items-start mb-3">
                          <div className="flex items-center gap-3">
                              <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 font-black text-lg border border-gray-200 dark:border-slate-600 uppercase">
                                  {(emp.name || '?').substring(0,2)}
                              </div>
                              <div>
                                  <h3 className="font-bold text-gray-900 dark:text-white leading-tight">{emp.name}</h3>
                                  <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">{emp.role || "Cargo não inf."}</p>
                              </div>
                          </div>
                          {canWrite && (
                              <div className="flex gap-1">
                                  <button onClick={() => openEditModal(emp)} className="text-gray-400 dark:text-gray-500 hover:text-blue-600 p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-slate-750 transition-colors"><Edit size={16}/></button>
                                  <button onClick={() => handleDelete(emp.id)} className="text-gray-400 dark:text-gray-500 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-slate-750 transition-colors"><Trash2 size={16}/></button>
                              </div>
                          )}
                      </div>
                      
                      <div className="mt-auto space-y-2 pt-3 border-t border-gray-50">
                          <div className="flex items-center gap-2 text-xs text-gray-600">
                              <Briefcase size={14} className="text-brand"/> 
                              <span className="font-bold bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-200 px-2 py-0.5 rounded">{emp.sector}</span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                              <MapPin size={14} className="text-gray-400 dark:text-gray-500"/> {emp.branch}
                          </div>
                          {emp.email && (
                              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 truncate" title={emp.email}>
                                  <Mail size={14} className="text-gray-400 dark:text-gray-500"/> {emp.email}
                              </div>
                          )}
                          {emp.cpf && (
                              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 font-mono" title={emp.cpf}>
                                  <CreditCard size={14} className="text-gray-400 dark:text-gray-500"/> {emp.cpf}
                              </div>
                          )}
                      </div>
                      {canIssueTerms && emp.name && (
                          <div className="grid grid-cols-2 gap-2 mt-3">
                              <button
                                  onClick={() => openEmployeeTerm(emp, 'responsabilidade')}
                                  disabled={Boolean(loadingTermFor)}
                                  title="Termo de responsabilidade com os ativos deste colaborador"
                                  className="flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 dark:border-slate-600 py-2 text-[10px] font-black uppercase tracking-wider text-gray-600 dark:text-gray-300 hover:text-brand hover:border-brand/40 disabled:opacity-50"
                              >
                                  <FileSignature size={13}/> {loadingTermFor === `${emp.id}-responsabilidade` ? 'Carregando…' : 'Termo'}
                              </button>
                              <button
                                  onClick={() => openEmployeeTerm(emp, 'devolucao')}
                                  disabled={Boolean(loadingTermFor)}
                                  title="Devolução dos ativos deste colaborador (ex.: desligamento)"
                                  className="flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 dark:border-slate-600 py-2 text-[10px] font-black uppercase tracking-wider text-gray-600 dark:text-gray-300 hover:text-brand hover:border-brand/40 disabled:opacity-50"
                              >
                                  <Undo2 size={13}/> {loadingTermFor === `${emp.id}-devolucao` ? 'Carregando…' : 'Devolução'}
                              </button>
                          </div>
                      )}
                  </div>
              ))}

              {/* Lista focada nas informações departamentais criando pequenos resumos do setor */}
              {activeTab === 'sectors' && filteredList.map(sec => (
                  <div key={sec.id} className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-gray-200 dark:border-slate-600 shadow-sm hover:border-black transition-all group relative">
                      <div className="flex justify-between items-start mb-4">
                          <div className="p-3 bg-gray-50 dark:bg-slate-900 rounded-xl">
                              <Building2 size={24} className="text-gray-700 dark:text-gray-200"/>
                          </div>
                          {canWrite && (
                              <div className="flex gap-1">
                                  <button onClick={() => openEditModal(sec)} className="text-gray-400 dark:text-gray-500 hover:text-blue-600 p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-slate-750 transition-colors"><Edit size={16}/></button>
                                  <button onClick={() => handleDelete(sec.id)} className="text-gray-400 dark:text-gray-500 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-slate-750 transition-colors"><Trash2 size={16}/></button>
                              </div>
                          )}
                      </div>
                      
                      <h3 className="text-xl font-black text-gray-900 dark:text-white mb-1">{sec.name}</h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 line-clamp-2 h-10">{sec.description || "Sem descrição."}</p>
                      
                      <div className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-slate-900 rounded-lg border border-gray-100 dark:border-slate-700">
                          <UserCircle size={16} className="text-gray-400 dark:text-gray-500"/>
                          <div className="text-xs">
                              <span className="block font-bold text-gray-400 dark:text-gray-500 uppercase text-[9px]">Gestor / Responsável</span>
                              <span className={`font-bold ${sec.manager ? 'text-gray-800 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500 italic'}`}>{sec.manager || "Não atribuído"}</span>
                          </div>
                      </div>
                  </div>
              ))}

              {filteredList.length === 0 && (
                  <div className="col-span-full py-12 text-center text-gray-400 dark:text-gray-500 border-2 border-dashed border-gray-200 dark:border-slate-600 rounded-2xl">
                      Nenhum registro encontrado.
                  </div>
              )}
          </div>
      )}

      {/* Janela polivalente: muda os campos baseada em qual aba o usuário quis abrir o "Novo" ou "Editar" */}
      {termModal && (
        <TermIssueModal
          kind={termModal.kind}
          initialAssets={termModal.assets}
          initialHolder={termModal.holder}
          onClose={() => setTermModal(null)}
        />
      )}

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md p-6 border border-gray-200 dark:border-slate-700 animate-in zoom-in-95">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-black text-gray-900 dark:text-white flex items-center gap-2">
                    {editingId ? <Edit size={20}/> : <Plus size={20}/>} 
                    {editingId ? 'Editar' : 'Novo'} {activeTab === 'employees' ? 'Colaborador' : 'Setor'}
                </h2>
                <button disabled={saving} onClick={() => setIsModalOpen(false)} className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"><X size={20}/></button>
            </div>
            
            <form onSubmit={handleSave} className="space-y-4">
              
              {activeTab === 'employees' ? (
                  // Campos moldados individualmente focado apenas para montar a ficha do peao
                  <>
                    <div>
                        <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">Nome Completo</label>
                        <input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full p-3 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-white rounded-xl font-bold outline-none focus:border-black dark:focus:border-brand" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">Cargo</label>
                            <input value={formData.role} onChange={e => setFormData({...formData, role: e.target.value})} className="w-full p-3 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-white rounded-xl outline-none focus:border-black dark:focus:border-brand" />
                        </div>
                        <div>
                            <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">Setor</label>
                            <select value={formData.sectorId} onChange={e => setFormData({...formData, sectorId: e.target.value})} className="w-full p-3 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-white rounded-xl outline-none focus:border-black dark:focus:border-brand cursor-pointer">
                                <option value="">Selecione...</option>
                                <option value="Geral">Geral</option>
                                {/* Extrai os setores ja consolidados do banco e cria uma listinha rapida */}
                                {sectors.filter(s => s.name !== 'Geral').map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                                <option value="Outro">Outro / Externo</option>
                            </select>
                        </div>
                    </div>
                    <div>
                        <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">Email</label>
                        <input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="w-full p-3 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-white rounded-xl outline-none focus:border-black dark:focus:border-brand" />
                    </div>
                    <div>
                        <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">Login de rede (Windows)</label>
                        <input value={formData.login} onChange={e => setFormData({...formData, login: e.target.value})} placeholder="Ex.: joao.silva" className="w-full p-3 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-white rounded-xl outline-none focus:border-black dark:focus:border-brand font-mono" />
                        <p className="mt-1 text-[10px] text-gray-400">O Agente ITAM usa para saber quem está usando cada máquina. Sem ele, tenta pelo e-mail e pelo nome.</p>
                    </div>
                    <div>
                        <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">CPF</label>
                        <input value={formData.cpf} onChange={e => setFormData({...formData, cpf: e.target.value})} placeholder="000.000.000-00" className="w-full p-3 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-white rounded-xl outline-none focus:border-black dark:focus:border-brand font-mono" />
                    </div>
                    <div>
                        <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">Unidade / Base</label>
                        <LocationSelect
                            value={formData.branch}
                            onChange={e => setFormData({...formData, branch: e.target.value})}
                            name="branch"
                            showManageLink
                            className="w-full p-3 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-white rounded-xl outline-none focus:border-black dark:focus:border-brand"
                        />
                    </div>
                  </>
              ) : (
                  // Config para criar areas independentemente das pessoas
                  <>
                    <div>
                        <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">Nome do Setor</label>
                        <input required value={formData.sectorName} onChange={e => setFormData({...formData, sectorName: e.target.value})} className="w-full p-3 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-white rounded-xl font-bold outline-none focus:border-black dark:focus:border-brand" placeholder="Ex: Financeiro, TI..." />
                    </div>
                    <div>
                        <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">Gestor Responsável</label>
                        <select value={formData.manager} onChange={e => setFormData({...formData, manager: e.target.value})} className="w-full p-3 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-white rounded-xl outline-none focus:border-black dark:focus:border-brand cursor-pointer">
                            <option value="">Selecione um colaborador...</option>
                            {/* Permite usar a lista de funcionarios para atrelar a lideranca de forma amarrada */}
                            {employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">Descrição</label>
                        <textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="w-full p-3 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-white rounded-xl outline-none focus:border-black dark:focus:border-brand" rows="3" placeholder="Função deste departamento..."></textarea>
                    </div>
                  </>
              )}

              <div className="flex gap-3 pt-4 border-t border-gray-100 dark:border-slate-700 mt-2">
                <button type="button" disabled={saving} onClick={() => setIsModalOpen(false)} className="flex-1 py-3 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-xl font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50">Cancelar</button>
                <button type="submit" disabled={saving} className="flex-1 py-3 bg-black dark:bg-brand text-white rounded-xl font-bold hover:bg-gray-800 dark:hover:opacity-90 shadow-lg flex justify-center items-center gap-2 transition-all disabled:opacity-50">
                    {saving ? <RefreshCcw className="animate-spin" size={18}/> : <Save size={18}/>}
                    {saving ? 'Salvando…' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmployeeManager;