<script setup>
import { reactive, ref, watch } from 'vue';
import { portalApi } from '../services/nexusApi';

const props = defineProps({
  tickets: { type: Array, required: true },
  assets: { type: Array, default: () => [] },
  userDepartment: { type: String, default: 'Engenharia de Produto' },
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
    const matchedAsset = props.assets.find((a) => a.internal_id === form.assetTag);
    const created = await portalApi.createTicket({
      title: form.title,
      description: form.description,
      category: form.category,
      priority: form.priority,
      department: props.userDepartment || 'Corporativo',
      assetId: matchedAsset ? matchedAsset.id : null,
      assetTag: form.assetTag || null,
    });
    form.title = '';
    form.description = '';
    feedback.value = `Protocolo ${created.protocol} registrado com sucesso! Nossa equipe técnica já foi notificada.`;
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
        // silencioso em background
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
      <div class="border-b border-slate-200 pb-3">
        <h2 class="text-lg font-extrabold tracking-tight text-slate-900">
          Nova Solicitação de Suporte
        </h2>
        <p class="text-xs text-slate-500">
          Abra um protocolo para reparos, novos softwares, acessos ou substituição de hardware.
        </p>
      </div>

      <form class="station-panel p-5 sm:p-6 space-y-4" @submit.prevent="submitTicket">
        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1">Assunto da Solicitação</label>
          <input
            v-model="form.title"
            type="text"
            required
            minlength="4"
            placeholder="Ex.: Lentidão na conexão VPN ou tela piscando"
            class="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-xs sm:text-sm focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none transition-all"
          />
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1">Categoria</label>
            <select
              v-model="form.category"
              class="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium focus:border-brand focus:outline-none bg-white"
            >
              <option>Hardware & Periféricos</option>
              <option>Software & Acesso VPN</option>
              <option>Substituição / Upgrade</option>
              <option>Segurança & Antivírus</option>
            </select>
          </div>

          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1">Prioridade / SLA</label>
            <select
              v-model="form.priority"
              class="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium focus:border-brand focus:outline-none bg-white"
            >
              <option value="low">Baixa (SLA 48h)</option>
              <option value="medium">Normal (SLA 24h)</option>
              <option value="high">Alta (SLA 8h)</option>
              <option value="critical">Crítica (SLA 4h)</option>
            </select>
          </div>
        </div>

        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1">
            Equipamento Relacionado (Opcional)
          </label>
          <select
            v-model="form.assetTag"
            class="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-mono focus:border-brand focus:outline-none bg-white"
          >
            <option value="">Sem vínculo específico</option>
            <option v-for="a in assets" :key="a.id" :value="a.internal_id">
              {{ a.internal_id }} — {{ a.brand }} {{ a.model }}
            </option>
          </select>
        </div>

        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1">
            Descrição do Problema ou Necessidade
          </label>
          <textarea
            v-model="form.description"
            rows="3"
            required
            minlength="6"
            placeholder="Descreva com detalhes o sintoma, mensagens de erro e quando o problema começou..."
            class="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-xs sm:text-sm focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none transition-all"
          />
        </div>

        <button
          type="submit"
          :disabled="submitting"
          class="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-brand text-white text-xs font-bold uppercase tracking-wider transition-all shadow-sm disabled:opacity-50"
        >
          {{ submitting ? 'Registrando Protocolo...' : 'Registrar Chamado' }}
        </button>

        <p
          v-if="feedback"
          class="text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl p-3"
        >
          {{ feedback }}
        </p>

        <p
          v-if="errorMsg"
          class="text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-xl p-3"
        >
          {{ errorMsg }}
        </p>
      </form>
    </div>

    <!-- Right Column: Tickets History & Interactive Chat -->
    <div class="lg:col-span-7 space-y-4">
      <div class="flex items-center justify-between border-b border-slate-200 pb-3">
        <div>
          <h2 class="text-lg font-extrabold tracking-tight text-slate-900">
            Meus Protocolos de Atendimento
          </h2>
          <p class="text-xs text-slate-500">
            Acompanhe o andamento das solicitações e dialogue com os técnicos de suporte.
          </p>
        </div>
        <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900 text-white text-xs font-mono font-bold shadow-xs">
          <span>{{ tickets.length }}</span>
          <span class="text-slate-300 font-sans font-normal">protocolos</span>
        </span>
      </div>

      <!-- Empty State -->
      <div
        v-if="tickets.length === 0"
        class="station-panel p-10 text-center space-y-3"
      >
        <div class="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 mx-auto flex items-center justify-center text-xl">
          🎧
        </div>
        <div>
          <h3 class="text-sm font-bold text-slate-800">Nenhum chamado aberto</h3>
          <p class="text-xs text-slate-500 max-w-sm mx-auto mt-1">
            Você não possui tickets de suporte em andamento. Preencha o formulário ao lado para abrir uma solicitação.
          </p>
        </div>
      </div>

      <!-- Tickets List -->
      <div v-else class="space-y-3">
        <article
          v-for="tk in tickets"
          :key="tk.id"
          class="station-panel p-4 sm:p-5 space-y-3 hover:border-brand/40 hover:shadow-xs transition-all cursor-pointer group"
          @click="openDetails(tk.id)"
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-mono text-xs font-black px-2.5 py-0.5 rounded bg-slate-900 text-white shadow-2xs">
                {{ tk.protocol }}
              </span>
              <span
                v-if="tk.asset_tag"
                class="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200"
              >
                {{ tk.asset_tag }}
              </span>
              <span
                class="text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-full"
                :class="{
                  'bg-slate-100 text-slate-700': tk.priority === 'low' || tk.priority === 'medium',
                  'bg-orange-100 text-orange-800': tk.priority === 'high',
                  'bg-rose-100 text-rose-800': tk.priority === 'critical',
                }"
              >
                {{ priorityLabel[tk.priority] || tk.priority }}
              </span>
            </div>

            <span
              class="text-[11px] font-bold px-2.5 py-0.5 rounded-full border shadow-2xs"
              :class="{
                'bg-amber-50 text-amber-700 border-amber-200': tk.status === 'open',
                'bg-indigo-50 text-indigo-700 border-indigo-200': tk.status === 'in_progress',
                'bg-emerald-50 text-emerald-700 border-emerald-200': tk.status === 'resolved' || tk.status === 'closed',
              }"
            >
              {{ statusLabel[tk.status] || tk.status }}
            </span>
          </div>

          <div>
            <h3 class="text-sm font-bold text-slate-900 group-hover:text-brand transition-colors">
              {{ tk.title }}
            </h3>
            <p class="text-xs text-slate-600 line-clamp-2 mt-0.5 leading-relaxed">
              {{ tk.description }}
            </p>
          </div>

          <div class="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 font-sans">
            <span class="text-slate-400">Prazo SLA: <strong class="text-slate-700 font-mono">{{ formatSla(tk.sla_due_at) }}</strong></span>
            <div class="flex items-center gap-3">
              <span v-if="tk.assigned_tech_name" class="font-medium text-slate-700">
                👨‍💻 {{ tk.assigned_tech_name }}
              </span>
              <span class="font-semibold text-brand">
                💬 {{ tk.comments_count || 0 }} mensagens
              </span>
            </div>
          </div>

          <div
            v-if="tk.resolution_notes"
            class="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-950 space-y-0.5"
          >
            <p class="font-bold uppercase text-[10px] text-emerald-800">Parecer Conclusivo da TI:</p>
            <p>{{ tk.resolution_notes }}</p>
          </div>
        </article>
      </div>

      <!-- Selected Ticket Conversation Thread -->
      <div
        v-if="selectedTicket"
        class="station-panel p-5 space-y-3.5 border-brand/50 shadow-md animate-in fade-in duration-200"
      >
        <div class="flex items-center justify-between border-b border-slate-200 pb-2.5">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-brand animate-pulse" />
            <h4 class="text-sm font-bold text-slate-900">
              Diálogo Técnico • {{ selectedTicket.protocol }}
            </h4>
          </div>
          <button
            type="button"
            class="text-xs font-semibold text-slate-400 hover:text-slate-700 px-2 py-1"
            @click="selectedTicket = null"
          >
            ✕ Fechar
          </button>
        </div>

        <div class="space-y-2.5 max-h-56 overflow-y-auto pr-1">
          <div
            v-if="!selectedTicket.comments || selectedTicket.comments.length === 0"
            class="text-xs text-slate-400 italic py-3 text-center"
          >
            Nenhuma mensagem técnica registrada neste protocolo ainda.
          </div>
          <div
            v-for="cm in selectedTicket.comments || []"
            :key="cm.id"
            class="p-3 rounded-xl text-xs space-y-1"
            :class="
              cm.author_role === 'admin'
                ? 'bg-indigo-50/70 border border-indigo-200/80 text-slate-900 ml-4'
                : 'bg-slate-100 border border-slate-200 text-slate-900 mr-4'
            "
          >
            <div class="flex items-center justify-between font-bold text-[11px]">
              <span class="text-slate-800">{{ cm.author_name }}</span>
              <span class="text-[10px] uppercase font-mono text-slate-400">
                {{ cm.author_role === 'admin' ? 'Engenharia de TI' : 'Colaborador' }}
              </span>
            </div>
            <p class="text-slate-700 leading-relaxed">{{ cm.message }}</p>
          </div>
        </div>

        <form class="flex gap-2 pt-2 border-t border-slate-100" @submit.prevent="sendComment">
          <input
            v-model="newComment"
            type="text"
            placeholder="Responder à equipe de suporte técnico..."
            class="flex-1 rounded-xl border border-slate-300 px-3.5 py-2 text-xs focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
          />
          <button
            type="submit"
            :disabled="sendingComment || !newComment.trim()"
            class="px-4 py-2 rounded-xl bg-brand text-white text-xs font-bold uppercase tracking-wider hover:bg-brand-dark disabled:opacity-50 transition-colors shadow-2xs"
          >
            {{ sendingComment ? 'Enviando...' : 'Enviar' }}
          </button>
        </form>
      </div>
    </div>
  </section>
</template>
