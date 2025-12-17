// src/components/Sidebar.jsx
import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../services/firebase';
import { 
  LayoutDashboard, Server, PlusSquare, FileInput, 
  Users, LogOut, ClipboardCheck, X, ShieldCheck, Layers, Globe,
  FolderGit2, Settings 
} from 'lucide-react';
import logoShineray from '../assets/logo-shineray.png';

const Sidebar = ({ isOpen, onClose }) => {
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

  // Lógica de Item Ativo (Com efeito Neon suave)
  const isActive = (path) => {
    return location.pathname === path 
      ? "bg-gradient-to-r from-red-600 to-red-700 text-white shadow-lg shadow-red-900/40 border-l-4 border-white translate-x-1" 
      : "text-gray-400 hover:bg-white/5 hover:text-white hover:pl-5";
  };

  // Organização dos Menus
  const mainItems = [
    { path: '/dashboard', icon: <LayoutDashboard size={20} />, label: 'Dashboard' },
    { path: '/assets', icon: <Server size={20} />, label: 'Ativos' },
    { path: '/projects', icon: <FolderGit2 size={20} />, label: 'Projetos' },
    { path: '/tasks', icon: <Layers size={20} />, label: 'Tarefas' },
  ];

  const manageItems = [
    { path: '/audit', icon: <ClipboardCheck size={20} />, label: 'Auditoria' },
    { path: '/employees', icon: <Users size={20} />, label: 'Equipe' },
    { path: '/licenses', icon: <ShieldCheck size={20} />, label: 'Licenças' },
    { path: '/services', icon: <Globe size={20} />, label: 'Contratos' },
  ];

  const systemItems = [
    { path: '/import', icon: <FileInput size={20} />, label: 'Importação' },
    { path: '/settings', icon: <Settings size={20} />, label: 'Configurações' },
  ];

  return (
    <>
      {/* CSS INJETADO PARA SCROLLBAR CUSTOMIZADA (DARK) */}
      <style>{`
        .custom-sidebar-scroll::-webkit-scrollbar { width: 4px; }
        .custom-sidebar-scroll::-webkit-scrollbar-track { background: transparent; }
        .custom-sidebar-scroll::-webkit-scrollbar-thumb { background: #333; border-radius: 10px; }
        .custom-sidebar-scroll::-webkit-scrollbar-thumb:hover { background: #ef4444; }
      `}</style>

      {/* OVERLAY MOBILE */}
      <div 
        className={`fixed inset-0 bg-black/80 z-30 md:hidden backdrop-blur-sm transition-opacity duration-300 ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* SIDEBAR CONTAINER */}
      <div className={`
        fixed inset-y-0 left-0 z-40 w-64 bg-neutral-900 border-r border-black 
        flex flex-col shadow-2xl transition-transform duration-300 ease-in-out
        md:translate-x-0 md:static md:h-screen
        ${isOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        
        {/* --- 1. HEADER (LOGO) --- */}
        <div className="h-28 flex items-center justify-center bg-black relative shrink-0 border-b border-neutral-800 z-10">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-900 via-red-600 to-red-900"></div>
          
          <button onClick={onClose} className="absolute top-3 right-3 text-neutral-600 hover:text-white transition-colors md:hidden">
            <X size={24} />
          </button>

          <div className="bg-white rounded-xl shadow-[0_0_15px_rgba(255,255,255,0.1)] px-6 py-3 transform hover:scale-105 transition-transform duration-300 cursor-default">
              <img src={logoShineray} alt="Shineray" className="h-10 w-auto object-contain" />
          </div>
        </div>

        {/* --- 2. NAVEGAÇÃO (COM SCROLL REFINADO) --- */}
        <nav className="flex-1 px-3 py-6 space-y-6 overflow-y-auto custom-sidebar-scroll bg-neutral-900">
          
          {/* AÇÃO PRINCIPAL */}
          <Link 
             to="/assets/new"
             onClick={onClose}
             className="flex items-center justify-center gap-3 px-4 py-3.5 bg-gradient-to-br from-neutral-800 to-neutral-900 border border-neutral-700 text-white rounded-xl hover:border-red-600 hover:shadow-[0_0_10px_rgba(220,38,38,0.3)] transition-all group mx-1"
          >
             <PlusSquare size={20} className="text-red-500 group-hover:text-white transition-colors"/> 
             <span className="font-bold text-sm tracking-wide">NOVO CADASTRO</span>
          </Link>

          {/* GRUPO: PRINCIPAL */}
          <div className="space-y-1">
            <p className="px-4 text-[10px] font-black text-neutral-500 uppercase tracking-[0.2em] mb-2">Visão Geral</p>
            {mainItems.map((item) => (
              <Link key={item.path} to={item.path} onClick={onClose} className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-300 font-bold text-sm group ${isActive(item.path)}`}>
                <span className="group-hover:scale-110 transition-transform">{item.icon}</span> {item.label}
              </Link>
            ))}
          </div>

          {/* GRUPO: GESTÃO */}
          <div className="space-y-1">
            <p className="px-4 text-[10px] font-black text-neutral-500 uppercase tracking-[0.2em] mb-2">Operacional</p>
            {manageItems.map((item) => (
              <Link key={item.path} to={item.path} onClick={onClose} className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-300 font-bold text-sm group ${isActive(item.path)}`}>
                <span className="group-hover:scale-110 transition-transform">{item.icon}</span> {item.label}
              </Link>
            ))}
          </div>

          {/* GRUPO: SISTEMA */}
          <div className="space-y-1">
            <p className="px-4 text-[10px] font-black text-neutral-500 uppercase tracking-[0.2em] mb-2">Sistema</p>
            {systemItems.map((item) => (
              <Link key={item.path} to={item.path} onClick={onClose} className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-300 font-bold text-sm group ${isActive(item.path)}`}>
                <span className="group-hover:scale-110 transition-transform">{item.icon}</span> {item.label}
              </Link>
            ))}
          </div>

          {/* Espaçamento extra no fim */}
          <div className="h-6"></div>
        </nav>

        {/* --- 3. FOOTER --- */}
        <div className="p-4 bg-black shrink-0 border-t border-neutral-800 z-10">
          <button 
            onClick={handleLogout}
            className="flex items-center justify-center gap-2 px-4 py-3 w-full rounded-lg text-neutral-400 hover:bg-red-600/90 hover:text-white transition-all duration-300 font-bold text-xs uppercase tracking-widest group border border-transparent hover:border-red-500"
          >
            <LogOut size={16} className="group-hover:-translate-x-1 transition-transform" />
            Sair
          </button>
          <div className="mt-4 flex flex-col items-center opacity-40 hover:opacity-100 transition-opacity">
            <p className="text-[10px] text-white font-mono tracking-widest uppercase">Shineray ITAM <span className="text-red-500">v4.2</span></p>
          </div>
        </div>
      </div>
    </>
  );
};

export default Sidebar;