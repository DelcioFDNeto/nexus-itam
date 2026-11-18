// services/tests/e2e_cloud_vault/f19_compliance_audit.test.js
// =============================================================================
// F-19: SHA-256 Hash-Chain Audit (service-compliance) (Opaque-Box E2E Suite)
// =============================================================================

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootE2eCluster } from './helpers/clusterHarness.js';
import { startMockAgentNode } from './helpers/mockAgentNode.js';
import {
  assertFullAuditIntegrity,
  expectAuditEvent,
  fetchAuditLog,
  findAuditEvents,
  verifyAuditChainViaApi,
  verifyChainLinksLocally,
} from './helpers/auditHelper.js';

describe('F-19: SHA-256 Hash-Chain Audit (service-compliance)', () => {
  let cluster;
  let agentA;
  let agentB;
  let ownerToken;
  let managerToken;
  let operatorToken;
  let collabFinToken;
  let betaToken;
  let superadminToken;
  let corpPublicAId;
  let setorFinAId;

  function extractNodesList(res) {
    if (Array.isArray(res.data)) return res.data;
    return res.data?.items || res.data?.nodes || [];
  }

  async function connectAgent(token, agentNode, label) {
    const parsed = new URL(agentNode.url);
    const putConn = await cluster.apiFetch(token, '/api/v1/storage/connection', {
      method: 'PUT',
      body: {
        providerType: 'agent_node',
        label,
        host: parsed.hostname,
        port: Number(parsed.port),
        endpointUrl: agentNode.url,
        rootPath: '/',
        quotaBytes: agentNode.quotaBytes,
        credentials: { hmacToken: agentNode.hmacToken },
        hmacToken: agentNode.hmacToken,
      },
    });
    expect([200, 201]).toContain(putConn.status);

    const initRes = await cluster.apiFetch(token, '/api/v1/storage/initialize', {
      method: 'POST',
      body: {},
    });
    expect([200, 201]).toContain(initRes.status);
  }

  async function uploadText(token, parentId, fileName, content = 'AUDIT_CONTENT') {
    const form = new FormData();
    form.append('parentId', parentId);
    form.append('fileName', fileName);
    form.append('conflictPolicy', 'version');
    form.append('file', new Blob([Buffer.from(content, 'utf8')], { type: 'text/plain' }), fileName);
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
      name: 'Audit Manager',
      email: 'audit.mgr@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'manager',
      department: 'Tecnologia',
    });
    managerToken = (await cluster.loginAs('audit.mgr@shineraybysabel.com.br', 'Password@2026!')).accessToken;

    await cluster.seedUser(ownerToken, {
      name: 'Audit Operator',
      email: 'audit.op@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'operator',
      department: 'Tecnologia',
    });
    operatorToken = (await cluster.loginAs('audit.op@shineraybysabel.com.br', 'Password@2026!')).accessToken;

    await cluster.seedUser(ownerToken, {
      name: 'Audit Collab Fin',
      email: 'audit.collab@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'collaborator',
      department: 'Financeiro',
    });
    collabFinToken = (await cluster.loginAs('audit.collab@shineraybysabel.com.br', 'Password@2026!')).accessToken;

    betaToken = cluster.createUserToken({
      sub: 'beta-audit-owner',
      email: 'owner@beta-audit.example.com',
      role: 'owner',
      tenantId: 'tenant-beta',
      department: 'Geral',
    });

    superadminToken = cluster.createUserToken({
      sub: 'sa-audit-master',
      email: 'master@nexus.internal',
      role: 'superadmin',
      tenantId: 'nexus-master',
    });

    agentA = await startMockAgentNode({ quotaBytes: 20 * 1024 * 1024 });
    agentB = await startMockAgentNode({ quotaBytes: 20 * 1024 * 1024 });

    await connectAgent(ownerToken, agentA, 'Tenant A Audit Node');
    await connectAgent(betaToken, agentB, 'Tenant B Audit Node');

    const rootsA = extractNodesList(await cluster.apiFetch(ownerToken, '/api/v1/storage/nodes'));
    corpPublicAId = rootsA.find((n) => n.name === 'Corporativo-Publico')?.id;
    const setoresA = rootsA.find((n) => n.name === 'Setores');
    expect(corpPublicAId).toBeTruthy();
    expect(setoresA?.id).toBeTruthy();

    const finRes = await cluster.apiFetch(ownerToken, '/api/v1/storage/folders', {
      method: 'POST',
      body: { parentId: setoresA.id, name: 'Financeiro', departmentScope: 'Financeiro' },
    });
    expect([200, 201]).toContain(finRes.status);
    setorFinAId = (finRes.data?.node || finRes.data).id;
  }, 45_000);

  afterAll(async () => {
    try {
      if (agentA) await agentA.stop();
      if (agentB) await agentB.stop();
    } finally {
      if (cluster) await cluster.stop();
    }
  }, 45_000);

  describe('Tier 1 — Storage, ACL, Temp Link, Collaborator Bridge & Chain Integrity', () => {
    it('logs storage lifecycle actions (folder, upload, rename, delete, purge) to audit_chain', async () => {
      const folderRes = await cluster.apiFetch(operatorToken, '/api/v1/storage/folders', {
        method: 'POST',
        body: { parentId: corpPublicAId, name: 'F19-AuditFolder' },
      });
      expect(folderRes.status).toBe(201);
      const folderId = (folderRes.data?.node || folderRes.data).id;

      const upRes = await uploadText(operatorToken, folderId, 'f19-doc.txt', 'AUDIT_LIFECYCLE');
      expect([200, 201]).toContain(upRes.status);
      const fileId = (upRes.data?.node || upRes.data).id;

      const patchRes = await cluster.apiFetch(operatorToken, `/api/v1/storage/nodes/${fileId}`, {
        method: 'PATCH',
        body: { name: 'f19-doc-renamed.txt' },
      });
      expect(patchRes.status).toBe(200);

      expect((await cluster.apiFetch(operatorToken, `/api/v1/storage/nodes/${fileId}`, { method: 'DELETE' })).status).toBe(200);
      expect((await cluster.apiFetch(managerToken, `/api/v1/storage/trash/${fileId}`, { method: 'DELETE' })).status).toBe(200);

      const folderEvents = await findAuditEvents(cluster.apiFetch, ownerToken, { resourceId: folderId });
      const fileEvents = await findAuditEvents(cluster.apiFetch, ownerToken, { resourceId: fileId });
      expect(folderEvents.length).toBeGreaterThanOrEqual(1);
      expect(fileEvents.length).toBeGreaterThanOrEqual(3);
      expect(fileEvents.some((e) => e.actor_email === 'audit.op@shineraybysabel.com.br')).toBe(true);
    });

    it('logs ACL rule mutations (PUT and DELETE /nodes/:id/acl) with target and accessLevel metadata', async () => {
      const folderRes = await cluster.apiFetch(ownerToken, '/api/v1/storage/folders', {
        method: 'POST',
        body: { parentId: corpPublicAId, name: 'F19-AclFolder' },
      });
      expect(folderRes.status).toBe(201);
      const folderId = (folderRes.data?.node || folderRes.data).id;

      const putAcl = await cluster.apiFetch(managerToken, `/api/v1/storage/nodes/${folderId}/acl`, {
        method: 'PUT',
        body: {
          rules: [{ targetType: 'department', targetValue: 'Financeiro', accessLevel: 'reader' }],
        },
      });
      expect([200, 201]).toContain(putAcl.status);
      const rules = Array.isArray(putAcl.data) ? putAcl.data : putAcl.data?.rules || putAcl.data?.acls || [];
      const aclId = rules[0]?.id;
      expect(aclId).toBeTruthy();

      const delAcl = await cluster.apiFetch(managerToken, `/api/v1/storage/nodes/${folderId}/acl/${aclId}`, {
        method: 'DELETE',
      });
      expect(delAcl.status).toBe(200);

      const aclAudit = await expectAuditEvent(cluster.apiFetch, ownerToken, {
        resourceId: folderId,
        actorEmail: 'audit.mgr@shineraybysabel.com.br',
      });
      expect(JSON.stringify(aclAudit.payload || {})).toContain('Financeiro');
    });

    it('logs temporary share link lifecycle (create, share access, revoke) in hash chain', async () => {
      const up = await uploadText(ownerToken, corpPublicAId, 'f19-share.txt', 'SHARE_AUDIT');
      expect([200, 201]).toContain(up.status);
      const fileId = (up.data?.node || up.data).id;

      const createLink = await cluster.apiFetch(managerToken, '/api/v1/storage/links', {
        method: 'POST',
        body: { nodeId: fileId, expiresInMinutes: 30, allowDownload: true },
      });
      expect(createLink.status).toBe(201);
      const linkId = (createLink.data?.link || createLink.data).id;
      const rawToken = createLink.data?.token || createLink.data?.link?.token;

      expect((await cluster.apiFetch(null, `/api/v1/storage/share/${rawToken}`)).status).toBe(200);
      expect((await cluster.apiFetch(managerToken, `/api/v1/storage/links/${linkId}`, { method: 'DELETE' })).status).toBe(200);

      const linkEvents = await findAuditEvents(cluster.apiFetch, ownerToken, { resourceId: linkId });
      const fileEvents = await findAuditEvents(cluster.apiFetch, ownerToken, { resourceId: fileId });
      expect(linkEvents.length + fileEvents.length).toBeGreaterThanOrEqual(3);
    });

    it('logs collaborator storage actions via HMAC-signed POST /internal/audit bridge', async () => {
      const up = await uploadText(collabFinToken, setorFinAId, 'f19-collab-upload.txt', 'COLLAB_AUDIT_DATA');
      expect([200, 201]).toContain(up.status);
      const nodeId = (up.data?.node || up.data).id;

      const collabEv = await expectAuditEvent(cluster.apiFetch, ownerToken, {
        actorEmail: 'audit.collab@shineraybysabel.com.br',
        actorRole: 'collaborator',
        resourceId: nodeId,
      });
      expect(collabEv.actor_role).toBe('collaborator');
      expect(collabEv.actor_email).toBe('audit.collab@shineraybysabel.com.br');
    });

    it('preserves cryptographic SHA-256 hash-chain integrity across mixed storage and compliance events', async () => {
      const compRes = await cluster.apiFetch(ownerToken, '/api/v1/compliance/audit', {
        method: 'POST',
        body: {
          action: 'F19_COMPLIANCE_MARKER',
          resourceType: 'policy',
          resourceId: 'pol-f19-1',
          payload: { source: 'test' },
        },
      });
      expect(compRes.status).toBe(201);

      const integrity = await assertFullAuditIntegrity(cluster.apiFetch, ownerToken);
      expect(integrity.apiResult.intact).toBe(true);
      expect(integrity.localResult.valid).toBe(true);
      expect(integrity.itemsAsc.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('Tier 2 — >200-Row Chain Verification, Multitenancy, Internal HMAC & Access Controls', () => {
    it('verifies hash chains exceeding 200 rows via verify-chain API and local slice validation', async () => {
      for (let i = 1; i <= 205; i += 1) {
        const res = await cluster.apiFetch(ownerToken, '/api/v1/storage/folders', {
          method: 'POST',
          body: { parentId: corpPublicAId, name: `F19-Bulk-${i}` },
        });
        expect(res.status).toBe(201);
      }

      const apiCheck = await verifyAuditChainViaApi(cluster.apiFetch, ownerToken);
      expect(apiCheck.intact).toBe(true);
      expect(Number(apiCheck.checkedRecords)).toBeGreaterThan(200);

      const { itemsAsc } = await fetchAuditLog(cluster.apiFetch, ownerToken, 200);
      expect(itemsAsc.length).toBe(200);
      const localSlice = verifyChainLinksLocally(itemsAsc, { requireGenesis: false });
      expect(localSlice.valid).toBe(true);
    }, 30_000);

    it('isolates audit chains strictly per tenant_id across tenant-ap3htf6 and tenant-beta', async () => {
      const betaFolder = await cluster.apiFetch(betaToken, '/api/v1/storage/folders', {
        method: 'POST',
        body: { parentId: null, name: 'F19-BetaOnlyFolder' },
      });
      expect(betaFolder.status).toBe(201);
      const betaFolderId = (betaFolder.data?.node || betaFolder.data).id;

      const { itemsAsc: betaItems } = await fetchAuditLog(cluster.apiFetch, betaToken, 200);
      expect(betaItems.some((e) => e.actor_email === 'ti@shineraybysabel.com.br')).toBe(false);
      expect(betaItems.some((e) => e.actor_email === 'audit.collab@shineraybysabel.com.br')).toBe(false);
      expect(betaItems.some((e) => e.resource_id === betaFolderId)).toBe(true);

      const betaApiCheck = await verifyAuditChainViaApi(cluster.apiFetch, betaToken);
      expect(betaApiCheck.intact).toBe(true);
      const betaLocal = verifyChainLinksLocally(betaItems, { requireGenesis: true, totalCount: betaItems.length });
      expect(betaLocal.valid).toBe(true);
    });

    it('blocks collaborator from querying GET /compliance/audit and verify-chain (403)', async () => {
      const auditRes = await cluster.apiFetch(collabFinToken, '/api/v1/compliance/audit');
      expect(auditRes.status).toBe(403);

      const verifyRes = await cluster.apiFetch(collabFinToken, '/api/v1/compliance/audit/verify-chain');
      expect(verifyRes.status).toBe(403);
    });

    it('rejects direct unauthenticated or forged-HMAC calls to service-compliance POST /internal/audit (401/403)', async () => {
      expect(cluster.ports?.compliance).toBeDefined();
      const internalUrl = `http://127.0.0.1:${cluster.ports.compliance}/internal/audit`;
      const payload = JSON.stringify({
        tenantId: 'tenant-ap3htf6',
        actorEmail: 'forged@attacker.local',
        actorRole: 'collaborator',
        action: 'FORGED_AUDIT',
        resourceType: 'storage_node',
        resourceId: 'node-forged',
        payload: {},
      });

      const noHmac = await fetch(internalUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: payload,
      });
      expect([401, 403]).toContain(noHmac.status);

      const forgedHmac = await fetch(internalUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-ts': String(Date.now()),
          'x-internal-sig': '0'.repeat(64),
        },
        body: payload,
      });
      expect([401, 403]).toContain(forgedHmac.status);
    });

    it('blocks superadmin from reading tenant storage trails or tenant A audit records (403)', async () => {
      const storageRes = await cluster.apiFetch(superadminToken, '/api/v1/storage/nodes');
      expect(storageRes.status).toBe(403);
      expect(JSON.stringify(storageRes.data || storageRes.text)).toContain('ZERO_KNOWLEDGE_RESTRICTED');

      const auditRes = await cluster.apiFetch(superadminToken, '/api/v1/compliance/audit', {
        headers: { 'x-tenant-id': 'tenant-ap3htf6' },
      });
      expect(auditRes.status).toBe(403);
    });
  });
});
