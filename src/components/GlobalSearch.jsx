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
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Building2, Command, FileText, Monitor, Search, User } from 'lucide-react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../contexts/AuthContext';
import { can, isSuperadmin } from '../utils/permissions';
import { isModuleEnabled } from '../utils/entitlements';

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
  { name: 'Projetos', path: '/projects', cap: 'projects:write', feature: 'projects' },
  { name: 'Tarefas', path: '/tasks', cap: 'tasks:write', feature: 'projects' },
  { name: 'Licenças', path: '/licenses', cap: 'licenses:write', feature: 'licenses' },
  { name: 'Contratos', path: '/services', cap: 'contracts:write', feature: 'contracts' },
  { name: 'Agente ITAM', path: '/agent', cap: 'agent:manage', feature: 'agent' },
  { name: 'Importação', path: '/import', cap: 'assets:import', feature: 'import' },
  { name: 'Acessos', path: '/users', cap: 'users:manage' },
  { name: 'Configurações', path: '/settings', cap: 'settings:read' },
];

const MASTER_PAGES = [
  { name: 'Painel do console', path: '/dashboard' },
  { name: 'Empresas', path: '/admin/tenants' },
  { name: 'Nova empresa', path: '/admin/tenants?novo=1' },
  { name: 'Acessos globais', path: '/admin/users' },
  { name: 'Planos e limites', path: '/admin/plans' },
];

const GlobalSearch = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const inputRef = useRef(null);
  const [term, setTerm] = useState('');
  const [data, setData] = useState(null); // carregado uma vez por abertura
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);

  const master = isSuperadmin(currentUser);
  const tenantId = currentUser?.tenantId;

  useEffect(() => {
    if (!isOpen) return undefined;
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        if (master) {
          const [tenantsSnap, usersSnap] = await Promise.all([
            getDocs(collection(db, 'tenants')),
            getDocs(collection(db, 'users')),
          ]);
          if (!cancelled) {
            setData({
              tenants: tenantsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
              users: usersSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
            });
          }
        } else if (tenantId) {
          const [assetsSnap, employeesSnap] = await Promise.all([
            getDocs(query(collection(db, 'assets'), where('tenantId', '==', tenantId))),
            can(currentUser, 'employees:write')
              ? getDocs(query(collection(db, 'employees'), where('tenantId', '==', tenantId)))
              : Promise.resolve({ docs: [] }),
          ]);
          if (!cancelled) {
            setData({
              assets: assetsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
              employees: employeesSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
            });
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
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, master, tenantId]);

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
      (data?.assets || [])
        .filter((a) => norm(`${a.model} ${a.internalId} ${a.serialNumber} ${a.assignedTo} ${a.clientName}`).includes(q))
        .slice(0, 8)
        .forEach((a) => items.push({ key: `a-${a.id}`, group: 'Ativos', icon: Monitor, title: a.model || a.internalId, subtitle: [a.internalId, a.assignedTo, a.status].filter(Boolean).join(' · '), path: `/assets/${a.id}` }));
      (data?.employees || [])
        .filter((e) => norm(`${e.name} ${e.email} ${e.role}`).includes(q))
        .slice(0, 4)
        .forEach((e) => items.push({ key: `e-${e.id}`, group: 'Equipe', icon: User, title: e.name || e.email || 'Sem nome', subtitle: [e.role, e.branch].filter(Boolean).join(' · '), path: '/employees' }));
    }
    return items;
  }, [term, data, master, currentUser]);

  const close = () => {
    setTerm('');
    setCursor(0);
    setData(null);
    onClose();
  };

  const select = (item) => {
    if (!item) return;
    navigate(item.path);
    close();
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
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
      className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[12vh] p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div role="dialog" aria-modal="true" aria-label="Busca global" className="bg-white dark:bg-slate-800 w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[70vh]">
        <div className="flex items-center p-4 border-b border-gray-100 dark:border-slate-700 gap-3">
          <Search className="text-gray-400 dark:text-gray-500" size={22} />
          <input
            ref={inputRef}
            value={term}
            onChange={(e) => { setTerm(e.target.value); setCursor(0); }}
            onKeyDown={onKeyDown}
            className="flex-1 text-lg outline-none text-gray-800 dark:text-gray-100 placeholder-gray-400 font-medium bg-transparent"
            placeholder={master ? 'Buscar empresas, usuários ou telas...' : 'Buscar ativos, pessoas ou telas...'}
            aria-label="Termo de busca"
            aria-activedescendant={results[cursor] ? `gs-${results[cursor].key}` : undefined}
          />
          <button onClick={close} className="p-1 bg-gray-100 dark:bg-slate-700 rounded text-gray-500 dark:text-gray-300 text-xs font-bold px-2">ESC</button>
        </div>

        <div className="overflow-y-auto p-2 bg-gray-50/60 dark:bg-slate-900/40" role="listbox">
          {loading && !data && <div className="p-4 text-center text-gray-400 dark:text-gray-500 text-sm">Carregando...</div>}

          {!term && (
            <div className="p-8 text-center text-gray-400 dark:text-gray-500 flex flex-col items-center gap-2">
              <Command size={32} className="opacity-20" />
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
                {header && <p className="px-3 pt-3 pb-1 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{header}</p>}
                <button
                  id={`gs-${item.key}`}
                  role="option"
                  aria-selected={active}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => select(item)}
                  className={`w-full text-left px-3 py-2.5 rounded-xl flex items-center gap-3 transition-all border ${active ? 'bg-white dark:bg-slate-800 border-brand/30 shadow-sm' : 'border-transparent'}`}
                >
                  <span className={`p-1.5 rounded-lg ${active ? 'bg-brand text-white' : 'bg-gray-200 text-gray-600 dark:bg-slate-700 dark:text-gray-300'}`}><Icon size={14} /></span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-bold text-sm text-gray-900 dark:text-white truncate">{item.title}</span>
                    {item.subtitle && <span className="block text-xs text-gray-400 dark:text-gray-500 truncate">{item.subtitle}</span>}
                  </span>
                  <ArrowRight size={14} className={`shrink-0 transition-opacity ${active ? 'opacity-100 text-brand' : 'opacity-0'}`} />
                </button>
              </React.Fragment>
            );
          })}

          {term && !loading && results.length === 0 && (
            <div className="p-8 text-center text-gray-500 dark:text-gray-400 text-sm">Nenhum resultado para "{term}".</div>
          )}
        </div>

        <div className="bg-gray-100 dark:bg-slate-900 p-2 text-center text-[10px] text-gray-400 dark:text-gray-500 font-mono border-t border-gray-200 dark:border-slate-700">
          ↑ ↓ para navegar • Enter para abrir • ESC para fechar
        </div>
      </div>
    </div>
  );
};

export default GlobalSearch;
