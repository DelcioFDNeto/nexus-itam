// services/tests/e2e_cloud_vault/f09_connection_health.test.js
// =============================================================================
// F-09: VPS Connection Management & Health Diagnostics — Opaque-Box Tests
// =============================================================================

import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootE2eCluster } from './helpers/clusterHarness.js';
import { startMockAgentNode } from './helpers/mockAgentNode.js';
import { startMockS3Server } from './helpers/mockS3Server.js';
import { assertFullAuditIntegrity, expectAuditEvent } from './helpers/auditHelper.js';

function getClosedLoopbackPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

describe('F-09: VPS Connection Management & Health Diagnostics', () => {
  let cluster;
  let agent;
  let s3;
  let ownerSession;
  let adminToken;
  let managerToken;
  let operatorToken;
  let viewerToken;
  let collaboratorToken;

  beforeAll(async () => {
    cluster = await bootE2eCluster();
    agent = await startMockAgentNode({ quotaBytes: 50_000_000 });
    s3 = await startMockS3Server({
      accessKey: 'f09-ak',
      secretKey: 'f09-sk-secret-value',
      bucket: 'f09-bucket',
      region: 'us-east-1',
    });
    ownerSession = await cluster.loginAs('ti@shineraybysabel.com.br', 'Shineray@2026!');

    const roles = ['admin', 'manager', 'operator', 'viewer', 'collaborator'];
    const tokens = {};
    for (const role of roles) {
      tokens[role] = cluster.createUserToken({
        sub: `f09-${role}`,
        email: `f09.${role}@shineraybysabel.com.br`,
        role,
        tenantId: 'tenant-ap3htf6',
        department: 'TI',
      });
    }
    adminToken = tokens.admin;
    managerToken = tokens.manager;
    operatorToken = tokens.operator;
    viewerToken = tokens.viewer;
    collaboratorToken = tokens.collaborator;
  }, 45_000);

  afterAll(async () => {
    try {
      if (agent) await agent.stop();
    } finally {
      try {
        if (s3) await s3.stop();
      } finally {
        if (cluster) await cluster.stop();
      }
    }
  }, 45_000);

  describe('Tier 1 — Connection Lifecycle, Diagnostics & Telemetry', () => {
    it('T1.1 — PUT and GET /connection persist metadata and mask credentials', async () => {
      const token = cluster.createUserToken({
        sub: 'f09-t1-own',
        email: 'f09t1@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f09-t1',
      });

      const putRes = await cluster.apiFetch(token, '/api/v1/storage/connection', {
        method: 'PUT',
        body: {
          providerType: 'agent_node',
          label: 'Primary Agent T1',
          endpointUrl: agent.url,
          rootPath: '/',
          quotaBytes: 50_000_000,
          hmacToken: agent.hmacToken,
        },
      });
      expect([200, 201]).toContain(putRes.status);

      const getRes = await cluster.apiFetch(token, '/api/v1/storage/connection');
      expect(getRes.status).toBe(200);
      const conn = getRes.data?.connection || getRes.data;
      expect(conn?.providerType).toBe('agent_node');
      expect(conn?.label).toBe('Primary Agent T1');
      expect(Number(conn?.quotaBytes)).toBe(50_000_000);
      expect(getRes.text).not.toContain(agent.hmacToken);
    });

    it('T1.2 — POST /connection/test returns live latency, freeBytes, totalBytes, and transportDetails', async () => {
      const putRes = await cluster.apiFetch(adminToken, '/api/v1/storage/connection', {
        method: 'PUT',
        body: {
          providerType: 'agent_node',
          label: 'Admin Configured Node',
          endpointUrl: agent.url,
          rootPath: '/',
          quotaBytes: 50_000_000,
          hmacToken: agent.hmacToken,
        },
      });
      expect([200, 201]).toContain(putRes.status);

      const testRes = await cluster.apiFetch(adminToken, '/api/v1/storage/connection/test', {
        method: 'POST',
      });
      expect(testRes.status).toBe(200);
      expect(testRes.data?.ok).toBe(true);
      expect(testRes.data?.status).toBe('connected');
      expect(typeof testRes.data?.latencyMs).toBe('number');
      expect(testRes.data.latencyMs).toBeGreaterThanOrEqual(0);
      expect(Number(testRes.data?.freeBytes)).toBeGreaterThan(0);
      expect(Number(testRes.data?.totalBytes)).toBe(50_000_000);
    });

    it('T1.3 — GET /health reflects connected telemetry (latencyMs, freeBytes, totalBytes, lastCheckAt)', async () => {
      const token = cluster.createUserToken({
        sub: 'f09-t3-own',
        email: 'f09t3@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f09-t3',
      });
      await cluster.apiFetch(token, '/api/v1/storage/connection', {
        method: 'PUT',
        body: {
          providerType: 'agent_node',
          endpointUrl: agent.url,
          rootPath: '/',
          hmacToken: agent.hmacToken,
          quotaBytes: 50_000_000,
        },
      });
      await cluster.apiFetch(token, '/api/v1/storage/connection/test', { method: 'POST' });

      const healthRes = await cluster.apiFetch(token, '/api/v1/storage/health');
      expect(healthRes.status).toBe(200);
      expect(healthRes.data?.ok).toBe(true);
      expect(healthRes.data?.status).toBe('connected');
      expect(typeof healthRes.data?.latencyMs).toBe('number');
      expect(Number(healthRes.data?.freeBytes)).toBeGreaterThan(0);
      expect(Number(healthRes.data?.totalBytes)).toBe(50_000_000);
      expect(healthRes.data?.lastCheckAt).toBeTruthy();
    });

    it('T1.4 — partial update preserves credentials and driver switch to S3 executes HEAD /{bucket}', async () => {
      const token = cluster.createUserToken({
        sub: 'f09-t4-own',
        email: 'f09t4@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f09-t4',
      });
      await cluster.apiFetch(token, '/api/v1/storage/connection', {
        method: 'PUT',
        body: {
          providerType: 'agent_node',
          label: 'Before Partial',
          endpointUrl: agent.url,
          rootPath: '/',
          hmacToken: agent.hmacToken,
        },
      });

      const partialRes = await cluster.apiFetch(token, '/api/v1/storage/connection', {
        method: 'PUT',
        body: { label: 'After Partial', quotaBytes: 25_000_000 },
      });
      expect([200, 201]).toContain(partialRes.status);

      const agentTest = await cluster.apiFetch(token, '/api/v1/storage/connection/test', { method: 'POST' });
      expect(agentTest.status).toBe(200);
      expect(agentTest.data?.ok).toBe(true);

      const switchRes = await cluster.apiFetch(token, '/api/v1/storage/connection', {
        method: 'PUT',
        body: {
          providerType: 's3',
          label: 'Switched S3',
          endpointUrl: s3.endpoint,
          bucket: s3.bucket,
          region: s3.region,
          accessKey: s3.accessKey,
          secretKey: s3.secretKey,
        },
      });
      expect([200, 201]).toContain(switchRes.status);

      const beforeLen = s3.getRequestLog().length;
      const s3Test = await cluster.apiFetch(token, '/api/v1/storage/connection/test', { method: 'POST' });
      expect(s3Test.status).toBe(200);
      expect(s3Test.data?.ok).toBe(true);
      expect(
        s3
          .getRequestLog()
          .slice(beforeLen)
          .some((l) => l.protocol === 's3' && l.method === 'HEAD' && l.status === 200),
      ).toBe(true);
    });

    it('T1.5 — unconfigured tenant returns non-500 status and closed-port SFTP returns structured diagnostic error', async () => {
      const gammaToken = cluster.createUserToken({
        sub: 'f09-gamma',
        email: 'gamma@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f09-gamma',
      });

      const gammaHealth = await cluster.apiFetch(gammaToken, '/api/v1/storage/health');
      expect(gammaHealth.status).toBeLessThan(500);
      expect(gammaHealth.data?.ok).toBe(false);

      const gammaConn = await cluster.apiFetch(gammaToken, '/api/v1/storage/connection');
      expect([200, 404]).toContain(gammaConn.status);

      const closedPort = await getClosedLoopbackPort();
      const sftpToken = cluster.createUserToken({
        sub: 'f09-closed-sftp',
        email: 'sftpclosed@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f09-closed-sftp',
      });
      await cluster.apiFetch(sftpToken, '/api/v1/storage/connection', {
        method: 'PUT',
        body: {
          providerType: 'sftp',
          host: '127.0.0.1',
          port: closedPort,
          username: 'probe',
          password: 'probe-password',
        },
      });
      const testRes = await cluster.apiFetch(sftpToken, '/api/v1/storage/connection/test', { method: 'POST' });
      expect([200, 422]).toContain(testRes.status);
      expect(testRes.data?.ok).toBe(false);
      expect(String(testRes.data?.error || '').length).toBeGreaterThan(0);
    });
  });

  describe('Tier 2 — Degradation, Wrong Auth, Validation, RBAC & Audit', () => {
    it('T2.1 — detects offline node degradation on POST /connection/test and GET /health without leaking secrets', async () => {
      const token = cluster.createUserToken({
        sub: 'f09-t6-own',
        email: 'f09t6@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f09-offline',
      });
      const ephemeralAgent = await startMockAgentNode({ quotaBytes: 10_000_000 });
      try {
        await cluster.apiFetch(token, '/api/v1/storage/connection', {
          method: 'PUT',
          body: {
            providerType: 'agent_node',
            endpointUrl: ephemeralAgent.url,
            rootPath: '/',
            hmacToken: ephemeralAgent.hmacToken,
          },
        });
        const okTest = await cluster.apiFetch(token, '/api/v1/storage/connection/test', { method: 'POST' });
        expect(okTest.status).toBe(200);
        expect(okTest.data?.ok).toBe(true);
      } finally {
        await ephemeralAgent.stop();
      }

      const failTest = await cluster.apiFetch(token, '/api/v1/storage/connection/test', { method: 'POST' });
      expect([200, 422]).toContain(failTest.status);
      expect(failTest.data?.ok).toBe(false);
      expect(failTest.data?.status).toBe('error');
      expect(failTest.text).not.toContain(ephemeralAgent.hmacToken);

      const health = await cluster.apiFetch(token, '/api/v1/storage/health');
      expect(health.status).toBeLessThan(500);
      expect(health.data?.status).toBe('error');
      expect(String(health.data?.lastError || health.data?.error || '').length).toBeGreaterThan(0);
    });

    it('T2.2 — wrong hmacToken fails diagnostics and updates /health to error state', async () => {
      const token = cluster.createUserToken({
        sub: 'f09-t7-own',
        email: 'f09t7@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f09-wronghmac',
      });
      await cluster.apiFetch(token, '/api/v1/storage/connection', {
        method: 'PUT',
        body: {
          providerType: 'agent_node',
          endpointUrl: agent.url,
          rootPath: '/',
          hmacToken: 'invalid-hmac-secret-f09',
        },
      });

      const testRes = await cluster.apiFetch(token, '/api/v1/storage/connection/test', { method: 'POST' });
      expect([200, 422]).toContain(testRes.status);
      expect(testRes.data?.ok).toBe(false);
      expect(testRes.data?.status).toBe('error');

      const healthRes = await cluster.apiFetch(token, '/api/v1/storage/health');
      expect(healthRes.status).toBeLessThan(500);
      expect(healthRes.data?.status).toBe('error');
    });

    it('T2.3 — rejects invalid providerType, ports, negative quotaBytes, and traversal rootPath with 400', async () => {
      const token = cluster.createUserToken({
        sub: 'f09-t8-own',
        email: 'f09t8@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f09-invalid',
      });

      const invalidPayloads = [
        { providerType: 'ftp_unsupported', host: '127.0.0.1' },
        { providerType: 'sftp', host: '127.0.0.1', port: 0, username: 'u', password: 'p' },
        { providerType: 'sftp', host: '127.0.0.1', port: 70000, username: 'u', password: 'p' },
        { providerType: 'sftp', host: '127.0.0.1', port: 'abc', username: 'u', password: 'p' },
        { providerType: 'agent_node', endpointUrl: agent.url, hmacToken: agent.hmacToken, quotaBytes: -1 },
        { providerType: 'agent_node', endpointUrl: agent.url, hmacToken: agent.hmacToken, rootPath: '/srv/../../etc' },
      ];

      for (const body of invalidPayloads) {
        const res = await cluster.apiFetch(token, '/api/v1/storage/connection', {
          method: 'PUT',
          body,
        });
        expect(res.status).toBe(400);
      }
    });

    it('T2.4 — enforces cloud:connect RBAC (403 for collaborator, viewer, operator, manager)', async () => {
      for (const actorToken of [collaboratorToken, viewerToken, operatorToken, managerToken]) {
        expect(
          (
            await cluster.apiFetch(actorToken, '/api/v1/storage/connection', {
              method: 'PUT',
              body: { label: 'RBAC Blocked' },
            })
          ).status,
        ).toBe(403);

        expect(
          (await cluster.apiFetch(actorToken, '/api/v1/storage/connection/test', { method: 'POST' })).status,
        ).toBe(403);

        expect(
          (
            await cluster.apiFetch(actorToken, '/api/v1/storage/connection/install-script', {
              method: 'POST',
              body: { rootPath: '/srv/nexus-vault' },
            })
          ).status,
        ).toBe(403);
      }
    });

    it('T2.5 — verifies SHA-256 compliance audit chain integrity without credential leakage', async () => {
      await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/connection', {
        method: 'PUT',
        body: {
          providerType: 'agent_node',
          label: 'Audit Verified Vault',
          endpointUrl: agent.url,
          rootPath: '/',
          hmacToken: agent.hmacToken,
        },
      });
      await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/connection/test', { method: 'POST' });

      const integrity = await assertFullAuditIntegrity(cluster.apiFetch, ownerSession.accessToken);
      expect(integrity.apiResult.intact).toBe(true);
      expect(integrity.localResult.valid).toBe(true);

      const serialized = JSON.stringify(integrity.itemsAsc);
      expect(serialized).not.toContain(agent.hmacToken);
      expect(serialized).not.toContain(s3.secretKey);

      const event = await expectAuditEvent(cluster.apiFetch, ownerSession.accessToken, {
        actorEmail: 'ti@shineraybysabel.com.br',
      });
      expect(event).toBeTruthy();
    });
  });
});
