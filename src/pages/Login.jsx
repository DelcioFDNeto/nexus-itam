// src/pages/Login.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  Lock,
  Mail,
  ArrowRight,
  AlertCircle,
  KeyRound,
  X,
  CheckCircle,
  Loader2,
  Server,
  ExternalLink,
  Sparkles,
} from 'lucide-react';
import Logo from '../components/Logo';
import { resolvePortalUrl } from '../services/microservicesClient';

// Mensagens por código do Firebase Auth / Gateway Fastify
const loginErrorMessage = (err) => {
  if (err?.isGatewayPolicyError) {
    return err.message;
  }
  if (err?.isGatewayError && err.message) {
    return err.message;
  }
  switch (err?.code) {
    case 'auth/too-many-requests':
      return 'Muitas tentativas seguidas. Aguarde alguns minutos ou redefina a senha.';
    case 'auth/network-request-failed':
      return 'Sem conexão com o servidor. Verifique sua internet.';
    case 'auth/user-disabled':
      return 'Esta conta foi desativada. Fale com o administrador.';
    case 'auth/invalid-email':
      return 'E-mail inválido.';
    default:
      return 'Acesso negado. Verifique suas credenciais.';
  }
};

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [signingIn, setSigningIn] = useState(false);

  const [isResetOpen, setIsResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetMessage, setResetMessage] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetLoading, setResetLoading] = useState(false);

  const { login, resetPassword, currentUser, loading: authLoading, isGatewayOnly = false } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const destination = location.state?.from && location.state.from !== '/' ? location.state.from : '/dashboard';

  const portalUrl = resolvePortalUrl();

  useEffect(() => {
    if (currentUser && !authLoading) navigate(destination, { replace: true });
  }, [currentUser, authLoading, navigate, destination]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSigningIn(true);
    if (destination === '/dashboard') import('./Dashboard').catch(() => {});
    try {
      await login(email, password);
    } catch (err) {
      console.error(err);
      setError(loginErrorMessage(err));
      setSigningIn(false);
    }
  };

  const handleFillDemoAdmin = () => {
    setEmail('admin@nexuscorp.com.br');
    setPassword('Nexus@2026!');
    setError('');
  };

  // Splashscreen de inicialização / validação de sessão
  if (authLoading || (signingIn && !error)) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-950 p-4 font-sans text-slate-100" aria-busy="true">
        <div className="flex flex-col items-center text-center max-w-sm px-6 animate-fade-in" role="status">
          <div className="w-14 h-14 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center shadow-lg p-2 mb-4">
            <Logo size="md" showText={false} />
          </div>

          <h1 className="text-xl font-bold text-white tracking-tight flex items-center justify-center gap-1.5">
            Nexus <span className="text-brand">ITAM</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1 font-medium">
            Gestão Inteligente de Ativos
          </p>

          <div className="mt-6 flex items-center gap-2 text-xs font-mono text-slate-400">
            <Loader2 className="animate-spin text-brand" size={16} />
            <span>{signingIn ? 'Entrando no sistema…' : 'Abrindo o sistema…'}</span>
          </div>
        </div>
      </main>
    );
  }

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (!resetEmail) return setResetError('Digite seu e-mail para recuperar.');

    try {
      setResetMessage('');
      setResetError('');
      setResetLoading(true);
      await resetPassword(resetEmail);
      setResetMessage('E-mail de recuperação enviado! Verifique sua caixa de entrada.');
      setTimeout(() => {
        setIsResetOpen(false);
        setResetMessage('');
      }, 5000);
    } catch (err) {
      console.error(err);
      setResetError(
        err?.code === 'auth/too-many-requests'
          ? 'Muitas solicitações. Tente novamente em alguns minutos.'
          : 'Falha ao enviar e-mail. Verifique se o endereço está correto.',
      );
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-950 p-4 font-sans text-slate-100">
      <div className="w-full max-w-sm">
        {/* Card Operacional Principal */}
        <div className="bg-slate-900 border border-slate-800/90 p-8 rounded-xl shadow-xl">
          {/* Cabeçalho */}
          <div className="flex flex-col items-center text-center mb-6">
            <div className="w-12 h-12 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-center p-2 mb-3 shadow-inner">
              <Logo size="md" showText={false} />
            </div>
            <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-1.5">
              Nexus <span className="text-brand">ITAM</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1">Acesso à plataforma operacional</p>

            {isGatewayOnly && (
              <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-mono font-bold text-emerald-400">
                <Server size={11} />
                <span>Modo Cluster VPS • PostgreSQL 16</span>
              </div>
            )}
          </div>

          {error && (
            <div role="alert" className="bg-rose-500/10 border border-rose-500/30 text-rose-300 p-3 rounded-lg mb-5 text-xs font-semibold flex items-center gap-2">
              <AlertCircle size={16} className="shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="login-email" className="block text-xs font-semibold text-slate-300">
                  E-mail corporativo
                </label>
                <button
                  type="button"
                  onClick={handleFillDemoAdmin}
                  className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-brand font-medium transition-colors"
                  title="Preencher com a conta de demonstração Nexus Corp"
                >
                  <Sparkles size={11} />
                  <span>Demo Admin</span>
                </button>
              </div>
              <div className="relative">
                <Mail className="absolute left-3 top-3 text-slate-500" size={16} />
                <input
                  id="login-email"
                  type="email"
                  required
                  autoComplete="username"
                  className="w-full pl-9 pr-3 py-2.5 bg-slate-950 border border-slate-800 rounded-lg focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand text-white text-sm placeholder-slate-600 transition-colors"
                  placeholder="acesso@nexusitam.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="login-password" className="text-xs font-semibold text-slate-300">
                  Senha
                </label>
                <button
                  type="button"
                  onClick={() => { setResetEmail(email); setResetError(''); setIsResetOpen(true); }}
                  className="text-xs text-slate-400 hover:text-brand font-medium transition-colors"
                >
                  Esqueceu a senha?
                </button>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-3 text-slate-500" size={16} />
                <input
                  id="login-password"
                  type="password"
                  required
                  autoComplete="current-password"
                  className="w-full pl-9 pr-3 py-2.5 bg-slate-950 border border-slate-800 rounded-lg focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand text-white text-sm placeholder-slate-600 transition-colors"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={signingIn}
                className="w-full bg-brand hover:bg-brand-dark text-white font-semibold py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 text-sm shadow-sm disabled:opacity-60"
              >
                {signingIn ? (
                  <Loader2 className="animate-spin text-white" size={16} />
                ) : (
                  <>
                    <span>Autenticar</span>
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            </div>
          </form>

          <div className="mt-6 pt-5 border-t border-slate-800 flex items-center justify-between text-xs">
            <span className="text-slate-400">Nova empresa?</span>
            <Link
              to="/register"
              className="text-brand hover:text-white font-semibold transition-colors"
            >
              Criar conta
            </Link>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-center">
            <a
              href={portalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-slate-200 transition-colors"
            >
              <span>Portal do Colaborador (Vue 3)</span>
              <ExternalLink size={12} />
            </a>
          </div>
        </div>

        <div className="mt-6 text-center text-xs text-slate-500">
          Nexus ITAM · {new Date().getFullYear()}
        </div>
      </div>

      {/* Modal de Redefinição de Senha */}
      {isResetOpen && (
        <div
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in"
          onClick={(e) => { if (e.target === e.currentTarget) setIsResetOpen(false); }}
        >
          <div className="bg-slate-900 border border-slate-800 w-full max-w-sm rounded-xl shadow-2xl p-6 relative">
            <button
              type="button"
              aria-label="Fechar"
              onClick={() => setIsResetOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors p-1 rounded-md"
            >
              <X size={18} />
            </button>

            <div className="mb-5 text-center">
              <div className="w-10 h-10 bg-brand/10 text-brand rounded-lg flex items-center justify-center mx-auto mb-3">
                <KeyRound size={20} />
              </div>
              <h3 className="font-bold text-white text-base">Redefinir Senha</h3>
              <p className="text-xs text-slate-400 mt-1">Informe seu e-mail para receber o link de recuperação.</p>
            </div>

            {resetError && (
              <div role="alert" className="bg-rose-500/10 border border-rose-500/30 text-rose-300 p-3 rounded-lg mb-4 text-xs font-semibold flex items-center gap-2">
                <AlertCircle size={15} className="shrink-0 text-rose-400" />
                <span>{resetError}</span>
              </div>
            )}

            {resetMessage ? (
              <div className="bg-emerald-500/10 text-emerald-300 p-4 rounded-lg text-center mb-4 border border-emerald-500/30 flex flex-col items-center gap-2">
                <CheckCircle size={22} className="text-emerald-400" />
                <p className="text-xs font-semibold">{resetMessage}</p>
              </div>
            ) : (
              <form onSubmit={handleResetPassword} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">E-mail cadastrado</label>
                  <input
                    type="email"
                    required
                    className="w-full p-2.5 bg-slate-950 border border-slate-800 rounded-lg focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand text-sm text-white placeholder-slate-600"
                    placeholder="usuario@nexusitam.com"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                  />
                </div>
                <button
                  type="submit"
                  disabled={resetLoading}
                  className="w-full bg-brand hover:bg-brand-dark text-white font-semibold py-2.5 rounded-lg transition-colors text-xs disabled:opacity-60"
                >
                  {resetLoading ? 'Enviando...' : 'Enviar link de recuperação'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </main>
  );
};

export default Login;
