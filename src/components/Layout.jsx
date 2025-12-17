// src/components/Layout.jsx
import React, { useState, useEffect } from 'react';
import { useLocation, Link } from 'react-router-dom';
import Sidebar from './Sidebar';
import GlobalSearch from './GlobalSearch'; // Certifique-se que este arquivo existe (enviei anteriormente)
import { 
  Home, Box, QrCode, Search, Plus, Settings 
} from 'lucide-react';

const Layout = ({ children }) => {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const location = useLocation();

  // Atalho de Teclado (Ctrl + K) para abrir a busca
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setIsSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="flex min-h-screen bg-gray-50 font-sans text-gray-900">
      
      {/* 1. SIDEBAR (Apenas Desktop - md:block) */}
      <div className="hidden md:block w-64 fixed h-full z-30">
        <Sidebar onSearchClick={() => setIsSearchOpen(true)} />
      </div>

      {/* 2. ÁREA DE CONTEÚDO PRINCIPAL */}
      {/* Adicionamos margem à esquerda no desktop (ml-64) e padding bottom no mobile para o menu não tapar conteúdo */}
      <div className="flex-1 md:ml-64 flex flex-col min-h-screen relative pb-24 md:pb-0 transition-all duration-300">
        
        {/* Barra Superior Mobile (Apenas Mobile - md:hidden) */}
        <div className="md:hidden bg-white border-b border-gray-200 p-4 flex justify-between items-center sticky top-0 z-20 shadow-sm safe-area-pt">
            <div className="flex items-center gap-2">
                <div className="bg-black text-white p-1.5 rounded text-xs font-black">SH</div>
                <h1 className="font-black text-lg tracking-tight text-gray-900">Shineray <span className="text-red-600">TI</span></h1>
            </div>
            <button onClick={() => setIsSearchOpen(true)} className="p-2 bg-gray-50 rounded-full text-gray-500 border border-gray-100 active:scale-95 transition-transform">
                <Search size={20}/>
            </button>
        </div>

        {/* Conteúdo da Página Injetado Aqui */}
        <main className="flex-1 animate-in fade-in duration-300 w-full max-w-[100vw] overflow-x-hidden">
            {children}
        </main>

      </div>

      {/* 3. BOTTOM NAVIGATION (Menu Inferior - Apenas Mobile) */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-gray-200 flex justify-between items-end py-2 px-6 z-40 shadow-[0_-4px_20px_-5px_rgba(0,0,0,0.1)] safe-area-pb">
          
          <Link to="/" className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${location.pathname === '/' ? 'text-black font-bold' : 'text-gray-400 font-medium'}`}>
              <Home size={22} strokeWidth={location.pathname === '/' ? 2.5 : 2} />
              <span className="text-[9px]">Início</span>
          </Link>

          <Link to="/assets" className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${location.pathname.startsWith('/assets') && location.pathname !== '/assets/new' ? 'text-black font-bold' : 'text-gray-400 font-medium'}`}>
              <Box size={22} strokeWidth={location.pathname.startsWith('/assets') ? 2.5 : 2} />
              <span className="text-[9px]">Ativos</span>
          </Link>

          {/* Botão de Ação Central (Novo Ativo) - Flutuante */}
          <Link to="/assets/new" className="flex flex-col items-center justify-center -mb-4 group">
              <div className="bg-black text-white p-4 rounded-2xl shadow-xl shadow-gray-300 border-4 border-gray-50 group-active:scale-95 transition-transform mb-1">
                  <Plus size={26} />
              </div>
              <span className="text-[9px] font-bold text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity">Novo</span>
          </Link>

          <Link to="/audit" className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${location.pathname === '/audit' ? 'text-black font-bold' : 'text-gray-400 font-medium'}`}>
              <QrCode size={22} strokeWidth={location.pathname === '/audit' ? 2.5 : 2} />
              <span className="text-[9px]">Audit</span>
          </Link>

          {/* Agora linka para Configurações em vez de Busca (já que busca está no topo) */}
          <Link to="/settings" className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${location.pathname === '/settings' ? 'text-black font-bold' : 'text-gray-400 font-medium'}`}>
              <Settings size={22} strokeWidth={location.pathname === '/settings' ? 2.5 : 2} />
              <span className="text-[9px]">Config</span>
          </Link>
      </div>

      {/* 4. COMPONENTE DE BUSCA GLOBAL (Overlay) */}
      <GlobalSearch isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />

    </div>
  );
};

export default Layout;