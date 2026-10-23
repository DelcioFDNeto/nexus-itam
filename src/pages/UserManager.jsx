// src/pages/UserManager.jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  CheckCircle2,
  Clock,
  Copy,
  Link2,
  Mail,
  Pause,
  Play,
  Shield,
  ShieldCheck,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react';
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
  owner: 'bg-slate-900 text-white dark:bg-white dark:text-slate-900',
  admin: 'bg-brand text-white',
  manager: 'bg-brand/15 text-brand',
  member: 'bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300',
  operator: 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-gray-200',
  viewer: 'bg-gray-50 text-gray-500 border border-gray-200 dark:bg-slate-800 dark:text-gray-400 dark:border-slate-600',
};

const RoleBadge = ({ role }) => (
  <span className={`px-2 py-1 text-[10px] font-black rounded uppercase tracking-widest whitespace-nowrap ${ROLE_BADGE[role] || ROLE_BADGE.viewer}`}>
    {ROLE_LABELS[role] || role || 'Sem papel'}
  </span>
);

const inviteLink = (invite, companyName) => {
  const params = new URLSearchParams({ email: invite.email, empresa: companyName || '' });
  return `${window.location.origin}/convite/${invite.id}?${params.toString()}`;
};

const UserManager = () => {
  const { currentUser } = useAuth();
  const confirm = useConfirm();
  const tenantId = currentUser?.tenantId;
  const companyName = currentUser?.companyName;

  const [users, setUsers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const roles = useMemo(() => assignableRoles(currentUser), [currentUser]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('operator');
  const [isInviting, setIsInviting] = useState(false);
  const [lastInvite, setLastInvite] = useState(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    try {
      const [usersSnap, invitesSnap] = await Promise.all([
        getDocs(query(collection(db, 'users'), where('tenantId', '==', tenantId))),
        getDocs(query(collection(db, 'invites'), where('tenantId', '==', tenantId))),
      ]);
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
      toast.error('Erro ao buscar membros da equipe.');
    } finally {
      setLoading(false);
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
      toast.success(message);
    } catch {
      toast.error('Não foi possível copiar. Selecione e copie o link manualmente.');
    }
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return;

    if (users.some((u) => (u.email || '').toLowerCase() === email)) {
      toast.error('Este e-mail já faz parte da equipe.');
      return;
    }
    const existing = invites.find((i) => i.email === email && !(toDate(i.expiresAt) < new Date()));
    if (existing) {
      setLastInvite(existing);
      toast.info('Já existe um convite pendente para este e-mail. O link está abaixo.');
      return;
    }

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
      const created = { id: docRef.id, ...inviteData, createdAt: new Date() };
      setInvites((prev) => [created, ...prev]);
      setLastInvite(created);
      setInviteEmail('');
      // O sistema nao envia e-mail sozinho (nao ha backend): o link fica pronto
      // para copiar ou abrir no cliente de e-mail do administrador.
      toast.success('Convite criado. Envie o link ao colaborador.');
    } catch (error) {
      console.error(error);
      toast.error(describeFirebaseError(error, 'Erro ao criar convite.'));
    } finally {
      setIsInviting(false);
    }
  };

  const handleRevokeInvite = async (invite) => {
    const ok = await confirm({
      title: 'Revogar Convite',
      message: `Revogar o convite de ${invite.email}? O link deixará de funcionar.`,
      danger: true,
      confirmLabel: 'Revogar',
    });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, 'invites', invite.id));
      setInvites((prev) => prev.filter((i) => i.id !== invite.id));
      if (lastInvite?.id === invite.id) setLastInvite(null);
      toast.success('Convite revogado.');
    } catch (error) {
      console.error(error);
      toast.error(describeFirebaseError(error, 'Erro ao revogar convite.'));
    }
  };

  const updateMember = async (member, changes, successMessage) => {
    setBusyId(member.id);
    try {
      await updateDoc(doc(db, 'users', member.id), { ...changes, updatedAt: serverTimestamp() });
      setUsers((prev) => prev.map((u) => (u.id === member.id ? { ...u, ...changes } : u)));
      toast.success(successMessage);
    } catch (error) {
      console.error(error);
      toast.error(describeFirebaseError(error, 'Não foi possível atualizar o membro.'));
    } finally {
      setBusyId(null);
    }
  };

  const handleChangeRole = async (member, role) => {
    if (role === member.role) return;
    const ok = await confirm({
      title: 'Alterar Papel',
      message: `Alterar ${member.name || member.email} para ${ROLE_LABELS[role]}?`,
      confirmLabel: 'Alterar',
    });
    if (!ok) return;
    updateMember(member, { role }, 'Nível de acesso atualizado.');
  };

  const handleToggleStatus = async (member) => {
    const suspend = !isUserBlocked(member.status);
    const verb = suspend ? 'Suspender' : 'Reativar';
    const ok = await confirm({
      title: `${verb} Acesso`,
      message: `${verb} o acesso de ${member.name || member.email}?`,
      danger: suspend,
      confirmLabel: verb,
    });
    if (!ok) return;
    updateMember(
      member,
      { status: suspend ? 'suspended' : 'active' },
      suspend ? 'Acesso suspenso. A pessoa perde o acesso imediatamente.' : 'Acesso reativado.',
    );
  };

  const handleRemove = async (member) => {
    const ok = await confirm({
      title: 'Remover Membro',
      message: `Remover ${member.name || member.email} da empresa? A conta de login continua existindo, mas sem acesso aos dados.`,
      danger: true,
      confirmLabel: 'Remover',
    });
    if (!ok) return;
    setBusyId(member.id);
    try {
      await deleteDoc(doc(db, 'users', member.id));
      setUsers((prev) => prev.filter((u) => u.id !== member.id));
      toast.success('Membro removido da empresa.');
    } catch (error) {
      console.error(error);
      toast.error(describeFirebaseError(error, 'Não foi possível remover o membro.'));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <ManagerSkeleton />;

  return (
    <div className="max-w-6xl mx-auto pb-24 animate-fade-in space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200/90 dark:border-slate-800 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-brand/10 border border-brand/20 text-brand flex items-center justify-center shrink-0">
            <Shield size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">Gestão de Acessos</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Quem acessa o Nexus ITAM de {companyName || 'sua empresa'}
            </p>
          </div>
        </div>

        <div className="min-w-[220px] rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 px-3.5 py-2.5">
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1.5"><Users size={13} /> Usuários do plano</span>
            <span className="text-slate-900 dark:text-white font-mono tabular-nums">{formatUsage(seatsUsed, maxUsers)}</span>
          </div>
          {maxUsers !== null && (
            <div className="mt-2 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${seatTone === 'critical' ? 'bg-rose-500' : seatTone === 'warning' ? 'bg-amber-500' : 'bg-brand'}`}
                style={{ width: `${Math.min(100, usageRatio(seatsUsed, maxUsers) * 100)}%` }}
              />
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          {/* Membros */}
          <section className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-gray-100 dark:border-slate-700 shadow-sm">
            <h2 className="text-sm font-black text-gray-900 dark:text-white mb-5 uppercase tracking-wider flex items-center gap-2">
              Membros
              <span className="bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-gray-300 px-2 py-0.5 rounded-full text-[10px]">{users.length}</span>
            </h2>

            <ul className="space-y-3">
              {users.map((member) => {
                const manageable = canManageMember(currentUser, member);
                const blocked = isUserBlocked(member.status);
                const isSelf = member.id === currentUser?.uid;
                return (
                  <li
                    key={member.id}
                    className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border rounded-2xl transition-colors ${
                      blocked
                        ? 'border-amber-200 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20'
                        : 'border-gray-100 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-900/60'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 shrink-0 rounded-full bg-brand/10 text-brand flex items-center justify-center font-black text-lg">
                        {(member.name || member.email || '?').charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-gray-900 dark:text-white truncate">
                          {member.name || 'Usuário Nexus'} {isSelf && <span className="text-[10px] font-black text-gray-400 uppercase">(você)</span>}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 font-medium truncate">{member.email}</p>
                        <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 flex items-center gap-1">
                          <Clock size={10} /> Último acesso: {formatDate(member.lastLoginAt)}
                          {blocked && <span className="ml-2 font-black uppercase text-amber-600 dark:text-amber-400">Suspenso</span>}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 sm:justify-end flex-wrap">
                      {manageable ? (
                        <select
                          value={member.role}
                          disabled={busyId === member.id}
                          onChange={(e) => handleChangeRole(member, e.target.value)}
                          aria-label={`Papel de ${member.name || member.email}`}
                          className="text-xs font-bold border border-gray-200 dark:border-slate-600 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200 outline-none cursor-pointer"
                        >
                          {/* Papel atual sempre visivel, mesmo fora da lista atribuivel */}
                          {!roles.includes(member.role) && <option value={member.role}>{ROLE_LABELS[member.role] || member.role}</option>}
                          {roles.map((role) => (
                            <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                          ))}
                        </select>
                      ) : (
                        <RoleBadge role={member.role} />
                      )}

                      {manageable && (
                        <>
                          <button
                            onClick={() => handleToggleStatus(member)}
                            disabled={busyId === member.id}
                            title={blocked ? 'Reativar acesso' : 'Suspender acesso'}
                            aria-label={blocked ? 'Reativar acesso' : 'Suspender acesso'}
                            className={`p-2 rounded-lg border transition-colors ${blocked ? 'text-green-600 border-green-200 hover:bg-green-50 dark:border-green-900 dark:hover:bg-green-950/40' : 'text-amber-600 border-amber-200 hover:bg-amber-50 dark:border-amber-900 dark:hover:bg-amber-950/40'}`}
                          >
                            {blocked ? <Play size={14} /> : <Pause size={14} />}
                          </button>
                          <button
                            onClick={() => handleRemove(member)}
                            disabled={busyId === member.id}
                            title="Remover da empresa"
                            aria-label="Remover da empresa"
                            className="p-2 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/40 transition-colors"
                          >
                            <UserMinus size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Convites pendentes */}
          {invites.length > 0 && (
            <section className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-gray-100 dark:border-slate-700 shadow-sm">
              <h2 className="text-sm font-black mb-5 uppercase tracking-wider text-gray-500 dark:text-gray-400">Convites pendentes</h2>
              <ul className="space-y-3">
                {invites.map((invite) => {
                  const expiresAt = toDate(invite.expiresAt);
                  const expired = expiresAt && expiresAt < new Date();
                  return (
                    <li key={invite.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 border border-gray-100 dark:border-slate-700 rounded-xl bg-gray-50 dark:bg-slate-900">
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-gray-700 dark:text-gray-200 flex items-center gap-1 truncate"><Mail size={12} /> {invite.email}</p>
                        <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1 uppercase">
                          {ROLE_LABELS[invite.role] || invite.role} ·{' '}
                          {expired ? <span className="text-rose-500 font-black">Expirado</span> : `válido até ${formatDate(invite.expiresAt)}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {!expired && (
                          <button
                            onClick={() => copy(inviteLink(invite, companyName))}
                            className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider border border-gray-200 dark:border-slate-600 text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-slate-800 flex items-center gap-1"
                          >
                            <Copy size={12} /> Copiar link
                          </button>
                        )}
                        <button onClick={() => handleRevokeInvite(invite)} className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors" title="Revogar convite" aria-label="Revogar convite">
                          <Trash2 size={16} />
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
          <section className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-xl p-5 shadow-sm">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-1.5 flex items-center gap-2">
              <UserPlus size={16} className="text-brand" /> Convidar membro
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
              Gere um link de acesso válido por {INVITE_TTL_DAYS} dias. A pessoa cria a senha e entra direto na empresa.
            </p>

            {roles.length === 0 ? (
              <p className="text-xs font-medium text-slate-500 bg-slate-100 dark:bg-slate-800 rounded-lg p-3">Seu perfil não pode convidar membros.</p>
            ) : (
              <form onSubmit={handleInvite} className="space-y-3.5">
                <div>
                  <label htmlFor="invite-email" className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">E-mail corporativo</label>
                  <input
                    id="invite-email"
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    required
                    placeholder="email@empresa.com"
                    className="w-full px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 focus:outline-none focus:border-brand font-medium text-slate-900 dark:text-white placeholder:text-slate-400"
                  />
                </div>
                <div>
                  <label htmlFor="invite-role" className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">Nível de acesso</label>
                  <select
                    id="invite-role"
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 focus:outline-none focus:border-brand font-medium text-slate-900 dark:text-white"
                  >
                    {roles.map((role) => (
                      <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                    ))}
                  </select>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">{ROLE_DESCRIPTIONS[inviteRole]}</p>
                </div>
                <button
                  type="submit"
                  disabled={isInviting}
                  className="w-full py-2.5 bg-brand hover:bg-brand-dark text-white font-semibold rounded-lg transition-colors text-xs flex items-center justify-center gap-1.5 disabled:opacity-60 shadow-sm"
                >
                  {isInviting ? 'Gerando...' : <><Link2 size={15} /> Gerar convite</>}
                </button>
              </form>
            )}

            {lastInvite && (
              <div className="mt-4 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 p-3.5 space-y-2.5">
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <CheckCircle2 size={13} className="text-emerald-500" /> Link para {lastInvite.email}
                </p>
                <input
                  readOnly
                  value={inviteLink(lastInvite, companyName)}
                  onFocus={(e) => e.target.select()}
                  className="w-full rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-2 py-1.5 text-[11px] font-mono text-slate-700 dark:text-slate-300"
                  aria-label="Link do convite"
                />
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => copy(inviteLink(lastInvite, companyName))} className="py-1.5 rounded-md bg-brand hover:bg-brand-dark text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors">
                    <Copy size={12} /> Copiar
                  </button>
                  <a
                    href={`mailto:${lastInvite.email}?subject=${encodeURIComponent(`Convite para o Nexus ITAM${companyName ? ` - ${companyName}` : ''}`)}&body=${encodeURIComponent(`Olá! Você foi convidado(a) para acessar o inventário de TI${companyName ? ` da ${companyName}` : ''} no Nexus ITAM.\n\nCrie sua senha pelo link (válido por ${INVITE_TTL_DAYS} dias):\n${inviteLink(lastInvite, companyName)}`)}`}
                    className="py-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium flex items-center justify-center gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    <Mail size={12} /> E-mail
                  </a>
                </div>
              </div>
            )}
          </section>

          <section className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-xl p-5 shadow-sm">
            <h2 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-3 flex items-center gap-2">
              <ShieldCheck size={14} className="text-brand" /> Entendendo os papéis
            </h2>
            <ul className="space-y-3">
              {TENANT_ROLES.map((role) => (
                <li key={role} className="flex gap-2 items-start">
                  <RoleBadge role={role} />
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-snug">{ROLE_DESCRIPTIONS[role]}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
};

export default UserManager;
