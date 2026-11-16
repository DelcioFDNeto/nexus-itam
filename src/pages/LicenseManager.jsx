// src/pages/LicenseManager.jsx
import React, { useState, useEffect, useCallback, useId, useRef, useMemo } from 'react';
import { getLicenses, createLicense, deleteLicense, assignLicense, unassignLicense } from '../services/licenseService';
import { describeFirebaseError } from '../services/tenantService';
import { useAssets } from '../hooks/useAssets';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../components/ConfirmDialog';
import ManagerSkeleton from '../components/dashboard/ManagerSkeleton';
import { can } from '../utils/permissions';
import { isRetired } from '../utils/assetStatus';
import { endOfLocalDay, formatDateBR, toLocalDate } from '../utils/dates';
import { captureFocusTarget, restoreFocusSafely, trapFocusWithin } from '../utils/focusTrap';
import { isTopmostModal } from '../utils/modalStack';
import {
  Key, ShieldCheck, Plus, Trash2, Search, Monitor,
  X, Copy, CheckCircle, AlertTriangle, Calendar, RefreshCcw, ChevronDown,
} from 'lucide-react';
import { toast } from 'sonner';

const fieldClass =
  'min-h-[44px] w-full px-3.5 py-2.5 bg-white dark:bg-[#111113] border border-slate-200 dark:border-zinc-800 rounded-xl text-sm font-medium text-slate-900 dark:text-[#fafafa] placeholder:text-slate-400 dark:placeholder:text-zinc-500 transition-colors hover:border-slate-300 dark:hover:border-zinc-700 active:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:border-brand disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-zinc-900 aria-[invalid=true]:border-rose-500 aria-[invalid=true]:focus-visible:ring-rose-500';
const btnPrimaryClass =
  'min-h-[44px] px-4 py-2.5 rounded-xl bg-brand hover:bg-brand-dark text-brand-fg font-bold text-sm inline-flex items-center justify-center gap-2 shadow-sm transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#111113] disabled:opacity-60 disabled:cursor-not-allowed';
const btnSecondaryClass =
  'min-h-[44px] px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] text-slate-700 dark:text-[#fafafa] font-bold text-sm inline-flex items-center justify-center gap-2 transition-colors hover:bg-slate-50 dark:hover:bg-zinc-800 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#111113] disabled:opacity-60 disabled:cursor-not-allowed';

const LicenseManager = () => {
  const [licenses, setLicenses] = useState([]);
  const { assets, error: assetsError } = useAssets();
  const { currentUser } = useAuth();
  const confirm = useConfirm();
  const tenantId = currentUser?.tenantId;
  const canWrite = can(currentUser, 'licenses:write');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyActionId, setBusyActionId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Controle de exibição das janelas sobrepostas para criação e atribuição
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isAssignOpen, setIsAssignOpen] = useState(false);
  const [selectedLicense, setSelectedLicense] = useState(null);

  // Armazena temporariamente os dados digitados ao registrar um novo software
  const [formData, setFormData] = useState({
    softwareName: '',
    key: '',
    type: 'Vitalícia',
    totalSeats: 1,
    expirationDate: '',
  });
  const [formErrors, setFormErrors] = useState({});
  const [formErrorMsg, setFormErrorMsg] = useState('');

  // Guarda qual máquina foi selecionada para receber a licença no momento
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [assignError, setAssignError] = useState('');

  const formTitleId = useId();
  const assignTitleId = useId();
  const formDialogRef = useRef(null);
  const formFirstInputRef = useRef(null);
  const formPreviousFocusRef = useRef(null);
  const assignDialogRef = useRef(null);
  const assignSelectRef = useRef(null);
  const assignPreviousFocusRef = useRef(null);
  const isMountedRef = useRef(true);
  const loadSeqRef = useRef(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadData = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    if (!tenantId) {
      setLicenses([]);
      setLoadError('');
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError('');
    try {
      const data = await getLicenses(tenantId);
      if (!isMountedRef.current || seq !== loadSeqRef.current) return;
      setLicenses(data);
    } catch (error) {
      console.error(error);
      if (!isMountedRef.current || seq !== loadSeqRef.current) return;
      setLoadError(describeFirebaseError(error, 'Erro ao carregar licenças de software.'));
      toast.error('Erro ao carregar licenças de software.');
    } finally {
      if (isMountedRef.current && seq === loadSeqRef.current) {
        setLoading(false);
      }
    }
  }, [tenantId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const closeFormModal = useCallback(() => {
    if (saving) return;
    setIsFormOpen(false);
    setFormErrors({});
    setFormErrorMsg('');
  }, [saving]);

  const closeAssignModal = useCallback(() => {
    if (saving) return;
    setIsAssignOpen(false);
    setAssignError('');
    setSelectedAssetId('');
  }, [saving]);

  const savingRef = useRef(saving);
  savingRef.current = saving;
  const closeFormModalRef = useRef(closeFormModal);
  closeFormModalRef.current = closeFormModal;
  const closeAssignModalRef = useRef(closeAssignModal);
  closeAssignModalRef.current = closeAssignModal;

  useEffect(() => {
    if (!isFormOpen) return undefined;
    const container = formDialogRef.current;
    formPreviousFocusRef.current = captureFocusTarget(container);

    const raf = requestAnimationFrame(() => {
      if (formFirstInputRef.current) formFirstInputRef.current.focus();
      else container?.focus();
    });

    const onKeyDown = (event) => {
      if (!isTopmostModal(container)) return;
      if (event.key === 'Escape') {
        if (savingRef.current) return;
        event.preventDefault();
        closeFormModalRef.current?.();
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
      const previous = formPreviousFocusRef.current;
      formPreviousFocusRef.current = null;
      restoreFocusSafely(previous, null, container);
    };
  }, [isFormOpen]);

  useEffect(() => {
    if (!isAssignOpen) return undefined;
    const container = assignDialogRef.current;
    assignPreviousFocusRef.current = captureFocusTarget(container);

    const raf = requestAnimationFrame(() => {
      if (assignSelectRef.current) assignSelectRef.current.focus();
      else container?.focus();
    });

    const onKeyDown = (event) => {
      if (!isTopmostModal(container)) return;
      if (event.key === 'Escape') {
        if (savingRef.current) return;
        event.preventDefault();
        closeAssignModalRef.current?.();
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
      const previous = assignPreviousFocusRef.current;
      assignPreviousFocusRef.current = null;
      restoreFocusSafely(previous, null, container);
    };
  }, [isAssignOpen]);

  // Central de funções que gravam no banco e processam as regras de cruzamento de dados
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;
    if (!tenantId) {
      toast.error('Sem contexto de tenant.');
      return;
    }

    const errs = {};
    if (!formData.softwareName.trim()) errs.softwareName = true;
    if (!formData.key.trim()) errs.key = true;
    const seats = Number(formData.totalSeats);
    if (!Number.isFinite(seats) || seats < 1) errs.totalSeats = true;

    if (Object.keys(errs).length > 0) {
      setFormErrors(errs);
      const msg = errs.totalSeats
        ? 'Informe uma quantidade válida de ativações (mínimo 1).'
        : 'Preencha o nome do software e a chave de ativação.';
      setFormErrorMsg(msg);
      toast.error(msg);
      return;
    }

    setFormErrors({});
    setFormErrorMsg('');
    setSaving(true);
    try {
      await createLicense({
        ...formData,
        softwareName: formData.softwareName.trim(),
        key: formData.key.trim(),
        totalSeats: Math.floor(seats),
        tenantId,
      });
      if (!isMountedRef.current) return;
      toast.success('Licença cadastrada!');
      setIsFormOpen(false);
      setFormData({ softwareName: '', key: '', type: 'Vitalícia', totalSeats: 1, expirationDate: '' });
      loadData();
    } catch (error) {
      console.error(error);
      if (!isMountedRef.current) return;
      const msg = describeFirebaseError(error, 'Erro ao salvar.');
      setFormErrorMsg(msg);
      toast.error(msg);
    } finally {
      if (isMountedRef.current) setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (busyActionId || saving) return;
    const ok = await confirm({
      title: 'Excluir Licença',
      message: 'Deseja excluir esta licença e todas as suas ativações?',
      danger: true,
      confirmLabel: 'Excluir',
    });
    if (!ok || !isMountedRef.current) return;

    setBusyActionId(`del:${id}`);
    try {
      await deleteLicense(id);
      if (!isMountedRef.current) return;
      toast.success('Licença excluída.');
      loadData();
    } catch (error) {
      console.error(error);
      if (isMountedRef.current) toast.error(describeFirebaseError(error, 'Erro ao excluir licença.'));
    } finally {
      if (isMountedRef.current) setBusyActionId(null);
    }
  };

  const handleAssign = async () => {
    if (saving) return;
    if (!selectedAssetId) {
      setAssignError('Selecione um ativo para vincular a licença.');
      return;
    }
    if (!selectedLicense) return;

    const used = selectedLicense.assignedAssets?.length || 0;
    if (used >= selectedLicense.totalSeats) {
      toast.warning('Todas as ativações foram usadas!');
      return;
    }

    const assetObj = assets.find((a) => a.id === selectedAssetId);
    if (!assetObj) return;

    setAssignError('');
    setSaving(true);
    try {
      const label = `${assetObj.model || 'Ativo'} (${assetObj.internalId || assetObj.id})`;
      await assignLicense(selectedLicense.id, assetObj.id, label);
      if (!isMountedRef.current) return;
      toast.success('Ativo vinculado!');
      setIsAssignOpen(false);
      setSelectedAssetId('');
      loadData();
    } catch (error) {
      console.error(error);
      if (!isMountedRef.current) return;
      const msg = describeFirebaseError(error, 'Erro ao vincular.');
      setAssignError(msg);
      toast.error(msg);
    } finally {
      if (isMountedRef.current) setSaving(false);
    }
  };

  const handleUnassign = async (license, assetObj) => {
    if (busyActionId || saving) return;
    const ok = await confirm({
      title: 'Desvincular Licença',
      message: `Remover a licença de ${assetObj.name || 'este ativo'}?`,
      danger: true,
      confirmLabel: 'Desvincular',
    });
    if (!ok || !isMountedRef.current) return;

    setBusyActionId(`unassign:${license.id}:${assetObj.id}`);
    try {
      await unassignLicense(license.id, assetObj);
      if (!isMountedRef.current) return;
      toast.success('Ativo desvinculado.');
      loadData();
    } catch (error) {
      console.error(error);
      if (isMountedRef.current) toast.error(describeFirebaseError(error, 'Erro ao desvincular.'));
    } finally {
      if (isMountedRef.current) setBusyActionId(null);
    }
  };

  const getUsageColor = (used, total) => {
    const percentage = (used / total) * 100;
    if (percentage >= 100) return 'bg-rose-500';
    if (percentage >= 80) return 'bg-amber-500';
    return 'bg-emerald-500';
  };

  const filteredLicenses = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return licenses;
    return licenses.filter((l) => (l.softwareName || '').toLowerCase().includes(term));
  }, [licenses, searchTerm]);

  const availableAssets = useMemo(
    () =>
      [...assets]
        .filter((a) => !isRetired(a.status))
        .sort((a, b) => String(a.model || '').localeCompare(String(b.model || ''))),
    [assets],
  );

  if (loading) return <ManagerSkeleton />;

  const combinedError = loadError || (assetsError ? 'Não foi possível sincronizar a lista de ativos.' : '');

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto pb-24 animate-fade-in">
      {/* Área superior com o título e o botão de partida para registrar novas compras */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-[#fafafa] flex items-center gap-2">
            <ShieldCheck className="text-brand-aa" aria-hidden="true" /> Licenças &amp; Software
          </h1>
          <p className="text-sm text-slate-600 dark:text-zinc-400">Gestão de chaves, contratos e ativações.</p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            aria-label="Recarregar licenças"
            title="Recarregar"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] text-slate-600 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <RefreshCcw size={16} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
          </button>
          {canWrite && (
            <button
              type="button"
              onClick={() => {
                setFormErrors({});
                setFormErrorMsg('');
                setIsFormOpen(true);
              }}
              className={btnPrimaryClass}
            >
              <Plus size={18} aria-hidden="true" /> <span>Nova Licença</span>
            </button>
          )}
        </div>
      </div>

      {/* ESTADO DE ERRO + RETRY */}
      {combinedError && (
        <div
          role="alert"
          className="mb-6 rounded-2xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-bold text-rose-900 dark:text-rose-200">Erro ao carregar licenças</h2>
              <p className="text-xs text-rose-700 dark:text-rose-300 mt-0.5">{combinedError}</p>
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

      {/* Barra fixa na tela dedicada à localização de pacotes específicos rapidamente */}
      <div className="bg-white dark:bg-[#111113] p-3 rounded-2xl shadow-sm border border-slate-200 dark:border-zinc-800 mb-6 flex items-center gap-2 sticky top-0 z-10">
        <div className="relative flex-1">
          <label htmlFor="license-search" className="sr-only">Buscar licença de software</label>
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-zinc-500 pointer-events-none" size={18} aria-hidden="true" />
          <input
            id="license-search"
            name="licenseSearch"
            type="search"
            placeholder="Buscar software (Office, Windows, Adobe…)"
            className={`${fieldClass} pl-10`}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        {searchTerm && (
          <button
            type="button"
            onClick={() => setSearchTerm('')}
            aria-label="Limpar busca"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl text-slate-400 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-[#fafafa] hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Renderiza os cartões densos de informação mostrando uso, chaves e vencimentos de cada pacote */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredLicenses.length === 0 ? (
          <div className="col-span-full py-16 text-center text-slate-500 dark:text-zinc-400 border-2 border-dashed border-slate-200 dark:border-zinc-800 rounded-2xl bg-white/50 dark:bg-[#111113]/50 space-y-2">
            <Key size={36} className="mx-auto opacity-30" aria-hidden="true" />
            <p className="font-bold text-base text-slate-700 dark:text-zinc-200">Nenhuma licença encontrada</p>
            <p className="text-xs">
              {searchTerm
                ? 'Ajuste o termo de busca ou limpe o filtro.'
                : 'Cadastre suas chaves e assinaturas para controlar ativações.'}
            </p>
            {searchTerm && (
              <div className="pt-2">
                <button type="button" onClick={() => setSearchTerm('')} className={btnSecondaryClass}>
                  Limpar busca
                </button>
              </div>
            )}
          </div>
        ) : (
          filteredLicenses.map((license) => {
            const used = license.assignedAssets?.length || 0;
            const total = parseInt(license.totalSeats, 10) || 1;
            const percentage = Math.min((used / total) * 100, 100);
            const expEnd = license.expirationDate ? endOfLocalDay(license.expirationDate) : null;
            const todayEnd = endOfLocalDay(new Date());
            const isExpired = Boolean(expEnd) && expEnd < new Date();
            const daysToExpire = expEnd && todayEnd
              ? Math.round((expEnd.getTime() - todayEnd.getTime()) / (1000 * 60 * 60 * 24))
              : null;

            return (
              <div
                key={license.id}
                className={`[content-visibility:auto] [contain-intrinsic-size:auto_56px] p-5 rounded-2xl border shadow-sm hover:border-slate-300 dark:hover:border-zinc-700 transition-colors flex flex-col justify-between ${
                  isExpired
                    ? 'border-rose-300 dark:border-rose-900/60 bg-rose-50/70 dark:bg-rose-950/20'
                    : 'bg-white dark:bg-[#111113] border-slate-200 dark:border-zinc-800'
                }`}
              >
                {/* Título do software e os rótulos dinâmicos alertando prazos de vencimento */}
                <div>
                  <div className="flex justify-between items-start gap-2 mb-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`p-2.5 rounded-xl shrink-0 ${
                          isExpired
                            ? 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300'
                            : 'bg-brand/10 text-brand-aa'
                        }`}
                      >
                        <Key size={20} aria-hidden="true" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-bold text-lg text-slate-900 dark:text-[#fafafa] line-clamp-1" title={license.softwareName}>
                          {license.softwareName}
                        </h3>
                        <div className="flex flex-wrap gap-2 text-xs mt-1">
                          <span className="bg-slate-100 dark:bg-zinc-900 text-slate-700 dark:text-zinc-300 px-2 py-0.5 rounded border border-slate-200 dark:border-zinc-800">
                            {license.type}
                          </span>
                          {isExpired ? (
                            <span className="bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 font-bold px-2 py-0.5 rounded inline-flex items-center gap-1">
                              <AlertTriangle size={11} aria-hidden="true" /> VENCIDA
                            </span>
                          ) : daysToExpire !== null && daysToExpire <= 30 ? (
                            <span className="bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 font-bold px-2 py-0.5 rounded inline-flex items-center gap-1 tabular-nums">
                              <AlertTriangle size={11} aria-hidden="true" /> Vence em {daysToExpire} dias
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    {canWrite && (
                      <button
                        type="button"
                        disabled={Boolean(busyActionId)}
                        onClick={() => handleDelete(license.id)}
                        className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-slate-400 dark:text-zinc-500 hover:text-rose-600 dark:hover:text-rose-400 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                        title="Excluir Licença"
                        aria-label={`Excluir licença ${license.softwareName}`}
                      >
                        <Trash2 size={17} aria-hidden="true" />
                      </button>
                    )}
                  </div>

                  {/* A serial key em si, destacada e com acesso de um clique para cópia */}
                  <div className="flex items-center gap-2 text-sm font-mono bg-slate-50 dark:bg-[#09090b] px-3 py-1.5 rounded-xl border border-slate-200 dark:border-zinc-800 mb-4 select-all group">
                    <span className="text-slate-500 dark:text-zinc-400 font-bold text-xs select-none shrink-0">KEY:</span>
                    <span className="font-bold text-slate-800 dark:text-[#fafafa] truncate flex-1" title={license.key}>{license.key}</span>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          if (!navigator.clipboard?.writeText) {
                            throw new Error('Clipboard unavailable');
                          }
                          await navigator.clipboard.writeText(license.key);
                          toast.success('Chave copiada para a área de transferência!');
                        } catch {
                          toast.error('Não foi possível copiar a chave.');
                        }
                      }}
                      className="min-h-[44px] min-w-[44px] -my-1.5 -mr-2 inline-flex items-center justify-center text-slate-500 dark:text-zinc-400 hover:text-brand-aa rounded-xl opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 focus-visible:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand shrink-0"
                      title="Copiar Chave"
                      aria-label={`Copiar chave de ${license.softwareName}`}
                    >
                      <Copy size={15} aria-hidden="true" />
                    </button>
                  </div>

                  {/* Termômetro visual para ver de longe a porcentagem de instalações executadas vs compradas */}
                  <div className="mb-4">
                    <div className="flex justify-between text-xs font-bold uppercase mb-1.5 text-slate-600 dark:text-zinc-400">
                      <span>Utilização</span>
                      <span className={`tabular-nums ${used >= total ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
                        {used} / {total}
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 dark:bg-zinc-800 rounded-full h-2 overflow-hidden border border-slate-200/70 dark:border-zinc-800">
                      <div className={`h-full rounded-full transition-[width] duration-500 ${getUsageColor(used, total)}`} style={{ width: `${percentage}%` }} />
                    </div>
                  </div>

                  {/* Relação restrita indicando quais computadores específicos engoliram essas ativações */}
                  <div className="space-y-1.5 max-h-32 overflow-y-auto custom-scrollbar mb-4 pr-1">
                    {license.assignedAssets?.length > 0 ? (
                      license.assignedAssets.map((asset, idx) => (
                        <div
                          key={asset.id || idx}
                          className="[content-visibility:auto] [contain-intrinsic-size:auto_56px] flex items-center justify-between bg-slate-50 dark:bg-[#09090b] px-2.5 py-1 rounded-xl text-xs border border-slate-200/70 dark:border-zinc-800 group/item hover:border-slate-300 dark:hover:border-zinc-700 transition-colors"
                        >
                          <div className="flex items-center gap-2 truncate min-w-0">
                            <Monitor size={13} className="text-slate-400 dark:text-zinc-500 shrink-0" aria-hidden="true" />
                            <span className="font-medium text-slate-700 dark:text-zinc-200 truncate" title={asset.name}>{asset.name}</span>
                          </div>
                          {canWrite && (
                            <button
                              type="button"
                              disabled={Boolean(busyActionId)}
                              onClick={() => handleUnassign(license, asset)}
                              className="min-h-[44px] min-w-[44px] -my-1 -mr-1.5 inline-flex items-center justify-center rounded-lg text-slate-400 dark:text-zinc-500 hover:text-rose-600 dark:hover:text-rose-400 opacity-100 md:opacity-0 md:group-hover/item:opacity-100 md:group-focus-within/item:opacity-100 focus-visible:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                              title="Desvincular"
                              aria-label={`Desvincular ${asset.name || 'ativo'} de ${license.softwareName}`}
                            >
                              <X size={14} aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-slate-500 dark:text-zinc-400 italic text-center py-2">Nenhum ativo vinculado.</p>
                    )}
                  </div>
                </div>

                {/* Fechamento do cartão reforçando validades e deixando engatilhado o botão de adicionar mais computadores */}
                <div className="pt-3 border-t border-slate-100 dark:border-zinc-800 flex justify-between items-center mt-auto gap-2">
                  <div className="text-xs text-slate-500 dark:text-zinc-400 flex items-center gap-1.5 tabular-nums">
                    {license.expirationDate ? (
                      <>
                        <Calendar size={13} aria-hidden="true" />
                        <span>Vence em {formatDateBR(toLocalDate(license.expirationDate))}</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle size={13} className="text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                        <span>Permanente</span>
                      </>
                    )}
                  </div>

                  {canWrite && used < total && !isExpired && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedLicense(license);
                        setSelectedAssetId('');
                        setAssignError('');
                        setIsAssignOpen(true);
                      }}
                      className="min-h-[44px] inline-flex items-center gap-1.5 bg-brand hover:bg-brand-dark text-brand-fg px-3.5 py-2 rounded-xl text-xs font-bold transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand shadow-sm"
                    >
                      <Plus size={14} aria-hidden="true" />
                      <span>Vincular</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Formulário principal que cadastra o software adquirido */}
      {isFormOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overscroll-contain animate-fade-in"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !saving) closeFormModal();
          }}
        >
          <div
            ref={formDialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby={formTitleId}
            className="bg-white dark:bg-[#111113] w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden animate-zoom-in border border-slate-200 dark:border-zinc-800 max-h-[92vh] overflow-y-auto overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <div className="bg-zinc-900 dark:bg-[#09090b] px-5 py-3.5 text-[#fafafa] flex justify-between items-center border-b border-zinc-800">
              <h3 id={formTitleId} className="font-bold flex items-center gap-2 text-base">
                <Key size={18} aria-hidden="true" />
                <span>Cadastrar Software</span>
              </h3>
              <button
                type="button"
                disabled={saving}
                onClick={closeFormModal}
                aria-label="Fechar janela de cadastro de licença"
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
                <label htmlFor="lic-software" className="block text-xs font-bold text-slate-600 dark:text-zinc-400 uppercase mb-1.5">
                  Nome do Software
                </label>
                <input
                  ref={formFirstInputRef}
                  id="lic-software"
                  name="softwareName"
                  required
                  aria-invalid={formErrors.softwareName ? 'true' : undefined}
                  className={fieldClass}
                  placeholder="Ex: Microsoft Office 2021 Home & Business"
                  value={formData.softwareName}
                  onChange={(e) => {
                    setFormData({ ...formData, softwareName: e.target.value });
                    if (formErrors.softwareName) setFormErrors((prev) => ({ ...prev, softwareName: false }));
                  }}
                />
              </div>
              <div>
                <label htmlFor="lic-key" className="block text-xs font-bold text-slate-600 dark:text-zinc-400 uppercase mb-1.5">
                  Chave de Ativação (Key)
                </label>
                <input
                  id="lic-key"
                  name="key"
                  required
                  aria-invalid={formErrors.key ? 'true' : undefined}
                  className={`${fieldClass} font-mono`}
                  placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
                  value={formData.key}
                  onChange={(e) => {
                    setFormData({ ...formData, key: e.target.value });
                    if (formErrors.key) setFormErrors((prev) => ({ ...prev, key: false }));
                  }}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="lic-type" className="block text-xs font-bold text-slate-600 dark:text-zinc-400 uppercase mb-1.5">
                    Tipo
                  </label>
                  <div className="relative">
                    <select
                      id="lic-type"
                      name="type"
                      className={`${fieldClass} appearance-none pr-9 cursor-pointer`}
                      value={formData.type}
                      onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                    >
                      <option>Vitalícia</option>
                      <option>Assinatura Anual</option>
                      <option>Assinatura Mensal</option>
                      <option>OEM</option>
                      <option>Open License (Volume)</option>
                    </select>
                    <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 dark:text-zinc-500" aria-hidden="true" />
                  </div>
                </div>
                <div>
                  <label htmlFor="lic-seats" className="block text-xs font-bold text-slate-600 dark:text-zinc-400 uppercase mb-1.5">
                    Quantidade (Seats)
                  </label>
                  <input
                    id="lic-seats"
                    name="totalSeats"
                    type="number"
                    min="1"
                    required
                    aria-invalid={formErrors.totalSeats ? 'true' : undefined}
                    className={`${fieldClass} tabular-nums`}
                    value={formData.totalSeats}
                    onChange={(e) => {
                      setFormData({ ...formData, totalSeats: e.target.value });
                      if (formErrors.totalSeats) setFormErrors((prev) => ({ ...prev, totalSeats: false }));
                    }}
                  />
                </div>
              </div>
              <div>
                <label htmlFor="lic-expiration" className="block text-xs font-bold text-slate-600 dark:text-zinc-400 uppercase mb-1.5">
                  Expiração (Opcional)
                </label>
                <input
                  id="lic-expiration"
                  name="expirationDate"
                  type="date"
                  className={`${fieldClass} tabular-nums`}
                  value={formData.expirationDate}
                  onChange={(e) => setFormData({ ...formData, expirationDate: e.target.value })}
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={closeFormModal}
                  className={`flex-1 ${btnSecondaryClass}`}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className={`flex-1 uppercase tracking-wide ${btnPrimaryClass}`}
                >
                  {saving ? 'Salvando…' : 'Salvar Licença'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Caixinha rápida focada em fazer o vínculo do ativo com a licença */}
      {isAssignOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overscroll-contain animate-fade-in"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !saving) closeAssignModal();
          }}
        >
          <div
            ref={assignDialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby={assignTitleId}
            className="bg-white dark:bg-[#111113] w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-zoom-in border border-slate-200 dark:border-zinc-800 max-h-[92vh] overflow-y-auto overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <div className="bg-zinc-900 dark:bg-[#09090b] px-5 py-3.5 text-[#fafafa] flex justify-between items-center border-b border-zinc-800">
              <h3 id={assignTitleId} className="font-bold text-base">Vincular a Ativo</h3>
              <button
                type="button"
                disabled={saving}
                onClick={closeAssignModal}
                aria-label="Fechar janela de vínculo de licença"
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl text-zinc-400 hover:text-[#fafafa] hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-slate-600 dark:text-zinc-300">
                Selecione qual máquina receberá uma ativação de <strong className="text-slate-900 dark:text-[#fafafa]">{selectedLicense?.softwareName}</strong>.
              </p>

              {assignError && (
                <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
                  {assignError}
                </p>
              )}

              <div>
                <label htmlFor="assign-asset" className="block text-xs font-bold text-slate-600 dark:text-zinc-400 uppercase mb-1.5">
                  Ativo de destino
                </label>
                <div className="relative">
                  <select
                    ref={assignSelectRef}
                    id="assign-asset"
                    name="assetId"
                    aria-invalid={assignError ? 'true' : undefined}
                    className={`${fieldClass} appearance-none pr-9 cursor-pointer`}
                    value={selectedAssetId}
                    onChange={(e) => {
                      setSelectedAssetId(e.target.value);
                      if (assignError) setAssignError('');
                    }}
                  >
                    <option value="">Selecione um ativo…</option>
                    {availableAssets.map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.model || 'Ativo'} ({asset.internalId || asset.id})
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 dark:text-zinc-500" aria-hidden="true" />
                </div>
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  disabled={saving}
                  onClick={closeAssignModal}
                  className={`flex-1 ${btnSecondaryClass}`}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleAssign}
                  disabled={saving}
                  className="flex-1 min-h-[44px] bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 px-4 rounded-xl transition-colors shadow-sm active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#111113] text-xs uppercase tracking-wider inline-flex justify-center items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <CheckCircle size={16} aria-hidden="true" />
                  <span>{saving ? 'Vinculando…' : 'Confirmar Vínculo'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LicenseManager;
