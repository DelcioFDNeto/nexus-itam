// src/pages/UserManager.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  KeyRound,
  Link2,
  Mail,
  Pause,
  Play,
  RefreshCcw,
  Shield,
  ShieldCheck,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { db } from '../services/firebase';
import { useAuth } from '../contexts/AuthContext';
import {
  assignableRoles,
  canManageMember,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  TENANT_ROLES,
} from '../utils/permissions';
import { formatUsage, isUserBlocked, usageRatio, usageTone } from '../utils/entitlements';
import { assertWithinLimit, describeFirebaseError } from '../services/tenantService';
import ManagerSkeleton from '../components/dashboard/ManagerSkeleton';
import { useConfirm } from '../components/ConfirmDialog';

const INVITE_TTL_DAYS = 7;

const toDate = (value) => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDate = (value) => {
  const date = toDate(value);
  return date ? date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';
};

const ROLE_BADGE = {
  owner: 'bg-zinc-900 text-[#fafafa] dark:bg-[#fafafa] dark:text-zinc-900',
  admin: 'bg-brand text-brand-fg',
  manager: 'bg-brand/10 text-brand-aa border border-brand/20',
  member: 'bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300',
  operator: 'bg-slate-100 text-slate-700 dark:bg-zinc-800 dark:text-zinc-200',
  viewer: 'bg-slate-50 text-slate-600 border border-slate-200 dark:bg-zinc-900 dark:text-zinc-400 dark:border-zinc-700',
};

const RoleBadge = ({ role }) => (
  <span className={`px-2 py-1 text-xs font-black rounded uppercase tracking-wider whitespace-nowrap ${ROLE_BADGE[role] || ROLE_BADGE.viewer}`}>
    {ROLE_LABELS[role] || role || 'Sem papel'}
  </span>
);

const inviteLink = (invite, companyName) => {
  const params = new URLSearchParams({ email: invite.email, empresa: companyName || '' });
  return `${window.location.origin}/convite/${invite.id}?${params.toString()}`;
};

const fieldClass =
  'min-h-[44px] w-full px-3.5 py-2 text-xs sm:text-sm rounded-xl bg-white dark:bg-[#111113] border border-slate-200 dark:border-zinc-800 font-medium text-slate-900 dark:text-[#fafafa] placeholder:text-slate-400 dark:placeholder:text-zinc-500 transition-colors hover:border-slate-300 dark:hover:border-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:border-brand disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-zinc-900 aria-[invalid=true]:border-rose-500 aria-[invalid=true]:focus-visible:ring-rose-500';
const btnPrimaryClass =
  'min-h-[44px] px-4 py-2 rounded-xl bg-brand hover:bg-brand-dark text-brand-fg font-semibold text-xs inline-flex items-center justify-center gap-1.5 shadow-sm transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#111113] disabled:opacity-60 disabled:cursor-not-allowed';
const btnSecondaryClass =
  'min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] text-slate-700 dark:text-[#fafafa] font-semibold text-xs inline-flex items-center justify-center gap-1.5 transition-colors hover:bg-slate-50 dark:hover:bg-zinc-800 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60 disabled:cursor-not-allowed';
const btnIconClass =
  'min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] text-slate-600 dark:text-zinc-300 transition-colors hover:bg-slate-50 dark:hover:bg-zinc-800 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60 disabled:cursor-not-allowed';

const UserManager = () => {
  const { currentUser } = useAuth();
  const confirm = useConfirm();
  const tenantId = currentUser?.tenantId;
  const companyName = currentUser?.companyName;

  const [users, setUsers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const roles = useMemo(() => assignableRoles(currentUser), [currentUser]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteEmailError, setInviteEmailError] = useState('');
  const [inviteRole, setInviteRole] = useState('operator');
  const [isInviting, setIsInviting] = useState(false);
  const [lastInvite, setLastInvite] = useState(null);
  const isMountedRef = useRef(true);
  const loadSeqRef = useRef(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    if (!tenantId) {
      setUsers([]);
      setInvites([]);
      setLoadError('');
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError('');
    try {
      const [usersSnap, invitesSnap] = await Promise.all([
        getDocs(query(collection(db, 'users'), where('tenantId', '==', tenantId))),
        getDocs(query(collection(db, 'invites'), where('tenantId', '==', tenantId))),
      ]);
      if (!isMountedRef.current || seq !== loadSeqRef.current) return;
      setUsers(
        usersSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => TENANT_ROLES.indexOf(a.role) - TENANT_ROLES.indexOf(b.role) || (a.name || '').localeCompare(b.name || '')),
      );
      setInvites(
        invitesSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((i) => i.status === 'pending')
          .sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0)),
      );
    } catch (error) {
      console.error(error);
      if (!isMountedRef.current || seq !== loadSeqRef.current) return;
      setLoadError(describeFirebaseError(error, 'Erro ao buscar membros da equipe.'));
      toast.error('Erro ao buscar membros da equipe.');
    } finally {
      if (isMountedRef.current && seq === loadSeqRef.current) {
        setLoading(false);
      }
    }
  }, [tenantId]);

  useEffect(() => {
    load();
  }, [load]);

  const maxUsers = currentUser?.entitlements?.maxUsers ?? null;
  const seatsUsed = users.length + invites.filter((i) => !(toDate(i.expiresAt) < new Date())).length;
  const seatTone = usageTone(usageRatio(seatsUsed, maxUsers));

  const copy = async (text, message = 'Link copiado.') => {
    try {
      await navigator.clipboard.writeText(text);
      if (isMountedRef.current) toast.success(message);
    } catch {
      if (isMountedRef.current) toast.error('Não foi possível copiar. Selecione e copie o link manualmente.');
    }
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    if (isInviting) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      const msg = 'Informe um e-mail corporativo válido.';
      setInviteEmailError(msg);
      toast.error(msg);
      return;
    }

    if (users.some((u) => (u.email || '').toLowerCase() === email)) {
      const msg = 'Este e-mail já faz parte da equipe.';
      setInviteEmailError(msg);
      toast.error(msg);
      return;
    }
    const existing = invites.find((i) => i.email === email && !(toDate(i.expiresAt) < new Date()));
    if (existing) {
      setInviteEmailError('');
      setLastInvite(existing);
      toast.info('Já existe um convite pendente para este e-mail. O link está abaixo.');
      return;
    }

    setInviteEmailError('');
    setIsInviting(true);
    try {
      await assertWithinLimit(currentUser, 'users', 1);
      const inviteData = {
        email,
        role: inviteRole,
        tenantId,
        companyName: companyName || '',
        invitedBy: currentUser.email,
        status: 'pending',
        createdAt: serverTimestamp(),
        expiresAt: Timestamp.fromDate(new Date(Date.now() + INVITE_TTL_DAYS * 86400000)),
      };
      const docRef = await addDoc(collection(db, 'invites'), inviteData);
      if (!isMountedRef.current) return;
      const created = { id: docRef.id, ...inviteData, createdAt: new Date() };
      setInvites((prev) => [created, ...prev]);
      setLastInvite(created);
      setInviteEmail('');
      // O sistema nao envia e-mail sozinho (nao ha backend): o link fica pronto
      // para copiar ou abrir no cliente de e-mail do administrador.
      toast.success('Convite criado. Envie o link ao colaborador.');
    } catch (error) {
      console.error(error);
      if (isMountedRef.current) toast.error(describeFirebaseError(error, 'Erro ao criar convite.'));
    } finally {
      if (isMountedRef.current) setIsInviting(false);
    }
  };

  const handleRevokeInvite = async (invite) => {
    if (busyId) return;
    const ok = await confirm({
      title: 'Revogar Convite',
      message: `Revogar o convite de ${invite.email}? O link deixará de funcionar.`,
      danger: true,
      confirmLabel: 'Revogar',
    });
    if (!ok || !isMountedRef.current) return;
    setBusyId(invite.id);
    try {
      await deleteDoc(doc(db, 'invites', invite.id));
      if (!isMountedRef.current) return;
      setInvites((prev) => prev.filter((i) => i.id !== invite.id));
      if (lastInvite?.id === invite.id) setLastInvite(null);
      toast.success('Convite revogado.');
    } catch (error) {
      console.error(error);
      if (isMountedRef.current) toast.error(describeFirebaseError(error, 'Erro ao revogar convite.'));
    } finally {
      if (isMountedRef.current) setBusyId(null);
    }
  };

  const updateMember = async (member, changes, successMessage) => {
    if (busyId) return;
    setBusyId(member.id);
    try {
      await updateDoc(doc(db, 'users', member.id), { ...changes, updatedAt: serverTimestamp() });
      if (!isMountedRef.current) return;
      setUsers((prev) => prev.map((u) => (u.id === member.id ? { ...u, ...changes } : u)));
      toast.success(successMessage);
    } catch (error) {
      console.error(error);
      if (isMountedRef.current) toast.error(describeFirebaseError(error, 'Não foi possível atualizar o membro.'));
    } finally {
      if (isMountedRef.current) setBusyId(null);
    }
  };

  const handleChangeRole = async (member, role) => {
    if (role === member.role || busyId) return;
    const ok = await confirm({
      title: 'Alterar Papel',
      message: `Alterar ${member.name || member.email} para ${ROLE_LABELS[role]}?`,
      confirmLabel: 'Alterar',
    });
    if (!ok || !isMountedRef.current) return;
    updateMember(member, { role }, 'Nível de acesso atualizado.');
  };

  const handleToggleStatus = async (member) => {
    if (busyId) return;
    const suspend = !isUserBlocked(member.status);
    const verb = suspend ? 'Suspender' : 'Reativar';
    const ok = await confirm({
      title: `${verb} Acesso`,
      message: `${verb} o acesso de ${member.name || member.email}?`,
      danger: suspend,
      confirmLabel: verb,
    });
    if (!ok || !isMountedRef.current) return;
    updateMember(
      member,
      { status: suspend ? 'suspended' : 'active' },
      suspend ? 'Acesso suspenso. A pessoa perde o acesso imediatamente.' : 'Acesso reativado.',
    );
  };

  const handleRemove = async (member) => {
    if (busyId) return;
    const ok = await confirm({
      title: 'Remover Membro',
      message: `Remover ${member.name || member.email} da empresa? A conta de login continua existindo, mas sem acesso aos dados.`,
      danger: true,
      confirmLabel: 'Remover',
    });
    if (!ok || !isMountedRef.current) return;
    setBusyId(member.id);
    try {
      await deleteDoc(doc(db, 'users', member.id));
      if (!isMountedRef.current) return;
      setUsers((prev) => prev.filter((u) => u.id !== member.id));
      toast.success('Membro removido da empresa.');
    } catch (error) {
      console.error(error);
      if (isMountedRef.current) toast.error(describeFirebaseError(error, 'Não foi possível remover o membro.'));
    } finally {
      if (isMountedRef.current) setBusyId(null);
    }
  };

  if (loading) return <ManagerSkeleton />;

  return (
    <div className="max-w-6xl mx-auto pb-24 animate-fade-in space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-[#111113] rounded-2xl p-5 border border-slate-200/90 dark:border-zinc-800 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand/10 border border-brand/20 text-brand-aa flex items-center justify-center shrink-0">
            <Shield size={20} aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-[#fafafa] tracking-tight">Gestão de Acessos</h1>
            <p className="text-xs text-slate-600 dark:text-zinc-400 mt-0.5">
              Quem acessa o Nexus ITAM de {companyName || 'sua empresa'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="min-w-[220px] rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-[#09090b] px-3.5 py-2.5">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-600 dark:text-zinc-400 gap-3">
              <span className="flex items-center gap-1.5"><Users size={13} aria-hidden="true" /> Usuários do plano</span>
              <span className="text-slate-900 dark:text-[#fafafa] font-mono tabular-nums">{formatUsage(seatsUsed, maxUsers)}</span>
            </div>
            {maxUsers !== null && (
              <div className="mt-2 h-1.5 rounded-full bg-slate-200 dark:bg-zinc-800 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-[width] duration-300 ${seatTone === 'critical' ? 'bg-rose-500' : seatTone === 'warning' ? 'bg-amber-500' : 'bg-brand'}`}
                  style={{ width: `${Math.min(100, usageRatio(seatsUsed, maxUsers) * 100)}%` }}
                />
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            aria-label="Recarregar membros e convites"
            title="Recarregar"
            className={btnIconClass}
          >
            <RefreshCcw size={16} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
          </button>
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
              <h2 className="text-sm font-bold text-rose-900 dark:text-rose-200">Erro ao carregar equipe</h2>
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          {/* Membros */}
          <section className="bg-white dark:bg-[#111113] rounded-2xl p-6 border border-slate-200/90 dark:border-zinc-800 shadow-sm">
            <h2 className="text-sm font-black text-slate-900 dark:text-[#fafafa] mb-5 uppercase tracking-wider flex items-center gap-2">
              <span>Membros</span>
              <span className="bg-slate-100 text-slate-700 dark:bg-zinc-800 dark:text-zinc-300 px-2.5 py-0.5 rounded-full text-xs tabular-nums">
                {users.length}
              </span>
            </h2>

            {users.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-500 dark:text-zinc-400 border-2 border-dashed border-slate-200 dark:border-zinc-800 rounded-xl">
                Nenhum membro encontrado nesta empresa.
              </div>
            ) : (
              <ul className="space-y-3">
                {users.map((member) => {
                  const manageable = canManageMember(currentUser, member);
                  const blocked = isUserBlocked(member.status);
                  const isSelf = member.id === currentUser?.uid;
                  const roleSelectId = `member-role-${member.id}`;
                  return (
                    <li
                      key={member.id}
                      className={`[content-visibility:auto] [contain-intrinsic-size:auto_56px] flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border rounded-2xl transition-colors ${
                        blocked
                          ? 'border-amber-200 bg-amber-50/60 dark:border-amber-900/50 dark:bg-amber-950/20'
                          : 'border-slate-200/80 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-900/60'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 shrink-0 rounded-full bg-brand/10 text-brand-aa flex items-center justify-center font-black text-lg">
                          {(member.name || member.email || '?').charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-900 dark:text-[#fafafa] truncate">
                            {member.name || 'Usuário Nexus'}{' '}
                            {isSelf && <span className="text-xs font-black text-slate-500 dark:text-zinc-400 uppercase">(você)</span>}
                          </p>
                          <p className="text-xs text-slate-600 dark:text-zinc-400 font-medium truncate">{member.email}</p>
                          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5 flex items-center gap-1.5 tabular-nums">
                            <Clock size={12} aria-hidden="true" />
                            <span>Último acesso: {formatDate(member.lastLoginAt)}</span>
                            {blocked && <span className="ml-1 font-black uppercase text-amber-700 dark:text-amber-400">Suspenso</span>}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 sm:justify-end flex-wrap">
                        {manageable ? (
                          <div>
                            <label htmlFor={roleSelectId} className="sr-only">
                              Papel de {member.name || member.email}
                            </label>
                            <select
                              id={roleSelectId}
                              name={`role_${member.id}`}
                              value={member.role}
                              disabled={busyId === member.id}
                              onChange={(e) => handleChangeRole(member, e.target.value)}
                              className="min-h-[44px] text-xs font-bold border border-slate-200 dark:border-zinc-800 rounded-xl px-3 py-2 bg-white dark:bg-[#111113] text-slate-700 dark:text-[#fafafa] cursor-pointer transition-colors hover:border-slate-300 dark:hover:border-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                              {/* Papel atual sempre visivel, mesmo fora da lista atribuivel */}
                              {!roles.includes(member.role) && <option value={member.role}>{ROLE_LABELS[member.role] || member.role}</option>}
                              {roles.map((role) => (
                                <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <RoleBadge role={member.role} />
                        )}

                        {manageable && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleToggleStatus(member)}
                              disabled={busyId === member.id}
                              title={blocked ? 'Reativar acesso' : 'Suspender acesso'}
                              aria-label={`${blocked ? 'Reativar' : 'Suspender'} acesso de ${member.name || member.email}`}
                              className={`${btnIconClass} ${
                                blocked
                                  ? 'text-emerald-700 border-emerald-200 hover:bg-emerald-50 dark:text-emerald-400 dark:border-emerald-900 dark:hover:bg-emerald-950/40'
                                  : 'text-amber-700 border-amber-200 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-900 dark:hover:bg-amber-950/40'
                              }`}
                            >
                              {blocked ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemove(member)}
                              disabled={busyId === member.id}
                              title="Remover da empresa"
                              aria-label={`Remover ${member.name || member.email} da empresa`}
                              className={`${btnIconClass} border-rose-200 text-rose-600 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950/40 focus-visible:ring-rose-500`}
                            >
                              <UserMinus size={15} aria-hidden="true" />
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Convites pendentes */}
          {invites.length > 0 && (
            <section className="bg-white dark:bg-[#111113] rounded-2xl p-6 border border-slate-200/90 dark:border-zinc-800 shadow-sm">
              <h2 className="text-sm font-black mb-5 uppercase tracking-wider text-slate-600 dark:text-zinc-400">Convites pendentes</h2>
              <ul className="space-y-3">
                {invites.map((invite) => {
                  const expiresAt = toDate(invite.expiresAt);
                  const expired = expiresAt && expiresAt < new Date();
                  return (
                    <li
                      key={invite.id}
                      className="[content-visibility:auto] [contain-intrinsic-size:auto_56px] flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 border border-slate-200/80 dark:border-zinc-800 rounded-xl bg-slate-50 dark:bg-[#09090b]"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-800 dark:text-zinc-200 flex items-center gap-1.5 truncate">
                          <Mail size={13} aria-hidden="true" />
                          <span className="truncate">{invite.email}</span>
                        </p>
                        <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1 uppercase tabular-nums">
                          {ROLE_LABELS[invite.role] || invite.role} ·{' '}
                          {expired ? <span className="text-rose-600 dark:text-rose-400 font-black">Expirado</span> : `válido até ${formatDate(invite.expiresAt)}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {!expired && (
                          <button
                            type="button"
                            onClick={() => copy(inviteLink(invite, companyName))}
                            className={`${btnSecondaryClass} uppercase tracking-wider`}
                          >
                            <Copy size={13} aria-hidden="true" />
                            <span>Copiar link</span>
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={Boolean(busyId)}
                          onClick={() => handleRevokeInvite(invite)}
                          className={`${btnIconClass} text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-900/60 hover:bg-rose-50 dark:hover:bg-rose-950/40 focus-visible:ring-rose-500`}
                          title="Revogar convite"
                          aria-label={`Revogar convite de ${invite.email}`}
                        >
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>

        {/* Convite */}
        <div className="space-y-6">
          <section className="bg-white dark:bg-[#111113] border border-slate-200/90 dark:border-zinc-800 rounded-2xl p-5 shadow-sm">
            <h2 className="text-sm font-bold text-slate-900 dark:text-[#fafafa] mb-1.5 flex items-center gap-2">
              <UserPlus size={16} className="text-brand-aa" aria-hidden="true" /> Convidar membro
            </h2>
            <p className="text-xs text-slate-600 dark:text-zinc-400 mb-4 tabular-nums">
              Gere um link de acesso válido por {INVITE_TTL_DAYS} dias. A pessoa cria a senha e entra direto na empresa.
            </p>

            {roles.length === 0 ? (
              <p className="text-xs font-medium text-slate-600 dark:text-zinc-300 bg-slate-100 dark:bg-zinc-900 rounded-lg p-3">
                Seu perfil não pode convidar membros.
              </p>
            ) : (
              <form onSubmit={handleInvite} className="space-y-3.5" noValidate>
                <div>
                  <label htmlFor="invite-email" className="text-xs font-semibold text-slate-700 dark:text-zinc-300 block mb-1.5">
                    E-mail corporativo
                  </label>
                  <input
                    id="invite-email"
                    name="inviteEmail"
                    type="email"
                    value={inviteEmail}
                    aria-invalid={inviteEmailError ? 'true' : undefined}
                    onChange={(e) => {
                      setInviteEmail(e.target.value);
                      if (inviteEmailError) setInviteEmailError('');
                    }}
                    required
                    placeholder="nome@empresa.com.br"
                    className={fieldClass}
                  />
                  {inviteEmailError && (
                    <p role="alert" className="mt-1 text-xs font-bold text-rose-600 dark:text-rose-400">
                      {inviteEmailError}
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="invite-role" className="text-xs font-semibold text-slate-700 dark:text-zinc-300 block mb-1.5">
                    Nível de acesso
                  </label>
                  <select
                    id="invite-role"
                    name="inviteRole"
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    className={`${fieldClass} cursor-pointer`}
                  >
                    {roles.map((role) => (
                      <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1.5">{ROLE_DESCRIPTIONS[inviteRole]}</p>
                </div>
                <button
                  type="submit"
                  disabled={isInviting}
                  className={`w-full ${btnPrimaryClass}`}
                >
                  {isInviting ? 'Gerando…' : <><Link2 size={15} aria-hidden="true" /> <span>Gerar convite</span></>}
                </button>
              </form>
            )}

            {lastInvite && (
              <div className="mt-4 rounded-xl bg-slate-50 dark:bg-[#09090b] border border-slate-200 dark:border-zinc-800 p-3.5 space-y-2.5">
                <p className="text-xs font-semibold text-slate-700 dark:text-zinc-300 flex items-center gap-1.5">
                  <CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                  <span className="truncate">Link para {lastInvite.email}</span>
                </p>
                <div>
                  <label htmlFor="last-invite-link" className="sr-only">Link do convite</label>
                  <input
                    id="last-invite-link"
                    name="lastInviteLink"
                    readOnly
                    value={inviteLink(lastInvite, companyName)}
                    onFocus={(e) => e.target.select()}
                    className={`${fieldClass} font-mono text-xs`}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => copy(inviteLink(lastInvite, companyName))}
                    className={btnPrimaryClass}
                  >
                    <Copy size={13} aria-hidden="true" />
                    <span>Copiar</span>
                  </button>
                  <a
                    href={`mailto:${lastInvite.email}?subject=${encodeURIComponent(`Convite para o Nexus ITAM${companyName ? ` - ${companyName}` : ''}`)}&body=${encodeURIComponent(`Olá! Você foi convidado(a) para acessar o inventário de TI${companyName ? ` da ${companyName}` : ''} no Nexus ITAM.\n\nCrie sua senha pelo link (válido por ${INVITE_TTL_DAYS} dias):\n${inviteLink(lastInvite, companyName)}`)}`}
                    className={btnSecondaryClass}
                  >
                    <Mail size={13} aria-hidden="true" />
                    <span>E-mail</span>
                  </a>
                </div>
              </div>
            )}
          </section>

          <section className="bg-white dark:bg-[#111113] border border-slate-200/90 dark:border-zinc-800 rounded-2xl p-5 shadow-sm">
            <h2 className="text-xs font-bold text-slate-900 dark:text-[#fafafa] uppercase tracking-wider mb-3 flex items-center gap-2">
              <ShieldCheck size={14} className="text-brand-aa" aria-hidden="true" /> Entendendo os papéis
            </h2>
            <ul className="space-y-3">
              {TENANT_ROLES.map((role) => (
                <li key={role} className="flex gap-2.5 items-start">
                  <RoleBadge role={role} />
                  <p className="text-xs text-slate-600 dark:text-zinc-400 leading-snug">{ROLE_DESCRIPTIONS[role]}</p>
                </li>
              ))}
            </ul>
          </section>

          <section className="bg-brand/5 dark:bg-brand/10 border border-brand/20 rounded-2xl p-5 space-y-2.5">
            <h2 className="text-xs font-black text-slate-900 dark:text-[#fafafa] uppercase tracking-wider flex items-center gap-2">
              <KeyRound size={14} className="text-brand-aa" aria-hidden="true" /> Portal do Colaborador (Vue 3)
            </h2>
            <p className="text-xs text-slate-600 dark:text-zinc-300 leading-relaxed">
              Logins de colaboradores finais para assinatura de termos e Service Desk são cadastrados na central dedicada do Portal.
            </p>
            <Link
              to="/portal-colaboradores"
              className="inline-flex min-h-[44px] items-center gap-1.5 text-xs font-black text-brand-aa hover:underline rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              Gerenciar Acessos do Portal →
            </Link>
          </section>
        </div>
      </div>
    </div>
  );
};

export default UserManager;
