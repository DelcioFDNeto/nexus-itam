// src/components/Sidebar.jsx
import React, { useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Server, PlusSquare, FileInput,
  Users, LogOut, ClipboardCheck, X, ShieldCheck, Layers, Globe,
  FolderGit2, Settings, ChevronLeft, ChevronRight, Search, Activity, UserCog, Building2, Moon, Sun, FileSignature, RefreshCw,
} from 'lucide-react';
import Logo from './Logo';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { usePWA } from '../contexts/PWAContext';
import { can, isSuperadmin, ROLE_LABELS } from '../utils/permissions';
import { isModuleEnabled } from '../utils/entitlements';

/**
 * Navegacao lateral estilo console de engenharia.
 */
const Sidebar = ({ isOpen, onClose, isCollapsed = false, toggleCollapse, onSearchClick }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser, logout } = useAuth();
  const { isDark, setTheme } = useTheme();
  const { needRefresh, applyUpdate } = usePWA();

  const master = isSuperadmin(currentUser);

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/', { replace: true });
    } catch (error) {
      console.error('Erro ao sair', error);
    }
  };

  const menuGroups = useMemo(() => {
    if (master) {
      return [
        {
          title: 'Nexus Master',
          items: [
            { path: '/dashboard', icon: LayoutDashboard, label: 'Painel Geral' },
            { path: '/admin/tenants', icon: Building2, label: 'Empresas' },
            { path: '/admin/users', icon: Users, label: 'Acessos Global' },
            { path: '/admin/plans', icon: Layers, label: 'Planos & Limites' },
          ],
        },
      ];
    }

    const groups = [
      {
        title: 'Visão Geral',
        items: [
          { path: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', cap: 'assets:read' },
          { path: '/assets', icon: Server, label: 'Ativos', cap: 'assets:read' },
          { path: '/projects', icon: FolderGit2, label: 'Projetos', cap: 'projects:write', feature: 'projects' },
          { path: '/tasks', icon: Layers, label: 'Tarefas', cap: 'tasks:write', feature: 'projects' },
        ],
      },
      {
        title: 'Operações',
        items: [
          { path: '/audit', icon: ClipboardCheck, label: 'Auditoria', cap: 'audit:run', feature: 'audit' },
          { path: '/termos', icon: FileSignature, label: 'Termos', cap: 'terms:read' },
          { path: '/employees', icon: Users, label: 'Equipe', cap: 'employees:write' },
          { path: '/licenses', icon: ShieldCheck, label: 'Licenças', cap: 'licenses:write', feature: 'licenses' },
          { path: '/services', icon: Globe, label: 'Contratos', cap: 'contracts:write', feature: 'contracts' },
          { path: '/agent', icon: Activity, label: 'Agente & NexusDesk', cap: 'agent:manage', feature: 'agent' },
        ],
      },
      {
        title: 'Configurações',
        items: [
          { path: '/import', icon: FileInput, label: 'Importação', cap: 'assets:import', feature: 'import' },
          { path: '/users', icon: UserCog, label: 'Acessos', cap: 'users:manage' },
          { path: '/settings', icon: Settings, label: 'Ajustes', cap: 'settings:read' },
        ],
      },
    ];

    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter(
          (item) => can(currentUser, item.cap) && (!item.feature || isModuleEnabled(currentUser, item.feature)),
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [master, currentUser]);

  const isActive = (path) =>
    path === '/dashboard' ? location.pathname === path : location.pathname.startsWith(path);

  const canCreate = can(currentUser, 'assets:write');

  return (
    <>
      {/* Overlay do drawer mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`
          fixed inset-y-0 left-0 z-50 flex h-full flex-col
          border-r border-slate-200/90 bg-white
          dark:border-slate-800 dark:bg-slate-900/95
          transition-transform duration-200 ease-out
          lg:static lg:z-auto lg:translate-x-0
          ${isOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}
          ${isCollapsed ? 'w-[76px]' : 'w-[256px]'}
        `}
        aria-label="Navegacao principal"
      >
        {/* Cabecalho */}
        <div
          className={`relative flex h-16 shrink-0 items-center border-b border-slate-200/80 dark:border-slate-800 ${
            isCollapsed ? 'justify-center' : 'justify-between px-4'
          }`}
        >
          <button
            onClick={() => (isCollapsed ? toggleCollapse?.() : navigate('/dashboard'))}
            className="flex items-center gap-2"
          >
            <Logo size="sm" showText={!isCollapsed} />
          </button>

          {toggleCollapse && (
            <button
              onClick={toggleCollapse}
              aria-label={isCollapsed ? 'Expandir menu' : 'Recolher menu'}
              className="absolute -right-3 top-5 z-10 hidden h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:text-brand dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 lg:flex"
            >
              {isCollapsed ? <ChevronRight size={13} strokeWidth={2.5} /> : <ChevronLeft size={13} strokeWidth={2.5} />}
            </button>
          )}

          {onClose && (
            <button
              onClick={onClose}
              aria-label="Fechar menu"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 lg:hidden"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Acoes rapidas */}
        {(onSearchClick || (!master && canCreate)) && (
          <div className={`shrink-0 space-y-2 pt-4 ${isCollapsed ? 'px-3' : 'px-3.5'}`}>
            {!master && canCreate && (
              <Link
                to="/assets/new"
                onClick={onClose}
                title="Novo item"
                className={`flex items-center justify-center gap-2 bg-slate-900 text-white transition-colors hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100 ${
                  isCollapsed ? 'mx-auto h-10 w-10 rounded-lg' : 'rounded-lg px-3 py-2'
                }`}
              >
                <PlusSquare size={16} className="shrink-0" />
                {!isCollapsed && (
                  <span className="whitespace-nowrap text-xs font-semibold">Novo Item</span>
                )}
              </Link>
            )}

            {onSearchClick && (
              <button
                onClick={() => {
                  onSearchClick();
                  onClose?.();
                }}
                title="Busca global (Ctrl+K)"
                className={`group flex items-center justify-center gap-2 border border-slate-200/90 bg-slate-50 text-slate-600 transition-colors hover:border-slate-300 hover:bg-white dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:bg-slate-800 ${
                  isCollapsed ? 'mx-auto h-10 w-10 rounded-lg' : 'w-full rounded-lg px-3 py-1.5'
                }`}
              >
                <Search size={15} className="shrink-0 text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-200" />
                {!isCollapsed && (
                  <span className="flex flex-1 items-center justify-between">
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Buscar...</span>
                    <kbd className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                      Ctrl K
                    </kbd>
                  </span>
                )}
              </button>
            )}
          </div>
        )}

        {/* Navegacao Principal */}
        <nav className="custom-scrollbar mt-4 flex-1 space-y-4 overflow-y-auto px-2 pb-4">
          {menuGroups.map((group) => (
            <div key={group.title} className="space-y-0.5">
              {isCollapsed ? (
                <div className="mx-2 my-2 h-px bg-slate-200/60 dark:bg-slate-800" />
              ) : (
                <p className="px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  {group.title}
                </p>
              )}

              {group.items.map(({ path, icon: Icon, label }) => {
                const active = isActive(path);
                return (
                  <Link
                    key={path}
                    to={path}
                    onClick={onClose}
                    title={isCollapsed ? label : undefined}
                    aria-current={active ? 'page' : undefined}
                    className={`
                      group relative flex items-center gap-2.5 rounded-lg transition-colors
                      ${isCollapsed ? 'mx-auto h-10 w-10 justify-center' : 'px-2.5 py-2 text-xs'}
                      ${
                        active
                          ? 'bg-brand font-semibold text-white shadow-sm'
                          : 'font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-slate-100'
                      }
                    `}
                  >
                    <Icon size={17} className="shrink-0" />
                    {!isCollapsed && <span className="truncate">{label}</span>}

                    {isCollapsed && (
                      <span className="pointer-events-none absolute left-full ml-2.5 whitespace-nowrap rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 dark:bg-white dark:text-slate-900 z-50">
                        {label}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Rodape */}
        <div className={`shrink-0 border-t border-slate-200/80 p-3 dark:border-slate-800 ${isCollapsed ? 'space-y-2' : ''}`}>
          {needRefresh && !isCollapsed && (
            <button
              type="button"
              onClick={applyUpdate}
              className="mb-2.5 w-full flex items-center justify-center gap-2 rounded-lg bg-brand text-white px-3 py-2 text-xs font-semibold shadow-sm hover:bg-brand-dark transition-colors"
            >
              <RefreshCw size={13} className="animate-spin" />
              <span>Nova versão disponível</span>
            </button>
          )}

          {!isCollapsed && (
            <div className="mb-2.5 flex items-center gap-2.5 rounded-lg bg-slate-50 border border-slate-200/70 p-2 dark:bg-slate-800/40 dark:border-slate-800">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-800 text-[11px] font-bold text-white dark:bg-slate-700">
                {(currentUser?.name || currentUser?.email || 'U').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-slate-800 dark:text-slate-200">
                  {currentUser?.name || 'Usuário'}
                </p>
                <p className="truncate text-[10px] text-slate-400 dark:text-slate-500 font-medium" title={currentUser?.companyName}>
                  {ROLE_LABELS[currentUser?.role] || 'Sem perfil'}
                  {!master && currentUser?.companyName ? ` · ${currentUser.companyName}` : ''}
                </p>
              </div>
            </div>
          )}

          <div className={isCollapsed ? 'space-y-2' : 'grid grid-cols-2 gap-2'}>
            <button
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
              title="Alternar tema"
              className={`flex items-center justify-center gap-1.5 rounded-lg border border-slate-200/80 py-1.5 text-xs text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:text-slate-400 dark:hover:bg-slate-800/60 ${
                isCollapsed ? 'mx-auto h-10 w-10 border-0 py-0' : ''
              }`}
            >
              {isDark ? <Sun size={15} className="text-amber-500" /> : <Moon size={15} className="text-slate-600 dark:text-slate-400" />}
              {!isCollapsed && <span className="font-medium text-[11px]">Tema</span>}
            </button>

            <button
              onClick={handleLogout}
              title="Encerrar sessão"
              className={`flex items-center justify-center gap-1.5 rounded-lg border border-slate-200/80 py-1.5 text-xs text-slate-600 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:border-slate-800 dark:text-slate-400 dark:hover:bg-rose-950/30 dark:hover:text-rose-400 ${
                isCollapsed ? 'mx-auto h-10 w-10 border-0 py-0' : ''
              }`}
            >
              <LogOut size={15} />
              {!isCollapsed && <span className="font-medium text-[11px]">Sair</span>}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
