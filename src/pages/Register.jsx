// src/pages/Register.jsx
import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { 
  Building2, 
  User, 
  Mail, 
  Lock, 
  ArrowRight, 
  AlertCircle, 
  CheckCircle,
  ShieldCheck,
  Loader2,
} from 'lucide-react';
import Logo from '../components/Logo';

const Register = () => {
  const [companyName, setCompanyName] = useState('');
  const [adminName, setAdminName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const { registerTenant } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      return setError('As senhas digitadas não coincidem.');
    }
    if (password.length < 8) {
      return setError('A senha deve conter no mínimo 8 caracteres.');
    }
    if (!companyName.trim() || !adminName.trim()) {
      return setError('Informe o nome da empresa e do administrador.');
    }

    try {
      setLoading(true);
      await registerTenant(companyName, adminName, email, password);
      setSuccess(true);
      setTimeout(() => {
        navigate('/dashboard', { replace: true });
      }, 1500);
    } catch (err) {
      console.error(err);
      const messages = {
        'auth/email-already-in-use': 'Este e-mail já possui uma conta. Faça login ou use outro endereço.',
        'auth/invalid-email': 'E-mail inválido.',
        'auth/weak-password': 'Senha fraca: use pelo menos 8 caracteres, com letras e números.',
        'auth/network-request-failed': 'Sem conexão com o servidor. Verifique sua internet.',
        'auth/too-many-requests': 'Muitas tentativas seguidas. Aguarde alguns minutos.',
      };
      setError(messages[err.code] || 'Não foi possível criar a empresa agora. Tente novamente em instantes.');
    } finally {
      setLoading(false);
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
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4 font-sans text-slate-100">
        <div className="bg-slate-900 border border-slate-800 p-8 rounded-xl max-w-md w-full text-center shadow-xl animate-fade-in">
          <div className="w-14 h-14 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-xl flex items-center justify-center mx-auto mb-4">
            <ShieldCheck size={28} />
          </div>
          
          <h2 className="text-xl font-bold text-white mb-2">Conta Criada com Sucesso</h2>
          <p className="text-xs text-slate-300 leading-relaxed">
            A organização <strong className="text-white">{companyName}</strong> foi inicializada. Você já pode acessar o painel e gerenciar seu inventário.
          </p>
          <div className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-400 font-mono">
            <Loader2 className="animate-spin text-brand" size={16} />
            <span>Redirecionando para o painel...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-950 p-4 font-sans text-slate-100 py-12">
      <div className="w-full max-w-lg">
        <div className="bg-slate-900 border border-slate-800 p-8 md:p-10 rounded-xl shadow-xl">
          {/* Cabeçalho */}
          <div className="text-center mb-6">
            <div className="w-12 h-12 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-center p-2 mx-auto mb-3 shadow-inner">
              <Logo size="md" showText={false} />
            </div>
            <h2 className="text-xl font-bold text-white tracking-tight">
              Criar Conta Corporativa
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Cadastre sua organização para iniciar a gestão de ativos
            </p>
          </div>

          {error && (
            <div role="alert" className="bg-rose-500/10 border border-rose-500/30 text-rose-300 p-3 rounded-lg mb-5 text-xs font-semibold flex items-center gap-2">
              <AlertCircle size={16} className="shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Nome da Empresa / Razão Social
                </label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-3 text-slate-500" size={16} />
                  <input 
                    type="text" 
                    required 
                    autoComplete="organization"
                    className="w-full pl-9 pr-3 py-2.5 bg-slate-950 border border-slate-800 rounded-lg focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand text-white text-sm placeholder-slate-600 transition-colors"
                    placeholder="Ex: Nexus Corp"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Administrador Responsável
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-3 text-slate-500" size={16} />
                  <input 
                    type="text" 
                    required 
                    autoComplete="name"
                    className="w-full pl-9 pr-3 py-2.5 bg-slate-950 border border-slate-800 rounded-lg focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand text-white text-sm placeholder-slate-600 transition-colors"
                    placeholder="Nome completo"
                    value={adminName}
                    onChange={(e) => setAdminName(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                E-mail Corporativo
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 text-slate-500" size={16} />
                <input 
                  type="email" 
                  required 
                  autoComplete="username"
                  className="w-full pl-9 pr-3 py-2.5 bg-slate-950 border border-slate-800 rounded-lg focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand text-white text-sm placeholder-slate-600 transition-colors"
                  placeholder="admin@empresa.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-xs font-semibold text-slate-300">
                    Senha
                  </label>
                  {password.length > 0 && (
                    <span className={`text-[10px] font-semibold ${pwdStrength > 50 ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {pwdStrength > 50 ? 'Forte' : 'Mín. 8 caracteres'}
                    </span>
                  )}
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 text-slate-500" size={16} />
                  <input 
                    type="password" 
                    required 
                    autoComplete="new-password"
                    className="w-full pl-9 pr-3 py-2.5 bg-slate-950 border border-slate-800 rounded-lg focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand text-white text-sm placeholder-slate-600 transition-colors"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Confirmar Senha
                </label>
                <div className="relative">
                  <ShieldCheck className="absolute left-3 top-3 text-slate-500" size={16} />
                  <input 
                    type="password" 
                    required 
                    autoComplete="new-password"
                    className="w-full pl-9 pr-3 py-2.5 bg-slate-950 border border-slate-800 rounded-lg focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand text-white text-sm placeholder-slate-600 transition-colors"
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="pt-2">
              <button 
                type="submit" 
                disabled={loading}
                className="w-full bg-brand hover:bg-brand-dark text-white font-semibold py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 text-sm shadow-sm disabled:opacity-60"
              >
                {loading ? (
                  <Loader2 className="animate-spin text-white" size={16} />
                ) : (
                  <>
                    <span>Criar Conta Corporativa</span>
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            </div>
          </form>

          <div className="mt-6 pt-5 border-t border-slate-800 flex items-center justify-center text-xs text-slate-400">
            <span>Já possui uma conta?</span>
            <Link 
              to="/"
              className="ml-1 text-brand hover:text-white font-semibold transition-colors"
            >
              Fazer Login
            </Link>
          </div>
        </div>

        <div className="mt-6 text-center text-xs text-slate-500">
          Nexus ITAM · {new Date().getFullYear()}
        </div>
      </div>
    </main>
  );
};

export default Register;
