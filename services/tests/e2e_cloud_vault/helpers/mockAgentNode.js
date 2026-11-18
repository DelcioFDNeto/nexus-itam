// services/tests/e2e_cloud_vault/helpers/mockAgentNode.js
// =============================================================================
// Loopback Nexus Storage Node (1-Click Linux Daemon) HTTP + HMAC-SHA256 Simulator
// =============================================================================
// - Pure Node built-ins (node:http, node:crypto, node:fs, node:fs/promises, node:path, node:os)
// - Validates x-nexus-ts (anti-replay) + x-nexus-sig via crypto.timingSafeEqual
// - Enforces rootDir confinement (403 PATH_TRAVERSAL_BLOCKED) & quotaBytes (413 QUOTA_EXCEEDED)
// =============================================================================

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf || Buffer.alloc(0)).digest('hex');
}

export function signAgentNodeHeaders({
  hmacToken,
  method = 'GET',
  pathWithQuery = '/',
  body = Buffer.alloc(0),
  ts = Date.now(),
} = {}) {
  const rawBody = Buffer.isBuffer(body)
    ? body
    : typeof body === 'string'
      ? Buffer.from(body, 'utf8')
      : body instanceof Uint8Array
        ? Buffer.from(body)
        : body
          ? Buffer.from(JSON.stringify(body), 'utf8')
          : Buffer.alloc(0);

  const tsStr = String(ts);
  const canonical = `${tsStr}.${String(method).toUpperCase()}.${pathWithQuery}.${sha256Hex(rawBody)}`;
  const sig = crypto.createHmac('sha256', String(hmacToken)).update(canonical).digest('hex');
  return {
    'x-nexus-ts': tsStr,
    'x-nexus-sig': sig,
  };
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function computeDirUsedBytes(dirPath) {
  let total = 0;
  let entries;
  try {
    entries = await fsp.readdir(dirPath, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += await computeDirUsedBytes(full);
    } else if (entry.isFile()) {
      const st = await fsp.stat(full);
      total += st.size;
    }
  }
  return total;
}

async function computePathSize(targetPath) {
  try {
    const st = await fsp.stat(targetPath);
    if (st.isFile()) return st.size;
    if (st.isDirectory()) return computeDirUsedBytes(targetPath);
    return 0;
  } catch {
    return 0;
  }
}

export async function startMockAgentNode({
  rootDir,
  quotaBytes = 100 * 1024 * 1024,
  hmacToken = crypto.randomBytes(32).toString('hex'),
  maxSkewMs = 60_000,
} = {}) {
  let autoCreatedRoot = false;
  let resolvedRoot;
  if (rootDir) {
    resolvedRoot = path.resolve(rootDir);
    await fsp.mkdir(resolvedRoot, { recursive: true });
  } else {
    resolvedRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'nexus-agent-node-'));
    autoCreatedRoot = true;
  }

  const requestLog = [];

  function requireNonEmptyPath(rawValue, fieldName = 'path') {
    if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') {
      const err = new Error(`Missing required ${fieldName}`);
      err.statusCode = 400;
      err.code = 'INVALID_PATH';
      throw err;
    }
    return String(rawValue);
  }

  function resolveNodePath(rawVirtualPath) {
    const raw = rawVirtualPath === undefined || rawVirtualPath === null ? '/' : String(rawVirtualPath);
    if (raw.includes('\0') || raw.includes('\\') || /^[a-zA-Z]:/.test(raw.trim())) {
      const err = new Error('Path traversal blocked');
      err.statusCode = 403;
      err.code = 'PATH_TRAVERSAL_BLOCKED';
      throw err;
    }

    // Check URL-encoded traversal sequences as well
    let decoded = raw;
    for (let i = 0; i < 3; i += 1) {
      try {
        const next = decodeURIComponent(decoded);
        if (next === decoded) break;
        decoded = next;
      } catch {
        break;
      }
    }
    if (
      decoded.includes('\0') ||
      decoded.includes('\\') ||
      /^[a-zA-Z]:/.test(decoded.trim()) ||
      /^\/+[a-zA-Z]:/.test(decoded.trim())
    ) {
      const err = new Error('Encoded path traversal blocked');
      err.statusCode = 403;
      err.code = 'PATH_TRAVERSAL_BLOCKED';
      throw err;
    }

    const segments = decoded.split('/').filter((s) => s.length > 0);
    if (segments.some((s) => s === '..' || s === '.')) {
      const err = new Error('Relative path segment blocked');
      err.statusCode = 403;
      err.code = 'PATH_TRAVERSAL_BLOCKED';
      throw err;
    }

    const absTarget = path.resolve(resolvedRoot, ...segments);
    const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
    if (absTarget !== resolvedRoot && !absTarget.startsWith(rootWithSep)) {
      const err = new Error('Root directory escape blocked');
      err.statusCode = 403;
      err.code = 'PATH_TRAVERSAL_BLOCKED';
      throw err;
    }

    const virtualNormalized = segments.length === 0 ? '/' : `/${segments.join('/')}`;
    return { absTarget, virtualNormalized };
  }

  function verifyAgentHmac(req, rawBody) {
    const tsHeader = req.headers['x-nexus-ts'];
    const sigHeader = req.headers['x-nexus-sig'];
    if (!tsHeader || !sigHeader) {
      return { ok: false, status: 401, code: 'AUTH_MISSING', message: 'Missing HMAC headers' };
    }

    const ts = Number(tsHeader);
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > maxSkewMs) {
      return { ok: false, status: 401, code: 'AUTH_EXPIRED', message: 'Timestamp outside anti-replay window' };
    }

    const canonical = `${String(tsHeader)}.${req.method.toUpperCase()}.${req.url}.${sha256Hex(rawBody)}`;
    const expectedSig = crypto.createHmac('sha256', String(hmacToken)).update(canonical).digest('hex');

    const providedBuf = Buffer.from(String(sigHeader).trim().toLowerCase(), 'utf8');
    const expectedBuf = Buffer.from(expectedSig, 'utf8');
    if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
      return { ok: false, status: 401, code: 'INVALID_SIGNATURE', message: 'Invalid HMAC signature' };
    }

    return { ok: true };
  }

  const server = http.createServer(async (req, res) => {
    const startTs = Date.now();
    let status = 500;
    let authorized = false;
    let errorCode;

    const finishLog = () => {
      requestLog.push({
        ts: startTs,
        method: req.method,
        url: req.url,
        status,
        authorized,
        ...(errorCode ? { errorCode } : {}),
      });
    };

    try {
      const rawBody = await readRawBody(req);
      const authResult = verifyAgentHmac(req, rawBody);
      if (!authResult.ok) {
        status = authResult.status;
        errorCode = authResult.code;
        finishLog();
        return sendJson(res, status, { error: authResult.code, message: authResult.message });
      }
      authorized = true;

      const parsedUrl = new URL(req.url, 'http://127.0.0.1');
      const pathname = parsedUrl.pathname;
      const method = req.method.toUpperCase();

      if (method === 'GET' && pathname === '/health') {
        const usedBytes = await computeDirUsedBytes(resolvedRoot);
        status = 200;
        finishLog();
        return sendJson(res, 200, {
          ok: true,
          status: 'healthy',
          driver: 'agent_node',
          latencyMs: 1,
          quotaBytes,
          usedBytes,
          freeBytes: Math.max(0, quotaBytes - usedBytes),
          totalBytes: quotaBytes,
        });
      }

      if (method === 'GET' && pathname === '/statfs') {
        const usedBytes = await computeDirUsedBytes(resolvedRoot);
        status = 200;
        finishLog();
        return sendJson(res, 200, {
          quotaBytes,
          usedBytes,
          freeBytes: Math.max(0, quotaBytes - usedBytes),
          totalBytes: quotaBytes,
        });
      }

      if (method === 'GET' && pathname === '/stat') {
        const { absTarget, virtualNormalized } = resolveNodePath(parsedUrl.searchParams.get('path') || '/');
        try {
          const st = await fsp.stat(absTarget);
          status = 200;
          finishLog();
          return sendJson(res, 200, {
            path: virtualNormalized,
            type: st.isDirectory() ? 'dir' : 'file',
            size: st.isDirectory() ? 0 : st.size,
            mtimeMs: st.mtimeMs,
          });
        } catch (err) {
          if (err?.code === 'ENOENT') {
            status = 404;
            errorCode = 'NOT_FOUND';
            finishLog();
            return sendJson(res, 404, { error: 'NOT_FOUND', message: 'Path not found' });
          }
          throw err;
        }
      }

      if (method === 'GET' && pathname === '/readdir') {
        const { absTarget, virtualNormalized } = resolveNodePath(parsedUrl.searchParams.get('path') || '/');
        try {
          const dirEntries = await fsp.readdir(absTarget, { withFileTypes: true });
          const entries = await Promise.all(
            dirEntries.map(async (entry) => {
              const st = await fsp.stat(path.join(absTarget, entry.name));
              return {
                name: entry.name,
                type: entry.isDirectory() ? 'dir' : 'file',
                size: entry.isDirectory() ? 0 : st.size,
                mtimeMs: st.mtimeMs,
              };
            }),
          );
          status = 200;
          finishLog();
          return sendJson(res, 200, { path: virtualNormalized, entries });
        } catch (err) {
          if (err?.code === 'ENOENT') {
            status = 404;
            errorCode = 'NOT_FOUND';
            finishLog();
            return sendJson(res, 404, { error: 'NOT_FOUND', message: 'Directory not found' });
          }
          throw err;
        }
      }

      if (method === 'POST' && pathname === '/mkdir') {
        const payload = rawBody.length ? JSON.parse(rawBody.toString('utf8')) : {};
        const { absTarget, virtualNormalized } = resolveNodePath(payload.path || '/');
        await fsp.mkdir(absTarget, { recursive: payload.recursive !== false });
        status = 201;
        finishLog();
        return sendJson(res, 201, { ok: true, path: virtualNormalized });
      }

      if ((method === 'PUT' && pathname === '/files') || (method === 'POST' && pathname === '/write')) {
        let targetVirtual = parsedUrl.searchParams.get('path') || req.headers['x-nexus-path'];
        let fileBuffer = rawBody;

        if (method === 'POST' && pathname === '/write' && !targetVirtual) {
          let payload = {};
          if (rawBody.length) {
            try {
              payload = JSON.parse(rawBody.toString('utf8'));
            } catch {
              payload = {};
            }
          }
          targetVirtual = payload.path;
          fileBuffer =
            payload.contentBase64 !== undefined
              ? Buffer.from(String(payload.contentBase64), 'base64')
              : Buffer.from(String(payload.content || ''), 'utf8');
        }

        const { absTarget, virtualNormalized } = resolveNodePath(
          requireNonEmptyPath(targetVirtual, 'path'),
        );
        const currentUsed = await computeDirUsedBytes(resolvedRoot);
        const existingSize = await computePathSize(absTarget);
        const projected = currentUsed - existingSize + fileBuffer.length;
        if (projected > quotaBytes) {
          status = 413;
          errorCode = 'QUOTA_EXCEEDED';
          finishLog();
          return sendJson(res, 413, {
            error: 'QUOTA_EXCEEDED',
            message: 'Quota exceeded on storage node',
            quotaBytes,
            usedBytes: currentUsed,
            requestedBytes: fileBuffer.length,
          });
        }

        await fsp.mkdir(path.dirname(absTarget), { recursive: true });
        await fsp.writeFile(absTarget, fileBuffer);
        status = 201;
        finishLog();
        return sendJson(res, 201, {
          ok: true,
          path: virtualNormalized,
          sizeBytes: fileBuffer.length,
          sha256: sha256Hex(fileBuffer),
        });
      }

      if (method === 'GET' && pathname === '/files') {
        const { absTarget } = resolveNodePath(parsedUrl.searchParams.get('path'));
        let st;
        try {
          st = await fsp.stat(absTarget);
        } catch (err) {
          if (err?.code === 'ENOENT') {
            status = 404;
            errorCode = 'NOT_FOUND';
            finishLog();
            return sendJson(res, 404, { error: 'NOT_FOUND', message: 'File not found' });
          }
          throw err;
        }

        if (!st.isFile()) {
          status = 400;
          errorCode = 'NOT_A_FILE';
          finishLog();
          return sendJson(res, 400, { error: 'NOT_A_FILE', message: 'Target is a directory' });
        }

        const rangeHeader = req.headers.range;
        if (rangeHeader) {
          const match = /^bytes=(\d*)-(\d*)$/i.exec(String(rangeHeader).trim());
          if (!match || (!match[1] && !match[2]) || st.size === 0) {
            status = 416;
            finishLog();
            res.writeHead(416, { 'content-range': `bytes */${st.size}` });
            return res.end();
          }
          let start;
          let end;
          if (!match[1] && match[2]) {
            const suffixLength = Number(match[2]);
            if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
              status = 416;
              finishLog();
              res.writeHead(416, { 'content-range': `bytes */${st.size}` });
              return res.end();
            }
            start = Math.max(0, st.size - suffixLength);
            end = st.size - 1;
          } else {
            start = Number(match[1]);
            end = match[2] ? Math.min(Number(match[2]), st.size - 1) : st.size - 1;
          }
          if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || start > end || start >= st.size) {
            status = 416;
            finishLog();
            res.writeHead(416, { 'content-range': `bytes */${st.size}` });
            return res.end();
          }

          const len = end - start + 1;
          const fh = await fsp.open(absTarget, 'r');
          const slice = Buffer.alloc(len);
          try {
            await fh.read(slice, 0, len, start);
          } finally {
            await fh.close();
          }
          status = 206;
          finishLog();
          res.writeHead(206, {
            'content-type': 'application/octet-stream',
            'accept-ranges': 'bytes',
            'content-range': `bytes ${start}-${end}/${st.size}`,
            'content-length': len,
          });
          return res.end(slice);
        }

        const content = await fsp.readFile(absTarget);
        status = 200;
        finishLog();
        res.writeHead(200, {
          'content-type': 'application/octet-stream',
          'accept-ranges': 'bytes',
          'content-length': content.length,
        });
        return res.end(content);
      }

      if (method === 'POST' && pathname === '/rename') {
        const payload = rawBody.length ? JSON.parse(rawBody.toString('utf8')) : {};
        const from = resolveNodePath(requireNonEmptyPath(payload.fromPath, 'fromPath'));
        const to = resolveNodePath(requireNonEmptyPath(payload.toPath, 'toPath'));
        try {
          await fsp.access(from.absTarget);
        } catch {
          status = 404;
          errorCode = 'NOT_FOUND';
          finishLog();
          return sendJson(res, 404, { error: 'NOT_FOUND', message: 'Source not found' });
        }
        await fsp.mkdir(path.dirname(to.absTarget), { recursive: true });
        await fsp.rename(from.absTarget, to.absTarget);
        status = 200;
        finishLog();
        return sendJson(res, 200, { ok: true, fromPath: from.virtualNormalized, toPath: to.virtualNormalized });
      }

      if (method === 'POST' && pathname === '/copy') {
        const payload = rawBody.length ? JSON.parse(rawBody.toString('utf8')) : {};
        const from = resolveNodePath(requireNonEmptyPath(payload.fromPath, 'fromPath'));
        const to = resolveNodePath(requireNonEmptyPath(payload.toPath, 'toPath'));
        let srcStat;
        try {
          srcStat = await fsp.stat(from.absTarget);
        } catch {
          status = 404;
          errorCode = 'NOT_FOUND';
          finishLog();
          return sendJson(res, 404, { error: 'NOT_FOUND', message: 'Source not found' });
        }
        const copySize = await computePathSize(from.absTarget);
        const currentUsed = await computeDirUsedBytes(resolvedRoot);
        const existingDestSize = await computePathSize(to.absTarget);
        if (currentUsed - existingDestSize + copySize > quotaBytes) {
          status = 413;
          errorCode = 'QUOTA_EXCEEDED';
          finishLog();
          return sendJson(res, 413, { error: 'QUOTA_EXCEEDED', message: 'Quota exceeded on copy' });
        }
        await fsp.mkdir(path.dirname(to.absTarget), { recursive: true });
        if (srcStat.isDirectory()) {
          await fsp.cp(from.absTarget, to.absTarget, { recursive: true });
        } else {
          await fsp.copyFile(from.absTarget, to.absTarget);
        }
        status = 200;
        finishLog();
        return sendJson(res, 200, { ok: true, sizeBytes: copySize });
      }

      if ((method === 'DELETE' && pathname === '/files') || (method === 'POST' && pathname === '/rm')) {
        const payload = method === 'POST' && rawBody.length ? JSON.parse(rawBody.toString('utf8')) : {};
        const targetPath = parsedUrl.searchParams.get('path') ?? payload.path;
        const recursive =
          parsedUrl.searchParams.get('recursive') !== 'false' && payload.recursive !== false;
        const { absTarget, virtualNormalized } = resolveNodePath(
          requireNonEmptyPath(targetPath, 'path'),
        );

        if (absTarget === resolvedRoot) {
          status = 403;
          errorCode = 'ROOT_PROTECTED';
          finishLog();
          return sendJson(res, 403, { error: 'ROOT_PROTECTED', message: 'Cannot delete root directory' });
        }

        try {
          await fsp.access(absTarget);
        } catch {
          status = 404;
          errorCode = 'NOT_FOUND';
          finishLog();
          return sendJson(res, 404, { error: 'NOT_FOUND', message: 'Path not found' });
        }

        await fsp.rm(absTarget, { recursive, force: false });
        status = 200;
        finishLog();
        return sendJson(res, 200, { ok: true, path: virtualNormalized });
      }

      status = 404;
      errorCode = 'ROUTE_NOT_FOUND';
      finishLog();
      return sendJson(res, 404, { error: 'ROUTE_NOT_FOUND', message: `Unsupported route ${method} ${pathname}` });
    } catch (err) {
      status = err?.statusCode || 500;
      errorCode = err?.code || 'INTERNAL_ERROR';
      finishLog();
      return sendJson(res, status, { error: errorCode, message: err?.message || 'Internal error' });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address();
  const url = `http://127.0.0.1:${addr.port}`;

  return {
    url,
    rootDir: resolvedRoot,
    quotaBytes,
    hmacToken,
    getRequestLog() {
      return [...requestLog];
    },
    async getUsedBytes() {
      return computeDirUsedBytes(resolvedRoot);
    },
    async stop() {
      await new Promise((resolve) => server.close(() => resolve()));
      if (autoCreatedRoot && fs.existsSync(resolvedRoot)) {
        await fsp.rm(resolvedRoot, { recursive: true, force: true });
      }
    },
  };
}
