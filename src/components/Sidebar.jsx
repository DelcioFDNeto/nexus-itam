// src/components/Sidebar.jsx
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Server, 
  ClipboardCheck, 
  CheckSquare, 
  Users, 
  FolderGit2, // <--- Ícone de Projetos (Importante estar aqui)
  LogOut 
} from 'lucide-react';
import logo from '../assets/logo-shineray.png'; 

const Sidebar = () => {
  const location = useLocation();

  const isActive = (path) => {
    return location.pathname === path ? 'bg-gray-800 text-white shadow-md' : 'text-gray-400 hover:bg-gray-800 hover:text-white';
  };

  return (
    <div className="h-screen w-64 bg-black text-white flex flex-col fixed left-0 top-0 border-r border-gray-800 z-50">
      
      {/* Logo Area */}
      <div className="p-6 flex justify-center border-b border-gray-800">
        <img src={logo} alt="Shineray" className="h-12 object-contain" />
      </div>

      {/* Menu Navigation */}
      <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
        
        <p className="px-4 text-[10px] font-bold text-gray-500 uppercase tracking-widest mt-4 mb-2">Geral</p>
        
        <Link to="/" className={`flex items-center gap-3 p-3 rounded-xl transition-all font-bold text-sm ${isActive('/')}`}>
          <LayoutDashboard size={20} />
          Dashboard
        </Link>

        <p className="px-4 text-[10px] font-bold text-gray-500 uppercase tracking-widest mt-6 mb-2">Gestão de Ativos</p>

        <Link to="/assets" className={`flex items-center gap-3 p-3 rounded-xl transition-all font-bold text-sm ${isActive('/assets')}`}>
          <Server size={20} />
          Inventário
        </Link>

        <Link to="/audit" className={`flex items-center gap-3 p-3 rounded-xl transition-all font-bold text-sm ${isActive('/audit')}`}>
          <ClipboardCheck size={20} />
          Auditoria
        </Link>

        <p className="px-4 text-[10px] font-bold text-gray-500 uppercase tracking-widest mt-6 mb-2">Gestão & Pessoas</p>

        {/* --- MENU PROJETOS (Certifique-se que este bloco está aqui) --- */}
        <Link to="/projects" className={`flex items-center gap-3 p-3 rounded-xl transition-all font-bold text-sm ${isActive('/projects')}`}>
          <FolderGit2 size={20} />
          Projetos
        </Link>

        <Link to="/tasks" className={`flex items-center gap-3 p-3 rounded-xl transition-all font-bold text-sm ${isActive('/tasks')}`}>
          <CheckSquare size={20} />
          Tarefas
        </Link>

        <Link to="/employees" className={`flex items-center gap-3 p-3 rounded-xl transition-all font-bold text-sm ${isActive('/employees')}`}>
          <Users size={20} />
          Equipa / TI
        </Link>

      </nav>

      {/* Footer / Logout */}
      <div className="p-4 border-t border-gray-800">
        <button className="flex items-center gap-3 p-3 text-red-500 hover:bg-red-500/10 rounded-xl w-full transition-all font-bold text-sm">
          <LogOut size={20} />
          Sair
        </button>
        <p className="text-center text-[10px] text-gray-600 mt-4">v1.2.0 • Shineray ITAM</p>
      </div>

    </div>
  );
};

export default Sidebar;