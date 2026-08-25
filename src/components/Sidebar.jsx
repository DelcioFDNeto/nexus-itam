// src/components/Sidebar.jsx
import React, { useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Server, PlusSquare, FileInput,
  Users, LogOut, ClipboardCheck, X, ShieldCheck, Layers, Globe,
  FolderGit2, Settings, ChevronLeft, ChevronRight, Search, Activity, UserCog, Building2, Moon, Sun,
} from 'lucide-react';
import Logo from './Logo';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { can, isSuperadmin, ROLE_LABELS } from '../utils/permissions';

/**
 * Navegacao lateral.
 *
 * Dois modos, um componente:
 *  - `isCollapsed` / `toggleCollapse` → coluna fixa do desktop (>= lg)
 *  - `isOpen` / `onClose`             → drawer deslizante de mobile e tablet
 *
 * Os itens sao derivados de `can()`: um usuario nunca ve um atalho para uma tela
 * que a rota vai recusar. Antes o menu escondia por `role` em dois lugares
 * diferentes e as rotas nao verificavam nada.
 */
const Sidebar = ({ isOpen, onClose, isCollapsed = false, toggleCollapse, onSearchClick }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser, logout } = useAuth();
  const { isDark, setTheme } = useTheme();

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
        title: 'Visao Geral',
        items: [
          { path: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', cap: 'assets:read' },
          { path: '/assets', icon: Server, label: 'Ativos', cap: 'assets:read' },
          { path: '/projects', icon: FolderGit2, label: 'Projetos', cap: 'projects:write' },
          { path: '/tasks', icon: Layers, label: 'Tarefas', cap: 'tasks:write' },
        ],
      },
      {
        title: 'Gestao',
        items: [
          { path: '/audit', icon: ClipboardCheck, label: 'Auditoria', cap: 'audit:run' },
          { path: '/employees', icon: Users, label: 'Equipe', cap: 'employees:write' },
          { path: '/licenses', icon: ShieldCheck, label: 'Licencas', cap: 'licenses:write' },
          { path: '/services', icon: Globe, label: 'Contratos', cap: 'contracts:write' },
          { path: '/agent', icon: Activity, label: 'Agente ITAM', cap: 'agent:manage' },
        ],
      },
      {
        title: 'Sistema',
        items: [
          { path: '/import', icon: FileInput, label: 'Importacao', cap: 'assets:import' },
          { path: '/users', icon: UserCog, label: 'Acessos', cap: 'users:manage' },
          { path: '/settings', icon: Settings, label: 'Configuracoes', cap: 'settings:read' },
        ],
      },
    ];

    return groups
      .map((group) => ({ ...group, items: group.items.filter((item) => can(currentUser, item.cap)) }))
      .filter((group) => group.items.length > 0);
  }, [master, currentUser]);

  const isActive = (path) =>
    path === '/dashboard' ? location.pathname === path : location.pathname.startsWith(path);

  const canCreate = can(currentUser, 'assets:write');

  return (
    <>
      {/* Overlay do drawer */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-sm lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`
          fixed inset-y-0 left-0 z-50 flex h-full flex-col
          border-r border-slate-200 bg-white shadow-2xl
          dark:border-slate-800 dark:bg-slate-900
          transition-transform duration-300 ease-out
          lg:static lg:z-auto lg:shadow-none lg:translate-x-0
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
          ${isCollapsed ? 'w-[88px]' : 'w-[272px]'}
        `}
        aria-label="Navegacao principal"
      >
        {/* --- Cabecalho --- */}
        <div
          className={`relative flex h-20 shrink-0 items-center border-b border-slate-100 dark:border-slate-800 ${
            isCollapsed ? 'justify-center' : 'justify-between px-5'
          }`}
        >
          <button
            onClick={() => (isCollapsed ? toggleCollapse?.() : navigate('/dashboard'))}
            className="flex items-center gap-2 transition-transform hover:scale-[1.02]"
          >
            <Logo size="sm" showText={!isCollapsed} />
          </button>

          {toggleCollapse && (
            <button
              onClick={toggleCollapse}
              aria-label={isCollapsed ? 'Expandir menu' : 'Recolher menu'}
              className="absolute -right-3.5 top-7 z-10 hidden h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 shadow-md transition-colors hover:text-brand dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 lg:flex"
            >
              {isCollapsed ? <ChevronRight size={14} strokeWidth={3} /> : <ChevronLeft size={14} strokeWidth={3} />}
            </button>
          )}

          {onClose && (
            <button
              onClick={onClose}
              aria-label="Fechar menu"
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 lg:hidden"
            >
              <X size={20} />
            </button>
          )}
        </div>

        {/* --- Acoes rapidas --- */}
        {!master && (
          <div className={`shrink-0 space-y-2 pt-5 ${isCollapsed ? 'px-4' : 'px-5'}`}>
            {canCreate && (
              <Link
                to="/assets/new"
                onClick={onClose}
                title="Novo cadastro"
                className={`flex items-center justify-center gap-2 bg-slate-900 text-white shadow-lg shadow-slate-900/20 transition-all hover:bg-slate-800 active:scale-95 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100 ${
                  isCollapsed ? 'mx-auto h-11 w-11 rounded-2xl' : 'rounded-xl px-4 py-3'
                }`}
              >
                <PlusSquare size={18} className="shrink-0" />
                {!isCollapsed && (
                  <span className="whitespace-nowrap text-xs font-black uppercase tracking-wider">Novo item</span>
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
                className={`group flex items-center justify-center gap-2 border border-slate-200 bg-white text-slate-700 shadow-sm transition-all hover:border-brand/40 hover:text-brand dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 ${
                  isCollapsed ? 'mx-auto h-11 w-11 rounded-2xl' : 'w-full rounded-xl px-4 py-2.5'
                }`}
              >
                <Search size={17} className="shrink-0 text-slate-400 group-hover:text-brand" />
                {!isCollapsed && (
                  <span className="flex flex-1 items-center justify-between">
                    <span className="text-xs font-bold">Busca global</span>
                    <kbd className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] tracking-widest text-slate-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300">
                      Ctrl K
                    </kbd>
                  </span>
                )}
              </button>
            )}
          </div>
        )}

        {/* --- Navegacao --- */}
        <nav className="custom-scrollbar mt-6 flex-1 space-y-6 overflow-y-auto pb-4">
          {menuGroups.map((group) => (
            <div key={group.title} className="space-y-1">
              {isCollapsed ? (
                <div className="mx-5 my-3 h-px bg-slate-100 dark:bg-slate-800" />
              ) : (
                <p className="mb-2 px-6 text-[10px] font-black uppercase tracking-widest text-slate-400">
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
                      group relative mx-3 flex items-center gap-3 rounded-xl transition-all duration-200
                      ${isCollapsed ? 'mx-auto h-11 w-11 justify-center' : 'px-4 py-2.5'}
                      ${
                        active
                          ? 'bg-brand font-bold text-white shadow-md shadow-brand/30'
                          : 'text-slate-500 hover:bg-slate-100 hover:text-brand dark:text-slate-400 dark:hover:bg-slate-800'
                      }
                    `}
                  >
                    <Icon size={isCollapsed ? 21 : 19} className="shrink-0" />
                    {!isCollapsed && <span className="text-sm font-semibold tracking-wide">{label}</span>}

                    {isCollapsed && (
                      <span className="pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 dark:bg-white dark:text-slate-900">
                        {label}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* --- Rodape: identidade + acoes --- */}
        <div className={`shrink-0 border-t border-slate-100 p-4 dark:border-slate-800 ${isCollapsed ? 'space-y-2' : ''}`}>
          {!isCollapsed && (
            <div className="mb-3 flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-800/60">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-black text-white dark:bg-white dark:text-slate-900">
                {(currentUser?.name || currentUser?.email || 'U').slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold text-slate-800 dark:text-slate-100">
                  {currentUser?.name || 'Usuario'}
                </p>
                <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  {ROLE_LABELS[currentUser?.role] || 'Sem perfil'}
                </p>
              </div>
            </div>
          )}

          <div className={isCollapsed ? 'space-y-2' : 'grid grid-cols-2 gap-2'}>
            <button
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
              title="Alternar tema"
              className={`flex items-center justify-center gap-2 rounded-xl border border-slate-200 py-2.5 text-slate-500 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 ${
                isCollapsed ? 'mx-auto h-11 w-11 border-0 py-0' : ''
              }`}
            >
              {isDark ? <Sun size={17} className="text-amber-500" /> : <Moon size={17} className="text-indigo-500" />}
              {!isCollapsed && <span className="text-[10px] font-black uppercase tracking-wider">Tema</span>}
            </button>

            <button
              onClick={handleLogout}
              title="Encerrar sessao"
              className={`flex items-center justify-center gap-2 rounded-xl border border-slate-200 py-2.5 text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-red-950/40 dark:hover:text-red-400 ${
                isCollapsed ? 'mx-auto h-11 w-11 border-0 py-0' : ''
              }`}
            >
              <LogOut size={17} />
              {!isCollapsed && <span className="text-[10px] font-black uppercase tracking-wider">Sair</span>}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
