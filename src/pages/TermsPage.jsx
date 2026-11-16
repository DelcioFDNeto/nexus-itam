// src/pages/TermsPage.jsx
// -----------------------------------------------------------------------------
// Termos patrimoniais: responsabilidade, devolucao e transferencia/recebimento.
// Fluxo automatico: gerar o termo -> imprimir e assinar -> anexar o assinado.
// Anexar conclui sozinho (recebimento na loja, assinatura) e o QR impresso
// identifica cada arquivo no anexo em lote.
// /termos/:termId abre direto o detalhe — e o endereco do QR impresso no termo;
// com ?anexar=1 ja abre a conclusao.
// -----------------------------------------------------------------------------
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertCircle, AlertTriangle, Ban, Clock, FileCheck2, FileSignature, Paperclip, Printer, RefreshCcw, Search, Truck, Undo2, UploadCloud, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { useTermPrinter } from '../hooks/useTermPrinter';
import { cancelTransfer, getTerm, listTerms } from '../services/termService';
import { can } from '../utils/permissions';
import { captureFocusTarget, restoreFocusSafely, trapFocusWithin } from '../utils/focusTrap';
import { isTopmostModal } from '../utils/modalStack';
import { useConfirm } from '../components/ConfirmDialog';
import {
  canAttachSignedCopy, daysSinceIssue, isOverdue, OPEN_TERM_STATUSES, RECEIPT_OUTCOMES, resolveTermOptions, TERM_KINDS, TERM_STATUS,
} from '../utils/terms';
import { TermKindTag, TermStatusBadge } from '../components/terms/termUi';
import TermIssueModal from '../components/terms/TermIssueModal';
import TransferModal from '../components/terms/TransferModal';
import ConcludeTermModal from '../components/terms/ConcludeTermModal';
import SignedCopiesModal from '../components/terms/SignedCopiesModal';
import SignedCopyViewer from '../components/terms/SignedCopyViewer';

const formatDate = (date) => (date ? date.toLocaleDateString('pt-BR') : '—');

const norm = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

const counterpart = (term) =>
  term.kind === 'transferencia'
    ? `${term.origin?.name || '—'} → ${term.destination?.name || '—'}`
    : term.holder?.name || '—';

const missingItems = (term) => (term.receipt?.items || []).filter((i) => i.outcome === 'nao_recebido');

const FILTERS = [
  { id: 'abertos', label: 'Pendências' },
  { id: 'atrasados', label: 'Atrasados' },
  { id: 'todos', label: 'Todos' },
  { id: 'transferencia', label: 'Transferências' },
  { id: 'responsabilidade', label: 'Responsabilidade' },
  { id: 'devolucao', label: 'Devoluções' },
];

const isOpen = (term) => OPEN_TERM_STATUSES.includes(term.status) || missingItems(term).length > 0;

const STEPS = [
  { icon: FileSignature, title: 'Gere o termo', text: 'Pelo ativo, pela lista ou aqui. Itens e responsável já vêm preenchidos.' },
  { icon: Printer, title: 'Imprima e colete as assinaturas', text: 'Na transferência, a via segue com os equipamentos e a loja assina ao receber.' },
  { icon: UploadCloud, title: 'Anexe o assinado', text: 'O QR identifica o termo e conclui sozinho: itens na loja, termo assinado.' },
];

const ActionButton = ({ icon: Icon, children, onClick, tone = 'default', disabled, label }) => {
  const tones = {
    default: 'border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] text-slate-700 dark:text-zinc-200 hover:text-brand-aa hover:border-brand/40',
    primary: 'border-brand bg-brand hover:bg-brand-dark text-brand-fg',
    danger: 'border-rose-200 dark:border-rose-900 bg-white dark:bg-[#111113] text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl border text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-40 disabled:cursor-not-allowed ${tones[tone]}`}
    >
      <Icon size={14} aria-hidden="true" /> {children}
    </button>
  );
};

const OverdueTag = ({ term, overdueDays }) => {
  if (!OPEN_TERM_STATUSES.includes(term.status)) return null;
  const days = daysSinceIssue(term);
  const late = isOverdue(term, { days: overdueDays });
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-bold uppercase whitespace-nowrap tabular-nums ${late ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-zinc-400'}`}>
      <Clock size={12} aria-hidden="true" /> {late ? 'Atrasado · ' : ''}{days === 0 ? 'hoje' : `há ${days} dia${days > 1 ? 's' : ''}`}
    </span>
  );
};

const TermDetail = ({ term, onClose, actions, overdueDays, onViewCopy }) => {
  const titleId = useId();
  const dialogRef = useRef(null);
  const closeBtnRef = useRef(null);
  const previousFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const container = dialogRef.current;
    previousFocusRef.current = captureFocusTarget(container);
    const raf = requestAnimationFrame(() => {
      if (closeBtnRef.current) closeBtnRef.current.focus();
      else container?.focus();
    });
    const onKeyDown = (event) => {
      if (!isTopmostModal(container)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (event.key === 'Tab') {
        trapFocusWithin(event, container);
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

  const outcomes = Object.fromEntries((term.receipt?.items || []).map((i) => [i.id, i]));
  const isTransfer = term.kind === 'transferencia';
  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="fixed inset-0 z-[60] !mt-0 flex justify-end focus:outline-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={onClose} aria-hidden="true" />
      <aside className="relative h-full w-full max-w-xl bg-slate-50 dark:bg-[#09090b] border-l border-slate-200 dark:border-zinc-800 shadow-2xl flex flex-col">
        <header className="bg-white dark:bg-[#111113] border-b border-slate-200 dark:border-zinc-800 px-6 py-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <TermKindTag kind={term.kind} />
            <h2 id={titleId} className="mt-1 text-xl font-black text-slate-900 dark:text-[#fafafa] font-mono tabular-nums">{term.number}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <TermStatusBadge status={term.status} />
              <OverdueTag term={term} overdueDays={overdueDays} />
              <span className="text-xs text-slate-500 dark:text-zinc-400 tabular-nums">
                Emitido em {formatDate(term.issuedAtDate)} por {term.issuedByName || term.issuedBy}
              </span>
            </div>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-[#fafafa] transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto overscroll-contain custom-scrollbar p-6 space-y-4">
          {OPEN_TERM_STATUSES.includes(term.status) && (
            <p className="rounded-2xl border border-brand/30 bg-brand/5 dark:bg-brand/10 p-4 text-xs text-slate-700 dark:text-zinc-200">
              <strong>Próximo passo:</strong>{' '}
              {term.status === 'em_transito'
                ? `quando a via assinada pela ${term.destination?.name || 'loja'} voltar, anexe o PDF ou a foto. O recebimento é concluído sozinho.`
                : 'anexe o termo assinado (PDF ou foto). Ele passa para "Assinado".'}
            </p>
          )}

          {term.signedCopy ? (
            <button
              type="button"
              onClick={onViewCopy}
              className="w-full min-h-[44px] text-left rounded-2xl border border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/20 p-4 text-xs flex items-center gap-3 hover:border-emerald-400 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <FileCheck2 size={22} className="text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block font-black text-slate-900 dark:text-[#fafafa]">Termo assinado anexado</span>
                <span className="block text-slate-600 dark:text-zinc-300 truncate">{term.signedCopy.name} · por {term.signedCopy.uploadedByName || term.signedCopy.uploadedBy}</span>
              </span>
              <span className="text-xs font-bold uppercase text-emerald-700 dark:text-emerald-300">Ver</span>
            </button>
          ) : (
            !OPEN_TERM_STATUSES.includes(term.status) && term.status !== 'cancelado' && (
              <p className="rounded-2xl border border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/20 p-4 text-xs font-bold text-amber-700 dark:text-amber-300">
                Concluído sem o termo assinado anexado.
              </p>
            )
          )}

          {isTransfer ? (
            <div className="grid grid-cols-2 gap-3">
              {[['Origem', term.origin], ['Destino', term.destination]].map(([label, place]) => (
                <div key={label} className="rounded-2xl bg-white dark:bg-[#111113] border border-slate-200/80 dark:border-zinc-800 p-4">
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400">{label}</p>
                  <p className="mt-1 text-sm font-black text-slate-900 dark:text-[#fafafa]">{place?.name || '—'}</p>
                  {place?.address && <p className="text-xs text-slate-500 dark:text-zinc-400">{place.address}</p>}
                </div>
              ))}
              <div className="col-span-2 rounded-2xl bg-white dark:bg-[#111113] border border-slate-200/80 dark:border-zinc-800 p-4 grid grid-cols-2 gap-3 text-xs">
                <p><span className="font-bold text-slate-500 dark:text-zinc-400 uppercase text-xs">Recebedor</span><br /><span className="font-bold text-slate-800 dark:text-zinc-100">{term.receiver?.name || term.destination?.manager || '—'}</span></p>
                <p><span className="font-bold text-slate-500 dark:text-zinc-400 uppercase text-xs">Transporte</span><br /><span className="font-bold text-slate-800 dark:text-zinc-100">{[term.transport?.mode, term.transport?.carrier].filter(Boolean).join(' · ') || '—'}</span></p>
                <p><span className="font-bold text-slate-500 dark:text-zinc-400 uppercase text-xs">NF / romaneio</span><br /><span className="font-bold text-slate-800 dark:text-zinc-100 tabular-nums">{term.transport?.document || '—'}</span></p>
                <p><span className="font-bold text-slate-500 dark:text-zinc-400 uppercase text-xs">Previsão</span><br /><span className="font-bold text-slate-800 dark:text-zinc-100 tabular-nums">{term.expectedAt ? term.expectedAt.split('-').reverse().join('/') : '—'}</span></p>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl bg-white dark:bg-[#111113] border border-slate-200/80 dark:border-zinc-800 p-4 text-xs space-y-1">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400">{term.kind === 'devolucao' ? 'Devolvido por' : 'Responsável'}</p>
              <p className="text-sm font-black text-slate-900 dark:text-[#fafafa]">{term.holder?.name}</p>
              <p className="text-slate-500 dark:text-zinc-400 tabular-nums">{[term.holder?.cpf && `CPF ${term.holder.cpf}`, term.holder?.role, term.holder?.sector, term.holder?.branch].filter(Boolean).join(' · ')}</p>
              {term.kind === 'devolucao' && term.returnLocation && <p className="text-slate-500 dark:text-zinc-400">Recebido em {term.returnLocation} por {term.receivedByName}</p>}
            </div>
          )}

          {term.receipt && (
            <div className={`rounded-2xl border p-4 text-xs ${term.status === 'recebido' ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/20' : 'border-orange-200 bg-orange-50 dark:border-orange-900/60 dark:bg-orange-950/20'}`}>
              <p className="font-black text-slate-900 dark:text-[#fafafa] tabular-nums">Recebido por {term.receipt.receivedByName} em {term.receipt.receivedAt?.split('-').reverse().join('/')}</p>
              <p className="text-slate-600 dark:text-zinc-300">Conferência registrada por {term.receipt.confirmedByName || term.receipt.confirmedBy}.</p>
            </div>
          )}

          {term.status === 'assinado' && (
            <p className="rounded-2xl border border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/20 p-4 text-xs font-bold text-emerald-700 dark:text-emerald-300">
              Assinatura registrada por {term.signedByName || term.signedBy}.
            </p>
          )}
          {term.status === 'cancelado' && (
            <p className="rounded-2xl border border-slate-200 bg-slate-100 dark:border-zinc-800 dark:bg-[#111113] p-4 text-xs font-bold text-slate-600 dark:text-zinc-300">
              Cancelado por {term.cancelledBy}{term.cancelReason ? `: ${term.cancelReason}` : '.'}
            </p>
          )}

          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 mb-2 tabular-nums">Itens ({term.assets.length})</p>
            <ul className="divide-y divide-slate-100 dark:divide-zinc-800 rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113]">
              {term.assets.map((a) => {
                const outcome = outcomes[a.id];
                return (
                  <li key={a.id} className="px-4 py-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-900 dark:text-[#fafafa] truncate">{a.model || '—'}</p>
                      <p className="text-xs font-mono text-slate-500 dark:text-zinc-400 tabular-nums">{a.internalId}{a.serialNumber ? ` · SN ${a.serialNumber}` : ''}</p>
                      {outcome?.note && <p className="text-xs font-bold text-orange-600 dark:text-orange-400">{outcome.note}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-bold uppercase text-slate-500 dark:text-zinc-400">{a.condition}</p>
                      {outcome && (
                        <p className={`text-xs font-bold uppercase ${outcome.outcome === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : outcome.outcome === 'ressalva' ? 'text-orange-600 dark:text-orange-400' : 'text-rose-600 dark:text-rose-400'}`}>
                          {RECEIPT_OUTCOMES[outcome.outcome]}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          {term.notes && (
            <p className="rounded-2xl bg-white dark:bg-[#111113] border border-slate-200/80 dark:border-zinc-800 p-4 text-xs text-slate-600 dark:text-zinc-300 whitespace-pre-wrap">
              <span className="font-bold uppercase text-xs text-slate-500 dark:text-zinc-400 block mb-1">Observações</span>{term.notes}
            </p>
          )}
        </div>

        <footer className="bg-white dark:bg-[#111113] border-t border-slate-200 dark:border-zinc-800 px-6 py-4 flex flex-wrap gap-2 justify-end">{actions}</footer>
      </aside>
    </div>
  );
};

const TermsPage = () => {
  const { termId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const confirm = useConfirm();
  const { printTerm, settings } = useTermPrinter();
  const { overdueDays } = resolveTermOptions(settings);
  const canIssue = can(currentUser, 'terms:issue');
  const canCancel = can(currentUser, 'terms:cancel');

  const [terms, setTerms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState('abertos');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null); // { type, term? }
  const [extraTerm, setExtraTerm] = useState(null); // termo aberto pelo QR fora da lista
  const [busyId, setBusyId] = useState(null);
  const searchInputId = useId();

  const load = useCallback(async () => {
    if (!currentUser?.tenantId) return;
    setLoading(true);
    setLoadError('');
    try {
      setTerms(await listTerms(currentUser.tenantId));
    } catch (error) {
      console.error('Falha ao carregar termos:', error);
      setLoadError('Não foi possível carregar os termos. Verifique sua conexão e tente novamente.');
      toast.error('Não foi possível carregar os termos.');
    } finally {
      setLoading(false);
    }
  }, [currentUser?.tenantId]);

  useEffect(() => {
    load();
  }, [load]);

  const selected = terms.find((t) => t.id === termId) || (extraTerm?.id === termId ? extraTerm : null);

  // QR de um termo antigo (fora dos 300 mais recentes): busca individual.
  useEffect(() => {
    if (!termId || loading || terms.some((t) => t.id === termId)) return undefined;
    let active = true;
    getTerm(termId)
      .then((term) => {
        if (!active) return;
        if (term && term.tenantId === currentUser?.tenantId) setExtraTerm(term);
        else toast.error('Termo não encontrado.');
      })
      .catch(() => {
        if (active) toast.error('Termo não encontrado ou sem acesso.');
      });
    return () => {
      active = false;
    };
  }, [termId, loading, terms, currentUser?.tenantId]);

  // /termos/:id?anexar=1 (botao do ativo em transito): abre direto a conclusao.
  const autoConclude = canIssue && searchParams.get('anexar') === '1' && selected && canAttachSignedCopy(selected) ? selected : null;

  const counts = useMemo(() => ({
    transit: terms.filter((t) => t.status === 'em_transito').length,
    unsigned: terms.filter((t) => t.status === 'pendente').length,
    overdue: terms.filter((t) => isOverdue(t, { days: overdueDays })).length,
    issues: terms.filter((t) => t.status === 'recebido_ressalvas').length + terms.reduce((sum, t) => sum + missingItems(t).length, 0),
  }), [terms, overdueDays]);

  const visible = useMemo(() => {
    const q = norm(search.trim());
    return terms.filter((t) => {
      if (filter === 'abertos' && !isOpen(t)) return false;
      if (filter === 'atrasados' && !isOverdue(t, { days: overdueDays })) return false;
      if (TERM_KINDS[filter] && t.kind !== filter) return false;
      if (!q) return true;
      const haystack = [t.number, counterpart(t), t.receiver?.name, ...(t.assets || []).map((a) => `${a.internalId} ${a.model} ${a.serialNumber}`)].join(' ');
      return norm(haystack).includes(q);
    });
  }, [terms, filter, search, overdueDays]);

  const refresh = async () => {
    await load();
    setExtraTerm(null);
  };

  const closeModal = () => {
    setModal(null);
    if (autoConclude) navigate(`/termos/${autoConclude.id}`, { replace: true });
  };

  const cancel = async (term) => {
    const reason = await confirm({
      title: `Cancelar ${term.number}`,
      message: 'Os itens transferidos voltam ao status e local anteriores.',
      danger: true,
      confirmLabel: 'Cancelar Termo',
      input: {
        label: 'Motivo do cancelamento',
        placeholder: 'Descreva o motivo…',
        required: true,
      },
    });
    if (!reason) return;
    setBusyId(term.id);
    try {
      await cancelTransfer({ term, user: currentUser, reason });
      toast.success(`${term.number} cancelado.`);
      await refresh();
    } catch (error) {
      toast.error(error?.code === 'permission-denied' ? 'Cancelar exige perfil de gestor.' : error.message || 'Erro ao cancelar.');
    } finally {
      setBusyId(null);
    }
  };

  const rowActions = (term, detailed = false) => {
    const open = OPEN_TERM_STATUSES.includes(term.status);
    return (
      <>
        <ActionButton icon={Printer} label="Imprimir termo" onClick={() => printTerm(term)}>{detailed ? 'Imprimir' : ''}</ActionButton>
        {term.signedCopy && (
          <ActionButton icon={FileCheck2} label="Ver termo assinado" onClick={() => setModal({ type: 'viewer', term })}>{detailed ? 'Ver assinado' : ''}</ActionButton>
        )}
        {canIssue && canAttachSignedCopy(term) && (
          <ActionButton icon={Paperclip} tone={open ? 'primary' : 'default'} onClick={() => setModal({ type: 'conclude', term })} disabled={busyId === term.id}>
            {open ? 'Anexar assinado' : 'Anexar'}
          </ActionButton>
        )}
        {canCancel && term.status === 'em_transito' && detailed && (
          <ActionButton icon={Ban} tone="danger" onClick={() => cancel(term)} disabled={busyId === term.id}>
            Cancelar envio
          </ActionButton>
        )}
      </>
    );
  };

  const concludeTarget = modal?.type === 'conclude' ? modal.term : autoConclude;

  return (
    <div className="max-w-7xl mx-auto pb-24 space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-black text-slate-900 dark:text-[#fafafa] flex items-center gap-2">
            <FileSignature className="text-brand-aa" aria-hidden="true" /> Termos e transferências
          </h1>
          <p className="text-sm text-slate-600 dark:text-zinc-400">Responsabilidade, devolução e transferência entre unidades, com número e controle de assinatura.</p>
        </div>
        {canIssue && (
          <div className="flex flex-wrap lg:flex-nowrap gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setModal({ type: 'bulk' })}
              className="min-h-[44px] px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white dark:bg-zinc-100 dark:hover:bg-white dark:text-zinc-900 text-xs font-black uppercase tracking-wider flex items-center gap-2 shadow-sm transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <UploadCloud size={15} aria-hidden="true" /> Anexar assinados
            </button>
            <button
              type="button"
              onClick={() => setModal({ type: 'transfer' })}
              className="min-h-[44px] px-4 py-2.5 rounded-xl bg-brand hover:bg-brand-dark text-brand-fg text-xs font-black uppercase tracking-wider flex items-center gap-2 shadow-sm transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <Truck size={15} aria-hidden="true" /> Nova transferência
            </button>
            <button
              type="button"
              onClick={() => setModal({ type: 'responsabilidade' })}
              className="min-h-[44px] px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] hover:bg-slate-50 dark:hover:bg-zinc-800 text-slate-700 dark:text-zinc-200 text-xs font-black uppercase tracking-wider flex items-center gap-2 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <FileSignature size={15} aria-hidden="true" /> Responsabilidade
            </button>
            <button
              type="button"
              onClick={() => setModal({ type: 'devolucao' })}
              className="min-h-[44px] px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] hover:bg-slate-50 dark:hover:bg-zinc-800 text-slate-700 dark:text-zinc-200 text-xs font-black uppercase tracking-wider flex items-center gap-2 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <Undo2 size={15} aria-hidden="true" /> Devolução
            </button>
          </div>
        )}
      </div>

      {/* Como funciona */}
      <ol className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {STEPS.map(({ icon: Icon, title, text }, index) => (
          <li key={title} className="flex items-start gap-3 rounded-2xl border border-slate-200/90 dark:border-zinc-800 bg-white dark:bg-[#111113] p-3.5 shadow-sm">
            <span className="relative p-2.5 rounded-xl bg-brand/10 text-brand-aa shrink-0" aria-hidden="true">
              <Icon size={16} aria-hidden="true" />
              <span className="absolute -top-1.5 -left-1.5 h-5 w-5 rounded-full bg-brand text-brand-fg text-xs font-black flex items-center justify-center tabular-nums">
                {index + 1}
              </span>
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-black text-slate-900 dark:text-[#fafafa]">{title}</span>
              <span className="block text-xs text-slate-500 dark:text-zinc-400">{text}</span>
            </span>
          </li>
        ))}
      </ol>

      {/* Pendencias */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Em trânsito', value: counts.transit, icon: Truck, tone: 'text-sky-600 bg-sky-50 dark:bg-sky-950/40 dark:text-sky-300', target: 'transferencia' },
          { label: 'Aguardando assinatura', value: counts.unsigned, icon: FileSignature, tone: 'text-amber-600 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300', target: 'abertos' },
          { label: `Atrasados (+${overdueDays} dias)`, value: counts.overdue, icon: Clock, tone: 'text-rose-600 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-300', target: 'atrasados' },
          { label: 'Ressalvas e faltas', value: counts.issues, icon: AlertTriangle, tone: 'text-orange-600 bg-orange-50 dark:bg-orange-950/40 dark:text-orange-300', target: 'todos' },
        ].map(({ label, value, icon: Icon, tone, target }) => (
          <button
            key={label}
            type="button"
            onClick={() => setFilter(target)}
            className="min-h-[44px] text-left bg-white dark:bg-[#111113] rounded-2xl border border-slate-200/90 dark:border-zinc-800 hover:border-slate-300 dark:hover:border-zinc-700 p-4 shadow-sm flex items-center gap-3 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <span className={`p-2.5 rounded-xl ${tone}`} aria-hidden="true"><Icon size={18} aria-hidden="true" /></span>
            <span>
              <span className="block text-2xl font-black text-slate-900 dark:text-[#fafafa] tabular-nums">{value}</span>
              <span className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">{label}</span>
            </span>
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div className="bg-white dark:bg-[#111113] rounded-2xl border border-slate-200/90 dark:border-zinc-800 p-3 shadow-sm flex flex-col md:flex-row gap-3 md:items-center">
        <div className="flex gap-1 overflow-x-auto scrollbar-hide">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              className={`min-h-[44px] px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                filter === f.id
                  ? 'bg-slate-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative md:ml-auto md:w-80">
          <label htmlFor={searchInputId} className="sr-only">
            Buscar termos
          </label>
          <Search size={15} className="absolute left-3 top-3.5 text-slate-400 dark:text-zinc-500 pointer-events-none" aria-hidden="true" />
          <input
            id={searchInputId}
            name="termSearch"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Número, pessoa, loja ou patrimônio…"
            aria-label="Buscar termos"
            className="w-full min-h-[44px] pl-9 pr-3 py-2 rounded-xl bg-slate-50 hover:border-slate-300 active:border-slate-400 focus-visible:outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25 disabled:opacity-50 disabled:cursor-not-allowed aria-[invalid=true]:border-rose-500 aria-[invalid=true]:focus-visible:ring-rose-500/25 dark:bg-[#111113] dark:border-zinc-800 dark:hover:border-zinc-700 border border-slate-200 text-sm text-slate-900 dark:text-[#fafafa] placeholder:text-slate-400 dark:placeholder:text-zinc-500 transition-colors"
          />
        </div>
        <button
          type="button"
          onClick={refresh}
          aria-label="Recarregar"
          title="Recarregar"
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-zinc-800 text-slate-500 dark:text-zinc-400 hover:text-brand-aa hover:border-slate-300 dark:hover:border-zinc-700 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <RefreshCcw size={16} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
        </button>
      </div>

      {loadError && terms.length > 0 && (
        <div role="alert" className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
          <span className="flex items-center gap-2">
            <AlertCircle size={16} aria-hidden="true" /> {loadError}
          </span>
          <button
            type="button"
            onClick={load}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
          >
            <RefreshCcw size={14} aria-hidden="true" /> Tentar novamente
          </button>
        </div>
      )}

      {/* Lista */}
      <div className="bg-white dark:bg-[#111113] rounded-2xl border border-slate-200/90 dark:border-zinc-800 shadow-sm overflow-hidden">
        {loading && terms.length === 0 ? (
          <p role="status" className="p-10 text-center text-sm text-slate-500 dark:text-zinc-400">Carregando termos…</p>
        ) : loadError && terms.length === 0 ? (
          <div role="alert" className="p-12 text-center flex flex-col items-center space-y-4">
            <AlertCircle size={40} className="text-rose-500 opacity-80" aria-hidden="true" />
            <div className="space-y-1">
              <p className="font-bold text-slate-900 dark:text-[#fafafa]">Falha ao carregar os termos</p>
              <p className="text-xs text-slate-500 dark:text-zinc-400">{loadError}</p>
            </div>
            <button
              type="button"
              onClick={load}
              className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand hover:bg-brand-dark text-brand-fg text-xs font-bold transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <RefreshCcw size={14} aria-hidden="true" /> Tentar novamente
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className="p-10 text-center">
            <FileSignature size={32} className="mx-auto mb-3 text-slate-300 dark:text-zinc-600" aria-hidden="true" />
            <p className="font-bold text-slate-700 dark:text-zinc-200">
              {filter === 'abertos' ? 'Nenhuma pendência. Tudo assinado e recebido.' : filter === 'atrasados' ? 'Nada atrasado.' : 'Nenhum termo encontrado.'}
            </p>
            {canIssue && terms.length === 0 && (
              <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">Emita termos pelo detalhe do ativo, pela lista (seleção múltipla) ou pelos botões acima.</p>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-zinc-800/80">
            {visible.map((term) => (
              <li
                key={term.id}
                className="[content-visibility:auto] [contain-intrinsic-size:auto_56px] flex flex-col md:flex-row md:items-center gap-3 px-4 py-3 hover:bg-slate-50/70 dark:hover:bg-zinc-900/60 transition-colors"
              >
                <Link
                  to={`/termos/${term.id}`}
                  className="flex-1 min-w-0 min-h-[44px] text-left flex items-center gap-4 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  <div className="w-36 shrink-0">
                    <p className="font-mono text-sm font-black text-slate-900 dark:text-[#fafafa] flex items-center gap-1.5 tabular-nums">
                      {term.number}
                      {term.signedCopy && (
                        <span title="Assinado anexado" aria-label="Assinado anexado">
                          <Paperclip size={12} className="text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                        </span>
                      )}
                    </p>
                    <TermKindTag kind={term.kind} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-slate-800 dark:text-zinc-100 truncate">{counterpart(term)}</p>
                    <p className="text-xs text-slate-500 dark:text-zinc-400 truncate tabular-nums">
                      {formatDate(term.issuedAtDate)} · {term.assets?.length || 0} item(ns) · {term.assets?.slice(0, 3).map((a) => a.internalId).join(', ')}{term.assets?.length > 3 ? '…' : ''}
                    </p>
                    {missingItems(term).length > 0 && (
                      <p className="text-xs font-bold text-rose-600 dark:text-rose-400 tabular-nums">{missingItems(term).length} item(ns) não recebido(s)</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <TermStatusBadge status={term.status} />
                    <OverdueTag term={term} overdueDays={overdueDays} />
                  </div>
                </Link>
                <div className="flex gap-2 md:justify-end shrink-0">{rowActions(term)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selected && (
        <TermDetail
          key={selected.id}
          term={selected}
          overdueDays={overdueDays}
          onClose={() => navigate('/termos')}
          onViewCopy={() => setModal({ type: 'viewer', term: selected })}
          actions={rowActions(selected, true)}
        />
      )}

      {modal?.type === 'transfer' && <TransferModal onClose={() => setModal(null)} onDispatched={refresh} />}
      {(modal?.type === 'responsabilidade' || modal?.type === 'devolucao') && (
        <TermIssueModal kind={modal.type} onClose={() => setModal(null)} onIssued={refresh} />
      )}
      {concludeTarget && <ConcludeTermModal key={concludeTarget.id} term={concludeTarget} onClose={closeModal} onConcluded={refresh} />}
      {modal?.type === 'bulk' && <SignedCopiesModal terms={terms} onClose={() => setModal(null)} onDone={refresh} />}
      {modal?.type === 'viewer' && <SignedCopyViewer term={modal.term} onClose={() => setModal(null)} />}

      <p className="text-xs text-slate-500 dark:text-zinc-400">
        Status possíveis: {Object.values(TERM_STATUS).map((s) => s.label).join(' · ')}.
      </p>
    </div>
  );
};

export default TermsPage;
