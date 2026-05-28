import React, { useState, useEffect } from 'react';
import { db } from '../services/firebase';
import { 
  collection, getDocs, doc, updateDoc, deleteDoc, serverTimestamp, getDoc 
} from 'firebase/firestore';
import { 
  Users, Search, Filter, ShieldCheck, CheckCircle, XCircle, 
  Trash2, Edit, Save, X, RefreshCcw, Building2, ShieldAlert, Shield, Mail, Pause, Play, Key
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

const NexusUserManager = () => {
  const { currentUser, resetPassword } = useAuth();
  const navigate = useNavigate();
  
  const [users, setUsers] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [tenantFilter, setTenantFilter] = useState('ALL');

  // Modal Editar
  const [editingUser, setEditingUser] = useState(null);
  const [editForm, setEditForm] = useState({
    name: '',
    role: 'member',
    status: 'active',
    tenantId: ''
  });

  // Modal Deletar
  const [deletingUser, setDeletingUser] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    if (currentUser?.role !== 'superadmin') {
      toast.error('Acesso negado. Área restrita à Administração Global.');
      navigate('/dashboard');
      return;
    }
    loadData();
  }, [currentUser, navigate]);

  const loadData = async () => {
    setLoading(true);
    try {
      // 1. Fetch tenants to resolve names
      const tenantsSnap = await getDocs(collection(db, 'tenants'));
      const tenantsList = tenantsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setTenants(tenantsList);

      const tenantMap = tenantsList.reduce((acc, curr) => {
        acc[curr.id] = curr.companyName || 'Empresa Desconhecida';
        return acc;
      }, {});

      // 2. Fetch users
      const usersSnap = await getDocs(collection(db, 'users'));
      const usersList = usersSnap.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          companyName: tenantMap[data.tenantId] || (data.tenantId === 'nexus-master' ? 'Nexus ITAM' : 'Sem Empresa')
        };
      });

      setUsers(usersList.sort((a, b) => (a.name || '').localeCompare(b.name || '')));

    } catch (error) {
      console.error("Erro ao carregar dados de usuários:", error);
      toast.error("Falha ao carregar lista de acessos.");
    } finally {
      setLoading(false);
    }
  };

  const handleSendPasswordReset = async (email) => {
    try {
      await resetPassword(email);
      toast.success(`E-mail de redefinição de senha enviado para ${email}`);
    } catch (error) {
      console.error(error);
      toast.error("Erro ao enviar e-mail de redefinição de senha.");
    }
  };

  const handleToggleStatus = async (user) => {
    const newStatus = user.status === 'active' ? 'suspended' : 'active';
    try {
      await updateDoc(doc(db, 'users', user.id), {
        status: newStatus,
        updatedAt: serverTimestamp()
      });
      toast.success(`Usuário ${newStatus === 'active' ? 'ativado' : 'suspenso'} com sucesso.`);
      setUsers(users.map(u => u.id === user.id ? { ...u, status: newStatus } : u));
    } catch (error) {
      console.error(error);
      toast.error("Erro ao alterar status do usuário.");
    }
  };

  const handleOpenEdit = (user) => {
    setEditingUser(user);
    setEditForm({
      name: user.name || '',
      role: user.role || 'member',
      status: user.status || 'active',
      tenantId: user.tenantId || ''
    });
  };

  const handleUpdateUser = async (e) => {
    e.preventDefault();
    try {
      await updateDoc(doc(db, 'users', editingUser.id), {
        name: editForm.name,
        role: editForm.role,
        status: editForm.status,
        tenantId: editForm.tenantId,
        updatedAt: serverTimestamp()
      });
      toast.success("Usuário atualizado com sucesso!");
      setEditingUser(null);
      loadData();
    } catch (error) {
      console.error(error);
      toast.error("Erro ao atualizar dados do usuário.");
    }
  };

  const handleDeleteUser = async () => {
    if (!deletingUser) return;
    setDeleteLoading(true);
    try {
      await deleteDoc(doc(db, 'users', deletingUser.id));
      toast.success("Perfil de usuário removido do banco.");
      setDeletingUser(null);
      loadData();
    } catch (error) {
      console.error(error);
      toast.error("Erro ao remover usuário.");
    } finally {
      setDeleteLoading(false);
    }
  };

  const getRoleBadge = (role) => {
    const r = role ? role.toLowerCase() : 'member';
    if (r === 'superadmin') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 text-[10px] font-black border border-blue-500/20"><ShieldAlert size={12}/> MASTER ADMIN</span>;
    if (r === 'owner') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-purple-500/10 text-purple-400 text-[10px] font-black border border-purple-500/20"><ShieldCheck size={12}/> OWNER</span>;
    if (r === 'admin') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 text-[10px] font-black border border-indigo-500/20"><Shield size={12}/> ADMIN</span>;
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-500/10 text-slate-400 text-[10px] font-black border border-white/5">MEMBRO</span>;
  };

  const getStatusBadge = (status) => {
    if (status === 'active') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-green-500/10 text-green-500 text-[10px] font-black"><CheckCircle size={12}/> ATIVO</span>;
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-500/10 text-rose-500 text-[10px] font-black"><XCircle size={12}/> SUSPENSO</span>;
  };

  const filteredUsers = users.filter(u => {
    const matchesSearch = 
      u.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.id?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesRole = roleFilter === 'ALL' || u.role === roleFilter;
    const matchesTenant = tenantFilter === 'ALL' || u.tenantId === tenantFilter;

    return matchesSearch && matchesRole && matchesTenant;
  });

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto pb-24 space-y-6">
      
      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-2 bg-slate-900 rounded-3xl p-6 md:p-8 shadow-xl relative overflow-hidden border border-white/5">
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/15 rounded-full blur-3xl pointer-events-none"></div>
        <div className="relative z-10 flex items-center gap-4">
          <div className="p-4 bg-white/5 backdrop-blur text-indigo-400 rounded-2xl border border-white/10">
            <Users size={32} />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-black text-white uppercase tracking-tight">Acessos Global</h1>
            <p className="text-slate-400 font-medium text-sm mt-1">Gerencie credenciais, permissões e status de usuários de todos os inquilinos.</p>
          </div>
        </div>

        <div className="relative z-10">
          <button onClick={loadData} className="flex items-center justify-center w-12 h-12 bg-white/5 hover:bg-white/10 text-white rounded-xl transition-all border border-white/10" title="Recarregar">
             <RefreshCcw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* FILTER BAR */}
      <div className="bg-white dark:bg-slate-800 rounded-3xl border border-gray-150 dark:border-slate-755 p-4 shadow-sm flex flex-col md:flex-row gap-3 items-center">
        <div className="relative w-full md:flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Pesquisar por nome, e-mail ou UID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 text-xs bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all font-medium text-gray-700 dark:text-slate-200"
          />
        </div>

        <div className="flex flex-wrap gap-2 w-full md:w-auto">
          {/* Nível Permissão */}
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="text-xs bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl px-4 py-2.5 font-bold text-gray-600 dark:text-slate-350 cursor-pointer focus:outline-none"
          >
            <option value="ALL">Todas as Permissões</option>
            <option value="superadmin">Master Admin</option>
            <option value="owner">Owner (Dono)</option>
            <option value="admin">Admin</option>
            <option value="member">Membro</option>
          </select>

          {/* Empresa Filter */}
          <select
            value={tenantFilter}
            onChange={(e) => setTenantFilter(e.target.value)}
            className="text-xs bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl px-4 py-2.5 font-bold text-gray-600 dark:text-slate-350 cursor-pointer focus:outline-none max-w-[200px]"
          >
            <option value="ALL">Todas as Empresas</option>
            <option value="nexus-master">Nexus ITAM</option>
            {tenants.map(t => (
              <option key={t.id} value={t.id}>{t.companyName}</option>
            ))}
          </select>
        </div>
      </div>

      {/* TABLE */}
      <div className="bg-white dark:bg-slate-800 rounded-3xl border border-gray-150 dark:border-slate-755 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 dark:bg-slate-900 text-gray-400 text-[10px] uppercase font-black tracking-widest border-b border-gray-150 dark:border-slate-700">
                <th className="p-4 pl-6">Usuário / ID</th>
                <th className="p-4">Empresa / Tenant</th>
                <th className="p-4 text-center">Permissão</th>
                <th className="p-4 text-center">Status</th>
                <th className="p-4 pr-6 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="text-xs font-semibold text-gray-700 dark:text-slate-200">
              {loading ? (
                <tr>
                  <td colSpan="5" className="p-12 text-center text-gray-400 font-bold uppercase tracking-widest">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-8 h-8 border-4 border-indigo-100 border-t-indigo-500 rounded-full animate-spin"></div>
                      Acessando Credenciais...
                    </div>
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan="5" className="p-8 text-center text-gray-400 font-medium">Nenhum usuário correspondente encontrado.</td>
                </tr>
              ) : (
                filteredUsers.map(user => (
                  <tr key={user.id} className="border-b border-gray-50 dark:border-slate-755 hover:bg-gray-50/50 dark:hover:bg-slate-900/30 transition-colors">
                    <td className="p-4 pl-6">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-gray-55 dark:bg-slate-900 flex items-center justify-center font-black border border-gray-200 dark:border-slate-700 shrink-0">
                          {user.name ? user.name.substring(0, 2).toUpperCase() : 'NA'}
                        </div>
                        <div>
                          <p className="font-extrabold text-gray-900 dark:text-white text-sm">{user.name || 'Usuário Sem Nome'}</p>
                          <p className="text-[10px] text-gray-400 font-medium flex items-center gap-1 mt-0.5"><Mail size={11} className="text-gray-400"/> {user.email}</p>
                          <p className="text-[8px] font-mono text-gray-400 dark:text-gray-500 tracking-wider">UID: {user.id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-1.5 font-bold text-gray-900 dark:text-white">
                        <Building2 size={13} className="text-gray-400" />
                        <div>
                          <p>{user.companyName}</p>
                          <p className="text-[9px] font-mono text-gray-400 tracking-wider">#{user.tenantId}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4 text-center">
                      {getRoleBadge(user.role)}
                    </td>
                    <td className="p-4 text-center">
                      {getStatusBadge(user.status)}
                    </td>
                    <td className="p-4 pr-6 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {user.email !== 'delciofarias04@gmail.com' && (
                          <>
                            <button 
                              onClick={() => handleToggleStatus(user)}
                              className={`p-2 rounded-xl border transition-all ${user.status === 'active' ? 'text-amber-500 border-amber-200/50 hover:bg-amber-50 dark:hover:bg-amber-900/10' : 'text-green-500 border-green-200/50 hover:bg-green-50 dark:hover:bg-green-900/10'}`}
                              title={user.status === 'active' ? 'Bloquear Usuário' : 'Ativar Usuário'}
                            >
                              {user.status === 'active' ? <Pause size={14}/> : <Play size={14}/>}
                            </button>
                             <button 
                              onClick={() => handleSendPasswordReset(user.email)}
                              className="p-2 rounded-xl border border-gray-200 dark:border-slate-700 text-gray-400 hover:text-cyan-500 hover:bg-cyan-50 dark:hover:bg-cyan-900/10 transition-all"
                              title="Redefinir Senha"
                            >
                              <Key size={14}/>
                            </button>
                            <button 
                              onClick={() => handleOpenEdit(user)}
                              className="p-2 rounded-xl border border-gray-200 dark:border-slate-700 text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/10 transition-all"
                              title="Configurar Perfil"
                            >
                              <Edit size={14}/>
                            </button>
                            <button 
                              onClick={() => setDeletingUser(user)}
                              className="p-2 rounded-xl border border-gray-200 dark:border-slate-700 text-gray-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/10 transition-all"
                              title="Remover Registro"
                            >
                              <Trash2 size={14}/>
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ════════════════ EDIT USER MODAL ════════════════ */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-[#121214] border border-white/10 rounded-3xl p-6 w-full max-w-sm shadow-2xl relative animate-[scaleUp_0.3s_ease-out]">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-indigo-500 to-transparent opacity-60"></div>
            
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-black text-white uppercase tracking-tight">Editar Usuário</h2>
              <button onClick={() => setEditingUser(null)} className="p-1 hover:bg-white/5 rounded-full text-gray-400 hover:text-white transition-colors"><X size={18} /></button>
            </div>

            <form onSubmit={handleUpdateUser} className="space-y-4 text-left">
              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5 ml-1">Nome Completo</label>
                <input 
                  type="text" 
                  value={editForm.name} 
                  onChange={e => setEditForm({ ...editForm, name: e.target.value })} 
                  required
                  className="w-full px-3 py-2.5 bg-black/50 border border-white/10 rounded-xl focus:outline-none focus:border-indigo-500 text-sm font-semibold text-white shadow-inner"
                />
              </div>

              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5 ml-1">Nível de Permissão</label>
                <select 
                  value={editForm.role} 
                  onChange={e => setEditForm({ ...editForm, role: e.target.value })}
                  className="w-full px-3 py-2.5 bg-black/50 border border-white/10 rounded-xl focus:outline-none focus:border-indigo-500 text-sm font-semibold text-white cursor-pointer"
                >
                  <option value="member">Membro / Usuário Padrão</option>
                  <option value="admin">Administrador Local</option>
                  <option value="owner">Dono da Instância (Owner)</option>
                  <option value="superadmin">Administrador Global (Nexus)</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5 ml-1">Vincular Empresa (Tenant)</label>
                <select 
                  value={editForm.tenantId} 
                  onChange={e => setEditForm({ ...editForm, tenantId: e.target.value })}
                  className="w-full px-3 py-2.5 bg-black/50 border border-white/10 rounded-xl focus:outline-none focus:border-indigo-500 text-sm font-semibold text-white cursor-pointer font-bold"
                >
                  <option value="nexus-master">Nexus ITAM</option>
                  {tenants.map(t => (
                    <option key={t.id} value={t.id}>{t.companyName}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5 ml-1">Status do Acesso</label>
                <select 
                  value={editForm.status} 
                  onChange={e => setEditForm({ ...editForm, status: e.target.value })}
                  className="w-full px-3 py-2.5 bg-black/50 border border-white/10 rounded-xl focus:outline-none focus:border-indigo-500 text-sm font-semibold text-white cursor-pointer"
                >
                  <option value="active">Ativo</option>
                  <option value="suspended">Suspenso</option>
                </select>
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setEditingUser(null)} className="flex-1 px-4 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-gray-300 font-bold text-xs uppercase tracking-wider transition-colors">Cancelar</button>
                <button type="submit" className="flex-1 px-4 py-3 bg-indigo-600 text-white rounded-xl font-bold text-xs uppercase tracking-wider shadow-lg flex items-center justify-center gap-2 hover:bg-indigo-700 transition-colors">
                  <Save size={14}/> Salvar Alterações
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ════════════════ DELETE USER MODAL ════════════════ */}
      {deletingUser && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-[#121214] border border-white/10 rounded-3xl p-6 w-full max-w-sm shadow-2xl relative text-center animate-[scaleUp_0.3s_ease-out]">
            <div className="w-14 h-14 bg-rose-500/10 border border-rose-500/30 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <XCircle size={28} />
            </div>
            
            <h3 className="font-black text-white text-lg uppercase tracking-tight mb-2">Excluir Conta</h3>
            <p className="text-xs text-gray-400 leading-relaxed mb-6">
              Tem certeza que deseja excluir permanentemente o usuário <strong className="text-white">"{deletingUser.name}"</strong>? 
              Essa operação revogará imediatamente o cadastro no banco do multi-tenant.
            </p>

            <div className="flex gap-3">
              <button onClick={() => setDeletingUser(null)} className="flex-1 px-4 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-gray-300 font-bold text-xs uppercase tracking-wider transition-colors">Cancelar</button>
              <button onClick={handleDeleteUser} disabled={deleteLoading} className="flex-1 px-4 py-3 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold text-xs uppercase tracking-wider transition-colors disabled:opacity-50">
                {deleteLoading ? 'Excluindo...' : 'Sim, Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default NexusUserManager;
