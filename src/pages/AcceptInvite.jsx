// src/pages/AcceptInvite.jsx
// -----------------------------------------------------------------------------
// Aceite de convite. Antes o "convite" era so um documento no banco: a tela
// dizia que o membro receberia um e-mail, mas nenhum e-mail era enviado e nao
// existia fluxo de entrada — nenhuma empresa conseguia ter um segundo usuario.
//
// Agora o administrador copia/compartilha o link /convite/{id}; aqui o
// convidado cria a conta (ou entra com uma existente) e o perfil nasce
// consumindo o convite, exatamente como as regras do Firestore exigem.
// -----------------------------------------------------------------------------
import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import {
  AlertCircle,
  ArrowRight,
  Building2,
  CheckCircle,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  LogOut,
  Mail,
  User,
} from 'lucide-react';
import { auth } from '../services/firebase';
import { useAuth } from '../contexts/AuthContext';
import { hasValidTenant } from '../utils/permissions';
import { describeFirebaseError } from '../services/tenantService';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const INVITE_TABS = [
  ['signup', 'Criar conta'],
  ['login', 'Já tenho conta'],
];

const inputClass =
  'w-full min-h-[44px] pl-10 py-2.5 bg-[#09090b] border border-zinc-800 rounded-xl font-medium text-[#fafafa] text-sm placeholder:text-zinc-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:border-brand aria-[invalid=true]:border-rose-500';

const Field = ({ icon: Icon, label, id, name, type = 'text', invalid = false, ...props }) => {
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === 'password';
  const effectiveType = isPassword && revealed ? 'text' : type;

  return (
    <div>
      <label htmlFor={id} className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-1.5 ml-0.5">
        {label}
      </label>
      <div className="relative group">
        <Icon
          aria-hidden="true"
          className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-brand-aa transition-colors pointer-events-none"
          size={17}
        />
        <input
          id={id}
          name={name || id}
          type={effectiveType}
          aria-invalid={invalid}
          className={`${inputClass} ${isPassword ? 'pr-12' : 'pr-3.5'}`}
          {...props}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setRevealed((prev) => !prev)}
            aria-label={revealed ? `Ocultar ${label.toLowerCase()}` : `Mostrar ${label.toLowerCase()}`}
            aria-pressed={revealed}
            data-icon-button="true"
            className="absolute right-0.5 top-1/2 -translate-y-1/2 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-zinc-400 transition-colors hover:text-[#fafafa] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            {revealed ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
          </button>
        )}
      </div>
    </div>
  );
};

const AcceptInvite = () => {
  const { inviteId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { currentUser, loading, login, logout, acceptInvite } = useAuth();

  // Nome da empresa e e-mail vem no link apenas para exibicao; quem decide
  // empresa e papel e o documento do convite, lido depois da autenticacao.
  const companyHint = searchParams.get('empresa') || '';
  const [mode, setMode] = useState('signup'); // 'signup' | 'login'
  const [name, setName] = useState('');
  const [email, setEmail] = useState(searchParams.get('email') || '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState(null);
  const [done, setDone] = useState(false);

  const navTimerRef = useRef(null);
  const isMountedRef = useRef(true);
  const tabRefs = useRef({});

  useEffect(() => () => {
    isMountedRef.current = false;
    if (navTimerRef.current !== null) {
      clearTimeout(navTimerRef.current);
      navTimerRef.current = null;
    }
  }, []);

  const finish = async (displayName) => {
    await acceptInvite(inviteId, displayName);
    if (!isMountedRef.current) return;
    setDone(true);
    if (navTimerRef.current !== null) {
      clearTimeout(navTimerRef.current);
    }
    navTimerRef.current = setTimeout(() => {
      navTimerRef.current = null;
      if (isMountedRef.current) {
        navigate('/dashboard', { replace: true });
      }
    }, 1200);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setFieldError(null);

    const trimmedEmail = email.trim().toLowerCase();

    if (mode === 'signup') {
      if (!name.trim()) {
        setFieldError('name');
        return setError('Informe seu nome.');
      }
      if (!trimmedEmail || !EMAIL_PATTERN.test(trimmedEmail)) {
        setFieldError('email');
        return setError('Informe um e-mail válido.');
      }
      if (password.length < 8) {
        setFieldError('password');
        return setError('A senha deve ter pelo menos 8 caracteres.');
      }
      if (password !== confirm) {
        setFieldError('confirm');
        return setError('As senhas não coincidem.');
      }
    } else {
      if (!trimmedEmail || !EMAIL_PATTERN.test(trimmedEmail)) {
        setFieldError('email');
        return setError('Informe um e-mail válido.');
      }
      if (!password) {
        setFieldError('password');
        return setError('Informe sua senha.');
      }
    }

    setWorking(true);
    try {
      if (mode === 'signup') {
        await createUserWithEmailAndPassword(auth, trimmedEmail, password);
      } else {
        await login(trimmedEmail, password);
      }
      await finish(name);
    } catch (err) {
      console.error(err);
      if (err?.code === 'auth/email-already-in-use') {
        setMode('login');
        setError('Este e-mail já tem conta. Entre com a sua senha para aceitar o convite.');
      } else if (err?.code?.startsWith?.('auth/')) {
        setError(describeFirebaseError(err));
      } else {
        setError(err?.message || 'Não foi possível aceitar o convite.');
      }
    } finally {
      setWorking(false);
    }
  };

  const handleAcceptLogged = async () => {
    setError('');
    setWorking(true);
    try {
      await finish(name || currentUser?.name);
    } catch (err) {
      console.error(err);
      setError(err?.message || 'Não foi possível aceitar o convite.');
    } finally {
      setWorking(false);
    }
  };

  const handleSwitchAccount = async () => {
    setError('');
    try {
      await logout();
    } catch (err) {
      console.error('Erro ao encerrar sessão para trocar de conta:', err);
      if (isMountedRef.current) {
        setError(err?.message || 'Não foi possível encerrar a sessão atual.');
      }
    }
  };

  const handleTabKeyDown = (event, currentIndex) => {
    let nextIndex = null;
    if (event.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % INVITE_TABS.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + INVITE_TABS.length) % INVITE_TABS.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = INVITE_TABS.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    const [nextMode] = INVITE_TABS[nextIndex];
    setMode(nextMode);
    setError('');
    setFieldError(null);
    tabRefs.current[nextMode]?.focus();
  };

  const alreadyMember = !done && !working && currentUser && hasValidTenant(currentUser);
  const loggedWithoutTenant = !done && currentUser && !hasValidTenant(currentUser);

  let body;
  if (done) {
    body = (
      <div role="status" className="text-center py-6">
        <div className="w-16 h-16 bg-emerald-500/15 border border-emerald-500/40 rounded-full flex items-center justify-center mx-auto mb-4" aria-hidden="true">
          <CheckCircle size={32} aria-hidden="true" className="text-emerald-400" />
        </div>
        <p className="text-[#fafafa] font-black text-lg">Convite aceito!</p>
        <p className="text-sm text-zinc-400 mt-1">Abrindo o painel da empresa…</p>
      </div>
    );
  } else if (loading) {
    body = (
      <div role="status" aria-label="Carregando convite" className="flex justify-center py-10">
        <Loader2 aria-hidden="true" className="animate-spin text-brand-aa" size={28} />
      </div>
    );
  } else if (alreadyMember) {
    body = (
      <div className="space-y-4 text-center">
        <p className="text-sm text-zinc-300">
          Você já está conectado como <strong className="text-[#fafafa]">{currentUser.email}</strong>, que pertence a{' '}
          <strong className="text-[#fafafa]">{currentUser.companyName}</strong>. Cada conta participa de uma única empresa.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            to="/dashboard"
            className="inline-flex min-h-[44px] items-center justify-center px-5 py-2.5 rounded-xl bg-brand hover:bg-brand-dark text-brand-fg font-bold text-xs uppercase tracking-wider transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-[#111113]"
          >
            Ir para o painel
          </Link>
          <button
            type="button"
            onClick={handleSwitchAccount}
            className="min-h-[44px] px-5 py-2.5 rounded-xl border border-zinc-700 bg-[#18181b] hover:bg-zinc-800 text-[#fafafa] font-bold text-xs uppercase tracking-wider inline-flex items-center justify-center gap-2 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <LogOut size={14} aria-hidden="true" /> Usar outra conta
          </button>
        </div>
      </div>
    );
  } else if (loggedWithoutTenant) {
    body = (
      <div className="space-y-4">
        <p className="text-sm text-zinc-300 text-center">
          Aceitar o convite como <strong className="text-[#fafafa]">{currentUser.email}</strong>?
        </p>
        <Field
          id="invite-name"
          name="name"
          icon={User}
          label="Seu nome"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={currentUser.name || 'Nome completo'}
          autoComplete="name"
        />
        <button
          type="button"
          onClick={handleAcceptLogged}
          disabled={working}
          className="w-full min-h-[44px] bg-brand hover:bg-brand-dark text-brand-fg font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 text-sm uppercase tracking-wider transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-[#111113] disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {working ? <Loader2 aria-hidden="true" className="animate-spin text-current" size={18} /> : <>Aceitar convite <ArrowRight size={18} aria-hidden="true" /></>}
        </button>
        <button
          type="button"
          onClick={handleSwitchAccount}
          className="w-full min-h-[44px] text-xs text-zinc-400 hover:text-[#fafafa] font-semibold rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          Não é você? Usar outra conta
        </button>
      </div>
    );
  } else {
    body = (
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="grid grid-cols-2 gap-2 p-1 bg-[#09090b] rounded-xl border border-zinc-800" role="tablist" aria-label="Modo de acesso ao convite">
          {INVITE_TABS.map(([value, label], index) => {
            const selected = mode === value;
            return (
              <button
                key={value}
                ref={(el) => {
                  tabRefs.current[value] = el;
                }}
                id={`invite-tab-${value}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls="invite-auth-panel"
                tabIndex={selected ? 0 : -1}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                onClick={() => {
                  setMode(value);
                  setError('');
                  setFieldError(null);
                }}
                className={`min-h-[44px] py-2 px-3 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                  selected
                    ? 'bg-brand text-brand-fg shadow-sm'
                    : 'text-zinc-400 hover:text-[#fafafa] hover:bg-[#18181b]'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div
          id="invite-auth-panel"
          role="tabpanel"
          aria-labelledby={`invite-tab-${mode}`}
          className="space-y-4"
        >
          {mode === 'signup' && (
            <Field
              id="invite-name"
              name="name"
              icon={User}
              label="Seu nome"
              value={name}
              invalid={fieldError === 'name'}
              onChange={(e) => {
                setName(e.target.value);
                if (fieldError === 'name') setFieldError(null);
              }}
              required
              autoComplete="name"
              placeholder="Nome completo"
            />
          )}
          <Field
            id="invite-email"
            name="email"
            icon={Mail}
            label="E-mail convidado"
            type="email"
            value={email}
            invalid={fieldError === 'email'}
            onChange={(e) => {
              setEmail(e.target.value);
              if (fieldError === 'email') setFieldError(null);
            }}
            required
            autoComplete="username"
            placeholder="nome@empresa.com.br"
          />
          <Field
            id="invite-password"
            name="password"
            icon={Lock}
            label="Senha"
            type="password"
            value={password}
            invalid={fieldError === 'password'}
            onChange={(e) => {
              setPassword(e.target.value);
              if (fieldError === 'password') setFieldError(null);
            }}
            required
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            placeholder="••••••••"
          />
          {mode === 'signup' && (
            <Field
              id="invite-confirm"
              name="confirmPassword"
              icon={Lock}
              label="Confirmar senha"
              type="password"
              value={confirm}
              invalid={fieldError === 'confirm'}
              onChange={(e) => {
                setConfirm(e.target.value);
                if (fieldError === 'confirm') setFieldError(null);
              }}
              required
              autoComplete="new-password"
              placeholder="••••••••"
            />
          )}

          <button
            type="submit"
            disabled={working}
            className="w-full min-h-[44px] bg-brand hover:bg-brand-dark text-brand-fg font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 text-sm uppercase tracking-wider transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-[#111113] disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {working ? <Loader2 aria-hidden="true" className="animate-spin text-current" size={18} /> : <>{mode === 'signup' ? 'Criar conta e entrar' : 'Entrar e aceitar'} <ArrowRight size={18} aria-hidden="true" /></>}
          </button>
        </div>
      </form>
    );
  }

  return (
    <main className="dark min-h-screen flex items-center justify-center bg-[#09090b] p-4 font-sans text-[#fafafa]">
      <div className="w-full max-w-md">
        <div className="bg-[#111113] border border-zinc-800 p-6 sm:p-8 rounded-xl shadow-xl">
          <div className="text-center mb-6">
            <div className="w-12 h-12 mx-auto mb-3 rounded-lg bg-brand/15 border border-brand/25 text-brand-aa flex items-center justify-center" aria-hidden="true">
              <Building2 size={24} aria-hidden="true" />
            </div>
            <p className="text-xs font-semibold text-zinc-400">Convite Nexus ITAM</p>
            <h1 className="text-xl font-bold text-[#fafafa] tracking-tight mt-1">
              {companyHint ? <>Entrar na equipe <span className="text-brand-aa">{companyHint}</span></> : 'Você foi convidado'}
            </h1>
            <p className="text-xs text-zinc-400 mt-1">Use o mesmo e-mail que recebeu o convite.</p>
          </div>

          {error && (
            <div role="alert" className="bg-rose-500/10 border border-rose-500/30 text-rose-300 p-3 rounded-lg mb-5 text-xs font-semibold flex items-start gap-2">
              <AlertCircle size={16} aria-hidden="true" className="shrink-0 mt-0.5 text-rose-400" /> <span>{error}</span>
            </div>
          )}

          {body}
        </div>

        <p className="mt-6 text-center text-xs text-zinc-400">
          Não esperava este convite?{' '}
          <Link
            to="/"
            className="inline-flex min-h-[44px] items-center rounded-lg px-2 text-brand-aa hover:underline font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            Voltar ao login
          </Link>
        </p>
      </div>
    </main>
  );
};

export default AcceptInvite;
