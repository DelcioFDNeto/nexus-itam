// src/pages/AuditPage.jsx
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../services/firebase';
import { collection, query, onSnapshot, orderBy, doc, updateDoc, serverTimestamp, addDoc } from 'firebase/firestore'; 
import { 
  ClipboardCheck, MapPin, Scan, CheckCircle, XCircle, AlertTriangle, ArrowLeft, 
  ArrowRightLeft, Search, Save, List, Clock, Box, Play, Check, X, AlertOctagon, Volume2, VolumeX, Smartphone
} from 'lucide-react';
import { toast } from 'sonner';
import QRScanner from '../components/QRScanner';
import AssetIcon from '../components/AssetIcon';

const AuditPage = () => {
  const navigate = useNavigate();
  
  // DATA STATES
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // SESSION STATES
  const [selectedLocation, setSelectedLocation] = useState(null); // null = Selection Mode
  const [scannedIds, setScannedIds] = useState(new Set()); 
  const [sessionLog, setSessionLog] = useState([]);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  
  // UX STATES
  const [viewMode, setViewMode] = useState('scan'); // 'scan', 'list'
  const [lastScanResult, setLastScanResult] = useState(null); // { type: 'success'|'error'|'warning', msg: '', item: {} }
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [manualSearch, setManualSearch] = useState('');

  // SOUND EFFECTS
  const playSound = (type) => {
    if (!soundEnabled) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'success') {
        osc.frequency.setValueAtTime(800, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
        osc.start();
        osc.stop(ctx.currentTime + 0.15);
    } else if (type === 'error') {
        osc.frequency.setValueAtTime(300, ctx.currentTime);
        osc.type = 'sawtooth';
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
    } else { // warning
        osc.frequency.setValueAtTime(500, ctx.currentTime);
        osc.type = 'square';
        gain.gain.setValueAtTime(0.05, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
        osc.start();
        osc.stop(ctx.currentTime + 0.2);
    }
  };

  // DATA FETCHING
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

  // COMPUTED DATA
  const locationsData = useMemo(() => {
    const locs = {};
    assets.forEach(asset => {
        if (!asset.location) return;
        if (!locs[asset.location]) locs[asset.location] = { name: asset.location, count: 0, preview: [] };
        // Filtrar 'Baixado' e 'Descarte' da contagem esperada de auditoria
        if (!['Baixado', 'Descarte'].includes(asset.status) && asset.category !== 'Promocional' && !asset.internalId?.includes('PRM')) {
            locs[asset.location].count++;
        }
    });
    return Object.values(locs).sort((a,b) => a.name.localeCompare(b.name));
  }, [assets]);

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

  // --- ACTIONS ---

  const handleScan = async (code) => {
      if (!code) return;
      const cleanCode = code.trim().toUpperCase();
      
      const asset = assets.find(a => a.internalId === cleanCode);
      const isExpected = asset && asset.location === selectedLocation;
      const isIntruder = asset && asset.location !== selectedLocation;

      // FEEDBACK LOGIC
      if (isExpected) {
          if (scannedIds.has(cleanCode)) {
              setLastScanResult({ type: 'warning', msg: 'Já auditado', item: asset, code: cleanCode });
              playSound('warning');
          } else {
              setLastScanResult({ type: 'success', msg: 'Confirmado', item: asset, code: cleanCode });
              playSound('success');
              setScannedIds(prev => new Set(prev).add(cleanCode));
              
              // Persistência
              try {
                  const assetRef = doc(db, 'assets', asset.id);
                  await updateDoc(assetRef, {
                      lastAudit: serverTimestamp(),
                      auditStatus: 'Conforme'
                  });
              } catch (error) { console.error(error); }
          }
      } else if (isIntruder) {
          setLastScanResult({ type: 'warning', msg: 'Intruso Detectado!', item: asset, code: cleanCode });
          playSound('warning');
          setScannedIds(prev => new Set(prev).add(cleanCode));
      } else {
          setLastScanResult({ type: 'error', msg: 'Não Encontrado', item: null, code: cleanCode });
          playSound('error');
      }

      // Add to Log if new or important
      setSessionLog(prev => [{ time: new Date(), code: cleanCode, status: isExpected ? 'OK' : isIntruder ? 'INTRUSO' : 'ERRO' }, ...prev]);
  };

  const handleManualInput = (e) => {
      e.preventDefault();
      handleScan(manualSearch);
      setManualSearch('');
  };

  const handleFinishAudit = async () => {
      if (!confirm(`Finalizar conferência de ${selectedLocation}?`)) return;
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
          toast.success("Auditoria salva com sucesso!");
          setSelectedLocation(null);
          setScannedIds(new Set());
          setSessionLog([]);
          setLastScanResult(null);
      } catch (error) { toast.error("Erro ao salvar."); }
  };

  // --- RENDERING ---

  if (loading) return <div className="flex h-screen items-center justify-center bg-gray-50"><div className="animate-spin rounded-full h-12 w-12 border-b-4 border-black"></div></div>;

  // 1. SELECTION SCREEN
  if (!selectedLocation) {
      return (
        <div className="p-4 md:p-8 min-h-screen bg-gray-50">
            <header className="flex items-center gap-4 mb-8">
                <button onClick={() => navigate('/')} className="p-3 bg-white rounded-xl shadow-sm hover:scale-105 transition-transform"><ArrowLeft size={24}/></button>
                <div>
                   <h1 className="text-3xl font-black text-gray-900 tracking-tight">Nova Auditoria</h1>
                   <p className="text-gray-500">Selecione o local para iniciar a conferência.</p>
                </div>
            </header>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {locationsData.map((loc) => (
                    <button 
                        key={loc.name}
                        onClick={() => setSelectedLocation(loc.name)}
                        className="group relative overflow-hidden bg-white p-6 rounded-3xl border border-gray-200 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all text-left"
                    >
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                            <MapPin size={64} className="text-black transform rotate-12"/>
                        </div>
                        <h3 className="text-xl font-black text-gray-900 mb-2">{loc.name}</h3>
                        <div className="flex items-center gap-2">
                             <span className="bg-black text-white px-3 py-1 rounded-lg text-xs font-bold">{loc.count} Ativos</span>
                             {loc.count === 0 && <span className="text-xs text-red-500 font-bold">Vazio</span>}
                        </div>
                    </button>
                ))}
            </div>
            {locationsData.length === 0 && <div className="text-center py-20 text-gray-400">Nenhum local com ativos encontrado.</div>}
        </div>
      );
  }

  // 2. AUDIT HUD (ACTIVE MODE)
  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white overflow-hidden">
        
        {/* TOP BAR */}
        <div className="px-4 py-4 bg-gray-900 border-b border-gray-800 flex justify-between items-center shrink-0">
             <div className="flex items-center gap-3">
                 <button onClick={() => { if(confirm('Sair da auditoria?')) setSelectedLocation(null); }} className="p-2 rounded-full bg-gray-800 text-gray-400 hover:text-white"><ArrowLeft size={20}/></button>
                 <div>
                     <h2 className="font-bold text-lg leading-none">{selectedLocation}</h2>
                     <p className="text-[10px] text-gray-400 uppercase tracking-widest">{expectedAssets.length} ITENS ESPERADOS</p>
                 </div>
             </div>
             <button onClick={() => setSoundEnabled(!soundEnabled)} className={`p-3 rounded-full ${soundEnabled ? 'bg-gray-800 text-green-400' : 'bg-gray-800 text-gray-500'}`}>
                 {soundEnabled ? <Volume2 size={20}/> : <VolumeX size={20}/>}
             </button>
        </div>

        {/* PROGRESS BAR */}
        <div className="w-full bg-gray-800 h-2 shrink-0">
             <div className="h-full bg-green-500 transition-all duration-500 shadow-[0_0_10px_#22c55e]" style={{ width: `${progress}%` }}></div>
        </div>

        {/* MAIN CONTENT AREA */}
        <div className="flex-1 relative bg-gray-900 overflow-y-auto">
            
            {/* VIEW: SCANNER MODE */}
            {viewMode === 'scan' && (
                <div className="flex flex-col items-center justify-center min-h-full p-6 gap-8">
                    
                    {/* FEEDBACK CARD (CENTRAL) */}
                    <div className={`
                        w-full max-w-sm aspect-square rounded-[3rem] flex flex-col items-center justify-center p-8 text-center transition-all duration-300 shadow-2xl border-4
                        ${!lastScanResult ? 'bg-gray-800 border-gray-700' : 
                          lastScanResult.type === 'success' ? 'bg-green-600 border-green-400 shadow-green-900/50' :
                          lastScanResult.type === 'error' ? 'bg-red-600 border-red-400 shadow-red-900/50' : 
                          'bg-yellow-600 border-yellow-400 shadow-yellow-900/50'}
                    `}>
                        {!lastScanResult ? (
                            <>
                                <Scan size={64} className="text-gray-600 mb-4 opacity-50"/>
                                <p className="text-gray-500 font-bold text-lg">Aguardando Leitura...</p>
                                <p className="text-gray-600 text-sm mt-2">Use o scanner ou digite abaixo</p>
                            </>
                        ) : (
                            <div className="animate-in zoom-in duration-300">
                                {lastScanResult.type === 'success' && <CheckCircle size={80} className="text-white mb-4 mx-auto"/>}
                                {lastScanResult.type === 'error' && <XCircle size={80} className="text-white mb-4 mx-auto"/>}
                                {lastScanResult.type === 'warning' && <AlertTriangle size={80} className="text-white mb-4 mx-auto"/>}
                                
                                <h2 className="text-3xl font-black text-white mb-2 uppercase">{lastScanResult.msg}</h2>
                                <p className="text-white/80 font-mono text-xl">{lastScanResult.code}</p>
                                {lastScanResult.item && <p className="text-white font-bold mt-2 bg-black/20 px-3 py-1 rounded-lg">{lastScanResult.item.model}</p>}
                            </div>
                        )}
                    </div>

                    {/* MANUAL INPUT */}
                    <form onSubmit={handleManualInput} className="w-full max-w-sm relative">
                        <input 
                            value={manualSearch}
                            onChange={e => setManualSearch(e.target.value)}
                            placeholder="Digitar código..."
                            className="w-full bg-gray-800 border-2 border-gray-700 text-white p-4 pl-12 rounded-2xl outline-none focus:border-brand font-mono text-lg transition-all"
                        />
                        <Search className="absolute left-4 top-5 text-gray-500" size={20}/>
                    </form>

                    {/* ACTIONS */}
                    <div className="grid grid-cols-2 gap-4 w-full max-w-sm">
                        <button onClick={() => setIsScannerOpen(true)} className="bg-white text-black py-4 rounded-xl font-black uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-gray-200 active:scale-95 transition-all">
                            <Smartphone size={20}/> Câmera
                        </button>
                        <button onClick={() => setViewMode('list')} className="bg-gray-800 text-white py-4 rounded-xl font-black uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-gray-700 active:scale-95 transition-all border border-gray-700">
                            <List size={20}/> Detalhes
                        </button>
                    </div>

                </div>
            )}

            {/* VIEW: LIST MODE */}
            {viewMode === 'list' && (
                <div className="p-4 space-y-6">
                    {/* STATS */}
                    <div className="grid grid-cols-3 gap-2">
                        <div className="bg-gray-800 p-3 rounded-xl border border-gray-700 text-center">
                            <p className="text-[10px] text-gray-400 uppercase font-black">Faltam</p>
                            <p className="text-2xl font-black text-red-500">{auditResult.missing.length}</p>
                        </div>
                        <div className="bg-gray-800 p-3 rounded-xl border border-gray-700 text-center">
                            <p className="text-[10px] text-gray-400 uppercase font-black">Achados</p>
                            <p className="text-2xl font-black text-green-500">{auditResult.found.length}</p>
                        </div>
                        <div className="bg-gray-800 p-3 rounded-xl border border-gray-700 text-center">
                            <p className="text-[10px] text-gray-400 uppercase font-black">Intrusos</p>
                            <p className="text-2xl font-black text-yellow-500">{auditResult.intruders.length}</p>
                        </div>
                    </div>

                    {/* INTRUDERS LIST */}
                    {auditResult.intruders.length > 0 && (
                        <div className="space-y-2">
                            <h3 className="text-yellow-500 font-bold text-xs uppercase flex items-center gap-2"><AlertTriangle size={14}/> Itens de Outros Setores</h3>
                            {auditResult.intruders.map(asset => (
                                <div key={asset.id} className="bg-yellow-900/20 border border-yellow-500/30 p-3 rounded-xl flex justify-between items-center">
                                    <div>
                                        <p className="text-yellow-100 font-bold text-sm">{asset.model}</p>
                                        <p className="text-yellow-500/70 text-xs font-mono">{asset.internalId} • De: {asset.location}</p>
                                    </div>
                                    <AlertOctagon size={16} className="text-yellow-500"/>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* MISSING LIST */}
                    <div className="space-y-2">
                         <h3 className="text-red-500 font-bold text-xs uppercase flex items-center gap-2"><XCircle size={14}/> Pendentes</h3>
                         {auditResult.missing.map(asset => (
                             <div key={asset.id} className="bg-gray-800 border border-gray-700 p-3 rounded-xl flex justify-between items-center opacity-80">
                                 <div className="flex items-center gap-3">
                                     <div className="w-8 h-8 rounded bg-gray-700 flex items-center justify-center text-gray-400"><Box size={14}/></div>
                                     <div>
                                         <p className="text-gray-300 font-bold text-sm">{asset.model}</p>
                                         <p className="text-gray-600 text-xs font-mono">{asset.internalId}</p>
                                     </div>
                                 </div>
                             </div>
                         ))}
                    </div>
                    
                    <button onClick={() => setViewMode('scan')} className="w-full py-4 bg-gray-800 text-white font-bold rounded-xl mt-4">
                        Voltar para Scanner
                    </button>
                </div>
            )}

        </div>

        {/* BOTTOM ACTION BAR */}
        <div className="p-4 bg-gray-900 border-t border-gray-800 shrink-0 flex gap-4">
            <div className="flex-1 bg-gray-800 rounded-xl px-4 flex items-center justify-between">
                <span className="text-xs text-gray-400 font-bold uppercase">Progresso</span>
                <span className="font-mono text-white text-lg font-bold">{progress}%</span>
            </div>
            <button 
                onClick={handleFinishAudit} 
                disabled={progress === 0} 
                className="bg-brand hover:bg-red-600 disabled:opacity-50 disabled:bg-gray-700 text-white px-8 py-3 rounded-xl font-black uppercase tracking-wider transition-all shadow-lg shadow-red-900/20 flex items-center gap-2"
            >
                <Save size={18}/> Salvar
            </button>
        </div>

        {isScannerOpen && <QRScanner onClose={() => setIsScannerOpen(false)} onScan={(code) => { setIsScannerOpen(false); handleScan(code); }} />}
    </div>
  );
};

export default AuditPage;