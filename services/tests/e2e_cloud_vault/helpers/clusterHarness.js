// services/tests/e2e_cloud_vault/helpers/clusterHarness.js
// =============================================================================
// Opaque-Box Cluster Harness for Nexus Cloud Vault & Conector VPS E2E Tests
// =============================================================================
// - Configures in-memory DB mode and test secrets BEFORE dynamic ESM imports
// - Probes a contiguous 10-port free block on 127.0.0.1 (avoiding 18100..18199)
// - Never statically imports service-storage so tests run cleanly pre/post M2
// =============================================================================

import net from 'node:net';
import WebSocket from 'ws';

const DEFAULT_TEST_MASTER_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isBodyBinaryOrStream(body) {
  return (
    typeof body === 'string' ||
    Buffer.isBuffer(body) ||
    body instanceof Uint8Array ||
    body instanceof ArrayBuffer ||
    (typeof FormData !== 'undefined' && body instanceof FormData) ||
    (typeof Blob !== 'undefined' && body instanceof Blob) ||
    (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) ||
    (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream)
  );
}

function probePortAvailable(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ host, port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function allocateFreePortBlock(blockSize = 10, host = '127.0.0.1') {
  const minBase = 20000;
  const maxBase = 48000;
  const maxAttempts = 80;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const raw = minBase + Math.floor(Math.random() * ((maxBase - minBase) / blockSize)) * blockSize;
    // Avoid 18100..18199 (used by microservices.test.js)
    if (raw >= 18090 && raw <= 18210) continue;

    const probes = Array.from({ length: blockSize }, (_, offset) =>
      probePortAvailable(raw + offset, host),
    );
    const results = await Promise.all(probes);
    if (results.every(Boolean)) return raw;
  }

  throw new Error(`Unable to allocate a contiguous ${blockSize}-port block on ${host}`);
}

export async function bootE2eCluster(options = {}) {
  // CRITICAL: Configure env BEFORE dynamic imports because db.js evaluates USE_PG at import time.
  process.env.NEXUS_DB_MODE = 'memory';
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'test';
  }
  if (!process.env.NEXUS_STORAGE_MASTER_KEY || process.env.NEXUS_STORAGE_MASTER_KEY.trim().length < 24) {
    process.env.NEXUS_STORAGE_MASTER_KEY = options.masterKey || DEFAULT_TEST_MASTER_KEY;
  }
  process.env.RATE_LIMIT_MAX = String(options.rateLimitMax ?? 5000);
  process.env.LOGIN_RATE_LIMIT_MAX = String(options.loginRateLimitMax ?? 500);

  const [{ startAllMicroservices }, { authRepo, resetMemoryStoreWithSeed }, { signJwt }] =
    await Promise.all([
      import('../../../orchestrator.js'),
      import('../../../shared/db.js'),
      import('../../../shared/security.js'),
    ]);

  resetMemoryStoreWithSeed();

  let cluster = null;
  let basePort = null;
  let lastBootError = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    basePort = options.basePort && attempt === 0 ? options.basePort : await allocateFreePortBlock(10);
    try {
      cluster = await startAllMicroservices({
        host: '127.0.0.1',
        basePort,
        logger: options.logger ?? false,
      });
      break;
    } catch (err) {
      lastBootError = err;
      if (err?.code !== 'EADDRINUSE') throw err;
    }
  }

  if (!cluster) {
    throw lastBootError || new Error('Failed to start E2E microservices cluster.');
  }

  const baseUrl = cluster.gatewayUrl;
  const wsUrl = cluster.wsUrl;
  const activeWsClients = new Set();

  async function apiFetch(token, path, init = {}) {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = `${baseUrl}${normalizedPath}`;
    const headers = new Headers(init.headers || {});

    if (token && !headers.has('authorization')) {
      headers.set('authorization', `Bearer ${token}`);
    }

    let body = init.body;
    if (body !== undefined && body !== null && !isBodyBinaryOrStream(body) && isPlainObject(body)) {
      if (!headers.has('content-type')) {
        headers.set('content-type', 'application/json');
      }
      body = JSON.stringify(body);
    }

    const fetchInit = {
      ...init,
      headers,
      body,
    };

    const res = await fetch(url, fetchInit);
    const contentType = res.headers.get('content-type') || '';
    const arrayBuf = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    const text = buffer.toString('utf8');

    let data = null;
    if (contentType.includes('application/json') && text.length > 0) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    } else if (!contentType && text.startsWith('{')) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }

    return {
      status: res.status,
      ok: res.ok,
      headers: res.headers,
      data,
      text,
      buffer,
      unimplemented: [404, 502, 503].includes(res.status),
    };
  }

  async function loginAs(email, password) {
    const res = await apiFetch(null, '/api/v1/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    if (!res.ok) {
      throw new Error(
        `loginAs(${email}) failed with status ${res.status}: ${res.data?.message || res.text}`,
      );
    }
    return {
      accessToken: res.data.accessToken,
      user: res.data.user,
      raw: res.data,
    };
  }

  function createUserToken({
    sub = `test-user-${Math.random().toString(36).slice(2, 10)}`,
    email = 'e2e.user@shineraybysabel.com.br',
    name = 'E2E Test User',
    role = 'owner',
    tenantId = 'tenant-ap3htf6',
    department = 'Geral',
    expiresInSeconds = 3600,
    ...extra
  } = {}) {
    return signJwt(
      {
        sub,
        email,
        name,
        role,
        tenantId,
        department,
        ...extra,
      },
      expiresInSeconds,
    );
  }

  async function seedUser(ownerOrAdminToken, userData) {
    const res = await apiFetch(ownerOrAdminToken, '/api/v1/auth/users', {
      method: 'POST',
      body: userData,
    });
    if (!res.ok) {
      throw new Error(
        `seedUser(${userData?.email}) failed (${res.status}): ${res.data?.message || res.text}`,
      );
    }
    return res.data?.user || res.data;
  }

  async function seedDirectUser(userData = {}) {
    return authRepo.createUser({
      tenantId: 'tenant-ap3htf6',
      department: 'Geral',
      jobTitle: 'Colaborador',
      role: 'collaborator',
      password: 'TestPass@2026!',
      ...userData,
    });
  }

  async function setTenantPlan(ownerToken, contractPayload = {}) {
    const res = await apiFetch(ownerToken, '/api/v1/auth/contract', {
      method: 'PUT',
      body: contractPayload,
    });
    if (!res.ok) {
      throw new Error(
        `setTenantPlan failed (${res.status}): ${res.data?.message || res.text}`,
      );
    }
    return res.data;
  }

  async function probeStorageAvailability(token = null) {
    const res = await apiFetch(token, '/api/v1/storage/health');
    return {
      available: !res.unimplemented,
      status: res.status,
      body: res.data,
    };
  }

  function openWsClient(token, clientType = 'e2e-test', { timeoutMs = 5000, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
      const targetUrl = `${wsUrl}?token=${encodeURIComponent(token || '')}&client=${encodeURIComponent(clientType)}`;
      const ws = new WebSocket(targetUrl, { headers });
      activeWsClients.add(ws);

      const frames = [];
      const waiters = [];
      let settled = false;
      let closed = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try {
            ws.terminate();
          } catch {
            /* ignore */
          }
          reject(new Error(`WebSocket welcome timeout after ${timeoutMs}ms (${clientType})`));
        }
      }, timeoutMs);

      const notifyWaiters = (frame) => {
        for (let i = waiters.length - 1; i >= 0; i -= 1) {
          const waiter = waiters[i];
          if (waiter.predicate(frame)) {
            waiters.splice(i, 1);
            clearTimeout(waiter.timer);
            waiter.resolve(frame);
          }
        }
      };

      // Attach listeners synchronously before any frames arrive
      ws.on('message', (raw) => {
        let parsed = null;
        try {
          parsed = JSON.parse(raw.toString('utf8'));
        } catch {
          parsed = { raw: raw.toString('utf8') };
        }
        frames.push(parsed);

        if (!settled) {
          if (parsed?.event === 'welcome') {
            settled = true;
            clearTimeout(timer);
            resolve(handle);
          } else if (parsed?.event === 'auth.rejected') {
            settled = true;
            clearTimeout(timer);
            reject(new Error(`WebSocket auth.rejected: ${parsed.message || 'unauthorized'}`));
          }
        }

        notifyWaiters(parsed);
      });

      ws.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      });

      ws.on('close', (code, reasonBuf) => {
        closed = true;
        activeWsClients.delete(ws);
        const reason = reasonBuf ? reasonBuf.toString('utf8') : '';
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`WebSocket closed before welcome (code=${code}, reason=${reason})`));
        }
        for (const w of waiters.splice(0, waiters.length)) {
          clearTimeout(w.timer);
          w.reject(new Error(`WebSocket closed while awaiting frame (code=${code})`));
        }
      });

      const handle = {
        ws,
        frames,
        get welcomeFrame() {
          return frames.find((f) => f?.event === 'welcome') || null;
        },
        send(payload) {
          if (ws.readyState !== WebSocket.OPEN) {
            throw new Error(`Cannot send on WebSocket with readyState=${ws.readyState}`);
          }
          ws.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
        },
        waitForEvent(match, waitMs = 5000) {
          const predicate =
            typeof match === 'function'
              ? match
              : (frame) => frame?.event === match || frame?.type === match;

          const existing = frames.find(predicate);
          if (existing) {
            return Promise.resolve(existing);
          }
          if (closed) {
            return Promise.reject(new Error('WebSocket already closed'));
          }

          return new Promise((resWait, rejWait) => {
            const wTimer = setTimeout(() => {
              const idx = waiters.findIndex((x) => x.resolve === resWait);
              if (idx >= 0) waiters.splice(idx, 1);
              rejWait(new Error(`Timed out waiting for WS event after ${waitMs}ms`));
            }, waitMs);
            waiters.push({ predicate, resolve: resWait, reject: rejWait, timer: wTimer });
          });
        },
        waitForNextEvent(match, waitMs = 5000, fromIndex = frames.length) {
          const predicate =
            typeof match === 'function'
              ? match
              : (frame) => frame?.event === match || frame?.type === match;

          const existing = frames.slice(fromIndex).find(predicate);
          if (existing) {
            return Promise.resolve(existing);
          }
          if (closed) {
            return Promise.reject(new Error('WebSocket already closed'));
          }

          return new Promise((resWait, rejWait) => {
            const wTimer = setTimeout(() => {
              const idx = waiters.findIndex((x) => x.resolve === resWait);
              if (idx >= 0) waiters.splice(idx, 1);
              rejWait(new Error(`Timed out waiting for next WS event after ${waitMs}ms`));
            }, waitMs);
            waiters.push({ predicate, resolve: resWait, reject: rejWait, timer: wTimer });
          });
        },
        close() {
          return new Promise((resClose) => {
            if (ws.readyState === WebSocket.CLOSED) {
              activeWsClients.delete(ws);
              resClose();
              return;
            }
            const forceTimer = setTimeout(() => {
              try {
                ws.terminate();
              } catch {
                /* ignore */
              }
              activeWsClients.delete(ws);
              resClose();
            }, 500);
            ws.once('close', () => {
              clearTimeout(forceTimer);
              activeWsClients.delete(ws);
              resClose();
            });
            try {
              ws.close();
            } catch {
              clearTimeout(forceTimer);
              activeWsClients.delete(ws);
              resClose();
            }
          });
        },
      };
    });
  }

  async function stop() {
    const closers = Array.from(activeWsClients).map(
      (ws) =>
        new Promise((resolve) => {
          if (ws.readyState === WebSocket.CLOSED) {
            resolve();
            return;
          }
          const force = setTimeout(() => {
            try {
              ws.terminate();
            } catch {
              /* ignore */
            }
            resolve();
          }, 500);
          ws.once('close', () => {
            clearTimeout(force);
            resolve();
          });
          try {
            ws.close();
          } catch {
            clearTimeout(force);
            resolve();
          }
        }),
    );
    await Promise.all(closers);
    activeWsClients.clear();
    await cluster.closeAll();
  }

  return {
    baseUrl,
    wsUrl,
    basePort,
    ports: cluster.ports,
    apiFetch,
    loginAs,
    createUserToken,
    seedUser,
    seedDirectUser,
    setTenantPlan,
    probeStorageAvailability,
    openWsClient,
    stop,
  };
}
