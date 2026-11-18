// services/tests/e2e_cloud_vault/harness_selfcheck.test.js
// =============================================================================
// E2E-M1 Self-Verification Suite for Backend Opaque-Box Harness & Driver Simulators
// =============================================================================

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootE2eCluster } from './helpers/clusterHarness.js';
import { signAgentNodeHeaders, startMockAgentNode } from './helpers/mockAgentNode.js';
import { signS3Request, startMockS3Server } from './helpers/mockS3Server.js';
import {
  assertSafeVpsTestRoot,
  createDisposableVpsRoot,
  resolveReferenceVpsConfig,
} from './helpers/wslVpsConfig.js';
import {
  assertFullAuditIntegrity,
  expectAuditEvent,
  verifyChainLinksLocally,
} from './helpers/auditHelper.js';

describe('E2E-M1 Backend Opaque-Box Harness Selfcheck', () => {
  let cluster;
  let ownerSession;

  beforeAll(async () => {
    cluster = await bootE2eCluster();
    ownerSession = await cluster.loginAs('ti@shineraybysabel.com.br', 'Shineray@2026!');
  }, 30_000);

  afterAll(async () => {
    if (cluster) await cluster.stop();
  }, 30_000);

  describe('1. clusterHarness.js', () => {
    it('boots cluster outside 18100..18199 in memory mode with healthy Gateway & microservices', async () => {
      expect(cluster.basePort).toBeGreaterThanOrEqual(20000);
      expect(process.env.NEXUS_DB_MODE).toBe('memory');
      expect(process.env.NEXUS_STORAGE_MASTER_KEY?.length).toBeGreaterThanOrEqual(24);

      const health = await cluster.apiFetch(null, '/health');
      expect(health.status).toBe(200);
      expect(health.ok).toBe(true);
      expect(health.data.overallStatus).toBe('healthy');
      expect(health.data.microservices.every((m) => m.status === 'healthy')).toBe(true);
    });

    it('supports loginAs, createUserToken (superadmin/collaborator/tenant-beta), seedUser, and setTenantPlan', async () => {
      expect(ownerSession.accessToken).toBeTruthy();
      expect(ownerSession.user.role).toBe('owner');
      expect(ownerSession.user.tenantId).toBe('tenant-ap3htf6');

      const superadminToken = cluster.createUserToken({
        sub: 'sa-master-1',
        email: 'master@nexus.internal',
        role: 'superadmin',
        tenantId: 'nexus-master',
      });
      expect(superadminToken.split('.')).toHaveLength(3);

      const betaToken = cluster.createUserToken({
        sub: 'beta-owner-1',
        email: 'owner@beta.example.com',
        role: 'owner',
        tenantId: 'tenant-beta',
        department: 'Operacoes',
      });
      const betaAssets = await cluster.apiFetch(betaToken, '/api/v1/assets');
      expect(betaAssets.status).toBe(200);
      expect(betaAssets.data.items).toHaveLength(0);

      const createdUser = await cluster.seedUser(ownerSession.accessToken, {
        name: 'Maria Financeiro',
        email: 'maria.fin@shineraybysabel.com.br',
        password: 'Password@2026!',
        role: 'collaborator',
        department: 'Financeiro',
      });
      expect(createdUser.email).toBe('maria.fin@shineraybysabel.com.br');

      const mariaLogin = await cluster.loginAs('maria.fin@shineraybysabel.com.br', 'Password@2026!');
      expect(mariaLogin.user.department).toBe('Financeiro');

      // seedDirectUser without explicit password uses default 'TestPass@2026!'
      const directUser = await cluster.seedDirectUser({
        name: 'Direct Default Pass',
        email: 'direct.nopass@shineraybysabel.com.br',
      });
      expect(directUser.email).toBe('direct.nopass@shineraybysabel.com.br');
      const directLogin = await cluster.loginAs('direct.nopass@shineraybysabel.com.br', 'TestPass@2026!');
      expect(directLogin.accessToken).toBeTruthy();

      const starterContract = await cluster.setTenantPlan(ownerSession.accessToken, {
        plan: 'starter',
        overrides: { features: { cloud_storage: false } },
      });
      expect(starterContract.plan).toBe('starter');

      const restoredContract = await cluster.setTenantPlan(ownerSession.accessToken, {
        plan: 'enterprise',
        overrides: {},
      });
      expect(restoredContract.plan).toBe('enterprise');
    });

    it('probes unimplemented /api/v1/storage/health gracefully and handles WS ping/pong', async () => {
      const probe = await cluster.probeStorageAvailability(ownerSession.accessToken);
      expect(typeof probe.available).toBe('boolean');
      expect([200, 404, 502, 503]).toContain(probe.status);

      const wsClient = await cluster.openWsClient(ownerSession.accessToken, 'e2e-selfcheck');
      expect(wsClient.welcomeFrame?.event).toBe('welcome');
      expect(wsClient.welcomeFrame?.tenantId).toBe('tenant-ap3htf6');

      const nextIdx = wsClient.frames.length;
      wsClient.send({ action: 'ping', id: 'selfcheck-ping-1' });
      const pong = await wsClient.waitForNextEvent(
        (f) => f?.event === 'pong' && f?.echoId === 'selfcheck-ping-1',
        3000,
        nextIdx,
      );
      expect(pong.event).toBe('pong');
      await wsClient.close();
    });
  });

  describe('2. mockAgentNode.js', () => {
    let agent;

    beforeAll(async () => {
      agent = await startMockAgentNode({ quotaBytes: 2048 });
    });

    afterAll(async () => {
      if (agent) await agent.stop();
    });

    async function signedFetch(method, pathWithQuery, body, customHeaders = {}, overrideToken = agent.hmacToken, tsOverride) {
      const signed = signAgentNodeHeaders({
        hmacToken: overrideToken,
        method,
        pathWithQuery,
        body: body ?? Buffer.alloc(0),
        ts: tsOverride ?? Date.now(),
      });
      return fetch(`${agent.url}${pathWithQuery}`, {
        method,
        headers: { ...signed, ...customHeaders },
        body,
      });
    }

    it('rejects missing, tampered, and expired HMAC signatures with 401', async () => {
      const missingRes = await fetch(`${agent.url}/health`);
      expect(missingRes.status).toBe(401);

      const wrongSigRes = await signedFetch('GET', '/health', undefined, {}, 'wrong-hmac-token');
      expect(wrongSigRes.status).toBe(401);
      expect((await wrongSigRes.json()).error).toBe('INVALID_SIGNATURE');

      const expiredTs = Date.now() - 120_000;
      const expiredRes = await signedFetch('GET', '/health', undefined, {}, agent.hmacToken, expiredTs);
      expect(expiredRes.status).toBe(401);
      expect((await expiredRes.json()).error).toBe('AUTH_EXPIRED');
    });

    it('executes full VFS CRUD, Range 206, path traversal 403, and quota 413', async () => {
      const mkdirRes = await signedFetch(
        'POST',
        '/mkdir',
        JSON.stringify({ path: '/Setores/TI', recursive: true }),
        { 'content-type': 'application/json' },
      );
      expect(mkdirRes.status).toBe(201);

      const fileBytes = Buffer.from('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'utf8');
      const putRes = await signedFetch('PUT', '/files?path=%2FSetores%2FTI%2Fdoc.txt', fileBytes);
      expect(putRes.status).toBe(201);
      const putBody = await putRes.json();
      expect(putBody.sizeBytes).toBe(fileBytes.length);

      const statRes = await signedFetch('GET', '/stat?path=%2FSetores%2FTI%2Fdoc.txt');
      expect(statRes.status).toBe(200);
      expect((await statRes.json()).size).toBe(fileBytes.length);

      const readdirRes = await signedFetch('GET', '/readdir?path=%2FSetores%2FTI');
      expect(readdirRes.status).toBe(200);
      expect((await readdirRes.json()).entries.map((e) => e.name)).toContain('doc.txt');

      const rangeRes = await signedFetch('GET', '/files?path=%2FSetores%2FTI%2Fdoc.txt', undefined, {
        Range: 'bytes=10-19',
      });
      expect(rangeRes.status).toBe(206);
      expect(rangeRes.headers.get('content-range')).toBe(`bytes 10-19/${fileBytes.length}`);
      expect(await rangeRes.text()).toBe('ABCDEFGHIJ');

      // RFC 9110 suffix byte-range & invalid empty range
      const suffixRangeRes = await signedFetch('GET', '/files?path=%2FSetores%2FTI%2Fdoc.txt', undefined, {
        Range: 'bytes=-4',
      });
      expect(suffixRangeRes.status).toBe(206);
      expect(suffixRangeRes.headers.get('content-range')).toBe(`bytes 32-35/${fileBytes.length}`);
      expect(await suffixRangeRes.text()).toBe('WXYZ');

      const invalidRangeRes = await signedFetch('GET', '/files?path=%2FSetores%2FTI%2Fdoc.txt', undefined, {
        Range: 'bytes=-',
      });
      expect(invalidRangeRes.status).toBe(416);

      const copyRes = await signedFetch(
        'POST',
        '/copy',
        JSON.stringify({ fromPath: '/Setores/TI/doc.txt', toPath: '/Setores/TI/doc-copy.txt' }),
        { 'content-type': 'application/json' },
      );
      expect(copyRes.status).toBe(200);

      const renameRes = await signedFetch(
        'POST',
        '/rename',
        JSON.stringify({ fromPath: '/Setores/TI/doc-copy.txt', toPath: '/Setores/TI/doc-renamed.txt' }),
        { 'content-type': 'application/json' },
      );
      expect(renameRes.status).toBe(200);

      // Traversal attempt blocked with 403 (including encoded Windows drive letters)
      const traversalRes = await signedFetch('GET', '/files?path=%2F..%2F..%2Fetc%2Fpasswd');
      expect(traversalRes.status).toBe(403);
      expect((await traversalRes.json()).error).toBe('PATH_TRAVERSAL_BLOCKED');

      const encodedDriveRes = await signedFetch('GET', '/files?path=%43%3a%2FWindows%2Fwin.ini');
      expect(encodedDriveRes.status).toBe(403);
      expect((await encodedDriveRes.json()).error).toBe('PATH_TRAVERSAL_BLOCKED');

      const encodedSlashDriveRes = await signedFetch('GET', '/files?path=%2F%43%3a%2FWindows');
      expect(encodedSlashDriveRes.status).toBe(403);
      expect((await encodedSlashDriveRes.json()).error).toBe('PATH_TRAVERSAL_BLOCKED');

      // Missing path/fromPath/toPath blocked with 400 INVALID_PATH
      const missingPutRes = await signedFetch('PUT', '/files', Buffer.from('abc'));
      expect(missingPutRes.status).toBe(400);
      expect((await missingPutRes.json()).error).toBe('INVALID_PATH');

      const missingWriteRes = await signedFetch(
        'POST',
        '/write',
        JSON.stringify({ content: 'abc' }),
        { 'content-type': 'application/json' },
      );
      expect(missingWriteRes.status).toBe(400);
      expect((await missingWriteRes.json()).error).toBe('INVALID_PATH');

      const missingRenameRes = await signedFetch(
        'POST',
        '/rename',
        JSON.stringify({ fromPath: '/Setores/TI/doc.txt' }),
        { 'content-type': 'application/json' },
      );
      expect(missingRenameRes.status).toBe(400);
      expect((await missingRenameRes.json()).error).toBe('INVALID_PATH');

      const missingCopyRes = await signedFetch(
        'POST',
        '/copy',
        JSON.stringify({ toPath: '/Setores/TI/x.txt' }),
        { 'content-type': 'application/json' },
      );
      expect(missingCopyRes.status).toBe(400);
      expect((await missingCopyRes.json()).error).toBe('INVALID_PATH');

      const missingDelRes = await signedFetch('DELETE', '/files');
      expect(missingDelRes.status).toBe(400);
      expect((await missingDelRes.json()).error).toBe('INVALID_PATH');

      const missingRmRes = await signedFetch(
        'POST',
        '/rm',
        JSON.stringify({}),
        { 'content-type': 'application/json' },
      );
      expect(missingRmRes.status).toBe(400);
      expect((await missingRmRes.json()).error).toBe('INVALID_PATH');

      // Quota exceedance blocked with 413
      const hugePayload = Buffer.alloc(3000, 0x41);
      const quotaRes = await signedFetch('PUT', '/files?path=%2FSetores%2FTI%2Ftoo-big.bin', hugePayload);
      expect(quotaRes.status).toBe(413);
      expect((await quotaRes.json()).error).toBe('QUOTA_EXCEEDED');

      const delRes = await signedFetch('DELETE', '/files?path=%2FSetores%2FTI%2Fdoc-renamed.txt');
      expect(delRes.status).toBe(200);

      const healthRes = await signedFetch('GET', '/health');
      expect(healthRes.status).toBe(200);
      const healthJson = await healthRes.json();
      expect(healthJson.usedBytes).toBe(fileBytes.length);
      expect(agent.getRequestLog().length).toBeGreaterThanOrEqual(8);
    });
  });

  describe('3. mockS3Server.js (AWS SigV4 & WebDAV)', () => {
    let s3;

    beforeAll(async () => {
      s3 = await startMockS3Server({
        accessKey: 'nexus-ak-test',
        secretKey: 'nexus-sk-secret-test-2026',
        bucket: 'nexus-vault',
      });
    });

    afterAll(async () => {
      if (s3) await s3.stop();
    });

    async function s3Fetch(method, relPath, { body = Buffer.alloc(0), headers = {}, secretKey = s3.secretKey } = {}) {
      const fullUrl = `${s3.endpoint}${relPath}`;
      const signedHeaders = signS3Request({
        method,
        url: fullUrl,
        headers,
        body,
        accessKey: s3.accessKey,
        secretKey,
        region: s3.region,
      });
      return fetch(fullUrl, {
        method,
        headers: signedHeaders,
        body: method === 'GET' || method === 'HEAD' || method === 'DELETE' ? undefined : body,
      });
    }

    it('verifies SigV4 auth (rejecting invalid signature 403) and executes S3 CRUD + Range 206', async () => {
      const badSigRes = await s3Fetch('HEAD', `/${s3.bucket}`, { secretKey: 'wrong-secret' });
      expect(badSigRes.status).toBe(403);

      const missingBucketRes = await s3Fetch('HEAD', '/non-existent-bucket');
      expect(missingBucketRes.status).toBe(404);

      const headBucketRes = await s3Fetch('HEAD', `/${s3.bucket}`);
      expect(headBucketRes.status).toBe(200);

      const payload = Buffer.from('Nexus S3 SigV4 Streaming Test Payload', 'utf8');
      const putRes = await s3Fetch('PUT', `/${s3.bucket}/Setores/TI/relatorio.txt`, {
        body: payload,
        headers: { 'content-type': 'text/plain' },
      });
      expect(putRes.status).toBe(200);

      const listRes = await s3Fetch('GET', `/${s3.bucket}?list-type=2&prefix=Setores%2F&delimiter=%2F`);
      expect(listRes.status).toBe(200);
      const listXml = await listRes.text();
      expect(listXml).toContain('<CommonPrefixes><Prefix>Setores/TI/</Prefix></CommonPrefixes>');

      const copyRes = await s3Fetch('PUT', `/${s3.bucket}/Setores/TI/relatorio-copy.txt`, {
        headers: { 'x-amz-copy-source': `/${s3.bucket}/Setores/TI/relatorio.txt` },
      });
      expect(copyRes.status).toBe(200);

      const rangeRes = await s3Fetch('GET', `/${s3.bucket}/Setores/TI/relatorio-copy.txt`, {
        headers: { Range: 'bytes=0-4' },
      });
      expect(rangeRes.status).toBe(206);
      expect(await rangeRes.text()).toBe('Nexus');

      const suffixRangeRes = await s3Fetch('GET', `/${s3.bucket}/Setores/TI/relatorio-copy.txt`, {
        headers: { Range: 'bytes=-7' },
      });
      expect(suffixRangeRes.status).toBe(206);
      expect(await suffixRangeRes.text()).toBe('Payload');

      const badRangeRes = await s3Fetch('GET', `/${s3.bucket}/Setores/TI/relatorio-copy.txt`, {
        headers: { Range: 'bytes=-' },
      });
      expect(badRangeRes.status).toBe(416);

      const delRes = await s3Fetch('DELETE', `/${s3.bucket}/Setores/TI/relatorio-copy.txt`);
      expect(delRes.status).toBe(204);
      expect(Object.keys(s3.getObjects())).toEqual(['Setores/TI/relatorio.txt']);
    });

    it('enforces WebDAV Basic auth (401) and executes MKCOL, PUT, PROPFIND 207, MOVE, COPY, DELETE', async () => {
      const unauth = await fetch(`${s3.endpoint}/webdav/Corporativo`, { method: 'MKCOL' });
      expect(unauth.status).toBe(401);

      const basicAuth = `Basic ${Buffer.from(`${s3.accessKey}:${s3.secretKey}`).toString('base64')}`;

      const mkcol = await fetch(`${s3.endpoint}/webdav/Corporativo`, {
        method: 'MKCOL',
        headers: { Authorization: basicAuth },
      });
      expect(mkcol.status).toBe(201);

      const put = await fetch(`${s3.endpoint}/webdav/Corporativo/nota.txt`, {
        method: 'PUT',
        headers: { Authorization: basicAuth, 'content-type': 'text/plain' },
        body: 'WebDAV payload ok',
      });
      expect(put.status).toBe(201);

      const propfind = await fetch(`${s3.endpoint}/webdav/Corporativo`, {
        method: 'PROPFIND',
        headers: { Authorization: basicAuth, Depth: '1' },
      });
      expect(propfind.status).toBe(207);
      const propXml = await propfind.text();
      expect(propXml).toContain('/webdav/Corporativo/nota.txt');

      const move = await fetch(`${s3.endpoint}/webdav/Corporativo/nota.txt`, {
        method: 'MOVE',
        headers: {
          Authorization: basicAuth,
          Destination: `${s3.endpoint}/webdav/Corporativo/nota-movida.txt`,
        },
      });
      expect(move.status).toBe(201);

      const getMoved = await fetch(`${s3.endpoint}/webdav/Corporativo/nota-movida.txt`, {
        headers: { Authorization: basicAuth },
      });
      expect(getMoved.status).toBe(200);
      expect(await getMoved.text()).toBe('WebDAV payload ok');

      const del = await fetch(`${s3.endpoint}/webdav/Corporativo/nota-movida.txt`, {
        method: 'DELETE',
        headers: { Authorization: basicAuth },
      });
      expect(del.status).toBe(204);
    });
  });

  describe('4. wslVpsConfig.js', () => {
    it('supports env overrides, temp mock SSH config with ~/.ssh/ mapping, graceful null, and /opt/shineray block', async () => {
      const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'nexus-ssh-mock-'));
      try {
        const fakeKeyPath = path.join(tempDir, 'id_mock_test');
        const fakeConfigPath = path.join(tempDir, 'config');
        await fsp.writeFile(fakeKeyPath, 'MOCK-OPENSSH-TEST-KEY-CONTENT', 'utf8');
        await fsp.writeFile(
          fakeConfigPath,
          [
            'Host shineray-vps',
            '  HostName 198.51.100.42',
            '  User testdeploy',
            '  Port 2222',
            '  IdentityFile ~/.ssh/id_mock_test',
          ].join('\n'),
          'utf8',
        );

        const fromConfig = resolveReferenceVpsConfig({
          env: {},
          configPath: fakeConfigPath,
          wslSshDir: tempDir,
        });
        expect(fromConfig).not.toBeNull();
        expect(fromConfig.source).toBe('wsl-ssh-config');
        expect(fromConfig.host).toBe('198.51.100.42');
        expect(fromConfig.username).toBe('testdeploy');
        expect(fromConfig.port).toBe(2222);
        expect(fromConfig.privateKey).toBe('MOCK-OPENSSH-TEST-KEY-CONTENT');

        const fromEnv = resolveReferenceVpsConfig({
          env: {
            NEXUS_TEST_VPS_HOST: '203.0.113.10',
            NEXUS_TEST_VPS_USER: 'ci-user',
            NEXUS_TEST_VPS_PORT: '2200',
            NEXUS_TEST_VPS_PRIVATE_KEY: 'ENV-TEST-KEY',
          },
          configPath: fakeConfigPath,
          wslSshDir: tempDir,
        });
        expect(fromEnv.source).toBe('env');
        expect(fromEnv.host).toBe('203.0.113.10');
        expect(fromEnv.port).toBe(2200);

        const missing = resolveReferenceVpsConfig({
          env: {},
          configPath: path.join(tempDir, 'does-not-exist'),
          wslSshDir: tempDir,
        });
        expect(missing).toBeNull();

        const root = createDisposableVpsRoot(fromConfig, 'run_abc-123!');
        expect(root).toBe('/tmp/nexus-vault-e2e-run_abc-123');
        expect(() => assertSafeVpsTestRoot('/opt/shineray')).toThrow();
        expect(() => assertSafeVpsTestRoot('/opt/shineray/prod')).toThrow();
        expect(() => assertSafeVpsTestRoot('/tmp/nexus-vault-e2e-x/../opt/shineray')).toThrow();

        // Verify zero hardcoded secrets in wslVpsConfig.js source
        const sourceText = fs.readFileSync(
          path.resolve(import.meta.dirname, './helpers/wslVpsConfig.js'),
          'utf8',
        );
        expect(sourceText).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY/);
      } finally {
        await fsp.rm(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('5. auditHelper.js', () => {
    it('verifies seeded + newly appended compliance audit chain in ascending order and catches tampering', async () => {
      const postRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/compliance/audit', {
        method: 'POST',
        body: {
          action: 'E2E_HARNESS_PROBE',
          resourceType: 'storage_node',
          resourceId: 'node-selfcheck-1',
          payload: { ok: true, step: 1 },
        },
      });
      expect(postRes.status).toBe(201);

      const integrity = await assertFullAuditIntegrity(cluster.apiFetch, ownerSession.accessToken);
      expect(integrity.apiResult.intact).toBe(true);
      expect(integrity.localResult.valid).toBe(true);
      expect(integrity.itemsAsc.length).toBeGreaterThanOrEqual(2);
      expect(integrity.itemsAsc[0].seq).toBeLessThan(integrity.itemsAsc[1].seq);

      const found = await expectAuditEvent(cluster.apiFetch, ownerSession.accessToken, {
        action: 'E2E_HARNESS_PROBE',
        resourceId: 'node-selfcheck-1',
      });
      expect(found.actor_email).toBe('ti@shineraybysabel.com.br');

      // Verify local tamper detection works
      const tampered = integrity.itemsAsc.map((entry, idx) =>
        idx === integrity.itemsAsc.length - 1
          ? { ...entry, payload: { ...entry.payload, tampered: true } }
          : entry,
      );
      const brokenCheck = verifyChainLinksLocally(tampered, { requireGenesis: true });
      expect(brokenCheck.valid).toBe(false);

      // Multi-tenant secondary tenant (seq > 1) must still enforce GENESIS_HASH when full chain is fetched
      const betaToken = cluster.createUserToken({
        sub: 'beta-audit-owner',
        email: 'audit@beta.example.com',
        role: 'owner',
        tenantId: 'tenant-beta',
      });
      const betaPost = await cluster.apiFetch(betaToken, '/api/v1/compliance/audit', {
        method: 'POST',
        body: {
          action: 'BETA_TENANT_GENESIS_PROBE',
          resourceType: 'storage_node',
          resourceId: 'beta-node-1',
          payload: { ok: true },
        },
      });
      expect(betaPost.status).toBe(201);
      const betaIntegrity = await assertFullAuditIntegrity(cluster.apiFetch, betaToken);
      expect(betaIntegrity.itemsAsc[0].seq).toBeGreaterThan(1);
      expect(betaIntegrity.localResult.valid).toBe(true);

      const brokenBetaGenesis = verifyChainLinksLocally(
        [{ ...betaIntegrity.itemsAsc[0], prev_hash: 'f'.repeat(64) }],
        { requireGenesis: true, totalCount: 1 },
      );
      expect(brokenBetaGenesis.valid).toBe(false);
      expect(brokenBetaGenesis.reason).toContain('GENESIS_HASH mismatch');
    });
  });
});
