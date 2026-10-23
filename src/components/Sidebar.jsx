// src/components/Sidebar.jsx
import React, { useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Server, PlusSquare, FileInput,
  Users, LogOut, ClipboardCheck, X, ShieldCheck, Layers, Globe,
  FolderGit2, Settings, ChevronLeft, ChevronRight, Search, Activity, UserCog, Building2, Moon, Sun, FileSignature, RefreshCw, Shield,
} from 'lucide-react';
import Logo from './Logo';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { usePWA } from '../contexts/PWAContext';
import { can, isSuperadmin, ROLE_LABELS } from '../utils/permissions';
import { isModuleEnabled } from '../utils/entitlements';

/**
 * Sidebar autêntica Nexus — console de instrumentação física e telemetria de frotas.
 * Arquitetura de baías (rack bays), barramento de status operacional e acoplamento de trilho.
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
          code: '00',
          title: 'Cluster Master',
          items: [
            { path: '/dashboard', icon: LayoutDashboard, label: 'Painel Master' },
            { path: '/admin/tenants', icon: Building2, label: 'Empresas Clientes' },
            { path: '/admin/users', icon: Users, label: 'Acessos Globais' },
            { path: '/admin/plans', icon: Layers, label: 'Planos & Cotas' },
          ],
        },
      ];
    }

    const groups = [
      {
        code: '01',
        title: 'Núcleo & Frota',
        items: [
          { path: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', cap: 'assets:read' },
          { path: '/assets', icon: Server, label: 'Ativos de TI', cap: 'assets:read' },
          { path: '/projects', icon: FolderGit2, label: 'Projetos', cap: 'projects:write', feature: 'projects' },
          { path: '/tasks', icon: Layers, label: 'Tarefas', cap: 'tasks:write', feature: 'projects' },
        ],
      },
      {
        code: '02',
        title: 'Telemetria & Custódia',
        items: [
          { path: '/agent', icon: Activity, label: 'NexusDesk & RMM', badge: 'v3.1', cap: 'agent:manage', feature: 'agent' },
          { path: '/audit', icon: ClipboardCheck, label: 'Auditoria QR', cap: 'audit:run', feature: 'audit' },
          { path: '/termos', icon: FileSignature, label: 'Termos de Custódia', cap: 'terms:read' },
          { path: '/employees', icon: Users, label: 'Equipe & Posse', cap: 'employees:write' },
          { path: '/licenses', icon: ShieldCheck, label: 'Softwares & Chaves', cap: 'licenses:write', feature: 'licenses' },
          { path: '/services', icon: Globe, label: 'Contratos & SLAs', cap: 'contracts:write', feature: 'contracts' },
        ],
      },
      {
        code: '03',
        title: 'Políticas & Sistema',
        items: [
          { path: '/import', icon: FileInput, label: 'Ingestão em Massa', cap: 'assets:import', feature: 'import' },
          { path: '/users', icon: UserCog, label: 'Acessos & Funções', cap: 'users:manage' },
          { path: '/settings', icon: Settings, label: 'Ajustes & Políticas', cap: 'settings:read' },
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
          className="fixed inset-0 z-40 bg-slate-950/75 backdrop-blur-sm lg:hidden transition-opacity"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`
          fixed inset-y-0 left-0 z-50 flex h-full flex-col
          border-r border-slate-200/90 bg-[#F8FAFC]
          dark:border-slate-800/80 dark:bg-[#0B0F17]
          transition-transform duration-200 ease-out select-none
          lg:static lg:z-auto lg:translate-x-0
          ${isOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}
          ${isCollapsed ? 'w-[76px]' : 'w-[256px]'}
        `}
        aria-label="Navegacao principal"
      >
        {/* Cabecalho / Chassis Head */}
        <div
          className={`relative flex h-16 shrink-0 items-center border-b border-slate-200/80 dark:border-slate-800/80 ${
            isCollapsed ? 'justify-center' : 'justify-between px-3.5'
          }`}
        >
          <button
            onClick={() => (isCollapsed ? toggleCollapse?.() : navigate('/dashboard'))}
            className="flex items-center gap-2 group text-left min-w-0"
            title="Ir para o painel principal"
          >
            <Logo size="sm" showText={!isCollapsed} />
            {!isCollapsed && !master && (
              <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 shrink-0">
                ITAM
              </span>
            )}
          </button>

          {/* Toggle de recolher/expandir com visual de switch embutido */}
          {toggleCollapse && (
            <button
              onClick={toggleCollapse}
              aria-label={isCollapsed ? 'Expandir menu' : 'Recolher menu'}
              title={isCollapsed ? 'Expandir console' : 'Recolher console'}
              className="absolute -right-3 top-5 z-20 hidden h-6 w-6 items-center justify-center rounded-md border border-slate-200/90 bg-white text-slate-500 shadow-xs transition-colors hover:border-brand hover:text-brand dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 lg:flex"
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

        {/* Baía de Ações Rápidas & Comando */}
        {(onSearchClick || (!master && canCreate)) && (
          <div className={`shrink-0 space-y-2 pt-3.5 ${isCollapsed ? 'px-3' : 'px-3'}`}>
            {!master && canCreate && (
              <Link
                to="/assets/new"
                onClick={onClose}
                title="Novo Ativo (Atalho rápido)"
                className={`group flex items-center justify-center gap-2 rounded-lg bg-slate-900 text-white transition-colors hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100 shadow-sm ${
                  isCollapsed ? 'mx-auto h-9 w-9' : 'px-3 py-2'
                }`}
              >
                <PlusSquare size={15} className="shrink-0" />
                {!isCollapsed && (
                  <span className="flex-1 whitespace-nowrap text-xs font-semibold tracking-tight text-left">Novo Ativo</span>
                )}
                {!isCollapsed && (
                  <kbd className="hidden sm:inline font-mono text-[9px] opacity-60 bg-white/10 dark:bg-black/10 px-1 py-0.5 rounded">
                    +A
                  </kbd>
                )}
              </Link>
            )}

            {onSearchClick && (
              <button
                onClick={() => {
                  onSearchClick();
                  onClose?.();
                }}
                title="Busca global de hardware, seriais e módulos (Ctrl+K)"
                className={`group flex items-center justify-center gap-2 rounded-lg border border-slate-200/90 bg-white text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:bg-slate-900 ${
                  isCollapsed ? 'mx-auto h-9 w-9' : 'w-full px-2.5 py-1.5'
                }`}
              >
                <Search size={14} className="shrink-0 text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-200" />
                {!isCollapsed && (
                  <span className="flex flex-1 items-center justify-between">
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Buscar no cluster...</span>
                    <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[9px] text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                      Ctrl K
                    </kbd>
                  </span>
                )}
              </button>
            )}
          </div>
        )}

        {/* Trilho de Navegação Principal (Console Bays) */}
        <nav className="custom-scrollbar mt-3 flex-1 space-y-4 overflow-y-auto px-2 pb-3">
          {menuGroups.map((group) => (
            <div key={group.code} className="space-y-0.5">
              {/* Divisor de Baía Operacional */}
              {isCollapsed ? (
                <div className="flex flex-col items-center my-2" title={`Baía ${group.code}: ${group.title}`}>
                  <div className="w-5 h-px bg-slate-200/80 dark:bg-slate-800/80 mb-1" />
                  <span className="font-mono text-[8px] font-bold text-slate-400 dark:text-slate-600 select-none">
                    {group.code}
                  </span>
                </div>
              ) : (
                <div className="flex items-center justify-between px-2.5 py-1 text-[10px] font-mono font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  <span>{group.title}</span>
                  <span className="text-[9px] opacity-60">BAY {group.code}</span>
                </div>
              )}

              {/* Itens do Trilho */}
              {group.items.map(({ path, icon: Icon, label, badge }) => {
                const active = isActive(path);
                return (
                  <Link
                    key={path}
                    to={path}
                    onClick={onClose}
                    title={isCollapsed ? `${label} [BAY ${group.code}]` : undefined}
                    aria-current={active ? 'page' : undefined}
                    className={`
                      group relative flex items-center transition-all duration-150
                      ${isCollapsed ? 'mx-auto h-9 w-9 justify-center rounded-lg' : 'gap-2.5 rounded-lg px-2.5 py-1.5 text-xs'}
                      ${
                        active
                          ? 'bg-white dark:bg-slate-800/80 text-slate-900 dark:text-white font-semibold border border-slate-200/90 dark:border-slate-700/70 shadow-xs'
                          : 'font-medium text-slate-600 dark:text-slate-400 hover:bg-white/80 dark:hover:bg-slate-850 hover:text-slate-900 dark:hover:text-slate-200 border border-transparent'
                      }
                    `}
                  >
                    {/* Indicador de Acoplamento do Trilho Ativo */}
                    {active && !isCollapsed && (
                      <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-brand shadow-[0_0_8px_rgba(79,70,229,0.5)]" />
                    )}

                    {/* Micro-container do ícone com lente de hardware */}
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors ${
                        active
                          ? 'bg-brand/10 text-brand dark:bg-brand/20 dark:text-brand-light ring-1 ring-brand/30'
                          : 'text-slate-400 group-hover:text-slate-700 dark:text-slate-500 dark:group-hover:text-slate-300'
                      }`}
                    >
                      <Icon size={14} strokeWidth={active ? 2.4 : 2} />
                    </span>

                    {!isCollapsed && (
                      <span className="flex-1 truncate tracking-tight">{label}</span>
                    )}

                    {!isCollapsed && badge && (
                      <span className="font-mono text-[9px] px-1.5 py-0.2 rounded border font-semibold border-brand/30 bg-brand/10 text-brand dark:text-brand-light">
                        {badge}
                      </span>
                    )}

                    {/* Tooltip técnico flutuante quando recolhido */}
                    {isCollapsed && (
                      <span className="pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-md bg-slate-900 dark:bg-slate-800 border border-slate-700/80 px-2.5 py-1 text-[11px] font-medium text-white shadow-xl opacity-0 transition-opacity group-hover:opacity-100 z-50 flex items-center gap-1.5">
                        <span className="font-mono text-[9px] text-slate-400">BAY {group.code}</span>
                        <span>{label}</span>
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Deck de Telemetria Operacional (Assinatura de Hardware do Nexus) */}
        {!isCollapsed ? (
          <div className="mx-2.5 my-2 p-2.5 rounded-lg border border-slate-200/90 dark:border-slate-800/90 bg-white/90 dark:bg-slate-900/80 shadow-xs">
            <div className="flex items-center justify-between gap-1 mb-1.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span className="font-mono text-[10px] font-bold tracking-wider uppercase text-slate-700 dark:text-slate-300 truncate">
                  {master ? 'Cluster Master' : 'Telemetria Ativa'}
                </span>
              </div>
              <span className="font-mono text-[9px] text-slate-400 dark:text-slate-500 uppercase font-semibold">
                {master ? 'ROOT' : 'v3.1'}
              </span>
            </div>
            <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 dark:text-slate-400">
              <span className="truncate max-w-[140px]" title={currentUser?.companyName || 'Nexus ITAM'}>
                {currentUser?.companyName || 'Nexus ITAM'}
              </span>
              <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-0.5 shrink-0">
                <Shield size={10} /> TLS
              </span>
            </div>
          </div>
        ) : (
          <div className="my-2 flex justify-center" title="Telemetria Ativa • TLS 1.3">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </span>
          </div>
        )}

        {/* Estação do Operador (Footer Deck) */}
        <div className={`shrink-0 border-t border-slate-200/80 dark:border-slate-800/90 p-3 ${isCollapsed ? 'space-y-2' : ''}`}>
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
            <div className="mb-2.5 flex items-center gap-2.5 rounded-lg border border-slate-200/80 bg-white p-2 dark:border-slate-800 dark:bg-slate-900/80 shadow-xs">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-900 text-white dark:bg-slate-800 font-mono text-xs font-bold border border-slate-700/60">
                {(currentUser?.name || currentUser?.email || 'U').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                  {currentUser?.name || 'Operador'}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="inline-block px-1 py-0.2 rounded text-[9px] font-mono font-bold uppercase tracking-wider bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {ROLE_LABELS[currentUser?.role] || 'Operador'}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className={isCollapsed ? 'space-y-2' : 'grid grid-cols-2 gap-2'}>
            <button
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
              title="Calibração de interface: Claro / Escuro"
              className={`flex items-center justify-center gap-1.5 rounded-lg border border-slate-200/80 py-1.5 text-xs text-slate-600 transition-colors hover:bg-white dark:border-slate-800 dark:text-slate-400 dark:hover:bg-slate-900 ${
                isCollapsed ? 'mx-auto h-9 w-9 border-0 py-0' : ''
              }`}
            >
              {isDark ? <Sun size={14} className="text-amber-400" /> : <Moon size={14} className="text-slate-600" />}
              {!isCollapsed && <span className="font-medium text-[11px]">{isDark ? 'Luz' : 'Escuro'}</span>}
            </button>

            <button
              onClick={handleLogout}
              title="Encerrar sessão de forma segura"
              className={`flex items-center justify-center gap-1.5 rounded-lg border border-slate-200/80 py-1.5 text-xs text-slate-600 transition-colors hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 dark:border-slate-800 dark:text-slate-400 dark:hover:bg-rose-950/40 dark:hover:text-rose-300 dark:hover:border-rose-900/50 ${
                isCollapsed ? 'mx-auto h-9 w-9 border-0 py-0' : ''
              }`}
            >
              <LogOut size={14} />
              {!isCollapsed && <span className="font-medium text-[11px]">Sair</span>}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
