// src/components/employees/EmployeeCustodyModal.jsx
import React, { useEffect, useId, useRef, useState } from 'react';
import {
  X, Briefcase, Laptop, Smartphone, Monitor, HardDrive,
  Copy, Check, ExternalLink, FileSignature, Undo2,
  DollarSign, ShieldCheck, MapPin, Mail,
  CreditCard, Network, ArrowUpRight
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { parseBRL, formatBRL } from '../../utils/currency';
import { captureFocusTarget, restoreFocusSafely, trapFocusWithin } from '../../utils/focusTrap';
import { isTopmostModal } from '../../utils/modalStack';

const getAssetIcon = (type) => {
  const t = (type || '').toLowerCase();
  if (t.includes('note') || t.includes('laptop')) return Laptop;
  if (t.includes('cel') || t.includes('phone') || t.includes('smart')) return Smartphone;
  if (t.includes('monit') || t.includes('tela')) return Monitor;
  return HardDrive;
};

const EmployeeCustodyModal = ({
  employee,
  assets = [],
  onClose,
  onOpenTerm,
  canIssueTerms = true
}) => {
  const navigate = useNavigate();
  const [copiedId, setCopiedId] = useState(null);
  const titleId = useId();
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const previousFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const copyTimerRef = useRef(null);
  const isMountedRef = useRef(true);
  const isOpen = Boolean(employee);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
        copyTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) {
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
        copyTimerRef.current = null;
      }
      setCopiedId(null);
      return undefined;
    }
    const container = dialogRef.current;
    previousFocusRef.current = captureFocusTarget(container);
    closeButtonRef.current?.focus();

    const handleKeyDown = (e) => {
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
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      const previous = previousFocusRef.current;
      previousFocusRef.current = null;
      restoreFocusSafely(previous, null, container);
    };
  }, [isOpen]);

  if (!employee) return null;

  const copyToClipboard = async (text, id) => {
    if (!text) return;
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard unavailable');
      }
      await navigator.clipboard.writeText(text);
      if (!isMountedRef.current) return;
      setCopiedId(id);
      toast.success(`Copiado: ${text}`);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => {
        if (isMountedRef.current) {
          setCopiedId(null);
        }
        copyTimerRef.current = null;
      }, 2000);
    } catch {
      if (isMountedRef.current) {
        toast.error('Não foi possível copiar para a área de transferência.');
      }
    }
  };

  const totalValue = assets.reduce((sum, a) => {
    return sum + parseBRL(a.valor ?? a.purchase_value ?? a.purchaseValue ?? 0);
  }, 0);

  const collaboratorPortalUrl = `${window.location.origin}/meus-ativos?employee=${encodeURIComponent(employee.name || '')}`;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4 overscroll-contain"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-white dark:bg-[#111113] rounded-3xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col border border-slate-200 dark:border-zinc-800 animate-zoom-in overflow-hidden"
      >
        {/* Header do Colaborador */}
        <div className="p-6 border-b border-slate-100 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/60 flex justify-between items-start gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-14 h-14 rounded-2xl bg-brand text-brand-fg flex items-center justify-center font-black text-xl shadow-sm uppercase shrink-0">
              {(employee.name || '?').substring(0, 2)}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id={titleId} className="text-xl font-black text-slate-900 dark:text-[#fafafa] leading-tight">
                  {employee.name}
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-black uppercase tracking-wider bg-brand/10 text-brand-aa border border-brand/20">
                  Custódia de Ativos
                </span>
              </div>

              <p className="text-xs text-slate-600 dark:text-zinc-400 mt-1">
                {employee.role || 'Cargo não informado'} • <span className="font-bold text-slate-800 dark:text-zinc-200">{employee.sector || 'Setor Geral'}</span>
              </p>

              <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-slate-600 dark:text-zinc-400">
                {employee.branch && (
                  <span className="flex items-center gap-1">
                    <MapPin size={13} className="text-slate-400 dark:text-zinc-500" aria-hidden="true" /> {employee.branch}
                  </span>
                )}
                {employee.email && (
                  <span className="flex items-center gap-1 truncate max-w-[240px]" title={employee.email}>
                    <Mail size={13} className="text-slate-400 dark:text-zinc-500" aria-hidden="true" /> {employee.email}
                  </span>
                )}
                {employee.cpf && (
                  <span className="flex items-center gap-1 font-mono tabular-nums">
                    <CreditCard size={13} className="text-slate-400 dark:text-zinc-500" aria-hidden="true" /> {employee.cpf}
                  </span>
                )}
                {employee.login && (
                  <span className="flex items-center gap-1 font-mono bg-slate-100 dark:bg-zinc-800 px-2 py-0.5 rounded text-xs">
                    <Network size={12} className="text-brand-aa" aria-hidden="true" /> {employee.login}
                  </span>
                )}
              </div>
            </div>
          </div>

          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Fechar janela de custódia"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-[#fafafa] hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand shrink-0"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {/* Resumo de Custódia KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-5 bg-slate-100/50 dark:bg-zinc-900/40 border-b border-slate-100 dark:border-zinc-800">
          <div className="bg-white dark:bg-[#111113] p-3.5 rounded-2xl border border-slate-200/80 dark:border-zinc-800 shadow-sm flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-brand/10 text-brand-aa">
              <Briefcase size={20} aria-hidden="true" />
            </div>
            <div>
              <span className="text-xs uppercase font-bold text-slate-500 dark:text-zinc-400 block">Itens em Custódia</span>
              <p className="text-lg font-black text-slate-900 dark:text-[#fafafa] leading-tight tabular-nums">
                {assets.length} {assets.length === 1 ? 'ativo' : 'ativos'}
              </p>
            </div>
          </div>

          <div className="bg-white dark:bg-[#111113] p-3.5 rounded-2xl border border-slate-200/80 dark:border-zinc-800 shadow-sm flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <DollarSign size={20} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <span className="text-xs uppercase font-bold text-slate-500 dark:text-zinc-400 block">Patrimônio em Posse</span>
              <p className="text-lg font-black text-slate-900 dark:text-[#fafafa] leading-tight truncate tabular-nums" title={formatBRL(totalValue)}>
                {formatBRL(totalValue)}
              </p>
            </div>
          </div>

          <div className="col-span-2 sm:col-span-1 bg-white dark:bg-[#111113] p-3.5 rounded-2xl border border-slate-200/80 dark:border-zinc-800 shadow-sm flex items-center justify-between sm:justify-start gap-3">
            <div className="p-2.5 rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400">
              <ShieldCheck size={20} aria-hidden="true" />
            </div>
            <div>
              <span className="text-xs uppercase font-bold text-slate-500 dark:text-zinc-400 block">Conformidade Legal</span>
              <p className="text-xs font-black text-slate-800 dark:text-zinc-200 leading-tight">
                {assets.length > 0 ? 'Art. 462 §1 CLT' : 'Sem equipamentos'}
              </p>
            </div>
          </div>
        </div>

        {/* Lista de Ativos em Posse */}
        <div className="p-6 overflow-y-auto overscroll-contain max-h-[48vh] space-y-3 custom-scrollbar flex-1">
          <div className="flex flex-wrap justify-between items-center gap-2 mb-2">
            <h3 className="text-xs font-black text-slate-500 dark:text-zinc-400 uppercase tracking-wider flex items-center gap-1.5 tabular-nums">
              <Laptop size={14} className="text-brand-aa" aria-hidden="true" /> Equipamentos Alocados ao Colaborador ({assets.length})
            </h3>
            <span className="text-xs text-slate-500 dark:text-zinc-400">Clique na tag ou serial para copiar</span>
          </div>

          {assets.length === 0 ? (
            <div className="py-12 px-4 text-center border-2 border-dashed border-slate-200 dark:border-zinc-800 rounded-2xl text-slate-500 dark:text-zinc-400">
              <Briefcase size={40} className="mx-auto mb-2 opacity-30 text-brand-aa" aria-hidden="true" />
              <p className="font-bold text-slate-700 dark:text-zinc-200 text-sm">
                Nenhum ativo atribuído a este colaborador
              </p>
              <p className="text-xs mt-1 text-slate-500 dark:text-zinc-400 max-w-sm mx-auto">
                Para vincular um equipamento, edite um ativo na lista de inventário e defina este colaborador como responsável.
              </p>
            </div>
          ) : (
            assets.map(asset => {
              const IconComp = getAssetIcon(asset.type);
              const tag = asset.internalId || asset.internal_id || asset.id;
              const serial = asset.serialNumber || asset.serial_number || 'S/N';
              const assetVal = asset.valor ?? asset.purchase_value ?? asset.purchaseValue;

              return (
                <div
                  key={asset.id}
                  className="p-4 rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 hover:border-brand/40 hover:shadow-sm transition-colors flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3.5 min-w-0 flex-1">
                    <div className="p-3 rounded-2xl bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 shrink-0">
                      <IconComp size={22} className="text-brand-aa" aria-hidden="true" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-bold text-slate-900 dark:text-[#fafafa] text-sm truncate">
                          {asset.model || asset.brand || 'Equipamento Corporativo'}
                        </h4>
                        <span className="px-2 py-0.5 rounded text-xs font-bold bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300">
                          {asset.type || 'Dispositivo'}
                        </span>
                        <span className="px-2 py-0.5 rounded text-xs font-bold bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
                          {asset.status || 'Em Uso'}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs">
                        {/* Tag com Botão de Cópia */}
                        <button
                          type="button"
                          onClick={() => copyToClipboard(tag, `tag-${asset.id}`)}
                          className="font-mono font-bold text-slate-700 dark:text-zinc-200 hover:text-brand-aa flex items-center gap-1.5 bg-slate-50 dark:bg-zinc-900 px-2.5 min-h-[44px] rounded-xl border border-slate-200 dark:border-zinc-700 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand tabular-nums"
                          title="Copiar Patrimônio / Tag"
                        >
                          <span className="text-xs text-slate-500 dark:text-zinc-400 font-sans">Tag:</span> {tag}
                          {copiedId === `tag-${asset.id}` ? <Check size={14} className="text-emerald-500" aria-hidden="true" /> : <Copy size={13} className="text-slate-400" aria-hidden="true" />}
                        </button>

                        {/* Serial Number com Cópia */}
                        {serial !== 'S/N' && (
                          <button
                            type="button"
                            onClick={() => copyToClipboard(serial, `sn-${asset.id}`)}
                            className="font-mono text-slate-600 dark:text-zinc-300 hover:text-brand-aa flex items-center gap-1.5 px-2 min-h-[44px] rounded-xl text-xs transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand tabular-nums"
                            title="Copiar Número de Série"
                          >
                            <span className="text-slate-500 dark:text-zinc-400">S/N:</span> {serial}
                            {copiedId === `sn-${asset.id}` ? <Check size={14} className="text-emerald-500" aria-hidden="true" /> : <Copy size={13} className="text-slate-400" aria-hidden="true" />}
                          </button>
                        )}

                        {Boolean(assetVal) && (
                          <span className="text-xs font-mono text-slate-600 dark:text-zinc-300 tabular-nums">
                            Valor: {formatBRL(assetVal)}
                          </span>
                        )}

                        {asset.location && (
                          <span className="text-xs text-slate-500 dark:text-zinc-400 flex items-center gap-1">
                            <MapPin size={12} aria-hidden="true" /> {asset.location}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Ação de abrir ficha */}
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      navigate(`/assets/${asset.id}`);
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 min-h-[44px] text-xs font-bold text-slate-700 dark:text-zinc-200 hover:text-brand-aa hover:bg-brand/10 rounded-xl transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand shrink-0"
                    title="Abrir prontuário completo deste ativo"
                  >
                    <span>Ficha</span>
                    <ArrowUpRight size={14} aria-hidden="true" />
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Rodapé de Ações do Gestor */}
        <div className="p-5 border-t border-slate-100 dark:border-zinc-800 bg-slate-50/80 dark:bg-zinc-900/60 flex flex-col sm:flex-row items-center justify-between gap-3">
          {/* Link para autoatendimento */}
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => {
                copyToClipboard(collaboratorPortalUrl, 'portal-url');
              }}
              className="text-xs font-bold text-slate-700 dark:text-zinc-200 hover:text-brand-aa inline-flex items-center gap-1.5 px-3.5 min-h-[44px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-[#111113] transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              title="Copiar link da página de custódia do colaborador"
            >
              {copiedId === 'portal-url' ? <Check size={14} className="text-emerald-500" aria-hidden="true" /> : <ExternalLink size={14} className="text-brand-aa" aria-hidden="true" />}
              <span>{copiedId === 'portal-url' ? 'Link Copiado!' : 'Copiar Link da Central'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                onClose();
                navigate(`/meus-ativos?employee=${encodeURIComponent(employee.name || '')}`);
              }}
              className="text-xs font-bold text-brand-aa hover:underline inline-flex items-center gap-1 px-3 min-h-[44px] rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand active:scale-[0.98]"
            >
              <span>Abrir Central</span>
              <ArrowUpRight size={14} aria-hidden="true" />
            </button>
          </div>

          {/* Botões de Termo & Devolução */}
          {canIssueTerms && (
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => onOpenTerm('responsabilidade')}
                className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-4 min-h-[44px] rounded-xl border border-slate-300 dark:border-zinc-700 font-bold text-xs text-slate-700 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                title="Emitir Termo de Responsabilidade e Uso"
              >
                <FileSignature size={15} className="text-brand-aa" aria-hidden="true" />
                <span>Emitir Termo</span>
              </button>

              <button
                type="button"
                onClick={() => onOpenTerm('devolucao')}
                disabled={assets.length === 0}
                className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-4 min-h-[44px] rounded-xl border border-slate-300 dark:border-zinc-700 font-bold text-xs text-slate-700 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
                title="Registrar devolução de ativos (desligamento ou troca)"
              >
                <Undo2 size={15} className="text-amber-500" aria-hidden="true" />
                <span>Devolução</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EmployeeCustodyModal;
