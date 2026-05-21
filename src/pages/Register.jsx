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
  Sparkles
} from 'lucide-react';
import Logo from '../components/Logo';

const Register = () => {
  // Dados do Formulário
  const [companyName, setCompanyName] = useState('');
  const [adminName, setAdminName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  // Feedbacks
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const { registerTenant } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Validações básicas
    if (password !== confirmPassword) {
      return setError('As senhas digitadas não são iguais.');
    }
    if (password.length < 6) {
      return setError('A senha deve conter no mínimo 6 caracteres.');
    }

    try {
      setLoading(true);
      await registerTenant(companyName, adminName, email, password);
      setSuccess(true);
      // Redireciona para o dashboard após um breve momento para celebrar o onboarding
      setTimeout(() => {
        navigate('/dashboard');
      }, 3000);
    } catch (err) {
      console.error(err);
      if (err.code === 'auth/email-already-in-use') {
        setError('Este endereço de e-mail já está em uso por outra empresa.');
      } else {
        setError('Ocorreu um erro ao criar a conta da sua empresa. Tente novamente.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-900 p-4 relative overflow-hidden font-sans">
      
      {/* Decorações do fundo: auréolas e gradientes corporativos premium */}
      <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-brand-dark via-brand to-brand-dark"></div>
      <div className="hidden md:block absolute -top-40 -left-40 w-[500px] h-[500px] bg-brand/10 rounded-full blur-3xl pointer-events-none"></div>
      <div className="hidden md:block absolute -bottom-40 -right-40 w-[500px] h-[500px] bg-blue-600/5 rounded-full blur-3xl pointer-events-none"></div>

      <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-12 bg-white rounded-3xl overflow-hidden shadow-2xl border border-gray-100 relative z-10">
        
        {/* Painel Lateral - Proposta de Valor do SaaS ITAM */}
        <div className="hidden md:flex md:col-span-5 bg-gradient-to-br from-neutral-900 to-neutral-950 p-8 flex-col justify-between relative overflow-hidden text-white border-r border-neutral-800">
          <div className="absolute top-0 right-0 w-64 h-64 bg-brand/10 rounded-full blur-2xl pointer-events-none"></div>
          
          <div>
            <div className="flex items-center gap-2 mb-12">
              <Logo size="sm" />
              <span className="text-xs font-black uppercase tracking-widest text-brand">Nexus B2B</span>
            </div>
            
            <h3 className="text-2xl font-black leading-tight tracking-tight uppercase">
              Eleve a gestão de infraestrutura de TI da sua empresa
            </h3>
            
            <div className="space-y-6 mt-8">
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-lg bg-brand/20 flex items-center justify-center text-brand shrink-0">
                  <ShieldCheck size={18} />
                </div>
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider">Isolamento Multi-Tenant</h4>
                  <p className="text-xs text-neutral-400 mt-1">Ambiente de nuvem 100% privado e isolado para as informações patrimoniais da sua empresa.</p>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-lg bg-brand/20 flex items-center justify-center text-brand shrink-0">
                  <Zap size={18} />
                </div>
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider">Configuração Instantânea</h4>
                  <p className="text-xs text-neutral-400 mt-1">Inscreva sua empresa e receba acesso imediato a dashboards de ativos, licenças e controle financeiro.</p>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-lg bg-brand/20 flex items-center justify-center text-brand shrink-0">
                  <Sparkles size={18} />
                </div>
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider">Pronto para Auditar</h4>
                  <p className="text-xs text-neutral-400 mt-1">Geração dinâmica de etiquetas QR Code inteligentes e controle de auditorias por dispositivo mobile.</p>
                </div>
              </div>
            </div>
          </div>
          
          <div className="border-t border-neutral-800 pt-4 mt-8">
            <p className="text-[10px] text-neutral-500 font-medium">Plataforma Nexus IT Asset Manager • Versão B2B SaaS</p>
          </div>
        </div>

        {/* Formulário Principal de Registro */}
        <div className="col-span-1 md:col-span-7 p-6 md:p-10 flex flex-col justify-center bg-white">
          {success ? (
            <div className="text-center py-10 flex flex-col items-center justify-center space-y-4 animate-in fade-in zoom-in duration-300">
              <div className="w-20 h-20 bg-green-50 text-green-500 rounded-full flex items-center justify-center shadow-lg shadow-green-100">
                <CheckCircle size={44} />
              </div>
              <h2 className="text-2xl font-black text-gray-900 uppercase tracking-tighter">Conta SaaS Criada!</h2>
              <p className="text-sm text-gray-500 max-w-sm">
                A empresa <strong>{companyName}</strong> e seu usuário administrador foram cadastrados. Estamos preparando sua nuvem privada...
              </p>
              <div className="flex items-center gap-2 mt-4 text-xs font-black text-brand uppercase tracking-widest animate-pulse">
                <span>Redirecionando para o Painel</span>
                <ArrowRight size={14} />
              </div>
            </div>
          ) : (
            <>
              <div className="mb-6">
                <div className="md:hidden flex items-center justify-between mb-6">
                  <Logo size="md" />
                  <Link to="/" className="text-xs font-bold text-gray-400 hover:text-black">Entrar</Link>
                </div>
                <h2 className="text-2xl font-black text-gray-900 uppercase tracking-tighter">Registre sua Empresa</h2>
                <p className="text-xs font-medium text-gray-400 mt-1">Inicie seu período de testes e configure sua infraestrutura em instantes.</p>
              </div>

              {error && (
                <div className="bg-red-50 text-red-600 p-3.5 rounded-xl mb-4 text-xs font-bold flex items-center gap-2 border border-red-100">
                  <AlertCircle size={16} className="shrink-0" /> {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                
                {/* Seção 1: Dados da Empresa */}
                <div className="border-b border-gray-100 pb-3 mb-3">
                  <h3 className="text-[10px] font-black text-brand uppercase tracking-widest mb-3">1. Informações Corporativas</h3>
                  
                  <div>
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Razão Social / Nome da Empresa</label>
                    <div className="relative group">
                      <Building2 className="absolute left-3 top-3.5 text-gray-400 group-focus-within:text-black transition-colors" size={18} />
                      <input 
                        type="text" 
                        required 
                        className="w-full pl-10 pr-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl focus:outline-none focus:border-black focus:bg-white transition-all font-bold text-gray-900 text-sm"
                        placeholder="Ex: Minha Empresa Tecnologia LTDA"
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                {/* Seção 2: Dados do Administrador */}
                <div className="space-y-4">
                  <h3 className="text-[10px] font-black text-brand uppercase tracking-widest mb-1">2. Perfil do Administrador Principal</h3>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Seu Nome</label>
                      <div className="relative group">
                        <User className="absolute left-3 top-3.5 text-gray-400 group-focus-within:text-black transition-colors" size={18} />
                        <input 
                          type="text" 
                          required 
                          className="w-full pl-10 pr-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl focus:outline-none focus:border-black focus:bg-white transition-all font-bold text-gray-900 text-sm"
                          placeholder="Nome Sobrenome"
                          value={adminName}
                          onChange={(e) => setAdminName(e.target.value)}
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">E-mail Corporativo</label>
                      <div className="relative group">
                        <Mail className="absolute left-3 top-3.5 text-gray-400 group-focus-within:text-black transition-colors" size={18} />
                        <input 
                          type="email" 
                          required 
                          className="w-full pl-10 pr-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl focus:outline-none focus:border-black focus:bg-white transition-all font-bold text-gray-900 text-sm"
                          placeholder="seu.email@empresa.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Senha de Acesso</label>
                      <div className="relative group">
                        <Lock className="absolute left-3 top-3.5 text-gray-400 group-focus-within:text-black transition-colors" size={18} />
                        <input 
                          type="password" 
                          required 
                          className="w-full pl-10 pr-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl focus:outline-none focus:border-black focus:bg-white transition-all font-bold text-gray-900 text-sm"
                          placeholder="Mínimo 6 caracteres"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Confirmar Senha</label>
                      <div className="relative group">
                        <Lock className="absolute left-3 top-3.5 text-gray-400 group-focus-within:text-black transition-colors" size={18} />
                        <input 
                          type="password" 
                          required 
                          className="w-full pl-10 pr-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl focus:outline-none focus:border-black focus:bg-white transition-all font-bold text-gray-900 text-sm"
                          placeholder="Confirme sua senha"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pt-2">
                  <button 
                    type="submit" 
                    disabled={loading}
                    className="w-full bg-brand text-white font-black py-4 rounded-xl hover:bg-brand-dark active:scale-98 transition-all flex items-center justify-center gap-2 shadow-lg shadow-brand/20 text-xs uppercase tracking-widest"
                  >
                    {loading ? 'Inicializando Nuvem Privada...' : <>Criar Conta Nexus <ArrowRight size={18} /></>}
                  </button>
                </div>
              </form>

              <div className="mt-6 text-center">
                <p className="text-xs text-gray-400 font-medium">
                  Sua empresa já possui uma conta no Nexus?{' '}
                  <Link to="/" className="text-brand font-black hover:underline">
                    Fazer Login
                  </Link>
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default Register;
