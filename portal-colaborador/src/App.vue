<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import CustodyAssetsPanel from './components/CustodyAssetsPanel.vue';
import CorporateCloudDrive from './components/CorporateCloudDrive.vue';
import FirstAccessTour from './components/FirstAccessTour.vue';
import PortalIcon from './components/PortalIcon.vue';
import ResponsibilityTerms from './components/ResponsibilityTerms.vue';
import SupportTicketDesk from './components/SupportTicketDesk.vue';
import { parseColor, toHex, useTheme } from './composables/useTheme';
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
const TOUR_STORAGE_PREFIX = 'nexus_portal_tour_v1';
const VALID_TABS = ['custody', 'terms', 'tickets', 'cloud'];

function readInitialTab() {
  try {
    const param = new URLSearchParams(window.location.search).get('tab');
    return VALID_TABS.includes(param) ? param : 'custody';
  } catch {
    return 'custody';
  }
}

function syncTabQuery(tabId) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tabId);
    window.history.replaceState(null, '', url.toString());
  } catch {
    // history API indisponível
  }
}

function sanitizeHexColor(value) {
  const parsed = parseColor(value);
  if (!parsed) return '';
  const hex = toHex(parsed);
  // Ignora o roxo antigo (#4f46e5) herdado de seeds legados do backend
  if (hex.toLowerCase() === '#4f46e5') return '';
  return hex;
}

const DATA_IMAGE_URI_RE =
  /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/i;
const MAX_QUERY_LOGO_LENGTH = 1024;
const MAX_DATA_LOGO_LENGTH = 512 * 1024;

function sanitizeLogoUrl(value, { allowDataUri = false } = {}) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (allowDataUri && raw.length <= MAX_DATA_LOGO_LENGTH && DATA_IMAGE_URI_RE.test(raw)) {
    return raw;
  }
  if (!allowDataUri && (raw.length > MAX_QUERY_LOGO_LENGTH || /^data:/i.test(raw))) {
    return '';
  }
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
    logoUrl: sanitizeLogoUrl(cached.logoUrl, { allowDataUri: true }),
    whitelabel: Boolean(cached.whitelabel),
  };

  try {
    const url = new URL(window.location.href);
    const params = url.searchParams;
    const paramEmpresa = params.get('empresa')?.trim().slice(0, 80) || '';
    const paramCor = sanitizeHexColor(params.get('cor'));
    const paramLogo = params.has('logo')
      ? sanitizeLogoUrl(params.get('logo'), { allowDataUri: false })
      : '';
    const hasParam =
      Boolean(paramEmpresa) || Boolean(paramCor) || Boolean(paramLogo) || params.get('wl') === '1';

    if (params.has('logo') && !paramLogo) {
      params.delete('logo');
      try {
        window.history.replaceState(null, '', url.toString());
      } catch {
        // history API indisponível
      }
    }

    if (hasParam) {
      const switchedCompany =
        Boolean(paramEmpresa) &&
        Boolean(next.companyName) &&
        paramEmpresa.toLowerCase() !== next.companyName.toLowerCase();

      if (switchedCompany) {
        next.logoUrl = paramLogo;
        next.primaryColor = paramCor;
        next.whitelabel = params.get('wl') === '1' || Boolean(paramCor) || Boolean(paramLogo);
      } else {
        if (paramCor) next.primaryColor = paramCor;
        if (paramLogo) next.logoUrl = paramLogo;
        if (params.get('wl') === '1' || paramCor || paramLogo) next.whitelabel = true;
      }
      if (paramCor) next.fromQueryCor = true;
      if (paramEmpresa) next.companyName = paramEmpresa;
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
const activeTab = ref(readInitialTab());
const loading = ref(false);
const authError = ref('');
const authStatusMessage = ref('');
const loadError = ref('');
const wsState = ref('disconnected');
const liveBanner = ref('');
const preselectedTag = ref('');
const latestTicketEvent = ref(null);
const latestSheetEvent = ref(null);
const unreadTicketMessages = ref(0);
const showFirstAccessTour = ref(false);
const tourIsReplay = ref(false);
const tourCheckedUserKey = ref('');

function getTourStorageKey(user) {
  if (!user) return '';
  const tenant = String(user.tenantId || user.tenant_id || 'default').toLowerCase().trim();
  const identity = String(user.email || user.id || user.sub || '').toLowerCase().trim();
  if (!identity) return '';
  return `${TOUR_STORAGE_PREFIX}:${tenant}:${identity}`;
}

function hasSeenFirstAccessTour(user) {
  const key = getTourStorageKey(user);
  if (!key) return true;
  try {
    return Boolean(localStorage.getItem(key));
  } catch {
    return true;
  }
}

function markFirstAccessTourSeen(user, status = 'completed') {
  const key = getTourStorageKey(user);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify({ status, seenAt: new Date().toISOString() }));
  } catch {
    // ignore storage quota errors
  }
}

function maybeLaunchFirstAccessTour(user) {
  const key = getTourStorageKey(user);
  if (!key || tourCheckedUserKey.value === key) return;
  tourCheckedUserKey.value = key;

  let tourParam = '';
  try {
    tourParam = new URLSearchParams(window.location.search).get('tour') || '';
  } catch {
    tourParam = '';
  }

  if (tourParam === '0') return;
  if (tourParam === '1' || !hasSeenFirstAccessTour(user)) {
    tourIsReplay.value = tourParam === '1' && hasSeenFirstAccessTour(user);
    showFirstAccessTour.value = true;
  }
}

function openTourReplay() {
  tourIsReplay.value = true;
  showFirstAccessTour.value = true;
}

function handleTourClose({ reason = 'skipped' } = {}) {
  markFirstAccessTourSeen(session.value?.user, reason);
  showFirstAccessTour.value = false;
}

function handleTourComplete({ targetTab = 'custody' } = {}) {
  markFirstAccessTourSeen(session.value?.user, 'completed');
  showFirstAccessTour.value = false;
  if (targetTab && VALID_TABS.includes(targetTab)) {
    selectTab(targetTab);
  }
}

const emailInputRef = ref(null);
const passwordInputRef = ref(null);
const tabButtonRefs = ref([]);

const loginForm = reactive({
  email: '',
  password: '',
});

const fieldErrors = reactive({
  email: '',
  password: '',
});

const assets = ref([]);
const terms = ref([]);
const tickets = ref([]);

let streamHandle = null;
let bannerTimer = null;
let wsRefreshTimer = null;

const currentYear = new Date().getFullYear();

function persistWhitelabelFromUser(user) {
  if (!user) return;
  const company = String(user.companyName || user.tenantName || user.tenant_name || '')
    .trim()
    .slice(0, 80);
  const color = sanitizeHexColor(user.primaryColor || user.primary_color);
  const logo = sanitizeLogoUrl(user.logoUrl || user.logo_url, { allowDataUri: true });
  if (!company && !color && !logo) return;
  const effectiveColor =
    preLoginBranding.value.fromQueryCor && preLoginBranding.value.primaryColor
      ? preLoginBranding.value.primaryColor
      : color || preLoginBranding.value.primaryColor;
  const merged = {
    companyName: company || preLoginBranding.value.companyName,
    primaryColor: effectiveColor,
    logoUrl: logo || preLoginBranding.value.logoUrl,
    fromQueryCor: Boolean(preLoginBranding.value.fromQueryCor),
    whitelabel: Boolean(
      user.whitelabel ??
        (Boolean(effectiveColor) || Boolean(logo) || preLoginBranding.value.whitelabel),
    ),
  };
  preLoginBranding.value = merged;
  try {
    localStorage.setItem(WHITELABEL_STORAGE_KEY, JSON.stringify(merged));
  } catch {
    try {
      localStorage.setItem(WHITELABEL_STORAGE_KEY, JSON.stringify({ ...merged, logoUrl: '' }));
    } catch {
      // ignore storage quota errors
    }
  }
}

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
    sanitizeLogoUrl(session.value?.user?.logoUrl || session.value?.user?.logo_url, {
      allowDataUri: true,
    }) ||
    preLoginBranding.value.logoUrl ||
    ''
  );
});

const brandColor = computed(() => {
  if (preLoginBranding.value.fromQueryCor && preLoginBranding.value.primaryColor) {
    return preLoginBranding.value.primaryColor;
  }
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

watch(
  brandColor,
  (color) => {
    applyBranding(color || null);
  },
  { immediate: true },
);

watch(activeTab, (nextTab) => {
  if (session.value?.user) {
    syncTabQuery(nextTab);
  }
});

const pendingTermsCount = computed(() => terms.value.filter((t) => t.status === 'pending').length);
const revokedTermsCount = computed(() => terms.value.filter((t) => t.status === 'revoked').length);
const signedTermsCount = computed(() => terms.value.filter((t) => t.status === 'signed').length);
const openTicketsCount = computed(
  () => tickets.value.filter((t) => t.status !== 'resolved' && t.status !== 'closed').length,
);

const termsSummary = computed(() => {
  if (pendingTermsCount.value > 0) {
    const word = pendingTermsCount.value === 1 ? 'pendente' : 'pendentes';
    return {
      headline: `${pendingTermsCount.value} ${word}`,
      subtitle: 'Termos Art. 462 §1º',
      borderCls: 'border-l-amber-600 dark:border-l-amber-400',
      textCls: 'text-amber-800 dark:text-amber-300',
      iconCls: 'bg-amber-500/10 text-amber-800 dark:text-amber-300',
    };
  }
  if (revokedTermsCount.value > 0) {
    const word = revokedTermsCount.value === 1 ? 'revogado' : 'revogados';
    return {
      headline: '0 pendentes',
      subtitle: `${revokedTermsCount.value} ${word} • Art. 462 §1º`,
      borderCls: 'border-l-slate-400 dark:border-l-zinc-500',
      textCls: 'text-slate-900 dark:text-[#fafafa]',
      iconCls: 'bg-slate-500/10 text-slate-700 dark:text-slate-200',
    };
  }
  if (signedTermsCount.value > 0) {
    return {
      headline: '100% Regular',
      subtitle: 'Termos Art. 462 §1º',
      borderCls: 'border-l-emerald-600 dark:border-l-emerald-400',
      textCls: 'text-emerald-700 dark:text-emerald-300',
      iconCls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    };
  }
  return {
    headline: '0 pendentes',
    subtitle: 'Nenhum termo emitido',
    borderCls: 'border-l-slate-400 dark:border-l-zinc-500',
    textCls: 'text-slate-900 dark:text-[#fafafa]',
    iconCls: 'bg-slate-500/10 text-slate-700 dark:text-slate-200',
  };
});

const portalTabs = computed(() => [
  { id: 'custody', label: `Meus equipamentos (${assets.value.length})` },
  { id: 'terms', label: 'Termos de responsabilidade', badge: pendingTermsCount.value },
  {
    id: 'tickets',
    label: `Central de chamados (${tickets.value.length})`,
    badge: unreadTicketMessages.value,
  },
  { id: 'cloud', label: 'Arquivos & Nuvem' },
]);

function selectTab(tabId) {
  if (!VALID_TABS.includes(tabId)) return;
  activeTab.value = tabId;
  if (tabId === 'tickets') {
    unreadTicketMessages.value = 0;
  }
}

function onTabKeydown(event) {
  const currentIndex = VALID_TABS.indexOf(activeTab.value);
  if (currentIndex === -1) return;

  let nextIndex = null;
  if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % VALID_TABS.length;
  else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + VALID_TABS.length) % VALID_TABS.length;
  else if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = VALID_TABS.length - 1;

  if (nextIndex === null) return;
  event.preventDefault();
  const nextId = VALID_TABS[nextIndex];
  selectTab(nextId);
  tabButtonRefs.value[nextIndex]?.focus();
}

async function loadWorkspaceData({ background = false } = {}) {
  if (!session.value?.token) return;
  const hasExistingData =
    assets.value.length > 0 || terms.value.length > 0 || tickets.value.length > 0;
  if (!background || !hasExistingData) {
    loading.value = true;
  }
  loadError.value = '';
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
    if (!background || !hasExistingData) {
      loadError.value = err.message || 'Não foi possível carregar os dados do portal.';
    }
  } finally {
    loading.value = false;
  }
}

function scheduleBackgroundRefresh() {
  clearTimeout(wsRefreshTimer);
  wsRefreshTimer = setTimeout(() => {
    loadWorkspaceData({ background: true });
  }, 1500);
}

function sendTicketTyping(payload) {
  streamHandle?.sendTicketTyping(payload);
}

function startWebSocket() {
  if (streamHandle) streamHandle.disconnect();
  if (!session.value?.token) return;

  streamHandle = portalApi.connectRealtimeStream(
    session.value.token,
    (frame) => {
      const evt = String(frame?.event || '');
      if (!evt || evt === 'welcome' || evt === 'pong') return;

      if (evt.startsWith('sheet.')) {
        latestSheetEvent.value = {
          event: evt,
          data: frame?.data || {},
          timestamp: frame?.timestamp || new Date().toISOString(),
          seq: Date.now() + Math.random(),
        };
        return;
      }

      if (evt.startsWith('ticket.')) {
        latestTicketEvent.value = {
          event: evt,
          data: frame?.data || {},
          timestamp: frame?.timestamp || new Date().toISOString(),
          seq: Date.now() + Math.random(),
        };
        if (evt === 'ticket.typing') {
          return;
        }
        const senderEmail = String(frame?.data?.authorEmail || '').toLowerCase().trim();
        const myEmail = String(session.value?.user?.email || '').toLowerCase().trim();
        if (evt === 'ticket.commented' && senderEmail && senderEmail === myEmail) {
          scheduleBackgroundRefresh();
          return;
        }
        if (evt === 'ticket.commented' && activeTab.value !== 'tickets') {
          unreadTicketMessages.value += 1;
        }
      }

      const isBusinessEvent =
        evt.startsWith('ticket.') ||
        evt.startsWith('term.') ||
        evt.startsWith('asset.') ||
        evt.startsWith('audit.') ||
        evt === 'cluster.sync';
      if (!isBusinessEvent) return;

      liveBanner.value =
        evt === 'ticket.commented'
          ? `Nova mensagem no chamado ${frame?.data?.protocol || ''} de ${frame?.data?.authorName || 'TI'}`
          : `Atualização recebida em tempo real (${evt}) via NexusDesk`;
      scheduleBackgroundRefresh();
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => {
        liveBanner.value = '';
      }, 6000);
    },
    (status) => {
      wsState.value = status;
    },
    () => {
      scheduleBackgroundRefresh();
    },
  );
}

function validateLoginForm() {
  const trimmedEmail = loginForm.email.trim();
  fieldErrors.email = '';
  fieldErrors.password = '';

  if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    fieldErrors.email = 'Informe um e-mail corporativo válido.';
  }
  if (!loginForm.password) {
    fieldErrors.password = 'Informe sua senha de acesso.';
  }

  if (fieldErrors.email) {
    authStatusMessage.value = fieldErrors.email;
    emailInputRef.value?.focus();
    return false;
  }
  if (fieldErrors.password) {
    authStatusMessage.value = fieldErrors.password;
    passwordInputRef.value?.focus();
    return false;
  }
  return true;
}

async function handleLogin() {
  authError.value = '';
  authStatusMessage.value = '';
  loadError.value = '';

  if (!validateLoginForm()) return;

  loading.value = true;
  authStatusMessage.value = 'Autenticando credenciais…';
  try {
    const res = await portalApi.login(loginForm.email.trim(), loginForm.password);
    session.value = { token: res.accessToken, user: res.user };
    persistWhitelabelFromUser(res.user);
    applyBranding(brandColor.value || null);
    syncTabQuery(activeTab.value);
    await loadWorkspaceData();
    startWebSocket();
    maybeLaunchFirstAccessTour(session.value?.user);
    authStatusMessage.value = 'Sessão iniciada.';
  } catch (err) {
    authError.value = err.message || 'Falha ao autenticar no portal.';
    authStatusMessage.value = authError.value;
  } finally {
    loading.value = false;
  }
}

function handleLogout(reason = '') {
  if (streamHandle) {
    streamHandle.disconnect();
    streamHandle = null;
  }
  clearTimeout(bannerTimer);
  clearTimeout(wsRefreshTimer);
  clearStoredSession();
  session.value = null;
  assets.value = [];
  terms.value = [];
  tickets.value = [];
  wsState.value = 'disconnected';
  liveBanner.value = '';
  latestTicketEvent.value = null;
  unreadTicketMessages.value = 0;
  showFirstAccessTour.value = false;
  tourCheckedUserKey.value = '';
  loginForm.password = '';
  showPassword.value = false;
  fieldErrors.email = '';
  fieldErrors.password = '';
  authError.value = '';
  authStatusMessage.value = '';
  loadError.value = '';
  if (typeof reason === 'string' && reason) {
    authError.value = reason;
    authStatusMessage.value = reason;
  }
}

function handleReportIssue(asset) {
  preselectedTag.value = asset.internal_id || asset.internalId || '';
  selectTab('tickets');
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
      applyBranding(brandColor.value || null);
      syncTabQuery(activeTab.value);
      await loadWorkspaceData();
      if (session.value?.token) {
        startWebSocket();
        maybeLaunchFirstAccessTour(session.value?.user);
      }
    } catch (err) {
      if (session.value?.token) {
        const profileErr = err?.message || 'Não foi possível validar sua sessão. Tente novamente.';
        await loadWorkspaceData();
        if (session.value?.token) {
          if (!loadError.value) {
            loadError.value = profileErr;
          }
          startWebSocket();
          maybeLaunchFirstAccessTour(session.value?.user);
        }
      }
    }
  }
});

onBeforeUnmount(() => {
  setUnauthorizedHandler(null);
  clearTimeout(bannerTimer);
  clearTimeout(wsRefreshTimer);
  if (streamHandle) streamHandle.disconnect();
});
</script>

<template>
  <div
    class="min-h-screen flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-[#fafafa] transition-colors duration-200"
  >
    <!-- Top Executive Header -->
    <header
      class="bg-white/90 dark:bg-[#111113]/90 backdrop-blur-md border-b border-slate-200/90 dark:border-zinc-800 sticky top-0 z-40"
    >
      <a
        href="#main-content"
        class="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2.5 focus:rounded-xl focus:bg-brand focus:text-brand-fg focus:text-xs focus:font-semibold focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-brand-ring"
      >
        Pular para o conteúdo
      </a>

      <div class="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        <!-- Brand & Identity -->
        <div class="flex items-center gap-3 min-w-0">
          <div
            v-if="userLogoUrl"
            class="w-10 h-10 rounded-xl overflow-hidden border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 flex items-center justify-center p-1 shrink-0"
          >
            <img
              :src="userLogoUrl"
              :alt="companyName"
              class="w-full h-full object-contain"
              @error="logoLoadError = true"
            />
          </div>
          <div
            v-else
            class="w-10 h-10 rounded-xl bg-brand border border-black/10 dark:border-white/15 flex items-center justify-center font-bold text-sm tracking-tight text-brand-fg shadow-sm shrink-0"
          >
            {{ companyInitial }}
          </div>

          <div class="min-w-0">
            <div class="flex items-center gap-2 min-w-0">
              <span class="font-bold text-sm tracking-tight text-slate-900 dark:text-[#fafafa] truncate">
                {{ companyName }}
              </span>
              <span
                class="hidden sm:inline-flex text-xs font-semibold px-2.5 py-0.5 rounded-full bg-brand/10 text-brand-text-light dark:text-brand-text-dark border border-brand-ring/30 items-center gap-1.5 shrink-0"
              >
                <span class="w-1.5 h-1.5 rounded-full bg-brand" />
                Portal do Colaborador
              </span>
            </div>
            <p class="text-xs text-slate-600 dark:text-slate-300 truncate">
              Custódia patrimonial CLT e autoatendimento de TI
            </p>
          </div>
        </div>

        <!-- Controls: Live Status, Theme Switch, Profile, Logout -->
        <div class="flex items-center gap-2 sm:gap-3 shrink-0">
          <div
            v-if="session?.user"
            class="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 text-xs text-slate-700 dark:text-slate-200"
            :title="
              wsState === 'connected'
                ? 'Atualizações automáticas ativas'
                : 'Sincronizando atualizações em tempo real'
            "
          >
            <span
              class="w-2 h-2 rounded-full"
              :class="
                wsState === 'connected'
                  ? 'bg-emerald-600 dark:bg-emerald-400'
                  : 'bg-amber-600 dark:bg-amber-400'
              "
            />
            <span class="font-medium">
              {{ wsState === 'connected' ? 'Tempo real ativo' : 'Sincronizando…' }}
            </span>
          </div>

          <!-- Guided Tour Replay Button -->
          <button
            v-if="session?.user"
            type="button"
            data-testid="portal-replay-tour-btn"
            class="min-h-[44px] px-3 py-2 rounded-xl border border-brand-ring/35 bg-brand/10 hover:bg-brand/15 text-brand-text-light dark:text-brand-text-dark active:scale-[0.98] text-xs font-semibold transition-colors cursor-pointer inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
            title="Reabrir tour guiado do portal"
            aria-label="Abrir tour guiado do portal"
            @click="openTourReplay"
          >
            <PortalIcon name="compass" :size="16" />
            <span class="hidden lg:inline">Tour Guiado</span>
          </button>

          <!-- Theme Toggle Switch -->
          <button
            type="button"
            class="icon-btn min-h-[44px] min-w-[44px] p-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-700 dark:text-slate-200 hover:text-brand-text-light dark:hover:text-brand-text-dark hover:border-brand-ring/50 active:scale-[0.98] transition-colors cursor-pointer flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
            :title="isDark ? 'Alternar para tema claro' : 'Alternar para tema escuro'"
            :aria-label="isDark ? 'Alternar para tema claro' : 'Alternar para tema escuro'"
            :aria-pressed="isDark"
            @click="toggleTheme"
          >
            <PortalIcon v-if="isDark" name="sun" :size="18" />
          <PortalIcon v-else name="moon" :size="18" />
          </button>

          <!-- User Badge & Logout -->
          <template v-if="session?.user">
            <div
              class="hidden md:flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 min-w-0"
            >
              <div
                class="w-7 h-7 rounded-lg bg-brand/10 text-brand-text-light dark:text-brand-text-dark font-bold text-xs flex items-center justify-center uppercase shrink-0"
              >
                {{ (session.user.name || 'CL').slice(0, 2) }}
              </div>
              <div class="text-left text-xs min-w-0">
                <p class="font-semibold text-slate-900 dark:text-[#fafafa] leading-tight truncate max-w-[140px]">
                  {{ session.user.name }}
                </p>
                <p class="text-xs text-slate-600 dark:text-slate-300 truncate max-w-[140px]">
                  {{ session.user.department || 'Geral' }}
                </p>
              </div>
            </div>

            <button
              type="button"
              class="min-h-[44px] text-xs font-semibold px-3.5 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-slate-100 dark:hover:bg-zinc-800 active:scale-[0.98] text-slate-700 dark:text-slate-200 transition-colors cursor-pointer inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
              @click="handleLogout('')"
            >
              <PortalIcon name="log-out" :size="16" />
              <span>Encerrar sessão</span>
            </button>
          </template>
        </div>
      </div>
    </header>

    <!-- Login View (When not logged in) -->
    <main
      v-if="!session?.user"
      id="main-content"
      tabindex="-1"
      class="flex-1 portal-login-backdrop relative overflow-hidden flex items-center justify-center px-4 py-8 sm:px-6 lg:px-8 focus:outline-none"
    >
      <div class="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-stretch relative z-10">
        <!-- Showcase Column (Order 2 on mobile/tablet, Order 1 on desktop) -->
        <section
          class="order-2 lg:order-1 lg:col-span-7 station-panel p-6 sm:p-8 cert-guilloche-bg flex flex-col justify-between gap-6 relative overflow-hidden"
        >
          <div class="space-y-4">
            <div class="flex flex-wrap items-center gap-2">
              <span
                class="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full bg-brand/10 text-brand-text-light dark:text-brand-text-dark border border-brand-ring/30"
              >
                {{
                  isBrandedContext
                    ? `Ambiente corporativo • ${companyName}`
                    : 'Nexus ITAM • Portal Corporativo'
                }}
              </span>
              <span class="mono-tag">HMAC-SHA256 • LGPD</span>
            </div>

            <div class="space-y-2.5">
              <h1
                class="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-slate-900 dark:text-[#fafafa] leading-[1.15]"
              >
                Equipamentos sob sua guarda e suporte de TI
              </h1>
              <p class="text-sm text-slate-600 dark:text-slate-300 leading-relaxed max-w-xl">
                Consulte ativos atribuídos, assine termos digitais (Art. 462 §1º CLT) e acompanhe
                chamados com retorno direto da equipe técnica.
              </p>
            </div>
          </div>

          <!-- Key Pillars Grid -->
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div
              class="p-4 rounded-xl bg-slate-50/90 dark:bg-zinc-900/70 border border-slate-200/80 dark:border-zinc-800 space-y-2"
            >
              <div
                class="w-9 h-9 rounded-lg bg-brand/10 text-brand-text-light dark:text-brand-text-dark flex items-center justify-center"
              >
                <PortalIcon name="monitor" :size="18" />
              </div>
              <p class="text-sm font-semibold text-slate-900 dark:text-[#fafafa]">
                Custódia auditada
              </p>
              <p class="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Ativos em sua posse com número de série, patrimônio e histórico completo.
              </p>
            </div>

            <div
              class="p-4 rounded-xl bg-slate-50/90 dark:bg-zinc-900/70 border border-slate-200/80 dark:border-zinc-800 space-y-2"
            >
              <div
                class="w-9 h-9 rounded-lg bg-brand/10 text-brand-text-light dark:text-brand-text-dark flex items-center justify-center"
              >
                <PortalIcon name="shield-check" :size="18" />
              </div>
              <p class="text-sm font-semibold text-slate-900 dark:text-[#fafafa]">
                Termo CLT digital
              </p>
              <p class="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Selo HMAC-SHA256 e comprovação conforme Art. 462 &sect;1&ordm; da CLT.
              </p>
            </div>

            <div
              class="p-4 rounded-xl bg-slate-50/90 dark:bg-zinc-900/70 border border-slate-200/80 dark:border-zinc-800 space-y-2"
            >
              <div
                class="w-9 h-9 rounded-lg bg-brand/10 text-brand-text-light dark:text-brand-text-dark flex items-center justify-center"
              >
                <PortalIcon name="message-square" :size="18" />
              </div>
              <p class="text-sm font-semibold text-slate-900 dark:text-[#fafafa]">
                Service desk N1/N2
              </p>
              <p class="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Abertura direta por patrimônio com retorno imediato da equipe técnica.
              </p>
            </div>
          </div>

          <!-- Compliance Footer inside Hero -->
          <div
            class="pt-4 border-t border-slate-200/70 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600 dark:text-slate-300"
          >
            <span class="inline-flex items-center gap-1.5 font-medium">
              <PortalIcon name="shield-check" :size="16" class="text-brand-text-light dark:text-brand-text-dark" />
              <span>Privacidade LGPD (Lei 13.709/2018) • Acesso exclusivo do colaborador</span>
            </span>
          </div>
        </section>

        <!-- Authentication Card Column (Order 1 on mobile/tablet so form is immediately visible) -->
        <section class="order-1 lg:order-2 lg:col-span-5 flex">
          <div
            class="w-full station-panel p-6 sm:p-8 flex flex-col justify-between space-y-6 shadow-xl border-t-4 border-t-brand-ring"
          >
            <div class="space-y-4">
              <div class="flex items-center gap-3.5">
                <div
                  v-if="userLogoUrl"
                  class="w-12 h-12 rounded-2xl overflow-hidden border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 flex items-center justify-center p-1.5 shadow-sm shrink-0"
                >
                  <img
                    :src="userLogoUrl"
                    :alt="companyName"
                    class="w-full h-full object-contain"
                    @error="logoLoadError = true"
                  />
                </div>
                <div
                  v-else
                  class="w-12 h-12 rounded-2xl bg-brand border border-black/10 dark:border-white/15 flex items-center justify-center font-bold text-base text-brand-fg shadow-sm shrink-0"
                >
                  {{ companyInitial }}
                </div>
                <div class="min-w-0">
                  <p class="text-xs font-semibold text-brand-text-light dark:text-brand-text-dark">
                    Acesso autenticado
                  </p>
                  <h2
                    class="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-[#fafafa] truncate"
                  >
                    {{ companyName }}
                  </h2>
                </div>
              </div>

              <p class="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                Entre com seu e-mail corporativo e a senha enviada pela equipe de TI ou RH.
              </p>
            </div>

            <form class="space-y-4" novalidate @submit.prevent="handleLogin">
              <div>
                <label
                  for="portal-login-email"
                  class="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5"
                >
                  E-mail corporativo
                </label>
                <div class="relative">
                  <span
                    class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400"
                  >
                    <PortalIcon name="mail" :size="16" />
                  </span>
                  <input
                    id="portal-login-email"
                    ref="emailInputRef"
                    v-model.trim="loginForm.email"
                    name="email"
                    type="email"
                    inputmode="email"
                    spellcheck="false"
                    autocomplete="email"
                    required
                    :aria-invalid="Boolean(fieldErrors.email)"
                    :aria-describedby="fieldErrors.email ? 'portal-login-email-error' : undefined"
                    class="w-full min-h-[44px] rounded-xl border bg-slate-50/70 dark:bg-zinc-900 text-slate-900 dark:text-[#fafafa] placeholder-slate-500 dark:placeholder-slate-400 pl-10 pr-3.5 py-2.5 text-sm focus:bg-white dark:focus:bg-zinc-900 focus:border-brand-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring transition-colors"
                    :class="
                      fieldErrors.email
                        ? 'border-rose-600 dark:border-rose-400'
                        : 'border-slate-300 dark:border-zinc-700'
                    "
                    placeholder="nome@empresa.com.br…"
                    @input="fieldErrors.email = ''"
                  />
                </div>
                <p
                  v-if="fieldErrors.email"
                  id="portal-login-email-error"
                  role="alert"
                  class="mt-1.5 text-xs font-medium text-rose-700 dark:text-rose-300"
                >
                  {{ fieldErrors.email }}
                </p>
              </div>

              <div>
                <label
                  for="portal-login-password"
                  class="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5"
                >
                  Senha de acesso
                </label>
                <div class="relative">
                  <span
                    class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400"
                  >
                    <PortalIcon name="lock" :size="16" />
                  </span>
                  <input
                    id="portal-login-password"
                    ref="passwordInputRef"
                    v-model="loginForm.password"
                    name="password"
                    :type="showPassword ? 'text' : 'password'"
                    autocomplete="current-password"
                    required
                    :aria-invalid="Boolean(fieldErrors.password)"
                    :aria-describedby="fieldErrors.password ? 'portal-login-password-error' : undefined"
                    class="w-full min-h-[44px] rounded-xl border bg-slate-50/70 dark:bg-zinc-900 text-slate-900 dark:text-[#fafafa] placeholder-slate-500 dark:placeholder-slate-400 pl-10 pr-12 py-2.5 text-sm focus:bg-white dark:focus:bg-zinc-900 focus:border-brand-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring transition-colors"
                    :class="
                      fieldErrors.password
                        ? 'border-rose-600 dark:border-rose-400'
                        : 'border-slate-300 dark:border-zinc-700'
                    "
                    placeholder="Digite sua senha…"
                    @input="fieldErrors.password = ''"
                  />
                  <button
                    type="button"
                    class="icon-btn absolute right-0.5 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white active:scale-95 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
                    :aria-label="showPassword ? 'Ocultar senha' : 'Exibir senha'"
                    :aria-pressed="showPassword"
                    :title="showPassword ? 'Ocultar senha' : 'Exibir senha'"
                    @click="showPassword = !showPassword"
                  >
                    <PortalIcon v-if="showPassword" name="eye-off" :size="18" />
                    <PortalIcon v-else name="eye" :size="18" />
                  </button>
                </div>
                <p
                  v-if="fieldErrors.password"
                  id="portal-login-password-error"
                  role="alert"
                  class="mt-1.5 text-xs font-medium text-rose-700 dark:text-rose-300"
                >
                  {{ fieldErrors.password }}
                </p>
              </div>

              <div role="status" aria-live="polite">
                <span v-if="authStatusMessage && !authError" class="sr-only">
                  {{ authStatusMessage }}
                </span>
                <div
                  v-if="authError"
                  role="alert"
                  class="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-800 dark:text-rose-200 font-medium flex items-start gap-2.5"
                >
                  <PortalIcon
                    name="alert-circle"
                    :size="16"
                    class="text-rose-700 dark:text-rose-300 mt-0.5"
                  />
                  <span>{{ authError }}</span>
                </div>
              </div>

              <button
                type="submit"
                :disabled="loading"
                class="w-full min-h-[44px] py-3 px-4 rounded-xl bg-brand hover:bg-brand-dark border border-black/10 dark:border-white/15 active:scale-[0.98] text-brand-fg text-sm font-semibold transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#111113]"
              >
                <span
                  v-if="loading"
                  class="w-4 h-4 border-2 border-brand-fg border-t-transparent rounded-full animate-spin"
                  aria-hidden="true"
                />
                <span>{{ loading ? 'Autenticando…' : 'Entrar no portal' }}</span>
              </button>
            </form>

            <div
              class="pt-4 border-t border-slate-200/80 dark:border-zinc-800 space-y-1 text-xs text-slate-600 dark:text-slate-300"
            >
              <p class="font-semibold text-slate-700 dark:text-slate-200">
                Precisa de acesso ou redefinição de senha?
              </p>
              <p class="leading-relaxed">
                Solicite ao gestor de TI da sua empresa na tela
                <strong class="font-semibold text-slate-900 dark:text-[#fafafa]">
                  Portal Colaboradores
                </strong>
                para gerar uma nova credencial.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>

    <!-- Authenticated Workspace View -->
    <main
      v-else
      id="main-content"
      tabindex="-1"
      class="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6 focus:outline-none"
    >
      <!-- Workspace Title -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div class="min-w-0">
          <h1 class="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-[#fafafa]">
            Custódia e atendimentos de {{ companyName }}
          </h1>
          <p class="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mt-0.5">
            Consulte seus equipamentos vinculados, assine termos CLT e acompanhe chamados de suporte.
          </p>
        </div>
      </div>

      <!-- Error Notification -->
      <div
        v-if="loadError"
        role="alert"
        aria-live="polite"
        class="p-4 rounded-2xl bg-rose-500/10 text-rose-800 dark:text-rose-200 border border-rose-500/30 text-xs font-medium flex flex-wrap items-center justify-between gap-3 shadow-sm"
      >
        <div class="flex items-center gap-2 min-w-0">
          <PortalIcon name="alert-triangle" :size="16" class="text-rose-700 dark:text-rose-300" />
          <span class="break-words">{{ loadError }}</span>
        </div>
        <button
          type="button"
          :disabled="loading"
          class="min-h-[44px] px-3 py-1.5 rounded-xl font-semibold text-rose-800 dark:text-rose-200 hover:bg-rose-500/15 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          @click="loadWorkspaceData"
        >
          Recarregar dados
        </button>
      </div>

      <!-- Real-time Live Event Toast Banner -->
      <div
        v-if="liveBanner"
        role="status"
        aria-live="polite"
        class="p-3.5 rounded-2xl bg-slate-900 dark:bg-zinc-900 text-[#fafafa] border border-emerald-500/40 text-xs flex items-center justify-between gap-3 shadow-lg animate-slide-down"
      >
        <div class="flex items-center gap-2.5 min-w-0">
          <PortalIcon name="check-circle" :size="16" class="text-emerald-400" />
          <span class="font-semibold text-emerald-300 shrink-0">Atualização em tempo real:</span>
          <span class="text-slate-100 truncate">{{ liveBanner }}</span>
        </div>
        <button
          type="button"
          class="icon-btn min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-300 hover:text-white hover:bg-white/10 active:scale-95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          aria-label="Dispensar notificação"
          @click="liveBanner = ''"
        >
          <PortalIcon name="x" :size="16" />
        </button>
      </div>

      <!-- Employee Dashboard Quick Summary -->
      <div data-tour="summary-cards" class="grid gap-3.5 sm:grid-cols-3">
        <!-- Equipamentos sob custódia -->
        <div class="station-panel p-4 flex items-center justify-between gap-3 border-l-4 border-l-brand-ring">
          <div class="min-w-0">
            <p class="text-xs font-semibold text-slate-600 dark:text-slate-300 truncate">
              Equipamentos sob custódia
            </p>
            <p class="text-2xl font-bold text-slate-900 dark:text-[#fafafa] mt-1 tabular-nums truncate">
              {{ assets.length }} {{ assets.length === 1 ? 'ativo' : 'ativos' }}
            </p>
            <p class="text-xs text-slate-600 dark:text-slate-300 truncate">
              Vinculados à sua matrícula
            </p>
          </div>
          <div
            class="w-11 h-11 rounded-2xl bg-brand/10 text-brand-text-light dark:text-brand-text-dark flex items-center justify-center shrink-0"
          >
            <PortalIcon name="laptop" :size="20" />
          </div>
        </div>

        <!-- Conformidade CLT -->
        <div
          class="station-panel p-4 flex items-center justify-between gap-3 border-l-4"
          :class="termsSummary.borderCls"
        >
          <div class="min-w-0">
            <p class="text-xs font-semibold text-slate-600 dark:text-slate-300 truncate">
              Conformidade jurídica CLT
            </p>
            <p
              class="text-2xl font-bold mt-1 tabular-nums truncate"
              :class="termsSummary.textCls"
            >
              {{ termsSummary.headline }}
            </p>
            <p class="text-xs text-slate-600 dark:text-slate-300 truncate">
              {{ termsSummary.subtitle }}
            </p>
          </div>
          <div
            class="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
            :class="termsSummary.iconCls"
          >
            <PortalIcon name="clipboard-check" :size="20" />
          </div>
        </div>

        <!-- Atendimento de TI -->
        <div class="station-panel p-4 flex items-center justify-between gap-3 border-l-4 border-l-brand-ring">
          <div class="min-w-0">
            <p class="text-xs font-semibold text-slate-600 dark:text-slate-300 truncate">
              Atendimento de TI
            </p>
            <p class="text-2xl font-bold text-slate-900 dark:text-[#fafafa] mt-1 tabular-nums truncate">
              {{ openTicketsCount }} em aberto
            </p>
            <p class="text-xs text-slate-600 dark:text-slate-300 tabular-nums truncate">
              {{ tickets.length }} {{ tickets.length === 1 ? 'chamado' : 'chamados' }} no histórico
            </p>
          </div>
          <div
            class="w-11 h-11 rounded-2xl bg-brand/10 text-brand-text-light dark:text-brand-text-dark flex items-center justify-center shrink-0"
          >
            <PortalIcon name="headphones" :size="20" />
          </div>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <nav
        aria-label="Navegação do portal"
        class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-zinc-800 pb-3"
      >
        <div
          role="tablist"
          aria-label="Seções do portal"
          class="flex flex-wrap gap-2"
          @keydown="onTabKeydown"
        >
          <button
            v-for="(tab, idx) in portalTabs"
            :id="`tab-${tab.id}`"
            :key="tab.id"
            :ref="(el) => { tabButtonRefs[idx] = el; }"
            type="button"
            role="tab"
            :aria-selected="activeTab === tab.id"
            :aria-controls="`panel-${tab.id}`"
            :tabindex="activeTab === tab.id ? 0 : -1"
            class="min-h-[44px] px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold active:scale-[0.98] transition-colors shadow-sm inline-flex items-center gap-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
            :class="
              activeTab === tab.id
                ? 'bg-brand text-brand-fg border border-black/10 dark:border-white/15'
                : 'station-panel text-slate-700 dark:text-slate-200 hover:border-slate-300 dark:hover:border-zinc-700'
            "
            @click="selectTab(tab.id)"
          >
            <span class="tabular-nums">{{ tab.label }}</span>
            <span
              v-if="tab.badge > 0"
              class="px-2 py-0.5 rounded-full bg-amber-400 text-slate-950 text-xs font-bold tabular-nums"
            >
              {{ tab.badge }} {{ tab.badge === 1 ? 'pendente' : 'pendentes' }}
            </span>
          </button>
        </div>

        <button
          type="button"
          :disabled="loading"
          class="min-h-[44px] text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-brand-text-light dark:hover:text-brand-text-dark active:scale-[0.98] transition-colors inline-flex items-center gap-1.5 cursor-pointer py-2 px-3 rounded-xl hover:bg-slate-100 dark:hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          @click="loadWorkspaceData"
        >
          <span>Atualizar painel</span>
          <PortalIcon name="refresh-cw" :size="16" :class="loading ? 'animate-spin' : ''" />
        </button>
      </nav>

      <!-- Tab Content Panels (kept mounted with v-show to preserve session state) -->
      <div
        v-show="activeTab === 'custody'"
        id="panel-custody"
        role="tabpanel"
        aria-labelledby="tab-custody"
        :aria-hidden="activeTab !== 'custody'"
      >
        <CustodyAssetsPanel
          :assets="assets"
          :loading="loading"
          :error="loadError"
          @retry="loadWorkspaceData"
          @report-issue="handleReportIssue"
        />
      </div>

      <div
        v-show="activeTab === 'terms'"
        id="panel-terms"
        role="tabpanel"
        aria-labelledby="tab-terms"
        :aria-hidden="activeTab !== 'terms'"
      >
        <ResponsibilityTerms
          :terms="terms"
          :loading="loading"
          :error="loadError"
          @retry="loadWorkspaceData"
          @signed="loadWorkspaceData"
        />
      </div>

      <div
        v-show="activeTab === 'tickets'"
        id="panel-tickets"
        role="tabpanel"
        aria-labelledby="tab-tickets"
        :aria-hidden="activeTab !== 'tickets'"
      >
        <SupportTicketDesk
          :tickets="tickets"
          :assets="assets"
          :loading="loading"
          :error="loadError"
          :user-department="session.user.department || 'Geral'"
          :user-email="session.user.email || ''"
          :ws-state="wsState"
          :live-event="latestTicketEvent"
          :preselected-asset-tag="preselectedTag"
          @retry="loadWorkspaceData"
          @clear-preselected="preselectedTag = ''"
          @created="loadWorkspaceData"
          @send-typing="sendTicketTyping"
          @sync-tickets="loadWorkspaceData({ background: true })"
        />
      </div>

      <div
        v-show="activeTab === 'cloud'"
        id="panel-cloud"
        role="tabpanel"
        aria-labelledby="tab-cloud"
        data-section-title="Arquivos & Nuvem"
        :aria-hidden="activeTab !== 'cloud'"
      >
        <CorporateCloudDrive
          :user="session.user"
          :user-email="session.user.email || ''"
          :user-department="session.user.department || 'Geral'"
          :assets="assets"
          :ws-state="wsState"
          :live-sheet-event="latestSheetEvent"
        />
      </div>
    </main>

    <!-- Professional Corporate Footer -->
    <footer
      class="bg-white dark:bg-[#111113] border-t border-slate-200/80 dark:border-zinc-800 py-4 text-center text-xs text-slate-600 dark:text-slate-300 mt-auto"
    >
      <div class="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
        <p>© {{ currentYear }} {{ companyName }} • Gestão Patrimonial de TI e Service Desk</p>
        <div class="flex items-center gap-4 text-xs">
          <a
            :href="`${GATEWAY_BASE_URL}/docs`"
            target="_blank"
            rel="noopener noreferrer"
            class="min-h-[44px] inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-200 hover:text-brand-text-light dark:hover:text-brand-text-dark active:scale-[0.98] font-semibold transition-colors px-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          >
            <span>Documentação de integrações</span>
            <PortalIcon name="arrow-up-right" :size="14" />
          </a>
        </div>
      </div>
    </footer>
    <!-- First-Access Guided Tour for Collaborators -->
    <FirstAccessTour
      v-if="session?.user"
      :open="showFirstAccessTour"
      :user-name="session.user.name || ''"
      :company-name="companyName"
      :department="session.user.department || ''"
      :assets-count="assets.length"
      :pending-terms-count="pendingTermsCount"
      :open-tickets-count="openTicketsCount"
      :is-replay="tourIsReplay"
      @select-tab="selectTab"
      @close="handleTourClose"
      @complete="handleTourComplete"
    />
  </div>
</template>
