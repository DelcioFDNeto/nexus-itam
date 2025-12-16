// src/pages/AuditPage.jsx
import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../services/firebase';
import { collection, query, onSnapshot, orderBy, doc, updateDoc, serverTimestamp, addDoc } from 'firebase/firestore'; // MUDANÇA: Imports de escrita
import QRScanner from '../components/QRScanner';
import { 
  ClipboardCheck, MapPin, Scan, CheckCircle, XCircle, AlertTriangle, ArrowLeft, 
  ArrowRightLeft, Search, Save
} from 'lucide-react';

const AuditPage = () => {
  const navigate = useNavigate();
  
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);

  const [selectedLocation, setSelectedLocation] = useState('');
  const [scannedIds, setScannedIds] = useState(new Set()); 
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [lastScanned, setLastScanned] = useState(null);
  
  // NOVO: Busca Manual para etiquetas rasgadas
  const [manualSearch, setManualSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, 'assets'), orderBy('location', 'asc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const assetData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setAssets(assetData);
      setLoading(false);
    }, (error) => {
      console.error("Erro ao carregar ativos:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const locations = useMemo(() => {
      const uniqueLocs = [...new Set(assets.map(a => a.location).filter(Boolean))];
      return uniqueLocs.sort();
  }, [assets]);

  const expectedAssets = useMemo(() => {
      if (!selectedLocation) return [];
      
      return assets.filter(a => 
          a.location === selectedLocation && 
          a.status !== 'Baixado' && 
          a.status !== 'Descarte' &&
          a.category !== 'Promocional' && 
          !a.internalId?.includes('PRM')
      );
  }, [assets, selectedLocation]);

  const auditResult = useMemo(() => {
      const found = [];
      const missing = [];
      const intruders = []; 

      expectedAssets.forEach(asset => {
          if (scannedIds.has(asset.internalId)) {
              found.push(asset);
          } else {
              missing.push(asset);
          }
      });

      scannedIds.forEach(id => {
          const asset = assets.find(a => a.internalId === id);
          if (asset && asset.location !== selectedLocation && asset.category !== 'Promocional' && !asset.internalId?.includes('PRM')) {
              intruders.push(asset);
          }
      });

      return { found, missing, intruders };
  }, [expectedAssets, scannedIds, assets, selectedLocation]);

  const progress = expectedAssets.length > 0 
      ? Math.round((auditResult.found.length / expectedAssets.length) * 100) 
      : 0;

  // --- MUDANÇA 1: PERSISTÊNCIA REALTIME ---
  const handleScan = async (code) => {
      if (!code) return;
      
      const cleanCode = code.trim().toUpperCase(); // Sanitização
      if (navigator.vibrate) navigator.vibrate(200);
      
      // Atualiza visualmente primeiro (UI Optimista)
      setScannedIds(prev => new Set(prev).add(cleanCode));
      setLastScanned(cleanCode);

      // Encontra o ativo para atualizar no banco
      const asset = assets.find(a => a.internalId === cleanCode);
      if (asset) {
          try {
              const assetRef = doc(db, 'assets', asset.id);
              await updateDoc(assetRef, {
                  lastAudit: serverTimestamp(), // Marca data da auditoria
                  auditStatus: 'Conforme'
              });
          } catch (error) {
              console.error("Erro ao salvar auditoria:", error);
          }
      }
  };

  // --- MUDANÇA 2: FUNÇÃO PARA ADOTAR INTRUSO ---
  const handleMoveIntruder = async (asset) => {
      if (!confirm(`Transferir ${asset.model} de "${asset.location}" para "${selectedLocation}"?`)) return;
      
      try {
          const assetRef = doc(db, 'assets', asset.id);
          await updateDoc(assetRef, {
              location: selectedLocation, // Move para cá
              lastAudit: serverTimestamp(),
              auditStatus: 'Movimentado na Auditoria'
          });
          // O onSnapshot vai atualizar a lista e ele sairá de "Intrusos" para "Encontrados" automaticamente
      } catch (error) {
          alert("Erro ao mover ativo.");
      }
  };

  // --- MUDANÇA 3: FINALIZAR E GERAR RELATÓRIO ---
  const handleFinishAudit = async () => {
      if (!confirm("Finalizar auditoria e salvar relatório?")) return;
      
      try {
          await addDoc(collection(db, 'audits'), {
              location: selectedLocation,
              date: serverTimestamp(),
              totalExpected: expectedAssets.length,
              totalFound: auditResult.found.length,
              totalMissing: auditResult.missing.length,
              totalIntruders: auditResult.intruders.length,
              missingItems: auditResult.missing.map(a => a.internalId),
              intruderItems: auditResult.intruders.map(a => a.internalId),
              status: progress === 100 ? 'Completa' : 'Parcial'
          });
          alert("Auditoria salva no histórico!");
          setSelectedLocation('');
          setScannedIds(new Set());
      } catch (error) {
          alert("Erro ao salvar relatório.");
      }
  };

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto pb-24">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => navigate('/')} className="p-3 bg-white rounded-xl hover:bg-gray-100 shadow-sm border border-gray-200">
            <ArrowLeft size={20} />
        </button>
        <div>
            <h1 className="text-xl md:text-2xl font-black text-gray-900 flex items-center gap-2">
                <ClipboardCheck className="text-shineray" /> Auditoria
            </h1>
            <p className="text-xs text-gray-500 font-bold uppercase tracking-wide">Conferência Física</p>
        </div>
      </div>

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
                    setScannedIds(new Set()); 
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
              
              {/* PLACAR */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-black text-white p-6 rounded-2xl relative overflow-hidden shadow-xl">
                      <div className="relative z-10 flex justify-between items-end">
                          <div>
                            <p className="text-gray-400 text-[10px] font-black uppercase tracking-widest mb-1">Progresso</p>
                            <h2 className="text-5xl font-black tracking-tighter">{progress}%</h2>
                          </div>
                          <div className="text-right">
                              <p className="text-2xl font-bold">{auditResult.found.length} <span className="text-gray-500 text-base">/ {expectedAssets.length}</span></p>
                              {auditResult.missing.length === 0 && <span className="text-xs text-green-400 font-bold">Concluído!</span>}
                          </div>
                      </div>
                      <div className="absolute bottom-0 left-0 h-1.5 bg-gray-800 w-full">
                        <div className={`h-full transition-all duration-500 ${progress === 100 ? 'bg-green-500' : 'bg-shineray'}`} style={{ width: `${progress}%` }}></div>
                      </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button 
                        onClick={() => setIsScannerOpen(true)}
                        className="bg-shineray hover:bg-red-700 text-white p-4 rounded-2xl flex flex-col items-center justify-center gap-2 transition-all active:scale-95 shadow-lg shadow-red-600/20 border-2 border-red-500 col-span-2 md:col-span-1"
                    >
                        <Scan size={32} />
                        <span className="font-black text-sm uppercase tracking-wide">Ler QR Code</span>
                    </button>
                    
                    {/* Botão Finalizar */}
                    <button 
                        onClick={handleFinishAudit}
                        disabled={progress === 0}
                        className="bg-white border-2 border-gray-200 text-gray-700 p-4 rounded-2xl flex flex-col items-center justify-center gap-2 hover:bg-gray-50 transition-all col-span-2 md:col-span-1 disabled:opacity-50"
                    >
                        <Save size={32} className="text-green-600"/>
                        <span className="font-bold text-sm uppercase tracking-wide">Finalizar</span>
                    </button>
                  </div>
              </div>

              {lastScanned && (
                  <div className="bg-blue-50 border border-blue-200 p-3 rounded-xl text-center animate-pulse">
                      <p className="text-[10px] text-blue-600 font-black uppercase tracking-widest">Última Leitura</p>
                      <p className="text-xl font-mono font-black text-blue-900 tracking-tight">{lastScanned}</p>
                  </div>
              )}

              {/* LISTAS */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  
                  {/* PENDENTES */}
                  <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm flex flex-col h-[500px]">
                      <div className="bg-red-50 p-4 border-b border-red-100 flex justify-between items-center">
                          <h3 className="font-bold text-red-800 text-sm flex items-center gap-2 uppercase tracking-wide">
                              <XCircle size={18} /> Pendentes ({auditResult.missing.length})
                          </h3>
                          {/* Busca Manual Rápida */}
                          <div className="relative">
                             <Search size={14} className="absolute left-2 top-2 text-red-300"/>
                             <input 
                                value={manualSearch}
                                onChange={e => setManualSearch(e.target.value)}
                                placeholder="Busca manual..."
                                className="pl-6 pr-2 py-1 text-xs border border-red-200 rounded-lg bg-white focus:outline-none focus:border-red-400 w-32"
                             />
                          </div>
                      </div>
                      <div className="flex-1 overflow-y-auto p-2">
                          {auditResult.missing
                            .filter(a => a.model.toLowerCase().includes(manualSearch.toLowerCase()) || a.internalId.toLowerCase().includes(manualSearch.toLowerCase()))
                            .map(asset => (
                              <div key={asset.id} className="p-3 border-b border-gray-50 last:border-0 hover:bg-gray-50 flex justify-between items-center group">
                                  <div onClick={() => handleScan(asset.internalId)} className="cursor-pointer flex-1">
                                      <p className="font-bold text-sm text-gray-900">{asset.model}</p>
                                      <p className="font-mono text-xs text-gray-400 font-bold">{asset.internalId}</p>
                                  </div>
                                  <button onClick={() => handleScan(asset.internalId)} className="text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded hover:bg-green-100 hover:text-green-700 transition-colors">
                                      Marcar
                                  </button>
                              </div>
                          ))}
                          {auditResult.missing.length === 0 && <div className="p-8 text-center"><CheckCircle size={40} className="text-green-200 mx-auto mb-2"/><p className="text-green-600 font-bold text-sm">Tudo encontrado!</p></div>}
                      </div>
                  </div>

                  {/* ENCONTRADOS E INTRUSOS */}
                  <div className="flex flex-col gap-4 h-[500px]">
                      
                      {/* Intrusos (Prioridade Visual) */}
                      {auditResult.intruders.length > 0 && (
                          <div className="bg-yellow-50 rounded-2xl border border-yellow-200 overflow-hidden shadow-sm flex-shrink-0 max-h-[40%] overflow-y-auto">
                              <div className="bg-yellow-100 p-3 flex justify-between items-center sticky top-0">
                                  <h3 className="font-bold text-yellow-900 text-xs flex items-center gap-2 uppercase tracking-wide">
                                      <AlertTriangle size={16} /> Intrusos ({auditResult.intruders.length})
                                  </h3>
                              </div>
                              <div className="p-2 space-y-2">
                                  {auditResult.intruders.map(asset => (
                                      <div key={asset.id} className="p-3 bg-white rounded-xl border border-yellow-100 flex justify-between items-center shadow-sm">
                                          <div>
                                              <p className="font-black text-xs text-gray-900">{asset.internalId}</p>
                                              <p className="text-[10px] text-red-500 font-bold">Local Origem: {asset.location}</p>
                                          </div>
                                          <button 
                                            onClick={() => handleMoveIntruder(asset)}
                                            className="flex items-center gap-1 bg-yellow-200 hover:bg-yellow-300 text-yellow-800 text-[10px] font-bold px-2 py-1.5 rounded-lg transition-colors"
                                          >
                                              <ArrowRightLeft size={12}/> Mover pra cá
                                          </button>
                                      </div>
                                  ))}
                              </div>
                          </div>
                      )}

                      {/* Ok / Encontrados */}
                      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm flex-1 flex flex-col">
                          <div className="bg-green-50 p-4 border-b border-green-100">
                              <h3 className="font-bold text-green-800 text-sm flex items-center gap-2 uppercase tracking-wide">
                                  <CheckCircle size={18} /> Ok ({auditResult.found.length})
                              </h3>
                          </div>
                          <div className="flex-1 overflow-y-auto p-2">
                              {auditResult.found.map(asset => (
                                  <div key={asset.id} className="p-3 border-b border-gray-50 last:border-0 bg-green-50/30 flex justify-between items-center">
                                      <div>
                                          <p className="font-bold text-sm text-gray-900">{asset.model}</p>
                                          <p className="font-mono text-xs text-green-600 font-bold">{asset.internalId}</p>
                                      </div>
                                      <CheckCircle size={16} className="text-green-500" />
                                  </div>
                              ))}
                          </div>
                      </div>
                  </div>
              </div>
          </div>
      )}

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