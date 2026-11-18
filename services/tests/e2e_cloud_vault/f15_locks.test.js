// services/tests/e2e_cloud_vault/f15_locks.test.js
// =============================================================================
// F-15: File Lock (Check-in / Check-out) (Opaque-Box E2E Suite)
// =============================================================================

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootE2eCluster } from './helpers/clusterHarness.js';
import { startMockAgentNode } from './helpers/mockAgentNode.js';

describe('F-15: File Lock (Check-in / Check-out)', () => {
  let cluster;
  let agent;
  let ownerToken;
  let adminToken;
  let op1Token;
  let op2Token;
  let viewerToken;
  let betaToken;
  let corpPublicId;

  function extractNodesList(res) {
    if (Array.isArray(res.data)) return res.data;
    return res.data?.items || res.data?.nodes || [];
  }

  async function uploadFile(token, fileName, textContent = 'LOCK_INITIAL_CONTENT') {
    const buf = Buffer.from(textContent, 'utf8');
    const form = new FormData();
    form.append('parentId', corpPublicId);
    form.append('fileName', fileName);
    form.append('conflictPolicy', 'version');
    form.append('file', new Blob([buf], { type: 'text/plain' }), fileName);
    return cluster.apiFetch(token, '/api/v1/storage/upload', {
      method: 'POST',
      body: form,
    });
  }

  beforeAll(async () => {
    cluster = await bootE2eCluster();
    const owner = await cluster.loginAs('ti@shineraybysabel.com.br', 'Shineray@2026!');
    ownerToken = owner.accessToken;

    await cluster.seedUser(ownerToken, {
      name: 'Lock Admin',
      email: 'lock.admin@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'admin',
      department: 'Tecnologia',
    });
    adminToken = (await cluster.loginAs('lock.admin@shineraybysabel.com.br', 'Password@2026!')).accessToken;

    await cluster.seedUser(ownerToken, {
      name: 'Lock Operator 1',
      email: 'lock.op1@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'operator',
      department: 'Tecnologia',
    });
    op1Token = (await cluster.loginAs('lock.op1@shineraybysabel.com.br', 'Password@2026!')).accessToken;

    await cluster.seedUser(ownerToken, {
      name: 'Lock Operator 2',
      email: 'lock.op2@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'operator',
      department: 'Tecnologia',
    });
    op2Token = (await cluster.loginAs('lock.op2@shineraybysabel.com.br', 'Password@2026!')).accessToken;

    await cluster.seedUser(ownerToken, {
      name: 'Lock Viewer',
      email: 'lock.viewer@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'viewer',
      department: 'Geral',
    });
    viewerToken = (await cluster.loginAs('lock.viewer@shineraybysabel.com.br', 'Password@2026!')).accessToken;

    betaToken = cluster.createUserToken({
      sub: 'beta-lock-owner',
      email: 'owner@beta-lock.example.com',
      role: 'owner',
      tenantId: 'tenant-beta',
      department: 'Geral',
    });

    agent = await startMockAgentNode({ quotaBytes: 20 * 1024 * 1024 });
    const parsed = new URL(agent.url);
    const putConn = await cluster.apiFetch(ownerToken, '/api/v1/storage/connection', {
      method: 'PUT',
      body: {
        providerType: 'agent_node',
        label: 'E2E Lock Node',
        host: parsed.hostname,
        port: Number(parsed.port),
        endpointUrl: agent.url,
        rootPath: '/',
        quotaBytes: agent.quotaBytes,
        credentials: { hmacToken: agent.hmacToken },
        hmacToken: agent.hmacToken,
      },
    });
    expect([200, 201]).toContain(putConn.status);

    const initRes = await cluster.apiFetch(ownerToken, '/api/v1/storage/initialize', {
      method: 'POST',
      body: {},
    });
    expect([200, 201]).toContain(initRes.status);

    const roots = extractNodesList(await cluster.apiFetch(ownerToken, '/api/v1/storage/nodes'));
    corpPublicId = roots.find((n) => n.name === 'Corporativo-Publico')?.id;
    expect(corpPublicId).toBeTruthy();
  }, 45_000);

  afterAll(async () => {
    try {
      if (agent) await agent.stop();
    } finally {
      if (cluster) await cluster.stop();
    }
  }, 45_000);

  describe('Tier 1 — Lock, Holder Writes, Unlock, Idempotency & Admin Override', () => {
    it('locks a file via POST /nodes/:id/lock and exposes locked_by_email and locked_at', async () => {
      const up = await uploadFile(op1Token, 'f15-t1-lock.txt');
      expect([200, 201]).toContain(up.status);
      const nodeId = (up.data?.node || up.data).id;

      const lockRes = await cluster.apiFetch(op1Token, `/api/v1/storage/nodes/${nodeId}/lock`, {
        method: 'POST',
        body: {},
      });
      expect(lockRes.status).toBe(200);
      const lockedNode = lockRes.data?.node || lockRes.data;
      expect(lockedNode.locked_by_email).toBe('lock.op1@shineraybysabel.com.br');
      expect(lockedNode.locked_at).toBeTruthy();

      const listRes = await cluster.apiFetch(op1Token, `/api/v1/storage/nodes?parentId=${corpPublicId}`);
      const listed = extractNodesList(listRes).find((n) => n.id === nodeId);
      expect(listed?.locked_by_email).toBe('lock.op1@shineraybysabel.com.br');
    });

    it('allows lock holder to overwrite and rename while locked', async () => {
      const up = await uploadFile(op1Token, 'f15-t2-holder.txt', 'BEFORE_HOLDER_WRITE');
      expect([200, 201]).toContain(up.status);
      const nodeId = (up.data?.node || up.data).id;

      const lockRes = await cluster.apiFetch(op1Token, `/api/v1/storage/nodes/${nodeId}/lock`, {
        method: 'POST',
        body: {},
      });
      expect(lockRes.status).toBe(200);

      const overwriteRes = await uploadFile(op1Token, 'f15-t2-holder.txt', 'AFTER_HOLDER_WRITE');
      expect([200, 201]).toContain(overwriteRes.status);

      const renameRes = await cluster.apiFetch(op1Token, `/api/v1/storage/nodes/${nodeId}`, {
        method: 'PATCH',
        body: { name: 'f15-t2-holder-renamed.txt' },
      });
      expect(renameRes.status).toBe(200);
    });

    it('unlocks a file via DELETE /nodes/:id/lock by holder, clearing lock metadata and allowing others to write', async () => {
      const up = await uploadFile(op1Token, 'f15-t3-unlock.txt');
      expect([200, 201]).toContain(up.status);
      const nodeId = (up.data?.node || up.data).id;

      expect((await cluster.apiFetch(op1Token, `/api/v1/storage/nodes/${nodeId}/lock`, { method: 'POST', body: {} })).status).toBe(200);

      const unlockRes = await cluster.apiFetch(op1Token, `/api/v1/storage/nodes/${nodeId}/lock`, {
        method: 'DELETE',
      });
      expect(unlockRes.status).toBe(200);
      const unlockedNode = unlockRes.data?.node || unlockRes.data;
      expect(unlockedNode.locked_by_email).toBeNull();

      const op2Overwrite = await uploadFile(op2Token, 'f15-t3-unlock.txt', 'OP2_AFTER_UNLOCK');
      expect([200, 201]).toContain(op2Overwrite.status);
    });

    it('allows idempotent re-lock by the same lock holder (200)', async () => {
      const up = await uploadFile(op1Token, 'f15-t4-idemp.txt');
      expect([200, 201]).toContain(up.status);
      const nodeId = (up.data?.node || up.data).id;

      const first = await cluster.apiFetch(op1Token, `/api/v1/storage/nodes/${nodeId}/lock`, { method: 'POST', body: {} });
      const second = await cluster.apiFetch(op1Token, `/api/v1/storage/nodes/${nodeId}/lock`, { method: 'POST', body: {} });
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect((second.data?.node || second.data).locked_by_email).toBe('lock.op1@shineraybysabel.com.br');
    });

    it('allows admin/owner to force-unlock another user lock', async () => {
      const up = await uploadFile(op1Token, 'f15-t5-override.txt');
      expect([200, 201]).toContain(up.status);
      const nodeId = (up.data?.node || up.data).id;

      expect((await cluster.apiFetch(op1Token, `/api/v1/storage/nodes/${nodeId}/lock`, { method: 'POST', body: {} })).status).toBe(200);

      const overrideRes = await cluster.apiFetch(adminToken, `/api/v1/storage/nodes/${nodeId}/lock`, {
        method: 'DELETE',
      });
      expect(overrideRes.status).toBe(200);
      expect((overrideRes.data?.node || overrideRes.data).locked_by_email).toBeNull();
    });
  });

  describe('Tier 2 — 423 Locked Conflicts, Viewer Block & Cross-Tenant Isolation', () => {
    it('rejects conflicting overwrite upload by a non-holder with 423 Locked without altering file bytes', async () => {
      const initialText = 'LOCKED_IMMUTABLE_V1';
      const up = await uploadFile(op1Token, 'f15-t6-conflict.txt', initialText);
      expect([200, 201]).toContain(up.status);
      const nodeId = (up.data?.node || up.data).id;

      expect((await cluster.apiFetch(op1Token, `/api/v1/storage/nodes/${nodeId}/lock`, { method: 'POST', body: {} })).status).toBe(200);

      const conflict = await uploadFile(op2Token, 'f15-t6-conflict.txt', 'HIJACK_V2');
      expect(conflict.status).toBe(423);

      const dl = await cluster.apiFetch(op1Token, `/api/v1/storage/nodes/${nodeId}/download`);
      expect(dl.text).toBe(initialText);
    });

    it('rejects rename/move (PATCH) and soft-delete (DELETE) by a non-holder with 423 Locked', async () => {
      const up = await uploadFile(op1Token, 'f15-t7-patch-del.txt');
      expect([200, 201]).toContain(up.status);
      const nodeId = (up.data?.node || up.data).id;

      expect((await cluster.apiFetch(op1Token, `/api/v1/storage/nodes/${nodeId}/lock`, { method: 'POST', body: {} })).status).toBe(200);

      const patchRes = await cluster.apiFetch(op2Token, `/api/v1/storage/nodes/${nodeId}`, {
        method: 'PATCH',
        body: { name: 'renamed-by-other.txt' },
      });
      expect(patchRes.status).toBe(423);

      const delRes = await cluster.apiFetch(op2Token, `/api/v1/storage/nodes/${nodeId}`, {
        method: 'DELETE',
      });
      expect(delRes.status).toBe(423);
    });

    it('rejects lock acquisition and unlock by another operator when already locked', async () => {
      const up = await uploadFile(op1Token, 'f15-t8-steal.txt');
      expect([200, 201]).toContain(up.status);
      const nodeId = (up.data?.node || up.data).id;

      expect((await cluster.apiFetch(op1Token, `/api/v1/storage/nodes/${nodeId}/lock`, { method: 'POST', body: {} })).status).toBe(200);

      const lockAttempt = await cluster.apiFetch(op2Token, `/api/v1/storage/nodes/${nodeId}/lock`, {
        method: 'POST',
        body: {},
      });
      expect([423, 409]).toContain(lockAttempt.status);

      const unlockAttempt = await cluster.apiFetch(op2Token, `/api/v1/storage/nodes/${nodeId}/lock`, {
        method: 'DELETE',
      });
      expect([403, 423]).toContain(unlockAttempt.status);
    });

    it('blocks viewer from locking or unlocking files (403)', async () => {
      const up = await uploadFile(op1Token, 'f15-t9-viewer.txt');
      expect([200, 201]).toContain(up.status);
      const nodeId = (up.data?.node || up.data).id;

      const lockRes = await cluster.apiFetch(viewerToken, `/api/v1/storage/nodes/${nodeId}/lock`, {
        method: 'POST',
        body: {},
      });
      expect(lockRes.status).toBe(403);

      const unlockRes = await cluster.apiFetch(viewerToken, `/api/v1/storage/nodes/${nodeId}/lock`, {
        method: 'DELETE',
      });
      expect(unlockRes.status).toBe(403);
    });

    it('enforces cross-tenant lock and unlock isolation (403/404)', async () => {
      const up = await uploadFile(op1Token, 'f15-t10-tenant.txt');
      expect([200, 201]).toContain(up.status);
      const nodeId = (up.data?.node || up.data).id;

      const lockOther = await cluster.apiFetch(betaToken, `/api/v1/storage/nodes/${nodeId}/lock`, {
        method: 'POST',
        body: {},
      });
      expect([403, 404]).toContain(lockOther.status);

      const unlockOther = await cluster.apiFetch(betaToken, `/api/v1/storage/nodes/${nodeId}/lock`, {
        method: 'DELETE',
      });
      expect([403, 404]).toContain(unlockOther.status);
    });
  });
});
