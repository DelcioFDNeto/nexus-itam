// src/pages/Login.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Lock, Mail, ArrowRight, AlertCircle, KeyRound, X, CheckCircle } from 'lucide-react';
import logo from '../assets/logo.png';

const Login = () => {
  // Estados de Login
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Estados de Recuperação de Senha
  const [isResetOpen, setIsResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetMessage, setResetMessage] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  
  const { login, resetPassword, currentUser } = useAuth(); // Puxamos o resetPassword
  const navigate = useNavigate();

  useEffect(() => {
    if (currentUser) navigate('/dashboard');
  }, [currentUser, navigate]);

  // Login Normal
  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setError('');
      setLoading(true);
      await login(email, password);
      navigate('/dashboard');
    } catch (err) {
      console.error(err);
      setError('Acesso negado. Verifique suas credenciais.');
    } finally {
      setLoading(false);
    }
  };

  // Recuperação de Senha
  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (!resetEmail) return setError('Digite seu e-mail para recuperar.');
    
    try {
      setResetMessage('');
      setError('');
      setResetLoading(true);
      await resetPassword(resetEmail);
      setResetMessage('E-mail de recuperação enviado! Verifique sua caixa de entrada.');
      setTimeout(() => {
         setIsResetOpen(false);
         setResetMessage('');
      }, 5000); // Fecha modal após 5s
    } catch (err) {
      console.error(err);
      setError('Falha ao enviar e-mail. Verifique se o endereço está correto.');
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-900 p-4 relative overflow-hidden">
      
      {/* Background Decorativo */}
      <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-red-900 via-red-600 to-red-900"></div>
      <div className="hidden md:block absolute -top-20 -right-20 w-96 h-96 bg-red-600/10 rounded-full blur-3xl pointer-events-none"></div>
      <div className="hidden md:block absolute -bottom-20 -left-20 w-96 h-96 bg-blue-600/5 rounded-full blur-3xl pointer-events-none"></div>

      {/* Card de Login */}
      <div className="bg-white p-6 md:p-8 rounded-3xl shadow-2xl w-full max-w-sm border border-gray-100 relative z-10">
        
        <div className="flex flex-col items-center mb-8">
          <div className="px-6 py-3 bg-white rounded-xl mb-6 shadow-md border border-gray-100 transform hover:scale-105 transition-transform duration-300">
              <img src={logo} alt="BySabel ITAM" className="h-12 object-contain" />
          </div>
          <h2 className="text-2xl font-black text-gray-900 uppercase tracking-tighter text-center">Portal TI</h2>
          <p className="text-xs font-medium text-gray-400 mt-1 text-center">Gestão de Ativos & Infraestrutura</p>
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-6 text-xs font-bold flex items-center gap-2 border border-red-100 animate-pulse">
            <AlertCircle size={16} /> {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">E-mail Corporativo</label>
            <div className="relative group">
              <Mail className="absolute left-3 top-3.5 text-gray-400 group-focus-within:text-black transition-colors" size={18} />
              <input 
                type="email" 
                required 
                className="w-full pl-10 pr-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl focus:outline-none focus:border-black focus:bg-white transition-all font-bold text-gray-900 text-sm"
                placeholder="usuario@bysabel.com.br"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Senha de Acesso</label>
            <div className="relative group">
              <Lock className="absolute left-3 top-3.5 text-gray-400 group-focus-within:text-black transition-colors" size={18} />
              <input 
                type="password" 
                required 
                className="w-full pl-10 pr-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl focus:outline-none focus:border-black focus:bg-white transition-all font-bold text-gray-900 text-sm"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-red-600 text-white font-black py-3.5 rounded-xl hover:bg-red-700 active:scale-95 transition-all flex items-center justify-center gap-2 shadow-lg shadow-red-600/30 text-xs uppercase tracking-widest mt-2"
          >
            {loading ? 'Validando...' : <>Acessar Sistema <ArrowRight size={18} /></>}
          </button>
        </form>

        {/* Link Esqueci a Senha */}
        <div className="mt-4 text-center">
            <button 
                onClick={() => setIsResetOpen(true)}
                className="text-xs text-gray-400 hover:text-red-600 font-bold transition-colors"
            >
                Esqueceu a senha?
            </button>
        </div>

        <div className="mt-6 text-center border-t border-gray-100 pt-4">
          <p className="text-[10px] text-gray-400 font-medium">BySabel © {new Date().getFullYear()}</p>
        </div>
      </div>

      {/* MODAL DE RECUPERAÇÃO DE SENHA */}
      {isResetOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6 relative">
                <button onClick={() => setIsResetOpen(false)} className="absolute top-4 right-4 text-gray-400 hover:text-black"><X size={20}/></button>
                
                <div className="mb-6 text-center">
                    <div className="w-12 h-12 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-3">
                        <KeyRound size={24} />
                    </div>
                    <h3 className="font-black text-gray-900 text-lg">Recuperar Acesso</h3>
                    <p className="text-xs text-gray-500 mt-1 px-4">Digite seu e-mail corporativo. Enviaremos um link para você redefinir sua senha.</p>
                </div>

                {resetMessage ? (
                    <div className="bg-green-50 text-green-700 p-4 rounded-xl text-center mb-4 border border-green-100 flex flex-col items-center gap-2">
                        <CheckCircle size={24} />
                        <p className="text-sm font-bold">E-mail enviado!</p>
                        <p className="text-xs">Verifique sua caixa de entrada (e spam).</p>
                    </div>
                ) : (
                    <form onSubmit={handleResetPassword} className="space-y-4">
                        <div>
                            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Seu E-mail</label>
                            <input 
                                type="email" 
                                required 
                                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-black transition-all text-sm font-bold"
                                placeholder="usuario@bysabel.com.br"
                                value={resetEmail}
                                onChange={(e) => setResetEmail(e.target.value)}
                            />
                        </div>
                        <button 
                            type="submit" 
                            disabled={resetLoading}
                            className="w-full bg-black text-white font-bold py-3 rounded-xl hover:bg-gray-800 transition-colors shadow-lg"
                        >
                            {resetLoading ? 'Enviando...' : 'Enviar Link de Recuperação'}
                        </button>
                    </form>
                )}
            </div>
        </div>
      )}

    </div>
  );
};

export default Login;