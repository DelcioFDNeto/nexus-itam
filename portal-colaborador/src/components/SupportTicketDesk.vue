<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { portalApi } from '../services/nexusApi';
import {
  MAX_TICKET_ATTACHMENTS,
  PORTAL_QUICK_TEMPLATES,
  extractClipboardImages,
  formatAttachmentBytes,
  isSupportStaffRole,
  processTicketImageFiles,
} from '../utils/ticketMedia';
import PortalIcon from './PortalIcon.vue';

const props = defineProps({
  tickets: { type: Array, required: true },
  assets: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  userDepartment: { type: String, default: 'Geral' },
  userEmail: { type: String, default: '' },
  wsState: { type: String, default: 'disconnected' },
  liveEvent: { type: Object, default: null },
  preselectedAssetTag: { type: String, default: '' },
});

const emit = defineEmits(['created', 'clear-preselected', 'retry', 'send-typing', 'sync-tickets']);

const form = reactive({
  title: '',
  description: '',
  category: 'Hardware & Periféricos',
  priority: 'medium',
  assetTag: '',
});

const fieldErrors = reactive({
  title: '',
  description: '',
});

const categories = [
  { id: 'Hardware & Periféricos', label: 'Hardware', desc: 'Tela, teclado, bateria ou fonte', icon: 'laptop' },
  { id: 'Conectividade & VPN', label: 'Rede / VPN', desc: 'Wi-Fi, VPN ou lentidão', icon: 'globe' },
  { id: 'Sistemas & Softwares', label: 'Sistemas / ERP', desc: 'Windows, e-mail e acessos', icon: 'settings' },
  { id: 'Substituição / Upgrade', label: 'Substituição', desc: 'Upgrade ou troca de máquina', icon: 'repeat' },
];

const priorities = [
  { id: 'low', label: 'Baixa', sla: '48h' },
  { id: 'medium', label: 'Normal', sla: '24h' },
  { id: 'high', label: 'Alta', sla: '8h' },
  { id: 'critical', label: 'Crítica', sla: '4h' },
];

const titleInputRef = ref(null);
const descriptionInputRef = ref(null);
const formFileInputRef = ref(null);
const formCameraInputRef = ref(null);
const chatFileInputRef = ref(null);
const chatCameraInputRef = ref(null);
const chatInputRef = ref(null);
const threadRef = ref(null);

const showComposer = ref(props.tickets.length === 0 && !props.loading && !props.error);
const activeTemplateId = ref('');
const formAttachments = ref([]);
const formDropActive = ref(false);
const processingFormFiles = ref(false);
const submitting = ref(false);
const feedback = ref('');
const errorMsg = ref('');

const statusFilter = ref('all');
const searchQuery = ref('');
const selectedTicket = ref(null);
const mobileChatOpen = ref(false);
const loadingDetails = ref(false);
const detailError = ref('');

const newComment = ref('');
const chatAttachments = ref([]);
const chatDropActive = ref(false);
const processingChatFiles = ref(false);
const sendingComment = ref(false);
const lightboxItem = ref(null);
const unreadMap = reactive({});
const typingIndicator = ref(null);

let latestDetailRequestId = 0;
let typingIdleTimer = null;
let lastTypingSentAt = 0;
let incomingTypingClearTimer = null;

function formatDateShort(iso) {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return String(iso);
  return dt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function formatTimeOnly(iso) {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function assetTagOf(asset) {
  return asset?.internal_id || asset?.internalId || '';
}

watch(
  () => props.assets,
  (list) => {
    if (!form.assetTag && Array.isArray(list) && list.length === 1) {
      const onlyTag = assetTagOf(list[0]);
      if (onlyTag) form.assetTag = onlyTag;
    }
  },
  { immediate: true },
);

watch(
  () => props.preselectedAssetTag,
  (val) => {
    if (val) {
      form.assetTag = val;
      showComposer.value = true;
      mobileChatOpen.value = false;
      emit('clear-preselected');
      nextTick(() => {
        titleInputRef.value?.focus();
      });
    }
  },
  { immediate: true },
);

const filteredTickets = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  return (props.tickets || []).filter((tk) => {
    if (statusFilter.value === 'active' && (tk.status === 'resolved' || tk.status === 'closed')) {
      return false;
    }
    if (statusFilter.value === 'done' && tk.status !== 'resolved' && tk.status !== 'closed') {
      return false;
    }
    if (!query) return true;
    return (
      String(tk.protocol || '').toLowerCase().includes(query) ||
      String(tk.title || '').toLowerCase().includes(query) ||
      String(tk.asset_tag || '').toLowerCase().includes(query) ||
      String(tk.last_message_preview || '').toLowerCase().includes(query)
    );
  });
});

watch(
  () => props.tickets,
  (list) => {
    if (!Array.isArray(list)) return;
    if (list.length === 0 && !props.loading && !props.error) {
      showComposer.value = true;
      selectedTicket.value = null;
      return;
    }
    if (selectedTicket.value) {
      const updated = list.find((item) => item.id === selectedTicket.value.id);
      if (updated) {
        selectedTicket.value = {
          ...selectedTicket.value,
          ...updated,
          attachments: selectedTicket.value.attachments || updated.attachments || [],
          comments: selectedTicket.value.comments || [],
        };
      }
    } else if (list.length > 0 && !showComposer.value && !loadingDetails.value) {
      openDetails(list[0], { openMobile: false });
    }
  },
  { immediate: true },
);

watch(
  () => props.liveEvent,
  (evtWrapper) => {
    if (!evtWrapper?.event) return;
    const { event, data, timestamp } = evtWrapper;
    const myEmail = String(props.userEmail || '').toLowerCase().trim();

    if (event === 'ticket.typing') {
      const senderEmail = String(data?.senderEmail || '').toLowerCase().trim();
      if (senderEmail && senderEmail === myEmail) return;
      if (selectedTicket.value?.id !== data?.ticketId) return;

      clearTimeout(incomingTypingClearTimer);
      if (data?.isTyping === false) {
        typingIndicator.value = null;
        return;
      }
      typingIndicator.value = {
        ticketId: data.ticketId,
        senderName: data.senderName || 'Equipe de TI',
        senderRole: data.senderRole || 'operator',
      };
      incomingTypingClearTimer = setTimeout(() => {
        typingIndicator.value = null;
      }, 3600);
      return;
    }

    if (event === 'ticket.commented' && data?.ticketId) {
      const senderEmail = String(data?.authorEmail || '').toLowerCase().trim();
      if (
        typingIndicator.value?.ticketId === data.ticketId &&
        senderEmail &&
        senderEmail !== myEmail
      ) {
        typingIndicator.value = null;
        clearTimeout(incomingTypingClearTimer);
      }

      if (selectedTicket.value?.id === data.ticketId) {
        const currentComments = Array.isArray(selectedTicket.value.comments)
          ? [...selectedTicket.value.comments]
          : [];
        const duplicate = currentComments.some(
          (cm) =>
            (data.commentId && cm.id === data.commentId) ||
            (cm.message === (data.message || '') &&
              String(cm.author_email || '').toLowerCase() === senderEmail &&
              Math.abs(new Date(cm.created_at).getTime() - new Date(data.createdAt || timestamp).getTime()) < 4000),
        );
        if (!duplicate) {
          currentComments.push({
            id: data.commentId || `ws-${Date.now().toString(36)}`,
            ticket_id: data.ticketId,
            author_name: data.authorName || 'Equipe de TI',
            author_email: data.authorEmail || '',
            author_role: data.authorRole || 'operator',
            message: data.message || '',
            attachments: Array.isArray(data.attachments) ? data.attachments : [],
            created_at: data.createdAt || timestamp || new Date().toISOString(),
          });
          selectedTicket.value = {
            ...selectedTicket.value,
            comments: currentComments,
            comments_count: currentComments.length,
          };
          scrollThreadToBottom();
        }
        delete unreadMap[data.ticketId];
      } else if (senderEmail !== myEmail) {
        unreadMap[data.ticketId] = (unreadMap[data.ticketId] || 0) + 1;
      }
      return;
    }

    if (event === 'ticket.updated' && data?.id) {
      if (selectedTicket.value?.id === data.id) {
        selectedTicket.value = {
          ...selectedTicket.value,
          status: data.status || selectedTicket.value.status,
          assigned_tech_name: data.assignedTechName ?? selectedTicket.value.assigned_tech_name,
          resolution_notes: data.resolutionNotes ?? selectedTicket.value.resolution_notes,
        };
      }
      emit('sync-tickets');
    }
  },
);

function handleWindowKeydown(e) {
  if (e.key === 'Escape' && lightboxItem.value) {
    lightboxItem.value = null;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', handleWindowKeydown);
}

onBeforeUnmount(() => {
  clearTimeout(typingIdleTimer);
  clearTimeout(incomingTypingClearTimer);
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', handleWindowKeydown);
  }
});

function scrollThreadToBottom() {
  nextTick(() => {
    if (threadRef.value) {
      threadRef.value.scrollTop = threadRef.value.scrollHeight;
    }
  });
}

function applyQuickTemplate(tpl) {
  activeTemplateId.value = tpl.id;
  form.category = tpl.category;
  form.priority = tpl.priority;
  form.title = tpl.title;
  form.description = tpl.description;
  fieldErrors.title = '';
  fieldErrors.description = '';
  errorMsg.value = '';
  nextTick(() => {
    descriptionInputRef.value?.focus();
  });
}

async function appendFilesToTarget(files, targetRef, processingRef, errorTargetRef) {
  if (!files || files.length === 0) return;
  processingRef.value = true;
  errorTargetRef.value = '';
  try {
    const { added, errors } = await processTicketImageFiles(
      files,
      targetRef.value,
      MAX_TICKET_ATTACHMENTS,
    );
    if (added.length > 0) {
      targetRef.value = [...targetRef.value, ...added];
    }
    if (errors.length > 0) {
      errorTargetRef.value = errors[0];
    }
  } finally {
    processingRef.value = false;
  }
}

async function handleFormFileChange(e) {
  const files = e.target?.files;
  await appendFilesToTarget(files, formAttachments, processingFormFiles, errorMsg);
  if (e.target) e.target.value = '';
}

async function handleFormPaste(e) {
  const imgs = extractClipboardImages(e.clipboardData);
  if (imgs.length > 0) {
    e.preventDefault();
    await appendFilesToTarget(imgs, formAttachments, processingFormFiles, errorMsg);
  }
}

async function handleFormDrop(e) {
  formDropActive.value = false;
  const files = e.dataTransfer?.files;
  if (files?.length) {
    await appendFilesToTarget(files, formAttachments, processingFormFiles, errorMsg);
  }
}

function removeFormAttachment(id) {
  formAttachments.value = formAttachments.value.filter((item) => item.id !== id);
}

async function handleChatFileChange(e) {
  const files = e.target?.files;
  await appendFilesToTarget(files, chatAttachments, processingChatFiles, detailError);
  if (e.target) e.target.value = '';
  nextTick(() => chatInputRef.value?.focus());
}

async function handleChatPaste(e) {
  const imgs = extractClipboardImages(e.clipboardData);
  if (imgs.length > 0) {
    e.preventDefault();
    await appendFilesToTarget(imgs, chatAttachments, processingChatFiles, detailError);
  }
}

async function handleChatDrop(e) {
  chatDropActive.value = false;
  const files = e.dataTransfer?.files;
  if (files?.length) {
    await appendFilesToTarget(files, chatAttachments, processingChatFiles, detailError);
  }
}

function removeChatAttachment(id) {
  chatAttachments.value = chatAttachments.value.filter((item) => item.id !== id);
}

function validateForm() {
  fieldErrors.title = '';
  fieldErrors.description = '';

  const cleanTitle = form.title.trim();
  const cleanDescription = form.description.trim();

  if (cleanTitle.length < 4) {
    fieldErrors.title = 'Informe um título claro com pelo menos 4 caracteres.';
  }
  if (cleanDescription.length < 3 && formAttachments.value.length === 0) {
    fieldErrors.description = 'Descreva o problema (mín. 3 caracteres) ou anexe uma foto/print.';
  }

  if (fieldErrors.title) {
    nextTick(() => titleInputRef.value?.focus());
    return false;
  }
  if (fieldErrors.description) {
    nextTick(() => descriptionInputRef.value?.focus());
    return false;
  }
  return true;
}

async function submitTicket() {
  errorMsg.value = '';
  feedback.value = '';

  if (!validateForm()) return;

  submitting.value = true;
  try {
    const cleanDescription =
      form.description.trim() || 'Evidência visual (foto/print) anexada na abertura do chamado.';

    const created = await portalApi.createTicket({
      title: form.title.trim(),
      description: cleanDescription,
      category: form.category,
      priority: form.priority,
      department: props.userDepartment || 'Geral',
      assetTag: form.assetTag || null,
      attachments: formAttachments.value,
    });
    feedback.value = `Chamado ${created.protocol} aberto! Envie mais detalhes ou prints no chat abaixo.`;
    form.title = '';
    form.description = '';
    form.priority = 'medium';
    formAttachments.value = [];
    activeTemplateId.value = '';
    showComposer.value = false;
    emit('created');
    await openDetails(created, { openMobile: true });
  } catch (err) {
    errorMsg.value = err.message || 'Falha ao abrir chamado.';
  } finally {
    submitting.value = false;
  }
}

async function openDetails(ticket, { openMobile = true } = {}) {
  const reqId = ++latestDetailRequestId;
  detailError.value = '';
  typingIndicator.value = null;
  delete unreadMap[ticket.id];

  selectedTicket.value = {
    ...ticket,
    attachments: ticket.attachments || [],
    comments: ticket.comments || [],
  };
  if (openMobile) {
    mobileChatOpen.value = true;
  }
  loadingDetails.value = true;
  try {
    const detail = await portalApi.getTicketDetail(ticket.id);
    if (reqId === latestDetailRequestId && selectedTicket.value?.id === ticket.id) {
      selectedTicket.value = detail;
      scrollThreadToBottom();
    }
  } catch (err) {
    if (reqId === latestDetailRequestId) {
      detailError.value = err.message || 'Falha ao sincronizar histórico deste chamado.';
    }
  } finally {
    if (reqId === latestDetailRequestId) {
      loadingDetails.value = false;
    }
  }
}

function handleChatTyping() {
  if (!selectedTicket.value?.id) return;
  const now = Date.now();
  if (now - lastTypingSentAt > 1800) {
    lastTypingSentAt = now;
    emit('send-typing', { ticketId: selectedTicket.value.id, isTyping: true });
  }
  clearTimeout(typingIdleTimer);
  typingIdleTimer = setTimeout(() => {
    if (selectedTicket.value?.id) {
      emit('send-typing', { ticketId: selectedTicket.value.id, isTyping: false });
    }
  }, 2400);
}

function handleChatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendComment();
  }
}

async function sendComment() {
  if (!selectedTicket.value || sendingComment.value) return;
  const message = newComment.value.trim();
  const attachmentsToSend = [...chatAttachments.value];
  if (!message && attachmentsToSend.length === 0) return;

  sendingComment.value = true;
  detailError.value = '';
  clearTimeout(typingIdleTimer);
  emit('send-typing', { ticketId: selectedTicket.value.id, isTyping: false });

  try {
    const createdComment = await portalApi.addTicketComment(
      selectedTicket.value.id,
      message,
      attachmentsToSend,
    );
    newComment.value = '';
    chatAttachments.value = [];

    const existing = Array.isArray(selectedTicket.value.comments)
      ? selectedTicket.value.comments
      : [];
    const alreadyExists = existing.some((cm) => cm.id === createdComment.id);
    if (!alreadyExists) {
      selectedTicket.value = {
        ...selectedTicket.value,
        comments: [...existing, createdComment],
        comments_count: existing.length + 1,
      };
    }
    scrollThreadToBottom();
    emit('sync-tickets');
  } catch (err) {
    detailError.value = err.message || 'Não foi possível enviar a mensagem.';
  } finally {
    sendingComment.value = false;
    nextTick(() => chatInputRef.value?.focus());
  }
}

function startNewTicket() {
  showComposer.value = !showComposer.value;
  errorMsg.value = '';
  feedback.value = '';
  if (showComposer.value) {
    nextTick(() => titleInputRef.value?.focus());
  }
}

const statusMap = {
  open: {
    label: 'Aberto',
    cls: 'bg-sky-50 text-sky-900 border-sky-200 dark:bg-sky-950/70 dark:text-sky-200 dark:border-sky-800',
  },
  in_progress: {
    label: 'Em Atendimento',
    cls: 'bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/70 dark:text-amber-200 dark:border-amber-800',
  },
  resolved: {
    label: 'Resolvido',
    cls: 'bg-emerald-50 text-emerald-900 border-emerald-200 dark:bg-emerald-950/70 dark:text-emerald-200 dark:border-emerald-800',
  },
  closed: {
    label: 'Fechado',
    cls: 'bg-slate-100 text-slate-800 border-slate-300 dark:bg-zinc-800 dark:text-zinc-200 dark:border-zinc-700',
  },
};

const priorityMap = {
  low: { label: 'Baixa', cls: 'text-slate-600 dark:text-slate-300' },
  medium: { label: 'Normal', cls: 'text-sky-700 dark:text-sky-300' },
  high: { label: 'Alta', cls: 'text-amber-700 dark:text-amber-300' },
  critical: { label: 'Crítica', cls: 'text-rose-700 dark:text-rose-300' },
};

function getN1Step(status) {
  if (status === 'resolved' || status === 'closed') return 3;
  if (status === 'in_progress') return 2;
  return 1;
}
</script>

<template>
  <section class="space-y-5">
    <!-- Top Header & Express Action Bar -->
    <div
      class="bg-white dark:bg-[#111113] rounded-2xl border border-slate-200/90 dark:border-zinc-800 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
    >
      <div>
        <div class="flex items-center gap-2">
          <span class="w-8 h-8 rounded-xl bg-brand/10 text-brand-text-light dark:text-brand-text-dark flex items-center justify-center">
            <PortalIcon name="headphones" :size="17" />
          </span>
          <h2 class="text-base sm:text-lg font-bold text-slate-900 dark:text-[#fafafa]">
            Central de Chamados & Chat com a TI
          </h2>
        </div>
        <p class="text-xs text-slate-600 dark:text-slate-300 mt-1">
          Abra solicitações em segundos usando atalhos e converse direto por aqui enviando fotos ou prints (Ctrl+V).
        </p>
      </div>

      <div class="flex items-center gap-2.5 self-start sm:self-center">
        <span
          class="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-full border"
          :class="
            wsState === 'connected'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-800'
              : 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-zinc-800 dark:text-slate-300 dark:border-zinc-700'
          "
        >
          <span
            class="w-2 h-2 rounded-full"
            :class="wsState === 'connected' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'"
          ></span>
          {{ wsState === 'connected' ? 'Chat em tempo real' : 'Canal sincronizado' }}
        </span>

        <button
          type="button"
          class="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs sm:text-sm font-bold transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          :class="
            showComposer
              ? 'border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-zinc-800'
              : 'bg-brand hover:bg-brand-hover text-brand-fg shadow-sm'
          "
          @click="startNewTicket"
        >
          <PortalIcon :name="showComposer ? 'x' : 'plus'" :size="16" />
          <span>{{ showComposer ? 'Fechar formulário' : 'Novo Chamado' }}</span>
        </button>
      </div>
    </div>

    <!-- Feedback Banner -->
    <div
      v-if="feedback"
      role="status"
      aria-live="polite"
      class="rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 p-3.5 text-xs sm:text-sm font-medium text-emerald-900 dark:text-emerald-200 flex items-center justify-between gap-2"
    >
      <div class="flex items-center gap-2">
        <PortalIcon name="check-circle" :size="18" class="shrink-0" />
        <span>{{ feedback }}</span>
      </div>
      <button
        type="button"
        class="p-1.5 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900 cursor-pointer"
        aria-label="Fechar aviso"
        @click="feedback = ''"
      >
        <PortalIcon name="x" :size="15" />
      </button>
    </div>

    <!-- Express Ticket Opener Form -->
    <section
      v-if="showComposer"
      class="bg-white dark:bg-[#111113] rounded-2xl border border-slate-200/90 dark:border-zinc-800 p-5 sm:p-6 shadow-sm space-y-5"
      @paste="handleFormPaste"
      @dragover.prevent="formDropActive = true"
      @dragleave.prevent="formDropActive = false"
      @drop.prevent="handleFormDrop"
    >
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-zinc-800">
        <div>
          <h3 class="text-base font-bold text-slate-900 dark:text-[#fafafa]">
            Abertura Rápida de Chamado
          </h3>
          <p class="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
            Toque em um atalho abaixo ou cole um print da tela com Ctrl+V para agilizar.
          </p>
        </div>
        <span class="text-xs font-medium text-slate-500 dark:text-slate-400">
          Setor: {{ userDepartment }}
        </span>
      </div>

      <!-- 1-Click Issue Shortcuts -->
      <div>
        <p class="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-2 flex items-center gap-1.5">
          <PortalIcon name="zap" :size="14" class="text-amber-500" />
          Atalhos em 1 clique
        </p>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="tpl in PORTAL_QUICK_TEMPLATES"
            :key="tpl.id"
            type="button"
            class="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
            :class="
              activeTemplateId === tpl.id
                ? 'border-brand bg-brand/10 text-brand-text-light dark:text-brand-text-dark shadow-xs'
                : 'border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 text-slate-800 dark:text-slate-200 hover:border-slate-400 dark:hover:border-zinc-500'
            "
            @click="applyQuickTemplate(tpl)"
          >
            {{ tpl.label }}
          </button>
        </div>
      </div>

      <form class="space-y-4" novalidate @submit.prevent="submitTicket">
        <!-- Smart Asset Selector Chips -->
        <div v-if="assets.length > 0" class="space-y-2">
          <label
            for="ticket-asset"
            class="block text-xs font-semibold text-slate-700 dark:text-slate-200"
          >
            Qual equipamento está com problema?
          </label>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="asset in assets.slice(0, 4)"
              :key="asset.id"
              type="button"
              class="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer"
              :class="
                form.assetTag === assetTagOf(asset)
                  ? 'border-brand bg-brand/10 text-brand-text-light dark:text-brand-text-dark'
                  : 'border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-zinc-800'
              "
              @click="form.assetTag = form.assetTag === assetTagOf(asset) ? '' : assetTagOf(asset)"
            >
              <PortalIcon name="laptop" :size="14" />
              <span class="font-mono">{{ assetTagOf(asset) }}</span>
              <span class="text-slate-500 dark:text-slate-400 font-normal truncate max-w-[140px]">
                {{ asset.model || asset.type }}
              </span>
            </button>
          </div>
          <select
            v-if="assets.length > 4"
            id="ticket-asset"
            v-model="form.assetTag"
            class="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 text-slate-900 dark:text-[#fafafa] px-3 py-2 text-xs sm:text-sm focus:border-brand-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          >
            <option value="">Outro equipamento / dúvida geral</option>
            <option v-for="asset in assets" :key="asset.id" :value="assetTagOf(asset)">
              [{{ assetTagOf(asset) }}] {{ asset.model || asset.type }}
            </option>
          </select>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-12 gap-4">
          <!-- Title -->
          <div class="md:col-span-7">
            <label
              for="ticket-title"
              class="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5"
            >
              O que está acontecendo? *
            </label>
            <input
              id="ticket-title"
              ref="titleInputRef"
              v-model="form.title"
              type="text"
              required
              minlength="4"
              maxlength="180"
              :aria-invalid="Boolean(fieldErrors.title)"
              :aria-describedby="fieldErrors.title ? 'ticket-title-error' : undefined"
              placeholder="Ex: VPN desconecta ao abrir o ERP…"
              class="w-full min-h-[44px] rounded-xl border bg-slate-50/70 dark:bg-zinc-900 text-slate-900 dark:text-[#fafafa] placeholder:text-slate-500 dark:placeholder:text-slate-400 px-3.5 py-2.5 text-sm focus:bg-white dark:focus:bg-zinc-900 focus:border-brand-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
              :class="
                fieldErrors.title
                  ? 'border-rose-600 dark:border-rose-400'
                  : 'border-slate-300 dark:border-zinc-700'
              "
              @input="fieldErrors.title = ''"
            />
            <p
              v-if="fieldErrors.title"
              id="ticket-title-error"
              role="alert"
              class="mt-1 text-xs font-medium text-rose-700 dark:text-rose-300"
            >
              {{ fieldErrors.title }}
            </p>
          </div>

          <!-- Urgency -->
          <div class="md:col-span-5">
            <span class="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5">
              Urgência
            </span>
            <div class="grid grid-cols-4 gap-1.5">
              <button
                v-for="p in priorities"
                :key="p.id"
                type="button"
                class="min-h-[44px] rounded-xl border px-2 py-1.5 text-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
                :class="
                  form.priority === p.id
                    ? 'border-brand bg-brand/10 text-brand-text-light dark:text-brand-text-dark'
                    : 'border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 text-slate-700 dark:text-slate-300'
                "
                @click="form.priority = p.id"
              >
                <span class="block text-xs font-bold leading-tight">{{ p.label }}</span>
                <span class="block text-[10px] opacity-75">{{ p.sla }}</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Category Cards -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button
            v-for="cat in categories"
            :key="cat.id"
            type="button"
            class="text-left rounded-xl border p-2.5 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
            :class="
              form.category === cat.id
                ? 'border-brand bg-brand/10 ring-1 ring-brand-ring'
                : 'border-slate-200 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900 hover:bg-white dark:hover:bg-zinc-800'
            "
            @click="form.category = cat.id"
          >
            <div class="flex items-center gap-1.5 font-semibold text-xs text-slate-900 dark:text-[#fafafa]">
              <PortalIcon :name="cat.icon" :size="14" class="text-brand-text-light dark:text-brand-text-dark" />
              {{ cat.label }}
            </div>
            <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-1">
              {{ cat.desc }}
            </p>
          </button>
        </div>

        <!-- Description + Photos Dropzone side-by-side -->
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div class="lg:col-span-7">
            <label
              for="ticket-desc"
              class="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5"
            >
              Detalhes rápidos do problema
            </label>
            <textarea
              id="ticket-desc"
              ref="descriptionInputRef"
              v-model="form.description"
              rows="4"
              maxlength="2500"
              :aria-invalid="Boolean(fieldErrors.description)"
              :aria-describedby="fieldErrors.description ? 'ticket-desc-error' : undefined"
              placeholder="Conte brevemente o que aparece na tela (você também pode colar um print direto aqui com Ctrl+V)..."
              class="w-full rounded-xl border bg-slate-50/70 dark:bg-zinc-900 text-slate-900 dark:text-[#fafafa] placeholder:text-slate-500 dark:placeholder:text-slate-400 px-3.5 py-2.5 text-sm focus:bg-white dark:focus:bg-zinc-900 focus:border-brand-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
              :class="
                fieldErrors.description
                  ? 'border-rose-600 dark:border-rose-400'
                  : 'border-slate-300 dark:border-zinc-700'
              "
              @input="fieldErrors.description = ''"
            ></textarea>
            <p
              v-if="fieldErrors.description"
              id="ticket-desc-error"
              role="alert"
              class="mt-1 text-xs font-medium text-rose-700 dark:text-rose-300"
            >
              {{ fieldErrors.description }}
            </p>
          </div>

          <!-- Attachments Dropzone -->
          <div class="lg:col-span-5">
            <span class="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5">
              Fotos / Prints do Erro (até {{ MAX_TICKET_ATTACHMENTS }})
            </span>

            <input
              ref="formFileInputRef"
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp,image/gif"
              class="sr-only"
              @change="handleFormFileChange"
            />
            <input
              ref="formCameraInputRef"
              type="file"
              accept="image/*"
              capture="environment"
              class="sr-only"
              @change="handleFormFileChange"
            />

            <div
              class="rounded-xl border-2 border-dashed p-3 transition-colors min-h-[108px] flex flex-col justify-between gap-2.5"
              :class="
                formDropActive
                  ? 'border-brand bg-brand/10'
                  : 'border-slate-300 dark:border-zinc-700 bg-slate-50/70 dark:bg-zinc-900/70'
              "
            >
              <div class="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  :disabled="processingFormFiles || formAttachments.length >= MAX_TICKET_ATTACHMENTS"
                  class="min-h-[38px] inline-flex items-center gap-1.5 rounded-lg bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-zinc-700 disabled:opacity-50 cursor-pointer"
                  @click="formFileInputRef?.click()"
                >
                  <PortalIcon name="paperclip" :size="14" />
                  <span>Anexar print / foto</span>
                </button>
                <button
                  type="button"
                  :disabled="processingFormFiles || formAttachments.length >= MAX_TICKET_ATTACHMENTS"
                  class="min-h-[38px] inline-flex items-center gap-1.5 rounded-lg bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-zinc-700 disabled:opacity-50 cursor-pointer"
                  @click="formCameraInputRef?.click()"
                >
                  <PortalIcon name="camera" :size="14" />
                  <span>Câmera</span>
                </button>
                <span class="text-[11px] text-slate-500 dark:text-slate-400">
                  ou Ctrl+V / arraste aqui
                </span>
              </div>

              <!-- Previews -->
              <div v-if="formAttachments.length > 0" class="grid grid-cols-4 gap-2">
                <div
                  v-for="att in formAttachments"
                  :key="att.id"
                  class="relative group rounded-lg overflow-hidden border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 aspect-square"
                >
                  <button
                    type="button"
                    class="w-full h-full cursor-zoom-in block"
                    :title="`Ampliar ${att.name}`"
                    @click="lightboxItem = att"
                  >
                    <img
                      :src="att.dataUrl"
                      :alt="att.name"
                      class="w-full h-full object-cover"
                    />
                  </button>
                  <button
                    type="button"
                    aria-label="Remover imagem"
                    class="absolute top-1 right-1 w-6 h-6 rounded-full bg-slate-900/80 text-white flex items-center justify-center hover:bg-rose-600 transition-colors cursor-pointer"
                    @click="removeFormAttachment(att.id)"
                  >
                    <PortalIcon name="x" :size="12" />
                  </button>
                </div>
              </div>
              <p v-else class="text-xs text-slate-500 dark:text-slate-400">
                Enviar um print ajuda a TI a resolver sem precisar ligar ou chamar no WhatsApp.
              </p>
            </div>
          </div>
        </div>

        <div
          v-if="errorMsg"
          role="alert"
          class="rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 p-3 text-xs font-medium text-rose-800 dark:text-rose-200 flex items-center gap-2"
        >
          <PortalIcon name="alert-triangle" :size="16" class="shrink-0" />
          <span>{{ errorMsg }}</span>
        </div>

        <div class="flex flex-wrap items-center justify-end gap-2 pt-1">
          <button
            v-if="tickets.length > 0"
            type="button"
            class="min-h-[44px] rounded-xl border border-slate-300 dark:border-zinc-700 px-4 py-2 text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-zinc-800 cursor-pointer"
            @click="showComposer = false"
          >
            Voltar às conversas
          </button>
          <button
            type="submit"
            :disabled="submitting || processingFormFiles"
            class="min-h-[44px] bg-brand hover:bg-brand-hover active:scale-[0.98] disabled:opacity-60 text-brand-fg font-bold text-sm py-2.5 px-6 rounded-xl shadow-sm transition-all inline-flex items-center justify-center gap-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          >
            <PortalIcon name="send" :size="16" />
            <span>{{ submitting ? 'Abrindo chamado…' : 'Abrir Chamado e Iniciar Chat' }}</span>
          </button>
        </div>
      </form>
    </section>

    <!-- Error / Skeleton states -->
    <div
      v-if="error"
      role="alert"
      class="bg-white dark:bg-[#111113] rounded-2xl border border-rose-200 dark:border-rose-900 p-8 text-center"
    >
      <p class="text-sm font-semibold text-rose-800 dark:text-rose-200 mb-3">
        {{ error }}
      </p>
      <button
        type="button"
        class="min-h-[44px] inline-flex items-center gap-2 bg-brand hover:bg-brand-hover text-brand-fg font-semibold text-xs px-4 py-2.5 rounded-xl cursor-pointer"
        @click="emit('retry')"
      >
        <PortalIcon name="refresh-cw" :size="15" />
        Tentar novamente
      </button>
    </div>

    <div
      v-else-if="loading && tickets.length === 0"
      class="grid grid-cols-1 lg:grid-cols-12 gap-5"
    >
      <div class="lg:col-span-5 bg-white dark:bg-[#111113] rounded-2xl border border-slate-200 dark:border-zinc-800 p-5 space-y-3 animate-pulse">
        <div class="h-5 w-40 bg-slate-200 dark:bg-zinc-800 rounded"></div>
        <div class="h-20 bg-slate-100 dark:bg-zinc-800/70 rounded-xl"></div>
        <div class="h-20 bg-slate-100 dark:bg-zinc-800/70 rounded-xl"></div>
      </div>
      <div class="lg:col-span-7 bg-white dark:bg-[#111113] rounded-2xl border border-slate-200 dark:border-zinc-800 p-6 h-80 animate-pulse"></div>
    </div>

    <!-- WhatsApp-Style Split Master-Detail Conversations Workspace -->
    <div
      v-else-if="tickets.length > 0"
      class="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start"
    >
      <!-- LEFT: Conversations Queue -->
      <aside
        class="lg:col-span-5 bg-white dark:bg-[#111113] rounded-2xl border border-slate-200/90 dark:border-zinc-800 overflow-hidden"
        :class="mobileChatOpen ? 'hidden lg:block' : 'block'"
      >
        <div class="p-4 border-b border-slate-100 dark:border-zinc-800 space-y-3">
          <div class="flex items-center justify-between gap-2">
            <h3 class="text-sm font-bold text-slate-900 dark:text-[#fafafa]">
              Seus Chamados ({{ filteredTickets.length }})
            </h3>
            <div class="flex items-center gap-1 bg-slate-100 dark:bg-zinc-900 p-1 rounded-xl text-[11px] font-semibold">
              <button
                type="button"
                class="px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
                :class="statusFilter === 'all' ? 'bg-white dark:bg-zinc-800 text-slate-900 dark:text-white shadow-xs' : 'text-slate-600 dark:text-slate-400'"
                @click="statusFilter = 'all'"
              >
                Todos
              </button>
              <button
                type="button"
                class="px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
                :class="statusFilter === 'active' ? 'bg-white dark:bg-zinc-800 text-slate-900 dark:text-white shadow-xs' : 'text-slate-600 dark:text-slate-400'"
                @click="statusFilter = 'active'"
              >
                Em andamento
              </button>
              <button
                type="button"
                class="px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
                :class="statusFilter === 'done' ? 'bg-white dark:bg-zinc-800 text-slate-900 dark:text-white shadow-xs' : 'text-slate-600 dark:text-slate-400'"
                @click="statusFilter = 'done'"
              >
                Concluídos
              </button>
            </div>
          </div>

          <div class="relative">
            <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              <PortalIcon name="search" :size="15" />
            </span>
            <input
              v-model="searchQuery"
              type="search"
              placeholder="Buscar protocolo, assunto ou ativo…"
              class="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 text-slate-900 dark:text-[#fafafa] pl-9 pr-3 py-1.5 text-xs focus:border-brand-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
            />
          </div>
        </div>

        <div class="divide-y divide-slate-100 dark:divide-zinc-800 max-h-[640px] overflow-y-auto">
          <button
            v-for="tk in filteredTickets"
            :key="tk.id"
            type="button"
            class="w-full text-left p-4 transition-colors cursor-pointer hover:bg-slate-50 dark:hover:bg-zinc-900/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-ring"
            :class="
              selectedTicket?.id === tk.id
                ? 'bg-brand/8 dark:bg-brand/12 border-l-4 border-l-brand'
                : 'border-l-4 border-l-transparent'
            "
            @click="openDetails(tk, { openMobile: true })"
          >
            <div class="flex items-center justify-between gap-2 mb-1">
              <div class="flex items-center gap-1.5 min-w-0">
                <span class="font-mono text-[11px] font-bold text-slate-700 dark:text-slate-200">
                  {{ tk.protocol }}
                </span>
                <span
                  class="text-[10px] font-bold px-2 py-0.5 rounded-full border"
                  :class="(statusMap[tk.status] || statusMap.open).cls"
                >
                  {{ (statusMap[tk.status] || statusMap.open).label }}
                </span>
                <span
                  v-if="unreadMap[tk.id]"
                  class="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-brand text-brand-fg text-[10px] font-bold"
                >
                  +{{ unreadMap[tk.id] }}
                </span>
              </div>
              <span class="text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
                {{ formatTimeOnly(tk.last_message_at || tk.updated_at || tk.created_at) }}
              </span>
            </div>

            <p class="font-semibold text-sm text-slate-900 dark:text-[#fafafa] line-clamp-1">
              {{ tk.title }}
            </p>

            <p class="text-xs text-slate-600 dark:text-slate-300 mt-1 line-clamp-1">
              {{ tk.last_message_preview || tk.description }}
            </p>

            <div class="flex items-center justify-between gap-2 mt-2 text-[11px] text-slate-500 dark:text-slate-400">
              <div class="flex items-center gap-2">
                <span
                  class="font-semibold"
                  :class="(priorityMap[tk.priority] || priorityMap.medium).cls"
                >
                  {{ (priorityMap[tk.priority] || priorityMap.medium).label }}
                </span>
                <span v-if="tk.asset_tag" class="font-mono text-[10px] bg-slate-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
                  {{ tk.asset_tag }}
                </span>
              </div>
              <div class="flex items-center gap-2">
                <span v-if="Number(tk.attachments_count) > 0" class="inline-flex items-center gap-1">
                  <PortalIcon name="image" :size="12" />
                  {{ tk.attachments_count }}
                </span>
                <span class="inline-flex items-center gap-1">
                  <PortalIcon name="message-square" :size="12" />
                  {{ tk.comments_count || 0 }}
                </span>
              </div>
            </div>
          </button>

          <div v-if="filteredTickets.length === 0" class="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
            Nenhum chamado encontrado para esse filtro.
          </div>
        </div>
      </aside>

      <!-- RIGHT: Real-time WhatsApp-Style Chat Panel -->
      <div
        class="lg:col-span-7 bg-white dark:bg-[#111113] rounded-2xl border border-slate-200/90 dark:border-zinc-800 overflow-hidden flex flex-col min-h-[540px] max-h-[740px]"
        :class="mobileChatOpen ? 'flex' : 'hidden lg:flex'"
        @paste="handleChatPaste"
        @dragover.prevent="chatDropActive = true"
        @dragleave.prevent="chatDropActive = false"
        @drop.prevent="handleChatDrop"
      >
        <template v-if="selectedTicket">
          <!-- Chat Header -->
          <header class="p-4 border-b border-slate-200/80 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/50 space-y-3">
            <div class="flex items-start justify-between gap-3">
              <div class="flex items-start gap-2.5 min-w-0">
                <button
                  type="button"
                  aria-label="Voltar aos chamados"
                  class="lg:hidden min-h-[40px] min-w-[40px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 flex items-center justify-center text-slate-700 dark:text-slate-200 shrink-0 cursor-pointer"
                  @click="mobileChatOpen = false"
                >
                  <PortalIcon name="arrow-left" :size="16" />
                </button>
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span class="font-mono text-xs font-bold text-slate-800 dark:text-slate-200">
                      {{ selectedTicket.protocol }}
                    </span>
                    <span
                      class="text-[11px] font-bold px-2 py-0.5 rounded-full border"
                      :class="(statusMap[selectedTicket.status] || statusMap.open).cls"
                    >
                      {{ (statusMap[selectedTicket.status] || statusMap.open).label }}
                    </span>
                    <span
                      v-if="selectedTicket.asset_tag"
                      class="font-mono text-[11px] px-2 py-0.5 rounded bg-slate-200/70 dark:bg-zinc-800 text-slate-800 dark:text-slate-200"
                    >
                      {{ selectedTicket.asset_tag }}
                    </span>
                  </div>
                  <h3 class="text-sm sm:text-base font-bold text-slate-900 dark:text-[#fafafa] mt-1 truncate">
                    {{ selectedTicket.title }}
                  </h3>
                </div>
              </div>

              <div class="text-right shrink-0">
                <span class="inline-flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-300">
                  <PortalIcon name="clock" :size="12" />
                  SLA {{ formatDateShort(selectedTicket.sla_due_at) }}
                </span>
                <p v-if="selectedTicket.assigned_tech_name" class="text-[11px] font-semibold text-brand-text-light dark:text-brand-text-dark mt-0.5">
                  Técnico: {{ selectedTicket.assigned_tech_name }}
                </p>
              </div>
            </div>

            <!-- Compact N1/N2 Timeline -->
            <div class="grid grid-cols-3 gap-1.5 text-[11px] font-semibold">
              <div
                class="rounded-lg px-2.5 py-1.5 border flex items-center gap-1.5"
                :class="
                  getN1Step(selectedTicket.status) >= 1
                    ? 'bg-sky-50/90 border-sky-200 text-sky-900 dark:bg-sky-950/60 dark:border-sky-800 dark:text-sky-200'
                    : 'border-slate-200 text-slate-500'
                "
              >
                <PortalIcon name="check" :size="12" />
                <span>1. Aberto</span>
              </div>
              <div
                class="rounded-lg px-2.5 py-1.5 border flex items-center gap-1.5"
                :class="
                  getN1Step(selectedTicket.status) >= 2
                    ? 'bg-amber-50/90 border-amber-200 text-amber-900 dark:bg-amber-950/60 dark:border-amber-800 dark:text-amber-200'
                    : 'bg-white/60 dark:bg-zinc-900/40 border-slate-200 dark:border-zinc-800 text-slate-500 dark:text-slate-400'
                "
              >
                <PortalIcon :name="getN1Step(selectedTicket.status) >= 2 ? 'check' : 'clock'" :size="12" />
                <span>2. Em análise</span>
              </div>
              <div
                class="rounded-lg px-2.5 py-1.5 border flex items-center gap-1.5"
                :class="
                  getN1Step(selectedTicket.status) >= 3
                    ? 'bg-emerald-50/90 border-emerald-200 text-emerald-900 dark:bg-emerald-950/60 dark:border-emerald-800 dark:text-emerald-200'
                    : 'bg-white/60 dark:bg-zinc-900/40 border-slate-200 dark:border-zinc-800 text-slate-500 dark:text-slate-400'
                "
              >
                <PortalIcon :name="getN1Step(selectedTicket.status) >= 3 ? 'check-circle' : 'clock'" :size="12" />
                <span>3. Concluído</span>
              </div>
            </div>
          </header>

          <!-- Chat Thread Stream -->
          <div
            ref="threadRef"
            class="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/40 dark:bg-zinc-950/50 relative"
          >
            <!-- Drop Overlay -->
            <div
              v-if="chatDropActive"
              class="sticky top-0 z-20 rounded-xl border-2 border-dashed border-brand bg-brand/15 p-4 text-center text-xs font-bold text-brand-text-light dark:text-brand-text-dark"
            >
              Solte aqui as fotos ou prints para anexar nesta conversa
            </div>

            <!-- Ticket Initial Description & Attachments -->
            <article class="rounded-2xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-3.5 shadow-2xs space-y-2.5">
              <div class="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                <span class="font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                  Descrição inicial do chamado • {{ selectedTicket.category }}
                </span>
                <span>{{ formatDateShort(selectedTicket.created_at) }}</span>
              </div>
              <p class="text-xs sm:text-sm text-slate-800 dark:text-slate-100 whitespace-pre-wrap leading-relaxed">
                {{ selectedTicket.description }}
              </p>
              <div
                v-if="selectedTicket.attachments && selectedTicket.attachments.length > 0"
                class="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1"
              >
                <button
                  v-for="att in selectedTicket.attachments"
                  :key="att.id || att.name"
                  type="button"
                  class="group relative rounded-xl overflow-hidden border border-slate-200 dark:border-zinc-700 aspect-video bg-slate-100 dark:bg-zinc-800 cursor-zoom-in"
                  @click="lightboxItem = att"
                >
                  <img :src="att.dataUrl" :alt="att.name || 'Print do chamado'" class="w-full h-full object-cover" />
                  <span class="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-slate-900/75 text-white text-[10px] flex items-center gap-1 opacity-90 group-hover:opacity-100">
                    <PortalIcon name="zoom-in" :size="11" />
                    Ver
                  </span>
                </button>
              </div>
            </article>

            <!-- Resolution Notes -->
            <div
              v-if="selectedTicket.resolution_notes"
              class="rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 p-3.5 text-xs text-emerald-900 dark:text-emerald-200 space-y-1"
            >
              <p class="font-bold flex items-center gap-1.5">
                <PortalIcon name="check-circle" :size="15" />
                Parecer Final da TI
              </p>
              <p class="whitespace-pre-wrap leading-relaxed">{{ selectedTicket.resolution_notes }}</p>
            </div>

            <div v-if="loadingDetails" class="text-center py-4 text-xs text-slate-500 dark:text-slate-400">
              Sincronizando mensagens…
            </div>

            <!-- Chat Bubbles -->
            <div
              v-for="cm in selectedTicket.comments || []"
              :key="cm.id"
              class="flex"
              :class="isSupportStaffRole(cm.author_role) ? 'justify-start' : 'justify-end'"
            >
              <div
                class="max-w-[88%] sm:max-w-[78%] rounded-2xl px-3.5 py-2.5 border shadow-2xs space-y-2"
                :class="
                  isSupportStaffRole(cm.author_role)
                    ? 'bg-white dark:bg-zinc-900 border-slate-200 dark:border-zinc-700 text-slate-900 dark:text-slate-100 rounded-tl-sm'
                    : 'bg-brand/10 dark:bg-brand/18 border-brand/25 dark:border-brand/35 text-slate-900 dark:text-[#fafafa] rounded-tr-sm'
                "
              >
                <div class="flex items-center justify-between gap-3 text-[11px]">
                  <span class="font-bold inline-flex items-center gap-1.5">
                    <PortalIcon
                      v-if="isSupportStaffRole(cm.author_role)"
                      name="headphones"
                      :size="12"
                      class="text-brand-text-light dark:text-brand-text-dark"
                    />
                    {{ isSupportStaffRole(cm.author_role) ? `${cm.author_name} • Equipe TI` : 'Você' }}
                  </span>
                  <span class="opacity-70 shrink-0">{{ formatTimeOnly(cm.created_at) }}</span>
                </div>

                <p
                  v-if="cm.message"
                  class="text-xs sm:text-sm whitespace-pre-wrap break-words leading-relaxed"
                >
                  {{ cm.message }}
                </p>

                <div
                  v-if="cm.attachments && cm.attachments.length > 0"
                  class="grid gap-2"
                  :class="cm.attachments.length === 1 ? 'grid-cols-1' : 'grid-cols-2'"
                >
                  <button
                    v-for="att in cm.attachments"
                    :key="att.id || att.name"
                    type="button"
                    class="group relative rounded-xl overflow-hidden border border-slate-200 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-950 cursor-zoom-in block"
                    @click="lightboxItem = att"
                  >
                    <img
                      :src="att.dataUrl"
                      :alt="att.name || 'Imagem enviada no chat'"
                      class="max-h-56 w-full object-cover"
                    />
                    <span class="absolute bottom-1.5 right-1.5 px-2 py-0.5 rounded-md bg-slate-900/75 text-white text-[10px] font-semibold flex items-center gap-1">
                      <PortalIcon name="zoom-in" :size="11" />
                      {{ formatAttachmentBytes(att.sizeBytes) }}
                    </span>
                  </button>
                </div>
              </div>
            </div>

            <!-- Live Typing Indicator -->
            <div v-if="typingIndicator" class="flex justify-start">
              <div class="inline-flex items-center gap-2 rounded-2xl rounded-tl-sm bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 px-3.5 py-2 text-xs text-slate-600 dark:text-slate-300 shadow-2xs">
                <span class="inline-flex gap-1">
                  <span class="w-1.5 h-1.5 rounded-full bg-brand animate-bounce"></span>
                  <span class="w-1.5 h-1.5 rounded-full bg-brand animate-bounce [animation-delay:120ms]"></span>
                  <span class="w-1.5 h-1.5 rounded-full bg-brand animate-bounce [animation-delay:240ms]"></span>
                </span>
                <span>{{ typingIndicator.senderName }} está digitando…</span>
              </div>
            </div>

            <div
              v-if="!(selectedTicket.comments || []).length && !loadingDetails"
              class="text-center py-6 text-xs text-slate-500 dark:text-slate-400"
            >
              Canal aberto com a equipe de TI. Envie uma mensagem ou cole um print abaixo sem precisar sair para o WhatsApp.
            </div>
          </div>

          <!-- Chat Composer Footer -->
          <footer class="p-3.5 border-t border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] space-y-2.5">
            <div
              v-if="detailError"
              role="alert"
              class="rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 px-3 py-2 text-xs font-medium text-rose-800 dark:text-rose-200"
            >
              {{ detailError }}
            </div>

            <!-- Staged Image Strip -->
            <div v-if="chatAttachments.length > 0" class="flex flex-wrap gap-2">
              <div
                v-for="att in chatAttachments"
                :key="att.id"
                class="relative w-16 h-16 rounded-xl overflow-hidden border border-slate-200 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900"
              >
                <button
                  type="button"
                  class="w-full h-full cursor-zoom-in"
                  @click="lightboxItem = att"
                >
                  <img :src="att.dataUrl" :alt="att.name" class="w-full h-full object-cover" />
                </button>
                <button
                  type="button"
                  aria-label="Remover foto anexada"
                  class="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-slate-900/85 text-white flex items-center justify-center hover:bg-rose-600 cursor-pointer"
                  @click="removeChatAttachment(att.id)"
                >
                  <PortalIcon name="x" :size="11" />
                </button>
              </div>
            </div>

            <input
              ref="chatFileInputRef"
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp,image/gif"
              class="sr-only"
              @change="handleChatFileChange"
            />
            <input
              ref="chatCameraInputRef"
              type="file"
              accept="image/*"
              capture="environment"
              class="sr-only"
              @change="handleChatFileChange"
            />

            <form class="flex items-end gap-2" @submit.prevent="sendComment">
              <button
                type="button"
                aria-label="Anexar foto ou print"
                title="Anexar foto ou print (Ctrl+V também funciona)"
                :disabled="processingChatFiles || chatAttachments.length >= MAX_TICKET_ATTACHMENTS"
                class="min-h-[44px] min-w-[44px] rounded-xl border border-slate-300 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-zinc-800 flex items-center justify-center shrink-0 disabled:opacity-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
                @click="chatFileInputRef?.click()"
              >
                <PortalIcon name="paperclip" :size="18" />
              </button>

              <button
                type="button"
                aria-label="Tirar foto com câmera"
                title="Fotografar erro"
                :disabled="processingChatFiles || chatAttachments.length >= MAX_TICKET_ATTACHMENTS"
                class="min-h-[44px] min-w-[44px] rounded-xl border border-slate-300 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-zinc-800 flex items-center justify-center shrink-0 disabled:opacity-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring sm:hidden"
                @click="chatCameraInputRef?.click()"
              >
                <PortalIcon name="camera" :size="18" />
              </button>

              <div class="flex-1 min-w-0">
                <textarea
                  ref="chatInputRef"
                  v-model="newComment"
                  rows="1"
                  maxlength="2000"
                  placeholder="Digite sua mensagem ou cole um print (Ctrl+V)… Enter envia"
                  class="w-full min-h-[44px] max-h-28 resize-none rounded-xl border border-slate-300 dark:border-zinc-700 bg-slate-50/80 dark:bg-zinc-900 text-slate-900 dark:text-[#fafafa] placeholder:text-slate-500 dark:placeholder:text-slate-400 px-3.5 py-2.5 text-sm focus:bg-white dark:focus:bg-zinc-900 focus:border-brand-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
                  @input="handleChatTyping"
                  @keydown="handleChatKeydown"
                ></textarea>
              </div>

              <button
                type="submit"
                :disabled="sendingComment || processingChatFiles || (!newComment.trim() && chatAttachments.length === 0)"
                class="min-h-[44px] px-4 py-2.5 rounded-xl bg-brand hover:bg-brand-hover disabled:opacity-50 text-brand-fg font-bold text-xs sm:text-sm inline-flex items-center gap-1.5 shrink-0 cursor-pointer transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
              >
                <PortalIcon name="send" :size="16" />
                <span class="hidden sm:inline">{{ sendingComment ? 'Enviando…' : 'Enviar' }}</span>
              </button>
            </form>
          </footer>
        </template>

        <div
          v-else
          class="flex-1 flex flex-col items-center justify-center text-center p-8 text-slate-500 dark:text-slate-400"
        >
          <PortalIcon name="message-square" :size="36" class="mb-3 opacity-50" />
          <p class="text-sm font-semibold text-slate-800 dark:text-slate-200">
            Selecione um chamado ao lado
          </p>
          <p class="text-xs mt-1 max-w-xs">
            Acompanhe respostas da TI em tempo real e troque fotos e capturas de tela por aqui mesmo.
          </p>
        </div>
      </div>
    </div>

    <!-- Image Lightbox Modal -->
    <div
      v-if="lightboxItem"
      role="dialog"
      aria-modal="true"
      aria-label="Visualização ampliada da imagem"
      class="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-xs flex items-center justify-center p-4"
      @click.self="lightboxItem = null"
    >
      <div class="relative max-w-4xl w-full bg-zinc-900 border border-zinc-700 rounded-2xl overflow-hidden shadow-2xl">
        <div class="flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-800 text-white">
          <div class="min-w-0">
            <p class="text-xs sm:text-sm font-semibold truncate">{{ lightboxItem.name || 'Evidência anexada' }}</p>
            <p class="text-[11px] text-zinc-400">{{ formatAttachmentBytes(lightboxItem.sizeBytes) }}</p>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <a
              :href="lightboxItem.dataUrl"
              :download="lightboxItem.name || 'evidencia.jpg'"
              class="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 text-xs font-semibold text-white"
            >
              <PortalIcon name="download" :size="14" />
              Baixar
            </a>
            <button
              type="button"
              aria-label="Fechar visualização"
              class="min-h-[40px] min-w-[40px] rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white flex items-center justify-center cursor-pointer"
              @click="lightboxItem = null"
            >
              <PortalIcon name="x" :size="16" />
            </button>
          </div>
        </div>
        <div class="bg-black flex items-center justify-center p-3 max-h-[82vh] overflow-auto">
          <img
            :src="lightboxItem.dataUrl"
            :alt="lightboxItem.name || 'Evidência ampliada'"
            class="max-h-[76vh] w-auto rounded-lg object-contain"
          />
        </div>
      </div>
    </div>
  </section>
</template>
