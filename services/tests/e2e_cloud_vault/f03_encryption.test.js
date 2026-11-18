// services/tests/e2e_cloud_vault/f03_encryption.test.js
// =============================================================================
// F-03: AES-256-GCM Credentials Encryption & Secret Masking — Opaque-Box Tests
// =============================================================================

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootE2eCluster } from './helpers/clusterHarness.js';
import { startMockAgentNode } from './helpers/mockAgentNode.js';
import { startMockS3Server } from './helpers/mockS3Server.js';
import { fetchAuditLog } from './helpers/auditHelper.js';

describe('F-03: AES-256-GCM Credentials Encryption & Masking', () => {
  let cluster;
  let agent;
  let s3;
  let ownerSession;

  beforeAll(async () => {
    cluster = await bootE2eCluster();
    agent = await startMockAgentNode({ quotaBytes: 25 * 1024 * 1024 });
    s3 = await startMockS3Server({
      accessKey: 'ak-f03',
      secretKey: 'sk-super-secret-f03-value',
      bucket: 'f03-vault',
      region: 'us-east-1',
    });
    ownerSession = await cluster.loginAs('ti@shineraybysabel.com.br', 'Shineray@2026!');
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

  describe('Tier 1 — At-Rest Encryption, Masking & Transparent Decryption', () => {
    it('T1.1 — masks agent_node hmacToken and ciphertext on PUT & GET /api/v1/storage/connection', async () => {
      const token = cluster.createUserToken({
        sub: 'f03-t1-own',
        email: 'f03t1@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f03-t1',
      });

      const putRes = await cluster.apiFetch(token, '/api/v1/storage/connection', {
        method: 'PUT',
        body: {
          providerType: 'agent_node',
          label: 'Encrypted Agent',
          endpointUrl: agent.url,
          rootPath: '/',
          hmacToken: agent.hmacToken,
          quotaBytes: 10_000_000,
        },
      });
      expect([200, 201]).toContain(putRes.status);
      expect(putRes.text).not.toContain(agent.hmacToken);
      expect(putRes.text).not.toContain('encrypted_credentials');

      const getRes = await cluster.apiFetch(token, '/api/v1/storage/connection');
      expect(getRes.status).toBe(200);
      expect(getRes.text).not.toContain(agent.hmacToken);
      expect(getRes.text).not.toContain('encrypted_credentials');
      expect(getRes.text).not.toContain('encryptedCredentials');
    });

    it('T1.2 — decrypts stored AES-256-GCM hmacToken transparently for mockAgentNode HMAC auth', async () => {
      const token = cluster.createUserToken({
        sub: 'f03-t2-own',
        email: 'f03t2@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f03-t2',
      });

      const putRes = await cluster.apiFetch(token, '/api/v1/storage/connection', {
        method: 'PUT',
        body: {
          providerType: 'agent_node',
          endpointUrl: agent.url,
          rootPath: '/',
          hmacToken: agent.hmacToken,
        },
      });
      expect([200, 201]).toContain(putRes.status);

      const beforeCount = agent.getRequestLog().length;
      const testRes = await cluster.apiFetch(token, '/api/v1/storage/connection/test', {
        method: 'POST',
      });
      expect(testRes.status).toBe(200);
      expect(testRes.data?.ok).toBe(true);

      const newLogs = agent.getRequestLog().slice(beforeCount);
      expect(newLogs.some((entry) => entry.authorized === true && entry.status === 200)).toBe(true);
    });

    it('T1.3 — masks S3 secretKey on PUT/GET /connection while SigV4 connection/test succeeds', async () => {
      const token = cluster.createUserToken({
        sub: 'f03-t3-own',
        email: 'f03t3@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f03-s3',
      });

      const putRes = await cluster.apiFetch(token, '/api/v1/storage/connection', {
        method: 'PUT',
        body: {
          providerType: 's3',
          endpointUrl: s3.endpoint,
          bucket: s3.bucket,
          region: s3.region,
          accessKey: s3.accessKey,
          secretKey: s3.secretKey,
        },
      });
      expect([200, 201]).toContain(putRes.status);
      expect(putRes.text).not.toContain(s3.secretKey);

      const getRes = await cluster.apiFetch(token, '/api/v1/storage/connection');
      expect(getRes.status).toBe(200);
      expect(getRes.text).not.toContain(s3.secretKey);

      const testRes = await cluster.apiFetch(token, '/api/v1/storage/connection/test', {
        method: 'POST',
      });
      expect(testRes.status).toBe(200);
      expect(testRes.data?.ok).toBe(true);
    });

    it('T1.4 — masks SFTP password, privateKey, and passphrase on PUT and GET /connection', async () => {
      const token = cluster.createUserToken({
        sub: 'f03-t4-own',
        email: 'f03t4@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f03-sftp',
      });

      const sshPassword = 'ULTRA_SECRET_SSH_PASSWORD_99';
      const sshKeyBody = 'SECRET_KEY_BODY_99';
      const sshPassphrase = 'KEY_PASSPHRASE_99';

      const putRes = await cluster.apiFetch(token, '/api/v1/storage/connection', {
        method: 'PUT',
        body: {
          providerType: 'sftp',
          host: '127.0.0.1',
          port: 22222,
          username: 'vault',
          password: sshPassword,
          privateKey: `-----BEGIN OPENSSH PRIVATE KEY-----\n${sshKeyBody}\n-----END OPENSSH PRIVATE KEY-----`,
          passphrase: sshPassphrase,
        },
      });
      expect([200, 201]).toContain(putRes.status);
      expect(putRes.text).not.toContain(sshPassword);
      expect(putRes.text).not.toContain(sshKeyBody);
      expect(putRes.text).not.toContain(sshPassphrase);

      const getRes = await cluster.apiFetch(token, '/api/v1/storage/connection');
      expect(getRes.status).toBe(200);
      expect(getRes.text).not.toContain(sshPassword);
      expect(getRes.text).not.toContain(sshKeyBody);
      expect(getRes.text).not.toContain(sshPassphrase);
    });

    it('T1.5 — install-script registers/rotates HMAC token without leaking on GET /connection and blocks collaborator', async () => {
      const scriptRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/connection/install-script', {
        method: 'POST',
        body: { rootPath: '/srv/nexus-vault', quotaBytes: 50_000_000 },
      });
      expect([200, 201]).toContain(scriptRes.status);
      const scriptBody = scriptRes.data?.script || scriptRes.data?.command || scriptRes.text;
      expect(scriptBody).toBeTruthy();

      const issuedToken = scriptRes.data?.hmacToken || scriptRes.data?.token;
      const getConn = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/connection');
      if (getConn.status === 200 && issuedToken) {
        expect(getConn.text).not.toContain(String(issuedToken));
      }

      const colabLogin = await cluster.loginAs('joao.silva@shineray.com.br', 'Colab@2026!');
      const colabScript = await cluster.apiFetch(colabLogin.accessToken, '/api/v1/storage/connection/install-script', {
        method: 'POST',
        body: { rootPath: '/srv/nexus-vault' },
      });
      expect(colabScript.status).toBe(403);
    });
  });

  describe('Tier 2 — Non-Leakage on Errors/Audit, Rotation & Zero-Knowledge', () => {
    it('T2.1 — never leaks SFTP secrets in failed POST /connection/test or GET /health responses', async () => {
      const token = cluster.createUserToken({
        sub: 'f03-t6-own',
        email: 'f03t6@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f03-errleak',
      });

      const secretPass = 'FAIL_LEAK_GUARD_PASS_77';
      const secretKey = 'FAIL_LEAK_GUARD_KEY_77';
      const secretPhrase = 'FAIL_LEAK_GUARD_PHRASE_77';

      const putRes = await cluster.apiFetch(token, '/api/v1/storage/connection', {
        method: 'PUT',
        body: {
          providerType: 'sftp',
          host: '127.0.0.1',
          port: 1,
          username: 'vault',
          password: secretPass,
          privateKey: `-----BEGIN OPENSSH PRIVATE KEY-----\n${secretKey}\n-----END OPENSSH PRIVATE KEY-----`,
          passphrase: secretPhrase,
        },
      });
      expect([200, 201]).toContain(putRes.status);

      const testRes = await cluster.apiFetch(token, '/api/v1/storage/connection/test', { method: 'POST' });
      expect(testRes.status).toBeLessThan(500);
      expect(testRes.data?.ok).toBe(false);
      expect(testRes.text).not.toContain(secretPass);
      expect(testRes.text).not.toContain(secretKey);
      expect(testRes.text).not.toContain(secretPhrase);

      const healthRes = await cluster.apiFetch(token, '/api/v1/storage/health');
      expect(healthRes.status).toBeLessThan(500);
      expect(healthRes.text).not.toContain(secretPass);
      expect(healthRes.text).not.toContain(secretKey);
      expect(healthRes.text).not.toContain(secretPhrase);
    });

    it('T2.2 — never writes plaintext credentials into service-compliance audit chain', async () => {
      const auditPass = 'AUDIT_SECRET_SSH_88';
      await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/connection', {
        method: 'PUT',
        body: {
          providerType: 'sftp',
          host: '127.0.0.1',
          port: 22222,
          username: 'audit-user',
          password: auditPass,
        },
      });
      await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/connection', {
        method: 'PUT',
        body: {
          providerType: 'agent_node',
          endpointUrl: agent.url,
          rootPath: '/',
          hmacToken: agent.hmacToken,
        },
      });
      await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/connection/test', { method: 'POST' });

      const { itemsAsc } = await fetchAuditLog(cluster.apiFetch, ownerSession.accessToken, 200);
      const serialized = JSON.stringify(itemsAsc);
      expect(serialized).not.toContain(agent.hmacToken);
      expect(serialized).not.toContain(s3.secretKey);
      expect(serialized).not.toContain(auditPass);
    });

    it('T2.3 — rotating hmacToken re-encrypts and invalidates prior secret during connection/test', async () => {
      const token = cluster.createUserToken({
        sub: 'f03-t8-own',
        email: 'f03t8@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f03-rot',
      });

      const firstPut = await cluster.apiFetch(token, '/api/v1/storage/connection', {
        method: 'PUT',
        body: { providerType: 'agent_node', endpointUrl: agent.url, rootPath: '/', hmacToken: agent.hmacToken },
      });
      expect([200, 201]).toContain(firstPut.status);

      const okTest = await cluster.apiFetch(token, '/api/v1/storage/connection/test', { method: 'POST' });
      expect(okTest.status).toBe(200);
      expect(okTest.data?.ok).toBe(true);

      const wrongPut = await cluster.apiFetch(token, '/api/v1/storage/connection', {
        method: 'PUT',
        body: { providerType: 'agent_node', endpointUrl: agent.url, rootPath: '/', hmacToken: 'wrong-rotated-token-xyz' },
      });
      expect([200, 201]).toContain(wrongPut.status);

      const failTest = await cluster.apiFetch(token, '/api/v1/storage/connection/test', { method: 'POST' });
      expect(failTest.status).toBeLessThan(500);
      expect(failTest.data?.ok).toBe(false);
      expect(failTest.text).not.toContain('wrong-rotated-token-xyz');

      await cluster.apiFetch(token, '/api/v1/storage/connection', {
        method: 'PUT',
        body: { hmacToken: agent.hmacToken },
      });
      const restoredTest = await cluster.apiFetch(token, '/api/v1/storage/connection/test', { method: 'POST' });
      expect(restoredTest.status).toBe(200);
      expect(restoredTest.data?.ok).toBe(true);
    });

    it('T2.4 — partial metadata PUT /connection preserves encrypted secrets and keeps connection/test working', async () => {
      const token = cluster.createUserToken({
        sub: 'f03-t9-own',
        email: 'f03t9@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f03-partial',
      });

      const initPut = await cluster.apiFetch(token, '/api/v1/storage/connection', {
        method: 'PUT',
        body: {
          providerType: 'agent_node',
          label: 'Initial Vault',
          endpointUrl: agent.url,
          rootPath: '/',
          hmacToken: agent.hmacToken,
          quotaBytes: 1_024_000,
        },
      });
      expect([200, 201]).toContain(initPut.status);

      const partialPut = await cluster.apiFetch(token, '/api/v1/storage/connection', {
        method: 'PUT',
        body: { label: 'Renamed Vault', quotaBytes: 2_048_000 },
      });
      expect([200, 201]).toContain(partialPut.status);

      const testRes = await cluster.apiFetch(token, '/api/v1/storage/connection/test', { method: 'POST' });
      expect(testRes.status).toBe(200);
      expect(testRes.data?.ok).toBe(true);

      const getRes = await cluster.apiFetch(token, '/api/v1/storage/connection');
      expect(getRes.status).toBe(200);
      expect(getRes.text).not.toContain(agent.hmacToken);
    });

    it('T2.5 — blocks superadmin (403 ZERO_KNOWLEDGE_RESTRICTED) and collaborator (403) from connection secrets', async () => {
      const superadminToken = cluster.createUserToken({
        sub: 'sa-f03',
        email: 'master@nexus.internal',
        role: 'superadmin',
        tenantId: 'nexus-master',
      });
      const colabLogin = await cluster.loginAs('karen.matos@shineraybysabel.com.br', 'Colab@2026!');

      const saGet = await cluster.apiFetch(superadminToken, '/api/v1/storage/connection');
      expect(saGet.status).toBe(403);
      expect(saGet.data?.error || saGet.text).toMatch(/ZERO_KNOWLEDGE_RESTRICTED|Forbidden/i);

      const saPut = await cluster.apiFetch(superadminToken, '/api/v1/storage/connection', {
        method: 'PUT',
        body: { providerType: 'agent_node', endpointUrl: agent.url, hmacToken: agent.hmacToken },
      });
      expect(saPut.status).toBe(403);

      const colabGet = await cluster.apiFetch(colabLogin.accessToken, '/api/v1/storage/connection');
      expect(colabGet.status).toBe(403);

      const colabPut = await cluster.apiFetch(colabLogin.accessToken, '/api/v1/storage/connection', {
        method: 'PUT',
        body: { label: 'Hijack' },
      });
      expect(colabPut.status).toBe(403);
    });
  });
});
