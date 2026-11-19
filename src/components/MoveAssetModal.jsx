// src/components/MoveAssetModal.jsx
import React, { useState, useEffect, useId, useRef } from 'react';
import { X, MapPin, User, Truck, Search, ArrowRight, ArrowRightLeft, RefreshCcw } from 'lucide-react';
import LocationSelect from './LocationSelect';
import { getEmployees } from '../services/employeeService';
import AssetIcon from './AssetIcon';
import { useAuth } from '../contexts/AuthContext';
import { today } from '../utils/dates';
import { captureFocusTarget, getFocusableElements, restoreFocusSafely, trapFocusWithin } from '../utils/focusTrap';
import { isTopmostModal } from '../utils/modalStack';
import { toast } from 'sonner';

const fieldCls =
  'w-full min-h-[44px] p-3 bg-white hover:border-slate-300 active:border-slate-400 focus-visible:outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25 disabled:opacity-50 disabled:cursor-not-allowed aria-[invalid=true]:border-rose-500 aria-[invalid=true]:focus-visible:ring-rose-500/25 dark:bg-[#111113] dark:border-zinc-800 dark:hover:border-zinc-700 dark:text-[#fafafa] dark:placeholder:text-zinc-500 border-2 border-gray-200 rounded-xl text-sm font-bold text-gray-800 transition-colors';

const MoveAssetModalBody = ({ onClose, asset, onConfirm }) => {
  const { currentUser } = useAuth();
  const [employees, setEmployees] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  const [formData, setFormData] = useState(() => ({
    newLocation: '',
    newResponsible: asset?.assignedTo || '',
    newEmail: asset?.assignedToEmail || asset?.assignedEmail || '',
    newEmployeeId: asset?.employeeId || '',
    newCpf: '',
    date: today(),
    reason: ''
  }));

  const titleId = useId();
  const locationId = useId();
  const responsibleId = useId();
  const customResponsibleId = useId();
  const dateId = useId();
  const reasonId = useId();
  const dialogRef = useRef(null);
  const previousFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const submittingRef = useRef(submitting);

  useEffect(() => {
    submittingRef.current = submitting;
  }, [submitting]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const container = dialogRef.current;
    previousFocusRef.current = captureFocusTarget(container);
    let observer;
    const raf = requestAnimationFrame(() => {
      const locationEl = document.getElementById(locationId);
      if (locationEl && !locationEl.disabled) {
        locationEl.focus();
        return;
      }
      const fallback = getFocusableElements(container)[0] || container;
      fallback?.focus();
      if (locationEl && typeof MutationObserver !== 'undefined') {
        observer = new MutationObserver(() => {
          if (!locationEl.disabled) {
            observer.disconnect();
            if (document.activeElement === container || document.activeElement === fallback) {
              locationEl.focus();
            }
          }
        });
        observer.observe(locationEl, { attributes: true, attributeFilter: ['disabled'] });
      }
    });
    const onKeyDown = (e) => {
      if (!isTopmostModal(container)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (!submittingRef.current) onCloseRef.current?.();
        return;
      }
      if (e.key === 'Tab') {
        trapFocusWithin(e, container);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener('keydown', onKeyDown);
      const previous = previousFocusRef.current;
      previousFocusRef.current = null;
      restoreFocusSafely(previous, null, container);
    };
  }, [locationId]);

  useEffect(() => {
    if (!currentUser?.tenantId) return undefined;
    let active = true;
    const fetchEmps = async () => {
      try {
        const data = await getEmployees(currentUser.tenantId);
        if (active) setEmployees(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('Erro ao carregar colaboradores:', err);
        if (active) setEmployees([]);
      }
    };
    fetchEmps();
    return () => {
      active = false;
    };
  }, [currentUser?.tenantId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.newLocation) return toast.error('Selecione o novo local.');
    setSubmitting(true);
    try {
      await onConfirm(formData);
      onClose();
    } catch (err) {
      console.error(err);
      toast.error('Erro ao transferir ativo.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResponsibleSelect = (e) => {
    const selectedName = e.target.value;
    const emp = employees.find(ep => ep.name === selectedName);
    setFormData({
      ...formData,
      newResponsible: selectedName,
      newEmail: emp?.email ? String(emp.email).trim().toLowerCase() : '',
      newEmployeeId: emp?.id || '',
      newCpf: emp?.cpf || '',
    });
  };

  const isCustomResponsible = formData.newResponsible && !employees.find(e => e.name === formData.newResponsible);

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in"
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-white dark:bg-[#111113] rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto overscroll-contain animate-zoom-in border border-gray-200 dark:border-zinc-800 focus:outline-none"
      >
        
        {/* Header Modal */}
        <div className="bg-brand p-5 flex justify-between items-center text-brand-fg shadow-md">
          <div>
            <h2 id={titleId} className="text-xl font-black flex items-center gap-2 uppercase tracking-wide">
              <Truck size={24} aria-hidden="true" /> Transferência
            </h2>
            <p className="opacity-85 text-xs mt-0.5 font-bold flex items-center gap-2">
              <AssetIcon type={asset?.type} category={asset?.category} model={asset?.model} internalId={asset?.internalId} size={16} /> 
              {asset?.model} ({asset?.internalId})
            </p>
          </div>
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            aria-label="Fechar"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center hover:bg-white/15 rounded-xl transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          
          {/* --- QUADRO DE PREVIA (ORIGEM -> DESTINO) --- */}
          <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
            
            {/* ORIGEM (ATUAL) */}
            <div className="bg-gray-100 dark:bg-zinc-900 p-3 rounded-xl border border-gray-200 dark:border-zinc-800 flex flex-col h-full justify-center opacity-80">
              <span className="text-xs font-black text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Origem (Atual)</span>
              <div className="flex items-center gap-1.5 text-gray-700 dark:text-zinc-200 font-bold text-xs mb-1">
                <MapPin size={12} aria-hidden="true" /> <span className="truncate">{asset?.location || 'N/A'}</span>
              </div>
              <div className="flex items-center gap-1.5 text-gray-500 dark:text-zinc-400 font-medium text-xs">
                <User size={12} aria-hidden="true" /> <span className="truncate">{asset?.assignedTo || 'Sem resp.'}</span>
              </div>
            </div>

            {/* SETA */}
            <div className="flex justify-center text-gray-300 dark:text-zinc-600" aria-hidden="true">
              <ArrowRight size={24} />
            </div>

            {/* DESTINO (NOVO) */}
            <div className={`p-3 rounded-xl border flex flex-col h-full justify-center transition-colors ${formData.newLocation ? 'bg-sky-50 border-sky-200 dark:bg-sky-950/30 dark:border-sky-900' : 'bg-white dark:bg-[#111113] border-dashed border-gray-300 dark:border-zinc-700'}`}>
              <span className={`text-xs font-black uppercase tracking-wider mb-1 ${formData.newLocation ? 'text-sky-600 dark:text-sky-400' : 'text-gray-400 dark:text-zinc-500'}`}>Destino (Novo)</span>
              <div className={`flex items-center gap-1.5 font-bold text-xs mb-1 ${formData.newLocation ? 'text-sky-900 dark:text-sky-200' : 'text-gray-400 dark:text-zinc-500'}`}>
                <MapPin size={12} aria-hidden="true" /> <span className="truncate">{formData.newLocation || 'Selecione…'}</span>
              </div>
              <div className={`flex items-center gap-1.5 font-medium text-xs ${formData.newResponsible ? 'text-sky-700 dark:text-sky-300' : 'text-gray-400 dark:text-zinc-500'}`}>
                <User size={12} aria-hidden="true" /> <span className="truncate">{formData.newResponsible || '…'}</span>
              </div>
            </div>
          </div>

          <p className="text-xs text-gray-600 dark:text-zinc-400 bg-gray-50 dark:bg-zinc-900 rounded-xl px-3 py-2 border border-gray-100 dark:border-zinc-800">
            Movimentação interna, sem termo. Para enviar a uma loja com Termo de Transferência e Recebimento (o ativo fica em trânsito até a loja conferir), use <strong>Enviar p/ loja</strong>.
          </p>

          {/* --- FORMULARIO --- */}
          <div className="space-y-4">
            
            {/* Selecao de Local */}
            <div>
              <label htmlFor={locationId} className="block text-xs font-bold text-gray-500 dark:text-zinc-400 uppercase mb-1">Novo Local / Filial</label>
              <div className="relative">
                <LocationSelect
                  id={locationId}
                  value={formData.newLocation}
                  onChange={(e) => setFormData({ ...formData, newLocation: e.target.value })}
                  name="newLocation"
                  emptyLabel="Selecione o destino…"
                  showManageLink
                  className={`${fieldCls} appearance-none pr-10`}
                />
                <div className="absolute right-4 top-3.5 pointer-events-none text-gray-400 dark:text-zinc-500" aria-hidden="true">▼</div>
              </div>
            </div>

            {/* Novo Responsavel */}
            <div>
              <label htmlFor={responsibleId} className="block text-xs font-bold text-gray-500 dark:text-zinc-400 uppercase mb-1">Novo Responsável</label>
              <div className="relative">
                <select
                  id={responsibleId}
                  name="newResponsible"
                  value={formData.newResponsible}
                  onChange={handleResponsibleSelect}
                  className={`${fieldCls} font-medium appearance-none pr-10 dark:[&_option]:bg-[#111113] dark:[&_option]:text-[#fafafa]`}
                >
                  <option value="">Manter atual / Sem responsável</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.name}>{emp.name} - {emp.sector}</option>
                  ))}
                  {isCustomResponsible && <option value={formData.newResponsible}>{formData.newResponsible}</option>}
                </select>
                <Search size={16} aria-hidden="true" className="absolute right-4 top-3.5 text-gray-400 dark:text-zinc-500 pointer-events-none"/>
              </div>
              {(!formData.newResponsible || isCustomResponsible) && (
                <>
                  <label htmlFor={customResponsibleId} className="sr-only">Nome do novo responsável</label>
                  <input
                    id={customResponsibleId}
                    name="customResponsible"
                    aria-label="Nome do novo responsável"
                    value={formData.newResponsible}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        newResponsible: e.target.value,
                        newEmail: '',
                        newEmployeeId: '',
                      })
                    }
                    className={`${fieldCls} mt-2 animate-slide-down`}
                    placeholder="Ou digite o nome manualmente…"
                  />
                </>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor={dateId} className="block text-xs font-bold text-gray-500 dark:text-zinc-400 uppercase mb-1">Data</label>
                <input
                  id={dateId}
                  name="date"
                  type="date"
                  required
                  max={today()}
                  value={formData.date}
                  onChange={(e) => setFormData({...formData, date: e.target.value})}
                  className={`${fieldCls} tabular-nums`}
                />
              </div>
              <div>
                <label htmlFor={reasonId} className="block text-xs font-bold text-gray-500 dark:text-zinc-400 uppercase mb-1">Motivo</label>
                <input
                  id={reasonId}
                  name="reason"
                  value={formData.reason}
                  onChange={(e) => setFormData({...formData, reason: e.target.value})}
                  className={fieldCls}
                  placeholder="Ex: Mudança de setor…"
                />
              </div>
            </div>
          </div>

          <div className="pt-2">
            <button 
              type="submit" 
              disabled={submitting}
              className="w-full min-h-[44px] bg-brand hover:bg-brand-dark text-brand-fg py-4 rounded-xl font-black transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand shadow-lg flex justify-center items-center gap-2 uppercase tracking-wide text-sm group disabled:opacity-50"
            >
              {submitting ? <RefreshCcw size={18} className="animate-spin" aria-hidden="true" /> : <ArrowRightLeft size={18} aria-hidden="true" className="group-hover:scale-110 transition-transform"/>}
              {submitting ? 'Transferindo…' : 'Confirmar Transferência'}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
};

const MoveAssetModal = ({ isOpen, onClose, asset, onConfirm }) => {
  if (!isOpen) return null;
  return (
    <MoveAssetModalBody
      key={asset?.id ?? 'default'}
      onClose={onClose}
      asset={asset}
      onConfirm={onConfirm}
    />
  );
};

export default MoveAssetModal;