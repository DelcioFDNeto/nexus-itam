// services/tests/e2e_cloud_vault/f17_preview.test.js
// =============================================================================
// F-17: Online Preview Without Download (Opaque-Box E2E Suite)
// =============================================================================

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootE2eCluster } from './helpers/clusterHarness.js';
import { startMockAgentNode } from './helpers/mockAgentNode.js';

describe('F-17: Online Preview Without Download', () => {
  let cluster;
  let agent;
  let ownerToken;
  let viewerOnlineCollabToken;
  let betaToken;
  let corpPublicId;
  let cofreId;
  let previewFolderId;
  let txtId;
  let pdfId;
  let pngId;
  let mediaId;
  let mediaPayload;

  function extractNodesList(res) {
    if (Array.isArray(res.data)) return res.data;
    return res.data?.items || res.data?.nodes || [];
  }

  async function uploadSample(token, parentId, fileName, buf, mimeType) {
    const form = new FormData();
    form.append('parentId', parentId);
    form.append('fileName', fileName);
    form.append('conflictPolicy', 'version');
    form.append('file', new Blob([buf], { type: mimeType }), fileName);
    const res = await cluster.apiFetch(token, '/api/v1/storage/upload', {
      method: 'POST',
      body: form,
    });
    expect([200, 201]).toContain(res.status);
    return (res.data?.node || res.data).id;
  }

  beforeAll(async () => {
    cluster = await bootE2eCluster();
    const owner = await cluster.loginAs('ti@shineraybysabel.com.br', 'Shineray@2026!');
    ownerToken = owner.accessToken;

    await cluster.seedUser(ownerToken, {
      name: 'Preview ViewerOnline Collab',
      email: 'preview.vo@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'collaborator',
      department: 'Comercial',
    });
    viewerOnlineCollabToken = (
      await cluster.loginAs('preview.vo@shineraybysabel.com.br', 'Password@2026!')
    ).accessToken;

    betaToken = cluster.createUserToken({
      sub: 'beta-preview-owner',
      email: 'owner@beta-preview.example.com',
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
        label: 'E2E Preview Node',
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
    cofreId = roots.find((n) => n.name === 'Cofre-TI-Infra')?.id;
    expect(corpPublicId).toBeTruthy();
    expect(cofreId).toBeTruthy();

    const pFolder = await cluster.apiFetch(ownerToken, '/api/v1/storage/folders', {
      method: 'POST',
      body: { parentId: corpPublicId, name: 'F17-PreviewZone' },
    });
    expect(pFolder.status).toBe(201);
    previewFolderId = (pFolder.data?.node || pFolder.data).id;

    const aclRes = await cluster.apiFetch(ownerToken, `/api/v1/storage/nodes/${previewFolderId}/acl`, {
      method: 'PUT',
      body: {
        rules: [
          {
            targetType: 'user',
            targetValue: 'preview.vo@shineraybysabel.com.br',
            accessLevel: 'viewer_online',
          },
        ],
      },
    });
    expect([200, 201]).toContain(aclRes.status);

    txtId = await uploadSample(
      ownerToken,
      previewFolderId,
      'f17-log.txt',
      Buffer.from('LINE_1_INFO\nLINE_2_OK', 'utf8'),
      'text/plain',
    );
    pdfId = await uploadSample(
      ownerToken,
      previewFolderId,
      'f17-manual.pdf',
      Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF', 'utf8'),
      'application/pdf',
    );
    pngId = await uploadSample(
      ownerToken,
      previewFolderId,
      'f17-logo.png',
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]),
      'image/png',
    );
    mediaPayload = Buffer.from('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'utf8');
    mediaId = await uploadSample(
      ownerToken,
      previewFolderId,
      'f17-clip.mp4',
      mediaPayload,
      'video/mp4',
    );
  }, 45_000);

  afterAll(async () => {
    try {
      if (agent) await agent.stop();
    } finally {
      if (cluster) await cluster.stop();
    }
  }, 45_000);

  describe('Tier 1 — Inline Security Headers, Media Types, Byte Ranges & viewer_online', () => {
    it('serves text/log preview with Content-Disposition inline, Cache-Control no-store, and nosniff', async () => {
      const res = await cluster.apiFetch(ownerToken, `/api/v1/storage/nodes/${txtId}/preview`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-disposition') || '').toMatch(/^inline/i);
      expect((res.headers.get('cache-control') || '').toLowerCase()).toContain('no-store');
      expect((res.headers.get('x-content-type-options') || '').toLowerCase()).toBe('nosniff');
      expect(res.text).toContain('LINE_1_INFO');
    });

    it('serves PDF and PNG previews inline with matching Content-Type', async () => {
      const pdfRes = await cluster.apiFetch(ownerToken, `/api/v1/storage/nodes/${pdfId}/preview`);
      expect(pdfRes.status).toBe(200);
      expect((pdfRes.headers.get('content-type') || '').toLowerCase()).toContain('application/pdf');
      expect(pdfRes.headers.get('content-disposition') || '').toMatch(/^inline/i);

      const pngRes = await cluster.apiFetch(ownerToken, `/api/v1/storage/nodes/${pngId}/preview`);
      expect(pngRes.status).toBe(200);
      expect((pngRes.headers.get('content-type') || '').toLowerCase()).toContain('image/png');
      expect(pngRes.headers.get('content-disposition') || '').toMatch(/^inline/i);
    });

    it('supports HTTP Range bytes=10-19 returning 206 Partial Content, Content-Range, and Accept-Ranges', async () => {
      const res = await cluster.apiFetch(ownerToken, `/api/v1/storage/nodes/${mediaId}/preview`, {
        headers: { Range: 'bytes=10-19' },
      });
      expect(res.status).toBe(206);
      expect(res.headers.get('content-range')).toBe(`bytes 10-19/${mediaPayload.length}`);
      expect((res.headers.get('accept-ranges') || '').toLowerCase()).toBe('bytes');
      expect(res.text).toBe('ABCDEFGHIJ');
    });

    it('supports open-ended (bytes=26-) and suffix (bytes=-4) Range requests', async () => {
      const openRes = await cluster.apiFetch(ownerToken, `/api/v1/storage/nodes/${mediaId}/preview`, {
        headers: { Range: 'bytes=26-' },
      });
      expect(openRes.status).toBe(206);
      expect(openRes.headers.get('content-range')).toBe(`bytes 26-35/${mediaPayload.length}`);
      expect(openRes.text).toBe('QRSTUVWXYZ');

      const suffixRes = await cluster.apiFetch(ownerToken, `/api/v1/storage/nodes/${mediaId}/preview`, {
        headers: { Range: 'bytes=-4' },
      });
      expect(suffixRes.status).toBe(206);
      expect(suffixRes.headers.get('content-range')).toBe(`bytes 32-35/${mediaPayload.length}`);
      expect(suffixRes.text).toBe('WXYZ');
    });

    it('allows viewer_online collaborator to preview (200) while blocking raw /download (403)', async () => {
      const prevRes = await cluster.apiFetch(
        viewerOnlineCollabToken,
        `/api/v1/storage/nodes/${pdfId}/preview`,
      );
      expect(prevRes.status).toBe(200);

      const dlRes = await cluster.apiFetch(
        viewerOnlineCollabToken,
        `/api/v1/storage/nodes/${pdfId}/download`,
      );
      expect(dlRes.status).toBe(403);
    });
  });

  describe('Tier 2 — 416 Range Bounds, ACL/Node/Trash Rejects, XSS Neutralization & Multitenancy', () => {
    it('returns 416 Range Not Satisfiable on out-of-bounds or malformed Range headers', async () => {
      const oob = await cluster.apiFetch(ownerToken, `/api/v1/storage/nodes/${mediaId}/preview`, {
        headers: { Range: 'bytes=9999-10005' },
      });
      expect(oob.status).toBe(416);

      const malformed = await cluster.apiFetch(ownerToken, `/api/v1/storage/nodes/${mediaId}/preview`, {
        headers: { Range: 'bytes=-' },
      });
      expect(malformed.status).toBe(416);
    });

    it('rejects preview (403) when user ACL resolves to none', async () => {
      const secretId = await uploadSample(
        ownerToken,
        cofreId,
        'f17-cofre-secret.txt',
        Buffer.from('TOP_SECRET', 'utf8'),
        'text/plain',
      );
      const res = await cluster.apiFetch(
        viewerOnlineCollabToken,
        `/api/v1/storage/nodes/${secretId}/preview`,
      );
      expect(res.status).toBe(403);
    });

    it('rejects preview on folders (400) and soft-deleted/trashed files (404/410)', async () => {
      const folderPrev = await cluster.apiFetch(
        ownerToken,
        `/api/v1/storage/nodes/${previewFolderId}/preview`,
      );
      expect(folderPrev.status).toBe(400);

      const tempId = await uploadSample(
        ownerToken,
        previewFolderId,
        'f17-trashed.txt',
        Buffer.from('GONE_TO_TRASH', 'utf8'),
        'text/plain',
      );
      expect((await cluster.apiFetch(ownerToken, `/api/v1/storage/nodes/${tempId}`, { method: 'DELETE' })).status).toBe(200);

      const trashedPrev = await cluster.apiFetch(ownerToken, `/api/v1/storage/nodes/${tempId}/preview`);
      expect([404, 410]).toContain(trashedPrev.status);
    });

    it('neutralizes potentially active HTML/SVG preview payloads with nosniff and safe type or sandbox CSP', async () => {
      const svgId = await uploadSample(
        ownerToken,
        previewFolderId,
        'f17-xss.svg',
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'utf8'),
        'image/svg+xml',
      );
      const htmlId = await uploadSample(
        ownerToken,
        previewFolderId,
        'f17-xss.html',
        Buffer.from('<html><body><script>alert(document.cookie)</script></body></html>', 'utf8'),
        'text/html',
      );

      for (const id of [svgId, htmlId]) {
        const res = await cluster.apiFetch(ownerToken, `/api/v1/storage/nodes/${id}/preview`);
        expect(res.status).toBe(200);
        expect((res.headers.get('x-content-type-options') || '').toLowerCase()).toBe('nosniff');
        expect((res.headers.get('cache-control') || '').toLowerCase()).toContain('no-store');
        const ctype = (res.headers.get('content-type') || '').toLowerCase();
        const csp = (res.headers.get('content-security-policy') || '').toLowerCase();
        const isSafeNeutralized =
          ctype.includes('text/plain') ||
          ctype.includes('application/octet-stream') ||
          csp.includes('sandbox') ||
          csp.includes("script-src 'none'");
        expect(isSafeNeutralized).toBe(true);
      }
    });

    it('enforces cross-tenant isolation on /preview (403/404)', async () => {
      const res = await cluster.apiFetch(betaToken, `/api/v1/storage/nodes/${txtId}/preview`);
      expect([403, 404]).toContain(res.status);
    });
  });
});
