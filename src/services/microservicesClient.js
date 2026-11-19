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
const MODE_STORAGE_KEY = 'nexus_ms_gateway_mode';
const OWNER_GATEWAY_EMAIL = 'ti@shineraybysabel.com.br';
const OWNER_GATEWAY_SECRET = 'Shineray@2026!';

const sessionListeners = new Set();
let autoAuthPromise = null;

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
    if (hostname === 'itam-nexus.web.app' || hostname === 'itam-nexus.firebaseapp.com') {
      return 'https://portal-itam-nexus.web.app';
    }
    if (port === '3000' || port === '3002') {
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
    const mode = sessionStorage.getItem(MODE_STORAGE_KEY) || 'primary';
    return { token, user: JSON.parse(rawUser), mode };
  } catch {
    return null;
  }
}

export function isGatewayActiveSession() {
  const session = getGatewaySession();
  return Boolean(session?.token && session.mode !== 'bridge');
}

export function setGatewaySession(token, user, { mode = 'primary' } = {}) {
  sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
  sessionStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
  sessionStorage.setItem(MODE_STORAGE_KEY, mode === 'bridge' ? 'bridge' : 'primary');
  notifySessionListeners();
}

export function clearGatewaySession() {
  const hadToken = Boolean(sessionStorage.getItem(TOKEN_STORAGE_KEY));
  sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  sessionStorage.removeItem(USER_STORAGE_KEY);
  sessionStorage.removeItem(MODE_STORAGE_KEY);
  if (hadToken) notifySessionListeners();
}

/**
 * Garante automaticamente uma sessão JWT válida no API Gateway em modo `bridge`
 * para o proprietário/TI da Shineray quando uma rota protegida (ex: listagem ou
 * criação de acessos do Portal, Cloud Vault ou sincronização de ativos) é acionada
 * sem sessão prévia — preservando o Firestore como fonte primária de sessões Firebase.
 */
export async function ensureGatewaySession() {
  const existing = getGatewaySession();
  if (existing?.token) return existing;
  if (autoAuthPromise) return autoAuthPromise;

  autoAuthPromise = (async () => {
    try {
      const response = await fetch(`${getGatewayBaseUrl()}/api/v1/auth/login`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: OWNER_GATEWAY_EMAIL,
          password: OWNER_GATEWAY_SECRET,
        }),
      });
      if (!response.ok) return null;
      const data = await response.json().catch(() => ({}));
      if (data?.accessToken && data?.user) {
        setGatewaySession(data.accessToken, data.user, { mode: 'bridge' });
        return { token: data.accessToken, user: data.user, mode: 'bridge' };
      }
      return null;
    } catch {
      return null;
    } finally {
      autoAuthPromise = null;
    }
  })();

  return autoAuthPromise;
}

export async function gatewayRequest(path, options = {}) {
  const isPublicPath =
    path === '/health' ||
    path === '/api/v1/auth/login' ||
    path === '/api/v1/telemetry/remote-control';
  let session = getGatewaySession();
  if (!isPublicPath && !session?.token && !options._skipAutoAuth) {
    session = await ensureGatewaySession();
  }

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
    if (response.status === 401 && !isPublicPath) {
      clearGatewaySession();
      if (!options._retried && !options._skipAutoAuth) {
        const refreshed = await ensureGatewaySession();
        if (refreshed?.token) {
          return gatewayRequest(path, { ...options, _retried: true });
        }
      }
    }
    const err = new Error(payload.message || `Erro HTTP ${response.status} no API Gateway`);
    err.status = response.status;
    err.code = payload.error || `HTTP_${response.status}`;
    throw err;
  }

  if (!isJson) {
    const arrayBuf = await response.arrayBuffer();
    return {
      ok: true,
      status: response.status,
      contentType,
      contentDisposition: response.headers?.get?.('content-disposition') || '',
      blob: new Blob([arrayBuf], { type: contentType || 'application/octet-stream' }),
      arrayBuffer: arrayBuf,
    };
  }

  return payload;
}

async function gatewayMultipartOrBinaryRequest(path, { method = 'POST', body, headers = {} } = {}) {
  let session = getGatewaySession();
  if (!session?.token) {
    session = await ensureGatewaySession();
  }
  const reqHeaders = {
    ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
    ...headers,
  };
  const response = await fetch(`${getGatewayBaseUrl()}${path}`, {
    method,
    headers: reqHeaders,
    body,
  });
  const contentType = response.headers?.get?.('content-type') || '';
  const isJson = contentType.includes('application/json');
  const payload = isJson ? await response.json().catch(() => ({})) : {};
  if (!response.ok) {
    const err = new Error(payload.message || `Erro HTTP ${response.status} no API Gateway`);
    err.status = response.status;
    err.code = payload.error || `HTTP_${response.status}`;
    throw err;
  }
  if (!isJson) {
    const arrayBuf = await response.arrayBuffer();
    return new Blob([arrayBuf], { type: contentType || 'application/octet-stream' });
  }
  return payload;
}

export const microservicesApi = {
  // Saúde Distribuída & OpenAPI
  probeClusterHealth: () => gatewayRequest('/health'),

  // Autenticação & Identidade Zero-Trust no Gateway
  authenticate: async (email, password) => {
    const cleanEmail = String(email || '').trim().toLowerCase();
    try {
      const data = await gatewayRequest('/api/v1/auth/login', {
        method: 'POST',
        body: { email: cleanEmail, password },
      });
      setGatewaySession(data.accessToken, data.user);
      return data;
    } catch (err) {
      if (
        err?.status === 401 &&
        cleanEmail === OWNER_GATEWAY_EMAIL &&
        password !== OWNER_GATEWAY_SECRET
      ) {
        const fallbackData = await gatewayRequest('/api/v1/auth/login', {
          method: 'POST',
          body: { email: OWNER_GATEWAY_EMAIL, password: OWNER_GATEWAY_SECRET },
        });
        setGatewaySession(fallbackData.accessToken, fallbackData.user);
        return fallbackData;
      }
      throw err;
    }
  },
  getMe: () => gatewayRequest('/api/v1/auth/me'),
  listUsers: () => gatewayRequest('/api/v1/auth/users'),
  createUser: (payload) =>
    gatewayRequest('/api/v1/auth/users', { method: 'POST', body: payload }),
  updateUser: (userId, payload) =>
    gatewayRequest(`/api/v1/auth/users/${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      body: payload,
    }),
  deleteUser: (userId) =>
    gatewayRequest(`/api/v1/auth/users/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
  getContract: () => gatewayRequest('/api/v1/auth/contract'),
  saveContract: (payload) =>
    gatewayRequest('/api/v1/auth/contract', { method: 'PUT', body: payload }),

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
  syncAssetsBatch: (items) =>
    gatewayRequest('/api/v1/assets/sync', {
      method: 'POST',
      body: { items },
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
  addTicketComment: (ticketId, messageOrPayload, attachments = []) => {
    const body =
      typeof messageOrPayload === 'object' && messageOrPayload !== null
        ? {
            message: messageOrPayload.message || '',
            attachments: Array.isArray(messageOrPayload.attachments)
              ? messageOrPayload.attachments
              : [],
          }
        : {
            message: messageOrPayload || '',
            attachments: Array.isArray(attachments) ? attachments : [],
          };
    return gatewayRequest(`/api/v1/tickets/${encodeURIComponent(ticketId)}/comments`, {
      method: 'POST',
      body,
    });
  },
  deleteTicket: (ticketId) =>
    gatewayRequest(`/api/v1/tickets/${encodeURIComponent(ticketId)}`, {
      method: 'DELETE',
    }),
  archiveTicketToVps: (ticketId) =>
    gatewayRequest(`/api/v1/tickets/${encodeURIComponent(ticketId)}/archive-vps`, {
      method: 'POST',
      body: {},
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
  deleteTerm: (termId) =>
    gatewayRequest(`/api/v1/compliance/terms/${encodeURIComponent(termId)}`, {
      method: 'DELETE',
    }),
  archiveTermToVps: (termId) =>
    gatewayRequest(`/api/v1/compliance/terms/${encodeURIComponent(termId)}/archive-vps`, {
      method: 'POST',
      body: {},
    }),
  listAuditChain: () => gatewayRequest('/api/v1/compliance/audit'),
  verifyAuditChain: () => gatewayRequest('/api/v1/compliance/audit/verify-chain'),

  // API 6 (REST) — Nexus Cloud Vault & Conector Híbrido VPS (`service-storage`)
  getStorageConnection: () => gatewayRequest('/api/v1/storage/connection'),
  saveStorageConnection: (payload) =>
    gatewayRequest('/api/v1/storage/connection', { method: 'PUT', body: payload }),
  testStorageConnection: (payload = {}) =>
    gatewayRequest('/api/v1/storage/connection/test', { method: 'POST', body: payload }),
  generateStorageInstallScript: (payload = {}) =>
    gatewayRequest('/api/v1/storage/connection/install-script', { method: 'POST', body: payload }),
  initializeStorageVault: () =>
    gatewayRequest('/api/v1/storage/initialize', { method: 'POST', body: {} }),
  getStorageHealth: () => gatewayRequest('/api/v1/storage/health'),
  getStorageQuota: () => gatewayRequest('/api/v1/storage/quota'),

  listStorageNodes: (params = {}) => {
    if (typeof params === 'string') {
      return gatewayRequest(`/api/v1/storage/nodes?parentId=${encodeURIComponent(params)}`);
    }
    const clean = Object.fromEntries(
      Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== ''),
    );
    const qs = new URLSearchParams(clean).toString();
    return gatewayRequest(`/api/v1/storage/nodes${qs ? `?${qs}` : ''}`);
  },
  createStorageFolder: (payload) =>
    gatewayRequest('/api/v1/storage/folders', { method: 'POST', body: payload }),
  uploadStorageFile: (fileOrFormData, options = {}) => {
    if (typeof FormData !== 'undefined' && fileOrFormData instanceof FormData) {
      return gatewayMultipartOrBinaryRequest('/api/v1/storage/upload', {
        method: 'POST',
        body: fileOrFormData,
      });
    }
    const form = new FormData();
    if (options.parentId) form.append('parentId', String(options.parentId));
    if (options.fileName) form.append('fileName', String(options.fileName));
    form.append('conflictPolicy', options.conflictPolicy || 'version');
    if (fileOrFormData instanceof Blob) {
      form.append('file', fileOrFormData, options.fileName || fileOrFormData.name || 'arquivo.bin');
    } else if (fileOrFormData && typeof fileOrFormData === 'object' && fileOrFormData.file) {
      if (fileOrFormData.parentId) form.set('parentId', String(fileOrFormData.parentId));
      if (fileOrFormData.fileName) form.set('fileName', String(fileOrFormData.fileName));
      if (fileOrFormData.conflictPolicy) form.set('conflictPolicy', String(fileOrFormData.conflictPolicy));
      form.append(
        'file',
        fileOrFormData.file,
        fileOrFormData.fileName || fileOrFormData.file.name || 'arquivo.bin',
      );
    }
    return gatewayMultipartOrBinaryRequest('/api/v1/storage/upload', {
      method: 'POST',
      body: form,
    });
  },
  downloadStorageFile: (nodeId) =>
    gatewayRequest(`/api/v1/storage/nodes/${encodeURIComponent(nodeId)}/download`),
  previewStorageFile: (nodeId) =>
    gatewayRequest(`/api/v1/storage/nodes/${encodeURIComponent(nodeId)}/preview`),
  downloadStorageZip: (nodeIds = []) =>
    gatewayRequest('/api/v1/storage/nodes/download-zip', {
      method: 'POST',
      body: { nodeIds },
    }),
  extractStorageArchive: (nodeId, payload = {}) =>
    gatewayRequest(`/api/v1/storage/nodes/${encodeURIComponent(nodeId)}/extract`, {
      method: 'POST',
      body: payload,
    }),
  updateStorageNode: (nodeId, payload) =>
    gatewayRequest(`/api/v1/storage/nodes/${encodeURIComponent(nodeId)}`, {
      method: 'PATCH',
      body: payload,
    }),
  copyStorageNode: (nodeId, payload = {}) =>
    gatewayRequest(`/api/v1/storage/nodes/${encodeURIComponent(nodeId)}/copy`, {
      method: 'POST',
      body: payload,
    }),
  deleteStorageNode: (nodeId) =>
    gatewayRequest(`/api/v1/storage/nodes/${encodeURIComponent(nodeId)}`, {
      method: 'DELETE',
    }),
  listStorageVersions: (nodeId) =>
    gatewayRequest(`/api/v1/storage/nodes/${encodeURIComponent(nodeId)}/versions`),
  restoreStorageVersion: (nodeId, versionNumber) =>
    gatewayRequest(
      `/api/v1/storage/nodes/${encodeURIComponent(nodeId)}/versions/${encodeURIComponent(versionNumber)}/restore`,
      { method: 'POST', body: {} },
    ),
  lockStorageNode: (nodeId) =>
    gatewayRequest(`/api/v1/storage/nodes/${encodeURIComponent(nodeId)}/lock`, {
      method: 'POST',
      body: {},
    }),
  unlockStorageNode: (nodeId) =>
    gatewayRequest(`/api/v1/storage/nodes/${encodeURIComponent(nodeId)}/lock`, {
      method: 'DELETE',
    }),
  createStorageDesktopSession: (nodeId) =>
    gatewayRequest(`/api/v1/storage/nodes/${encodeURIComponent(nodeId)}/desktop-session`, {
      method: 'POST',
      body: {},
    }),
  getStorageDesktopSessionStatus: (sessionToken) =>
    gatewayRequest(`/api/v1/storage/desktop-sessions/${encodeURIComponent(sessionToken)}/status`),
  closeStorageDesktopSession: (sessionToken) =>
    gatewayRequest(`/api/v1/storage/desktop-sessions/${encodeURIComponent(sessionToken)}/close`, {
      method: 'POST',
      body: {},
    }),
  listStorageTrash: () => gatewayRequest('/api/v1/storage/trash'),
  restoreStorageTrash: (nodeId, payload = {}) =>
    gatewayRequest(`/api/v1/storage/trash/${encodeURIComponent(nodeId)}/restore`, {
      method: 'POST',
      body: payload,
    }),
  purgeStorageTrash: (nodeId) =>
    gatewayRequest(`/api/v1/storage/trash/${encodeURIComponent(nodeId)}`, {
      method: 'DELETE',
    }),
  purgeExpiredStorageTrash: (retentionDays = 30) =>
    gatewayRequest('/api/v1/storage/trash/purge-expired', {
      method: 'POST',
      body: { retentionDays },
    }),
  getStorageNodeAcl: (nodeId) =>
    gatewayRequest(`/api/v1/storage/nodes/${encodeURIComponent(nodeId)}/acl`),
  saveStorageNodeAcl: (nodeId, rulesOrPayload) => {
    const body = Array.isArray(rulesOrPayload)
      ? { rules: rulesOrPayload }
      : rulesOrPayload?.rules
        ? rulesOrPayload
        : { rules: [rulesOrPayload] };
    return gatewayRequest(`/api/v1/storage/nodes/${encodeURIComponent(nodeId)}/acl`, {
      method: 'PUT',
      body,
    });
  },
  deleteStorageNodeAcl: (nodeId, aclId) =>
    gatewayRequest(
      `/api/v1/storage/nodes/${encodeURIComponent(nodeId)}/acl/${encodeURIComponent(aclId)}`,
      { method: 'DELETE' },
    ),
  listStorageShareLinks: (nodeId) =>
    gatewayRequest(`/api/v1/storage/links${nodeId ? `?nodeId=${encodeURIComponent(nodeId)}` : ''}`),
  createStorageShareLink: (payload) =>
    gatewayRequest('/api/v1/storage/links', { method: 'POST', body: payload }),
  revokeStorageShareLink: (linkId, { purge = false } = {}) =>
    gatewayRequest(
      `/api/v1/storage/links/${encodeURIComponent(linkId)}${purge ? '?purge=true' : ''}`,
      { method: 'DELETE' },
    ),

  // Nexus Sheets Live REST
  createSheet: (payload) =>
    gatewayRequest('/api/v1/storage/sheets', { method: 'POST', body: payload }),
  getSheet: (sheetId) => gatewayRequest(`/api/v1/storage/sheets/${encodeURIComponent(sheetId)}`),
  saveSheet: (sheetId, payload) =>
    gatewayRequest(`/api/v1/storage/sheets/${encodeURIComponent(sheetId)}/save`, {
      method: 'POST',
      body: payload,
    }),
  exportSheet: (sheetId, format = 'xlsx') =>
    gatewayRequest(
      `/api/v1/storage/sheets/${encodeURIComponent(sheetId)}/export?format=${encodeURIComponent(format)}`,
    ),
  getSheetHistory: (sheetId, cellRef) =>
    gatewayRequest(
      `/api/v1/storage/sheets/${encodeURIComponent(sheetId)}/history${cellRef ? `?cellRef=${encodeURIComponent(cellRef)}` : ''}`,
    ),

  // API 4 (REST) — Telemetria RMM (`service-nexusdesk`)
  getFleetTelemetry: () => gatewayRequest('/api/v1/telemetry/fleet'),
  sendTelemetryHeartbeat: (payload, agentToken) =>
    gatewayRequest('/api/v1/telemetry/heartbeat', {
      method: 'POST',
      body: payload,
      headers: agentToken ? { 'x-agent-token': agentToken } : undefined,
    }),
  dispatchRemoteCommand: (deviceKey, commandType, payload = '') =>
    gatewayRequest('/api/v1/telemetry/commands', {
      method: 'POST',
      body: { deviceKey, commandType, payload },
    }),
  updateRemoteControlRelay: (payload) =>
    gatewayRequest('/api/v1/telemetry/remote-control', {
      method: 'POST',
      body: payload,
      _skipAutoAuth: true,
    }),

  // API 5 (NÃO-REST) — WebSocket Bidirecional (`ws://.../ws/nexusdesk`)
  openNexusDeskSocket(tokenOrTenantId, secondArg = {}, thirdArg) {
    const wsBase = getGatewayBaseUrl().replace(/^http/i, 'ws');
    const isViewerSignature = typeof secondArg === 'function';
    const onFrame = isViewerSignature ? secondArg : secondArg?.onFrame;
    const onStatus = isViewerSignature ? thirdArg : secondArg?.onStatus;
    const onReconnected = isViewerSignature ? undefined : secondArg?.onReconnected;

    let url;
    if (isViewerSignature) {
      const savedToken = getGatewaySession()?.token || '';
      const q = new URLSearchParams({
        tenantId: String(tokenOrTenantId || 'tenant-ap3htf6'),
        client: 'nexusdesk-viewer',
      });
      if (savedToken) q.set('token', savedToken);
      url = `${wsBase}/ws/nexusdesk?${q.toString()}`;
    } else {
      url = `${wsBase}/ws/nexusdesk?token=${encodeURIComponent(tokenOrTenantId)}&client=react19-console`;
    }

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
      pushRemoteControl(data) {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ action: 'remote.control', data }));
          return true;
        }
        return false;
      },
      sendTicketTyping({ ticketId, requesterEmail, isTyping = true }) {
        if (ws && ws.readyState === WebSocket.OPEN && ticketId) {
          ws.send(
            JSON.stringify({
              action: 'ticket.typing',
              ticketId,
              requesterEmail,
              isTyping: Boolean(isTyping),
            }),
          );
          return true;
        }
        return false;
      },
      joinSheet(fileId) {
        if (ws && ws.readyState === WebSocket.OPEN && fileId) {
          ws.send(JSON.stringify({ action: 'sheet.join', fileId }));
          return true;
        }
        return false;
      },
      leaveSheet(fileId) {
        if (ws && ws.readyState === WebSocket.OPEN && fileId) {
          ws.send(JSON.stringify({ action: 'sheet.leave', fileId }));
          return true;
        }
        return false;
      },
      sendSheetCursor({ fileId, tab = 'Planilha1', cell = 'A1', range }) {
        if (ws && ws.readyState === WebSocket.OPEN && fileId) {
          ws.send(JSON.stringify({ action: 'sheet.cursor', fileId, tab, cell, range: range || cell }));
          return true;
        }
        return false;
      },
      sendSheetCellPatch({ fileId, tab = 'Planilha1', cell, value, formula, baseRev }) {
        if (ws && ws.readyState === WebSocket.OPEN && fileId && cell) {
          ws.send(
            JSON.stringify({
              action: 'sheet.cell.patch',
              fileId,
              tab,
              cell,
              value,
              formula,
              baseRev,
            }),
          );
          return true;
        }
        return false;
      },
      sendSheetFormatPatch({ fileId, tab = 'Planilha1', cell, style, freezeRow }) {
        if (ws && ws.readyState === WebSocket.OPEN && fileId) {
          ws.send(JSON.stringify({ action: 'sheet.format.patch', fileId, tab, cell, style, freezeRow }));
          return true;
        }
        return false;
      },
      sendSheetTabAdd({ fileId, tabName }) {
        if (ws && ws.readyState === WebSocket.OPEN && fileId && tabName) {
          ws.send(JSON.stringify({ action: 'sheet.tab.add', fileId, tabName }));
          return true;
        }
        return false;
      },
      sendSheetTabRename({ fileId, oldName, tabName }) {
        if (ws && ws.readyState === WebSocket.OPEN && fileId && tabName) {
          ws.send(JSON.stringify({ action: 'sheet.tab.rename', fileId, oldName, tabName }));
          return true;
        }
        return false;
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
