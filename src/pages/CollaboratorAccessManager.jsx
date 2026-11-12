// src/pages/CollaboratorAccessManager.jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Copy,
  ExternalLink,
  KeyRound,
  ShieldCheck,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { can } from '../utils/permissions';
import { getEmployees, getSectors } from '../services/employeeService';
import { microservicesApi, resolvePortalUrl } from '../services/microservicesClient';
import { buildBrandedPortalUrl } from '../utils/portalBranding';
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

  const portalUrl = useMemo(
    () => buildBrandedPortalUrl(resolvePortalUrl(), currentUser),
    [currentUser],
  );

  const loadAll = useCallback(async () => {
    if (!currentUser?.tenantId) return;
    setLoading(true);
    try {
      const [usersRes, empsRes, secsRes] = await Promise.allSettled([
        microservicesApi.listUsers(),
        getEmployees(currentUser.tenantId),
        getSectors(currentUser.tenantId),
      ]);

      if (usersRes.status === 'fulfilled') {
        setPortalUsers(usersRes.value?.items || []);
      } else {
        setPortalUsers([]);
      }
      setEmployees(empsRes.status === 'fulfilled' ? empsRes.value || [] : []);
      setSectors(secsRes.status === 'fulfilled' ? secsRes.value || [] : []);
    } catch (err) {
      console.error('Erro ao carregar central de acessos:', err);
      toast.error('Não foi possível carregar os dados do Portal do Colaborador.');
    } finally {
      setLoading(false);
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
    const pendingFromHr = employees.filter(
      (e) => e.email && !portalEmailSet.has(String(e.email).toLowerCase().trim()),
    ).length;

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

  return (
    <div className="max-w-7xl mx-auto pb-24 space-y-6 animate-fade-in">
      {/* HEADER DEDICADO DO GESTOR */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-brand/10 border border-brand/20 text-brand flex items-center justify-center shrink-0">
              <KeyRound size={22} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight">
                  Acessos do Portal do Colaborador
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  Gestão Centralizada
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                Cadastre logins individuais, puxe colaboradores já registrados no RH, redefina senhas fortes e compartilhe o link Whitelabel do portal.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={copyPortalLink}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 hover:border-brand/50 hover:text-brand transition-colors"
            >
              <Copy size={14} /> Copiar Link Portal
            </button>
            <a
              href={portalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand hover:bg-brand-dark text-white text-xs font-black shadow-sm transition-colors"
            >
              <span>Abrir Portal</span>
              <ExternalLink size={14} />
            </a>
          </div>
        </div>

        {/* KPI STRIP */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5 pt-5 border-t border-slate-100 dark:border-slate-800">
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1">
              <UserCheck size={12} className="text-emerald-500" /> Colaboradores Ativos
            </p>
            <p className="text-2xl font-black text-slate-900 dark:text-white mt-1 tabular-nums">
              {metrics.active}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {metrics.total} contas no total
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1">
              <UserPlus size={12} className="text-brand" /> Base RH Sem Login
            </p>
            <p className="text-2xl font-black text-slate-900 dark:text-white mt-1 tabular-nums">
              {metrics.pendingFromHr}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {metrics.pendingFromHr > 0 ? 'Prontos para importar abaixo' : '100% da base coberta'}
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1">
              <ShieldCheck size={12} className="text-amber-500" /> Acessos Suspensos
            </p>
            <p className="text-2xl font-black text-slate-900 dark:text-white mt-1 tabular-nums">
              {metrics.suspended}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Bloqueio reversível imediato
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800 flex flex-col justify-between">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1">
              <Users size={12} /> Atalhos de Equipe
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
              <Link
                to="/employees"
                className="text-xs font-bold text-brand hover:underline"
              >
                Equipe & Posse →
              </Link>
              {can(currentUser, 'users:manage') && (
                <Link
                  to="/users"
                  className="text-xs font-bold text-slate-500 hover:text-brand hover:underline"
                >
                  Usuários Console →
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>

      <CollaboratorAccessWorkspace
        currentUser={currentUser}
        portalUsers={portalUsers}
        portalLoading={loading}
        employees={employees}
        sectors={sectors}
        onRefreshUsers={loadAll}
        onPortalUsersChange={setPortalUsers}
      />
    </div>
  );
};

export default CollaboratorAccessManager;
