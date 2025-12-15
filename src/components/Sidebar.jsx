// src/components/Sidebar.jsx
import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../services/firebase';
import { 
  LayoutDashboard, Server, PlusSquare, FileInput, 
  Users, LogOut, ClipboardCheck, X, ShieldCheck, Layers, Globe,
  FolderGit2 // <--- Ícone adicionado para Projetos
} from 'lucide-react';
import logoShineray from '../assets/logo-shineray.png';

const Sidebar = ({ isOpen, onClose }) => {
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await signOut(auth);
    navigate('/');
  };

  // Estilo do botão ativo: Vermelho Shineray com borda branca à esquerda
  const isActive = (path) => {
    return location.pathname === path 
      ? "bg-red-600 text-white shadow-lg shadow-red-900/50 scale-105 border-l-4 border-white" 
      : "text-gray-400 hover:bg-neutral-800 hover:text-white hover:pl-5";
  };

  // --- LISTA DE MENUS ATUALIZADA ---
  const menuItems = [
    { path: '/dashboard', icon: <LayoutDashboard size={20} />, label: 'Dashboard' },
    { path: '/assets', icon: <Server size={20} />, label: 'Ativos' },
    
    // --- NOVO ITEM: PROJETOS ---
    { path: '/projects', icon: <FolderGit2 size={20} />, label: 'Projetos' },
    
    { path: '/tasks', icon: <Layers size={20} />, label: 'Tarefas' }, // Separei Tarefas de Projetos
    { path: '/licenses', icon: <ShieldCheck size={20} />, label: 'Licenças Soft.' },
    { path: '/services', icon: <Globe size={20} />, label: 'Contratos & Links' },
    { path: '/employees', icon: <Users size={20} />, label: 'Equipe' },
    { path: '/audit', icon: <ClipboardCheck size={20} />, label: 'Auditoria Mobile' },
    { path: '/assets/new', icon: <PlusSquare size={20} />, label: 'Novo Cadastro' },
    { path: '/import', icon: <FileInput size={20} />, label: 'Importação' },
  ];

  return (
    <>
      {/* OVERLAY MOBILE (Fundo escuro ao abrir no celular) */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/90 z-30 md:hidden backdrop-blur-sm transition-opacity"
          onClick={onClose}
        />
      )}

      {/* SIDEBAR CONTAINER */}
      <div className={`
        fixed inset-y-0 left-0 z-40 w-64 bg-neutral-900 border-r border-black 
        flex flex-col shadow-2xl transition-transform duration-300 ease-in-out
        md:translate-x-0 md:static md:h-full 
        ${isOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        
        {/* --- ÁREA DA LOGO --- */}
        <div className="h-28 flex items-center justify-center bg-black relative shrink-0 border-b border-neutral-800">
          {/* Faixa Vermelha Decorativa */}
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-800 via-red-600 to-red-800"></div>
          
          {/* Botão Fechar (Só Mobile) */}
          <button onClick={onClose} className="absolute top-3 right-3 text-neutral-500 hover:text-white md:hidden">
            <X size={24} />
          </button>

          {/* Box Branco da Logo */}
          <div className="bg-white rounded-xl shadow-lg shadow-white/5 px-6 py-3 transform hover:scale-105 transition-transform duration-300">
              <img 
                  src={logoShineray} 
                  alt="Shineray" 
                  className="h-10 w-auto object-contain" 
              />
          </div>
        </div>

        {/* --- MENU --- */}
        <nav className="flex-1 p-4 space-y-1.5 overflow-y-auto custom-scrollbar bg-neutral-900">
          <p className="px-4 text-[10px] font-black text-red-600 uppercase tracking-[0.25em] mb-3 mt-2 opacity-90">
              Gestão Corporativa
          </p>
          
          {menuItems.map((item) => (
            <Link 
              key={item.path} 
              to={item.path} 
              onClick={onClose} // Fecha menu no mobile ao clicar
              className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-300 font-bold text-sm group ${isActive(item.path)}`}
            >
              <span className="group-hover:scale-110 transition-transform">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>

        {/* --- FOOTER --- */}
        <div className="p-4 bg-black shrink-0 border-t border-neutral-800">
          <button 
            onClick={handleLogout}
            className="flex items-center justify-center gap-2 px-4 py-3 w-full rounded-lg text-neutral-400 hover:bg-red-600 hover:text-white transition-all duration-300 font-bold text-xs uppercase tracking-wide group"
          >
            <LogOut size={16} className="group-hover:-translate-x-1 transition-transform" />
            Sair
          </button>
          <div className="mt-3 flex flex-col items-center">
            <p className="text-[9px] text-neutral-600 font-mono tracking-widest uppercase">Shineray ITAM v4.0</p>
          </div>
        </div>
      </div>
    </>
  );
};

export default Sidebar;