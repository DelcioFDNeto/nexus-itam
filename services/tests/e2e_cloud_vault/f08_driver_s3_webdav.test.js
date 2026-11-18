// services/tests/e2e_cloud_vault/f08_driver_s3_webdav.test.js
// =============================================================================
// F-08: Hybrid Driver — S3 / MinIO / R2 (SigV4) & WebDAV — Opaque-Box Tests
// =============================================================================

import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootE2eCluster } from './helpers/clusterHarness.js';
import { signS3Request, startMockS3Server } from './helpers/mockS3Server.js';
import { assertFullAuditIntegrity } from './helpers/auditHelper.js';

function extractId(payload) {
  return payload?.id ?? payload?.node?.id ?? payload?.data?.id;
}

describe('F-08: Hybrid Driver — S3 / MinIO / R2 (SigV4) & WebDAV', () => {
  let cluster;
  let s3;
  let ownerSession;
  let betaOwnerToken;
  let superadminToken;

  beforeAll(async () => {
    cluster = await bootE2eCluster();
    s3 = await startMockS3Server({
      accessKey: 'nexus-f08-ak',
      secretKey: 'nexus-f08-sk-2026-secret',
      bucket: 'nexus-vault',
      region: 'us-east-1',
      allowWebDav: true,
    });
    ownerSession = await cluster.loginAs('ti@shineraybysabel.com.br', 'Shineray@2026!');
    betaOwnerToken = cluster.createUserToken({
      sub: 'f08-beta-own',
      email: 'owner@beta.example.com',
      role: 'owner',
      tenantId: 'tenant-beta',
      department: 'TI',
    });
    superadminToken = cluster.createUserToken({
      sub: 'f08-sa-master',
      email: 'master@nexus.internal',
      role: 'superadmin',
      tenantId: 'nexus-master',
    });
  }, 45_000);

  afterAll(async () => {
    try {
      if (s3) await s3.stop();
    } finally {
      if (cluster) await cluster.stop();
    }
  }, 45_000);

  async function connectS3(token, overrides = {}) {
    const res = await cluster.apiFetch(token, '/api/v1/storage/connection', {
      method: 'PUT',
      body: {
        providerType: 's3',
        label: 'Mock S3 / MinIO',
        endpointUrl: s3.endpoint,
        bucket: s3.bucket,
        region: s3.region,
        accessKey: s3.accessKey,
        secretKey: s3.secretKey,
        rootPath: '/',
        quotaBytes: 100 * 1024 * 1024,
        ...overrides,
      },
    });
    expect([200, 201]).toContain(res.status);
    return res;
  }

  async function connectWebDav(token, overrides = {}) {
    const res = await cluster.apiFetch(token, '/api/v1/storage/connection', {
      method: 'PUT',
      body: {
        providerType: 'webdav',
        label: 'Mock WebDAV',
        endpointUrl: `${s3.endpoint}/webdav`,
        username: s3.accessKey,
        password: s3.secretKey,
        rootPath: '/',
        quotaBytes: 100 * 1024 * 1024,
        ...overrides,
      },
    });
    expect([200, 201]).toContain(res.status);
    return res;
  }

  describe('Tier 1 — S3 SigV4 & WebDAV Connection, CRUD & Range 206', () => {
    it('T1.1 — configures S3 connection, masks secretKey, and executes SigV4 HeadBucket test', async () => {
      const token = cluster.createUserToken({
        sub: 'f08-t1-own',
        email: 'f08t1@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f08-t1',
      });
      await connectS3(token);

      const getRes = await cluster.apiFetch(token, '/api/v1/storage/connection');
      expect(getRes.status).toBe(200);
      expect(getRes.text).not.toContain(s3.secretKey);

      const beforeLen = s3.getRequestLog().length;
      const testRes = await cluster.apiFetch(token, '/api/v1/storage/connection/test', { method: 'POST' });
      expect(testRes.status).toBe(200);
      expect(testRes.data?.ok).toBe(true);
      expect(testRes.data?.status).toBe('connected');

      const logs = s3.getRequestLog().slice(beforeLen);
      expect(logs.some((l) => l.protocol === 's3' && l.method === 'HEAD' && l.status === 200)).toBe(true);
    });

    it('T1.2 — executes S3 VFS CRUD (PutObject, GetObject SHA-256, CopyObject, Rename, Delete/Purge)', async () => {
      const token = cluster.createUserToken({
        sub: 'f08-t2-own',
        email: 'f08t2@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f08-t2',
      });
      await connectS3(token);

      const folderRes = await cluster.apiFetch(token, '/api/v1/storage/folders', {
        method: 'POST',
        body: { parentId: null, name: 'S3CrudDir' },
      });
      expect(folderRes.status).toBe(201);
      const folderId = extractId(folderRes.data);

      const payload = Buffer.from('S3-SIGV4-OBJECT-PAYLOAD-2026', 'utf8');
      const expectedSha = crypto.createHash('sha256').update(payload).digest('hex');

      const form = new FormData();
      form.append('parentId', folderId);
      form.append('fileName', 's3-obj.txt');
      form.append('file', new Blob([payload], { type: 'text/plain' }), 's3-obj.txt');
      const upRes = await cluster.apiFetch(token, '/api/v1/storage/upload', { method: 'POST', body: form });
      expect(upRes.status).toBe(201);
      const fileId = extractId(upRes.data);

      expect(Object.keys(s3.getObjects()).some((k) => k.includes('s3-obj.txt'))).toBe(true);

      const dlRes = await cluster.apiFetch(token, `/api/v1/storage/nodes/${fileId}/download`);
      expect(dlRes.status).toBe(200);
      expect(crypto.createHash('sha256').update(dlRes.buffer).digest('hex')).toBe(expectedSha);

      const copyRes = await cluster.apiFetch(token, `/api/v1/storage/nodes/${fileId}/copy`, {
        method: 'POST',
        body: { targetParentId: folderId, name: 's3-copy.txt' },
      });
      expect([200, 201]).toContain(copyRes.status);
      const copyId = extractId(copyRes.data);
      expect(Object.keys(s3.getObjects()).some((k) => k.includes('s3-copy.txt'))).toBe(true);

      await cluster.apiFetch(token, `/api/v1/storage/nodes/${copyId}`, { method: 'DELETE' });
      const purgeRes = await cluster.apiFetch(token, `/api/v1/storage/trash/${copyId}`, { method: 'DELETE' });
      expect([200, 204]).toContain(purgeRes.status);
    });

    it('T1.3 — streams S3 Range: bytes=6-15 as 206 Partial Content with inline headers', async () => {
      const token = cluster.createUserToken({
        sub: 'f08-t3-own',
        email: 'f08t3@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f08-t3',
      });
      await connectS3(token);

      const body = '0123456789ABCDEFGHIJKL'; // 22 bytes
      const form = new FormData();
      form.append('fileName', 's3-range.txt');
      form.append('file', new Blob([body], { type: 'text/plain' }), 's3-range.txt');
      const upRes = await cluster.apiFetch(token, '/api/v1/storage/upload', { method: 'POST', body: form });
      expect(upRes.status).toBe(201);
      const fileId = extractId(upRes.data);

      const prevRes = await cluster.apiFetch(token, `/api/v1/storage/nodes/${fileId}/preview`, {
        headers: { Range: 'bytes=6-15' },
      });
      expect(prevRes.status).toBe(206);
      expect(prevRes.headers.get('content-range')).toBe('bytes 6-15/22');
      expect(prevRes.headers.get('accept-ranges')).toBe('bytes');
      expect(prevRes.headers.get('content-disposition')).toContain('inline');
      expect(prevRes.headers.get('cache-control')).toContain('no-store');
      expect(prevRes.text).toBe('6789ABCDEF');
    });

    it('T1.4 — configures WebDAV connection, masks password, and passes OPTIONS/PROPFIND connection/test', async () => {
      const token = cluster.createUserToken({
        sub: 'f08-t4-own',
        email: 'f08t4@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f08-t4',
      });
      await connectWebDav(token);

      const getRes = await cluster.apiFetch(token, '/api/v1/storage/connection');
      expect(getRes.status).toBe(200);
      expect(getRes.text).not.toContain(s3.secretKey);

      const beforeLen = s3.getRequestLog().length;
      const testRes = await cluster.apiFetch(token, '/api/v1/storage/connection/test', { method: 'POST' });
      expect(testRes.status).toBe(200);
      expect(testRes.data?.ok).toBe(true);
      expect(testRes.data?.status).toBe('connected');

      const logs = s3.getRequestLog().slice(beforeLen);
      expect(logs.some((l) => l.protocol === 'webdav' && [200, 207].includes(l.status))).toBe(true);
    });

    it('T1.5 — executes WebDAV full CRUD lifecycle (MKCOL, PUT, GET, MOVE, COPY, DELETE)', async () => {
      const token = cluster.createUserToken({
        sub: 'f08-t5-own',
        email: 'f08t5@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f08-t5',
      });
      await connectWebDav(token);

      const folderRes = await cluster.apiFetch(token, '/api/v1/storage/folders', {
        method: 'POST',
        body: { parentId: null, name: 'DavCrudDir' },
      });
      expect(folderRes.status).toBe(201);
      const folderId = extractId(folderRes.data);

      const payload = Buffer.from('WEBDAV-CRUD-PAYLOAD-2026', 'utf8');
      const form = new FormData();
      form.append('parentId', folderId);
      form.append('fileName', 'dav-file.txt');
      form.append('file', new Blob([payload], { type: 'text/plain' }), 'dav-file.txt');
      const upRes = await cluster.apiFetch(token, '/api/v1/storage/upload', { method: 'POST', body: form });
      expect(upRes.status).toBe(201);
      const fileId = extractId(upRes.data);

      const dlRes = await cluster.apiFetch(token, `/api/v1/storage/nodes/${fileId}/download`);
      expect(dlRes.status).toBe(200);
      expect(dlRes.buffer.equals(payload)).toBe(true);

      const copyRes = await cluster.apiFetch(token, `/api/v1/storage/nodes/${fileId}/copy`, {
        method: 'POST',
        body: { targetParentId: folderId, name: 'dav-copy.txt' },
      });
      expect([200, 201]).toContain(copyRes.status);
      const copyId = extractId(copyRes.data);

      const renRes = await cluster.apiFetch(token, `/api/v1/storage/nodes/${copyId}`, {
        method: 'PATCH',
        body: { name: 'dav-moved.txt' },
      });
      expect(renRes.status).toBe(200);

      await cluster.apiFetch(token, `/api/v1/storage/nodes/${copyId}`, { method: 'DELETE' });
      await cluster.apiFetch(token, `/api/v1/storage/trash/${copyId}`, { method: 'DELETE' });

      const davLogs = s3.getRequestLog().filter((l) => l.protocol === 'webdav');
      expect(davLogs.some((l) => ['PUT', 'MKCOL'].includes(l.method))).toBe(true);
      expect(davLogs.some((l) => l.method === 'GET' && l.status === 200)).toBe(true);
      expect(davLogs.some((l) => ['MOVE', 'COPY', 'DELETE'].includes(l.method))).toBe(true);
    });
  });

  describe('Tier 2 — SigV4/WebDAV Errors, Range 416, Plan Gate & Tenant Isolation', () => {
    it('T2.1 — rejects invalid S3 secretKey (403 SignatureDoesNotMatch) cleanly on connection/test', async () => {
      const token = cluster.createUserToken({
        sub: 'f08-t6-own',
        email: 'f08t6@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f08-badsig',
      });
      const wrongSecret = 'wrong-s3-secret-f08';
      await connectS3(token, { secretKey: wrongSecret });

      const beforeLen = s3.getRequestLog().length;
      const testRes = await cluster.apiFetch(token, '/api/v1/storage/connection/test', { method: 'POST' });
      expect([200, 422]).toContain(testRes.status);
      expect(testRes.data?.ok).toBe(false);
      expect(testRes.data?.status).toBe('error');
      expect(testRes.text).not.toContain(wrongSecret);

      const logs = s3.getRequestLog().slice(beforeLen);
      expect(logs.some((l) => l.protocol === 's3' && l.status === 403 && l.errorCode === 'SignatureDoesNotMatch')).toBe(
        true,
      );
    });

    it('T2.2 — diagnoses missing S3 bucket (NoSuchBucket 404) and persists error state', async () => {
      const token = cluster.createUserToken({
        sub: 'f08-t7-own',
        email: 'f08t7@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f08-nobucket',
      });
      await connectS3(token, { bucket: 'non-existent-bucket-f08' });

      const beforeLen = s3.getRequestLog().length;
      const testRes = await cluster.apiFetch(token, '/api/v1/storage/connection/test', { method: 'POST' });
      expect([200, 422]).toContain(testRes.status);
      expect(testRes.data?.ok).toBe(false);
      expect(testRes.data?.status).toBe('error');

      const logs = s3.getRequestLog().slice(beforeLen);
      expect(logs.some((l) => l.status === 404 && l.errorCode === 'NoSuchBucket')).toBe(true);

      const getConn = await cluster.apiFetch(token, '/api/v1/storage/connection');
      expect(getConn.status).toBe(200);
      expect((getConn.data?.connection || getConn.data)?.status).toBe('error');
    });

    it('T2.3 — handles WebDAV 401 auth failure and prevents phantom node persistence on failed upload', async () => {
      const token = cluster.createUserToken({
        sub: 'f08-t8-own',
        email: 'f08t8@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f08-badwebdav',
      });
      const wrongPass = 'wrong-dav-pass-f08';
      await connectWebDav(token, { password: wrongPass });

      const beforeLen = s3.getRequestLog().length;
      const testRes = await cluster.apiFetch(token, '/api/v1/storage/connection/test', { method: 'POST' });
      expect([200, 422]).toContain(testRes.status);
      expect(testRes.data?.ok).toBe(false);
      expect(s3.getRequestLog().slice(beforeLen).some((l) => l.protocol === 'webdav' && l.status === 401)).toBe(true);

      const form = new FormData();
      form.append('fileName', 'phantom.txt');
      form.append('file', new Blob(['should-fail'], { type: 'text/plain' }), 'phantom.txt');
      const upRes = await cluster.apiFetch(token, '/api/v1/storage/upload', { method: 'POST', body: form });
      expect(upRes.ok).toBe(false);

      const listRes = await cluster.apiFetch(token, '/api/v1/storage/nodes');
      expect(listRes.status).toBe(200);
      const items = listRes.data?.items || listRes.data?.nodes || [];
      expect(items.some((n) => n.name === 'phantom.txt')).toBe(false);
    });

    it('T2.4 — handles S3 Range 416, superadmin 403, and starter plan 403 gate', async () => {
      await connectS3(ownerSession.accessToken);
      const form = new FormData();
      form.append('fileName', 's3-gate.txt');
      form.append('file', new Blob(['short-body'], { type: 'text/plain' }), 's3-gate.txt');
      const upRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/upload', {
        method: 'POST',
        body: form,
      });
      expect(upRes.status).toBe(201);
      const fileId = extractId(upRes.data);

      const badRange = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/nodes/${fileId}/preview`, {
        headers: { Range: 'bytes=99999-' },
      });
      expect(badRange.status).toBe(416);

      const saConn = await cluster.apiFetch(superadminToken, '/api/v1/storage/connection');
      expect(saConn.status).toBe(403);

      try {
        await cluster.setTenantPlan(ownerSession.accessToken, {
          plan: 'starter',
          overrides: { features: { cloud_storage: false } },
        });
        const gatedRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/connection');
        expect(gatedRes.status).toBe(403);
      } finally {
        await cluster.setTenantPlan(ownerSession.accessToken, {
          plan: 'enterprise',
          overrides: {},
        });
      }
    });

    it('T2.5 — isolates S3 buckets/objects across tenants and preserves SHA-256 compliance chain', async () => {
      await connectS3(ownerSession.accessToken);
      const form = new FormData();
      form.append('fileName', 's3-alpha-only.txt');
      form.append('file', new Blob(['alpha-s3-data'], { type: 'text/plain' }), 's3-alpha-only.txt');
      const upRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/upload', {
        method: 'POST',
        body: form,
      });
      expect(upRes.status).toBe(201);
      const fileId = extractId(upRes.data);

      // Create dedicated beta-bucket on mockS3Server via SigV4 PutBucket
      const betaBucketUrl = `${s3.endpoint}/beta-bucket`;
      const signedPut = signS3Request({
        method: 'PUT',
        url: betaBucketUrl,
        accessKey: s3.accessKey,
        secretKey: s3.secretKey,
        region: s3.region,
      });
      const putBucketRes = await fetch(betaBucketUrl, { method: 'PUT', headers: signedPut });
      expect(putBucketRes.status).toBe(200);

      await connectS3(betaOwnerToken, { bucket: 'beta-bucket' });

      const crossDl = await cluster.apiFetch(betaOwnerToken, `/api/v1/storage/nodes/${fileId}/download`);
      expect([403, 404]).toContain(crossDl.status);

      const integrity = await assertFullAuditIntegrity(cluster.apiFetch, ownerSession.accessToken);
      expect(integrity.apiResult.intact).toBe(true);
      expect(integrity.localResult.valid).toBe(true);
    });
  });
});
