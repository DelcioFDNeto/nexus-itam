// src/pages/CollaboratorAccessManager.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Copy,
  ExternalLink,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { can } from '../utils/permissions';
import { getEmployees, getSectors } from '../services/employeeService';
import { syncTenantAssetsToPortal } from '../services/assetService';
import { microservicesApi, resolvePortalUrl } from '../services/microservicesClient';
import { buildBrandedPortalUrl } from '../utils/portalBranding';
import { isMatchingHolder } from '../utils/employeeMatching';
import CollaboratorAccessWorkspace from '../components/portal/CollaboratorAccessWorkspace';

/**
 * Tela dedicada ao Gestor para provisionamento e governanca de acessos
 * ao Portal do Colaborador (Vue 3) sem precisar navegar ate abas secundarias.
 */
const CollaboratorAccessManager = () => {
  const { currentUser } = useAuth();
  const [portalUsers, setPortalUsers] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [sectors, setSectors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncingAssets, setSyncingAssets] = useState(false);
  const [loadError, setLoadError] = useState('');
  const requestSeqRef = useRef(0);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const portalUrl = useMemo(
    () => buildBrandedPortalUrl(resolvePortalUrl(), currentUser),
    [currentUser],
  );

  const loadAll = useCallback(async () => {
    if (!currentUser?.tenantId) {
      setLoading(false);
      return;
    }
    const reqSeq = ++requestSeqRef.current;
    setLoading(true);
    setLoadError('');
    try {
      const [usersRes, empsRes, secsRes] = await Promise.allSettled([
        microservicesApi.listUsers(),
        getEmployees(currentUser.tenantId),
        getSectors(currentUser.tenantId),
      ]);
      if (!isMountedRef.current || reqSeq !== requestSeqRef.current) return;

      if (usersRes.status === 'fulfilled') {
        setPortalUsers(usersRes.value?.items || []);
      } else {
        setPortalUsers([]);
        const msg = usersRes.reason?.message || 'Não foi possível carregar os dados do Portal do Colaborador.';
        setLoadError(msg);
        toast.error(msg);
      }
      setEmployees(empsRes.status === 'fulfilled' ? empsRes.value || [] : []);
      setSectors(secsRes.status === 'fulfilled' ? secsRes.value || [] : []);
    } catch (err) {
      if (!isMountedRef.current || reqSeq !== requestSeqRef.current) return;
      console.error('Erro ao carregar central de acessos:', err);
      const msg = err?.message || 'Não foi possível carregar os dados do Portal do Colaborador.';
      setLoadError(msg);
      toast.error(msg);
    } finally {
      if (isMountedRef.current && reqSeq === requestSeqRef.current) {
        setLoading(false);
      }
    }
  }, [currentUser?.tenantId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const metrics = useMemo(() => {
    const collaborators = portalUsers.filter((u) => u.role === 'collaborator');
    const active = collaborators.filter((u) => u.active !== false).length;
    const suspended = collaborators.length - active;
    const portalEmailSet = new Set(portalUsers.map((u) => String(u.email || '').toLowerCase().trim()));
    const pendingFromHr = employees.filter((e) => {
      if (!e.email) return false;
      if (portalEmailSet.has(String(e.email).toLowerCase().trim())) return false;
      if (e.name && portalUsers.some((u) => u?.name && isMatchingHolder(u.name, e.name))) {
        return false;
      }
      return true;
    }).length;

    return { total: collaborators.length, active, suspended, pendingFromHr };
  }, [portalUsers, employees]);

  const copyPortalLink = async () => {
    try {
      await navigator.clipboard.writeText(portalUrl);
      toast.success('Link Whitelabel do Portal copiado!');
    } catch {
      toast.error('Não foi possível copiar o link.');
    }
  };

  const handleSyncAssets = async () => {
    if (!currentUser?.tenantId || syncingAssets) return;
    setSyncingAssets(true);
    try {
      const res = await syncTenantAssetsToPortal(currentUser.tenantId, {
        silent: false,
        employees,
      });
      if (res.synced > 0) {
        toast.success(
          `${res.synced} ativo(s) sincronizado(s) com o Portal do Colaborador!`,
        );
      } else {
        toast.info('Nenhum ativo encontrado para sincronizar com o Portal.');
      }
    } catch (err) {
      toast.error(err?.message || 'Não foi possível sincronizar os ativos com o Portal.');
    } finally {
      if (isMountedRef.current) setSyncingAssets(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto pb-24 space-y-6 animate-fade-in">
      {/* HEADER DEDICADO DO GESTOR */}
      <header className="bg-white dark:bg-[#111113] rounded-2xl border border-slate-200 dark:border-zinc-800 p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-brand/10 border border-brand/20 text-brand-aa flex items-center justify-center shrink-0">
              <KeyRound size={22} aria-hidden="true" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-[#fafafa] tracking-tight">
                  Acessos do Portal do Colaborador
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-black uppercase tracking-wider bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
                  Gestão Centralizada
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-zinc-400 mt-0.5">
                Cadastre logins individuais, puxe colaboradores já registrados no RH, redefina senhas fortes e compartilhe o link Whitelabel do portal.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleSyncAssets}
              disabled={syncingAssets || !currentUser?.tenantId}
              title="Envia todos os ativos em custódia para o Portal do Colaborador"
              className="inline-flex min-h-[44px] items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-[#18181b] text-xs font-bold text-slate-700 dark:text-zinc-200 hover:border-brand/50 hover:text-brand-aa active:scale-[0.98] transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <RefreshCw
                size={14}
                className={syncingAssets ? 'animate-spin' : ''}
                aria-hidden="true"
              />
              <span>{syncingAssets ? 'Sincronizando…' : 'Sincronizar Ativos'}</span>
            </button>
            <button
              type="button"
              onClick={copyPortalLink}
              className="inline-flex min-h-[44px] items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-[#18181b] text-xs font-bold text-slate-700 dark:text-zinc-200 hover:border-brand/50 hover:text-brand-aa active:scale-[0.98] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <Copy size={14} aria-hidden="true" /> Copiar Link Portal
            </button>
            <a
              href={portalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] items-center gap-1.5 px-4 py-2 rounded-xl bg-brand hover:bg-brand-dark text-brand-fg text-xs font-black shadow-sm active:scale-[0.98] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <span>Abrir Portal</span>
              <ExternalLink size={14} aria-hidden="true" />
            </a>
          </div>
        </div>
      </header>

      {/* KPI STRIP */}
      <section aria-label="Indicadores de acesso ao portal" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-4 rounded-2xl bg-white dark:bg-[#111113] border border-slate-200 dark:border-zinc-800 shadow-sm">
          <p className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-zinc-400 flex items-center gap-1.5">
            <UserCheck size={13} className="text-emerald-500" aria-hidden="true" /> Colaboradores Ativos
          </p>
          <p className="text-2xl font-black text-slate-900 dark:text-[#fafafa] mt-1 tabular-nums">
            {metrics.active}
          </p>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5 tabular-nums">
            {metrics.total} contas no total
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-[#111113] border border-slate-200 dark:border-zinc-800 shadow-sm">
          <p className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-zinc-400 flex items-center gap-1.5">
            <UserPlus size={13} className="text-brand-aa" aria-hidden="true" /> Base RH Sem Login
          </p>
          <p className="text-2xl font-black text-slate-900 dark:text-[#fafafa] mt-1 tabular-nums">
            {metrics.pendingFromHr}
          </p>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
            {metrics.pendingFromHr > 0 ? 'Prontos para importar abaixo' : '100% da base coberta'}
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-[#111113] border border-slate-200 dark:border-zinc-800 shadow-sm">
          <p className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-zinc-400 flex items-center gap-1.5">
            <ShieldCheck size={13} className="text-amber-500" aria-hidden="true" /> Acessos Suspensos
          </p>
          <p className="text-2xl font-black text-slate-900 dark:text-[#fafafa] mt-1 tabular-nums">
            {metrics.suspended}
          </p>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
            Bloqueio reversível imediato
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-[#111113] border border-slate-200 dark:border-zinc-800 shadow-sm flex flex-col justify-between">
          <p className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-zinc-400 flex items-center gap-1.5">
            <Users size={13} aria-hidden="true" /> Atalhos de Equipe
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            <Link
              to="/employees"
              className="inline-flex min-h-[44px] items-center text-xs font-bold text-brand-aa hover:underline rounded-lg px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              Equipe & Posse →
            </Link>
            {can(currentUser, 'users:manage') && (
              <Link
                to="/users"
                className="inline-flex min-h-[44px] items-center text-xs font-bold text-slate-600 dark:text-zinc-300 hover:text-brand-aa hover:underline rounded-lg px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                Usuários Console →
              </Link>
            )}
          </div>
        </div>
      </section>

      <CollaboratorAccessWorkspace
        currentUser={currentUser}
        portalUsers={portalUsers}
        portalLoading={loading}
        portalError={loadError}
        employees={employees}
        sectors={sectors}
        onRefreshUsers={loadAll}
        onPortalUsersChange={setPortalUsers}
      />
    </div>
  );
};

export default CollaboratorAccessManager;
