// src/components/Sidebar.jsx
import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../services/firebase';
import { 
  LayoutDashboard, Server, PlusSquare, FileInput, 
  Users, LogOut, ClipboardCheck, X, ShieldCheck, Layers, Globe,
  FolderGit2, Settings, ChevronLeft, ChevronRight, Menu 
} from 'lucide-react';
import logo from '../assets/logo.png';

const Sidebar = ({ isOpen, onClose, isCollapsed, toggleCollapse }) => { // Recebe props de colapso
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate('/');
    } catch (error) {
      console.error("Erro ao sair", error);
    }
  };

  // Lógica de Item Ativo (Neon Effect)
  const isActive = (path) => {
    const active = location.pathname.startsWith(path) && (path !== '/' || location.pathname === '/');
    if (active) {
        return "bg-neutral-800 text-white shadow-[0_0_15px_rgba(255,255,255,0.1)] border-l-4 border-red-600";
    }
    return "text-gray-500 hover:bg-neutral-800 hover:text-white";
  };

  // Organização dos Menus
  const mainItems = [
    { path: '/dashboard', icon: <LayoutDashboard size={isCollapsed ? 24 : 20} />, label: 'Dashboard' },
    { path: '/assets', icon: <Server size={isCollapsed ? 24 : 20} />, label: 'Ativos' },
    { path: '/projects', icon: <FolderGit2 size={isCollapsed ? 24 : 20} />, label: 'Projetos' },
    { path: '/tasks', icon: <Layers size={isCollapsed ? 24 : 20} />, label: 'Tarefas' },
  ];

  const manageItems = [
    { path: '/audit', icon: <ClipboardCheck size={isCollapsed ? 24 : 20} />, label: 'Auditoria' },
    { path: '/employees', icon: <Users size={isCollapsed ? 24 : 20} />, label: 'Equipe' },
    { path: '/licenses', icon: <ShieldCheck size={isCollapsed ? 24 : 20} />, label: 'Licenças' },
    { path: '/services', icon: <Globe size={isCollapsed ? 24 : 20} />, label: 'Contratos' },
  ];

  const systemItems = [
    { path: '/import', icon: <FileInput size={isCollapsed ? 24 : 20} />, label: 'Importação' },
    { path: '/settings', icon: <Settings size={isCollapsed ? 24 : 20} />, label: 'Configurações' },
  ];

  return (
    <>
      <style>{`
        .custom-sidebar-scroll::-webkit-scrollbar { width: 0px; }
      `}</style>
      
      {/* Mobile Overlay */}
      <div 
        className={`fixed inset-0 bg-black/80 z-30 md:hidden backdrop-blur-sm transition-opacity duration-300 ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Sidebar Container */}
      <div className={`
        fixed inset-y-0 left-0 z-40 bg-[#0A0A0A] border-r border-[#1F1F1F] 
        flex flex-col shadow-2xl transition-all duration-300 ease-in-out
        md:static md:h-screen
        ${isOpen ? 'translate-x-0 w-64' : '-translate-x-full md:translate-x-0'}
        ${isCollapsed ? 'md:w-20' : 'md:w-64'}
      `}>
        
        {/* --- 1. HEADER (LOGO + TOGGLE) --- */}
        <div className={`h-20 flex items-center ${isCollapsed ? 'justify-center' : 'justify-between px-6'} bg-[#0A0A0A] relative shrink-0 border-b border-[#1F1F1F]`}>
           
           {!isCollapsed && (
             <div className="flex items-center gap-2 animate-in fade-in duration-300">
               <div className="w-8 h-8 bg-gradient-to-br from-red-600 to-red-800 rounded-lg flex items-center justify-center shadow-lg shadow-red-900/40">
                 <span className="font-black text-white text-xs">BY</span>
               </div>
               <span className="font-bold text-white tracking-tight">BySabel<span className="text-red-500">ITAM</span> <span className="text-[9px] bg-red-900/50 text-red-200 px-1 py-0.5 rounded ml-1 border border-red-800/50">v2.0</span></span>
             </div>
           )}

           {isCollapsed && (
             <div className="w-10 h-10 bg-gradient-to-br from-red-600 to-red-800 rounded-xl flex items-center justify-center shadow-lg shadow-red-900/40 cursor-pointer" onClick={toggleCollapse}>
                 <span className="font-black text-white text-sm">BY</span>
             </div>
           )}
           
           {/* Botão de Collapse (Desktop) */}
           <button 
             onClick={toggleCollapse} 
             className={`hidden md:flex w-6 h-6 items-center justify-center rounded-full bg-[#1F1F1F] text-gray-400 hover:text-white hover:bg-red-600 transition-all absolute -right-3 top-7 border border-[#0A0A0A] z-50`}
           >
             {isCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
           </button>

           {/* Botão Fechar (Mobile) */}
           <button onClick={onClose} className="md:hidden text-gray-500 hover:text-white">
             <X size={24} />
           </button>
        </div>

        {/* --- 2. NAVEGAÇÃO --- */}
        <nav className="flex-1 py-6 space-y-6 overflow-y-auto custom-sidebar-scroll">
          
          {/* BOTÃO NOVO (CONDENSADO SE COLAPSADO) */}
          <div className="px-3">
             <Link 
                to="/assets/new"
                onClick={onClose}
                className={`flex items-center justify-center gap-3 bg-white text-black hover:bg-gray-200 transition-all group overflow-hidden ${isCollapsed ? 'rounded-xl w-12 h-12 mx-auto' : 'rounded-lg px-4 py-3'}`}
                title="Novo Cadastro"
             >
                <PlusSquare size={20} className="shrink-0"/> 
                {!isCollapsed && <span className="font-black text-xs uppercase tracking-wider whitespace-nowrap">Novo Item</span>}
             </Link>
          </div>

          {/* MENUS LOOP */}
          {[
              { title: 'Visão Geral', items: mainItems },
              { title: 'Gestão', items: manageItems },
              { title: 'Sistema', items: systemItems }
          ].map((group, idx) => (
             <div key={idx} className="space-y-1">
               {!isCollapsed && <p className="px-6 text-[10px] font-black text-[#525252] uppercase tracking-[0.2em] mb-2 fade-in">{group.title}</p>}
               {isCollapsed && <div className="h-[1px] bg-[#1F1F1F] mx-4 my-2"></div>}
               
               {group.items.map((item) => (
                 <Link 
                    key={item.path} 
                    to={item.path} 
                    onClick={onClose} 
                    className={`
                        flex items-center gap-3 mx-2 rounded-lg transition-all duration-200 group relative
                        ${isCollapsed ? 'justify-center p-3' : 'px-4 py-2.5'}
                        ${isActive(item.path)}
                    `}
                    title={isCollapsed ? item.label : ''}
                 >
                   <span className={`transition-transform duration-300 ${isCollapsed ? '' : 'group-hover:translate-x-1'}`}>
                       {item.icon}
                   </span>
                   {!isCollapsed && <span className="font-bold text-sm">{item.label}</span>}
                   
                   {/* Tooltip Fake no Collapsed */}
                   {isCollapsed && (
                       <div className="absolute left-full ml-4 px-3 py-1 bg-white text-black text-xs font-bold rounded shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">
                           {item.label}
                       </div>
                   )}
                 </Link>
               ))}
             </div>
          ))}
          
        </nav>

        {/* --- 3. FOOTER --- */}
        <div className={`p-4 bg-[#0A0A0A] shrink-0 border-t border-[#1F1F1F] ${isCollapsed ? 'flex justify-center' : ''}`}>
          <button 
            onClick={handleLogout}
            className={`flex items-center justify-center gap-2 rounded-lg text-[#525252] hover:bg-neutral-800 hover:text-white transition-all duration-200 group ${isCollapsed ? 'w-10 h-10 p-0' : 'w-full px-4 py-3'}`}
            title="Sair"
          >
            <LogOut size={18} />
            {!isCollapsed && <span className="font-bold text-xs uppercase tracking-widest">Sair</span>}
          </button>
        </div>

      </div>
    </>
  );
};

export default Sidebar;