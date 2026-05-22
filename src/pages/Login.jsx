// src/pages/Login.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Lock, Mail, ArrowRight, AlertCircle, KeyRound, X, CheckCircle, Orbit } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Logo from '../components/Logo';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [isResetOpen, setIsResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetMessage, setResetMessage] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  
  const { login, resetPassword, currentUser } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (currentUser) navigate('/dashboard');
  }, [currentUser, navigate]);

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
      }, 5000);
    } catch (err) {
      console.error(err);
      setError('Falha ao enviar e-mail. Verifique se o endereço está correto.');
    } finally {
      setResetLoading(false);
    }
  };

  // Variantes de animação do Framer Motion
  const containerVariants = {
    hidden: { opacity: 0, y: 50 },
    visible: { 
      opacity: 1, 
      y: 0,
      transition: { duration: 0.6, ease: "easeOut", staggerChildren: 0.1 }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.4 } }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0c] p-4 relative overflow-hidden font-sans">
      
      {/* Background Animado - Estilo Cyber/Neon */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div 
          animate={{ rotate: 360 }} 
          transition={{ duration: 120, repeat: Infinity, ease: "linear" }}
          className="absolute -top-[30%] -right-[10%] w-[70vw] h-[70vw] rounded-full bg-brand/10 blur-[120px]"
        />
        <motion.div 
          animate={{ rotate: -360 }} 
          transition={{ duration: 150, repeat: Infinity, ease: "linear" }}
          className="absolute -bottom-[30%] -left-[10%] w-[60vw] h-[60vw] rounded-full bg-cyan-600/10 blur-[100px]"
        />
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-5 mix-blend-overlay"></div>
      </div>

      <motion.div 
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="relative z-10 w-full max-w-md"
      >
        {/* Painel Glassmorphism - Mescla Dark/Light */}
        <div className="backdrop-blur-2xl bg-white/[0.03] border border-white/10 p-8 rounded-[2rem] shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] relative overflow-hidden">
          
          {/* Brilho Superior do Card */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-brand to-transparent opacity-50"></div>

          <motion.div variants={itemVariants} className="flex flex-col items-center mb-8 relative">
            <div className="absolute -top-4 -z-10 w-24 h-24 bg-brand/20 blur-2xl rounded-full"></div>
            <Logo size="lg" className="drop-shadow-[0_0_15px_rgba(79,70,229,0.5)]" />
            <h2 className="text-3xl font-black text-white uppercase tracking-tighter mt-4 flex items-center gap-2">
              Nexus <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand to-cyan-400">ITAM</span>
            </h2>
            <p className="text-xs font-medium text-gray-400 dark:text-gray-500 mt-2 tracking-widest uppercase">Portal de Acesso Seguro</p>
          </motion.div>

          <AnimatePresence>
            {error && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-xl mb-6 text-xs font-bold flex items-center gap-2"
              >
                <AlertCircle size={16} /> {error}
              </motion.div>
            )}
          </AnimatePresence>

          <form onSubmit={handleSubmit} className="space-y-5">
            <motion.div variants={itemVariants}>
              <label className="block text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1.5 ml-1">ID Corporativo (E-mail)</label>
              <div className="relative group">
                <Mail className="absolute left-4 top-3.5 text-gray-500 dark:text-gray-400 dark:text-gray-500 group-focus-within:text-brand transition-colors" size={18} />
                <input 
                  type="email" 
                  required 
                  className="w-full pl-12 pr-4 py-3 bg-black/40 border border-white/10 rounded-xl focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand transition-all font-medium text-white text-sm placeholder-gray-600 shadow-inner"
                  placeholder="acesso@nexusitam.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </motion.div>

            <motion.div variants={itemVariants}>
              <label className="block text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Chave de Segurança</label>
              <div className="relative group">
                <Lock className="absolute left-4 top-3.5 text-gray-500 dark:text-gray-400 dark:text-gray-500 group-focus-within:text-brand transition-colors" size={18} />
                <input 
                  type="password" 
                  required 
                  className="w-full pl-12 pr-4 py-3 bg-black/40 border border-white/10 rounded-xl focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand transition-all font-medium text-white text-sm placeholder-gray-600 shadow-inner tracking-widest"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </motion.div>

            <motion.div variants={itemVariants} className="pt-2">
              <motion.button 
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                type="submit" 
                disabled={loading}
                className="w-full relative group overflow-hidden bg-white dark:bg-slate-800 text-black font-black py-3.5 rounded-xl transition-all flex items-center justify-center gap-2 text-sm uppercase tracking-widest shadow-[0_0_20px_rgba(255,255,255,0.1)] hover:shadow-[0_0_25px_rgba(255,255,255,0.2)]"
              >
                <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-gray-200 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]"></div>
                {loading ? (
                  <Orbit className="animate-spin text-brand" size={18} />
                ) : (
                  <>Autenticar <ArrowRight size={18} className="text-brand group-hover:translate-x-1 transition-transform" /></>
                )}
              </motion.button>
            </motion.div>
          </form>

          <motion.div variants={itemVariants} className="mt-6 flex flex-col sm:flex-row justify-between items-center px-1 gap-4 sm:gap-0">
              <button 
                  onClick={() => setIsResetOpen(true)}
                  className="text-[11px] text-gray-400 dark:text-gray-500 hover:text-white font-medium transition-colors border-b border-transparent hover:border-white pb-0.5"
              >
                  Recuperar credenciais
              </button>
              <Link 
                  to="/register"
                  className="text-[11px] px-4 py-2 rounded-full bg-white/5 border border-white/10 text-white hover:bg-white/10 font-bold transition-colors flex items-center gap-1"
              >
                  Nova Empresa
              </Link>
          </motion.div>
        </div>
        
        <motion.div variants={itemVariants} className="mt-8 text-center">
          <p className="text-[10px] text-gray-500 dark:text-gray-400 dark:text-gray-500 font-medium tracking-widest uppercase">
            Nexus ITAM Security Protocol © {new Date().getFullYear()}
          </p>
        </motion.div>
      </motion.div>

      {/* Janela de Recuperação Glassmorphism */}
      <AnimatePresence>
        {isResetOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-4"
          >
              <motion.div 
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.9, y: 20 }}
                className="bg-[#121214] border border-white/10 w-full max-w-sm rounded-3xl shadow-2xl p-8 relative overflow-hidden"
              >
                  <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-brand to-transparent opacity-50"></div>
                  
                  <button onClick={() => setIsResetOpen(false)} className="absolute top-5 right-5 text-gray-500 dark:text-gray-400 dark:text-gray-500 hover:text-white transition-colors bg-white/5 p-1 rounded-full"><X size={18}/></button>
                  
                  <div className="mb-8 text-center relative z-10">
                      <div className="w-14 h-14 bg-brand/20 border border-brand/30 text-brand rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-[0_0_15px_rgba(79,70,229,0.3)]">
                          <KeyRound size={24} />
                      </div>
                      <h3 className="font-black text-white text-xl tracking-tight">Recuperação Segura</h3>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-2 px-2 leading-relaxed">Insira a chave de e-mail vinculada à conta. As instruções serão criptografadas e enviadas.</p>
                  </div>

                  {resetMessage ? (
                      <motion.div 
                        initial={{ scale: 0.9 }} animate={{ scale: 1 }}
                        className="bg-green-500/10 text-green-400 p-5 rounded-2xl text-center mb-4 border border-green-500/20 flex flex-col items-center gap-3"
                      >
                          <CheckCircle size={28} />
                          <p className="text-sm font-bold tracking-wide">Protocolo Enviado!</p>
                          <p className="text-xs opacity-80">Verifique a caixa de entrada (e spam).</p>
                      </motion.div>
                  ) : (
                      <form onSubmit={handleResetPassword} className="space-y-5 relative z-10">
                          <div>
                              <label className="block text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1.5 ml-1">E-mail Vinculado</label>
                              <input 
                                  type="email" 
                                  required 
                                  className="w-full p-3 bg-black/50 border border-white/10 rounded-xl focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand transition-all text-sm font-medium text-white placeholder-gray-600"
                                  placeholder="usuario@nexusitam.com"
                                  value={resetEmail}
                                  onChange={(e) => setResetEmail(e.target.value)}
                              />
                          </div>
                          <motion.button 
                              whileHover={{ scale: 1.02 }}
                              whileTap={{ scale: 0.98 }}
                              type="submit" 
                              disabled={resetLoading}
                              className="w-full bg-brand text-white font-bold py-3.5 rounded-xl hover:bg-brand-dark transition-colors shadow-[0_0_15px_rgba(79,70,229,0.4)] text-sm tracking-wide"
                          >
                              {resetLoading ? 'Transmitindo...' : 'Solicitar Token'}
                          </motion.button>
                      </form>
                  )}
              </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
};

export default Login;