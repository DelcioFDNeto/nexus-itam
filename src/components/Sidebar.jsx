// src/components/Sidebar.jsx
import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Server, Plus, FileInput,
  Users, LogOut, ClipboardCheck, X, ShieldCheck, Layers, Globe,
  FolderGit2, Settings, ChevronLeft, ChevronRight, ChevronDown,
  Search, Activity, UserCog, Building2, Moon, Sun, FileSignature, KeyRound, CreditCard,
  RefreshCw, Shield, Boxes, Network, Smartphone,
} from 'lucide-react';
import Logo from './Logo';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { usePWA } from '../contexts/PWAContext';
import { can, isSuperadmin, ROLE_LABELS } from '../utils/permissions';
import { hasFeature, isModuleEnabled } from '../utils/entitlements';
import { AGENT_VERSION } from '../utils/agentInventory';
import {
  captureFocusTarget,
  getFocusableElements,
  restoreFocusSafely,
  trapFocusWithin,
} from '../utils/focusTrap';

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
  returnFocusRef,
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser, logout } = useAuth();
  const { isDark, setTheme } = useTheme();
  const { needRefresh, applyUpdate, isStandalone, setIsInstallModalOpen } = usePWA();

  const asideRef = useRef(null);
  const closeButtonRef = useRef(null);
  const previousFocusRef = useRef(null);
  const wasOpenRef = useRef(false);
  const returnFocusRefLatest = useRef(returnFocusRef);
  useEffect(() => {
    returnFocusRefLatest.current = returnFocusRef;
  }, [returnFocusRef]);

  const [updating, setUpdating] = useState(false);
  const isMountedRef = useRef(true);
  useEffect(() => () => {
    isMountedRef.current = false;
  }, []);

  const isMobileDrawer = typeof isOpen === 'boolean';
  const isDrawerHidden = isMobileDrawer && !isOpen;

  useEffect(() => {
    if (!isMobileDrawer) return undefined;

    if (isOpen && !wasOpenRef.current) {
      wasOpenRef.current = true;
      previousFocusRef.current = captureFocusTarget(asideRef.current);
      const focusTarget =
        closeButtonRef.current || getFocusableElements(asideRef.current)[0] || null;
      if (focusTarget && typeof focusTarget.focus === 'function') {
        focusTarget.focus();
      }
      return undefined;
    }

    if (!isOpen && wasOpenRef.current) {
      wasOpenRef.current = false;
      const target = returnFocusRefLatest.current?.current || previousFocusRef.current;
      previousFocusRef.current = null;
      const rafId = window.requestAnimationFrame(() => {
        if (
          document.querySelector('[aria-modal="true"]') ||
          document.activeElement?.closest?.('[aria-modal="true"]')
        ) {
          return;
        }
        restoreFocusSafely(target);
      });
      return () => window.cancelAnimationFrame(rafId);
    }

    return undefined;
  }, [isMobileDrawer, isOpen]);

  useEffect(() => {
    if (!isMobileDrawer || !isOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Tab') {
        trapFocusWithin(event, asideRef.current);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isMobileDrawer, isOpen]);

  const master = isSuperadmin(currentUser);

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/', { replace: true });
    } catch (error) {
      console.error('Erro ao sair', error);
    }
  };

  const handleApplyUpdate = async () => {
    if (updating) return;
    setUpdating(true);
    try {
      await applyUpdate?.();
    } catch (error) {
      console.error('Erro ao atualizar versão', error);
      if (isMountedRef.current) {
        setUpdating(false);
      }
    }
  };

  const isActive = useCallback(
    (path) => (path === '/dashboard' ? location.pathname === path : location.pathname.startsWith(path)),
    [location.pathname],
  );

  // Redimensionamento interativo por arraste no desktop
  const isResizingRef = useRef(false);
  const resizeCleanupRef = useRef(null);

  const stopResizing = useCallback(() => {
    if (resizeCleanupRef.current) {
      resizeCleanupRef.current();
      resizeCleanupRef.current = null;
    }
    isResizingRef.current = false;
    if (typeof document !== 'undefined') {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  }, []);

  useEffect(() => {
    if (isCollapsed) {
      stopResizing();
    }
  }, [isCollapsed, stopResizing]);

  useEffect(() => () => stopResizing(), [stopResizing]);

  const handleMouseDown = useCallback(
    (e) => {
      e.preventDefault();
      stopResizing();
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
        stopResizing();
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      resizeCleanupRef.current = () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    },
    [onWidthChange, stopResizing],
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
          { path: '/agent', icon: Activity, label: 'NexusDesk & RMM', badge: `v${AGENT_VERSION.slice(0, 3)}`, cap: 'agent:manage', feature: 'agent' },
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
          { path: '/meus-ativos', icon: Smartphone, label: 'Meus Ativos (Custódia)', cap: 'assets:read' },
          { path: '/termos', icon: FileSignature, label: 'Termos de Custódia', cap: 'terms:read' },
          { path: '/employees', icon: Users, label: 'Equipe & Posse', cap: 'employees:write' },
          { path: '/portal-colaboradores', icon: KeyRound, label: 'Portal Colaboradores', cap: 'portal:manage' },
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
          { path: '/plano', icon: CreditCard, label: 'Plano & Contrato', cap: 'settings:read' },
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
      {/* Overlay mobile com transição fluida */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden transition-opacity duration-300 ease-out animate-fade-in"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        ref={asideRef}
        inert={isDrawerHidden ? true : undefined}
        aria-hidden={isDrawerHidden ? true : undefined}
        style={{
          width: isCollapsed ? 78 : (width || undefined),
        }}
        className={`
          fixed inset-y-0 left-0 z-50 flex flex-col
          w-[85vw] max-w-[320px]
          bg-white/95 dark:bg-[#111113]/95 backdrop-blur-xl
          border-r border-slate-200/90 dark:border-zinc-800
          shadow-2xl
          safe-area-pt safe-area-pb
          transition-transform duration-300 ease-out select-none
          lg:static lg:z-auto lg:h-full lg:w-full lg:translate-x-0
          lg:rounded-2xl lg:border lg:border-slate-200/90 lg:dark:border-zinc-800
          lg:shadow-[0_12px_36px_-6px_rgba(15,23,42,0.08),0_4px_12px_-2px_rgba(15,23,42,0.03)]
          lg:dark:shadow-[0_20px_50px_-10px_rgba(0,0,0,0.65)]
          lg:pt-0 lg:pb-0
          ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
          ${isCollapsed ? 'lg:w-[78px]' : ''}
        `}
        aria-label="Navegação corporativa"
      >
        {/* ================================================================= */}
        {/* ALÇA INTERATIVA DE AJUSTE DE LARGURA (DESKTOP)                    */}
        {/* ================================================================= */}
        {!isCollapsed && onWidthChange && (
          <div
            aria-hidden="true"
            onMouseDown={handleMouseDown}
            onDoubleClick={onResetWidth}
            title="Arraste para ajustar largura (duplo-clique para redefinir)"
            className="hidden lg:block absolute -right-1.5 top-6 bottom-6 w-3 cursor-col-resize group/resizer z-50 select-none"
          >
            <div className="mx-auto h-full w-1 rounded-full bg-transparent group-hover/resizer:bg-brand/40 group-active/resizer:bg-brand transition-colors" />
          </div>
        )}

        {/* ================================================================= */}
        {/* CABEÇALHO: IDENTIDADE CORPORATIVA & GATILHOS EXECUTIVOS           */}
        {/* ================================================================= */}
        <div className="shrink-0 p-3 pb-2.5 border-b border-slate-100 dark:border-zinc-800">
          <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'justify-between gap-2'}`}>
            <button
              type="button"
              onClick={() => (isCollapsed ? toggleCollapse?.() : navigate('/dashboard'))}
              className="flex min-h-[44px] items-center gap-2 rounded-lg group text-left min-w-0 flex-1 px-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              title={isCollapsed ? 'Expandir barra lateral' : (showCompany ? companyName : 'Ir para o painel principal')}
            >
              <Logo size="sm" showText={!isCollapsed} maxChars={22} />
              {!isCollapsed && !master && !showCompany && (
                <span className="font-mono text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-400 px-1.5 py-0.5 rounded border border-slate-200/90 dark:border-zinc-800 bg-slate-50 dark:bg-[#18181b] shrink-0">
                  ITAM
                </span>
              )}
            </button>

            {!isCollapsed && toggleCollapse && (
              <button
                type="button"
                onClick={toggleCollapse}
                aria-label="Recolher menu"
                title="Recolher barra lateral"
                data-icon-button="true"
                className="hidden lg:flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg border border-slate-200/80 bg-slate-50 text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-zinc-800 dark:bg-[#18181b] dark:text-zinc-400 dark:hover:text-[#fafafa] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <ChevronLeft size={16} strokeWidth={2.2} aria-hidden="true" />
              </button>
            )}

            {onClose && (
              <button
                ref={closeButtonRef}
                type="button"
                onClick={onClose}
                aria-label="Fechar menu"
                data-icon-button="true"
                className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-zinc-400 dark:hover:bg-[#18181b] dark:hover:text-[#fafafa] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand lg:hidden"
              >
                <X size={18} aria-hidden="true" />
              </button>
            )}
          </div>

          {/* Botão de expansão no modo rail */}
          {isCollapsed && toggleCollapse && (
            <button
              type="button"
              onClick={toggleCollapse}
              aria-label="Expandir menu"
              title="Expandir barra lateral"
              data-icon-button="true"
              className="mt-2 hidden lg:flex mx-auto min-h-[44px] w-full items-center justify-center rounded-lg bg-slate-100/80 text-slate-500 hover:text-brand-aa dark:bg-[#18181b] dark:text-zinc-400 dark:hover:text-[#fafafa] transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <ChevronRight size={16} strokeWidth={2.2} aria-hidden="true" />
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
                  className={`group flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-slate-900 text-white transition-colors hover:bg-brand hover:text-brand-fg dark:bg-brand dark:text-brand-fg dark:hover:bg-brand-dark shadow-sm active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                    isCollapsed ? 'mx-auto min-w-[44px]' : 'px-3 py-2'
                  }`}
                >
                  <Plus size={16} strokeWidth={2.4} className="shrink-0" aria-hidden="true" />
                  {!isCollapsed && (
                    <>
                      <span className="flex-1 whitespace-nowrap text-xs font-semibold tracking-tight text-left">
                        Novo Ativo
                      </span>
                      <kbd className="font-mono text-xs px-1.5 py-0.5 rounded bg-white/20 text-current">
                        +N
                      </kbd>
                    </>
                  )}
                </Link>
              )}

              {onSearchClick && (
                <button
                  type="button"
                  onClick={() => {
                    onSearchClick();
                    onClose?.();
                  }}
                  title="Busca rápida e comandos (Ctrl+K)"
                  aria-label="Busca rápida"
                  className={`group flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-200/80 bg-slate-50/80 text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-100/90 dark:border-zinc-800 dark:bg-[#18181b]/70 dark:text-zinc-200 dark:hover:border-zinc-700 dark:hover:bg-[#18181b] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                    isCollapsed ? 'mx-auto min-w-[44px]' : 'w-full px-3 py-2'
                  }`}
                >
                  <Search size={15} aria-hidden="true" className="shrink-0 text-slate-500 dark:text-zinc-400 group-hover:text-brand-aa transition-colors" />
                  {!isCollapsed && (
                    <span className="flex flex-1 items-center justify-between gap-2">
                      <span className="text-xs font-medium text-slate-600 dark:text-zinc-300">
                        Busca rápida
                      </span>
                      <kbd className="rounded border border-slate-200/90 bg-white px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-600 dark:border-zinc-700 dark:bg-[#111113] dark:text-zinc-400">
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
        <nav aria-label="Menu principal" className="custom-scrollbar my-1 flex-1 overflow-y-auto overscroll-contain px-2 py-1.5 space-y-1.5">
          {menuGroups.map((group) => {
            const GroupIcon = group.icon;
            const hasActiveChild = group.items.some((item) => isActive(item.path));
            const isGroupOpen = Boolean(openGroups[group.id]);

            if (isCollapsed) {
              // Modo compacto (rail de 78px): ícones e tooltips flutuantes
              return (
                <div key={group.id} className="py-1 border-b border-slate-100/80 dark:border-zinc-800/70 last:border-0">
                  <div className="space-y-1">
                    {group.items.map((item) => {
                      const active = isActive(item.path);
                      const ItemIcon = item.icon;
                      return (
                        <Link
                          key={item.path}
                          to={item.path}
                          onClick={onClose}
                          aria-label={item.label}
                          aria-current={active ? 'page' : undefined}
                          className={`
                            group relative flex min-h-[44px] min-w-[44px] mx-auto items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand
                            ${
                              active
                                ? 'bg-brand text-brand-fg shadow-sm'
                                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-zinc-400 dark:hover:text-[#fafafa] dark:hover:bg-[#18181b]'
                            }
                          `}
                        >
                          <ItemIcon size={17} strokeWidth={active ? 2.3 : 1.9} aria-hidden="true" />

                          {/* Tooltip corporativo flutuante */}
                          <div
                            aria-hidden="true"
                            className="pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-lg bg-[#111113] border border-zinc-800 px-2.5 py-1.5 text-xs font-medium text-[#fafafa] shadow-xl opacity-0 transition-opacity group-hover:opacity-100 z-50 flex items-center gap-2"
                          >
                            <span className="text-xs text-zinc-400 font-semibold uppercase tracking-wider">
                              {group.title}
                            </span>
                            <span className="text-zinc-600">•</span>
                            <span className="font-semibold text-[#fafafa]">{item.label}</span>
                            {item.badge && (
                              <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-brand/25 text-brand-text-dark font-bold">
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
                  className="w-full min-h-[44px] flex items-center justify-between px-2.5 py-2 rounded-lg text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-[#fafafa] hover:bg-slate-100/70 dark:hover:bg-[#18181b] transition-colors group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-500 group-hover:text-slate-800 dark:text-zinc-400 dark:group-hover:text-zinc-200 transition-colors" aria-hidden="true">
                      <GroupIcon size={14} strokeWidth={2} aria-hidden="true" />
                    </span>
                    <span className="truncate text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-400 group-hover:text-slate-900 dark:group-hover:text-[#fafafa] transition-colors">
                      {group.title}
                    </span>
                    {/* Indicador de módulo ativo quando a cascata está recolhida */}
                    {!isGroupOpen && hasActiveChild && (
                      <span
                        aria-hidden="true"
                        className="h-1.5 w-1.5 rounded-full bg-brand ring-2 ring-brand/30 shrink-0"
                        title="Há um módulo ativo nesta seção"
                      />
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="font-mono text-xs text-slate-500 dark:text-zinc-400 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-[#18181b]">
                      {group.items.length}
                    </span>
                    <ChevronDown
                      size={14}
                      aria-hidden="true"
                      className={`text-slate-400 transition-transform duration-200 ${
                        isGroupOpen ? 'rotate-0' : '-rotate-90'
                      }`}
                    />
                  </div>
                </button>

                {/* Submódulos em cascata com linha de árvore conectora */}
                {isGroupOpen && (
                  <div className="relative ml-4 pl-2.5 my-1 border-l border-slate-200/90 dark:border-zinc-800 space-y-0.5 animate-fade-in">
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
                            group relative flex min-h-[44px] items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand
                            ${
                              active
                                ? 'bg-brand/10 text-brand-aa dark:bg-brand/15 font-semibold border border-brand/25 shadow-sm'
                                : 'font-medium text-slate-600 dark:text-zinc-400 hover:bg-slate-100/80 dark:hover:bg-[#18181b] hover:text-slate-900 dark:hover:text-[#fafafa] border border-transparent'
                            }
                          `}
                        >
                          {/* Micro-pino conector na linha da árvore */}
                          <span
                            aria-hidden="true"
                            className={`absolute -left-[14px] top-1/2 -translate-y-1/2 transition-opacity ${
                              active
                                ? 'h-2 w-2 rounded-full bg-brand ring-2 ring-brand/30'
                                : 'h-1 w-1 rounded-full bg-slate-300 dark:bg-zinc-700 opacity-0 group-hover:opacity-100'
                            }`}
                          />

                          <span
                            aria-hidden="true"
                            className={`flex h-4 w-4 shrink-0 items-center justify-center transition-colors ${
                              active
                                ? 'text-brand-aa'
                                : 'text-slate-500 group-hover:text-slate-800 dark:text-zinc-400 dark:group-hover:text-zinc-200'
                            }`}
                          >
                            <ItemIcon size={15} strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" />
                          </span>

                          <span className="flex-1 truncate tracking-tight">{item.label}</span>

                          {item.badge && (
                            <span
                              className={`font-mono text-xs px-1.5 py-0.5 rounded font-bold ${
                                active
                                  ? 'bg-brand/15 text-brand-aa'
                                  : 'bg-slate-100 text-slate-600 dark:bg-[#18181b] dark:text-zinc-400'
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
        <div className="shrink-0 p-2.5 pt-2 border-t border-slate-100 dark:border-zinc-800 space-y-2">
          {/* Card Executivo PWA / Aplicativo Nexus ITAM Nativo */}
          {!isCollapsed && (
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/90 p-2.5 dark:border-zinc-800 dark:bg-[#18181b]/70 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    aria-hidden="true"
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                      isStandalone
                        ? 'bg-emerald-500/15 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'
                        : 'bg-brand/15 text-brand-aa'
                    }`}
                  >
                    <Smartphone size={15} strokeWidth={2.2} aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-slate-800 dark:text-[#fafafa]">
                      Aplicativo Nexus ITAM Nativo
                    </p>
                    <p className="text-xs text-slate-600 dark:text-zinc-400 flex items-center gap-1.5 mt-0.5">
                      <span
                        aria-hidden="true"
                        className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${
                          isStandalone ? 'bg-emerald-500' : 'bg-brand'
                        }`}
                      />
                      <span className="truncate">{isStandalone ? 'Instalado' : 'Instalar no smartphone'}</span>
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsInstallModalOpen(true);
                    onClose?.();
                  }}
                  aria-label={isStandalone ? 'Gerenciar aplicativo' : 'Instalar aplicativo'}
                  className={`shrink-0 min-h-[44px] rounded-lg px-3 py-2 text-xs font-semibold transition-colors active:scale-[0.98] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                    isStandalone
                      ? 'bg-slate-200/80 text-slate-800 hover:bg-slate-300 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700'
                      : 'bg-brand text-brand-fg hover:bg-brand-dark shadow-sm'
                  }`}
                >
                  {isStandalone ? 'Gerenciar' : 'Instalar'}
                </button>
              </div>
            </div>
          )}

          {needRefresh && !isCollapsed && (
            <button
              type="button"
              onClick={handleApplyUpdate}
              disabled={updating}
              className="w-full min-h-[44px] flex items-center justify-center gap-2 rounded-lg bg-brand text-brand-fg px-3 py-2 text-xs font-semibold shadow-sm hover:bg-brand-dark active:scale-[0.98] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <RefreshCw size={14} aria-hidden="true" className={updating ? 'animate-spin' : ''} />
              <span>{updating ? 'Atualizando…' : 'Atualizar versão'}</span>
            </button>
          )}

          {/* Card de Workspace & Telemetria */}
          {!isCollapsed ? (
            <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 dark:bg-[#18181b]/70 border border-slate-200/70 dark:border-zinc-800 px-2.5 py-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 shrink-0" aria-hidden="true" />
                <span
                  className="font-mono text-xs font-semibold text-slate-700 dark:text-zinc-300 truncate"
                  title={currentUser?.companyName || 'Nexus ITAM'}
                >
                  {currentUser?.companyName || (master ? 'Cluster Master' : 'Nexus ITAM')}
                </span>
              </div>
              <span className="font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1 shrink-0">
                <Shield size={12} aria-hidden="true" /> TLS 1.3
              </span>
            </div>
          ) : (
            <div className="flex justify-center py-1" title={`Conectado • ${currentUser?.companyName || 'Nexus ITAM'}`}>
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" aria-hidden="true" />
            </div>
          )}

          {/* Perfil corporativo do operador */}
          {!isCollapsed ? (
            <div className="flex items-center justify-between gap-2 pt-0.5">
              <div className="flex items-center gap-2 min-w-0">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white dark:bg-[#18181b] font-mono text-xs font-bold border border-slate-700/60 dark:border-zinc-700 shadow-sm">
                  {(currentUser?.name || currentUser?.email || 'U')
                    .split(' ')
                    .map((p) => p[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-slate-900 dark:text-[#fafafa] leading-tight">
                    {currentUser?.name || 'Operador'}
                  </p>
                  <p className="truncate font-mono text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mt-0.5">
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
                  data-icon-button="true"
                  className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-200/80 bg-slate-50 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:border-zinc-800 dark:bg-[#18181b] dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-[#fafafa] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  {isDark ? <Sun size={16} aria-hidden="true" className="text-amber-400" /> : <Moon size={16} aria-hidden="true" />}
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  title="Encerrar sessão"
                  aria-label="Encerrar sessão"
                  data-icon-button="true"
                  className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-200/80 bg-slate-50 text-slate-600 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 dark:border-zinc-800 dark:bg-[#18181b] dark:text-zinc-300 dark:hover:border-rose-900/50 dark:hover:bg-rose-950/40 dark:hover:text-rose-300 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  <LogOut size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1.5 pt-1 border-t border-slate-100 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setTheme(isDark ? 'light' : 'dark')}
                title={isDark ? 'Modo Claro' : 'Modo Escuro'}
                aria-label="Alternar tema"
                data-icon-button="true"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 dark:text-zinc-300 dark:hover:bg-[#18181b] active:scale-[0.98] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                {isDark ? <Sun size={16} aria-hidden="true" className="text-amber-400" /> : <Moon size={16} aria-hidden="true" />}
              </button>
              <button
                type="button"
                onClick={handleLogout}
                title="Encerrar sessão"
                aria-label="Encerrar sessão"
                data-icon-button="true"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-600 hover:bg-rose-50 hover:text-rose-600 dark:text-zinc-300 dark:hover:bg-rose-950/40 dark:hover:text-rose-300 active:scale-[0.98] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <LogOut size={16} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
