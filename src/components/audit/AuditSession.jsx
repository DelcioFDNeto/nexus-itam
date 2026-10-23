// src/components/audit/AuditSession.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Box, CheckCircle, Cpu, List, RefreshCcw, Save, Scan, Search, Smartphone, Trash2, Undo2, Volume2, VolumeX, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { buildAssetIndex, classifyScan, expectedAt, resolveScan, SCAN_RESULTS, seenByAgentAt, summarizeAudit } from '../../utils/audit';

const QRScanner = React.lazy(() => import('../QRScanner'));

const FEEDBACK = {
  found: { tone: 'success', color: 'bg-green-600 border-green-400 shadow-green-900/50', icon: CheckCircle },
  other_location: { tone: 'warning', color: 'bg-yellow-600 border-yellow-400 shadow-yellow-900/50', icon: AlertTriangle },
  transit_in: { tone: 'warning', color: 'bg-blue-600 border-blue-400 shadow-blue-900/50', icon: AlertTriangle },
  transit_out: { tone: 'warning', color: 'bg-yellow-600 border-yellow-400 shadow-yellow-900/50', icon: AlertTriangle },
  retired: { tone: 'error', color: 'bg-red-600 border-red-400 shadow-red-900/50', icon: XCircle },
  unknown: { tone: 'error', color: 'bg-red-600 border-red-400 shadow-red-900/50', icon: XCircle },
  repeated: { tone: 'warning', color: 'bg-gray-700 border-gray-500', icon: CheckCircle },
};

const REPEAT_WINDOW_MS = 2500;

/** Conferencia em andamento num local (tela de leitura, pensada para celular). */
const AuditSession = ({ location, locationInfo, assets, draft, onDraftChange, onLeave, onDiscard, onFinish, saving, canRun }) => {
  const [view, setView] = useState('scan');
  const [tab, setTab] = useState('pending');
  const [last, setLast] = useState(null);
  const [manual, setManual] = useState('');
  const [sound, setSound] = useState(true);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [notes, setNotes] = useState('');
  const inputRef = useRef(null);
  const audioRef = useRef(null);
  const recentRef = useRef(new Map());

  const index = useMemo(() => buildAssetIndex(assets), [assets]);
  const expected = useMemo(() => expectedAt(assets, location), [assets, location]);
  const scans = draft.scans;
  const summary = useMemo(() => summarizeAudit(expected, scans), [expected, scans]);
  const progress = expected.length ? Math.round((summary.found / expected.length) * 100) : 100;
  const scannedIds = useMemo(() => new Set(scans.map((s) => s.assetId).filter(Boolean)), [scans]);
  const agentCandidates = useMemo(
    () => expected.filter((a) => !scannedIds.has(a.id) && seenByAgentAt(a, locationInfo)),
    [expected, scannedIds, locationInfo],
  );

  // Leitor USB (teclado) digita o codigo + Enter: o campo fica sempre pronto.
  useEffect(() => {
    if (view === 'scan' && !cameraOpen && !finishing) inputRef.current?.focus();
  }, [view, cameraOpen, finishing, scans.length]);

  useEffect(() => () => audioRef.current?.close?.().catch(() => {}), []);

  const beep = (tone) => {
    if (!sound) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioRef.current ||= new Ctx();
      const ctx = audioRef.current;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      const [freq, type, len] = tone === 'success' ? [1000, 'sine', 0.15] : tone === 'error' ? [300, 'sawtooth', 0.3] : [500, 'square', 0.2];
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + len);
      osc.start();
      osc.stop(ctx.currentTime + len);
    } catch {
      /* navegador sem audio */
    }
  };

  const addScans = (newScans) => onDraftChange({ ...draft, scans: [...draft.scans, ...newScans] });

  const handleCode = (raw, method) => {
    const code = String(raw || '').trim();
    if (!code) return;
    // A camera le o mesmo QR varias vezes por segundo.
    const now = Date.now();
    if (now - (recentRef.current.get(code) || 0) < REPEAT_WINDOW_MS) return;
    recentRef.current.set(code, now);

    const asset = resolveScan(code, index);
    const already = asset ? scannedIds.has(asset.id) : scans.some((s) => !s.assetId && s.code.toUpperCase() === code.toUpperCase());
    if (already) {
      setLast({ result: 'repeated', label: 'Já conferido', code, asset });
      beep('warning');
      return;
    }
    const result = classifyScan(asset, location);
    addScans([{
      assetId: asset?.id || '',
      code,
      internalId: asset?.internalId || code,
      model: asset?.model || '',
      from: asset?.location || '',
      result,
      method,
      at: new Date().toISOString(),
    }]);
    setLast({ result, label: SCAN_RESULTS[result].label, code, asset });
    beep(FEEDBACK[result].tone);
    if (cameraOpen && result !== 'found') toast.warning(`${asset?.internalId || code}: ${SCAN_RESULTS[result].label}`);
  };

  const submitManual = (e) => {
    e.preventDefault();
    handleCode(manual, 'manual');
    setManual('');
  };

  const confirmAgentSeen = () => {
    addScans(agentCandidates.map((a) => ({
      assetId: a.id, code: a.internalId, internalId: a.internalId, model: a.model || '', from: a.location, result: 'found', method: 'agent', at: new Date().toISOString(),
    })));
    toast.success(`${agentCandidates.length} máquina(s) confirmada(s) pelo Agente ITAM.`);
  };

  const undoLast = () => {
    if (!scans.length) return;
    onDraftChange({ ...draft, scans: scans.slice(0, -1) });
    setLast(null);
  };

  const feedback = last ? FEEDBACK[last.result] : null;
  const FeedbackIcon = feedback?.icon || Scan;
  const otherScans = scans.filter((s) => s.result !== 'found');

  return (
    <div className="-mx-4 -mt-4 sm:-mx-6 lg:-mx-8 lg:-my-8 flex flex-col min-h-[calc(100vh-8rem)] lg:min-h-screen bg-gray-900 text-white">
      <div className="px-4 py-4 border-b border-gray-800 flex justify-between items-center gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button type="button" onClick={onLeave} aria-label="Sair e continuar depois" title="Sair e continuar depois" className="p-2 rounded-full bg-gray-800 text-gray-400 hover:text-white">
            <ArrowLeft size={20} />
          </button>
          <div className="min-w-0">
            <h2 className="font-bold text-lg leading-none truncate">{location}</h2>
            <p className="text-[10px] text-gray-400 uppercase tracking-widest mt-1">{summary.found} de {expected.length} conferidos · {otherScans.length} outra(s) leitura(s)</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={undoLast} disabled={!scans.length} aria-label="Desfazer última leitura" title="Desfazer última leitura" className="p-3 rounded-full bg-gray-800 text-gray-300 disabled:opacity-30"><Undo2 size={18} /></button>
          <button type="button" onClick={() => setSound((v) => !v)} aria-label={sound ? 'Desligar som' : 'Ligar som'} className={`p-3 rounded-full bg-gray-800 ${sound ? 'text-green-400' : 'text-gray-500'}`}>
            {sound ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
        </div>
      </div>

      <div className="w-full bg-gray-800 h-2" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso da conferência">
        <div className="h-full bg-green-500 transition-all duration-500" style={{ width: `${progress}%` }} />
      </div>

      <div className="flex-1 overflow-y-auto">
        {view === 'scan' ? (
          <div className="flex flex-col items-center p-6 gap-6">
            {agentCandidates.length > 0 && (
              <div className="w-full max-w-sm rounded-2xl border border-indigo-400/40 bg-indigo-500/15 p-4 text-sm">
                <p className="flex items-start gap-2"><Cpu size={16} className="shrink-0 mt-0.5 text-indigo-300" /> {agentCandidates.length} máquina(s) foram vistas pelo Agente ITAM na rede deste local nas últimas 24 h.</p>
                <button type="button" onClick={confirmAgentSeen} className="mt-3 w-full py-2.5 rounded-xl bg-indigo-500 text-white text-xs font-black uppercase tracking-wider">Confirmar presença pelo agente</button>
              </div>
            )}

            <div className={`w-full max-w-sm aspect-square rounded-[3rem] flex flex-col items-center justify-center p-8 text-center transition-all duration-300 shadow-2xl border-4 ${feedback ? feedback.color : 'bg-gray-800 border-gray-700'}`} role="status" aria-live="polite">
              {!last ? (
                <>
                  <Scan size={64} className="text-gray-600 mb-4 opacity-50" />
                  <p className="text-gray-400 font-bold text-lg">Aguardando leitura</p>
                  <p className="text-gray-500 text-sm mt-2">Câmera, leitor USB ou digitação</p>
                </>
              ) : (
                <>
                  <FeedbackIcon size={72} className="text-white mb-4" />
                  <h3 className="text-2xl font-black text-white uppercase">{last.label}</h3>
                  <p className="text-white/80 font-mono text-lg mt-1">{last.asset?.internalId || last.code}</p>
                  {last.asset && <p className="text-white font-bold mt-2 bg-black/20 px-3 py-1 rounded-lg">{last.asset.model}</p>}
                  {last.result === 'other_location' && <p className="text-white/90 text-xs mt-2">Cadastro: {last.asset?.location || 'sem local'}</p>}
                </>
              )}
            </div>

            <form onSubmit={submitManual} className="w-full max-w-sm relative">
              <input
                ref={inputRef}
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="Patrimônio ou número de série…"
                aria-label="Código do ativo"
                autoComplete="off"
                className="w-full bg-gray-800 border-2 border-gray-700 text-white p-4 pl-12 rounded-2xl outline-none focus:border-brand font-mono text-lg"
              />
              <Search className="absolute left-4 top-5 text-gray-400" size={20} />
            </form>

            <div className="grid grid-cols-2 gap-4 w-full max-w-sm">
              <button type="button" onClick={() => setCameraOpen(true)} className="bg-white text-black py-4 rounded-xl font-black uppercase tracking-wider flex items-center justify-center gap-2 active:scale-95">
                <Smartphone size={20} /> Câmera
              </button>
              <button type="button" onClick={() => setView('list')} className="bg-gray-800 text-white py-4 rounded-xl font-black uppercase tracking-wider flex items-center justify-center gap-2 border border-gray-700 active:scale-95">
                <List size={20} /> Detalhes
              </button>
            </div>
          </div>
        ) : (
          <div className="p-4 space-y-4 max-w-2xl mx-auto">
            <div className="grid grid-cols-3 gap-2">
              {[
                ['pending', 'Faltam', summary.missing, 'text-red-400'],
                ['found', 'Conferidos', summary.found, 'text-green-400'],
                ['other', 'Outras leituras', otherScans.length, 'text-yellow-400'],
              ].map(([id, label, value, color]) => (
                <button key={id} type="button" onClick={() => setTab(id)} aria-pressed={tab === id} className={`p-3 rounded-xl border text-center ${tab === id ? 'bg-gray-700 border-gray-500' : 'bg-gray-800 border-gray-700'}`}>
                  <p className="text-[10px] text-gray-400 uppercase font-black">{label}</p>
                  <p className={`text-2xl font-black ${color}`}>{value}</p>
                </button>
              ))}
            </div>
            <ul className="space-y-2">
              {tab === 'pending' && summary.missingAssets.map((a) => (
                <li key={a.id} className="bg-gray-800 border border-gray-700 p-3 rounded-xl flex items-center gap-3">
                  <Box size={16} className="text-gray-500" />
                  <div className="min-w-0"><p className="font-bold text-sm text-gray-200 truncate">{a.model}</p><p className="text-gray-500 text-xs font-mono">{a.internalId}</p></div>
                </li>
              ))}
              {tab === 'found' && summary.foundAssets.map((a) => (
                <li key={a.id} className="bg-green-900/20 border border-green-500/30 p-3 rounded-xl flex items-center gap-3">
                  <CheckCircle size={16} className="text-green-400" />
                  <div className="min-w-0 flex-1"><p className="font-bold text-sm text-green-100 truncate">{a.model}</p><p className="text-green-400/70 text-xs font-mono">{a.internalId}</p></div>
                  {scans.find((s) => s.assetId === a.id)?.method === 'agent' && <span className="text-[10px] font-black uppercase text-indigo-300">Agente</span>}
                </li>
              ))}
              {tab === 'other' && otherScans.map((s) => (
                <li key={`${s.code}-${s.at}`} className="bg-yellow-900/20 border border-yellow-500/30 p-3 rounded-xl">
                  <p className="font-bold text-sm text-yellow-100">{s.internalId} {s.model && <span className="font-normal text-yellow-200/70">· {s.model}</span>}</p>
                  <p className="text-yellow-400/80 text-xs">{SCAN_RESULTS[s.result].label}{s.from ? ` · cadastro: ${s.from}` : ''}</p>
                </li>
              ))}
              {((tab === 'pending' && !summary.missing) || (tab === 'found' && !summary.found) || (tab === 'other' && !otherScans.length)) && (
                <li className="text-center text-sm text-gray-500 py-6">Nada aqui.</li>
              )}
            </ul>
            <div className="flex gap-2">
              <button type="button" onClick={() => setView('scan')} className="flex-1 py-3 bg-gray-800 text-white font-bold rounded-xl">Voltar para leitura</button>
              <button type="button" onClick={onDiscard} className="px-4 py-3 rounded-xl border border-red-500/40 text-red-300 font-bold flex items-center gap-1.5"><Trash2 size={16} /> Descartar</button>
            </div>
          </div>
        )}
      </div>

      <div className="p-4 bg-gray-900 border-t border-gray-800 flex gap-3">
        <div className="flex-1 bg-gray-800 rounded-xl px-4 py-2 flex items-center justify-between">
          <span className="text-xs text-gray-400 font-bold uppercase">Progresso</span>
          <span className="font-mono text-white text-lg font-bold">{progress}%</span>
        </div>
        <button
          type="button"
          onClick={() => setFinishing(true)}
          disabled={!canRun || saving}
          className="bg-brand text-white px-6 py-3 rounded-xl font-black uppercase tracking-wider flex items-center gap-2 disabled:opacity-50"
        >
          <Save size={18} /> Finalizar
        </button>
      </div>

      {finishing && (
        <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Finalizar auditoria">
          <div className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-xl p-6 space-y-4">
            <h3 className="text-lg font-black">Finalizar auditoria de {location}</h3>
            <dl className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-gray-800 rounded-xl p-3"><dt className="text-[10px] uppercase text-gray-400 font-black">Conferidos</dt><dd className="text-xl font-black text-green-400">{summary.found}</dd></div>
              <div className="bg-gray-800 rounded-xl p-3"><dt className="text-[10px] uppercase text-gray-400 font-black">Não localizados</dt><dd className="text-xl font-black text-red-400">{summary.missing}</dd></div>
              <div className="bg-gray-800 rounded-xl p-3"><dt className="text-[10px] uppercase text-gray-400 font-black">Outras leituras</dt><dd className="text-xl font-black text-yellow-400">{otherScans.length}</dd></div>
            </dl>
            {summary.missing > 0 && (
              <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-xl p-3">
                Os {summary.missing} itens não lidos ficam marcados como "Não localizado" no cadastro e entram no relatório. Leia mais itens antes, se ainda estiver conferindo.
              </p>
            )}
            <label className="block">
              <span className="block text-[10px] uppercase font-black text-gray-400 mb-1">Observações (saem no relatório)</span>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full bg-gray-800 border border-gray-700 rounded-xl p-3 text-sm outline-none focus:border-brand" placeholder="Ex.: sala do estoque estava trancada." />
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setFinishing(false)} disabled={saving} className="flex-1 py-3 rounded-xl bg-gray-800 font-bold">Continuar lendo</button>
              <button type="button" onClick={() => onFinish(notes)} disabled={saving} className="flex-1 py-3 rounded-xl bg-brand font-black uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-60">
                {saving ? <RefreshCcw size={16} className="animate-spin" /> : <Save size={16} />} {saving ? 'Salvando…' : 'Salvar relatório'}
              </button>
            </div>
          </div>
        </div>
      )}

      {cameraOpen && (
        <React.Suspense fallback={<div className="fixed inset-0 bg-black/95 z-[9999] flex items-center justify-center text-xs font-bold uppercase tracking-widest text-gray-400">Acessando câmera…</div>}>
          <QRScanner onClose={() => setCameraOpen(false)} onScan={(code) => handleCode(code, 'qr')} />
        </React.Suspense>
      )}
    </div>
  );
};

export default AuditSession;
