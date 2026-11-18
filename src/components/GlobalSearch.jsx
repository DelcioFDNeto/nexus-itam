// src/components/GlobalSearch.jsx
// -----------------------------------------------------------------------------
// Busca global (Ctrl+K).
//
// Antes: buscava so nos 100 primeiros ativos e 50 colaboradores (ordem
// arbitraria do Firestore) — em empresas maiores, itens existentes "sumiam";
// o rodape prometia setas/Enter/ESC mas nenhuma tecla funcionava; havia atalho
// para /wiki (rota inexistente) e um colaborador sem nome derrubava a busca.
// Agora os dados sao carregados uma vez por abertura e filtrados em memoria;
// no console master a busca encontra empresas e usuarios.
// -----------------------------------------------------------------------------
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Building2, Command, FileText, Monitor, Search, User } from 'lucide-react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../services/firebase';
import { getAllAssets } from '../services/assetService';
import { getEmployees } from '../services/employeeService';
import { useAuth } from '../contexts/AuthContext';
import { can, isSuperadmin } from '../utils/permissions';
import { isModuleEnabled } from '../utils/entitlements';
import { captureFocusTarget, restoreFocusSafely, trapFocusWithin } from '../utils/focusTrap';

const norm = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

const TENANT_PAGES = [
  { name: 'Dashboard', path: '/dashboard' },
  { name: 'Ativos', path: '/assets', cap: 'assets:read' },
  { name: 'Novo ativo', path: '/assets/new', cap: 'assets:write' },
  { name: 'Auditoria', path: '/audit', cap: 'audit:run', feature: 'audit' },
  { name: 'Termos e transferências', path: '/termos', cap: 'terms:read' },
  { name: 'Equipe', path: '/employees', cap: 'employees:write' },
  { name: 'Acessos Portal Colaborador', path: '/portal-colaboradores', cap: 'portal:manage' },
  { name: 'Projetos', path: '/projects', cap: 'projects:write', feature: 'projects' },
  { name: 'Tarefas', path: '/tasks', cap: 'tasks:write', feature: 'projects' },
  { name: 'Licenças', path: '/licenses', cap: 'licenses:write', feature: 'licenses' },
  { name: 'Contratos', path: '/services', cap: 'contracts:write', feature: 'contracts' },
  { name: 'Agente ITAM', path: '/agent', cap: 'agent:manage', feature: 'agent' },
  { name: 'Cloud Vault & Conector VPS', path: '/cloud-vault', cap: 'cloud:read', feature: 'cloud_storage' },
  { name: 'Importação', path: '/import', cap: 'assets:import', feature: 'import' },
  { name: 'Acessos', path: '/users', cap: 'users:manage' },
  { name: 'Plano e contrato personalizado', path: '/plano', cap: 'settings:read' },
  { name: 'Configurações', path: '/settings', cap: 'settings:read' },
  { name: 'Filiais e locais', path: '/settings?secao=locais', cap: 'settings:read' },
  { name: 'Termos: textos e regras', path: '/settings?secao=documentos', cap: 'settings:read' },
  { name: 'Identidade visual', path: '/settings?secao=identidade', cap: 'settings:read' },
  { name: 'Backup', path: '/settings?secao=backup', cap: 'backup:create' },
];

const MASTER_PAGES = [
  { name: 'Painel do console', path: '/dashboard' },
  { name: 'Empresas', path: '/admin/tenants' },
  { name: 'Nova empresa', path: '/admin/tenants?novo=1' },
  { name: 'Acessos globais', path: '/admin/users' },
  { name: 'Planos e limites', path: '/admin/plans' },
];

const CACHE_TTL_MS = 3 * 60 * 1000;
const globalSearchCache = {
  key: null,
  timestamp: 0,
  data: null,
};

const GlobalSearch = ({ isOpen, onClose, returnFocusRef }) => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const previousFocusRef = useRef(null);
  const wasOpenRef = useRef(false);
  const returnFocusRefLatest = useRef(returnFocusRef);
  useEffect(() => {
    returnFocusRefLatest.current = returnFocusRef;
  }, [returnFocusRef]);

  const [term, setTerm] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);

  const master = isSuperadmin(currentUser);
  const tenantId = currentUser?.tenantId;
  const authSource = currentUser?.authSource;
  const userUid = currentUser?.uid || 'anon';
  const canViewEmployees = can(currentUser, 'employees:write');
  const cacheKey = master
    ? `nexus-master:${userUid}`
    : `${tenantId || 'none'}:${userUid}:${canViewEmployees ? '1' : '0'}`;

  const close = useCallback(() => {
    setTerm('');
    setCursor(0);
    setLoading(false);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) {
      if (wasOpenRef.current) {
        wasOpenRef.current = false;
        const previous = previousFocusRef.current;
        previousFocusRef.current = null;
        const mainContent =
          typeof document !== 'undefined' ? document.getElementById('main-content') : null;
        if (!restoreFocusSafely(previous, returnFocusRefLatest.current?.current)) {
          restoreFocusSafely(mainContent);
        }
      }
      return undefined;
    }

    wasOpenRef.current = true;
    previousFocusRef.current = captureFocusTarget(dialogRef.current);

    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleGlobalKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === 'Tab') {
        trapFocusWithin(event, dialogRef.current);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isOpen, close]);

  useEffect(() => {
    if (!isOpen) {
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    const now = Date.now();
    if (
      globalSearchCache.key === cacheKey &&
      globalSearchCache.data &&
      now - globalSearchCache.timestamp < CACHE_TTL_MS
    ) {
      setData(globalSearchCache.data);
      setLoading(false);
      return undefined;
    }

    if (!master && !tenantId) {
      setData({});
      setLoading(false);
      return undefined;
    }

    setData(null);

    const load = async () => {
      setLoading(true);
      try {
        if (master) {
          const [tenantsSnap, usersSnap] = await Promise.all([
            getDocs(collection(db, 'tenants')),
            getDocs(collection(db, 'users')),
          ]);
          if (!cancelled) {
            const fetchedData = {
              tenants: tenantsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
              users: usersSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
            };
            globalSearchCache.key = cacheKey;
            globalSearchCache.timestamp = Date.now();
            globalSearchCache.data = fetchedData;
            setData(fetchedData);
          }
        } else if (tenantId) {
          if (authSource === 'gateway') {
            const [assetsList, employeesList] = await Promise.all([
              getAllAssets(tenantId),
              canViewEmployees ? getEmployees(tenantId) : Promise.resolve([]),
            ]);
            if (!cancelled) {
              const fetchedData = { assets: assetsList, employees: employeesList };
              globalSearchCache.key = cacheKey;
              globalSearchCache.timestamp = Date.now();
              globalSearchCache.data = fetchedData;
              setData(fetchedData);
            }
            return;
          }

          const [assetsSnap, employeesSnap] = await Promise.all([
            getDocs(query(collection(db, 'assets'), where('tenantId', '==', tenantId))),
            canViewEmployees
              ? getDocs(query(collection(db, 'employees'), where('tenantId', '==', tenantId)))
              : Promise.resolve({ docs: [] }),
          ]);
          if (!cancelled) {
            const fetchedData = {
              assets: assetsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
              employees: employeesSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
            };
            globalSearchCache.key = cacheKey;
            globalSearchCache.timestamp = Date.now();
            globalSearchCache.data = fetchedData;
            setData(fetchedData);
          }
        }
      } catch (error) {
        console.error('Falha ao carregar a busca:', error);
        if (!cancelled) setData({});
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();

    return () => {
      cancelled = true;
      setLoading(false);
    };
  }, [isOpen, master, tenantId, canViewEmployees, authSource, cacheKey]);

  const results = useMemo(() => {
    const q = norm(term.trim());
    const pages = (master ? MASTER_PAGES : TENANT_PAGES).filter(
      (p) => (!p.cap || can(currentUser, p.cap)) && (!p.feature || isModuleEnabled(currentUser, p.feature)),
    );
    if (!q) return [];

    const items = [];
    pages
      .filter((p) => norm(p.name).includes(q))
      .forEach((p) => items.push({ key: `page-${p.path}`, group: 'Acesso rápido', icon: FileText, title: p.name, path: p.path }));

    if (master) {
      (data?.tenants || [])
        .filter((t) => norm(`${t.companyName} ${t.id}`).includes(q))
        .slice(0, 6)
        .forEach((t) => items.push({ key: `t-${t.id}`, group: 'Empresas', icon: Building2, title: t.companyName || t.id, subtitle: `#${t.id} · ${t.plan || 'sem plano'}`, path: `/admin/tenants?empresa=${encodeURIComponent(t.id)}` }));
      (data?.users || [])
        .filter((u) => norm(`${u.name} ${u.email}`).includes(q))
        .slice(0, 6)
        .forEach((u) => items.push({ key: `u-${u.id}`, group: 'Usuários', icon: User, title: u.name || u.email, subtitle: u.email, path: `/admin/users?empresa=${encodeURIComponent(u.tenantId || '')}` }));
    } else {
      if (can(currentUser, 'assets:read')) {
        (data?.assets || [])
          .filter((a) => norm(`${a.model} ${a.internalId} ${a.serialNumber} ${a.assignedTo} ${a.clientName}`).includes(q))
          .slice(0, 8)
          .forEach((a) => items.push({ key: `a-${a.id}`, group: 'Ativos', icon: Monitor, title: a.model || a.internalId, subtitle: [a.internalId, a.assignedTo, a.status].filter(Boolean).join(' · '), path: `/assets/${a.id}` }));
      }
      if (canViewEmployees) {
        (data?.employees || [])
          .filter((e) => norm(`${e.name} ${e.email} ${e.role}`).includes(q))
          .slice(0, 4)
          .forEach((e) => items.push({ key: `e-${e.id}`, group: 'Equipe', icon: User, title: e.name || e.email || 'Sem nome', subtitle: [e.role, e.branch].filter(Boolean).join(' · '), path: '/employees' }));
      }
    }
    return items;
  }, [term, data, master, currentUser, canViewEmployees]);

  const select = (item) => {
    if (!item) return;
    navigate(item.path);
    close();
  };

  const onInputKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      select(results[cursor]);
    }
  };

  if (!isOpen) return null;

  let lastGroup = null;

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[12vh] p-4 animate-fade-in"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="global-search-title"
        className="bg-white dark:bg-[#111113] border border-slate-200 dark:border-zinc-800 w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[75vh] overscroll-contain animate-zoom-in"
      >
        <h2 id="global-search-title" className="sr-only">
          Busca global
        </h2>
        <div className="flex items-center px-4 py-2.5 border-b border-slate-200 dark:border-zinc-800 gap-3">
          <Search aria-hidden="true" className="text-slate-400 dark:text-zinc-500 shrink-0" size={20} />
          <label htmlFor="global-search-input" className="sr-only">
            Termo de busca global
          </label>
          <input
            ref={inputRef}
            id="global-search-input"
            name="globalSearch"
            type="text"
            aria-autocomplete="list"
            aria-expanded={results.length > 0}
            aria-activedescendant={results[cursor] ? `gs-${results[cursor].key}` : undefined}
            aria-controls="global-search-listbox"
            value={term}
            onChange={(e) => { setTerm(e.target.value); setCursor(0); }}
            onKeyDown={onInputKeyDown}
            className="flex-1 min-h-[44px] rounded-lg px-2 text-base sm:text-lg text-slate-900 dark:text-[#fafafa] placeholder:text-slate-400 dark:placeholder:text-zinc-500 font-medium bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            placeholder={master ? 'Buscar empresas, usuários ou telas…' : 'Buscar ativos, pessoas ou telas…'}
          />
          <button
            type="button"
            onClick={close}
            aria-label="Fechar busca"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-[#18181b] px-3 text-xs font-bold text-slate-700 dark:text-zinc-300 transition-colors hover:bg-slate-200 dark:hover:bg-zinc-800 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            ESC
          </button>
        </div>

        <div id="global-search-listbox" className="overflow-y-auto overscroll-contain p-2 bg-slate-50/70 dark:bg-[#09090b]/60" role="listbox">
          {loading && !data && <div className="p-4 text-center text-slate-500 dark:text-zinc-400 text-sm">Carregando…</div>}

          {!term && (
            <div className="p-8 text-center text-slate-500 dark:text-zinc-400 flex flex-col items-center gap-2">
              <Command size={32} aria-hidden="true" className="opacity-30" />
              <p className="text-sm">{master ? 'Digite para buscar empresas, usuários ou telas do console.' : 'Digite para buscar ativos, pessoas ou telas.'}</p>
            </div>
          )}

          {results.map((item, index) => {
            const header = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            const Icon = item.icon;
            const active = index === cursor;
            return (
              <React.Fragment key={item.key}>
                {header && (
                  <p role="presentation" className="px-3 pt-3 pb-1 text-xs font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-wider">
                    {header}
                  </p>
                )}
                <button
                  type="button"
                  id={`gs-${item.key}`}
                  role="option"
                  aria-selected={active}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => select(item)}
                  className={`min-h-[44px] w-full text-left px-3 py-2.5 rounded-xl flex items-center gap-3 transition-colors border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                    active
                      ? 'bg-white dark:bg-[#111113] border-brand/40 shadow-sm'
                      : 'border-transparent hover:bg-white/70 dark:hover:bg-[#18181b]'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`p-2 rounded-lg ${
                      active
                        ? 'bg-brand text-brand-fg'
                        : 'bg-slate-200 text-slate-700 dark:bg-zinc-800 dark:text-zinc-300'
                    }`}
                  >
                    <Icon size={15} aria-hidden="true" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-bold text-sm text-slate-900 dark:text-[#fafafa] truncate">{item.title}</span>
                    {item.subtitle && <span className="block text-xs text-slate-500 dark:text-zinc-400 truncate">{item.subtitle}</span>}
                  </span>
                  <ArrowRight
                    size={14}
                    aria-hidden="true"
                    className={`shrink-0 transition-opacity ${active ? 'opacity-100 text-brand-aa' : 'opacity-0'}`}
                  />
                </button>
              </React.Fragment>
            );
          })}

          {term && !loading && results.length === 0 && (
            <div className="p-8 text-center text-slate-500 dark:text-zinc-400 text-sm">Nenhum resultado para &ldquo;{term}&rdquo;.</div>
          )}
        </div>

        <div className="bg-slate-100 dark:bg-[#111113] px-3 py-2 text-center text-xs text-slate-500 dark:text-zinc-400 font-mono border-t border-slate-200 dark:border-zinc-800">
          ↑ ↓ para navegar • Enter para abrir • ESC para fechar
        </div>
      </div>
    </div>
  );
};

export default GlobalSearch;
