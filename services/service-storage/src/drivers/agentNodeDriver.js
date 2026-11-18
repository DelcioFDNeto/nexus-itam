// services/service-storage/src/drivers/agentNodeDriver.js
// =============================================================================
// Driver Híbrido 2 — Nexus Storage Node (HTTP + HMAC-SHA256)
// =============================================================================

import crypto from 'node:crypto';
import { normalizeVirtualVaultPath } from '../../../shared/security.js';

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

    let res;
    try {
      res = await fetch(`${baseUrl}${pathWithQuery}`, {
        method,
        headers: reqHeaders,
        body: ['GET', 'HEAD'].includes(method.toUpperCase()) ? undefined : rawBody,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (fetchErr) {
      const err = new Error(`Nexus Storage Node inacessível (${fetchErr.message || 'offline'}).`);
      err.code = 'UPSTREAM_UNAVAILABLE';
      err.statusCode = 502;
      throw err;
    }

    const arrayBuf = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
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
    };
  }

  return {
    providerType: 'agent_node',

    async testConnection() {
      const started = Date.now();
      try {
        const res = await signedRequest('GET', '/health');
        const latencyMs = Date.now() - started;
        if (!res.ok) {
          return {
            ok: false,
            status: 'error',
            latencyMs,
            error: res.data?.message || res.data?.error || `HTTP ${res.status}`,
          };
        }
        return {
          ok: true,
          status: 'connected',
          driver: 'agent_node',
          latencyMs,
          freeBytes: Number(res.data?.freeBytes ?? 0),
          totalBytes: Number(res.data?.totalBytes ?? res.data?.quotaBytes ?? 0),
          usedBytes: Number(res.data?.usedBytes ?? 0),
        };
      } catch (err) {
        return {
          ok: false,
          status: 'error',
          latencyMs: Date.now() - started,
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
