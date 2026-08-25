// src/components/PrivateRoute.jsx
import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { can, hasValidTenant, isSuperadmin } from '../utils/permissions';

const AccessDenied = ({ reason }) => (
  <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-6">
    <div className="w-16 h-16 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-100 dark:border-red-900/50 flex items-center justify-center mb-5">
      <ShieldAlert className="text-red-500" size={28} />
    </div>
    <h1 className="text-xl font-black tracking-tight text-slate-900 dark:text-white">Acesso restrito</h1>
    <p className="mt-2 max-w-sm text-sm text-slate-500 dark:text-slate-400">{reason}</p>
    <a
      href="/dashboard"
      className="mt-6 inline-flex items-center rounded-xl bg-slate-900 px-5 py-3 text-xs font-black uppercase tracking-widest text-white hover:bg-slate-800"
    >
      Voltar ao painel
    </a>
  </div>
);

/**
 * Guarda de rota.
 *
 * @param {string}  [capability] Capacidade exigida (ver utils/permissions.js).
 * @param {boolean} [masterOnly] Restringe ao tenant Nexus Master.
 *
 * Sem `capability` a rota apenas exige sessao valida — o comportamento antigo.
 */
const PrivateRoute = ({ children, capability, masterOnly = false }) => {
  const { currentUser, loading } = useAuth();
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
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }

  // Perfil sem tenant valido nao acessa dado nenhum: fail-closed.
  if (!hasValidTenant(currentUser)) {
    return (
      <AccessDenied reason="Seu usuario ainda nao esta vinculado a uma empresa. Peca ao administrador para concluir o convite." />
    );
  }

  if (masterOnly && !isSuperadmin(currentUser)) {
    return <AccessDenied reason="Esta area pertence ao console Nexus Master." />;
  }

  if (capability && !can(currentUser, capability)) {
    return (
      <AccessDenied reason="Seu perfil nao tem permissao para esta area. Fale com o proprietario da conta." />
    );
  }

  return children;
};

export default PrivateRoute;
