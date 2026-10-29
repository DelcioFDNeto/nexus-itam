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
  <div class="min-h-screen flex flex-col bg-slate-50 text-slate-900 selection:bg-brand selection:text-white">
    <!-- Top Executive Header -->
    <header class="bg-slate-950 text-white border-b border-slate-800/80 sticky top-0 z-40 backdrop-blur-md">
      <div class="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <div
            class="w-9 h-9 rounded-xl bg-gradient-to-tr from-brand to-indigo-500 flex items-center justify-center font-black text-sm tracking-tight text-white shadow-md shadow-brand/20"
          >
            NX
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span class="font-bold text-sm tracking-tight text-white">Nexus Workspace</span>
              <span
                class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1"
              >
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Portal do Colaborador
              </span>
            </div>
            <p class="text-[11px] text-slate-400">
              Central Integrada de Custódia, Conformidade CLT & Atendimento de TI
            </p>
          </div>
        </div>

        <div v-if="session?.user" class="flex items-center gap-3 sm:gap-4">
          <div
            class="hidden sm:flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-[11px] font-mono text-slate-300"
            title="Conexão WebSocket ativa para sincronização em tempo real"
          >
            <span
              class="w-2 h-2 rounded-full"
              :class="wsState === 'connected' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'"
            />
            <span>{{ wsState === 'connected' ? 'Conexão Segura Ativa' : 'Reconectando...' }}</span>
          </div>

          <div class="flex items-center gap-2.5">
            <div
              class="w-8 h-8 rounded-full bg-indigo-600/30 border border-indigo-400/40 text-indigo-200 flex items-center justify-center font-bold text-xs uppercase"
            >
              {{ session.user.name?.slice(0, 2) || 'CL' }}
            </div>
            <div class="text-right hidden md:block">
              <div class="text-xs font-bold text-white">{{ session.user.name }}</div>
              <div class="text-[11px] text-slate-400 font-mono">
                {{ session.user.department || session.user.tenantName }} • {{ session.user.role }}
              </div>
            </div>
          </div>

          <button
            type="button"
            class="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white transition-colors"
            @click="handleLogout('')"
          >
            Sair
          </button>
        </div>
      </div>
    </header>

    <!-- Login View -->
    <main v-if="!session?.user" class="flex-1 flex items-center justify-center p-6 bg-radial from-slate-900 via-slate-950 to-slate-950">
      <div class="w-full max-w-md bg-white border border-slate-200/90 rounded-2xl shadow-2xl p-7 sm:p-8 space-y-6">
        <div class="space-y-1.5 text-center">
          <div
            class="w-12 h-12 rounded-2xl bg-gradient-to-tr from-brand to-indigo-600 mx-auto flex items-center justify-center font-black text-xl text-white shadow-lg shadow-brand/25 mb-3"
          >
            NX
          </div>
          <h1 class="text-xl sm:text-2xl font-black tracking-tight text-slate-900">
            Nexus Workspace
          </h1>
          <p class="text-xs text-slate-500">
            Acesso corporativo seguro à central de custódia e atendimento
          </p>
        </div>

        <!-- Quick Demo Profiles -->
        <div class="bg-slate-50 rounded-xl p-3 border border-slate-200/80 space-y-2">
          <p class="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Acesso Rápido para Demonstração
          </p>
          <div class="grid grid-cols-2 gap-2">
            <button
              type="button"
              class="p-2.5 rounded-lg border border-slate-200 bg-white hover:border-brand hover:shadow-xs text-left transition-all"
              @click="fillDemo('colab')"
            >
              <div class="text-xs font-bold text-slate-800">Mariana Costa</div>
              <div class="text-[10px] text-slate-500 truncate">Colaboradora • Engenharia</div>
            </button>
            <button
              type="button"
              class="p-2.5 rounded-lg border border-slate-200 bg-white hover:border-brand hover:shadow-xs text-left transition-all"
              @click="fillDemo('admin')"
            >
              <div class="text-xs font-bold text-slate-800">Ricardo Almeida</div>
              <div class="text-[10px] text-slate-500 truncate">Gestor de TI • Admin</div>
            </button>
          </div>
        </div>

        <form class="space-y-4" @submit.prevent="handleLogin">
          <div>
            <label class="block text-xs font-semibold text-slate-700 mb-1">E-mail Corporativo</label>
            <input
              v-model="loginForm.email"
              type="email"
              required
              class="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-xs sm:text-sm focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none transition-all"
              placeholder="seu.nome@empresa.com.br"
            />
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-700 mb-1">Senha de Acesso</label>
            <input
              v-model="loginForm.password"
              type="password"
              required
              class="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-xs sm:text-sm focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none transition-all"
              placeholder="••••••••••••"
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
            class="w-full py-2.5 rounded-lg bg-gradient-to-r from-brand to-indigo-600 hover:from-brand-dark hover:to-indigo-700 text-white text-xs font-bold uppercase tracking-wider transition-all shadow-md shadow-brand/20 disabled:opacity-50"
          >
            {{ loading ? 'Autenticando...' : 'Acessar Central Corporativa' }}
          </button>
        </form>

        <p class="text-[10px] text-center text-slate-400">
          Protegido com criptografia ponta a ponta • Conformidade CLT Art. 462 & LGPD
        </p>
      </div>
    </main>

    <!-- Authenticated Workspace -->
    <main v-else class="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
      <!-- Error Notification -->
      <div
        v-if="portalError"
        class="p-3.5 rounded-xl bg-red-50 text-red-800 border border-red-200 text-xs font-medium flex items-center justify-between gap-3"
      >
        <span>⚠️ {{ portalError }}</span>
        <button
          type="button"
          class="font-bold text-red-700 hover:text-red-900 underline"
          @click="refreshPortalData"
        >
          Recarregar dados
        </button>
      </div>

      <!-- Real-time Live Event Toast Banner -->
      <div
        v-if="liveBanner"
        class="p-3.5 rounded-xl bg-slate-900 text-slate-100 border border-emerald-500/40 text-xs font-sans flex items-center justify-between shadow-lg animate-in slide-in-from-top-2 duration-300"
      >
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
          <span class="font-semibold text-emerald-400">Atualização em Tempo Real:</span>
          <span class="text-slate-200">{{ liveBanner }}</span>
        </div>
        <button type="button" class="text-slate-400 hover:text-white px-2 py-0.5 text-xs font-bold" @click="liveBanner = ''">
          OK
        </button>
      </div>

      <!-- Employee Dashboard Quick Summary -->
      <div class="grid gap-3 sm:grid-cols-3">
        <div class="station-panel p-4 flex items-center justify-between border-l-4 border-l-brand">
          <div>
            <p class="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Equipamentos</p>
            <p class="text-xl font-black text-slate-900 mt-0.5">{{ assets.length }} Ativos</p>
            <p class="text-[10px] text-slate-500">Sob sua custódia direta</p>
          </div>
          <div class="w-10 h-10 rounded-xl bg-brand/10 text-brand flex items-center justify-center font-bold">
            💻
          </div>
        </div>

        <div
          class="station-panel p-4 flex items-center justify-between border-l-4"
          :class="pendingTermsCount > 0 ? 'border-l-amber-500' : 'border-l-emerald-500'"
        >
          <div>
            <p class="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Conformidade Legal</p>
            <p
              class="text-xl font-black mt-0.5"
              :class="pendingTermsCount > 0 ? 'text-amber-600' : 'text-emerald-600'"
            >
              {{ pendingTermsCount > 0 ? `${pendingTermsCount} Pendente` : '100% Regular' }}
            </p>
            <p class="text-[10px] text-slate-500">Termos CLT Art. 462</p>
          </div>
          <div
            class="w-10 h-10 rounded-xl flex items-center justify-center font-bold"
            :class="pendingTermsCount > 0 ? 'bg-amber-500/10 text-amber-600' : 'bg-emerald-500/10 text-emerald-600'"
          >
            📋
          </div>
        </div>

        <div class="station-panel p-4 flex items-center justify-between border-l-4 border-l-indigo-500">
          <div>
            <p class="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Atendimento de TI</p>
            <p class="text-xl font-black text-slate-900 mt-0.5">
              {{ tickets.filter(t => t.status !== 'resolved' && t.status !== 'closed').length }} Em Aberto
            </p>
            <p class="text-[10px] text-slate-500">{{ tickets.length }} chamados no histórico</p>
          </div>
          <div class="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center font-bold">
            🎧
          </div>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <nav class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-xs"
            :class="
              activeTab === 'custody'
                ? 'bg-slate-900 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300'
            "
            @click="activeTab = 'custody'"
          >
            Meus Equipamentos ({{ assets.length }})
          </button>

          <button
            type="button"
            class="px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-2"
            :class="
              activeTab === 'terms'
                ? 'bg-slate-900 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300'
            "
            @click="activeTab = 'terms'"
          >
            <span>Termos de Responsabilidade</span>
            <span
              v-if="pendingTermsCount > 0"
              class="px-2 py-0.5 rounded-full bg-amber-500 text-slate-950 text-[10px] font-black"
            >
              {{ pendingTermsCount }} pendente
            </span>
          </button>

          <button
            type="button"
            class="px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-xs"
            :class="
              activeTab === 'tickets'
                ? 'bg-slate-900 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300'
            "
            @click="activeTab = 'tickets'"
          >
            Central de Chamados ({{ tickets.length }})
          </button>
        </div>

        <button
          type="button"
          class="text-xs font-semibold text-slate-500 hover:text-brand transition-colors flex items-center gap-1"
          @click="refreshPortalData"
        >
          <span>Atualizar Dados</span>
          <span :class="loading ? 'animate-spin inline-block' : ''">↻</span>
        </button>
      </nav>

      <!-- Tab Content Panels -->
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
        :user-department="session.user.department || 'Engenharia de Produto'"
        :preselected-asset-tag="preselectedTag"
        @clear-preselected="preselectedTag = ''"
        @created="refreshPortalData"
      />
    </main>

    <!-- Professional Corporate Footer -->
    <footer class="bg-white border-t border-slate-200/80 py-4 text-center text-xs text-slate-400 mt-auto">
      <div class="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
        <p>© 2026 Nexus ITAM Enterprise • Plataforma de Gestão de Ativos & Service Desk</p>
        <div class="flex items-center gap-4 text-[11px]">
          <a
            :href="`${GATEWAY_BASE_URL}/docs`"
            target="_blank"
            rel="noopener noreferrer"
            class="text-slate-500 hover:text-brand font-medium transition-colors"
          >
            Documentação de Integração & APIs ↗
          </a>
        </div>
      </div>
    </footer>
  </div>
</template>
