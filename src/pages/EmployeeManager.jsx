// src/pages/EmployeeManager.jsx
import React, { useState, useEffect } from 'react';
import { 
  getEmployees, addEmployee, updateEmployee, deleteEmployee, 
  getSectors, addSector, updateSector, deleteSector 
} from '../services/employeeService';
import { 
  Users, Briefcase, Plus, Trash2, Search, Edit,
  UserCircle, Building2, MapPin, Mail, Save, X, CreditCard, FileSignature, Undo2, RefreshCcw, Laptop,
  KeyRound, Copy, Check, Eye, EyeOff, ExternalLink, ShieldCheck, RefreshCw, Lock
} from 'lucide-react';
import { getAssets, getAssetsAssignedTo } from '../services/assetService';
import { isRetired } from '../utils/assetStatus';
import { isMatchingHolder } from '../utils/employeeMatching';
import { can } from '../utils/permissions';
import { useConfirm } from '../components/ConfirmDialog';
import TermIssueModal from '../components/terms/TermIssueModal';
import EmployeeCustodyModal from '../components/employees/EmployeeCustodyModal';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import ManagerSkeleton from '../components/dashboard/ManagerSkeleton';
import LocationSelect from '../components/LocationSelect';
import { microservicesApi, resolvePortalUrl } from '../services/microservicesClient';
import { generateRandomSecurePassword } from '../utils/passwords';

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
  const [custodyModalEmp, setCustodyModalEmp] = useState(null);
  const [tenantAssets, setTenantAssets] = useState([]);

  const openEmployeeTerm = async (emp, kind) => {
    setLoadingTermFor(`${emp.id}-${kind}`);
    try {
      const assets = custodyMap[emp.name] || (await getAssetsAssignedTo(tenantId, emp.name)).filter((a) => !isRetired(a.status) && !a.transit);
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

  const [portalUsers, setPortalUsers] = useState([]);
  const [loadingPortalUsers, setLoadingPortalUsers] = useState(false);
  const [portalForm, setPortalForm] = useState(() => ({
    name: '',
    email: '',
    department: '',
    jobTitle: '',
    password: generateRandomSecurePassword(14),
  }));
  const [showPortalPassword, setShowPortalPassword] = useState(false);
  const [copiedKey, setCopiedKey] = useState(null);
  const [createdCredentialsModal, setCreatedCredentialsModal] = useState(null);

  const portalUrl = resolvePortalUrl();

  const loadPortalUsers = React.useCallback(async () => {
    setLoadingPortalUsers(true);
    try {
      const res = await microservicesApi.listUsers();
      if (res?.items) {
        setPortalUsers(res.items);
      }
    } catch (err) {
      console.warn('Não foi possível sincronizar usuários com o Gateway:', err);
    } finally {
      setLoadingPortalUsers(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'portal') {
      loadPortalUsers();
    }
  }, [activeTab, loadPortalUsers]);

  const handleRegeneratePassword = () => {
    setPortalForm((prev) => ({
      ...prev,
      password: generateRandomSecurePassword(14),
    }));
    toast.info('Nova senha aleatória gerada.');
  };

  const handleCopyPassword = () => {
    if (!portalForm.password) return;
    navigator.clipboard.writeText(portalForm.password);
    setCopiedKey('formPassword');
    setTimeout(() => setCopiedKey(null), 2500);
    toast.success('Senha copiada para a área de transferência.');
  };

  const handleCreatePortalCollaborator = async (e) => {
    e.preventDefault();
    const cleanName = portalForm.name.trim();
    const cleanEmail = portalForm.email.trim().toLowerCase();
    const cleanPassword = portalForm.password.trim();

    if (!cleanName || !cleanEmail || !cleanPassword) {
      toast.error('Preencha nome completo, e-mail corporativo e a senha.');
      return;
    }

    setSaving(true);
    try {
      const department = portalForm.department.trim() || 'Geral';
      const jobTitle = portalForm.jobTitle.trim() || 'Colaborador';

      await microservicesApi.createUser({
        name: cleanName,
        email: cleanEmail,
        password: cleanPassword,
        role: 'collaborator',
        department,
        jobTitle,
        active: true,
      });

      const existing = employees.find(
        (emp) => (emp.email || '').toLowerCase() === cleanEmail
      );
      if (!existing && tenantId) {
        try {
          await addEmployee({
            name: cleanName,
            email: cleanEmail,
            role: jobTitle,
            sector: department,
            branch: 'Matriz Belém',
            tenantId,
          });
        } catch {
          // Ignora falha local para não abortar provisionamento de credenciais
        }
        loadData();
      }

      setCreatedCredentialsModal({
        name: cleanName,
        email: cleanEmail,
        password: cleanPassword,
        department,
        jobTitle,
        portalUrl,
      });

      toast.success('Colaborador ativado com sucesso para o Portal!');
      setPortalForm({
        name: '',
        email: '',
        department: '',
        jobTitle: '',
        password: generateRandomSecurePassword(14),
      });
      loadPortalUsers();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Erro ao registrar colaborador no portal.');
    } finally {
      setSaving(false);
    }
  };

  const handleCopyFullCredentials = (creds) => {
    const text = `Credenciais de Acesso — Portal do Colaborador (Nexus ITAM / Shineray)\n\nColaborador: ${creds.name}\nPortal: ${creds.portalUrl}\nE-mail: ${creds.email}\nSenha Provisória: ${creds.password}\n\nInstruções: Acesse o link acima para visualizar seus equipamentos em posse, assinar seus Termos de Responsabilidade CLT e abrir chamados de TI.`;
    navigator.clipboard.writeText(text);
    toast.success('Credenciais completas copiadas!');
  };

  // Puxa colaboradores, departamentos e inventário simultaneamente para sincronizar a custódia
  const loadData = async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
        const [empRes, secRes, assetRes] = await Promise.allSettled([
          getEmployees(tenantId), 
          getSectors(tenantId),
          getAssets(tenantId)
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
        if (assetRes.status === 'fulfilled') {
          setTenantAssets(assetRes.value || []);
        } else {
          console.error("Erro ao carregar ativos para custódia:", assetRes.reason);
        }
    } catch (error) {
        console.error("Erro ao carregar:", error);
    } finally {
        setLoading(false);
    }
  };

  // Mapa reativo de ativos em custódia indexados pelo colaborador com suporte a nomes compostos
  const custodyMap = React.useMemo(() => {
    const map = {};
    (employees || []).forEach(emp => {
      map[emp.name] = (tenantAssets || []).filter(a => {
        if (isRetired(a.status) || a.transit) return false;
        const holder = (a.assignedTo || '').trim();
        if (!holder) return false;
        return isMatchingHolder(emp.name, holder) || (emp.email && a.assignedEmail && emp.email.toLowerCase() === a.assignedEmail.toLowerCase());
      });
    });
    return map;
  }, [employees, tenantAssets]);

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
        {canWrite && activeTab !== 'portal' && (
          <button onClick={openCreateModal} className="bg-black text-white dark:bg-white dark:text-slate-900 px-5 py-2.5 rounded-xl font-bold hover:bg-gray-800 dark:hover:bg-gray-100 flex items-center gap-2 shadow-lg transition-all active:scale-95">
              <Plus size={20}/> {activeTab === 'employees' ? 'Novo Colaborador' : 'Novo Setor'}
          </button>
        )}
      </div>

      {/* Chaves principais que alternam a visão entre pessoas ou a visão por hierarquia */}
      <div className="flex flex-wrap gap-1 bg-gray-100 dark:bg-slate-800 p-1 rounded-xl w-full md:w-fit mb-6 border border-gray-200/60 dark:border-slate-700/60">
          <button 
            onClick={() => setActiveTab('employees')} 
            className={`px-5 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${activeTab === 'employees' ? 'bg-white text-black shadow-sm dark:bg-slate-700 dark:text-white' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
          >
              <UserCircle size={18}/> Colaboradores
          </button>
          <button 
            onClick={() => setActiveTab('sectors')} 
            className={`px-5 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${activeTab === 'sectors' ? 'bg-white text-black shadow-sm dark:bg-slate-700 dark:text-white' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
          >
              <Briefcase size={18}/> Setores / Deptos
          </button>
          <button 
            onClick={() => setActiveTab('portal')} 
            className={`px-5 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${activeTab === 'portal' ? 'bg-white text-black shadow-sm dark:bg-slate-700 dark:text-white' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
          >
              <KeyRound size={18} className="text-brand"/> Portal do Colaborador (Acessos)
          </button>
      </div>

      {/* Campo que reage tecla por tecla sem ter que fazer a tabela piscar ou ir na nuvem */}
      <div className="relative mb-6">
          <Search className="absolute left-3 top-3 text-gray-400 dark:text-gray-500" size={20}/>
          <input 
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder={activeTab === 'employees' ? "Buscar por nome, cargo, email..." : activeTab === 'sectors' ? "Buscar setor..." : "Buscar colaboradores cadastrados no portal..."}
            className="w-full pl-10 pr-4 py-3 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-xl outline-none focus:border-black focus:ring-1 focus:ring-black transition-all text-sm"
          />
      </div>

      {/* Área flexível que injeta os cartões da aba selecionada */}
      {activeTab === 'portal' ? (
        <div className="space-y-6">
          {/* Card de Cadastro com Gerador de Senha */}
          <div className="bg-white dark:bg-slate-800 p-6 md:p-8 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pb-6 border-b border-slate-100 dark:border-slate-700/80">
              <div>
                <h2 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                  <KeyRound className="text-brand" size={22} />
                  Cadastro de Acesso ao Portal do Colaborador
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Cadastre colaboradores com geração automática de senha aleatória segura para autoatendimento e custódia CLT.
                </p>
              </div>
              <a
                href={portalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-xs font-bold text-brand bg-brand/10 hover:bg-brand/20 px-3.5 py-2 rounded-xl transition-all shrink-0"
              >
                <span>Acessar Portal (Vue 3)</span>
                <ExternalLink size={14} />
              </a>
            </div>

            <form onSubmit={handleCreatePortalCollaborator} className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 uppercase text-[10px] tracking-wider">
                    Nome Completo *
                  </label>
                  <input
                    type="text"
                    required
                    value={portalForm.name}
                    onChange={(e) => setPortalForm((p) => ({ ...p, name: e.target.value }))}
                    placeholder="Ex: Roberto Souza"
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-brand"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 uppercase text-[10px] tracking-wider">
                    E-mail Corporativo *
                  </label>
                  <input
                    type="email"
                    required
                    value={portalForm.email}
                    onChange={(e) => setPortalForm((p) => ({ ...p, email: e.target.value }))}
                    placeholder="colaborador@shineraybysabel.com.br"
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-brand"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 uppercase text-[10px] tracking-wider">
                    Setor / Departamento
                  </label>
                  <input
                    type="text"
                    value={portalForm.department}
                    onChange={(e) => setPortalForm((p) => ({ ...p, department: e.target.value }))}
                    placeholder="Ex: Vendas Concessionária"
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-brand"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 uppercase text-[10px] tracking-wider">
                    Cargo / Função
                  </label>
                  <input
                    type="text"
                    value={portalForm.jobTitle}
                    onChange={(e) => setPortalForm((p) => ({ ...p, jobTitle: e.target.value }))}
                    placeholder="Ex: Consultor Comercial"
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-brand"
                  />
                </div>
              </div>

              {/* Gerador de Senha Aleatória */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700/80 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Lock size={15} className="text-brand" />
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      Geração de Senha Aleatória Segura
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold border border-emerald-500/20">
                      Alta Entropia (14 caracteres)
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleRegeneratePassword}
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 hover:text-brand px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 transition-all hover:shadow-xs"
                      title="Gerar nova sequência aleatória"
                    >
                      <RefreshCw size={13} />
                      <span>Gerar Outra Senha</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleCopyPassword}
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 hover:text-brand px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 transition-all hover:shadow-xs"
                      title="Copiar senha atual"
                    >
                      {copiedKey === 'formPassword' ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                      <span>{copiedKey === 'formPassword' ? 'Copiada!' : 'Copiar Senha'}</span>
                    </button>
                  </div>
                </div>

                <div className="relative">
                  <input
                    type={showPortalPassword ? 'text' : 'password'}
                    required
                    value={portalForm.password}
                    onChange={(e) => setPortalForm((p) => ({ ...p, password: e.target.value }))}
                    className="w-full pr-12 pl-4 py-2.5 font-mono text-sm tracking-wider bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-brand"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPortalPassword(!showPortalPassword)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                    title={showPortalPassword ? 'Ocultar senha' : 'Exibir senha'}
                  >
                    {showPortalPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="bg-brand hover:bg-brand-dark text-white font-bold py-2.5 px-6 rounded-xl transition-all shadow-md flex items-center gap-2 text-xs sm:text-sm disabled:opacity-60"
                >
                  <KeyRound size={16} />
                  <span>{saving ? 'Registrando Acesso...' : 'Cadastrar e Liberar Acesso ao Portal'}</span>
                </button>
              </div>
            </form>
          </div>

          {/* Banner LGPD de Privacidade e Segurança */}
          <div className="p-4 rounded-xl bg-sky-50/70 dark:bg-sky-950/20 border border-sky-200/80 dark:border-sky-800/60 flex items-start gap-3">
            <ShieldCheck size={20} className="text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
            <div className="text-xs text-sky-900 dark:text-sky-200 leading-relaxed">
              <strong className="font-bold">Aderência às Normas LGPD (Lei 13.709/2018 - Art. 6º e 46):</strong>
              <p className="mt-0.5 text-sky-800 dark:text-sky-300">
                O acesso ao Portal do Colaborador implementa o princípio da estrita necessidade e minimização de dados. Os colaboradores autenticam-se com credenciais seguras hash Scrypt exclusivamente para assinar seus próprios Termos de Responsabilidade CLT (com selo HMAC-SHA256) e abrir chamados de TI. Nenhum dado sensível ou telemetria invasiva de tela/comportamento é coletado.
              </p>
            </div>
          </div>

          {/* Lista de Colaboradores com Acesso Ativo ao Portal */}
          <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-black text-slate-900 dark:text-white text-base">
                  Usuários Cadastrados com Acesso ao Portal
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {portalUsers.length} conta(s) ativas no Gateway para a Shineray
                </p>
              </div>
              <button
                type="button"
                onClick={loadPortalUsers}
                className="text-xs font-bold text-slate-500 hover:text-brand flex items-center gap-1.5 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                title="Recarregar lista"
              >
                <RefreshCcw size={14} className={loadingPortalUsers ? 'animate-spin' : ''} />
                <span>Atualizar</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {portalUsers
                .filter((u) => {
                  if (!searchTerm) return true;
                  const term = searchTerm.toLowerCase();
                  return (
                    (u.name || '').toLowerCase().includes(term) ||
                    (u.email || '').toLowerCase().includes(term) ||
                    (u.department || '').toLowerCase().includes(term)
                  );
                })
                .map((u) => (
                  <div
                    key={u.id}
                    className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40 flex flex-col justify-between space-y-3"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="font-bold text-sm text-slate-900 dark:text-white truncate">
                          {u.name}
                        </span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                          {u.role === 'collaborator' ? 'Colaborador' : u.role}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate" title={u.email}>
                        {u.email}
                      </p>
                    </div>

                    <div className="pt-2 border-t border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between text-xs">
                      <span className="text-slate-500 dark:text-slate-400 text-[11px] truncate">
                        {u.department || 'Geral'} • {u.job_title || 'Colaborador'}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(u.email);
                          toast.success(`E-mail ${u.email} copiado!`);
                        }}
                        className="text-[11px] font-bold text-brand hover:underline shrink-0"
                      >
                        Copiar E-mail
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      ) : loading ? (
          <div className="text-center py-20 text-gray-400 dark:text-gray-500 animate-pulse">Carregando dados...</div>
      ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              
              {/* Mapeia a lista de funcionários em pequenos cartões estilo crachá de contato */}
              {activeTab === 'employees' && filteredList.map(emp => {
                const empAssets = custodyMap[emp.name] || [];
                return (
                  <div key={emp.id} className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-gray-200 dark:border-slate-600 shadow-sm hover:shadow-md transition-all group relative flex flex-col">
                      <div className="flex justify-between items-start mb-3">
                          <div className="flex items-center gap-3">
                              <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-slate-700 flex items-center justify-center text-gray-600 dark:text-gray-300 font-black text-lg border border-gray-200 dark:border-slate-600 uppercase">
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

                      {/* Resumo de Ativos em Custódia */}
                      <div className="my-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-700/60 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Laptop size={14} className={empAssets.length > 0 ? "text-brand" : "text-slate-400"} />
                          <span className={`font-bold truncate text-[11px] ${empAssets.length > 0 ? "text-slate-800 dark:text-slate-200" : "text-slate-400"}`}>
                            {empAssets.length > 0 ? `${empAssets.length} ${empAssets.length === 1 ? 'ativo' : 'ativos'} em posse` : 'Sem ativos vinculados'}
                          </span>
                        </div>
                        <button
                          onClick={() => setCustodyModalEmp(emp)}
                          className="text-[10px] font-bold text-brand hover:underline px-2 py-0.5 rounded hover:bg-brand/10 transition-colors shrink-0"
                          title="Abrir prontuário de equipamentos e custódia deste colaborador"
                        >
                          Ver Custódia
                        </button>
                      </div>
                      
                      <div className="mt-auto space-y-2 pt-3 border-t border-gray-50 dark:border-slate-700">
                          <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
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
                );
              })}

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

      {custodyModalEmp && (
        <EmployeeCustodyModal
          employee={custodyModalEmp}
          assets={custodyMap[custodyModalEmp.name] || []}
          onClose={() => setCustodyModalEmp(null)}
          onOpenTerm={(kind) => {
            const target = custodyModalEmp;
            setCustodyModalEmp(null);
            openEmployeeTerm(target, kind);
          }}
          canIssueTerms={canIssueTerms}
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

      {/* Modal de Confirmação & Cópia de Credenciais do Portal */}
      {createdCredentialsModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 w-full max-w-md rounded-2xl shadow-2xl p-6 relative space-y-4">
            <button
              onClick={() => setCreatedCredentialsModal(null)}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg"
            >
              <X size={18} />
            </button>

            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <Check size={20} />
              </div>
              <div>
                <h3 className="font-black text-slate-900 dark:text-white text-base">
                  Acesso Criado com Sucesso!
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Transmita as credenciais abaixo ao colaborador com segurança.
                </p>
              </div>
            </div>

            <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2 text-xs font-mono">
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Colaborador</span>
                <span className="text-slate-900 dark:text-white font-bold">{createdCredentialsModal.name}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Link do Portal</span>
                <span className="text-brand break-all">{createdCredentialsModal.portalUrl}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">E-mail</span>
                <span className="text-slate-900 dark:text-white">{createdCredentialsModal.email}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Senha Provisória</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-black text-sm">{createdCredentialsModal.password}</span>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => handleCopyFullCredentials(createdCredentialsModal)}
                className="flex-1 bg-brand hover:bg-brand-dark text-white font-bold py-2.5 px-4 rounded-xl transition-all flex items-center justify-center gap-2 text-xs shadow-sm"
              >
                <Copy size={15} />
                <span>Copiar Credenciais Completas</span>
              </button>
              <button
                type="button"
                onClick={() => setCreatedCredentialsModal(null)}
                className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmployeeManager;