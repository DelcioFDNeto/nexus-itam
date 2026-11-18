// src/pages/ServiceDeskHub.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  FileSignature,
  Image as ImageIcon,
  Inbox,
  Laptop,
  Lock,
  MessageSquare,
  Monitor,
  Network,
  Paperclip,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Tag,
  Terminal,
  Ticket,
  Trash2,
  TrendingUp,
  UploadCloud,
  User,
  X,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  clearGatewaySession,
  getGatewaySession,
  microservicesApi,
  onGatewaySessionChange,
  resolvePortalUrl,
} from '../services/microservicesClient';
import { useAuth } from '../contexts/AuthContext';
import { hasPermission } from '../utils/permissions';
import { hasPlanFeature } from '../utils/entitlements';
import { useConfirm } from '../components/ConfirmDialog';
import RemoteControlModal from '../components/RemoteControlModal';
import TicketChatPanel from '../components/servicedesk/TicketChatPanel';
import {
  MAX_TICKET_ATTACHMENTS,
  TICKET_QUICK_TEMPLATES,
  extractClipboardImages,
  processTicketImageFiles,
} from '../utils/ticketMedia';
import { buildBrandedPortalUrl } from '../utils/portalBranding';
import {
  captureFocusTarget,
  getFocusableElements,
  restoreFocusSafely,
  trapFocusWithin,
} from '../utils/focusTrap';
import { isTopmostModal } from '../utils/modalStack';

const STATUS_BADGES = {
  open: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25',
  in_progress: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/25',
  resolved: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25',
  closed: 'bg-zinc-500/10 text-zinc-700 dark:text-zinc-300 border-zinc-500/25',
};

const STATUS_NAMES = {
  open: 'Aberto',
  in_progress: 'Em Atendimento',
  resolved: 'Resolvido',
  closed: 'Encerrado',
};

const PRIORITY_BADGES = {
  critical: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
  high: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20',
  medium: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20',
  low: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20',
};

const PRIORITY_NAMES = {
  critical: 'Crítica',
  high: 'Alta',
  medium: 'Normal',
  low: 'Baixa',
};

const PRIORITY_META = {
  critical: { label: 'P1 Crítica', color: 'bg-rose-500', text: 'text-rose-600 dark:text-rose-400', border: 'border-rose-500/30 bg-rose-500/10' },
  high: { label: 'P2 Alta', color: 'bg-orange-500', text: 'text-orange-600 dark:text-orange-400', border: 'border-orange-500/30 bg-orange-500/10' },
  medium: { label: 'P3 Normal', color: 'bg-sky-500', text: 'text-sky-600 dark:text-sky-400', border: 'border-sky-500/30 bg-sky-500/10' },
  low: { label: 'P4 Baixa', color: 'bg-slate-400', text: 'text-slate-600 dark:text-slate-400', border: 'border-slate-500/30 bg-slate-500/10' },
};

const CATEGORY_NAMES = {
  hardware: 'Hardware',
  software: 'Software',
  network: 'Rede & VPN',
  access: 'Acesso',
  other: 'Geral',
};

const formatRelativeTime = (timestamp) => {
  if (!timestamp) return 'Hoje';
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return 'Hoje';
    const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
    if (diffSec < 60) return 'agora';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `há ${diffMin} min`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `há ${diffHours}h`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return 'ontem';
    if (diffDays < 7) return `há ${diffDays} dias`;
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  } catch {
    return 'Recente';
  }
};

const ServiceDeskHub = () => {
  const { currentUser } = useAuth?.() || {};
  const confirm = useConfirm();
  const [gatewaySession, setGatewaySessionState] = useState(() => getGatewaySession());
  const [remoteModalDevice, setRemoteModalDevice] = useState(null);
  const [clusterHealth, setClusterHealth] = useState(null);
  const [healthError, setHealthError] = useState('');
  const [wsStatus, setWsStatus] = useState('disconnected');
  const [wsFeed, setWsFeed] = useState([]);

  const [tickets, setTickets] = useState([]);
  const [terms, setTerms] = useState([]);
  const [fleet, setFleet] = useState({ summary: {}, devices: [] });
  const [chainReport, setChainReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeTicketCommentId, setActiveTicketCommentId] = useState(null);
  const [ticketDetailMap, setTicketDetailMap] = useState({});
  const [ticketCommentsMap, setTicketCommentsMap] = useState({});
  const [unreadTicketsMap, setUnreadTicketsMap] = useState({});
  const [typingByTicket, setTypingByTicket] = useState({});
  const [loadingCommentsId, setLoadingCommentsId] = useState(null);
  const [ticketFilter, setTicketFilter] = useState('all');
  const [ticketSearch, setTicketSearch] = useState('');
  const [showDevDrawer, setShowDevDrawer] = useState(false);

  const [isNewTicketModalOpen, setIsNewTicketModalOpen] = useState(false);
  const [submittingTicket, setSubmittingTicket] = useState(false);
  const [newTicketAttachments, setNewTicketAttachments] = useState([]);
  const [processingModalImages, setProcessingModalImages] = useState(false);
  const [modalDropActive, setModalDropActive] = useState(false);
  const [newTicketForm, setNewTicketForm] = useState({
    title: '',
    description: '',
    category: 'hardware',
    priority: 'medium',
    assetTag: '',
    department: 'TI Corporativa',
  });

  const [isNewTermModalOpen, setIsNewTermModalOpen] = useState(false);
  const [submittingTerm, setSubmittingTerm] = useState(false);
  const [archivingTicketIds, setArchivingTicketIds] = useState({});
  const [archivingTermIds, setArchivingTermIds] = useState({});
  const archivingTicketRef = useRef(new Set());
  const archivingTermRef = useRef(new Set());
  const canArchiveToVps = useMemo(() => {
    const actor = currentUser || gatewaySession?.user;
    if (!actor) return false;
    const role = String(actor.role || '').toLowerCase();
    if (role === 'superadmin' || role === 'viewer' || actor.tenantId === 'nexus-master') return false;
    return hasPermission(actor, 'cloud:write') && hasPlanFeature(actor, 'cloud_storage');
  }, [currentUser, gatewaySession?.user]);
  const [newTermForm, setNewTermForm] = useState({
    termType: 'entrega',
    employeeName: '',
    employeeEmail: '',
    department: 'TI & Operações',
    internalId: '',
    model: '',
    serialNumber: '',
  });

  const [credentials, setCredentials] = useState(() => ({
    email: '',
    password: '',
  }));

  const wsRef = useRef(null);
  const wsFeedSeqRef = useRef(0);
  const activeTicketCommentIdRef = useRef(null);
  const commentsReqSeqRef = useRef(0);
  const newTicketModalRef = useRef(null);
  const newTermModalRef = useRef(null);
  const newTicketFileInputRef = useRef(null);
  const chatPanelWrapperRef = useRef(null);
  const typingTimersRef = useRef({});
  const modalReturnFocusRef = useRef(null);
  const isModalSubmittingRef = useRef(false);
  const portalUrl = buildBrandedPortalUrl(resolvePortalUrl(), currentUser || gatewaySession?.user);

  useEffect(() => {
    isModalSubmittingRef.current = submittingTicket || submittingTerm;
  }, [submittingTicket, submittingTerm]);

  useEffect(() => {
    activeTicketCommentIdRef.current = activeTicketCommentId;
  }, [activeTicketCommentId]);

  useEffect(() => {
    const activeModalEl = isNewTicketModalOpen
      ? newTicketModalRef.current
      : isNewTermModalOpen
        ? newTermModalRef.current
        : null;

    if (!activeModalEl) return undefined;

    modalReturnFocusRef.current = captureFocusTarget(activeModalEl);
    const focusables = getFocusableElements(activeModalEl);
    if (focusables.length > 0) {
      focusables[0].focus();
    } else {
      activeModalEl.focus();
    }

    const handleKeyDown = (event) => {
      if (!isTopmostModal(activeModalEl)) return;

      if (event.key === 'Escape') {
        if (isModalSubmittingRef.current) return;
        event.preventDefault();
        if (isNewTicketModalOpen) setIsNewTicketModalOpen(false);
        if (isNewTermModalOpen) setIsNewTermModalOpen(false);
        return;
      }

      if (event.key === 'Tab') {
        trapFocusWithin(event, activeModalEl);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const previous = modalReturnFocusRef.current;
      modalReturnFocusRef.current = null;
      restoreFocusSafely(previous, null, activeModalEl);
    };
  }, [isNewTicketModalOpen, isNewTermModalOpen]);

  const handleNewTicketFiles = async (fileList) => {
    if (!fileList || fileList.length === 0) return;
    setProcessingModalImages(true);
    try {
      const { added, errors } = await processTicketImageFiles(
        fileList,
        newTicketAttachments,
        MAX_TICKET_ATTACHMENTS,
      );
      if (added.length > 0) {
        setNewTicketAttachments((prev) => [...prev, ...added]);
      }
      if (errors.length > 0) {
        toast.error(errors[0]);
      }
    } finally {
      setProcessingModalImages(false);
    }
  };

  const handleNewTicketPaste = async (e) => {
    const imgs = extractClipboardImages(e.clipboardData);
    if (imgs.length > 0) {
      e.preventDefault();
      await handleNewTicketFiles(imgs);
    }
  };

  const handleCreateNewTicket = async (e) => {
    e.preventDefault();
    if (!newTicketForm.title.trim()) {
      toast.error('Preencha o título do chamado.');
      return;
    }
    if (!newTicketForm.description.trim() && newTicketAttachments.length === 0) {
      toast.error('Descreva o problema ou anexe pelo menos uma foto/print.');
      return;
    }
    setSubmittingTicket(true);
    try {
      const created = await microservicesApi.createTicket({
        title: newTicketForm.title.trim(),
        description:
          newTicketForm.description.trim() ||
          'Evidência visual (foto/print) anexada na abertura do chamado.',
        category: newTicketForm.category,
        priority: newTicketForm.priority,
        department: newTicketForm.department || 'Corporativo',
        assetTag: newTicketForm.assetTag.trim() || null,
        attachments: newTicketAttachments,
      });
      toast.success(`Chamado ${created?.protocol || ''} registrado com sucesso!`);
      setIsNewTicketModalOpen(false);
      setNewTicketForm({
        title: '',
        description: '',
        category: 'hardware',
        priority: 'medium',
        assetTag: '',
        department: 'TI Corporativa',
      });
      setNewTicketAttachments([]);
      if (created?.id) {
        setTicketDetailMap((prev) => ({ ...prev, [created.id]: created }));
        setTicketCommentsMap((prev) => ({ ...prev, [created.id]: [] }));
        activeTicketCommentIdRef.current = created.id;
        setActiveTicketCommentId(created.id);
      }
      loadDomainData();
    } catch (err) {
      toast.error(err.message || 'Falha ao registrar novo chamado.');
    } finally {
      setSubmittingTicket(false);
    }
  };

  useEffect(() => {
    return onGatewaySessionChange((session) => {
      setGatewaySessionState(session);
    });
  }, []);

  const loadDomainData = useCallback(async () => {
    try {
      const health = await microservicesApi.probeClusterHealth();
      setClusterHealth(health);
      setHealthError('');
    } catch (err) {
      setHealthError(
        err?.message
          ? `Serviço indisponível no momento (${err.message}). Tente reconectar em instantes.`
          : 'Serviço temporariamente indisponível. Verifique a conectividade ou tente novamente.',
      );
      return;
    }

    if (!getGatewaySession()?.token) return;

    setLoading(true);
    try {
      const [tkRes, tmRes, flRes, chRes] = await Promise.all([
        microservicesApi.listTickets(),
        microservicesApi.listTerms(),
        microservicesApi.getFleetTelemetry(),
        microservicesApi.verifyAuditChain(),
      ]);
      setTickets(tkRes.items || []);
      setTerms(tmRes.items || []);
      setFleet(flRes || { summary: {}, devices: [] });
      setChainReport(chRes);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshTimeoutRef = useRef(null);

  const debouncedLoadDomainData = useCallback(() => {
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }
    refreshTimeoutRef.current = setTimeout(() => {
      loadDomainData();
    }, 2000);
  }, [loadDomainData]);

  useEffect(() => {
    let active = true;
    microservicesApi
      .probeClusterHealth()
      .then((h) => {
        if (active) {
          setClusterHealth(h);
          setHealthError('');
        }
      })
      .catch((err) => {
        if (active) {
          setHealthError(
            err?.message
              ? `Não foi possível conectar aos serviços do Service Desk (${err.message}).`
              : 'Não foi possível conectar aos serviços do Service Desk no momento.',
          );
        }
      });

    if (gatewaySession?.token) {
      Promise.all([
        microservicesApi.listTickets(),
        microservicesApi.listTerms(),
        microservicesApi.getFleetTelemetry(),
        microservicesApi.verifyAuditChain(),
      ])
        .then(([tkRes, tmRes, flRes, chRes]) => {
          if (!active) return;
          setTickets(tkRes.items || []);
          setTerms(tmRes.items || []);
          setFleet(flRes || { summary: {}, devices: [] });
          setChainReport(chRes);
        })
        .catch((err) => {
          if (!active) return;
          console.error('Erro ao carregar dados iniciais do Service Desk:', err);
          toast.error(err?.message || 'Não foi possível carregar os dados do Service Desk.');
        });

      const handle = microservicesApi.openNexusDeskSocket(gatewaySession.token, {
        onStatus: (st) => {
          if (active) setWsStatus(st);
        },
        onFrame: (frame) => {
          if (!active) return;
          const evt = String(frame?.event || '');
          const data = frame?.data || {};
          const myEmail = String(
            gatewaySession?.user?.email || currentUser?.email || '',
          )
            .toLowerCase()
            .trim();

          if (evt === 'ticket.typing' && data.ticketId) {
            const senderEmail = String(data.senderEmail || '').toLowerCase().trim();
            if (senderEmail && senderEmail === myEmail) return;

            if (typingTimersRef.current[data.ticketId]) {
              clearTimeout(typingTimersRef.current[data.ticketId]);
            }
            if (data.isTyping === false) {
              setTypingByTicket((prev) => {
                const next = { ...prev };
                delete next[data.ticketId];
                return next;
              });
              return;
            }
            setTypingByTicket((prev) => ({
              ...prev,
              [data.ticketId]: {
                senderName: data.senderName || 'Colaborador',
                senderRole: data.senderRole || 'collaborator',
              },
            }));
            typingTimersRef.current[data.ticketId] = setTimeout(() => {
              setTypingByTicket((prev) => {
                const next = { ...prev };
                delete next[data.ticketId];
                return next;
              });
            }, 3600);
            return;
          }

          if (evt === 'ticket.commented' && data.ticketId) {
            const senderEmail = String(data.authorEmail || '').toLowerCase().trim();
            if (typingTimersRef.current[data.ticketId]) {
              clearTimeout(typingTimersRef.current[data.ticketId]);
            }
            setTypingByTicket((prev) => {
              if (!prev[data.ticketId]) return prev;
              const next = { ...prev };
              delete next[data.ticketId];
              return next;
            });

            const incomingComment = {
              id: data.commentId || `ws-${Date.now().toString(36)}`,
              ticket_id: data.ticketId,
              author_name: data.authorName || data.authorEmail || 'Participante',
              author_email: data.authorEmail || '',
              author_role: data.authorRole || 'collaborator',
              message: data.message || '',
              attachments: Array.isArray(data.attachments) ? data.attachments : [],
              created_at: data.createdAt || frame?.timestamp || new Date().toISOString(),
            };

            setTicketCommentsMap((prev) => {
              const existing = prev[data.ticketId] || [];
              const duplicate = existing.some(
                (cm) =>
                  (incomingComment.id && cm.id === incomingComment.id) ||
                  (cm.message === incomingComment.message &&
                    String(cm.author_email || '').toLowerCase() === senderEmail &&
                    Math.abs(
                      new Date(cm.created_at).getTime() -
                        new Date(incomingComment.created_at).getTime(),
                    ) < 4000),
              );
              if (duplicate) return prev;
              return { ...prev, [data.ticketId]: [...existing, incomingComment] };
            });

            setTickets((prev) =>
              prev.map((tk) =>
                tk.id === data.ticketId
                  ? {
                      ...tk,
                      comments_count: Number(tk.comments_count || 0) + 1,
                      attachments_count:
                        Number(tk.attachments_count || 0) + (incomingComment.attachments?.length || 0),
                      last_message_at: incomingComment.created_at,
                      last_message_preview:
                        incomingComment.message?.trim() ||
                        (incomingComment.attachments?.length ? '📷 Imagem anexada' : ''),
                    }
                  : tk,
              ),
            );

            if (activeTicketCommentIdRef.current !== data.ticketId && senderEmail !== myEmail) {
              setUnreadTicketsMap((prev) => ({
                ...prev,
                [data.ticketId]: (prev[data.ticketId] || 0) + 1,
              }));
              toast.info(
                `Nova mensagem em ${data.protocol || 'chamado'} (${incomingComment.author_name})`,
              );
            }
          }

          if (evt !== 'ticket.typing') {
            const feedItem = {
              ...frame,
              _feedKey:
                frame?.id || `${frame?.event || 'evt'}-${Date.now()}-${++wsFeedSeqRef.current}`,
            };
            setWsFeed((prev) => [feedItem, ...prev].slice(0, 15));
          }

          const isBusinessEvent =
            evt &&
            (evt.startsWith('ticket.') ||
              evt.startsWith('term.') ||
              evt.startsWith('audit.') ||
              evt === 'cluster.sync');
          if (isBusinessEvent && evt !== 'ticket.typing') {
            debouncedLoadDomainData();
          }
        },
      });
      wsRef.current = handle;
    }

    return () => {
      active = false;
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
      wsRef.current?.close();
      Object.values(typingTimersRef.current).forEach((timerId) => clearTimeout(timerId));
      typingTimersRef.current = {};
    };
  }, [debouncedLoadDomainData, gatewaySession?.token, gatewaySession?.user?.email, currentUser?.email]);

  const handleConnectGateway = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      const auth = await microservicesApi.authenticate(credentials.email, credentials.password);
      const mergedUser = {
        ...auth.user,
        companyName: currentUser?.companyName || auth.user?.tenantName || auth.user?.companyName,
        primaryColor: currentUser?.primaryColor || auth.user?.primaryColor || null,
        logoUrl: currentUser?.logoUrl || auth.user?.logoUrl || '',
      };
      setGatewaySessionState({ token: auth.accessToken, user: mergedUser });
      if (auth.user?.role === 'owner' && (currentUser?.primaryColor || currentUser?.companyName)) {
        microservicesApi
          .saveContract({
            companyName: currentUser?.companyName || null,
            primaryColor: currentUser?.primaryColor || null,
            logoUrl: currentUser?.logoUrl || null,
          })
          .catch(() => {});
      }
      toast.success(`Autenticado no API Gateway como ${auth.user.name}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnectGateway = () => {
    wsRef.current?.close();
    clearGatewaySession();
    setGatewaySessionState(null);
    setWsStatus('disconnected');
    setTickets([]);
    setTerms([]);
    setFleet({ summary: {}, devices: [] });
    setChainReport(null);
    setWsFeed([]);
    activeTicketCommentIdRef.current = null;
    setActiveTicketCommentId(null);
    setTicketCommentsMap({});
    setLoadingCommentsId(null);
    setRemoteModalDevice(null);
  };

  const handleResolveTicket = async (ticketId, nextStatus, customNotes = '') => {
    try {
      const notes =
        String(customNotes || '').trim() ||
        (nextStatus === 'resolved'
          ? 'Atendimento técnico concluído. Solicitação atendida conforme o SLA corporativo.'
          : 'Chamado assumido pela equipe de TI & Infraestrutura.');
      const updated = await microservicesApi.updateTicketStatus(ticketId, {
        status: nextStatus,
        resolutionNotes: notes,
      });
      if (updated?.id) {
        setTickets((prev) => prev.map((t) => (t.id === ticketId ? { ...t, ...updated } : t)));
        setTicketDetailMap((prev) =>
          prev[ticketId] ? { ...prev, [ticketId]: { ...prev[ticketId], ...updated } } : prev,
        );
      }
      toast.success(`Status do chamado atualizado para ${STATUS_NAMES[nextStatus]}.`);
      loadDomainData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDeleteTicket = async (ticketId, protocol) => {
    const ok = await confirm({
      title: `Excluir chamado ${protocol || ''}?`,
      message: 'Esta ação removerá o chamado da fila operacional e não poderá ser desfeita.',
      confirmLabel: 'Excluir chamado',
      cancelLabel: 'Cancelar',
      danger: true,
    });
    if (!ok) return;

    try {
      await microservicesApi.deleteTicket(ticketId);
      setTickets((prev) => prev.filter((t) => t.id !== ticketId));
      if (activeTicketCommentIdRef.current === ticketId) {
        activeTicketCommentIdRef.current = null;
        setActiveTicketCommentId(null);
      }
      toast.success(`Chamado ${protocol || ''} excluído com sucesso.`);
      loadDomainData();
    } catch (err) {
      toast.error(err.message || 'Falha ao excluir chamado.');
    }
  };

  const handleToggleTicketComments = async (ticketId) => {
    if (activeTicketCommentId === ticketId) {
      activeTicketCommentIdRef.current = null;
      setActiveTicketCommentId(null);
      setLoadingCommentsId(null);
      return;
    }
    const reqSeq = ++commentsReqSeqRef.current;
    activeTicketCommentIdRef.current = ticketId;
    setActiveTicketCommentId(ticketId);
    setLoadingCommentsId(ticketId);
    setUnreadTicketsMap((prev) => {
      if (!prev[ticketId]) return prev;
      const next = { ...prev };
      delete next[ticketId];
      return next;
    });
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      window.requestAnimationFrame(() => {
        chatPanelWrapperRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
      });
    }
    try {
      const detail = await microservicesApi.getTicketById(ticketId);
      if (reqSeq !== commentsReqSeqRef.current || activeTicketCommentIdRef.current !== ticketId) {
        return;
      }
      if (detail) {
        setTicketDetailMap((prev) => ({ ...prev, [ticketId]: detail }));
        if (detail.comments) {
          setTicketCommentsMap((prev) => ({ ...prev, [ticketId]: detail.comments }));
        }
      }
    } catch (err) {
      if (reqSeq === commentsReqSeqRef.current && activeTicketCommentIdRef.current === ticketId) {
        toast.error(err?.message || 'Não foi possível carregar o histórico de mensagens.');
      }
    } finally {
      if (reqSeq === commentsReqSeqRef.current) {
        setLoadingCommentsId((prev) => (prev === ticketId ? null : prev));
      }
    }
  };

  const handleSendTicketComment = async (ticketId, payload) => {
    const cleanMessage =
      typeof payload === 'string' ? payload.trim() : String(payload?.message || '').trim();
    const cleanAttachments = Array.isArray(payload?.attachments) ? payload.attachments : [];
    if (!cleanMessage && cleanAttachments.length === 0) return false;
    try {
      const added = await microservicesApi.addTicketComment(ticketId, {
        message: cleanMessage,
        attachments: cleanAttachments,
      });
      if (added) {
        setTicketCommentsMap((prev) => {
          const cur = prev[ticketId] || [];
          if (cur.some((cm) => cm.id === added.id)) return prev;
          return { ...prev, [ticketId]: [...cur, added] };
        });
        setTickets((prev) =>
          prev.map((tk) =>
            tk.id === ticketId
              ? {
                  ...tk,
                  comments_count: Number(tk.comments_count || 0) + 1,
                  attachments_count:
                    Number(tk.attachments_count || 0) + (added.attachments?.length || 0),
                  last_message_at: added.created_at,
                  last_message_preview:
                    added.message?.trim() || (added.attachments?.length ? '📷 Imagem anexada' : ''),
                }
              : tk,
          ),
        );
      }
      loadDomainData();
      return true;
    } catch (err) {
      toast.error(err.message);
      return false;
    }
  };

  const handleTypingForTicket = useCallback((ticket, isTyping) => {
    if (!ticket?.id) return;
    wsRef.current?.sendTicketTyping?.({
      ticketId: ticket.id,
      requesterEmail: ticket.requester_email || '',
      isTyping,
    });
  }, []);

  const findDeviceForTicket = useCallback(
    (tk) => {
      if (!tk?.asset_tag) return null;
      const needle = String(tk.asset_tag).toUpperCase().trim();
      const found = (fleet.devices || []).find(
        (d) => String(d.assetTag || d.internalId || '').toUpperCase().trim() === needle,
      );
      if (found) return found;
      return {
        assetTag: tk.asset_tag,
        hostname: tk.asset_tag,
        loggedUser: tk.requester_name || tk.requester_email || 'Colaborador',
      };
    },
    [fleet.devices],
  );

  const selectedActiveTicket = useMemo(() => {
    if (!activeTicketCommentId) return null;
    const fromList = tickets.find((t) => t.id === activeTicketCommentId);
    const detailed = ticketDetailMap[activeTicketCommentId];
    if (!fromList && !detailed) return null;
    return {
      ...(detailed || {}),
      ...(fromList || {}),
      attachments: detailed?.attachments || fromList?.attachments || [],
    };
  }, [activeTicketCommentId, tickets, ticketDetailMap]);

  const handleCreateNewTerm = async (e) => {
    e.preventDefault();
    if (
      !newTermForm.employeeName.trim() ||
      !newTermForm.employeeEmail.trim() ||
      !newTermForm.internalId.trim() ||
      !newTermForm.model.trim()
    ) {
      toast.error('Preencha os dados do colaborador e do equipamento sob custódia.');
      return;
    }
    setSubmittingTerm(true);
    try {
      await microservicesApi.issueTerm({
        termType: newTermForm.termType || 'entrega',
        employeeName: newTermForm.employeeName.trim(),
        employeeEmail: newTermForm.employeeEmail.trim().toLowerCase(),
        department: newTermForm.department.trim() || 'TI & Operações',
        assetsSnapshot: [
          {
            internalId: newTermForm.internalId.trim().toUpperCase(),
            model: newTermForm.model.trim(),
            serialNumber: newTermForm.serialNumber.trim() || null,
          },
        ],
      });
      toast.success('Termo de Custódia CLT emitido com hash SHA-256 canônico.');
      setIsNewTermModalOpen(false);
      setNewTermForm({
        termType: 'entrega',
        employeeName: '',
        employeeEmail: '',
        department: 'TI & Operações',
        internalId: '',
        model: '',
        serialNumber: '',
      });
      loadDomainData();
    } catch (err) {
      toast.error(err.message || 'Falha ao emitir termo CLT.');
    } finally {
      setSubmittingTerm(false);
    }
  };

  const handleSignTerm = async (termId) => {
    try {
      await microservicesApi.signTerm(termId, true);
      toast.success('Termo assinado digitalmente com selo criptográfico HMAC-SHA256!');
      loadDomainData();
    } catch (err) {
      toast.error(err.message || 'Falha ao assinar termo.');
    }
  };

  const handleVerifySingleTerm = async (termId) => {
    try {
      const res = await microservicesApi.verifyTerm(termId);
      const isIntact = Boolean(
        res.valid ?? (res.documentIntact && (res.status !== 'signed' || res.signatureValid)),
      );
      if (isIntact && res.status === 'signed') {
        toast.success('Termo validado: Selo digital HMAC-SHA256 íntegro e assinado juridicamente.');
      } else if (isIntact) {
        toast.success('Documento íntegro (SHA-256 canônico verificado). Aguardando assinatura.');
      } else {
        toast.error('Atenção: Hash divergente do registro original.');
      }
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDeleteTerm = async (termId, employeeName) => {
    const ok = await confirm({
      title: 'Remover termo de custódia CLT?',
      message: `Confirma a remoção permanente do termo emitido para ${employeeName || 'este colaborador'}?`,
      confirmLabel: 'Remover termo',
      cancelLabel: 'Cancelar',
      danger: true,
    });
    if (!ok) return;

    try {
      await microservicesApi.deleteTerm(termId);
      setTerms((prev) => prev.filter((t) => t.id !== termId));
      toast.success(`Termo de ${employeeName || 'custódia'} removido com sucesso.`);
      loadDomainData();
    } catch (err) {
      toast.error(err.message || 'Falha ao remover termo.');
    }
  };

  const handleArchiveTicketToVps = async (ticketId, protocol) => {
    if (!canArchiveToVps || archivingTicketRef.current.has(ticketId)) return;
    archivingTicketRef.current.add(ticketId);
    setArchivingTicketIds((prev) => ({ ...prev, [ticketId]: true }));
    try {
      const res = await microservicesApi.archiveTicketToVps(ticketId);
      const destPath = res?.folderPath || `/Chamados/${protocol || ticketId}/`;
      toast.success(`Chamado arquivado na VPS em ${destPath}`);
    } catch (err) {
      toast.error(err?.message || 'Falha ao arquivar chamado na VPS.');
    } finally {
      archivingTicketRef.current.delete(ticketId);
      setArchivingTicketIds((prev) => {
        const next = { ...prev };
        delete next[ticketId];
        return next;
      });
    }
  };

  const handleArchiveCltTermToVps = async (termId, employeeName) => {
    if (!canArchiveToVps || archivingTermRef.current.has(termId)) return;
    archivingTermRef.current.add(termId);
    setArchivingTermIds((prev) => ({ ...prev, [termId]: true }));
    try {
      const res = await microservicesApi.archiveTermToVps(termId);
      const destPath = res?.virtualPath || res?.folderPath || `/Cofre-TI-Infra/Termos/termo-${termId}.txt`;
      toast.success(`Termo de ${employeeName || 'custódia'} arquivado na VPS em ${destPath}`);
    } catch (err) {
      toast.error(err?.message || 'Falha ao arquivar termo na VPS.');
    } finally {
      archivingTermRef.current.delete(termId);
      setArchivingTermIds((prev) => {
        const next = { ...prev };
        delete next[termId];
        return next;
      });
    }
  };

  const handleDispatchRemoteCommand = async (deviceKey, commandType) => {
    try {
      await microservicesApi.dispatchRemoteCommand(deviceKey, commandType, 'Console de Gestão ITAM');
      toast.success(`Comando "${commandType}" despachado com sucesso para a estação.`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleQuickNextTag = async () => {
    try {
      const res = await microservicesApi.suggestNextTag('Notebook');
      toast.success(`Próxima Etiqueta Sequencial: ${res.suggestedTag} (Sequência ${res.nextSequence})`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleVerifyAuditChainNow = async () => {
    try {
      wsRef.current?.ping?.();
      const chRes = await microservicesApi.verifyAuditChain();
      setChainReport(chRes);
      if (chRes?.intact) {
        toast.success(
          `Hash-Chain SHA-256 verificada: 100% íntegra (${chRes.checkedRecords || 0} blocos auditados).`,
        );
      } else {
        toast.error(`Alerta na Hash-Chain: ${chRes?.reason || 'divergência detectada'}.`);
      }
    } catch (err) {
      toast.error(err.message);
    }
  };

  // KPIs calculados dinamicamente (sem dados fictícios)
  const activeTickets = useMemo(() => {
    return tickets.filter((t) => t.status === 'open' || t.status === 'in_progress');
  }, [tickets]);

  const signedTerms = useMemo(() => {
    return terms.filter((t) => t.status === 'signed');
  }, [terms]);

  const ticketCounts = useMemo(() => {
    const total = tickets.length;
    const open = tickets.filter((t) => t.status === 'open').length;
    const inProgress = tickets.filter((t) => t.status === 'in_progress').length;
    const resolved = tickets.filter((t) => t.status === 'resolved' || t.status === 'closed').length;
    return { total, open, inProgress, resolved };
  }, [tickets]);

  const slaMetrics = useMemo(() => {
    if (tickets.length === 0) {
      return {
        rate: '100%',
        badge: 'Em dia',
        subtitle: 'Meta contratual ≥ 98% • Sem chamados em atraso',
      };
    }
    const now = Date.now();
    const withinSla = tickets.filter((t) => {
      if (!t.sla_due_at) return true;
      const due = new Date(t.sla_due_at).getTime();
      const end = t.resolved_at ? new Date(t.resolved_at).getTime() : now;
      return isNaN(due) || end <= due;
    }).length;
    const pct = ((withinSla / tickets.length) * 100).toFixed(1).replace(/\.0$/, '');
    return {
      rate: `${pct}%`,
      badge: `${withinSla}/${tickets.length} no prazo`,
      subtitle: `Meta contratual ≥ 98% • ${ticketCounts.resolved} concluídos`,
    };
  }, [tickets, ticketCounts.resolved]);

  const filteredTickets = useMemo(() => {
    return tickets.filter((t) => {
      let matchesFilter = true;
      if (ticketFilter === 'open') matchesFilter = t.status === 'open';
      else if (ticketFilter === 'in_progress') matchesFilter = t.status === 'in_progress';
      else if (ticketFilter === 'resolved') matchesFilter = t.status === 'resolved' || t.status === 'closed';
      else if (ticketFilter === 'mine') {
        const userName = gatewaySession?.user?.name?.toLowerCase()?.trim() || '';
        if (!userName) {
          matchesFilter = false;
        } else {
          matchesFilter =
            Boolean(t.technician_name && t.technician_name.toLowerCase().includes(userName)) ||
            Boolean(t.assigned_tech_name && t.assigned_tech_name.toLowerCase().includes(userName)) ||
            Boolean(t.assigned_to && t.assigned_to.toLowerCase().includes(userName)) ||
            Boolean(t.requester_name && t.requester_name.toLowerCase().includes(userName));
        }
      } else if (ticketFilter === 'critical') {
        matchesFilter = t.priority === 'critical' || t.priority === 'high' || t.status === 'open';
      }

      const matchesSearch =
        !ticketSearch ||
        t.title?.toLowerCase().includes(ticketSearch.toLowerCase()) ||
        t.protocol?.toLowerCase().includes(ticketSearch.toLowerCase()) ||
        t.requester_name?.toLowerCase().includes(ticketSearch.toLowerCase()) ||
        t.asset_tag?.toLowerCase().includes(ticketSearch.toLowerCase()) ||
        t.category?.toLowerCase().includes(ticketSearch.toLowerCase());
      return matchesFilter && matchesSearch;
    });
  }, [tickets, ticketFilter, ticketSearch, gatewaySession?.user?.name]);

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between border-b border-slate-200/80 dark:border-zinc-800 pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand-aa">
            <span className="flex h-2 w-2 rounded-full bg-emerald-500" />
            <span>Operações de TI &amp; Atendimento</span>
          </div>
          <h1 className="mt-1 text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-zinc-50">
            Service Desk &amp; Orquestração de Microsserviços
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-slate-600 dark:text-zinc-400 max-w-3xl">
            Central de chamados N1/N2, custódia patrimonial CLT com assinatura HMAC e telemetria da frota.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
          <button
            type="button"
            onClick={() => setShowDevDrawer((p) => !p)}
            aria-expanded={showDevDrawer}
            className="min-h-[44px] inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-zinc-200 hover:border-brand dark:hover:border-brand active:bg-slate-50 dark:active:bg-zinc-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            title="Exibir diagnósticos e ferramentas de verificação"
          >
            <Server size={14} className="text-brand-aa" />
            <span>Topologia &amp; APIs</span>
            {showDevDrawer ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          <a
            href={portalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="min-h-[44px] inline-flex items-center gap-1.5 rounded-lg bg-brand hover:bg-brand-dark px-3.5 py-2 text-xs font-bold text-brand-fg shadow-sm active:opacity-90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <Laptop size={14} />
            <span>Portal do Colaborador</span>
            <ExternalLink size={12} />
          </a>

          <button
            type="button"
            onClick={loadDomainData}
            className="min-h-[44px] inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-900 active:bg-slate-100 dark:active:bg-zinc-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin text-brand-aa' : ''} />
            <span>Atualizar</span>
          </button>
        </div>
      </div>

      {/* Offline Alert */}
      {healthError && (
        <div
          role="alert"
          className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs font-medium text-amber-900 dark:text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-start gap-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="font-bold">Aviso de Conectividade do Cluster</p>
              <p className="mt-0.5">{healthError}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={loadDomainData}
            className="min-h-[44px] shrink-0 inline-flex items-center justify-center gap-1.5 rounded-lg border border-amber-500/40 bg-white/80 dark:bg-[#111113] px-3.5 py-2 text-xs font-bold text-amber-900 dark:text-amber-200 hover:bg-amber-50 dark:hover:bg-zinc-900 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <RefreshCw size={13} />
            <span>Tentar novamente</span>
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {/* SLA Compliance KPI */}
        <div className="surface-card p-4 flex flex-col justify-between relative overflow-hidden border-l-4 border-l-emerald-500">
          <div className="flex items-center justify-between text-xs font-medium text-slate-600 dark:text-zinc-400">
            <span>SLA Operacional (MTTR)</span>
            <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Clock size={15} />
            </span>
          </div>
          <div className="mt-2">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black tabular-nums text-slate-900 dark:text-zinc-50">
                {slaMetrics.rate}
              </span>
              <span className="text-xs font-bold tabular-nums text-emerald-600 dark:text-emerald-400 flex items-center">
                <TrendingUp size={12} className="mr-0.5" /> {slaMetrics.badge}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-600 dark:text-zinc-400">
              {slaMetrics.subtitle}
            </p>
          </div>
        </div>

        {/* Active Ticket Desk KPI */}
        <div className="surface-card p-4 flex flex-col justify-between relative overflow-hidden border-l-4 border-l-brand">
          <div className="flex items-center justify-between text-xs font-medium text-slate-600 dark:text-zinc-400">
            <span>Fila de Atendimento</span>
            <span className="p-1.5 rounded-lg bg-brand/10 text-brand-aa">
              <Ticket size={15} />
            </span>
          </div>
          <div className="mt-2">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black tabular-nums text-slate-900 dark:text-zinc-50">
                {activeTickets.length}
              </span>
              <span className="text-xs font-medium text-slate-600 dark:text-zinc-400">
                chamados em aberto
              </span>
            </div>
            <p className="mt-1 text-xs tabular-nums text-slate-600 dark:text-zinc-400">
              {tickets.filter((t) => t.status === 'open').length} novos •{' '}
              {tickets.filter((t) => t.status === 'in_progress').length} em andamento
            </p>
          </div>
        </div>

        {/* CLT Legal Compliance KPI */}
        <div className="surface-card p-4 flex flex-col justify-between relative overflow-hidden border-l-4 border-l-sky-500">
          <div className="flex items-center justify-between text-xs font-medium text-slate-600 dark:text-zinc-400">
            <span>Conformidade Jurídica CLT</span>
            <span className="p-1.5 rounded-lg bg-sky-500/10 text-sky-700 dark:text-sky-300">
              <ShieldCheck size={15} />
            </span>
          </div>
          <div className="mt-2">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black tabular-nums text-slate-900 dark:text-zinc-50">
                {signedTerms.length} / {terms.length}
              </span>
              <span className="text-xs font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
                {terms.length > 0
                  ? `${Math.round((signedTerms.length / terms.length) * 100)}% Selados`
                  : 'Sem pendências'}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-600 dark:text-zinc-400">
              Art. 462 CLT com assinatura HMAC-SHA256
            </p>
          </div>
        </div>

        {/* Fleet Telemetry (RMM) KPI */}
        <div className="surface-card p-4 flex flex-col justify-between relative overflow-hidden border-l-4 border-l-cyan-500">
          <div className="flex items-center justify-between text-xs font-medium text-slate-600 dark:text-zinc-400">
            <span>Estações Conectadas (RMM)</span>
            <span className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
              <Laptop size={15} />
            </span>
          </div>
          <div className="mt-2">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black tabular-nums text-slate-900 dark:text-zinc-50">
                {fleet.devices?.length || 0}
              </span>
              <span className="text-xs font-medium tabular-nums text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                {(fleet.devices || []).filter((d) => d.online !== false).length} Ativas
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-600 dark:text-zinc-400">
              Telemetria contínua via WebSocket
            </p>
          </div>
        </div>
      </div>

      {/* Cluster Infrastructure Status Ribbon (flattened, single surface level) */}
      {clusterHealth && (
        <section
          aria-label="Infraestrutura da Malha e Microsserviços"
          className="surface-card p-3 sm:p-4 space-y-2.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-zinc-200">
              <Network size={14} className="text-brand-aa" />
              <span>Infraestrutura da Malha &amp; Microsserviços</span>
            </div>
            <span className="text-xs font-medium text-slate-600 dark:text-zinc-400">
              Monitoramento operacional ativo
            </span>
          </div>

          <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
            <div className="rounded-lg p-2.5 bg-slate-50 dark:bg-zinc-900/70 border border-slate-200/80 dark:border-zinc-800">
              <div className="flex items-center justify-between text-xs font-mono text-slate-600 dark:text-zinc-400">
                <span>BANCO DE DADOS</span>
                <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
              </div>
              <p className="mt-1 text-xs font-bold text-slate-900 dark:text-zinc-50">
                {clusterHealth.database?.engine}
              </p>
              <p className="text-xs font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                Latência: {clusterHealth.database?.latencyMs}ms
              </p>
            </div>

            {(clusterHealth.microservices || []).map((svc) => (
              <div
                key={svc.service}
                className="rounded-lg p-2.5 bg-slate-50 dark:bg-zinc-900/70 border border-slate-200/80 dark:border-zinc-800"
              >
                <div className="flex items-center justify-between gap-1 text-xs font-mono text-slate-600 dark:text-zinc-400">
                  <span className="truncate">{svc.service}</span>
                  <span
                    className={`h-2 w-2 rounded-full shrink-0 ${
                      svc.status === 'healthy' ? 'bg-emerald-500' : 'bg-red-500'
                    }`}
                  />
                </div>
                <p className="mt-1 text-xs font-bold text-slate-900 dark:text-zinc-50 capitalize">
                  {svc.status}
                </p>
                <p className="text-xs font-mono tabular-nums text-slate-600 dark:text-zinc-400">
                  RTT: {svc.latencyMs}ms
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Collapsible Architecture & Cluster Diagnostics Drawer */}
      {showDevDrawer && (
        <div className="surface-card p-5 space-y-4 border-brand/30 animate-fade-in">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 dark:border-zinc-800 pb-3">
            <div className="flex items-center gap-2">
              <Terminal size={16} className="text-brand-aa" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-zinc-50">
                Ferramentas Operacionais &amp; Verificação Rápida
              </h3>
            </div>
            <span className="text-xs font-medium text-slate-600 dark:text-zinc-400">
              {clusterHealth ? 'Cluster saudável' : 'Aguardando status do cluster'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={handleQuickNextTag}
              className="min-h-[44px] inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-zinc-200 hover:border-brand active:bg-slate-50 dark:active:bg-zinc-800 shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <Tag size={13} className="text-brand-aa" />
              <span>Consultar Próxima Tag (API 1)</span>
            </button>
            <button
              type="button"
              onClick={handleVerifyAuditChainNow}
              className="min-h-[44px] inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-zinc-200 hover:border-brand active:bg-slate-50 dark:active:bg-zinc-800 shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <ShieldCheck size={13} className="text-emerald-500" />
              <span>Auditar Hash-Chain SHA-256 (API 3)</span>
            </button>
            <button
              type="button"
              onClick={() => setIsNewTermModalOpen(true)}
              className="min-h-[44px] inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-zinc-200 hover:border-brand active:bg-slate-50 dark:active:bg-zinc-800 shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <FileSignature size={13} className="text-sky-600 dark:text-sky-400" />
              <span>Emitir Termo de Custódia CLT</span>
            </button>
          </div>
        </div>
      )}

      {/* Gateway Authentication Card (When not signed in) */}
      {!gatewaySession?.token ? (
        <div className="surface-card p-6 sm:p-8 max-w-xl mx-auto shadow-xl space-y-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-brand/10 text-brand-aa">
              <Lock size={22} />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-zinc-50">
                Autenticação no Gateway de Operações
              </h2>
              <p className="text-xs text-slate-600 dark:text-zinc-400">
                Entre com suas credenciais de operador para acessar chamados e telemetria.
              </p>
            </div>
          </div>

          <form onSubmit={handleConnectGateway} className="space-y-4">
            <div>
              <label
                htmlFor="gw-operator-email"
                className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5"
              >
                E-mail de Operador / Gestor de TI
              </label>
              <input
                id="gw-operator-email"
                name="email"
                type="email"
                autoComplete="email"
                value={credentials.email}
                onChange={(e) => setCredentials((p) => ({ ...p, email: e.target.value }))}
                className="w-full min-h-[44px] rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3.5 py-2 text-xs sm:text-sm text-slate-900 dark:text-zinc-50 placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                placeholder="operador@empresa.com.br"
                required
              />
            </div>
            <div>
              <label
                htmlFor="gw-operator-password"
                className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1.5"
              >
                Senha de Acesso
              </label>
              <input
                id="gw-operator-password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={credentials.password}
                onChange={(e) => setCredentials((p) => ({ ...p, password: e.target.value }))}
                className="w-full min-h-[44px] rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3.5 py-2 text-xs sm:text-sm text-slate-900 dark:text-zinc-50 placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                placeholder="Digite sua senha de acesso"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-[44px] rounded-lg bg-brand hover:bg-brand-dark py-2.5 text-xs font-bold text-brand-fg uppercase tracking-wider active:opacity-90 transition-colors shadow-sm disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              {loading ? 'Validando Credenciais…' : 'Conectar ao Cluster de Microsserviços'}
            </button>
          </form>
        </div>
      ) : (
        <>
          {/* Active Status Bar */}
          <div className="surface-card p-3 sm:p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 font-mono font-bold text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                API 5 WebSocket: {wsStatus.toUpperCase()}
              </span>

              {chainReport && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/15 px-3 py-1 font-mono font-semibold tabular-nums text-sky-700 dark:text-sky-300 border border-sky-500/30">
                  <ShieldCheck size={13} />
                  Hash-Chain SHA-256: {chainReport.intact ? `ÍNTEGRA (${chainReport.checkedRecords} blocos)` : 'ALERTA'}
                </span>
              )}
            </div>

            <div className="flex items-center gap-3">
              <div className="text-right hidden sm:block">
                <p className="text-xs font-bold text-slate-800 dark:text-zinc-100">
                  {gatewaySession.user?.name || 'Gestor de TI'}
                </p>
                <p className="text-xs text-slate-500 dark:text-zinc-400 font-mono">
                  {gatewaySession.user?.role?.toUpperCase()}
                  {gatewaySession.user?.tenantId ? ` • ${gatewaySession.user.tenantId}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={handleDisconnectGateway}
                className="min-h-[44px] text-xs font-semibold px-3.5 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 text-slate-700 dark:text-zinc-300 hover:text-red-600 dark:hover:text-red-400 hover:border-red-400 active:bg-slate-50 dark:active:bg-zinc-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                Desconectar
              </button>
            </div>
          </div>

          {/* Quick Ticket KPIs - 2x2 Grid on Mobile, 4 Cols on Desktop */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3.5">
            <button
              type="button"
              onClick={() => setTicketFilter('all')}
              aria-pressed={ticketFilter === 'all'}
              className={`surface-card min-h-[44px] p-3 sm:p-4 flex flex-col justify-between text-left border-l-4 border-l-brand hover:border-slate-300 dark:hover:border-zinc-700 active:bg-slate-50 dark:active:bg-zinc-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                ticketFilter === 'all' ? 'ring-1 ring-brand/40 bg-brand/5 dark:bg-brand/10' : ''
              }`}
            >
              <div className="w-full flex items-center justify-between text-xs font-medium text-slate-600 dark:text-zinc-400">
                <span className="truncate font-semibold">Total Chamados</span>
                <span className="p-1.5 rounded-lg bg-brand/10 text-brand-aa shrink-0">
                  <Ticket size={14} />
                </span>
              </div>
              <div className="mt-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-xl sm:text-2xl font-black tabular-nums text-slate-900 dark:text-zinc-50">
                    {ticketCounts.total}
                  </span>
                  <span className="text-xs font-mono font-medium text-slate-500 dark:text-zinc-400 hidden sm:inline">
                    registrados
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-600 dark:text-zinc-400 truncate">
                  Central de Atendimento N1/N2
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setTicketFilter('open')}
              aria-pressed={ticketFilter === 'open'}
              className={`surface-card min-h-[44px] p-3 sm:p-4 flex flex-col justify-between text-left border-l-4 border-l-amber-500 hover:border-slate-300 dark:hover:border-zinc-700 active:bg-slate-50 dark:active:bg-zinc-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                ticketFilter === 'open' ? 'ring-1 ring-amber-500/40 bg-amber-500/5 dark:bg-amber-500/10' : ''
              }`}
            >
              <div className="w-full flex items-center justify-between text-xs font-medium text-slate-600 dark:text-zinc-400">
                <span className="truncate font-semibold">Abertos</span>
                <span className="p-1.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 shrink-0">
                  <Inbox size={14} />
                </span>
              </div>
              <div className="mt-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-xl sm:text-2xl font-black tabular-nums text-slate-900 dark:text-zinc-50">
                    {ticketCounts.open}
                  </span>
                  {ticketCounts.open > 0 && (
                    <span className="text-xs font-bold text-amber-600 dark:text-amber-400">
                      Pendente
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-slate-600 dark:text-zinc-400 truncate">
                  Fila inicial sem atribuição
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setTicketFilter('in_progress')}
              aria-pressed={ticketFilter === 'in_progress'}
              className={`surface-card min-h-[44px] p-3 sm:p-4 flex flex-col justify-between text-left border-l-4 border-l-sky-500 hover:border-slate-300 dark:hover:border-zinc-700 active:bg-slate-50 dark:active:bg-zinc-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                ticketFilter === 'in_progress' ? 'ring-1 ring-sky-500/40 bg-sky-500/5 dark:bg-sky-500/10' : ''
              }`}
            >
              <div className="w-full flex items-center justify-between text-xs font-medium text-slate-600 dark:text-zinc-400">
                <span className="truncate font-semibold">Em Atendimento</span>
                <span className="p-1.5 rounded-lg bg-sky-500/10 text-sky-700 dark:text-sky-300 shrink-0">
                  <Activity size={14} />
                </span>
              </div>
              <div className="mt-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-xl sm:text-2xl font-black tabular-nums text-slate-900 dark:text-zinc-50">
                    {ticketCounts.inProgress}
                  </span>
                  <span className="text-xs font-bold text-sky-700 dark:text-sky-300">
                    Em curso
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-600 dark:text-zinc-400 truncate">
                  Técnico em diagnóstico
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setTicketFilter('resolved')}
              aria-pressed={ticketFilter === 'resolved'}
              className={`surface-card min-h-[44px] p-3 sm:p-4 flex flex-col justify-between text-left border-l-4 border-l-emerald-500 hover:border-slate-300 dark:hover:border-zinc-700 active:bg-slate-50 dark:active:bg-zinc-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                ticketFilter === 'resolved' ? 'ring-1 ring-emerald-500/40 bg-emerald-500/5 dark:bg-emerald-500/10' : ''
              }`}
            >
              <div className="w-full flex items-center justify-between text-xs font-medium text-slate-600 dark:text-zinc-400">
                <span className="truncate font-semibold">Concluídos</span>
                <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shrink-0">
                  <CheckCircle2 size={14} />
                </span>
              </div>
              <div className="mt-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-xl sm:text-2xl font-black tabular-nums text-slate-900 dark:text-zinc-50">
                    {ticketCounts.resolved}
                  </span>
                  <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    Resolvidos
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-600 dark:text-zinc-400 truncate">
                  Histórico fechado
                </p>
              </div>
            </button>
          </div>

          {/* Main 2-Column Command Workspace */}
          <div className="grid gap-6 lg:grid-cols-12">
            {/* Left Column: Tickets Queue */}
            <div className="lg:col-span-7 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Ticket size={17} className="text-brand-aa shrink-0" aria-hidden="true" />
                  <h2 className="text-sm font-bold uppercase tracking-wider tabular-nums text-slate-800 dark:text-zinc-100 truncate">
                    Fila Operacional de Chamados ({filteredTickets.length})
                  </h2>
                </div>

                <button
                  type="button"
                  onClick={() => setIsNewTicketModalOpen(true)}
                  className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand hover:bg-brand-dark px-4 py-2 text-xs font-bold text-brand-fg shadow-sm active:opacity-90 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  <span aria-hidden="true">+</span>
                  <span>Novo Chamado</span>
                </button>
              </div>

              {/* Horizontal Scrolling Filter Tabs */}
              <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide py-1">
                {[
                  { id: 'all', label: 'Todos', count: ticketCounts.total },
                  { id: 'open', label: 'Abertos', count: ticketCounts.open },
                  { id: 'in_progress', label: 'Em Atendimento', count: ticketCounts.inProgress },
                  { id: 'resolved', label: 'Concluídos', count: ticketCounts.resolved },
                  { id: 'mine', label: 'Meus Chamados', icon: User },
                  { id: 'critical', label: 'SLA Crítico', icon: AlertCircle },
                ].map((tab) => {
                  const isTabActive = ticketFilter === tab.id;
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setTicketFilter(tab.id)}
                      aria-pressed={isTabActive}
                      className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-colors active:scale-[0.98] flex items-center gap-1.5 border shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                        isTabActive
                          ? 'bg-slate-900 text-white border-slate-900 shadow-sm dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100'
                          : 'bg-white dark:bg-[#111113] text-slate-700 dark:text-zinc-300 border-slate-200/80 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-900'
                      }`}
                    >
                      {Icon && (
                        <Icon
                          size={13}
                          aria-hidden="true"
                          className={isTabActive ? 'text-white dark:text-zinc-900' : 'text-slate-400 dark:text-zinc-500'}
                        />
                      )}
                      <span>{tab.label}</span>
                      {tab.count !== undefined && (
                        <span
                          className={`px-1.5 py-0.5 rounded-md text-xs font-mono tabular-nums ${
                            isTabActive
                              ? 'bg-white/20 text-white dark:bg-zinc-900/15 dark:text-zinc-900'
                              : 'bg-slate-100 text-slate-700 dark:bg-zinc-800 dark:text-zinc-200'
                          }`}
                        >
                          {tab.count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Search input with Clear button */}
              <div className="relative">
                <label htmlFor="service-desk-ticket-search" className="sr-only">
                  Pesquisar chamados por protocolo, solicitante, tag ou assunto
                </label>
                <Search size={14} className="absolute left-3.5 top-3.5 text-slate-400 pointer-events-none" />
                <input
                  id="service-desk-ticket-search"
                  name="ticketSearch"
                  type="text"
                  value={ticketSearch}
                  onChange={(e) => setTicketSearch(e.target.value)}
                  placeholder="Pesquisar por protocolo, solicitante, tag ou assunto…"
                  className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] pl-9 pr-11 py-2.5 text-xs sm:text-sm text-slate-900 dark:text-zinc-50 placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                />
                {ticketSearch && (
                  <button
                    type="button"
                    onClick={() => setTicketSearch('')}
                    className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center absolute right-0 top-0 text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200 rounded-xl transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    aria-label="Limpar pesquisa"
                  >
                    <X size={15} />
                  </button>
                )}
              </div>

              {/* Ticket Cards */}
              <div className="space-y-3">
                {filteredTickets.length === 0 ? (
                  <div className="surface-card p-10 text-center space-y-2">
                    <Inbox size={32} className="mx-auto text-slate-300 dark:text-zinc-600" />
                    <p className="text-xs font-medium text-slate-600 dark:text-zinc-400">
                      Nenhum chamado encontrado com os filtros selecionados.
                    </p>
                  </div>
                ) : (
                  filteredTickets.map((tk) => {
                    const priorityMeta = PRIORITY_META[tk.priority] || PRIORITY_META.medium;

                    return (
                      <div
                        key={tk.id}
                        className={`surface-card p-4 space-y-3 transition-all ${
                          activeTicketCommentId === tk.id
                            ? 'ring-2 ring-brand/50 border-brand/40'
                            : 'hover:border-slate-300 dark:hover:border-zinc-700'
                        }`}
                      >
                        {/* Linha 1: Protocolo, Tag, Categoria, Prioridade com Dot, Status */}
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-md bg-slate-900 text-white dark:bg-zinc-800 border border-slate-700 dark:border-zinc-700">
                              {tk.protocol}
                            </span>
                            {unreadTicketsMap[tk.id] > 0 && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-brand text-brand-fg text-[10px] font-bold">
                                +{unreadTicketsMap[tk.id]} nova
                              </span>
                            )}
                            {tk.asset_tag && (
                              <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded-md bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800 flex items-center gap-1">
                                <Laptop size={12} />
                                {tk.asset_tag}
                              </span>
                            )}
                            {tk.category && (
                              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300">
                                {CATEGORY_NAMES[tk.category] || tk.category}
                              </span>
                            )}
                            {Number(tk.attachments_count) > 0 && (
                              <span
                                title={`${tk.attachments_count} foto(s)/print(s) anexado(s)`}
                                className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300"
                              >
                                <ImageIcon size={11} />
                                {tk.attachments_count}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5">
                            {/* Prioridade com Dot colorido */}
                            <span
                              className={`inline-flex items-center gap-1.5 text-xs font-bold px-2 py-0.5 rounded-full border ${priorityMeta.border} ${priorityMeta.text}`}
                            >
                              <span className={`h-1.5 w-1.5 rounded-full ${priorityMeta.color}`} />
                              <span>{priorityMeta.label}</span>
                            </span>

                            <span
                              className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${
                                STATUS_BADGES[tk.status] || STATUS_BADGES.open
                              }`}
                            >
                              {STATUS_NAMES[tk.status] || tk.status}
                            </span>
                          </div>
                        </div>

                        {/* Linha 2: Título, Descrição e Última Mensagem do Chat */}
                        <div>
                          <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-50 leading-snug">
                            {tk.title}
                          </h3>
                          <p className="mt-1 text-xs text-slate-600 dark:text-zinc-400 leading-relaxed line-clamp-2">
                            {tk.last_message_preview ? (
                              <>
                                <span className="font-semibold text-slate-700 dark:text-zinc-300">
                                  Última msg:{' '}
                                </span>
                                {tk.last_message_preview}
                              </>
                            ) : (
                              tk.description
                            )}
                          </p>
                        </div>

                        {/* Parecer Técnico quando houver */}
                        {tk.resolution_notes && (
                          <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 p-2.5 text-xs text-emerald-900 dark:text-emerald-300">
                            <span className="font-bold">Parecer Técnico:</span> {tk.resolution_notes}
                          </div>
                        )}

                        {/* Linha 3: Solicitante e Data de abertura relativa */}
                        <div className="flex items-center justify-between gap-2 text-xs text-slate-600 dark:text-zinc-400 pt-1">
                          <div className="flex items-center gap-1.5 truncate max-w-[70%]">
                            <div className="w-6 h-6 rounded-full bg-slate-100 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 flex items-center justify-center text-xs font-bold text-slate-700 dark:text-zinc-200 uppercase shrink-0">
                              {(tk.requester_name || 'C').charAt(0)}
                            </div>
                            <span className="font-semibold text-slate-800 dark:text-zinc-200 truncate">
                              {tk.requester_name}
                            </span>
                            {tk.department && (
                              <span className="text-xs text-slate-500 dark:text-zinc-400 hidden sm:inline">
                                ({tk.department})
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1 text-xs tabular-nums text-slate-500 dark:text-zinc-400 shrink-0">
                            <Clock size={12} />
                            <span>{formatRelativeTime(tk.created_at || tk.createdAt)}</span>
                          </div>
                        </div>

                        {/* Linha 4: Ações Operacionais */}
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-zinc-800/80">
                          <div className="flex flex-wrap items-center gap-2">
                            {tk.status !== 'resolved' && tk.status !== 'closed' && (
                              <>
                                {tk.status === 'open' && (
                                  <button
                                    type="button"
                                    onClick={() => handleResolveTicket(tk.id, 'in_progress')}
                                    className="min-h-[44px] rounded-xl border border-sky-500/40 bg-sky-50 dark:bg-sky-950/30 px-3.5 py-2 text-xs font-bold text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/40 active:opacity-90 transition-colors flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                                  >
                                    <Zap size={13} />
                                    <span>Assumir Chamado</span>
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleResolveTicket(tk.id, 'resolved')}
                                  className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-3.5 py-2 text-xs font-bold text-white shadow-sm active:opacity-90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                                >
                                  <CheckCircle2 size={13} />
                                  <span>Concluir Atendimento</span>
                                </button>
                              </>
                            )}
                            {tk.asset_tag && (
                              <button
                                type="button"
                                onClick={() => {
                                  const dev = fleet.devices?.find(
                                    (d) =>
                                      d.internalId === tk.asset_tag ||
                                      d.hostname === tk.asset_tag ||
                                      d.device_key === tk.asset_tag,
                                  ) || {
                                    hostname: tk.asset_tag,
                                    internalId: tk.asset_tag,
                                    deviceKey: tk.asset_tag,
                                    loggedUser: tk.requester_name || tk.requester_email || 'Colaborador',
                                  };
                                  setRemoteModalDevice(dev);
                                }}
                                className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border border-brand/35 bg-brand/10 px-3 py-2 text-xs font-bold text-brand-aa hover:bg-brand/15 active:opacity-90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                                title={`Acessar estação ${tk.asset_tag} remotamente via NexusDesk`}
                              >
                                <Monitor size={13} />
                                <span>NexusDesk ({tk.asset_tag})</span>
                              </button>
                            )}
                            {canArchiveToVps && (
                              <button
                                type="button"
                                onClick={() => handleArchiveTicketToVps(tk.id, tk.protocol)}
                                disabled={Boolean(archivingTicketIds[tk.id])}
                                className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-xs font-bold text-slate-700 dark:text-zinc-200 hover:border-brand/40 hover:text-brand-aa transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Arquivar cópia na VPS (/Chamados)"
                                aria-label={`Arquivar cópia na VPS do chamado ${tk.protocol || tk.title}`}
                              >
                                <UploadCloud size={13} />
                                <span>{archivingTicketIds[tk.id] ? 'Arquivando...' : 'Arquivar cópia na VPS'}</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDeleteTicket(tk.id, tk.protocol)}
                              className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center gap-1 rounded-xl border border-slate-200 dark:border-zinc-800 px-3 py-2 text-xs font-semibold text-slate-500 dark:text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 hover:border-rose-500/40 active:bg-rose-50 dark:active:bg-rose-950/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                              title="Excluir chamado"
                              aria-label={`Excluir chamado ${tk.protocol || tk.title}`}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleToggleTicketComments(tk.id)}
                            aria-expanded={activeTicketCommentId === tk.id}
                            className={`min-h-[44px] inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold tabular-nums transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                              activeTicketCommentId === tk.id
                                ? 'bg-brand text-brand-fg shadow-xs'
                                : 'text-slate-700 dark:text-zinc-200 hover:text-brand-aa hover:bg-slate-50 dark:hover:bg-zinc-900 border border-slate-200 dark:border-zinc-800'
                            }`}
                          >
                            <MessageSquare size={13} />
                            <span>
                              Diálogo Técnico ({ticketCommentsMap[tk.id]?.length ?? tk.comments_count ?? 0})
                            </span>
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Right Column: Live Ticket Chat Panel + Telemetry Fleet, Terms, Live Feed */}
            <div ref={chatPanelWrapperRef} className="lg:col-span-5 space-y-5">
              {selectedActiveTicket && (
                <TicketChatPanel
                  ticket={selectedActiveTicket}
                  comments={
                    ticketCommentsMap[selectedActiveTicket.id] ||
                    selectedActiveTicket.comments ||
                    []
                  }
                  loading={loadingCommentsId === selectedActiveTicket.id}
                  wsStatus={wsStatus}
                  typingUser={typingByTicket[selectedActiveTicket.id] || null}
                  matchingDevice={
                    selectedActiveTicket.asset_tag
                      ? findDeviceForTicket(selectedActiveTicket)
                      : null
                  }
                  onClose={() => {
                    activeTicketCommentIdRef.current = null;
                    setActiveTicketCommentId(null);
                  }}
                  onSendMessage={(payload) =>
                    handleSendTicketComment(selectedActiveTicket.id, payload)
                  }
                  onTyping={(isTyping) => handleTypingForTicket(selectedActiveTicket, isTyping)}
                  onUpdateStatus={(nextStatus, notes) =>
                    handleResolveTicket(selectedActiveTicket.id, nextStatus, notes)
                  }
                  onOpenRemote={(dev) => setRemoteModalDevice(dev)}
                />
              )}
              {/* Fleet Telemetry (RMM) */}
              <div className="surface-card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider tabular-nums text-slate-800 dark:text-zinc-100 flex items-center gap-2">
                    <Laptop size={15} className="text-cyan-500" />
                    <span>Telemetria de Frotas ({fleet.devices?.length || 0})</span>
                  </h3>
                  <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    Ao Vivo
                  </span>
                </div>

                <div className="space-y-2">
                  {(fleet.devices || []).length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-zinc-400 italic py-2">
                      Nenhuma estação enviando telemetria no momento.
                    </p>
                  ) : (
                    (fleet.devices || []).map((dev) => (
                      <div
                        key={dev.id || dev.device_key}
                        className="surface-subtle p-3 space-y-2.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <div className="min-w-0">
                            <p className="font-mono font-bold text-slate-900 dark:text-zinc-50 truncate">
                              {dev.hostname}
                            </p>
                            <p className="text-xs text-slate-600 dark:text-zinc-400 truncate">
                              {dev.os_version}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setRemoteModalDevice(dev)}
                              className="min-h-[44px] inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand/10 hover:bg-brand/20 border border-brand/30 text-brand-aa active:opacity-90 transition-colors text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                              title="Acessar remotamente via NexusDesk"
                            >
                              <Monitor size={12} />
                              <span>NexusDesk</span>
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleDispatchRemoteCommand(
                                  dev.device_key || dev.hostname,
                                  'force_inventory',
                                )
                              }
                              className="min-h-[44px] inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-200 dark:bg-zinc-800 text-slate-800 dark:text-zinc-200 hover:text-brand-aa hover:bg-slate-300 dark:hover:bg-zinc-700 active:opacity-90 transition-colors text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                              title="Despachar comando de inventário imediato"
                            >
                              <Terminal size={12} />
                              <span>Inventariar</span>
                            </button>
                          </div>
                        </div>

                        {/* Resource Meters */}
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <div className="flex justify-between text-xs text-slate-600 dark:text-zinc-400 mb-1">
                              <span>CPU</span>
                              <span className="font-mono font-bold tabular-nums">{dev.cpu_percent}%</span>
                            </div>
                            <div className="w-full bg-slate-200 dark:bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-[width] duration-300 ${
                                  dev.cpu_percent > 80
                                    ? 'bg-rose-500'
                                    : dev.cpu_percent > 60
                                      ? 'bg-amber-500'
                                      : 'bg-emerald-500'
                                }`}
                                style={{ width: `${Math.min(dev.cpu_percent, 100)}%` }}
                              />
                            </div>
                          </div>

                          <div>
                            <div className="flex justify-between text-xs text-slate-600 dark:text-zinc-400 mb-1">
                              <span>RAM</span>
                              <span className="font-mono font-bold tabular-nums">{dev.ram_percent}%</span>
                            </div>
                            <div className="w-full bg-slate-200 dark:bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-[width] duration-300 ${
                                  dev.ram_percent > 85
                                    ? 'bg-rose-500'
                                    : dev.ram_percent > 70
                                      ? 'bg-amber-500'
                                      : 'bg-sky-500'
                                }`}
                                style={{ width: `${Math.min(dev.ram_percent, 100)}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Legal Custody Terms (CLT Passports) */}
              <div className="surface-card p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider tabular-nums text-slate-800 dark:text-zinc-100 flex items-center gap-2">
                    <FileSignature size={15} className="text-sky-600 dark:text-sky-400" />
                    <span>Custódia &amp; Termos CLT ({terms.length})</span>
                  </h3>
                  <button
                    type="button"
                    onClick={() => setIsNewTermModalOpen(true)}
                    className="min-h-[44px] px-2.5 text-xs font-bold text-brand-aa hover:underline rounded-lg transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    + Novo Termo
                  </button>
                </div>

                <div className="space-y-2">
                  {terms.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-zinc-400 italic py-2">
                      Nenhum termo de custódia CLT emitido no momento.
                    </p>
                  ) : (
                    terms.slice(0, 6).map((tm) => (
                      <div
                        key={tm.id}
                        className="surface-subtle p-2.5 flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="space-y-0.5 min-w-0 pr-2">
                          <p className="font-semibold text-slate-800 dark:text-zinc-100 truncate">
                            {tm.employee_name}
                          </p>
                          <p className="font-mono text-xs text-slate-500 dark:text-zinc-400 truncate max-w-[180px]">
                            Doc: {tm.document_hash}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <span
                            className={`text-xs font-bold px-2 py-0.5 rounded-full uppercase ${
                              tm.status === 'signed'
                                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                            }`}
                          >
                            {tm.status === 'signed' ? 'HMAC Assinado' : 'Pendente'}
                          </span>
                          {tm.status === 'pending' && (
                            <button
                              type="button"
                              onClick={() => handleSignTerm(tm.id)}
                              className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-slate-500 dark:text-zinc-400 hover:text-brand-aa hover:bg-slate-200/60 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                              title="Assinar termo digitalmente (HMAC-SHA256)"
                              aria-label={`Assinar termo de ${tm.employee_name}`}
                            >
                              <FileSignature size={15} />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleVerifySingleTerm(tm.id)}
                            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-slate-500 dark:text-zinc-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-slate-200/60 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                            title="Auditar integridade da assinatura criptográfica"
                            aria-label={`Auditar termo de ${tm.employee_name}`}
                          >
                            <ShieldCheck size={15} />
                          </button>
                          {tm.status === 'signed' && canArchiveToVps && (
                            <button
                              type="button"
                              onClick={() => handleArchiveCltTermToVps(tm.id, tm.employee_name)}
                              disabled={Boolean(archivingTermIds[tm.id])}
                              className="min-h-[44px] px-2.5 inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 dark:border-zinc-700 text-xs font-bold text-slate-700 dark:text-zinc-200 hover:text-brand-aa hover:border-brand/40 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50 disabled:cursor-not-allowed"
                              title="Arquivar cópia na VPS (/Cofre-TI-Infra/Termos)"
                              aria-label={`Arquivar cópia na VPS do termo de ${tm.employee_name}`}
                            >
                              <UploadCloud size={14} />
                              <span>{archivingTermIds[tm.id] ? 'Arquivando...' : 'Arquivar cópia na VPS'}</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDeleteTerm(tm.id, tm.employee_name)}
                            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-slate-500 dark:text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                            title="Remover termo"
                            aria-label={`Remover termo de ${tm.employee_name}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Live Operational Audit Log */}
              <div className="surface-card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-zinc-100 flex items-center gap-2">
                    <Activity size={14} className="text-emerald-500" />
                    <span>Auditoria de Eventos em Tempo Real</span>
                  </h3>
                  <span className="text-xs font-mono text-slate-500 dark:text-zinc-400">
                    WebSocket Ativo
                  </span>
                </div>

                <div className="max-h-48 overflow-y-auto space-y-1.5 font-mono text-xs custom-scrollbar">
                  {wsFeed.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-zinc-400 py-3 text-center">
                      Aguardando eventos operacionais na malha…
                    </p>
                  ) : (
                    wsFeed.map((item) => (
                      <div
                        key={item._feedKey}
                        className="rounded-lg bg-zinc-900 text-zinc-200 px-3 py-2 border border-zinc-800 flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <span className="text-emerald-400 font-bold">[{item.event}]</span>
                          <span className="text-zinc-300 truncate">
                            {typeof item.data === 'string'
                              ? item.data
                              : item.data?.title || item.data?.message || item.role || 'Evento processado'}
                          </span>
                        </div>
                        <span className="text-xs text-zinc-400 uppercase shrink-0 ml-2">
                          Live
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Modal de Emissão de Novo Termo de Custódia CLT */}
      {isNewTermModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div
            aria-hidden="true"
            className="fixed inset-0 bg-black/70 backdrop-blur-sm animate-fade-in"
            onClick={() => !submittingTerm && setIsNewTermModalOpen(false)}
          />

          <div
            ref={newTermModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-term-modal-title"
            tabIndex={-1}
            className="relative bg-white dark:bg-[#111113] rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-zinc-800 shadow-2xl w-full max-w-lg p-5 sm:p-6 space-y-4 max-h-[90vh] overflow-y-auto overscroll-contain custom-scrollbar animate-zoom-in safe-area-pb focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <div className="w-10 h-1 bg-slate-300 dark:bg-zinc-700 rounded-full mx-auto -mt-2 mb-2 sm:hidden" />

            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-zinc-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400">
                  <FileSignature size={20} />
                </div>
                <div>
                  <h3
                    id="new-term-modal-title"
                    className="text-base font-bold text-slate-900 dark:text-zinc-50"
                  >
                    Emitir Termo de Custódia CLT
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-zinc-400">
                    Art. 462 §1º CLT • Selo Criptográfico SHA-256 + HMAC
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsNewTermModalOpen(false)}
                disabled={submittingTerm}
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-500 dark:text-zinc-400 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
                aria-label="Fechar modal de termo"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateNewTerm} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="term-employee-name"
                    className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-zinc-300 mb-1.5"
                  >
                    Colaborador Responsável *
                  </label>
                  <input
                    id="term-employee-name"
                    name="employeeName"
                    type="text"
                    required
                    value={newTermForm.employeeName}
                    onChange={(e) =>
                      setNewTermForm((p) => ({ ...p, employeeName: e.target.value }))
                    }
                    placeholder="Ex: Délcio Farias"
                    className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3.5 py-2 text-xs sm:text-sm text-slate-900 dark:text-zinc-50 placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  />
                </div>
                <div>
                  <label
                    htmlFor="term-employee-email"
                    className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-zinc-300 mb-1.5"
                  >
                    E-mail Corporativo *
                  </label>
                  <input
                    id="term-employee-email"
                    name="employeeEmail"
                    type="email"
                    required
                    value={newTermForm.employeeEmail}
                    onChange={(e) =>
                      setNewTermForm((p) => ({ ...p, employeeEmail: e.target.value }))
                    }
                    placeholder="Ex: colaborador@empresa.com.br"
                    className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3.5 py-2 text-xs sm:text-sm text-slate-900 dark:text-zinc-50 placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="term-type"
                    className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-zinc-300 mb-1.5"
                  >
                    Tipo de Termo
                  </label>
                  <select
                    id="term-type"
                    name="termType"
                    value={newTermForm.termType}
                    onChange={(e) =>
                      setNewTermForm((p) => ({ ...p, termType: e.target.value }))
                    }
                    className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3.5 py-2 text-xs sm:text-sm font-semibold text-slate-900 dark:text-zinc-50 focus:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    <option value="entrega">Termo de Entrega &amp; Guarda</option>
                    <option value="emprestimo">Termo de Empréstimo Temporário</option>
                    <option value="devolucao">Termo de Devolução Patrimonial</option>
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="term-department"
                    className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-zinc-300 mb-1.5"
                  >
                    Departamento / Filial
                  </label>
                  <input
                    id="term-department"
                    name="department"
                    type="text"
                    value={newTermForm.department}
                    onChange={(e) =>
                      setNewTermForm((p) => ({ ...p, department: e.target.value }))
                    }
                    placeholder="Ex: TI & Operações"
                    className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3.5 py-2 text-xs sm:text-sm text-slate-900 dark:text-zinc-50 placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label
                    htmlFor="term-asset-tag"
                    className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-zinc-300 mb-1.5"
                  >
                    Tag Patrimonial *
                  </label>
                  <input
                    id="term-asset-tag"
                    name="internalId"
                    type="text"
                    required
                    value={newTermForm.internalId}
                    onChange={(e) =>
                      setNewTermForm((p) => ({ ...p, internalId: e.target.value }))
                    }
                    placeholder="Ex: NTB-001"
                    className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs font-mono uppercase text-slate-900 dark:text-zinc-50 placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  />
                </div>
                <div>
                  <label
                    htmlFor="term-asset-model"
                    className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-zinc-300 mb-1.5"
                  >
                    Equipamento / Modelo *
                  </label>
                  <input
                    id="term-asset-model"
                    name="model"
                    type="text"
                    required
                    value={newTermForm.model}
                    onChange={(e) =>
                      setNewTermForm((p) => ({ ...p, model: e.target.value }))
                    }
                    placeholder="Notebook Samsung Book"
                    className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs sm:text-sm text-slate-900 dark:text-zinc-50 placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  />
                </div>
                <div>
                  <label
                    htmlFor="term-serial-number"
                    className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-zinc-300 mb-1.5"
                  >
                    Número de Série
                  </label>
                  <input
                    id="term-serial-number"
                    name="serialNumber"
                    type="text"
                    value={newTermForm.serialNumber}
                    onChange={(e) =>
                      setNewTermForm((p) => ({ ...p, serialNumber: e.target.value }))
                    }
                    placeholder="Opcional"
                    className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs font-mono text-slate-900 dark:text-zinc-50 placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-100 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setIsNewTermModalOpen(false)}
                  disabled={submittingTerm}
                  className="min-h-[44px] rounded-xl border border-slate-300 dark:border-zinc-700 px-4 py-2 text-xs font-bold text-slate-700 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 active:opacity-90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submittingTerm}
                  className="min-h-[44px] rounded-xl bg-brand hover:bg-brand-dark px-4 py-2 text-xs font-bold text-brand-fg shadow-md active:opacity-90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  {submittingTerm ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" />
                      <span>Emitindo…</span>
                    </>
                  ) : (
                    <>
                      <FileSignature size={15} />
                      <span>Emitir Termo CLT</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Abertura de Novo Chamado */}
      {isNewTicketModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div
            aria-hidden="true"
            className="fixed inset-0 bg-black/70 backdrop-blur-sm animate-fade-in"
            onClick={() => !submittingTicket && setIsNewTicketModalOpen(false)}
          />

          <div
            ref={newTicketModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-ticket-modal-title"
            tabIndex={-1}
            className="relative bg-white dark:bg-[#111113] rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-zinc-800 shadow-2xl w-full max-w-lg p-5 sm:p-6 space-y-4 max-h-[90vh] overflow-y-auto overscroll-contain custom-scrollbar animate-zoom-in safe-area-pb focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <div className="w-10 h-1 bg-slate-300 dark:bg-zinc-700 rounded-full mx-auto -mt-2 mb-2 sm:hidden" />

            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-zinc-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-brand/10 text-brand-aa">
                  <Ticket size={20} />
                </div>
                <div>
                  <h3
                    id="new-ticket-modal-title"
                    className="text-base font-bold text-slate-900 dark:text-zinc-50"
                  >
                    Novo Chamado Técnico
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-zinc-400">
                    Registre a ocorrência para a equipe de Suporte N1/N2
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsNewTicketModalOpen(false)}
                disabled={submittingTicket}
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-500 dark:text-zinc-400 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
                aria-label="Fechar modal"
              >
                <X size={18} />
              </button>
            </div>

            <form
              onSubmit={handleCreateNewTicket}
              onPaste={handleNewTicketPaste}
              onDragOver={(e) => {
                e.preventDefault();
                setModalDropActive(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setModalDropActive(false);
              }}
              onDrop={async (e) => {
                e.preventDefault();
                setModalDropActive(false);
                if (e.dataTransfer?.files?.length) {
                  await handleNewTicketFiles(e.dataTransfer.files);
                }
              }}
              className="space-y-4"
            >
              {/* Atalhos Rápidos em 1 clique */}
              <div>
                <span className="block text-[11px] font-bold text-slate-600 dark:text-zinc-300 mb-1.5 uppercase tracking-wider">
                  Atalhos rápidos
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {TICKET_QUICK_TEMPLATES.map((tpl) => (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() =>
                        setNewTicketForm((p) => ({
                          ...p,
                          title: tpl.title,
                          description: tpl.description,
                          category: tpl.category,
                          priority: tpl.priority,
                        }))
                      }
                      className="rounded-lg border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-2.5 py-1 text-[11px] font-semibold text-slate-700 dark:text-zinc-200 hover:border-brand hover:text-brand-aa transition-colors"
                    >
                      {tpl.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label
                  htmlFor="new-ticket-title"
                  className="block text-xs font-bold text-slate-700 dark:text-zinc-300 mb-1.5 uppercase tracking-wider"
                >
                  Assunto / Título da Demanda *
                </label>
                <input
                  id="new-ticket-title"
                  name="title"
                  type="text"
                  required
                  value={newTicketForm.title}
                  onChange={(e) =>
                    setNewTicketForm((p) => ({ ...p, title: e.target.value }))
                  }
                  placeholder="Ex: Falha na conexão VPN corporativa"
                  className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 dark:text-zinc-50 placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="new-ticket-category"
                    className="block text-xs font-bold text-slate-700 dark:text-zinc-300 mb-1.5 uppercase tracking-wider"
                  >
                    Categoria
                  </label>
                  <select
                    id="new-ticket-category"
                    name="category"
                    value={newTicketForm.category}
                    onChange={(e) =>
                      setNewTicketForm((p) => ({ ...p, category: e.target.value }))
                    }
                    className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3.5 py-2.5 text-xs sm:text-sm font-semibold text-slate-900 dark:text-zinc-50 focus:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    <option value="hardware">Hardware / Equipamento</option>
                    <option value="software">Software / SO</option>
                    <option value="network">Rede &amp; Conectividade VPN</option>
                    <option value="access">Acesso &amp; Credenciais</option>
                    <option value="other">Outros</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="new-ticket-priority"
                    className="block text-xs font-bold text-slate-700 dark:text-zinc-300 mb-1.5 uppercase tracking-wider"
                  >
                    Prioridade &amp; Impacto
                  </label>
                  <select
                    id="new-ticket-priority"
                    name="priority"
                    value={newTicketForm.priority}
                    onChange={(e) =>
                      setNewTicketForm((p) => ({ ...p, priority: e.target.value }))
                    }
                    className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3.5 py-2.5 text-xs sm:text-sm font-semibold text-slate-900 dark:text-zinc-50 focus:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    <option value="medium">P3 Normal (SLA 24h)</option>
                    <option value="high">P2 Alta (SLA 8h)</option>
                    <option value="critical">P1 Crítica / Bloqueante (SLA 2h)</option>
                    <option value="low">P4 Baixa (Planejada)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="new-ticket-asset-tag"
                    className="block text-xs font-bold text-slate-700 dark:text-zinc-300 mb-1.5 uppercase tracking-wider"
                  >
                    Patrimônio / Tag (Opcional)
                  </label>
                  <input
                    id="new-ticket-asset-tag"
                    name="assetTag"
                    type="text"
                    list="servicedesk-fleet-tags"
                    value={newTicketForm.assetTag}
                    onChange={(e) =>
                      setNewTicketForm((p) => ({ ...p, assetTag: e.target.value }))
                    }
                    placeholder="Ex: NTB-001"
                    className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3.5 py-2.5 text-xs sm:text-sm font-mono text-slate-900 dark:text-zinc-50 placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand uppercase"
                  />
                  <datalist id="servicedesk-fleet-tags">
                    {(fleet.devices || []).map((dev, idx) => {
                      const tagValue = dev.assetTag || dev.internalId || dev.device_key || dev.hostname;
                      if (!tagValue) return null;
                      return (
                        <option key={dev.id || tagValue || idx} value={tagValue}>
                          {dev.hostname || tagValue} ({dev.loggedUser || dev.os_version || 'Estação'})
                        </option>
                      );
                    })}
                  </datalist>
                </div>

                <div>
                  <label
                    htmlFor="new-ticket-department"
                    className="block text-xs font-bold text-slate-700 dark:text-zinc-300 mb-1.5 uppercase tracking-wider"
                  >
                    Departamento / Área
                  </label>
                  <input
                    id="new-ticket-department"
                    name="department"
                    type="text"
                    value={newTicketForm.department}
                    onChange={(e) =>
                      setNewTicketForm((p) => ({ ...p, department: e.target.value }))
                    }
                    placeholder="Ex: Operações / Logística"
                    className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 dark:text-zinc-50 placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="new-ticket-description"
                  className="block text-xs font-bold text-slate-700 dark:text-zinc-300 mb-1.5 uppercase tracking-wider"
                >
                  Descrição Detalhada do Problema *
                </label>
                <textarea
                  id="new-ticket-description"
                  name="description"
                  required={newTicketAttachments.length === 0}
                  rows={3}
                  value={newTicketForm.description}
                  onChange={(e) =>
                    setNewTicketForm((p) => ({ ...p, description: e.target.value }))
                  }
                  placeholder="Descreva o sintoma observado, mensagem de erro ou equipamento afetado…"
                  className="w-full rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 p-3 text-xs sm:text-sm text-slate-900 dark:text-zinc-50 placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand resize-none"
                />
              </div>

              {/* Anexo de Fotos e Prints (Ctrl+V / arrastar / selecionar) */}
              <div className="space-y-2">
                <span className="block text-xs font-bold text-slate-700 dark:text-zinc-300 uppercase tracking-wider">
                  Fotos ou Prints de Evidência (Opcional, até {MAX_TICKET_ATTACHMENTS})
                </span>
                <input
                  ref={newTicketFileInputRef}
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="sr-only"
                  onChange={async (e) => {
                    await handleNewTicketFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
                <div
                  className={`rounded-xl border-2 border-dashed p-3 transition-colors space-y-2 ${
                    modalDropActive
                      ? 'border-brand bg-brand/10'
                      : 'border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900/70'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={
                        processingModalImages ||
                        newTicketAttachments.length >= MAX_TICKET_ATTACHMENTS
                      }
                      onClick={() => newTicketFileInputRef.current?.click()}
                      className="min-h-[36px] inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-zinc-200 hover:border-brand disabled:opacity-50"
                    >
                      <Paperclip size={13} />
                      <span>Anexar print / foto</span>
                    </button>
                    <span className="text-[11px] text-slate-500 dark:text-zinc-400">
                      ou cole um print aqui com Ctrl+V
                    </span>
                  </div>

                  {newTicketAttachments.length > 0 && (
                    <div className="grid grid-cols-4 gap-2">
                      {newTicketAttachments.map((att) => (
                        <div
                          key={att.id}
                          className="relative rounded-lg overflow-hidden border border-slate-200 dark:border-zinc-700 aspect-square"
                        >
                          <img
                            src={att.dataUrl}
                            alt={att.name}
                            className="w-full h-full object-cover"
                          />
                          <button
                            type="button"
                            aria-label={`Remover ${att.name}`}
                            onClick={() =>
                              setNewTicketAttachments((prev) =>
                                prev.filter((item) => item.id !== att.id),
                              )
                            }
                            className="absolute top-1 right-1 w-5 h-5 rounded-full bg-slate-900/85 text-white flex items-center justify-center hover:bg-rose-600"
                          >
                            <X size={11} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-100 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setIsNewTicketModalOpen(false)}
                  disabled={submittingTicket}
                  className="min-h-[44px] rounded-xl border border-slate-300 dark:border-zinc-700 px-4 py-2 text-xs font-bold text-slate-700 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 active:opacity-90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submittingTicket || processingModalImages}
                  className="min-h-[44px] rounded-xl bg-brand hover:bg-brand-dark px-4 py-2 text-xs font-bold text-brand-fg shadow-md active:opacity-90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  {submittingTicket ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" />
                      <span>Registrando…</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={15} />
                      <span>Abrir Chamado</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Modal Remoto NexusDesk */}
      {remoteModalDevice && (
        <RemoteControlModal
          isOpen={Boolean(remoteModalDevice)}
          onClose={() => setRemoteModalDevice(null)}
          tenantId={gatewaySession?.user?.tenantId || currentUser?.tenantId || ''}
          initialDevice={remoteModalDevice}
          currentUser={currentUser || gatewaySession?.user}
          initialTab="screen"
        />
      )}
    </div>
  );
};

export default ServiceDeskHub;
