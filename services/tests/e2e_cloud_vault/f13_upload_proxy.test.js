// services/tests/e2e_cloud_vault/f13_upload_proxy.test.js
// =============================================================================
// F-13: Advanced Upload & Gateway Binary/Multipart Proxy (Opaque-Box E2E)
// =============================================================================

import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootE2eCluster } from './helpers/clusterHarness.js';
import { startMockAgentNode } from './helpers/mockAgentNode.js';

describe('F-13: Advanced Upload & Gateway Binary/Multipart Proxy', () => {
  let cluster;
  let agent;
  let ownerToken;
  let betaNoConnToken;
  let uploadsFolderId;

  function extractNodesList(res) {
    if (Array.isArray(res.data)) return res.data;
    return res.data?.items || res.data?.nodes || [];
  }

  function sha256(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
  }

  async function uploadMultipart(token, parentId, fileName, buf, { conflictPolicy = 'version', mimeType = 'text/plain' } = {}) {
    const form = new FormData();
    if (parentId) form.append('parentId', parentId);
    form.append('fileName', fileName);
    form.append('conflictPolicy', conflictPolicy);
    form.append('file', new Blob([buf], { type: mimeType }), fileName);
    return cluster.apiFetch(token, '/api/v1/storage/upload', {
      method: 'POST',
      body: form,
    });
  }

  beforeAll(async () => {
    cluster = await bootE2eCluster();
    const owner = await cluster.loginAs('ti@shineraybysabel.com.br', 'Shineray@2026!');
    ownerToken = owner.accessToken;

    betaNoConnToken = cluster.createUserToken({
      sub: 'beta-noconn-owner',
      email: 'owner@beta-noconn.example.com',
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
        label: 'E2E Upload Proxy Node',
        host: parsed.hostname,
        port: Number(parsed.port),
        endpointUrl: agent.url,
        rootPath: '/',
        quotaBytes: 20 * 1024 * 1024,
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
    const corpPublic = roots.find((n) => n.name === 'Corporativo-Publico');
    expect(corpPublic?.id).toBeTruthy();

    const dirRes = await cluster.apiFetch(ownerToken, '/api/v1/storage/folders', {
      method: 'POST',
      body: { parentId: corpPublic.id, name: 'F13-Uploads' },
    });
    expect(dirRes.status).toBe(201);
    uploadsFolderId = (dirRes.data?.node || dirRes.data).id;
  }, 45_000);

  afterAll(async () => {
    try {
      if (agent) await agent.stop();
    } finally {
      if (cluster) await cluster.stop();
    }
  }, 45_000);

  describe('Tier 1 — Multipart, Raw Binary, SHA-256 Dedupe & Conflict Policies', () => {
    it('uploads via multipart/form-data and verifies computed sha256_hash matches uploaded buffer', async () => {
      const payload = Buffer.from('Nexus-F13-Multipart-SHA256-Payload-2026', 'utf8');
      const res = await uploadMultipart(ownerToken, uploadsFolderId, 'f13-multipart.txt', payload);
      expect([200, 201]).toContain(res.status);
      const node = res.data?.node || res.data;
      expect(node.id).toBeTruthy();
      expect(node.sha256_hash ?? node.sha256Hash).toBe(sha256(payload));
      expect(Number(node.size_bytes ?? node.sizeBytes)).toBe(payload.length);
    });

    it('uploads via raw binary passthrough (application/octet-stream) preserving bytes bit-for-bit', async () => {
      const rawBytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x00, 0xff, 0x7f]);
      const res = await cluster.apiFetch(
        ownerToken,
        `/api/v1/storage/upload?parentId=${uploadsFolderId}&fileName=f13-raw.pdf`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/octet-stream' },
          body: rawBytes,
        },
      );
      expect([200, 201]).toContain(res.status);
      const node = res.data?.node || res.data;
      expect(node.id).toBeTruthy();

      const dl = await cluster.apiFetch(ownerToken, `/api/v1/storage/nodes/${node.id}/download`);
      expect(dl.status).toBe(200);
      expect(dl.buffer.equals(rawBytes)).toBe(true);
    });

    it('detects duplicate content by SHA-256 hash when uploading identical bytes under a new filename', async () => {
      const identical = Buffer.from('F13-Identical-Content-Dedupe-Check-998877', 'utf8');
      const first = await uploadMultipart(ownerToken, uploadsFolderId, 'f13-alpha.txt', identical);
      expect([200, 201]).toContain(first.status);

      const second = await uploadMultipart(ownerToken, uploadsFolderId, 'f13-beta.txt', identical);
      expect([200, 201]).toContain(second.status);
      const isDup =
        second.data?.isDuplicate === true ||
        Boolean(second.data?.duplicateOf) ||
        Boolean(second.data?.duplicate);
      expect(isDup).toBe(true);
    });

    it('applies conflictPolicy rename when uploading to an existing filename, preserving both files', async () => {
      const v1 = Buffer.from('REPORT_V1_ORIGINAL', 'utf8');
      const v2 = Buffer.from('REPORT_V2_RENAMED', 'utf8');

      const res1 = await uploadMultipart(ownerToken, uploadsFolderId, 'f13-report.txt', v1, {
        conflictPolicy: 'reject',
      });
      expect([200, 201]).toContain(res1.status);
      const id1 = (res1.data?.node || res1.data).id;

      const res2 = await uploadMultipart(ownerToken, uploadsFolderId, 'f13-report.txt', v2, {
        conflictPolicy: 'rename',
      });
      expect([200, 201]).toContain(res2.status);
      const node2 = res2.data?.node || res2.data;
      expect(node2.id).toBeTruthy();
      expect(node2.id).not.toBe(id1);
      expect(node2.name).not.toBe('f13-report.txt');

      const dl1 = await cluster.apiFetch(ownerToken, `/api/v1/storage/nodes/${id1}/download`);
      const dl2 = await cluster.apiFetch(ownerToken, `/api/v1/storage/nodes/${node2.id}/download`);
      expect(dl1.buffer.equals(v1)).toBe(true);
      expect(dl2.buffer.equals(v2)).toBe(true);
    });

    it('applies conflictPolicy version on overwrite, incrementing current_version and updating content', async () => {
      const v1 = Buffer.from('SPEC_CONTENT_V1', 'utf8');
      const v2 = Buffer.from('SPEC_CONTENT_V2_UPDATED', 'utf8');

      const res1 = await uploadMultipart(ownerToken, uploadsFolderId, 'f13-spec.txt', v1, {
        conflictPolicy: 'version',
      });
      expect([200, 201]).toContain(res1.status);
      const id1 = (res1.data?.node || res1.data).id;

      const res2 = await uploadMultipart(ownerToken, uploadsFolderId, 'f13-spec.txt', v2, {
        conflictPolicy: 'version',
      });
      expect([200, 201]).toContain(res2.status);
      const node2 = res2.data?.node || res2.data;
      expect(node2.id).toBe(id1);
      expect(Number(node2.current_version ?? node2.currentVersion)).toBe(2);

      const dl = await cluster.apiFetch(ownerToken, `/api/v1/storage/nodes/${id1}/download`);
      expect(dl.status).toBe(200);
      expect(dl.buffer.equals(v2)).toBe(true);
    });
  });

  describe('Tier 2 — >4MB Gateway Streaming, Reject Policy, Security & Unconfigured Tenant', () => {
    it('streams >4MB (4.5 MiB) binary upload through api-gateway without hitting 4 MiB bodyLimit', async () => {
      const sizeBytes = Math.floor(4.5 * 1024 * 1024);
      const bigBuf = crypto.randomBytes(sizeBytes);
      const expectedHash = sha256(bigBuf);

      const res = await cluster.apiFetch(
        ownerToken,
        `/api/v1/storage/upload?parentId=${uploadsFolderId}&fileName=f13-large-4_5mb.bin`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/octet-stream' },
          body: bigBuf,
        },
      );
      expect([200, 201]).toContain(res.status);
      const node = res.data?.node || res.data;
      expect(Number(node.size_bytes ?? node.sizeBytes)).toBe(sizeBytes);
      expect(node.sha256_hash ?? node.sha256Hash).toBe(expectedHash);

      const dl = await cluster.apiFetch(ownerToken, `/api/v1/storage/nodes/${node.id}/download`);
      expect(dl.status).toBe(200);
      expect(dl.buffer.length).toBe(sizeBytes);
      expect(sha256(dl.buffer)).toBe(expectedHash);
    }, 30_000);

    it('rejects conflicting filename with 409 when conflictPolicy is reject', async () => {
      const first = await uploadMultipart(ownerToken, uploadsFolderId, 'f13-unique.txt', Buffer.from('FIRST', 'utf8'), {
        conflictPolicy: 'reject',
      });
      expect([200, 201]).toContain(first.status);

      const second = await uploadMultipart(ownerToken, uploadsFolderId, 'f13-unique.txt', Buffer.from('SECOND', 'utf8'), {
        conflictPolicy: 'reject',
      });
      expect(second.status).toBe(409);
    });

    it('rejects disallowed executable MIME/extensions and empty missing-file uploads', async () => {
      const exeRes = await uploadMultipart(
        ownerToken,
        uploadsFolderId,
        'f13-malware.exe',
        Buffer.from('MZ\x90\x00', 'binary'),
        { mimeType: 'application/x-msdownload' },
      );
      expect([400, 415]).toContain(exeRes.status);

      const emptyRes = await cluster.apiFetch(ownerToken, '/api/v1/storage/upload', {
        method: 'POST',
        body: { parentId: uploadsFolderId, fileName: 'no-binary.txt' },
      });
      expect([400, 415]).toContain(emptyRes.status);
    });

    it('blocks path traversal sequences in fileName without writing to mockAgentNode', async () => {
      const logBefore = agent.getRequestLog().length;
      const travRes = await uploadMultipart(
        ownerToken,
        uploadsFolderId,
        '../../etc/cron.d/pwn.txt',
        Buffer.from('EVIL', 'utf8'),
      );
      expect([400, 403]).toContain(travRes.status);

      const encodedTrav = await cluster.apiFetch(
        ownerToken,
        `/api/v1/storage/upload?parentId=${uploadsFolderId}&fileName=${encodeURIComponent('%2e%2e%2fevil.txt')}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/octet-stream' },
          body: Buffer.from('EVIL2', 'utf8'),
        },
      );
      expect([400, 403]).toContain(encodedTrav.status);

      const writesAfter = agent
        .getRequestLog()
        .slice(logBefore)
        .filter((entry) => entry.url.includes('pwn.txt') || entry.url.includes('evil.txt'));
      expect(writesAfter.filter((e) => e.status === 201)).toHaveLength(0);
    });

    it('rejects unauthenticated upload (401) and upload when tenant has no VPS connection (4xx)', async () => {
      const unauth = await uploadMultipart(null, uploadsFolderId, 'f13-unauth.txt', Buffer.from('NOAUTH', 'utf8'));
      expect(unauth.status).toBe(401);

      const noConn = await uploadMultipart(betaNoConnToken, null, 'f13-noconn.txt', Buffer.from('NOCONN', 'utf8'));
      expect(noConn.status).toBeGreaterThanOrEqual(400);
      expect(noConn.status).toBeLessThan(500);
    });
  });
});
