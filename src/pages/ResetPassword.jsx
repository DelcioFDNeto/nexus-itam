// src/pages/ResetPassword.jsx
import React, { useEffect, useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  Lock,
  Mail,
  ShieldCheck,
  Loader2,
} from 'lucide-react';
import { confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth';
import { auth } from '../services/firebase';
import Logo from '../components/Logo';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const oobCode = searchParams.get('oobCode') || '';
  const mode = searchParams.get('mode') || 'resetPassword';

  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('verifying'); // 'verifying' | 'ready' | 'success' | 'error'
  const [errorMessage, setErrorMessage] = useState('');
  const [fieldError, setFieldError] = useState(null);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setErrorMessage('');
    setFieldError(null);
    setEmail('');

    if (!oobCode) {
      setStatus('error');
      setErrorMessage('Link de redefinição incompleto ou inválido. O código de segurança não foi informado.');
      return undefined;
    }

    if (mode !== 'resetPassword') {
      setStatus('error');
      setErrorMessage(`Operação "${mode}" não suportada nesta tela.`);
      return undefined;
    }

    setStatus('verifying');
    verifyPasswordResetCode(auth, oobCode)
      .then((accountEmail) => {
        if (cancelled) return;
        setEmail(accountEmail || '');
        setStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Falha ao validar código de redefinição:', err);
        setStatus('error');
        if (err?.code === 'auth/expired-action-code') {
          setErrorMessage('Este link de redefinição já expirou. Por motivos de segurança, solicite um novo link.');
        } else if (err?.code === 'auth/invalid-action-code') {
          setErrorMessage('Este link de redefinição já foi utilizado ou é inválido.');
        } else {
          setErrorMessage('Não foi possível validar este link de redefinição. Tente solicitar novamente.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [oobCode, mode]);

  const passwordCriteria = {
    length: password.length >= 6,
    hasUpper: /[A-Z]/.test(password),
    hasNumber: /[0-9]/.test(password),
    hasSpecial: /[^A-Za-z0-9]/.test(password),
  };
  const passedCriteriaCount = Object.values(passwordCriteria).filter(Boolean).length;
  const strengthLevel =
    password.length === 0
      ? 0
      : passedCriteriaCount <= 1
      ? 1
      : passedCriteriaCount <= 3
      ? 2
      : 3;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFieldError(null);
    if (!password) {
      setFieldError('password');
      setErrorMessage('Digite uma nova senha.');
      return;
    }
    if (password.length < 6) {
      setFieldError('password');
      setErrorMessage('A nova senha deve ter no mínimo 6 caracteres.');
      return;
    }
    if (password !== confirmPassword) {
      setFieldError('confirmPassword');
      setErrorMessage('As senhas digitadas não coincidem.');
      return;
    }

    setSubmitting(true);
    setErrorMessage('');
    try {
      await confirmPasswordReset(auth, oobCode, password);
      setStatus('success');
    } catch (err) {
      console.error('Erro ao atualizar senha:', err);
      if (err?.code === 'auth/weak-password') {
        setFieldError('password');
        setErrorMessage('Senha fraca. Utilize uma combinação mais complexa com letras, números e símbolos.');
      } else if (err?.code === 'auth/expired-action-code') {
        setErrorMessage('O link expirou enquanto você preenchia o formulário. Solicite um novo link.');
      } else {
        setErrorMessage('Falha ao atualizar senha. Verifique sua conexão e tente novamente.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="dark min-h-screen flex items-center justify-center bg-[#09090b] p-4 font-sans text-[#fafafa]">
      <div className="w-full max-w-sm">
        <div className="bg-[#111113] border border-zinc-800 p-6 sm:p-8 rounded-xl shadow-xl">
          {/* Logo e Cabeçalho */}
          <div className="flex flex-col items-center text-center mb-6">
            <div className="w-12 h-12 rounded-lg bg-[#09090b] border border-zinc-800 flex items-center justify-center p-2 mb-3 shadow-inner">
              <Logo size="md" showText={false} />
            </div>
            <h1 className="text-xl font-bold text-[#fafafa] tracking-tight flex items-center gap-1.5">
              Nexus <span className="text-brand-aa">ITAM</span>
            </h1>
            <p className="text-xs text-zinc-400 mt-1">
              Redefinição de Senha
            </p>
          </div>

          {/* ESTADO 1: VERIFICANDO O CODIGO DO LINK */}
          {status === 'verifying' && (
            <div role="status" aria-live="polite" className="text-center py-8 space-y-3">
              <Loader2 aria-hidden="true" className="w-8 h-8 animate-spin text-brand-aa mx-auto" />
              <p className="text-sm font-medium text-zinc-200">
                Verificando link de segurança…
              </p>
              <p className="text-xs text-zinc-400">
                Aguarde enquanto autenticamos sua solicitação.
              </p>
            </div>
          )}

          {/* ESTADO 2: LINK EXPIRADO OU INVALIDO */}
          {status === 'error' && (
            <div role="alert" className="space-y-4 text-center py-2">
              <div className="w-12 h-12 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-center justify-center mx-auto" aria-hidden="true">
                <AlertCircle size={24} aria-hidden="true" />
              </div>
              <div className="space-y-1.5">
                <h2 className="text-base font-bold text-[#fafafa]">
                  Link Indisponível
                </h2>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  {errorMessage || 'Não foi possível validar este link de redefinição de senha.'}
                </p>
              </div>
              <div className="pt-2">
                <Link
                  to="/"
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 w-full py-2.5 px-4 bg-brand hover:bg-brand-dark text-brand-fg font-semibold text-xs rounded-lg transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-[#111113] shadow-sm"
                >
                  <ArrowLeft size={16} aria-hidden="true" /> Voltar para o Login
                </Link>
              </div>
            </div>
          )}

          {/* ESTADO 3: FORMULARIO DE NOVA SENHA */}
          {status === 'ready' && (
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              {email && (
                <div className="flex items-center gap-2.5 p-3 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-zinc-300">
                  <Mail size={16} aria-hidden="true" className="text-brand-aa shrink-0" />
                  <div className="min-w-0 truncate">
                    <span className="text-xs uppercase font-bold text-zinc-400 block">Conta Identificada</span>
                    <strong className="text-[#fafafa] font-mono">{email}</strong>
                  </div>
                </div>
              )}

              {errorMessage && (
                <div role="alert" className="bg-rose-500/10 border border-rose-500/30 text-rose-300 p-3 rounded-lg text-xs font-semibold flex items-center gap-2">
                  <AlertCircle size={16} aria-hidden="true" className="shrink-0 text-rose-400" />
                  <span>{errorMessage}</span>
                </div>
              )}

              <div>
                <label htmlFor="reset-password" className="block text-xs font-semibold text-zinc-300 mb-1.5">
                  Nova Senha
                </label>
                <div className="relative">
                  <Lock aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" size={16} />
                  <input
                    id="reset-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    autoComplete="new-password"
                    aria-invalid={fieldError === 'password'}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (fieldError === 'password') setFieldError(null);
                    }}
                    placeholder="Mínimo de 6 caracteres"
                    className="w-full min-h-[44px] pl-9 pr-12 py-2.5 bg-[#09090b] border border-zinc-800 rounded-lg font-medium text-[#fafafa] text-sm placeholder:text-zinc-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:border-brand aria-[invalid=true]:border-rose-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Ocultar nova senha' : 'Mostrar nova senha'}
                    aria-pressed={showPassword}
                    data-icon-button="true"
                    className="absolute right-0.5 top-1/2 -translate-y-1/2 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-zinc-400 hover:text-[#fafafa] active:scale-[0.98] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    {showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                  </button>
                </div>

                {/* Indicador de forca da senha */}
                {password && (
                  <div className="mt-2 space-y-1">
                    <div className="flex gap-1 h-1" aria-hidden="true">
                      <div className={`flex-1 rounded-full ${strengthLevel >= 1 ? (strengthLevel === 1 ? 'bg-rose-500' : strengthLevel === 2 ? 'bg-amber-500' : 'bg-emerald-500') : 'bg-zinc-800'}`} />
                      <div className={`flex-1 rounded-full ${strengthLevel >= 2 ? (strengthLevel === 2 ? 'bg-amber-500' : 'bg-emerald-500') : 'bg-zinc-800'}`} />
                      <div className={`flex-1 rounded-full ${strengthLevel >= 3 ? 'bg-emerald-500' : 'bg-zinc-800'}`} />
                    </div>
                    <div className="flex justify-between items-center text-xs text-zinc-400">
                      <span>Força da senha</span>
                      <span className={strengthLevel === 3 ? 'text-emerald-400 font-semibold' : strengthLevel === 2 ? 'text-amber-400' : 'text-rose-400'}>
                        {strengthLevel === 3 ? 'Forte' : strengthLevel === 2 ? 'Média' : 'Fraca'}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label htmlFor="reset-confirm-password" className="block text-xs font-semibold text-zinc-300 mb-1.5">
                  Confirmar Senha
                </label>
                <div className="relative">
                  <Lock aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" size={16} />
                  <input
                    id="reset-confirm-password"
                    name="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    autoComplete="new-password"
                    aria-invalid={fieldError === 'confirmPassword'}
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      if (fieldError === 'confirmPassword') setFieldError(null);
                    }}
                    placeholder="Repita a nova senha"
                    className="w-full min-h-[44px] pl-9 pr-12 py-2.5 bg-[#09090b] border border-zinc-800 rounded-lg font-medium text-[#fafafa] text-sm placeholder:text-zinc-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:border-brand aria-[invalid=true]:border-rose-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((v) => !v)}
                    aria-label={showConfirmPassword ? 'Ocultar confirmação de senha' : 'Mostrar confirmação de senha'}
                    aria-pressed={showConfirmPassword}
                    data-icon-button="true"
                    className="absolute right-0.5 top-1/2 -translate-y-1/2 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-zinc-400 hover:text-[#fafafa] active:scale-[0.98] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    {showConfirmPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                  </button>
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full min-h-[44px] py-2.5 px-4 bg-brand hover:bg-brand-dark text-brand-fg font-semibold text-sm rounded-lg transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-[#111113] shadow-sm disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {submitting ? (
                    <>
                      <Loader2 size={16} aria-hidden="true" className="animate-spin" />
                      <span>Salvando…</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck size={16} aria-hidden="true" />
                      <span>Salvar Nova Senha</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* ESTADO 4: SUCESSO */}
          {status === 'success' && (
            <div role="status" className="space-y-4 text-center py-2">
              <div className="w-12 h-12 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto" aria-hidden="true">
                <CheckCircle2 size={24} aria-hidden="true" />
              </div>
              <div className="space-y-1.5">
                <h2 className="text-base font-bold text-[#fafafa]">
                  Senha Atualizada!
                </h2>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Sua nova credencial foi registrada. Você já pode acessar o Nexus ITAM com a nova senha.
                </p>
              </div>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => navigate('/')}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 w-full py-2.5 px-4 bg-brand hover:bg-brand-dark text-brand-fg font-semibold text-sm rounded-lg transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-[#111113] shadow-sm"
                >
                  Ir para Login
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 text-center text-xs text-zinc-400">
          Nexus ITAM · {new Date().getFullYear()}
        </div>
      </div>
    </main>
  );
}
