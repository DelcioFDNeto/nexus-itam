// services/tests/e2e_cloud_vault/f04_path_chroot.test.js
// =============================================================================
// F-04: Logical Chroot resolveSafeVaultPath & Path Confinement — Opaque-Box Tests
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootE2eCluster } from './helpers/clusterHarness.js';
import { startMockAgentNode } from './helpers/mockAgentNode.js';

function extractId(payload) {
  return payload?.id ?? payload?.node?.id ?? payload?.data?.id ?? payload?.sheet?.id;
}

describe('F-04: Logical Chroot Path Confinement (resolveSafeVaultPath)', () => {
  let cluster;
  let agent;
  let ownerSession;

  beforeAll(async () => {
    cluster = await bootE2eCluster();
    agent = await startMockAgentNode({ quotaBytes: 25 * 1024 * 1024 });
    ownerSession = await cluster.loginAs('ti@shineraybysabel.com.br', 'Shineray@2026!');
  }, 45_000);

  afterAll(async () => {
    try {
      if (agent) await agent.stop();
    } finally {
      if (cluster) await cluster.stop();
    }
  }, 45_000);

  async function setupTenantWithSafeDir(tenantId, dirName) {
    const token = cluster.createUserToken({
      sub: `owner-${tenantId}`,
      email: `${tenantId}@iso.example.com`,
      role: 'owner',
      tenantId,
    });
    const connRes = await cluster.apiFetch(token, '/api/v1/storage/connection', {
      method: 'PUT',
      body: {
        providerType: 'agent_node',
        endpointUrl: agent.url,
        rootPath: '/',
        hmacToken: agent.hmacToken,
      },
    });
    expect([200, 201]).toContain(connRes.status);

    const folderRes = await cluster.apiFetch(token, '/api/v1/storage/folders', {
      method: 'POST',
      body: { parentId: null, name: dirName },
    });
    expect(folderRes.status).toBe(201);
    return { token, dirId: extractId(folderRes.data) };
  }

  describe('Tier 1 — Traversal, Encoding, Null-Byte Blocks & Valid Edge Names', () => {
    it('T1.1 — POST /folders blocks .., ., slash segments, and backslash traversal names (400)', async () => {
      const { token } = await setupTenantWithSafeDir('tenant-f04-t1', 'SafeBaseT1');
      const badNames = ['..', '.', '../escape', 'a/../../b', 'sub\\dir', 'a/b'];

      for (const name of badNames) {
        const res = await cluster.apiFetch(token, '/api/v1/storage/folders', {
          method: 'POST',
          body: { parentId: null, name },
        });
        expect(res.status).toBe(400);
      }

      const listRes = await cluster.apiFetch(token, '/api/v1/storage/nodes');
      expect(listRes.status).toBe(200);
      const names = (listRes.data?.items || listRes.data?.nodes || []).map((n) => n.name);
      expect(names).toEqual(['SafeBaseT1']);
    });

    it('T1.2 — POST /upload blocks traversal and Windows drive-letter fileName values with zero agent writes', async () => {
      const { token, dirId } = await setupTenantWithSafeDir('tenant-f04-t2', 'SafeBaseT2');
      const beforeLogLen = agent.getRequestLog().length;
      const evilFileNames = ['../../etc/passwd', '..\\evil.txt', 'C:/Windows/win.ini', 'c:\\boot.ini'];

      for (const fileName of evilFileNames) {
        const form = new FormData();
        form.append('parentId', dirId);
        form.append('fileName', fileName);
        form.append('file', new Blob(['evil-payload'], { type: 'text/plain' }), 'payload.txt');

        const res = await cluster.apiFetch(token, '/api/v1/storage/upload', {
          method: 'POST',
          body: form,
        });
        expect(res.status).toBe(400);
      }

      const newWrites = agent
        .getRequestLog()
        .slice(beforeLogLen)
        .filter((r) => (r.url.includes('/files') || r.url.includes('/write')) && r.status === 201);
      expect(newWrites).toHaveLength(0);
    });

    it('T1.3 — blocks URL-encoded (%2e%2e, %252e%252e, %2f, %5c) traversal on folders and upload', async () => {
      const { token, dirId } = await setupTenantWithSafeDir('tenant-f04-t3', 'SafeBaseT3');
      const encodedPayloads = ['%2e%2e', '%2E%2E%2fpasswd', '%252e%252e/x', 'a%2fb', 'a%5cb', '.%2e'];

      for (const name of encodedPayloads) {
        const fRes = await cluster.apiFetch(token, '/api/v1/storage/folders', {
          method: 'POST',
          body: { parentId: dirId, name },
        });
        expect(fRes.status).toBe(400);

        const form = new FormData();
        form.append('parentId', dirId);
        form.append('fileName', name);
        form.append('file', new Blob(['x'], { type: 'text/plain' }), 'x.txt');
        const uRes = await cluster.apiFetch(token, '/api/v1/storage/upload', {
          method: 'POST',
          body: form,
        });
        expect(uRes.status).toBe(400);
      }
    });

    it('T1.4 — blocks null-byte (\\0 and %00) injection on folders and upload', async () => {
      const { token, dirId } = await setupTenantWithSafeDir('tenant-f04-t4', 'SafeBaseT4');
      const nullPayloads = ['bad\0.txt', 'bad%00.txt', '/safe\0/evil'];

      for (const name of nullPayloads) {
        const fRes = await cluster.apiFetch(token, '/api/v1/storage/folders', {
          method: 'POST',
          body: { parentId: dirId, name },
        });
        expect(fRes.status).toBe(400);

        const form = new FormData();
        form.append('parentId', dirId);
        form.append('fileName', name);
        form.append('file', new Blob(['null-byte-test'], { type: 'text/plain' }), 'null.txt');
        const uRes = await cluster.apiFetch(token, '/api/v1/storage/upload', {
          method: 'POST',
          body: form,
        });
        expect(uRes.status).toBe(400);
      }
    });

    it('T1.5 — allows legitimate edge filenames (report..v2.xlsx, meta_100%.pdf, TI_1) with byte parity', async () => {
      const { token, dirId } = await setupTenantWithSafeDir('tenant-f04-t5', 'SafeBaseT5');

      const subRes = await cluster.apiFetch(token, '/api/v1/storage/folders', {
        method: 'POST',
        body: { parentId: dirId, name: 'TI_1' },
      });
      expect(subRes.status).toBe(201);
      const subId = extractId(subRes.data);

      for (const [fileName, content] of [
        ['report..v2.xlsx', 'valid-double-dot-xlsx-bytes'],
        ['meta_100%.pdf', 'valid-percent-pdf-bytes'],
      ]) {
        const form = new FormData();
        form.append('parentId', subId);
        form.append('fileName', fileName);
        form.append('file', new Blob([content], { type: 'application/octet-stream' }), fileName);

        const upRes = await cluster.apiFetch(token, '/api/v1/storage/upload', { method: 'POST', body: form });
        expect(upRes.status).toBe(201);
        const fileId = extractId(upRes.data);

        const dlRes = await cluster.apiFetch(token, `/api/v1/storage/nodes/${fileId}/download`);
        expect(dlRes.status).toBe(200);
        expect(dlRes.text).toBe(content);

        const prevRes = await cluster.apiFetch(token, `/api/v1/storage/nodes/${fileId}/preview`);
        expect(prevRes.status).toBe(200);
        expect(prevRes.text).toBe(content);
      }
    });
  });

  describe('Tier 2 — Rename/Copy, Root Escape, Prefix Escape & Tampered Queries', () => {
    it('T2.1 — PATCH /nodes/:id and POST /nodes/:id/copy block traversal names and preserve original file', async () => {
      const { token, dirId } = await setupTenantWithSafeDir('tenant-f04-t6', 'SafeBaseT6');

      const form = new FormData();
      form.append('parentId', dirId);
      form.append('fileName', 'safe.txt');
      form.append('file', new Blob(['original-safe-bytes'], { type: 'text/plain' }), 'safe.txt');
      const upRes = await cluster.apiFetch(token, '/api/v1/storage/upload', { method: 'POST', body: form });
      expect(upRes.status).toBe(201);
      const fileId = extractId(upRes.data);

      for (const badName of ['../pwn.txt', '..\\pwn.txt', '%2e%2e/pwn.txt', 'evil\0.txt', '..']) {
        const patchRes = await cluster.apiFetch(token, `/api/v1/storage/nodes/${fileId}`, {
          method: 'PATCH',
          body: { name: badName },
        });
        expect(patchRes.status).toBe(400);

        const copyRes = await cluster.apiFetch(token, `/api/v1/storage/nodes/${fileId}/copy`, {
          method: 'POST',
          body: { targetParentId: dirId, name: badName },
        });
        expect(copyRes.status).toBe(400);
      }

      const dlRes = await cluster.apiFetch(token, `/api/v1/storage/nodes/${fileId}/download`);
      expect(dlRes.status).toBe(200);
      expect(dlRes.text).toBe('original-safe-bytes');
    });

    it('T2.2 — PUT /connection blocks traversal, backslash, and null-byte rootPath values', async () => {
      const token = cluster.createUserToken({
        sub: 'owner-f04-root',
        email: 'rootguard@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f04-root',
      });

      for (const badRoot of ['/srv/../etc', 'C:\\vault', '/srv/vault\0', '/srv/%2e%2e/etc']) {
        const res = await cluster.apiFetch(token, '/api/v1/storage/connection', {
          method: 'PUT',
          body: {
            providerType: 'agent_node',
            endpointUrl: agent.url,
            rootPath: badRoot,
            hmacToken: agent.hmacToken,
          },
        });
        expect(res.status).toBe(400);
      }

      const getConn = await cluster.apiFetch(token, '/api/v1/storage/connection');
      expect([404, 200]).toContain(getConn.status);
      if (getConn.status === 200) {
        const conn = getConn.data?.connection || getConn.data;
        expect(conn?.rootPath).not.toContain('..');
      }
    });

    it('T2.3 — blocks prefix-escape sibling path attacks with zero sibling directory side effects on disk', async () => {
      const { token, dirId } = await setupTenantWithSafeDir('tenant-f04-t8', 'SafeBaseT8');
      const baseName = path.basename(agent.rootDir);
      const siblingEvilDir = path.join(path.dirname(agent.rootDir), `${baseName}-evil`);
      const siblingStaticDir = path.join(path.dirname(agent.rootDir), 'nexus-vault-evil');

      const attempts = [`../${baseName}-evil/pwn.txt`, '../nexus-vault-evil/secret.txt'];
      for (const name of attempts) {
        const fRes = await cluster.apiFetch(token, '/api/v1/storage/folders', {
          method: 'POST',
          body: { parentId: dirId, name },
        });
        expect(fRes.status).toBe(400);

        const form = new FormData();
        form.append('parentId', dirId);
        form.append('fileName', name);
        form.append('file', new Blob(['escape'], { type: 'text/plain' }), 'escape.txt');
        const uRes = await cluster.apiFetch(token, '/api/v1/storage/upload', {
          method: 'POST',
          body: form,
        });
        expect(uRes.status).toBe(400);
      }

      expect(fs.existsSync(siblingEvilDir)).toBe(false);
      expect(fs.existsSync(siblingStaticDir)).toBe(false);
    });

    it('T2.4 — POST /sheets blocks traversal names (400) while GET /nodes?q= treats traversal strings safely', async () => {
      const { token } = await setupTenantWithSafeDir('tenant-f04-t9', 'SafeBaseT9');

      for (const badSheetName of ['../../evil.xlsx', 'bad\0.xlsx']) {
        const sRes = await cluster.apiFetch(token, '/api/v1/storage/sheets', {
          method: 'POST',
          body: { parentId: null, name: badSheetName },
        });
        expect(sRes.status).toBe(400);
      }

      const searchRes = await cluster.apiFetch(
        token,
        '/api/v1/storage/nodes?q=..%2F..%2Fetc%2Fpasswd',
      );
      expect(searchRes.status).toBe(200);
      const items = searchRes.data?.items || searchRes.data?.nodes || [];
      expect(items).toHaveLength(0);
    });

    it('T2.5 — download and preview remain confined even when query/path params are tampered', async () => {
      const { token, dirId } = await setupTenantWithSafeDir('tenant-f04-t10', 'SafeBaseT10');

      const form = new FormData();
      form.append('parentId', dirId);
      form.append('fileName', 'confined.txt');
      form.append('file', new Blob(['ONLY_CONFINED_VAULT_BYTES'], { type: 'text/plain' }), 'confined.txt');
      const upRes = await cluster.apiFetch(token, '/api/v1/storage/upload', { method: 'POST', body: form });
      expect(upRes.status).toBe(201);
      const fileId = extractId(upRes.data);

      const dlTampered = await cluster.apiFetch(
        token,
        `/api/v1/storage/nodes/${fileId}/download?path=../../etc/passwd`,
      );
      expect([200, 400, 404]).toContain(dlTampered.status);
      if (dlTampered.status === 200) {
        expect(dlTampered.text).toBe('ONLY_CONFINED_VAULT_BYTES');
      }
      expect(dlTampered.text).not.toContain('root:x:0:0');

      const prevTampered = await cluster.apiFetch(
        token,
        `/api/v1/storage/nodes/${fileId}/preview?path=%2e%2e%2fetc%2fpasswd`,
      );
      expect([200, 400, 404]).toContain(prevTampered.status);
      if (prevTampered.status === 200) {
        expect(prevTampered.text).toBe('ONLY_CONFINED_VAULT_BYTES');
      }
      expect(prevTampered.text).not.toContain('root:x:0:0');

      const idTraversal = await cluster.apiFetch(
        ownerSession.accessToken,
        '/api/v1/storage/nodes/..%2f..%2fetc%2fpasswd/download',
      );
      expect([400, 403, 404]).toContain(idTraversal.status);
      expect(idTraversal.text).not.toContain('root:x:0:0');
    });
  });
});
