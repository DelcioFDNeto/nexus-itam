// services/tests/e2e_cloud_vault/f02_schema_repo.test.js
// =============================================================================
// F-02: Schema storage_svc & storageRepo Persistence — Opaque-Box Tests
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootE2eCluster } from './helpers/clusterHarness.js';
import { startMockAgentNode } from './helpers/mockAgentNode.js';

const SERVICES_DIR = path.resolve(import.meta.dirname, '../..');

function extractId(payload) {
  return payload?.id ?? payload?.node?.id ?? payload?.data?.id ?? payload?.sheet?.id ?? payload?.link?.id;
}

describe('F-02: Schema storage_svc & storageRepo Persistence', () => {
  let cluster;
  let agent;
  let ownerSession;

  beforeAll(async () => {
    cluster = await bootE2eCluster();
    agent = await startMockAgentNode({ quotaBytes: 50 * 1024 * 1024 });
    ownerSession = await cluster.loginAs('ti@shineraybysabel.com.br', 'Shineray@2026!');
  }, 45_000);

  afterAll(async () => {
    try {
      if (agent) await agent.stop();
    } finally {
      if (cluster) await cluster.stop();
    }
  }, 45_000);

  async function ensureAgentConnection(token, overrides = {}) {
    const res = await cluster.apiFetch(token, '/api/v1/storage/connection', {
      method: 'PUT',
      body: {
        providerType: 'agent_node',
        label: 'F02 Test Node',
        endpointUrl: agent.url,
        rootPath: '/',
        hmacToken: agent.hmacToken,
        quotaBytes: 10 * 1024 * 1024,
        ...overrides,
      },
    });
    expect([200, 201]).toContain(res.status);
    return res.data;
  }

  describe('Tier 1 — DDL Schema & Opaque-Box Entity Persistence', () => {
    it('T1.1 — services/shared/init.sql declares storage_svc schema and all 7 tables', () => {
      const sql = fs.readFileSync(path.join(SERVICES_DIR, 'shared/init.sql'), 'utf8');

      expect(sql).toMatch(/CREATE\s+SCHEMA\s+IF\s+NOT\s+EXISTS\s+storage_svc\s*;/i);

      const requiredTables = [
        'vps_connections',
        'storage_nodes',
        'storage_acls',
        'storage_versions',
        'storage_temp_links',
        'sheet_sessions',
        'sheet_cell_history',
      ];
      for (const table of requiredTables) {
        expect(sql).toMatch(new RegExp(`CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+storage_svc\\.${table}\\b`, 'i'));
      }
    });

    it('T1.2 — init.sql enforces enums, CHECK constraints, partial unique active path index, and cascades', () => {
      const sql = fs.readFileSync(path.join(SERVICES_DIR, 'shared/init.sql'), 'utf8');

      expect(sql).toMatch(/provider_type[^;]*IN\s*\(\s*'sftp'\s*,\s*'agent_node'\s*,\s*'s3'\s*,\s*'webdav'\s*\)/i);
      expect(sql).toMatch(/node_type[^;]*IN\s*\(\s*'folder'\s*,\s*'file'\s*,\s*'spreadsheet'\s*\)/i);
      expect(sql).toMatch(
        /access_level[^;]*IN\s*\(\s*'none'\s*,\s*'viewer_online'\s*,\s*'reader'\s*,\s*'editor'\s*,\s*'full_control'\s*\)/i,
      );
      expect(sql).toMatch(/uq_storage_nodes_active_path[\s\S]*WHERE\s+is_trashed\s*=\s*FALSE/i);
      expect(sql).toMatch(/ON\s+DELETE\s+CASCADE/i);
      expect(sql).toMatch(/CHECK\s*\(\s*quota_bytes\s*>=\s*0\s*\)/i);
      expect(sql).toMatch(/CHECK\s*\(\s*used_bytes\s*>=\s*0\s*\)/i);
    });

    it('T1.3 — persists and retrieves vps_connections via PUT and GET /api/v1/storage/connection', async () => {
      const t3Token = cluster.createUserToken({
        sub: 'f02-t3-owner',
        email: 'f02t3@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f02-t3',
      });

      await ensureAgentConnection(t3Token, {
        label: 'Node T1.3',
        quotaBytes: 10_485_760,
      });

      const getRes = await cluster.apiFetch(t3Token, '/api/v1/storage/connection');
      expect(getRes.status).toBe(200);
      const conn = getRes.data?.connection || getRes.data;
      expect(conn?.providerType).toBe('agent_node');
      expect(conn?.label).toBe('Node T1.3');
      expect(Number(conn?.quotaBytes)).toBe(10_485_760);
      expect(Number(conn?.usedBytes ?? 0)).toBe(0);
    });

    it('T1.4 — persists storage_nodes (folder + uploaded file) and storage_acls via Gateway REST API', async () => {
      const token = cluster.createUserToken({
        sub: 'f02-t4-owner',
        email: 'f02t4@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f02-t4',
      });
      await ensureAgentConnection(token);

      const folderRes = await cluster.apiFetch(token, '/api/v1/storage/folders', {
        method: 'POST',
        body: { parentId: null, name: 'RepoTestT4', departmentScope: 'TI' },
      });
      expect(folderRes.status).toBe(201);
      const folderId = extractId(folderRes.data);
      expect(folderId).toBeTruthy();

      const form = new FormData();
      form.append('parentId', folderId);
      form.append('fileName', 'doc-t4.txt');
      form.append('file', new Blob(['hello-f02-t4'], { type: 'text/plain' }), 'doc-t4.txt');

      const uploadRes = await cluster.apiFetch(token, '/api/v1/storage/upload', {
        method: 'POST',
        body: form,
      });
      expect(uploadRes.status).toBe(201);
      const fileId = extractId(uploadRes.data);
      expect(fileId).toBeTruthy();

      const aclPut = await cluster.apiFetch(token, `/api/v1/storage/nodes/${folderId}/acl`, {
        method: 'PUT',
        body: {
          rules: [{ targetType: 'department', targetValue: 'TI', accessLevel: 'editor' }],
        },
      });
      expect([200, 201]).toContain(aclPut.status);

      const listRes = await cluster.apiFetch(token, `/api/v1/storage/nodes?parentId=${folderId}`);
      expect(listRes.status).toBe(200);
      const items = listRes.data?.items || listRes.data?.nodes || [];
      expect(items.some((n) => n.name === 'doc-t4.txt' && n.id === fileId)).toBe(true);

      const aclGet = await cluster.apiFetch(token, `/api/v1/storage/nodes/${folderId}/acl`);
      expect(aclGet.status).toBe(200);
      const rules = aclGet.data?.rules || aclGet.data?.items || [];
      expect(
        rules.some(
          (r) => r.targetType === 'department' && r.targetValue === 'TI' && r.accessLevel === 'editor',
        ),
      ).toBe(true);
    });

    it('T1.5 — persists storage_versions, storage_temp_links, and sheet_sessions via Gateway REST API', async () => {
      const token = cluster.createUserToken({
        sub: 'f02-t5-owner',
        email: 'f02t5@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f02-t5',
      });
      await ensureAgentConnection(token);

      const folderRes = await cluster.apiFetch(token, '/api/v1/storage/folders', {
        method: 'POST',
        body: { parentId: null, name: 'RepoTestT5' },
      });
      expect(folderRes.status).toBe(201);
      const folderId = extractId(folderRes.data);

      const uploadV1 = new FormData();
      uploadV1.append('parentId', folderId);
      uploadV1.append('fileName', 'versioned.txt');
      uploadV1.append('file', new Blob(['version-1-bytes'], { type: 'text/plain' }), 'versioned.txt');
      const r1 = await cluster.apiFetch(token, '/api/v1/storage/upload', { method: 'POST', body: uploadV1 });
      expect(r1.status).toBe(201);
      const fileId = extractId(r1.data);

      const uploadV2 = new FormData();
      uploadV2.append('parentId', folderId);
      uploadV2.append('fileName', 'versioned.txt');
      uploadV2.append('conflictPolicy', 'version');
      uploadV2.append('file', new Blob(['version-2-bytes-updated'], { type: 'text/plain' }), 'versioned.txt');
      const r2 = await cluster.apiFetch(token, '/api/v1/storage/upload', { method: 'POST', body: uploadV2 });
      expect([200, 201]).toContain(r2.status);

      const versRes = await cluster.apiFetch(token, `/api/v1/storage/nodes/${fileId}/versions`);
      expect(versRes.status).toBe(200);
      const versions = versRes.data?.versions || versRes.data?.items || [];
      expect(versions.length).toBeGreaterThanOrEqual(2);

      const linkRes = await cluster.apiFetch(token, '/api/v1/storage/links', {
        method: 'POST',
        body: { nodeId: fileId, expiresInMinutes: 60 },
      });
      expect(linkRes.status).toBe(201);
      const linkId = extractId(linkRes.data);

      const linksList = await cluster.apiFetch(token, '/api/v1/storage/links');
      expect(linksList.status).toBe(200);
      const links = linksList.data?.links || linksList.data?.items || [];
      expect(links.some((l) => l.id === linkId || l.nodeId === fileId)).toBe(true);

      const sheetCreate = await cluster.apiFetch(token, '/api/v1/storage/sheets', {
        method: 'POST',
        body: { parentId: folderId, name: 'F02Plan.xlsx' },
      });
      expect(sheetCreate.status).toBe(201);
      const sheetId = extractId(sheetCreate.data);

      const sheetGet = await cluster.apiFetch(token, `/api/v1/storage/sheets/${sheetId}`);
      expect(sheetGet.status).toBe(200);
      expect(sheetGet.data?.id).toBe(sheetId);
      expect(sheetGet.data?.rev).toBe(1);
      expect(Array.isArray(sheetGet.data?.sheets)).toBe(true);
    });
  });

  describe('Tier 2 — Constraints, Partial Updates & Tenant Isolation', () => {
    it('T2.1 — enforces active path uniqueness (409) and allows reuse after soft-delete', async () => {
      const token = cluster.createUserToken({
        sub: 'f02-t6-owner',
        email: 'f02t6@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f02-t6',
      });
      await ensureAgentConnection(token);

      const first = await cluster.apiFetch(token, '/api/v1/storage/folders', {
        method: 'POST',
        body: { parentId: null, name: 'UniqueDir' },
      });
      expect(first.status).toBe(201);
      const dirId = extractId(first.data);

      const dup = await cluster.apiFetch(token, '/api/v1/storage/folders', {
        method: 'POST',
        body: { parentId: null, name: 'UniqueDir' },
      });
      expect(dup.status).toBe(409);

      const del = await cluster.apiFetch(token, `/api/v1/storage/nodes/${dirId}`, { method: 'DELETE' });
      expect([200, 204]).toContain(del.status);

      const recreated = await cluster.apiFetch(token, '/api/v1/storage/folders', {
        method: 'POST',
        body: { parentId: null, name: 'UniqueDir' },
      });
      expect(recreated.status).toBe(201);
    });

    it('T2.2 — rejects invalid connection constraints and nonexistent/invalid parentId (400/404)', async () => {
      const token = cluster.createUserToken({
        sub: 'f02-t7-owner',
        email: 'f02t7@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f02-t7',
      });
      await ensureAgentConnection(token);

      const badQuota = await cluster.apiFetch(token, '/api/v1/storage/connection', {
        method: 'PUT',
        body: { providerType: 'agent_node', endpointUrl: agent.url, hmacToken: agent.hmacToken, quotaBytes: -100 },
      });
      expect(badQuota.status).toBe(400);

      const badPort = await cluster.apiFetch(token, '/api/v1/storage/connection', {
        method: 'PUT',
        body: { providerType: 'sftp', host: '127.0.0.1', port: 70000, username: 'u', password: 'p' },
      });
      expect(badPort.status).toBe(400);

      const missingParent = await cluster.apiFetch(token, '/api/v1/storage/folders', {
        method: 'POST',
        body: { parentId: '00000000-0000-4000-8000-000000000999', name: 'Orphan' },
      });
      expect([400, 404]).toContain(missingParent.status);

      const form = new FormData();
      form.append('fileName', 'not-a-folder.txt');
      form.append('file', new Blob(['abc'], { type: 'text/plain' }), 'not-a-folder.txt');
      const fileRes = await cluster.apiFetch(token, '/api/v1/storage/upload', { method: 'POST', body: form });
      expect(fileRes.status).toBe(201);
      const fileId = extractId(fileRes.data);

      const fileAsParent = await cluster.apiFetch(token, '/api/v1/storage/folders', {
        method: 'POST',
        body: { parentId: fileId, name: 'SubUnderFile' },
      });
      expect([400, 404, 409]).toContain(fileAsParent.status);
    });

    it('T2.3 — partial PUT /connection preserves omitted fields and encrypted credentials', async () => {
      const token = cluster.createUserToken({
        sub: 'f02-t8-owner',
        email: 'f02t8@iso.example.com',
        role: 'owner',
        tenantId: 'tenant-f02-t8',
      });
      await ensureAgentConnection(token, { label: 'Primary', quotaBytes: 5_000_000 });

      const partial = await cluster.apiFetch(token, '/api/v1/storage/connection', {
        method: 'PUT',
        body: { label: 'Updated Label', quotaBytes: 8_000_000 },
      });
      expect([200, 201]).toContain(partial.status);

      const getRes = await cluster.apiFetch(token, '/api/v1/storage/connection');
      expect(getRes.status).toBe(200);
      const conn = getRes.data?.connection || getRes.data;
      expect(conn?.providerType).toBe('agent_node');
      expect(conn?.endpointUrl).toBe(agent.url);
      expect(conn?.label).toBe('Updated Label');
      expect(Number(conn?.quotaBytes)).toBe(8_000_000);

      const testRes = await cluster.apiFetch(token, '/api/v1/storage/connection/test', { method: 'POST' });
      expect(testRes.status).toBe(200);
      expect(testRes.data?.ok).toBe(true);
    });

    it('T2.4 — enforces strict cross-tenant isolation across persisted nodes, ACLs, versions, and sheets', async () => {
      const alphaToken = cluster.createUserToken({
        sub: 'f02-alpha-own',
        email: 'alpha@f02.example.com',
        role: 'owner',
        tenantId: 'tenant-f02-alpha',
      });
      const betaToken = cluster.createUserToken({
        sub: 'f02-beta-own',
        email: 'beta@f02.example.com',
        role: 'owner',
        tenantId: 'tenant-f02-beta',
      });

      await ensureAgentConnection(alphaToken, { label: 'Alpha Conn' });
      await ensureAgentConnection(betaToken, { label: 'Beta Conn' });

      const alphaFolder = await cluster.apiFetch(alphaToken, '/api/v1/storage/folders', {
        method: 'POST',
        body: { parentId: null, name: 'SharedName' },
      });
      expect(alphaFolder.status).toBe(201);
      const alphaFolderId = extractId(alphaFolder.data);

      const alphaSheet = await cluster.apiFetch(alphaToken, '/api/v1/storage/sheets', {
        method: 'POST',
        body: { parentId: alphaFolderId, name: 'AlphaSheet.xlsx' },
      });
      expect(alphaSheet.status).toBe(201);
      const alphaSheetId = extractId(alphaSheet.data);

      const betaFolder = await cluster.apiFetch(betaToken, '/api/v1/storage/folders', {
        method: 'POST',
        body: { parentId: null, name: 'SharedName' },
      });
      expect(betaFolder.status).toBe(201);

      const betaList = await cluster.apiFetch(betaToken, '/api/v1/storage/nodes');
      expect(betaList.status).toBe(200);
      const betaItems = betaList.data?.items || betaList.data?.nodes || [];
      expect(betaItems.some((n) => n.id === alphaFolderId || n.id === alphaSheetId)).toBe(false);

      const crossAcl = await cluster.apiFetch(betaToken, `/api/v1/storage/nodes/${alphaFolderId}/acl`);
      expect([403, 404]).toContain(crossAcl.status);

      const crossVers = await cluster.apiFetch(betaToken, `/api/v1/storage/nodes/${alphaFolderId}/versions`);
      expect([403, 404]).toContain(crossVers.status);

      const crossSheet = await cluster.apiFetch(betaToken, `/api/v1/storage/sheets/${alphaSheetId}`);
      expect([403, 404]).toContain(crossSheet.status);
    });

    it('T2.5 — canonical tenant alias (shineray <-> tenant-ap3htf6) shares persisted connection and nodes', async () => {
      await ensureAgentConnection(ownerSession.accessToken, { label: 'Shineray Canonical' });

      const aliasToken = cluster.createUserToken({
        sub: 'f02-alias-owner',
        email: 'alias@shineraybysabel.com.br',
        role: 'owner',
        tenantId: 'shineray',
      });

      const aliasConn = await cluster.apiFetch(aliasToken, '/api/v1/storage/connection');
      expect(aliasConn.status).toBe(200);
      const conn = aliasConn.data?.connection || aliasConn.data;
      expect(conn?.label).toBe('Shineray Canonical');

      const createdByAlias = await cluster.apiFetch(aliasToken, '/api/v1/storage/folders', {
        method: 'POST',
        body: { parentId: null, name: 'AliasCreatedDir' },
      });
      expect(createdByAlias.status).toBe(201);
      const aliasDirId = extractId(createdByAlias.data);

      const ownerNodes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/nodes');
      expect(ownerNodes.status).toBe(200);
      const items = ownerNodes.data?.items || ownerNodes.data?.nodes || [];
      expect(items.some((n) => n.id === aliasDirId && n.name === 'AliasCreatedDir')).toBe(true);
    });
  });
});
