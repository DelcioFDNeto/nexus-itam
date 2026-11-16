// src/pages/Login.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  Eye,
  EyeOff,
} from 'lucide-react';
import Logo from '../components/Logo';
import { resolvePortalUrl } from '../services/microservicesClient';
import { buildBrandedPortalUrl } from '../utils/portalBranding';
import { captureFocusTarget, restoreFocusSafely, trapFocusWithin } from '../utils/focusTrap';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState(null);
  const [signingIn, setSigningIn] = useState(false);

  const [isResetOpen, setIsResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetMessage, setResetMessage] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetFieldError, setResetFieldError] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  const resetModalRef = useRef(null);
  const resetInputRef = useRef(null);
  const previousFocusRef = useRef(null);
  const wasResetOpenRef = useRef(false);
  const resetTimerRef = useRef(null);
  const isMountedRef = useRef(true);

  const clearResetTimer = useCallback(() => {
    if (resetTimerRef.current !== null) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    isMountedRef.current = false;
    clearResetTimer();
  }, [clearResetTimer]);

  const { login, resetPassword, currentUser, loading: authLoading, isGatewayOnly = false } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const destination = location.state?.from && location.state.from !== '/' ? location.state.from : '/dashboard';

  const rawPortalUrl = resolvePortalUrl();
  const portalUrl = buildBrandedPortalUrl(rawPortalUrl, currentUser || {}) || rawPortalUrl;

  useEffect(() => {
    if (currentUser && !authLoading) navigate(destination, { replace: true });
  }, [currentUser, authLoading, navigate, destination]);

  const closeResetModal = useCallback(() => {
    clearResetTimer();
    setIsResetOpen(false);
    setResetMessage('');
    setResetError('');
    setResetFieldError(false);
  }, [clearResetTimer]);

  useEffect(() => {
    if (!isResetOpen) {
      if (wasResetOpenRef.current) {
        wasResetOpenRef.current = false;
        const previous = previousFocusRef.current;
        previousFocusRef.current = null;
        restoreFocusSafely(previous);
      }
      return undefined;
    }

    wasResetOpenRef.current = true;
    previousFocusRef.current = captureFocusTarget(resetModalRef.current);

    const focusTimer = setTimeout(() => {
      if (resetInputRef.current) {
        resetInputRef.current.focus();
      } else {
        resetModalRef.current?.focus();
      }
    }, 0);

    return () => clearTimeout(focusTimer);
  }, [isResetOpen]);

  useEffect(() => {
    if (!isResetOpen) return undefined;

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeResetModal();
        return;
      }
      if (event.key === 'Tab') {
        trapFocusWithin(event, resetModalRef.current);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isResetOpen, closeResetModal]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setFieldError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !EMAIL_PATTERN.test(trimmedEmail)) {
      setFieldError('email');
      setError('Informe um e-mail corporativo válido.');
      return;
    }
    if (!password) {
      setFieldError('password');
      setError('Informe sua senha.');
      return;
    }

    setSigningIn(true);
    if (destination === '/dashboard') import('./Dashboard').catch(() => {});
    try {
      await login(trimmedEmail, password);
    } catch (err) {
      console.error(err);
      setError(loginErrorMessage(err));
      setSigningIn(false);
    }
  };

  // Splashscreen de inicialização / validação de sessão
  if (authLoading || (signingIn && !error)) {
    return (
      <main className="dark min-h-screen flex items-center justify-center bg-[#09090b] p-4 font-sans text-[#fafafa]" aria-busy="true">
        <div className="flex flex-col items-center text-center max-w-sm px-6 animate-fade-in" role="status">
          <div className="w-14 h-14 rounded-xl bg-[#111113] border border-zinc-800 flex items-center justify-center shadow-lg p-2 mb-4">
            <Logo size="md" showText={false} />
          </div>

          <h1 className="text-xl font-bold text-[#fafafa] tracking-tight flex items-center justify-center gap-1.5">
            Nexus <span className="text-brand-aa">ITAM</span>
          </h1>
          <p className="text-xs text-zinc-400 mt-1 font-medium">
            Gestão Inteligente de Ativos
          </p>

          <div className="mt-6 flex items-center gap-2 text-xs font-mono text-zinc-400">
            <Loader2 aria-hidden="true" className="animate-spin text-brand-aa" size={16} />
            <span>{signingIn ? 'Entrando no sistema…' : 'Abrindo o sistema…'}</span>
          </div>
        </div>
      </main>
    );
  }

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setResetError('');
    setResetFieldError(false);

    const trimmedResetEmail = resetEmail.trim();
    if (!trimmedResetEmail || !EMAIL_PATTERN.test(trimmedResetEmail)) {
      setResetFieldError(true);
      setResetError('Informe um e-mail válido para recuperar.');
      return;
    }

    try {
      clearResetTimer();
      setResetMessage('');
      setResetLoading(true);
      await resetPassword(trimmedResetEmail);
      if (!isMountedRef.current) return;
      setResetMessage('E-mail de recuperação enviado! Verifique sua caixa de entrada.');
      resetTimerRef.current = setTimeout(() => {
        resetTimerRef.current = null;
        if (!isMountedRef.current) return;
        setIsResetOpen(false);
        setResetMessage('');
        setResetError('');
      }, 5000);
    } catch (err) {
      console.error(err);
      if (!isMountedRef.current) return;
      setResetError(
        err?.code === 'auth/too-many-requests'
          ? 'Muitas solicitações. Tente novamente em alguns minutos.'
          : 'Falha ao enviar e-mail. Verifique se o endereço está correto.',
      );
    } finally {
      if (isMountedRef.current) {
        setResetLoading(false);
      }
    }
  };

  return (
    <main className="dark min-h-screen flex items-center justify-center bg-[#09090b] p-4 font-sans text-[#fafafa]">
      <div className="w-full max-w-sm">
        {/* Card Operacional Principal */}
        <div className="bg-[#111113] border border-zinc-800 p-6 sm:p-8 rounded-xl shadow-xl">
          {/* Cabeçalho */}
          <div className="flex flex-col items-center text-center mb-6">
            <div className="w-12 h-12 rounded-lg bg-[#09090b] border border-zinc-800 flex items-center justify-center p-2 mb-3 shadow-inner">
              <Logo size="md" showText={false} />
            </div>
            <h1 className="text-xl font-bold text-[#fafafa] tracking-tight flex items-center gap-1.5">
              Nexus <span className="text-brand-aa">ITAM</span>
            </h1>
            <p className="text-xs text-zinc-400 mt-1">Acesso à plataforma operacional</p>

            {isGatewayOnly && (
              <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-mono font-bold text-emerald-400">
                <Server size={12} aria-hidden="true" />
                <span>Modo Cluster VPS • PostgreSQL 16</span>
              </div>
            )}
          </div>

          {error && (
            <div role="alert" className="bg-rose-500/10 border border-rose-500/30 text-rose-300 p-3 rounded-lg mb-5 text-xs font-semibold flex items-center gap-2">
              <AlertCircle size={16} aria-hidden="true" className="shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label htmlFor="login-email" className="block text-xs font-semibold text-zinc-300 mb-1.5">
                E-mail corporativo
              </label>
              <div className="relative">
                <Mail aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" size={16} />
                <input
                  id="login-email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  aria-invalid={fieldError === 'email' || Boolean(error && !fieldError)}
                  className="w-full min-h-[44px] pl-9 pr-3 py-2.5 bg-[#09090b] border border-zinc-800 rounded-lg text-[#fafafa] text-sm placeholder:text-zinc-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-text-dark focus-visible:border-brand-text-dark aria-[invalid=true]:border-rose-500"
                  placeholder="nome@empresa.com.br"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (fieldError === 'email') setFieldError(null);
                  }}
                />
              </div>
            </div>

            <div>
              <label htmlFor="login-password" className="block text-xs font-semibold text-zinc-300 mb-1.5">
                Senha
              </label>
              <div className="relative">
                <Lock aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" size={16} />
                <input
                  id="login-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  aria-invalid={fieldError === 'password' || Boolean(error && !fieldError)}
                  className="w-full min-h-[44px] pl-9 pr-12 py-2.5 bg-[#09090b] border border-zinc-800 rounded-lg text-[#fafafa] text-sm placeholder:text-zinc-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-text-dark focus-visible:border-brand-text-dark aria-[invalid=true]:border-rose-500"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (fieldError === 'password') setFieldError(null);
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  aria-pressed={showPassword}
                  data-icon-button="true"
                  className="absolute right-0.5 top-1/2 -translate-y-1/2 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-zinc-400 transition-colors hover:text-[#fafafa] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-text-dark"
                >
                  {showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                </button>
              </div>
              <div className="mt-1.5 flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    clearResetTimer();
                    setResetEmail(email);
                    setResetMessage('');
                    setResetError('');
                    setResetFieldError(false);
                    setIsResetOpen(true);
                  }}
                  className="inline-flex min-h-[44px] items-center rounded-lg px-2 text-xs font-semibold text-brand-aa transition-colors hover:underline active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-text-dark"
                >
                  Esqueceu a senha?
                </button>
              </div>
            </div>

            <div className="pt-1">
              <button
                type="submit"
                disabled={signingIn}
                className="w-full min-h-[44px] bg-brand hover:bg-brand-dark text-brand-fg font-semibold py-2.5 px-4 rounded-lg transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-text-dark focus-visible:ring-offset-2 focus-visible:ring-offset-[#111113] flex items-center justify-center gap-2 text-sm shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {signingIn ? (
                  <Loader2 aria-hidden="true" className="animate-spin text-current" size={16} />
                ) : (
                  <>
                    <span>Autenticar</span>
                    <ArrowRight size={16} aria-hidden="true" />
                  </>
                )}
              </button>
            </div>
          </form>

          <div className="mt-6 pt-4 border-t border-zinc-800 flex items-center justify-between text-xs">
            <span className="text-zinc-400">Nova empresa?</span>
            <Link
              to="/register"
              className="inline-flex min-h-[44px] items-center rounded-lg px-2 text-brand-aa hover:underline font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-text-dark"
            >
              Criar conta
            </Link>
          </div>

          <div className="mt-2 pt-2 border-t border-zinc-800/70 flex items-center justify-center">
            <a
              href={portalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-xs text-zinc-400 hover:text-[#fafafa] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-text-dark"
            >
              <span>Portal do Colaborador (Vue 3)</span>
              <ExternalLink size={13} aria-hidden="true" />
            </a>
          </div>
        </div>

        <div className="mt-6 text-center text-xs text-zinc-400">
          Nexus ITAM · {new Date().getFullYear()}
        </div>
      </div>

      {/* Modal de Redefinição de Senha */}
      {isResetOpen && (
        <div
          className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in"
          onMouseDown={(e) => { if (e.target === e.currentTarget) closeResetModal(); }}
        >
          <div
            ref={resetModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-modal-title"
            tabIndex={-1}
            className="bg-[#111113] border border-zinc-800 w-full max-w-sm max-h-[90vh] overflow-y-auto overscroll-contain rounded-xl shadow-2xl p-6 relative animate-zoom-in focus:outline-none"
          >
            <button
              type="button"
              aria-label="Fechar"
              data-icon-button="true"
              onClick={closeResetModal}
              className="absolute top-3 right-3 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-zinc-400 hover:bg-[#18181b] hover:text-[#fafafa] active:scale-[0.98] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-text-dark"
            >
              <X size={18} aria-hidden="true" />
            </button>

            <div className="mb-5 text-center">
              <div className="w-10 h-10 bg-brand/15 text-brand-aa rounded-lg flex items-center justify-center mx-auto mb-3" aria-hidden="true">
                <KeyRound size={20} aria-hidden="true" />
              </div>
              <h2 id="reset-modal-title" className="font-bold text-[#fafafa] text-base">
                Redefinir Senha
              </h2>
              <p className="text-xs text-zinc-400 mt-1">
                Informe seu e-mail para receber o link de recuperação.
              </p>
            </div>

            {resetError && (
              <div role="alert" className="bg-rose-500/10 border border-rose-500/30 text-rose-300 p-3 rounded-lg mb-4 text-xs font-semibold flex items-center gap-2">
                <AlertCircle size={15} aria-hidden="true" className="shrink-0 text-rose-400" />
                <span>{resetError}</span>
              </div>
            )}

            {resetMessage ? (
              <div role="status" className="bg-emerald-500/10 text-emerald-300 p-4 rounded-lg text-center mb-4 border border-emerald-500/30 flex flex-col items-center gap-2">
                <CheckCircle size={22} aria-hidden="true" className="text-emerald-400" />
                <p className="text-xs font-semibold">{resetMessage}</p>
              </div>
            ) : (
              <form onSubmit={handleResetPassword} className="space-y-4" noValidate>
                <div>
                  <label htmlFor="reset-email" className="block text-xs font-semibold text-zinc-300 mb-1.5">
                    E-mail cadastrado
                  </label>
                  <input
                    ref={resetInputRef}
                    id="reset-email"
                    name="resetEmail"
                    type="email"
                    required
                    autoComplete="email"
                    aria-invalid={resetFieldError || Boolean(resetError)}
                    className="w-full min-h-[44px] px-3 py-2.5 bg-[#09090b] border border-zinc-800 rounded-lg text-sm text-[#fafafa] placeholder:text-zinc-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-text-dark focus-visible:border-brand-text-dark aria-[invalid=true]:border-rose-500"
                    placeholder="nome@empresa.com.br"
                    value={resetEmail}
                    onChange={(e) => {
                      setResetEmail(e.target.value);
                      if (resetFieldError) setResetFieldError(false);
                    }}
                  />
                </div>
                <button
                  type="submit"
                  disabled={resetLoading}
                  className="w-full min-h-[44px] bg-brand hover:bg-brand-dark text-brand-fg font-semibold py-2.5 px-4 rounded-lg transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-text-dark focus-visible:ring-offset-2 focus-visible:ring-offset-[#111113] text-xs disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {resetLoading ? 'Enviando…' : 'Enviar link de recuperação'}
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
