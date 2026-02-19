// src/components/QRScanner.jsx
import React, { useEffect, useState, useRef } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { useNavigate } from 'react-router-dom';
import { X, Camera, AlertTriangle, RefreshCcw } from 'lucide-react';

// Som de Bip simples (Base64 para não precisar de arquivo)
const beepSound = "data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU"; // (Versão curta placeholder)

const QRScanner = ({ onClose, onScan }) => {
  const navigate = useNavigate();
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastScan, setLastScan] = useState(null);
  const scannerRef = useRef(null);

  useEffect(() => {
    const elementId = "reader";
    const formats = [ Html5QrcodeSupportedFormats.QR_CODE ];
    
    if (!scannerRef.current) {
        scannerRef.current = new Html5Qrcode(elementId, { formats });
    }
    const scanner = scannerRef.current;

    const startScanner = async () => {
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
            // Previne leituras duplicadas muito rápidas (1.5s de delay)
            const now = Date.now();
            if (lastScan && (now - lastScan < 1500) && decodedText === lastScan) return;
            
            handleScanSuccess(decodedText);
          },
          () => {}
        );
        setLoading(false);
      } catch (err) {
        console.error("Erro scanner:", err);
        setLoading(false);
        setError("Erro ao acessar câmera. Verifique permissões e HTTPS.");
      }
    };

    setTimeout(() => startScanner(), 100);

    return () => {
        if (scanner && scanner.isScanning) {
            scanner.stop().then(() => scanner.clear()).catch(() => {});
        }
    };
  }, []);

  const handleScanSuccess = (decodedText) => {
    const text = decodedText.trim();
    
    // Se tiver função customizada (Auditoria), usa ela
    if (onScan) {
        onScan(text);
        // Pequeno feedback visual/sonoro poderia vir aqui
    } else {
        // Comportamento padrão (Navegar)
        if (scannerRef.current) scannerRef.current.pause();
        navigate(`/assets/${text}`);
        if (onClose) onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/95 z-[9999] flex flex-col items-center justify-center p-4">
      <button onClick={onClose} className="absolute top-6 right-6 bg-white/20 text-white p-3 rounded-full hover:bg-white/40 z-50">
        <X size={24} />
      </button>

      <div className="w-full max-w-md bg-gray-900 rounded-2xl overflow-hidden shadow-2xl relative border border-gray-800">
        <div className="bg-gray-800 p-4 text-center text-white">
            <h3 className="font-bold text-lg flex items-center justify-center gap-2">
                <Camera size={20} className="text-brand" /> 
                {onScan ? "Modo Auditoria (Bipando...)" : "Scanner BySabel"}
            </h3>
        </div>
        
        <div className="relative bg-black min-h-[300px] flex items-center justify-center">
            <div id="reader" className="w-full h-full"></div>
            {loading && !error && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-white z-10 bg-black/50">
                    <RefreshCcw className="animate-spin mb-2" size={32} />
                    <p>Iniciando...</p>
                </div>
            )}
            {error && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 z-20 bg-gray-900 text-white">
                    <AlertTriangle className="text-red-500 mb-4" size={48} />
                    <p>{error}</p>
                    <button onClick={onClose} className="mt-4 px-6 py-2 bg-gray-700 rounded-lg">Fechar</button>
                </div>
            )}
        </div>
        
        <div className="p-4 text-center bg-gray-800 text-gray-400 text-xs">
            {onScan ? "Aponte para o próximo item. O scanner continuará ativo." : "Aponte a câmera para a etiqueta"}
        </div>
      </div>
    </div>
  );
};

export default QRScanner;