import React, { useState, useEffect } from 'react';
import { db } from '../services/firebase';
import { collection, getDocs, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { 
  Building2, Users, Calendar, Activity, 
  Search, Shield, AlertTriangle, Play, Pause, ExternalLink, RefreshCcw, UserCog, Mail
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

const TenantManager = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    // Proteção rigorosa: Apenas Superadmins entram aqui
    if (currentUser?.role !== 'superadmin') {
      toast.error('Acesso negado. Área restrita à Administração Global.');
      navigate('/dashboard');
      return;
    }
    loadTenants();
  }, [currentUser]);

  const loadTenants = async () => {
    setLoading(true);
    try {
      // Busca todas as empresas (tenants)
      const tenantsSnap = await getDocs(collection(db, 'tenants'));
      const tenantsData = tenantsSnap.docs.map(doc => ({ ...doc.data(), refId: doc.id }));

      // Busca todos os usuários para cruzar quem é o admin de cada tenant
      const usersSnap = await getDocs(collection(db, 'users'));
      const usersData = usersSnap.docs.map(doc => doc.data());

      // Faz o join (cruza os dados)
      const enrichedTenants = tenantsData.map(tenant => {
        // Encontra o usuário 'owner' ou 'admin' desse tenant
        const adminUser = usersData.find(u => u.tenantId === tenant.id && (u.role === 'owner' || u.role === 'admin'));
        return {
          ...tenant,
          adminName: adminUser ? adminUser.name : 'N/A',
          adminEmail: adminUser ? adminUser.email : 'N/A',
          usersCount: usersData.filter(u => u.tenantId === tenant.id).length
        };
      });

      setTenants(enrichedTenants.sort((a, b) => b.createdAt - a.createdAt));
    } catch (error) {
      console.error("Erro ao carregar tenants:", error);
      toast.error("Falha ao carregar a lista de empresas.");
    } finally {
      setLoading(false);
    }
  };

  const toggleTenantStatus = async (tenantId, currentStatus) => {
    const newStatus = currentStatus === 'active' ? 'suspended' : 'active';
    try {
      await updateDoc(doc(db, 'tenants', tenantId), { status: newStatus });
      toast.success(`Empresa ${newStatus === 'active' ? 'ativada' : 'suspensa'} com sucesso.`);
      setTenants(tenants.map(t => t.id === tenantId ? { ...t, status: newStatus } : t));
    } catch (error) {
      console.error(error);
      toast.error("Erro ao alterar status da empresa.");
    }
  };

  const filteredTenants = tenants.filter(t => 
    t.companyName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.adminEmail?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusBadge = (status) => {
    if (status === 'active') return <span className="px-2.5 py-1 bg-green-100 text-green-700 text-[10px] font-black uppercase rounded border border-green-200">Ativo</span>;
    if (status === 'suspended') return <span className="px-2.5 py-1 bg-red-100 text-red-700 text-[10px] font-black uppercase rounded border border-red-200">Suspenso</span>;
    return <span className="px-2.5 py-1 bg-gray-100 text-gray-700 text-[10px] font-black uppercase rounded border border-gray-200">{status}</span>;
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto pb-24">
      
      {/* HEADER GLOBAL */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 bg-slate-900 rounded-3xl p-6 md:p-8 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none"></div>
        <div className="relative z-10 flex items-center gap-4">
          <div className="p-4 bg-white/10 backdrop-blur text-white rounded-2xl border border-white/10">
            <Shield size={32} />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-black text-white uppercase tracking-tight">Painel de Controle Global</h1>
            <p className="text-indigo-200 font-medium text-sm mt-1">Gestão de Inquilinos (Tenants) e Contas SaaS B2B.</p>
          </div>
        </div>
        
        <div className="relative z-10">
           <button onClick={loadTenants} className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg font-bold text-sm transition-colors border border-white/10">
             <RefreshCcw size={16} className={loading ? 'animate-spin' : ''} /> Atualizar Lista
           </button>
        </div>
      </div>

      {/* DASHBOARD STATS */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-4">
            <div className="p-3 bg-blue-50 text-blue-600 rounded-xl"><Building2 size={24}/></div>
            <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Empresas</p>
                <p className="text-2xl font-black text-gray-900">{tenants.length}</p>
            </div>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-4">
            <div className="p-3 bg-green-50 text-green-600 rounded-xl"><Activity size={24}/></div>
            <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Ativas</p>
                <p className="text-2xl font-black text-gray-900">{tenants.filter(t => t.status === 'active').length}</p>
            </div>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-4">
            <div className="p-3 bg-red-50 text-red-600 rounded-xl"><AlertTriangle size={24}/></div>
            <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Suspensas</p>
                <p className="text-2xl font-black text-gray-900">{tenants.filter(t => t.status === 'suspended').length}</p>
            </div>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-4">
            <div className="p-3 bg-purple-50 text-purple-600 rounded-xl"><Users size={24}/></div>
            <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Usuários SaaS</p>
                <p className="text-2xl font-black text-gray-900">{tenants.reduce((acc, t) => acc + (t.usersCount || 0), 0)}</p>
            </div>
        </div>
      </div>

      {/* LISTAGEM DE EMPRESAS */}
      <div className="bg-white rounded-3xl border border-gray-200 shadow-sm overflow-hidden">
        
        {/* Toolbar */}
        <div className="p-5 border-b border-gray-100 bg-gray-50/50 flex flex-col md:flex-row justify-between items-center gap-4">
            <h2 className="font-black text-gray-800 uppercase tracking-wide flex items-center gap-2">
                <Building2 className="text-indigo-500" size={20}/> Empresas Registradas
            </h2>
            <div className="relative w-full md:w-96">
                <Search className="absolute left-3 top-2.5 text-gray-400" size={18} />
                <input 
                    type="text" 
                    placeholder="Buscar por nome, ID ou email..." 
                    className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-xl text-sm font-medium focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>
        </div>

        {/* Tabela de Inquilinos */}
        <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-[10px] uppercase font-black tracking-widest border-b border-gray-100">
                  <th className="p-4 pl-6">Empresa & ID</th>
                  <th className="p-4">Administrador / Owner</th>
                  <th className="p-4 text-center">Usuários</th>
                  <th className="p-4 text-center">Plano</th>
                  <th className="p-4 text-center">Status</th>
                  <th className="p-4 text-center">Data Registro</th>
                  <th className="p-4 pr-6 text-right">Ações Globais</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {loading ? (
                    <tr>
                        <td colSpan="7" className="p-8 text-center text-gray-400 font-bold uppercase tracking-widest">
                            <div className="flex flex-col items-center gap-3">
                                <div className="w-8 h-8 border-4 border-indigo-100 border-t-indigo-500 rounded-full animate-spin"></div>
                                Carregando Banco Global...
                            </div>
                        </td>
                    </tr>
                ) : filteredTenants.length === 0 ? (
                    <tr>
                        <td colSpan="7" className="p-8 text-center text-gray-500 font-medium">Nenhuma empresa encontrada com os termos de busca.</td>
                    </tr>
                ) : (
                    filteredTenants.map(tenant => (
                        <tr key={tenant.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors group">
                            <td className="p-4 pl-6">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600 font-black shrink-0 border border-indigo-100">
                                        {tenant.companyName ? tenant.companyName.substring(0,2).toUpperCase() : 'NA'}
                                    </div>
                                    <div>
                                        <p className="font-bold text-gray-900">{tenant.companyName || 'Empresa Sem Nome'}</p>
                                        <p className="text-[10px] font-mono text-gray-400 font-medium bg-gray-100 px-1.5 py-0.5 rounded inline-block mt-0.5">#{tenant.id}</p>
                                    </div>
                                </div>
                            </td>
                            <td className="p-4">
                                <p className="font-bold text-gray-800 flex items-center gap-1.5"><UserCog size={14} className="text-gray-400"/> {tenant.adminName}</p>
                                <p className="text-xs text-gray-500 flex items-center gap-1.5 mt-0.5"><Mail size={12} className="text-gray-400"/> {tenant.adminEmail}</p>
                            </td>
                            <td className="p-4 text-center">
                                <span className="bg-gray-100 text-gray-700 px-2.5 py-1 rounded-full text-xs font-black border border-gray-200">
                                    {tenant.usersCount}
                                </span>
                            </td>
                            <td className="p-4 text-center">
                                <span className="bg-gradient-to-r from-amber-500 to-orange-500 text-white px-2 py-1 rounded text-[10px] font-black uppercase tracking-wider shadow-sm">
                                    {tenant.plan || 'Starter'}
                                </span>
                            </td>
                            <td className="p-4 text-center">
                                {getStatusBadge(tenant.status)}
                            </td>
                            <td className="p-4 text-center text-xs font-medium text-gray-500">
                                {tenant.createdAt?.toDate ? new Date(tenant.createdAt.toDate()).toLocaleDateString('pt-BR') : 'N/A'}
                            </td>
                            <td className="p-4 pr-6 text-right">
                                <div className="flex items-center justify-end gap-2">
                                    {/* Action: Suspender / Reativar */}
                                    <button 
                                        onClick={() => toggleTenantStatus(tenant.id, tenant.status)}
                                        className={`p-2 rounded-lg border transition-all ${tenant.status === 'active' ? 'text-amber-600 border-amber-200 hover:bg-amber-50' : 'text-green-600 border-green-200 hover:bg-green-50'}`}
                                        title={tenant.status === 'active' ? 'Suspender Conta' : 'Reativar Conta'}
                                    >
                                        {tenant.status === 'active' ? <Pause size={16}/> : <Play size={16}/>}
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
    </div>
  );
};

export default TenantManager;
