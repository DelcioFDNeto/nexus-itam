// src/components/audit/AuditSession.jsx
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Box, CheckCircle, Cpu, List, RefreshCcw, Save, Scan, Search, Smartphone, Trash2, Undo2, Volume2, VolumeX, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { buildAssetIndex, classifyScan, expectedAt, resolveScan, SCAN_RESULTS, seenByAgentAt, summarizeAudit } from '../../utils/audit';
import { captureFocusTarget, getFocusableElements, restoreFocusSafely, trapFocusWithin } from '../../utils/focusTrap';
import { isTopmostModal } from '../../utils/modalStack';

const QRScanner = React.lazy(() => import('../QRScanner'));

const FEEDBACK = {
  found: { tone: 'success', color: 'bg-emerald-700 border-emerald-500 shadow-emerald-950/50', icon: CheckCircle },
  other_location: { tone: 'warning', color: 'bg-amber-700 border-amber-500 shadow-amber-950/50', icon: AlertTriangle },
  transit_in: { tone: 'warning', color: 'bg-sky-700 border-sky-500 shadow-sky-950/50', icon: AlertTriangle },
  transit_out: { tone: 'warning', color: 'bg-amber-700 border-amber-500 shadow-amber-950/50', icon: AlertTriangle },
  retired: { tone: 'error', color: 'bg-rose-700 border-rose-500 shadow-rose-950/50', icon: XCircle },
  unknown: { tone: 'error', color: 'bg-rose-700 border-rose-500 shadow-rose-950/50', icon: XCircle },
  repeated: { tone: 'warning', color: 'bg-zinc-800 border-zinc-600', icon: CheckCircle },
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
  const finishDialogRef = useRef(null);
  const manualInputId = useId();
  const finishNotesId = useId();
  const finishTitleId = useId();
  const audioRef = useRef(null);
  const recentRef = useRef(new Map());
  const savingRef = useRef(saving);
  const finishPrevFocusRef = useRef(null);
  const prevScanFocusRef = useRef({ view: null, scansLen: draft.scans.length });

  useEffect(() => {
    savingRef.current = saving;
  }, [saving]);

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

  // Leitor USB (teclado) digita o codigo + Enter: foca ao abrir a tela de leitura ou apos cada bip, sem disputar foco ao fechar modais.
  useEffect(() => {
    const prev = prevScanFocusRef.current;
    const shouldFocus =
      view === 'scan' &&
      !cameraOpen &&
      !finishing &&
      (prev.view !== 'scan' || prev.scansLen !== scans.length);
    prevScanFocusRef.current = { view, scansLen: scans.length };
    if (shouldFocus) inputRef.current?.focus();
  }, [view, cameraOpen, finishing, scans.length]);

  useEffect(() => {
    if (!finishing) return undefined;
    const dialogEl = finishDialogRef.current;
    finishPrevFocusRef.current = captureFocusTarget(dialogEl);
    const raf = requestAnimationFrame(() => {
      const focusables = getFocusableElements(dialogEl);
      (focusables[0] || dialogEl)?.focus();
    });

    const onKeyDown = (e) => {
      if (!isTopmostModal(dialogEl)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!savingRef.current) setFinishing(false);
        return;
      }
      if (e.key === 'Tab') {
        trapFocusWithin(e, dialogEl);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown);
      const prevFocus = finishPrevFocusRef.current;
      finishPrevFocusRef.current = null;
      restoreFocusSafely(prevFocus, null, dialogEl);
    };
  }, [finishing]);

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
    <div className="-mx-4 -mt-4 sm:-mx-6 lg:-mx-8 lg:-my-8 flex flex-col min-h-[calc(100vh-8rem)] lg:min-h-screen bg-[#09090b] text-[#fafafa]">
      <div className="px-4 py-4 border-b border-zinc-800 bg-[#111113] flex justify-between items-center gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onLeave}
            aria-label="Sair e continuar depois"
            title="Sair e continuar depois"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-full bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <ArrowLeft size={20} aria-hidden="true" />
          </button>
          <div className="min-w-0">
            <h2 className="font-bold text-lg leading-none truncate">{location}</h2>
            <p className="text-xs text-zinc-400 uppercase tracking-widest mt-1 tabular-nums">
              {summary.found} de {expected.length} conferidos · {otherScans.length} outra(s) leitura(s)
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={undoLast}
            disabled={!scans.length}
            aria-label="Desfazer última leitura"
            title="Desfazer última leitura"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-full bg-zinc-900 border border-zinc-800 text-zinc-200 hover:bg-zinc-800 disabled:opacity-30 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <Undo2 size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setSound((v) => !v)}
            aria-label={sound ? 'Desligar som' : 'Ligar som'}
            aria-pressed={sound}
            className={`min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-full bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${sound ? 'text-emerald-400' : 'text-zinc-400'}`}
          >
            {sound ? <Volume2 size={18} aria-hidden="true" /> : <VolumeX size={18} aria-hidden="true" />}
          </button>
        </div>
      </div>

      <div className="w-full bg-zinc-800 h-2" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso da conferência">
        <div className="h-full bg-emerald-500 transition-[width] duration-500" style={{ width: `${progress}%` }} />
      </div>

      <div className="flex-1 overflow-y-auto">
        {view === 'scan' ? (
          <div className="flex flex-col items-center p-6 gap-6">
            {agentCandidates.length > 0 && (
              <div className="w-full max-w-sm rounded-2xl border border-brand/40 bg-brand/15 p-4 text-sm">
                <p className="flex items-start gap-2 tabular-nums">
                  <Cpu size={16} className="shrink-0 mt-0.5 text-sky-300" aria-hidden="true" />
                  <span>{agentCandidates.length} máquina(s) foram vistas pelo Agente ITAM na rede deste local nas últimas 24 h.</span>
                </p>
                <button
                  type="button"
                  onClick={confirmAgentSeen}
                  className="mt-3 w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-brand hover:bg-brand-dark text-brand-fg text-xs font-black uppercase tracking-wider transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  Confirmar presença pelo agente
                </button>
              </div>
            )}

            <div className={`w-full max-w-sm aspect-square rounded-[3rem] flex flex-col items-center justify-center p-8 text-center transition-colors duration-300 shadow-2xl border-4 ${feedback ? feedback.color : 'bg-[#111113] border-zinc-800'}`} role="status" aria-live="polite">
              {!last ? (
                <>
                  <Scan size={64} className="text-zinc-500 mb-4 opacity-70" aria-hidden="true" />
                  <p className="text-zinc-200 font-bold text-lg">Aguardando leitura</p>
                  <p className="text-zinc-400 text-sm mt-2">Câmera, leitor USB ou digitação</p>
                </>
              ) : (
                <>
                  <FeedbackIcon size={72} className="text-white mb-4" aria-hidden="true" />
                  <h3 className="text-2xl font-black text-white uppercase">{last.label}</h3>
                  <p className="text-white/90 font-mono text-lg mt-1">{last.asset?.internalId || last.code}</p>
                  {last.asset && <p className="text-white font-bold mt-2 bg-black/25 px-3 py-1 rounded-lg">{last.asset.model}</p>}
                  {last.result === 'other_location' && <p className="text-white/90 text-xs mt-2">Cadastro: {last.asset?.location || 'sem local'}</p>}
                </>
              )}
            </div>

            <form onSubmit={submitManual} className="w-full max-w-sm relative">
              <label htmlFor={manualInputId} className="sr-only">
                Código do ativo
              </label>
              <input
                ref={inputRef}
                id={manualInputId}
                name="manualCode"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="Patrimônio ou número de série…"
                aria-label="Código do ativo"
                autoComplete="off"
                className="w-full min-h-[56px] bg-[#111113] dark:bg-[#111113] border-2 border-zinc-700 hover:border-zinc-600 active:border-zinc-500 text-[#fafafa] placeholder:text-zinc-500 p-4 pl-12 rounded-2xl transition-colors focus-visible:outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25 disabled:opacity-50 disabled:cursor-not-allowed aria-[invalid=true]:border-rose-500 aria-[invalid=true]:focus-visible:ring-rose-500/25 font-mono text-lg"
              />
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" size={20} aria-hidden="true" />
            </form>

            <div className="grid grid-cols-2 gap-4 w-full max-w-sm">
              <button
                type="button"
                onClick={() => setCameraOpen(true)}
                className="min-h-[48px] bg-[#fafafa] hover:bg-zinc-200 text-[#09090b] py-3.5 px-4 rounded-xl font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <Smartphone size={20} aria-hidden="true" /> Câmera
              </button>
              <button
                type="button"
                onClick={() => setView('list')}
                className="min-h-[48px] bg-[#111113] hover:bg-zinc-900 text-[#fafafa] py-3.5 px-4 rounded-xl font-black uppercase tracking-wider flex items-center justify-center gap-2 border border-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <List size={20} aria-hidden="true" /> Detalhes
              </button>
            </div>
          </div>
        ) : (
          <div className="p-4 space-y-4 max-w-2xl mx-auto">
            <div className="grid grid-cols-3 gap-2">
              {[
                ['pending', 'Faltam', summary.missing, 'text-rose-400'],
                ['found', 'Conferidos', summary.found, 'text-emerald-400'],
                ['other', 'Outras leituras', otherScans.length, 'text-amber-400'],
              ].map(([id, label, value, color]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  aria-pressed={tab === id}
                  className={`min-h-[64px] p-3 rounded-xl border text-center transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${tab === id ? 'bg-zinc-800 border-zinc-600' : 'bg-[#111113] border-zinc-800 hover:border-zinc-700'}`}
                >
                  <p className="text-xs text-zinc-400 uppercase font-black">{label}</p>
                  <p className={`text-2xl font-black tabular-nums ${color}`}>{value}</p>
                </button>
              ))}
            </div>
            <ul className="space-y-2">
              {tab === 'pending' && summary.missingAssets.map((a) => (
                <li key={a.id} className="bg-[#111113] border border-zinc-800 p-3 rounded-xl flex items-center gap-3">
                  <Box size={16} className="text-zinc-400 shrink-0" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="font-bold text-sm text-zinc-100 truncate">{a.model}</p>
                    <p className="text-zinc-400 text-xs font-mono">{a.internalId}</p>
                  </div>
                </li>
              ))}
              {tab === 'found' && summary.foundAssets.map((a) => (
                <li key={a.id} className="bg-emerald-950/30 border border-emerald-500/30 p-3 rounded-xl flex items-center gap-3">
                  <CheckCircle size={16} className="text-emerald-400 shrink-0" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-sm text-emerald-100 truncate">{a.model}</p>
                    <p className="text-emerald-300/80 text-xs font-mono">{a.internalId}</p>
                  </div>
                  {scans.find((s) => s.assetId === a.id)?.method === 'agent' && <span className="text-xs font-black uppercase text-sky-300">Agente</span>}
                </li>
              ))}
              {tab === 'other' && otherScans.map((s) => (
                <li key={`${s.code}-${s.at}`} className="bg-amber-950/30 border border-amber-500/30 p-3 rounded-xl">
                  <p className="font-bold text-sm text-amber-100">{s.internalId} {s.model && <span className="font-normal text-amber-200/80">· {s.model}</span>}</p>
                  <p className="text-amber-300/90 text-xs">{SCAN_RESULTS[s.result].label}{s.from ? ` · cadastro: ${s.from}` : ''}</p>
                </li>
              ))}
              {((tab === 'pending' && !summary.missing) || (tab === 'found' && !summary.found) || (tab === 'other' && !otherScans.length)) && (
                <li className="text-center text-sm text-zinc-400 py-6">Nada aqui.</li>
              )}
            </ul>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setView('scan')}
                className="min-h-[44px] flex-1 py-3 px-4 bg-[#111113] hover:bg-zinc-900 border border-zinc-800 text-[#fafafa] font-bold rounded-xl transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                Voltar para leitura
              </button>
              <button
                type="button"
                onClick={onDiscard}
                className="min-h-[44px] px-4 py-3 rounded-xl border border-rose-500/40 hover:bg-rose-950/40 text-rose-300 font-bold flex items-center gap-1.5 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <Trash2 size={16} aria-hidden="true" /> Descartar
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="p-4 bg-[#111113] border-t border-zinc-800 flex gap-3">
        <div className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2 flex items-center justify-between">
          <span className="text-xs text-zinc-400 font-bold uppercase">Progresso</span>
          <span className="font-mono text-[#fafafa] text-lg font-bold tabular-nums">{progress}%</span>
        </div>
        <button
          type="button"
          onClick={() => setFinishing(true)}
          disabled={!canRun || saving}
          className="min-h-[44px] bg-brand hover:bg-brand-dark text-brand-fg px-6 py-3 rounded-xl font-black uppercase tracking-wider flex items-center gap-2 disabled:opacity-50 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <Save size={18} aria-hidden="true" /> Finalizar
        </button>
      </div>

      {finishing && (
        <div
          className="fixed inset-0 z-[70] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
          onClick={(e) => { if (e.target === e.currentTarget && !saving) setFinishing(false); }}
        >
          <div
            ref={finishDialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby={finishTitleId}
            className="w-full max-w-md max-h-[90vh] overflow-y-auto overscroll-contain bg-[#111113] border border-zinc-800 text-[#fafafa] rounded-2xl p-6 space-y-4 shadow-2xl animate-zoom-in focus:outline-none"
          >
            <h3 id={finishTitleId} className="text-lg font-black">Finalizar auditoria de {location}</h3>
            <dl className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
                <dt className="text-xs uppercase text-zinc-400 font-black">Conferidos</dt>
                <dd className="text-xl font-black text-emerald-400 tabular-nums mt-1">{summary.found}</dd>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
                <dt className="text-xs uppercase text-zinc-400 font-black">Não localizados</dt>
                <dd className="text-xl font-black text-rose-400 tabular-nums mt-1">{summary.missing}</dd>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
                <dt className="text-xs uppercase text-zinc-400 font-black">Outras leituras</dt>
                <dd className="text-xl font-black text-amber-400 tabular-nums mt-1">{otherScans.length}</dd>
              </div>
            </dl>
            {summary.missing > 0 && (
              <p className="text-xs text-rose-300 bg-rose-950/30 border border-rose-500/30 rounded-xl p-3 tabular-nums">
                Os {summary.missing} itens não lidos ficam marcados como "Não localizado" no cadastro e entram no relatório. Leia mais itens antes, se ainda estiver conferindo.
              </p>
            )}
            <label htmlFor={finishNotesId} className="block">
              <span className="block text-xs uppercase font-black text-zinc-400 mb-1.5">Observações (saem no relatório)</span>
              <textarea
                id={finishNotesId}
                name="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full min-h-[88px] bg-[#111113] dark:bg-[#111113] border border-zinc-700 hover:border-zinc-600 active:border-zinc-500 rounded-xl p-3 text-sm text-[#fafafa] placeholder:text-zinc-500 transition-colors focus-visible:outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25 disabled:opacity-50 disabled:cursor-not-allowed aria-[invalid=true]:border-rose-500 aria-[invalid=true]:focus-visible:ring-rose-500/25"
                placeholder="Ex.: sala do estoque estava trancada."
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setFinishing(false)}
                disabled={saving}
                className="min-h-[44px] flex-1 py-3 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-bold transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
              >
                Continuar lendo
              </button>
              <button
                type="button"
                onClick={() => onFinish(notes)}
                disabled={saving}
                className="min-h-[44px] flex-1 py-3 px-4 rounded-xl bg-brand hover:bg-brand-dark text-brand-fg font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60"
              >
                {saving ? <RefreshCcw size={16} className="animate-spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />} {saving ? 'Salvando…' : 'Salvar relatório'}
              </button>
            </div>
          </div>
        </div>
      )}

      {cameraOpen && (
        <React.Suspense fallback={<div role="status" className="fixed inset-0 bg-black/95 z-[9999] flex items-center justify-center text-xs font-bold uppercase tracking-widest text-zinc-400">Acessando câmera…</div>}>
          <QRScanner onClose={() => setCameraOpen(false)} onScan={(code) => handleCode(code, 'qr')} />
        </React.Suspense>
      )}
    </div>
  );
};

export default AuditSession;
