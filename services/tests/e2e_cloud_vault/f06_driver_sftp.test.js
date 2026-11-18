// services/tests/e2e_cloud_vault/f06_driver_sftp.test.js
// =============================================================================
// F-06: Hybrid Driver — SFTP / SSH Nativo Zero-Install (Local Loopback ssh2.Server)
// =============================================================================

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import ssh2Mod from 'ssh2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootE2eCluster } from './helpers/clusterHarness.js';
import { assertSafeVpsTestRoot, createDisposableVpsRoot } from './helpers/wslVpsConfig.js';
import { assertFullAuditIntegrity } from './helpers/auditHelper.js';

const ssh2 = ssh2Mod.default || ssh2Mod;
const { Server: SshServer, utils: sshUtils } = ssh2;
const { OPEN_MODE, STATUS_CODE } = sshUtils.sftp;

function extractId(payload) {
  return payload?.id ?? payload?.node?.id ?? payload?.data?.id;
}

function getClosedLoopbackPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function startLoopbackSftpServer() {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'nexus-sftp-loopback-'));
  const hostKey = sshUtils.generateKeyPairSync('ed25519');
  const ed25519UserKey = sshUtils.generateKeyPairSync('ed25519');
  const rsaPassphrase = crypto.randomBytes(12).toString('hex');
  const rsaUserKey = sshUtils.generateKeyPairSync('rsa', {
    bits: 2048,
    passphrase: rsaPassphrase,
    cipher: 'aes256-ctr',
  });
  const userPassword = crypto.randomBytes(12).toString('hex');
  const username = 'vault-sftp';

  const parsedEdPub = sshUtils.parseKey(ed25519UserKey.public);
  const parsedRsaPub = sshUtils.parseKey(rsaUserKey.public);
  const allowedPubKeys = [parsedEdPub, parsedRsaPub];

  let handleSeq = 1;

  function resolveSftpPath(rawPath) {
    const cleaned = String(rawPath || '/').replace(/\\/g, '/');
    if (cleaned.includes('\0')) return null;
    const segments = cleaned.split('/').filter((s) => s.length > 0 && s !== '.');
    if (segments.some((s) => s === '..')) return null;
    const abs = path.resolve(tempRoot, ...segments);
    const rootPrefix = tempRoot.endsWith(path.sep) ? tempRoot : `${tempRoot}${path.sep}`;
    if (abs !== tempRoot && !abs.startsWith(rootPrefix)) return null;
    return {
      abs,
      posix: segments.length === 0 ? '/' : `/${segments.join('/')}`,
    };
  }

  function statsToAttrs(st) {
    return {
      mode: st.mode,
      uid: st.uid || 1000,
      gid: st.gid || 1000,
      size: st.isDirectory() ? 0 : st.size,
      atime: Math.floor(st.atimeMs / 1000),
      mtime: Math.floor(st.mtimeMs / 1000),
    };
  }

  function formatLongname(name, st) {
    const isDir = st.isDirectory();
    const typeChar = isDir ? 'd' : '-';
    const perms = isDir ? 'rwxr-xr-x' : 'rw-r--r--';
    const sizeStr = String(isDir ? 4096 : st.size).padStart(8, ' ');
    return `${typeChar}${perms} 1 ${username} ${username} ${sizeStr} Jan 01 00:00 ${name}`;
  }

  const server = new SshServer(
    {
      hostKeys: [hostKey.private],
    },
    (client) => {
      client.on('authentication', (ctx) => {
        if (ctx.username !== username) {
          return ctx.reject();
        }
        if (ctx.method === 'password') {
          const a = Buffer.from(String(ctx.password || ''), 'utf8');
          const b = Buffer.from(userPassword, 'utf8');
          if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
            return ctx.accept();
          }
          return ctx.reject(['password', 'publickey']);
        }
        if (ctx.method === 'publickey') {
          const matched = allowedPubKeys.find(
            (pk) =>
              ctx.key.algo === pk.type &&
              ctx.key.data.length === pk.getPublicSSH().length &&
              crypto.timingSafeEqual(ctx.key.data, pk.getPublicSSH()),
          );
          if (!matched) {
            return ctx.reject(['publickey', 'password']);
          }
          if (ctx.signature) {
            const verified = matched.verify(ctx.blob, ctx.signature, ctx.hashAlgo);
            if (verified === true) {
              return ctx.accept();
            }
            return ctx.reject(['publickey', 'password']);
          }
          return ctx.accept();
        }
        return ctx.reject(['publickey', 'password']);
      });

      client.on('ready', () => {
        client.on('session', (acceptSession) => {
          const session = acceptSession();

          session.on('exec', (acceptExec, rejectExec, info) => {
            const stream = acceptExec();
            const cmd = String(info?.command || '').trim();

            if (cmd.includes('df ')) {
              stream.stdout.write(
                'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/vda1 104857600 1048576 103809024 1% /\n',
              );
              stream.exit(0);
              stream.end();
              return;
            }
            if (cmd.startsWith('mkdir ')) {
              const target = cmd.replace(/^mkdir\s+-p\s+/, '').replace(/['"]/g, '').trim();
              const resolved = resolveSftpPath(target);
              if (resolved) {
                fs.mkdirSync(resolved.abs, { recursive: true });
                stream.exit(0);
              } else {
                stream.stderr.write('Permission denied\n');
                stream.exit(1);
              }
              stream.end();
              return;
            }
            stream.stdout.write('ok\n');
            stream.exit(0);
            stream.end();
          });

          session.on('sftp', (acceptSftp) => {
            const sftp = acceptSftp();
            const openHandles = new Map();

            function allocHandle(state) {
              const id = handleSeq++;
              const buf = Buffer.alloc(4);
              buf.writeUInt32BE(id, 0);
              openHandles.set(buf.toString('hex'), state);
              return buf;
            }

            sftp.on('REALPATH', (reqid, reqPath) => {
              const resolved = resolveSftpPath(reqPath || '/');
              if (!resolved) return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
              return sftp.name(reqid, [{ filename: resolved.posix, longname: resolved.posix, attrs: {} }]);
            });

            const handleStat = async (reqid, reqPath) => {
              const resolved = resolveSftpPath(reqPath);
              if (!resolved) return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
              try {
                const st = await fsp.stat(resolved.abs);
                return sftp.attrs(reqid, statsToAttrs(st));
              } catch {
                return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
              }
            };
            sftp.on('STAT', handleStat);
            sftp.on('LSTAT', handleStat);

            sftp.on('FSTAT', async (reqid, handleBuf) => {
              const state = openHandles.get(handleBuf.toString('hex'));
              if (!state) return sftp.status(reqid, STATUS_CODE.FAILURE);
              try {
                const st = await fsp.stat(state.abs);
                return sftp.attrs(reqid, statsToAttrs(st));
              } catch {
                return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
              }
            });

            sftp.on('MKDIR', async (reqid, reqPath) => {
              const resolved = resolveSftpPath(reqPath);
              if (!resolved) return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
              try {
                await fsp.mkdir(resolved.abs, { recursive: true });
                return sftp.status(reqid, STATUS_CODE.OK);
              } catch {
                return sftp.status(reqid, STATUS_CODE.FAILURE);
              }
            });

            sftp.on('OPENDIR', async (reqid, reqPath) => {
              const resolved = resolveSftpPath(reqPath);
              if (!resolved) return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
              try {
                const dirents = await fsp.readdir(resolved.abs, { withFileTypes: true });
                const entries = [];
                for (const d of dirents) {
                  const st = await fsp.stat(path.join(resolved.abs, d.name));
                  entries.push({
                    filename: d.name,
                    longname: formatLongname(d.name, st),
                    attrs: statsToAttrs(st),
                  });
                }
                const handle = allocHandle({ isDir: true, abs: resolved.abs, entries, sent: false });
                return sftp.handle(reqid, handle);
              } catch {
                return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
              }
            });

            sftp.on('READDIR', (reqid, handleBuf) => {
              const state = openHandles.get(handleBuf.toString('hex'));
              if (!state || !state.isDir) return sftp.status(reqid, STATUS_CODE.FAILURE);
              if (state.sent) return sftp.status(reqid, STATUS_CODE.EOF);
              state.sent = true;
              return sftp.name(reqid, state.entries);
            });

            sftp.on('OPEN', async (reqid, filename, flags) => {
              const resolved = resolveSftpPath(filename);
              if (!resolved) return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);

              const wantsWrite = Boolean(flags & OPEN_MODE.WRITE);
              const wantsCreat = Boolean(flags & OPEN_MODE.CREAT);
              const wantsTrunc = Boolean(flags & OPEN_MODE.TRUNC);
              const wantsAppend = Boolean(flags & OPEN_MODE.APPEND);

              try {
                if (wantsCreat || wantsWrite) {
                  await fsp.mkdir(path.dirname(resolved.abs), { recursive: true });
                }
                let nodeFlags = 'r';
                if (wantsWrite && wantsCreat && wantsTrunc) nodeFlags = 'w+';
                else if (wantsWrite && wantsAppend) nodeFlags = 'a+';
                else if (wantsWrite && wantsCreat) nodeFlags = 'w+';
                else if (wantsWrite) nodeFlags = 'r+';

                const fh = await fsp.open(resolved.abs, nodeFlags);
                const handle = allocHandle({ isDir: false, abs: resolved.abs, fh });
                return sftp.handle(reqid, handle);
              } catch {
                return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
              }
            });

            sftp.on('READ', async (reqid, handleBuf, offset, length) => {
              const state = openHandles.get(handleBuf.toString('hex'));
              if (!state || state.isDir || !state.fh) return sftp.status(reqid, STATUS_CODE.FAILURE);
              try {
                const buf = Buffer.alloc(length);
                const { bytesRead } = await state.fh.read(buf, 0, length, Number(offset));
                if (bytesRead === 0) return sftp.status(reqid, STATUS_CODE.EOF);
                return sftp.data(reqid, buf.subarray(0, bytesRead));
              } catch {
                return sftp.status(reqid, STATUS_CODE.FAILURE);
              }
            });

            sftp.on('WRITE', async (reqid, handleBuf, offset, data) => {
              const state = openHandles.get(handleBuf.toString('hex'));
              if (!state || state.isDir || !state.fh) return sftp.status(reqid, STATUS_CODE.FAILURE);
              try {
                await state.fh.write(data, 0, data.length, Number(offset));
                return sftp.status(reqid, STATUS_CODE.OK);
              } catch {
                return sftp.status(reqid, STATUS_CODE.FAILURE);
              }
            });

            sftp.on('CLOSE', async (reqid, handleBuf) => {
              const key = handleBuf.toString('hex');
              const state = openHandles.get(key);
              openHandles.delete(key);
              if (state?.fh) {
                try {
                  await state.fh.close();
                } catch {
                  /* ignore */
                }
              }
              return sftp.status(reqid, STATUS_CODE.OK);
            });

            sftp.on('REMOVE', async (reqid, reqPath) => {
              const resolved = resolveSftpPath(reqPath);
              if (!resolved) return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
              try {
                await fsp.unlink(resolved.abs);
                return sftp.status(reqid, STATUS_CODE.OK);
              } catch {
                return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
              }
            });

            sftp.on('RMDIR', async (reqid, reqPath) => {
              const resolved = resolveSftpPath(reqPath);
              if (!resolved) return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
              try {
                await fsp.rmdir(resolved.abs);
                return sftp.status(reqid, STATUS_CODE.OK);
              } catch {
                return sftp.status(reqid, STATUS_CODE.FAILURE);
              }
            });

            sftp.on('RENAME', async (reqid, oldPath, newPath) => {
              const from = resolveSftpPath(oldPath);
              const to = resolveSftpPath(newPath);
              if (!from || !to) return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
              try {
                await fsp.mkdir(path.dirname(to.abs), { recursive: true });
                await fsp.rename(from.abs, to.abs);
                return sftp.status(reqid, STATUS_CODE.OK);
              } catch {
                return sftp.status(reqid, STATUS_CODE.FAILURE);
              }
            });

            sftp.on('SETSTAT', (reqid) => sftp.status(reqid, STATUS_CODE.OK));
            sftp.on('FSETSTAT', (reqid) => sftp.status(reqid, STATUS_CODE.OK));
          });
        });
      });
    },
  );

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const { port } = server.address();

  return {
    host: '127.0.0.1',
    port,
    username,
    tempRoot,
    ed25519PrivateKey: ed25519UserKey.private,
    rsaPrivateKey: rsaUserKey.private,
    rsaPassphrase,
    password: userPassword,
    async stop() {
      await new Promise((resolve) => server.close(() => resolve()));
      await fsp.rm(tempRoot, { recursive: true, force: true });
    },
  };
}

describe('F-06: Hybrid Driver — SFTP / SSH Nativo Zero-Install', () => {
  let cluster;
  let sftpServer;
  let ownerSession;
  let betaOwnerToken;
  let superadminToken;

  beforeAll(async () => {
    cluster = await bootE2eCluster();
    sftpServer = await startLoopbackSftpServer();
    ownerSession = await cluster.loginAs('ti@shineraybysabel.com.br', 'Shineray@2026!');
    betaOwnerToken = cluster.createUserToken({
      sub: 'f06-beta-own',
      email: 'owner@beta.example.com',
      role: 'owner',
      tenantId: 'tenant-beta',
      department: 'TI',
    });
    superadminToken = cluster.createUserToken({
      sub: 'f06-sa-master',
      email: 'master@nexus.internal',
      role: 'superadmin',
      tenantId: 'nexus-master',
    });
  }, 45_000);

  afterAll(async () => {
    try {
      if (sftpServer) await sftpServer.stop();
    } finally {
      if (cluster) await cluster.stop();
    }
  }, 45_000);

  async function connectEd25519Sftp(token) {
    const res = await cluster.apiFetch(token, '/api/v1/storage/connection', {
      method: 'PUT',
      body: {
        providerType: 'sftp',
        label: 'Loopback SFTP Ed25519',
        host: sftpServer.host,
        port: sftpServer.port,
        username: sftpServer.username,
        rootPath: '/',
        authMethod: 'privateKey',
        privateKey: sftpServer.ed25519PrivateKey,
        quotaBytes: 50 * 1024 * 1024,
      },
    });
    expect([200, 201]).toContain(res.status);
    return res;
  }

  describe('Tier 1 — Auth Modes, Handshake, VFS CRUD & Safety Contract', () => {
    it('T1.1 — configures SFTP (Ed25519 key) and masks privateKey on PUT and GET /connection', async () => {
      const token = cluster.createUserToken({
        sub: 'f06-t1-own',
        email: 'f06t1@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f06-t1',
      });
      const putRes = await connectEd25519Sftp(token);
      expect(putRes.text).not.toContain('OPENSSH PRIVATE KEY');

      const getRes = await cluster.apiFetch(token, '/api/v1/storage/connection');
      expect(getRes.status).toBe(200);
      const conn = getRes.data?.connection || getRes.data;
      expect(conn?.providerType).toBe('sftp');
      expect(conn?.host).toBe('127.0.0.1');
      expect(Number(conn?.port)).toBe(sftpServer.port);
      expect(getRes.text).not.toContain(sftpServer.ed25519PrivateKey);
    });

    it('T1.2 — executes SFTP connection/test handshake and returns latency telemetry', async () => {
      const token = cluster.createUserToken({
        sub: 'f06-t2-own',
        email: 'f06t2@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f06-t2',
      });
      await connectEd25519Sftp(token);

      const testRes = await cluster.apiFetch(token, '/api/v1/storage/connection/test', { method: 'POST' });
      expect(testRes.status).toBe(200);
      expect(testRes.data?.ok).toBe(true);
      expect(testRes.data?.status).toBe('connected');
      expect(typeof testRes.data?.latencyMs).toBe('number');
      expect(testRes.data.latencyMs).toBeGreaterThanOrEqual(0);

      const getConn = await cluster.apiFetch(token, '/api/v1/storage/connection');
      expect(getConn.status).toBe(200);
      expect((getConn.data?.connection || getConn.data)?.status).toBe('connected');
    });

    it('T1.3 — supports passphrase-encrypted RSA private key and password authentication modes', async () => {
      const token = cluster.createUserToken({
        sub: 'f06-t3-own',
        email: 'f06t3@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f06-t3',
      });

      const rsaPut = await cluster.apiFetch(token, '/api/v1/storage/connection', {
        method: 'PUT',
        body: {
          providerType: 'sftp',
          host: sftpServer.host,
          port: sftpServer.port,
          username: sftpServer.username,
          rootPath: '/',
          authMethod: 'privateKey',
          privateKey: sftpServer.rsaPrivateKey,
          passphrase: sftpServer.rsaPassphrase,
        },
      });
      expect([200, 201]).toContain(rsaPut.status);

      const rsaTest = await cluster.apiFetch(token, '/api/v1/storage/connection/test', { method: 'POST' });
      expect(rsaTest.status).toBe(200);
      expect(rsaTest.data?.ok).toBe(true);

      const getAfterRsa = await cluster.apiFetch(token, '/api/v1/storage/connection');
      expect(getAfterRsa.status).toBe(200);
      expect(getAfterRsa.text).not.toContain(sftpServer.rsaPassphrase);
      expect(getAfterRsa.text).not.toContain(sftpServer.rsaPrivateKey);

      const passPut = await cluster.apiFetch(token, '/api/v1/storage/connection', {
        method: 'PUT',
        body: {
          providerType: 'sftp',
          host: sftpServer.host,
          port: sftpServer.port,
          username: sftpServer.username,
          rootPath: '/',
          authMethod: 'password',
          password: sftpServer.password,
        },
      });
      expect([200, 201]).toContain(passPut.status);

      const passTest = await cluster.apiFetch(token, '/api/v1/storage/connection/test', { method: 'POST' });
      expect(passTest.status).toBe(200);
      expect(passTest.data?.ok).toBe(true);

      const getAfterPass = await cluster.apiFetch(token, '/api/v1/storage/connection');
      expect(getAfterPass.status).toBe(200);
      expect(getAfterPass.text).not.toContain(sftpServer.password);
    });

    it('T1.4 — executes SFTP VFS CRUD (mkdir, upload, download SHA-256 parity, rename, soft-delete)', async () => {
      await connectEd25519Sftp(ownerSession.accessToken);

      const folderRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/folders', {
        method: 'POST',
        body: { parentId: null, name: 'SftpCrudDir' },
      });
      expect(folderRes.status).toBe(201);
      const folderId = extractId(folderRes.data);

      const payload = Buffer.from('SFTP-BINARY-PARITY-\x00\x01\x02-OK', 'latin1');
      const expectedSha = crypto.createHash('sha256').update(payload).digest('hex');

      const form = new FormData();
      form.append('parentId', folderId);
      form.append('fileName', 'sftp-bin.dat');
      form.append('file', new Blob([payload], { type: 'application/octet-stream' }), 'sftp-bin.dat');

      const upRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/upload', {
        method: 'POST',
        body: form,
      });
      expect(upRes.status).toBe(201);
      const fileId = extractId(upRes.data);

      const dlRes = await cluster.apiFetch(
        ownerSession.accessToken,
        `/api/v1/storage/nodes/${fileId}/download`,
      );
      expect(dlRes.status).toBe(200);
      expect(crypto.createHash('sha256').update(dlRes.buffer).digest('hex')).toBe(expectedSha);

      const renRes = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/nodes/${fileId}`, {
        method: 'PATCH',
        body: { name: 'sftp-renamed.dat' },
      });
      expect(renRes.status).toBe(200);

      const delRes = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/nodes/${fileId}`, {
        method: 'DELETE',
      });
      expect([200, 204]).toContain(delRes.status);

      const listActive = await cluster.apiFetch(
        ownerSession.accessToken,
        `/api/v1/storage/nodes?parentId=${folderId}`,
      );
      expect(listActive.status).toBe(200);
      const activeItems = listActive.data?.items || listActive.data?.nodes || [];
      expect(activeItems.some((n) => n.id === fileId)).toBe(false);
    });

    it('T1.5 — reports SFTP /health diagnostics and enforces zero hardcoded secrets & /opt/shineray protection', async () => {
      const token = cluster.createUserToken({
        sub: 'f06-t5-own',
        email: 'f06t5@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f06-t5',
      });
      await connectEd25519Sftp(token);

      const healthRes = await cluster.apiFetch(token, '/api/v1/storage/health');
      expect(healthRes.status).toBe(200);
      expect(healthRes.data?.ok).toBe(true);
      expect(typeof healthRes.data?.latencyMs).toBe('number');
      expect(healthRes.data.latencyMs).toBeGreaterThanOrEqual(0);

      const disposable = createDisposableVpsRoot(null, 'f06-check');
      expect(disposable).toMatch(/^\/tmp\/nexus-vault-e2e-/);
      expect(() => assertSafeVpsTestRoot('/opt/shineray')).toThrow();

      const selfSrc = fs.readFileSync(path.join(import.meta.dirname, 'f06_driver_sftp.test.js'), 'utf8');
      const pkMarker = new RegExp(`-----BEGIN [A-Z ]*PRIVATE` + ` KEY-----`);
      expect(selfSrc).not.toMatch(pkMarker);
    });
  });

  describe('Tier 2 — Closed Port, Bad Auth, Malformed Config & Isolation', () => {
    it('T2.1 — diagnoses closed loopback port cleanly and persists error state', async () => {
      const token = cluster.createUserToken({
        sub: 'f06-t6-own',
        email: 'f06t6@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f06-closed',
      });
      const closedPort = await getClosedLoopbackPort();

      const putRes = await cluster.apiFetch(token, '/api/v1/storage/connection', {
        method: 'PUT',
        body: {
          providerType: 'sftp',
          host: '127.0.0.1',
          port: closedPort,
          username: sftpServer.username,
          rootPath: '/',
          authMethod: 'password',
          password: sftpServer.password,
        },
      });
      expect([200, 201]).toContain(putRes.status);

      const testRes = await cluster.apiFetch(token, '/api/v1/storage/connection/test', { method: 'POST' });
      expect([200, 422]).toContain(testRes.status);
      expect(testRes.data?.ok).toBe(false);
      expect(testRes.data?.status).toBe('error');
      expect(String(testRes.data?.error || '').length).toBeGreaterThan(0);

      const getConn = await cluster.apiFetch(token, '/api/v1/storage/connection');
      expect(getConn.status).toBe(200);
      const conn = getConn.data?.connection || getConn.data;
      expect(conn?.status).toBe('error');
      expect(String(conn?.lastError || '').length).toBeGreaterThan(0);
    });

    it('T2.2 — diagnoses wrong password and wrong Ed25519 key without leaking bad secret', async () => {
      const token = cluster.createUserToken({
        sub: 'f06-t7-own',
        email: 'f06t7@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f06-badauth',
      });
      const badPass = 'WRONG_SFTP_PASSWORD_F06';
      await cluster.apiFetch(token, '/api/v1/storage/connection', {
        method: 'PUT',
        body: {
          providerType: 'sftp',
          host: sftpServer.host,
          port: sftpServer.port,
          username: sftpServer.username,
          rootPath: '/',
          authMethod: 'password',
          password: badPass,
        },
      });

      const passFail = await cluster.apiFetch(token, '/api/v1/storage/connection/test', { method: 'POST' });
      expect([200, 422]).toContain(passFail.status);
      expect(passFail.data?.ok).toBe(false);
      expect(passFail.data?.status).toBe('error');
      expect(passFail.text).not.toContain(badPass);

      const wrongKeyPair = sshUtils.generateKeyPairSync('ed25519');
      await cluster.apiFetch(token, '/api/v1/storage/connection', {
        method: 'PUT',
        body: {
          providerType: 'sftp',
          host: sftpServer.host,
          port: sftpServer.port,
          username: sftpServer.username,
          rootPath: '/',
          authMethod: 'privateKey',
          privateKey: wrongKeyPair.private,
        },
      });

      const keyFail = await cluster.apiFetch(token, '/api/v1/storage/connection/test', { method: 'POST' });
      expect([200, 422]).toContain(keyFail.status);
      expect(keyFail.data?.ok).toBe(false);
      expect(keyFail.data?.status).toBe('error');
    });

    it('T2.3 — rejects malformed SFTP configs (400) while preserving prior valid connection', async () => {
      const token = cluster.createUserToken({
        sub: 'f06-t8-own',
        email: 'f06t8@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f06-malformed',
      });
      await connectEd25519Sftp(token);

      const badConfigs = [
        { providerType: 'sftp', host: '127.0.0.1', port: 0, username: 'u', password: 'p' },
        { providerType: 'sftp', host: '127.0.0.1', port: 70000, username: 'u', password: 'p' },
        { providerType: 'sftp', port: 22, username: '', password: 'p' },
        { providerType: 'sftp', host: '127.0.0.1', port: 22, username: 'u', privateKey: 'not-a-valid-key' },
        { providerType: 'sftp', host: '127.0.0.1', port: 22, username: 'u', password: 'p', rootPath: '/srv/../etc' },
      ];

      for (const cfg of badConfigs) {
        const res = await cluster.apiFetch(token, '/api/v1/storage/connection', {
          method: 'PUT',
          body: cfg,
        });
        expect(res.status).toBe(400);
      }

      const getConn = await cluster.apiFetch(token, '/api/v1/storage/connection');
      expect(getConn.status).toBe(200);
      expect(Number((getConn.data?.connection || getConn.data)?.port)).toBe(sftpServer.port);
    });

    it('T2.4 — enforces Zero-Knowledge superadmin (403) and cloud:connect RBAC', async () => {
      const colab = await cluster.loginAs('joao.silva@shineray.com.br', 'Colab@2026!');
      const opToken = cluster.createUserToken({
        sub: 'f06-op',
        email: 'op@shineraybysabel.com.br',
        role: 'operator',
        tenantId: 'tenant-ap3htf6',
      });

      for (const [method, endpoint, body] of [
        ['GET', '/api/v1/storage/connection'],
        ['PUT', '/api/v1/storage/connection', { label: 'sa-hack' }],
        ['POST', '/api/v1/storage/connection/test'],
      ]) {
        const saRes = await cluster.apiFetch(superadminToken, endpoint, { method, ...(body ? { body } : {}) });
        expect(saRes.status).toBe(403);
      }

      for (const actorToken of [colab.accessToken, opToken]) {
        expect(
          (
            await cluster.apiFetch(actorToken, '/api/v1/storage/connection', {
              method: 'PUT',
              body: { label: 'non-admin' },
            })
          ).status,
        ).toBe(403);
        expect(
          (await cluster.apiFetch(actorToken, '/api/v1/storage/connection/test', { method: 'POST' })).status,
        ).toBe(403);
      }
    });

    it('T2.5 — isolates SFTP nodes across tenants and maintains SHA-256 compliance audit chain', async () => {
      await connectEd25519Sftp(ownerSession.accessToken);

      const form = new FormData();
      form.append('fileName', 'sftp-audit.txt');
      form.append('file', new Blob(['sftp-audit-bytes'], { type: 'text/plain' }), 'sftp-audit.txt');
      const upRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/upload', {
        method: 'POST',
        body: form,
      });
      expect(upRes.status).toBe(201);
      const fileId = extractId(upRes.data);

      const betaConn = await cluster.apiFetch(betaOwnerToken, '/api/v1/storage/connection');
      expect([200, 404]).toContain(betaConn.status);
      if (betaConn.status === 200) {
        expect(betaConn.data?.configured === false || betaConn.data?.connection === null).toBe(true);
      }

      const crossDl = await cluster.apiFetch(betaOwnerToken, `/api/v1/storage/nodes/${fileId}/download`);
      expect([403, 404]).toContain(crossDl.status);

      const integrity = await assertFullAuditIntegrity(cluster.apiFetch, ownerSession.accessToken);
      expect(integrity.apiResult.intact).toBe(true);
      expect(integrity.localResult.valid).toBe(true);
    });
  });
});
