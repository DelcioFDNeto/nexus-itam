// src/pages/AuditPage.jsx
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../services/firebase';
import { collection, query, onSnapshot, orderBy, doc, updateDoc, serverTimestamp, addDoc, where } from 'firebase/firestore'; 
import { 
  ClipboardCheck, MapPin, Scan, CheckCircle, XCircle, AlertTriangle, ArrowLeft, 
  Search, Save, List, Box, AlertOctagon, Volume2, VolumeX, Smartphone, RefreshCcw 
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../components/ConfirmDialog';
import { isRetired } from '../utils/assetStatus';
import { isoDay } from '../utils/dates';
import { can } from '../utils/permissions';
const QRScanner = React.lazy(() => import('../components/QRScanner'));

const AuditPage = () => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const confirm = useConfirm();
  const tenantId = currentUser?.tenantId;
  const canRunAudit = can(currentUser, 'audit:run');
  
  // Estados principais de dados
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  
  // Controle da sessão de auditoria atual
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [scannedIds, setScannedIds] = useState(new Set()); 
  const [, setSessionLog] = useState([]);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  
  // Estados de interface e experiência do usuário
  const [viewMode, setViewMode] = useState('scan');
  const [lastScanResult, setLastScanResult] = useState(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [manualSearch, setManualSearch] = useState('');

  // AudioContext reutilizado via ref para evitar vazamento de memória e limites do navegador
  const audioCtxRef = useRef(null);

  const getAudioContext = () => {
    if (!audioCtxRef.current) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        audioCtxRef.current = new AudioCtx();
      }
    }
    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => {});
    }
    return audioCtxRef.current;
  };

  useEffect(() => {
    return () => {
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
      }
    };
  }, []);

  const playSound = (type) => {
    if (!soundEnabled) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
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
      } else {
        osc.frequency.setValueAtTime(500, ctx.currentTime);
        osc.type = 'square';
        gain.gain.setValueAtTime(0.05, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
        osc.start();
        osc.stop(ctx.currentTime + 0.2);
      }
    } catch {
      // Ignora falhas de áudio por autoplay policy
    }
  };

  // Buscando a lista atualizada de ativos do banco de dados
  useEffect(() => {
    if (!tenantId) return;
    const q = query(collection(db, 'assets'), where('tenantId', '==', tenantId), orderBy('location', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const assetData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setAssets(assetData);
      setLoading(false);
    }, (err) => { 
      console.error(err); 
      setLoading(false); 
    });
    return () => unsubscribe();
  }, [tenantId]);

  // Processamento lógico memorizado
  const locationsData = useMemo(() => {
    const locs = {};
    assets.forEach(asset => {
      if (!asset.location) return;
      if (!locs[asset.location]) locs[asset.location] = { name: asset.location, count: 0, preview: [] };
      if (!isRetired(asset.status) && asset.category !== 'Promocional' && !asset.internalId?.includes('PRM')) {
        locs[asset.location].count++;
      }
    });
    return Object.values(locs).sort((a,b) => a.name.localeCompare(b.name));
  }, [assets]);

  const expectedAssets = useMemo(() => {
    if (!selectedLocation) return [];
    return assets.filter(a => 
      a.location === selectedLocation && 
      !isRetired(a.status) &&
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

  // Ações do usuário
  const handleScan = async (code) => {
    if (!code) return;
    const cleanCode = code.trim().toUpperCase();
    
    const asset = assets.find(a => a.internalId === cleanCode);
    const isExpected = asset && asset.location === selectedLocation;
    const isIntruder = asset && asset.location !== selectedLocation;

    if (isExpected) {
      if (scannedIds.has(cleanCode)) {
        setLastScanResult({ type: 'warning', msg: 'Já auditado', item: asset, code: cleanCode });
        playSound('warning');
      } else {
        try {
          const assetRef = doc(db, 'assets', asset.id);
          await updateDoc(assetRef, {
            lastAudit: serverTimestamp(),
            auditStatus: 'Conforme'
          });
          setLastScanResult({ type: 'success', msg: 'Confirmado', item: asset, code: cleanCode });
          playSound('success');
          setScannedIds(prev => new Set(prev).add(cleanCode));
        } catch (err) {
          console.error(err);
          toast.error(`Falha ao registrar auditoria do ativo ${cleanCode}.`);
          playSound('error');
          return;
        }
      }
    } else if (isIntruder) {
      setLastScanResult({ type: 'warning', msg: 'Intruso Detectado!', item: asset, code: cleanCode });
      playSound('warning');
      setScannedIds(prev => new Set(prev).add(cleanCode));
    } else {
      setLastScanResult({ type: 'error', msg: 'Não Encontrado', item: null, code: cleanCode });
      playSound('error');
    }

    setSessionLog(prev => [{ time: new Date(), code: cleanCode, status: isExpected ? 'OK' : isIntruder ? 'INTRUSO' : 'ERRO' }, ...prev]);
  };

  const handleManualInput = (e) => {
    e.preventDefault();
    handleScan(manualSearch);
    setManualSearch('');
  };

  const handleExitAudit = async () => {
    if (scannedIds.size > 0) {
      const confirmed = await confirm({
        title: 'Sair da Auditoria',
        message: 'A conferência em andamento não foi salva. Deseja realmente sair?',
        danger: true,
        confirmLabel: 'Sair sem Salvar'
      });
      if (!confirmed) return;
    }
    setSelectedLocation(null);
    setScannedIds(new Set());
    setSessionLog([]);
    setLastScanResult(null);
  };

  const handleFinishAudit = async () => {
    if (!canRunAudit) {
      toast.error('Você não tem permissão para registrar auditorias.');
      return;
    }
    const confirmed = await confirm({
      title: 'Finalizar Auditoria',
      message: `Finalizar e registrar o relatório de conferência de "${selectedLocation}"?`,
      confirmLabel: 'Finalizar e Salvar'
    });
    if (!confirmed) return;

    setSaving(true);
    try {
      await addDoc(collection(db, 'audits'), {
        tenantId,
        location: selectedLocation,
        date: serverTimestamp(),
        auditedBy: currentUser?.email || 'Desconhecido',
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
      toast.success('Auditoria salva com sucesso!');
      setSelectedLocation(null);
      setScannedIds(new Set());
      setSessionLog([]);
      setLastScanResult(null);
    } catch (err) {
      console.error(err);
      toast.error('Erro ao salvar auditoria.');
    } finally {
      setSaving(false);
    }
  };

  const exportToPDF = async () => {
    if (!selectedLocation || exporting) return;
    
    setExporting(true);
    toast.info('Gerando PDF, aguarde...', { id: 'pdf-toast' });
    try {
      const { jsPDF } = await import('jspdf');
      await import('jspdf-autotable');

      const pdfDoc = new jsPDF();
      pdfDoc.text('Relatório de Auditoria - Nexus ITAM', 14, 15);
      pdfDoc.setFontSize(10);
      pdfDoc.text(`Local: ${selectedLocation}`, 14, 22);
      pdfDoc.text(`Data: ${new Date().toLocaleString('pt-BR')}`, 14, 28);
      pdfDoc.text(`Progresso: ${progress}% (${auditResult.found.length}/${expectedAssets.length})`, 14, 34);

      const tableColumn = ['Status', 'Ativo', 'Identificação', 'Local Original'];
      const tableRows = [];

      auditResult.found.forEach(asset => tableRows.push(['Encontrado', asset.model, asset.internalId, asset.location]));
      auditResult.missing.forEach(asset => tableRows.push(['Faltante', asset.model, asset.internalId, asset.location]));
      auditResult.intruders.forEach(asset => tableRows.push(['Intruso', asset.model, asset.internalId, asset.location]));

      pdfDoc.autoTable({
        head: [tableColumn],
        body: tableRows,
        startY: 40,
        styles: { fontSize: 9 },
        headStyles: { fillColor: [79, 70, 229] }
      });

      pdfDoc.save(`Auditoria_${selectedLocation}_${isoDay()}.pdf`);
      toast.success('Relatório PDF exportado com sucesso!', { id: 'pdf-toast' });
    } catch (err) {
      console.error(err);
      toast.error('Erro ao gerar PDF.');
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 dark:bg-slate-900">
        <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-black dark:border-white"></div>
      </div>
    );
  }

  // Tela inicial pedindo para escolher qual local vai ser auditado agora
  if (!selectedLocation) {
    return (
      <div className="p-4 md:p-8 min-h-screen bg-gray-50 dark:bg-slate-900">
        <header className="flex items-center gap-4 mb-8">
          <button onClick={() => navigate('/')} className="p-3 bg-white dark:bg-slate-800 text-gray-800 dark:text-white rounded-xl shadow-sm hover:scale-105 transition-transform">
            <ArrowLeft size={24}/>
          </button>
          <div>
            <h1 className="text-3xl font-black text-gray-900 dark:text-white tracking-tight">Nova Auditoria</h1>
            <p className="text-gray-500 dark:text-gray-400">Selecione o local para iniciar a conferência.</p>
          </div>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {locationsData.map((loc) => (
            <button 
              key={loc.name}
              onClick={() => setSelectedLocation(loc.name)}
              className="group relative overflow-hidden bg-white dark:bg-slate-800 p-6 rounded-3xl border border-gray-200 dark:border-slate-700 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all text-left"
            >
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <MapPin size={64} className="text-black dark:text-white transform rotate-12"/>
              </div>
              <h3 className="text-xl font-black text-gray-900 dark:text-white mb-2">{loc.name}</h3>
              <div className="flex items-center gap-2">
                <span className="bg-black dark:bg-brand text-white px-3 py-1 rounded-lg text-xs font-bold">{loc.count} Ativos</span>
                {loc.count === 0 && <span className="text-xs text-red-500 font-bold">Vazio</span>}
              </div>
            </button>
          ))}
        </div>
        {locationsData.length === 0 && (
          <div className="text-center py-20 text-gray-400 dark:text-gray-500">
            Nenhum local com ativos elegíveis para auditoria foi encontrado.
          </div>
        )}
      </div>
    );
  }

  // Tela principal ativada durante o processo ativo de auditoria
  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white overflow-hidden">
      
      {/* Barra fixa superior mostrando onde estamos e controle de som */}
      <div className="px-4 py-4 bg-gray-900 border-b border-gray-800 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={handleExitAudit} className="p-2 rounded-full bg-gray-800 text-gray-400 hover:text-white transition-colors">
            <ArrowLeft size={20}/>
          </button>
          <div>
            <h2 className="font-bold text-lg leading-none">{selectedLocation}</h2>
            <p className="text-[10px] text-gray-400 uppercase tracking-widest mt-0.5">{expectedAssets.length} ITENS ESPERADOS</p>
          </div>
        </div>
        <button onClick={() => setSoundEnabled(!soundEnabled)} className={`p-3 rounded-full ${soundEnabled ? 'bg-gray-800 text-green-400' : 'bg-gray-800 text-gray-500'}`}>
          {soundEnabled ? <Volume2 size={20}/> : <VolumeX size={20}/>}
        </button>
      </div>

      {/* Visualizacao de progresso no topo */}
      <div className="w-full bg-gray-800 h-2 shrink-0">
        <div className="h-full bg-green-500 transition-all duration-500 shadow-[0_0_10px_#22c55e]" style={{ width: `${progress}%` }}></div>
      </div>

      {/* Area rolabel */}
      <div className="flex-1 relative bg-gray-900 overflow-y-auto">
        
        {viewMode === 'scan' && (
          <div className="flex flex-col items-center justify-center min-h-full p-6 gap-8">
            
            {/* Cartao grande central com feedback visual */}
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
                  <p className="text-gray-400 font-bold text-lg">Aguardando Leitura...</p>
                  <p className="text-gray-500 text-sm mt-2">Use o scanner ou digite abaixo</p>
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

            {/* Opcao auxiliar de digitar rapido */}
            <form onSubmit={handleManualInput} className="w-full max-w-sm relative">
              <input 
                value={manualSearch}
                onChange={e => setManualSearch(e.target.value)}
                placeholder="Digitar código..."
                className="w-full bg-gray-800 border-2 border-gray-700 text-white p-4 pl-12 rounded-2xl outline-none focus:border-brand font-mono text-lg transition-all"
              />
              <Search className="absolute left-4 top-5 text-gray-400" size={20}/>
            </form>

            {/* Botoes de acoes */}
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

        {viewMode === 'list' && (
          <div className="p-4 space-y-6">
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
            
            <button onClick={() => setViewMode('scan')} className="w-full py-4 bg-gray-800 text-white font-bold rounded-xl mt-4 hover:bg-gray-750 transition-colors">
              Voltar para Scanner
            </button>
          </div>
        )}

      </div>

      {/* Rodape com botoes de salvar e exportar */}
      <div className="p-4 bg-gray-900 border-t border-gray-800 shrink-0 flex gap-4 overflow-x-auto">
        <div className="flex-1 bg-gray-800 rounded-xl px-4 py-2 flex items-center justify-between min-w-[120px]">
          <span className="text-xs text-gray-400 font-bold uppercase">Progresso</span>
          <span className="font-mono text-white text-lg font-bold">{progress}%</span>
        </div>
        <button 
          onClick={exportToPDF}
          disabled={exporting}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-6 py-3 rounded-xl font-black uppercase tracking-wider transition-all shadow-lg flex items-center gap-2 whitespace-nowrap"
        >
          {exporting ? <RefreshCcw size={18} className="animate-spin" /> : <ClipboardCheck size={18}/>}
          {exporting ? 'Exportando…' : 'Exportar PDF'}
        </button>
        <button 
          onClick={handleFinishAudit} 
          disabled={progress === 0 || saving || !canRunAudit} 
          className="bg-brand hover:opacity-90 disabled:opacity-50 disabled:bg-gray-700 text-white px-6 py-3 rounded-xl font-black uppercase tracking-wider transition-all shadow-lg flex items-center gap-2 whitespace-nowrap"
        >
          {saving ? <RefreshCcw size={18} className="animate-spin" /> : <Save size={18}/>}
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
      </div>

      {isScannerOpen && (
        <React.Suspense fallback={
          <div className="fixed inset-0 bg-black/95 z-[9999] flex flex-col items-center justify-center text-white">
            <div className="animate-spin h-8 w-8 border-4 border-brand border-t-transparent rounded-full mb-4"></div>
            <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Acessando Câmera...</p>
          </div>
        }>
          <QRScanner onClose={() => setIsScannerOpen(false)} onScan={(code) => { setIsScannerOpen(false); handleScan(code); }} />
        </React.Suspense>
      )}
    </div>
  );
};

export default AuditPage;