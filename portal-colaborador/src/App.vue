<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import CustodyAssetsPanel from './components/CustodyAssetsPanel.vue';
import ResponsibilityTerms from './components/ResponsibilityTerms.vue';
import SupportTicketDesk from './components/SupportTicketDesk.vue';
import { useTheme } from './composables/useTheme';
import {
  GATEWAY_BASE_URL,
  clearStoredSession,
  getStoredSession,
  portalApi,
  saveStoredSession,
  setUnauthorizedHandler,
} from './services/nexusApi';

const { isDark, toggleTheme, applyBranding } = useTheme();

const WHITELABEL_STORAGE_KEY = 'nexus_portal_whitelabel_v3';

function sanitizeHexColor(value) {
  const raw = String(value || '').trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw) ? raw : '';
}

function sanitizeLogoUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw, window.location.origin);
    if (
      parsed.protocol === 'https:' ||
      (parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))
    ) {
      return parsed.toString();
    }
  } catch {
    return '';
  }
  return '';
}

function readInitialWhitelabel() {
  let cached = {};
  try {
    cached = JSON.parse(localStorage.getItem(WHITELABEL_STORAGE_KEY) || '{}') || {};
  } catch {
    cached = {};
  }

  const next = {
    companyName: String(cached.companyName || '').trim().slice(0, 80),
    primaryColor: sanitizeHexColor(cached.primaryColor),
    logoUrl: sanitizeLogoUrl(cached.logoUrl),
    whitelabel: Boolean(cached.whitelabel),
  };

  try {
    const params = new URLSearchParams(window.location.search);
    const paramEmpresa = params.get('empresa');
    const paramCor = sanitizeHexColor(params.get('cor'));
    const paramLogo = params.has('logo') ? sanitizeLogoUrl(params.get('logo')) : '';
    const hasParam =
      Boolean(paramEmpresa) || Boolean(paramCor) || Boolean(paramLogo) || params.get('wl') === '1';

    if (hasParam) {
      if (paramEmpresa) next.companyName = paramEmpresa.trim().slice(0, 80);
      if (paramCor) next.primaryColor = paramCor;
      if (paramLogo) next.logoUrl = paramLogo;
      if (params.get('wl') === '1' || paramCor || paramLogo) next.whitelabel = true;
      localStorage.setItem(WHITELABEL_STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    // URLSearchParams/localStorage indisponiveis em contexto restrito
  }

  return next;
}

const preLoginBranding = ref(readInitialWhitelabel());
const showPassword = ref(false);
const logoLoadError = ref(false);

const session = ref(getStoredSession());
const activeTab = ref('custody');
const loading = ref(false);
const authError = ref('');
const portalError = ref('');
const wsState = ref('disconnected');
const liveBanner = ref('');
const preselectedTag = ref('');

const loginForm = reactive({
  email: '',
  password: '',
});

const assets = ref([]);
const terms = ref([]);
const tickets = ref([]);

let streamHandle = null;
let bannerTimer = null;

function persistWhitelabelFromUser(user) {
  if (!user) return;
  const company = String(user.companyName || user.tenantName || user.tenant_name || '').trim().slice(0, 80);
  const color = sanitizeHexColor(user.primaryColor || user.primary_color);
  const logo = sanitizeLogoUrl(user.logoUrl || user.logo_url);
  if (!company && !color && !logo) return;
  const merged = {
    companyName: company || preLoginBranding.value.companyName,
    primaryColor: color || preLoginBranding.value.primaryColor,
    logoUrl: logo || preLoginBranding.value.logoUrl,
    whitelabel: Boolean(user.whitelabel ?? (Boolean(color) || Boolean(logo) || preLoginBranding.value.whitelabel)),
  };
  preLoginBranding.value = merged;
  try {
    localStorage.setItem(WHITELABEL_STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // ignore storage quota errors
  }
}

// Whitelabel computed properties
const companyName = computed(() => {
  return (
    session.value?.user?.companyName ||
    session.value?.user?.tenantName ||
    session.value?.user?.tenant_name ||
    preLoginBranding.value.companyName ||
    'Nexus ITAM'
  );
});

const companyInitial = computed(() => {
  const name = companyName.value || 'NX';
  return name.slice(0, 2).toUpperCase();
});

const userLogoUrl = computed(() => {
  if (logoLoadError.value) return '';
  return (
    sanitizeLogoUrl(session.value?.user?.logoUrl || session.value?.user?.logo_url) ||
    preLoginBranding.value.logoUrl ||
    ''
  );
});

const brandColor = computed(() => {
  return (
    sanitizeHexColor(session.value?.user?.primaryColor || session.value?.user?.primary_color) ||
    preLoginBranding.value.primaryColor ||
    null
  );
});

const isBrandedContext = computed(() => {
  return Boolean(
    preLoginBranding.value.whitelabel ||
      brandColor.value ||
      userLogoUrl.value ||
      (companyName.value && companyName.value !== 'Nexus ITAM'),
  );
});

watch(
  () => session.value?.user?.logoUrl || session.value?.user?.logo_url || preLoginBranding.value.logoUrl,
  () => {
    logoLoadError.value = false;
  },
);

// Atualiza o CSS dinâmico de cores Whitelabel sempre que o usuário possuir primaryColor
watch(
  brandColor,
  (color) => {
    applyBranding(color || null);
  },
  { immediate: true },
);

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
      liveBanner.value = `Atualização recebida em tempo real (${frame.event}) via NexusDesk`;
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
    persistWhitelabelFromUser(res.user);
    const brand = res.user?.primaryColor || res.user?.primary_color;
    if (brand) {
      applyBranding(brand);
    }
    await refreshPortalData();
    startWebSocket();
  } catch (err) {
    authError.value = err.message;
  } finally {
    loading.value = false;
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
      persistWhitelabelFromUser(profile);
      const brand = profile.primaryColor || profile.primary_color;
      if (brand) {
        applyBranding(brand);
      }
      await refreshPortalData();
      startWebSocket();
    } catch {
      // 401 interceptor cuida da limpeza
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
  <div class="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors duration-200">
    <!-- Top Executive Header -->
    <header class="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200/90 dark:border-slate-800/80 sticky top-0 z-40">
      <div class="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        <!-- Brand & Identity -->
        <div class="flex items-center gap-3 min-w-0">
          <div
            v-if="userLogoUrl"
            class="w-10 h-10 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex items-center justify-center p-1 shrink-0"
          >
            <img :src="userLogoUrl" :alt="companyName" class="w-full h-full object-contain" @error="logoLoadError = true" />
          </div>
          <div
            v-else
            class="w-10 h-10 rounded-xl bg-gradient-to-tr from-brand to-brand-dark flex items-center justify-center font-black text-sm tracking-tight text-white shadow-md shadow-brand/20 shrink-0"
          >
            {{ companyInitial }}
          </div>

          <div class="truncate">
            <div class="flex items-center gap-2">
              <span class="font-black text-sm tracking-tight text-slate-900 dark:text-white truncate">
                {{ companyName }}
              </span>
              <span
                class="hidden sm:inline-flex text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 items-center gap-1.5"
              >
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Portal do Colaborador
              </span>
            </div>
            <p class="text-[11px] text-slate-500 dark:text-slate-400 truncate">
              Custódia Patrimonial CLT & Autoatendimento de TI
            </p>
          </div>
        </div>

        <!-- Controls: WebSocket, Theme Switch, Profile, Logout -->
        <div class="flex items-center gap-2.5 sm:gap-3">
          <!-- WebSocket Pulse Beacon (Only when logged in) -->
          <div
            v-if="session?.user"
            class="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-mono text-slate-700 dark:text-slate-300"
            :title="wsState === 'connected' ? 'WebSocket em tempo real ativo' : 'Reconectando canal WebSocket...'"
          >
            <span
              class="w-2 h-2 rounded-full"
              :class="wsState === 'connected' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400 animate-ping'"
            />
            <span class="font-medium">{{ wsState === 'connected' ? 'Tempo Real Ativo' : 'Sincronizando...' }}</span>
          </div>

          <!-- Theme Toggle Switch (Sun / Moon) -->
          <button
            type="button"
            class="p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-brand dark:hover:text-brand hover:border-brand/40 transition-all cursor-pointer"
            :title="isDark ? 'Alternar para tema claro' : 'Alternar para tema escuro'"
            aria-label="Alternar tema"
            @click="toggleTheme"
          >
            <span v-if="isDark" class="text-sm">☀️</span>
            <span v-else class="text-sm">🌙</span>
          </button>

          <!-- User Badge & Logout -->
          <template v-if="session?.user">
            <div class="hidden md:flex items-center gap-2 px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
              <div
                class="w-7 h-7 rounded-lg bg-brand/10 text-brand font-black text-xs flex items-center justify-center uppercase"
              >
                {{ (session.user.name || 'CL').slice(0, 2) }}
              </div>
              <div class="text-left text-xs">
                <p class="font-bold text-slate-900 dark:text-white leading-tight">
                  {{ session.user.name }}
                </p>
                <p class="text-[10px] text-slate-500 dark:text-slate-400">
                  {{ session.user.department || 'Geral' }}
                </p>
              </div>
            </div>

            <button
              type="button"
              class="text-xs font-bold px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
              @click="handleLogout('')"
            >
              Sair
            </button>
          </template>
        </div>
      </div>
    </header>

    <!-- Login View (When not logged in) -->
    <main
      v-if="!session?.user"
      class="flex-1 portal-login-backdrop relative overflow-hidden flex items-center justify-center px-4 py-8 sm:px-6 lg:px-8"
    >
      <div class="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-stretch relative z-10">
        <!-- Left Executive Showcase Column -->
        <section class="lg:col-span-7 station-panel p-7 sm:p-9 cert-guilloche-bg flex flex-col justify-between gap-7 relative overflow-hidden">
          <div class="space-y-5">
            <div class="flex flex-wrap items-center gap-2">
              <span class="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-3 py-1 rounded-full bg-brand/10 text-brand border border-brand/20">
                <span class="w-1.5 h-1.5 rounded-full bg-brand animate-pulse" />
                {{ isBrandedContext ? `Ambiente Exclusivo • ${companyName}` : 'Nexus ITAM • Portal Corporativo' }}
              </span>
              <span class="mono-tag">
                HMAC-SHA256 &bull; LGPD
              </span>
            </div>

            <div class="space-y-3">
              <h1 class="text-2xl sm:text-4xl font-black tracking-tight text-slate-900 dark:text-white leading-[1.12]">
                Seu passaporte patrimonial e suporte técnico em um só lugar
              </h1>
              <p class="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed max-w-xl">
                Consulte equipamentos vinculados ao seu crachá digital, assine Termos de Responsabilidade CLT com autenticidade criptográfica e abra chamados de TI N1/N2 com atualização instantânea.
              </p>
            </div>
          </div>

          <!-- Key Pillars Grid -->
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div class="p-4 rounded-xl bg-slate-50/90 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/70 space-y-1.5">
              <div class="w-8 h-8 rounded-lg bg-brand/10 text-brand flex items-center justify-center">
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="2" y="3" width="20" height="14" rx="2" />
                  <path d="M8 21h8M12 17v4" />
                </svg>
              </div>
              <h2 class="text-xs font-black text-slate-900 dark:text-white">
                Custódia Auditada
              </h2>
              <p class="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                Ativos em sua posse com número de série, patrimônio e histórico completo.
              </p>
            </div>

            <div class="p-4 rounded-xl bg-slate-50/90 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/70 space-y-1.5">
              <div class="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
              </div>
              <h2 class="text-xs font-black text-slate-900 dark:text-white">
                Termo CLT Digital
              </h2>
              <p class="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                Selo HMAC-SHA256 e comprovação conforme Art. 462 &sect;1&ordm; da CLT.
              </p>
            </div>

            <div class="p-4 rounded-xl bg-slate-50/90 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/70 space-y-1.5">
              <div class="w-8 h-8 rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400 flex items-center justify-center">
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <h2 class="text-xs font-black text-slate-900 dark:text-white">
                Service Desk N1/N2
              </h2>
              <p class="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                Abertura direta por patrimônio com retorno em tempo real via WebSocket.
              </p>
            </div>
          </div>

          <!-- Compliance Footer inside Hero -->
          <div class="pt-4 border-t border-slate-200/70 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-500 dark:text-slate-400">
            <span class="inline-flex items-center gap-1.5 font-semibold">
              <svg class="w-3.5 h-3.5 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              Privacidade LGPD (Lei 13.709/2018) &bull; Sem telemetria invasiva
            </span>
            <span class="font-mono text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Scrypt Zero-Trust Auth
            </span>
          </div>
        </section>

        <!-- Right Authentication Card Column -->
        <section class="lg:col-span-5 flex">
          <div class="w-full station-panel p-7 sm:p-8 flex flex-col justify-between space-y-6 shadow-2xl border-t-4 border-t-brand">
            <div class="space-y-4">
              <div class="flex items-center gap-3.5">
                <div
                  v-if="userLogoUrl"
                  class="w-12 h-12 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex items-center justify-center p-1.5 shadow-sm shrink-0"
                >
                  <img :src="userLogoUrl" :alt="companyName" class="w-full h-full object-contain" @error="logoLoadError = true" />
                </div>
                <div
                  v-else
                  class="w-12 h-12 rounded-2xl bg-gradient-to-tr from-brand to-brand-dark flex items-center justify-center font-black text-base text-white shadow-lg shadow-brand/25 shrink-0"
                >
                  {{ companyInitial }}
                </div>
                <div class="min-w-0">
                  <p class="text-[10px] font-bold uppercase tracking-widest text-brand">
                    Acesso Autenticado
                  </p>
                  <h2 class="text-lg sm:text-xl font-black tracking-tight text-slate-900 dark:text-white truncate">
                    {{ companyName }}
                  </h2>
                </div>
              </div>

              <p class="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Entre com seu e-mail corporativo e a senha provisória enviada pelo seu gestor de TI ou RH.
              </p>
            </div>

            <form class="space-y-4" @submit.prevent="handleLogin">
              <div>
                <label for="portal-login-email" class="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  E-mail Corporativo
                </label>
                <div class="relative">
                  <span class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500">
                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect width="20" height="16" x="2" y="4" rx="2" />
                      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                    </svg>
                  </span>
                  <input
                    id="portal-login-email"
                    v-model.trim="loginForm.email"
                    type="email"
                    autocomplete="email"
                    required
                    class="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/90 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 pl-10 pr-3.5 py-2.5 text-xs sm:text-sm focus:bg-white dark:focus:bg-slate-800 focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none transition-all"
                    placeholder="colaborador@empresa.com.br"
                  />
                </div>
              </div>

              <div>
                <label for="portal-login-password" class="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  Senha de Acesso
                </label>
                <div class="relative">
                  <span class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500">
                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </span>
                  <input
                    id="portal-login-password"
                    v-model="loginForm.password"
                    :type="showPassword ? 'text' : 'password'"
                    autocomplete="current-password"
                    required
                    class="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/90 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 pl-10 pr-11 py-2.5 text-xs sm:text-sm focus:bg-white dark:focus:bg-slate-800 focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none transition-all"
                    placeholder="••••••••••••"
                  />
                  <button
                    type="button"
                    class="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors cursor-pointer"
                    :aria-label="showPassword ? 'Ocultar senha' : 'Exibir senha'"
                    :title="showPassword ? 'Ocultar senha' : 'Exibir senha'"
                    @click="showPassword = !showPassword"
                  >
                    <svg v-if="showPassword" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                      <line x1="2" x2="22" y1="2" y2="22" />
                    </svg>
                    <svg v-else class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  </button>
                </div>
              </div>

              <div
                v-if="authError"
                role="alert"
                class="p-3.5 rounded-xl bg-red-500/10 border border-red-500/25 text-xs text-red-700 dark:text-red-300 font-semibold flex items-start gap-2.5"
              >
                <svg class="w-4 h-4 text-red-500 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" x2="12" y1="8" y2="12" />
                  <line x1="12" x2="12.01" y1="16" y2="16" />
                </svg>
                <span>{{ authError }}</span>
              </div>

              <button
                type="submit"
                :disabled="loading"
                class="w-full py-3 rounded-xl bg-brand hover:bg-brand-dark text-white text-xs font-bold uppercase tracking-wider transition-all shadow-lg shadow-brand/25 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
              >
                <span v-if="loading" class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>{{ loading ? 'Autenticando...' : 'Acessar Central Corporativa' }}</span>
              </button>
            </form>

            <div class="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              <p class="font-semibold text-slate-600 dark:text-slate-300">
                Precisa de acesso ou redefinição de senha?
              </p>
              <p class="leading-relaxed">
                Solicite ao gestor de TI da sua empresa na tela <strong class="font-semibold text-slate-700 dark:text-slate-200">Portal Colaboradores</strong> para gerar uma nova credencial.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>

    <!-- Authenticated Workspace View -->
    <main v-else class="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
      <!-- Error Notification -->
      <div
        v-if="portalError"
        class="p-4 rounded-2xl bg-red-500/10 text-red-800 dark:text-red-300 border border-red-500/20 text-xs font-semibold flex items-center justify-between gap-3 shadow-xs"
      >
        <span>⚠️ {{ portalError }}</span>
        <button
          type="button"
          class="font-bold text-red-700 dark:text-red-400 hover:underline cursor-pointer"
          @click="refreshPortalData"
        >
          Recarregar dados
        </button>
      </div>

      <!-- Real-time Live Event Toast Banner -->
      <div
        v-if="liveBanner"
        class="p-3.5 rounded-2xl bg-slate-900 dark:bg-slate-800 text-white border border-emerald-500/40 text-xs font-sans flex items-center justify-between shadow-xl animate-in slide-in-from-top-2 duration-300"
      >
        <div class="flex items-center gap-2.5">
          <span class="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
          <span class="font-bold text-emerald-400">Atualização em Tempo Real:</span>
          <span class="text-slate-200">{{ liveBanner }}</span>
        </div>
        <button
          type="button"
          class="text-slate-400 hover:text-white px-2 py-0.5 text-xs font-bold cursor-pointer"
          @click="liveBanner = ''"
        >
          ✕
        </button>
      </div>

      <!-- Employee Dashboard Quick Summary -->
      <div class="grid gap-3.5 sm:grid-cols-3">
        <!-- Equipamentos sob custódia -->
        <div class="station-panel p-4 flex items-center justify-between border-l-4 border-l-brand">
          <div>
            <p class="text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Equipamentos sob Custódia
            </p>
            <p class="text-2xl font-black text-slate-900 dark:text-white mt-1">
              {{ assets.length }} Ativos
            </p>
            <p class="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
              Vinculados à sua matrícula
            </p>
          </div>
          <div class="w-11 h-11 rounded-2xl bg-brand/10 text-brand flex items-center justify-center font-bold text-xl">
            💻
          </div>
        </div>

        <!-- Conformidade CLT -->
        <div
          class="station-panel p-4 flex items-center justify-between border-l-4"
          :class="pendingTermsCount > 0 ? 'border-l-amber-500' : 'border-l-emerald-500'"
        >
          <div>
            <p class="text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Conformidade Jurídica CLT
            </p>
            <p
              class="text-2xl font-black mt-1"
              :class="pendingTermsCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'"
            >
              {{ pendingTermsCount > 0 ? `${pendingTermsCount} Pendente` : '100% Regular' }}
            </p>
            <p class="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
              Termos Art. 462 §1º
            </p>
          </div>
          <div
            class="w-11 h-11 rounded-2xl flex items-center justify-center font-bold text-xl"
            :class="pendingTermsCount > 0 ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'"
          >
            📋
          </div>
        </div>

        <!-- Atendimento de TI -->
        <div class="station-panel p-4 flex items-center justify-between border-l-4 border-l-indigo-500">
          <div>
            <p class="text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Atendimento de TI
            </p>
            <p class="text-2xl font-black text-slate-900 dark:text-white mt-1">
              {{ tickets.filter(t => t.status !== 'resolved' && t.status !== 'closed').length }} Em Aberto
            </p>
            <p class="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
              {{ tickets.length }} chamados no histórico
            </p>
          </div>
          <div class="w-11 h-11 rounded-2xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold text-xl">
            🎧
          </div>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <nav class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
            :class="
              activeTab === 'custody'
                ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-sm'
                : 'station-panel text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700'
            "
            @click="activeTab = 'custody'"
          >
            Meus Equipamentos ({{ assets.length }})
          </button>

          <button
            type="button"
            class="px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-2 cursor-pointer"
            :class="
              activeTab === 'terms'
                ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-sm'
                : 'station-panel text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700'
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
            class="px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
            :class="
              activeTab === 'tickets'
                ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-sm'
                : 'station-panel text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700'
            "
            @click="activeTab = 'tickets'"
          >
            Central de Chamados ({{ tickets.length }})
          </button>
        </div>

        <button
          type="button"
          class="text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-brand transition-colors flex items-center gap-1.5 cursor-pointer py-1.5 px-3 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
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
        :user-department="session.user.department || 'Geral'"
        :preselected-asset-tag="preselectedTag"
        @clear-preselected="preselectedTag = ''"
        @created="refreshPortalData"
      />
    </main>

    <!-- Professional Corporate Footer -->
    <footer class="bg-white dark:bg-slate-900 border-t border-slate-200/80 dark:border-slate-800/80 py-4 text-center text-xs text-slate-400 dark:text-slate-500 mt-auto">
      <div class="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
        <p>© 2026 {{ companyName }} • Gestão Patrimonial de TI & Service Desk</p>
        <div class="flex items-center gap-4 text-[11px]">
          <a
            :href="`${GATEWAY_BASE_URL}/docs`"
            target="_blank"
            rel="noopener noreferrer"
            class="text-slate-500 dark:text-slate-400 hover:text-brand font-bold transition-colors"
          >
            Catálogo de Integração & APIs ↗
          </a>
        </div>
      </div>
    </footer>
  </div>
</template>
