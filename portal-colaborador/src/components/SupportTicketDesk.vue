<script setup>
import { reactive, ref, watch } from 'vue';
import { portalApi } from '../services/nexusApi';

const props = defineProps({
  tickets: { type: Array, required: true },
  assets: { type: Array, default: () => [] },
  userDepartment: { type: String, default: 'Corporativo' },
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
    feedback.value = `Chamado ${created.protocol} aberto e transmitido em tempo real à equipe de TI.`;
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
    <div class="lg:col-span-5 space-y-4">
      <div>
        <p class="font-mono text-[11px] uppercase tracking-widest text-indigo-600 font-semibold">
          API 2 (REST) • /api/v1/tickets
        </p>
        <h2 class="text-lg font-bold tracking-tight text-slate-900">
          Abrir Solicitação para a Engenharia de TI
        </h2>
      </div>

      <form class="station-panel p-5 space-y-3.5" @submit.prevent="submitTicket">
        <div>
          <label class="block text-xs font-semibold text-slate-700 mb-1">Assunto</label>
          <input
            v-model="form.title"
            type="text"
            required
            minlength="4"
            placeholder="Ex.: Falha na porta USB-C da dockstation"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-semibold text-slate-700 mb-1">Categoria</label>
            <select
              v-model="form.category"
              class="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs font-medium"
            >
              <option>Hardware & Periféricos</option>
              <option>Software & Acesso VPN</option>
              <option>Substituição / Upgrade</option>
              <option>Segurança & Antivírus</option>
            </select>
          </div>

          <div>
            <label class="block text-xs font-semibold text-slate-700 mb-1">Urgência / SLA</label>
            <select
              v-model="form.priority"
              class="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs font-medium"
            >
              <option value="low">Baixa (SLA 48h)</option>
              <option value="medium">Normal (SLA 24h)</option>
              <option value="high">Alta (SLA 8h)</option>
              <option value="critical">Crítica (SLA 4h)</option>
            </select>
          </div>
        </div>

        <div>
          <label class="block text-xs font-semibold text-slate-700 mb-1">
            Equipamento Relacionado (Opcional)
          </label>
          <select
            v-model="form.assetTag"
            class="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs font-mono"
          >
            <option value="">Sem vínculo específico</option>
            <option v-for="a in assets" :key="a.id" :value="a.internal_id">
              {{ a.internal_id }} — {{ a.brand }} {{ a.model }}
            </option>
          </select>
        </div>

        <div>
          <label class="block text-xs font-semibold text-slate-700 mb-1">
            Descrição Técnica do Sintoma
          </label>
          <textarea
            v-model="form.description"
            rows="3"
            required
            minlength="6"
            placeholder="Descreva quando ocorre e mensagens exibidas..."
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />
        </div>

        <button
          type="submit"
          :disabled="submitting"
          class="w-full py-2.5 rounded-lg bg-slate-900 text-white text-xs font-bold uppercase tracking-wider hover:bg-brand transition-colors disabled:opacity-50"
        >
          {{ submitting ? 'Registrando protocolo...' : 'Registrar Chamado de Suporte' }}
        </button>

        <p
          v-if="feedback"
          class="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-2.5"
        >
          {{ feedback }}
        </p>

        <p
          v-if="errorMsg"
          class="text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5"
        >
          {{ errorMsg }}
        </p>
      </form>
    </div>

    <div class="lg:col-span-7 space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <p class="font-mono text-[11px] uppercase tracking-widest text-emerald-600 font-semibold">
            Sincronização Instantânea via API 5 (WebSocket)
          </p>
          <h2 class="text-lg font-bold tracking-tight text-slate-900">
            Meus Protocolos de Atendimento
          </h2>
        </div>
        <span class="mono-tag">{{ tickets.length }} protocolos</span>
      </div>

      <div
        v-if="tickets.length === 0"
        class="station-panel p-8 text-center text-sm text-slate-500"
      >
        Você ainda não possui chamados registrados.
      </div>

      <div v-else class="space-y-3">
        <article
          v-for="tk in tickets"
          :key="tk.id"
          class="station-panel p-4 space-y-2 hover:border-slate-300 transition-colors cursor-pointer"
          @click="openDetails(tk.id)"
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex flex-wrap items-center gap-2">
              <span class="mono-tag">{{ tk.protocol }}</span>
              <span v-if="tk.asset_tag" class="mono-tag">{{ tk.asset_tag }}</span>
              <span
                class="text-[10px] font-bold uppercase px-2 py-0.5 rounded"
                :class="{
                  'bg-slate-100 text-slate-700': tk.priority === 'low' || tk.priority === 'medium',
                  'bg-orange-100 text-orange-800': tk.priority === 'high',
                  'bg-red-100 text-red-800': tk.priority === 'critical',
                }"
              >
                Prioridade {{ priorityLabel[tk.priority] || tk.priority }}
              </span>
            </div>
            <span
              class="text-[11px] font-bold px-2.5 py-0.5 rounded-full"
              :class="{
                'bg-amber-100 text-amber-800': tk.status === 'open',
                'bg-indigo-100 text-indigo-800': tk.status === 'in_progress',
                'bg-emerald-100 text-emerald-800': tk.status === 'resolved' || tk.status === 'closed',
              }"
            >
              {{ statusLabel[tk.status] || tk.status }}
            </span>
          </div>

          <h3 class="text-sm font-bold text-slate-900">{{ tk.title }}</h3>
          <p class="text-xs text-slate-600 line-clamp-2">{{ tk.description }}</p>

          <div class="pt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 font-mono">
            <span>SLA até: {{ formatSla(tk.sla_due_at) }}</span>
            <div class="flex items-center gap-3">
              <span v-if="tk.assigned_tech_name">Técnico: {{ tk.assigned_tech_name }}</span>
              <span v-if="tk.comments_count !== undefined">💬 {{ tk.comments_count }} msg</span>
            </div>
          </div>

          <div
            v-if="tk.resolution_notes"
            class="p-2.5 rounded bg-emerald-50 border border-emerald-200 text-xs text-emerald-900"
          >
            <strong>Parecer da TI:</strong> {{ tk.resolution_notes }}
          </div>
        </article>
      </div>

      <div v-if="selectedTicket" class="station-panel p-5 space-y-3 border-indigo-300">
        <div class="flex items-center justify-between">
          <h4 class="text-sm font-bold text-slate-900">
            Diálogo Técnico • {{ selectedTicket.protocol }}
          </h4>
          <button
            type="button"
            class="text-xs text-slate-400 hover:text-slate-700"
            @click="selectedTicket = null"
          >
            Fechar
          </button>
        </div>

        <div class="space-y-2 max-h-48 overflow-y-auto">
          <div
            v-if="!selectedTicket.comments || selectedTicket.comments.length === 0"
            class="text-xs text-slate-400 italic py-2"
          >
            Nenhuma mensagem técnica registrada neste protocolo ainda.
          </div>
          <div
            v-for="cm in selectedTicket.comments || []"
            :key="cm.id"
            class="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs"
          >
            <div class="font-bold text-slate-800">
              {{ cm.author_name }}
              <span class="font-mono text-[10px] text-slate-400">({{ cm.author_role }})</span>
            </div>
            <p class="text-slate-600 mt-0.5">{{ cm.message }}</p>
          </div>
        </div>

        <form class="flex gap-2" @submit.prevent="sendComment">
          <input
            v-model="newComment"
            type="text"
            placeholder="Adicionar informação ao chamado..."
            class="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
          />
          <button
            type="submit"
            :disabled="sendingComment || !newComment.trim()"
            class="px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-bold disabled:opacity-50"
          >
            {{ sendingComment ? 'Enviando...' : 'Enviar' }}
          </button>
        </form>
      </div>
    </div>
  </section>
</template>
