// services/service-storage/src/agent/nexusStorageNodeServer.js
// =============================================================================
// Nexus Storage Node — Standalone Daemon (1-Click Linux Agent, Zero External Deps)
// =============================================================================
// Pure Node.js built-ins only (node:crypto, node:fs, node:fs/promises, node:http, node:path, node:url)
// so this exact file runs both inside tests and standalone on any customer Linux VPS
// via `/opt/nexus-storage-node/server.mjs` + systemd.
// =============================================================================

import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf || Buffer.alloc(0)).digest('hex');
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readRawBody(req, maxBytes) {
  const declaredLen = Number(req.headers['content-length'] || 0);
  if (Number.isFinite(declaredLen) && declaredLen > maxBytes) {
    const err = new Error(`Payload excede o limite máximo permitido (${maxBytes} bytes).`);
    err.statusCode = 413;
    err.code = 'PAYLOAD_TOO_LARGE';
    return Promise.reject(err);
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;
    let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      received += chunk.length;
      if (received > maxBytes) {
        settled = true;
        const err = new Error(`Payload excede o limite máximo permitido (${maxBytes} bytes).`);
        err.statusCode = 413;
        err.code = 'PAYLOAD_TOO_LARGE';
        req.destroy();
        reject(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks));
      }
    });
    req.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

function parseJsonBody(rawBody) {
  if (!rawBody || rawBody.length === 0) return {};
  try {
    return JSON.parse(rawBody.toString('utf8'));
  } catch {
    const err = new Error('JSON inválido no corpo da requisição.');
    err.statusCode = 400;
    err.code = 'INVALID_JSON';
    throw err;
  }
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
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dirPath, entry.name);
    try {
      if (entry.isDirectory()) {
        total += await computeDirUsedBytes(full);
      } else if (entry.isFile()) {
        const st = await fsp.stat(full);
        total += st.size;
      }
    } catch {
      // Ignore files removed concurrently during calculation
    }
  }
  return total;
}

async function computePathSize(targetPath) {
  try {
    const st = await fsp.lstat(targetPath);
    if (st.isSymbolicLink()) return 0;
    if (st.isFile()) return st.size;
    if (st.isDirectory()) return computeDirUsedBytes(targetPath);
    return 0;
  } catch {
    return 0;
  }
}

export async function startNexusStorageNodeAgent({
  rootDir = process.env.NEXUS_VAULT_ROOT || '/srv/nexus-vault',
  quotaBytes = Number(process.env.NEXUS_VAULT_QUOTA_BYTES || 53_687_091_200),
  hmacToken = process.env.NEXUS_NODE_HMAC_TOKEN || '',
  port = Number(process.env.NEXUS_NODE_PORT || 9443),
  host = process.env.NEXUS_NODE_BIND || '0.0.0.0',
  maxSkewMs = Number(process.env.NEXUS_NODE_MAX_SKEW_MS || 60_000),
  maxBodyBytes = Number(process.env.NEXUS_NODE_MAX_BODY_BYTES || 120 * 1024 * 1024),
  logger = false,
} = {}) {
  if (!hmacToken || String(hmacToken).trim().length < 16) {
    throw new Error('NEXUS_NODE_HMAC_TOKEN ausente ou inválido (mínimo 16 caracteres).');
  }
  const safeToken = String(hmacToken).trim();
  const effectiveQuota = Number.isFinite(Number(quotaBytes)) && Number(quotaBytes) > 0
    ? Number(quotaBytes)
    : 53_687_091_200;

  const resolvedRoot = path.resolve(String(rootDir || '/srv/nexus-vault'));
  await fsp.mkdir(resolvedRoot, { recursive: true });
  const realRoot = await fsp.realpath(resolvedRoot);
  const rootPosix = resolvedRoot.replace(/\\/g, '/').replace(/\/+$/, '') || '/';

  function requireNonEmptyPath(rawValue, fieldName = 'path') {
    if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') {
      const err = new Error(`Parâmetro '${fieldName}' obrigatório.`);
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

    // If connection rootPath on console matches daemon NEXUS_VAULT_ROOT (e.g. '/srv/nexus-vault'),
    // avoid double-nesting '/srv/nexus-vault/srv/nexus-vault/...' by stripping the matching prefix.
    const canonicalVirtual = segments.length === 0 ? '/' : `/${segments.join('/')}`;
    let relSegments = segments;
    if (rootPosix !== '/' && (canonicalVirtual === rootPosix || canonicalVirtual.startsWith(`${rootPosix}/`))) {
      const rootSegCount = rootPosix.split('/').filter(Boolean).length;
      relSegments = segments.slice(rootSegCount);
    }

    const absTarget = path.resolve(resolvedRoot, ...relSegments);
    const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
    if (absTarget !== resolvedRoot && !absTarget.startsWith(rootWithSep)) {
      const err = new Error('Root directory escape blocked');
      err.statusCode = 403;
      err.code = 'PATH_TRAVERSAL_BLOCKED';
      throw err;
    }

    const virtualNormalized = relSegments.length === 0 ? '/' : `/${relSegments.join('/')}`;
    return { absTarget, virtualNormalized };
  }

  async function assertNoSymlinkEscape(absTarget) {
    const realRootWithSep = realRoot.endsWith(path.sep) ? realRoot : `${realRoot}${path.sep}`;
    let cursor = absTarget;
    while (true) {
      try {
        const lst = await fsp.lstat(cursor);
        if (lst.isSymbolicLink()) {
          const err = new Error('Symbolic link access blocked inside vault');
          err.statusCode = 403;
          err.code = 'PATH_TRAVERSAL_BLOCKED';
          throw err;
        }
        const real = await fsp.realpath(cursor);
        if (real !== realRoot && !real.startsWith(realRootWithSep)) {
          const err = new Error('Symlink directory escape blocked');
          err.statusCode = 403;
          err.code = 'PATH_TRAVERSAL_BLOCKED';
          throw err;
        }
        break;
      } catch (err) {
        if (err?.code === 'PATH_TRAVERSAL_BLOCKED') throw err;
        if (err?.code !== 'ENOENT') throw err;
        const parent = path.dirname(cursor);
        if (parent === cursor) break;
        cursor = parent;
      }
    }
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
    const expectedSig = crypto.createHmac('sha256', safeToken).update(canonical, 'utf8').digest('hex');

    const providedBuf = Buffer.from(String(sigHeader).trim().toLowerCase(), 'utf8');
    const expectedBuf = Buffer.from(expectedSig, 'utf8');
    if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
      return { ok: false, status: 401, code: 'INVALID_SIGNATURE', message: 'Invalid HMAC signature' };
    }

    return { ok: true };
  }

  const server = http.createServer(async (req, res) => {
    try {
      const method = String(req.method || 'GET').toUpperCase();
      const bodyLimitForMethod = ['GET', 'HEAD', 'DELETE'].includes(method) ? 1024 * 1024 : maxBodyBytes;
      const rawBody = await readRawBody(req, bodyLimitForMethod);

      const authResult = verifyAgentHmac(req, rawBody);
      if (!authResult.ok) {
        return sendJson(res, authResult.status, { error: authResult.code, message: authResult.message });
      }

      const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1');
      const pathname = parsedUrl.pathname;

      if (method === 'GET' && pathname === '/health') {
        const usedBytes = await computeDirUsedBytes(resolvedRoot);
        return sendJson(res, 200, {
          ok: true,
          status: 'healthy',
          driver: 'agent_node',
          rootDir: resolvedRoot,
          quotaBytes: effectiveQuota,
          usedBytes,
          freeBytes: Math.max(0, effectiveQuota - usedBytes),
          totalBytes: effectiveQuota,
          pid: process.pid,
          nodeVersion: process.version,
        });
      }

      if (method === 'GET' && pathname === '/statfs') {
        const usedBytes = await computeDirUsedBytes(resolvedRoot);
        return sendJson(res, 200, {
          quotaBytes: effectiveQuota,
          usedBytes,
          freeBytes: Math.max(0, effectiveQuota - usedBytes),
          totalBytes: effectiveQuota,
        });
      }

      if (method === 'GET' && pathname === '/stat') {
        const { absTarget, virtualNormalized } = resolveNodePath(parsedUrl.searchParams.get('path') || '/');
        await assertNoSymlinkEscape(absTarget);
        try {
          const st = await fsp.stat(absTarget);
          return sendJson(res, 200, {
            path: virtualNormalized,
            type: st.isDirectory() ? 'dir' : 'file',
            size: st.isDirectory() ? 0 : st.size,
            mtimeMs: st.mtimeMs,
          });
        } catch (err) {
          if (err?.code === 'ENOENT') {
            return sendJson(res, 404, { error: 'NOT_FOUND', message: 'Path not found' });
          }
          throw err;
        }
      }

      if (method === 'GET' && pathname === '/readdir') {
        const { absTarget, virtualNormalized } = resolveNodePath(parsedUrl.searchParams.get('path') || '/');
        await assertNoSymlinkEscape(absTarget);
        try {
          const dirEntries = await fsp.readdir(absTarget, { withFileTypes: true });
          const entries = [];
          for (const entry of dirEntries) {
            if (entry.isSymbolicLink()) continue;
            const st = await fsp.stat(path.join(absTarget, entry.name));
            entries.push({
              name: entry.name,
              type: entry.isDirectory() ? 'dir' : 'file',
              size: entry.isDirectory() ? 0 : st.size,
              mtimeMs: st.mtimeMs,
            });
          }
          return sendJson(res, 200, { path: virtualNormalized, entries });
        } catch (err) {
          if (err?.code === 'ENOENT') {
            return sendJson(res, 404, { error: 'NOT_FOUND', message: 'Directory not found' });
          }
          throw err;
        }
      }

      if (method === 'POST' && pathname === '/mkdir') {
        const payload = parseJsonBody(rawBody);
        const { absTarget, virtualNormalized } = resolveNodePath(payload.path || '/');
        await assertNoSymlinkEscape(absTarget);
        await fsp.mkdir(absTarget, { recursive: payload.recursive !== false });
        return sendJson(res, 201, { ok: true, path: virtualNormalized });
      }

      if ((method === 'PUT' && pathname === '/files') || (method === 'POST' && pathname === '/write')) {
        let targetVirtual = parsedUrl.searchParams.get('path') || req.headers['x-nexus-path'];
        let fileBuffer = rawBody;

        if (method === 'POST' && pathname === '/write' && !targetVirtual) {
          const payload = parseJsonBody(rawBody);
          targetVirtual = payload.path;
          fileBuffer =
            payload.contentBase64 !== undefined
              ? Buffer.from(String(payload.contentBase64), 'base64')
              : Buffer.from(String(payload.content || ''), 'utf8');
        }

        const { absTarget, virtualNormalized } = resolveNodePath(
          requireNonEmptyPath(targetVirtual, 'path'),
        );
        await assertNoSymlinkEscape(absTarget);

        const currentUsed = await computeDirUsedBytes(resolvedRoot);
        const existingSize = await computePathSize(absTarget);
        if (currentUsed - existingSize + fileBuffer.length > effectiveQuota) {
          return sendJson(res, 413, {
            error: 'QUOTA_EXCEEDED',
            message: 'Quota exceeded on storage node',
            quotaBytes: effectiveQuota,
            usedBytes: currentUsed,
            requestedBytes: fileBuffer.length,
          });
        }

        await fsp.mkdir(path.dirname(absTarget), { recursive: true });
        await fsp.writeFile(absTarget, fileBuffer);
        return sendJson(res, 201, {
          ok: true,
          path: virtualNormalized,
          sizeBytes: fileBuffer.length,
          sha256: sha256Hex(fileBuffer),
        });
      }

      if (method === 'GET' && pathname === '/files') {
        const { absTarget } = resolveNodePath(parsedUrl.searchParams.get('path'));
        await assertNoSymlinkEscape(absTarget);
        let st;
        try {
          st = await fsp.stat(absTarget);
        } catch (err) {
          if (err?.code === 'ENOENT') {
            return sendJson(res, 404, { error: 'NOT_FOUND', message: 'File not found' });
          }
          throw err;
        }
        if (!st.isFile()) {
          return sendJson(res, 400, { error: 'NOT_A_FILE', message: 'Target is a directory' });
        }

        const rangeHeader = req.headers.range;
        if (rangeHeader) {
          const match = /^bytes=(\d*)-(\d*)$/i.exec(String(rangeHeader).trim());
          if (!match || (!match[1] && !match[2]) || st.size === 0) {
            res.writeHead(416, { 'content-range': `bytes */${st.size}` });
            return res.end();
          }
          let start;
          let end;
          if (!match[1] && match[2]) {
            const suffixLength = Number(match[2]);
            if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
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
          res.writeHead(206, {
            'content-type': 'application/octet-stream',
            'accept-ranges': 'bytes',
            'content-range': `bytes ${start}-${end}/${st.size}`,
            'content-length': len,
          });
          return res.end(slice);
        }

        const content = await fsp.readFile(absTarget);
        res.writeHead(200, {
          'content-type': 'application/octet-stream',
          'accept-ranges': 'bytes',
          'content-length': content.length,
        });
        return res.end(content);
      }

      if (method === 'POST' && pathname === '/rename') {
        const payload = parseJsonBody(rawBody);
        const from = resolveNodePath(requireNonEmptyPath(payload.fromPath, 'fromPath'));
        const to = resolveNodePath(requireNonEmptyPath(payload.toPath, 'toPath'));
        await assertNoSymlinkEscape(from.absTarget);
        await assertNoSymlinkEscape(to.absTarget);
        if (from.absTarget === resolvedRoot) {
          return sendJson(res, 403, { error: 'ROOT_PROTECTED', message: 'Cannot rename root directory' });
        }
        try {
          await fsp.access(from.absTarget);
        } catch {
          return sendJson(res, 404, { error: 'NOT_FOUND', message: 'Source not found' });
        }
        await fsp.mkdir(path.dirname(to.absTarget), { recursive: true });
        await fsp.rename(from.absTarget, to.absTarget);
        return sendJson(res, 200, { ok: true, fromPath: from.virtualNormalized, toPath: to.virtualNormalized });
      }

      if (method === 'POST' && pathname === '/copy') {
        const payload = parseJsonBody(rawBody);
        const from = resolveNodePath(requireNonEmptyPath(payload.fromPath, 'fromPath'));
        const to = resolveNodePath(requireNonEmptyPath(payload.toPath, 'toPath'));
        await assertNoSymlinkEscape(from.absTarget);
        await assertNoSymlinkEscape(to.absTarget);
        let srcStat;
        try {
          srcStat = await fsp.stat(from.absTarget);
        } catch {
          return sendJson(res, 404, { error: 'NOT_FOUND', message: 'Source not found' });
        }
        const copySize = await computePathSize(from.absTarget);
        const currentUsed = await computeDirUsedBytes(resolvedRoot);
        const existingDestSize = await computePathSize(to.absTarget);
        if (currentUsed - existingDestSize + copySize > effectiveQuota) {
          return sendJson(res, 413, { error: 'QUOTA_EXCEEDED', message: 'Quota exceeded on copy' });
        }
        await fsp.mkdir(path.dirname(to.absTarget), { recursive: true });
        if (srcStat.isDirectory()) {
          await fsp.cp(from.absTarget, to.absTarget, { recursive: true });
        } else {
          await fsp.copyFile(from.absTarget, to.absTarget);
        }
        return sendJson(res, 200, { ok: true, sizeBytes: copySize });
      }

      if ((method === 'DELETE' && pathname === '/files') || (method === 'POST' && pathname === '/rm')) {
        const payload = method === 'POST' && rawBody.length ? parseJsonBody(rawBody) : {};
        const targetPath = parsedUrl.searchParams.get('path') ?? payload.path;
        const recursive =
          parsedUrl.searchParams.get('recursive') !== 'false' && payload.recursive !== false;
        const { absTarget, virtualNormalized } = resolveNodePath(
          requireNonEmptyPath(targetPath, 'path'),
        );
        await assertNoSymlinkEscape(absTarget);

        if (absTarget === resolvedRoot) {
          return sendJson(res, 403, { error: 'ROOT_PROTECTED', message: 'Cannot delete root directory' });
        }
        try {
          await fsp.access(absTarget);
        } catch {
          return sendJson(res, 404, { error: 'NOT_FOUND', message: 'Path not found' });
        }

        await fsp.rm(absTarget, { recursive, force: false });
        return sendJson(res, 200, { ok: true, path: virtualNormalized });
      }

      return sendJson(res, 404, { error: 'ROUTE_NOT_FOUND', message: `Unsupported route ${method} ${pathname}` });
    } catch (err) {
      if (logger) {
        console.error('[NexusStorageNode] Error:', err?.message || err);
      }
      return sendJson(res, err?.statusCode || 500, {
        error: err?.code || 'INTERNAL_ERROR',
        message: err?.message || 'Internal error',
      });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(port), host, () => resolve());
  });

  const addr = server.address();
  const listenPort = typeof addr === 'object' && addr ? addr.port : Number(port);
  const displayHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;

  return {
    port: listenPort,
    url: `http://${displayHost}:${listenPort}`,
    rootDir: resolvedRoot,
    quotaBytes: effectiveQuota,
    async stop() {
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

const isMainEntry =
  typeof process.argv?.[1] === 'string' &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMainEntry) {
  const agent = await startNexusStorageNodeAgent({ logger: true });
  console.log(`[Nexus Storage Node] Ouvindo em ${process.env.NEXUS_NODE_BIND || '0.0.0.0'}:${agent.port} | Raiz: ${agent.rootDir}`);
  const shutdown = async () => {
    await agent.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
