// src/components/Layout.jsx
import React, { useState, useEffect } from 'react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import GlobalSearch from './GlobalSearch';
import { 
  Home, Box, QrCode, Search, Plus, Settings, Menu, Bell, User
} from 'lucide-react';

const Layout = ({ children }) => {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  // Persistência do estado da Sidebar
  useEffect(() => {
    const savedState = localStorage.getItem('sidebar_collapsed');
    if (savedState) setIsSidebarCollapsed(JSON.parse(savedState));
  }, []);

  const toggleSidebar = () => {
    const newState = !isSidebarCollapsed;
    setIsSidebarCollapsed(newState);
    localStorage.setItem('sidebar_collapsed', JSON.stringify(newState));
  };

  // Keyboard Shortcuts
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
    <div className="flex min-h-screen bg-[#F4F4F5] font-sans text-gray-900 selection:bg-red-500 selection:text-white">
      
      {/* ----------------------------------------------------- */}
      {/*                  DESKTOP LAYOUT                       */}
      {/* ----------------------------------------------------- */}
      
      {/* 1. SIDEBAR DESKTOP */}
      <div className={`hidden md:block fixed h-full z-40 transition-all duration-500 cubic-bezier(0.4, 0, 0.2, 1) ${isSidebarCollapsed ? 'w[88px]' : 'w-[280px]'}`}>
        <Sidebar 
          isCollapsed={isSidebarCollapsed} 
          toggleCollapse={toggleSidebar}
          onSearchClick={() => setIsSearchOpen(true)} 
        />
      </div>

      {/* 2. DESKTOP MAIN AREA */}
      <div className={`hidden md:flex flex-1 flex-col min-h-screen transition-all duration-500 ${isSidebarCollapsed ? 'ml-[88px]' : 'ml-[280px]'}`}>
          {/* Header Desktop (Optional, if needed for breadcrumbs/profile) */}
          <main className="flex-1 w-full max-w-[1920px] mx-auto animate-fade-in p-6">
              {children}
          </main>
      </div>


      {/* ----------------------------------------------------- */}
      {/*                   MOBILE LAYOUT                       */}
      {/* ----------------------------------------------------- */}

      <div className="md:hidden flex flex-col flex-1 min-h-screen relative w-full bg-[#FAFAFA]">
          
          {/* 1. TOP BAR MOBILE (Sticky & Glass) */}
          <div className="sticky top-0 z-30 w-full px-5 py-3 glass flex justify-between items-center safe-area-pt">
              <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center shadow-md">
                      <span className="text-white font-black text-xs">BY</span>
                  </div>
                  <div>
                      <h1 className="font-black text-sm text-gray-900 leading-none">BySabel</h1>
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Mobile Manager</p>
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
                  
                  <Link to="/dashboard" className={`flex flex-col items-center gap-1 p-2 transition-all ${location.pathname.includes('/dashboard') ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`}>
                      <Home size={22} strokeWidth={location.pathname.includes('/dashboard') ? 3 : 2} />
                  </Link>
                  
                  <Link to="/assets" className={`flex flex-col items-center gap-1 p-2 transition-all ${location.pathname.startsWith('/assets') && location.pathname !== '/assets/new' ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`}>
                      <Box size={22} strokeWidth={location.pathname.startsWith('/assets') ? 3 : 2} />
                  </Link>

                  {/* CENTER ACTION BUTTON */}
                  <Link to="/assets/new" className="-mt-8">
                       <div className="w-14 h-14 bg-[#E61E05] rounded-full flex items-center justify-center shadow-lg shadow-red-900/50 border-4 border-[#FAFAFA] transform active:scale-90 transition-transform">
                           <Plus size={28} className="text-white" />
                       </div>
                  </Link>

                  <Link to="/audit" className={`flex flex-col items-center gap-1 p-2 transition-all ${location.pathname === '/audit' ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`}>
                      <QrCode size={22} strokeWidth={location.pathname === '/audit' ? 3 : 2} />
                  </Link>

                  <Link to="/settings" className={`flex flex-col items-center gap-1 p-2 transition-all ${location.pathname === '/settings' ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`}>
                      <Settings size={22} strokeWidth={location.pathname === '/settings' ? 3 : 2} />
                  </Link>

              </div>
          </div>

      </div>

      {/* GLOBAL SEARCH OVERLAY */}
      <GlobalSearch isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />

    </div>
  );
};

export default Layout;