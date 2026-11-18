// services/tests/e2e_cloud_vault/f20_rbac_backend.test.js
// =============================================================================
// F-20: Global RBAC Capabilities & Zero-Knowledge Superadmin (Backend E2E)
// =============================================================================

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootE2eCluster } from './helpers/clusterHarness.js';
import { startMockAgentNode } from './helpers/mockAgentNode.js';

describe('F-20: Global RBAC Capabilities & Zero-Knowledge Superadmin Enforcement', () => {
  let cluster;
  let agent;
  let ownerToken;
  let adminToken;
  let managerToken;
  let memberToken;
  let operatorToken;
  let viewerToken;
  let collabFinToken;
  let superadminToken;

  let corpPublicId;
  let cofreId;
  let setorFinId;
  let setorRhId;
  let espacoCollabId;

  function extractNodesList(res) {
    if (Array.isArray(res.data)) return res.data;
    return res.data?.items || res.data?.nodes || [];
  }

  async function uploadText(token, parentId, fileName, text = 'RBAC_PAYLOAD') {
    const form = new FormData();
    if (parentId) form.append('parentId', parentId);
    form.append('fileName', fileName);
    form.append('conflictPolicy', 'version');
    form.append('file', new Blob([Buffer.from(text, 'utf8')], { type: 'text/plain' }), fileName);
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
      name: 'RBAC Admin',
      email: 'rbac.admin@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'admin',
      department: 'Tecnologia',
    });
    adminToken = (await cluster.loginAs('rbac.admin@shineraybysabel.com.br', 'Password@2026!')).accessToken;

    await cluster.seedUser(ownerToken, {
      name: 'RBAC Manager',
      email: 'rbac.manager@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'manager',
      department: 'Tecnologia',
    });
    managerToken = (await cluster.loginAs('rbac.manager@shineraybysabel.com.br', 'Password@2026!')).accessToken;

    // POST /api/v1/auth/users omits 'member' from its schema enum; seed directly
    await cluster.seedDirectUser({
      name: 'RBAC Member',
      email: 'rbac.member@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'member',
      tenantId: 'tenant-ap3htf6',
      department: 'Tecnologia',
    });
    memberToken = (await cluster.loginAs('rbac.member@shineraybysabel.com.br', 'Password@2026!')).accessToken;

    await cluster.seedUser(ownerToken, {
      name: 'RBAC Operator',
      email: 'rbac.operator@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'operator',
      department: 'Tecnologia',
    });
    operatorToken = (await cluster.loginAs('rbac.operator@shineraybysabel.com.br', 'Password@2026!')).accessToken;

    await cluster.seedUser(ownerToken, {
      name: 'RBAC Viewer',
      email: 'rbac.viewer@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'viewer',
      department: 'Geral',
    });
    viewerToken = (await cluster.loginAs('rbac.viewer@shineraybysabel.com.br', 'Password@2026!')).accessToken;

    await cluster.seedUser(ownerToken, {
      name: 'RBAC Collab Financeiro',
      email: 'rbac.collab@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'collaborator',
      department: 'Financeiro',
    });
    collabFinToken = (await cluster.loginAs('rbac.collab@shineraybysabel.com.br', 'Password@2026!')).accessToken;

    superadminToken = cluster.createUserToken({
      sub: 'sa-rbac-master',
      email: 'master@nexus.internal',
      role: 'superadmin',
      tenantId: 'nexus-master',
    });

    agent = await startMockAgentNode({ quotaBytes: 20 * 1024 * 1024 });
    const parsed = new URL(agent.url);
    const putConn = await cluster.apiFetch(ownerToken, '/api/v1/storage/connection', {
      method: 'PUT',
      body: {
        providerType: 'agent_node',
        label: 'E2E RBAC Node',
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
    const setores = roots.find((n) => n.name === 'Setores');
    const espaco = roots.find((n) => n.name === 'Espaco-Pessoal');
    expect(corpPublicId).toBeTruthy();
    expect(cofreId).toBeTruthy();
    expect(setores?.id).toBeTruthy();
    expect(espaco?.id).toBeTruthy();

    const finRes = await cluster.apiFetch(ownerToken, '/api/v1/storage/folders', {
      method: 'POST',
      body: { parentId: setores.id, name: 'Financeiro', departmentScope: 'Financeiro' },
    });
    expect([200, 201]).toContain(finRes.status);
    setorFinId = (finRes.data?.node || finRes.data).id;

    const rhRes = await cluster.apiFetch(ownerToken, '/api/v1/storage/folders', {
      method: 'POST',
      body: { parentId: setores.id, name: 'RH', departmentScope: 'RH' },
    });
    expect([200, 201]).toContain(rhRes.status);
    setorRhId = (rhRes.data?.node || rhRes.data).id;

    const espacoChildren = extractNodesList(
      await cluster.apiFetch(ownerToken, `/api/v1/storage/nodes?parentId=${espaco.id}`),
    );
    const existingCollabHome = espacoChildren.find(
      (n) => n.name === 'rbac.collab@shineraybysabel.com.br',
    );
    if (existingCollabHome) {
      espacoCollabId = existingCollabHome.id;
    } else {
      const homeRes = await cluster.apiFetch(ownerToken, '/api/v1/storage/folders', {
        method: 'POST',
        body: { parentId: espaco.id, name: 'rbac.collab@shineraybysabel.com.br' },
      });
      expect([200, 201]).toContain(homeRes.status);
      espacoCollabId = (homeRes.data?.node || homeRes.data).id;
    }
  }, 45_000);

  afterAll(async () => {
    try {
      if (agent) await agent.stop();
    } finally {
      if (cluster) await cluster.stop();
    }
  }, 45_000);

  describe('Tier 1 — Global RBAC Matrix (cloud:connect/acl/write/read) & Collaborator Parity', () => {
    it('enforces cloud:connect: owner & admin allowed; manager/member/operator/viewer/collaborator rejected (403)', async () => {
      const parsed = new URL(agent.url);
      const connBody = {
        providerType: 'agent_node',
        label: 'RBAC Conn Update',
        host: parsed.hostname,
        port: Number(parsed.port),
        endpointUrl: agent.url,
        rootPath: '/',
        quotaBytes: agent.quotaBytes,
        credentials: { hmacToken: agent.hmacToken },
        hmacToken: agent.hmacToken,
      };

      for (const allowedToken of [ownerToken, adminToken]) {
        expect((await cluster.apiFetch(allowedToken, '/api/v1/storage/connection', { method: 'PUT', body: connBody })).status).toBe(200);
        expect((await cluster.apiFetch(allowedToken, '/api/v1/storage/connection/test', { method: 'POST', body: {} })).status).toBe(200);
        expect((await cluster.apiFetch(allowedToken, '/api/v1/storage/connection/install-script', { method: 'POST', body: {} })).status).toBe(200);
        expect([200, 201]).toContain((await cluster.apiFetch(allowedToken, '/api/v1/storage/initialize', { method: 'POST', body: {} })).status);
      }

      for (const deniedToken of [managerToken, memberToken, operatorToken, viewerToken, collabFinToken]) {
        expect((await cluster.apiFetch(deniedToken, '/api/v1/storage/connection', { method: 'PUT', body: connBody })).status).toBe(403);
        expect((await cluster.apiFetch(deniedToken, '/api/v1/storage/connection/test', { method: 'POST', body: {} })).status).toBe(403);
        expect((await cluster.apiFetch(deniedToken, '/api/v1/storage/connection/install-script', { method: 'POST', body: {} })).status).toBe(403);
        expect((await cluster.apiFetch(deniedToken, '/api/v1/storage/initialize', { method: 'POST', body: {} })).status).toBe(403);
      }
    });

    it('enforces cloud:acl: owner/admin/manager allowed; member/operator/viewer/collaborator rejected (403)', async () => {
      const fRes = await cluster.apiFetch(ownerToken, '/api/v1/storage/folders', {
        method: 'POST',
        body: { parentId: corpPublicId, name: 'F20-AclTarget' },
      });
      expect(fRes.status).toBe(201);
      const targetId = (fRes.data?.node || fRes.data).id;

      for (const allowedToken of [ownerToken, adminToken, managerToken]) {
        const putRes = await cluster.apiFetch(allowedToken, `/api/v1/storage/nodes/${targetId}/acl`, {
          method: 'PUT',
          body: { rules: [{ targetType: 'department', targetValue: 'Comercial', accessLevel: 'reader' }] },
        });
        expect([200, 201]).toContain(putRes.status);
      }

      for (const deniedToken of [memberToken, operatorToken, viewerToken, collabFinToken]) {
        const putRes = await cluster.apiFetch(deniedToken, `/api/v1/storage/nodes/${targetId}/acl`, {
          method: 'PUT',
          body: { rules: [{ targetType: 'department', targetValue: 'Comercial', accessLevel: 'editor' }] },
        });
        expect(putRes.status).toBe(403);
      }
    });

    it('enforces cloud:write: operator/member/manager+ allowed; viewer always blocked (403)', async () => {
      for (const [label, token] of [
        ['operator', operatorToken],
        ['member', memberToken],
        ['manager', managerToken],
      ]) {
        const up = await uploadText(token, corpPublicId, `f20-write-${label}.txt`, 'WRITE_OK');
        expect([200, 201]).toContain(up.status);
      }

      const viewerFolder = await cluster.apiFetch(viewerToken, '/api/v1/storage/folders', {
        method: 'POST',
        body: { parentId: corpPublicId, name: 'F20-ViewerBlocked' },
      });
      expect(viewerFolder.status).toBe(403);

      const viewerUpload = await uploadText(viewerToken, corpPublicId, 'f20-viewer-blocked.txt', 'NO_WRITE');
      expect(viewerUpload.status).toBe(403);
    });

    it('enforces cloud:read across all tenant roles including viewer and collaborator', async () => {
      const pubUp = await uploadText(ownerToken, corpPublicId, 'f20-public-read.txt', 'PUBLIC_READ_OK');
      expect([200, 201]).toContain(pubUp.status);
      const pubFileId = (pubUp.data?.node || pubUp.data).id;

      for (const token of [ownerToken, adminToken, managerToken, memberToken, operatorToken, viewerToken, collabFinToken]) {
        expect((await cluster.apiFetch(token, '/api/v1/storage/nodes')).status).toBe(200);
        expect((await cluster.apiFetch(token, '/api/v1/storage/quota')).status).toBe(200);
        expect((await cluster.apiFetch(token, '/api/v1/storage/health')).status).toBe(200);
        expect((await cluster.apiFetch(token, `/api/v1/storage/nodes/${pubFileId}/preview`)).status).toBe(200);
        expect((await cluster.apiFetch(token, `/api/v1/storage/nodes/${pubFileId}/download`)).status).toBe(200);
      }
    });

    it('enforces collaborator parity: reads /Corporativo-Publico, writes /Setores/{dept} & /Espaco-Pessoal/{email}, 403 on /Cofre-TI-Infra & other depts', async () => {
      const readPub = await cluster.apiFetch(collabFinToken, `/api/v1/storage/nodes?parentId=${corpPublicId}`);
      expect(readPub.status).toBe(200);

      const writeDept = await uploadText(collabFinToken, setorFinId, 'f20-collab-fin.txt', 'DEPT_OK');
      expect([200, 201]).toContain(writeDept.status);

      const writeHome = await uploadText(collabFinToken, espacoCollabId, 'f20-collab-home.txt', 'HOME_OK');
      expect([200, 201]).toContain(writeHome.status);

      const writeCofre = await uploadText(collabFinToken, cofreId, 'f20-collab-cofre.txt', 'FORBIDDEN');
      expect(writeCofre.status).toBe(403);

      const readCofre = await cluster.apiFetch(collabFinToken, `/api/v1/storage/nodes?parentId=${cofreId}`);
      expect(readCofre.status).toBe(403);

      const writeOtherDept = await uploadText(collabFinToken, setorRhId, 'f20-collab-rh.txt', 'FORBIDDEN');
      expect(writeOtherDept.status).toBe(403);
    });
  });

  describe('Tier 2 — Superadmin Zero-Knowledge LGPD, Header Spoofing, ACL Ceiling & Credential Masking', () => {
    it('enforces superadmin Zero-Knowledge LGPD block (403 ZERO_KNOWLEDGE_RESTRICTED) across all /api/v1/storage/* routes', async () => {
      const endpoints = [
        ['GET', '/api/v1/storage/connection'],
        ['PUT', '/api/v1/storage/connection', { providerType: 'agent_node', endpointUrl: agent.url }],
        ['POST', '/api/v1/storage/connection/test', {}],
        ['POST', '/api/v1/storage/initialize', {}],
        ['GET', '/api/v1/storage/health'],
        ['GET', '/api/v1/storage/quota'],
        ['GET', '/api/v1/storage/nodes'],
        ['POST', '/api/v1/storage/folders', { parentId: null, name: 'SA-Blocked' }],
        ['GET', '/api/v1/storage/trash'],
        ['GET', '/api/v1/storage/links'],
        ['POST', '/api/v1/storage/sheets', { parentId: null, name: 'sa.xlsx' }],
      ];

      for (const [method, path, body] of endpoints) {
        const res = await cluster.apiFetch(superadminToken, path, {
          method,
          ...(body ? { body } : {}),
        });
        expect(res.status).toBe(403);
        expect(JSON.stringify(res.data || res.text)).toContain('ZERO_KNOWLEDGE_RESTRICTED');
      }

      const upRes = await uploadText(superadminToken, corpPublicId, 'sa-blocked.txt', 'BLOCKED');
      expect(upRes.status).toBe(403);
      expect(JSON.stringify(upRes.data || upRes.text)).toContain('ZERO_KNOWLEDGE_RESTRICTED');
    });

    it('rejects superadmin even with spoofed x-tenant-id header targeting tenant-ap3htf6', async () => {
      const nodesRes = await cluster.apiFetch(superadminToken, '/api/v1/storage/nodes', {
        headers: { 'x-tenant-id': 'tenant-ap3htf6' },
      });
      expect(nodesRes.status).toBe(403);
      expect(JSON.stringify(nodesRes.data || nodesRes.text)).toContain('ZERO_KNOWLEDGE_RESTRICTED');

      const connRes = await cluster.apiFetch(superadminToken, '/api/v1/storage/connection', {
        headers: { 'x-tenant-id': 'tenant-ap3htf6' },
      });
      expect(connRes.status).toBe(403);
      expect(JSON.stringify(connRes.data || connRes.text)).toContain('ZERO_KNOWLEDGE_RESTRICTED');
    });

    it('rejects viewer write even when explicit folder ACL grants full_control (RBAC global ceiling)', async () => {
      const fRes = await cluster.apiFetch(ownerToken, '/api/v1/storage/folders', {
        method: 'POST',
        body: { parentId: corpPublicId, name: 'F20-ViewerCeiling' },
      });
      expect(fRes.status).toBe(201);
      const folderId = (fRes.data?.node || fRes.data).id;

      const grant = await cluster.apiFetch(ownerToken, `/api/v1/storage/nodes/${folderId}/acl`, {
        method: 'PUT',
        body: {
          rules: [{ targetType: 'user', targetValue: 'rbac.viewer@shineraybysabel.com.br', accessLevel: 'full_control' }],
        },
      });
      expect([200, 201]).toContain(grant.status);

      const viewerUpload = await uploadText(viewerToken, folderId, 'f20-ceiling.txt', 'CANNOT_WRITE');
      expect(viewerUpload.status).toBe(403);

      const ownerUp = await uploadText(ownerToken, folderId, 'f20-ceiling-existing.txt', 'OWNER_FILE');
      expect([200, 201]).toContain(ownerUp.status);
      const existingId = (ownerUp.data?.node || ownerUp.data).id;

      const viewerDel = await cluster.apiFetch(viewerToken, `/api/v1/storage/nodes/${existingId}`, {
        method: 'DELETE',
      });
      expect(viewerDel.status).toBe(403);
    });

    it('rejects unauthenticated (401), forged JWT (401), and forged direct-to-storage gateway signature (401/403)', async () => {
      const unauth = await cluster.apiFetch(null, '/api/v1/storage/nodes');
      expect(unauth.status).toBe(401);

      const forgedJwt = await cluster.apiFetch('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.bad_sig', '/api/v1/storage/nodes');
      expect(forgedJwt.status).toBe(401);

      expect(cluster.ports?.storage).toBeDefined();
      const directStorageRes = await fetch(`http://127.0.0.1:${cluster.ports.storage}/api/v1/storage/nodes`, {
        headers: {
          'x-user-id': '33333333-3333-4333-8333-333333333301',
          'x-user-email': 'ti@shineraybysabel.com.br',
          'x-user-role': 'owner',
          'x-tenant-id': 'tenant-ap3htf6',
          'x-request-id': 'forged-req-1',
          'x-gateway-timestamp': String(Date.now()),
          'x-gateway-signature': '0'.repeat(64),
        },
      });
      expect([401, 403]).toContain(directStorageRes.status);
    });

    it('prevents GET /connection credential leakage and blocks lower roles from reading connection config', async () => {
      for (const allowedToken of [ownerToken, adminToken]) {
        const res = await cluster.apiFetch(allowedToken, '/api/v1/storage/connection');
        expect(res.status).toBe(200);
        const serialized = JSON.stringify(res.data);
        expect(serialized).not.toContain(agent.hmacToken);
        expect(res.data?.encrypted_credentials).toBeUndefined();
      }

      for (const deniedToken of [managerToken, memberToken, operatorToken, viewerToken, collabFinToken, superadminToken]) {
        const res = await cluster.apiFetch(deniedToken, '/api/v1/storage/connection');
        expect(res.status).toBe(403);
      }
    });
  });
});
