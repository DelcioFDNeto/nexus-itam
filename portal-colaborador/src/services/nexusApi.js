// portal-colaborador/src/services/nexusApi.js
// =============================================================================
// Cliente HTTP JWT + Canal WebSocket Bidirecional (100% Independente do Firebase)
// =============================================================================

const STORAGE_TOKEN_KEY = 'nexus_portal_jwt_v3';
const STORAGE_USER_KEY = 'nexus_portal_user_v3';

function isLocalHostname(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function isLocalGatewayUrl(url) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(url);
}

export function resolveGatewayBaseUrl() {
  const rawEnv = String(import.meta.env.VITE_API_GATEWAY_URL || '').trim().replace(/\/$/, '');

  if (typeof window !== 'undefined' && window.location?.hostname) {
    const browserIsLocal = isLocalHostname(window.location.hostname);

    if (rawEnv && (!isLocalGatewayUrl(rawEnv) || browserIsLocal)) {
      if (window.location.protocol === 'https:' && rawEnv.startsWith('http://') && !browserIsLocal) {
        return rawEnv.replace(/^http:\/\//i, 'https://');
      }
      return rawEnv;
    }

    // Em VPS via IP (:3001) ou domínio HTTPS sem build-arg explícito, utiliza o
    // reverse-proxy Nginx embarcado no próprio container (`location /api` e `/ws/`).
    if (!browserIsLocal && window.location.origin && window.location.origin !== 'null') {
      return window.location.origin.replace(/\/$/, '');
    }

    // Docker local na porta 3001 também possui proxy Nginx embarcado
    if (browserIsLocal && window.location.port === '3001') {
      return window.location.origin.replace(/\/$/, '');
    }
  }

  return rawEnv || 'http://localhost:8000';
}

export const GATEWAY_BASE_URL = resolveGatewayBaseUrl();

let unauthorizedHandler = null;

export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = typeof fn === 'function' ? fn : null;
}

export function getStoredSession() {
  try {
    const token = sessionStorage.getItem(STORAGE_TOKEN_KEY);
    const rawUser = sessionStorage.getItem(STORAGE_USER_KEY);
    if (!token || !rawUser) return null;
    return { token, user: JSON.parse(rawUser) };
  } catch {
    return null;
  }
}

export function saveStoredSession(token, user) {
  sessionStorage.setItem(STORAGE_TOKEN_KEY, token);
  sessionStorage.setItem(STORAGE_USER_KEY, JSON.stringify(user));
}

export function clearStoredSession() {
  sessionStorage.removeItem(STORAGE_TOKEN_KEY);
  sessionStorage.removeItem(STORAGE_USER_KEY);
}

async function request(path, options = {}) {
  const session = getStoredSession();
  const headers = {
    Accept: 'application/json',
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
    ...(options.headers || {}),
  };

  const res = await fetch(`${GATEWAY_BASE_URL}${path}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await res.json().catch(() => ({}))
    : {};

  if (res.status === 401 && path !== '/api/v1/auth/login') {
    clearStoredSession();
    unauthorizedHandler?.(data.message || 'Sua sessão expirou. Faça login novamente.');
  }

  if (!res.ok) {
    throw new Error(data.message || `Falha na requisição (${res.status})`);
  }

  if (!contentType.includes('application/json')) {
    throw new Error('Resposta inesperada do API Gateway (verifique a conectividade da VPS).');
  }

  return data;
}

export const portalApi = {
  getHealth: () => request('/health'),

  login: async (email, password) => {
    const data = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    saveStoredSession(data.accessToken, data.user);
    return data;
  },

  getProfile: () => request('/api/v1/auth/me'),

  // API 1 (REST) — Ativos sob Custódia
  listMyAssets: () => request('/api/v1/assets'),

  // API 2 (REST) — Chamados de Suporte
  listMyTickets: () => request('/api/v1/tickets'),
  getTicketDetail: (id) => request(`/api/v1/tickets/${id}`),
  createTicket: (payload) =>
    request('/api/v1/tickets', {
      method: 'POST',
      body: payload,
    }),
  addTicketComment: (id, message) =>
    request(`/api/v1/tickets/${id}/comments`, {
      method: 'POST',
      body: { message },
    }),

  // API 3 (REST) — Termos Jurídicos CLT & Verificação Criptográfica
  listMyTerms: () => request('/api/v1/compliance/terms'),
  signTerm: (id) =>
    request(`/api/v1/compliance/terms/${id}/sign`, {
      method: 'POST',
    }),
  verifyTermIntegrity: (id) => request(`/api/v1/compliance/terms/${id}/verify`),

  // API 5 (NÃO-REST) — Conexão WebSocket Bidirecional Full-Duplex com Backoff & Watchdog
  connectRealtimeStream(token, onFrame, onStatusChange, onReconnected) {
    const wsBase = GATEWAY_BASE_URL.replace(/^http/i, 'ws');
    const url = `${wsBase}/ws/nexusdesk?token=${encodeURIComponent(token)}&client=vue3-portal`;

    let ws = null;
    let closedManually = false;
    let authRejected = false;
    let reconnectTimer = null;
    let pingInterval = null;
    let pongTimeout = null;
    let attempt = 0;
    let hadConnectedBefore = false;

    const clearTimers = () => {
      clearInterval(pingInterval);
      clearTimeout(pongTimeout);
      clearTimeout(reconnectTimer);
    };

    const scheduleReconnect = () => {
      if (closedManually || authRejected) return;
      const baseDelay = Math.min(1500 * 2 ** attempt, 25000);
      const jitter = Math.floor(Math.random() * 600);
      attempt += 1;
      reconnectTimer = setTimeout(connect, baseDelay + jitter);
    };

    const connect = () => {
      if (closedManually || authRejected) return;
      clearTimers();
      onStatusChange?.('connecting');
      ws = new WebSocket(url);

      ws.onopen = () => {
        onStatusChange?.('connected');
        pingInterval = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ action: 'ping', id: `vue-${Date.now()}` }));
            clearTimeout(pongTimeout);
            pongTimeout = setTimeout(() => {
              if (ws?.readyState === WebSocket.OPEN) {
                ws.close(4000, 'Heartbeat timeout');
              }
            }, 15000);
          }
        }, 25000);
      };

      ws.onmessage = (evt) => {
        try {
          const parsed = JSON.parse(evt.data);
          if (parsed.event === 'auth.rejected') {
            authRejected = true;
            clearStoredSession();
            unauthorizedHandler?.(parsed.message || 'Sessão WebSocket expirada.');
            return;
          }
          if (parsed.event === 'pong') {
            clearTimeout(pongTimeout);
          }
          if (parsed.event === 'welcome') {
            attempt = 0;
            if (hadConnectedBefore) {
              onReconnected?.();
            }
            hadConnectedBefore = true;
          }
          onFrame?.(parsed);
        } catch {
          // ignora frame inválido
        }
      };

      ws.onclose = (evt) => {
        clearInterval(pingInterval);
        clearTimeout(pongTimeout);
        if (evt?.code === 1008) {
          authRejected = true;
          clearStoredSession();
          onStatusChange?.('unauthorized');
          unauthorizedHandler?.('Autenticação recusada pelo canal em tempo real.');
          return;
        }
        onStatusChange?.('disconnected');
        scheduleReconnect();
      };

      ws.onerror = () => {
        onStatusChange?.('error');
      };
    };

    const handleOnline = () => {
      if (!closedManually && !authRejected && (!ws || ws.readyState === WebSocket.CLOSED)) {
        attempt = 0;
        connect();
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
    }

    connect();

    return {
      sendPing() {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ action: 'ping', id: `manual-${Date.now()}` }));
        }
      },
      disconnect() {
        closedManually = true;
        clearTimers();
        if (typeof window !== 'undefined') {
          window.removeEventListener('online', handleOnline);
        }
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
          ws.close(1000, 'Client logout');
        }
      },
    };
  },
};
