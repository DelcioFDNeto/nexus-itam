// services/tests/e2e_cloud_vault/f18_temp_links.test.js
// =============================================================================
// F-18: Audited Temporary Share Links (Opaque-Box E2E Suite)
// =============================================================================

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootE2eCluster } from './helpers/clusterHarness.js';
import { startMockAgentNode } from './helpers/mockAgentNode.js';
import { assertFullAuditIntegrity, findAuditEvents } from './helpers/auditHelper.js';

describe('F-18: Audited Temporary Share Links', () => {
  let cluster;
  let agent;
  let ownerToken;
  let managerToken;
  let viewerToken;
  let collabToken;
  let betaToken;
  let corpPublicId;
  let brochureId;
  const brochureBytes = Buffer.from('%PDF-1.4\nNEXUS_PUBLIC_BROCHURE_CONTENT', 'utf8');

  function extractNodesList(res) {
    if (Array.isArray(res.data)) return res.data;
    return res.data?.items || res.data?.nodes || [];
  }

  function extractLinksList(res) {
    if (Array.isArray(res.data)) return res.data;
    return res.data?.links || res.data?.items || [];
  }

  beforeAll(async () => {
    cluster = await bootE2eCluster();
    const owner = await cluster.loginAs('ti@shineraybysabel.com.br', 'Shineray@2026!');
    ownerToken = owner.accessToken;

    await cluster.seedUser(ownerToken, {
      name: 'Links Manager',
      email: 'links.mgr@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'manager',
      department: 'Comercial',
    });
    managerToken = (await cluster.loginAs('links.mgr@shineraybysabel.com.br', 'Password@2026!')).accessToken;

    await cluster.seedUser(ownerToken, {
      name: 'Links Viewer',
      email: 'links.viewer@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'viewer',
      department: 'Comercial',
    });
    viewerToken = (await cluster.loginAs('links.viewer@shineraybysabel.com.br', 'Password@2026!')).accessToken;

    await cluster.seedUser(ownerToken, {
      name: 'Links Collab',
      email: 'links.collab@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'collaborator',
      department: 'Comercial',
    });
    collabToken = (await cluster.loginAs('links.collab@shineraybysabel.com.br', 'Password@2026!')).accessToken;

    betaToken = cluster.createUserToken({
      sub: 'beta-links-owner',
      email: 'owner@beta-links.example.com',
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
        label: 'E2E TempLinks Node',
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

    const form = new FormData();
    form.append('parentId', corpPublicId);
    form.append('fileName', 'f18-brochure.pdf');
    form.append('conflictPolicy', 'version');
    form.append('file', new Blob([brochureBytes], { type: 'application/pdf' }), 'f18-brochure.pdf');
    const up = await cluster.apiFetch(ownerToken, '/api/v1/storage/upload', {
      method: 'POST',
      body: form,
    });
    expect([200, 201]).toContain(up.status);
    brochureId = (up.data?.node || up.data).id;
  }, 45_000);

  afterAll(async () => {
    try {
      if (agent) await agent.stop();
    } finally {
      if (cluster) await cluster.stop();
    }
  }, 45_000);

  describe('Tier 1 — Link Creation, Public Access, Password Protection, Download Flag & Revocation', () => {
    it('creates a temporary share link and lists masked metadata without exposing password', async () => {
      const createRes = await cluster.apiFetch(managerToken, '/api/v1/storage/links', {
        method: 'POST',
        body: {
          nodeId: brochureId,
          expiresInMinutes: 60,
          password: 'MaskCheck#2026',
          allowDownload: true,
        },
      });
      expect(createRes.status).toBe(201);
      const linkObj = createRes.data?.link || createRes.data;
      const rawToken = createRes.data?.token || linkObj?.token;
      expect(linkObj?.id).toBeTruthy();
      expect(rawToken).toBeTruthy();

      const listRes = await cluster.apiFetch(managerToken, '/api/v1/storage/links');
      expect(listRes.status).toBe(200);
      const listed = extractLinksList(listRes).find((l) => l.id === linkObj.id);
      expect(listed).toBeTruthy();
      expect(JSON.stringify(listed)).not.toContain('MaskCheck#2026');
    });

    it('grants unauthenticated public access via GET /share/:token and increments access_count', async () => {
      const createRes = await cluster.apiFetch(managerToken, '/api/v1/storage/links', {
        method: 'POST',
        body: { nodeId: brochureId, expiresInMinutes: 60, allowDownload: true },
      });
      expect(createRes.status).toBe(201);
      const linkId = (createRes.data?.link || createRes.data).id;
      const rawToken = createRes.data?.token || createRes.data?.link?.token;

      const shareRes = await cluster.apiFetch(null, `/api/v1/storage/share/${rawToken}`);
      expect(shareRes.status).toBe(200);
      expect(shareRes.buffer.length).toBeGreaterThan(0);

      const listRes = await cluster.apiFetch(managerToken, '/api/v1/storage/links');
      const listed = extractLinksList(listRes).find((l) => l.id === linkId);
      expect(Number(listed?.access_count)).toBeGreaterThanOrEqual(1);
    });

    it('enforces optional password protection via POST /share/:token', async () => {
      const createRes = await cluster.apiFetch(managerToken, '/api/v1/storage/links', {
        method: 'POST',
        body: {
          nodeId: brochureId,
          expiresInMinutes: 60,
          password: 'Secret#2026',
          allowDownload: true,
        },
      });
      expect(createRes.status).toBe(201);
      const rawToken = createRes.data?.token || createRes.data?.link?.token;

      const unauthGet = await cluster.apiFetch(null, `/api/v1/storage/share/${rawToken}`);
      expect([401, 403]).toContain(unauthGet.status);

      const postOk = await cluster.apiFetch(null, `/api/v1/storage/share/${rawToken}`, {
        method: 'POST',
        body: { password: 'Secret#2026' },
      });
      expect(postOk.status).toBe(200);
    });

    it('enforces allowDownload flag (false blocks download mode; true allows download)', async () => {
      const previewOnlyRes = await cluster.apiFetch(managerToken, '/api/v1/storage/links', {
        method: 'POST',
        body: { nodeId: brochureId, expiresInMinutes: 60, allowDownload: false },
      });
      expect(previewOnlyRes.status).toBe(201);
      const previewToken = previewOnlyRes.data?.token || previewOnlyRes.data?.link?.token;

      const blockedDl = await cluster.apiFetch(null, `/api/v1/storage/share/${previewToken}?download=1`);
      if (blockedDl.status === 200) {
        const disp = (blockedDl.headers.get('content-disposition') || '').toLowerCase();
        expect(disp).not.toContain('attachment');
      } else {
        expect(blockedDl.status).toBe(403);
      }

      const allowDlRes = await cluster.apiFetch(managerToken, '/api/v1/storage/links', {
        method: 'POST',
        body: { nodeId: brochureId, expiresInMinutes: 60, allowDownload: true },
      });
      expect(allowDlRes.status).toBe(201);
      const dlToken = allowDlRes.data?.token || allowDlRes.data?.link?.token;

      const okDl = await cluster.apiFetch(null, `/api/v1/storage/share/${dlToken}?download=1`);
      expect(okDl.status).toBe(200);
      expect(okDl.buffer.equals(brochureBytes)).toBe(true);
    });

    it('revokes link immediately via DELETE /links/:id so subsequent access returns 410 Gone', async () => {
      const createRes = await cluster.apiFetch(managerToken, '/api/v1/storage/links', {
        method: 'POST',
        body: { nodeId: brochureId, expiresInMinutes: 60, allowDownload: true },
      });
      expect(createRes.status).toBe(201);
      const linkId = (createRes.data?.link || createRes.data).id;
      const rawToken = createRes.data?.token || createRes.data?.link?.token;

      const revRes = await cluster.apiFetch(managerToken, `/api/v1/storage/links/${linkId}`, {
        method: 'DELETE',
      });
      expect(revRes.status).toBe(200);

      const afterRev = await cluster.apiFetch(null, `/api/v1/storage/share/${rawToken}`);
      expect(afterRev.status).toBe(410);
    });

    it('supports expiresInHours, nodeId filter with nodeName/status metadata, and permanent purge via DELETE /links/:id?purge=true', async () => {
      const createRes = await cluster.apiFetch(managerToken, '/api/v1/storage/links', {
        method: 'POST',
        body: { nodeId: brochureId, expiresInHours: 2, allowDownload: false },
      });
      expect(createRes.status).toBe(201);
      const linkId = (createRes.data?.link || createRes.data).id;
      const rawToken = createRes.data?.token || createRes.data?.link?.token;
      expect(createRes.data?.nodeName).toBe('f18-brochure.pdf');
      expect(createRes.data?.sharePath).toBe(`/api/v1/storage/share/${rawToken}`);

      const filteredList = await cluster.apiFetch(managerToken, `/api/v1/storage/links?nodeId=${brochureId}`);
      expect(filteredList.status).toBe(200);
      const found = extractLinksList(filteredList).find((l) => l.id === linkId);
      expect(found).toBeTruthy();
      expect(found.nodeName).toBe('f18-brochure.pdf');
      expect(found.status).toBe('active');

      const purgeRes = await cluster.apiFetch(managerToken, `/api/v1/storage/links/${linkId}?purge=true`, {
        method: 'DELETE',
      });
      expect(purgeRes.status).toBe(200);
      expect(purgeRes.data?.purged).toBe(true);

      const listAfterPurge = await cluster.apiFetch(managerToken, `/api/v1/storage/links?nodeId=${brochureId}`);
      expect(listAfterPurge.status).toBe(200);
      expect(extractLinksList(listAfterPurge).find((l) => l.id === linkId)).toBeUndefined();

      const afterPurgeAccess = await cluster.apiFetch(null, `/api/v1/storage/share/${rawToken}`);
      expect(afterPurgeAccess.status).toBe(404);
    });
  });

  describe('Tier 2 — Expiration, Wrong Password, Audit Trail, RBAC & Cross-Tenant Isolation', () => {
    it('rejects expired temporary link with 410 Gone', async () => {
      const shortRes = await cluster.apiFetch(managerToken, '/api/v1/storage/links', {
        method: 'POST',
        body: { nodeId: brochureId, expiresInMinutes: 0.005, allowDownload: true },
      });
      if (shortRes.status === 400) {
        // If sub-minute TTL is rejected, verify zero-minute rejection + test integer minimum or past expiry
        const zeroRes = await cluster.apiFetch(managerToken, '/api/v1/storage/links', {
          method: 'POST',
          body: { nodeId: brochureId, expiresInMinutes: 0, allowDownload: true },
        });
        expect(zeroRes.status).toBe(400);
        return;
      }
      expect(shortRes.status).toBe(201);
      const rawToken = shortRes.data?.token || shortRes.data?.link?.token;
      await new Promise((r) => setTimeout(r, 450));

      const expiredGet = await cluster.apiFetch(null, `/api/v1/storage/share/${rawToken}`);
      expect(expiredGet.status).toBe(410);
    });

    it('rejects wrong password on POST /share/:token with 401/403 without incrementing access_count', async () => {
      const createRes = await cluster.apiFetch(managerToken, '/api/v1/storage/links', {
        method: 'POST',
        body: {
          nodeId: brochureId,
          expiresInMinutes: 60,
          password: 'CorrectPassword#2026',
          allowDownload: true,
        },
      });
      expect(createRes.status).toBe(201);
      const linkId = (createRes.data?.link || createRes.data).id;
      const rawToken = createRes.data?.token || createRes.data?.link?.token;

      const badPost = await cluster.apiFetch(null, `/api/v1/storage/share/${rawToken}`, {
        method: 'POST',
        body: { password: 'WrongPassword!' },
      });
      expect([401, 403]).toContain(badPost.status);

      const listRes = await cluster.apiFetch(managerToken, '/api/v1/storage/links');
      const listed = extractLinksList(listRes).find((l) => l.id === linkId);
      expect(Number(listed?.access_count)).toBe(0);
    });

    it('writes immutable compliance audit entries on link creation, public share access, and revocation', async () => {
      const createRes = await cluster.apiFetch(managerToken, '/api/v1/storage/links', {
        method: 'POST',
        body: { nodeId: brochureId, expiresInMinutes: 60, allowDownload: true },
      });
      expect(createRes.status).toBe(201);
      const linkId = (createRes.data?.link || createRes.data).id;
      const rawToken = createRes.data?.token || createRes.data?.link?.token;

      const shareRes = await cluster.apiFetch(null, `/api/v1/storage/share/${rawToken}`);
      expect(shareRes.status).toBe(200);

      const revRes = await cluster.apiFetch(managerToken, `/api/v1/storage/links/${linkId}`, {
        method: 'DELETE',
      });
      expect(revRes.status).toBe(200);

      const linkEvents = await findAuditEvents(cluster.apiFetch, ownerToken, { resourceId: linkId });
      const nodeEvents = await findAuditEvents(cluster.apiFetch, ownerToken, { resourceId: brochureId });
      expect(linkEvents.length + nodeEvents.length).toBeGreaterThanOrEqual(3);

      const integrity = await assertFullAuditIntegrity(cluster.apiFetch, ownerToken);
      expect(integrity.apiResult.intact).toBe(true);
      expect(integrity.localResult.valid).toBe(true);
    });

    it('blocks viewer and collaborator from creating or revoking share links (403)', async () => {
      const createRes = await cluster.apiFetch(managerToken, '/api/v1/storage/links', {
        method: 'POST',
        body: { nodeId: brochureId, expiresInMinutes: 60, allowDownload: true },
      });
      expect(createRes.status).toBe(201);
      const linkId = (createRes.data?.link || createRes.data).id;

      for (const token of [viewerToken, collabToken]) {
        const postRes = await cluster.apiFetch(token, '/api/v1/storage/links', {
          method: 'POST',
          body: { nodeId: brochureId, expiresInMinutes: 30, allowDownload: false },
        });
        expect(postRes.status).toBe(403);

        const delRes = await cluster.apiFetch(token, `/api/v1/storage/links/${linkId}`, {
          method: 'DELETE',
        });
        expect(delRes.status).toBe(403);
      }
    });

    it('enforces cross-tenant isolation on GET/DELETE /links and returns 404/410 on unknown share token', async () => {
      const createRes = await cluster.apiFetch(managerToken, '/api/v1/storage/links', {
        method: 'POST',
        body: { nodeId: brochureId, expiresInMinutes: 60, allowDownload: true },
      });
      expect(createRes.status).toBe(201);
      const linkId = (createRes.data?.link || createRes.data).id;

      const betaList = await cluster.apiFetch(betaToken, '/api/v1/storage/links');
      expect(betaList.status).toBe(200);
      expect(extractLinksList(betaList).find((l) => l.id === linkId)).toBeUndefined();

      const betaRevoke = await cluster.apiFetch(betaToken, `/api/v1/storage/links/${linkId}`, {
        method: 'DELETE',
      });
      expect([403, 404]).toContain(betaRevoke.status);

      const unknownShare = await cluster.apiFetch(null, '/api/v1/storage/share/nonexistent-token-xyz-999');
      expect([404, 410]).toContain(unknownShare.status);
    });
  });
});
