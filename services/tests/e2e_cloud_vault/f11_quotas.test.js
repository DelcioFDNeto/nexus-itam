// services/tests/e2e_cloud_vault/f11_quotas.test.js
// =============================================================================
// F-11: Reserved Quota Calculation, Blocking & Alerts (Opaque-Box E2E Suite)
// =============================================================================

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootE2eCluster } from './helpers/clusterHarness.js';
import { startMockAgentNode } from './helpers/mockAgentNode.js';

describe('F-11: Reserved Quota Calculation, Blocking & Alerts', () => {
  let cluster;
  let agent;
  let ownerToken;
  let operatorToken;
  let managerToken;
  let betaToken;
  let finFolderId;
  let tiFolderId;

  async function connectTenant(token, endpointUrl, hmacToken, quotaBytes) {
    const parsed = new URL(endpointUrl);
    const res = await cluster.apiFetch(token, '/api/v1/storage/connection', {
      method: 'PUT',
      body: {
        providerType: 'agent_node',
        label: 'E2E Quota Node',
        host: parsed.hostname,
        port: Number(parsed.port),
        endpointUrl,
        rootPath: '/',
        quotaBytes,
        credentials: { hmacToken },
        hmacToken,
      },
    });
    expect([200, 201]).toContain(res.status);
  }

  async function ensureFolder(token, parentId, name, departmentScope) {
    const res = await cluster.apiFetch(token, '/api/v1/storage/folders', {
      method: 'POST',
      body: {
        parentId: parentId || null,
        name,
        ...(departmentScope ? { departmentScope } : {}),
      },
    });
    expect([200, 201]).toContain(res.status);
    return res.data?.node || res.data;
  }

  async function uploadSizedFile(token, parentId, fileName, byteSize, conflictPolicy = 'version') {
    const buf = Buffer.alloc(byteSize, 0x51);
    const form = new FormData();
    if (parentId) form.append('parentId', parentId);
    form.append('fileName', fileName);
    form.append('conflictPolicy', conflictPolicy);
    form.append('file', new Blob([buf], { type: 'application/octet-stream' }), fileName);

    const res = await cluster.apiFetch(token, '/api/v1/storage/upload', {
      method: 'POST',
      body: form,
    });
    return { res, buf };
  }

  async function permanentlyDeleteNode(token, nodeId) {
    if (!nodeId) return;
    await cluster.apiFetch(token, `/api/v1/storage/nodes/${nodeId}`, { method: 'DELETE' });
    await cluster.apiFetch(token, `/api/v1/storage/trash/${nodeId}`, { method: 'DELETE' });
  }

  function extractNodesList(res) {
    if (Array.isArray(res.data)) return res.data;
    return res.data?.items || res.data?.nodes || [];
  }

  beforeAll(async () => {
    cluster = await bootE2eCluster();
    const owner = await cluster.loginAs('ti@shineraybysabel.com.br', 'Shineray@2026!');
    ownerToken = owner.accessToken;

    await cluster.seedUser(ownerToken, {
      name: 'Quota Operator TI',
      email: 'quota.op@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'operator',
      department: 'Tecnologia',
    });
    operatorToken = (await cluster.loginAs('quota.op@shineraybysabel.com.br', 'Password@2026!')).accessToken;

    await cluster.seedUser(ownerToken, {
      name: 'Quota Manager Fin',
      email: 'quota.mgr@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'manager',
      department: 'Financeiro',
    });
    managerToken = (await cluster.loginAs('quota.mgr@shineraybysabel.com.br', 'Password@2026!')).accessToken;

    betaToken = cluster.createUserToken({
      sub: 'beta-quota-owner',
      email: 'owner@beta-quota.example.com',
      role: 'owner',
      tenantId: 'tenant-beta',
      department: 'Geral',
    });

    agent = await startMockAgentNode({ quotaBytes: 50_000 });
    await connectTenant(ownerToken, agent.url, agent.hmacToken, 1000);

    const initRes = await cluster.apiFetch(ownerToken, '/api/v1/storage/initialize', {
      method: 'POST',
      body: {},
    });
    expect([200, 201]).toContain(initRes.status);

    const rootList = extractNodesList(await cluster.apiFetch(ownerToken, '/api/v1/storage/nodes'));
    const setores = rootList.find((n) => n.name === 'Setores' || n.virtual_path === '/Setores');
    expect(setores?.id).toBeTruthy();

    finFolderId = (await ensureFolder(ownerToken, setores.id, 'Financeiro', 'Financeiro')).id;
    tiFolderId = (await ensureFolder(ownerToken, setores.id, 'Tecnologia', 'Tecnologia')).id;
  }, 45_000);

  afterAll(async () => {
    try {
      if (agent) await agent.stop();
    } finally {
      if (cluster) await cluster.stop();
    }
  }, 45_000);

  describe('Tier 1 — Core Quota Calculation & Threshold Alerts', () => {
    it('returns initial quota summary with quotaBytes, usedBytes 0, alertLevel ok, and byDepartment array', async () => {
      const res = await cluster.apiFetch(ownerToken, '/api/v1/storage/quota');
      expect(res.status).toBe(200);
      expect(res.data).toBeTruthy();
      expect(Number(res.data.quotaBytes)).toBe(1000);
      expect(Number(res.data.usedBytes)).toBe(0);
      expect(Number(res.data.usagePercent)).toBe(0);
      expect(res.data.alertLevel).toBe('ok');
      expect(Array.isArray(res.data.byDepartment)).toBe(true);
    });

    it('increments usedBytes and attributes bytes accurately in byDepartment after department uploads', async () => {
      const createdIds = [];
      try {
        const upFin = await uploadSizedFile(managerToken, finFolderId, 'f11-t2-fin.bin', 300);
        expect([200, 201]).toContain(upFin.res.status);
        const finNode = upFin.res.data?.node || upFin.res.data;
        createdIds.push(finNode.id);

        const upTi = await uploadSizedFile(operatorToken, tiFolderId, 'f11-t2-ti.bin', 200);
        expect([200, 201]).toContain(upTi.res.status);
        const tiNode = upTi.res.data?.node || upTi.res.data;
        createdIds.push(tiNode.id);

        const quota = await cluster.apiFetch(ownerToken, '/api/v1/storage/quota');
        expect(quota.status).toBe(200);
        expect(Number(quota.data.usedBytes)).toBe(500);
        expect(Number(quota.data.usagePercent)).toBe(50);
        expect(quota.data.alertLevel).toBe('ok');

        const finDept = quota.data.byDepartment.find((d) => d.department === 'Financeiro');
        const tiDept = quota.data.byDepartment.find((d) => d.department === 'Tecnologia');
        expect(Number(finDept?.bytes)).toBe(300);
        expect(Number(tiDept?.bytes)).toBe(200);
      } finally {
        for (const id of createdIds) {
          await permanentlyDeleteNode(ownerToken, id);
        }
      }
    });

    it('triggers alertLevel warning_80 when usage reaches >= 80% and < 90%', async () => {
      const createdIds = [];
      try {
        const up = await uploadSizedFile(operatorToken, tiFolderId, 'f11-t3-warn.bin', 820);
        expect([200, 201]).toContain(up.res.status);
        createdIds.push((up.res.data?.node || up.res.data).id);

        const quota = await cluster.apiFetch(ownerToken, '/api/v1/storage/quota');
        expect(quota.status).toBe(200);
        expect(Number(quota.data.usedBytes)).toBe(820);
        expect(Number(quota.data.usagePercent)).toBeGreaterThanOrEqual(80);
        expect(Number(quota.data.usagePercent)).toBeLessThan(90);
        expect(quota.data.alertLevel).toBe('warning_80');
      } finally {
        for (const id of createdIds) {
          await permanentlyDeleteNode(ownerToken, id);
        }
      }
    });

    it('triggers alertLevel critical_90 when usage reaches >= 90% and <= 100%', async () => {
      const createdIds = [];
      try {
        const up = await uploadSizedFile(operatorToken, tiFolderId, 'f11-t4-crit.bin', 920);
        expect([200, 201]).toContain(up.res.status);
        createdIds.push((up.res.data?.node || up.res.data).id);

        const quota = await cluster.apiFetch(ownerToken, '/api/v1/storage/quota');
        expect(quota.status).toBe(200);
        expect(Number(quota.data.usedBytes)).toBe(920);
        expect(Number(quota.data.usagePercent)).toBeGreaterThanOrEqual(90);
        expect(quota.data.alertLevel).toBe('critical_90');
      } finally {
        for (const id of createdIds) {
          await permanentlyDeleteNode(ownerToken, id);
        }
      }
    });

    it('allows exact-boundary upload up to 100% (1000 / 1000) and reports updated usage', async () => {
      const createdIds = [];
      try {
        const up1 = await uploadSizedFile(operatorToken, tiFolderId, 'f11-t5-base.bin', 920);
        expect([200, 201]).toContain(up1.res.status);
        createdIds.push((up1.res.data?.node || up1.res.data).id);

        const up2 = await uploadSizedFile(operatorToken, tiFolderId, 'f11-t5-exact.bin', 80);
        expect([200, 201]).toContain(up2.res.status);
        createdIds.push((up2.res.data?.node || up2.res.data).id);

        const quota = await cluster.apiFetch(ownerToken, '/api/v1/storage/quota');
        expect(quota.status).toBe(200);
        expect(Number(quota.data.usedBytes)).toBe(1000);
        expect(Number(quota.data.usagePercent)).toBe(100);
      } finally {
        for (const id of createdIds) {
          await permanentlyDeleteNode(ownerToken, id);
        }
      }
    });
  });

  describe('Tier 2 — Quota Blocking, Copy/Trash Accounting, Multitenancy & Validation', () => {
    it('rejects upload exceeding quotaBytes with 413/403 QUOTA_EXCEEDED without mutating usedBytes', async () => {
      const createdIds = [];
      try {
        const up1 = await uploadSizedFile(operatorToken, tiFolderId, 'f11-t6-base.bin', 920);
        expect([200, 201]).toContain(up1.res.status);
        createdIds.push((up1.res.data?.node || up1.res.data).id);

        const beforeAgentBytes = await agent.getUsedBytes();
        const blocked = await uploadSizedFile(operatorToken, tiFolderId, 'f11-t6-overflow.bin', 200);
        expect([413, 403]).toContain(blocked.res.status);
        expect(JSON.stringify(blocked.res.data || blocked.res.text)).toContain('QUOTA_EXCEEDED');

        const quota = await cluster.apiFetch(ownerToken, '/api/v1/storage/quota');
        expect(quota.status).toBe(200);
        expect(Number(quota.data.usedBytes)).toBe(920);
        expect(await agent.getUsedBytes()).toBe(beforeAgentBytes);
      } finally {
        for (const id of createdIds) {
          await permanentlyDeleteNode(ownerToken, id);
        }
      }
    });

    it('rejects POST /nodes/:id/copy when copied file size would exceed quotaBytes', async () => {
      const createdIds = [];
      try {
        const up = await uploadSizedFile(operatorToken, tiFolderId, 'f11-t7-copy-src.bin', 600);
        expect([200, 201]).toContain(up.res.status);
        const srcId = (up.res.data?.node || up.res.data).id;
        createdIds.push(srcId);

        const copyRes = await cluster.apiFetch(operatorToken, `/api/v1/storage/nodes/${srcId}/copy`, {
          method: 'POST',
          body: { targetParentId: tiFolderId, name: 'f11-t7-copy-dst.bin' },
        });
        expect([413, 403]).toContain(copyRes.status);
        expect(JSON.stringify(copyRes.data || copyRes.text)).toContain('QUOTA_EXCEEDED');

        const quota = await cluster.apiFetch(ownerToken, '/api/v1/storage/quota');
        expect(Number(quota.data.usedBytes)).toBe(600);
      } finally {
        for (const id of createdIds) {
          await permanentlyDeleteNode(ownerToken, id);
        }
      }
    });

    it('retains usedBytes on soft-delete and frees usedBytes only on permanent trash purge', async () => {
      const createdIds = [];
      try {
        const up = await uploadSizedFile(ownerToken, tiFolderId, 'f11-t8-trash.bin', 600);
        expect([200, 201]).toContain(up.res.status);
        const nodeId = (up.res.data?.node || up.res.data).id;
        createdIds.push(nodeId);

        const delRes = await cluster.apiFetch(ownerToken, `/api/v1/storage/nodes/${nodeId}`, {
          method: 'DELETE',
        });
        expect(delRes.status).toBe(200);

        const quotaWhileTrashed = await cluster.apiFetch(ownerToken, '/api/v1/storage/quota');
        expect(quotaWhileTrashed.status).toBe(200);
        expect(Number(quotaWhileTrashed.data.usedBytes)).toBe(600);

        const purgeRes = await cluster.apiFetch(managerToken, `/api/v1/storage/trash/${nodeId}`, {
          method: 'DELETE',
        });
        expect(purgeRes.status).toBe(200);

        const quotaAfterPurge = await cluster.apiFetch(ownerToken, '/api/v1/storage/quota');
        expect(Number(quotaAfterPurge.data.usedBytes)).toBe(0);
        expect(quotaAfterPurge.data.alertLevel).toBe('ok');

        const upAfter = await uploadSizedFile(ownerToken, tiFolderId, 'f11-t8-reupload.bin', 600);
        expect([200, 201]).toContain(upAfter.res.status);
        createdIds.push((upAfter.res.data?.node || upAfter.res.data).id);
      } finally {
        for (const id of createdIds) {
          await permanentlyDeleteNode(ownerToken, id);
        }
      }
    });

    it('isolates quota accounting strictly per tenant_id', async () => {
      const createdIds = [];
      let betaAgent;
      try {
        const upA = await uploadSizedFile(operatorToken, tiFolderId, 'f11-t9-alpha.bin', 950);
        expect([200, 201]).toContain(upA.res.status);
        createdIds.push((upA.res.data?.node || upA.res.data).id);

        betaAgent = await startMockAgentNode({ quotaBytes: 20_000 });
        await connectTenant(betaToken, betaAgent.url, betaAgent.hmacToken, 2000);
        const betaInit = await cluster.apiFetch(betaToken, '/api/v1/storage/initialize', {
          method: 'POST',
          body: {},
        });
        expect([200, 201]).toContain(betaInit.status);

        const betaRoots = extractNodesList(await cluster.apiFetch(betaToken, '/api/v1/storage/nodes'));
        const betaPub = betaRoots.find((n) => n.name === 'Corporativo-Publico');
        const upB = await uploadSizedFile(betaToken, betaPub?.id || null, 'f11-t9-beta.bin', 100);
        expect([200, 201]).toContain(upB.res.status);

        const quotaA = await cluster.apiFetch(ownerToken, '/api/v1/storage/quota');
        const quotaB = await cluster.apiFetch(betaToken, '/api/v1/storage/quota');
        expect(Number(quotaA.data.usedBytes)).toBe(950);
        expect(quotaA.data.alertLevel).toBe('critical_90');
        expect(Number(quotaB.data.quotaBytes)).toBe(2000);
        expect(Number(quotaB.data.usedBytes)).toBe(100);
        expect(quotaB.data.alertLevel).toBe('ok');
      } finally {
        for (const id of createdIds) {
          await permanentlyDeleteNode(ownerToken, id);
        }
        if (betaAgent) await betaAgent.stop();
      }
    });

    it('handles overwrite replacement delta consistently and rejects negative quotaBytes on PUT /connection', async () => {
      const createdIds = [];
      try {
        const up1 = await uploadSizedFile(operatorToken, tiFolderId, 'f11-t10-replace.bin', 400, 'version');
        expect([200, 201]).toContain(up1.res.status);
        const nodeId = (up1.res.data?.node || up1.res.data).id;
        createdIds.push(nodeId);

        const up2 = await uploadSizedFile(operatorToken, tiFolderId, 'f11-t10-replace.bin', 500, 'version');
        expect([200, 201]).toContain(up2.res.status);

        const quota = await cluster.apiFetch(ownerToken, '/api/v1/storage/quota');
        expect(quota.status).toBe(200);
        expect(Number(quota.data.usedBytes)).toBeGreaterThanOrEqual(500);
        expect(Number(quota.data.usedBytes)).toBeLessThanOrEqual(900);

        const badConn = await cluster.apiFetch(ownerToken, '/api/v1/storage/connection', {
          method: 'PUT',
          body: {
            providerType: 'agent_node',
            endpointUrl: agent.url,
            quotaBytes: -10,
            credentials: { hmacToken: agent.hmacToken },
          },
        });
        expect(badConn.status).toBe(400);
      } finally {
        for (const id of createdIds) {
          await permanentlyDeleteNode(ownerToken, id);
        }
      }
    });
  });
});
