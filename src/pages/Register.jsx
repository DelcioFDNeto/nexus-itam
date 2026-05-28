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
  Zap,
  Sparkles,
  Orbit
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
    if (password.length < 6) {
      return setError('A senha deve conter no mínimo 6 caracteres.');
    }

    try {
      setLoading(true);
      await registerTenant(companyName, adminName, email, password);
      setSuccess(true);
      setTimeout(() => {
        navigate('/dashboard');
      }, 3000);
    } catch (err) {
      console.error(err);
      if (err.code === 'auth/email-already-in-use') {
        setError('Este endereço de e-mail já está vinculado a outra corporação.');
      } else {
        setError('Falha de sistema ao provisionar nova instância. Tente novamente.');
      }
    } finally {
      setLoading(false);
    }
  };

  const calculatePasswordStrength = (pass) => {
    let strength = 0;
    if (pass.length > 5) strength += 25;
    if (pass.length > 8) strength += 25;
    if (pass.match(/[A-Z]/)) strength += 25;
    if (pass.match(/[0-9]/) || pass.match(/[^A-Za-z0-9]/)) strength += 25;
    return strength;
  };

  const pwdStrength = calculatePasswordStrength(password);
  
  let pwdColor = 'bg-red-500';
  if (pwdStrength > 25) pwdColor = 'bg-orange-500';
  if (pwdStrength > 50) pwdColor = 'bg-yellow-500';
  if (pwdStrength > 75) pwdColor = 'bg-green-500';

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0c] p-4 relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('/carbon-fibre.png')] opacity-5 mix-blend-overlay pointer-events-none"></div>
        <div className="bg-black/40 backdrop-blur-2xl border border-brand/30 p-10 rounded-3xl max-w-md w-full text-center shadow-[0_0_50px_rgba(79,70,229,0.2)] relative z-10 animate-[loginScaleIn_0.6s_ease-out_both]">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-green-400 to-transparent opacity-80"></div>
          
          <div className="w-20 h-20 bg-green-500/20 border border-green-500/50 rounded-full flex items-center justify-center mx-auto mb-6 shadow-[0_0_30px_rgba(34,197,94,0.4)] animate-[loginScaleIn_0.5s_ease-out_0.2s_both]">
            <ShieldCheck size={40} className="text-green-400" />
          </div>
          
          <h2 className="text-2xl font-black text-white uppercase tracking-tighter mb-2">Instância Criada!</h2>
          <p className="text-sm text-gray-400 dark:text-gray-500 font-medium">A infraestrutura da <span className="text-brand font-bold">{companyName}</span> foi provisionada com sucesso.</p>
          <div className="mt-8 flex justify-center">
            <Orbit className="animate-spin text-brand" size={24} />
          </div>
          <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-widest mt-4 animate-pulse">Redirecionando para o Dashboard Central...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0c] p-4 relative overflow-hidden font-sans py-12">
      
      {/* Background Cyber/Neon — CSS puro */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[10%] -left-[20%] w-[70vw] h-[70vw] rounded-full bg-indigo-600/10 blur-[130px] animate-[spin_150s_linear_infinite_reverse]" />
        <div className="absolute -bottom-[20%] -right-[10%] w-[60vw] h-[60vw] rounded-full bg-cyan-600/10 blur-[120px] animate-[spin_120s_linear_infinite]" />
        <div className="absolute inset-0 bg-[url('/carbon-fibre.png')] opacity-5 mix-blend-overlay"></div>
      </div>

      <div className="relative z-10 w-full max-w-xl animate-[loginFadeUp_0.6s_ease-out_both]">
        <div className="backdrop-blur-2xl bg-white/[0.03] border border-white/10 p-8 md:p-10 rounded-[2rem] shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] relative overflow-hidden">
          
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-cyan-400 to-transparent opacity-50"></div>

          <div className="text-center mb-8 relative animate-[loginFadeUp_0.6s_ease-out_0.08s_both]">
             <div className="absolute top-0 left-1/2 -translate-x-1/2 -z-10 w-32 h-32 bg-cyan-500/20 blur-3xl rounded-full"></div>
             <div className="flex justify-center mb-4">
                 <Logo size="lg" className="drop-shadow-[0_0_15px_rgba(34,211,238,0.5)]" />
             </div>
            <h2 className="text-3xl font-black text-white uppercase tracking-tighter flex items-center justify-center gap-2">
              Deploy <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-brand">Corporativo</span>
            </h2>
            <p className="text-xs font-medium text-gray-400 dark:text-gray-500 mt-2 tracking-widest uppercase">Provisionamento de Nova Instância SaaS</p>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-xl mb-6 text-xs font-bold flex items-center gap-2 animate-[loginFadeUp_0.3s_ease-out_both]">
              <AlertCircle size={16} /> {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Empresa */}
              <div className="animate-[loginFadeUp_0.6s_ease-out_0.16s_both]">
                <label className="block text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Razão Social / Fantasia</label>
                <div className="relative group">
                  <Building2 className="absolute left-4 top-3.5 text-gray-500 dark:text-gray-400 group-focus-within:text-cyan-400 transition-colors" size={18} />
                  <input 
                    type="text" 
                    required 
                    className="w-full pl-12 pr-4 py-3 bg-black/40 border border-white/10 rounded-xl focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 transition-all font-medium text-white text-sm placeholder-gray-600 shadow-inner"
                    placeholder="Ex: Nexus Corp"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                  />
                </div>
              </div>

              {/* Admin */}
              <div className="animate-[loginFadeUp_0.6s_ease-out_0.24s_both]">
                <label className="block text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Administrador Master</label>
                <div className="relative group">
                  <User className="absolute left-4 top-3.5 text-gray-500 dark:text-gray-400 group-focus-within:text-cyan-400 transition-colors" size={18} />
                  <input 
                    type="text" 
                    required 
                    className="w-full pl-12 pr-4 py-3 bg-black/40 border border-white/10 rounded-xl focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 transition-all font-medium text-white text-sm placeholder-gray-600 shadow-inner"
                    placeholder="Nome Completo"
                    value={adminName}
                    onChange={(e) => setAdminName(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* Email */}
            <div className="animate-[loginFadeUp_0.6s_ease-out_0.32s_both]">
              <label className="block text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1.5 ml-1">E-mail de Acesso</label>
              <div className="relative group">
                <Mail className="absolute left-4 top-3.5 text-gray-500 dark:text-gray-400 group-focus-within:text-cyan-400 transition-colors" size={18} />
                <input 
                  type="email" 
                  required 
                  className="w-full pl-12 pr-4 py-3 bg-black/40 border border-white/10 rounded-xl focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 transition-all font-medium text-white text-sm placeholder-gray-600 shadow-inner"
                  placeholder="admin@empresa.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            {/* Senhas */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="animate-[loginFadeUp_0.6s_ease-out_0.4s_both]">
                <label className="flex justify-between text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1.5 ml-1">
                  <span>Chave de Segurança</span>
                  {password.length > 0 && (
                      <span className={`text-[9px] ${pwdStrength > 50 ? 'text-green-400' : 'text-orange-400'}`}>
                          {pwdStrength > 50 ? 'Forte' : 'Fraca'}
                      </span>
                  )}
                </label>
                <div className="relative group">
                  <Lock className="absolute left-4 top-3.5 text-gray-500 dark:text-gray-400 group-focus-within:text-cyan-400 transition-colors" size={18} />
                  <input 
                    type="password" 
                    required 
                    className="w-full pl-12 pr-4 py-3 bg-black/40 border border-white/10 rounded-xl focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 transition-all font-medium text-white text-sm placeholder-gray-600 tracking-widest shadow-inner"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  {/* Barra de Força da Senha */}
                  {password.length > 0 && (
                      <div className="absolute bottom-0 left-0 h-0.5 bg-gray-800 w-full rounded-b-xl overflow-hidden">
                          <div 
                              className={`h-full ${pwdColor} transition-all duration-300`}
                              style={{ width: `${pwdStrength}%` }}
                          />
                      </div>
                  )}
                </div>
              </div>

              <div className="animate-[loginFadeUp_0.6s_ease-out_0.48s_both]">
                <label className="block text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Confirmar Chave</label>
                <div className="relative group">
                  <ShieldCheck className="absolute left-4 top-3.5 text-gray-500 dark:text-gray-400 group-focus-within:text-cyan-400 transition-colors" size={18} />
                  <input 
                    type="password" 
                    required 
                    className="w-full pl-12 pr-4 py-3 bg-black/40 border border-white/10 rounded-xl focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 transition-all font-medium text-white text-sm placeholder-gray-600 tracking-widest shadow-inner"
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="pt-4 animate-[loginFadeUp_0.6s_ease-out_0.56s_both]">
              <button 
                type="submit" 
                disabled={loading}
                className="w-full relative group overflow-hidden bg-white dark:bg-slate-800 text-black font-black py-3.5 rounded-xl transition-all flex items-center justify-center gap-2 text-sm uppercase tracking-widest shadow-[0_0_20px_rgba(255,255,255,0.1)] hover:shadow-[0_0_25px_rgba(34,211,238,0.3)] hover:scale-[1.02] active:scale-[0.98]"
              >
                <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-cyan-100 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]"></div>
                {loading ? (
                  <Sparkles className="animate-spin text-cyan-600" size={18} />
                ) : (
                  <>Inicializar Sistema <Zap size={18} className="text-cyan-600 group-hover:scale-110 transition-transform" /></>
                )}
              </button>
            </div>
          </form>

          <div className="mt-6 flex justify-center items-center px-1 animate-[loginFadeUp_0.6s_ease-out_0.64s_both]">
              <span className="text-[11px] text-gray-500 dark:text-gray-400 mr-2">Já possui uma instância provisionada?</span>
              <Link 
                  to="/"
                  className="text-[11px] text-cyan-400 hover:text-cyan-300 font-bold transition-colors underline decoration-cyan-400/30 hover:decoration-cyan-400 underline-offset-4"
              >
                  Fazer Login Seguro
              </Link>
          </div>
        </div>
        
        <div className="mt-8 text-center animate-[loginFadeUp_0.6s_ease-out_0.72s_both]">
          <p className="text-[10px] text-gray-500 dark:text-gray-400 font-medium tracking-widest uppercase">
            SaaS Infrastructure Protocol © {new Date().getFullYear()}
          </p>
        </div>
      </div>

    </div>
  );
};

export default Register;
