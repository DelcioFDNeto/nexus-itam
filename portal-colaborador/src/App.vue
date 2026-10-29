<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import CustodyAssetsPanel from './components/CustodyAssetsPanel.vue';
import ResponsibilityTerms from './components/ResponsibilityTerms.vue';
import SupportTicketDesk from './components/SupportTicketDesk.vue';
import {
  GATEWAY_BASE_URL,
  clearStoredSession,
  getStoredSession,
  portalApi,
   saveStoredSession,
  setUnauthorizedHandler,
} from './services/nexusApi';

const session = ref(getStoredSession());
const activeTab = ref('custody');
const loading = ref(false);
const authError = ref('');
const portalError = ref('');
const wsState = ref('disconnected');
const liveBanner = ref('');
const preselectedTag = ref('');

const loginForm = reactive({
  email: 'mariana.costa@nexuscorp.com.br',
  password: 'Colab@2026!',
});

const assets = ref([]);
const terms = ref([]);
const tickets = ref([]);

let streamHandle = null;
let bannerTimer = null;

const pendingTermsCount = computed(
  () => terms.value.filter((t) => t.status === 'pending').length,
);

async function refreshPortalData() {
  if (!session.value?.token) return;
  loading.value = true;
  portalError.value = '';
  try {
    const [aRes, tRes, kRes] = await Promise.all([
      portalApi.listMyAssets(),
      portalApi.listMyTerms(),
      portalApi.listMyTickets(),
    ]);
    assets.value = aRes.items || [];
    terms.value = tRes.items || [];
    tickets.value = kRes.items || [];
  } catch (err) {
    portalError.value = err.message;
  } finally {
    loading.value = false;
  }
}

function startWebSocket() {
  if (streamHandle) streamHandle.disconnect();
  if (!session.value?.token) return;

  streamHandle = portalApi.connectRealtimeStream(
    session.value.token,
    (frame) => {
      if (frame.event === 'welcome' || frame.event === 'pong') return;
      liveBanner.value = `Evento em tempo real (${frame.event}) recebido via WebSocket NexusDesk`;
      refreshPortalData();
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => {
        liveBanner.value = '';
      }, 6000);
    },
    (status) => {
      wsState.value = status;
    },
    () => {
      refreshPortalData();
    },
  );
}

async function handleLogin() {
  authError.value = '';
  portalError.value = '';
  loading.value = true;
  try {
    const res = await portalApi.login(loginForm.email, loginForm.password);
    session.value = { token: res.accessToken, user: res.user };
    await refreshPortalData();
    startWebSocket();
  } catch (err) {
    authError.value = err.message;
  } finally {
    loading.value = false;
  }
}

function fillDemo(type) {
  if (type === 'colab') {
    loginForm.email = 'mariana.costa@nexuscorp.com.br';
    loginForm.password = 'Colab@2026!';
  } else {
    loginForm.email = 'admin@nexuscorp.com.br';
    loginForm.password = 'Nexus@2026!';
  }
}

function handleLogout(reason = '') {
  if (streamHandle) {
    streamHandle.disconnect();
    streamHandle = null;
  }
  clearStoredSession();
  session.value = null;
  assets.value = [];
  terms.value = [];
  tickets.value = [];
  wsState.value = 'disconnected';
  if (typeof reason === 'string' && reason) {
    authError.value = reason;
  }
}

function handleReportIssue(asset) {
  preselectedTag.value = asset.internal_id;
  activeTab.value = 'tickets';
}

onMounted(async () => {
  setUnauthorizedHandler((msg) => {
    handleLogout(msg);
  });

  if (session.value?.token) {
    try {
      const profile = await portalApi.getProfile();
      saveStoredSession(session.value.token, profile);
      session.value = { token: session.value.token, user: profile };
      await refreshPortalData();
      startWebSocket();
    } catch {
      // Caso o token tenha expirado, o interceptor 401 já limpa a sessão
    }
  }
});

onBeforeUnmount(() => {
  setUnauthorizedHandler(null);
  clearTimeout(bannerTimer);
  if (streamHandle) streamHandle.disconnect();
});
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <!-- Top Operational Header -->
    <header class="bg-slate-950 text-white border-b border-slate-800">
      <div class="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <div
            class="w-9 h-9 rounded-lg bg-brand flex items-center justify-center font-black text-sm tracking-tight"
          >
            NX
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span class="font-bold text-sm tracking-tight">Nexus Self-Service</span>
              <span
                class="font-mono text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
              >
                Vue 3.5 • Zero-Firebase
              </span>
            </div>
            <p class="text-[11px] text-slate-400">
              Estação do Colaborador • Custódia, Termos CLT & Suporte TI
            </p>
          </div>
        </div>

        <div v-if="session?.user" class="flex items-center gap-4">
          <div class="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-[11px] font-mono">
            <span
              class="w-2 h-2 rounded-full"
              :class="wsState === 'connected' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'"
            />
            <span>WS: {{ wsState === 'connected' ? 'LIVE RFC 6455' : wsState }}</span>
          </div>

          <div class="text-right hidden md:block">
            <div class="text-xs font-bold">{{ session.user.name }}</div>
            <div class="text-[11px] text-slate-400 font-mono">
              {{ session.user.tenantName }} ({{ session.user.role }})
            </div>
          </div>

          <button
            type="button"
            class="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
            @click="handleLogout('')"
          >
            Encerrar Sessão
          </button>
        </div>
      </div>
    </header>

    <!-- Login View -->
    <main v-if="!session?.user" class="flex-1 flex items-center justify-center p-6">
      <div class="w-full max-w-md station-panel p-7 space-y-5">
        <div class="space-y-1.5">
          <p class="font-mono text-[11px] uppercase tracking-widest text-brand font-bold">
            Autenticação JWT Stateless • Scrypt
          </p>
          <h1 class="text-xl font-black tracking-tight text-slate-900">
            Acesso à Estação do Colaborador
          </h1>
          <p class="text-xs text-slate-500">
            Conectado exclusivamente ao API Gateway Fastify ({{ GATEWAY_BASE_URL }}).
          </p>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <button
            type="button"
            class="p-2 rounded-lg border border-slate-200 hover:border-brand text-left transition-colors"
            @click="fillDemo('colab')"
          >
            <div class="text-[11px] font-bold text-slate-900">Perfil Colaboradora</div>
            <div class="text-[10px] font-mono text-slate-500 truncate">mariana.costa@...</div>
          </button>
          <button
            type="button"
            class="p-2 rounded-lg border border-slate-200 hover:border-brand text-left transition-colors"
            @click="fillDemo('admin')"
          >
            <div class="text-[11px] font-bold text-slate-900">Perfil Gestor TI</div>
            <div class="text-[10px] font-mono text-slate-500 truncate">admin@nexuscorp...</div>
          </button>
        </div>

        <form class="space-y-3.5" @submit.prevent="handleLogin">
          <div>
            <label class="block text-xs font-semibold text-slate-700 mb-1">E-mail Corporativo</label>
            <input
              v-model="loginForm.email"
              type="email"
              required
              class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
            />
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-700 mb-1">Senha</label>
            <input
              v-model="loginForm.password"
              type="password"
              required
              class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
            />
          </div>

          <div
            v-if="authError"
            class="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 font-medium"
          >
            {{ authError }}
          </div>

          <button
            type="submit"
            :disabled="loading"
            class="w-full py-2.5 rounded-lg bg-brand hover:bg-brand-dark text-white text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
          >
            {{ loading ? 'Autenticando no Gateway...' : 'Entrar no Portal de Custódia' }}
          </button>
        </form>
      </div>
    </main>

    <!-- Authenticated Workspace -->
    <main v-else class="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div
        v-if="portalError"
        class="p-3 rounded-xl bg-red-50 text-red-800 border border-red-200 text-xs font-medium flex items-center justify-between gap-3"
      >
        <span>⚠️ {{ portalError }}</span>
        <button
          type="button"
          class="font-bold text-red-700 hover:text-red-900 underline"
          @click="refreshPortalData"
        >
          Tentar novamente
        </button>
      </div>

      <div
        v-if="liveBanner"
        class="p-3 rounded-xl bg-emerald-950 text-emerald-200 border border-emerald-700 text-xs font-mono flex items-center justify-between"
      >
        <span>⚡ {{ liveBanner }}</span>
        <button type="button" class="text-emerald-400 hover:text-white" @click="liveBanner = ''">
          OK
        </button>
      </div>

      <!-- Navigation Bar -->
      <nav class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="px-4 py-2 rounded-lg text-xs font-bold transition-colors"
            :class="
              activeTab === 'custody'
                ? 'bg-slate-900 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900'
            "
            @click="activeTab = 'custody'"
          >
            Meus Equipamentos ({{ assets.length }})
          </button>

          <button
            type="button"
            class="px-4 py-2 rounded-lg text-xs font-bold transition-colors flex items-center gap-2"
            :class="
              activeTab === 'terms'
                ? 'bg-slate-900 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900'
            "
            @click="activeTab = 'terms'"
          >
            <span>Termos & Criptografia</span>
            <span
              v-if="pendingTermsCount > 0"
              class="px-1.5 py-0.5 rounded-full bg-amber-500 text-slate-950 text-[10px] font-black"
            >
              {{ pendingTermsCount }} pendente
            </span>
          </button>

          <button
            type="button"
            class="px-4 py-2 rounded-lg text-xs font-bold transition-colors"
            :class="
              activeTab === 'tickets'
                ? 'bg-slate-900 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900'
            "
            @click="activeTab = 'tickets'"
          >
            Chamados de Suporte ({{ tickets.length }})
          </button>
        </div>

        <a
          :href="`${GATEWAY_BASE_URL}/docs`"
          target="_blank"
          rel="noopener noreferrer"
          class="font-mono text-[11px] font-semibold text-indigo-600 hover:text-indigo-800"
        >
          Catálogo OpenAPI 3.1 ↗
        </a>
      </nav>

      <CustodyAssetsPanel
        v-if="activeTab === 'custody'"
        :assets="assets"
        :loading="loading"
        @report-issue="handleReportIssue"
      />

      <ResponsibilityTerms
        v-else-if="activeTab === 'terms'"
        :terms="terms"
        @signed="refreshPortalData"
      />

      <SupportTicketDesk
        v-else
        :tickets="tickets"
        :assets="assets"
        :user-department="session.user.department || 'Corporativo'"
        :preselected-asset-tag="preselectedTag"
        @clear-preselected="preselectedTag = ''"
        @created="refreshPortalData"
      />
    </main>
  </div>
</template>
