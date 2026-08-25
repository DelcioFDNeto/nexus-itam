// src/components/Layout.jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import {
  Home, Box, QrCode, Search, Plus, Settings, Menu,
  Building2, Users, Layers, LayoutDashboard, MoreHorizontal,
} from 'lucide-react';
import Sidebar from './Sidebar';
import GlobalSearch from './GlobalSearch';
import Logo from './Logo';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { can, isSuperadmin, ROLE_LABELS } from '../utils/permissions';

const SIDEBAR_KEY = 'sidebar_collapsed';

/**
 * Casca da aplicacao.
 *
 * Ponto critico corrigido: a versao anterior renderizava `{children}` duas vezes
 * — uma arvore para desktop e outra para mobile — escondendo uma delas por CSS.
 * Toda pagina montava em dobro, cada `useEffect` de carregamento disparava duas
 * vezes e o custo de leitura no Firestore dobrava em cada navegacao.
 * Agora existe UMA arvore de conteudo; so a navegacao muda por breakpoint.
 */
const Layout = ({ children }) => {
  const { currentUser } = useAuth();
  const { resolvedTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  const master = isSuperadmin(currentUser);

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(SIDEBAR_KEY) ?? 'false');
    } catch {
      return false;
    }
  });

  const toggleSidebar = useCallback(() => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_KEY, JSON.stringify(next));
      } catch {
        /* modo privado: apenas nao persiste */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  // Atalhos de teclado (desktop)
  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsSearchOpen(true);
      }
      if (e.altKey && e.key.toLowerCase() === 'n' && can(currentUser, 'assets:write')) {
        e.preventDefault();
        navigate('/assets/new');
      }
      if (e.key === 'Escape') setIsMobileMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate, currentUser]);

  // Barra inferior mobile: montada a partir das permissoes reais do usuario,
  // nao de um `if` fixo de superadmin.
  const bottomNav = useMemo(() => {
    if (master) {
      return [
        { to: '/dashboard', icon: LayoutDashboard, label: 'Painel' },
        { to: '/admin/tenants', icon: Building2, label: 'Empresas' },
        { to: '/admin/users', icon: Users, label: 'Acessos' },
        { to: '/admin/plans', icon: Layers, label: 'Planos' },
      ];
    }
    return [
      { to: '/dashboard', icon: Home, label: 'Inicio' },
      { to: '/assets', icon: Box, label: 'Ativos' },
      can(currentUser, 'assets:write') ? { to: '/assets/new', icon: Plus, label: 'Novo', primary: true } : null,
      can(currentUser, 'audit:run') ? { to: '/audit', icon: QrCode, label: 'Auditoria' } : null,
      can(currentUser, 'settings:read')
        ? { to: '/settings', icon: Settings, label: 'Ajustes' }
        : { to: '/tasks', icon: Layers, label: 'Tarefas' },
    ].filter(Boolean);
  }, [master, currentUser]);

  const isActive = (path) =>
    path === '/dashboard' ? location.pathname === path : location.pathname.startsWith(path);

  const initials = (currentUser?.name || currentUser?.email || 'U')
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 selection:bg-brand selection:text-white">
      <Toaster richColors position="top-right" theme={resolvedTheme} />

      {/* ------------------------------------------------------------------ */}
      {/* NAVEGACAO LATERAL — visivel a partir de lg (>=1024px).              */}
      {/* Entre 768px e 1024px (tablet) a sidebar fixa de 280px espremia o    */}
      {/* conteudo; nessa faixa usamos o drawer, como no mobile.              */}
      {/* ------------------------------------------------------------------ */}
      <div
        className={`hidden lg:block fixed inset-y-0 left-0 z-40 transition-[width] duration-300 ease-out ${
          isCollapsed ? 'w-[88px]' : 'w-[272px]'
        }`}
      >
        <Sidebar
          isCollapsed={isCollapsed}
          toggleCollapse={toggleSidebar}
          onSearchClick={() => setIsSearchOpen(true)}
        />
      </div>

      {/* Drawer para mobile e tablet */}
      <div className="lg:hidden">
        <Sidebar isOpen={isMobileMenuOpen} onClose={() => setIsMobileMenuOpen(false)} />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* COLUNA PRINCIPAL — uma unica arvore para todos os breakpoints        */}
      {/* ------------------------------------------------------------------ */}
      <div
        className={`flex min-h-screen flex-col transition-[padding] duration-300 ease-out ${
          isCollapsed ? 'lg:pl-[88px]' : 'lg:pl-[272px]'
        }`}
      >
        {/* Topo compacto: some no desktop, onde a sidebar ja cumpre o papel */}
        <header className="lg:hidden sticky top-0 z-30 border-b border-slate-200/70 bg-white/85 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/85 safe-area-pt">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <button
                onClick={() => setIsMobileMenuOpen(true)}
                aria-label="Abrir menu"
                className="-ml-1 rounded-lg p-2 text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Menu size={22} />
              </button>
              <div className="min-w-0">
                <Logo size="sm" />
                <p className="truncate text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {currentUser?.companyName || 'Nexus ITAM'}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => setIsSearchOpen(true)}
                aria-label="Buscar"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-600 active:scale-95 dark:bg-slate-800 dark:text-slate-300"
              >
                <Search size={18} />
              </button>
              <div
                title={`${currentUser?.name || ''} — ${ROLE_LABELS[currentUser?.role] || ''}`}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-[11px] font-black text-white dark:bg-white dark:text-slate-900"
              >
                {initials}
              </div>
            </div>
          </div>
        </header>

        {/* Conteudo: largura fluida, com teto legivel em telas muito largas */}
        <main className="flex-1 px-4 pt-4 pb-28 sm:px-6 lg:px-8 lg:py-8 lg:pb-8 safe-area-pb">
          <div className="mx-auto w-full max-w-[1600px]">{children}</div>
        </main>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* BARRA INFERIOR — apenas em telas pequenas                           */}
      {/* ------------------------------------------------------------------ */}
      <nav aria-label="Navegacao rapida" className="lg:hidden fixed inset-x-3 bottom-3 z-40 sm:inset-x-auto sm:left-1/2 sm:w-[420px] sm:-translate-x-1/2">
        <div className="flex items-center justify-around rounded-2xl border border-white/10 bg-slate-900/95 px-2 py-1.5 text-white shadow-2xl backdrop-blur-xl safe-area-pb">
          {bottomNav.map(({ to, icon: Icon, label, primary }) =>
            primary ? (
              <Link key={to} to={to} aria-label={label} className="-mt-6">
                <span className="flex h-14 w-14 items-center justify-center rounded-full border-4 border-slate-50 bg-brand shadow-lg shadow-brand/40 transition-transform active:scale-90 dark:border-slate-950">
                  <Icon size={22} className="text-white" />
                </span>
              </Link>
            ) : (
              <Link
                key={to}
                to={to}
                aria-label={label}
                aria-current={isActive(to) ? 'page' : undefined}
                className={`flex flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-2 transition-colors ${
                  isActive(to) ? 'text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon size={20} strokeWidth={isActive(to) ? 2.6 : 2} />
                <span className="text-[9px] font-bold uppercase tracking-wide">{label}</span>
              </Link>
            ),
          )}

          <button
            onClick={() => setIsMobileMenuOpen(true)}
            aria-label="Mais opcoes"
            className="flex flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-2 text-slate-400 hover:text-slate-200"
          >
            <MoreHorizontal size={20} />
            <span className="text-[9px] font-bold uppercase tracking-wide">Mais</span>
          </button>
        </div>
      </nav>

      <GlobalSearch isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
    </div>
  );
};

export default Layout;
