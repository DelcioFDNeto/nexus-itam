<script setup>
import { reactive, ref, watch } from 'vue';
import { portalApi } from '../services/nexusApi';

const props = defineProps({
  tickets: { type: Array, required: true },
  assets: { type: Array, default: () => [] },
  userDepartment: { type: String, default: 'Geral' },
  preselectedAssetTag: { type: String, default: '' },
});

const emit = defineEmits(['created', 'clear-preselected']);

const form = reactive({
  title: '',
  description: '',
  category: 'Hardware & Periféricos',
  priority: 'medium',
  assetTag: '',
});

const categories = [
  { id: 'Hardware & Periféricos', label: 'Hardware', desc: 'Tela, teclado, bateria, mouse ou fonte', icon: '💻' },
  { id: 'Conectividade & VPN', label: 'Rede & VPN', desc: 'Lentidão, Wi-Fi, VPN corporativa e portas', icon: '🌐' },
  { id: 'Sistemas & Softwares', label: 'Sistemas & ERP', desc: 'Licenças, Windows, e-mail e acessos', icon: '⚙️' },
  { id: 'Substituição / Upgrade', label: 'Substituição', desc: 'Upgrade de memória, disco ou troca', icon: '🔄' },
];

const priorities = [
  { id: 'low', label: 'Baixa', sla: 'SLA 48h', badge: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20' },
  { id: 'medium', label: 'Normal', sla: 'SLA 24h', badge: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20' },
  { id: 'high', label: 'Alta', sla: 'SLA 8h', badge: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20' },
  { id: 'critical', label: 'Crítica', sla: 'SLA 4h', badge: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20' },
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
const feedback = ref('');
const errorMsg = ref('');
const selectedTicket = ref(null);
const newComment = ref('');

function formatSla(iso) {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return String(iso);
  return dt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

async function submitTicket() {
  if (!form.title.trim() || !form.description.trim()) return;
  submitting.value = true;
  feedback.value = '';
  errorMsg.value = '';
  try {
    const matchedAsset = props.assets.find((a) => (a.internal_id || a.internalId) === form.assetTag);
    const created = await portalApi.createTicket({
      title: form.title,
      description: form.description,
      category: form.category,
      priority: form.priority,
      department: props.userDepartment || 'Corporativo',
      assetId: matchedAsset ? (matchedAsset.id || null) : null,
      assetTag: form.assetTag || null,
    });
    form.title = '';
    form.description = '';
    feedback.value = `Protocolo ${created.protocol} registrado com sucesso! Nossa equipe técnica N1/N2 já foi acionada.`;
    emit('created');
  } catch (err) {
    errorMsg.value = err.message || 'Não foi possível registrar o chamado.';
  } finally {
    submitting.value = false;
  }
}

async function openDetails(ticketId) {
  errorMsg.value = '';
  try {
    selectedTicket.value = await portalApi.getTicketDetail(ticketId);
  } catch (err) {
    errorMsg.value = err.message || 'Falha ao carregar histórico do chamado.';
  }
}

// Mantém o diálogo técnico aberto sincronizado quando eventos WebSocket atualizam a fila
watch(
  () => props.tickets,
  async () => {
    if (selectedTicket.value?.id) {
      try {
        selectedTicket.value = await portalApi.getTicketDetail(selectedTicket.value.id);
      } catch {
        // silencioso
      }
    }
  },
);

async function sendComment() {
  if (!selectedTicket.value || !newComment.value.trim() || sendingComment.value) return;
  sendingComment.value = true;
  errorMsg.value = '';
  try {
    await portalApi.addTicketComment(selectedTicket.value.id, newComment.value.trim());
    newComment.value = '';
    selectedTicket.value = await portalApi.getTicketDetail(selectedTicket.value.id);
    emit('created');
  } catch (err) {
    errorMsg.value = err.message || 'Falha ao enviar comentário.';
  } finally {
    sendingComment.value = false;
  }
}

const statusLabel = {
  open: 'Aberto',
  in_progress: 'Em Atendimento',
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
    <div class="lg:col-span-5 space-y-4">
      <div class="border-b border-slate-200 dark:border-slate-800 pb-3">
        <h2 class="text-xl font-black tracking-tight text-slate-900 dark:text-white">
          Abertura de Chamado Técnico
        </h2>
        <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Autoatendimento prioritário para suporte a hardware, softwares, acessos ou rede.
        </p>
      </div>

      <form class="station-panel p-5 sm:p-6 space-y-5" @submit.prevent="submitTicket">
        <!-- Interactive Category Cards -->
        <div>
          <label class="block text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
            Selecione a Categoria do Incidente
          </label>
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="cat in categories"
              :key="cat.id"
              type="button"
              class="p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-1.5"
              :class="
                form.category === cat.id
                  ? 'bg-brand/10 border-brand ring-1 ring-brand/40 shadow-xs'
                  : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700/80 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'
              "
              @click="form.category = cat.id"
            >
              <div class="flex items-center justify-between">
                <span class="text-lg">{{ cat.icon }}</span>
                <span
                  v-if="form.category === cat.id"
                  class="w-2 h-2 rounded-full bg-brand"
                />
              </div>
              <div>
                <p class="text-xs font-bold leading-tight text-slate-900 dark:text-white">{{ cat.label }}</p>
                <p class="text-[10px] text-slate-400 dark:text-slate-500 line-clamp-1 mt-0.5">{{ cat.desc }}</p>
              </div>
            </button>
          </div>
        </div>

        <!-- Priority / SLA Pills -->
        <div>
          <label class="block text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
            Prioridade & SLA Estimado
          </label>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button
              v-for="p in priorities"
              :key="p.id"
              type="button"
              class="py-2 px-2.5 rounded-xl border text-center transition-all cursor-pointer"
              :class="
                form.priority === p.id
                  ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold border-slate-900 dark:border-white shadow-xs'
                  : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700/80 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'
              "
              @click="form.priority = p.id"
            >
              <p class="text-xs font-bold">{{ p.label }}</p>
              <p class="text-[10px] opacity-75 mt-0.5">{{ p.sla }}</p>
            </button>
          </div>
        </div>

        <!-- Equipment Picker -->
        <div>
          <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
            Equipamento Relacionado (Opcional)
          </label>
          <select
            v-model="form.assetTag"
            class="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3.5 py-2 text-xs font-mono focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none transition-all cursor-pointer"
          >
            <option value="">Sem vínculo com ativo específico</option>
            <option v-for="a in assets" :key="a.id || a.internal_id || a.internalId" :value="a.internal_id || a.internalId">
              {{ a.internal_id || a.internalId }} — {{ a.brand }} {{ a.model }}
            </option>
          </select>
        </div>

        <!-- Title Field -->
        <div>
          <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
            Resumo do Problema (Assunto)
          </label>
          <input
            v-model="form.title"
            type="text"
            required
            minlength="4"
            placeholder="Ex.: Lentidão na VPN ou falha ao inicializar sistema"
            class="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 px-3.5 py-2.5 text-xs sm:text-sm focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none transition-all"
          />
        </div>

        <!-- Description Field -->
        <div>
          <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
            Descrição Detalhada do Sintoma
          </label>
          <textarea
            v-model="form.description"
            rows="3"
            required
            minlength="6"
            placeholder="Descreva quando o problema ocorre, mensagens de erro exibidas e tentativas de solução..."
            class="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 px-3.5 py-2.5 text-xs sm:text-sm focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none transition-all"
          />
        </div>

        <!-- Submit Button -->
        <button
          type="submit"
          :disabled="submitting"
          class="w-full py-3 rounded-xl bg-brand hover:bg-brand-dark text-white text-xs font-bold uppercase tracking-wider transition-all shadow-md shadow-brand/20 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
        >
          <span v-if="submitting" class="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          <span>{{ submitting ? 'Registrando Protocolo...' : 'Registrar Chamado Técnico' }}</span>
        </button>

        <!-- Feedback & Errors -->
        <p
          v-if="feedback"
          class="text-xs font-semibold text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3.5"
        >
          {{ feedback }}
        </p>

        <p
          v-if="errorMsg"
          class="text-xs font-semibold text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl p-3.5"
        >
          {{ errorMsg }}
        </p>
      </form>
    </div>

    <!-- Right Column: Tickets History & Interactive Chat -->
    <div class="lg:col-span-7 space-y-4">
      <div class="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
        <div>
          <h2 class="text-xl font-black tracking-tight text-slate-900 dark:text-white">
            Histórico & Resolução N1/N2
          </h2>
          <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Acompanhe a linha do tempo técnica e converse diretamente com os analistas de TI.
          </p>
        </div>
        <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-900 dark:bg-slate-800 text-white text-xs font-mono font-bold shadow-xs border border-slate-800 dark:border-slate-700">
          <span>{{ tickets.length }}</span>
          <span class="text-slate-400 font-sans font-normal">protocolos</span>
        </span>
      </div>

      <!-- Empty State -->
      <div
        v-if="tickets.length === 0"
        class="station-panel p-16 text-center space-y-3"
      >
        <div class="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 mx-auto flex items-center justify-center text-2xl">
          🎧
        </div>
        <div>
          <h3 class="text-sm font-black text-slate-800 dark:text-slate-200">
            Nenhum chamado aberto
          </h3>
          <p class="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto mt-1">
            Você não possui tickets de suporte em andamento. Caso necessite de apoio técnico ou substituição de hardware, utilize o formulário ao lado.
          </p>
        </div>
      </div>

      <!-- Tickets List -->
      <div v-else class="space-y-4">
        <article
          v-for="tk in tickets"
          :key="tk.id"
          class="station-panel station-panel-hover p-5 space-y-4 cursor-pointer group"
          :class="selectedTicket?.id === tk.id ? 'border-brand dark:border-brand ring-1 ring-brand/30' : ''"
          @click="openDetails(tk.id)"
        >
          <!-- Header Bar -->
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-mono text-xs font-black px-2.5 py-1 rounded-lg bg-slate-900 dark:bg-slate-800 text-white shadow-2xs border border-slate-700">
                {{ tk.protocol }}
              </span>
              <span
                v-if="tk.asset_tag"
                class="font-mono text-xs font-bold px-2 py-0.5 rounded-lg bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border border-indigo-500/20"
              >
                {{ tk.asset_tag }}
              </span>
              <span
                class="text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full border"
                :class="{
                  'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20': tk.priority === 'low' || tk.priority === 'medium',
                  'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20': tk.priority === 'high',
                  'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20': tk.priority === 'critical',
                }"
              >
                {{ priorityLabel[tk.priority] || tk.priority }}
              </span>
            </div>

            <span
              class="text-[11px] font-bold px-2.5 py-0.5 rounded-full border shadow-2xs"
              :class="{
                'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20': tk.status === 'open',
                'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20': tk.status === 'in_progress',
                'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20': tk.status === 'resolved' || tk.status === 'closed',
              }"
            >
              {{ statusLabel[tk.status] || tk.status }}
            </span>
          </div>

          <!-- Title & Description -->
          <div>
            <h3 class="text-sm sm:text-base font-black text-slate-900 dark:text-white group-hover:text-brand transition-colors">
              {{ tk.title }}
            </h3>
            <p class="text-xs text-slate-600 dark:text-slate-400 line-clamp-2 mt-1 leading-relaxed">
              {{ tk.description }}
            </p>
          </div>

          <!-- Resolution Timeline (N1 / N2) -->
          <div class="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800 space-y-2">
            <span class="text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 block">
              Linha de Atendimento Técnico
            </span>
            <div class="grid grid-cols-3 gap-2 text-center text-xs">
              <!-- Etapa 1: Triagem N1 -->
              <div
                class="p-2 rounded-xl border"
                :class="
                  tk.status !== 'open'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                    : 'bg-brand/10 border-brand text-brand'
                "
              >
                <p class="font-bold text-[11px]">N1: Triagem</p>
                <p class="text-[10px] opacity-80 mt-0.5">
                  {{ tk.status !== 'open' ? 'Concluída ✓' : 'Em análise' }}
                </p>
              </div>

              <!-- Etapa 2: Especialista N2 -->
              <div
                class="p-2 rounded-xl border"
                :class="
                  tk.status === 'resolved' || tk.status === 'closed'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                    : tk.status === 'in_progress'
                      ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-700 dark:text-indigo-300 font-bold'
                      : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400'
                "
              >
                <p class="font-bold text-[11px]">N2: Especialista</p>
                <p class="text-[10px] opacity-80 mt-0.5">
                  {{ tk.assigned_tech_name || 'Aguardando fila' }}
                </p>
              </div>

              <!-- Etapa 3: Parecer Técnico -->
              <div
                class="p-2 rounded-xl border"
                :class="
                  tk.status === 'resolved' || tk.status === 'closed'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                    : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400'
                "
              >
                <p class="font-bold text-[11px]">Conclusão</p>
                <p class="text-[10px] opacity-80 mt-0.5">
                  {{ tk.status === 'resolved' || tk.status === 'closed' ? 'Resolvido ✓' : 'Pendente' }}
                </p>
              </div>
            </div>
          </div>

          <!-- Footer Info -->
          <div class="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400 font-sans">
            <span class="text-slate-400">
              Prazo SLA: <strong class="text-slate-700 dark:text-slate-300 font-mono">{{ formatSla(tk.sla_due_at) }}</strong>
            </span>
            <div class="flex items-center gap-3 font-semibold text-brand">
              <span>💬 {{ tk.comments_count || 0 }} mensagens registradas</span>
              <span>↗</span>
            </div>
          </div>

          <!-- Parecer Conclusivo se houver -->
          <div
            v-if="tk.resolution_notes"
            class="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-950 dark:text-emerald-200 space-y-1"
          >
            <p class="font-black uppercase text-[10px] text-emerald-800 dark:text-emerald-400">
              Parecer Conclusivo da TI:
            </p>
            <p class="leading-relaxed">{{ tk.resolution_notes }}</p>
          </div>
        </article>
      </div>

      <!-- Selected Ticket Live Conversation Thread -->
      <div
        v-if="selectedTicket"
        class="station-panel p-5 sm:p-6 space-y-4 border-brand/50 dark:border-brand/60 shadow-lg animate-in fade-in duration-200"
      >
        <div class="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
          <div class="flex items-center gap-2.5">
            <span class="w-2.5 h-2.5 rounded-full bg-brand animate-pulse" />
            <h4 class="text-sm font-black text-slate-900 dark:text-white">
              Diálogo Técnico com TI • Protocolo {{ selectedTicket.protocol }}
            </h4>
          </div>
          <button
            type="button"
            class="text-xs font-bold text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 px-2 py-1 rounded-lg cursor-pointer"
            @click="selectedTicket = null"
          >
            ✕ Fechar
          </button>
        </div>

        <div class="space-y-3 max-h-64 overflow-y-auto pr-1">
          <div
            v-if="!selectedTicket.comments || selectedTicket.comments.length === 0"
            class="text-xs text-slate-400 italic py-4 text-center"
          >
            Nenhuma mensagem técnica registrada neste protocolo ainda. Envie uma mensagem abaixo.
          </div>
          <div
            v-for="cm in selectedTicket.comments || []"
            :key="cm.id"
            class="p-3.5 rounded-2xl text-xs space-y-1"
            :class="
              cm.author_role === 'admin'
                ? 'bg-indigo-500/10 border border-indigo-500/20 text-slate-900 dark:text-slate-100 ml-5'
                : 'bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 mr-5'
            "
          >
            <div class="flex items-center justify-between font-bold text-[11px]">
              <span class="text-slate-900 dark:text-white">{{ cm.author_name }}</span>
              <span class="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-black/5 dark:bg-white/10 text-slate-500 dark:text-slate-400">
                {{ cm.author_role === 'admin' ? 'Engenharia de TI' : 'Colaborador' }}
              </span>
            </div>
            <p class="text-slate-700 dark:text-slate-300 leading-relaxed font-sans">{{ cm.message }}</p>
          </div>
        </div>

        <form class="flex gap-2 pt-3 border-t border-slate-100 dark:border-slate-800" @submit.prevent="sendComment">
          <input
            v-model="newComment"
            type="text"
            placeholder="Responder à equipe de suporte técnico..."
            class="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 px-3.5 py-2.5 text-xs focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none transition-all"
          />
          <button
            type="submit"
            :disabled="sendingComment || !newComment.trim()"
            class="px-5 py-2.5 rounded-xl bg-brand hover:bg-brand-dark text-white text-xs font-bold uppercase tracking-wider disabled:opacity-50 transition-colors shadow-xs cursor-pointer"
          >
            {{ sendingComment ? 'Enviando...' : 'Enviar' }}
          </button>
        </form>
      </div>
    </div>
  </section>
</template>
