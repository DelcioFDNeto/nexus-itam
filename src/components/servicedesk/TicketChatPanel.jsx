import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  CheckCheck,
  Clock,
  Download,
  Headphones,
  Loader2,
  Maximize2,
  MessageSquare,
  Minimize2,
  MonitorPlay,
  Paperclip,
  Send,
  User,
  X,
  ZoomIn,
} from 'lucide-react';
import {
  MAX_TICKET_ATTACHMENTS,
  extractClipboardImages,
  formatAttachmentBytes,
  isSupportStaffRole,
  processTicketImageFiles,
} from '../../utils/ticketMedia';
import {
  captureFocusTarget,
  getFocusableElements,
  restoreFocusSafely,
  trapFocusWithin,
} from '../../utils/focusTrap';
import { isTopmostModal } from '../../utils/modalStack';

const STATUS_META = {
  open: {
    label: 'Aberto',
    cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  },
  in_progress: {
    label: 'Em Atendimento',
    cls: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
  },
  resolved: {
    label: 'Resolvido',
    cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  },
  closed: {
    label: 'Fechado',
    cls: 'bg-slate-500/15 text-slate-700 dark:text-zinc-300 border-slate-500/30',
  },
};

const QUICK_TRIAGE_REPLIES = [
  'Olá! Já estou analisando seu chamado agora.',
  'Consegue enviar um print da tela ou mensagem de erro?',
  'Pode reiniciar o equipamento e testar novamente, por favor?',
];

function formatTime(iso) {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(iso) {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return String(iso);
  return dt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * Painel de atendimento e chat em tempo real estilo Helpdesk/WhatsApp para analistas de TI,
 * com suporte a envio de prints (Ctrl+V / arrastar / câmera), indicador de digitação e lightbox.
 */
export default function TicketChatPanel({
  ticket,
  comments = [],
  loading = false,
  wsStatus = 'disconnected',
  typingUser = null,
  matchingDevice = null,
  onClose,
  onSendMessage,
  onTyping,
  onUpdateStatus,
  onOpenRemote,
}) {
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [processingFiles, setProcessingFiles] = useState(false);
  const [sending, setSending] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [showResolveBox, setShowResolveBox] = useState(false);
  const [resolutionNote, setResolutionNote] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [lightboxItem, setLightboxItem] = useState(null);

  const threadEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const textareaRef = useRef(null);
  const lightboxRef = useRef(null);
  const returnFocusRef = useRef(null);
  const lastTypingSentAtRef = useRef(0);
  const idleTypingTimerRef = useRef(null);

  // Reseta rascunho ao trocar de chamado ativo e rola para o fim do histórico
  useEffect(() => {
    setDraft('');
    setAttachments([]);
    setMediaError('');
    setShowResolveBox(false);
    setResolutionNote('');
  }, [ticket?.id]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [ticket?.id, comments.length, typingUser?.senderName]);

  useEffect(() => {
    return () => {
      if (idleTypingTimerRef.current) clearTimeout(idleTypingTimerRef.current);
    };
  }, []);

  // Gerenciamento de foco e Esc para o Lightbox modal acessível
  useEffect(() => {
    if (!lightboxItem || !lightboxRef.current) return undefined;
    const dialogEl = lightboxRef.current;
    returnFocusRef.current = captureFocusTarget(dialogEl);
    const focusables = getFocusableElements(dialogEl);
    if (focusables.length > 0) focusables[0].focus();
    else dialogEl.focus();

    const handleKeyDown = (event) => {
      if (!isTopmostModal(dialogEl)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        setLightboxItem(null);
        return;
      }
      if (event.key === 'Tab') {
        trapFocusWithin(event, dialogEl);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const prev = returnFocusRef.current;
      returnFocusRef.current = null;
      restoreFocusSafely(prev, null, dialogEl);
    };
  }, [lightboxItem]);

  if (!ticket) return null;

  const statusInfo = STATUS_META[ticket.status] || STATUS_META.open;
  const openingAttachments = Array.isArray(ticket.attachments) ? ticket.attachments : [];

  const handleFiles = async (fileList) => {
    if (!fileList || fileList.length === 0) return;
    setProcessingFiles(true);
    setMediaError('');
    try {
      const { added, errors } = await processTicketImageFiles(
        fileList,
        attachments,
        MAX_TICKET_ATTACHMENTS,
      );
      if (added.length > 0) {
        setAttachments((prev) => [...prev, ...added]);
      }
      if (errors.length > 0) {
        setMediaError(errors[0]);
      }
    } finally {
      setProcessingFiles(false);
    }
  };

  const handlePaste = async (e) => {
    const imgs = extractClipboardImages(e.clipboardData);
    if (imgs.length > 0) {
      e.preventDefault();
      await handleFiles(imgs);
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer?.files?.length) {
      await handleFiles(e.dataTransfer.files);
    }
  };

  const notifyTyping = () => {
    if (!onTyping) return;
    const now = Date.now();
    if (now - lastTypingSentAtRef.current > 1800) {
      lastTypingSentAtRef.current = now;
      onTyping(true);
    }
    if (idleTypingTimerRef.current) clearTimeout(idleTypingTimerRef.current);
    idleTypingTimerRef.current = setTimeout(() => {
      onTyping(false);
    }, 2400);
  };

  const submitChat = async (e) => {
    e?.preventDefault?.();
    const cleanText = draft.trim();
    if (sending || processingFiles) return;
    if (!cleanText && attachments.length === 0) return;

    setSending(true);
    setMediaError('');
    if (idleTypingTimerRef.current) clearTimeout(idleTypingTimerRef.current);
    onTyping?.(false);

    try {
      const ok = await onSendMessage({
        message: cleanText,
        attachments: [...attachments],
      });
      if (ok) {
        setDraft('');
        setAttachments([]);
        textareaRef.current?.focus();
      }
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitChat();
    }
  };

  const handleStatusTransition = async (nextStatus, noteText = '') => {
    if (!onUpdateStatus || updatingStatus) return;
    setUpdatingStatus(true);
    try {
      await onUpdateStatus(nextStatus, noteText);
      if (nextStatus === 'resolved' || nextStatus === 'closed') {
        setShowResolveBox(false);
        setResolutionNote('');
      }
    } finally {
      setUpdatingStatus(false);
    }
  };

  return (
    <section
      aria-label={`Atendimento em tempo real do chamado ${ticket.protocol}`}
      onPaste={handlePaste}
      onDragOver={(e) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setDragActive(false);
      }}
      onDrop={handleDrop}
      className={`surface-card border-brand/30 shadow-lg flex flex-col overflow-hidden transition-all ${
        expanded ? 'min-h-[680px] max-h-[820px]' : 'min-h-[500px] max-h-[660px]'
      }`}
    >
      {/* Header da Conversa */}
      <header className="p-3.5 sm:p-4 border-b border-slate-200 dark:border-zinc-800 bg-slate-50/90 dark:bg-zinc-900/70 space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-xs font-bold text-slate-900 dark:text-zinc-100">
                {ticket.protocol}
              </span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${statusInfo.cls}`}>
                {statusInfo.label}
              </span>
              <span
                className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                  wsStatus === 'connected'
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25'
                    : 'bg-slate-200/70 text-slate-600 dark:bg-zinc-800 dark:text-zinc-400 border-slate-300 dark:border-zinc-700'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    wsStatus === 'connected' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
                  }`}
                />
                {wsStatus === 'connected' ? 'Ao vivo' : 'Sync'}
              </span>
            </div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-50 leading-snug truncate">
              {ticket.title}
            </h3>
            <p className="text-[11px] text-slate-600 dark:text-zinc-300 flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
              <span className="inline-flex items-center gap-1 font-medium">
                <User size={11} aria-hidden="true" />
                {ticket.requester_name} ({ticket.department})
              </span>
              {ticket.asset_tag && (
                <span className="font-mono text-[10px] bg-slate-200/80 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
                  {ticket.asset_tag}
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                <Clock size={11} aria-hidden="true" />
                SLA {formatDateTime(ticket.sla_due_at)}
              </span>
            </p>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              title={expanded ? 'Reduzir painel' : 'Expandir conversa'}
              aria-label={expanded ? 'Reduzir painel' : 'Expandir conversa'}
              className="min-h-[36px] min-w-[36px] rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-600 dark:text-zinc-300 hover:text-brand-aa flex items-center justify-center"
            >
              {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
            <button
              type="button"
              onClick={onClose}
              title="Fechar chat"
              aria-label="Fechar painel do chat"
              className="min-h-[36px] min-w-[36px] rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-600 dark:text-zinc-300 hover:text-rose-600 flex items-center justify-center"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Barra de Ações Rápidas de Triagem / NexusDesk */}
        <div className="flex flex-wrap items-center gap-1.5">
          {matchingDevice && onOpenRemote && (
            <button
              type="button"
              onClick={() => onOpenRemote(matchingDevice)}
              className="min-h-[36px] inline-flex items-center gap-1.5 rounded-lg border border-brand/35 bg-brand/10 px-2.5 py-1 text-[11px] font-bold text-brand-aa hover:bg-brand/15 transition-colors"
            >
              <MonitorPlay size={13} aria-hidden="true" />
              NexusDesk ({matchingDevice.assetTag})
            </button>
          )}
          {ticket.status === 'open' && (
            <button
              type="button"
              disabled={updatingStatus}
              onClick={() => handleStatusTransition('in_progress')}
              className="min-h-[36px] inline-flex items-center gap-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 px-2.5 py-1 text-[11px] font-bold text-amber-800 dark:text-amber-200 transition-colors disabled:opacity-50"
            >
              Assumir
            </button>
          )}
          {ticket.status !== 'resolved' && ticket.status !== 'closed' && (
            <button
              type="button"
              disabled={updatingStatus}
              onClick={() => setShowResolveBox((v) => !v)}
              className="min-h-[36px] inline-flex items-center gap-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 px-2.5 py-1 text-[11px] font-bold text-emerald-800 dark:text-emerald-200 transition-colors disabled:opacity-50"
            >
              <CheckCheck size={13} aria-hidden="true" />
              Concluir Chamado
            </button>
          )}
        </div>

        {showResolveBox && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2.5 space-y-2">
            <label
              htmlFor="chat-resolution-note"
              className="block text-[11px] font-bold text-emerald-900 dark:text-emerald-200"
            >
              Parecer técnico de resolução (opcional):
            </label>
            <textarea
              id="chat-resolution-note"
              rows={2}
              value={resolutionNote}
              onChange={(e) => setResolutionNote(e.target.value)}
              placeholder="Ex: Perfil de VPN reconfigurado e conexão validada com o colaborador."
              className="w-full rounded-lg border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-zinc-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowResolveBox(false)}
                className="min-h-[34px] px-2.5 text-[11px] font-semibold text-slate-700 dark:text-zinc-300"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={updatingStatus}
                onClick={() => handleStatusTransition('resolved', resolutionNote)}
                className="min-h-[34px] inline-flex items-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3 py-1 text-[11px] font-bold text-white disabled:opacity-50"
              >
                <Check size={13} />
                Confirmar Resolução
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Corpo do Chat em Tempo Real */}
      <div className="flex-1 overflow-y-auto p-3.5 sm:p-4 space-y-3 bg-slate-50/50 dark:bg-zinc-950/60 relative">
        {dragActive && (
          <div className="sticky top-0 z-10 rounded-xl border-2 border-dashed border-brand bg-brand/15 p-3 text-center text-xs font-bold text-brand-aa">
            Solte aqui as imagens ou prints para enviar no atendimento
          </div>
        )}

        {/* Descrição de Abertura + Evidências Iniciais */}
        <article className="surface-subtle p-3 space-y-2">
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
            <span>Abertura • {ticket.category}</span>
            <span>{formatDateTime(ticket.created_at)}</span>
          </div>
          <p className="text-xs text-slate-800 dark:text-zinc-100 whitespace-pre-wrap leading-relaxed">
            {ticket.description}
          </p>
          {openingAttachments.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
              {openingAttachments.map((att, idx) => (
                <button
                  key={att.id || `${att.name}-${idx}`}
                  type="button"
                  onClick={() => setLightboxItem(att)}
                  className="group relative rounded-lg overflow-hidden border border-slate-200 dark:border-zinc-700 aspect-video bg-slate-100 dark:bg-zinc-900 cursor-zoom-in"
                >
                  <img
                    src={att.dataUrl}
                    alt={att.name || 'Evidência da abertura'}
                    className="w-full h-full object-cover"
                  />
                  <span className="absolute bottom-1 right-1 rounded bg-slate-900/80 px-1.5 py-0.5 text-[10px] font-semibold text-white inline-flex items-center gap-1">
                    <ZoomIn size={10} />
                    Ver
                  </span>
                </button>
              ))}
            </div>
          )}
        </article>

        {ticket.resolution_notes && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-900 dark:text-emerald-200">
            <p className="font-bold">Parecer Técnico Registrado</p>
            <p className="mt-1 whitespace-pre-wrap">{ticket.resolution_notes}</p>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center gap-2 py-4 text-xs text-slate-500 dark:text-zinc-400">
            <Loader2 size={14} className="animate-spin" />
            Sincronizando conversa…
          </div>
        )}

        {!loading && comments.length === 0 && (
          <div className="text-center py-6 text-xs text-slate-500 dark:text-zinc-400 space-y-1">
            <MessageSquare size={22} className="mx-auto opacity-45" />
            <p>Nenhuma mensagem trocada ainda. Inicie o atendimento abaixo.</p>
          </div>
        )}

        {comments.map((cm) => {
          const staff = isSupportStaffRole(cm.author_role);
          const imgs = Array.isArray(cm.attachments) ? cm.attachments : [];
          return (
            <div key={cm.id} className={`flex ${staff ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 border space-y-1.5 shadow-2xs ${
                  staff
                    ? 'bg-brand/10 border-brand/25 text-slate-900 dark:text-zinc-50 rounded-tr-sm'
                    : 'bg-white dark:bg-zinc-900 border-slate-200 dark:border-zinc-700 text-slate-900 dark:text-zinc-100 rounded-tl-sm'
                }`}
              >
                <div className="flex items-center justify-between gap-3 text-[10px] font-bold">
                  <span className="inline-flex items-center gap-1">
                    {staff ? (
                      <>
                        <Headphones size={11} className="text-brand-aa" aria-hidden="true" />
                        <span>{cm.author_name} • TI</span>
                      </>
                    ) : (
                      <>
                        <User size={11} className="text-sky-600 dark:text-sky-400" aria-hidden="true" />
                        <span>{cm.author_name}</span>
                      </>
                    )}
                  </span>
                  <span className="font-mono font-normal text-slate-500 dark:text-zinc-400">
                    {formatTime(cm.created_at)}
                  </span>
                </div>

                {cm.message && (
                  <p className="text-xs whitespace-pre-wrap break-words leading-relaxed">
                    {cm.message}
                  </p>
                )}

                {imgs.length > 0 && (
                  <div className={`grid gap-1.5 ${imgs.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                    {imgs.map((att, idx) => (
                      <button
                        key={att.id || `${att.name}-${idx}`}
                        type="button"
                        onClick={() => setLightboxItem(att)}
                        className="relative rounded-lg overflow-hidden border border-slate-200 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-950 cursor-zoom-in block"
                      >
                        <img
                          src={att.dataUrl}
                          alt={att.name || 'Print enviado no atendimento'}
                          className="max-h-48 w-full object-cover"
                        />
                        <span className="absolute bottom-1 right-1 rounded bg-slate-900/80 px-1.5 py-0.5 text-[10px] font-semibold text-white inline-flex items-center gap-1">
                          <ZoomIn size={10} />
                          {formatAttachmentBytes(att.sizeBytes)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {typingUser && (
          <div className="flex justify-start">
            <div className="inline-flex items-center gap-2 rounded-2xl rounded-tl-sm border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-[11px] text-slate-600 dark:text-zinc-300">
              <span className="inline-flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-brand animate-bounce" />
                <span className="w-1.5 h-1.5 rounded-full bg-brand animate-bounce [animation-delay:120ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-brand animate-bounce [animation-delay:240ms]" />
              </span>
              <span>{typingUser.senderName || 'Colaborador'} está digitando…</span>
            </div>
          </div>
        )}

        <div ref={threadEndRef} />
      </div>

      {/* Footer de Resposta com Prints Ctrl+V + Quick Replies */}
      <footer className="p-3 border-t border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 space-y-2">
        {/* Sugestões rápidas de resposta da TI */}
        <div className="flex flex-wrap gap-1.5">
          {QUICK_TRIAGE_REPLIES.map((replyText) => (
            <button
              key={replyText}
              type="button"
              onClick={() => {
                setDraft(replyText);
                textareaRef.current?.focus();
              }}
              className="rounded-full border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-2.5 py-1 text-[10px] font-medium text-slate-700 dark:text-zinc-300 hover:border-brand hover:text-brand-aa transition-colors"
            >
              {replyText}
            </button>
          ))}
        </div>

        {mediaError && (
          <p role="alert" className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
            {mediaError}
          </p>
        )}

        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachments.map((att) => (
              <div
                key={att.id}
                className="relative w-14 h-14 rounded-lg overflow-hidden border border-slate-200 dark:border-zinc-700"
              >
                <button
                  type="button"
                  onClick={() => setLightboxItem(att)}
                  className="w-full h-full cursor-zoom-in"
                >
                  <img src={att.dataUrl} alt={att.name} className="w-full h-full object-cover" />
                </button>
                <button
                  type="button"
                  aria-label={`Remover ${att.name}`}
                  onClick={() => setAttachments((prev) => prev.filter((i) => i.id !== att.id))}
                  className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-slate-900/85 text-white flex items-center justify-center hover:bg-rose-600"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="sr-only"
          onChange={async (e) => {
            await handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={async (e) => {
            await handleFiles(e.target.files);
            e.target.value = '';
          }}
        />

        <form onSubmit={submitChat} className="flex items-end gap-2">
          <button
            type="button"
            disabled={processingFiles || attachments.length >= MAX_TICKET_ATTACHMENTS}
            onClick={() => fileInputRef.current?.click()}
            title="Anexar foto ou print (Ctrl+V também cola)"
            aria-label="Anexar foto ou print"
            className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-300 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 text-slate-700 dark:text-zinc-200 hover:border-brand hover:text-brand-aa flex items-center justify-center shrink-0 disabled:opacity-50"
          >
            <Paperclip size={16} />
          </button>

          <button
            type="button"
            disabled={processingFiles || attachments.length >= MAX_TICKET_ATTACHMENTS}
            onClick={() => cameraInputRef.current?.click()}
            aria-label="Fotografar evidência"
            className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-300 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 text-slate-700 dark:text-zinc-200 hover:border-brand flex items-center justify-center shrink-0 sm:hidden disabled:opacity-50"
          >
            <Camera size={16} />
          </button>

          <textarea
            ref={textareaRef}
            rows={1}
            value={draft}
            maxLength={2000}
            onChange={(e) => {
              setDraft(e.target.value);
              notifyTyping();
            }}
            onKeyDown={handleKeyDown}
            placeholder="Responder no chat em tempo real ou Ctrl+V print…"
            aria-label="Mensagem do atendimento"
            className="flex-1 min-h-[44px] max-h-28 resize-none rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3 py-2.5 text-xs text-slate-900 dark:text-zinc-50 placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          />

          <button
            type="submit"
            disabled={sending || processingFiles || (!draft.trim() && attachments.length === 0)}
            aria-label="Enviar mensagem no chat"
            className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-xs font-bold text-brand-fg hover:bg-brand-dark disabled:opacity-50 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <Send size={14} />
            <span>Enviar</span>
          </button>
        </form>
      </footer>

      {/* Modal Lightbox Acessível para Imagens */}
      {lightboxItem && (
        <div
          ref={lightboxRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label="Visualização ampliada de imagem do chamado"
          className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setLightboxItem(null);
          }}
        >
          <div className="relative max-w-4xl w-full bg-zinc-900 border border-zinc-700 rounded-2xl overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-800 text-white">
              <div className="min-w-0">
                <p className="text-xs sm:text-sm font-semibold truncate">
                  {lightboxItem.name || 'Evidência anexada'}
                </p>
                <p className="text-[11px] text-zinc-400">
                  {formatAttachmentBytes(lightboxItem.sizeBytes)}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={lightboxItem.dataUrl}
                  download={lightboxItem.name || 'evidencia.jpg'}
                  className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  <Download size={14} />
                  Baixar
                </a>
                <button
                  type="button"
                  aria-label="Fechar visualização"
                  onClick={() => setLightboxItem(null)}
                  className="min-h-[40px] min-w-[40px] rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white flex items-center justify-center"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="bg-black flex items-center justify-center p-3 max-h-[82vh] overflow-auto">
              <img
                src={lightboxItem.dataUrl}
                alt={lightboxItem.name || 'Evidência ampliada'}
                className="max-h-[76vh] w-auto rounded-lg object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
