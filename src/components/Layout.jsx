// src/components/Layout.jsx
import React, { useState, useEffect } from 'react';
import { useLocation, Link } from 'react-router-dom';
import Sidebar from './Sidebar'; // Seu Sidebar atual
import GlobalSearch from './GlobalSearch';
import { 
  Home, Box, QrCode, Menu, Search, Plus, User 
} from 'lucide-react';

const Layout = ({ children }) => {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const location = useLocation();

  // Atalho de Teclado (Ctrl + K)
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
      
      {/* 1. SIDEBAR (Escondido no Mobile) */}
      <div className="hidden md:block w-64 fixed h-full z-30">
        <Sidebar onSearchClick={() => setIsSearchOpen(true)} />
      </div>

      {/* 2. ÁREA DE CONTEÚDO PRINCIPAL */}
      <div className="flex-1 md:ml-64 flex flex-col min-h-screen relative pb-20 md:pb-0">
        
        {/* Barra Superior Mobile (Só aparece em telas pequenas) */}
        <div className="md:hidden bg-white border-b border-gray-200 p-4 flex justify-between items-center sticky top-0 z-20 shadow-sm">
            <h1 className="font-black text-lg tracking-tight">Shineray <span className="text-red-600">TI</span></h1>
            <button onClick={() => setIsSearchOpen(true)} className="p-2 bg-gray-100 rounded-full text-gray-600">
                <Search size={20}/>
            </button>
        </div>

        {/* Conteúdo da Página */}
        <main className="flex-1 animate-in fade-in duration-300">
            {children}
        </main>

      </div>

      {/* 3. BOTTOM NAVIGATION (Só aparece no Mobile) */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex justify-around items-center py-3 px-2 z-40 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] safe-area-pb">
          
          <Link to="/" className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-colors ${location.pathname === '/' ? 'text-red-600 bg-red-50' : 'text-gray-400'}`}>
              <Home size={20} strokeWidth={location.pathname === '/' ? 3 : 2} />
              <span className="text-[9px] font-bold">Início</span>
          </Link>

          <Link to="/assets" className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-colors ${location.pathname.startsWith('/assets') && location.pathname !== '/assets/new' ? 'text-red-600 bg-red-50' : 'text-gray-400'}`}>
              <Box size={20} strokeWidth={location.pathname.startsWith('/assets') ? 3 : 2} />
              <span className="text-[9px] font-bold">Ativos</span>
          </Link>

          {/* Botão de Ação Central (Novo Ativo) */}
          <Link to="/assets/new" className="flex flex-col items-center justify-center -mt-8">
              <div className="bg-black text-white p-3.5 rounded-full shadow-lg border-4 border-gray-50 active:scale-95 transition-transform">
                  <Plus size={24} />
              </div>
              <span className="text-[9px] font-bold text-gray-500 mt-1">Novo</span>
          </Link>

          <Link to="/audit" className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-colors ${location.pathname === '/audit' ? 'text-red-600 bg-red-50' : 'text-gray-400'}`}>
              <QrCode size={20} strokeWidth={location.pathname === '/audit' ? 3 : 2} />
              <span className="text-[9px] font-bold">Audit</span>
          </Link>

          <button onClick={() => setIsSearchOpen(true)} className="flex flex-col items-center gap-1 p-2 rounded-xl text-gray-400 active:text-black">
              <Search size={20} />
              <span className="text-[9px] font-bold">Buscar</span>
          </button>
      </div>

      {/* 4. COMPONENTE DE BUSCA GLOBAL */}
      <GlobalSearch isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />

    </div>
  );
};

export default Layout;