<script setup>
import { nextTick, reactive, ref, watch } from 'vue';
import { portalApi } from '../services/nexusApi';
import PortalIcon from './PortalIcon.vue';

const props = defineProps({
  tickets: { type: Array, required: true },
  assets: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  userDepartment: { type: String, default: 'Geral' },
  preselectedAssetTag: { type: String, default: '' },
});

const emit = defineEmits(['created', 'clear-preselected', 'retry']);

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

const titleInputRef = ref(null);
const descriptionInputRef = ref(null);
const threadRef = ref(null);

const categories = [
  {
    id: 'Hardware & Periféricos',
    label: 'Hardware',
    desc: 'Tela, teclado, bateria, mouse ou fonte',
    icon: 'laptop',
  },
  {
    id: 'Conectividade & VPN',
    label: 'Rede e VPN',
    desc: 'Lentidão, Wi-Fi, VPN corporativa e portas',
    icon: 'globe',
  },
  {
    id: 'Sistemas & Softwares',
    label: 'Sistemas e ERP',
    desc: 'Licenças, Windows, e-mail e acessos',
    icon: 'settings',
  },
  {
    id: 'Substituição / Upgrade',
    label: 'Substituição',
    desc: 'Upgrade de memória, disco ou troca',
    icon: 'repeat',
  },
];

const priorities = [
  { id: 'low', label: 'Baixa', sla: 'SLA 48h' },
  { id: 'medium', label: 'Normal', sla: 'SLA 24h' },
  { id: 'high', label: 'Alta', sla: 'SLA 8h' },
  { id: 'critical', label: 'Crítica', sla: 'SLA 4h' },
];

watch(
  () => props.preselectedAssetTag,
  (val) => {
    if (val) {
      form.assetTag = val;
      emit('clear-preselected');
    }
  },
  { immediate: true },
);

const submitting = ref(false);
const sendingComment = ref(false);
const loadingDetails = ref(false);
const feedback = ref('');
const errorMsg = ref('');
const detailError = ref('');
const selectedTicket = ref(null);
const newComment = ref('');

let latestDetailRequestId = 0;

function formatSla(iso) {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return String(iso);
  return dt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function validateForm() {
  fieldErrors.title = '';
  fieldErrors.description = '';

  const titleTrimmed = form.title.trim();
  const descTrimmed = form.description.trim();

  if (titleTrimmed.length < 4) {
    fieldErrors.title = 'Informe um assunto com pelo menos 4 caracteres.';
  }
  if (descTrimmed.length < 6) {
    fieldErrors.description = 'Descreva o problema com pelo menos 6 caracteres.';
  }

  if (fieldErrors.title) {
    titleInputRef.value?.focus();
    return false;
  }
  if (fieldErrors.description) {
    descriptionInputRef.value?.focus();
    return false;
  }
  return true;
}

async function submitTicket() {
  feedback.value = '';
  errorMsg.value = '';
  if (!validateForm()) return;

  submitting.value = true;
  try {
    const matchedAsset = props.assets.find(
      (a) => (a.internal_id || a.internalId) === form.assetTag,
    );
    const created = await portalApi.createTicket({
      title: form.title.trim(),
      description: form.description.trim(),
      category: form.category,
      priority: form.priority,
      department: props.userDepartment || 'Corporativo',
      assetId: matchedAsset ? matchedAsset.id || null : null,
      assetTag: form.assetTag || null,
    });
    form.title = '';
    form.description = '';
    feedback.value = `Protocolo ${created.protocol} registrado com sucesso. Nossa equipe técnica N1/N2 já foi acionada.`;
    emit('created');
  } catch (err) {
    errorMsg.value = err.message || 'Não foi possível registrar o chamado.';
  } finally {
    submitting.value = false;
  }
}

async function openDetails(ticketId) {
  const reqId = ++latestDetailRequestId;
  detailError.value = '';
  loadingDetails.value = true;
  try {
    const detail = await portalApi.getTicketDetail(ticketId);
    if (reqId !== latestDetailRequestId) return;
    selectedTicket.value = detail;
    await nextTick();
    threadRef.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    if (reqId !== latestDetailRequestId) return;
    detailError.value = err.message || 'Falha ao carregar histórico do chamado.';
  } finally {
    if (reqId === latestDetailRequestId) {
      loadingDetails.value = false;
    }
  }
}

watch(
  () => props.tickets,
  async () => {
    const activeId = selectedTicket.value?.id;
    if (!activeId) return;
    const reqId = ++latestDetailRequestId;
    try {
      const detail = await portalApi.getTicketDetail(activeId);
      if (reqId === latestDetailRequestId && selectedTicket.value?.id === activeId) {
        selectedTicket.value = detail;
      }
    } catch {
      // silencioso no refresh em background
    }
  },
);

async function sendComment() {
  if (!selectedTicket.value || !newComment.value.trim() || sendingComment.value) return;
  const targetId = selectedTicket.value.id;
  sendingComment.value = true;
  detailError.value = '';
  try {
    await portalApi.addTicketComment(targetId, newComment.value.trim());
    newComment.value = '';
    const reqId = ++latestDetailRequestId;
    const updated = await portalApi.getTicketDetail(targetId);
    if (reqId === latestDetailRequestId) {
      selectedTicket.value = updated;
    }
    emit('created');
  } catch (err) {
    detailError.value = err.message || 'Falha ao enviar comentário.';
  } finally {
    sendingComment.value = false;
  }
}

const statusLabel = {
  open: 'Aberto',
  in_progress: 'Em atendimento',
  resolved: 'Resolvido',
  closed: 'Encerrado',
};

const priorityLabel = {
  low: 'Baixa',
  medium: 'Normal',
  high: 'Alta',
  critical: 'Crítica',
};
</script>

<template>
  <section class="grid gap-6 lg:grid-cols-12">
    <!-- Left Column: Create Ticket Form -->
    <div class="lg:col-span-5 space-y-4 min-w-0">
      <div class="border-b border-slate-200 dark:border-zinc-800 pb-3">
        <h2 class="text-xl font-bold tracking-tight text-slate-900 dark:text-[#fafafa]">
          Abertura de chamado técnico
        </h2>
        <p class="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mt-0.5">
          Autoatendimento prioritário para suporte a hardware, softwares, acessos ou rede.
        </p>
      </div>

      <form class="station-panel p-5 sm:p-6 space-y-5" novalidate @submit.prevent="submitTicket">
        <!-- Interactive Category Cards (Phrasing content only inside button) -->
        <fieldset>
          <legend class="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2">
            Categoria do incidente
          </legend>
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="cat in categories"
              :key="cat.id"
              type="button"
              :aria-pressed="form.category === cat.id"
              class="min-h-[44px] p-3 rounded-xl border text-left active:scale-[0.98] transition-colors cursor-pointer flex flex-col justify-between gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
              :class="
                form.category === cat.id
                  ? 'bg-brand/10 border-brand-ring ring-1 ring-brand-ring/40 shadow-sm'
                  : 'bg-slate-50 dark:bg-zinc-900 border-slate-200 dark:border-zinc-700 text-slate-700 dark:text-slate-200 hover:border-slate-300 dark:hover:border-zinc-600'
              "
              @click="form.category = cat.id"
            >
              <span class="flex items-center justify-between w-full">
                <PortalIcon
                  :name="cat.icon"
                  :size="18"
                  :class="
                    form.category === cat.id
                      ? 'text-brand-text-light dark:text-brand-text-dark'
                      : 'text-slate-600 dark:text-slate-300'
                  "
                />
                <span v-if="form.category === cat.id" class="w-2 h-2 rounded-full bg-brand" />
              </span>
              <span class="block min-w-0 w-full">
                <span class="block text-xs font-semibold leading-tight text-slate-900 dark:text-[#fafafa]">
                  {{ cat.label }}
                </span>
                <span class="block text-xs text-slate-600 dark:text-slate-300 line-clamp-1 mt-0.5">
                  {{ cat.desc }}
                </span>
              </span>
            </button>
          </div>
        </fieldset>

        <!-- Priority / SLA Pills -->
        <fieldset>
          <legend class="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2">
            Prioridade e SLA estimado
          </legend>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button
              v-for="p in priorities"
              :key="p.id"
              type="button"
              :aria-pressed="form.priority === p.id"
              class="min-h-[44px] py-2 px-2.5 rounded-xl border text-center active:scale-[0.98] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
              :class="
                form.priority === p.id
                  ? 'bg-slate-900 dark:bg-[#fafafa] text-white dark:text-[#09090b] font-semibold border-slate-900 dark:border-[#fafafa] shadow-sm'
                  : 'bg-slate-50 dark:bg-zinc-900 border-slate-200 dark:border-zinc-700 text-slate-700 dark:text-slate-200 hover:border-slate-300 dark:hover:border-zinc-600'
              "
              @click="form.priority = p.id"
            >
              <span class="block text-xs font-semibold">{{ p.label }}</span>
              <span class="block text-xs opacity-90 mt-0.5 tabular-nums">{{ p.sla }}</span>
            </button>
          </div>
        </fieldset>

        <!-- Equipment Picker -->
        <div>
          <label
            for="ticket-asset-tag"
            class="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5"
          >
            Equipamento relacionado (opcional)
          </label>
          <select
            id="ticket-asset-tag"
            v-model="form.assetTag"
            name="assetTag"
            class="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-900 dark:text-[#fafafa] px-3.5 py-2 text-xs font-mono focus:border-brand-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring transition-colors cursor-pointer"
          >
            <option value="">Sem vínculo com ativo específico</option>
            <option
              v-for="a in assets"
              :key="a.id || a.internal_id || a.internalId"
              :value="a.internal_id || a.internalId"
            >
              {{ a.internal_id || a.internalId }} — {{ a.brand }} {{ a.model }}
            </option>
          </select>
        </div>

        <!-- Title Field -->
        <div>
          <label
            for="ticket-title"
            class="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5"
          >
            Resumo do problema (assunto)
          </label>
          <input
            id="ticket-title"
            ref="titleInputRef"
            v-model="form.title"
            name="title"
            type="text"
            required
            minlength="4"
            :aria-invalid="Boolean(fieldErrors.title)"
            :aria-describedby="fieldErrors.title ? 'ticket-title-error' : undefined"
            placeholder="Ex.: Lentidão na VPN ou falha ao iniciar sistema…"
            class="w-full min-h-[44px] rounded-xl border bg-white dark:bg-zinc-900 text-slate-900 dark:text-[#fafafa] placeholder-slate-500 dark:placeholder-slate-400 px-3.5 py-2.5 text-sm focus:border-brand-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring transition-colors"
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
            class="mt-1.5 text-xs font-medium text-rose-700 dark:text-rose-300"
          >
            {{ fieldErrors.title }}
          </p>
        </div>

        <!-- Description Field -->
        <div>
          <label
            for="ticket-description"
            class="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5"
          >
            Descrição detalhada do sintoma
          </label>
          <textarea
            id="ticket-description"
            ref="descriptionInputRef"
            v-model="form.description"
            name="description"
            rows="3"
            required
            minlength="6"
            :aria-invalid="Boolean(fieldErrors.description)"
            :aria-describedby="fieldErrors.description ? 'ticket-description-error' : undefined"
            placeholder="Descreva quando o problema ocorre, mensagens de erro exibidas e tentativas de solução…"
            class="w-full min-h-[88px] rounded-xl border bg-white dark:bg-zinc-900 text-slate-900 dark:text-[#fafafa] placeholder-slate-500 dark:placeholder-slate-400 px-3.5 py-2.5 text-sm focus:border-brand-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring transition-colors"
            :class="
              fieldErrors.description
                ? 'border-rose-600 dark:border-rose-400'
                : 'border-slate-300 dark:border-zinc-700'
            "
            @input="fieldErrors.description = ''"
          />
          <p
            v-if="fieldErrors.description"
            id="ticket-description-error"
            role="alert"
            class="mt-1.5 text-xs font-medium text-rose-700 dark:text-rose-300"
          >
            {{ fieldErrors.description }}
          </p>
        </div>

        <!-- Submit Button -->
        <button
          type="submit"
          :disabled="submitting"
          class="w-full min-h-[44px] py-3 px-4 rounded-xl bg-brand hover:bg-brand-dark border border-black/10 dark:border-white/15 active:scale-[0.98] text-brand-fg text-xs sm:text-sm font-semibold transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
        >
          <span
            v-if="submitting"
            class="w-4 h-4 border-2 border-brand-fg border-t-transparent rounded-full animate-spin"
            aria-hidden="true"
          />
          <span>{{ submitting ? 'Registrando protocolo…' : 'Registrar chamado técnico' }}</span>
        </button>

        <!-- Feedback & Errors -->
        <p
          v-if="feedback"
          role="status"
          aria-live="polite"
          class="text-xs font-medium text-emerald-800 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 rounded-xl p-3.5 break-words"
        >
          {{ feedback }}
        </p>

        <p
          v-if="errorMsg"
          role="alert"
          aria-live="polite"
          class="text-xs font-medium text-rose-800 dark:text-rose-200 bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 rounded-xl p-3.5 break-words"
        >
          {{ errorMsg }}
        </p>
      </form>
    </div>

    <!-- Right Column: Tickets History & Interactive Chat -->
    <div class="lg:col-span-7 space-y-4 min-w-0">
      <div
        class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-zinc-800 pb-3"
      >
        <div class="min-w-0">
          <h2 class="text-xl font-bold tracking-tight text-slate-900 dark:text-[#fafafa]">
            Histórico e resolução N1/N2
          </h2>
          <p class="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mt-0.5">
            Acompanhe a linha do tempo técnica e converse diretamente com os analistas de TI.
          </p>
        </div>
        <span
          class="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-900 dark:bg-zinc-900 text-[#fafafa] text-xs font-mono font-semibold shadow-sm border border-slate-800 dark:border-zinc-700 shrink-0"
        >
          <span class="tabular-nums">{{ tickets.length }}</span>
          <span class="text-slate-200 font-sans font-normal">
            {{ tickets.length === 1 ? 'protocolo' : 'protocolos' }}
          </span>
        </span>
      </div>

      <!-- Load Error State -->
      <div
        v-if="error && !loading && tickets.length === 0"
        role="alert"
        class="station-panel p-8 text-center space-y-4 border-rose-500/30"
      >
        <div
          class="w-12 h-12 rounded-2xl bg-rose-500/10 text-rose-700 dark:text-rose-300 mx-auto flex items-center justify-center"
        >
          <PortalIcon name="alert-triangle" :size="24" />
        </div>
        <div class="max-w-md mx-auto space-y-1">
          <h3 class="text-base font-bold text-slate-900 dark:text-[#fafafa]">
            Falha ao carregar chamados
          </h3>
          <p class="text-xs text-slate-600 dark:text-slate-300 break-words">{{ error }}</p>
        </div>
        <button
          type="button"
          class="min-h-[44px] px-4 py-2 rounded-xl bg-brand hover:bg-brand-dark border border-black/10 dark:border-white/15 active:scale-[0.98] text-brand-fg text-xs font-semibold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          @click="emit('retry')"
        >
          Tentar novamente
        </button>
      </div>

      <!-- Loading Skeleton -->
      <div
        v-else-if="loading && tickets.length === 0"
        role="status"
        aria-label="Carregando histórico de chamados"
        class="space-y-4"
      >
        <div v-for="n in 2" :key="n" class="station-panel p-5 space-y-3">
          <div class="flex items-center justify-between">
            <div class="w-28 h-6 rounded-lg bg-slate-200 dark:bg-zinc-800 animate-pulse" />
            <div class="w-24 h-6 rounded-full bg-slate-200 dark:bg-zinc-800 animate-pulse" />
          </div>
          <div class="w-2/3 h-5 rounded bg-slate-200 dark:bg-zinc-800 animate-pulse" />
          <div class="h-16 rounded-xl bg-slate-100 dark:bg-zinc-900 animate-pulse" />
          <span class="sr-only">Carregando chamados técnicos…</span>
        </div>
      </div>

      <!-- Empty State -->
      <div v-else-if="tickets.length === 0" class="station-panel p-12 text-center space-y-3">
        <div
          class="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-slate-300 mx-auto flex items-center justify-center"
        >
          <PortalIcon name="headphones" :size="24" />
        </div>
        <div>
          <h3 class="text-base font-bold text-slate-900 dark:text-[#fafafa]">
            Nenhum chamado aberto
          </h3>
          <p class="text-xs text-slate-600 dark:text-slate-300 max-w-sm mx-auto mt-1 leading-relaxed">
            Você não possui tickets de suporte em andamento. Caso necessite de apoio técnico ou
            substituição de hardware, utilize o formulário ao lado.
          </p>
        </div>
      </div>

      <!-- Tickets List -->
      <ul v-else class="space-y-4">
        <li v-for="tk in tickets" :key="tk.id">
          <button
            type="button"
            :aria-expanded="selectedTicket?.id === tk.id"
            class="w-full text-left station-panel station-panel-hover p-5 space-y-4 active:scale-[0.99] cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring min-w-0"
            :class="
              selectedTicket?.id === tk.id
                ? 'border-brand-ring ring-1 ring-brand-ring/30'
                : ''
            "
            @click="openDetails(tk.id)"
          >
            <!-- Header Bar -->
            <span
              class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-zinc-800 pb-3"
            >
              <span class="flex flex-wrap items-center gap-2 min-w-0">
                <span
                  class="font-mono text-xs font-bold px-2.5 py-1 rounded-lg bg-slate-900 dark:bg-zinc-800 text-[#fafafa] shadow-sm border border-slate-700 dark:border-zinc-700"
                >
                  {{ tk.protocol }}
                </span>
                <span
                  v-if="tk.asset_tag"
                  class="font-mono text-xs font-semibold px-2 py-0.5 rounded-lg bg-brand/10 text-brand-text-light dark:text-brand-text-dark border border-brand-ring/30"
                >
                  {{ tk.asset_tag }}
                </span>
                <span
                  class="text-xs font-semibold px-2.5 py-0.5 rounded-full border"
                  :class="{
                    'bg-slate-500/10 text-slate-700 dark:text-slate-200 border-slate-500/25':
                      tk.priority === 'low' || tk.priority === 'medium',
                    'bg-orange-500/10 text-orange-800 dark:text-orange-300 border-orange-500/25':
                      tk.priority === 'high',
                    'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/25':
                      tk.priority === 'critical',
                  }"
                >
                  {{ priorityLabel[tk.priority] || tk.priority }}
                </span>
              </span>

              <span
                class="text-xs font-semibold px-2.5 py-0.5 rounded-full border shadow-sm"
                :class="{
                  'bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/25':
                    tk.status === 'open',
                  'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/25':
                    tk.status === 'in_progress',
                  'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25':
                    tk.status === 'resolved' || tk.status === 'closed',
                }"
              >
                {{ statusLabel[tk.status] || tk.status }}
              </span>
            </span>

            <!-- Title & Description -->
            <span class="block min-w-0">
              <span
                class="block text-sm sm:text-base font-bold text-slate-900 dark:text-[#fafafa] group-hover:text-brand-text-light dark:group-hover:text-brand-text-dark transition-colors break-words"
              >
                {{ tk.title }}
              </span>
              <span
                class="block text-xs text-slate-600 dark:text-slate-300 line-clamp-2 mt-1 leading-relaxed break-words"
              >
                {{ tk.description }}
              </span>
            </span>

            <!-- Resolution Timeline (N1 / N2) -->
            <span
              class="block p-3.5 rounded-2xl bg-slate-50 dark:bg-zinc-900/80 border border-slate-200/80 dark:border-zinc-800 space-y-2"
            >
              <span class="text-xs font-semibold text-slate-600 dark:text-slate-300 block">
                Linha de atendimento técnico
              </span>
              <span class="grid grid-cols-1 sm:grid-cols-3 gap-2 text-center text-xs">
                <!-- Etapa 1: Triagem N1 -->
                <span
                  class="block p-2 rounded-xl border min-w-0"
                  :class="
                    tk.status !== 'open'
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-200'
                      : 'bg-brand/10 border-brand-ring/40 text-brand-text-light dark:text-brand-text-dark'
                  "
                >
                  <span class="block font-semibold text-xs">N1: Triagem</span>
                  <span class="block text-xs mt-0.5">
                    {{ tk.status !== 'open' ? 'Concluída' : 'Em análise' }}
                  </span>
                </span>

                <!-- Etapa 2: Especialista N2 -->
                <span
                  class="block p-2 rounded-xl border min-w-0"
                  :class="
                    tk.status === 'resolved' || tk.status === 'closed'
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-200'
                      : tk.status === 'in_progress'
                        ? 'bg-sky-500/10 border-sky-500/30 text-sky-800 dark:text-sky-200 font-semibold'
                        : 'bg-slate-100 dark:bg-zinc-800 border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-slate-300'
                  "
                >
                  <span class="block font-semibold text-xs">N2: Especialista</span>
                  <span class="block text-xs mt-0.5 truncate">
                    {{ tk.assigned_tech_name || 'Aguardando fila' }}
                  </span>
                </span>

                <!-- Etapa 3: Parecer Técnico -->
                <span
                  class="block p-2 rounded-xl border min-w-0"
                  :class="
                    tk.status === 'resolved' || tk.status === 'closed'
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-200'
                      : 'bg-slate-100 dark:bg-zinc-800 border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-slate-300'
                  "
                >
                  <span class="block font-semibold text-xs">Conclusão</span>
                  <span class="block text-xs mt-0.5">
                    {{ tk.status === 'resolved' || tk.status === 'closed' ? 'Resolvido' : 'Pendente' }}
                  </span>
                </span>
              </span>
            </span>

            <!-- Footer Info -->
            <span
              class="pt-2 border-t border-slate-100 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-300 font-sans"
            >
              <span>
                Prazo SLA:
                <strong class="text-slate-900 dark:text-[#fafafa] font-mono tabular-nums">
                  {{ formatSla(tk.sla_due_at) }}
                </strong>
              </span>
              <span
                class="inline-flex items-center gap-2 font-semibold text-brand-text-light dark:text-brand-text-dark"
              >
                <PortalIcon name="message-square" :size="15" />
                <span class="tabular-nums">
                  {{ tk.comments_count || 0 }}
                  {{ (tk.comments_count || 0) === 1 ? 'mensagem registrada' : 'mensagens registradas' }}
                </span>
                <PortalIcon name="chevron-right" :size="15" />
              </span>
            </span>

            <!-- Parecer Conclusivo se houver -->
            <span
              v-if="tk.resolution_notes"
              class="block p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 text-xs text-emerald-950 dark:text-emerald-200 space-y-1 min-w-0"
            >
              <span class="block font-semibold text-xs text-emerald-800 dark:text-emerald-300">
                Parecer conclusivo da TI:
              </span>
              <span class="block leading-relaxed break-words">{{ tk.resolution_notes }}</span>
            </span>
          </button>
        </li>
      </ul>

      <!-- Contextual Detail Loading Indicator -->
      <div
        v-if="loadingDetails"
        role="status"
        aria-live="polite"
        class="station-panel p-4 text-xs font-medium text-slate-700 dark:text-slate-200 flex items-center gap-2.5"
      >
        <span
          class="w-4 h-4 border-2 border-brand-ring border-t-transparent rounded-full animate-spin shrink-0"
          aria-hidden="true"
        />
        <span>Carregando histórico técnico do chamado…</span>
      </div>

      <!-- Contextual Detail / Comment Error Alert -->
      <div
        v-if="detailError"
        role="alert"
        aria-live="polite"
        class="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-xs font-medium text-rose-800 dark:text-rose-200 flex items-center justify-between gap-3"
      >
        <div class="flex items-center gap-2 min-w-0">
          <PortalIcon name="alert-triangle" :size="16" class="text-rose-700 dark:text-rose-300" />
          <span class="break-words">{{ detailError }}</span>
        </div>
        <button
          type="button"
          class="icon-btn min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-rose-700 dark:text-rose-300 hover:bg-rose-500/15 active:scale-95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          aria-label="Fechar alerta"
          @click="detailError = ''"
        >
          <PortalIcon name="x" :size="16" />
        </button>
      </div>

      <!-- Selected Ticket Live Conversation Thread -->
      <div
        v-if="selectedTicket"
        ref="threadRef"
        class="station-panel p-5 sm:p-6 space-y-4 border-brand-ring/60 shadow-lg animate-fade-in"
      >
        <div
          class="flex items-center justify-between gap-3 border-b border-slate-200 dark:border-zinc-800 pb-3"
        >
          <div class="flex items-center gap-2.5 min-w-0">
            <span class="w-2.5 h-2.5 rounded-full bg-brand shrink-0" />
            <h3 class="text-sm font-bold text-slate-900 dark:text-[#fafafa] truncate">
              Diálogo técnico com TI • Protocolo {{ selectedTicket.protocol }}
            </h3>
          </div>
          <button
            type="button"
            class="min-h-[44px] px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-zinc-800 active:scale-[0.98] rounded-xl inline-flex items-center gap-1.5 cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
            @click="selectedTicket = null"
          >
            <PortalIcon name="x" :size="16" />
            <span>Fechar</span>
          </button>
        </div>

        <div class="space-y-3 max-h-64 overflow-y-auto pr-1 overscroll-contain">
          <div
            v-if="!selectedTicket.comments || selectedTicket.comments.length === 0"
            class="text-xs text-slate-600 dark:text-slate-300 italic py-4 text-center"
          >
            Nenhuma mensagem técnica registrada neste protocolo ainda. Envie uma mensagem abaixo.
          </div>
          <div
            v-for="cm in selectedTicket.comments || []"
            :key="cm.id"
            class="p-3.5 rounded-2xl text-xs space-y-1 min-w-0"
            :class="
              cm.author_role === 'admin'
                ? 'bg-brand/10 border border-brand-ring/30 text-slate-900 dark:text-slate-100 ml-5'
                : 'bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 text-slate-900 dark:text-slate-100 mr-5'
            "
          >
            <div class="flex items-center justify-between gap-2 font-semibold text-xs">
              <span class="text-slate-900 dark:text-[#fafafa] truncate">{{ cm.author_name }}</span>
              <span
                class="text-xs font-mono px-2 py-0.5 rounded-full bg-black/5 dark:bg-white/10 text-slate-700 dark:text-slate-200 shrink-0"
              >
                {{ cm.author_role === 'admin' ? 'Engenharia de TI' : 'Colaborador' }}
              </span>
            </div>
            <p class="text-slate-700 dark:text-slate-200 leading-relaxed font-sans break-words">
              {{ cm.message }}
            </p>
          </div>
        </div>

        <form
          class="flex flex-wrap sm:flex-nowrap gap-2 pt-3 border-t border-slate-100 dark:border-zinc-800"
          @submit.prevent="sendComment"
        >
          <label for="ticket-comment-input" class="sr-only">
            Responder à equipe de suporte técnico
          </label>
          <input
            id="ticket-comment-input"
            v-model="newComment"
            name="comment"
            type="text"
            placeholder="Responder à equipe de suporte técnico…"
            class="flex-1 min-w-0 min-h-[44px] rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-900 dark:text-[#fafafa] placeholder-slate-500 dark:placeholder-slate-400 px-3.5 py-2.5 text-sm focus:border-brand-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring transition-colors"
          />
          <button
            type="submit"
            :disabled="sendingComment || !newComment.trim()"
            class="min-h-[44px] px-5 py-2.5 rounded-xl bg-brand hover:bg-brand-dark border border-black/10 dark:border-white/15 active:scale-[0.98] text-brand-fg text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm cursor-pointer inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          >
            <PortalIcon name="send" :size="15" />
            <span>{{ sendingComment ? 'Enviando…' : 'Enviar' }}</span>
          </button>
        </form>
      </div>
    </div>
  </section>
</template>
