// services/service-storage/src/drivers/s3Driver.js
// =============================================================================
// Driver Híbrido 3 — S3 / MinIO / Cloudflare R2 (SigV4) & WebDAV
// =============================================================================

import crypto from 'node:crypto';
import { normalizeVirtualVaultPath } from '../../../shared/security.js';
import { parseHttpByteRange } from './sftpDriver.js';

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data || Buffer.alloc(0)).digest('hex');
}

function hmacSha256(key, data) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

export function signAwsV4Headers({
  method,
  url,
  accessKey,
  secretKey,
  region = 'us-east-1',
  service = 's3',
  payload = Buffer.alloc(0),
  extraHeaders = {},
}) {
  const parsed = new URL(url);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(payload);

  const headersToSign = {
    host: parsed.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  for (const [k, v] of Object.entries(extraHeaders)) {
    const lk = k.toLowerCase();
    if (lk.startsWith('x-amz-')) {
      headersToSign[lk] = String(v).trim();
    }
  }

  const sortedHeaderKeys = Object.keys(headersToSign).sort();
  const canonicalHeaders = sortedHeaderKeys.map((k) => `${k}:${headersToSign[k]}\n`).join('');
  const signedHeaders = sortedHeaderKeys.join(';');

  const queryParams = [...parsed.searchParams.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const canonicalQuery = queryParams
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const canonicalRequest = [
    method.toUpperCase(),
    parsed.pathname,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(Buffer.from(canonicalRequest, 'utf8')),
  ].join('\n');

  const kDate = hmacSha256(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  const kSigning = hmacSha256(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  return {
    ...extraHeaders,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
    Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

export function createS3OrWebDavDriver(connection, credentials = {}) {
  const providerType = String(connection.provider_type || connection.providerType || 's3').toLowerCase();
  const endpointUrl = String(connection.endpoint_url || connection.endpointUrl || credentials.endpointUrl || '').replace(/\/+$/, '');
  const rootPath = normalizeVirtualVaultPath(connection.root_path || connection.rootPath || '/');

  if (providerType === 'webdav') {
    return createWebDavDriver(endpointUrl, rootPath, connection, credentials);
  }
  return createS3Driver(endpointUrl, rootPath, connection, credentials);
}

function createS3Driver(endpointUrl, rootPath, connection, credentials) {
  const bucket = String(connection.bucket || credentials.bucket || 'nexus-vault');
  const region = String(connection.region || credentials.region || 'us-east-1');
  const accessKey = String(credentials.accessKey || credentials.accessKeyId || '');
  const secretKey = String(credentials.secretKey || credentials.secretAccessKey || '');

  function toObjectKey(virtualPath) {
    const vPath = normalizeVirtualVaultPath(virtualPath || '/');
    const combined = rootPath === '/' ? vPath : `${rootPath}${vPath === '/' ? '' : vPath}`;
    return combined.replace(/^\/+/, '');
  }

  function encodeKeyPath(key) {
    return String(key || '')
      .split('/')
      .filter(Boolean)
      .map((seg) => encodeURIComponent(seg))
      .join('/');
  }

  async function s3Request(method, keyPath = '', { body = Buffer.alloc(0), headers = {}, query = '' } = {}) {
    const encodedKey = keyPath ? `/${encodeKeyPath(keyPath)}` : '';
    const url = `${endpointUrl}/${encodeURIComponent(bucket)}${encodedKey}${query ? `?${query}` : ''}`;
    const payloadBuf = Buffer.isBuffer(body) ? body : Buffer.from(body || '');
    const signedHeaders = signAwsV4Headers({
      method,
      url,
      accessKey,
      secretKey,
      region,
      payload: ['GET', 'HEAD', 'DELETE'].includes(method.toUpperCase()) ? Buffer.alloc(0) : payloadBuf,
      extraHeaders: headers,
    });

    const res = await fetch(url, {
      method,
      headers: signedHeaders,
      body: ['GET', 'HEAD', 'DELETE'].includes(method.toUpperCase()) ? undefined : payloadBuf,
      signal: AbortSignal.timeout(8000),
    });
    const buffer = Buffer.from(await res.arrayBuffer());
    return {
      ok: res.ok,
      status: res.status,
      headers: res.headers,
      buffer,
      text: buffer.toString('utf8'),
    };
  }

  return {
    providerType: 's3',

    async testConnection() {
      const started = Date.now();
      try {
        const res = await s3Request('HEAD', '');
        const latencyMs = Date.now() - started;
        if (!res.ok) {
          let errCode = `HTTP_${res.status}`;
          if (res.status === 404) errCode = 'NoSuchBucket';
          if (res.status === 403) errCode = 'SignatureDoesNotMatch';
          return {
            ok: false,
            status: 'error',
            driver: 's3',
            latencyMs,
            error: `S3 ${errCode} (${res.status})`,
          };
        }
        return {
          ok: true,
          status: 'connected',
          driver: 's3',
          latencyMs,
        };
      } catch (err) {
        return {
          ok: false,
          status: 'error',
          driver: 's3',
          latencyMs: Date.now() - started,
          error: err.message || 'Falha ao conectar ao endpoint S3.',
        };
      }
    },

    async mkdir(virtualPath) {
      const key = `${toObjectKey(virtualPath).replace(/\/+$/, '')}/.keep`;
      const res = await s3Request('PUT', key, { body: Buffer.alloc(0) });
      if (!res.ok) {
        const err = new Error(`Falha no S3 mkdir (${res.status})`);
        err.statusCode = res.status >= 500 ? 502 : res.status;
        throw err;
      }
      return { ok: true };
    },

    async writeFile(virtualPath, buffer) {
      const key = toObjectKey(virtualPath);
      const res = await s3Request('PUT', key, {
        body: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || ''),
      });
      if (!res.ok) {
        const err = new Error(`Falha no upload S3 (${res.status})`);
        err.statusCode = res.status >= 500 ? 502 : res.status;
        throw err;
      }
      return { ok: true, size: buffer.length };
    },

    async readFile(virtualPath, { rangeHeader } = {}) {
      const key = toObjectKey(virtualPath);
      const headers = {};
      if (rangeHeader) headers.Range = rangeHeader;
      const res = await s3Request('GET', key, { headers });
      if (res.status === 416) {
        const err = new Error('Range Not Satisfiable');
        err.statusCode = 416;
        throw err;
      }
      if (!res.ok) {
        const err = new Error(`Objeto S3 não encontrado (${res.status})`);
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

    async copy(fromVirtualPath, toVirtualPath) {
      const srcKey = toObjectKey(fromVirtualPath);
      const dstKey = toObjectKey(toVirtualPath);
      const copySource = `/${encodeURIComponent(bucket)}/${encodeKeyPath(srcKey)}`;
      const res = await s3Request('PUT', dstKey, {
        headers: { 'x-amz-copy-source': copySource },
      });
      if (!res.ok) {
        // Fallback: read & write
        const readRes = await this.readFile(fromVirtualPath);
        await this.writeFile(toVirtualPath, readRes.buffer);
      }
      return { ok: true };
    },

    async rename(fromVirtualPath, toVirtualPath) {
      await this.copy(fromVirtualPath, toVirtualPath);
      await this.remove(fromVirtualPath);
      return { ok: true };
    },

    async remove(virtualPath) {
      const key = toObjectKey(virtualPath);
      await s3Request('DELETE', key);
      return { ok: true };
    },
  };
}

function createWebDavDriver(endpointUrl, rootPath, connection, credentials) {
  const username = String(connection.username || credentials.username || '');
  const password = String(credentials.password || credentials.token || '');

  function buildAuthHeader() {
    if (credentials.bearerToken) return `Bearer ${credentials.bearerToken}`;
    const token = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
    return `Basic ${token}`;
  }

  function toDavUrl(virtualPath) {
    const vPath = normalizeVirtualVaultPath(virtualPath || '/');
    const combined = rootPath === '/' ? vPath : `${rootPath}${vPath === '/' ? '' : vPath}`;
    const encoded = combined
      .split('/')
      .filter(Boolean)
      .map((s) => encodeURIComponent(s))
      .join('/');
    return encoded ? `${endpointUrl}/${encoded}` : `${endpointUrl}/`;
  }

  async function davRequest(method, virtualPath, { body = null, headers = {} } = {}) {
    const url = toDavUrl(virtualPath);
    const reqHeaders = {
      Authorization: buildAuthHeader(),
      ...headers,
    };
    const res = await fetch(url, {
      method,
      headers: reqHeaders,
      body: body ? (Buffer.isBuffer(body) ? body : Buffer.from(body)) : undefined,
      signal: AbortSignal.timeout(8000),
    });
    const buffer = Buffer.from(await res.arrayBuffer());
    return {
      ok: res.ok || res.status === 207 || res.status === 201 || res.status === 204,
      status: res.status,
      headers: res.headers,
      buffer,
    };
  }

  return {
    providerType: 'webdav',

    async testConnection() {
      const started = Date.now();
      try {
        const res = await davRequest('PROPFIND', '/', { headers: { Depth: '0' } });
        const latencyMs = Date.now() - started;
        if (!res.ok) {
          return {
            ok: false,
            status: 'error',
            driver: 'webdav',
            latencyMs,
            error: `WebDAV HTTP ${res.status}`,
          };
        }
        return {
          ok: true,
          status: 'connected',
          driver: 'webdav',
          latencyMs,
        };
      } catch (err) {
        return {
          ok: false,
          status: 'error',
          driver: 'webdav',
          latencyMs: Date.now() - started,
          error: err.message || 'Falha na conexão WebDAV.',
        };
      }
    },

    async mkdir(virtualPath) {
      const segments = normalizeVirtualVaultPath(virtualPath).split('/').filter(Boolean);
      let current = '';
      for (const seg of segments) {
        current += `/${seg}`;
        const res = await davRequest('MKCOL', current);
        if (!res.ok && res.status !== 405 && res.status !== 409) {
          const err = new Error(`Falha no WebDAV MKCOL (${res.status})`);
          err.statusCode = res.status === 401 || res.status === 403 ? res.status : 502;
          throw err;
        }
      }
      return { ok: true };
    },

    async writeFile(virtualPath, buffer) {
      const vPath = normalizeVirtualVaultPath(virtualPath);
      const parts = vPath.split('/').filter(Boolean);
      if (parts.length > 1) {
        await this.mkdir(`/${parts.slice(0, -1).join('/')}`);
      }
      const res = await davRequest('PUT', vPath, {
        body: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || ''),
      });
      if (!res.ok) {
        const err = new Error(`Falha no WebDAV PUT (${res.status})`);
        err.statusCode = res.status === 401 || res.status === 403 ? res.status : 502;
        throw err;
      }
      return { ok: true, size: buffer.length };
    },

    async readFile(virtualPath, { rangeHeader } = {}) {
      const headers = {};
      if (rangeHeader) headers.Range = rangeHeader;
      const res = await davRequest('GET', virtualPath, { headers });
      if (res.status === 416) {
        const err = new Error('Range Not Satisfiable');
        err.statusCode = 416;
        throw err;
      }
      if (!res.ok) {
        const err = new Error(`Arquivo WebDAV não encontrado (${res.status})`);
        err.statusCode = res.status === 404 ? 404 : 502;
        throw err;
      }
      if (rangeHeader && res.status === 200) {
        const parsed = parseHttpByteRange(rangeHeader, res.buffer.length);
        if (!parsed.valid) {
          const err = new Error('Range Not Satisfiable');
          err.statusCode = 416;
          throw err;
        }
        return {
          status: 206,
          buffer: res.buffer.subarray(parsed.start, parsed.end + 1),
          contentRange: `bytes ${parsed.start}-${parsed.end}/${res.buffer.length}`,
          acceptRanges: 'bytes',
        };
      }
      return {
        status: res.status,
        buffer: res.buffer,
        contentRange: res.headers.get('content-range') || null,
        acceptRanges: res.headers.get('accept-ranges') || 'bytes',
      };
    },

    async rename(fromVirtualPath, toVirtualPath) {
      const destUrl = toDavUrl(toVirtualPath);
      const res = await davRequest('MOVE', fromVirtualPath, {
        headers: { Destination: destUrl, Overwrite: 'T' },
      });
      if (!res.ok) {
        const readRes = await this.readFile(fromVirtualPath);
        await this.writeFile(toVirtualPath, readRes.buffer);
        await this.remove(fromVirtualPath);
      }
      return { ok: true };
    },

    async copy(fromVirtualPath, toVirtualPath) {
      const destUrl = toDavUrl(toVirtualPath);
      const res = await davRequest('COPY', fromVirtualPath, {
        headers: { Destination: destUrl, Overwrite: 'T' },
      });
      if (!res.ok) {
        const readRes = await this.readFile(fromVirtualPath);
        await this.writeFile(toVirtualPath, readRes.buffer);
      }
      return { ok: true };
    },

    async remove(virtualPath) {
      await davRequest('DELETE', virtualPath);
      return { ok: true };
    },
  };
}
