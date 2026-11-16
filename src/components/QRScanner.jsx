// src/components/QRScanner.jsx
import React, { useEffect, useId, useState, useRef } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { useNavigate } from 'react-router-dom';
import { X, Camera, AlertTriangle, RefreshCcw, Zap, ZapOff } from 'lucide-react';

// Som de Bip simples (placeholder, reservado para uso futuro)
// const beepSound = ...;

import { useAuth } from '../contexts/AuthContext';
import { db } from '../services/firebase';
import { collection, query, where, getDocs, limit } from 'firebase/firestore';
import { captureFocusTarget, restoreFocusSafely, trapFocusWithin } from '../utils/focusTrap';
import { isTopmostModal } from '../utils/modalStack';

const QRScanner = ({ onClose, onScan, title }) => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const tenantId = currentUser?.tenantId;
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hasTorch, setHasTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const lastScanRef = useRef(null);
  const scannerRef = useRef(null);
  const dialogRef = useRef(null);
  const closeBtnRef = useRef(null);
  const previousFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const mountedRef = useRef(true);
  const titleId = useId();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const container = dialogRef.current;
    previousFocusRef.current = captureFocusTarget(container);
    const raf = requestAnimationFrame(() => closeBtnRef.current?.focus());
    const onKeyDown = (e) => {
      if (!isTopmostModal(container)) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (e.key === 'Tab') {
        trapFocusWithin(e, container);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown);
      const previous = previousFocusRef.current;
      previousFocusRef.current = null;
      restoreFocusSafely(previous, null, container);
    };
  }, []);

  async function handleScanSuccess(decodedText) {
    const text = decodedText.trim();
    
    if (onScan) {
      onScan(text);
      return;
    }

    if (scannerRef.current) {
      try {
        scannerRef.current.pause();
      } catch {
        // Ignora erro se pause falhar
      }
    }

    // Se for URL, tenta extrair rota de ativo ou termo
    if (text.startsWith('http://') || text.startsWith('https://')) {
      try {
        const url = new URL(text);
        if (url.pathname.includes('/assets/')) {
          const assetId = url.pathname.split('/assets/')[1]?.split('/')[0]?.split('?')[0];
          if (assetId) {
            navigate(`/assets/${assetId}`);
            if (onClose) onClose();
            return;
          }
        }
        if (url.pathname.includes('/termos/')) {
          const termId = url.pathname.split('/termos/')[1]?.split('/')[0]?.split('?')[0];
          if (termId) {
            navigate(`/termos/${termId}`);
            if (onClose) onClose();
            return;
          }
        }
      } catch (e) {
        console.error("URL parse error:", e);
      }
    }

    // Busca por internalId no tenant atual
    try {
      if (tenantId) {
        const q = query(
          collection(db, 'assets'),
          where('tenantId', '==', tenantId),
          where('internalId', '==', text),
          limit(1)
        );
        const snap = await getDocs(q);
        if (!mountedRef.current) return;
        if (!snap.empty) {
          navigate(`/assets/${snap.docs[0].id}`);
          if (onClose) onClose();
          return;
        }
      }
    } catch (err) {
      console.error("Erro ao buscar ativo pelo patrimônio:", err);
    }

    if (!mountedRef.current) return;
    // Se não encontrou por internalId nem URL, tenta navegar diretamente pelo id do documento
    navigate(`/assets/${text}`);
    if (onClose) onClose();
  }

  useEffect(() => {
    let active = true;
    const elementId = "reader";
    const formats = [
      Html5QrcodeSupportedFormats.QR_CODE,
      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.CODE_39,
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.DATA_MATRIX,
    ];
    
    if (!scannerRef.current) {
        scannerRef.current = new Html5Qrcode(elementId, { formats });
    }
    const scanner = scannerRef.current;

    const startScanner = async () => {
      if (!active) return;
      try {
        setLoading(true);
        setError(null);

        await scanner.start(
          { facingMode: "environment" }, 
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1.0
          },
          (decodedText) => {
            if (!active) return;
            const now = Date.now();
            if (lastScanRef.current && (now - lastScanRef.current.time < 1500) && decodedText === lastScanRef.current.text) return;
            lastScanRef.current = { text: decodedText, time: now };
            
            handleScanSuccess(decodedText);
          },
          () => {}
        );
        if (!active) {
          if (scanner && scanner.isScanning) {
            scanner.stop().then(() => scanner.clear()).catch(() => {});
          }
          return;
        }
        setLoading(false);
        try {
          const track = scanner.getRunningTrackCapabilities?.();
          if (track && 'torch' in track) setHasTorch(true);
        } catch {
          /* sem suporte a lanterna */
        }
      } catch (err) {
        if (!active) return;
        console.error("Erro scanner:", err);
        setLoading(false);
        try {
          const track = scanner.getRunningTrackCapabilities?.();
          if (track && 'torch' in track) setHasTorch(true);
        } catch {
          /* sem suporte a lanterna */
        }
        setError("Erro ao acessar câmera. Verifique permissões e HTTPS.");
      }
    };

    const timer = setTimeout(() => {
      if (active) startScanner();
    }, 100);

    return () => {
      active = false;
      clearTimeout(timer);
      if (scanner && scanner.isScanning) {
        scanner.stop().then(() => scanner.clear()).catch(() => {});
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleTorch = async () => {
    try {
      const next = !torchOn;
      await scannerRef.current?.applyVideoConstraints({
        advanced: [{ torch: next }],
      });
      setTorchOn(next);
    } catch (e) {
      console.warn('Erro ao alternar lanterna:', e);
    }
  };

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 bg-black/95 z-[9999] flex flex-col items-center justify-center p-4 animate-fade-in focus:outline-none"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <button
        ref={closeBtnRef}
        type="button"
        onClick={onClose}
        aria-label="Fechar scanner"
        className="min-h-[44px] min-w-[44px] flex items-center justify-center absolute top-6 right-6 bg-white/20 text-white p-3 rounded-full hover:bg-white/35 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white z-50"
      >
        <X size={24} aria-hidden="true" />
      </button>

      <div
        className="w-full max-w-md max-h-[90vh] overflow-y-auto overscroll-contain bg-[#111113] rounded-2xl shadow-2xl relative border border-zinc-800 animate-zoom-in"
      >
        <div className="bg-zinc-900 p-4 text-[#fafafa] flex items-center justify-between border-b border-zinc-800">
            <h3 id={titleId} className="font-bold text-sm sm:text-base flex items-center gap-2">
                <Camera size={20} className="text-brand-aa" aria-hidden="true" /> 
                <span className="truncate">{title || (onScan ? "Modo Auditoria (Bipando…)" : "Scanner Nexus")}</span>
            </h3>
            {hasTorch && (
              <button
                type="button"
                onClick={toggleTorch}
                aria-label={torchOn ? 'Desligar lanterna' : 'Ligar lanterna'}
                aria-pressed={torchOn}
                title="Alternar lanterna"
                className={`min-h-[44px] min-w-[44px] flex items-center justify-center p-2 rounded-xl border text-xs font-bold gap-1 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                  torchOn ? 'bg-amber-500 text-slate-900 border-amber-400' : 'bg-zinc-800 text-zinc-200 border-zinc-700 hover:bg-zinc-700'
                }`}
              >
                {torchOn ? <ZapOff size={16} aria-hidden="true" /> : <Zap size={16} aria-hidden="true" />}
              </button>
            )}
        </div>
        
        <div className="relative bg-black min-h-[300px] flex items-center justify-center">
            <div id="reader" className="w-full h-full"></div>
            {loading && !error && (
                <div role="status" aria-label="Iniciando câmera…" className="absolute inset-0 flex flex-col items-center justify-center text-white z-10 bg-black/50">
                    <RefreshCcw className="animate-spin mb-2" size={32} aria-hidden="true" />
                    <p>Iniciando…</p>
                </div>
            )}
            {error && (
                <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 z-20 bg-[#111113] text-[#fafafa]">
                    <AlertTriangle className="text-rose-500 mb-4" size={48} aria-hidden="true" />
                    <p>{error}</p>
                    <button
                      type="button"
                      onClick={onClose}
                      className="mt-4 min-h-[44px] px-6 py-2 bg-zinc-800 hover:bg-zinc-700 text-[#fafafa] font-semibold rounded-lg transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    >
                      Fechar
                    </button>
                </div>
            )}
        </div>
        
        <div className="p-4 text-center bg-zinc-900 border-t border-zinc-800 text-zinc-400 text-xs">
            {onScan ? "Aponte para o próximo item. O scanner continuará ativo." : "Aponte a câmera para a etiqueta"}
        </div>
      </div>
    </div>
  );
};

export default QRScanner;