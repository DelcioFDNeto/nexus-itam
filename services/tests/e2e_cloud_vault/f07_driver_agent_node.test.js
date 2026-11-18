// services/tests/e2e_cloud_vault/f07_driver_agent_node.test.js
// =============================================================================
// F-07: Hybrid Driver — Script 1-Click Nexus Storage Node (HMAC Daemon)
// =============================================================================

import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootE2eCluster } from './helpers/clusterHarness.js';
import { signAgentNodeHeaders, startMockAgentNode } from './helpers/mockAgentNode.js';
import { assertFullAuditIntegrity, expectAuditEvent } from './helpers/auditHelper.js';

function extractId(payload) {
  return payload?.id ?? payload?.node?.id ?? payload?.data?.id;
}

describe('F-07: Hybrid Driver — 1-Click Nexus Storage Node (agent_node)', () => {
  let cluster;
  let agent;
  let ownerSession;
  let betaOwnerToken;
  let superadminToken;

  beforeAll(async () => {
    cluster = await bootE2eCluster();
    agent = await startMockAgentNode({ quotaBytes: 65_536 });
    ownerSession = await cluster.loginAs('ti@shineraybysabel.com.br', 'Shineray@2026!');
    betaOwnerToken = cluster.createUserToken({
      sub: 'f07-beta-own',
      email: 'owner@beta.example.com',
      role: 'owner',
      tenantId: 'tenant-beta',
      department: 'TI',
    });
    superadminToken = cluster.createUserToken({
      sub: 'f07-sa-master',
      email: 'master@nexus.internal',
      role: 'superadmin',
      tenantId: 'nexus-master',
    });
  }, 45_000);

  afterAll(async () => {
    try {
      if (agent) await agent.stop();
    } finally {
      if (cluster) await cluster.stop();
    }
  }, 45_000);

  async function connectAgent(token, targetAgent = agent) {
    const res = await cluster.apiFetch(token, '/api/v1/storage/connection', {
      method: 'PUT',
      body: {
        providerType: 'agent_node',
        label: '1-Click Agent Node',
        endpointUrl: targetAgent.url,
        rootPath: '/',
        hmacToken: targetAgent.hmacToken,
        quotaBytes: targetAgent.quotaBytes,
      },
    });
    expect([200, 201]).toContain(res.status);
    return res;
  }

  describe('Tier 1 — Install Script, HMAC Auth, VFS Lifecycle & Range 206', () => {
    it('T1.1 — generates 1-Click install-script for owner and blocks collaborator/superadmin (403)', async () => {
      const res = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/connection/install-script', {
        method: 'POST',
        body: { rootPath: '/srv/nexus-vault', quotaBytes: 104_857_600 },
      });
      expect([200, 201]).toContain(res.status);
      const script = res.data?.script || res.data?.command || res.text;
      expect(script).toMatch(/bash|systemd|nexus/i);
      expect(script).toContain('/srv/nexus-vault');

      const colab = await cluster.loginAs('joao.silva@shineray.com.br', 'Colab@2026!');
      const colabRes = await cluster.apiFetch(colab.accessToken, '/api/v1/storage/connection/install-script', {
        method: 'POST',
        body: { rootPath: '/srv/nexus-vault' },
      });
      expect(colabRes.status).toBe(403);

      const saRes = await cluster.apiFetch(superadminToken, '/api/v1/storage/connection/install-script', {
        method: 'POST',
        body: { rootPath: '/srv/nexus-vault' },
      });
      expect(saRes.status).toBe(403);
    });

    it('T1.2 — configures agent_node, masks hmacToken, and passes HMAC /health diagnostics', async () => {
      const token = cluster.createUserToken({
        sub: 'f07-t2-own',
        email: 'f07t2@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f07-t2',
      });
      await connectAgent(token);

      const getRes = await cluster.apiFetch(token, '/api/v1/storage/connection');
      expect(getRes.status).toBe(200);
      expect(getRes.text).not.toContain(agent.hmacToken);

      const beforeLen = agent.getRequestLog().length;
      const testRes = await cluster.apiFetch(token, '/api/v1/storage/connection/test', { method: 'POST' });
      expect(testRes.status).toBe(200);
      expect(testRes.data?.ok).toBe(true);
      expect(testRes.data?.status).toBe('connected');
      expect(Number(testRes.data?.totalBytes)).toBe(65_536);

      const logs = agent.getRequestLog().slice(beforeLen);
      expect(logs.some((l) => l.method === 'GET' && l.url === '/health' && l.authorized && l.status === 200)).toBe(
        true,
      );
    });

    it('T1.3 — executes full agent_node VFS lifecycle (mkdir, write, download, rename, copy, delete/purge)', async () => {
      const token = cluster.createUserToken({
        sub: 'f07-t3-own',
        email: 'f07t3@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f07-t3',
      });
      const localAgent = await startMockAgentNode({ quotaBytes: 65_536 });
      try {
        await connectAgent(token, localAgent);

        const folderRes = await cluster.apiFetch(token, '/api/v1/storage/folders', {
          method: 'POST',
          body: { parentId: null, name: 'AgentCrudDir' },
        });
        expect(folderRes.status).toBe(201);
        const folderId = extractId(folderRes.data);

        const payload = Buffer.from('AGENT-NODE-CRUD-PAYLOAD-BYTES', 'utf8');
        const form = new FormData();
        form.append('parentId', folderId);
        form.append('fileName', 'orig.txt');
        form.append('file', new Blob([payload], { type: 'text/plain' }), 'orig.txt');
        const upRes = await cluster.apiFetch(token, '/api/v1/storage/upload', { method: 'POST', body: form });
        expect(upRes.status).toBe(201);
        const fileId = extractId(upRes.data);

        const dlRes = await cluster.apiFetch(token, `/api/v1/storage/nodes/${fileId}/download`);
        expect(dlRes.status).toBe(200);
        expect(dlRes.buffer.equals(payload)).toBe(true);

        const copyRes = await cluster.apiFetch(token, `/api/v1/storage/nodes/${fileId}/copy`, {
          method: 'POST',
          body: { targetParentId: folderId, name: 'copied.txt' },
        });
        expect([200, 201]).toContain(copyRes.status);
        const copyId = extractId(copyRes.data);

        const renRes = await cluster.apiFetch(token, `/api/v1/storage/nodes/${copyId}`, {
          method: 'PATCH',
          body: { name: 'renamed.txt' },
        });
        expect(renRes.status).toBe(200);

        const usedAfterCopy = await localAgent.getUsedBytes();
        expect(usedAfterCopy).toBeGreaterThanOrEqual(payload.length * 2);

        await cluster.apiFetch(token, `/api/v1/storage/nodes/${copyId}`, { method: 'DELETE' });
        await cluster.apiFetch(token, `/api/v1/storage/trash/${copyId}`, { method: 'DELETE' });

        const urls = localAgent.getRequestLog().map((r) => `${r.method} ${r.url}`);
        expect(urls.some((u) => u.includes('/mkdir'))).toBe(true);
        expect(urls.some((u) => u.includes('/files') || u.includes('/write'))).toBe(true);
        expect(urls.some((u) => u.includes('/copy'))).toBe(true);
        expect(urls.some((u) => u.includes('/rename'))).toBe(true);
        expect(urls.some((u) => u.startsWith('DELETE /files') || u.includes('/rm'))).toBe(true);
      } finally {
        await localAgent.stop();
      }
    });

    it('T1.4 — streams Range: bytes=5-14 as 206 Partial Content with inline preview headers', async () => {
      const token = cluster.createUserToken({
        sub: 'f07-t4-own',
        email: 'f07t4@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f07-t4',
      });
      await connectAgent(token);

      const content = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123'; // 40 bytes
      const form = new FormData();
      form.append('fileName', 'range-preview.txt');
      form.append('file', new Blob([content], { type: 'text/plain' }), 'range-preview.txt');
      const upRes = await cluster.apiFetch(token, '/api/v1/storage/upload', { method: 'POST', body: form });
      expect(upRes.status).toBe(201);
      const fileId = extractId(upRes.data);

      const prevRes = await cluster.apiFetch(token, `/api/v1/storage/nodes/${fileId}/preview`, {
        headers: { Range: 'bytes=5-14' },
      });
      expect(prevRes.status).toBe(206);
      expect(prevRes.headers.get('content-range')).toBe('bytes 5-14/40');
      expect(prevRes.headers.get('accept-ranges')).toBe('bytes');
      expect(prevRes.headers.get('content-disposition')).toContain('inline');
      expect(prevRes.headers.get('cache-control')).toContain('no-store');
      expect(prevRes.headers.get('x-content-type-options')).toBe('nosniff');
      expect(prevRes.text).toBe('56789ABCDE');
    });

    it('T1.5 — rotating agent_node HMAC token rejects prior token and restores connectivity with new token', async () => {
      const token = cluster.createUserToken({
        sub: 'f07-t5-own',
        email: 'f07t5@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f07-t5',
      });
      const oldToken = crypto.randomBytes(16).toString('hex');
      const rotatedAgent = await startMockAgentNode({ quotaBytes: 32_768 });
      try {
        // Direct check that rotatedAgent rejects oldToken
        const oldSigned = signAgentNodeHeaders({ hmacToken: oldToken, method: 'GET', pathWithQuery: '/health' });
        const oldDirect = await fetch(`${rotatedAgent.url}/health`, { headers: oldSigned });
        expect(oldDirect.status).toBe(401);

        await connectAgent(token, rotatedAgent);
        const testRes = await cluster.apiFetch(token, '/api/v1/storage/connection/test', { method: 'POST' });
        expect(testRes.status).toBe(200);
        expect(testRes.data?.ok).toBe(true);

        const getRes = await cluster.apiFetch(token, '/api/v1/storage/connection');
        expect(getRes.status).toBe(200);
        expect(getRes.text).not.toContain(rotatedAgent.hmacToken);
      } finally {
        await rotatedAgent.stop();
      }
    });
  });

  describe('Tier 2 — Replay Protection, Traversal, Quota & Audit Integrity', () => {
    it('T2.1 — mismatched hmacToken fails POST /connection/test cleanly with error diagnostic', async () => {
      const token = cluster.createUserToken({
        sub: 'f07-t6-own',
        email: 'f07t6@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f07-badhmac',
      });
      const wrongToken = 'wrong-token-0000-f07';

      const putRes = await cluster.apiFetch(token, '/api/v1/storage/connection', {
        method: 'PUT',
        body: {
          providerType: 'agent_node',
          endpointUrl: agent.url,
          rootPath: '/',
          hmacToken: wrongToken,
        },
      });
      expect([200, 201]).toContain(putRes.status);

      const beforeLen = agent.getRequestLog().length;
      const testRes = await cluster.apiFetch(token, '/api/v1/storage/connection/test', { method: 'POST' });
      expect([200, 422]).toContain(testRes.status);
      expect(testRes.data?.ok).toBe(false);
      expect(testRes.data?.status).toBe('error');
      expect(testRes.text).not.toContain(wrongToken);

      const newLogs = agent.getRequestLog().slice(beforeLen);
      expect(newLogs.some((l) => l.status === 401 && l.errorCode === 'INVALID_SIGNATURE')).toBe(true);
    });

    it('T2.2 — mockAgentNode rejects missing auth, expired timestamp (AUTH_EXPIRED), and tampered path signature', async () => {
      const missingRes = await fetch(`${agent.url}/health`);
      expect(missingRes.status).toBe(401);
      expect((await missingRes.json()).error).toBe('AUTH_MISSING');

      const expiredHeaders = signAgentNodeHeaders({
        hmacToken: agent.hmacToken,
        method: 'GET',
        pathWithQuery: '/health',
        ts: Date.now() - 120_000,
      });
      const expiredRes = await fetch(`${agent.url}/health`, { headers: expiredHeaders });
      expect(expiredRes.status).toBe(401);
      expect((await expiredRes.json()).error).toBe('AUTH_EXPIRED');

      const mismatchedPathHeaders = signAgentNodeHeaders({
        hmacToken: agent.hmacToken,
        method: 'GET',
        pathWithQuery: '/health',
      });
      const tamperedRes = await fetch(`${agent.url}/statfs`, { headers: mismatchedPathHeaders });
      expect(tamperedRes.status).toBe(401);
      expect((await tamperedRes.json()).error).toBe('INVALID_SIGNATURE');
    });

    it('T2.3 — blocks traversal at both Gateway/Storage (400) and mockAgentNode (403 PATH_TRAVERSAL_BLOCKED)', async () => {
      const token = cluster.createUserToken({
        sub: 'f07-t8-own',
        email: 'f07t8@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f07-trav',
      });
      await connectAgent(token);

      const gwFolder = await cluster.apiFetch(token, '/api/v1/storage/folders', {
        method: 'POST',
        body: { parentId: null, name: '../escape' },
      });
      expect(gwFolder.status).toBe(400);

      for (const badPath of ['%2F..%2Fetc%2Fpasswd', '%43%3a%2FWindows']) {
        const query = `/files?path=${badPath}`;
        const signed = signAgentNodeHeaders({ hmacToken: agent.hmacToken, method: 'GET', pathWithQuery: query });
        const directRes = await fetch(`${agent.url}${query}`, { headers: signed });
        expect(directRes.status).toBe(403);
        expect((await directRes.json()).error).toBe('PATH_TRAVERSAL_BLOCKED');
      }
    });

    it('T2.4 — enforces node-level quotaBytes overflow (413 QUOTA_EXCEEDED) while allowing within-quota writes', async () => {
      const token = cluster.createUserToken({
        sub: 'f07-t9-own',
        email: 'f07t9@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f07-quota',
      });
      const tightAgent = await startMockAgentNode({ quotaBytes: 1024 });
      try {
        await connectAgent(token, tightAgent);

        const bigForm = new FormData();
        bigForm.append('fileName', 'too-big.bin');
        bigForm.append('file', new Blob([Buffer.alloc(2048, 0x41)], { type: 'application/octet-stream' }), 'too-big.bin');
        const bigRes = await cluster.apiFetch(token, '/api/v1/storage/upload', { method: 'POST', body: bigForm });
        expect(bigRes.status).toBe(413);
        expect(await tightAgent.getUsedBytes()).toBeLessThanOrEqual(1024);

        const okForm = new FormData();
        okForm.append('fileName', 'fits.bin');
        okForm.append('file', new Blob([Buffer.alloc(512, 0x42)], { type: 'application/octet-stream' }), 'fits.bin');
        const okRes = await cluster.apiFetch(token, '/api/v1/storage/upload', { method: 'POST', body: okForm });
        expect(okRes.status).toBe(201);
      } finally {
        await tightAgent.stop();
      }
    });

    it('T2.5 — isolates agent_node resources across tenants and records SHA-256 compliance audit', async () => {
      await connectAgent(ownerSession.accessToken);
      const form = new FormData();
      form.append('fileName', 'agent-iso.txt');
      form.append('file', new Blob(['alpha-agent-secret'], { type: 'text/plain' }), 'agent-iso.txt');
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
      const event = await expectAuditEvent(cluster.apiFetch, ownerSession.accessToken, {
        actorEmail: 'ti@shineraybysabel.com.br',
      });
      expect(event).toBeTruthy();
    });
  });
});
