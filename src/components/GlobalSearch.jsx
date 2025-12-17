import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Monitor, User, FileText, ArrowRight, Command, X } from 'lucide-react';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '../services/firebase';

const GlobalSearch = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [term, setTerm] = useState('');
  const [results, setResults] = useState({ assets: [], employees: [], pages: [] });
  const [loading, setLoading] = useState(false);

  // Páginas do Sistema (Atalhos)
  const systemPages = [
    { name: 'Dashboard', path: '/', icon: <FileText size={14}/> },
    { name: 'Novo Ativo', path: '/assets/new', icon: <Monitor size={14}/> },
    { name: 'Auditoria', path: '/audit', icon: <FileText size={14}/> },
    { name: 'Equipe', path: '/employees', icon: <User size={14}/> },
    { name: 'Wiki / KB', path: '/wiki', icon: <FileText size={14}/> },
  ];

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 100);
  }, [isOpen]);

  // Busca com Debounce (espera parar de digitar)
  useEffect(() => {
    const delayDebounce = setTimeout(async () => {
      if (!term.trim()) {
          setResults({ assets: [], employees: [], pages: [] });
          return;
      }
      
      setLoading(true);
      const lowerTerm = term.toLowerCase();

      // 1. Filtrar Páginas
      const matchedPages = systemPages.filter(p => p.name.toLowerCase().includes(lowerTerm));

      try {
        // 2. Buscar Ativos (Firestore não tem 'LIKE', então buscamos tudo ou usamos lógica de prefixo. 
        // Para simplificar e performance em demo, vamos buscar os recentes ou usar uma estratégia mista.
        // Aqui simularei uma busca simples pegando uma coleção menor ou filtrando no cliente se a base não for gigante.
        // Para produção real com milhares de itens, ideal é Algolia ou ElasticSearch.
        // Vou fazer uma busca manual em memória nos snapshots recentes para manter a simplicidade sem custos extras:
        
        const assetsRef = collection(db, 'assets');
        const assetsSnap = await getDocs(query(assetsRef, limit(100))); // Limite de segurança
        const matchedAssets = assetsSnap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(a => 
                a.model?.toLowerCase().includes(lowerTerm) || 
                a.internalId?.toLowerCase().includes(lowerTerm) ||
                a.assignedTo?.toLowerCase().includes(lowerTerm)
            )
            .slice(0, 5);

        // 3. Buscar Funcionários
        const empRef = collection(db, 'employees');
        const empSnap = await getDocs(query(empRef, limit(50)));
        const matchedEmp = empSnap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(e => e.name.toLowerCase().includes(lowerTerm))
            .slice(0, 3);

        setResults({ assets: matchedAssets, employees: matchedEmp, pages: matchedPages });

      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }

    }, 300);

    return () => clearTimeout(delayDebounce);
  }, [term]);

  const handleSelect = (path) => {
      navigate(path);
      onClose();
      setTerm('');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[15vh] p-4 animate-in fade-in duration-100">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[70vh]">
        
        {/* Input Area */}
        <div className="flex items-center p-4 border-b border-gray-100 gap-3">
            <Search className="text-gray-400" size={24} />
            <input 
                ref={inputRef}
                value={term}
                onChange={e => setTerm(e.target.value)}
                className="flex-1 text-xl outline-none text-gray-800 placeholder-gray-300 font-medium bg-transparent"
                placeholder="O que você procura?"
            />
            <button onClick={onClose} className="p-1 bg-gray-100 rounded text-gray-400 text-xs font-bold px-2">ESC</button>
        </div>

        {/* Results Area */}
        <div className="overflow-y-auto p-2 bg-gray-50/50">
            
            {loading && <div className="p-4 text-center text-gray-400 text-sm">Buscando...</div>}

            {!loading && !term && (
                <div className="p-8 text-center text-gray-400 flex flex-col items-center gap-2">
                    <Command size={32} className="opacity-20"/>
                    <p className="text-sm">Digite para buscar ativos, pessoas ou páginas.</p>
                </div>
            )}

            {/* Seção Páginas */}
            {results.pages.length > 0 && (
                <div className="mb-2">
                    <p className="px-3 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Acesso Rápido</p>
                    {results.pages.map(page => (
                        <button key={page.path} onClick={() => handleSelect(page.path)} className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-white hover:shadow-sm hover:text-black text-gray-600 flex items-center gap-3 transition-all group border border-transparent hover:border-gray-100">
                            <div className="p-1.5 bg-gray-200 rounded-lg group-hover:bg-black group-hover:text-white transition-colors">{page.icon}</div>
                            <span className="font-bold text-sm">{page.name}</span>
                            <ArrowRight size={14} className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity"/>
                        </button>
                    ))}
                </div>
            )}

            {/* Seção Ativos */}
            {results.assets.length > 0 && (
                <div className="mb-2">
                    <p className="px-3 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Ativos Encontrados</p>
                    {results.assets.map(asset => (
                        <button key={asset.id} onClick={() => handleSelect(`/assets/${asset.id}`)} className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-white hover:shadow-sm text-gray-600 flex items-center gap-3 transition-all group border border-transparent hover:border-gray-100">
                            <div className="p-1.5 bg-blue-100 text-blue-600 rounded-lg"><Monitor size={14}/></div>
                            <div className="flex-1">
                                <p className="font-bold text-sm text-gray-900">{asset.model}</p>
                                <p className="text-xs text-gray-400 font-mono">{asset.internalId}</p>
                            </div>
                            <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${asset.status === 'Em Uso' ? 'bg-green-100 text-green-700' : 'bg-gray-100'}`}>{asset.status}</span>
                        </button>
                    ))}
                </div>
            )}

            {/* Seção Pessoas */}
            {results.employees.length > 0 && (
                <div className="mb-2">
                    <p className="px-3 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Equipe</p>
                    {results.employees.map(emp => (
                        <button key={emp.id} onClick={() => handleSelect(`/employees`)} className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-white hover:shadow-sm text-gray-600 flex items-center gap-3 transition-all group border border-transparent hover:border-gray-100">
                            <div className="p-1.5 bg-purple-100 text-purple-600 rounded-lg"><User size={14}/></div>
                            <div className="flex-1">
                                <p className="font-bold text-sm text-gray-900">{emp.name}</p>
                                <p className="text-xs text-gray-400">{emp.role} - {emp.branch}</p>
                            </div>
                        </button>
                    ))}
                </div>
            )}

            {!loading && term && results.assets.length === 0 && results.employees.length === 0 && results.pages.length === 0 && (
                <div className="p-8 text-center text-gray-500 text-sm">
                    Nenhum resultado para "{term}".
                </div>
            )}
        </div>
        
        <div className="bg-gray-100 p-2 text-center text-[10px] text-gray-400 font-mono border-t border-gray-200">
            Use as setas para navegar • Enter para selecionar • ESC para fechar
        </div>
      </div>
    </div>
  );
};

export default GlobalSearch;