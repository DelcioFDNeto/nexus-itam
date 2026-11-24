// services/service-storage/src/drivers/agentNodeDriver.js
// =============================================================================
// Driver Híbrido 2 — Nexus Storage Node (HTTP + HMAC-SHA256)
// =============================================================================

import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { normalizeVirtualVaultPath } from '../../../shared/security.js';

const KEEP_ALIVE_HTTP_AGENT = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 60_000,
  maxSockets: 64,
  maxFreeSockets: 16,
  scheduling: 'lifo',
  timeout: 65_000,
});

const KEEP_ALIVE_HTTPS_AGENT = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 60_000,
  maxSockets: 64,
  maxFreeSockets: 16,
  scheduling: 'lifo',
  timeout: 65_000,
});

function createHeaderAccessor(rawHeaders = {}) {
  return {
    get(name) {
      if (!name) return null;
      const val = rawHeaders[String(name).toLowerCase()];
      if (Array.isArray(val)) return val.join(', ');
      return val !== undefined ? String(val) : null;
    },
  };
}

function sendKeepAliveHttpRequest(urlStr, { method = 'GET', headers = {}, bodyBuffer = null, timeoutMs = 8000 } = {}) {
  const parsed = new URL(urlStr);
  const isHttps = parsed.protocol === 'https:';
  const transport = isHttps ? https : http;
  const agent = isHttps ? KEEP_ALIVE_HTTPS_AGENT : KEEP_ALIVE_HTTP_AGENT;
  const upperMethod = String(method || 'GET').toUpperCase();
  const hasPayload = !['GET', 'HEAD'].includes(upperMethod) && bodyBuffer && bodyBuffer.length > 0;

  const finalHeaders = {
    Connection: 'keep-alive',
    ...headers,
  };
  if (!['GET', 'HEAD'].includes(upperMethod)) {
    finalHeaders['Content-Length'] = hasPayload ? bodyBuffer.length : 0;
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const req = transport.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: upperMethod,
        headers: finalHeaders,
        agent,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          if (settled) return;
          settled = true;
          const buffer = Buffer.concat(chunks);
          const status = res.statusCode || 500;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            headers: createHeaderAccessor(res.headers),
            buffer,
            reusedSocket: Boolean(req.reusedSocket),
          });
        });
        res.on('error', (err) => {
          if (settled) return;
          settled = true;
          reject(err);
        });
      },
    );

    req.setNoDelay(true);
    req.setTimeout(timeoutMs, () => {
      if (!settled) {
        settled = true;
        const timeoutErr = new Error(`Timeout após ${timeoutMs}ms`);
        timeoutErr.code = 'ETIMEDOUT';
        req.destroy(timeoutErr);
        reject(timeoutErr);
      }
    });

    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      err.reusedSocket = Boolean(req.reusedSocket);
      reject(err);
    });

    if (hasPayload) {
      req.write(bodyBuffer);
    }
    req.end();
  });
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf || Buffer.alloc(0)).digest('hex');
}

export function signAgentNodeHeaders({ hmacToken, method, pathWithQuery, rawBody = Buffer.alloc(0), ts = Date.now() }) {
  const tsStr = String(ts);
  const m = String(method || 'GET').toUpperCase();
  const bodyBuf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8');
  const bodyHash = sha256Hex(bodyBuf);
  const canonical = `${tsStr}.${m}.${pathWithQuery}.${bodyHash}`;
  const sig = crypto.createHmac('sha256', String(hmacToken || '')).update(canonical, 'utf8').digest('hex');
  return {
    'x-nexus-ts': tsStr,
    'x-nexus-sig': sig,
  };
}

export function createAgentNodeDriver(connection, credentials = {}) {
  const rawEndpoint = String(
    connection.endpoint_url ||
      connection.endpointUrl ||
      credentials.endpointUrl ||
      (connection.host ? `http://${connection.host}:${connection.port || 9443}` : ''),
  )
    .trim()
    .replace(/\/+$/, '');
  const baseUrl =
    rawEndpoint && !/^https?:\/\//i.test(rawEndpoint) && !rawEndpoint.includes('://')
      ? `http://${rawEndpoint}`
      : rawEndpoint;
  const hmacToken = String(credentials.hmacToken || credentials.token || '');

  function resolveRemotePath(virtualPath) {
    const vPath = normalizeVirtualVaultPath(virtualPath || '/');
    const rootPath = normalizeVirtualVaultPath(connection.root_path || connection.rootPath || '/');
    if (rootPath === '/') return vPath;
    if (vPath === '/') return rootPath;
    return `${rootPath}${vPath}`;
  }

  async function signedRequest(method, pathWithQuery, { body = null, headers = {}, timeoutMs = 8000 } = {}) {
    if (!baseUrl) {
      const err = new Error('Endpoint do Nexus Storage Node ausente.');
      err.statusCode = 400;
      throw err;
    }
    let rawBody = Buffer.alloc(0);
    const reqHeaders = { ...headers };
    if (body !== null && body !== undefined) {
      if (Buffer.isBuffer(body)) {
        rawBody = body;
        if (!reqHeaders['content-type']) reqHeaders['content-type'] = 'application/octet-stream';
      } else if (typeof body === 'object') {
        rawBody = Buffer.from(JSON.stringify(body), 'utf8');
        reqHeaders['content-type'] = 'application/json';
      } else {
        rawBody = Buffer.from(String(body), 'utf8');
      }
    }

    const authHeaders = signAgentNodeHeaders({
      hmacToken,
      method,
      pathWithQuery,
      rawBody,
    });
    Object.assign(reqHeaders, authHeaders);

    const targetUrl = `${baseUrl}${pathWithQuery}`;
    let res;
    try {
      try {
        res = await sendKeepAliveHttpRequest(targetUrl, {
          method,
          headers: reqHeaders,
          bodyBuffer: rawBody,
          timeoutMs,
        });
      } catch (firstErr) {
        if (firstErr?.reusedSocket && ['ECONNRESET', 'EPIPE', 'ECONNABORTED'].includes(firstErr?.code)) {
          const freshAuth = signAgentNodeHeaders({
            hmacToken,
            method,
            pathWithQuery,
            rawBody,
          });
          res = await sendKeepAliveHttpRequest(targetUrl, {
            method,
            headers: { ...reqHeaders, ...freshAuth },
            bodyBuffer: rawBody,
            timeoutMs,
          });
        } else {
          throw firstErr;
        }
      }
    } catch (fetchErr) {
      const err = new Error(`Nexus Storage Node inacessível (${fetchErr.message || 'offline'}).`);
      err.code = 'UPSTREAM_UNAVAILABLE';
      err.statusCode = 502;
      throw err;
    }

    const buffer = res.buffer;
    let data = null;
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('application/json')) {
      try {
        data = JSON.parse(buffer.toString('utf8'));
      } catch {
        data = null;
      }
    }
    return {
      ok: res.ok,
      status: res.status,
      headers: res.headers,
      buffer,
      data,
      reusedSocket: Boolean(res.reusedSocket),
    };
  }

  return {
    providerType: 'agent_node',

    async testConnection() {
      const coldStart = Date.now();
      try {
        let res = await signedRequest('GET', '/health');
        const coldLatencyMs = Date.now() - coldStart;
        if (!res.ok) {
          return {
            ok: false,
            status: 'error',
            latencyMs: coldLatencyMs,
            error: res.data?.message || res.data?.error || `HTTP ${res.status}`,
          };
        }

        // Quando a primeira chamada abriu socket TCP frio, mede o RTT real sobre o socket Keep-Alive já aquecido
        let latencyMs = coldLatencyMs;
        if (!res.reusedSocket) {
          const warmStart = Date.now();
          try {
            const warmRes = await signedRequest('GET', '/health', { timeoutMs: 4000 });
            if (warmRes.ok) {
              latencyMs = Date.now() - warmStart;
              res = warmRes;
            }
          } catch {
            // Mantém medição inicial se a sonda de aquecimento falhar
          }
        }

        return {
          ok: true,
          status: 'connected',
          driver: 'agent_node',
          latencyMs,
          freeBytes: Number(res.data?.freeBytes ?? 0),
          totalBytes: Number(res.data?.totalBytes ?? res.data?.quotaBytes ?? 0),
          usedBytes: Number(res.data?.usedBytes ?? 0),
          transportDetails: {
            keepAlive: true,
            reusedSocket: Boolean(res.reusedSocket),
            coldLatencyMs,
          },
        };
      } catch (err) {
        return {
          ok: false,
          status: 'error',
          latencyMs: Date.now() - coldStart,
          error: err.message || 'Falha ao conectar ao Nexus Storage Node.',
        };
      }
    },

    async statfs() {
      const res = await signedRequest('GET', '/statfs');
      if (!res.ok) {
        const err = new Error(res.data?.message || `Falha em /statfs (${res.status})`);
        err.statusCode = res.status >= 500 ? 502 : res.status;
        throw err;
      }
      return res.data;
    },

    async mkdir(virtualPath) {
      const rPath = resolveRemotePath(virtualPath);
      const res = await signedRequest('POST', '/mkdir', {
        body: { path: rPath, recursive: true },
      });
      if (!res.ok) {
        const err = new Error(res.data?.message || `Falha ao criar pasta (${res.status})`);
        err.code = res.data?.error || 'MKDIR_FAILED';
        err.statusCode = res.status >= 500 ? 502 : res.status;
        throw err;
      }
      return { ok: true, path: rPath };
    },

    async mkdirBatch(virtualPaths = []) {
      const list = Array.isArray(virtualPaths) ? virtualPaths.filter(Boolean) : [];
      if (list.length === 0) return { ok: true, created: [] };
      const remotePaths = list.map((vp) => resolveRemotePath(vp));
      const res = await signedRequest('POST', '/mkdir-batch', {
        body: { paths: remotePaths, recursive: true },
      });
      if (res.ok) {
        return { ok: true, created: remotePaths };
      }
      if (res.status === 404) {
        await Promise.all(list.map((vp) => this.mkdir(vp)));
        return { ok: true, created: remotePaths };
      }
      const err = new Error(res.data?.message || `Falha ao criar pastas em lote (${res.status})`);
      err.code = res.data?.error || 'MKDIR_BATCH_FAILED';
      err.statusCode = res.status >= 500 ? 502 : res.status;
      throw err;
    },

    async writeFile(virtualPath, buffer) {
      const rPath = resolveRemotePath(virtualPath);
      const q = `/files?path=${encodeURIComponent(rPath)}`;
      let res = await signedRequest('PUT', q, {
        body: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || ''),
      });
      if (!res.ok && res.status === 404) {
        const parts = rPath.split('/').filter(Boolean);
        if (parts.length > 1) {
          const parentDir = `/${parts.slice(0, -1).join('/')}`;
          await signedRequest('POST', '/mkdir', {
            body: { path: parentDir, recursive: true },
          });
          res = await signedRequest('PUT', q, {
            body: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || ''),
          });
        }
      }
      if (!res.ok) {
        const err = new Error(res.data?.message || `Falha na escrita remota (${res.status})`);
        err.code = res.data?.error || (res.status === 413 ? 'QUOTA_EXCEEDED' : 'WRITE_FAILED');
        err.statusCode = res.status === 413 ? 413 : res.status >= 500 ? 502 : res.status;
        throw err;
      }
      return res.data || { ok: true, size: buffer.length };
    },

    async readFile(virtualPath, { rangeHeader } = {}) {
      const rPath = resolveRemotePath(virtualPath);
      const q = `/files?path=${encodeURIComponent(rPath)}`;
      const headers = {};
      if (rangeHeader) headers.Range = rangeHeader;
      const res = await signedRequest('GET', q, { headers });
      if (res.status === 416) {
        const err = new Error('Range Not Satisfiable');
        err.code = 'RANGE_NOT_SATISFIABLE';
        err.statusCode = 416;
        throw err;
      }
      if (!res.ok) {
        const err = new Error(res.data?.message || `Arquivo não encontrado no storage (${res.status})`);
        err.code = res.data?.error || 'READ_FAILED';
        err.statusCode = res.status === 404 ? 404 : res.status >= 500 ? 502 : res.status;
        throw err;
      }
      return {
        status: res.status,
        buffer: res.buffer,
        contentRange: res.headers.get('content-range') || null,
        acceptRanges: res.headers.get('accept-ranges') || 'bytes',
      };
    },

    async rename(fromVirtualPath, toVirtualPath) {
      const fromPath = resolveRemotePath(fromVirtualPath);
      const toPath = resolveRemotePath(toVirtualPath);
      const res = await signedRequest('POST', '/rename', {
        body: { fromPath, toPath },
      });
      if (!res.ok) {
        const err = new Error(res.data?.message || `Falha ao renomear/mover (${res.status})`);
        err.statusCode = res.status >= 500 ? 502 : res.status;
        throw err;
      }
      return { ok: true };
    },

    async copy(fromVirtualPath, toVirtualPath) {
      const fromPath = resolveRemotePath(fromVirtualPath);
      const toPath = resolveRemotePath(toVirtualPath);
      const res = await signedRequest('POST', '/copy', {
        body: { fromPath, toPath },
      });
      if (!res.ok) {
        const err = new Error(res.data?.message || `Falha ao copiar (${res.status})`);
        err.code = res.data?.error || (res.status === 413 ? 'QUOTA_EXCEEDED' : 'COPY_FAILED');
        err.statusCode = res.status === 413 ? 413 : res.status >= 500 ? 502 : res.status;
        throw err;
      }
      return { ok: true };
    },

    async remove(virtualPath, { recursive = true } = {}) {
      const rPath = resolveRemotePath(virtualPath);
      const q = `/files?path=${encodeURIComponent(rPath)}&recursive=${recursive ? 'true' : 'false'}`;
      const res = await signedRequest('DELETE', q);
      if (!res.ok && res.status !== 404) {
        const err = new Error(res.data?.message || `Falha ao excluir (${res.status})`);
        err.statusCode = res.status >= 500 ? 502 : res.status;
        throw err;
      }
      return { ok: true };
    },
  };
}
