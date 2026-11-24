// services/service-storage/src/drivers/sftpDriver.js
// =============================================================================
// Driver Híbrido 1 — SFTP / SSH Nativo Zero-Install (ssh2)
// =============================================================================

import crypto from 'node:crypto';
import path from 'node:path';
import { Client as SshClient } from 'ssh2';
import { normalizeVirtualVaultPath } from '../../../shared/security.js';

// Pool de sessões SFTP persistentes por host/credencial (elimina handshakes SSH repetidos a cada operação)
const SFTP_WAN_IDLE_TTL_MS = 45_000;
const SFTP_LOOPBACK_IDLE_TTL_MS = 800;
const sftpPool = new Map();

function isLoopbackHost(h) {
  const clean = String(h || '').trim().toLowerCase();
  return clean === '127.0.0.1' || clean === 'localhost' || clean === '::1';
}

function evictPooledSftp(poolKey, expectedEntry = null) {
  const entry = sftpPool.get(poolKey);
  if (!entry || (expectedEntry && entry !== expectedEntry)) return;
  sftpPool.delete(poolKey);
  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  }
  try {
    entry.client?.end();
  } catch {
    /* ignore */
  }
}

export function closeAllSftpSessions() {
  for (const key of Array.from(sftpPool.keys())) {
    evictPooledSftp(key);
  }
}

function touchPooledSftp(poolKey, entry) {
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  const ttl = entry.idleTtlMs || SFTP_WAN_IDLE_TTL_MS;
  entry.idleTimer = setTimeout(() => {
    evictPooledSftp(poolKey, entry);
  }, ttl);
  entry.idleTimer.unref?.();
}

function sanitizeSftpErrorMessage(msg, secrets = []) {
  let out = String(msg || 'Falha na conexão SFTP.');
  for (const s of secrets) {
    if (s && typeof s === 'string' && s.length >= 4) {
      out = out.split(s).join('[REDACTED]');
    }
  }
  return out;
}

export function createSftpDriver(connection, credentials = {}) {
  const host = String(connection.host || credentials.host || '127.0.0.1');
  const port = Number(connection.port || credentials.port || 22);
  const username = String(connection.username || credentials.username || 'root');
  const password = credentials.password ? String(credentials.password) : undefined;
  const privateKey = credentials.privateKey ? String(credentials.privateKey) : undefined;
  const passphrase = credentials.passphrase ? String(credentials.passphrase) : undefined;
  const rootPath = normalizeVirtualVaultPath(connection.root_path || connection.rootPath || '/');

  const secretValues = [password, privateKey, passphrase].filter(Boolean);
  const credFingerprint = crypto
    .createHash('sha256')
    .update(`${host}:${port}:${username}:${password || ''}:${privateKey || ''}:${passphrase || ''}`)
    .digest('hex');

  function resolveRemotePath(virtualPath) {
    const vPath = normalizeVirtualVaultPath(virtualPath || '/');
    if (rootPath === '/') return vPath;
    if (vPath === '/') return rootPath;
    return path.posix.join(rootPath, vPath.replace(/^\/+/, ''));
  }

  function acquirePooledSession() {
    const existing = sftpPool.get(credFingerprint);
    if (existing?.sftp && existing.ready) {
      touchPooledSftp(credFingerprint, existing);
      return Promise.resolve(existing);
    }
    if (existing?.connectingPromise) {
      return existing.connectingPromise;
    }

    const client = new SshClient();
    const entry = {
      client,
      sftp: null,
      ready: false,
      idleTimer: null,
      idleTtlMs: isLoopbackHost(host) ? SFTP_LOOPBACK_IDLE_TTL_MS : SFTP_WAN_IDLE_TTL_MS,
      connectingPromise: null,
    };

    entry.connectingPromise = new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        evictPooledSftp(credFingerprint, entry);
        reject(new Error('Timeout na conexão SFTP.'));
      }, 7000);
      timer.unref?.();

      client.once('ready', () => {
        client.sftp((err, sftpStream) => {
          clearTimeout(timer);
          if (settled) return;
          if (err) {
            settled = true;
            evictPooledSftp(credFingerprint, entry);
            return reject(err);
          }
          settled = true;
          entry.sftp = sftpStream;
          entry.ready = true;
          entry.connectingPromise = null;
          sftpStream.once('close', () => evictPooledSftp(credFingerprint, entry));
          sftpStream.once('error', () => evictPooledSftp(credFingerprint, entry));
          touchPooledSftp(credFingerprint, entry);
          // Unref underlying socket when idle so test runners exit cleanly
          client._sock?.unref?.();
          resolve(entry);
        });
      });

      client.on('error', (err) => {
        clearTimeout(timer);
        evictPooledSftp(credFingerprint, entry);
        if (!settled) {
          settled = true;
          reject(err);
        }
      });

      client.once('close', () => evictPooledSftp(credFingerprint, entry));
      client.once('end', () => evictPooledSftp(credFingerprint, entry));

      const connectConfig = {
        host,
        port,
        username,
        readyTimeout: 6000,
        keepaliveInterval: 15_000,
        keepaliveCountMax: 3,
      };
      if (privateKey) {
        connectConfig.privateKey = privateKey;
        if (passphrase) connectConfig.passphrase = passphrase;
      }
      if (password) {
        connectConfig.password = password;
      }

      try {
        client.connect(connectConfig);
      } catch (syncErr) {
        clearTimeout(timer);
        evictPooledSftp(credFingerprint, entry);
        if (!settled) {
          settled = true;
          reject(syncErr);
        }
      }
    });

    sftpPool.set(credFingerprint, entry);
    return entry.connectingPromise;
  }

  async function withSftpSession(fn) {
    let wasCached = Boolean(sftpPool.get(credFingerprint)?.ready);
    try {
      const entry = await acquirePooledSession();
      touchPooledSftp(credFingerprint, entry);
      return await fn(entry.sftp, entry.client);
    } catch (firstErr) {
      // Se falhou em uma sessão reaproveitada (ex.: servidor fechou canal ocioso), reconecta 1 vez
      if (wasCached && firstErr?.statusCode !== 404) {
        evictPooledSftp(credFingerprint);
        try {
          const fresh = await acquirePooledSession();
          touchPooledSftp(credFingerprint, fresh);
          return await fn(fresh.sftp, fresh.client);
        } catch (retryErr) {
          const cleanRetryMsg = sanitizeSftpErrorMessage(retryErr?.message, secretValues);
          const wrappedRetry = new Error(cleanRetryMsg);
          wrappedRetry.code = retryErr?.code || 'SFTP_ERROR';
          wrappedRetry.statusCode = retryErr?.statusCode || 502;
          throw wrappedRetry;
        }
      }
      if (firstErr?.statusCode !== 404) {
        evictPooledSftp(credFingerprint);
      }
      const cleanMsg = sanitizeSftpErrorMessage(firstErr?.message, secretValues);
      const wrapped = new Error(cleanMsg);
      wrapped.code = firstErr?.code || 'SFTP_ERROR';
      wrapped.statusCode = firstErr?.statusCode || 502;
      throw wrapped;
    }
  }

  async function sftpStat(sftp, remotePath) {
    return new Promise((resolve, reject) => {
      sftp.stat(remotePath, (err, stats) => {
        if (err) return reject(err);
        resolve(stats);
      });
    });
  }

  async function sftpMkdirSingle(sftp, remotePath) {
    return new Promise((resolve, reject) => {
      sftp.mkdir(remotePath, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  async function ensureRemoteDir(sftp, remoteDirPath) {
    const norm = path.posix.normalize(remoteDirPath || '/');
    if (norm === '/' || norm === '.') return;
    const segments = norm.split('/').filter(Boolean);
    let current = '';
    for (const seg of segments) {
      current += `/${seg}`;
      try {
        await sftpStat(sftp, current);
      } catch {
        try {
          await sftpMkdirSingle(sftp, current);
        } catch {
          /* ignore if concurrent created */
        }
      }
    }
  }

  async function writeBuffer(sftp, remotePath, buffer) {
    const parentDir = path.posix.dirname(remotePath);
    await ensureRemoteDir(sftp, parentDir);
    const dataBuf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
    return new Promise((resolve, reject) => {
      sftp.open(remotePath, 'w', (openErr, handle) => {
        if (openErr) return reject(openErr);
        if (dataBuf.length === 0) {
          return sftp.close(handle, (closeErr) => (closeErr ? reject(closeErr) : resolve()));
        }
        sftp.write(handle, dataBuf, 0, dataBuf.length, 0, (writeErr) => {
          sftp.close(handle, (closeErr) => {
            if (writeErr) return reject(writeErr);
            if (closeErr) return reject(closeErr);
            resolve();
          });
        });
      });
    });
  }

  async function readBuffer(sftp, remotePath) {
    const stats = await sftpStat(sftp, remotePath).catch(() => null);
    const size = Number(stats?.size ?? 0);
    return new Promise((resolve, reject) => {
      sftp.open(remotePath, 'r', (openErr, handle) => {
        if (openErr) {
          const notFound = new Error('Arquivo não encontrado via SFTP.');
          notFound.statusCode = 404;
          return reject(notFound);
        }
        const chunks = [];
        let offset = 0;
        const chunkSize = Math.max(Math.min(size || 65536, 262144), 16384);

        function readNext() {
          const buf = Buffer.alloc(chunkSize);
          sftp.read(handle, buf, 0, chunkSize, offset, (readErr, bytesRead, readBuf) => {
            if (readErr) {
              return sftp.close(handle, () => reject(readErr));
            }
            if (!bytesRead || bytesRead <= 0) {
              return sftp.close(handle, () => resolve(Buffer.concat(chunks)));
            }
            chunks.push(Buffer.from(readBuf.subarray(0, bytesRead)));
            offset += bytesRead;
            readNext();
          });
        }
        readNext();
      });
    });
  }

  async function removeRecursive(sftp, remotePath) {
    let stats;
    try {
      stats = await sftpStat(sftp, remotePath);
    } catch {
      return;
    }
    const isDir = typeof stats.isDirectory === 'function' ? stats.isDirectory() : (stats.mode & 0o170000) === 0o040000;
    if (!isDir) {
      await new Promise((resolve) => sftp.unlink(remotePath, () => resolve()));
      return;
    }
    const entries = await new Promise((resolve) => {
      sftp.readdir(remotePath, (err, list) => resolve(err ? [] : list || []));
    });
    for (const item of entries) {
      if (item.filename === '.' || item.filename === '..') continue;
      await removeRecursive(sftp, path.posix.join(remotePath, item.filename));
    }
    await new Promise((resolve) => sftp.rmdir(remotePath, () => resolve()));
  }

  return {
    providerType: 'sftp',

    async testConnection() {
      const started = Date.now();
      try {
        await withSftpSession(async (sftp) => {
          await ensureRemoteDir(sftp, rootPath);
          await sftpStat(sftp, rootPath);
        });
        return {
          ok: true,
          status: 'connected',
          driver: 'sftp',
          latencyMs: Date.now() - started,
        };
      } catch (err) {
        return {
          ok: false,
          status: 'error',
          driver: 'sftp',
          latencyMs: Date.now() - started,
          error: sanitizeSftpErrorMessage(err?.message, secretValues),
        };
      }
    },

    async mkdir(virtualPath) {
      const remotePath = resolveRemotePath(virtualPath);
      await withSftpSession(async (sftp) => {
        await ensureRemoteDir(sftp, remotePath);
      });
      return { ok: true, path: remotePath };
    },

    async mkdirBatch(virtualPaths = []) {
      const list = Array.isArray(virtualPaths) ? virtualPaths.filter(Boolean) : [];
      if (list.length === 0) return { ok: true, created: [] };
      const remotePaths = list.map((vp) => resolveRemotePath(vp));
      await withSftpSession(async (sftp) => {
        for (const rPath of remotePaths) {
          await ensureRemoteDir(sftp, rPath);
        }
      });
      return { ok: true, created: remotePaths };
    },

    async writeFile(virtualPath, buffer) {
      const remotePath = resolveRemotePath(virtualPath);
      await withSftpSession(async (sftp) => {
        await writeBuffer(sftp, remotePath, buffer);
      });
      return { ok: true, size: buffer.length };
    },

    async readFile(virtualPath, { rangeHeader } = {}) {
      const remotePath = resolveRemotePath(virtualPath);
      const fullBuf = await withSftpSession(async (sftp) => readBuffer(sftp, remotePath));
      if (rangeHeader) {
        const parsed = parseHttpByteRange(rangeHeader, fullBuf.length);
        if (!parsed.valid) {
          const err = new Error('Range Not Satisfiable');
          err.statusCode = 416;
          throw err;
        }
        return {
          status: 206,
          buffer: fullBuf.subarray(parsed.start, parsed.end + 1),
          contentRange: `bytes ${parsed.start}-${parsed.end}/${fullBuf.length}`,
          acceptRanges: 'bytes',
        };
      }
      return {
        status: 200,
        buffer: fullBuf,
        contentRange: null,
        acceptRanges: 'bytes',
      };
    },

    async rename(fromVirtualPath, toVirtualPath) {
      const fromPath = resolveRemotePath(fromVirtualPath);
      const toPath = resolveRemotePath(toVirtualPath);
      await withSftpSession(async (sftp) => {
        await ensureRemoteDir(sftp, path.posix.dirname(toPath));
        await new Promise((resolve, reject) => {
          sftp.rename(fromPath, toPath, (err) => (err ? reject(err) : resolve()));
        });
      });
      return { ok: true };
    },

    async copy(fromVirtualPath, toVirtualPath) {
      const fromPath = resolveRemotePath(fromVirtualPath);
      const toPath = resolveRemotePath(toVirtualPath);
      await withSftpSession(async (sftp) => {
        const buf = await readBuffer(sftp, fromPath);
        await writeBuffer(sftp, toPath, buf);
      });
      return { ok: true };
    },

    async remove(virtualPath) {
      const remotePath = resolveRemotePath(virtualPath);
      await withSftpSession(async (sftp) => {
        await removeRecursive(sftp, remotePath);
      });
      return { ok: true };
    },
  };
}

export function parseHttpByteRange(rangeHeader, totalLength) {
  const m = /^bytes=(\d*)-(\d*)$/i.exec(String(rangeHeader || '').trim());
  if (!m) return { valid: false };
  const [, startStr, endStr] = m;
  if (!startStr && !endStr) return { valid: false };
  if (totalLength <= 0) return { valid: false };

  let start;
  let end;
  if (!startStr) {
    const suffixLen = Number.parseInt(endStr, 10);
    if (!Number.isFinite(suffixLen) || suffixLen <= 0) return { valid: false };
    start = Math.max(0, totalLength - suffixLen);
    end = totalLength - 1;
  } else {
    start = Number.parseInt(startStr, 10);
    end = endStr ? Number.parseInt(endStr, 10) : totalLength - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= totalLength || end < start) {
    return { valid: false };
  }
  end = Math.min(end, totalLength - 1);
  return { valid: true, start, end };
}
