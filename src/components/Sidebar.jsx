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
 * Sidebar Flutuante Nexus — Monólito de 3 Câmaras (Command Pod, Circuit Rail Matrix, Telemetry & Operator Dock).
 * Descolada das bordas da viewport com visual autêntico de instrumentação de hardware.
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
          className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm lg:hidden transition-opacity"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`
          fixed top-3 bottom-3 left-3 z-50 flex flex-col
          rounded-2xl p-1.5
          bg-slate-200/75 dark:bg-[#080C14]
          border border-slate-300/80 dark:border-slate-800/90
          shadow-[0_16px_40px_-12px_rgba(15,23,42,0.16)] dark:shadow-[0_20px_50px_-12px_rgba(0,0,0,0.75)]
          transition-all duration-200 ease-out select-none
          lg:static lg:z-auto lg:h-full lg:w-full lg:translate-x-0
          ${isOpen ? 'translate-x-0' : '-translate-x-[115%] lg:translate-x-0'}
          ${isCollapsed ? 'w-[78px]' : 'w-[264px]'}
        `}
        aria-label="Navegacao principal"
      >
        {/* ================================================================= */}
        {/* CÂMARA 1: COMMAND & IDENTITY POD                                  */}
        {/* ================================================================= */}
        <div className="shrink-0 rounded-xl bg-white dark:bg-[#101624] border border-slate-200/90 dark:border-slate-800/90 p-2.5 shadow-2xs">
          <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'justify-between gap-2'}`}>
            <button
              onClick={() => (isCollapsed ? toggleCollapse?.() : navigate('/dashboard'))}
              className="flex items-center gap-2 group text-left min-w-0"
              title={isCollapsed ? 'Expandir console' : 'Ir para o painel principal'}
            >
              <Logo size="sm" showText={!isCollapsed} />
              {!isCollapsed && !master && (
                <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 shrink-0">
                  ITAM
                </span>
              )}
            </button>

            {!isCollapsed && toggleCollapse && (
              <button
                onClick={toggleCollapse}
                aria-label="Recolher menu"
                title="Recolher console"
                className="hidden lg:flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-slate-200/80 bg-slate-50 text-slate-400 transition-colors hover:border-brand/40 hover:text-brand dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500 dark:hover:text-slate-200"
              >
                <ChevronLeft size={13} strokeWidth={2.5} />
              </button>
            )}

            {onClose && (
              <button
                onClick={onClose}
                aria-label="Fechar menu"
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 lg:hidden"
              >
                <X size={16} />
              </button>
            )}
          </div>

          {isCollapsed && toggleCollapse && (
            <button
              onClick={toggleCollapse}
              aria-label="Expandir menu"
              title="Expandir console"
              className="mt-2 hidden lg:flex mx-auto h-6 w-full items-center justify-center rounded-md bg-slate-100/80 text-slate-400 hover:text-brand dark:bg-slate-900 dark:text-slate-500 dark:hover:text-slate-200 transition-colors"
            >
              <ChevronRight size={13} strokeWidth={2.5} />
            </button>
          )}

          {(onSearchClick || (!master && canCreate)) && (
            <div className="mt-2.5 pt-2.5 border-t border-slate-100 dark:border-slate-800/80 space-y-1.5">
              {!master && canCreate && (
                <Link
                  to="/assets/new"
                  onClick={onClose}
                  title="Novo Ativo"
                  className={`group flex items-center justify-center gap-2 rounded-lg bg-slate-900 text-white transition-all hover:bg-brand dark:bg-brand dark:text-white dark:hover:bg-brand-dark shadow-xs ${
                    isCollapsed ? 'mx-auto h-9 w-9' : 'px-2.5 py-1.5'
                  }`}
                >
                  <PlusSquare size={14} className="shrink-0" />
                  {!isCollapsed && (
                    <>
                      <span className="flex-1 whitespace-nowrap text-xs font-semibold tracking-tight text-left">
                        Novo Ativo
                      </span>
                      <kbd className="font-mono text-[9px] px-1 py-0.5 rounded bg-white/15 text-white/90">
                        +N
                      </kbd>
                    </>
                  )}
                </Link>
              )}

              {onSearchClick && (
                <button
                  onClick={() => {
                    onSearchClick();
                    onClose?.();
                  }}
                  title="Busca rápida e comandos (Ctrl+K)"
                  className={`group flex items-center justify-center gap-2 rounded-lg border border-slate-200/80 bg-slate-50/90 text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-100/80 dark:border-slate-800 dark:bg-[#0B0F19] dark:text-slate-300 dark:hover:border-slate-700 ${
                    isCollapsed ? 'mx-auto h-9 w-9' : 'w-full px-2.5 py-1.5'
                  }`}
                >
                  <Search size={13} className="shrink-0 text-slate-400 group-hover:text-brand" />
                  {!isCollapsed && (
                    <span className="flex flex-1 items-center justify-between">
                      <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        Comando / Busca
                      </span>
                      <kbd className="rounded border border-slate-200/90 bg-white px-1.5 py-0.5 font-mono text-[9px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                        Ctrl K
                      </kbd>
                    </span>
                  )}
                </button>
              )}
            </div>
          )}
        </div>

        {/* ================================================================= */}
        {/* CÂMARA 2: MATRIZ DE NAVEGAÇÃO EM TRILHO DE CIRCUITO               */}
        {/* ================================================================= */}
        <nav className="custom-scrollbar my-1.5 flex-1 overflow-y-auto px-1 py-1.5 space-y-3.5">
          {menuGroups.map((group) => (
            <div key={group.code}>
              {isCollapsed ? (
                <div className="flex flex-col items-center mb-1.5" title={`Baía ${group.code}: ${group.title}`}>
                  <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-300/60 text-slate-600 dark:bg-slate-800/80 dark:text-slate-400 select-none">
                    {group.code}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2 px-2 mb-1.5">
                  <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-300/70 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {group.code}
                  </span>
                  <span className="text-[10px] font-mono font-bold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400 truncate">
                    {group.title}
                  </span>
                  <div className="flex-1 h-px bg-slate-300/60 dark:bg-slate-800/80" />
                </div>
              )}

              <div
                className={
                  isCollapsed
                    ? 'space-y-1'
                    : 'relative ml-3.5 pl-2.5 border-l border-slate-300/80 dark:border-slate-800 space-y-1'
                }
              >
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
                        ${isCollapsed ? 'mx-auto h-10 w-10 justify-center rounded-xl' : 'gap-2.5 rounded-xl px-2.5 py-1.5 text-xs'}
                        ${
                          active
                            ? 'bg-white dark:bg-[#141C2E] text-slate-900 dark:text-white font-semibold border border-slate-200/90 dark:border-slate-700/80 shadow-sm'
                            : 'font-medium text-slate-600 dark:text-slate-400 hover:bg-white/60 dark:hover:bg-[#101624]/80 hover:text-slate-900 dark:hover:text-slate-200 border border-transparent'
                        }
                      `}
                    >
                      {/* Pino conector no trilho de circuito */}
                      {!isCollapsed && (
                        <span
                          className={`absolute -left-[13.5px] top-1/2 -translate-y-1/2 transition-all ${
                            active
                              ? 'h-4 w-1.5 rounded-full bg-brand ring-4 ring-brand/20'
                              : 'h-1.5 w-1.5 rounded-full bg-slate-300 dark:bg-slate-700 opacity-0 group-hover:opacity-100'
                          }`}
                        />
                      )}

                      {isCollapsed && active && (
                        <span className="absolute left-0.5 top-2.5 bottom-2.5 w-1 rounded-full bg-brand" />
                      )}

                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg transition-colors ${
                          active
                            ? 'bg-brand text-white shadow-2xs'
                            : 'text-slate-500 group-hover:text-slate-800 dark:text-slate-400 dark:group-hover:text-slate-200'
                        }`}
                      >
                        <Icon size={14} strokeWidth={active ? 2.4 : 2} />
                      </span>

                      {!isCollapsed && (
                        <span className="flex-1 truncate tracking-tight">{label}</span>
                      )}

                      {!isCollapsed && badge && (
                        <span
                          className={`font-mono text-[9px] px-1.5 py-0.5 rounded font-bold ${
                            active
                              ? 'bg-brand/15 text-brand dark:bg-brand/25 dark:text-brand-light'
                              : 'bg-slate-200/70 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                          }`}
                        >
                          {badge}
                        </span>
                      )}

                      {isCollapsed && (
                        <span className="pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-lg bg-slate-900 dark:bg-slate-800 border border-slate-700 px-2.5 py-1.5 text-[11px] font-medium text-white shadow-xl opacity-0 transition-opacity group-hover:opacity-100 z-50 flex items-center gap-2">
                          <span className="font-mono text-[9px] px-1 py-0.2 rounded bg-white/10 text-slate-300">
                            {group.code}
                          </span>
                          <span>{label}</span>
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* ================================================================= */}
        {/* CÂMARA 3: DOCK DE TELEMETRIA E ESTAÇÃO DO OPERADOR                */}
        {/* ================================================================= */}
        <div className="shrink-0 rounded-xl bg-white dark:bg-[#101624] border border-slate-200/90 dark:border-slate-800/90 p-2.5 shadow-2xs space-y-2">
          {needRefresh && !isCollapsed && (
            <button
              type="button"
              onClick={applyUpdate}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-brand text-white px-2.5 py-1.5 text-[11px] font-semibold shadow-xs hover:bg-brand-dark transition-colors"
            >
              <RefreshCw size={12} className="animate-spin" />
              <span>Atualizar versão</span>
            </button>
          )}

          {!isCollapsed ? (
            <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-200/70 dark:border-slate-800/80 px-2.5 py-1.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                <span className="font-mono text-[10px] font-semibold text-slate-700 dark:text-slate-300 truncate" title={currentUser?.companyName || 'Nexus ITAM'}>
                  {currentUser?.companyName || (master ? 'Cluster Master' : 'Nexus ITAM')}
                </span>
              </div>
              <span className="font-mono text-[9px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5 shrink-0">
                <Shield size={10} /> TLS
              </span>
            </div>
          ) : (
            <div className="flex justify-center py-1" title={`Telemetria Ativa • ${currentUser?.companyName || 'Nexus ITAM'}`}>
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
              </span>
            </div>
          )}

          {!isCollapsed ? (
            <div className="flex items-center justify-between gap-2 pt-0.5">
              <div className="flex items-center gap-2 min-w-0">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white dark:bg-slate-800 font-mono text-xs font-bold border border-slate-700/60">
                  {(currentUser?.name || currentUser?.email || 'U')
                    .split(' ')
                    .map((p) => p[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100 leading-tight">
                    {currentUser?.name || 'Operador'}
                  </p>
                  <p className="truncate font-mono text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mt-0.5">
                    {ROLE_LABELS[currentUser?.role] || 'Operador'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => setTheme(isDark ? 'light' : 'dark')}
                  title={isDark ? 'Modo Claro' : 'Modo Escuro'}
                  aria-label="Alternar tema"
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200/80 bg-slate-50 text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800"
                >
                  {isDark ? <Sun size={13} className="text-amber-400" /> : <Moon size={13} />}
                </button>
                <button
                  onClick={handleLogout}
                  title="Encerrar sessão"
                  aria-label="Encerrar sessão"
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200/80 bg-slate-50 text-slate-600 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-rose-900/50 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
                >
                  <LogOut size={13} />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1.5 pt-1 border-t border-slate-100 dark:border-slate-800/80">
              <button
                onClick={() => setTheme(isDark ? 'light' : 'dark')}
                title={isDark ? 'Modo Claro' : 'Modo Escuro'}
                aria-label="Alternar tema"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800/80 transition-colors"
              >
                {isDark ? <Sun size={14} className="text-amber-400" /> : <Moon size={14} />}
              </button>
              <button
                onClick={handleLogout}
                title="Encerrar sessão"
                aria-label="Encerrar sessão"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:text-slate-400 dark:hover:bg-rose-950/40 dark:hover:text-rose-300 transition-colors"
              >
                <LogOut size={14} />
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
