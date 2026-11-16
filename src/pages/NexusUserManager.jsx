// src/pages/NexusUserManager.jsx
// -----------------------------------------------------------------------------
// Acessos de todas as empresas (console Nexus Master).
//
// Mudancas: a protecao da conta master era um e-mail pessoal escrito no codigo
// (e publicado no bundle); agora ninguem altera a PROPRIA conta por aqui. A
// lista de papeis cobre todos os papeis reais, superadmin so existe no tenant
// master, e suspender passou a bloquear de fato (regras do Firestore).
// -----------------------------------------------------------------------------
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { collection, deleteDoc, doc, getDocs, serverTimestamp, updateDoc } from 'firebase/firestore';
import {
  AlertTriangle, Building2, CheckCircle, Edit, KeyRound, Mail, Pause, Play, RefreshCcw, Save, Search, ShieldCheck, Trash2, Users, X, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { db } from '../services/firebase';
import { useAuth } from '../contexts/AuthContext';
import { describeFirebaseError } from '../services/tenantService';
import { MASTER_TENANT, ROLE_LABELS, TENANT_ROLES } from '../utils/permissions';
import { isUserBlocked } from '../utils/entitlements';
import { relativeDays } from '../utils/consoleMetrics';
import { KpiTile } from '../components/console/consoleUi';
import { useConfirm } from '../components/ConfirmDialog';
import { captureFocusTarget, restoreFocusSafely, trapFocusWithin } from '../utils/focusTrap';
import { isTopmostModal } from '../utils/modalStack';

const ROLE_STYLE = {
  superadmin: 'bg-brand/10 text-brand-aa border-brand/20',
  owner: 'bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/20',
  admin: 'bg-sky-500/10 text-sky-800 dark:text-sky-300 border-sky-500/20',
  manager: 'bg-teal-500/10 text-teal-800 dark:text-teal-300 border-teal-500/20',
  member: 'bg-slate-500/10 text-slate-700 dark:text-zinc-300 border-slate-500/20',
  operator: 'bg-slate-100 text-slate-700 dark:bg-zinc-800 dark:text-zinc-300 border-slate-200 dark:border-zinc-700',
  viewer: 'bg-slate-50 text-slate-600 dark:bg-zinc-900 dark:text-zinc-400 border-slate-200 dark:border-zinc-700',
  collaborator: 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-500/20',
};

const fieldClass =
  'min-h-[44px] w-full px-3.5 py-2.5 bg-white dark:bg-[#111113] border border-slate-200 dark:border-zinc-800 rounded-xl text-sm font-semibold text-slate-900 dark:text-[#fafafa] placeholder:text-slate-400 dark:placeholder:text-zinc-500 transition-colors hover:border-slate-300 dark:hover:border-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:border-brand disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-zinc-900 aria-[invalid=true]:border-rose-500 aria-[invalid=true]:focus-visible:ring-rose-500';
const btnPrimaryClass =
  'min-h-[44px] px-4 py-2.5 rounded-xl bg-brand hover:bg-brand-dark text-brand-fg font-bold text-xs uppercase tracking-wider inline-flex items-center justify-center gap-2 shadow-sm transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#111113] disabled:opacity-60 disabled:cursor-not-allowed';
const btnSecondaryClass =
  'min-h-[44px] px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] text-slate-700 dark:text-[#fafafa] font-bold text-xs uppercase tracking-wider inline-flex items-center justify-center gap-2 transition-colors hover:bg-slate-50 dark:hover:bg-zinc-800 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#111113] disabled:opacity-60 disabled:cursor-not-allowed';
const btnIconClass =
  'min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] text-slate-600 dark:text-zinc-300 transition-colors hover:bg-slate-50 dark:hover:bg-zinc-800 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60 disabled:cursor-not-allowed';

const rolesForTenant = (tenantId) =>
  tenantId === MASTER_TENANT ? ['superadmin'] : [...TENANT_ROLES, 'collaborator'];

const toDate = (value) => (value?.toDate ? value.toDate() : null);

const NexusUserManager = () => {
  const { currentUser, resetPassword } = useAuth();
  const confirm = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();

  const [users, setUsers] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const searchTerm = searchParams.get('q') || '';
  const roleFilter = searchParams.get('papel') || 'ALL';
  const tenantFilter = searchParams.get('empresa') || 'ALL';

  const [editingUser, setEditingUser] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', role: 'member', status: 'active', tenantId: '' });
  const [editFieldErrors, setEditFieldErrors] = useState({});
  const [editError, setEditError] = useState('');
  const [deletingUser, setDeletingUser] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionUserId, setActionUserId] = useState(null);
  const [resettingEmail, setResettingEmail] = useState(null);

  const editTitleId = useId();
  const deleteTitleId = useId();
  const editDialogRef = useRef(null);
  const editNameInputRef = useRef(null);
  const editPreviousFocusRef = useRef(null);
  const deleteDialogRef = useRef(null);
  const deleteCancelBtnRef = useRef(null);
  const deletePreviousFocusRef = useRef(null);
  const isMountedRef = useRef(true);
  const loadSeqRef = useRef(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const updateParam = useCallback((key, value, defaultVal = '') => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value === null || value === undefined || value === '' || value === defaultVal) {
        next.delete(key);
      } else {
        next.set(key, value);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const loadData = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setLoadError('');
    try {
      const [tenantsSnap, usersSnap] = await Promise.all([
        getDocs(collection(db, 'tenants')),
        getDocs(collection(db, 'users')),
      ]);
      if (!isMountedRef.current || seq !== loadSeqRef.current) return;
      const tenantsList = tenantsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const names = Object.fromEntries(tenantsList.map((t) => [t.id, t.companyName || t.id]));
      setTenants(tenantsList.sort((a, b) => (a.companyName || '').localeCompare(b.companyName || '')));
      setUsers(
        usersSnap.docs
          .map((d) => {
            const data = d.data();
            return {
              id: d.id,
              ...data,
              companyName: data.tenantId === MASTER_TENANT ? 'Nexus ITAM (master)' : names[data.tenantId] || (data.tenantId ? `${data.tenantId} (legada)` : 'Sem empresa'),
            };
          })
          .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
      );
    } catch (error) {
      console.error('Erro ao carregar usuários:', error);
      if (!isMountedRef.current || seq !== loadSeqRef.current) return;
      setLoadError(describeFirebaseError(error, 'Falha ao carregar a lista de acessos.'));
      toast.error('Falha ao carregar a lista de acessos.');
    } finally {
      if (isMountedRef.current && seq === loadSeqRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const closeEditModal = useCallback(() => {
    if (busy) return;
    setEditingUser(null);
    setEditFieldErrors({});
    setEditError('');
  }, [busy]);

  const closeDeleteModal = useCallback(() => {
    if (busy) return;
    setDeletingUser(null);
  }, [busy]);

  const busyRef = useRef(busy);
  busyRef.current = busy;
  const closeEditModalRef = useRef(closeEditModal);
  closeEditModalRef.current = closeEditModal;
  const closeDeleteModalRef = useRef(closeDeleteModal);
  closeDeleteModalRef.current = closeDeleteModal;
  const editingUserId = editingUser?.id || '';
  const deletingUserId = deletingUser?.id || '';

  useEffect(() => {
    if (!editingUserId) return undefined;
    const container = editDialogRef.current;
    editPreviousFocusRef.current = captureFocusTarget(container);

    const raf = requestAnimationFrame(() => {
      if (editNameInputRef.current) editNameInputRef.current.focus();
      else container?.focus();
    });

    const onKeyDown = (event) => {
      if (!isTopmostModal(container)) return;
      if (event.key === 'Escape') {
        if (busyRef.current) return;
        event.preventDefault();
        closeEditModalRef.current?.();
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
      const previous = editPreviousFocusRef.current;
      editPreviousFocusRef.current = null;
      restoreFocusSafely(previous, null, container);
    };
  }, [editingUserId]);

  useEffect(() => {
    if (!deletingUserId) return undefined;
    const container = deleteDialogRef.current;
    deletePreviousFocusRef.current = captureFocusTarget(container);

    const raf = requestAnimationFrame(() => {
      if (deleteCancelBtnRef.current) deleteCancelBtnRef.current.focus();
      else container?.focus();
    });

    const onKeyDown = (event) => {
      if (!isTopmostModal(container)) return;
      if (event.key === 'Escape') {
        if (busyRef.current) return;
        event.preventDefault();
        closeDeleteModalRef.current?.();
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
      const previous = deletePreviousFocusRef.current;
      deletePreviousFocusRef.current = null;
      restoreFocusSafely(previous, null, container);
    };
  }, [deletingUserId]);

  const filteredUsers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return users.filter((u) => {
      if (term && ![u.name, u.email, u.id, u.companyName].filter(Boolean).join(' ').toLowerCase().includes(term)) return false;
      if (roleFilter !== 'ALL' && u.role !== roleFilter) return false;
      if (tenantFilter !== 'ALL' && u.tenantId !== tenantFilter) return false;
      return true;
    });
  }, [users, searchTerm, roleFilter, tenantFilter]);

  const kpis = useMemo(() => {
    const blocked = users.filter((u) => isUserBlocked(u.status)).length;
    return {
      total: users.length,
      active: users.length - blocked,
      blocked,
      companies: tenants.length,
    };
  }, [users, tenants.length]);

  const isSelf = (user) => user.id === currentUser?.uid;

  const handleSendPasswordReset = async (email) => {
    if (!email || resettingEmail) return;
    setResettingEmail(email);
    try {
      await resetPassword(email);
      if (isMountedRef.current) toast.success(`E-mail de redefinição enviado para ${email}.`);
    } catch (error) {
      if (isMountedRef.current) toast.error(describeFirebaseError(error, 'Erro ao enviar redefinição de senha.'));
    } finally {
      if (isMountedRef.current) setResettingEmail(null);
    }
  };

  const handleToggleStatus = async (user) => {
    if (actionUserId || busy) return;
    const suspend = !isUserBlocked(user.status);
    const verb = suspend ? 'Suspender' : 'Reativar';
    const ok = await confirm({
      title: `${verb} Acesso`,
      message: `${verb} o acesso de ${user.name || user.email}?`,
      danger: suspend,
      confirmLabel: verb,
    });
    if (!ok || !isMountedRef.current) return;
    setActionUserId(user.id);
    try {
      await updateDoc(doc(db, 'users', user.id), { status: suspend ? 'suspended' : 'active', updatedAt: serverTimestamp() });
      if (!isMountedRef.current) return;
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, status: suspend ? 'suspended' : 'active' } : u)));
      toast.success(suspend ? 'Usuário suspenso: o acesso é bloqueado imediatamente.' : 'Usuário reativado.');
    } catch (error) {
      if (isMountedRef.current) toast.error(describeFirebaseError(error, 'Erro ao alterar status.'));
    } finally {
      if (isMountedRef.current) setActionUserId(null);
    }
  };

  const handleOpenEdit = (user) => {
    setEditFieldErrors({});
    setEditError('');
    setEditingUser(user);
    setEditForm({
      name: user.name || '',
      role: user.role || 'member',
      status: user.status || 'active',
      tenantId: user.tenantId || '',
    });
  };

  const changeEditTenant = (tenantId) => {
    const allowed = rolesForTenant(tenantId);
    setEditForm((prev) => ({ ...prev, tenantId, role: allowed.includes(prev.role) ? prev.role : allowed[allowed.length - 1] }));
    setEditFieldErrors((prev) => ({ ...prev, role: false }));
  };

  const handleUpdateUser = async (e) => {
    e.preventDefault();
    if (busy || !editingUser) return;
    const errs = {};
    if (!String(editForm.name || '').trim()) errs.name = true;
    if (!rolesForTenant(editForm.tenantId).includes(editForm.role)) errs.role = true;
    if (Object.keys(errs).length > 0) {
      setEditFieldErrors(errs);
      const msg = errs.name ? 'Informe o nome do usuário.' : 'Papel inválido para esta empresa.';
      setEditError(msg);
      toast.error(msg);
      return;
    }
    setEditFieldErrors({});
    setEditError('');
    setBusy(true);
    try {
      await updateDoc(doc(db, 'users', editingUser.id), { ...editForm, name: editForm.name.trim(), updatedAt: serverTimestamp() });
      if (!isMountedRef.current) return;
      toast.success('Usuário atualizado.');
      setEditingUser(null);
      loadData();
    } catch (error) {
      if (!isMountedRef.current) return;
      const msg = describeFirebaseError(error, 'Erro ao atualizar o usuário.');
      setEditError(msg);
      toast.error(msg);
    } finally {
      if (isMountedRef.current) setBusy(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!deletingUser || busy) return;
    setBusy(true);
    try {
      await deleteDoc(doc(db, 'users', deletingUser.id));
      if (!isMountedRef.current) return;
      toast.success('Perfil removido. A conta de login fica sem acesso a qualquer empresa.');
      setDeletingUser(null);
      loadData();
    } catch (error) {
      if (isMountedRef.current) toast.error(describeFirebaseError(error, 'Erro ao remover o usuário.'));
    } finally {
      if (isMountedRef.current) setBusy(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto pb-24 space-y-6 animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-[#111113] rounded-2xl p-5 border border-slate-200/90 dark:border-zinc-800 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand/10 border border-brand/20 text-brand-aa flex items-center justify-center shrink-0">
            <Users size={20} aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-[#fafafa] tracking-tight">Acessos globais</h1>
            <p className="text-xs text-slate-600 dark:text-zinc-400 mt-0.5">Usuários de todas as empresas: papéis, status e senhas.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={loadData}
          disabled={loading}
          aria-label="Recarregar lista de acessos"
          title="Recarregar"
          className={btnIconClass}
        >
          <RefreshCcw size={15} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
        </button>
      </div>

      {/* RESUMO KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiTile
          icon={Users}
          label="Total de usuários"
          value={kpis.total.toLocaleString('pt-BR')}
          hint="Contas vinculadas na plataforma"
        />
        <KpiTile
          icon={CheckCircle}
          tone="bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400"
          label="Acessos ativos"
          value={kpis.active.toLocaleString('pt-BR')}
          hint="Operando normalmente"
        />
        <KpiTile
          icon={XCircle}
          tone="bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400"
          label="Acessos suspensos"
          value={kpis.blocked.toLocaleString('pt-BR')}
          hint="Bloqueados nas regras do banco"
        />
        <KpiTile
          icon={Building2}
          tone="bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400"
          label="Empresas cadastradas"
          value={kpis.companies.toLocaleString('pt-BR')}
          hint="Multi-tenant isolados"
        />
      </div>

      {/* Aviso LGPD de Minimização de Dados */}
      <div className="p-3.5 rounded-xl bg-zinc-900 dark:bg-[#111113] border border-zinc-800 text-xs text-zinc-300 flex items-center gap-3">
        <ShieldCheck size={18} className="text-emerald-400 shrink-0" aria-hidden="true" />
        <div className="leading-relaxed">
          <strong className="text-[#fafafa] font-bold">Privacidade &amp; LGPD (Art. 6º, III):</strong> Visão administrativa restrita à gestão de acesso. Dados sensíveis e telemetria de tela de colaboradores são tecnicamente isolados para proteção da privacidade dos clientes e colaboradores das organizações.
        </div>
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
              <h2 className="text-sm font-bold text-rose-900 dark:text-rose-200">Erro ao carregar acessos globais</h2>
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

      {/* FILTROS */}
      <div className="bg-white dark:bg-[#111113] rounded-2xl border border-slate-200/90 dark:border-zinc-800 p-4 shadow-sm flex flex-col md:flex-row gap-3 items-stretch md:items-center">
        <div className="relative w-full md:flex-1">
          <label htmlFor="nu-search" className="sr-only">Pesquisar usuários</label>
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-zinc-500" aria-hidden="true" />
          <input
            id="nu-search"
            name="q"
            type="search"
            placeholder="Pesquisar por nome, e-mail, empresa ou UID…"
            value={searchTerm}
            onChange={(e) => updateParam('q', e.target.value, '')}
            className={`${fieldClass} pl-10 text-xs`}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <div>
            <label htmlFor="nu-role-filter" className="sr-only">Filtrar por papel</label>
            <select
              id="nu-role-filter"
              name="papel"
              value={roleFilter}
              onChange={(e) => updateParam('papel', e.target.value, 'ALL')}
              className={`${fieldClass} md:w-44 text-xs cursor-pointer`}
            >
              <option value="ALL">Todos os papéis</option>
              {['superadmin', ...TENANT_ROLES, 'collaborator'].map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="nu-tenant-filter" className="sr-only">Filtrar por empresa</label>
            <select
              id="nu-tenant-filter"
              name="empresa"
              value={tenantFilter}
              onChange={(e) => updateParam('empresa', e.target.value, 'ALL')}
              className={`${fieldClass} md:w-56 text-xs cursor-pointer`}
            >
              <option value="ALL">Todas as empresas</option>
              <option value={MASTER_TENANT}>Nexus ITAM (master)</option>
              {tenants.map((t) => <option key={t.id} value={t.id}>{t.companyName || t.id}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-[#111113] rounded-2xl border border-slate-200/90 dark:border-zinc-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-[#09090b] text-slate-500 dark:text-zinc-400 text-xs uppercase font-black tracking-wider border-b border-slate-200 dark:border-zinc-800">
                <th className="p-4 pl-6">Usuário</th>
                <th className="p-4">Empresa</th>
                <th className="p-4 text-center">Papel</th>
                <th className="p-4 text-center">Status</th>
                <th className="p-4">Último acesso</th>
                <th className="p-4 pr-6 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="text-xs font-semibold text-slate-700 dark:text-zinc-200">
              {loading && users.length === 0 ? (
                <tr>
                  <td colSpan="6" className="p-12 text-center">
                    <div role="status" className="flex flex-col items-center gap-3 text-slate-500 dark:text-zinc-400">
                      <div className="w-8 h-8 border-4 border-brand/20 border-t-brand rounded-full animate-spin" aria-hidden="true" />
                      <span className="text-xs font-bold uppercase tracking-wider">Carregando acessos…</span>
                    </div>
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan="6" className="p-10 text-center text-slate-500 dark:text-zinc-400 font-medium">
                    Nenhum usuário corresponde aos filtros.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => {
                  const blocked = isUserBlocked(user.status);
                  return (
                    <tr
                      key={user.id}
                      className="border-b border-slate-100 dark:border-zinc-800/80 hover:bg-slate-50/70 dark:hover:bg-zinc-800/50 transition-colors"
                    >
                      <td className="p-4 pl-6">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-zinc-900 flex items-center justify-center font-black border border-slate-200 dark:border-zinc-800 text-slate-800 dark:text-[#fafafa] shrink-0">
                            {(user.name || user.email || '?').substring(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="font-extrabold text-slate-900 dark:text-[#fafafa] text-sm truncate">
                              {user.name || 'Usuário sem nome'}{' '}
                              {isSelf(user) && <span className="text-xs font-bold uppercase text-slate-500 dark:text-zinc-400">(você)</span>}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-zinc-400 font-medium flex items-center gap-1 mt-0.5 truncate">
                              <Mail size={12} aria-hidden="true" />
                              <span className="truncate">{user.email}</span>
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        <p className="font-bold text-slate-900 dark:text-[#fafafa] truncate max-w-[200px]">{user.companyName}</p>
                        <p className="text-xs font-mono text-slate-500 dark:text-zinc-400 truncate max-w-[200px]">#{user.tenantId}</p>
                      </td>
                      <td className="p-4 text-center">
                        <span className={`inline-flex px-2.5 py-0.5 rounded text-xs font-black uppercase border ${ROLE_STYLE[user.role] || 'bg-slate-500/10 text-slate-600 dark:text-zinc-300 border-slate-500/20'}`}>
                          {ROLE_LABELS[user.role] || user.role || '—'}
                        </span>
                      </td>
                      <td className="p-4 text-center">
                        {blocked ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-rose-500/10 text-rose-700 dark:text-rose-400 text-xs font-black">
                            <XCircle size={12} aria-hidden="true" /> SUSPENSO
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-emerald-500/10 text-emerald-800 dark:text-emerald-400 text-xs font-black">
                            <CheckCircle size={12} aria-hidden="true" /> ATIVO
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-xs text-slate-600 dark:text-zinc-400 whitespace-nowrap tabular-nums">
                        {relativeDays(toDate(user.lastLoginAt))}
                      </td>
                      <td className="p-4 pr-6 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            disabled={Boolean(resettingEmail)}
                            onClick={() => handleSendPasswordReset(user.email)}
                            title="Enviar redefinição de senha"
                            aria-label={`Enviar redefinição de senha para ${user.name || user.email}`}
                            className={`${btnIconClass} hover:text-sky-600 dark:hover:text-sky-400`}
                          >
                            <KeyRound size={15} aria-hidden="true" />
                          </button>
                          {!isSelf(user) && (
                            <>
                              <button
                                type="button"
                                disabled={actionUserId === user.id || busy}
                                onClick={() => handleToggleStatus(user)}
                                title={blocked ? 'Reativar usuário' : 'Suspender usuário'}
                                aria-label={`${blocked ? 'Reativar' : 'Suspender'} ${user.name || user.email}`}
                                className={`${btnIconClass} ${
                                  blocked
                                    ? 'text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/60 hover:bg-emerald-50 dark:hover:bg-emerald-950/30'
                                    : 'text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-900/60 hover:bg-amber-50 dark:hover:bg-amber-950/30'
                                }`}
                              >
                                {blocked ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenEdit(user)}
                                title="Editar perfil"
                                aria-label={`Editar perfil de ${user.name || user.email}`}
                                className={`${btnIconClass} hover:text-brand-aa`}
                              >
                                <Edit size={15} aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeletingUser(user)}
                                title="Remover perfil"
                                aria-label={`Remover perfil de ${user.name || user.email}`}
                                className={`${btnIconClass} hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30`}
                              >
                                <Trash2 size={15} aria-hidden="true" />
                              </button>
                            </>
                          )}
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

      {/* MODAL DE EDIÇÃO */}
      {editingUser && (
        <div
          className="fixed inset-0 !mt-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4 overscroll-contain animate-fade-in"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) closeEditModal();
          }}
        >
          <div
            ref={editDialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby={editTitleId}
            className="bg-white dark:bg-[#111113] border border-slate-200 dark:border-zinc-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl max-h-[92vh] overflow-y-auto overscroll-contain animate-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 id={editTitleId} className="text-lg font-black text-slate-900 dark:text-[#fafafa]">Editar usuário</h2>
              <button
                type="button"
                disabled={busy}
                onClick={closeEditModal}
                aria-label="Fechar janela de edição de usuário"
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-[#fafafa] hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            {editError && (
              <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
                {editError}
              </p>
            )}

            <form onSubmit={handleUpdateUser} className="space-y-4" noValidate>
              <div>
                <label htmlFor="nu-name" className="block text-xs font-bold text-slate-600 dark:text-zinc-400 uppercase tracking-wider mb-1.5">Nome</label>
                <input
                  ref={editNameInputRef}
                  id="nu-name"
                  name="name"
                  value={editForm.name}
                  aria-invalid={editFieldErrors.name ? 'true' : undefined}
                  onChange={(e) => {
                    setEditForm({ ...editForm, name: e.target.value });
                    if (editFieldErrors.name) setEditFieldErrors((prev) => ({ ...prev, name: false }));
                  }}
                  required
                  className={fieldClass}
                />
              </div>
              <div>
                <label htmlFor="nu-tenant" className="block text-xs font-bold text-slate-600 dark:text-zinc-400 uppercase tracking-wider mb-1.5">Empresa</label>
                <select
                  id="nu-tenant"
                  name="tenantId"
                  value={editForm.tenantId}
                  onChange={(e) => changeEditTenant(e.target.value)}
                  className={`${fieldClass} cursor-pointer`}
                >
                  <option value={MASTER_TENANT}>Nexus ITAM (master)</option>
                  {tenants.map((t) => <option key={t.id} value={t.id}>{t.companyName || t.id}</option>)}
                  {editForm.tenantId && editForm.tenantId !== MASTER_TENANT && !tenants.some((t) => t.id === editForm.tenantId) && (
                    <option value={editForm.tenantId}>{editForm.tenantId} (legada)</option>
                  )}
                </select>
              </div>
              <div>
                <label htmlFor="nu-role" className="block text-xs font-bold text-slate-600 dark:text-zinc-400 uppercase tracking-wider mb-1.5">Papel</label>
                <select
                  id="nu-role"
                  name="role"
                  value={editForm.role}
                  aria-invalid={editFieldErrors.role ? 'true' : undefined}
                  onChange={(e) => {
                    setEditForm({ ...editForm, role: e.target.value });
                    if (editFieldErrors.role) setEditFieldErrors((prev) => ({ ...prev, role: false }));
                  }}
                  className={`${fieldClass} cursor-pointer`}
                >
                  {rolesForTenant(editForm.tenantId).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="nu-status" className="block text-xs font-bold text-slate-600 dark:text-zinc-400 uppercase tracking-wider mb-1.5">Status</label>
                <select
                  id="nu-status"
                  name="status"
                  value={editForm.status}
                  onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                  className={`${fieldClass} cursor-pointer`}
                >
                  <option value="active">Ativo</option>
                  <option value="suspended">Suspenso</option>
                </select>
              </div>
              <p className="text-xs text-slate-600 dark:text-zinc-400">
                Contas com custom claims (definidas pelo script de backend) mantêm o papel e a empresa das claims até serem atualizadas por lá.
              </p>
              <div className="flex gap-3 pt-2">
                <button type="button" disabled={busy} onClick={closeEditModal} className={`flex-1 ${btnSecondaryClass}`}>
                  Cancelar
                </button>
                <button type="submit" disabled={busy} className={`flex-1 ${btnPrimaryClass}`}>
                  <Save size={14} aria-hidden="true" />
                  <span>{busy ? 'Salvando…' : 'Salvar'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL DE CONFIRMAÇÃO DE REMOÇÃO */}
      {deletingUser && (
        <div
          className="fixed inset-0 !mt-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4 overscroll-contain animate-fade-in"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) closeDeleteModal();
          }}
        >
          <div
            ref={deleteDialogRef}
            tabIndex={-1}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={deleteTitleId}
            className="bg-white dark:bg-[#111113] border border-slate-200 dark:border-zinc-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl text-center max-h-[92vh] overflow-y-auto overscroll-contain animate-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <div className="flex justify-end -mt-2 -mr-2 mb-1">
              <button
                type="button"
                disabled={busy}
                onClick={closeDeleteModal}
                aria-label="Fechar confirmação de remoção"
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-[#fafafa] hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="w-14 h-14 bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 rounded-full flex items-center justify-center mx-auto mb-4" aria-hidden="true">
              <XCircle size={28} aria-hidden="true" />
            </div>
            <h3 id={deleteTitleId} className="font-black text-slate-900 dark:text-[#fafafa] text-lg mb-2">Remover perfil</h3>
            <p className="text-xs text-slate-600 dark:text-zinc-400 leading-relaxed mb-6">
              Remover <strong className="text-slate-900 dark:text-[#fafafa]">{deletingUser.name || deletingUser.email}</strong> de <strong>{deletingUser.companyName}</strong>?
              A conta de login continua existindo, mas sem acesso a nenhuma empresa.
            </p>
            <div className="flex gap-3">
              <button ref={deleteCancelBtnRef} type="button" disabled={busy} onClick={closeDeleteModal} className={`flex-1 ${btnSecondaryClass}`}>
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDeleteUser}
                disabled={busy}
                className="flex-1 min-h-[44px] px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold text-xs uppercase tracking-wider shadow-sm transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#111113] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {busy ? 'Removendo…' : 'Remover'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NexusUserManager;
