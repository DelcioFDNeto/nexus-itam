// services/tests/e2e_cloud_vault/f10_provisioner.test.js
// =============================================================================
// F-10: Auto-Provisioned Corporate Structure — Opaque-Box Tests
// =============================================================================

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootE2eCluster } from './helpers/clusterHarness.js';
import { signAgentNodeHeaders, startMockAgentNode } from './helpers/mockAgentNode.js';
import { assertFullAuditIntegrity, expectAuditEvent } from './helpers/auditHelper.js';

function extractId(payload) {
  return payload?.id ?? payload?.node?.id ?? payload?.data?.id;
}

describe('F-10: Auto-Provisioned Corporate Structure (POST /initialize)', () => {
  let cluster;
  let agent;
  let ownerSession;
  let finColabToken;
  let adminToken;
  let managerToken;
  let operatorToken;
  let viewerToken;

  beforeAll(async () => {
    cluster = await bootE2eCluster();
    agent = await startMockAgentNode({ quotaBytes: 50_000_000 });
    ownerSession = await cluster.loginAs('ti@shineraybysabel.com.br', 'Shineray@2026!');

    await cluster.seedUser(ownerSession.accessToken, {
      name: 'Ana Financeiro',
      email: 'ana.fin@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'collaborator',
      department: 'Financeiro',
    });
    await cluster.seedUser(ownerSession.accessToken, {
      name: 'Bruno RH',
      email: 'bruno.rh@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'collaborator',
      department: 'RH',
    });

    const finLogin = await cluster.loginAs('ana.fin@shineraybysabel.com.br', 'Password@2026!');
    finColabToken = finLogin.accessToken;

    adminToken = cluster.createUserToken({
      sub: 'f10-admin',
      email: 'admin.f10@shineraybysabel.com.br',
      role: 'admin',
      tenantId: 'tenant-ap3htf6',
      department: 'Tecnologia & Operações',
    });
    managerToken = cluster.createUserToken({
      sub: 'f10-manager',
      email: 'mgr.f10@shineraybysabel.com.br',
      role: 'manager',
      tenantId: 'tenant-ap3htf6',
      department: 'Tecnologia & Operações',
    });
    operatorToken = cluster.createUserToken({
      sub: 'f10-operator',
      email: 'op.f10@shineraybysabel.com.br',
      role: 'operator',
      tenantId: 'tenant-ap3htf6',
      department: 'Tecnologia & Operações',
    });
    viewerToken = cluster.createUserToken({
      sub: 'f10-viewer',
      email: 'view.f10@shineraybysabel.com.br',
      role: 'viewer',
      tenantId: 'tenant-ap3htf6',
      department: 'Tecnologia & Operações',
    });
  }, 45_000);

  afterAll(async () => {
    try {
      if (agent) await agent.stop();
    } finally {
      if (cluster) await cluster.stop();
    }
  }, 45_000);

  async function ensureTenantConnected(token = ownerSession.accessToken, targetAgent = agent) {
    const res = await cluster.apiFetch(token, '/api/v1/storage/connection', {
      method: 'PUT',
      body: {
        providerType: 'agent_node',
        label: 'F10 Corporate Vault',
        endpointUrl: targetAgent.url,
        rootPath: '/',
        hmacToken: targetAgent.hmacToken,
        quotaBytes: targetAgent.quotaBytes,
      },
    });
    expect([200, 201]).toContain(res.status);
  }

  async function signedAgentStat(targetAgent, virtualPath) {
    const query = `/stat?path=${encodeURIComponent(virtualPath)}`;
    const headers = signAgentNodeHeaders({
      hmacToken: targetAgent.hmacToken,
      method: 'GET',
      pathWithQuery: query,
    });
    return fetch(`${targetAgent.url}${query}`, { headers });
  }

  describe('Tier 1 — Corporate Tree, Default ACLs, Idempotency & Incremental Sync', () => {
    it('T1.1 — POST /initialize provisions full corporate tree in VFS and .nexus_versions/.nexus_trash on disk', async () => {
      await ensureTenantConnected();

      const initRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/initialize', {
        method: 'POST',
      });
      expect([200, 201]).toContain(initRes.status);

      const listRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/nodes');
      expect(listRes.status).toBe(200);
      const allNodes = listRes.data?.items || listRes.data?.nodes || [];
      const paths = new Set(allNodes.map((n) => n.virtualPath || n.virtual_path || `/${n.name}`));

      expect(paths.has('/Corporativo-Publico')).toBe(true);
      expect(paths.has('/Setores')).toBe(true);
      expect(paths.has('/Cofre-TI-Infra')).toBe(true);
      expect(paths.has('/Chamados')).toBe(true);
      expect(paths.has('/Espaco-Pessoal')).toBe(true);

      for (const diskDir of [
        '/Corporativo-Publico',
        '/Setores/Financeiro',
        '/Setores/RH',
        '/Cofre-TI-Infra',
        '/Cofre-TI-Infra/Termos',
        '/Chamados',
        '/Espaco-Pessoal/ana.fin@shineraybysabel.com.br',
        '/.nexus_versions',
        '/.nexus_trash',
      ]) {
        const st = await signedAgentStat(agent, diskDir);
        expect(st.status).toBe(200);
        const body = await st.json();
        expect(body.type).toBe('dir');
      }
    });

    it('T1.2 — sets default ACLs across provisioned folders (reader public, editor own sector, none on other sectors/cofre)', async () => {
      await ensureTenantConnected();
      await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/initialize', { method: 'POST' });

      const ownerNodesRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/nodes');
      expect(ownerNodesRes.status).toBe(200);
      const ownerNodes = ownerNodesRes.data?.items || ownerNodesRes.data?.nodes || [];

      const findByPath = (p) => ownerNodes.find((n) => (n.virtualPath || n.virtual_path) === p);
      const publico = findByPath('/Corporativo-Publico');
      const finDir = findByPath('/Setores/Financeiro');
      const vendasDir = findByPath('/Setores/Vendas Concessionária');
      const cofreDir = findByPath('/Cofre-TI-Infra');
      const personalDir = findByPath('/Espaco-Pessoal/ana.fin@shineraybysabel.com.br');

      expect(publico).toBeTruthy();
      expect(finDir).toBeTruthy();
      expect(cofreDir).toBeTruthy();
      expect(personalDir).toBeTruthy();

      const colabNodesRes = await cluster.apiFetch(finColabToken, '/api/v1/storage/nodes');
      expect(colabNodesRes.status).toBe(200);
      const colabNodes = colabNodesRes.data?.items || colabNodesRes.data?.nodes || [];

      expect(colabNodes.some((n) => n.id === publico.id)).toBe(true);
      expect(colabNodes.some((n) => n.id === finDir.id)).toBe(true);
      expect(colabNodes.some((n) => n.id === personalDir.id)).toBe(true);
      expect(colabNodes.some((n) => n.id === cofreDir.id)).toBe(false);
      if (vendasDir) {
        expect(colabNodes.some((n) => n.id === vendasDir.id)).toBe(false);
      }

      // reader on /Corporativo-Publico cannot upload (403)
      const pubForm = new FormData();
      pubForm.append('parentId', publico.id);
      pubForm.append('fileName', 'blocked-pub.txt');
      pubForm.append('file', new Blob(['nope'], { type: 'text/plain' }), 'blocked-pub.txt');
      const pubUpload = await cluster.apiFetch(finColabToken, '/api/v1/storage/upload', {
        method: 'POST',
        body: pubForm,
      });
      expect(pubUpload.status).toBe(403);

      // editor on /Setores/Financeiro can upload (201)
      const finForm = new FormData();
      finForm.append('parentId', finDir.id);
      finForm.append('fileName', 'fin-ok.txt');
      finForm.append('file', new Blob(['fin-data'], { type: 'text/plain' }), 'fin-ok.txt');
      const finUpload = await cluster.apiFetch(finColabToken, '/api/v1/storage/upload', {
        method: 'POST',
        body: finForm,
      });
      expect(finUpload.status).toBe(201);

      // none on /Cofre-TI-Infra blocked (403/404)
      const cofreAccess = await cluster.apiFetch(finColabToken, `/api/v1/storage/nodes?parentId=${cofreDir.id}`);
      expect([403, 404]).toContain(cofreAccess.status);
    });

    it('T1.3 — idempotent re-initialization preserves existing files and custom ACLs without duplicates', async () => {
      await ensureTenantConnected();
      await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/initialize', { method: 'POST' });

      const list1 = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/nodes');
      expect(list1.status).toBe(200);
      const nodes1 = list1.data?.items || list1.data?.nodes || [];
      const publico = nodes1.find((n) => (n.virtualPath || n.virtual_path) === '/Corporativo-Publico');
      expect(publico).toBeTruthy();

      const form = new FormData();
      form.append('parentId', publico.id);
      form.append('fileName', 'manual-idempotent.txt');
      form.append('file', new Blob(['preserve-me'], { type: 'text/plain' }), 'manual-idempotent.txt');
      const upRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/upload', {
        method: 'POST',
        body: form,
      });
      expect(upRes.status).toBe(201);
      const fileId = extractId(upRes.data);

      await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/nodes/${publico.id}/acl`, {
        method: 'PUT',
        body: { rules: [{ targetType: 'department', targetValue: 'RH', accessLevel: 'editor' }] },
      });

      const reInit = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/initialize', { method: 'POST' });
      expect([200, 201]).toContain(reInit.status);

      const list2 = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/nodes');
      expect(list2.status).toBe(200);
      const nodes2 = list2.data?.items || list2.data?.nodes || [];
      const publicoMatches = nodes2.filter((n) => (n.virtualPath || n.virtual_path) === '/Corporativo-Publico');
      expect(publicoMatches).toHaveLength(1);
      expect(publicoMatches[0].id).toBe(publico.id);

      const dl = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/nodes/${fileId}/download`);
      expect(dl.status).toBe(200);
      expect(dl.text).toBe('preserve-me');

      const aclRes = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/nodes/${publico.id}/acl`);
      expect(aclRes.status).toBe(200);
      const rules = aclRes.data?.rules || aclRes.data?.items || [];
      expect(rules.some((r) => r.targetType === 'department' && r.targetValue === 'RH' && r.accessLevel === 'editor')).toBe(
        true,
      );
    });

    it('T1.4 — updates connection initializedAt ISO timestamp after POST /initialize', async () => {
      const token = cluster.createUserToken({
        sub: 'f10-t4-own',
        email: 'f10t4@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f10-t4',
      });
      const localAgent = await startMockAgentNode({ quotaBytes: 20_000_000 });
      try {
        await ensureTenantConnected(token, localAgent);
        const initRes = await cluster.apiFetch(token, '/api/v1/storage/initialize', { method: 'POST' });
        expect([200, 201]).toContain(initRes.status);

        const getConn = await cluster.apiFetch(token, '/api/v1/storage/connection');
        expect(getConn.status).toBe(200);
        const conn = getConn.data?.connection || getConn.data;
        expect(conn?.initializedAt).toBeTruthy();
        expect(Number.isNaN(Date.parse(conn.initializedAt))).toBe(false);
      } finally {
        await localAgent.stop();
      }
    });

    it('T1.5 — incrementally provisions newly seeded department and user personal folder on re-initialize', async () => {
      await ensureTenantConnected();

      await cluster.seedUser(ownerSession.accessToken, {
        name: 'Carlos Juridico',
        email: 'juridico@shineraybysabel.com.br',
        password: 'Password@2026!',
        role: 'collaborator',
        department: 'Juridico',
      });

      const reInit = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/initialize', { method: 'POST' });
      expect([200, 201]).toContain(reInit.status);

      const listRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/nodes');
      expect(listRes.status).toBe(200);
      const nodes = listRes.data?.items || listRes.data?.nodes || [];
      const paths = new Set(nodes.map((n) => n.virtualPath || n.virtual_path));

      expect(paths.has('/Setores/Juridico')).toBe(true);
      expect(paths.has('/Espaco-Pessoal/juridico@shineraybysabel.com.br')).toBe(true);
    });
  });

  describe('Tier 2 — RBAC, Unconfigured/Offline Rollback, Path Safety & Audit', () => {
    it('T2.1 — enforces cloud:connect RBAC on POST /initialize (403 for non-admins; 200/201 for admin)', async () => {
      await ensureTenantConnected();

      for (const actorToken of [finColabToken, viewerToken, operatorToken, managerToken]) {
        const res = await cluster.apiFetch(actorToken, '/api/v1/storage/initialize', { method: 'POST' });
        expect(res.status).toBe(403);
      }

      const adminInit = await cluster.apiFetch(adminToken, '/api/v1/storage/initialize', { method: 'POST' });
      expect([200, 201]).toContain(adminInit.status);
    });

    it('T2.2 — rejects unconfigured tenant POST /initialize with precondition error and zero orphan nodes', async () => {
      const unconfiguredToken = cluster.createUserToken({
        sub: 'f10-unconf-own',
        email: 'unconf@f10.example.com',
        role: 'owner',
        tenantId: 'tenant-f10-unconfigured',
      });

      const initRes = await cluster.apiFetch(unconfiguredToken, '/api/v1/storage/initialize', { method: 'POST' });
      expect([400, 404, 412]).toContain(initRes.status);

      const listRes = await cluster.apiFetch(unconfiguredToken, '/api/v1/storage/nodes');
      if (listRes.status === 200) {
        const items = listRes.data?.items || listRes.data?.nodes || [];
        expect(items).toHaveLength(0);
      }
    });

    it('T2.3 — offline backend during POST /initialize leaves zero phantom nodes and null initializedAt', async () => {
      const offlineToken = cluster.createUserToken({
        sub: 'f10-off-own',
        email: 'offline@f10.example.com',
        role: 'owner',
        tenantId: 'tenant-f10-offline',
      });
      const deadAgent = await startMockAgentNode({ quotaBytes: 10_000_000 });
      await ensureTenantConnected(offlineToken, deadAgent);
      await deadAgent.stop();

      const initRes = await cluster.apiFetch(offlineToken, '/api/v1/storage/initialize', { method: 'POST' });
      expect([502, 503]).toContain(initRes.status);

      const listRes = await cluster.apiFetch(offlineToken, '/api/v1/storage/nodes');
      expect(listRes.status).toBe(200);
      expect(listRes.data?.items || listRes.data?.nodes || []).toHaveLength(0);

      const getConn = await cluster.apiFetch(offlineToken, '/api/v1/storage/connection');
      expect(getConn.status).toBe(200);
      const conn = getConn.data?.connection || getConn.data;
      expect(conn?.initializedAt ?? null).toBeNull();
    });

    it('T2.4 — blocks or sanitizes unsafe traversal department names during initialization', async () => {
      const token = cluster.createUserToken({
        sub: 'f10-trav-own',
        email: 'trav@f10.example.com',
        role: 'owner',
        tenantId: 'tenant-f10-dept-trav',
        department: '../EscapeDept',
      });
      const localAgent = await startMockAgentNode({ quotaBytes: 10_000_000 });
      try {
        await cluster.seedDirectUser({
          name: 'Unsafe Dept User',
          email: 'unsafedept@f10.example.com',
          tenantId: 'tenant-f10-dept-trav',
          department: '../EscapeDept',
          role: 'collaborator',
        });
        await ensureTenantConnected(token, localAgent);

        const initRes = await cluster.apiFetch(token, '/api/v1/storage/initialize', { method: 'POST' });
        expect([200, 201, 400]).toContain(initRes.status);

        const escapeStat = await signedAgentStat(localAgent, '/EscapeDept');
        expect(escapeStat.status).toBe(404);
      } finally {
        await localAgent.stop();
      }
    });

    it('T2.5 — records provisioning event in compliance SHA-256 hash-chain audit', async () => {
      await ensureTenantConnected();
      const initRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/initialize', {
        method: 'POST',
      });
      expect([200, 201]).toContain(initRes.status);

      const integrity = await assertFullAuditIntegrity(cluster.apiFetch, ownerSession.accessToken);
      expect(integrity.apiResult.intact).toBe(true);
      expect(integrity.localResult.valid).toBe(true);

      const event = await expectAuditEvent(cluster.apiFetch, ownerSession.accessToken, {
        actorEmail: 'ti@shineraybysabel.com.br',
      });
      expect(event).toBeTruthy();
    });
  });
});
