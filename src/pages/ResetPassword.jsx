// src/pages/ResetPassword.jsx
import React, { useEffect, useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  ShieldCheck,
} from 'lucide-react';
import { confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth';
import { auth } from '../services/firebase';
import Logo from '../components/Logo';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // O Firebase pode enviar o codigo como `oobCode` e o modo como `mode`
  const oobCode = searchParams.get('oobCode') || '';
  const mode = searchParams.get('mode') || 'resetPassword';

  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('verifying'); // 'verifying' | 'ready' | 'success' | 'error'
  const [errorMessage, setErrorMessage] = useState('');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // 1. Valida o oobCode com o Firebase Authentication
  useEffect(() => {
    if (!oobCode) {
      setStatus('error');
      setErrorMessage('Link de redefinição incompleto ou inválido. O código de segurança não foi informado.');
      return;
    }

    if (mode !== 'resetPassword') {
      setStatus('error');
      setErrorMessage(`Operação "${mode}" não suportada nesta tela.`);
      return;
    }

    setStatus('verifying');
    verifyPasswordResetCode(auth, oobCode)
      .then((accountEmail) => {
        setEmail(accountEmail || '');
        setStatus('ready');
      })
      .catch((err) => {
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
  }, [oobCode, mode]);

  // Calculo de forca da senha
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
      ? 1 // Fraca
      : passedCriteriaCount <= 3
      ? 2 // Media
      : 3; // Forte

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!password) {
      setErrorMessage('Digite uma nova senha.');
      return;
    }
    if (password.length < 6) {
      setErrorMessage('A nova senha deve ter no mínimo 6 caracteres.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage('As senhas digitadas não coincidem.');
      return;
    }

    try {
      setSubmitting(true);
      setErrorMessage('');
      await confirmPasswordReset(auth, oobCode, password);
      setStatus('success');
    } catch (err) {
      console.error('Erro ao redefinir senha:', err);
      if (err?.code === 'auth/expired-action-code') {
        setErrorMessage('O tempo deste link expirou durante o preenchimento. Solicite um novo link.');
      } else if (err?.code === 'auth/weak-password') {
        setErrorMessage('A senha informada é considerada muito fraca pelo sistema.');
      } else {
        setErrorMessage(err?.message || 'Falha ao redefinir senha. Tente novamente.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#0a0a0c] p-4 relative overflow-hidden font-sans">
      {/* Background Animado */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[30%] -right-[10%] w-[70vw] h-[70vw] rounded-full bg-brand/10 blur-[120px]" />
        <div className="absolute -bottom-[30%] -left-[10%] w-[60vw] h-[60vw] rounded-full bg-cyan-600/10 blur-[100px]" />
        <div className="absolute inset-0 bg-[url('/carbon-fibre.png')] opacity-5 mix-blend-overlay" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Card Glassmorphic */}
        <div className="backdrop-blur-2xl bg-white/[0.03] border border-white/10 p-8 rounded-[2rem] shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] relative overflow-hidden">
          {/* Brilho Superior */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-brand to-transparent opacity-50" />

          {/* Logo e Cabecalho */}
          <div className="flex flex-col items-center mb-6 relative">
            <div className="absolute -top-4 -z-10 w-24 h-24 bg-brand/20 blur-2xl rounded-full" />
            <Logo size="lg" showText={false} className="drop-shadow-[0_0_15px_rgba(79,70,229,0.5)]" />
            <h1 className="text-2xl font-black text-white uppercase tracking-tight mt-4 flex items-center gap-2">
              Nexus <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand to-cyan-400">ITAM</span>
            </h1>
            <p className="text-[11px] font-bold text-gray-400 mt-1 tracking-widest uppercase">
              Redefinição de Senha
            </p>
          </div>

          {/* ESTADO 1: VERIFICANDO O CODIGO DO LINK */}
          {status === 'verifying' && (
            <div className="text-center py-8 space-y-4">
              <div className="w-12 h-12 border-3 border-brand border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-sm font-medium text-gray-300">
                Verificando link de segurança...
              </p>
              <p className="text-xs text-gray-500">
                Aguarde enquanto autenticamos sua solicitação.
              </p>
            </div>
          )}

          {/* ESTADO 2: LINK EXPIRADO OU INVALIDO */}
          {status === 'error' && (
            <div className="space-y-6 text-center py-2">
              <div className="w-14 h-14 rounded-2xl bg-red-500/15 border border-red-500/30 text-red-400 flex items-center justify-center mx-auto">
                <AlertCircle size={28} />
              </div>
              <div className="space-y-2">
                <h2 className="text-lg font-bold text-white">
                  Link Indisponível
                </h2>
                <p className="text-xs text-gray-400 leading-relaxed">
                  {errorMessage || 'Não foi possível validar este link de redefinição de senha.'}
                </p>
              </div>
              <div className="pt-2">
                <Link
                  to="/"
                  className="inline-flex items-center justify-center gap-2 w-full py-3.5 bg-gradient-to-r from-brand to-indigo-600 hover:from-brand/90 hover:to-indigo-500 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all shadow-lg shadow-brand/20 active:scale-95"
                >
                  <ArrowLeft size={16} /> Voltar para o Login
                </Link>
              </div>
            </div>
          )}

          {/* ESTADO 3: FORMULARIO DE NOVA SENHA */}
          {status === 'ready' && (
            <form onSubmit={handleSubmit} className="space-y-5">
              {email && (
                <div className="flex items-center gap-2.5 p-3 rounded-xl bg-white/[0.04] border border-white/10 text-xs text-gray-300">
                  <Mail size={16} className="text-cyan-400 shrink-0" />
                  <div className="truncate">
                    <span className="text-[10px] uppercase font-bold text-gray-500 block">Conta Identificada</span>
                    <strong className="text-white font-mono">{email}</strong>
                  </div>
                </div>
              )}

              {errorMessage && (
                <div role="alert" className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-xl text-xs font-bold flex items-center gap-2">
                  <AlertCircle size={16} className="shrink-0" /> {errorMessage}
                </div>
              )}

              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 ml-1">
                  Nova Senha
                </label>
                <div className="relative group">
                  <Lock className="absolute left-4 top-3.5 text-gray-500 group-focus-within:text-brand transition-colors" size={18} />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Mínimo de 6 caracteres"
                    className="w-full pl-12 pr-12 py-3 bg-black/40 border border-white/10 rounded-xl focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand font-medium text-white text-sm placeholder-gray-600 shadow-inner"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-4 top-3.5 text-gray-500 hover:text-gray-300"
                    title={showPassword ? 'Ocultar senha' : 'Ver senha'}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>

                {/* Barra de Forca da Senha */}
                {password.length > 0 && (
                  <div className="mt-2 space-y-1.5 px-1">
                    <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden flex gap-1">
                      <div
                        className={`h-full rounded-full transition-all ${
                          strengthLevel === 1
                            ? 'w-1/3 bg-red-500'
                            : strengthLevel === 2
                            ? 'w-2/3 bg-amber-400'
                            : 'w-full bg-emerald-400'
                        }`}
                      />
                    </div>
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="text-gray-400 font-semibold">Força da senha:</span>
                      <span
                        className={`font-bold uppercase tracking-wider ${
                          strengthLevel === 1
                            ? 'text-red-400'
                            : strengthLevel === 2
                            ? 'text-amber-400'
                            : 'text-emerald-400'
                        }`}
                      >
                        {strengthLevel === 1 ? 'Fraca' : strengthLevel === 2 ? 'Média' : 'Forte'}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 ml-1">
                  Confirmar Nova Senha
                </label>
                <div className="relative group">
                  <KeyRound className="absolute left-4 top-3.5 text-gray-500 group-focus-within:text-brand transition-colors" size={18} />
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repita a nova senha"
                    className="w-full pl-12 pr-12 py-3 bg-black/40 border border-white/10 rounded-xl focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand font-medium text-white text-sm placeholder-gray-600 shadow-inner"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((v) => !v)}
                    className="absolute right-4 top-3.5 text-gray-500 hover:text-gray-300"
                    title={showConfirmPassword ? 'Ocultar senha' : 'Ver senha'}
                  >
                    {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting || !password || password !== confirmPassword}
                className="w-full py-3.5 bg-gradient-to-r from-brand to-indigo-600 hover:from-brand/90 hover:to-indigo-500 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all shadow-lg shadow-brand/20 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Salvando...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck size={16} />
                    <span>Salvar Nova Senha</span>
                  </>
                )}
              </button>

              <div className="text-center pt-2">
                <Link
                  to="/"
                  className="text-xs text-gray-400 hover:text-white transition-colors inline-flex items-center gap-1.5"
                >
                  <ArrowLeft size={14} /> Cancelar e voltar ao login
                </Link>
              </div>
            </form>
          )}

          {/* ESTADO 4: SENHA REDEFINIDA COM SUCESSO */}
          {status === 'success' && (
            <div className="space-y-6 text-center py-3">
              <div className="w-16 h-16 rounded-3xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/10">
                <CheckCircle2 size={32} />
              </div>

              <div className="space-y-2">
                <h2 className="text-xl font-black text-white tracking-tight">
                  Senha Atualizada!
                </h2>
                <p className="text-xs text-gray-300 leading-relaxed max-w-xs mx-auto">
                  Sua nova senha de acesso já está ativa. Você já pode se autenticar normalmente no Nexus ITAM.
                </p>
              </div>

              <button
                type="button"
                onClick={() => navigate('/')}
                className="inline-flex items-center justify-center gap-2 w-full py-3.5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all shadow-lg shadow-emerald-500/20 active:scale-95"
              >
                Acessar o Sistema com a Nova Senha
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
