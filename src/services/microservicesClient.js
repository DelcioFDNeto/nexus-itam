// src/services/microservicesClient.js
// =============================================================================
// Camada Adapter Híbrida (Strangler Fig Pattern) — Console React 19 <-> Fastify
// =============================================================================
// Permite ao Console Administrativo React comunicar-se de forma segura com o
// API Gateway (Portas 8000-8004) via HTTP REST + WebSocket Bidirecional,
// funcionando tanto em produção na VPS (IP direto :3000 ou Domínio HTTPS via
// proxy reverso Nginx/Caddy) quanto em modo híbrido local, preservando 100%
// da compatibilidade com o deploy Firebase existente.
// =============================================================================

const TOKEN_STORAGE_KEY = 'nexus_ms_gateway_jwt';
const USER_STORAGE_KEY = 'nexus_ms_gateway_user';

const sessionListeners = new Set();

function notifySessionListeners() {
  const snapshot = getGatewaySession();
  sessionListeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch {
      /* listener isolado */
    }
  });
}

export function onGatewaySessionChange(listener) {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

/**
 * Resolve dinamicamente a URL base do API Gateway:
 * 1. Respeita `VITE_API_GATEWAY_URL` explícito (exceto se apontar para localhost
 *    quando o navegador estiver acessando um IP/domínio remoto de VPS).
 * 2. Em VPS por IP (`:3000`) ou domínio HTTPS, utiliza `window.location.origin`
 *    pois `nginx.spa.conf` faz proxy reverso nativo de `/api`, `/ws`, `/health` e `/docs`.
 * 3. Em desenvolvimento local (`localhost:5173`), aponta para `http://localhost:8000`.
 */
export function getGatewayBaseUrl() {
  const configured = (import.meta.env.VITE_API_GATEWAY_URL || '').trim().replace(/\/$/, '');
  const isBrowser = typeof window !== 'undefined' && Boolean(window.location?.hostname);
  const host = isBrowser ? window.location.hostname : 'localhost';
  const isLocalHost = host === 'localhost' || host === '127.0.0.1';

  if (configured) {
    const pointsToLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(configured);
    if (!pointsToLocal || isLocalHost) {
      return configured;
    }
  }

  if (isBrowser && !isLocalHost) {
    return window.location.origin;
  }

  if (isBrowser && window.location.port === '3000') {
    return window.location.origin;
  }

  return 'http://localhost:8000';
}

/**
 * Resolve a URL do Portal do Colaborador (Vue 3) em qualquer topologia:
 * - Variável `VITE_PORTAL_URL` explícita (quando compatível com o ambiente);
 * - VPS por IP (`http://IP:3000` -> `http://IP:3001`);
 * - Domínio HTTPS (`https://itam.dominio` -> `https://portal.dominio`);
 * - Desenvolvimento local (`http://localhost:3001`).
 */
export function resolvePortalUrl() {
  const configured = (import.meta.env.VITE_PORTAL_URL || '').trim().replace(/\/$/, '');
  const isBrowser = typeof window !== 'undefined' && Boolean(window.location?.hostname);
  const host = isBrowser ? window.location.hostname : 'localhost';
  const isLocalHost = host === 'localhost' || host === '127.0.0.1';

  if (configured) {
    const pointsToLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(configured);
    if (!pointsToLocal || isLocalHost) {
      return configured;
    }
  }

  if (isBrowser && !isLocalHost) {
    const { protocol, hostname, port } = window.location;
    if (port === '3000') {
      return `${protocol}//${hostname}:3001`;
    }
    if (hostname.startsWith('itam.')) {
      return `${protocol}//portal.${hostname.slice(5)}`;
    }
    return `${protocol}//${hostname}:3001`;
  }

  return 'http://localhost:3001';
}

export function getGatewaySession() {
  try {
    const token = sessionStorage.getItem(TOKEN_STORAGE_KEY);
    const rawUser = sessionStorage.getItem(USER_STORAGE_KEY);
    if (!token || !rawUser) return null;
    return { token, user: JSON.parse(rawUser) };
  } catch {
    return null;
  }
}

export function isGatewayActiveSession() {
  return Boolean(getGatewaySession()?.token);
}

export function setGatewaySession(token, user) {
  sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
  sessionStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
  notifySessionListeners();
}

export function clearGatewaySession() {
  const hadToken = Boolean(sessionStorage.getItem(TOKEN_STORAGE_KEY));
  sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  sessionStorage.removeItem(USER_STORAGE_KEY);
  if (hadToken) notifySessionListeners();
}

export async function gatewayRequest(path, options = {}) {
  const session = getGatewaySession();
  const headers = {
    Accept: 'application/json',
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(`${getGatewayBaseUrl()}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const contentType = response.headers?.get?.('content-type') || 'application/json';
  const isJson = contentType.includes('application/json');
  const payload = isJson ? await response.json().catch(() => ({})) : {};

  if (!response.ok) {
    if (response.status === 401 && path !== '/api/v1/auth/login') {
      clearGatewaySession();
    }
    const err = new Error(payload.message || `Erro HTTP ${response.status} no API Gateway`);
    err.status = response.status;
    err.code = payload.error || `HTTP_${response.status}`;
    throw err;
  }

  if (!isJson) {
    throw new Error('Resposta inesperada do servidor (esperado JSON do API Gateway).');
  }

  return payload;
}

export const microservicesApi = {
  // Saúde Distribuída & OpenAPI
  probeClusterHealth: () => gatewayRequest('/health'),

  // Autenticação & Identidade Zero-Trust no Gateway
  authenticate: async (email, password) => {
    const data = await gatewayRequest('/api/v1/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    setGatewaySession(data.accessToken, data.user);
    return data;
  },
  getMe: () => gatewayRequest('/api/v1/auth/me'),
  listUsers: () => gatewayRequest('/api/v1/auth/users'),

  // API 1 (REST) — Gestão de Ativos (`service-assets`)
  listAssets: (params = {}) => {
    const cleanParams = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
    );
    const qs = new URLSearchParams(cleanParams).toString();
    return gatewayRequest(`/api/v1/assets${qs ? `?${qs}` : ''}`);
  },
  getAssetById: (assetId) => gatewayRequest(`/api/v1/assets/${encodeURIComponent(assetId)}`),
  suggestNextTag: (type = 'Notebook') =>
    gatewayRequest(`/api/v1/assets/next-tag?type=${encodeURIComponent(type)}`),
  createAsset: (assetPayload) =>
    gatewayRequest('/api/v1/assets', { method: 'POST', body: assetPayload }),
  updateAsset: (assetId, assetPayload) =>
    gatewayRequest(`/api/v1/assets/${encodeURIComponent(assetId)}`, {
      method: 'PUT',
      body: assetPayload,
    }),
  retireAsset: (assetId, reason = 'Baixa patrimonial') =>
    gatewayRequest(`/api/v1/assets/${encodeURIComponent(assetId)}`, {
      method: 'DELETE',
      body: { reason },
    }),

  // API 2 (REST) — Central de Chamados (`service-tickets`)
  listTickets: () => gatewayRequest('/api/v1/tickets'),
  getTicketById: (ticketId) => gatewayRequest(`/api/v1/tickets/${encodeURIComponent(ticketId)}`),
  getTicketMetrics: () => gatewayRequest('/api/v1/tickets/metrics'),
  createTicket: (payload) =>
    gatewayRequest('/api/v1/tickets', { method: 'POST', body: payload }),
  updateTicketStatus: (ticketId, payload) =>
    gatewayRequest(`/api/v1/tickets/${encodeURIComponent(ticketId)}/status`, {
      method: 'PATCH',
      body: payload,
    }),
  addTicketComment: (ticketId, message) =>
    gatewayRequest(`/api/v1/tickets/${encodeURIComponent(ticketId)}/comments`, {
      method: 'POST',
      body: { message },
    }),

  // API 3 (REST) — Compliance CLT & Hash-Chain (`service-compliance`)
  listTerms: () => gatewayRequest('/api/v1/compliance/terms'),
  issueTerm: (payload) =>
    gatewayRequest('/api/v1/compliance/terms', { method: 'POST', body: payload }),
  signTerm: (termId, declarationAccepted = true) =>
    gatewayRequest(`/api/v1/compliance/terms/${encodeURIComponent(termId)}/sign`, {
      method: 'POST',
      body: { declarationAccepted },
    }),
  verifyTerm: (termId) =>
    gatewayRequest(`/api/v1/compliance/terms/${encodeURIComponent(termId)}/verify`),
  listAuditChain: () => gatewayRequest('/api/v1/compliance/audit'),
  verifyAuditChain: () => gatewayRequest('/api/v1/compliance/audit/verify-chain'),

  // API 4 (REST) — Telemetria RMM (`service-nexusdesk`)
  getFleetTelemetry: () => gatewayRequest('/api/v1/telemetry/fleet'),
  dispatchRemoteCommand: (deviceKey, commandType, payload = '') =>
    gatewayRequest('/api/v1/telemetry/commands', {
      method: 'POST',
      body: { deviceKey, commandType, payload },
    }),

  // API 5 (NÃO-REST) — WebSocket Bidirecional (`ws://.../ws/nexusdesk`)
  openNexusDeskSocket(token, { onFrame, onStatus, onReconnected } = {}) {
    const wsBase = getGatewayBaseUrl().replace(/^http/i, 'ws');
    const url = `${wsBase}/ws/nexusdesk?token=${encodeURIComponent(token)}&client=react19-console`;

    let ws = null;
    let closedByOperator = false;
    let reconnectAttempt = 0;
    let reconnectTimer = null;
    let pingTimer = null;
    let connectedOnce = false;

    const clearTimers = () => {
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const connect = () => {
      if (closedByOperator) return;
      try {
        ws = new WebSocket(url);
      } catch {
        onStatus?.('error');
        return;
      }

      ws.onopen = () => {
        const isReconnection = connectedOnce;
        connectedOnce = true;
        reconnectAttempt = 0;
        onStatus?.('connected');
        if (pingTimer) clearInterval(pingTimer);
        pingTimer = setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ action: 'ping', id: `react-${Date.now()}` }));
          }
        }, 25_000);
        if (isReconnection) {
          onReconnected?.();
        }
      };

      ws.onmessage = (evt) => {
        try {
          const frame = JSON.parse(evt.data);
          if (frame?.event === 'auth.rejected') {
            closedByOperator = true;
            clearTimers();
            clearGatewaySession();
            onStatus?.('disconnected');
            return;
          }
          onFrame?.(frame);
        } catch {
          // ignora frame malformado
        }
      };

      ws.onerror = () => {
        onStatus?.('error');
      };

      ws.onclose = (evt) => {
        if (pingTimer) {
          clearInterval(pingTimer);
          pingTimer = null;
        }
        onStatus?.('disconnected');
        if (closedByOperator || evt?.code === 1008) return;
        const delay = Math.min(15_000, 1200 * 2 ** reconnectAttempt) + Math.floor(Math.random() * 350);
        reconnectAttempt += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    connect();

    return {
      pushLiveTelemetry(data) {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ action: 'telemetry.push', data }));
        }
      },
      ping() {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ action: 'ping', id: `react-${Date.now()}` }));
        }
      },
      close() {
        closedByOperator = true;
        clearTimers();
        if (ws) {
          try {
            ws.close();
          } catch {
            /* noop */
          }
        }
      },
    };
  },
};
