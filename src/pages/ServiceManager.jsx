// src/pages/ServiceManager.jsx
import React, { useState, useEffect, useMemo, useCallback, useId, useRef } from 'react';
import { getContracts, createContract, updateContract, deleteContract } from '../services/contractService';
import { describeFirebaseError } from '../services/tenantService';
import { useAuth } from '../contexts/AuthContext';
import ManagerSkeleton from '../components/dashboard/ManagerSkeleton';
import {
  AlertTriangle, Globe, Plus, Trash2, Search, Phone, Calendar, DollarSign, Briefcase, Edit, RefreshCcw, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { can } from '../utils/permissions';
import { useConfirm } from '../components/ConfirmDialog';
import { endOfLocalDay, formatDateBR } from '../utils/dates';
import { parseBRL } from '../utils/currency';
import { captureFocusTarget, restoreFocusSafely, trapFocusWithin } from '../utils/focusTrap';
import { isTopmostModal } from '../utils/modalStack';

const initialForm = {
  provider: '',
  serviceType: 'Internet',
  monthlyCost: '',
  renewalDate: '',
  supportPhone: '',
  description: '',
};

const fieldClass =
  'min-h-[44px] w-full px-3.5 py-2.5 bg-white dark:bg-[#111113] border border-slate-200 dark:border-zinc-800 rounded-xl text-sm font-medium text-slate-900 dark:text-[#fafafa] placeholder:text-slate-400 dark:placeholder:text-zinc-500 transition-colors hover:border-slate-300 dark:hover:border-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:border-brand disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-zinc-900 aria-[invalid=true]:border-rose-500 aria-[invalid=true]:focus-visible:ring-rose-500';
const btnPrimaryClass =
  'min-h-[44px] px-4 py-2.5 rounded-xl bg-brand hover:bg-brand-dark text-brand-fg font-bold text-sm inline-flex items-center justify-center gap-2 shadow-sm transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#111113] disabled:opacity-60 disabled:cursor-not-allowed';
const btnSecondaryClass =
  'min-h-[44px] px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] text-slate-700 dark:text-[#fafafa] font-bold text-sm inline-flex items-center justify-center gap-2 transition-colors hover:bg-slate-50 dark:hover:bg-zinc-800 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#111113] disabled:opacity-60 disabled:cursor-not-allowed';

const ServiceManager = () => {
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [formData, setFormData] = useState(initialForm);
  const [formErrors, setFormErrors] = useState({});
  const [formErrorMsg, setFormErrorMsg] = useState('');

  const modalTitleId = useId();
  const modalRef = useRef(null);
  const firstInputRef = useRef(null);
  const previousFocusRef = useRef(null);
  const isMountedRef = useRef(true);
  const loadSeqRef = useRef(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const { currentUser } = useAuth();
  const confirm = useConfirm();
  const tenantId = currentUser?.tenantId;
  const canWrite = can(currentUser, 'contracts:write');

  const loadData = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    if (!tenantId) {
      setContracts([]);
      setLoadError('');
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError('');
    try {
      const data = await getContracts(tenantId);
      if (!isMountedRef.current || seq !== loadSeqRef.current) return;
      setContracts(data);
    } catch (error) {
      console.error(error);
      if (!isMountedRef.current || seq !== loadSeqRef.current) return;
      setLoadError(describeFirebaseError(error, 'Erro ao carregar contratos.'));
      toast.error('Erro ao carregar contratos.');
    } finally {
      if (isMountedRef.current && seq === loadSeqRef.current) {
        setLoading(false);
      }
    }
  }, [tenantId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const closeModal = useCallback(() => {
    if (saving) return;
    setIsModalOpen(false);
    setFormErrors({});
    setFormErrorMsg('');
  }, [saving]);

  const savingRef = useRef(saving);
  savingRef.current = saving;
  const closeModalRef = useRef(closeModal);
  closeModalRef.current = closeModal;

  useEffect(() => {
    if (!isModalOpen) return undefined;
    const container = modalRef.current;
    previousFocusRef.current = captureFocusTarget(container);

    const raf = requestAnimationFrame(() => {
      if (firstInputRef.current) firstInputRef.current.focus();
      else container?.focus();
    });

    const onKeyDown = (event) => {
      if (!isTopmostModal(container)) return;
      if (event.key === 'Escape') {
        if (savingRef.current) return;
        event.preventDefault();
        closeModalRef.current?.();
        return;
      }
      if (event.key === 'Tab') {
        trapFocusWithin(event, container);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown);
      const previous = previousFocusRef.current;
      previousFocusRef.current = null;
      restoreFocusSafely(previous, null, container);
    };
  }, [isModalOpen]);

  const openCreateModal = () => {
    setEditingId(null);
    setFormData(initialForm);
    setFormErrors({});
    setFormErrorMsg('');
    setIsModalOpen(true);
  };

  const openEditModal = (contract) => {
    setEditingId(contract.id);
    const hasCost = contract.monthlyCost !== undefined && contract.monthlyCost !== null && contract.monthlyCost !== '';
    setFormData({
      provider: contract.provider || '',
      serviceType: contract.serviceType || 'Internet',
      monthlyCost: hasCost ? String(parseBRL(contract.monthlyCost)) : '',
      renewalDate: contract.renewalDate || '',
      supportPhone: contract.supportPhone || '',
      description: contract.description || '',
    });
    setFormErrors({});
    setFormErrorMsg('');
    setIsModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;
    if (!tenantId) {
      toast.error('Sem contexto de tenant.');
      return;
    }

    const errs = {};
    if (!formData.provider.trim()) errs.provider = true;
    const rawCost = String(formData.monthlyCost ?? '').trim();
    const costNum = rawCost && /\d/.test(rawCost) ? parseBRL(rawCost) : NaN;
    if (!Number.isFinite(costNum) || costNum < 0) errs.monthlyCost = true;

    if (Object.keys(errs).length > 0) {
      setFormErrors(errs);
      const msg = errs.provider ? 'Informe o fornecedor ou empresa.' : 'Informe um valor mensal válido.';
      setFormErrorMsg(msg);
      toast.error(msg);
      return;
    }

    setFormErrors({});
    setFormErrorMsg('');
    setSaving(true);
    try {
      const payload = {
        provider: formData.provider.trim(),
        serviceType: formData.serviceType,
        monthlyCost: costNum,
        renewalDate: formData.renewalDate || '',
        supportPhone: formData.supportPhone.trim(),
        description: formData.description.trim(),
      };

      if (editingId) {
        await updateContract(editingId, payload);
        if (!isMountedRef.current) return;
        toast.success('Contrato atualizado com sucesso.');
      } else {
        await createContract({ ...payload, tenantId });
        if (!isMountedRef.current) return;
        toast.success('Contrato criado com sucesso.');
      }

      setIsModalOpen(false);
      setFormData(initialForm);
      setEditingId(null);
      await loadData();
    } catch (error) {
      console.error(error);
      if (!isMountedRef.current) return;
      const msg = describeFirebaseError(error, 'Erro ao salvar contrato.');
      setFormErrorMsg(msg);
      toast.error(msg);
    } finally {
      if (isMountedRef.current) setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (deletingId || saving) return;
    const confirmed = await confirm({
      title: 'Excluir Contrato',
      message: 'Tem certeza que deseja remover este contrato? Esta ação não pode ser desfeita.',
      danger: true,
      confirmLabel: 'Excluir Contrato',
    });
    if (!confirmed || !isMountedRef.current) return;

    setDeletingId(id);
    try {
      await deleteContract(id);
      if (!isMountedRef.current) return;
      toast.success('Contrato excluído com sucesso.');
      await loadData();
    } catch (error) {
      console.error(error);
      if (isMountedRef.current) toast.error(describeFirebaseError(error, 'Erro ao excluir contrato.'));
    } finally {
      if (isMountedRef.current) setDeletingId(null);
    }
  };

  const filteredContracts = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return contracts;
    return contracts.filter((c) =>
      (c.provider && c.provider.toLowerCase().includes(term)) ||
      (c.serviceType && c.serviceType.toLowerCase().includes(term)) ||
      (c.description && c.description.toLowerCase().includes(term)) ||
      (c.supportPhone && c.supportPhone.toLowerCase().includes(term)),
    );
  }, [contracts, searchTerm]);

  // Soma automatica de todos os custos recorrentes para exibir no painel principal
  const totalMonthly = useMemo(
    () => contracts.reduce((acc, curr) => acc + parseBRL(curr.monthlyCost), 0),
    [contracts],
  );

  if (loading) return <ManagerSkeleton />;

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto animate-fade-in pb-24">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-[#fafafa] flex items-center gap-2">
            <Globe className="text-brand-aa" aria-hidden="true" /> Contas &amp; Serviços
          </h1>
          <p className="text-sm text-slate-600 dark:text-zinc-400">Links, Hospedagem, Outsourcing e Assinaturas.</p>
        </div>

        <div className="flex items-center gap-2.5 w-full md:w-auto">
          <div className="relative flex-1 md:w-72">
            <label htmlFor="service-search" className="sr-only">Buscar contratos</label>
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-zinc-500" size={16} aria-hidden="true" />
            <input
              id="service-search"
              name="serviceSearch"
              type="search"
              placeholder="Buscar contratos…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className={`${fieldClass} pl-10 pr-10`}
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                aria-label="Limpar busca de contratos"
                className="absolute right-0 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-slate-400 hover:text-slate-700 dark:text-zinc-500 dark:hover:text-[#fafafa] rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <X size={15} aria-hidden="true" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            aria-label="Recarregar contratos"
            title="Recarregar"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] text-slate-600 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60 disabled:cursor-not-allowed shrink-0"
          >
            <RefreshCcw size={16} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
          </button>
          {canWrite && (
            <button
              type="button"
              onClick={openCreateModal}
              className={`${btnPrimaryClass} shrink-0`}
            >
              <Plus size={18} aria-hidden="true" /> <span>Novo Contrato</span>
            </button>
          )}
        </div>
      </div>

      {/* ESTADO DE ERRO + RETRY */}
      {loadError && (
        <div
          role="alert"
          className="mb-8 rounded-2xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-bold text-rose-900 dark:text-rose-200">Erro ao carregar contratos</h2>
              <p className="text-xs text-rose-700 dark:text-rose-300 mt-0.5">{loadError}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            className="min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-white dark:bg-[#111113] border border-rose-200 dark:border-rose-800 text-xs font-bold text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-60 disabled:cursor-not-allowed shrink-0"
          >
            <RefreshCcw size={14} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
            <span>Tentar novamente</span>
          </button>
        </div>
      )}

      {/* Painel de destaque financeiro exibindo o escoamento mensal em servicos */}
      <div className="bg-zinc-900 dark:bg-[#111113] border border-zinc-800 text-[#fafafa] p-6 rounded-2xl shadow-sm mb-8 flex justify-between items-center relative overflow-hidden">
        <div className="relative z-10">
          <p className="text-zinc-400 text-xs font-bold uppercase mb-1">Custo Mensal Recorrente</p>
          <h2 className="text-3xl md:text-4xl font-black tabular-nums">
            R$ {totalMonthly.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </h2>
        </div>
        <div className="p-3 bg-white/10 rounded-full" aria-hidden="true">
          <DollarSign size={32} aria-hidden="true" />
        </div>
      </div>

      {/* Grade exibindo cada contrato como um cartao individual */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredContracts.map((contract) => {
          const cost = parseBRL(contract.monthlyCost);
          const renewalEnd = contract.renewalDate ? endOfLocalDay(contract.renewalDate) : null;
          const isExpired = Boolean(renewalEnd) && renewalEnd < new Date();

          return (
            <div
              key={contract.id}
              className="[content-visibility:auto] [contain-intrinsic-size:auto_56px] bg-white dark:bg-[#111113] p-6 rounded-2xl border border-slate-200 dark:border-zinc-800 shadow-sm hover:border-slate-300 dark:hover:border-zinc-700 transition-colors group relative"
            >
              {canWrite && (
                <div className="absolute top-3 right-3 flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => openEditModal(contract)}
                    title="Editar contrato"
                    aria-label={`Editar contrato ${contract.provider}`}
                    className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-slate-500 dark:text-zinc-400 hover:text-brand-aa hover:bg-brand/10 dark:hover:bg-zinc-800 rounded-xl transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    <Edit size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(deletingId)}
                    onClick={() => handleDelete(contract.id)}
                    title="Excluir contrato"
                    aria-label={`Excluir contrato ${contract.provider}`}
                    className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-slate-500 dark:text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-xl transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </div>
              )}

              <div className="flex items-center gap-3 mb-4 pr-24">
                <div className="p-3 bg-slate-50 dark:bg-[#09090b] rounded-xl text-brand-aa font-bold border border-slate-200/80 dark:border-zinc-800 shrink-0">
                  {contract.serviceType === 'Internet' ? <Globe size={24} aria-hidden="true" /> : <Briefcase size={24} aria-hidden="true" />}
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-slate-900 dark:text-[#fafafa] text-lg leading-tight truncate" title={contract.provider}>
                    {contract.provider}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-zinc-400 font-medium uppercase tracking-wider">{contract.serviceType}</p>
                </div>
              </div>

              <div className="space-y-3 text-sm text-slate-600 dark:text-zinc-300">
                <div className="flex justify-between border-b border-slate-100 dark:border-zinc-800 pb-2">
                  <span className="flex items-center gap-2"><DollarSign size={14} aria-hidden="true" /> Valor Mensal</span>
                  <span className="font-bold text-slate-900 dark:text-[#fafafa] tabular-nums">
                    R$ {cost.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between border-b border-slate-100 dark:border-zinc-800 pb-2">
                  <span className="flex items-center gap-2"><Phone size={14} aria-hidden="true" /> Suporte</span>
                  <span className="font-mono text-slate-800 dark:text-zinc-200 tabular-nums">{contract.supportPhone || '—'}</span>
                </div>
                <div className="flex justify-between border-b border-slate-100 dark:border-zinc-800 pb-2">
                  <span className="flex items-center gap-2"><Calendar size={14} aria-hidden="true" /> Renovação</span>
                  <span className={`font-bold tabular-nums ${isExpired ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-zinc-200'}`}>
                    {contract.renewalDate ? formatDateBR(contract.renewalDate) : 'Indefinido'}
                  </span>
                </div>
              </div>
              {contract.description && (
                <div className="mt-4 p-3 bg-slate-50 dark:bg-[#09090b] border border-slate-200/70 dark:border-zinc-800 rounded-lg text-xs text-slate-600 dark:text-zinc-400 italic">
                  &ldquo;{contract.description}&rdquo;
                </div>
              )}
            </div>
          );
        })}
      </div>

      {filteredContracts.length === 0 && !loadError && (
        <div className="py-16 text-center text-slate-500 dark:text-zinc-400 border-2 border-dashed border-slate-200 dark:border-zinc-800 rounded-2xl bg-white/50 dark:bg-[#111113]/50">
          <Globe size={40} className="mx-auto mb-3 opacity-40" aria-hidden="true" />
          <p className="font-bold text-base text-slate-700 dark:text-zinc-200">Nenhum contrato encontrado</p>
          <p className="text-sm mt-1">
            {searchTerm ? 'Tente ajustar os termos da busca.' : 'Cadastre os contratos de internet, serviços ou licenças terceiras.'}
          </p>
        </div>
      )}

      {/* Formulario modal para registrar ou editar contrato */}
      {isModalOpen && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 overscroll-contain animate-fade-in"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !saving) closeModal();
          }}
        >
          <div
            ref={modalRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby={modalTitleId}
            className="bg-white dark:bg-[#111113] w-full max-w-md rounded-2xl shadow-2xl overflow-hidden border border-slate-200 dark:border-zinc-800 max-h-[92vh] overflow-y-auto overscroll-contain animate-zoom-in focus:outline-none"
          >
            <div className="bg-zinc-900 dark:bg-[#09090b] px-5 py-3.5 text-[#fafafa] flex justify-between items-center border-b border-zinc-800">
              <h3 id={modalTitleId} className="font-bold flex items-center gap-2 text-base">
                {editingId ? <Edit size={18} aria-hidden="true" /> : <Plus size={18} aria-hidden="true" />}
                <span>{editingId ? 'Editar Contrato / Serviço' : 'Novo Contrato / Serviço'}</span>
              </h3>
              <button
                type="button"
                disabled={saving}
                onClick={closeModal}
                aria-label="Fechar janela de contrato"
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl text-zinc-400 hover:text-[#fafafa] hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4" noValidate>
              {formErrorMsg && (
                <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
                  {formErrorMsg}
                </p>
              )}
              <div>
                <label htmlFor="contract-provider" className="block text-xs font-bold text-slate-600 dark:text-zinc-400 uppercase mb-1.5">
                  Fornecedor / Empresa
                </label>
                <input
                  ref={firstInputRef}
                  id="contract-provider"
                  name="provider"
                  required
                  aria-invalid={formErrors.provider ? 'true' : undefined}
                  className={fieldClass}
                  placeholder="Ex: VIVO Fibra"
                  value={formData.provider}
                  onChange={(e) => {
                    setFormData({ ...formData, provider: e.target.value });
                    if (formErrors.provider) setFormErrors((prev) => ({ ...prev, provider: false }));
                  }}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="contract-type" className="block text-xs font-bold text-slate-600 dark:text-zinc-400 uppercase mb-1.5">
                    Tipo
                  </label>
                  <select
                    id="contract-type"
                    name="serviceType"
                    className={`${fieldClass} cursor-pointer`}
                    value={formData.serviceType}
                    onChange={(e) => setFormData({ ...formData, serviceType: e.target.value })}
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
                  <label htmlFor="contract-cost" className="block text-xs font-bold text-slate-600 dark:text-zinc-400 uppercase mb-1.5">
                    Valor Mensal (R$)
                  </label>
                  <input
                    id="contract-cost"
                    name="monthlyCost"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    aria-invalid={formErrors.monthlyCost ? 'true' : undefined}
                    className={`${fieldClass} tabular-nums`}
                    placeholder="0.00"
                    value={formData.monthlyCost}
                    onChange={(e) => {
                      setFormData({ ...formData, monthlyCost: e.target.value });
                      if (formErrors.monthlyCost) setFormErrors((prev) => ({ ...prev, monthlyCost: false }));
                    }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="contract-phone" className="block text-xs font-bold text-slate-600 dark:text-zinc-400 uppercase mb-1.5">
                    Telefone Suporte
                  </label>
                  <input
                    id="contract-phone"
                    name="supportPhone"
                    className={fieldClass}
                    placeholder="0800…"
                    value={formData.supportPhone}
                    onChange={(e) => setFormData({ ...formData, supportPhone: e.target.value })}
                  />
                </div>
                <div>
                  <label htmlFor="contract-renewal" className="block text-xs font-bold text-slate-600 dark:text-zinc-400 uppercase mb-1.5">
                    Data Renovação
                  </label>
                  <input
                    id="contract-renewal"
                    name="renewalDate"
                    type="date"
                    className={`${fieldClass} tabular-nums`}
                    value={formData.renewalDate}
                    onChange={(e) => setFormData({ ...formData, renewalDate: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label htmlFor="contract-description" className="block text-xs font-bold text-slate-600 dark:text-zinc-400 uppercase mb-1.5">
                  Descrição do Plano
                </label>
                <textarea
                  id="contract-description"
                  name="description"
                  className={fieldClass}
                  rows="2"
                  placeholder="Ex: Link Dedicado 100MB + IP Fixo"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={closeModal}
                  className={`flex-1 ${btnSecondaryClass}`}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className={`flex-1 ${btnPrimaryClass}`}
                >
                  {saving ? <RefreshCcw className="animate-spin" size={16} aria-hidden="true" /> : null}
                  <span>{saving ? 'Salvando…' : (editingId ? 'Salvar Alterações' : 'Salvar Contrato')}</span>
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
