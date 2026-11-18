// services/tests/e2e_cloud_vault/f22_entitlements_gateway.test.js
// =============================================================================
// F-22: Commercial Module `cloud_storage` & Gateway Entitlement Gate (E2E)
// =============================================================================

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { bootE2eCluster } from './helpers/clusterHarness.js';
import { startMockAgentNode } from './helpers/mockAgentNode.js';

let cluster;
let agent;
let ownerSession;
let superadminToken;
let vaultConnected = false;
let cachedShareToken = null;

async function restoreEnterprisePlan() {
  if (!cluster || !ownerSession?.accessToken) return;
  await cluster.setTenantPlan(ownerSession.accessToken, {
    plan: 'enterprise',
    overrides: {},
    customContract: { enabled: false },
  });
}

async function ensureEnterpriseVault() {
  if (vaultConnected) return;
  await restoreEnterprisePlan();

  let connRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/connection', {
    method: 'PUT',
    body: {
      providerType: 'agent_node',
      label: 'E2E Entitlements Agent',
      endpointUrl: agent.url,
      rootPath: '/',
      quotaBytes: agent.quotaBytes,
      credentials: { hmacToken: agent.hmacToken },
    },
  });
  if (connRes.status === 400 && !connRes.ok) {
    connRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/connection', {
      method: 'PUT',
      body: {
        providerType: 'agent_node',
        label: 'E2E Entitlements Agent',
        endpointUrl: agent.url,
        rootPath: '/',
        quotaBytes: agent.quotaBytes,
        hmacToken: agent.hmacToken,
      },
    });
  }
  expect(connRes.status).toBe(200);

  const initRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/initialize', {
    method: 'POST',
    body: {},
  });
  expect(initRes.ok).toBe(true);
  vaultConnected = true;
}

async function ensurePublicShareToken() {
  if (cachedShareToken) return cachedShareToken;
  await ensureEnterpriseVault();

  const nodesRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/nodes');
  expect(nodesRes.status).toBe(200);
  const items = nodesRes.data?.items || nodesRes.data?.nodes || [];
  const pubFolder = items.find((n) => (n.virtual_path || n.virtualPath || n.path) === '/Corporativo-Publico') || items[0];
  expect(pubFolder).toBeTruthy();

  const form = new FormData();
  form.append('parentId', String(pubFolder.id));
  form.append('file', new Blob(['public-link-doc-payload'], { type: 'text/plain' }), 'public-entitlement.txt');
  const uploadRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/upload', {
    method: 'POST',
    body: form,
  });
  expect([200, 201]).toContain(uploadRes.status);
  const uploadedNode = uploadRes.data?.node || uploadRes.data?.file || uploadRes.data;

  const linkRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/links', {
    method: 'POST',
    body: {
      nodeId: uploadedNode.id,
      expiresInMinutes: 60,
      allowDownload: true,
    },
  });
  expect([200, 201]).toContain(linkRes.status);
  const token = linkRes.data?.token || linkRes.data?.link?.token;
  expect(token).toBeTruthy();
  cachedShareToken = token;
  return token;
}

describe('F-22: Commercial Module cloud_storage & Gateway Enforcement', () => {
  beforeAll(async () => {
    cluster = await bootE2eCluster();
    agent = await startMockAgentNode({ quotaBytes: 25 * 1024 * 1024 });
    ownerSession = await cluster.loginAs('ti@shineraybysabel.com.br', 'Shineray@2026!');
    superadminToken = cluster.createUserToken({
      sub: 'sa-master-f22',
      email: 'master@nexus.internal',
      name: 'Nexus Master',
      role: 'superadmin',
      tenantId: 'nexus-master',
    });
  }, 45_000);

  afterEach(async () => {
    await restoreEnterprisePlan();
  });

  afterAll(async () => {
    await restoreEnterprisePlan();
    if (cluster) await cluster.stop();
    if (agent) await agent.stop();
  }, 45_000);

  describe('Tier 1 — Unit & Contract (Plan Matrix & Public Share Bypass)', () => {
    it('blocks all authenticated /api/v1/storage/* routes with 403 on starter plan', async () => {
      await cluster.setTenantPlan(ownerSession.accessToken, {
        plan: 'starter',
        overrides: {},
      });

      const healthRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/health');
      expect(healthRes.status).toBe(403);

      const connRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/connection');
      expect(connRes.status).toBe(403);

      const nodesRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/nodes');
      expect(nodesRes.status).toBe(403);

      const mkdirRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/folders', {
        method: 'POST',
        body: { parentId: null, name: 'BlockedStarter' },
      });
      expect(mkdirRes.status).toBe(403);
    });

    it('allows /api/v1/storage/* routes on pro plan', async () => {
      await ensureEnterpriseVault();
      await cluster.setTenantPlan(ownerSession.accessToken, {
        plan: 'pro',
        overrides: {},
      });

      const connRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/connection');
      expect(connRes.status).toBe(200);

      const nodesRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/nodes');
      expect(nodesRes.status).toBe(200);

      const quotaRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/quota');
      expect(quotaRes.status).toBe(200);
    });

    it('allows /api/v1/storage/* routes on enterprise plan', async () => {
      await ensureEnterpriseVault();
      await cluster.setTenantPlan(ownerSession.accessToken, {
        plan: 'enterprise',
        overrides: {},
      });

      const nodesRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/nodes');
      expect(nodesRes.status).toBe(200);

      const folderRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/folders', {
        method: 'POST',
        body: { parentId: null, name: 'Enterprise-Allowed-Folder' },
      });
      expect([200, 201]).toContain(folderRes.status);
    });

    it('enforces custom plan add-on: blocks without cloud_storage (403) and allows with cloud_storage: true', async () => {
      await ensureEnterpriseVault();

      await cluster.setTenantPlan(ownerSession.accessToken, {
        plan: 'custom',
        overrides: { features: { cloud_storage: false } },
        customContract: { enabled: true, mode: 'modular' },
      });
      const deniedRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/nodes');
      expect(deniedRes.status).toBe(403);

      await cluster.setTenantPlan(ownerSession.accessToken, {
        plan: 'custom',
        overrides: { features: { cloud_storage: true } },
        customContract: { enabled: true, mode: 'modular' },
      });
      const allowedRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/nodes');
      expect(allowedRes.status).toBe(200);
    });

    it('allows unauthenticated /api/v1/storage/share/:token bypass even when authenticated /storage/* is blocked on starter', async () => {
      const shareToken = await ensurePublicShareToken();

      await cluster.setTenantPlan(ownerSession.accessToken, {
        plan: 'starter',
        overrides: {},
      });

      const authBlocked = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/nodes');
      expect(authBlocked.status).toBe(403);

      const shareRes = await cluster.apiFetch(null, `/api/v1/storage/share/${shareToken}`);
      expect(shareRes.status).toBe(200);
    });
  });

  describe('Tier 2 — Integration, Security, Immediate Propagation & Edge Cases', () => {
    it('applies plan downgrade and upgrade immediately to an already-issued JWT', async () => {
      await ensureEnterpriseVault();
      const persistentJwt = ownerSession.accessToken;

      const res1 = await cluster.apiFetch(persistentJwt, '/api/v1/storage/nodes');
      expect(res1.status).toBe(200);

      await cluster.setTenantPlan(persistentJwt, { plan: 'starter', overrides: {} });
      const res2 = await cluster.apiFetch(persistentJwt, '/api/v1/storage/nodes');
      expect(res2.status).toBe(403);

      await cluster.setTenantPlan(persistentJwt, { plan: 'pro', overrides: {} });
      const res3 = await cluster.apiFetch(persistentJwt, '/api/v1/storage/nodes');
      expect(res3.status).toBe(200);
    });

    it('unlocks cloud_storage on starter plan when explicit tenant override sets cloud_storage: true', async () => {
      await ensureEnterpriseVault();

      await cluster.setTenantPlan(ownerSession.accessToken, {
        plan: 'starter',
        overrides: { features: { cloud_storage: true } },
      });
      const res = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/nodes');
      expect(res.status).toBe(200);
    });

    it('falls back unknown plan IDs to starter denial (403) unless overridden', async () => {
      await ensureEnterpriseVault();

      await cluster.setTenantPlan(ownerSession.accessToken, {
        plan: 'platinum-unknown',
        overrides: {},
      });
      const res = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/nodes');
      expect(res.status).toBe(403);
    });

    it('keeps non-storage microservices (/assets, /tickets, /compliance) operational when storage is gated on starter', async () => {
      await cluster.setTenantPlan(ownerSession.accessToken, {
        plan: 'starter',
        overrides: {},
      });

      const storageRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/nodes');
      expect(storageRes.status).toBe(403);

      const assetsRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/assets');
      expect(assetsRes.status).toBe(200);

      const ticketsRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/tickets');
      expect(ticketsRes.status).toBe(200);

      const auditRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/compliance/audit');
      expect(auditRes.status).toBe(200);
    });

    it('keeps superadmin Zero-Knowledge 403 precedence on enterprise and rejects tampered share routes', async () => {
      await ensureEnterpriseVault();

      const saNodes = await cluster.apiFetch(superadminToken, '/api/v1/storage/nodes');
      expect(saNodes.status).toBe(403);

      const saConn = await cluster.apiFetch(superadminToken, '/api/v1/storage/connection');
      expect(saConn.status).toBe(403);

      const badShare = await cluster.apiFetch(null, '/api/v1/storage/share/non-existent-share-token-xyz');
      expect([404, 410]).toContain(badShare.status);

      const traversalShare = await cluster.apiFetch(null, '/api/v1/storage/share/..%2Fnodes');
      expect(traversalShare.status).not.toBe(200);
      expect([400, 401, 403, 404, 410]).toContain(traversalShare.status);
    });
  });
});
