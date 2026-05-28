import React, { useState, useEffect } from 'react';
import { db } from '../services/firebase';
import { 
  collection, getDocs, doc, updateDoc, setDoc, serverTimestamp, 
  collectionGroup, deleteDoc, getDoc 
} from 'firebase/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { 
  Building2, Users, Calendar, Activity, Search, Shield, 
  AlertTriangle, Play, Pause, RefreshCcw, UserCog, Mail,
  PlusSquare, X, Save, Layers, Trash2, ShieldCheck, CheckCircle
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const TenantManager = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [planFilter, setPlanFilter] = useState('ALL');

  // Modal Provisionar
  const [showProvisionModal, setShowProvisionModal] = useState(false);
  const [provisionLoading, setProvisionLoading] = useState(false);
  const [provisionForm, setProvisionForm] = useState({
    companyName: '',
    adminName: '',
    email: '',
    password: '',
    plan: 'starter'
  });

  // Modal Editar
  const [editingTenant, setEditingTenant] = useState(null);
  const [editForm, setEditForm] = useState({
    companyName: '',
    plan: 'starter',
    status: 'active'
  });

  // Modal Deletar
  const [deletingTenant, setDeletingTenant] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    if (currentUser?.role !== 'superadmin') {
      toast.error('Acesso negado. Área restrita à Administração Global.');
      navigate('/dashboard');
      return;
    }
    loadTenants();
  }, [currentUser, navigate]);

  const loadTenants = async () => {
    setLoading(true);
    try {
      // 1. Busca todas as empresas (tenants)
      const tenantsSnap = await getDocs(collection(db, 'tenants'));
      const tenantsData = tenantsSnap.docs.map(doc => ({ ...doc.data(), refId: doc.id }));

      // 2. Busca todos os usuários
      const usersSnap = await getDocs(collection(db, 'users'));
      const usersData = usersSnap.docs.map(doc => doc.data());

      // 3. Busca ativos globais
      const assetsSnap = await getDocs(collectionGroup(db, 'assets'));
      const assetsData = assetsSnap.docs.map(doc => doc.data());

      // Faz o join
      const enrichedTenants = tenantsData.map(tenant => {
        const adminUser = usersData.find(u => u.tenantId === tenant.id && (u.role === 'owner' || u.role === 'admin'));
        return {
          ...tenant,
          adminName: adminUser ? adminUser.name : 'N/A',
          adminEmail: adminUser ? adminUser.email : 'N/A',
          usersCount: usersData.filter(u => u.tenantId === tenant.id).length,
          assetsCount: assetsData.filter(a => a.tenantId === tenant.id).length
        };
      });

      setTenants(enrichedTenants.sort((a, b) => {
        const aDate = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
        const bDate = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
        return bDate - aDate;
      }));
    } catch (error) {
      console.error("Erro ao carregar tenants:", error);
      toast.error("Falha ao carregar a lista de empresas.");
    } finally {
      setLoading(false);
    }
  };

  // Alterar Status Rápido
  const toggleTenantStatus = async (tenantId, currentStatus) => {
    const newStatus = currentStatus === 'active' ? 'suspended' : 'active';
    try {
      await updateDoc(doc(db, 'tenants', tenantId), { 
        status: newStatus,
        updatedAt: serverTimestamp()
      });
      toast.success(`Empresa ${newStatus === 'active' ? 'ativada' : 'suspensa'} com sucesso.`);
      setTenants(tenants.map(t => t.id === tenantId ? { ...t, status: newStatus } : t));
    } catch (error) {
      console.error(error);
      toast.error("Erro ao alterar status da empresa.");
    }
  };

  // Criar Novo Tenant (Empresa)
  const handleProvisionTenant = async (e) => {
    e.preventDefault();
    setProvisionLoading(true);

    const tempAppName = `TempApp-${Date.now()}`;
    let tempApp = null;

    try {
      // 1. Gera ID único para o tenant
      const tenantId = `tenant-${Math.random().toString(36).substring(2, 9)}`;

      // 2. Inicializa App temporário para criar usuário sem deslogar o superadmin
      tempApp = initializeApp(firebaseConfig, tempAppName);
      const tempAuth = getAuth(tempApp);
      
      const userCredential = await createUserWithEmailAndPassword(
        tempAuth, 
        provisionForm.email, 
        provisionForm.password
      );
      const user = userCredential.user;
      await signOut(tempAuth);

      // 3. Salva Tenant no Firestore
      await setDoc(doc(db, 'tenants', tenantId), {
        id: tenantId,
        companyName: provisionForm.companyName,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        status: 'active',
        plan: provisionForm.plan
      });

      // 4. Salva o perfil do usuário como owner do novo tenant
      await setDoc(doc(db, 'users', user.uid), {
        id: user.uid,
        email: provisionForm.email,
        name: provisionForm.adminName,
        tenantId: tenantId,
        role: 'owner',
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      toast.success(`Inquilino "${provisionForm.companyName}" provisionado com sucesso!`);
      setShowProvisionModal(false);
      setProvisionForm({
        companyName: '',
        adminName: '',
        email: '',
        password: '',
        plan: 'starter'
      });
      loadTenants();

    } catch (error) {
      console.error("Erro ao provisionar inquilino:", error);
      toast.error(error.message || "Erro ao criar novo inquilino.");
    } finally {
      if (tempApp) {
        try {
          await deleteApp(tempApp);
        } catch (e) {
          console.warn("Erro ao desalocar tempApp", e);
        }
      }
      setProvisionLoading(false);
    }
  };

  // Atualizar Detalhes do Tenant (Edição)
  const handleUpdateTenant = async (e) => {
    e.preventDefault();
    try {
      await updateDoc(doc(db, 'tenants', editingTenant.id), {
        companyName: editForm.companyName,
        plan: editForm.plan,
        status: editForm.status,
        updatedAt: serverTimestamp()
      });
      toast.success("Empresa atualizada com sucesso!");
      setEditingTenant(null);
      loadTenants();
    } catch (error) {
      console.error(error);
      toast.error("Erro ao atualizar empresa.");
    }
  };

  // Excluir Tenant
  const handleDeleteTenant = async () => {
    if (!deletingTenant) return;
    setDeleteLoading(true);
    try {
      // 1. Remove documento do tenant
      await deleteDoc(doc(db, 'tenants', deletingTenant.id));
      
      // Observação: Na prática, excluiria cascateado os ativos/usuários do tenant.
      // Por segurança no ambiente de teste, removemos apenas o tenant.
      
      toast.success(`Inquilino "${deletingTenant.companyName}" excluído da plataforma.`);
      setDeletingTenant(null);
      loadTenants();
    } catch (error) {
      console.error(error);
      toast.error("Erro ao excluir inquilino.");
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleOpenEdit = (tenant) => {
    setEditingTenant(tenant);
    setEditForm({
      companyName: tenant.companyName || '',
      plan: tenant.plan || 'starter',
      status: tenant.status || 'active'
    });
  };

  const getStatusBadge = (status) => {
    if (status === 'active') return <span className="px-2.5 py-1 bg-green-500/10 text-green-500 text-[10px] font-black uppercase rounded border border-green-500/20">Ativo</span>;
    if (status === 'suspended') return <span className="px-2.5 py-1 bg-rose-500/10 text-rose-500 text-[10px] font-black uppercase rounded border border-rose-500/20">Suspenso</span>;
    return <span className="px-2.5 py-1 bg-gray-500/10 text-gray-400 text-[10px] font-black uppercase rounded border border-white/10">{status}</span>;
  };

  const getPlanBadge = (plan) => {
    const p = plan ? plan.toUpperCase() : 'STARTER';
    if (p === 'ENTERPRISE') return <span className="bg-gradient-to-r from-amber-500 to-orange-500 text-white px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider shadow-sm">Enterprise</span>;
    if (p === 'PRO') return <span className="bg-purple-600 text-white px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider">Pro</span>;
    return <span className="bg-slate-700 text-slate-300 px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider border border-white/5">Starter</span>;
  };

  const filteredTenants = tenants.filter(t => {
    const matchesSearch = 
      t.companyName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.adminEmail?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === 'ALL' || t.status === statusFilter;
    const matchesPlan = planFilter === 'ALL' || t.plan === planFilter;

    return matchesSearch && matchesStatus && matchesPlan;
  });

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto pb-24 space-y-6">
      
      {/* 1. HEADER */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-2 bg-slate-900 rounded-3xl p-6 md:p-8 shadow-xl relative overflow-hidden border border-white/5">
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/15 rounded-full blur-3xl pointer-events-none"></div>
        <div className="relative z-10 flex items-center gap-4">
          <div className="p-4 bg-white/5 backdrop-blur text-indigo-400 rounded-2xl border border-white/10">
            <Building2 size={32} />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-black text-white uppercase tracking-tight">Gerenciar Empresas</h1>
            <p className="text-slate-400 font-medium text-sm mt-1">Administre e provisione contas de clientes da plataforma SaaS.</p>
          </div>
        </div>
        
        <div className="relative z-10 flex items-center gap-2">
           <button onClick={() => setShowProvisionModal(true)} className="flex items-center gap-2 px-5 py-3 bg-white hover:bg-gray-100 text-black rounded-xl font-black text-xs uppercase tracking-wider transition-all active:scale-95 shadow-lg">
             <PlusSquare size={16} /> Novo Inquilino
           </button>
           <button onClick={loadTenants} className="flex items-center justify-center w-12 h-12 bg-white/5 hover:bg-white/10 text-white rounded-xl transition-all border border-white/10" title="Recarregar">
             <RefreshCcw size={16} className={loading ? 'animate-spin' : ''} />
           </button>
        </div>
      </div>

      {/* 2. STATS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total', value: tenants.length, icon: <Building2 className="w-6 h-6 text-indigo-500" /> },
          { label: 'Ativos', value: tenants.filter(t => t.status === 'active').length, icon: <CheckCircle className="w-6 h-6 text-green-500" /> },
          { label: 'Bloqueados', value: tenants.filter(t => t.status === 'suspended').length, icon: <AlertTriangle className="w-6 h-6 text-rose-500" /> },
          { label: 'Total Usuários', value: tenants.reduce((acc, t) => acc + (t.usersCount || 0), 0), icon: <Users className="w-6 h-6 text-purple-500" /> },
        ].map(stat => (
          <div key={stat.label} className="bg-white dark:bg-slate-800 rounded-3xl p-5 border border-gray-150 dark:border-slate-700 shadow-sm flex justify-between items-center group hover:shadow-md transition-shadow">
            <div>
              <p className="text-xs text-gray-400 dark:text-gray-500 font-bold uppercase tracking-wider">{stat.label}</p>
              <p className="text-2xl font-black text-gray-900 dark:text-white mt-1">{stat.value}</p>
            </div>
            <div className="p-3 bg-gray-50 dark:bg-slate-900 rounded-2xl">{stat.icon}</div>
          </div>
        ))}
      </div>

      {/* 3. FILTERS */}
      <div className="bg-white dark:bg-slate-800 rounded-3xl border border-gray-150 dark:border-slate-750 p-4 shadow-sm flex flex-col md:flex-row gap-3 items-center">
        <div className="relative w-full md:flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Pesquisar por razão social, e-mail ou ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 text-xs bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all font-medium text-gray-700 dark:text-slate-200"
          />
        </div>

        <div className="flex flex-wrap gap-2 w-full md:w-auto">
          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-xs bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl px-4 py-2.5 font-bold text-gray-600 dark:text-slate-350 cursor-pointer focus:outline-none"
          >
            <option value="ALL">Todos os Status</option>
            <option value="active">Ativo</option>
            <option value="suspended">Suspenso</option>
          </select>

          {/* Plan Filter */}
          <select
            value={planFilter}
            onChange={(e) => setPlanFilter(e.target.value)}
            className="text-xs bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl px-4 py-2.5 font-bold text-gray-600 dark:text-slate-350 cursor-pointer focus:outline-none"
          >
            <option value="ALL">Todos os Planos</option>
            <option value="starter">Starter</option>
            <option value="pro">Pro</option>
            <option value="enterprise">Enterprise</option>
          </select>
        </div>
      </div>

      {/* 4. TABLE */}
      <div className="bg-white dark:bg-slate-800 rounded-3xl border border-gray-150 dark:border-slate-750 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 dark:bg-slate-900 text-gray-400 text-[10px] uppercase font-black tracking-widest border-b border-gray-150 dark:border-slate-700">
                <th className="p-4 pl-6">Empresa / ID</th>
                <th className="p-4">Administrador / Responsável</th>
                <th className="p-4 text-center">Usuários</th>
                <th className="p-4 text-center">Parque de Ativos</th>
                <th className="p-4 text-center">Plano</th>
                <th className="p-4 text-center">Status</th>
                <th className="p-4 text-center">Registro</th>
                <th className="p-4 pr-6 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="text-xs font-semibold text-gray-700 dark:text-slate-200">
              {loading ? (
                <tr>
                  <td colSpan="8" className="p-12 text-center text-gray-400 font-bold uppercase tracking-widest">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-8 h-8 border-4 border-indigo-100 border-t-indigo-500 rounded-full animate-spin"></div>
                      Acessando Banco Global...
                    </div>
                  </td>
                </tr>
              ) : filteredTenants.length === 0 ? (
                <tr>
                  <td colSpan="8" className="p-8 text-center text-gray-400 font-medium">Nenhum inquilino correspondente encontrado.</td>
                </tr>
              ) : (
                filteredTenants.map(tenant => (
                  <tr key={tenant.id} className="border-b border-gray-50 dark:border-slate-750 hover:bg-gray-50/50 dark:hover:bg-slate-900/30 transition-colors">
                    <td className="p-4 pl-6">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-slate-900 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-black border border-indigo-100 dark:border-slate-700 shrink-0">
                          {tenant.companyName ? tenant.companyName.substring(0, 2).toUpperCase() : 'NA'}
                        </div>
                        <div>
                          <p className="font-extrabold text-gray-900 dark:text-white text-sm">{tenant.companyName || 'Empresa sem nome'}</p>
                          <p className="text-[9px] font-mono text-gray-400 dark:text-gray-500 font-medium bg-gray-150 dark:bg-slate-900 px-1.5 py-0.5 rounded inline-block mt-0.5">#{tenant.id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <p className="font-bold text-gray-900 dark:text-white flex items-center gap-1.5"><UserCog size={13} className="text-gray-400"/> {tenant.adminName}</p>
                      <p className="text-[10px] text-gray-400 font-medium flex items-center gap-1.5 mt-0.5"><Mail size={11} className="text-gray-400"/> {tenant.adminEmail}</p>
                    </td>
                    <td className="p-4 text-center">
                      <span className="bg-gray-100 dark:bg-slate-900 text-gray-700 dark:text-gray-300 px-2.5 py-1 rounded-full text-[10px] font-black border border-gray-200 dark:border-slate-700">
                        {tenant.usersCount}
                      </span>
                    </td>
                    <td className="p-4 text-center">
                      <span className="bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 px-2.5 py-1 rounded-full text-[10px] font-black border border-indigo-100/50 dark:border-indigo-900/30">
                        {tenant.assetsCount}
                      </span>
                    </td>
                    <td className="p-4 text-center">
                      {getPlanBadge(tenant.plan)}
                    </td>
                    <td className="p-4 text-center">
                      {getStatusBadge(tenant.status)}
                    </td>
                    <td className="p-4 text-center text-[10px] font-medium text-gray-400">
                      {tenant.createdAt?.toDate ? new Date(tenant.createdAt.toDate()).toLocaleDateString('pt-BR') : 'N/A'}
                    </td>
                    <td className="p-4 pr-6 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button 
                          onClick={() => toggleTenantStatus(tenant.id, tenant.status)}
                          className={`p-2 rounded-xl border transition-all ${tenant.status === 'active' ? 'text-amber-500 border-amber-200/50 hover:bg-amber-50 dark:hover:bg-amber-900/10' : 'text-green-500 border-green-200/50 hover:bg-green-50 dark:hover:bg-green-900/10'}`}
                          title={tenant.status === 'active' ? 'Suspender Empresa' : 'Ativar Empresa'}
                        >
                          {tenant.status === 'active' ? <Pause size={14}/> : <Play size={14}/>}
                        </button>
                        <button 
                          onClick={() => handleOpenEdit(tenant)}
                          className="p-2 rounded-xl border border-gray-200 dark:border-slate-700 text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/10 transition-all"
                          title="Configurar Plano"
                        >
                          <Layers size={14}/>
                        </button>
                        <button 
                          onClick={() => setDeletingTenant(tenant)}
                          className="p-2 rounded-xl border border-gray-200 dark:border-slate-700 text-gray-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/10 transition-all"
                          title="Remover Inquilino"
                        >
                          <Trash2 size={14}/>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ════════════════ PROVISION MODAL ════════════════ */}
      {showProvisionModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-[#121214] border border-white/10 rounded-3xl p-6 w-full max-w-md shadow-2xl relative animate-[scaleUp_0.3s_ease-out]" onClick={e => e.stopPropagation()}>
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-indigo-500 to-transparent opacity-60"></div>
            
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-black text-white uppercase tracking-tight">Provisionar Inquilino</h2>
              <button onClick={() => setShowProvisionModal(false)} className="p-1 hover:bg-white/5 rounded-full text-gray-400 hover:text-white transition-colors"><X size={18} /></button>
            </div>

            <form onSubmit={handleProvisionTenant} className="space-y-4 text-left">
              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5 ml-1">Razão Social / Nome Fantasia *</label>
                <input 
                  type="text" 
                  value={provisionForm.companyName} 
                  onChange={e => setProvisionForm({ ...provisionForm, companyName: e.target.value })} 
                  required
                  className="w-full px-3 py-2.5 bg-black/50 border border-white/10 rounded-xl focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-sm font-semibold text-white placeholder-gray-600 shadow-inner"
                  placeholder="Ex: ACME Corporation" 
                />
              </div>

              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5 ml-1">Administrador Master (Nome) *</label>
                <input 
                  type="text" 
                  value={provisionForm.adminName} 
                  onChange={e => setProvisionForm({ ...provisionForm, adminName: e.target.value })} 
                  required
                  className="w-full px-3 py-2.5 bg-black/50 border border-white/10 rounded-xl focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-sm font-semibold text-white placeholder-gray-600 shadow-inner"
                  placeholder="Ex: John Doe" 
                />
              </div>

              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5 ml-1">E-mail Master (Acesso) *</label>
                <input 
                  type="email" 
                  value={provisionForm.email} 
                  onChange={e => setProvisionForm({ ...provisionForm, email: e.target.value })} 
                  required
                  className="w-full px-3 py-2.5 bg-black/50 border border-white/10 rounded-xl focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-sm font-semibold text-white placeholder-gray-600 shadow-inner"
                  placeholder="admin@empresa.com" 
                />
              </div>

              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5 ml-1">Chave de Segurança Inicial *</label>
                <input 
                  type="password" 
                  value={provisionForm.password} 
                  onChange={e => setProvisionForm({ ...provisionForm, password: e.target.value })} 
                  required
                  minLength={6}
                  className="w-full px-3 py-2.5 bg-black/50 border border-white/10 rounded-xl focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-sm font-semibold text-white placeholder-gray-600 shadow-inner tracking-widest"
                  placeholder="••••••••" 
                />
              </div>

              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5 ml-1">Plano SaaS *</label>
                <select 
                  value={provisionForm.plan} 
                  onChange={e => setProvisionForm({ ...provisionForm, plan: e.target.value })}
                  className="w-full px-3 py-2.5 bg-black/50 border border-white/10 rounded-xl focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-sm font-semibold text-white cursor-pointer"
                >
                  <option value="starter">Starter Plan (Até 100 ativos)</option>
                  <option value="pro">Pro Plan (Até 1000 ativos)</option>
                  <option value="enterprise">Enterprise (Ilimitado + Whitelabel)</option>
                </select>
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowProvisionModal(false)} className="flex-1 px-4 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-gray-300 font-bold text-xs uppercase tracking-wider transition-colors">Cancelar</button>
                <button type="submit" disabled={provisionLoading}
                  className="flex-1 px-4 py-3 bg-indigo-600 text-white rounded-xl font-bold text-xs uppercase tracking-wider shadow-lg disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                >
                  {provisionLoading ? 'Provisionando...' : 'Inicializar Conta'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ════════════════ EDIT PLAN MODAL ════════════════ */}
      {editingTenant && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-[#121214] border border-white/10 rounded-3xl p-6 w-full max-w-sm shadow-2xl relative animate-[scaleUp_0.3s_ease-out]">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-indigo-500 to-transparent opacity-60"></div>
            
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-black text-white uppercase tracking-tight">Editar Inquilino</h2>
              <button onClick={() => setEditingTenant(null)} className="p-1 hover:bg-white/5 rounded-full text-gray-400 hover:text-white transition-colors"><X size={18} /></button>
            </div>

            <form onSubmit={handleUpdateTenant} className="space-y-4 text-left">
              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5 ml-1">Razão Social / Nome Fantasia</label>
                <input 
                  type="text" 
                  value={editForm.companyName} 
                  onChange={e => setEditForm({ ...editForm, companyName: e.target.value })} 
                  required
                  className="w-full px-3 py-2.5 bg-black/50 border border-white/10 rounded-xl focus:outline-none focus:border-indigo-500 text-sm font-semibold text-white shadow-inner"
                />
              </div>

              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5 ml-1">Plano Atual</label>
                <select 
                  value={editForm.plan} 
                  onChange={e => setEditForm({ ...editForm, plan: e.target.value })}
                  className="w-full px-3 py-2.5 bg-black/50 border border-white/10 rounded-xl focus:outline-none focus:border-indigo-500 text-sm font-semibold text-white cursor-pointer"
                >
                  <option value="starter">Starter Plan</option>
                  <option value="pro">Pro Plan</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5 ml-1">Status Operacional</label>
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
                <button type="button" onClick={() => setEditingTenant(null)} className="flex-1 px-4 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-gray-300 font-bold text-xs uppercase tracking-wider transition-colors">Cancelar</button>
                <button type="submit" className="flex-1 px-4 py-3 bg-indigo-600 text-white rounded-xl font-bold text-xs uppercase tracking-wider shadow-lg flex items-center justify-center gap-2 hover:bg-indigo-700 transition-colors">
                  <Save size={14}/> Salvar Alterações
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ════════════════ DELETE MODAL ════════════════ */}
      {deletingTenant && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-[#121214] border border-white/10 rounded-3xl p-6 w-full max-w-sm shadow-2xl relative text-center animate-[scaleUp_0.3s_ease-out]">
            <div className="w-14 h-14 bg-rose-500/10 border border-rose-500/30 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertTriangle size={28} />
            </div>
            
            <h3 className="font-black text-white text-lg uppercase tracking-tight mb-2">Excluir Inquilino</h3>
            <p className="text-xs text-gray-400 leading-relaxed mb-6">
              Tem certeza que deseja excluir permanentemente a empresa <strong className="text-white">"{deletingTenant.companyName}"</strong>? 
              Essa ação removerá o registro e os acessos imediatos da plataforma SaaS.
            </p>

            <div className="flex gap-3">
              <button onClick={() => setDeletingTenant(null)} className="flex-1 px-4 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-gray-300 font-bold text-xs uppercase tracking-wider transition-colors">Cancelar</button>
              <button onClick={handleDeleteTenant} disabled={deleteLoading} className="flex-1 px-4 py-3 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold text-xs uppercase tracking-wider transition-colors disabled:opacity-50">
                {deleteLoading ? 'Removendo...' : 'Sim, Remover'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default TenantManager;
