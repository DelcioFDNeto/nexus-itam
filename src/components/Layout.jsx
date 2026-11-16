// src/components/Layout.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import {
  Home, Box, QrCode, Search, Plus, Settings, Menu, Monitor,
  Building2, Users, Layers, LayoutDashboard, MoreHorizontal, Download,
} from 'lucide-react';
import Sidebar from './Sidebar';
import GlobalSearch from './GlobalSearch';
import Logo from './Logo';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { usePWA } from '../contexts/PWAContext';
import { can, isSuperadmin, ROLE_LABELS } from '../utils/permissions';
import { hasFeature, isModuleEnabled } from '../utils/entitlements';
import { useAgentAutoSync } from '../hooks/useAgentAutoSync';

const SIDEBAR_KEY = 'sidebar_collapsed';
const SIDEBAR_WIDTH_KEY = 'nexus_sidebar_width_v1';
const MIN_SIDEBAR_WIDTH = 250;
const MAX_SIDEBAR_WIDTH = 340;

/**
 * Calcula a largura ideal (em px) para acomodar o nome da empresa
 * com limite modesto de caracteres exibíveis (evita esticar demais).
 */
const computeOptimalSidebarWidth = (companyName) => {
  if (!companyName || companyName === 'Nexus ITAM') return 264;
  const chars = Math.min(companyName.length, 22);
  // Base confortável de 258px + 3.5px por caractere além de 10
  const target = Math.round(258 + Math.max(0, chars - 10) * 3.5);
  return Math.min(Math.max(target, 264), 305);
};

/**
 * Casca da aplicação.
 *
 * Ponto crítico: renderiza `{children}` uma única vez.
 * Navegação lateral flutuante com suporte a largura ajustável,
 * auto-calibração pelo nome da empresa e modo recolhido tático.
 */
const Layout = ({ children }) => {
  const { currentUser } = useAuth();
  const { resolvedTheme } = useTheme();
  const { isStandalone, canInstall, isInstallModalOpen, setIsInstallModalOpen } = usePWA();
  const location = useLocation();
  const navigate = useNavigate();

  const master = isSuperadmin(currentUser);
  // Aceite automático do Agente ITAM em segundo plano (só admin, se ligado).
  useAgentAutoSync();

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const menuTriggerRef = useRef(null);
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(SIDEBAR_KEY) ?? 'false');
    } catch {
      return false;
    }
  });

  // Indicador de conectividade em tempo real para header mobile
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' && 'onLine' in navigator ? navigator.onLine : true,
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const optimalWidth = useMemo(
    () => computeOptimalSidebarWidth(currentUser?.companyName),
    [currentUser?.companyName],
  );

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
      if (saved) {
        const parsed = Number(saved);
        if (!isNaN(parsed) && parsed >= MIN_SIDEBAR_WIDTH && parsed <= MAX_SIDEBAR_WIDTH) {
          return parsed;
        }
      }
    } catch {
      /* modo privado */
    }
    return computeOptimalSidebarWidth(currentUser?.companyName);
  });

  const handleWidthChange = useCallback((newWidth) => {
    const clamped = Math.min(Math.max(newWidth, MIN_SIDEBAR_WIDTH), MAX_SIDEBAR_WIDTH);
    setSidebarWidth(clamped);
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, JSON.stringify(clamped));
    } catch {
      /* noop */
    }
  }, []);

  const handleResetWidth = useCallback(() => {
    setSidebarWidth(optimalWidth);
    try {
      localStorage.removeItem(SIDEBAR_WIDTH_KEY);
    } catch {
      /* noop */
    }
  }, [optimalWidth]);

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

  // Identidade da empresa também na aba do navegador (e no ícone, com whitelabel).
  const whitelabel = !master && hasFeature(currentUser, 'whitelabel');
  const companyName = currentUser?.companyName;
  const logoUrl = currentUser?.logoUrl;
  useEffect(() => {
    if (master) document.title = 'Nexus Master · Console';
    else if (companyName && companyName !== 'Nexus ITAM') document.title = whitelabel ? companyName : `${companyName} · Nexus ITAM`;
    else document.title = 'Nexus ITAM — Gestão Inteligente de Ativos';

    const icon = document.querySelector("link[rel='icon'][type='image/webp']") || document.querySelector("link[rel='icon']");
    if (!icon) return;
    if (!icon.dataset.defaultHref) icon.dataset.defaultHref = icon.getAttribute('href');
    icon.setAttribute('href', whitelabel && logoUrl ? logoUrl : icon.dataset.defaultHref);
  }, [master, whitelabel, companyName, logoUrl]);

  // Atalhos de teclado (desktop)
  useEffect(() => {
    const onKeyDown = (e) => {
      const hasOpenModal =
        isInstallModalOpen ||
        isSearchOpen ||
        Boolean(document.querySelector('[aria-modal="true"]'));

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        if (hasOpenModal) return;
        e.preventDefault();
        setIsSearchOpen(true);
        return;
      }
      if (e.altKey && e.key.toLowerCase() === 'n' && !isSuperadmin(currentUser) && can(currentUser, 'assets:write')) {
        if (hasOpenModal) return;
        e.preventDefault();
        navigate('/assets/new');
        return;
      }
      if (e.key === 'Escape' && isMobileMenuOpen && !hasOpenModal) {
        setIsMobileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate, currentUser, isMobileMenuOpen, isSearchOpen, isInstallModalOpen]);

  // Barra inferior mobile: montada a partir das permissões reais do usuário
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
      { to: '/dashboard', icon: Home, label: 'Início' },
      { to: '/assets', icon: Box, label: 'Ativos' },
      can(currentUser, 'assets:write') ? { to: '/assets/new', icon: Plus, label: 'Novo', primary: true } : null,
      can(currentUser, 'agent:manage') && isModuleEnabled(currentUser, 'agent') ? { to: '/agent', icon: Monitor, label: 'NexusDesk' } : null,
      can(currentUser, 'audit:run') && isModuleEnabled(currentUser, 'audit') ? { to: '/audit', icon: QrCode, label: 'Auditoria' } : null,
      can(currentUser, 'settings:read')
        ? { to: '/settings', icon: Settings, label: 'Ajustes' }
        : can(currentUser, 'tasks:write') && isModuleEnabled(currentUser, 'projects')
          ? { to: '/tasks', icon: Layers, label: 'Tarefas' }
          : null,
    ].filter(Boolean).slice(0, 5);
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
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-[#09090b] dark:text-[#fafafa] selection:bg-brand selection:text-brand-fg">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:inline-flex focus:min-h-[44px] focus:items-center focus:rounded-lg focus:bg-brand focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-brand-fg focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 dark:focus:ring-offset-[#09090b]"
      >
        Pular para o conteúdo
      </a>

      <Toaster richColors position="top-right" theme={resolvedTheme} />

      {/* ------------------------------------------------------------------ */}
      {/* NAVEGAÇÃO LATERAL FLUTUANTE — visível a partir de lg (>=1024px).    */}
      {/* ------------------------------------------------------------------ */}
      <div
        style={{ width: isCollapsed ? 78 : sidebarWidth }}
        className="hidden lg:block fixed top-3.5 bottom-3.5 left-3.5 z-40 transition-[width] duration-150 ease-out"
      >
        <Sidebar
          isCollapsed={isCollapsed}
          toggleCollapse={toggleSidebar}
          onSearchClick={() => setIsSearchOpen(true)}
          width={sidebarWidth}
          onWidthChange={handleWidthChange}
          onResetWidth={handleResetWidth}
        />
      </div>

      {/* Drawer para mobile e tablet com slide-over e safe areas */}
      <div className="lg:hidden">
        <Sidebar
          isOpen={isMobileMenuOpen}
          onClose={() => setIsMobileMenuOpen(false)}
          onSearchClick={() => setIsSearchOpen(true)}
          returnFocusRef={menuTriggerRef}
        />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* COLUNA PRINCIPAL — uma única árvore para todos os breakpoints        */}
      {/* ------------------------------------------------------------------ */}
      <div
        style={{
          '--sidebar-offset': `${isCollapsed ? 96 : sidebarWidth + 18}px`,
        }}
        className="flex min-h-screen flex-col lg:[padding-left:var(--sidebar-offset)] transition-[padding] duration-150 ease-out"
      >
        {/* Topo compacto mobile estilo console com Safe Area Top */}
        <header className="lg:hidden sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 dark:border-zinc-800 dark:bg-[#111113]/95 backdrop-blur-xl safe-area-pt">
          <div className="flex items-center justify-between gap-2 px-3.5 py-2">
            {/* Esquerda: Menu Drawer, Logo e Empresa/Tenant */}
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={(e) => {
                  menuTriggerRef.current = e.currentTarget;
                  setIsMobileMenuOpen(true);
                }}
                aria-label="Abrir menu"
                aria-expanded={isMobileMenuOpen}
                data-icon-button="true"
                className="-ml-1.5 flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-[#18181b] transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <Menu size={20} aria-hidden="true" />
              </button>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <Logo size="sm" />
                  {/* Indicador sutil de conectividade em tempo real */}
                  <span
                    className="inline-flex items-center gap-1 shrink-0"
                    title={isOnline ? 'Conexão ativa (Online)' : 'Modo Offline (Sem internet)'}
                    aria-label={isOnline ? 'Online' : 'Offline'}
                  >
                    <span
                      aria-hidden="true"
                      className={`h-2 w-2 rounded-full transition-colors ${
                        isOnline
                          ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)]'
                          : 'bg-rose-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]'
                      }`}
                    />
                    {!isOnline && (
                      <span className="text-xs font-mono font-bold text-rose-600 dark:text-rose-400 uppercase tracking-tight">
                        Off
                      </span>
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-1 min-w-0">
                  <p className="truncate text-xs font-mono font-semibold uppercase tracking-wider text-slate-600 dark:text-zinc-400">
                    {currentUser?.companyName || 'Nexus ITAM'}
                  </p>
                  {currentUser?.tenantId && (
                    <span className="hidden sm:inline-block font-mono text-xs text-slate-500 dark:text-zinc-400 truncate">
                      · #{currentUser.tenantId.slice(0, 8)}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Direita: Botão Instalar App (quando disponível e não standalone), Busca Rápida e Avatar */}
            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              {!isStandalone && canInstall && (
                <button
                  type="button"
                  onClick={() => setIsInstallModalOpen(true)}
                  aria-label="Instalar App"
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-brand/30 bg-brand/10 hover:bg-brand/20 text-brand-aa px-3 py-2 text-xs font-semibold transition-colors active:scale-[0.98] shadow-sm cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  title="Instalar aplicativo Nexus ITAM no dispositivo"
                >
                  <Download size={14} strokeWidth={2.2} className="shrink-0" aria-hidden="true" />
                  <span className="text-xs font-bold uppercase tracking-wider">Instalar</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setIsSearchOpen(true)}
                aria-label="Buscar"
                data-icon-button="true"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-[#18181b] dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <Search size={18} aria-hidden="true" />
              </button>

              <div
                title={`${currentUser?.name || 'Usuário'} — ${ROLE_LABELS[currentUser?.role] || 'Operador'} (${currentUser?.companyName || 'Nexus ITAM'})`}
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 font-mono text-xs font-bold text-white dark:bg-[#18181b] border border-slate-700/60 dark:border-zinc-700 shadow-sm select-none"
              >
                {initials}
              </div>
            </div>
          </div>
        </header>

        {/* Conteúdo com Safe Area Bottom para não colidir com o Bottom Nav */}
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 px-4 pt-4 pb-28 sm:px-6 lg:px-8 lg:py-6 lg:pb-8 safe-area-pb focus:outline-none"
        >
          <div className="mx-auto w-full max-w-[1600px]">{children}</div>
        </main>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* BARRA INFERIOR — Bottom Navigation Bar Corporativa Nativa          */}
      {/* ------------------------------------------------------------------ */}
      <nav
        aria-label="Navegação rápida"
        className="lg:hidden fixed inset-x-3 z-40 bottom-[calc(0.6rem+env(safe-area-inset-bottom,0px))] sm:inset-x-auto sm:left-1/2 sm:w-[440px] sm:-translate-x-1/2"
      >
        <div className="flex items-center justify-around rounded-2xl border border-slate-200/80 bg-white/95 dark:border-zinc-800 dark:bg-[#111113]/95 backdrop-blur-xl px-2 py-1.5 shadow-[0_10px_30px_-5px_rgba(0,0,0,0.25)] dark:shadow-[0_12px_36px_-6px_rgba(0,0,0,0.7)] select-none">
          {bottomNav.map(({ to, icon: Icon, label, primary }) => {
            const active = isActive(to);
            if (primary) {
              return (
                <Link
                  key={to}
                  to={to}
                  aria-label={label}
                  className="group relative flex flex-1 min-h-[44px] min-w-[44px] flex-col items-center justify-center py-1 rounded-xl transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-brand-fg shadow-md shadow-brand/30 transition-transform group-hover:scale-105 group-active:scale-95">
                    <Icon size={19} strokeWidth={2.5} aria-hidden="true" />
                  </span>
                  <span className="mt-0.5 text-xs font-bold tracking-tight text-brand-aa">
                    {label}
                  </span>
                </Link>
              );
            }

            return (
              <Link
                key={to}
                to={to}
                aria-label={label}
                aria-current={active ? 'page' : undefined}
                className={`group relative flex flex-1 min-h-[44px] min-w-[44px] flex-col items-center justify-center py-1 px-1 rounded-xl transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                  active
                    ? 'text-brand-aa font-semibold'
                    : 'text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-[#fafafa]'
                }`}
              >
                {/* Active pill indicator com microinteração suave */}
                <span
                  className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors ${
                    active
                      ? 'bg-brand/15 text-brand-aa shadow-sm'
                      : 'bg-transparent text-slate-600 dark:text-zinc-400 group-hover:bg-slate-100/70 dark:group-hover:bg-[#18181b]'
                  }`}
                >
                  <Icon size={18} strokeWidth={active ? 2.4 : 1.9} aria-hidden="true" />
                </span>
                <span
                  className={`mt-0.5 text-xs tracking-tight transition-colors ${
                    active ? 'font-bold text-slate-900 dark:text-[#fafafa]' : 'font-medium'
                  }`}
                >
                  {label}
                </span>
              </Link>
            );
          })}

          <button
            type="button"
            onClick={(e) => {
              menuTriggerRef.current = e.currentTarget;
              setIsMobileMenuOpen(true);
            }}
            aria-label="Mais opções"
            aria-expanded={isMobileMenuOpen}
            className="group relative flex flex-1 min-h-[44px] min-w-[44px] flex-col items-center justify-center py-1 px-1 rounded-xl text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-[#fafafa] transition-colors active:scale-[0.98] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <span className="flex h-7 w-12 items-center justify-center rounded-full transition-colors group-hover:bg-slate-100/70 dark:group-hover:bg-[#18181b]">
              <MoreHorizontal size={18} strokeWidth={1.9} aria-hidden="true" />
            </span>
            <span className="mt-0.5 text-xs font-medium tracking-tight">Mais</span>
          </button>
        </div>
      </nav>

      <GlobalSearch
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        returnFocusRef={menuTriggerRef}
      />
    </div>
  );
};

export default Layout;
