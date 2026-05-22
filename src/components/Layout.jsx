// src/components/Layout.jsx
import React, { useState, useEffect } from 'react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import GlobalSearch from './GlobalSearch';
import { Toaster } from 'sonner';
import { 
  Home, Box, QrCode, Search, Plus, Settings, Menu, Bell, User
} from 'lucide-react';
import Logo from './Logo';

const Layout = ({ children }) => {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    const savedState = localStorage.getItem('sidebar_collapsed');
    return savedState ? JSON.parse(savedState) : false;
  });
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const toggleSidebar = () => {
    const newState = !isSidebarCollapsed;
    setIsSidebarCollapsed(newState);
    localStorage.setItem('sidebar_collapsed', JSON.stringify(newState));
  };

  // Scroll sempre para o topo ao trocar de rotas/páginas
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Busca Global: Ctrl+K ou Cmd+K
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setIsSearchOpen(true);
      }
      // Novo Ativo: Alt+N ou Option+N
      if (e.altKey && e.key === 'n') {
        e.preventDefault();
        navigate('/assets/new');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate]);

  return (
    <div className="flex min-h-screen bg-[#F4F4F5] dark:bg-slate-950 font-sans text-gray-900 dark:text-white selection:bg-brand selection:text-white transition-colors duration-300">
      <Toaster richColors position="top-right" />
      {/* ----------------------------------------------------- */}
      {/*                  DESKTOP LAYOUT                       */}
      {/* ----------------------------------------------------- */}
      
      {/* 1. SIDEBAR DESKTOP */}
      <div className={`hidden md:block fixed h-full z-40 transition-all duration-500 cubic-bezier(0.4, 0, 0.2, 1) ${isSidebarCollapsed ? 'w-[100px]' : 'w-[280px]'}`}>
        <Sidebar 
          isCollapsed={isSidebarCollapsed} 
          toggleCollapse={toggleSidebar}
          onSearchClick={() => setIsSearchOpen(true)} 
        />
      </div>

      {/* 2. DESKTOP MAIN AREA */}
      <div className={`hidden md:flex flex-1 flex-col min-h-screen transition-all duration-500 ${isSidebarCollapsed ? 'ml-[100px]' : 'ml-[280px]'}`}>
          {/* Header Desktop (Optional, if needed for breadcrumbs/profile) */}
          <main className="flex-1 w-full max-w-[1920px] mx-auto animate-fade-in p-6">
              {children}
          </main>
      </div>


      {/* ----------------------------------------------------- */}
      {/*                   MOBILE LAYOUT                       */}
      {/* ----------------------------------------------------- */}

      <div className="md:hidden flex flex-col flex-1 min-h-screen relative w-full bg-[#FAFAFA] dark:bg-slate-950">
          
          {/* 1. TOP BAR MOBILE (Sticky & Glass) */}
          <div className="sticky top-0 z-30 w-full px-5 py-3 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md flex justify-between items-center safe-area-pt border-b border-gray-100 dark:border-slate-700">
              <div className="flex items-center gap-3">
                  <button onClick={() => setIsMobileMenuOpen(true)} className="p-1 -ml-1 text-gray-800 dark:text-gray-100 hover:text-black dark:hover:text-white">
                      <Menu size={24} />
                  </button>
                  <div className="flex flex-col">
                      <Logo size="sm" />
                      <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mt-0.5 ml-8">Mobile Manager</p>
                  </div>
              </div>
              
              <div className="flex items-center gap-2">
                  <button onClick={() => setIsSearchOpen(true)} className="w-9 h-9 flex items-center justify-center bg-gray-100 rounded-full text-gray-600 active:scale-95 transition-all">
                      <Search size={18}/>
                  </button>
                  <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-gray-200 to-gray-100 p-[2px]">
                      <img src="https://ui-avatars.com/api/?name=Admin+User&background=000&color=fff" className="w-full h-full rounded-full object-cover" alt="Profile" />
                  </div>
              </div>
          </div>

          {/* 2. MOBILE CONTENT AREA */}
          <main className="flex-1 w-full pb-24 px-4 pt-4 overflow-x-hidden animate-slide-up safe-area-pb">
              {children}
          </main>

          {/* 3. BOTTOM NAVIGATION (Floating Island) */}
          <div className="fixed bottom-6 left-4 right-4 z-40">
              <div className="bg-black/90 backdrop-blur-xl text-white rounded-3xl shadow-2xl border border-white/10 p-2 flex justify-between items-center px-6 safe-area-pb">
                  
                  <Link to="/dashboard" className={`flex flex-col items-center gap-1 p-2 transition-all ${location.pathname.includes('/dashboard') ? 'text-white' : 'text-gray-500 dark:text-gray-400 hover:text-gray-300'}`}>
                      <Home size={22} strokeWidth={location.pathname.includes('/dashboard') ? 3 : 2} />
                  </Link>
                  
                  <Link to="/assets" className={`flex flex-col items-center gap-1 p-2 transition-all ${location.pathname.startsWith('/assets') && location.pathname !== '/assets/new' ? 'text-white' : 'text-gray-500 dark:text-gray-400 hover:text-gray-300'}`}>
                      <Box size={22} strokeWidth={location.pathname.startsWith('/assets') ? 3 : 2} />
                  </Link>

                  {/* CENTER ACTION BUTTON */}
                  <Link to="/assets/new" className="-mt-8">
                       <div className="w-14 h-14 bg-brand rounded-full flex items-center justify-center shadow-lg shadow-brand/50 border-4 border-[#FAFAFA] transform active:scale-90 transition-transform">
                           <Plus size={28} className="text-white" />
                       </div>
                  </Link>

                  <Link to="/audit" className={`flex flex-col items-center gap-1 p-2 transition-all ${location.pathname === '/audit' ? 'text-white' : 'text-gray-500 dark:text-gray-400 hover:text-gray-300'}`}>
                      <QrCode size={22} strokeWidth={location.pathname === '/audit' ? 3 : 2} />
                  </Link>

                  <Link to="/settings" className={`flex flex-col items-center gap-1 p-2 transition-all ${location.pathname === '/settings' ? 'text-white' : 'text-gray-500 dark:text-gray-400 hover:text-gray-300'}`}>
                      <Settings size={22} strokeWidth={location.pathname === '/settings' ? 3 : 2} />
                  </Link>

              </div>
          </div>

      </div>

      {/* MOBILE SIDEBAR */}
      <div className="md:hidden">
        <Sidebar 
          isOpen={isMobileMenuOpen} 
          onClose={() => setIsMobileMenuOpen(false)} 
        />
      </div>

      {/* GLOBAL SEARCH OVERLAY */}
      <GlobalSearch isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />

    </div>
  );
};

export default Layout;