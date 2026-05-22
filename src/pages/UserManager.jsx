import React, { useState, useEffect } from 'react';
import { db } from '../services/firebase';
import { collection, query, where, getDocs, addDoc, serverTimestamp, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'sonner';
import { Shield, UserPlus, Mail, Trash2, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const UserManager = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);

  // Formulário de Convite
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('operator');
  const [isInviting, setIsInviting] = useState(false);

  useEffect(() => {
    if (currentUser?.role !== 'owner' && currentUser?.role !== 'superadmin') {
      toast.error('Acesso negado. Apenas o Líder da TI (Owner) pode acessar esta área.');
      navigate('/dashboard');
      return;
    }

    const fetchData = async () => {
      try {
        // Busca usuários ativos do mesmo tenant
        const qUsers = query(collection(db, 'users'), where('tenantId', '==', currentUser.tenantId));
        const snapUsers = await getDocs(qUsers);
        setUsers(snapUsers.docs.map(d => ({ id: d.id, ...d.data() })));

        // Busca convites pendentes
        const qInvites = query(collection(db, 'invites'), where('tenantId', '==', currentUser.tenantId));
        const snapInvites = await getDocs(qInvites);
        setInvites(snapInvites.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (error) {
        console.error(error);
        toast.error('Erro ao buscar membros da equipe.');
      } finally {
        setLoading(false);
      }
    };

    if (currentUser?.tenantId) {
      fetchData();
    }
  }, [currentUser, navigate]);

  const handleInvite = async (e) => {
    e.preventDefault();
    if (!inviteEmail) return;

    setIsInviting(true);
    try {
      const inviteData = {
        email: inviteEmail,
        role: inviteRole,
        tenantId: currentUser.tenantId,
        invitedBy: currentUser.email,
        createdAt: serverTimestamp(),
        status: 'pending'
      };
      
      const docRef = await addDoc(collection(db, 'invites'), inviteData);
      setInvites([...invites, { id: docRef.id, ...inviteData, createdAt: new Date() }]);
      setInviteEmail('');
      toast.success('Convite enviado com sucesso! O membro receberá um e-mail com o link de acesso.');
    } catch (error) {
      console.error(error);
      toast.error('Erro ao enviar convite.');
    } finally {
      setIsInviting(false);
    }
  };

  const handleRevokeInvite = async (inviteId) => {
    if (!confirm('Deseja revogar este convite?')) return;
    try {
      await deleteDoc(doc(db, 'invites', inviteId));
      setInvites(invites.filter(i => i.id !== inviteId));
      toast.success('Convite revogado.');
    } catch (error) {
      console.error(error);
      toast.error('Erro ao revogar convite.');
    }
  };

  const handleChangeRole = async (userId, newRole) => {
    if (!confirm('Deseja alterar o nível de acesso deste usuário?')) return;
    try {
      await updateDoc(doc(db, 'users', userId), { role: newRole });
      setUsers(users.map(u => u.id === userId ? { ...u, role: newRole } : u));
      toast.success('Nível de acesso atualizado.');
    } catch (error) {
      console.error(error);
      toast.error('Erro ao atualizar permissões.');
    }
  };

  const getRoleBadge = (role) => {
    switch (role) {
      case 'owner':
        return <span className="px-2 py-1 bg-black text-white text-[10px] font-black rounded uppercase tracking-widest flex items-center gap-1"><ShieldCheck size={12}/> Owner</span>;
      case 'manager':
        return <span className="px-2 py-1 bg-brand text-white text-[10px] font-black rounded uppercase tracking-widest">Manager</span>;
      default:
        return <span className="px-2 py-1 bg-gray-200 text-gray-700 dark:text-gray-200 text-[10px] font-black rounded uppercase tracking-widest">Operator</span>;
    }
  };

  if (loading) return <div className="flex h-screen items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black"></div></div>;

  return (
    <div className="max-w-5xl mx-auto pb-24 animate-fade-in relative">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-black text-gray-900 dark:text-white flex items-center gap-2"><Shield className="text-brand"/> Gestão de Acessos</h1>
          <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Gerencie quem acessa o seu Nexus ITAM</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        
        {/* Painel de Membros */}
        <div className="md:col-span-2 space-y-6">
          <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 border border-gray-100 dark:border-slate-700 shadow-sm">
            <h3 className="text-sm font-black text-gray-900 dark:text-white mb-6 uppercase tracking-wider flex items-center gap-2">Membros Ativos <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-[10px]">{users.length}</span></h3>
            
            <div className="space-y-4">
              {users.map(user => (
                <div key={user.id} className="flex items-center justify-between p-4 border border-gray-100 dark:border-slate-700 rounded-2xl hover:bg-gray-50 dark:bg-slate-900 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-brand/10 text-brand flex items-center justify-center font-black text-lg">
                      {user.name ? user.name.charAt(0).toUpperCase() : user.email.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-900 dark:text-white">{user.name || 'Usuário Nexus'}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500 font-medium">{user.email}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    {getRoleBadge(user.role)}
                    
                    {user.id !== currentUser.uid && (
                      <select 
                        value={user.role} 
                        onChange={(e) => handleChangeRole(user.id, e.target.value)}
                        className="text-[10px] font-bold border border-gray-200 dark:border-slate-600 rounded p-1 bg-white dark:bg-slate-800 outline-none cursor-pointer"
                      >
                        <option value="owner">Tornar Owner</option>
                        <option value="manager">Tornar Manager</option>
                        <option value="operator">Tornar Operator</option>
                      </select>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {invites.length > 0 && (
            <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 border border-gray-100 dark:border-slate-700 shadow-sm">
              <h3 className="text-sm font-black text-gray-900 dark:text-white mb-6 uppercase tracking-wider text-gray-500 dark:text-gray-400 dark:text-gray-500">Convites Pendentes</h3>
              <div className="space-y-3">
                {invites.map(invite => (
                  <div key={invite.id} className="flex items-center justify-between p-3 border border-gray-100 dark:border-slate-700 rounded-xl bg-gray-50 dark:bg-slate-900">
                    <div>
                      <p className="text-xs font-bold text-gray-700 dark:text-gray-200 flex items-center gap-1"><Mail size={12}/> {invite.email}</p>
                      <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1 uppercase">Como: {invite.role}</p>
                    </div>
                    <button onClick={() => handleRevokeInvite(invite.id)} className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Revogar Convite">
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Formulário de Convite */}
        <div className="md:col-span-1">
          <div className="bg-brand text-white rounded-3xl p-6 shadow-lg relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-2xl pointer-events-none -mt-10 -mr-10"></div>
            
            <h3 className="text-sm font-black mb-2 uppercase tracking-wider flex items-center gap-2"><UserPlus size={18}/> Convidar Membro</h3>
            <p className="text-xs text-white/70 mb-6 font-medium">Envie um convite para um colega participar da gestão do inventário.</p>

            <form onSubmit={handleInvite} className="space-y-4 relative z-10">
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-white/80 block mb-1">E-mail Corporativo</label>
                <input 
                  type="email" 
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  required
                  placeholder="email@empresa.com"
                  className="w-full p-3 rounded-xl bg-white/10 border border-white/20 focus:bg-white dark:bg-slate-800 focus:text-black focus:outline-none transition-all placeholder:text-white/30 text-sm font-bold text-white"
                />
              </div>

              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-white/80 block mb-1">Nível de Acesso</label>
                <select 
                  value={inviteRole}
                  onChange={e => setInviteRole(e.target.value)}
                  className="w-full p-3 rounded-xl bg-white/10 border border-white/20 focus:bg-white dark:bg-slate-800 focus:text-black focus:outline-none transition-all text-sm font-bold text-white [&>option]:text-black"
                >
                  <option value="manager">Manager (Gestão)</option>
                  <option value="operator">Operator (Técnico)</option>
                </select>
              </div>

              <div className="pt-2">
                <button type="submit" disabled={isInviting} className="w-full py-3 bg-white dark:bg-slate-800 text-brand font-black rounded-xl hover:bg-gray-100 transition-colors shadow-md text-xs uppercase tracking-widest flex items-center justify-center gap-2">
                  {isInviting ? 'Enviando...' : <><Mail size={16}/> Enviar Convite</>}
                </button>
              </div>
            </form>
          </div>

          <div className="mt-6 bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-2xl p-5 shadow-sm">
            <h4 className="text-xs font-black text-gray-900 dark:text-white uppercase tracking-widest mb-3">Entendendo os Papéis</h4>
            <ul className="space-y-3">
              <li className="flex gap-2">
                <ShieldCheck size={16} className="text-black shrink-0"/>
                <div>
                  <p className="text-xs font-bold text-gray-900 dark:text-white">Owner</p>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 dark:text-gray-500">Acesso total. O único que pode acessar as configurações, cores da marca e gestão de usuários.</p>
                </div>
              </li>
              <li className="flex gap-2">
                <Shield size={16} className="text-brand shrink-0"/>
                <div>
                  <p className="text-xs font-bold text-gray-900 dark:text-white">Manager</p>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 dark:text-gray-500">Pode criar, editar e excluir ativos. Gerencia funcionários e licenças.</p>
                </div>
              </li>
              <li className="flex gap-2">
                <CheckCircle2 size={16} className="text-gray-400 dark:text-gray-500 shrink-0"/>
                <div>
                  <p className="text-xs font-bold text-gray-900 dark:text-white">Operator</p>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 dark:text-gray-500">Nível mais básico. Não pode excluir ativos ou gerenciar contratos.</p>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserManager;
