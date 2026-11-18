// services/tests/e2e_cloud_vault/f14_versioning.test.js
// =============================================================================
// F-14: File Versioning (.nexus_versions/) & Restore (Opaque-Box E2E Suite)
// =============================================================================

import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootE2eCluster } from './helpers/clusterHarness.js';
import { signAgentNodeHeaders, startMockAgentNode } from './helpers/mockAgentNode.js';

describe('F-14: File Versioning (.nexus_versions/) & Restore', () => {
  let cluster;
  let agent;
  let ownerToken;
  let operatorToken;
  let viewerToken;
  let betaToken;
  let corpPublicId;

  function extractNodesList(res) {
    if (Array.isArray(res.data)) return res.data;
    return res.data?.items || res.data?.nodes || [];
  }

  function extractVersionsList(res) {
    if (Array.isArray(res.data)) return res.data;
    return res.data?.versions || res.data?.items || [];
  }

  function sha256(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
  }

  async function uploadVersioned(token, fileName, content) {
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
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
      name: 'Version Operator',
      email: 'ver.op@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'operator',
      department: 'Tecnologia',
    });
    operatorToken = (await cluster.loginAs('ver.op@shineraybysabel.com.br', 'Password@2026!')).accessToken;

    await cluster.seedUser(ownerToken, {
      name: 'Version Viewer',
      email: 'ver.viewer@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'viewer',
      department: 'Geral',
    });
    viewerToken = (await cluster.loginAs('ver.viewer@shineraybysabel.com.br', 'Password@2026!')).accessToken;

    betaToken = cluster.createUserToken({
      sub: 'beta-ver-owner',
      email: 'owner@beta-ver.example.com',
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
        label: 'E2E Versioning Node',
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

  describe('Tier 1 — Version Creation, .nexus_versions/ Snapshots, Restore & Attribution', () => {
    it('creates version 1 record on initial upload and lists via GET /nodes/:id/versions', async () => {
      const v1Data = Buffer.from('VERSION_1_INITIAL_DATA', 'utf8');
      const up = await uploadVersioned(ownerToken, 'f14-t1-contract.txt', v1Data);
      expect([200, 201]).toContain(up.status);
      const nodeId = (up.data?.node || up.data).id;

      const listRes = await cluster.apiFetch(ownerToken, `/api/v1/storage/nodes/${nodeId}/versions`);
      expect(listRes.status).toBe(200);
      const versions = extractVersionsList(listRes);
      expect(versions).toHaveLength(1);
      expect(Number(versions[0].version_number)).toBe(1);
      expect(versions[0].sha256_hash).toBe(sha256(v1Data));
      expect(Number(versions[0].size_bytes)).toBe(v1Data.length);
      expect(versions[0].uploaded_by_email).toBe('ti@shineraybysabel.com.br');
    });

    it('stores snapshot in .nexus_versions/ on overwrite and records v2', async () => {
      const up1 = await uploadVersioned(ownerToken, 'f14-t2-snap.txt', 'VERSION_1_DATA');
      expect([200, 201]).toContain(up1.status);
      const nodeId = (up1.data?.node || up1.data).id;

      const up2 = await uploadVersioned(ownerToken, 'f14-t2-snap.txt', 'VERSION_2_DATA');
      expect([200, 201]).toContain(up2.status);

      const listRes = await cluster.apiFetch(ownerToken, `/api/v1/storage/nodes/${nodeId}/versions`);
      expect(listRes.status).toBe(200);
      const versions = extractVersionsList(listRes);
      expect(versions.map((v) => Number(v.version_number))).toEqual([2, 1]);

      const verRoot = await agentReaddir('/.nexus_versions');
      const verSub = await agentReaddir(`/.nexus_versions/${nodeId}`);
      const hasSnapshot =
        (verRoot?.entries && verRoot.entries.length > 0) ||
        (verSub?.entries && verSub.entries.length > 0);
      expect(hasSnapshot).toBe(true);
    });

    it('restores previous version via POST /nodes/:id/versions/1/restore with byte-for-byte parity', async () => {
      const v1Buf = Buffer.from('VERSION_1_RESTORE_EXACT_BYTES', 'utf8');
      const v2Buf = Buffer.from('VERSION_2_OVERWRITTEN_BYTES', 'utf8');
      const up1 = await uploadVersioned(ownerToken, 'f14-t3-restore.txt', v1Buf);
      expect([200, 201]).toContain(up1.status);
      const nodeId = (up1.data?.node || up1.data).id;

      const up2 = await uploadVersioned(ownerToken, 'f14-t3-restore.txt', v2Buf);
      expect([200, 201]).toContain(up2.status);

      const restoreRes = await cluster.apiFetch(ownerToken, `/api/v1/storage/nodes/${nodeId}/versions/1/restore`, {
        method: 'POST',
        body: {},
      });
      expect([200, 201]).toContain(restoreRes.status);

      const dlRes = await cluster.apiFetch(ownerToken, `/api/v1/storage/nodes/${nodeId}/download`);
      expect(dlRes.status).toBe(200);
      expect(dlRes.buffer.equals(v1Buf)).toBe(true);
    });

    it('preserves version history trail after restore by creating v3 pointing to restored content', async () => {
      const v1Buf = Buffer.from('TRAIL_V1_BYTES', 'utf8');
      const v2Buf = Buffer.from('TRAIL_V2_BYTES', 'utf8');
      const up1 = await uploadVersioned(ownerToken, 'f14-t4-trail.txt', v1Buf);
      expect([200, 201]).toContain(up1.status);
      const nodeId = (up1.data?.node || up1.data).id;

      const up2 = await uploadVersioned(ownerToken, 'f14-t4-trail.txt', v2Buf);
      expect([200, 201]).toContain(up2.status);

      const restoreRes = await cluster.apiFetch(ownerToken, `/api/v1/storage/nodes/${nodeId}/versions/1/restore`, {
        method: 'POST',
        body: {},
      });
      expect([200, 201]).toContain(restoreRes.status);

      const versions = extractVersionsList(
        await cluster.apiFetch(ownerToken, `/api/v1/storage/nodes/${nodeId}/versions`),
      );
      expect(versions.map((v) => Number(v.version_number))).toEqual([3, 2, 1]);
      expect(versions[0].sha256_hash).toBe(sha256(v1Buf));
    });

    it('tracks uploader attribution (uploaded_by_email) per version across different actors', async () => {
      const up1 = await uploadVersioned(ownerToken, 'f14-t5-attrib.txt', 'OWNER_V1');
      expect([200, 201]).toContain(up1.status);
      const nodeId = (up1.data?.node || up1.data).id;

      const up2 = await uploadVersioned(operatorToken, 'f14-t5-attrib.txt', 'OPERATOR_V2');
      expect([200, 201]).toContain(up2.status);

      const versions = extractVersionsList(
        await cluster.apiFetch(ownerToken, `/api/v1/storage/nodes/${nodeId}/versions`),
      );
      const v1 = versions.find((v) => Number(v.version_number) === 1);
      const v2 = versions.find((v) => Number(v.version_number) === 2);
      expect(v1?.uploaded_by_email).toBe('ti@shineraybysabel.com.br');
      expect(v2?.uploaded_by_email).toBe('ver.op@shineraybysabel.com.br');
    });
  });

  describe('Tier 2 — Retention Cap, Lock Conflict, Not Found, RBAC & Multitenancy', () => {
    it('enforces version retention cap N and retains the most recent versions', async () => {
      const totalUploads = 15;
      let nodeId;
      for (let i = 1; i <= totalUploads; i += 1) {
        const up = await uploadVersioned(ownerToken, 'f14-t6-cap.txt', `CAP_CONTENT_${i}`);
        expect([200, 201]).toContain(up.status);
        nodeId = (up.data?.node || up.data).id;
      }

      const listRes = await cluster.apiFetch(ownerToken, `/api/v1/storage/nodes/${nodeId}/versions`);
      expect(listRes.status).toBe(200);
      const versions = extractVersionsList(listRes);
      expect(versions.length).toBeGreaterThan(0);
      expect(versions.length).toBeLessThanOrEqual(10);
      expect(Number(versions[0].version_number)).toBe(totalUploads);
    });

    it('rejects version restore when file is locked by another user (423 Locked)', async () => {
      const up1 = await uploadVersioned(ownerToken, 'f14-t7-locked.txt', 'LOCK_V1');
      expect([200, 201]).toContain(up1.status);
      const nodeId = (up1.data?.node || up1.data).id;

      const up2 = await uploadVersioned(ownerToken, 'f14-t7-locked.txt', 'LOCK_V2');
      expect([200, 201]).toContain(up2.status);

      const lockRes = await cluster.apiFetch(ownerToken, `/api/v1/storage/nodes/${nodeId}/lock`, {
        method: 'POST',
        body: {},
      });
      expect(lockRes.status).toBe(200);

      const restoreBlocked = await cluster.apiFetch(
        operatorToken,
        `/api/v1/storage/nodes/${nodeId}/versions/1/restore`,
        { method: 'POST', body: {} },
      );
      expect(restoreBlocked.status).toBe(423);
    });

    it('rejects restore of non-existent version number or non-existent node with 404', async () => {
      const up = await uploadVersioned(ownerToken, 'f14-t8-missing.txt', 'ONLY_V1');
      expect([200, 201]).toContain(up.status);
      const nodeId = (up.data?.node || up.data).id;

      const missingVer = await cluster.apiFetch(ownerToken, `/api/v1/storage/nodes/${nodeId}/versions/999/restore`, {
        method: 'POST',
        body: {},
      });
      expect(missingVer.status).toBe(404);

      const missingNode = await cluster.apiFetch(
        ownerToken,
        '/api/v1/storage/nodes/00000000-0000-4000-8000-000000000999/versions/1/restore',
        { method: 'POST', body: {} },
      );
      expect(missingNode.status).toBe(404);
    });

    it('blocks viewer from restoring versions (403) while allowing version history listing (200)', async () => {
      const up1 = await uploadVersioned(ownerToken, 'f14-t9-rbac.txt', 'RBAC_V1');
      expect([200, 201]).toContain(up1.status);
      const nodeId = (up1.data?.node || up1.data).id;

      const up2 = await uploadVersioned(ownerToken, 'f14-t9-rbac.txt', 'RBAC_V2');
      expect([200, 201]).toContain(up2.status);

      const listRes = await cluster.apiFetch(viewerToken, `/api/v1/storage/nodes/${nodeId}/versions`);
      expect(listRes.status).toBe(200);

      const restoreRes = await cluster.apiFetch(viewerToken, `/api/v1/storage/nodes/${nodeId}/versions/1/restore`, {
        method: 'POST',
        body: {},
      });
      expect(restoreRes.status).toBe(403);
    });

    it('blocks cross-tenant version listing and restore (403/404)', async () => {
      const up = await uploadVersioned(ownerToken, 'f14-t10-tenant.txt', 'TENANT_A_VER');
      expect([200, 201]).toContain(up.status);
      const nodeId = (up.data?.node || up.data).id;

      const listOther = await cluster.apiFetch(betaToken, `/api/v1/storage/nodes/${nodeId}/versions`);
      expect([403, 404]).toContain(listOther.status);

      const restoreOther = await cluster.apiFetch(betaToken, `/api/v1/storage/nodes/${nodeId}/versions/1/restore`, {
        method: 'POST',
        body: {},
      });
      expect([403, 404]).toContain(restoreOther.status);
    });
  });
});
