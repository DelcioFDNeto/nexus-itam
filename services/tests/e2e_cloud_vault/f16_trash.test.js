// services/tests/e2e_cloud_vault/f16_trash.test.js
// =============================================================================
// F-16: Corporate Trash 30-Day Retention (.nexus_trash/) (Opaque-Box E2E Suite)
// =============================================================================

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootE2eCluster } from './helpers/clusterHarness.js';
import { signAgentNodeHeaders, startMockAgentNode } from './helpers/mockAgentNode.js';

describe('F-16: Corporate Trash 30-Day Retention (.nexus_trash/)', () => {
  let cluster;
  let agent;
  let ownerToken;
  let managerToken;
  let op1Token;
  let viewerToken;
  let collabFinToken;
  let betaToken;
  let corpPublicId;
  let setorFinId;

  function extractNodesList(res) {
    if (Array.isArray(res.data)) return res.data;
    return res.data?.items || res.data?.nodes || [];
  }

  async function uploadFile(token, parentId, fileName, content = 'TRASH_TEST_DATA') {
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const form = new FormData();
    if (parentId) form.append('parentId', parentId);
    form.append('fileName', fileName);
    form.append('conflictPolicy', 'version');
    form.append('file', new Blob([buf], { type: 'text/plain' }), fileName);
    return cluster.apiFetch(token, '/api/v1/storage/upload', {
      method: 'POST',
      body: form,
    });
  }

  async function agentReaddir(virtualPath) {
    const pathWithQuery = `/readdir?path=${encodeURIComponent(virtualPath)}`;
    const headers = signAgentNodeHeaders({
      hmacToken: agent.hmacToken,
      method: 'GET',
      pathWithQuery,
    });
    const res = await fetch(`${agent.url}${pathWithQuery}`, { headers });
    if (!res.ok) return null;
    return res.json();
  }

  beforeAll(async () => {
    cluster = await bootE2eCluster();
    const owner = await cluster.loginAs('ti@shineraybysabel.com.br', 'Shineray@2026!');
    ownerToken = owner.accessToken;

    await cluster.seedUser(ownerToken, {
      name: 'Trash Manager',
      email: 'trash.mgr@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'manager',
      department: 'Tecnologia',
    });
    managerToken = (await cluster.loginAs('trash.mgr@shineraybysabel.com.br', 'Password@2026!')).accessToken;

    await cluster.seedUser(ownerToken, {
      name: 'Trash Operator',
      email: 'trash.op@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'operator',
      department: 'Financeiro',
    });
    op1Token = (await cluster.loginAs('trash.op@shineraybysabel.com.br', 'Password@2026!')).accessToken;

    await cluster.seedUser(ownerToken, {
      name: 'Trash Viewer',
      email: 'trash.viewer@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'viewer',
      department: 'Geral',
    });
    viewerToken = (await cluster.loginAs('trash.viewer@shineraybysabel.com.br', 'Password@2026!')).accessToken;

    await cluster.seedUser(ownerToken, {
      name: 'Trash Collab Fin',
      email: 'trash.collab@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'collaborator',
      department: 'Financeiro',
    });
    collabFinToken = (await cluster.loginAs('trash.collab@shineraybysabel.com.br', 'Password@2026!')).accessToken;

    betaToken = cluster.createUserToken({
      sub: 'beta-trash-owner',
      email: 'owner@beta-trash.example.com',
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
        label: 'E2E Trash Node',
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
    const setores = roots.find((n) => n.name === 'Setores');
    expect(corpPublicId).toBeTruthy();
    expect(setores?.id).toBeTruthy();

    const finRes = await cluster.apiFetch(ownerToken, '/api/v1/storage/folders', {
      method: 'POST',
      body: { parentId: setores.id, name: 'Financeiro', departmentScope: 'Financeiro' },
    });
    expect([200, 201]).toContain(finRes.status);
    setorFinId = (finRes.data?.node || finRes.data).id;
  }, 45_000);

  afterAll(async () => {
    try {
      if (agent) await agent.stop();
    } finally {
      if (cluster) await cluster.stop();
    }
  }, 45_000);

  describe('Tier 1 — Soft Delete, .nexus_trash/, Restore, Purge & Retention Sweep', () => {
    it('soft-deletes a file, hides it from GET /nodes, and lists it in GET /trash', async () => {
      const up = await uploadFile(op1Token, corpPublicId, 'f16-t1-soft.txt', 'SOFT_DELETE_ME');
      expect([200, 201]).toContain(up.status);
      const nodeId = (up.data?.node || up.data).id;

      const del = await cluster.apiFetch(op1Token, `/api/v1/storage/nodes/${nodeId}`, { method: 'DELETE' });
      expect(del.status).toBe(200);

      const activeList = extractNodesList(
        await cluster.apiFetch(ownerToken, `/api/v1/storage/nodes?parentId=${corpPublicId}`),
      );
      expect(activeList.find((n) => n.id === nodeId)).toBeUndefined();

      const trashRes = await cluster.apiFetch(managerToken, '/api/v1/storage/trash');
      expect(trashRes.status).toBe(200);
      const trashed = extractNodesList(trashRes).find((n) => n.id === nodeId);
      expect(trashed).toBeTruthy();
      expect(trashed.is_trashed).toBe(true);
      expect(trashed.trashed_at).toBeTruthy();
      expect(trashed.original_virtual_path).toContain('f16-t1-soft.txt');
    });

    it('soft-deletes a non-empty folder subtree and moves physical artifact into .nexus_trash/', async () => {
      const dirRes = await cluster.apiFetch(op1Token, '/api/v1/storage/folders', {
        method: 'POST',
        body: { parentId: corpPublicId, name: 'F16-TempDir' },
      });
      expect(dirRes.status).toBe(201);
      const dirId = (dirRes.data?.node || dirRes.data).id;

      const nested = await uploadFile(op1Token, dirId, 'nested.txt', 'NESTED_TRASH_BYTES');
      expect([200, 201]).toContain(nested.status);
      const nestedId = (nested.data?.node || nested.data).id;

      const delDir = await cluster.apiFetch(op1Token, `/api/v1/storage/nodes/${dirId}`, { method: 'DELETE' });
      expect(delDir.status).toBe(200);

      const activeList = extractNodesList(
        await cluster.apiFetch(ownerToken, `/api/v1/storage/nodes?parentId=${corpPublicId}`),
      );
      expect(activeList.find((n) => n.id === dirId)).toBeUndefined();

      const trashItems = extractNodesList(await cluster.apiFetch(managerToken, '/api/v1/storage/trash'));
      expect(trashItems.find((n) => n.id === dirId)).toBeTruthy();
      expect(trashItems.find((n) => n.id === nestedId)).toBeTruthy();

      const trashDir = await agentReaddir('/.nexus_trash');
      expect(trashDir?.entries?.length).toBeGreaterThan(0);
    });

    it('restores a trashed file via POST /trash/:id/restore back to active VFS with intact bytes', async () => {
      const payload = Buffer.from('RESTORE_EXACT_BYTES_F16', 'utf8');
      const up = await uploadFile(op1Token, corpPublicId, 'f16-t3-restore.txt', payload);
      expect([200, 201]).toContain(up.status);
      const nodeId = (up.data?.node || up.data).id;

      expect((await cluster.apiFetch(op1Token, `/api/v1/storage/nodes/${nodeId}`, { method: 'DELETE' })).status).toBe(200);

      const restoreRes = await cluster.apiFetch(managerToken, `/api/v1/storage/trash/${nodeId}/restore`, {
        method: 'POST',
        body: {},
      });
      expect(restoreRes.status).toBe(200);

      const dl = await cluster.apiFetch(ownerToken, `/api/v1/storage/nodes/${nodeId}/download`);
      expect(dl.status).toBe(200);
      expect(dl.buffer.equals(payload)).toBe(true);
    });

    it('permanently purges a trashed item via DELETE /trash/:id and frees quota', async () => {
      const payload = Buffer.alloc(1024, 0x54);
      const up = await uploadFile(op1Token, corpPublicId, 'f16-t4-purge.bin', payload);
      expect([200, 201]).toContain(up.status);
      const nodeId = (up.data?.node || up.data).id;

      const quotaBefore = Number((await cluster.apiFetch(ownerToken, '/api/v1/storage/quota')).data.usedBytes);
      expect((await cluster.apiFetch(op1Token, `/api/v1/storage/nodes/${nodeId}`, { method: 'DELETE' })).status).toBe(200);

      const purge = await cluster.apiFetch(managerToken, `/api/v1/storage/trash/${nodeId}`, {
        method: 'DELETE',
      });
      expect(purge.status).toBe(200);

      const trashItems = extractNodesList(await cluster.apiFetch(managerToken, '/api/v1/storage/trash'));
      expect(trashItems.find((n) => n.id === nodeId)).toBeUndefined();

      const quotaAfter = Number((await cluster.apiFetch(ownerToken, '/api/v1/storage/quota')).data.usedBytes);
      expect(quotaAfter).toBe(quotaBefore - payload.length);
    });

    it('executes POST /trash/purge-expired retaining <30d items on {} and purging on retentionDays 0', async () => {
      const payload = Buffer.alloc(512, 0x45);
      const up = await uploadFile(op1Token, corpPublicId, 'f16-t5-retention.bin', payload);
      expect([200, 201]).toContain(up.status);
      const nodeId = (up.data?.node || up.data).id;

      expect((await cluster.apiFetch(op1Token, `/api/v1/storage/nodes/${nodeId}`, { method: 'DELETE' })).status).toBe(200);

      // Default 30-day retention must keep freshly trashed items
      const defaultSweep = await cluster.apiFetch(managerToken, '/api/v1/storage/trash/purge-expired', {
        method: 'POST',
        body: {},
      });
      expect(defaultSweep.status).toBe(200);

      const trashAfterDefault = extractNodesList(await cluster.apiFetch(managerToken, '/api/v1/storage/trash'));
      expect(trashAfterDefault.find((n) => n.id === nodeId)).toBeTruthy();

      const quotaBeforeZeroSweep = Number((await cluster.apiFetch(ownerToken, '/api/v1/storage/quota')).data.usedBytes);

      // retentionDays: 0 must purge freshly trashed items and free quota
      const zeroSweep = await cluster.apiFetch(managerToken, '/api/v1/storage/trash/purge-expired', {
        method: 'POST',
        body: { retentionDays: 0 },
      });
      expect(zeroSweep.status).toBe(200);

      const trashAfterZero = extractNodesList(await cluster.apiFetch(managerToken, '/api/v1/storage/trash'));
      expect(trashAfterZero.find((n) => n.id === nodeId)).toBeUndefined();

      const quotaAfterZeroSweep = Number((await cluster.apiFetch(ownerToken, '/api/v1/storage/quota')).data.usedBytes);
      expect(quotaAfterZeroSweep).toBeLessThan(quotaBeforeZeroSweep);
    });
  });

  describe('Tier 2 — Role Boundaries, Editor Own-Delete, Restore Conflicts & Multitenancy', () => {
    it('blocks collaborator, viewer, and operator from listing, restoring, or purging trash (403)', async () => {
      const up = await uploadFile(op1Token, corpPublicId, 'f16-t6-rbac.txt', 'RBAC_TRASH');
      expect([200, 201]).toContain(up.status);
      const nodeId = (up.data?.node || up.data).id;
      expect((await cluster.apiFetch(op1Token, `/api/v1/storage/nodes/${nodeId}`, { method: 'DELETE' })).status).toBe(200);

      for (const token of [collabFinToken, viewerToken, op1Token]) {
        const listRes = await cluster.apiFetch(token, '/api/v1/storage/trash');
        expect(listRes.status).toBe(403);

        const restoreRes = await cluster.apiFetch(token, `/api/v1/storage/trash/${nodeId}/restore`, {
          method: 'POST',
          body: {},
        });
        expect(restoreRes.status).toBe(403);

        const purgeRes = await cluster.apiFetch(token, `/api/v1/storage/trash/${nodeId}`, {
          method: 'DELETE',
        });
        expect(purgeRes.status).toBe(403);

        const sweepRes = await cluster.apiFetch(token, '/api/v1/storage/trash/purge-expired', {
          method: 'POST',
          body: {},
        });
        expect(sweepRes.status).toBe(403);
      }
    });

    it('enforces editor own-delete restriction: collaborator deletes own file (200) but gets 403 on other user file', async () => {
      const otherUp = await uploadFile(op1Token, setorFinId, 'f16-t7-shared-other.txt', 'OTHER_OWNED');
      expect([200, 201]).toContain(otherUp.status);
      const otherId = (otherUp.data?.node || otherUp.data).id;

      const ownUp = await uploadFile(collabFinToken, setorFinId, 'f16-t7-own.txt', 'COLLAB_OWNED');
      expect([200, 201]).toContain(ownUp.status);
      const ownId = (ownUp.data?.node || ownUp.data).id;

      const delOther = await cluster.apiFetch(collabFinToken, `/api/v1/storage/nodes/${otherId}`, {
        method: 'DELETE',
      });
      expect(delOther.status).toBe(403);

      const delOwn = await cluster.apiFetch(collabFinToken, `/api/v1/storage/nodes/${ownId}`, {
        method: 'DELETE',
      });
      expect(delOwn.status).toBe(200);
    });

    it('rejects restore with 409 PATH_ALREADY_EXISTS when path is occupied, and succeeds with targetParentId', async () => {
      const up1 = await uploadFile(op1Token, corpPublicId, 'f16-t8-conflict.txt', 'OLD_DOC');
      expect([200, 201]).toContain(up1.status);
      const oldId = (up1.data?.node || up1.data).id;

      expect((await cluster.apiFetch(op1Token, `/api/v1/storage/nodes/${oldId}`, { method: 'DELETE' })).status).toBe(200);

      const up2 = await uploadFile(op1Token, corpPublicId, 'f16-t8-conflict.txt', 'NEW_ACTIVE_DOC');
      expect([200, 201]).toContain(up2.status);

      const conflictRestore = await cluster.apiFetch(managerToken, `/api/v1/storage/trash/${oldId}/restore`, {
        method: 'POST',
        body: {},
      });
      expect(conflictRestore.status).toBe(409);

      const altFolderRes = await cluster.apiFetch(ownerToken, '/api/v1/storage/folders', {
        method: 'POST',
        body: { parentId: corpPublicId, name: 'F16-RestoreAlt' },
      });
      expect(altFolderRes.status).toBe(201);
      const altId = (altFolderRes.data?.node || altFolderRes.data).id;

      const okRestore = await cluster.apiFetch(managerToken, `/api/v1/storage/trash/${oldId}/restore`, {
        method: 'POST',
        body: { targetParentId: altId },
      });
      expect(okRestore.status).toBe(200);
    });

    it('rejects permanent DELETE /trash/:id or restore on an active non-trashed node (404)', async () => {
      const up = await uploadFile(op1Token, corpPublicId, 'f16-t9-active.txt', 'NOT_IN_TRASH');
      expect([200, 201]).toContain(up.status);
      const activeId = (up.data?.node || up.data).id;

      const purgeActive = await cluster.apiFetch(managerToken, `/api/v1/storage/trash/${activeId}`, {
        method: 'DELETE',
      });
      expect(purgeActive.status).toBe(404);

      const restoreActive = await cluster.apiFetch(managerToken, `/api/v1/storage/trash/${activeId}/restore`, {
        method: 'POST',
        body: {},
      });
      expect(restoreActive.status).toBe(404);
    });

    it('enforces cross-tenant trash isolation across list, restore, purge, and purge-expired', async () => {
      const up = await uploadFile(op1Token, corpPublicId, 'f16-t10-tenant.txt', 'TENANT_A_TRASH');
      expect([200, 201]).toContain(up.status);
      const nodeId = (up.data?.node || up.data).id;
      expect((await cluster.apiFetch(op1Token, `/api/v1/storage/nodes/${nodeId}`, { method: 'DELETE' })).status).toBe(200);

      const betaTrash = await cluster.apiFetch(betaToken, '/api/v1/storage/trash');
      expect(betaTrash.status).toBe(200);
      expect(extractNodesList(betaTrash).find((n) => n.id === nodeId)).toBeUndefined();

      const betaRestore = await cluster.apiFetch(betaToken, `/api/v1/storage/trash/${nodeId}/restore`, {
        method: 'POST',
        body: {},
      });
      expect([403, 404]).toContain(betaRestore.status);

      const betaPurge = await cluster.apiFetch(betaToken, `/api/v1/storage/trash/${nodeId}`, {
        method: 'DELETE',
      });
      expect([403, 404]).toContain(betaPurge.status);
    });
  });
});
