// src/pages/AuditPage.jsx
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../services/firebase';
import { collection, query, onSnapshot, orderBy, doc, updateDoc, serverTimestamp, addDoc } from 'firebase/firestore'; 
import QRScanner from '../components/QRScanner';
import { 
  ClipboardCheck, MapPin, Scan, CheckCircle, XCircle, AlertTriangle, ArrowLeft, 
  ArrowRightLeft, Search, Save, List, Clock
} from 'lucide-react';

const AuditPage = () => {
  const navigate = useNavigate();
  
  // Estados
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedLocation, setSelectedLocation] = useState('');
  
  // Auditoria
  const [scannedIds, setScannedIds] = useState(new Set()); 
  const [sessionLog, setSessionLog] = useState([]); // LOG DETALHADO DA SESSÃO
  
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [manualSearch, setManualSearch] = useState('');
  
  // Refs
  const logEndRef = useRef(null);

  // Scroll automático para o fim do log
  useEffect(() => {
      logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [sessionLog]);

  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, 'assets'), orderBy('location', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const assetData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setAssets(assetData);
      setLoading(false);
    }, (error) => { console.error(error); setLoading(false); });
    return () => unsubscribe();
  }, []);

  const locations = useMemo(() => [...new Set(assets.map(a => a.location).filter(Boolean))].sort(), [assets]);

  const expectedAssets = useMemo(() => {
      if (!selectedLocation) return [];
      return assets.filter(a => 
          a.location === selectedLocation && 
          !['Baixado', 'Descarte'].includes(a.status) &&
          a.category !== 'Promocional' && 
          !a.internalId?.includes('PRM')
      );
  }, [assets, selectedLocation]);

  const auditResult = useMemo(() => {
      const found = [];
      const missing = [];
      const intruders = []; 

      expectedAssets.forEach(asset => {
          if (scannedIds.has(asset.internalId)) found.push(asset);
          else missing.push(asset);
      });

      scannedIds.forEach(id => {
          const asset = assets.find(a => a.internalId === id);
          if (asset && asset.location !== selectedLocation && asset.category !== 'Promocional' && !asset.internalId?.includes('PRM')) {
              intruders.push(asset);
          }
      });

      return { found, missing, intruders };
  }, [expectedAssets, scannedIds, assets, selectedLocation]);

  const progress = expectedAssets.length > 0 ? Math.round((auditResult.found.length / expectedAssets.length) * 100) : 0;

  // --- LOGIC: SCAN & LOGGING ---
  const handleScan = async (code) => {
      if (!code) return;
      const cleanCode = code.trim().toUpperCase();
      
      // Evita duplicidade no log visual (opcional)
      // if (scannedIds.has(cleanCode)) return; 

      if (navigator.vibrate) navigator.vibrate(200);
      setScannedIds(prev => new Set(prev).add(cleanCode));

      const asset = assets.find(a => a.internalId === cleanCode);
      const isExpected = asset && asset.location === selectedLocation;
      const isIntruder = asset && asset.location !== selectedLocation;
      const isUnknown = !asset;

      // Adiciona ao Log Detalhado
      const newLogEntry = {
          time: new Date(),
          code: cleanCode,
          model: asset?.model || 'Desconhecido',
          status: isExpected ? 'Sucesso' : isIntruder ? 'Intruso' : 'Não Cadastrado',
          type: isExpected ? 'success' : isIntruder ? 'warning' : 'error'
      };
      setSessionLog(prev => [...prev, newLogEntry]);

      // Persistência no Banco (apenas se existe)
      if (asset) {
          try {
              const assetRef = doc(db, 'assets', asset.id);
              await updateDoc(assetRef, {
                  lastAudit: serverTimestamp(),
                  auditStatus: isExpected ? 'Conforme' : 'Local Divergente'
              });
          } catch (error) { console.error(error); }
      }
  };

  const handleMoveIntruder = async (asset) => {
      if (!confirm(`Transferir ${asset.model} para "${selectedLocation}"?`)) return;
      try {
          const assetRef = doc(db, 'assets', asset.id);
          await updateDoc(assetRef, { location: selectedLocation, lastAudit: serverTimestamp(), auditStatus: 'Movimentado Audit' });
          setSessionLog(prev => [...prev, { time: new Date(), code: asset.internalId, model: asset.model, status: 'Movido', type: 'info' }]);
      } catch (error) { alert("Erro ao mover."); }
  };

  const handleFinishAudit = async () => {
      if (!confirm("Finalizar e salvar relatório?")) return;
      try {
          await addDoc(collection(db, 'audits'), {
              location: selectedLocation,
              date: serverTimestamp(),
              stats: {
                  expected: expectedAssets.length,
                  found: auditResult.found.length,
                  missing: auditResult.missing.length,
                  intruders: auditResult.intruders.length
              },
              missingItems: auditResult.missing.map(a => a.internalId),
              intruderItems: auditResult.intruders.map(a => a.internalId),
              status: progress === 100 ? 'Completa' : 'Parcial'
          });
          alert("Auditoria salva!");
          setSelectedLocation('');
          setScannedIds(new Set());
          setSessionLog([]);
      } catch (error) { alert("Erro ao salvar."); }
  };

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto pb-24 h-screen flex flex-col">
      
      <div className="flex items-center gap-4 mb-4 shrink-0">
        <button onClick={() => navigate('/')} className="p-3 bg-white rounded-xl hover:bg-gray-100 shadow-sm border border-gray-200"><ArrowLeft size={20} /></button>
        <div>
            <h1 className="text-xl md:text-2xl font-black text-gray-900 flex items-center gap-2"><ClipboardCheck className="text-shineray" /> Auditoria</h1>
            <p className="text-xs text-gray-500 font-bold uppercase tracking-wide">Conferência Física</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 overflow-hidden">
        
        {/* ESQUERDA: CONTROLES */}
        <div className="lg:col-span-1 flex flex-col gap-4 overflow-y-auto">
            
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200">
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-2"><MapPin size={14} /> Local</label>
                <div className="relative">
                    <select 
                        className="w-full p-3 border-2 border-gray-100 rounded-xl bg-gray-50 focus:border-black outline-none font-bold text-gray-800 appearance-none"
                        value={selectedLocation}
                        onChange={(e) => { setSelectedLocation(e.target.value); setScannedIds(new Set()); setSessionLog([]); }}
                    >
                        <option value="">-- Selecionar --</option>
                        {locations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
                    </select>
                    <div className="absolute right-4 top-4 text-gray-400 pointer-events-none">▼</div>
                </div>
            </div>

            {selectedLocation && (
                <>
                    <div className="bg-black text-white p-6 rounded-2xl shadow-xl">
                        <div className="flex justify-between items-end mb-4">
                            <div><p className="text-gray-400 text-[10px] font-black uppercase tracking-widest">Progresso</p><h2 className="text-5xl font-black tracking-tighter">{progress}%</h2></div>
                            <div className="text-right"><p className="text-2xl font-bold">{auditResult.found.length} <span className="text-gray-500 text-base">/ {expectedAssets.length}</span></p></div>
                        </div>
                        <div className="w-full bg-gray-800 h-1.5 rounded-full overflow-hidden">
                            <div className="h-full bg-green-500 transition-all duration-500" style={{ width: `${progress}%` }}></div>
                        </div>
                        <div className="grid grid-cols-2 gap-4 mt-6">
                            <button onClick={() => setIsScannerOpen(true)} className="bg-shineray hover:bg-red-700 text-white p-3 rounded-xl flex flex-col items-center justify-center gap-1 transition-all active:scale-95 shadow-lg border border-red-500"><Scan size={24} /><span className="font-bold text-xs uppercase">Scan</span></button>
                            <button onClick={handleFinishAudit} disabled={progress === 0} className="bg-white text-black p-3 rounded-xl flex flex-col items-center justify-center gap-1 hover:bg-gray-100 transition-all disabled:opacity-50"><Save size={24}/><span className="font-bold text-xs uppercase">Finalizar</span></button>
                        </div>
                    </div>

                    {/* CONSOLE DE LOG (NOVO) */}
                    <div className="flex-1 bg-gray-900 rounded-2xl border border-gray-800 p-4 flex flex-col min-h-[300px]">
                        <h3 className="text-xs font-bold text-gray-500 uppercase mb-2 flex items-center gap-2"><List size={14}/> Log da Sessão</h3>
                        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1 font-mono text-xs">
                            {sessionLog.length === 0 && <p className="text-gray-600 text-center mt-10">Aguardando leituras...</p>}
                            {sessionLog.map((entry, i) => (
                                <div key={i} className="flex gap-3 text-gray-300 border-b border-gray-800 pb-1 mb-1">
                                    <span className="text-gray-500 w-12 shrink-0">{entry.time.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'})}</span>
                                    <span className={`font-bold w-24 shrink-0 ${entry.type === 'success' ? 'text-green-400' : entry.type === 'warning' ? 'text-yellow-400' : 'text-red-400'}`}>{entry.code}</span>
                                    <span className="truncate flex-1 text-gray-400">{entry.status}</span>
                                </div>
                            ))}
                            <div ref={logEndRef} />
                        </div>
                    </div>
                </>
            )}
        </div>

        {/* DIREITA: LISTAS */}
        {selectedLocation && (
            <div className="lg:col-span-2 flex flex-col gap-6 overflow-y-auto">
                
                {/* Intrusos (Destaque) */}
                {auditResult.intruders.length > 0 && (
                    <div className="bg-yellow-50 rounded-2xl border border-yellow-200 p-4 animate-in slide-in-from-right">
                        <div className="flex justify-between items-center mb-2">
                            <h3 className="font-bold text-yellow-900 text-sm flex items-center gap-2 uppercase tracking-wide"><AlertTriangle size={16} /> Intrusos ({auditResult.intruders.length})</h3>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {auditResult.intruders.map(asset => (
                                <div key={asset.id} className="p-2 bg-white rounded-lg border border-yellow-100 flex justify-between items-center shadow-sm">
                                    <div><p className="font-black text-xs text-gray-900">{asset.internalId}</p><p className="text-[10px] text-red-500 font-bold">Origem: {asset.location}</p></div>
                                    <button onClick={() => handleMoveIntruder(asset)} className="bg-yellow-200 hover:bg-yellow-300 text-yellow-900 p-1.5 rounded-lg"><ArrowRightLeft size={14}/></button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Pendentes e Encontrados */}
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm flex-1 flex flex-col overflow-hidden">
                    <div className="flex border-b border-gray-100">
                        <div className="flex-1 p-4 bg-red-50/50 border-r border-gray-100">
                            <div className="flex justify-between items-center mb-3">
                                <h3 className="font-bold text-red-800 text-sm flex items-center gap-2"><XCircle size={16} /> Pendentes ({auditResult.missing.length})</h3>
                                <div className="relative w-32"><Search size={12} className="absolute left-2 top-2 text-red-300"/><input value={manualSearch} onChange={e => setManualSearch(e.target.value)} placeholder="Busca..." className="w-full pl-6 py-1 text-[10px] border border-red-100 rounded-md bg-white focus:outline-none"/></div>
                            </div>
                            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
                                {auditResult.missing
                                    .filter(a => a.model.toLowerCase().includes(manualSearch.toLowerCase()) || a.internalId.toLowerCase().includes(manualSearch.toLowerCase()))
                                    .map(asset => (
                                    <div key={asset.id} className="flex justify-between items-center p-2 hover:bg-red-50 rounded border border-transparent hover:border-red-100 group">
                                        <div><p className="font-bold text-xs text-gray-900">{asset.model}</p><p className="font-mono text-[10px] text-gray-400">{asset.internalId}</p></div>
                                        <button onClick={() => handleScan(asset.internalId)} className="text-[10px] bg-white border border-gray-200 px-2 py-1 rounded hover:bg-black hover:text-white transition-colors opacity-0 group-hover:opacity-100">Manual</button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="flex-1 p-4 bg-green-50/30">
                            <h3 className="font-bold text-green-800 text-sm flex items-center gap-2 mb-3"><CheckCircle size={16} /> Encontrados ({auditResult.found.length})</h3>
                            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
                                {auditResult.found.map(asset => (
                                    <div key={asset.id} className="flex justify-between items-center p-2 bg-green-50/50 rounded border border-green-100">
                                        <div><p className="font-bold text-xs text-gray-900">{asset.model}</p><p className="font-mono text-[10px] text-green-700">{asset.internalId}</p></div>
                                        <CheckCircle size={14} className="text-green-500" />
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        )}
      </div>

      {isScannerOpen && <QRScanner onClose={() => setIsScannerOpen(false)} onScan={handleScan} />}
    </div>
  );
};

export default AuditPage;