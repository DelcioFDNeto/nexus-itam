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
import React, { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { AlertCircle, ArrowRight, Building2, CheckCircle, Lock, LogOut, Mail, Orbit, User } from 'lucide-react';
import { auth } from '../services/firebase';
import { useAuth } from '../contexts/AuthContext';
import { hasValidTenant } from '../utils/permissions';
import { describeFirebaseError } from '../services/tenantService';

const inputClass =
  'w-full pl-12 pr-4 py-3 bg-black/40 border border-white/10 rounded-xl focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand transition-all font-medium text-white text-sm placeholder-gray-600';

const Field = ({ icon: Icon, label, id, ...props }) => (
  <div>
    <label htmlFor={id} className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 ml-1">
      {label}
    </label>
    <div className="relative group">
      <Icon className="absolute left-4 top-3.5 text-gray-500 group-focus-within:text-brand transition-colors" size={18} />
      <input id={id} className={inputClass} {...props} />
    </div>
  </div>
);

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
  const [done, setDone] = useState(false);

  const finish = async (displayName) => {
    await acceptInvite(inviteId, displayName);
    setDone(true);
    setTimeout(() => navigate('/dashboard', { replace: true }), 1200);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (mode === 'signup') {
      if (password.length < 8) return setError('A senha deve ter pelo menos 8 caracteres.');
      if (password !== confirm) return setError('As senhas não coincidem.');
      if (!name.trim()) return setError('Informe seu nome.');
    }

    setWorking(true);
    try {
      if (mode === 'signup') {
        await createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
      } else {
        await login(email, password);
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
    await logout();
    setError('');
  };

  const alreadyMember = !done && !working && currentUser && hasValidTenant(currentUser);
  const loggedWithoutTenant = !done && currentUser && !hasValidTenant(currentUser);

  let body;
  if (done) {
    body = (
      <div className="text-center py-6">
        <div className="w-16 h-16 bg-green-500/20 border border-green-500/50 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle size={32} className="text-green-400" />
        </div>
        <p className="text-white font-black text-lg">Convite aceito!</p>
        <p className="text-sm text-gray-400 mt-1">Abrindo o painel da empresa...</p>
      </div>
    );
  } else if (loading) {
    body = (
      <div className="flex justify-center py-10">
        <Orbit className="animate-spin text-brand" size={28} />
      </div>
    );
  } else if (alreadyMember) {
    body = (
      <div className="space-y-4 text-center">
        <p className="text-sm text-gray-300">
          Você já está conectado como <strong className="text-white">{currentUser.email}</strong>, que pertence a{' '}
          <strong className="text-white">{currentUser.companyName}</strong>. Cada conta participa de uma única empresa.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link to="/dashboard" className="px-5 py-3 rounded-xl bg-white text-black font-black text-xs uppercase tracking-widest">
            Ir para o painel
          </Link>
          <button onClick={handleSwitchAccount} className="px-5 py-3 rounded-xl border border-white/15 text-white font-black text-xs uppercase tracking-widest inline-flex items-center justify-center gap-2">
            <LogOut size={14} /> Usar outra conta
          </button>
        </div>
      </div>
    );
  } else if (loggedWithoutTenant) {
    body = (
      <div className="space-y-4">
        <p className="text-sm text-gray-300 text-center">
          Aceitar o convite como <strong className="text-white">{currentUser.email}</strong>?
        </p>
        <Field id="invite-name" icon={User} label="Seu nome" value={name} onChange={(e) => setName(e.target.value)} placeholder={currentUser.name || 'Nome completo'} autoComplete="name" />
        <button
          onClick={handleAcceptLogged}
          disabled={working}
          className="w-full bg-white text-black font-black py-3.5 rounded-xl flex items-center justify-center gap-2 text-sm uppercase tracking-widest disabled:opacity-60"
        >
          {working ? <Orbit className="animate-spin text-brand" size={18} /> : <>Aceitar convite <ArrowRight size={18} /></>}
        </button>
        <button onClick={handleSwitchAccount} className="w-full text-[11px] text-gray-400 hover:text-white font-bold">
          Não é você? Usar outra conta
        </button>
      </div>
    );
  } else {
    body = (
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-2 p-1 bg-black/30 rounded-xl border border-white/10" role="tablist">
          {[
            ['signup', 'Criar conta'],
            ['login', 'Já tenho conta'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => { setMode(value); setError(''); }}
              className={`py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-colors ${mode === value ? 'bg-white text-black' : 'text-gray-400 hover:text-white'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === 'signup' && (
          <Field id="invite-name" icon={User} label="Seu nome" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" placeholder="Nome completo" />
        )}
        <Field id="invite-email" icon={Mail} label="E-mail convidado" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" placeholder="voce@empresa.com" />
        <Field id="invite-password" icon={Lock} label="Senha" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} placeholder="••••••••" />
        {mode === 'signup' && (
          <Field id="invite-confirm" icon={Lock} label="Confirmar senha" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" placeholder="••••••••" />
        )}

        <button
          type="submit"
          disabled={working}
          className="w-full bg-white text-black font-black py-3.5 rounded-xl flex items-center justify-center gap-2 text-sm uppercase tracking-widest disabled:opacity-60"
        >
          {working ? <Orbit className="animate-spin text-brand" size={18} /> : <>{mode === 'signup' ? 'Criar conta e entrar' : 'Entrar e aceitar'} <ArrowRight size={18} /></>}
        </button>
      </form>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#0a0a0c] p-4 relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[30%] -right-[10%] w-[70vw] h-[70vw] rounded-full bg-brand/10 blur-[120px]" />
        <div className="absolute -bottom-[30%] -left-[10%] w-[60vw] h-[60vw] rounded-full bg-cyan-600/10 blur-[100px]" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        <div className="backdrop-blur-2xl bg-white/[0.03] border border-white/10 p-8 rounded-[2rem] shadow-2xl">
          <div className="text-center mb-6">
            <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-brand/20 border border-brand/30 text-brand flex items-center justify-center">
              <Building2 size={26} />
            </div>
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-gray-400">Convite Nexus ITAM</p>
            <h1 className="text-2xl font-black text-white tracking-tight mt-2">
              {companyHint ? <>Entrar na equipe <span className="text-brand">{companyHint}</span></> : 'Você foi convidado'}
            </h1>
            <p className="text-xs text-gray-400 mt-2">Use o mesmo e-mail que recebeu o convite.</p>
          </div>

          {error && (
            <div role="alert" className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-xl mb-5 text-xs font-bold flex items-start gap-2">
              <AlertCircle size={16} className="shrink-0 mt-0.5" /> <span>{error}</span>
            </div>
          )}

          {body}
        </div>

        <p className="mt-6 text-center text-[11px] text-gray-500">
          Não esperava este convite? <Link to="/" className="text-gray-300 hover:text-white font-bold">Voltar ao login</Link>
        </p>
      </div>
    </main>
  );
};

export default AcceptInvite;
