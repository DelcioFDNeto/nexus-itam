// services/tests/e2e_cloud_vault/f05_multitenancy_lgpd.test.js
// =============================================================================
// F-05: Strict Multitenancy & Zero-Knowledge LGPD (superadmin) — Opaque-Box Tests
// =============================================================================

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootE2eCluster } from './helpers/clusterHarness.js';
import { startMockAgentNode } from './helpers/mockAgentNode.js';
import { assertFullAuditIntegrity } from './helpers/auditHelper.js';

function extractId(payload) {
  return payload?.id ?? payload?.node?.id ?? payload?.data?.id ?? payload?.sheet?.id ?? payload?.link?.id;
}

describe('F-05: Strict Multitenancy & Zero-Knowledge superadmin (LGPD)', () => {
  let cluster;
  let agentA;
  let agentB;
  let ownerA;
  let colabA;
  let ownerBToken;
  let superadminMaster;
  let superadminSpoof;

  beforeAll(async () => {
    cluster = await bootE2eCluster();
    agentA = await startMockAgentNode({ quotaBytes: 25 * 1024 * 1024 });
    agentB = await startMockAgentNode({ quotaBytes: 25 * 1024 * 1024 });

    ownerA = await cluster.loginAs('ti@shineraybysabel.com.br', 'Shineray@2026!');
    colabA = await cluster.loginAs('karen.matos@shineraybysabel.com.br', 'Colab@2026!');

    ownerBToken = cluster.createUserToken({
      sub: 'f05-beta-owner',
      email: 'owner@beta.example.com',
      role: 'owner',
      tenantId: 'tenant-beta',
      department: 'TI',
    });
    superadminMaster = cluster.createUserToken({
      sub: 'sa-master-f05',
      email: 'master@nexus.internal',
      role: 'superadmin',
      tenantId: 'nexus-master',
    });
    superadminSpoof = cluster.createUserToken({
      sub: 'sa-spoof-f05',
      email: 'spoof@nexus.internal',
      role: 'superadmin',
      tenantId: 'tenant-beta',
    });
  }, 45_000);

  afterAll(async () => {
    try {
      if (agentA) await agentA.stop();
    } finally {
      try {
        if (agentB) await agentB.stop();
      } finally {
        if (cluster) await cluster.stop();
      }
    }
  }, 45_000);

  async function ensureBothTenantsConnected() {
    const putA = await cluster.apiFetch(ownerA.accessToken, '/api/v1/storage/connection', {
      method: 'PUT',
      body: {
        providerType: 'agent_node',
        label: 'Tenant A Vault',
        endpointUrl: agentA.url,
        rootPath: '/',
        hmacToken: agentA.hmacToken,
      },
    });
    expect([200, 201]).toContain(putA.status);

    const putB = await cluster.apiFetch(ownerBToken, '/api/v1/storage/connection', {
      method: 'PUT',
      body: {
        providerType: 'agent_node',
        label: 'Tenant B Vault',
        endpointUrl: agentB.url,
        rootPath: '/',
        hmacToken: agentB.hmacToken,
      },
    });
    expect([200, 201]).toContain(putB.status);
  }

  async function uploadTextToRoot(token, folderName, fileName, content) {
    const fRes = await cluster.apiFetch(token, '/api/v1/storage/folders', {
      method: 'POST',
      body: { parentId: null, name: folderName },
    });
    expect(fRes.status).toBe(201);
    const folderId = extractId(fRes.data);

    const form = new FormData();
    form.append('parentId', folderId);
    form.append('fileName', fileName);
    form.append('file', new Blob([content], { type: 'text/plain' }), fileName);

    const uRes = await cluster.apiFetch(token, '/api/v1/storage/upload', { method: 'POST', body: form });
    expect(uRes.status).toBe(201);
    return { folderId, fileId: extractId(uRes.data) };
  }

  describe('Tier 1 — Tenant Isolation & Superadmin Zero-Knowledge Contract', () => {
    it('T1.1 — isolates connection metadata per tenant, masks secrets, and leaves tenant-gamma unconfigured', async () => {
      await ensureBothTenantsConnected();

      const getA = await cluster.apiFetch(ownerA.accessToken, '/api/v1/storage/connection');
      expect(getA.status).toBe(200);
      expect((getA.data?.connection || getA.data)?.label).toBe('Tenant A Vault');
      expect(getA.text).not.toContain(agentA.hmacToken);

      const getB = await cluster.apiFetch(ownerBToken, '/api/v1/storage/connection');
      expect(getB.status).toBe(200);
      expect((getB.data?.connection || getB.data)?.label).toBe('Tenant B Vault');
      expect(getB.text).not.toContain(agentB.hmacToken);

      const gammaToken = cluster.createUserToken({
        sub: 'gamma-owner',
        email: 'owner@gamma.example.com',
        role: 'owner',
        tenantId: 'tenant-gamma',
      });
      const getGamma = await cluster.apiFetch(gammaToken, '/api/v1/storage/connection');
      expect([200, 404]).toContain(getGamma.status);
      if (getGamma.status === 200) {
        expect(getGamma.data?.configured === false || getGamma.data?.connection === null).toBe(true);
      }
    });

    it('T1.2 — isolates initialized VFS trees and node listings between Tenant A and Tenant B', async () => {
      await ensureBothTenantsConnected();

      const initA = await cluster.apiFetch(ownerA.accessToken, '/api/v1/storage/initialize', { method: 'POST' });
      expect([200, 201]).toContain(initA.status);
      const initB = await cluster.apiFetch(ownerBToken, '/api/v1/storage/initialize', { method: 'POST' });
      expect([200, 201]).toContain(initB.status);

      const alpha = await uploadTextToRoot(ownerA.accessToken, 'AlphaOnlyT12', 'alpha-secret.txt', 'alpha-content');
      const beta = await uploadTextToRoot(ownerBToken, 'BetaOnlyT12', 'beta-secret.txt', 'beta-content');

      const listA = await cluster.apiFetch(ownerA.accessToken, '/api/v1/storage/nodes?q=secret.txt');
      expect(listA.status).toBe(200);
      const itemsA = listA.data?.items || listA.data?.nodes || [];
      expect(itemsA.some((n) => n.id === alpha.fileId)).toBe(true);
      expect(itemsA.some((n) => n.id === beta.fileId)).toBe(false);

      const listB = await cluster.apiFetch(ownerBToken, '/api/v1/storage/nodes?q=secret.txt');
      expect(listB.status).toBe(200);
      const itemsB = listB.data?.items || listB.data?.nodes || [];
      expect(itemsB.some((n) => n.id === beta.fileId)).toBe(true);
      expect(itemsB.some((n) => n.id === alpha.fileId)).toBe(false);
    });

    it('T1.3 — blocks cross-tenant download, preview, rename/move, and delete with 403/404', async () => {
      await ensureBothTenantsConnected();
      const alpha = await uploadTextToRoot(ownerA.accessToken, 'AlphaGuardT13', 'guard.txt', 'TOP_SECRET_ALPHA');

      const dlCross = await cluster.apiFetch(ownerBToken, `/api/v1/storage/nodes/${alpha.fileId}/download`);
      expect([403, 404]).toContain(dlCross.status);

      const prevCross = await cluster.apiFetch(ownerBToken, `/api/v1/storage/nodes/${alpha.fileId}/preview`);
      expect([403, 404]).toContain(prevCross.status);

      const patchCross = await cluster.apiFetch(ownerBToken, `/api/v1/storage/nodes/${alpha.fileId}`, {
        method: 'PATCH',
        body: { name: 'stolen.txt' },
      });
      expect([403, 404]).toContain(patchCross.status);

      const delCross = await cluster.apiFetch(ownerBToken, `/api/v1/storage/nodes/${alpha.fileId}`, {
        method: 'DELETE',
      });
      expect([403, 404]).toContain(delCross.status);

      const verifyIntact = await cluster.apiFetch(ownerA.accessToken, `/api/v1/storage/nodes/${alpha.fileId}/download`);
      expect(verifyIntact.status).toBe(200);
      expect(verifyIntact.text).toBe('TOP_SECRET_ALPHA');
    });

    it('T1.4 — rejects superadmin (nexus-master) with 403 ZERO_KNOWLEDGE_RESTRICTED across storage endpoints', async () => {
      await ensureBothTenantsConnected();
      const alpha = await uploadTextToRoot(ownerA.accessToken, 'AlphaZKT14', 'zk.txt', 'PRIVATE_DATA');

      const endpoints = [
        ['GET', '/api/v1/storage/connection'],
        ['PUT', '/api/v1/storage/connection', { label: 'Bypass' }],
        ['POST', '/api/v1/storage/connection/test'],
        ['GET', '/api/v1/storage/nodes'],
        ['GET', `/api/v1/storage/nodes/${alpha.fileId}/download`],
        ['GET', `/api/v1/storage/nodes/${alpha.fileId}/preview`],
        ['GET', '/api/v1/storage/trash'],
        ['GET', '/api/v1/storage/links'],
      ];

      for (const [method, endpoint, body] of endpoints) {
        const res = await cluster.apiFetch(superadminMaster, endpoint, { method, ...(body ? { body } : {}) });
        expect(res.status).toBe(403);
        expect(res.data?.error || res.text).toMatch(/ZERO_KNOWLEDGE_RESTRICTED|Forbidden/i);
      }
    });

    it('T1.5 — canonical tenant alias shineray resolves to tenant-ap3htf6 and cannot access tenant-beta', async () => {
      await ensureBothTenantsConnected();
      const alpha = await uploadTextToRoot(ownerA.accessToken, 'AliasCheckT15', 'canon.txt', 'CANONICAL_BYTES');
      const beta = await uploadTextToRoot(ownerBToken, 'BetaCheckT15', 'beta.txt', 'BETA_BYTES');

      const shinerayAliasToken = cluster.createUserToken({
        sub: 'f05-shineray-alias',
        email: 'alias@shineraybysabel.com.br',
        role: 'owner',
        tenantId: 'shineray',
      });

      const dlAlpha = await cluster.apiFetch(shinerayAliasToken, `/api/v1/storage/nodes/${alpha.fileId}/download`);
      expect(dlAlpha.status).toBe(200);
      expect(dlAlpha.text).toBe('CANONICAL_BYTES');

      const dlBeta = await cluster.apiFetch(shinerayAliasToken, `/api/v1/storage/nodes/${beta.fileId}/download`);
      expect([403, 404]).toContain(dlBeta.status);
    });
  });

  describe('Tier 2 — Sub-Resource Isolation, Anti-Spoofing & Compliance Chains', () => {
    it('T2.1 — isolates locks, file versions, and trash items strictly by tenant_id', async () => {
      await ensureBothTenantsConnected();
      const { folderId, fileId } = await uploadTextToRoot(
        ownerA.accessToken,
        'AlphaLockVerT21',
        'locked.txt',
        'v1-content',
      );

      const lockRes = await cluster.apiFetch(ownerA.accessToken, `/api/v1/storage/nodes/${fileId}/lock`, {
        method: 'POST',
      });
      expect([200, 201]).toContain(lockRes.status);

      const v2Form = new FormData();
      v2Form.append('parentId', folderId);
      v2Form.append('fileName', 'locked.txt');
      v2Form.append('conflictPolicy', 'version');
      v2Form.append('file', new Blob(['v2-content'], { type: 'text/plain' }), 'locked.txt');
      await cluster.apiFetch(ownerA.accessToken, `/api/v1/storage/nodes/${fileId}/lock`, { method: 'DELETE' });
      const v2Res = await cluster.apiFetch(ownerA.accessToken, '/api/v1/storage/upload', { method: 'POST', body: v2Form });
      expect([200, 201]).toContain(v2Res.status);

      const trashed = await uploadTextToRoot(ownerA.accessToken, 'AlphaTrashT21', 'trashme.txt', 'trash-bytes');
      const delRes = await cluster.apiFetch(ownerA.accessToken, `/api/v1/storage/nodes/${trashed.fileId}`, {
        method: 'DELETE',
      });
      expect([200, 204]).toContain(delRes.status);

      const crossLock = await cluster.apiFetch(ownerBToken, `/api/v1/storage/nodes/${fileId}/lock`, { method: 'POST' });
      expect([403, 404]).toContain(crossLock.status);

      const crossUnlock = await cluster.apiFetch(ownerBToken, `/api/v1/storage/nodes/${fileId}/lock`, {
        method: 'DELETE',
      });
      expect([403, 404]).toContain(crossUnlock.status);

      const crossVersions = await cluster.apiFetch(ownerBToken, `/api/v1/storage/nodes/${fileId}/versions`);
      expect([403, 404]).toContain(crossVersions.status);

      const crossRestoreVer = await cluster.apiFetch(
        ownerBToken,
        `/api/v1/storage/nodes/${fileId}/versions/1/restore`,
        { method: 'POST' },
      );
      expect([403, 404]).toContain(crossRestoreVer.status);

      const betaTrash = await cluster.apiFetch(ownerBToken, '/api/v1/storage/trash');
      expect(betaTrash.status).toBe(200);
      const betaTrashItems = betaTrash.data?.items || betaTrash.data?.trash || [];
      expect(betaTrashItems.some((t) => t.id === trashed.fileId || t.nodeId === trashed.fileId)).toBe(false);

      const crossTrashRestore = await cluster.apiFetch(
        ownerBToken,
        `/api/v1/storage/trash/${trashed.fileId}/restore`,
        { method: 'POST' },
      );
      expect([403, 404]).toContain(crossTrashRestore.status);

      const crossTrashPurge = await cluster.apiFetch(
        ownerBToken,
        `/api/v1/storage/trash/${trashed.fileId}`,
        { method: 'DELETE' },
      );
      expect([403, 404]).toContain(crossTrashPurge.status);
    });

    it('T2.2 — isolates ACL rules, temporary share links, and sheet sessions/history by tenant_id', async () => {
      await ensureBothTenantsConnected();
      const alpha = await uploadTextToRoot(ownerA.accessToken, 'AlphaSubT22', 'acl-doc.txt', 'acl-data');

      const aclPut = await cluster.apiFetch(ownerA.accessToken, `/api/v1/storage/nodes/${alpha.folderId}/acl`, {
        method: 'PUT',
        body: { rules: [{ targetType: 'department', targetValue: 'TI', accessLevel: 'full_control' }] },
      });
      expect([200, 201]).toContain(aclPut.status);

      const linkRes = await cluster.apiFetch(ownerA.accessToken, '/api/v1/storage/links', {
        method: 'POST',
        body: { nodeId: alpha.fileId, expiresInMinutes: 30 },
      });
      expect(linkRes.status).toBe(201);
      const linkId = extractId(linkRes.data);

      const sheetRes = await cluster.apiFetch(ownerA.accessToken, '/api/v1/storage/sheets', {
        method: 'POST',
        body: { parentId: alpha.folderId, name: 'AlphaSheetT22.xlsx' },
      });
      expect(sheetRes.status).toBe(201);
      const sheetId = extractId(sheetRes.data);

      expect([403, 404]).toContain(
        (await cluster.apiFetch(ownerBToken, `/api/v1/storage/nodes/${alpha.folderId}/acl`)).status,
      );
      expect([403, 404]).toContain(
        (
          await cluster.apiFetch(ownerBToken, `/api/v1/storage/nodes/${alpha.folderId}/acl`, {
            method: 'PUT',
            body: { rules: [{ targetType: 'role', targetValue: 'owner', accessLevel: 'full_control' }] },
          })
        ).status,
      );

      const betaLinks = await cluster.apiFetch(ownerBToken, '/api/v1/storage/links');
      expect(betaLinks.status).toBe(200);
      const linksList = betaLinks.data?.links || betaLinks.data?.items || [];
      expect(linksList.some((l) => l.id === linkId)).toBe(false);

      expect([403, 404]).toContain(
        (await cluster.apiFetch(ownerBToken, `/api/v1/storage/links/${linkId}`, { method: 'DELETE' })).status,
      );
      expect([403, 404]).toContain(
        (await cluster.apiFetch(ownerBToken, `/api/v1/storage/sheets/${sheetId}`)).status,
      );
      expect([403, 404]).toContain(
        (await cluster.apiFetch(ownerBToken, `/api/v1/storage/sheets/${sheetId}/history`)).status,
      );
      expect([403, 404]).toContain(
        (await cluster.apiFetch(ownerBToken, `/api/v1/storage/sheets/${sheetId}/export?format=xlsx`)).status,
      );
    });

    it('T2.3 — ignores forged x-tenant-id and x-user-role headers in Gateway requests', async () => {
      await ensureBothTenantsConnected();
      const alpha = await uploadTextToRoot(ownerA.accessToken, 'SpoofTargetT23', 'secret.txt', 'ALPHA_PRIVATE');

      const spoofConn = await cluster.apiFetch(ownerBToken, '/api/v1/storage/connection', {
        headers: {
          'x-tenant-id': 'tenant-ap3htf6',
          'x-user-role': 'owner',
        },
      });
      expect(spoofConn.status).toBe(200);
      expect((spoofConn.data?.connection || spoofConn.data)?.label).toBe('Tenant B Vault');

      const spoofNodes = await cluster.apiFetch(ownerBToken, '/api/v1/storage/nodes', {
        headers: { 'x-tenant-id': 'tenant-ap3htf6' },
      });
      expect(spoofNodes.status).toBe(200);
      const items = spoofNodes.data?.items || spoofNodes.data?.nodes || [];
      expect(items.some((n) => n.id === alpha.fileId)).toBe(false);

      // Collaborator on Tenant A attempting x-user-role: owner header spoof cannot write connection
      const colabSpoof = await cluster.apiFetch(colabA.accessToken, '/api/v1/storage/connection', {
        method: 'PUT',
        headers: { 'x-user-role': 'owner' },
        body: { label: 'Spoofed' },
      });
      expect(colabSpoof.status).toBe(403);
    });

    it('T2.4 — blocks superadmin even when JWT carries tenant-beta across upload, zip, initialize, sheets, and quota', async () => {
      await ensureBothTenantsConnected();

      const form = new FormData();
      form.append('fileName', 'sa-spoof.txt');
      form.append('file', new Blob(['blocked'], { type: 'text/plain' }), 'sa-spoof.txt');

      expect((await cluster.apiFetch(superadminSpoof, '/api/v1/storage/upload', { method: 'POST', body: form })).status).toBe(
        403,
      );
      expect(
        (
          await cluster.apiFetch(superadminSpoof, '/api/v1/storage/nodes/download-zip', {
            method: 'POST',
            body: { nodeIds: [] },
          })
        ).status,
      ).toBe(403);
      expect(
        (await cluster.apiFetch(superadminSpoof, '/api/v1/storage/initialize', { method: 'POST' })).status,
      ).toBe(403);
      expect(
        (
          await cluster.apiFetch(superadminSpoof, '/api/v1/storage/sheets', {
            method: 'POST',
            body: { parentId: null, name: 'SpoofSheet.xlsx' },
          })
        ).status,
      ).toBe(403);
      expect((await cluster.apiFetch(superadminSpoof, '/api/v1/storage/quota')).status).toBe(403);
    });

    it('T2.5 — maintains independent verifiable SHA-256 compliance audit chains per tenant', async () => {
      await ensureBothTenantsConnected();
      await uploadTextToRoot(ownerA.accessToken, 'AuditAlphaT25', 'a.txt', 'alpha-audit');
      await uploadTextToRoot(ownerBToken, 'AuditBetaT25', 'b.txt', 'beta-audit');

      const auditA = await assertFullAuditIntegrity(cluster.apiFetch, ownerA.accessToken);
      const auditB = await assertFullAuditIntegrity(cluster.apiFetch, ownerBToken);

      expect(auditA.apiResult.intact).toBe(true);
      expect(auditA.localResult.valid).toBe(true);
      expect(auditA.itemsAsc.every((e) => e.tenant_id === 'tenant-ap3htf6')).toBe(true);

      expect(auditB.apiResult.intact).toBe(true);
      expect(auditB.localResult.valid).toBe(true);
      expect(auditB.itemsAsc.every((e) => e.tenant_id === 'tenant-beta')).toBe(true);
    });
  });
});
