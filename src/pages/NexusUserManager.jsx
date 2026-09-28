// src/pages/NexusUserManager.jsx
// -----------------------------------------------------------------------------
// Acessos de todas as empresas (console Nexus Master).
//
// Mudancas: a protecao da conta master era um e-mail pessoal escrito no codigo
// (e publicado no bundle); agora ninguem altera a PROPRIA conta por aqui. A
// lista de papeis cobre todos os papeis reais, superadmin so existe no tenant
// master, e suspender passou a bloquear de fato (regras do Firestore).
// -----------------------------------------------------------------------------
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { collection, deleteDoc, doc, getDocs, serverTimestamp, updateDoc } from 'firebase/firestore';
import {
  CheckCircle, Edit, KeyRound, Mail, Pause, Play, RefreshCcw, Save, Search, Trash2, Users, X, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { db } from '../services/firebase';
import { useAuth } from '../contexts/AuthContext';
import { describeFirebaseError } from '../services/tenantService';
import { MASTER_TENANT, ROLE_LABELS, TENANT_ROLES } from '../utils/permissions';
import { isUserBlocked } from '../utils/entitlements';
import { relativeDays } from '../utils/consoleMetrics';

const ROLE_STYLE = {
  superadmin: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
  owner: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
  admin: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20',
};

const fieldClass =
  'w-full px-3 py-2.5 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-brand text-sm font-semibold text-gray-900 dark:text-white';

const rolesForTenant = (tenantId) => (tenantId === MASTER_TENANT ? ['superadmin'] : TENANT_ROLES);

const toDate = (value) => (value?.toDate ? value.toDate() : null);

const NexusUserManager = () => {
  const { currentUser, resetPassword } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [users, setUsers] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const tenantFilter = searchParams.get('empresa') || 'ALL';

  const [editingUser, setEditingUser] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', role: 'member', status: 'active', tenantId: '' });
  const [deletingUser, setDeletingUser] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [tenantsSnap, usersSnap] = await Promise.all([
        getDocs(collection(db, 'tenants')),
        getDocs(collection(db, 'users')),
      ]);
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
      toast.error('Falha ao carregar a lista de acessos.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredUsers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return users.filter((u) => {
      if (term && ![u.name, u.email, u.id, u.companyName].filter(Boolean).join(' ').toLowerCase().includes(term)) return false;
      if (roleFilter !== 'ALL' && u.role !== roleFilter) return false;
      if (tenantFilter !== 'ALL' && u.tenantId !== tenantFilter) return false;
      return true;
    });
  }, [users, searchTerm, roleFilter, tenantFilter]);

  const isSelf = (user) => user.id === currentUser?.uid;

  const handleSendPasswordReset = async (email) => {
    try {
      await resetPassword(email);
      toast.success(`E-mail de redefinição enviado para ${email}.`);
    } catch (error) {
      toast.error(describeFirebaseError(error, 'Erro ao enviar redefinição de senha.'));
    }
  };

  const handleToggleStatus = async (user) => {
    const suspend = !isUserBlocked(user.status);
    if (!confirm(`${suspend ? 'Suspender' : 'Reativar'} o acesso de ${user.name || user.email}?`)) return;
    try {
      await updateDoc(doc(db, 'users', user.id), { status: suspend ? 'suspended' : 'active', updatedAt: serverTimestamp() });
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, status: suspend ? 'suspended' : 'active' } : u)));
      toast.success(suspend ? 'Usuário suspenso: o acesso é bloqueado imediatamente.' : 'Usuário reativado.');
    } catch (error) {
      toast.error(describeFirebaseError(error, 'Erro ao alterar status.'));
    }
  };

  const handleOpenEdit = (user) => {
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
  };

  const handleUpdateUser = async (e) => {
    e.preventDefault();
    if (!rolesForTenant(editForm.tenantId).includes(editForm.role)) {
      toast.error('Papel inválido para esta empresa.');
      return;
    }
    setBusy(true);
    try {
      await updateDoc(doc(db, 'users', editingUser.id), { ...editForm, updatedAt: serverTimestamp() });
      toast.success('Usuário atualizado.');
      setEditingUser(null);
      loadData();
    } catch (error) {
      toast.error(describeFirebaseError(error, 'Erro ao atualizar o usuário.'));
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!deletingUser) return;
    setBusy(true);
    try {
      await deleteDoc(doc(db, 'users', deletingUser.id));
      toast.success('Perfil removido. A conta de login fica sem acesso a qualquer empresa.');
      setDeletingUser(null);
      loadData();
    } catch (error) {
      toast.error(describeFirebaseError(error, 'Erro ao remover o usuário.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto pb-24 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900 rounded-3xl p-6 md:p-8 shadow-xl relative overflow-hidden border border-white/5">
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/15 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex items-center gap-4">
          <div className="p-4 bg-white/5 text-indigo-300 rounded-2xl border border-white/10"><Users size={32} /></div>
          <div>
            <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight">Acessos globais</h1>
            <p className="text-slate-400 font-medium text-sm mt-1">Usuários de todas as empresas: papéis, status e senhas.</p>
          </div>
        </div>
        <button onClick={loadData} aria-label="Recarregar" title="Recarregar" className="relative z-10 flex items-center justify-center w-12 h-12 bg-white/5 hover:bg-white/10 text-white rounded-xl transition-all border border-white/10">
          <RefreshCcw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-3xl border border-gray-100 dark:border-slate-700 p-4 shadow-sm flex flex-col md:flex-row gap-3 items-stretch md:items-center">
        <div className="relative w-full md:flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="search"
            placeholder="Pesquisar por nome, e-mail, empresa ou UID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 text-xs bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-brand font-medium text-gray-700 dark:text-slate-200"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label="Filtrar por papel" className="text-xs bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl px-4 py-2.5 font-bold text-gray-600 dark:text-slate-300 cursor-pointer focus:outline-none">
            <option value="ALL">Todos os papéis</option>
            {['superadmin', ...TENANT_ROLES].map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
          <select
            value={tenantFilter}
            onChange={(e) => setSearchParams((prev) => { const n = new URLSearchParams(prev); if (e.target.value === 'ALL') n.delete('empresa'); else n.set('empresa', e.target.value); return n; }, { replace: true })}
            aria-label="Filtrar por empresa"
            className="text-xs bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl px-4 py-2.5 font-bold text-gray-600 dark:text-slate-300 cursor-pointer focus:outline-none max-w-[220px]"
          >
            <option value="ALL">Todas as empresas</option>
            <option value={MASTER_TENANT}>Nexus ITAM (master)</option>
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.companyName || t.id}</option>)}
          </select>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-3xl border border-gray-100 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 dark:bg-slate-900 text-gray-400 text-[10px] uppercase font-black tracking-widest border-b border-gray-100 dark:border-slate-700">
                <th className="p-4 pl-6">Usuário</th>
                <th className="p-4">Empresa</th>
                <th className="p-4 text-center">Papel</th>
                <th className="p-4 text-center">Status</th>
                <th className="p-4">Último acesso</th>
                <th className="p-4 pr-6 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="text-xs font-semibold text-gray-700 dark:text-slate-200">
              {loading && users.length === 0 ? (
                <tr><td colSpan="6" className="p-12 text-center text-gray-400 font-bold uppercase tracking-widest">Carregando...</td></tr>
              ) : filteredUsers.length === 0 ? (
                <tr><td colSpan="6" className="p-8 text-center text-gray-400 font-medium">Nenhum usuário corresponde aos filtros.</td></tr>
              ) : (
                filteredUsers.map((user) => {
                  const blocked = isUserBlocked(user.status);
                  return (
                    <tr key={user.id} className="border-b border-gray-50 dark:border-slate-700/60 hover:bg-gray-50/60 dark:hover:bg-slate-900/40 transition-colors">
                      <td className="p-4 pl-6">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-gray-100 dark:bg-slate-900 flex items-center justify-center font-black border border-gray-200 dark:border-slate-700 shrink-0">
                            {(user.name || user.email || '?').substring(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="font-extrabold text-gray-900 dark:text-white text-sm truncate">
                              {user.name || 'Usuário sem nome'} {isSelf(user) && <span className="text-[9px] font-black uppercase text-gray-400">(você)</span>}
                            </p>
                            <p className="text-[10px] text-gray-400 font-medium flex items-center gap-1 mt-0.5 truncate"><Mail size={11} /> {user.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        <p className="font-bold text-gray-900 dark:text-white truncate max-w-[200px]">{user.companyName}</p>
                        <p className="text-[9px] font-mono text-gray-400 truncate max-w-[200px]">#{user.tenantId}</p>
                      </td>
                      <td className="p-4 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-black uppercase border ${ROLE_STYLE[user.role] || 'bg-slate-500/10 text-slate-500 dark:text-slate-400 border-slate-500/20'}`}>
                          {ROLE_LABELS[user.role] || user.role || '—'}
                        </span>
                      </td>
                      <td className="p-4 text-center">
                        {blocked ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-500/10 text-rose-500 text-[10px] font-black"><XCircle size={12} /> SUSPENSO</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-green-500/10 text-green-600 dark:text-green-400 text-[10px] font-black"><CheckCircle size={12} /> ATIVO</span>
                        )}
                      </td>
                      <td className="p-4 text-[11px] text-gray-500 dark:text-gray-400 whitespace-nowrap">{relativeDays(toDate(user.lastLoginAt))}</td>
                      <td className="p-4 pr-6 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => handleSendPasswordReset(user.email)} title="Enviar redefinição de senha" aria-label="Enviar redefinição de senha" className="p-2 rounded-xl border border-gray-200 dark:border-slate-700 text-gray-400 hover:text-cyan-500 transition-all">
                            <KeyRound size={14} />
                          </button>
                          {!isSelf(user) && (
                            <>
                              <button onClick={() => handleToggleStatus(user)} title={blocked ? 'Reativar usuário' : 'Suspender usuário'} aria-label={blocked ? 'Reativar usuário' : 'Suspender usuário'} className={`p-2 rounded-xl border transition-all ${blocked ? 'text-green-500 border-green-200/60 dark:border-green-900/60' : 'text-amber-500 border-amber-200/60 dark:border-amber-900/60'}`}>
                                {blocked ? <Play size={14} /> : <Pause size={14} />}
                              </button>
                              <button onClick={() => handleOpenEdit(user)} title="Editar perfil" aria-label="Editar perfil" className="p-2 rounded-xl border border-gray-200 dark:border-slate-700 text-gray-400 hover:text-brand transition-all">
                                <Edit size={14} />
                              </button>
                              <button onClick={() => setDeletingUser(user)} title="Remover perfil" aria-label="Remover perfil" className="p-2 rounded-xl border border-gray-200 dark:border-slate-700 text-gray-400 hover:text-rose-500 transition-all">
                                <Trash2 size={14} />
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

      {editingUser && (
        <div className="fixed inset-0 !mt-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4" role="dialog" aria-modal="true" aria-label="Editar usuário">
          <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-3xl p-6 w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-black text-gray-900 dark:text-white">Editar usuário</h2>
              <button onClick={() => setEditingUser(null)} aria-label="Fechar" className="p-1 rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-white"><X size={18} /></button>
            </div>
            <form onSubmit={handleUpdateUser} className="space-y-4">
              <div>
                <label htmlFor="nu-name" className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5">Nome</label>
                <input id="nu-name" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required className={fieldClass} />
              </div>
              <div>
                <label htmlFor="nu-tenant" className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5">Empresa</label>
                <select id="nu-tenant" value={editForm.tenantId} onChange={(e) => changeEditTenant(e.target.value)} className={fieldClass}>
                  <option value={MASTER_TENANT}>Nexus ITAM (master)</option>
                  {tenants.map((t) => <option key={t.id} value={t.id}>{t.companyName || t.id}</option>)}
                  {editForm.tenantId && editForm.tenantId !== MASTER_TENANT && !tenants.some((t) => t.id === editForm.tenantId) && (
                    <option value={editForm.tenantId}>{editForm.tenantId} (legada)</option>
                  )}
                </select>
              </div>
              <div>
                <label htmlFor="nu-role" className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5">Papel</label>
                <select id="nu-role" value={editForm.role} onChange={(e) => setEditForm({ ...editForm, role: e.target.value })} className={fieldClass}>
                  {rolesForTenant(editForm.tenantId).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="nu-status" className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5">Status</label>
                <select id="nu-status" value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })} className={fieldClass}>
                  <option value="active">Ativo</option>
                  <option value="suspended">Suspenso</option>
                </select>
              </div>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                Contas com custom claims (definidas pelo script de backend) mantêm o papel e a empresa das claims até serem atualizadas por lá.
              </p>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setEditingUser(null)} className="flex-1 px-4 py-3 border border-gray-200 dark:border-slate-700 rounded-xl text-gray-600 dark:text-gray-300 font-bold text-xs uppercase tracking-wider">Cancelar</button>
                <button type="submit" disabled={busy} className="flex-1 px-4 py-3 bg-brand text-white rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-60">
                  <Save size={14} /> Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deletingUser && (
        <div className="fixed inset-0 !mt-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4" role="alertdialog" aria-modal="true" aria-label="Remover usuário">
          <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-3xl p-6 w-full max-w-sm shadow-2xl text-center">
            <div className="w-14 h-14 bg-rose-500/10 border border-rose-500/30 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-4"><XCircle size={28} /></div>
            <h3 className="font-black text-gray-900 dark:text-white text-lg mb-2">Remover perfil</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed mb-6">
              Remover <strong className="text-gray-900 dark:text-white">{deletingUser.name || deletingUser.email}</strong> de <strong>{deletingUser.companyName}</strong>?
              A conta de login continua existindo, mas sem acesso a nenhuma empresa.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeletingUser(null)} className="flex-1 px-4 py-3 border border-gray-200 dark:border-slate-700 rounded-xl text-gray-600 dark:text-gray-300 font-bold text-xs uppercase tracking-wider">Cancelar</button>
              <button onClick={handleDeleteUser} disabled={busy} className="flex-1 px-4 py-3 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold text-xs uppercase tracking-wider disabled:opacity-50">
                {busy ? 'Removendo...' : 'Remover'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NexusUserManager;
