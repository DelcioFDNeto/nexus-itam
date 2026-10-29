// src/components/Sidebar.jsx
import React, { useState, useMemo, useCallback, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Server, Plus, FileInput,
  Users, LogOut, ClipboardCheck, X, ShieldCheck, Layers, Globe,
  FolderGit2, Settings, ChevronLeft, ChevronRight, ChevronDown,
  Search, Activity, UserCog, Building2, Moon, Sun, FileSignature,
  RefreshCw, Shield, Boxes, Network,
} from 'lucide-react';
import Logo from './Logo';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { usePWA } from '../contexts/PWAContext';
import { can, isSuperadmin, ROLE_LABELS } from '../utils/permissions';
import { hasFeature, isModuleEnabled } from '../utils/entitlements';

const CASCADE_STORAGE_KEY = 'nexus_sidebar_cascade_v2';

/**
 * Sidebar Flutuante Corporativa Nexus — Navegação em Modelo Cascata.
 * - Tudo recolhido por padrão (expansão sob demanda pelo operador).
 * - Largura auto-ajustável e redimensionável com limite modesto de caracteres.
 * - Design executivo corporativo de alta legibilidade.
 */
const Sidebar = ({
  isOpen,
  onClose,
  isCollapsed = false,
  toggleCollapse,
  onSearchClick,
  width,
  onWidthChange,
  onResetWidth,
}) => {
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

  const isActive = useCallback(
    (path) => (path === '/dashboard' ? location.pathname === path : location.pathname.startsWith(path)),
    [location.pathname],
  );

  // Redimensionamento interativo por arraste no desktop
  const isResizingRef = useRef(false);
  const handleMouseDown = useCallback(
    (e) => {
      e.preventDefault();
      isResizingRef.current = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const handleMouseMove = (moveEvent) => {
        if (!isResizingRef.current) return;
        // O container desktop começa em left-3.5 (14px). Largura = clientX - 14.
        const newWidth = Math.round(moveEvent.clientX - 14);
        onWidthChange?.(newWidth);
      };

      const handleMouseUp = () => {
        isResizingRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [onWidthChange],
  );

  // Estrutura modular corporativa em cascata
  const menuGroups = useMemo(() => {
    if (master) {
      return [
        {
          id: 'master_corp',
          title: 'Console Master',
          icon: Building2,
          items: [
            { path: '/dashboard', icon: LayoutDashboard, label: 'Painel Master' },
            { path: '/admin/tenants', icon: Building2, label: 'Empresas Clientes' },
          ],
        },
        {
          id: 'master_infra',
          title: 'Governança Global',
          icon: Layers,
          items: [
            { path: '/admin/users', icon: Users, label: 'Acessos Globais' },
            { path: '/admin/plans', icon: Layers, label: 'Planos & Cotas' },
          ],
        },
      ];
    }

    const groups = [
      {
        id: 'inventory',
        title: 'Inventário & Frotas',
        icon: Boxes,
        items: [
          { path: '/dashboard', icon: LayoutDashboard, label: 'Visão Geral', cap: 'assets:read' },
          { path: '/assets', icon: Server, label: 'Ativos de TI', cap: 'assets:read' },
          { path: '/import', icon: FileInput, label: 'Ingestão em Massa', cap: 'assets:import', feature: 'import' },
        ],
      },
      {
        id: 'telemetry',
        title: 'Telemetria & RMM',
        icon: Activity,
        items: [
          { path: '/agent', icon: Activity, label: 'NexusDesk & RMM', badge: 'v3.1', cap: 'agent:manage', feature: 'agent' },
          { path: '/service-desk', icon: Network, label: 'Service Desk & APIs', badge: '5 APIs', cap: 'assets:read' },
          { path: '/audit', icon: ClipboardCheck, label: 'Auditoria QR Code', cap: 'audit:run', feature: 'audit' },
        ],
      },
      {
        id: 'projects',
        title: 'Projetos & Demandas',
        icon: FolderGit2,
        items: [
          { path: '/projects', icon: FolderGit2, label: 'Projetos', cap: 'projects:write', feature: 'projects' },
          { path: '/tasks', icon: Layers, label: 'Tarefas & Quadro', cap: 'tasks:write', feature: 'projects' },
        ],
      },
      {
        id: 'governance',
        title: 'Governança & Custódia',
        icon: ShieldCheck,
        items: [
          { path: '/termos', icon: FileSignature, label: 'Termos de Custódia', cap: 'terms:read' },
          { path: '/employees', icon: Users, label: 'Equipe & Posse', cap: 'employees:write' },
          { path: '/licenses', icon: ShieldCheck, label: 'Softwares & Licenças', cap: 'licenses:write', feature: 'licenses' },
          { path: '/services', icon: Globe, label: 'Contratos & SLAs', cap: 'contracts:write', feature: 'contracts' },
        ],
      },
      {
        id: 'system',
        title: 'Administração & Sistema',
        icon: Settings,
        items: [
          { path: '/users', icon: UserCog, label: 'Acessos & Usuários', cap: 'users:manage' },
          { path: '/settings', icon: Settings, label: 'Ajustes da Empresa', cap: 'settings:read' },
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

  // Seções abertas na cascata.
  // REGRA: Tudo recolhido por padrão (objeto vazio {}) a menos que o operador expanda.
  const [openGroups, setOpenGroups] = useState(() => {
    try {
      const saved = localStorage.getItem(CASCADE_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch {
      /* modo privado */
    }
    return {};
  });

  // Alterna expansão da seção na cascata
  const toggleGroup = (groupId) => {
    setOpenGroups((prev) => {
      const next = { ...prev, [groupId]: !prev[groupId] };
      try {
        localStorage.setItem(CASCADE_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* noop */
      }
      return next;
    });
  };

  const canCreate = can(currentUser, 'assets:write');

  // Identidade da empresa
  const companyName = currentUser?.companyName || 'Nexus ITAM';
  const customLogo = currentUser?.logoUrl || '';
  const whitelabel = Boolean(currentUser) && !isSuperadmin(currentUser) && hasFeature(currentUser, 'whitelabel') && Boolean(currentUser?.tenantId);
  const showCompany = Boolean(customLogo) || (whitelabel && companyName !== 'Nexus ITAM');

  return (
    <>
      {/* Overlay mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-xs lg:hidden transition-opacity"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        style={{
          width: isCollapsed ? 78 : (width || undefined),
        }}
        className={`
          relative fixed top-3.5 bottom-3.5 left-3.5 z-50 flex flex-col
          rounded-2xl
          bg-white/95 dark:bg-[#0D121F]/95 backdrop-blur-xl
          border border-slate-200/90 dark:border-slate-800/80
          shadow-[0_12px_36px_-6px_rgba(15,23,42,0.08),0_4px_12px_-2px_rgba(15,23,42,0.03)]
          dark:shadow-[0_20px_50px_-10px_rgba(0,0,0,0.65)]
          transition-all duration-150 ease-out select-none
          lg:static lg:z-auto lg:h-full lg:w-full lg:translate-x-0
          ${isOpen ? 'translate-x-0 w-[calc(100vw-28px)] max-w-[320px]' : '-translate-x-[115%] lg:translate-x-0'}
          ${isCollapsed ? 'w-[78px]' : ''}
        `}
        aria-label="Navegação corporativa"
      >
        {/* ================================================================= */}
        {/* ALÇA INTERATIVA DE AJUSTE DE LARGURA (DESKTOP)                    */}
        {/* ================================================================= */}
        {!isCollapsed && onWidthChange && (
          <div
            onMouseDown={handleMouseDown}
            onDoubleClick={onResetWidth}
            title="Arraste para ajustar largura (duplo-clique para redefinir)"
            aria-label="Ajustar largura da barra lateral"
            className="hidden lg:block absolute -right-1.5 top-6 bottom-6 w-3 cursor-col-resize group/resizer z-50 select-none"
          >
            <div className="mx-auto h-full w-1 rounded-full bg-transparent group-hover/resizer:bg-brand/40 group-active/resizer:bg-brand transition-colors" />
          </div>
        )}

        {/* ================================================================= */}
        {/* CABEÇALHO: IDENTIDADE CORPORATIVA & GATILHOS EXECUTIVOS           */}
        {/* ================================================================= */}
        <div className="shrink-0 p-3 pb-2.5 border-b border-slate-100 dark:border-slate-800/80">
          <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'justify-between gap-2'}`}>
            <button
              onClick={() => (isCollapsed ? toggleCollapse?.() : navigate('/dashboard'))}
              className="flex items-center gap-2 group text-left min-w-0 flex-1"
              title={isCollapsed ? 'Expandir barra lateral' : (showCompany ? companyName : 'Ir para o painel principal')}
            >
              <Logo size="sm" showText={!isCollapsed} maxChars={22} />
              {!isCollapsed && !master && !showCompany && (
                <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded border border-slate-200/90 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/90 shrink-0">
                  ITAM
                </span>
              )}
            </button>

            {!isCollapsed && toggleCollapse && (
              <button
                onClick={toggleCollapse}
                aria-label="Recolher menu"
                title="Recolher barra lateral"
                className="hidden lg:flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-slate-200/80 bg-slate-50 text-slate-400 transition-colors hover:border-slate-300 hover:text-slate-700 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-500 dark:hover:text-slate-200"
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

          {/* Botão de expansão no modo rail */}
          {isCollapsed && toggleCollapse && (
            <button
              onClick={toggleCollapse}
              aria-label="Expandir menu"
              title="Expandir barra lateral"
              className="mt-2.5 hidden lg:flex mx-auto h-6 w-full items-center justify-center rounded-md bg-slate-100/80 text-slate-400 hover:text-brand dark:bg-slate-900/80 dark:text-slate-500 dark:hover:text-slate-200 transition-colors"
            >
              <ChevronRight size={13} strokeWidth={2.5} />
            </button>
          )}

          {/* Ações Rápidas: Novo Ativo (+N) & Busca Global (Ctrl+K) */}
          {(onSearchClick || (!master && canCreate)) && (
            <div className="mt-2.5 space-y-1.5">
              {!master && canCreate && (
                <Link
                  to="/assets/new"
                  onClick={onClose}
                  title="Novo Ativo (Alt+N)"
                  className={`group flex items-center justify-center gap-2 rounded-lg bg-slate-900 text-white transition-all hover:bg-brand dark:bg-brand dark:text-white dark:hover:bg-brand-dark shadow-xs ${
                    isCollapsed ? 'mx-auto h-8 w-8' : 'px-2.5 py-1.5'
                  }`}
                >
                  <Plus size={14} strokeWidth={2.5} className="shrink-0" />
                  {!isCollapsed && (
                    <>
                      <span className="flex-1 whitespace-nowrap text-xs font-semibold tracking-tight text-left">
                        Novo Ativo
                      </span>
                      <kbd className="font-mono text-[9px] px-1 py-0.5 rounded bg-white/20 text-white">
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
                  className={`group flex items-center justify-center gap-2 rounded-lg border border-slate-200/80 bg-slate-50/80 text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-100/90 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:border-slate-700 ${
                    isCollapsed ? 'mx-auto h-8 w-8' : 'w-full px-2.5 py-1.5'
                  }`}
                >
                  <Search size={13} className="shrink-0 text-slate-400 group-hover:text-brand transition-colors" />
                  {!isCollapsed && (
                    <span className="flex flex-1 items-center justify-between">
                      <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        Busca rápida
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
        {/* NAVEGAÇÃO EM MODELO CASCATA (RECOLHIDO POR PADRÃO)                */}
        {/* ================================================================= */}
        <nav className="custom-scrollbar my-1 flex-1 overflow-y-auto px-2 py-1.5 space-y-1.5">
          {menuGroups.map((group) => {
            const GroupIcon = group.icon;
            const hasActiveChild = group.items.some((item) => isActive(item.path));
            const isGroupOpen = Boolean(openGroups[group.id]);

            if (isCollapsed) {
              // Modo compacto (rail de 78px): ícones e tooltips flutuantes
              return (
                <div key={group.id} className="py-1 border-b border-slate-100/80 dark:border-slate-800/60 last:border-0">
                  <div className="space-y-1">
                    {group.items.map((item) => {
                      const active = isActive(item.path);
                      const ItemIcon = item.icon;
                      return (
                        <Link
                          key={item.path}
                          to={item.path}
                          onClick={onClose}
                          aria-current={active ? 'page' : undefined}
                          className={`
                            group relative flex h-9 w-9 mx-auto items-center justify-center rounded-lg transition-all
                            ${
                              active
                                ? 'bg-brand text-white shadow-xs'
                                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800/80'
                            }
                          `}
                        >
                          <ItemIcon size={16} strokeWidth={active ? 2.4 : 1.8} />

                          {/* Tooltip corporativo flutuante */}
                          <div className="pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-lg bg-slate-900 dark:bg-slate-800 border border-slate-700/80 px-2.5 py-1.5 text-[11px] font-medium text-white shadow-xl opacity-0 transition-opacity group-hover:opacity-100 z-50 flex items-center gap-2">
                            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                              {group.title}
                            </span>
                            <span className="text-slate-500">•</span>
                            <span className="font-semibold text-slate-100">{item.label}</span>
                            {item.badge && (
                              <span className="font-mono text-[9px] px-1 py-0.2 rounded bg-brand/30 text-brand-light font-bold">
                                {item.badge}
                              </span>
                            )}
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            }

            // Modo expandido: Modelo Cascata (recolhido por padrão)
            return (
              <div key={group.id} className="rounded-xl transition-colors">
                {/* Cabeçalho da seção da cascata */}
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  aria-expanded={isGroupOpen}
                  className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100/70 dark:hover:bg-slate-800/40 transition-colors group cursor-pointer"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 group-hover:text-slate-700 dark:text-slate-500 dark:group-hover:text-slate-300 transition-colors">
                      <GroupIcon size={13} strokeWidth={2} />
                    </span>
                    <span className="truncate text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 group-hover:text-slate-800 dark:group-hover:text-slate-200 transition-colors">
                      {group.title}
                    </span>
                    {/* Indicador luminoso de módulo ativo quando a cascata está recolhida */}
                    {!isGroupOpen && hasActiveChild && (
                      <span
                        className="h-1.5 w-1.5 rounded-full bg-brand ring-2 ring-brand/30 shrink-0"
                        title="Há um módulo ativo nesta seção"
                      />
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="font-mono text-[9px] text-slate-400 dark:text-slate-500 px-1 py-0.2 rounded bg-slate-100 dark:bg-slate-800/80">
                      {group.items.length}
                    </span>
                    <ChevronDown
                      size={12}
                      className={`text-slate-400 transition-transform duration-200 ${
                        isGroupOpen ? 'rotate-0' : '-rotate-90'
                      }`}
                    />
                  </div>
                </button>

                {/* Submódulos em cascata com linha de árvore conectora */}
                {isGroupOpen && (
                  <div className="relative ml-4 pl-2.5 my-1 border-l border-slate-200/90 dark:border-slate-800/80 space-y-0.5 animate-in fade-in duration-150">
                    {group.items.map((item) => {
                      const active = isActive(item.path);
                      const ItemIcon = item.icon;
                      return (
                        <Link
                          key={item.path}
                          to={item.path}
                          onClick={onClose}
                          aria-current={active ? 'page' : undefined}
                          className={`
                            group relative flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs transition-all duration-150
                            ${
                              active
                                ? 'bg-brand/10 text-brand dark:bg-brand/20 dark:text-brand-light font-semibold border border-brand/20 dark:border-brand/30 shadow-2xs'
                                : 'font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100/80 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-100 border border-transparent'
                            }
                          `}
                        >
                          {/* Micro-pino conector na linha da árvore */}
                          <span
                            className={`absolute -left-[14px] top-1/2 -translate-y-1/2 transition-all ${
                              active
                                ? 'h-2 w-2 rounded-full bg-brand ring-2 ring-brand/30'
                                : 'h-1 w-1 rounded-full bg-slate-300 dark:bg-slate-700 opacity-0 group-hover:opacity-100'
                            }`}
                          />

                          <span
                            className={`flex h-4 w-4 shrink-0 items-center justify-center transition-colors ${
                              active
                                ? 'text-brand dark:text-brand-light'
                                : 'text-slate-400 group-hover:text-slate-700 dark:text-slate-500 dark:group-hover:text-slate-300'
                            }`}
                          >
                            <ItemIcon size={14} strokeWidth={active ? 2.2 : 1.8} />
                          </span>

                          <span className="flex-1 truncate tracking-tight">{item.label}</span>

                          {item.badge && (
                            <span
                              className={`font-mono text-[9px] px-1.5 py-0.5 rounded font-bold ${
                                active
                                  ? 'bg-brand/20 text-brand dark:text-brand-light'
                                  : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                              }`}
                            >
                              {item.badge}
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* ================================================================= */}
        {/* RODAPÉ: WORKSPACE TELEMETRY & PERFIL DO OPERADOR                   */}
        {/* ================================================================= */}
        <div className="shrink-0 p-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80 space-y-2">
          {/* Alerta de atualização PWA */}
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

          {/* Card de Workspace & Telemetria */}
          {!isCollapsed ? (
            <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-800/70 px-2.5 py-1.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                <span
                  className="font-mono text-[10px] font-semibold text-slate-700 dark:text-slate-300 truncate"
                  title={currentUser?.companyName || 'Nexus ITAM'}
                >
                  {currentUser?.companyName || (master ? 'Cluster Master' : 'Nexus ITAM')}
                </span>
              </div>
              <span className="font-mono text-[9px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5 shrink-0">
                <Shield size={10} /> TLS 1.3
              </span>
            </div>
          ) : (
            <div className="flex justify-center py-1" title={`Conectado • ${currentUser?.companyName || 'Nexus ITAM'}`}>
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
              </span>
            </div>
          )}

          {/* Perfil corporativo do operador */}
          {!isCollapsed ? (
            <div className="flex items-center justify-between gap-2 pt-0.5">
              <div className="flex items-center gap-2 min-w-0">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white dark:bg-slate-800 font-mono text-xs font-bold border border-slate-700/60 shadow-2xs">
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
                  <p className="truncate font-mono text-[9px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mt-0.5">
                    {ROLE_LABELS[currentUser?.role] || 'Operador'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setTheme(isDark ? 'light' : 'dark')}
                  title={isDark ? 'Modo Claro' : 'Modo Escuro'}
                  aria-label="Alternar tema"
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200/80 bg-slate-50 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                >
                  {isDark ? <Sun size={13} className="text-amber-400" /> : <Moon size={13} />}
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  title="Encerrar sessão"
                  aria-label="Encerrar sessão"
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200/80 bg-slate-50 text-slate-600 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400 dark:hover:border-rose-900/50 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
                >
                  <LogOut size={13} />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1.5 pt-1 border-t border-slate-100 dark:border-slate-800/80">
              <button
                type="button"
                onClick={() => setTheme(isDark ? 'light' : 'dark')}
                title={isDark ? 'Modo Claro' : 'Modo Escuro'}
                aria-label="Alternar tema"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800/80 transition-colors"
              >
                {isDark ? <Sun size={14} className="text-amber-400" /> : <Moon size={14} />}
              </button>
              <button
                type="button"
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
