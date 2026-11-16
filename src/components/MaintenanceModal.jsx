// src/components/MaintenanceModal.jsx
import React, { useEffect, useId, useRef, useState } from 'react';
import { X, Wrench, DollarSign, AlertTriangle, Save } from 'lucide-react';
import AssetIcon from './AssetIcon';
import { toast } from 'sonner';
import { captureFocusTarget, restoreFocusSafely, trapFocusWithin } from '../utils/focusTrap';
import { isTopmostModal } from '../utils/modalStack';

const fieldCls =
  'w-full min-h-[44px] p-2.5 bg-white hover:border-slate-300 active:border-slate-400 focus-visible:outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25 disabled:opacity-50 disabled:cursor-not-allowed aria-[invalid=true]:border-rose-500 aria-[invalid=true]:focus-visible:ring-rose-500/25 dark:bg-[#111113] dark:border-zinc-800 dark:hover:border-zinc-700 dark:text-[#fafafa] dark:placeholder:text-zinc-500 border border-gray-200 rounded-lg text-sm text-gray-900 transition-colors';

const MaintenanceModalBody = ({ onClose, asset, onConfirm }) => {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState(() => ({
    defect: '',
    provider: '',
    cost: '',
    description: ''
  }));
  const titleId = useId();
  const defectId = useId();
  const providerId = useId();
  const costId = useId();
  const descriptionId = useId();
  const dialogRef = useRef(null);
  const defectRef = useRef(null);
  const previousFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const loadingRef = useRef(loading);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const container = dialogRef.current;
    previousFocusRef.current = captureFocusTarget(container);
    const raf = requestAnimationFrame(() => defectRef.current?.focus());
    const onKeyDown = (e) => {
      if (!isTopmostModal(container)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (!loadingRef.current) onCloseRef.current?.();
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    try {
      setLoading(true);
      await onConfirm(formData);
      onClose();
    } catch (error) {
      console.error(error);
      toast.error('Erro ao registrar manutenção. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  // Formata moeda simples
  const handleCostChange = (e) => {
    let value = e.target.value.replace(/\D/g, "");
    value = (Number(value) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
    setFormData({ ...formData, cost: value });
  };

  return (
    <div
      className="fixed inset-0 bg-black/55 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in"
      onClick={(e) => { if (e.target === e.currentTarget && !loading) onClose(); }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-white dark:bg-[#111113] border border-gray-200 dark:border-zinc-800 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto overscroll-contain animate-zoom-in focus:outline-none"
      >
        
        {/* Header de Alerta */}
        <div className="bg-orange-600 p-4 flex justify-between items-center text-white">
          <h3 id={titleId} className="font-bold text-lg flex items-center gap-2">
            <Wrench className="text-white" aria-hidden="true" /> Registrar Manutenção
          </h3>
          <button
            type="button"
            disabled={loading}
            onClick={onClose}
            aria-label="Fechar modal"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center hover:bg-orange-700 rounded-lg transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          
          <div className="bg-orange-50 dark:bg-orange-950/30 p-3 rounded-lg border border-orange-100 dark:border-orange-900/50 flex gap-3">
             <AlertTriangle className="text-orange-500 shrink-0" size={20} aria-hidden="true" />
             <p className="text-xs text-orange-800 dark:text-orange-300">
                Ao confirmar, o status do ativo <span className="inline-flex items-center gap-1 mx-1 align-bottom rounded bg-white dark:bg-[#111113] px-1 border border-orange-200 dark:border-orange-900"><AssetIcon type={asset?.type} category={asset?.category} model={asset?.model} internalId={asset?.internalId} size={14} /> <strong>{asset?.internalId}</strong></span> mudará automaticamente para <strong>EM MANUTENÇÃO</strong>.
             </p>
          </div>

          <div>
            <label htmlFor={defectId} className="block text-sm font-bold text-gray-700 dark:text-zinc-200 mb-1">Defeito Apresentado</label>
            <input
                ref={defectRef}
                id={defectId}
                name="defect"
                type="text" required
                disabled={loading}
                placeholder="Ex: Tela piscando, HD queimado…"
                className={fieldCls}
                value={formData.defect}
                onChange={e => setFormData({...formData, defect: e.target.value})}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
                <label htmlFor={providerId} className="block text-sm font-bold text-gray-700 dark:text-zinc-200 mb-1">Fornecedor / Técnico</label>
                <input
                    id={providerId}
                    name="provider"
                    type="text" required
                    disabled={loading}
                    placeholder="Ex: Dell Support, Assistência Local"
                    className={fieldCls}
                    value={formData.provider}
                    onChange={e => setFormData({...formData, provider: e.target.value})}
                />
            </div>
            <div>
                <label htmlFor={costId} className="block text-sm font-bold text-gray-700 dark:text-zinc-200 mb-1">Custo (R$)</label>
                <div className="relative">
                    <input
                        id={costId}
                        name="cost"
                        type="text"
                        disabled={loading}
                        placeholder="0,00"
                        className={`${fieldCls} pl-8 font-mono tabular-nums`}
                        value={formData.cost}
                        onChange={handleCostChange}
                    />
                    <DollarSign size={16} aria-hidden="true" className="absolute left-2.5 top-3 text-gray-400 dark:text-zinc-500" />
                </div>
            </div>
          </div>

          <div>
            <label htmlFor={descriptionId} className="block text-sm font-bold text-gray-700 dark:text-zinc-200 mb-1">Relatório Técnico / Observações</label>
            <textarea
                id={descriptionId}
                name="description"
                disabled={loading}
                className={`${fieldCls} h-24`}
                placeholder="Detalhes do serviço realizado…"
                value={formData.description}
                onChange={e => setFormData({...formData, description: e.target.value})}
            ></textarea>
          </div>

          <button 
            type="submit" disabled={loading}
            className="w-full min-h-[44px] py-3 bg-orange-600 text-white font-bold rounded-lg hover:bg-orange-700 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? "Salvando…" : <><Save size={18} aria-hidden="true" /> Confirmar Entrada em Manutenção</>}
          </button>

        </form>
      </div>
    </div>
  );
};

const MaintenanceModal = ({ isOpen, onClose, asset, onConfirm }) => {
  if (!isOpen) return null;
  return (
    <MaintenanceModalBody
      key={asset?.id ?? 'default'}
      onClose={onClose}
      asset={asset}
      onConfirm={onConfirm}
    />
  );
};

export default MaintenanceModal;