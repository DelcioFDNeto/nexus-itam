// src/pages/TenantManager.jsx
// -----------------------------------------------------------------------------
// Empresas da plataforma (console Nexus Master).
//
// Correcoes em relacao a versao anterior:
//  - limites vinham de uma tabela fixa no codigo, ignorando /plans e qualquer
//    ajuste individual; agora o plano efetivo sai de utils/entitlements;
//  - lia TODOS os ativos da plataforma (collectionGroup) so para contar; agora
//    usa agregacao por empresa (1 leitura a cada 1.000 documentos);
//  - "Excluir" apagava so o documento da empresa — usuarios e dados continuavam
//    acessiveis. Encerrar agora e um status que as regras do Firestore bloqueiam;
//  - empresas legadas (sem /tenants) passam a aparecer e podem ser regularizadas;
//  - provisionamento com erro nao deixa mais conta de login orfa.
// -----------------------------------------------------------------------------
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, Building2, CheckCircle, ChevronRight, CircleDollarSign, Pause, Play, PlusSquare, RefreshCcw, Search, ShieldCheck, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { describeFirebaseError, loadConsoleSnapshot, provisionTenant, updateTenant } from '../services/tenantService';
import { TENANT_STATUSES } from '../utils/entitlements';
import { brl, brlCompact, relativeDays, tenantAlerts } from '../utils/consoleMetrics';
import { KpiTile, PlanBadge, TenantStatusBadge, UsageBar } from '../components/console/consoleUi';
import TenantDetailDrawer from '../components/console/TenantDetailDrawer';
import { useConfirm } from '../components/ConfirmDialog';
import { captureFocusTarget, restoreFocusSafely, trapFocusWithin } from '../utils/focusTrap';
import { isTopmostModal } from '../utils/modalStack';

const EMPTY_PROVISION = { companyName: '', adminName: '', email: '', password: '', plan: 'starter' };

const fieldClass =
  'min-h-[44px] w-full px-3.5 py-2.5 bg-white dark:bg-[#111113] border border-slate-200 dark:border-zinc-800 rounded-xl text-sm font-semibold text-slate-900 dark:text-[#fafafa] placeholder:text-slate-400 dark:placeholder:text-zinc-500 transition-colors hover:border-slate-300 dark:hover:border-zinc-700 active:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:border-brand disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-zinc-900 aria-[invalid=true]:border-rose-500 aria-[invalid=true]:focus-visible:ring-rose-500';
const btnPrimaryClass =
  'min-h-[44px] px-4 py-2.5 rounded-xl bg-brand hover:bg-brand-dark text-brand-fg font-bold text-xs inline-flex items-center justify-center gap-2 shadow-sm transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#111113] disabled:opacity-60 disabled:cursor-not-allowed';
const btnSecondaryClass =
  'min-h-[44px] px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] text-slate-700 dark:text-[#fafafa] font-bold text-xs inline-flex items-center justify-center gap-2 transition-colors hover:bg-slate-50 dark:hover:bg-zinc-800 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#111113] disabled:opacity-60 disabled:cursor-not-allowed';
const btnIconClass =
  'min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] text-slate-600 dark:text-zinc-300 transition-colors hover:bg-slate-50 dark:hover:bg-zinc-800 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60 disabled:cursor-not-allowed';

const TenantManager = () => {
  const confirm = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const searchTerm = searchParams.get('q') || '';
  const statusFilter = searchParams.get('status') || 'ALL';
  const planFilter = searchParams.get('plano') || 'ALL';
  const alertsOnly = searchParams.get('alertas') === '1';
  const selectedId = searchParams.get('empresa');
  const showProvision = searchParams.get('novo') === '1';

  const [provisionForm, setProvisionForm] = useState(EMPTY_PROVISION);
  const [provisionLoading, setProvisionLoading] = useState(false);
  const [provisionError, setProvisionError] = useState('');
  const [provisionFieldErrors, setProvisionFieldErrors] = useState({});
  const [togglingId, setTogglingId] = useState(null);

  const provisionTitleId = useId();
  const provisionDialogRef = useRef(null);
  const provisionFirstInputRef = useRef(null);
  const previousFocusRef = useRef(null);
  const isMountedRef = useRef(true);
  const loadSeqRef = useRef(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const setParam = useCallback((key, value) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value === null || value === undefined || value === '' || value === 'ALL') next.delete(key);
      else next.set(key, value);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setLoadError('');
    try {
      const data = await loadConsoleSnapshot();
      if (!isMountedRef.current || seq !== loadSeqRef.current) return;
      setSnapshot(data);
    } catch (error) {
      console.error('Erro ao carregar empresas:', error);
      if (!isMountedRef.current || seq !== loadSeqRef.current) return;
      setLoadError(describeFirebaseError(error, 'Falha ao carregar a lista de empresas.'));
      toast.error('Falha ao carregar a lista de empresas.');
    } finally {
      if (isMountedRef.current && seq === loadSeqRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const closeProvision = useCallback(() => {
    if (provisionLoading) return;
    setParam('novo', null);
    setProvisionForm(EMPTY_PROVISION);
    setProvisionError('');
    setProvisionFieldErrors({});
  }, [provisionLoading, setParam]);

  const provisionLoadingRef = useRef(provisionLoading);
  provisionLoadingRef.current = provisionLoading;
  const closeProvisionRef = useRef(closeProvision);
  closeProvisionRef.current = closeProvision;

  useEffect(() => {
    if (!showProvision) return undefined;
    const container = provisionDialogRef.current;
    previousFocusRef.current = captureFocusTarget(container);

    const raf = requestAnimationFrame(() => {
      if (provisionFirstInputRef.current) provisionFirstInputRef.current.focus();
      else container?.focus();
    });

    const onKeyDown = (event) => {
      if (!isTopmostModal(container)) return;
      if (event.key === 'Escape') {
        if (provisionLoadingRef.current) return;
        event.preventDefault();
        closeProvisionRef.current?.();
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
  }, [showProvision]);

  const tenants = useMemo(() => snapshot?.tenants || [], [snapshot]);
  const plans = useMemo(() => snapshot?.plans || {}, [snapshot]);
  const selected = tenants.find((t) => t.id === selectedId) || null;

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return tenants.filter((t) => {
      if (term) {
        const haystack = [t.companyName, t.id, t.owner?.email, t.owner?.name].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      if (statusFilter === 'legacy' && !t.legacy) return false;
      if (statusFilter !== 'ALL' && statusFilter !== 'legacy' && (t.legacy || t.status !== statusFilter)) return false;
      if (planFilter !== 'ALL' && t.entitlements?.planId !== planFilter) return false;
      if (alertsOnly && tenantAlerts(t).length === 0) return false;
      return true;
    });
  }, [tenants, searchTerm, statusFilter, planFilter, alertsOnly]);

  const totals = useMemo(() => ({
    total: tenants.length,
    live: tenants.filter((t) => !t.legacy && ['active', 'trial'].includes(t.status)).length,
    blocked: tenants.filter((t) => ['suspended', 'cancelled'].includes(t.status)).length,
    legacy: tenants.filter((t) => t.legacy).length,
    mrr: tenants.reduce((sum, t) => sum + (t.mrr || 0), 0),
    withAlerts: tenants.filter((t) => tenantAlerts(t).some((a) => a.level !== 'info')).length,
  }), [tenants]);

  const quickToggle = async (tenant) => {
    if (togglingId) return;
    const suspend = ['active', 'trial'].includes(tenant.status);
    const verb = suspend ? 'Suspender' : 'Reativar';
    const ok = await confirm({
      title: `${verb} Empresa`,
      message: `${verb} o acesso de "${tenant.companyName || tenant.id}"?`,
      danger: suspend,
      confirmLabel: verb,
    });
    if (!ok || !isMountedRef.current) return;
    setTogglingId(tenant.id);
    try {
      await updateTenant(tenant.id, { status: suspend ? 'suspended' : 'active' });
      if (!isMountedRef.current) return;
      toast.success(suspend ? 'Empresa suspensa: acesso bloqueado.' : 'Empresa reativada.');
      load();
    } catch (error) {
      console.error(error);
      if (isMountedRef.current) toast.error(describeFirebaseError(error));
    } finally {
      if (isMountedRef.current) setTogglingId(null);
    }
  };

  const handleProvision = async (e) => {
    e.preventDefault();
    if (provisionLoading) return;
    setProvisionError('');
    const errs = {};
    if (!provisionForm.companyName.trim()) errs.companyName = true;
    if (!provisionForm.adminName.trim()) errs.adminName = true;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(provisionForm.email.trim())) errs.email = true;
    if (provisionForm.password.length < 8) errs.password = true;

    if (Object.keys(errs).length > 0) {
      setProvisionFieldErrors(errs);
      setProvisionError(
        errs.password
          ? 'A senha inicial precisa de pelo menos 8 caracteres.'
          : 'Preencha corretamente todos os campos obrigatórios.',
      );
      return;
    }

    setProvisionFieldErrors({});
    setProvisionLoading(true);
    try {
      const { tenantId } = await provisionTenant({
        ...provisionForm,
        companyName: provisionForm.companyName.trim(),
        adminName: provisionForm.adminName.trim(),
        email: provisionForm.email.trim(),
      });
      if (!isMountedRef.current) return;
      toast.success(`Empresa "${provisionForm.companyName.trim()}" criada. Envie o acesso ao responsável.`);
      setParam('novo', null);
      setProvisionForm(EMPTY_PROVISION);
      setProvisionError('');
      await load();
      if (!isMountedRef.current) return;
      setParam('empresa', tenantId);
    } catch (error) {
      console.error('Erro ao provisionar empresa:', error);
      if (isMountedRef.current) setProvisionError(describeFirebaseError(error, 'Erro ao criar a empresa.'));
    } finally {
      if (isMountedRef.current) setProvisionLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto pb-24 space-y-6 animate-fade-in">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-[#111113] rounded-2xl p-5 border border-slate-200/90 dark:border-zinc-800 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand/10 border border-brand/20 text-brand-aa flex items-center justify-center shrink-0">
            <Building2 size={20} aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-[#fafafa] tracking-tight">Empresas</h1>
            <p className="text-xs text-slate-600 dark:text-zinc-400 mt-0.5">Planos, limites sob medida, identidade e saúde de cada cliente.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setParam('novo', '1')} className={btnPrimaryClass}>
            <PlusSquare size={15} aria-hidden="true" /> <span>Nova empresa</span>
          </button>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            aria-label="Recarregar empresas"
            title="Recarregar"
            className={btnIconClass}
          >
            <RefreshCcw size={15} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* RESUMO KPI */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <KpiTile
          icon={Building2}
          label="Total"
          value={totals.total.toLocaleString('pt-BR')}
          hint={statusFilter === 'ALL' && !alertsOnly ? `${totals.legacy} legadas` : 'Limpar filtro de status'}
          onClick={() => { setParam('status', null); setParam('alertas', null); }}
        />
        <KpiTile
          icon={CheckCircle}
          tone="bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400"
          label="Ativas"
          value={totals.live.toLocaleString('pt-BR')}
          hint={statusFilter === 'active' ? 'Filtro ativo' : 'Filtrar ativas'}
          onClick={() => setParam('status', statusFilter === 'active' ? null : 'active')}
        />
        <KpiTile
          icon={Pause}
          tone="bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400"
          label="Suspensas / encerradas"
          value={totals.blocked.toLocaleString('pt-BR')}
          hint={statusFilter === 'suspended' ? 'Filtro ativo' : 'Filtrar suspensas'}
          onClick={() => setParam('status', statusFilter === 'suspended' ? null : 'suspended')}
        />
        <KpiTile
          icon={AlertTriangle}
          tone="bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400"
          label="Com alertas"
          value={totals.withAlerts.toLocaleString('pt-BR')}
          hint={alertsOnly ? 'Filtro ativo' : 'Filtrar alertas'}
          onClick={() => setParam('alertas', alertsOnly ? null : '1')}
        />
        <KpiTile
          icon={CircleDollarSign}
          tone="bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400"
          label="MRR"
          value={brlCompact.format(totals.mrr)}
          hint={`ARR ${brlCompact.format(totals.mrr * 12)}`}
        />
      </div>

      {/* ESTADO DE ERRO + RETRY */}
      {loadError && (
        <div
          role="alert"
          className="rounded-2xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-bold text-rose-900 dark:text-rose-200">Erro ao carregar empresas</h2>
              <p className="text-xs text-rose-700 dark:text-rose-300 mt-0.5">{loadError}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-white dark:bg-[#111113] border border-rose-200 dark:border-rose-800 text-xs font-bold text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-60 disabled:cursor-not-allowed shrink-0"
          >
            <RefreshCcw size={14} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
            <span>Tentar novamente</span>
          </button>
        </div>
      )}

      {/* FILTROS */}
      <div className="bg-white dark:bg-[#111113] rounded-2xl border border-slate-200/90 dark:border-zinc-800 p-4 shadow-sm flex flex-col md:flex-row gap-3 items-stretch md:items-center">
        <div className="relative w-full md:flex-1">
          <label htmlFor="tm-search" className="sr-only">Buscar empresas</label>
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-zinc-500" aria-hidden="true" />
          <input
            id="tm-search"
            name="q"
            type="search"
            placeholder="Buscar por empresa, ID, responsável ou e-mail…"
            value={searchTerm}
            onChange={(e) => setParam('q', e.target.value)}
            className={`${fieldClass} pl-10 text-xs`}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <div>
            <label htmlFor="tm-status-filter" className="sr-only">Filtrar por status</label>
            <select
              id="tm-status-filter"
              name="status"
              value={statusFilter}
              onChange={(e) => setParam('status', e.target.value)}
              className={`${fieldClass} md:w-48 text-xs cursor-pointer`}
            >
              <option value="ALL">Todos os status</option>
              {Object.entries(TENANT_STATUSES).map(([id, s]) => <option key={id} value={id}>{s.label}</option>)}
              <option value="legacy">Legadas (sem cadastro)</option>
            </select>
          </div>
          <div>
            <label htmlFor="tm-plan-filter" className="sr-only">Filtrar por plano</label>
            <select
              id="tm-plan-filter"
              name="plano"
              value={planFilter}
              onChange={(e) => setParam('plano', e.target.value)}
              className={`${fieldClass} md:w-48 text-xs cursor-pointer`}
            >
              <option value="ALL">Todos os planos</option>
              {Object.values(plans).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          {alertsOnly && (
            <button
              type="button"
              onClick={() => setParam('alertas', null)}
              className="min-h-[44px] text-xs font-bold px-3.5 py-2 rounded-xl bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-200 dark:border-amber-900/60 inline-flex items-center gap-1.5 transition-colors hover:bg-amber-200/70 dark:hover:bg-amber-950/80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <span>Com alertas</span>
              <X size={13} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* Governança e DPA (Data Processing Agreement) LGPD */}
      <div className="p-3.5 rounded-xl bg-zinc-900 dark:bg-[#111113] border border-zinc-800 text-xs text-zinc-300 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <ShieldCheck size={18} className="text-emerald-400 shrink-0" aria-hidden="true" />
          <span className="truncate">
            <strong className="text-[#fafafa] font-bold">Acordo de Processamento de Dados (DPA):</strong> Isolamento lógico multi-tenant e hash criptográfico para conformidade com a LGPD (Lei 13.709/2018).
          </span>
        </div>
        <div className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-mono text-xs font-bold shrink-0">
          DPA Ativo • Multi-tenant
        </div>
      </div>

      {/* TABELA */}
      <div className="bg-white dark:bg-[#111113] rounded-2xl border border-slate-200/90 dark:border-zinc-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-[#09090b] text-slate-500 dark:text-zinc-400 text-xs uppercase font-black tracking-wider border-b border-slate-200 dark:border-zinc-800">
                <th className="p-4 pl-6">Empresa</th>
                <th className="p-4">Responsável</th>
                <th className="p-4">Plano</th>
                <th className="p-4">Usuários</th>
                <th className="p-4">Ativos</th>
                <th className="p-4">Último acesso</th>
                <th className="p-4 text-right">MRR</th>
                <th className="p-4 pr-6 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="text-xs font-semibold text-slate-700 dark:text-zinc-200">
              {loading && !snapshot ? (
                <tr>
                  <td colSpan="8" className="p-12 text-center text-slate-500 dark:text-zinc-400 font-bold uppercase tracking-wider">
                    <div role="status" className="flex flex-col items-center gap-3">
                      <div className="w-8 h-8 border-4 border-brand/20 border-t-brand rounded-full animate-spin" aria-hidden="true" />
                      <span>Carregando empresas…</span>
                    </div>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan="8" className="p-10 text-center text-slate-500 dark:text-zinc-400 font-medium">
                    Nenhuma empresa corresponde aos filtros.
                  </td>
                </tr>
              ) : (
                filtered.map((tenant) => {
                  const alerts = tenantAlerts(tenant);
                  const worst = alerts.find((a) => a.level === 'critical') || alerts.find((a) => a.level === 'warning');
                  const isLive = ['active', 'trial'].includes(tenant.status);
                  return (
                    <tr
                      key={tenant.id}
                      className="border-b border-slate-100 dark:border-zinc-800/80 hover:bg-slate-50/70 dark:hover:bg-zinc-800/50 transition-colors"
                    >
                      <td className="p-4 pl-6">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-brand/10 text-brand-aa flex items-center justify-center font-black shrink-0">
                            {(tenant.companyName || tenant.id).substring(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <button
                              type="button"
                              onClick={() => setParam('empresa', tenant.id)}
                              className="min-h-[44px] text-left font-extrabold text-slate-900 dark:text-[#fafafa] hover:text-brand-aa text-sm truncate max-w-[220px] inline-flex items-center gap-1.5 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                            >
                              <span className="truncate">{tenant.companyName || 'Empresa sem nome'}</span>
                              {worst && (
                                <AlertTriangle
                                  size={13}
                                  className={worst.level === 'critical' ? 'text-rose-500 shrink-0' : 'text-amber-500 shrink-0'}
                                  aria-hidden="true"
                                />
                              )}
                            </button>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <TenantStatusBadge tenant={tenant} />
                              <span className="text-xs font-mono text-slate-500 dark:text-zinc-400 truncate max-w-[140px]">#{tenant.id}</span>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        <p className="font-bold text-slate-900 dark:text-[#fafafa] truncate max-w-[180px]">{tenant.owner?.name || '—'}</p>
                        <p className="text-xs text-slate-500 dark:text-zinc-400 truncate max-w-[180px]">{tenant.owner?.email || 'Sem responsável'}</p>
                      </td>
                      <td className="p-4"><PlanBadge tenant={tenant} /></td>
                      <td className="p-4 w-32"><UsageBar compact current={tenant.usersCount} limit={tenant.entitlements?.maxUsers} /></td>
                      <td className="p-4 w-32"><UsageBar compact current={tenant.assetsCount} limit={tenant.entitlements?.maxAssets} /></td>
                      <td className="p-4 text-xs text-slate-600 dark:text-zinc-400 whitespace-nowrap tabular-nums">{relativeDays(tenant.lastActivity)}</td>
                      <td className="p-4 text-right tabular-nums font-black text-slate-900 dark:text-[#fafafa]">{tenant.mrr ? brl.format(tenant.mrr) : '—'}</td>
                      <td className="p-4 pr-6">
                        <div className="flex items-center justify-end gap-2">
                          {!tenant.legacy && tenant.status !== 'cancelled' && (
                            <button
                              type="button"
                              disabled={togglingId === tenant.id}
                              onClick={() => quickToggle(tenant)}
                              className={`${btnIconClass} ${
                                isLive
                                  ? 'text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-900/60 hover:bg-amber-50 dark:hover:bg-amber-950/30'
                                  : 'text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/60 hover:bg-emerald-50 dark:hover:bg-emerald-950/30'
                              }`}
                              title={isLive ? 'Suspender empresa' : 'Reativar empresa'}
                              aria-label={`${isLive ? 'Suspender' : 'Reativar'} ${tenant.companyName || tenant.id}`}
                            >
                              {isLive ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setParam('empresa', tenant.id)}
                            className="min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] text-slate-700 dark:text-zinc-200 hover:text-brand-aa hover:border-brand/40 hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand inline-flex items-center gap-1 text-xs font-black uppercase"
                          >
                            <span>Detalhes</span>
                            <ChevronRight size={13} aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <TenantDetailDrawer
          key={selected.id}
          tenant={selected}
          plans={plans}
          onClose={() => setParam('empresa', null)}
          onChanged={load}
        />
      )}
      {selectedId && !selected && snapshot && !loading && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 !mt-0 rounded-xl bg-zinc-900 dark:bg-[#111113] border border-zinc-800 text-[#fafafa] pl-4 pr-2 py-2 text-xs font-bold shadow-xl flex items-center gap-2"
        >
          <span>Empresa &quot;{selectedId}&quot; não encontrada.</span>
          <button
            type="button"
            onClick={() => setParam('empresa', null)}
            aria-label="Fechar aviso"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-zinc-400 hover:text-[#fafafa] hover:bg-zinc-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* PROVISIONAMENTO */}
      {showProvision && (
        <div
          className="fixed inset-0 !mt-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4 overscroll-contain animate-fade-in"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !provisionLoading) closeProvision();
          }}
        >
          <div
            ref={provisionDialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby={provisionTitleId}
            className="bg-white dark:bg-[#111113] border border-slate-200 dark:border-zinc-800 rounded-2xl p-6 w-full max-w-md shadow-2xl max-h-[92vh] overflow-y-auto overscroll-contain animate-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <div className="flex items-center justify-between mb-5">
              <h2 id={provisionTitleId} className="text-lg font-black text-slate-900 dark:text-[#fafafa]">Nova empresa</h2>
              <button
                type="button"
                disabled={provisionLoading}
                onClick={closeProvision}
                aria-label="Fechar janela de nova empresa"
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-[#fafafa] hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            {provisionError && (
              <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
                {provisionError}
              </p>
            )}

            <form onSubmit={handleProvision} className="space-y-4" noValidate>
              {[
                ['companyName', 'Razão social / nome fantasia', 'text', 'Ex: ACME Indústria', 'organization'],
                ['adminName', 'Nome do responsável (owner)', 'text', 'Nome completo', 'name'],
                ['email', 'E-mail de acesso do responsável', 'email', 'nome@empresa.com.br', 'off'],
                ['password', 'Senha inicial (mín. 8)', 'password', '••••••••', 'new-password'],
              ].map(([key, text, type, placeholder, autoComplete], idx) => (
                <div key={key}>
                  <label htmlFor={`prov-${key}`} className="block text-xs font-bold text-slate-600 dark:text-zinc-400 uppercase tracking-wider mb-1.5">{text}</label>
                  <input
                    ref={idx === 0 ? provisionFirstInputRef : undefined}
                    id={`prov-${key}`}
                    name={key}
                    type={type}
                    required
                    minLength={key === 'password' ? 8 : undefined}
                    autoComplete={autoComplete}
                    value={provisionForm[key]}
                    aria-invalid={provisionFieldErrors[key] ? 'true' : undefined}
                    onChange={(e) => {
                      setProvisionForm({ ...provisionForm, [key]: e.target.value });
                      if (provisionFieldErrors[key]) {
                        setProvisionFieldErrors((prev) => ({ ...prev, [key]: false }));
                      }
                    }}
                    placeholder={placeholder}
                    className={fieldClass}
                  />
                </div>
              ))}
              <div>
                <label htmlFor="prov-plan" className="block text-xs font-bold text-slate-600 dark:text-zinc-400 uppercase tracking-wider mb-1.5">Plano</label>
                <select
                  id="prov-plan"
                  name="plan"
                  value={provisionForm.plan}
                  onChange={(e) => setProvisionForm({ ...provisionForm, plan: e.target.value })}
                  className={`${fieldClass} cursor-pointer`}
                >
                  {Object.values(plans).map((p) => (
                    <option key={p.id} value={p.id}>{p.name} — {brl.format(Number(p.monthlyPrice) || 0)}/mês</option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-slate-600 dark:text-zinc-400">
                Limites e recursos sob medida podem ser ajustados logo depois, em Detalhes → Plano e limites.
              </p>
              <div className="flex gap-3 pt-2">
                <button type="button" disabled={provisionLoading} onClick={closeProvision} className={`flex-1 uppercase tracking-wider ${btnSecondaryClass}`}>
                  Cancelar
                </button>
                <button type="submit" disabled={provisionLoading} className={`flex-1 uppercase tracking-wider ${btnPrimaryClass}`}>
                  {provisionLoading ? 'Criando…' : 'Criar empresa'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default TenantManager;
