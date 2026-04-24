// src/components/Sidebar.jsx
import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../services/firebase';
import { 
  LayoutDashboard, Server, PlusSquare, FileInput, 
  Users, LogOut, ClipboardCheck, X, ShieldCheck, Layers, Globe,
  FolderGit2, Settings, ChevronLeft, ChevronRight, Menu, Search 
} from 'lucide-react';


const Sidebar = ({ isOpen, onClose, isCollapsed, toggleCollapse, onSearchClick }) => { // Recebe props de colapso
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

  // Lógica de Item Ativo (Luxo / SaaS Premium)
  const isActive = (path) => {
    const active = location.pathname.startsWith(path) && (path !== '/' || location.pathname === '/');
    if (active) {
        return "bg-gradient-to-r from-brand to-indigo-500 text-white shadow-md shadow-brand/30 border-none font-bold translate-x-1";
    }
    return "text-slate-500 hover:bg-indigo-50 hover:text-brand hover:translate-x-1";
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

      {/* Sidebar Container - Floating Island */}
      <div className={`
        fixed z-40 bg-white/70 backdrop-blur-2xl border border-white shadow-[0_8px_30px_rgb(0,0,0,0.06)] 
        flex flex-col transition-all duration-300 ease-in-out
        inset-y-0 left-0 md:top-4 md:bottom-4 md:left-4 md:rounded-[2rem]
        ${isOpen ? 'translate-x-0 w-64' : '-translate-x-full md:translate-x-0'}
        ${isCollapsed ? 'md:w-20' : 'md:w-[260px]'}
      `}>
        
        {/* --- 1. HEADER (LOGO + TOGGLE) --- */}
        <div className={`h-24 flex items-center ${isCollapsed ? 'justify-center' : 'justify-between px-7'} bg-transparent relative shrink-0 border-b border-gray-100/50`}>
           
           {!isCollapsed && (
             <div className="flex items-center gap-3 animate-in fade-in duration-300">
               <div className="w-9 h-9 bg-gradient-to-br from-brand to-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-brand/30 ring-4 ring-indigo-50">
                 <Layers className="text-white w-4 h-4" strokeWidth={2.5} />
               </div>
               <span className="font-black text-slate-800 tracking-tight text-lg">Nexus<span className="text-brand">ITAM</span> <span className="text-[9px] bg-indigo-50 text-brand px-1.5 py-0.5 rounded-full ml-1 border border-indigo-100 font-black relative -top-1 shadow-sm">v2.0</span></span>
             </div>
           )}

           {isCollapsed && (
             <div className="w-10 h-10 bg-gradient-to-br from-brand to-brand-dark rounded-xl flex items-center justify-center shadow-lg shadow-brand/40 cursor-pointer" onClick={toggleCollapse}>
                 <Layers className="text-white w-5 h-5" strokeWidth={2.5} />
             </div>
           )}
           
           {/* Botão de Collapse (Desktop) */}
           <button 
             onClick={toggleCollapse} 
             className={`hidden md:flex w-7 h-7 items-center justify-center rounded-full bg-white text-gray-400 hover:text-brand hover:bg-indigo-50 transition-all absolute -right-3.5 top-8 border border-gray-100 shadow-md z-50`}
           >
             {isCollapsed ? <ChevronRight size={14} strokeWidth={3} /> : <ChevronLeft size={14} strokeWidth={3} />}
           </button>

           {/* Botão Fechar (Mobile) */}
           <button onClick={onClose} className="md:hidden text-gray-500 hover:text-white">
             <X size={24} />
           </button>
        </div>

        {/* --- 2. NAVEGAÇÃO --- */}
        <nav className="flex-1 py-6 space-y-6 overflow-y-auto custom-sidebar-scroll">
          
          {/* BOTÃO NOVO (CONDENSADO SE COLAPSADO) */}
          <div className="px-5">
             <Link 
                to="/assets/new"
                onClick={onClose}
                className={`flex items-center justify-center gap-2 bg-slate-900 text-white hover:bg-slate-800 transition-all group overflow-hidden shadow-lg shadow-slate-900/20 active:scale-95 ${isCollapsed ? 'rounded-2xl w-12 h-12 mx-auto' : 'rounded-xl px-4 py-3.5'}`}
                title="Novo Cadastro"
             >
                <PlusSquare size={20} className="shrink-0 text-indigo-300"/> 
                {!isCollapsed && <span className="font-black text-xs uppercase tracking-wider whitespace-nowrap">Novo Item</span>}
             </Link>
          </div>

          {/* BOTÃO BUSCA GLOBAL (COM ATALHO) */}
          <div className="px-5 mt-3">
             <button 
                onClick={() => { if(onSearchClick) onSearchClick(); if(onClose) onClose(); }}
                className={`flex items-center justify-center gap-2 bg-white text-slate-700 hover:text-brand hover:border-brand/30 hover:bg-indigo-50/50 transition-all group overflow-hidden border border-gray-200 shadow-sm ${isCollapsed ? 'rounded-2xl w-12 h-12 mx-auto' : 'rounded-xl px-4 py-3 w-full'}`}
                title="Busca Global (Ctrl+K)"
             >
                <Search size={18} className="shrink-0 text-slate-400 group-hover:text-brand transition-colors"/> 
                {!isCollapsed && <div className="flex-1 flex items-center justify-between"><span className="font-bold text-xs">Busca Global</span><span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded border border-slate-200 font-mono tracking-widest hidden lg:block group-hover:bg-indigo-100 group-hover:border-indigo-200 group-hover:text-brand">Ctrl+K</span></div>}
             </button>
          </div>

          {/* MENUS LOOP */}
          {[
              { title: 'Visão Geral', items: mainItems },
              { title: 'Gestão', items: manageItems },
              { title: 'Sistema', items: systemItems }
          ].map((group, idx) => (
             <div key={idx} className="space-y-1 mt-6">
               {!isCollapsed && <p className="px-7 text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">{group.title}</p>}
               {isCollapsed && <div className="h-[1px] bg-gray-100 mx-6 my-4"></div>}
               
               {group.items.map((item) => (
                 <Link 
                    key={item.path} 
                    to={item.path} 
                    onClick={onClose} 
                    className={`
                        flex items-center gap-3 mx-4 rounded-xl transition-all duration-300 group relative
                        ${isCollapsed ? 'justify-center p-3.5 mx-auto w-12 h-12' : 'px-4 py-3'}
                        ${isActive(item.path)}
                    `}
                    title={isCollapsed ? item.label : ''}
                 >
                   <span className={`transition-transform duration-300`}>
                       {item.icon}
                   </span>
                   {!isCollapsed && <span className="font-bold text-sm tracking-wide">{item.label}</span>}
                   
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
        <div className={`p-5 bg-transparent shrink-0 mt-auto ${isCollapsed ? 'flex justify-center' : ''}`}>
          <button 
            onClick={handleLogout}
            className={`flex items-center justify-center gap-2 rounded-xl text-slate-400 hover:bg-red-50 hover:text-red-600 transition-all duration-300 group ${isCollapsed ? 'w-12 h-12 p-0' : 'w-full px-4 py-3 bg-gray-50/50 border border-gray-100/50'}`}
            title="Sair"
          >
            <LogOut size={18} className="group-hover:scale-110 transition-transform"/>
            {!isCollapsed && <span className="font-bold text-xs uppercase tracking-widest">Encerrar Sessão</span>}
          </button>
        </div>

      </div>
    </>
  );
};

export default Sidebar;