// src/pages/AuditPage.jsx
import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
// MUDANÇA: Usando conexão direta com o banco para garantir dados frescos
import { db } from '../services/firebase';
import { collection, query, onSnapshot, orderBy } from 'firebase/firestore';
import QRScanner from '../components/QRScanner';
import { 
  ClipboardCheck, MapPin, Scan, CheckCircle, XCircle, AlertTriangle, ArrowLeft 
} from 'lucide-react';

const AuditPage = () => {
  const navigate = useNavigate();
  
  // Estado de Dados
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);

  // Estados da Auditoria
  const [selectedLocation, setSelectedLocation] = useState('');
  const [scannedIds, setScannedIds] = useState(new Set()); 
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [lastScanned, setLastScanned] = useState(null);

  // --- CARREGAMENTO EM TEMPO REAL ---
  useEffect(() => {
    setLoading(true);
    // Trazemos todos os ativos para poder filtrar localmente
    const q = query(collection(db, 'assets'), orderBy('location', 'asc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const assetData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setAssets(assetData);
      setLoading(false);
    }, (error) => {
      console.error("Erro ao carregar ativos para auditoria:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // --- 1. LISTA DE LOCAIS (FILTRO) ---
  const locations = useMemo(() => {
      // Pega todos os locais únicos do banco
      const uniqueLocs = [...new Set(assets.map(a => a.location).filter(Boolean))];
      // Remove locais que não fazem sentido auditar fisicamente (opcional)
      return uniqueLocs.sort();
  }, [assets]);

  // --- 2. O QUE ESPERAMOS ENCONTRAR? ---
  const expectedAssets = useMemo(() => {
      if (!selectedLocation) return [];
      // Filtra ativos que DEVEM estar na unidade e que não foram baixados
      return assets.filter(a => a.location === selectedLocation && a.status !== 'Baixado' && a.status !== 'Descarte');
  }, [assets, selectedLocation]);

  // --- 3. RESULTADO DA CONFERÊNCIA ---
  const auditResult = useMemo(() => {
      const found = [];
      const missing = [];
      const intruders = []; // Itens bipados que são de OUTRO lugar

      // A. Verifica os que deveriam estar aqui
      expectedAssets.forEach(asset => {
          if (scannedIds.has(asset.internalId)) {
              found.push(asset);
          } else {
              missing.push(asset);
          }
      });

      // B. Verifica intrusos (Bipados que não estão na lista de esperados)
      scannedIds.forEach(id => {
          const asset = assets.find(a => a.internalId === id);
          // Se o ativo existe no sistema, mas o local dele no cadastro NÃO é o selecionado
          if (asset && asset.location !== selectedLocation) {
              intruders.push(asset);
          }
      });

      return { found, missing, intruders };
  }, [expectedAssets, scannedIds, assets, selectedLocation]);

  // --- PROGRESSO ---
  const progress = expectedAssets.length > 0 
      ? Math.round((auditResult.found.length / expectedAssets.length) * 100) 
      : 0;

  // --- AÇÃO DO SCANNER ---
  const handleScan = (code) => {
      if (!code) return;
      
      // Feedback sonoro (opcional, vibração funciona melhor em mobile)
      if (navigator.vibrate) navigator.vibrate(200);

      setScannedIds(prev => {
          const newSet = new Set(prev);
          newSet.add(code); // Adiciona o ID lido (ex: SHL-NTB-001)
          return newSet;
      });
      
      setLastScanned(code);
  };

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto pb-24">
      
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => navigate('/')} className="p-3 bg-white rounded-xl hover:bg-gray-100 shadow-sm border border-gray-200">
            <ArrowLeft size={20} />
        </button>
        <div>
            <h1 className="text-xl md:text-2xl font-black text-gray-900 flex items-center gap-2">
                <ClipboardCheck className="text-shineray" /> Auditoria
            </h1>
            <p className="text-xs text-gray-500 font-bold uppercase tracking-wide">Conferência Mobile</p>
        </div>
      </div>

      {/* Seleção de Local (FILTRO POR UNIDADE) */}
      <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200 mb-6 relative">
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-2">
              <MapPin size={14} /> Selecione a Unidade / Local
          </label>
          <div className="relative">
            <select 
                className="w-full p-4 border-2 border-gray-100 rounded-xl bg-gray-50 focus:ring-2 focus:ring-black outline-none font-bold text-gray-800 text-lg appearance-none"
                value={selectedLocation}
                onChange={(e) => {
                    setSelectedLocation(e.target.value);
                    setScannedIds(new Set()); // Reseta conferência ao mudar de sala
                    setLastScanned(null);
                }}
            >
                <option value="">-- Toque para selecionar --</option>
                {locations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
            </select>
            <div className="absolute right-4 top-5 pointer-events-none text-gray-400">▼</div>
          </div>
      </div>

      {selectedLocation && (
          <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
              
              {/* Painel de Controle e Botão de Scan */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  
                  {/* Card de Progresso */}
                  <div className="bg-black text-white p-6 rounded-2xl relative overflow-hidden shadow-xl">
                      <div className="relative z-10 flex justify-between items-end">
                          <div>
                            <p className="text-gray-400 text-[10px] font-black uppercase tracking-widest mb-1">Progresso da Auditoria</p>
                            <h2 className="text-5xl font-black tracking-tighter">{progress}%</h2>
                          </div>
                          <div className="text-right">
                              <p className="text-2xl font-bold">{auditResult.found.length} <span className="text-gray-500 text-base">/ {expectedAssets.length}</span></p>
                              <p className="text-xs text-gray-400">Itens</p>
                          </div>
                      </div>
                      {/* Barra Visual */}
                      <div className="absolute bottom-0 left-0 h-1.5 bg-gray-800 w-full">
                        <div className="h-full bg-green-500 transition-all duration-500" style={{ width: `${progress}%` }}></div>
                      </div>
                  </div>

                  {/* Botão de Câmera */}
                  <button 
                    onClick={() => setIsScannerOpen(true)}
                    className="bg-shineray hover:bg-red-700 text-white p-4 rounded-2xl flex items-center justify-center gap-4 transition-all active:scale-95 shadow-lg shadow-red-600/20 border-2 border-red-500"
                  >
                      <div className="bg-white/20 p-3 rounded-full">
                        <Scan size={32} />
                      </div>
                      <div className="text-left">
                        <span className="block font-black text-lg uppercase tracking-wide">Abrir Câmera</span>
                        <span className="text-xs text-red-100 opacity-90">Ler QR Code / Etiqueta</span>
                      </div>
                  </button>
              </div>

              {/* Feedback Último Scan */}
              {lastScanned && (
                  <div className="bg-blue-50 border border-blue-200 p-4 rounded-xl text-center animate-pulse flex flex-col items-center justify-center">
                      <p className="text-[10px] text-blue-600 font-black uppercase tracking-widest mb-1">Última Leitura</p>
                      <p className="text-2xl font-mono font-black text-blue-900 tracking-tight">{lastScanned}</p>
                  </div>
              )}

              {/* Listas de Resultados */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  
                  {/* Coluna 1: Pendentes (Vermelho) */}
                  <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                      <div className="bg-red-50 p-4 border-b border-red-100 flex justify-between items-center">
                          <h3 className="font-bold text-red-800 text-sm flex items-center gap-2 uppercase tracking-wide">
                              <XCircle size={18} /> Pendentes ({auditResult.missing.length})
                          </h3>
                      </div>
                      <div className="max-h-80 overflow-y-auto p-2">
                          {auditResult.missing.length === 0 ? (
                              <div className="p-8 text-center">
                                  <CheckCircle size={40} className="text-green-200 mx-auto mb-2"/>
                                  <p className="text-green-600 font-bold text-sm">Todos os itens encontrados!</p>
                              </div>
                          ) : (
                              auditResult.missing.map(asset => (
                                  <div key={asset.id} className="p-3 border-b border-gray-50 last:border-0 hover:bg-gray-50 flex justify-between items-center group">
                                      <div>
                                          <p className="font-bold text-sm text-gray-900">{asset.model}</p>
                                          <p className="font-mono text-xs text-gray-400 font-bold">{asset.internalId}</p>
                                      </div>
                                      <div className="w-2 h-2 rounded-full bg-red-400 group-hover:scale-125 transition-transform"></div>
                                  </div>
                              ))
                          )}
                      </div>
                  </div>

                  {/* Coluna 2: Encontrados (Verde) */}
                  <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                      <div className="bg-green-50 p-4 border-b border-green-100 flex justify-between items-center">
                          <h3 className="font-bold text-green-800 text-sm flex items-center gap-2 uppercase tracking-wide">
                              <CheckCircle size={18} /> Ok / Encontrados ({auditResult.found.length})
                          </h3>
                      </div>
                      <div className="max-h-80 overflow-y-auto p-2">
                          {auditResult.found.map(asset => (
                              <div key={asset.id} className="p-3 border-b border-gray-50 last:border-0 bg-green-50/30 flex justify-between items-center">
                                  <div>
                                      <p className="font-bold text-sm text-gray-900">{asset.model}</p>
                                      <p className="font-mono text-xs text-green-600 font-bold">{asset.internalId}</p>
                                  </div>
                                  <CheckCircle size={16} className="text-green-500" />
                              </div>
                          ))}
                          {auditResult.found.length === 0 && <p className="p-6 text-center text-xs text-gray-400">Nenhum item bipado ainda.</p>}
                      </div>
                  </div>

                  {/* Coluna 3: Intrusos (Amarelo - Opcional) */}
                  {auditResult.intruders.length > 0 && (
                      <div className="md:col-span-2 bg-yellow-50 rounded-2xl border border-yellow-200 overflow-hidden shadow-sm animate-in slide-in-from-left">
                          <div className="bg-yellow-100 p-4 flex justify-between items-center">
                              <h3 className="font-bold text-yellow-900 text-sm flex items-center gap-2 uppercase tracking-wide">
                                  <AlertTriangle size={18} /> Intrusos / Outro Local
                              </h3>
                              <span className="bg-yellow-300 text-yellow-900 text-xs font-black px-2 py-1 rounded-lg">{auditResult.intruders.length}</span>
                          </div>
                          <div className="p-2 space-y-2">
                              {auditResult.intruders.map(asset => (
                                  <div key={asset.id} className="p-3 bg-white rounded-xl border border-yellow-100 flex justify-between items-center shadow-sm">
                                      <div>
                                          <p className="font-black text-sm text-gray-900">{asset.internalId}</p>
                                          <p className="text-xs text-gray-500 font-medium">{asset.model}</p>
                                          <p className="text-[10px] text-red-500 font-bold mt-1">Pertence a: {asset.location}</p>
                                      </div>
                                      <button 
                                        className="text-[10px] bg-black text-white px-3 py-2 rounded-lg font-bold uppercase tracking-wide hover:bg-gray-800"
                                        onClick={() => alert("Funcionalidade de transferência rápida em breve!")}
                                      >
                                          Transferir
                                      </button>
                                  </div>
                              ))}
                          </div>
                      </div>
                  )}

              </div>
          </div>
      )}

      {/* COMPONENTE DE CÂMERA (QR Code) */}
      {isScannerOpen && (
          <QRScanner 
            onClose={() => setIsScannerOpen(false)} 
            onScan={handleScan}
          />
      )}
    </div>
  );
};

export default AuditPage;