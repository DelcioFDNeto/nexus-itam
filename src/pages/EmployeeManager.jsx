// src/pages/EmployeeManager.jsx
import React, { useState, useEffect, useCallback, useId, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  getEmployees, addEmployee, updateEmployee, deleteEmployee,
  getSectors, addSector, updateSector, deleteSector
} from '../services/employeeService';
import {
  Users, Briefcase, Plus, Trash2, Search, Edit,
  UserCircle, Building2, MapPin, Mail, Save, X, CreditCard, FileSignature, Undo2, RefreshCcw, Laptop,
  KeyRound, AlertCircle
} from 'lucide-react';
import { getAssets, getAssetsAssignedTo } from '../services/assetService';
import { isRetired } from '../utils/assetStatus';
import { isMatchingHolder } from '../utils/employeeMatching';
import { can } from '../utils/permissions';
import { useConfirm } from '../components/ConfirmDialog';
import TermIssueModal from '../components/terms/TermIssueModal';
import EmployeeCustodyModal from '../components/employees/EmployeeCustodyModal';
import CollaboratorAccessWorkspace from '../components/portal/CollaboratorAccessWorkspace';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import ManagerSkeleton from '../components/dashboard/ManagerSkeleton';
import LocationSelect from '../components/LocationSelect';
import { microservicesApi } from '../services/microservicesClient';
import { captureFocusTarget, restoreFocusSafely, trapFocusWithin } from '../utils/focusTrap';
import { isTopmostModal } from '../utils/modalStack';

const TABS = ['employees', 'sectors', 'portal'];

const fieldClass =
  'w-full px-3 py-2.5 min-h-[44px] border border-slate-200 dark:border-zinc-700 bg-white dark:bg-[#111113] text-slate-900 dark:text-[#fafafa] placeholder:text-slate-400 dark:placeholder:text-zinc-500 rounded-xl transition-colors hover:border-slate-300 dark:hover:border-zinc-600 active:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:border-brand disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-zinc-900 aria-[invalid=true]:border-rose-500 aria-[invalid=true]:focus-visible:ring-rose-500';

const EmployeeManager = () => {
  const { currentUser } = useAuth();
  const confirm = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  const tenantId = currentUser?.tenantId;
  const canWrite = can(currentUser, 'employees:write');
  const canIssueTerms = can(currentUser, 'terms:issue');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  // { kind, assets, holder } — termo do colaborador com os ativos que estao no nome dele
  const [termModal, setTermModal] = useState(null);
  const [loadingTermFor, setLoadingTermFor] = useState(null);
  const [custodyModalEmp, setCustodyModalEmp] = useState(null);
  const [tenantAssets, setTenantAssets] = useState([]);

  const isMountedRef = useRef(true);
  const dataSeqRef = useRef(0);
  const portalSeqRef = useRef(0);
  const savingRef = useRef(saving);
  savingRef.current = saving;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const openEmployeeTerm = async (emp, kind) => {
    if (loadingTermFor) return;
    setLoadingTermFor(`${emp.id}-${kind}`);
    try {
      const assets = custodyMap[emp.name] || (await getAssetsAssignedTo(tenantId, emp.name)).filter((a) => !isRetired(a.status) && !a.transit);
      if (!isMountedRef.current) return;
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
      if (isMountedRef.current) toast.error('Não foi possível carregar os ativos do colaborador.');
    } finally {
      if (isMountedRef.current) setLoadingTermFor(null);
    }
  };

  // Armazena as listas puxadas do banco de dados
  const [employees, setEmployees] = useState([]);
  const [sectors, setSectors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // Controla o que o usuário está interagindo no momento sincronizado com a URL (?tab= & ?q=)
  const activeTab = TABS.includes(searchParams.get('tab')) ? searchParams.get('tab') : 'employees';
  const searchTerm = searchParams.get('q') || '';
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null); // Identifica se a janela foi aberta para salvar um novo item (null) ou consertar um já existente (ID)

  const modalTitleId = useId();
  const modalRef = useRef(null);
  const modalFirstInputRef = useRef(null);
  const previousFocusRef = useRef(null);

  const setActiveTab = (tab) => {
    const next = new URLSearchParams(searchParams);
    if (tab === 'employees') next.delete('tab');
    else next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };

  const setSearchTerm = (value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('q', value);
    else next.delete('q');
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    if (!isModalOpen) return undefined;
    const container = modalRef.current;
    previousFocusRef.current = captureFocusTarget(container);
    const frameId = requestAnimationFrame(() => modalFirstInputRef.current?.focus());
    const handleKeyDown = (e) => {
      if (!isTopmostModal(container)) return;
      if (e.key === 'Escape') {
        if (savingRef.current) return;
        e.stopPropagation();
        setIsModalOpen(false);
        return;
      }
      if (e.key === 'Tab') {
        trapFocusWithin(e, container);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('keydown', handleKeyDown);
      const previous = previousFocusRef.current;
      previousFocusRef.current = null;
      restoreFocusSafely(previous, null, container);
    };
  }, [isModalOpen]);

  // Molde padrão para dar reset no formulário sem precisar limpar campo por campo
  const initialForm = {
    name: '', role: '', email: '', login: '', cpf: '', branch: '', sectorId: '',
    sectorName: '', manager: '', description: ''
  };
  const [formData, setFormData] = useState(initialForm);

  const [portalUsers, setPortalUsers] = useState([]);
  const [loadingPortalUsers, setLoadingPortalUsers] = useState(false);
  const [portalError, setPortalError] = useState('');

  const loadPortalUsers = React.useCallback(async ({ isCancelled } = {}) => {
    const seq = ++portalSeqRef.current;
    const stale = () => !isMountedRef.current || seq !== portalSeqRef.current || Boolean(isCancelled?.());

    setLoadingPortalUsers(true);
    setPortalError('');
    try {
      const res = await microservicesApi.listUsers();
      if (stale()) return;
      if (res?.items) {
        setPortalUsers(res.items);
      }
    } catch (err) {
      console.warn('Não foi possível sincronizar usuários com o Gateway:', err);
      if (stale()) return;
      setPortalError(err?.message || 'Não foi possível carregar os acessos do portal.');
    } finally {
      if (!stale()) {
        setLoadingPortalUsers(false);
      }
    }
  }, []);

  useEffect(() => {
    if (activeTab !== 'portal') return undefined;
    let cancelled = false;
    loadPortalUsers({ isCancelled: () => cancelled });
    return () => {
      cancelled = true;
    };
  }, [activeTab, loadPortalUsers]);

  // Puxa colaboradores, departamentos e inventário simultaneamente para sincronizar a custódia
  const loadData = useCallback(async ({ isCancelled } = {}) => {
    const seq = ++dataSeqRef.current;
    const stale = () => !isMountedRef.current || seq !== dataSeqRef.current || Boolean(isCancelled?.());

    if (!tenantId) {
      if (!stale()) {
        setEmployees([]);
        setSectors([]);
        setTenantAssets([]);
        setLoadError(null);
        setLoading(false);
      }
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
        const [empRes, secRes, assetRes] = await Promise.allSettled([
          getEmployees(tenantId),
          getSectors(tenantId),
          getAssets(tenantId)
        ]);
        if (stale()) return;
        let failedCount = 0;
        if (empRes.status === 'fulfilled') {
          setEmployees(empRes.value || []);
        } else {
          failedCount += 1;
          console.error('Erro ao carregar colaboradores:', empRes.reason);
        }
        if (secRes.status === 'fulfilled') {
          setSectors(secRes.value || []);
        } else {
          failedCount += 1;
          console.error('Erro ao carregar setores:', secRes.reason);
        }
        if (assetRes.status === 'fulfilled') {
          setTenantAssets(assetRes.value || []);
        } else {
          console.error('Erro ao carregar ativos para custódia:', assetRes.reason);
        }
        if (failedCount > 0) {
          setLoadError('Não foi possível carregar todos os dados de pessoas e setores. Tente novamente.');
        }
    } catch (error) {
        console.error('Erro ao carregar:', error);
        if (stale()) return;
        setLoadError('Não foi possível carregar os dados de pessoas e setores.');
    } finally {
        if (!stale()) {
          setLoading(false);
        }
    }
  }, [tenantId]);

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
    let cancelled = false;
    loadData({ isCancelled: () => cancelled });
    return () => {
      cancelled = true;
    };
  }, [loadData]);

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
    if (saving) return;
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
                if (!isMountedRef.current) return;
                if (res?.updatedAssetsCount > 0) {
                  toast.success(`Colaborador atualizado! ${res.updatedAssetsCount} ativo(s) vinculado(s) foram atualizados em cascata.`);
                } else {
                  toast.success('Colaborador atualizado com sucesso!');
                }
            } else {
                await addEmployee(payload);
                if (!isMountedRef.current) return;
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
                if (!isMountedRef.current) return;
                const total = (res?.updatedEmployeesCount || 0) + (res?.updatedAssetsCount || 0);
                if (total > 0) {
                  toast.success(`Setor atualizado! Vínculos em cascata atualizados (${res.updatedEmployeesCount} colaborador(es), ${res.updatedAssetsCount} ativo(s)).`);
                } else {
                  toast.success('Setor atualizado com sucesso!');
                }
            } else {
                await addSector(payload);
                if (!isMountedRef.current) return;
                toast.success('Setor cadastrado com sucesso!');
            }
        }
        setIsModalOpen(false);
        loadData();
    } catch (err) {
        console.error(err);
        if (isMountedRef.current) toast.error("Erro ao salvar.");
    } finally {
        if (isMountedRef.current) setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (deletingId || saving) return;
    setDeletingId(id);
    try {
      if (activeTab === 'employees') {
        const emp = employees.find(e => e.id === id);
        const assignedAssets = (emp?.name && tenantId) ? await getAssetsAssignedTo(tenantId, emp.name) : [];
        if (!isMountedRef.current) return;
        const msg = assignedAssets.length > 0
          ? `Este colaborador possui ${assignedAssets.length} ativo(s) vinculado(s) sob sua responsabilidade. A exclusão não apagará os ativos, mas removerá o vínculo. Deseja excluir "${emp?.name || ''}"?`
          : `Tem certeza que deseja excluir o colaborador "${emp?.name || ''}"?`;

        const ok = await confirm({
          title: 'Excluir Colaborador',
          message: msg,
          danger: true,
          confirmLabel: 'Excluir Colaborador'
        });
        if (!ok || !isMountedRef.current) return;

        await deleteEmployee(id);
        if (!isMountedRef.current) return;
        toast.success('Colaborador excluído com sucesso.');
        loadData();
      } else {
        const sec = sectors.find(s => s.id === id);
        const ok = await confirm({
          title: 'Excluir Setor',
          message: `Tem certeza que deseja excluir o setor "${sec?.name || ''}"?`,
          danger: true,
          confirmLabel: 'Excluir Setor'
        });
        if (!ok || !isMountedRef.current) return;

        await deleteSector(id);
        if (!isMountedRef.current) return;
        toast.success('Setor excluído com sucesso.');
        loadData();
      }
    } catch (err) {
      console.error(err);
      if (isMountedRef.current) {
        toast.error(activeTab === 'employees' ? 'Erro ao excluir colaborador.' : 'Erro ao excluir setor.');
      }
    } finally {
      if (isMountedRef.current) setDeletingId(null);
    }
  };

  // O filtro ocorre localmente varrendo o nome sem bater no servidor novamente
  const query = searchTerm.toLowerCase();
  const filteredList = activeTab === 'employees'
    ? employees.filter(e => (e.name || '').toLowerCase().includes(query) || (e.role || '').toLowerCase().includes(query) || (e.email || '').toLowerCase().includes(query))
    : sectors.filter(s => (s.name || '').toLowerCase().includes(query));

  if (loading) return <ManagerSkeleton />;

  if (loadError && activeTab !== 'portal') {
    return (
      <div className="p-4 md:p-8 max-w-[1600px] mx-auto animate-fade-in">
        <div role="alert" className="rounded-2xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertCircle size={22} className="text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <h2 className="text-base font-bold text-rose-900 dark:text-rose-200">Erro ao carregar pessoas e setores</h2>
              <p className="text-xs text-rose-700 dark:text-rose-300 mt-1">{loadError}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={loadData}
            className="inline-flex items-center justify-center gap-2 px-4 min-h-[44px] rounded-xl bg-white dark:bg-[#111113] border border-rose-200 dark:border-rose-800 text-xs font-bold text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-950/60 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 shrink-0"
          >
            <RefreshCcw size={15} aria-hidden="true" /> Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto animate-fade-in pb-24">

      {/* Titulação da página com botão de nova ação que muda o contexto conforme a aba atual */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-8">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-[#fafafa] flex items-center gap-2">
            <Users className="text-brand-aa" size={28} aria-hidden="true" /> Gestão de Pessoas &amp; Áreas
          </h1>
          <p className="text-sm text-slate-500 dark:text-zinc-400">Mantenha a estrutura organizacional atualizada</p>
        </div>
        {canWrite && activeTab !== 'portal' && (
          <button
            type="button"
            onClick={openCreateModal}
            className="bg-brand text-brand-fg hover:bg-brand-dark px-5 min-h-[44px] rounded-xl font-bold flex items-center gap-2 shadow-sm transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <Plus size={18} aria-hidden="true" /> {activeTab === 'employees' ? 'Novo Colaborador' : 'Novo Setor'}
          </button>
        )}
      </div>

      {/* Chaves principais que alternam a visão entre pessoas ou a visão por hierarquia */}
      <div className="flex flex-wrap gap-1.5 bg-slate-100 dark:bg-[#111113] p-1.5 rounded-xl w-full md:w-fit mb-6 border border-slate-200/80 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => setActiveTab('employees')}
          aria-pressed={activeTab === 'employees'}
          className={`px-4 min-h-[44px] rounded-lg text-sm font-bold flex items-center gap-2 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${activeTab === 'employees' ? 'bg-white text-slate-900 shadow-sm dark:bg-zinc-800 dark:text-[#fafafa]' : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-[#fafafa]'}`}
        >
          <UserCircle size={18} aria-hidden="true" /> Colaboradores
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('sectors')}
          aria-pressed={activeTab === 'sectors'}
          className={`px-4 min-h-[44px] rounded-lg text-sm font-bold flex items-center gap-2 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${activeTab === 'sectors' ? 'bg-white text-slate-900 shadow-sm dark:bg-zinc-800 dark:text-[#fafafa]' : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-[#fafafa]'}`}
        >
          <Briefcase size={18} aria-hidden="true" /> Setores / Deptos
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('portal')}
          aria-pressed={activeTab === 'portal'}
          className={`px-4 min-h-[44px] rounded-lg text-sm font-bold flex items-center gap-2 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${activeTab === 'portal' ? 'bg-white text-slate-900 shadow-sm dark:bg-zinc-800 dark:text-[#fafafa]' : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-[#fafafa]'}`}
        >
          <KeyRound size={18} className="text-brand-aa" aria-hidden="true" /> Portal do Colaborador (Acessos)
        </button>
      </div>

      {/* Campo que reage tecla por tecla sem ter que fazer a tabela piscar ou ir na nuvem */}
      {activeTab !== 'portal' && (
        <div className="relative mb-6">
          <label htmlFor="employee-search" className="sr-only">
            {activeTab === 'employees' ? 'Buscar colaborador por nome, cargo ou e-mail' : 'Buscar setor'}
          </label>
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-zinc-500" size={18} aria-hidden="true" />
          <input
            id="employee-search"
            name="employee-search"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder={activeTab === 'employees' ? 'Buscar por nome, cargo, e-mail…' : 'Buscar setor…'}
            className="w-full pl-11 pr-4 min-h-[44px] bg-white dark:bg-[#111113] border border-slate-200 dark:border-zinc-800 rounded-xl text-sm text-slate-900 dark:text-[#fafafa] placeholder:text-slate-400 dark:placeholder:text-zinc-500 transition-colors hover:border-slate-300 dark:hover:border-zinc-700 active:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:border-brand disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-zinc-900 aria-[invalid=true]:border-rose-500 aria-[invalid=true]:focus-visible:ring-rose-500"
          />
        </div>
      )}

      {/* Área flexível que injeta os cartões da aba selecionada */}
      {activeTab === 'portal' ? (
        <CollaboratorAccessWorkspace
          currentUser={currentUser}
          portalUsers={portalUsers}
          portalLoading={loadingPortalUsers}
          portalError={portalError}
          employees={employees}
          sectors={sectors}
          onRefreshUsers={loadPortalUsers}
          onPortalUsersChange={setPortalUsers}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">

          {/* Mapeia a lista de funcionários em pequenos cartões estilo crachá de contato */}
          {activeTab === 'employees' && filteredList.map(emp => {
            const empAssets = custodyMap[emp.name] || [];
            return (
              <div
                key={emp.id}
                className="[content-visibility:auto] [contain-intrinsic-size:auto_260px] bg-white dark:bg-[#111113] p-5 rounded-2xl border border-slate-200 dark:border-zinc-800 shadow-sm hover:border-brand/40 transition-colors group relative flex flex-col"
              >
                <div className="flex justify-between items-start mb-3 gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-zinc-900 flex items-center justify-center text-slate-700 dark:text-zinc-200 font-black text-lg border border-slate-200 dark:border-zinc-800 uppercase shrink-0">
                      {(emp.name || '?').substring(0, 2)}
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-bold text-slate-900 dark:text-[#fafafa] leading-tight truncate">{emp.name}</h3>
                      <p className="text-xs text-slate-500 dark:text-zinc-400 font-medium truncate">{emp.role || 'Cargo não inf.'}</p>
                    </div>
                  </div>
                  {canWrite && (
                    <div className="flex gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => openEditModal(emp)}
                        aria-label={`Editar ${emp.name}`}
                        className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-slate-500 dark:text-zinc-400 hover:text-brand-aa rounded-xl hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                      >
                        <Edit size={16} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(deletingId)}
                        onClick={() => handleDelete(emp.id)}
                        aria-label={`Excluir ${emp.name}`}
                        className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-slate-500 dark:text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Resumo de Ativos em Custódia */}
                <div className="my-2 px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-zinc-900/60 border border-slate-100 dark:border-zinc-800 flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <Laptop size={14} className={empAssets.length > 0 ? 'text-brand-aa shrink-0' : 'text-slate-400 shrink-0'} aria-hidden="true" />
                    <span className={`font-bold truncate text-xs tabular-nums ${empAssets.length > 0 ? 'text-slate-800 dark:text-zinc-200' : 'text-slate-500 dark:text-zinc-400'}`}>
                      {empAssets.length > 0 ? `${empAssets.length} ${empAssets.length === 1 ? 'ativo' : 'ativos'} em posse` : 'Sem ativos vinculados'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCustodyModalEmp(emp)}
                    className="text-xs font-bold text-brand-aa hover:underline px-2.5 min-h-[44px] inline-flex items-center rounded-lg hover:bg-brand/10 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand shrink-0"
                    title="Abrir prontuário de equipamentos e custódia deste colaborador"
                  >
                    Ver Custódia
                  </button>
                </div>

                <div className="mt-auto space-y-2 pt-3 border-t border-slate-100 dark:border-zinc-800">
                  <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-zinc-300">
                    <Briefcase size={14} className="text-brand-aa shrink-0" aria-hidden="true" />
                    <span className="font-bold bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 px-2 py-0.5 rounded">{emp.sector}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-zinc-400">
                    <MapPin size={14} className="text-slate-400 dark:text-zinc-500 shrink-0" aria-hidden="true" /> {emp.branch}
                  </div>
                  {emp.email && (
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-zinc-400 truncate" title={emp.email}>
                      <Mail size={14} className="text-slate-400 dark:text-zinc-500 shrink-0" aria-hidden="true" /> {emp.email}
                    </div>
                  )}
                  {emp.cpf && (
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-zinc-400 font-mono tabular-nums" title={emp.cpf}>
                      <CreditCard size={14} className="text-slate-400 dark:text-zinc-500 shrink-0" aria-hidden="true" /> {emp.cpf}
                    </div>
                  )}
                </div>
                {canIssueTerms && emp.name && (
                  <div className="grid grid-cols-2 gap-2 mt-3">
                    <button
                      type="button"
                      onClick={() => openEmployeeTerm(emp, 'responsabilidade')}
                      disabled={Boolean(loadingTermFor)}
                      title="Termo de responsabilidade com os ativos deste colaborador"
                      className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 dark:border-zinc-700 min-h-[44px] text-xs font-black uppercase tracking-wider text-slate-700 dark:text-zinc-200 hover:text-brand-aa hover:border-brand/40 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
                    >
                      <FileSignature size={14} aria-hidden="true" /> {loadingTermFor === `${emp.id}-responsabilidade` ? 'Carregando…' : 'Termo'}
                    </button>
                    <button
                      type="button"
                      onClick={() => openEmployeeTerm(emp, 'devolucao')}
                      disabled={Boolean(loadingTermFor)}
                      title="Devolução dos ativos deste colaborador (ex.: desligamento)"
                      className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 dark:border-zinc-700 min-h-[44px] text-xs font-black uppercase tracking-wider text-slate-700 dark:text-zinc-200 hover:text-brand-aa hover:border-brand/40 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
                    >
                      <Undo2 size={14} aria-hidden="true" /> {loadingTermFor === `${emp.id}-devolucao` ? 'Carregando…' : 'Devolução'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {/* Lista focada nas informações departamentais criando pequenos resumos do setor */}
          {activeTab === 'sectors' && filteredList.map(sec => (
            <div
              key={sec.id}
              className="[content-visibility:auto] [contain-intrinsic-size:auto_220px] bg-white dark:bg-[#111113] p-6 rounded-2xl border border-slate-200 dark:border-zinc-800 shadow-sm hover:border-brand/40 transition-colors group relative"
            >
              <div className="flex justify-between items-start mb-4">
                <div className="p-3 bg-slate-50 dark:bg-zinc-900 rounded-xl border border-slate-100 dark:border-zinc-800">
                  <Building2 size={24} className="text-slate-700 dark:text-zinc-200" aria-hidden="true" />
                </div>
                {canWrite && (
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => openEditModal(sec)}
                      aria-label={`Editar setor ${sec.name}`}
                      className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-slate-500 dark:text-zinc-400 hover:text-brand-aa rounded-xl hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    >
                      <Edit size={16} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(deletingId)}
                      onClick={() => handleDelete(sec.id)}
                      aria-label={`Excluir setor ${sec.name}`}
                      className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-slate-500 dark:text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </div>
                )}
              </div>

              <h3 className="text-xl font-black text-slate-900 dark:text-[#fafafa] mb-1">{sec.name}</h3>
              <p className="text-sm text-slate-500 dark:text-zinc-400 mb-4 line-clamp-2 min-h-[2.5rem]">{sec.description || 'Sem descrição.'}</p>

              <div className="flex items-center gap-2.5 p-2.5 bg-slate-50 dark:bg-zinc-900/60 rounded-xl border border-slate-100 dark:border-zinc-800">
                <UserCircle size={16} className="text-slate-400 dark:text-zinc-500 shrink-0" aria-hidden="true" />
                <div className="text-xs min-w-0">
                  <span className="block font-bold text-slate-500 dark:text-zinc-400 uppercase text-xs">Gestor / Responsável</span>
                  <span className={`font-bold truncate block ${sec.manager ? 'text-slate-800 dark:text-zinc-100' : 'text-slate-400 dark:text-zinc-500 italic'}`}>
                    {sec.manager || 'Não atribuído'}
                  </span>
                </div>
              </div>
            </div>
          ))}

          {filteredList.length === 0 && (
            <div className="col-span-full py-12 text-center text-slate-500 dark:text-zinc-400 border-2 border-dashed border-slate-200 dark:border-zinc-800 rounded-2xl">
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
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overscroll-contain"
          onClick={(e) => {
            if (e.target === e.currentTarget && !saving) setIsModalOpen(false);
          }}
        >
          <div
            ref={modalRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby={modalTitleId}
            className="bg-white dark:bg-[#111113] rounded-2xl shadow-2xl w-full max-w-md max-h-[92vh] overflow-y-auto overscroll-contain p-6 border border-slate-200 dark:border-zinc-800 animate-zoom-in"
          >
            <div className="flex justify-between items-center mb-4">
              <h2 id={modalTitleId} className="text-xl font-black text-slate-900 dark:text-[#fafafa] flex items-center gap-2">
                {editingId ? <Edit size={20} aria-hidden="true" /> : <Plus size={20} aria-hidden="true" />}
                {editingId ? 'Editar' : 'Novo'} {activeTab === 'employees' ? 'Colaborador' : 'Setor'}
              </h2>
              <button
                type="button"
                disabled={saving}
                onClick={() => setIsModalOpen(false)}
                aria-label="Fechar janela"
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-[#fafafa] hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4">

              {activeTab === 'employees' ? (
                <>
                  <div>
                    <label htmlFor="emp-name" className="block text-xs font-bold text-slate-600 dark:text-zinc-300 uppercase mb-1">Nome Completo</label>
                    <input
                      ref={modalFirstInputRef}
                      id="emp-name"
                      name="emp-name"
                      required
                      value={formData.name}
                      onChange={e => setFormData({ ...formData, name: e.target.value })}
                      className={`${fieldClass} font-bold`}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="emp-role" className="block text-xs font-bold text-slate-600 dark:text-zinc-300 uppercase mb-1">Cargo</label>
                      <input
                        id="emp-role"
                        name="emp-role"
                        value={formData.role}
                        onChange={e => setFormData({ ...formData, role: e.target.value })}
                        className={fieldClass}
                      />
                    </div>
                    <div>
                      <label htmlFor="emp-sector" className="block text-xs font-bold text-slate-600 dark:text-zinc-300 uppercase mb-1">Setor</label>
                      <select
                        id="emp-sector"
                        name="emp-sector"
                        value={formData.sectorId}
                        onChange={e => setFormData({ ...formData, sectorId: e.target.value })}
                        className={`${fieldClass} cursor-pointer`}
                      >
                        <option value="">Selecione…</option>
                        <option value="Geral">Geral</option>
                        {sectors.filter(s => s.name !== 'Geral').map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                        <option value="Outro">Outro / Externo</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="emp-email" className="block text-xs font-bold text-slate-600 dark:text-zinc-300 uppercase mb-1">E-mail</label>
                    <input
                      id="emp-email"
                      name="emp-email"
                      type="email"
                      value={formData.email}
                      onChange={e => setFormData({ ...formData, email: e.target.value })}
                      className={fieldClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="emp-login" className="block text-xs font-bold text-slate-600 dark:text-zinc-300 uppercase mb-1">Login de rede (Windows)</label>
                    <input
                      id="emp-login"
                      name="emp-login"
                      value={formData.login}
                      onChange={e => setFormData({ ...formData, login: e.target.value })}
                      placeholder="Ex.: joao.silva"
                      className={`${fieldClass} font-mono`}
                    />
                    <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">O Agente ITAM usa para saber quem está usando cada máquina. Sem ele, tenta pelo e-mail e pelo nome.</p>
                  </div>
                  <div>
                    <label htmlFor="emp-cpf" className="block text-xs font-bold text-slate-600 dark:text-zinc-300 uppercase mb-1">CPF</label>
                    <input
                      id="emp-cpf"
                      name="emp-cpf"
                      value={formData.cpf}
                      onChange={e => setFormData({ ...formData, cpf: e.target.value })}
                      placeholder="000.000.000-00"
                      className={`${fieldClass} font-mono tabular-nums`}
                    />
                  </div>
                  <div>
                    <label htmlFor="branch" className="block text-xs font-bold text-slate-600 dark:text-zinc-300 uppercase mb-1">Unidade / Base</label>
                    <LocationSelect
                      value={formData.branch}
                      onChange={e => setFormData({ ...formData, branch: e.target.value })}
                      id="branch"
                      name="branch"
                      showManageLink
                      className={`${fieldClass} cursor-pointer`}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label htmlFor="sec-name" className="block text-xs font-bold text-slate-600 dark:text-zinc-300 uppercase mb-1">Nome do Setor</label>
                    <input
                      ref={modalFirstInputRef}
                      id="sec-name"
                      name="sec-name"
                      required
                      value={formData.sectorName}
                      onChange={e => setFormData({ ...formData, sectorName: e.target.value })}
                      className={`${fieldClass} font-bold`}
                      placeholder="Ex: Financeiro, TI…"
                    />
                  </div>
                  <div>
                    <label htmlFor="sec-manager" className="block text-xs font-bold text-slate-600 dark:text-zinc-300 uppercase mb-1">Gestor Responsável</label>
                    <select
                      id="sec-manager"
                      name="sec-manager"
                      value={formData.manager}
                      onChange={e => setFormData({ ...formData, manager: e.target.value })}
                      className={`${fieldClass} cursor-pointer`}
                    >
                      <option value="">Selecione um colaborador…</option>
                      {employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="sec-desc" className="block text-xs font-bold text-slate-600 dark:text-zinc-300 uppercase mb-1">Descrição</label>
                    <textarea
                      id="sec-desc"
                      name="sec-desc"
                      value={formData.description}
                      onChange={e => setFormData({ ...formData, description: e.target.value })}
                      className={fieldClass}
                      rows="3"
                      placeholder="Função deste departamento…"
                    />
                  </div>
                </>
              )}

              <div className="flex gap-3 pt-4 border-t border-slate-100 dark:border-zinc-800 mt-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 min-h-[44px] bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-xl font-bold text-slate-700 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 min-h-[44px] bg-brand hover:bg-brand-dark text-brand-fg rounded-xl font-bold shadow-sm flex justify-center items-center gap-2 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
                >
                  {saving ? <RefreshCcw className="animate-spin" size={18} aria-hidden="true" /> : <Save size={18} aria-hidden="true" />}
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