// src/pages/TermsPage.jsx
// -----------------------------------------------------------------------------
// Termos patrimoniais: responsabilidade, devolucao e transferencia/recebimento.
// Fluxo automatico: gerar o termo -> imprimir e assinar -> anexar o assinado.
// Anexar conclui sozinho (recebimento na loja, assinatura) e o QR impresso
// identifica cada arquivo no anexo em lote.
// /termos/:termId abre direto o detalhe — e o endereco do QR impresso no termo;
// com ?anexar=1 ja abre a conclusao.
// -----------------------------------------------------------------------------
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, Ban, Clock, FileCheck2, FileSignature, Paperclip, Printer, RefreshCcw, Search, Truck, Undo2, UploadCloud, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { useTermPrinter } from '../hooks/useTermPrinter';
import { cancelTransfer, getTerm, listTerms } from '../services/termService';
import { can } from '../utils/permissions';
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
    default: 'border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300 hover:text-brand hover:border-brand/40',
    primary: 'border-brand bg-brand text-white hover:bg-brand-dark',
    danger: 'border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`px-3 py-2 rounded-xl border text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 ${tones[tone]}`}
    >
      <Icon size={13} /> {children}
    </button>
  );
};

const OverdueTag = ({ term, overdueDays }) => {
  if (!OPEN_TERM_STATUSES.includes(term.status)) return null;
  const days = daysSinceIssue(term);
  const late = isOverdue(term, { days: overdueDays });
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-black uppercase whitespace-nowrap ${late ? 'text-rose-600 dark:text-rose-400' : 'text-gray-400'}`}>
      <Clock size={11} /> {late ? 'Atrasado · ' : ''}{days === 0 ? 'hoje' : `há ${days} dia${days > 1 ? 's' : ''}`}
    </span>
  );
};

const TermDetail = ({ term, onClose, actions, overdueDays, onViewCopy }) => {
  const outcomes = Object.fromEntries((term.receipt?.items || []).map((i) => [i.id, i]));
  const isTransfer = term.kind === 'transferencia';
  return (
    <div className="fixed inset-0 z-[60] !mt-0 flex justify-end" role="dialog" aria-modal="true" aria-label={`Termo ${term.number}`}>
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <aside className="relative h-full w-full max-w-xl bg-slate-50 dark:bg-slate-950 shadow-2xl flex flex-col">
        <header className="bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800 px-6 py-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <TermKindTag kind={term.kind} />
            <h2 className="mt-1 text-xl font-black text-gray-900 dark:text-white font-mono">{term.number}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <TermStatusBadge status={term.status} />
              <OverdueTag term={term} overdueDays={overdueDays} />
              <span className="text-[11px] text-gray-500 dark:text-gray-400">Emitido em {formatDate(term.issuedAtDate)} por {term.issuedByName || term.issuedBy}</span>
            </div>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="p-2 rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-slate-800 dark:hover:text-white">
            <X size={20} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-4">
          {OPEN_TERM_STATUSES.includes(term.status) && (
            <p className="rounded-2xl border border-brand/30 bg-brand/5 p-4 text-xs text-gray-700 dark:text-gray-200">
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
              className="w-full text-left rounded-2xl border border-green-200 bg-green-50 dark:border-green-900/60 dark:bg-green-950/20 p-4 text-xs flex items-center gap-3 hover:border-green-400"
            >
              <FileCheck2 size={22} className="text-green-600 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block font-black text-gray-900 dark:text-white">Termo assinado anexado</span>
                <span className="block text-gray-600 dark:text-gray-300 truncate">{term.signedCopy.name} · por {term.signedCopy.uploadedByName || term.signedCopy.uploadedBy}</span>
              </span>
              <span className="text-[10px] font-black uppercase text-green-700 dark:text-green-300">Ver</span>
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
                <div key={label} className="rounded-2xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 p-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{label}</p>
                  <p className="mt-1 text-sm font-black text-gray-900 dark:text-white">{place?.name || '—'}</p>
                  {place?.address && <p className="text-[11px] text-gray-500 dark:text-gray-400">{place.address}</p>}
                </div>
              ))}
              <div className="col-span-2 rounded-2xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 p-4 grid grid-cols-2 gap-2 text-xs">
                <p><span className="font-black text-gray-400 uppercase text-[10px]">Recebedor</span><br /><span className="font-bold text-gray-800 dark:text-gray-100">{term.receiver?.name || term.destination?.manager || '—'}</span></p>
                <p><span className="font-black text-gray-400 uppercase text-[10px]">Transporte</span><br /><span className="font-bold text-gray-800 dark:text-gray-100">{[term.transport?.mode, term.transport?.carrier].filter(Boolean).join(' · ') || '—'}</span></p>
                <p><span className="font-black text-gray-400 uppercase text-[10px]">NF / romaneio</span><br /><span className="font-bold text-gray-800 dark:text-gray-100">{term.transport?.document || '—'}</span></p>
                <p><span className="font-black text-gray-400 uppercase text-[10px]">Previsão</span><br /><span className="font-bold text-gray-800 dark:text-gray-100">{term.expectedAt ? term.expectedAt.split('-').reverse().join('/') : '—'}</span></p>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 p-4 text-xs space-y-1">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{term.kind === 'devolucao' ? 'Devolvido por' : 'Responsável'}</p>
              <p className="text-sm font-black text-gray-900 dark:text-white">{term.holder?.name}</p>
              <p className="text-gray-500 dark:text-gray-400">{[term.holder?.cpf && `CPF ${term.holder.cpf}`, term.holder?.role, term.holder?.sector, term.holder?.branch].filter(Boolean).join(' · ')}</p>
              {term.kind === 'devolucao' && term.returnLocation && <p className="text-gray-500 dark:text-gray-400">Recebido em {term.returnLocation} por {term.receivedByName}</p>}
            </div>
          )}

          {term.receipt && (
            <div className={`rounded-2xl border p-4 text-xs ${term.status === 'recebido' ? 'border-green-200 bg-green-50 dark:border-green-900/60 dark:bg-green-950/20' : 'border-orange-200 bg-orange-50 dark:border-orange-900/60 dark:bg-orange-950/20'}`}>
              <p className="font-black text-gray-900 dark:text-white">Recebido por {term.receipt.receivedByName} em {term.receipt.receivedAt?.split('-').reverse().join('/')}</p>
              <p className="text-gray-600 dark:text-gray-300">Conferência registrada por {term.receipt.confirmedByName || term.receipt.confirmedBy}.</p>
            </div>
          )}

          {term.status === 'assinado' && (
            <p className="rounded-2xl border border-green-200 bg-green-50 dark:border-green-900/60 dark:bg-green-950/20 p-4 text-xs font-bold text-green-700 dark:text-green-300">
              Assinatura registrada por {term.signedByName || term.signedBy}.
            </p>
          )}
          {term.status === 'cancelado' && (
            <p className="rounded-2xl border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-900 p-4 text-xs font-bold text-slate-600 dark:text-slate-300">
              Cancelado por {term.cancelledBy}{term.cancelReason ? `: ${term.cancelReason}` : '.'}
            </p>
          )}

          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-2">Itens ({term.assets.length})</p>
            <ul className="divide-y divide-gray-100 dark:divide-slate-800 rounded-2xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              {term.assets.map((a) => {
                const outcome = outcomes[a.id];
                return (
                  <li key={a.id} className="px-4 py-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{a.model || '—'}</p>
                      <p className="text-[11px] font-mono text-gray-500 dark:text-gray-400">{a.internalId}{a.serialNumber ? ` · SN ${a.serialNumber}` : ''}</p>
                      {outcome?.note && <p className="text-[11px] font-bold text-orange-600 dark:text-orange-400">{outcome.note}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[10px] font-black uppercase text-gray-400">{a.condition}</p>
                      {outcome && (
                        <p className={`text-[10px] font-black uppercase ${outcome.outcome === 'ok' ? 'text-green-600' : outcome.outcome === 'ressalva' ? 'text-orange-600' : 'text-rose-600'}`}>
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
            <p className="rounded-2xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 p-4 text-xs text-gray-600 dark:text-gray-300 whitespace-pre-wrap">
              <span className="font-black uppercase text-[10px] text-gray-400 block mb-1">Observações</span>{term.notes}
            </p>
          )}
        </div>

        <footer className="bg-white dark:bg-slate-900 border-t border-gray-200 dark:border-slate-800 px-6 py-4 flex flex-wrap gap-2 justify-end">{actions}</footer>
      </aside>
    </div>
  );
};

const TermsPage = () => {
  const { termId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { printTerm, settings } = useTermPrinter();
  const { overdueDays } = resolveTermOptions(settings);
  const canIssue = can(currentUser, 'terms:issue');
  const canCancel = can(currentUser, 'terms:cancel');

  const [terms, setTerms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('abertos');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null); // { type, term? }
  const [extraTerm, setExtraTerm] = useState(null); // termo aberto pelo QR fora da lista
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    if (!currentUser?.tenantId) return;
    setLoading(true);
    try {
      setTerms(await listTerms(currentUser.tenantId));
    } catch (error) {
      console.error('Falha ao carregar termos:', error);
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
    if (!termId || loading || terms.some((t) => t.id === termId)) return;
    getTerm(termId)
      .then((term) => {
        if (term && term.tenantId === currentUser?.tenantId) setExtraTerm(term);
        else toast.error('Termo não encontrado.');
      })
      .catch(() => toast.error('Termo não encontrado ou sem acesso.'));
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
    const reason = prompt(`Cancelar ${term.number}? Os itens voltam ao status anterior.\n\nMotivo do cancelamento:`);
    if (reason === null) return;
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
          <h1 className="text-2xl font-black text-gray-900 dark:text-white flex items-center gap-2">
            <FileSignature className="text-brand" /> Termos e transferências
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Responsabilidade, devolução e transferência entre unidades, com número e controle de assinatura.</p>
        </div>
        {canIssue && (
          <div className="flex flex-wrap lg:flex-nowrap gap-2 shrink-0">
            <button onClick={() => setModal({ type: 'bulk' })} className="px-4 py-2.5 rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-xs font-black uppercase tracking-wider flex items-center gap-2 shadow-md">
              <UploadCloud size={15} /> Anexar assinados
            </button>
            <button onClick={() => setModal({ type: 'transfer' })} className="px-4 py-2.5 rounded-xl bg-brand text-white text-xs font-black uppercase tracking-wider flex items-center gap-2 shadow-md shadow-brand/30">
              <Truck size={15} /> Nova transferência
            </button>
            <button onClick={() => setModal({ type: 'responsabilidade' })} className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200 text-xs font-black uppercase tracking-wider flex items-center gap-2">
              <FileSignature size={15} /> Responsabilidade
            </button>
            <button onClick={() => setModal({ type: 'devolucao' })} className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200 text-xs font-black uppercase tracking-wider flex items-center gap-2">
              <Undo2 size={15} /> Devolução
            </button>
          </div>
        )}
      </div>

      {/* Como funciona */}
      <ol className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {STEPS.map(({ icon: Icon, title, text }, index) => (
          <li key={title} className="flex items-start gap-3 rounded-2xl border border-gray-100 dark:border-slate-700 bg-white/60 dark:bg-slate-800/60 p-3">
            <span className="relative p-2 rounded-xl bg-brand/10 text-brand shrink-0">
              <Icon size={16} />
              <span className="absolute -top-1.5 -left-1.5 h-4 w-4 rounded-full bg-brand text-white text-[9px] font-black flex items-center justify-center">{index + 1}</span>
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-black text-gray-900 dark:text-white">{title}</span>
              <span className="block text-[11px] text-gray-500 dark:text-gray-400">{text}</span>
            </span>
          </li>
        ))}
      </ol>

      {/* Pendencias */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Em trânsito', value: counts.transit, icon: Truck, tone: 'text-blue-600 bg-blue-50 dark:bg-blue-950/40 dark:text-blue-300', target: 'transferencia' },
          { label: 'Aguardando assinatura', value: counts.unsigned, icon: FileSignature, tone: 'text-amber-600 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300', target: 'abertos' },
          { label: `Atrasados (+${overdueDays} dias)`, value: counts.overdue, icon: Clock, tone: 'text-rose-600 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-300', target: 'atrasados' },
          { label: 'Ressalvas e faltas', value: counts.issues, icon: AlertTriangle, tone: 'text-orange-600 bg-orange-50 dark:bg-orange-950/40 dark:text-orange-300', target: 'todos' },
        ].map(({ label, value, icon: Icon, tone, target }) => (
          <button key={label} onClick={() => setFilter(target)} className="text-left bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-4 shadow-sm flex items-center gap-3">
            <span className={`p-2.5 rounded-xl ${tone}`}><Icon size={18} /></span>
            <span>
              <span className="block text-2xl font-black text-gray-900 dark:text-white tabular-nums">{value}</span>
              <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{label}</span>
            </span>
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-3 shadow-sm flex flex-col md:flex-row gap-3 md:items-center">
        <div className="flex gap-1 overflow-x-auto scrollbar-hide">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              className={`px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-colors ${filter === f.id ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative md:ml-auto md:w-80">
          <Search size={15} className="absolute left-3 top-2.5 text-gray-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Número, pessoa, loja ou patrimônio…"
            aria-label="Buscar termos"
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:border-brand"
          />
        </div>
        <button onClick={refresh} aria-label="Recarregar" title="Recarregar" className="p-2 rounded-xl border border-gray-200 dark:border-slate-700 text-gray-500 hover:text-brand">
          <RefreshCcw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Lista */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm overflow-hidden">
        {loading && terms.length === 0 ? (
          <p className="p-10 text-center text-sm text-gray-400">Carregando termos…</p>
        ) : visible.length === 0 ? (
          <div className="p-10 text-center">
            <FileSignature size={32} className="mx-auto mb-3 text-gray-300 dark:text-slate-600" />
            <p className="font-bold text-gray-700 dark:text-gray-200">
              {filter === 'abertos' ? 'Nenhuma pendência. Tudo assinado e recebido.' : filter === 'atrasados' ? 'Nada atrasado.' : 'Nenhum termo encontrado.'}
            </p>
            {canIssue && terms.length === 0 && (
              <p className="text-xs text-gray-400 mt-1">Emita termos pelo detalhe do ativo, pela lista (seleção múltipla) ou pelos botões acima.</p>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-slate-700/60">
            {visible.map((term) => (
              <li key={term.id} className="flex flex-col md:flex-row md:items-center gap-3 px-4 py-3 hover:bg-gray-50/70 dark:hover:bg-slate-900/40">
                <button onClick={() => navigate(`/termos/${term.id}`)} className="flex-1 min-w-0 text-left flex items-center gap-4">
                  <div className="w-36 shrink-0">
                    <p className="font-mono text-sm font-black text-gray-900 dark:text-white flex items-center gap-1.5">
                      {term.number}
                      {term.signedCopy && <Paperclip size={12} className="text-green-600" aria-label="Assinado anexado" />}
                    </p>
                    <TermKindTag kind={term.kind} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-gray-800 dark:text-gray-100 truncate">{counterpart(term)}</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                      {formatDate(term.issuedAtDate)} · {term.assets?.length || 0} item(ns) · {term.assets?.slice(0, 3).map((a) => a.internalId).join(', ')}{term.assets?.length > 3 ? '…' : ''}
                    </p>
                    {missingItems(term).length > 0 && (
                      <p className="text-[11px] font-bold text-rose-600 dark:text-rose-400">{missingItems(term).length} item(ns) não recebido(s)</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <TermStatusBadge status={term.status} />
                    <OverdueTag term={term} overdueDays={overdueDays} />
                  </div>
                </button>
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

      <p className="text-[11px] text-gray-400 dark:text-gray-500">
        Status possíveis: {Object.values(TERM_STATUS).map((s) => s.label).join(' · ')}.
      </p>
    </div>
  );
};

export default TermsPage;
