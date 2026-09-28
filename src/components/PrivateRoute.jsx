// src/components/PrivateRoute.jsx
import React from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { LockKeyhole, LogOut, ShieldAlert } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { can, hasValidTenant, isSuperadmin } from '../utils/permissions';
import { FEATURES, hasFeature, isModuleHidden } from '../utils/entitlements';

const AccessDenied = ({ title = 'Acesso restrito', reason, icon: Icon = ShieldAlert, showHome = true }) => {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/', { replace: true });
  };

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-6">
      <div className="w-16 h-16 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-100 dark:border-red-900/50 flex items-center justify-center mb-5">
        <Icon className="text-red-500" size={28} />
      </div>
      <h1 className="text-xl font-black tracking-tight text-slate-900 dark:text-white">{title}</h1>
      <p className="mt-2 max-w-sm text-sm text-slate-500 dark:text-slate-400">{reason}</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        {showHome && (
          <Link
            to="/dashboard"
            className="inline-flex items-center rounded-xl bg-slate-900 px-5 py-3 text-xs font-black uppercase tracking-widest text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
          >
            Voltar ao painel
          </Link>
        )}
        {/* Sem empresa vinculada (ou com acesso suspenso) nao ha menu lateral:
            antes o usuario ficava preso nesta tela, sem como sair da conta. */}
        <button
          onClick={handleLogout}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-5 py-3 text-xs font-black uppercase tracking-widest text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <LogOut size={14} /> Sair da conta
        </button>
      </div>
    </div>
  );
};

/**
 * Guarda de rota.
 *
 * @param {string}  [capability] Capacidade exigida (ver utils/permissions.js).
 * @param {boolean} [masterOnly] Restringe ao tenant Nexus Master.
 * @param {string}  [feature]    Recurso do plano exigido (ver utils/entitlements.js).
 *
 * Sem `capability` a rota apenas exige sessao valida — o comportamento antigo.
 */
const PrivateRoute = ({ children, capability, masterOnly = false, feature }) => {
  const { currentUser, loading, profileError } = useAuth();
  const location = useLocation();

  // Enquanto o perfil nao resolve, nao decidimos nada: nem libera, nem manda ao login.
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-slate-900 dark:border-slate-700 dark:border-t-white" />
      </div>
    );
  }

  if (!currentUser) {
    // Guarda o destino para devolver o usuario apos o login.
    return <Navigate to="/" replace state={{ from: location.pathname + location.search }} />;
  }

  // Perfil sem tenant valido (orfao, suspenso ou empresa bloqueada): fail-closed.
  if (!hasValidTenant(currentUser)) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <AccessDenied
          title={currentUser.blocked ? 'Acesso suspenso' : 'Acesso restrito'}
          reason={profileError || 'Seu usuário ainda não está vinculado a uma empresa. Peça ao administrador um convite.'}
          showHome={false}
        />
      </div>
    );
  }

  if (masterOnly && !isSuperadmin(currentUser)) {
    return <AccessDenied reason="Esta área pertence ao console Nexus Master." />;
  }

  if (capability && !can(currentUser, capability)) {
    return <AccessDenied reason="Seu perfil não tem permissão para esta área. Fale com o proprietário da conta." />;
  }

  if (feature && !hasFeature(currentUser, feature)) {
    const label = FEATURES.find((f) => f.id === feature)?.label || 'Este recurso';
    return (
      <AccessDenied
        icon={LockKeyhole}
        title="Recurso fora do plano"
        reason={`${label} não está incluído no plano ${currentUser.entitlements?.planName || 'atual'} da sua empresa. Fale com o suporte Nexus ITAM para liberar.`}
      />
    );
  }

  if (feature && !isSuperadmin(currentUser) && isModuleHidden(currentUser, feature)) {
    return (
      <AccessDenied
        icon={LockKeyhole}
        title="Módulo desativado"
        reason="O proprietário da conta desativou este módulo em Configurações."
      />
    );
  }

  return children;
};

export default PrivateRoute;
