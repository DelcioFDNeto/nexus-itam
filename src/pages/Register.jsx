// src/pages/Register.jsx
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  Building2,
  User,
  Mail,
  Lock,
  ArrowRight,
  AlertCircle,
  ShieldCheck,
  Loader2,
  Eye,
  EyeOff,
} from 'lucide-react';
import Logo from '../components/Logo';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const Register = () => {
  const [companyName, setCompanyName] = useState('');
  const [adminName, setAdminName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const { registerTenant } = useAuth();
  const navigate = useNavigate();
  const navTimerRef = useRef(null);
  const isMountedRef = useRef(true);

  useEffect(() => () => {
    isMountedRef.current = false;
    if (navTimerRef.current !== null) {
      clearTimeout(navTimerRef.current);
      navTimerRef.current = null;
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setFieldError(null);

    if (!companyName.trim()) {
      setFieldError('companyName');
      return setError('Informe o nome da empresa.');
    }
    if (!adminName.trim()) {
      setFieldError('adminName');
      return setError('Informe o nome do administrador responsável.');
    }
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !EMAIL_PATTERN.test(trimmedEmail)) {
      setFieldError('email');
      return setError('Informe um e-mail corporativo válido.');
    }
    if (password.length < 8) {
      setFieldError('password');
      return setError('A senha deve conter no mínimo 8 caracteres.');
    }
    if (password !== confirmPassword) {
      setFieldError('confirmPassword');
      return setError('As senhas digitadas não coincidem.');
    }

    try {
      setLoading(true);
      await registerTenant(companyName.trim(), adminName.trim(), trimmedEmail, password);
      if (!isMountedRef.current) return;
      setSuccess(true);
      if (navTimerRef.current !== null) {
        clearTimeout(navTimerRef.current);
      }
      navTimerRef.current = setTimeout(() => {
        navTimerRef.current = null;
        if (isMountedRef.current) {
          navigate('/dashboard', { replace: true });
        }
      }, 1500);
    } catch (err) {
      console.error(err);
      if (!isMountedRef.current) return;
      const messages = {
        'auth/email-already-in-use': 'Este e-mail já possui uma conta. Faça login ou use outro endereço.',
        'auth/invalid-email': 'E-mail inválido.',
        'auth/weak-password': 'Senha fraca: use pelo menos 8 caracteres, com letras e números.',
        'auth/network-request-failed': 'Sem conexão com o servidor. Verifique sua internet.',
        'auth/too-many-requests': 'Muitas tentativas seguidas. Aguarde alguns minutos.',
      };
      setError(messages[err.code] || 'Não foi possível criar a empresa agora. Tente novamente em instantes.');
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  };

  const calculatePasswordStrength = (pass) => {
    let strength = 0;
    if (pass.length >= 8) strength += 25;
    if (pass.length >= 12) strength += 25;
    if (pass.match(/[A-Z]/)) strength += 25;
    if (pass.match(/[0-9]/) || pass.match(/[^A-Za-z0-9]/)) strength += 25;
    return strength;
  };

  const pwdStrength = calculatePasswordStrength(password);

  if (success) {
    return (
      <main className="dark min-h-screen flex items-center justify-center bg-[#09090b] p-4 font-sans text-[#fafafa]">
        <div role="status" className="bg-[#111113] border border-zinc-800 p-8 rounded-xl max-w-md w-full text-center shadow-xl animate-fade-in">
          <div className="w-14 h-14 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-xl flex items-center justify-center mx-auto mb-4" aria-hidden="true">
            <ShieldCheck size={28} aria-hidden="true" />
          </div>

          <h1 className="text-xl font-bold text-[#fafafa] mb-2">Conta Criada com Sucesso</h1>
          <p className="text-xs text-zinc-300 leading-relaxed">
            A organização <strong className="text-[#fafafa]">{companyName}</strong> foi inicializada. Você já pode acessar o painel e gerenciar seu inventário.
          </p>
          <div className="mt-6 flex items-center justify-center gap-2 text-xs text-zinc-400 font-mono">
            <Loader2 aria-hidden="true" className="animate-spin text-brand-aa" size={16} />
            <span>Redirecionando para o painel…</span>
          </div>
        </div>
      </main>
    );
  }

  const inputBaseClass =
    'w-full min-h-[44px] pl-9 py-2.5 bg-[#09090b] border border-zinc-800 rounded-lg text-[#fafafa] text-sm placeholder:text-zinc-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:border-brand aria-[invalid=true]:border-rose-500';

  return (
    <main className="dark min-h-screen flex items-center justify-center bg-[#09090b] p-4 font-sans text-[#fafafa] py-10">
      <div className="w-full max-w-lg">
        <div className="bg-[#111113] border border-zinc-800 p-6 sm:p-8 md:p-10 rounded-xl shadow-xl">
          {/* Cabeçalho */}
          <div className="text-center mb-6">
            <div className="w-12 h-12 rounded-lg bg-[#09090b] border border-zinc-800 flex items-center justify-center p-2 mx-auto mb-3 shadow-inner">
              <Logo size="md" showText={false} />
            </div>
            <h1 className="text-xl font-bold text-[#fafafa] tracking-tight">
              Criar Conta Corporativa
            </h1>
            <p className="text-xs text-zinc-400 mt-1">
              Cadastre sua organização para iniciar a gestão de ativos
            </p>
          </div>

          {error && (
            <div role="alert" className="bg-rose-500/10 border border-rose-500/30 text-rose-300 p-3 rounded-lg mb-5 text-xs font-semibold flex items-center gap-2">
              <AlertCircle size={16} aria-hidden="true" className="shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="register-company" className="block text-xs font-semibold text-zinc-300 mb-1.5">
                  Nome da Empresa / Razão Social
                </label>
                <div className="relative">
                  <Building2 aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" size={16} />
                  <input
                    id="register-company"
                    name="companyName"
                    type="text"
                    required
                    autoComplete="organization"
                    aria-invalid={fieldError === 'companyName'}
                    className={`${inputBaseClass} pr-3`}
                    placeholder="Ex: Nexus Corp"
                    value={companyName}
                    onChange={(e) => {
                      setCompanyName(e.target.value);
                      if (fieldError === 'companyName') setFieldError(null);
                    }}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="register-admin" className="block text-xs font-semibold text-zinc-300 mb-1.5">
                  Administrador Responsável
                </label>
                <div className="relative">
                  <User aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" size={16} />
                  <input
                    id="register-admin"
                    name="adminName"
                    type="text"
                    required
                    autoComplete="name"
                    aria-invalid={fieldError === 'adminName'}
                    className={`${inputBaseClass} pr-3`}
                    placeholder="Nome completo"
                    value={adminName}
                    onChange={(e) => {
                      setAdminName(e.target.value);
                      if (fieldError === 'adminName') setFieldError(null);
                    }}
                  />
                </div>
              </div>
            </div>

            <div>
              <label htmlFor="register-email" className="block text-xs font-semibold text-zinc-300 mb-1.5">
                E-mail Corporativo
              </label>
              <div className="relative">
                <Mail aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" size={16} />
                <input
                  id="register-email"
                  name="email"
                  type="email"
                  required
                  autoComplete="username"
                  aria-invalid={fieldError === 'email'}
                  className={`${inputBaseClass} pr-3`}
                  placeholder="nome@empresa.com.br"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (fieldError === 'email') setFieldError(null);
                  }}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="flex justify-between items-center mb-1.5 gap-2">
                  <label htmlFor="register-password" className="text-xs font-semibold text-zinc-300">
                    Senha
                  </label>
                  {password.length > 0 && (
                    <span
                      className={`text-xs font-semibold ${
                        password.length < 8
                          ? 'text-amber-400'
                          : pwdStrength > 50
                            ? 'text-emerald-400'
                            : 'text-zinc-300'
                      }`}
                    >
                      {password.length < 8 ? 'Mín. 8 caracteres' : pwdStrength > 50 ? 'Forte' : 'Média'}
                    </span>
                  )}
                </div>
                <div className="relative">
                  <Lock aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" size={16} />
                  <input
                    id="register-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="new-password"
                    aria-invalid={fieldError === 'password'}
                    className={`${inputBaseClass} pr-12`}
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
                    className="absolute right-0.5 top-1/2 -translate-y-1/2 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-zinc-400 transition-colors hover:text-[#fafafa] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    {showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="register-confirm-password" className="block text-xs font-semibold text-zinc-300 mb-1.5">
                  Confirmar Senha
                </label>
                <div className="relative">
                  <ShieldCheck aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" size={16} />
                  <input
                    id="register-confirm-password"
                    name="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    required
                    autoComplete="new-password"
                    aria-invalid={fieldError === 'confirmPassword'}
                    className={`${inputBaseClass} pr-12`}
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      if (fieldError === 'confirmPassword') setFieldError(null);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((prev) => !prev)}
                    aria-label={showConfirmPassword ? 'Ocultar confirmação de senha' : 'Mostrar confirmação de senha'}
                    aria-pressed={showConfirmPassword}
                    data-icon-button="true"
                    className="absolute right-0.5 top-1/2 -translate-y-1/2 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-zinc-400 transition-colors hover:text-[#fafafa] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    {showConfirmPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={loading}
                className="w-full min-h-[44px] bg-brand hover:bg-brand-dark text-brand-fg font-semibold py-2.5 px-4 rounded-lg transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-[#111113] flex items-center justify-center gap-2 text-sm shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <Loader2 aria-hidden="true" className="animate-spin text-current" size={16} />
                ) : (
                  <>
                    <span>Criar Conta Corporativa</span>
                    <ArrowRight size={16} aria-hidden="true" />
                  </>
                )}
              </button>
            </div>
          </form>

          <div className="mt-6 pt-4 border-t border-zinc-800 flex items-center justify-center text-xs text-zinc-400">
            <span>Já possui uma conta?</span>
            <Link
              to="/"
              className="ml-1 inline-flex min-h-[44px] items-center rounded-lg px-2 text-brand-aa hover:underline font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              Fazer Login
            </Link>
          </div>
        </div>

        <div className="mt-6 text-center text-xs text-zinc-400">
          Nexus ITAM · {new Date().getFullYear()}
        </div>
      </div>
    </main>
  );
};

export default Register;
