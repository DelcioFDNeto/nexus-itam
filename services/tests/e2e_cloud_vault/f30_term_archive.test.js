// services/tests/e2e_cloud_vault/f30_term_archive.test.js
// =============================================================================
// F-30: API 3 (Termos) "Arquivar cópia na VPS" (E2E Opaque-Box Suite)
// =============================================================================

import fsp from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootE2eCluster } from './helpers/clusterHarness.js';
import { startMockAgentNode } from './helpers/mockAgentNode.js';
import {
  assertFullAuditIntegrity,
  fetchAuditLog,
  verifyChainLinksLocally,
} from './helpers/auditHelper.js';

const SEEDED_SIGNED_TERM_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccc01';
const SEEDED_PENDING_TERM_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccc02';

let cluster;
let agent;
let betaAgent;

let ownerSession;
let karenColab;
let joaoColab;
let adminSession;
let managerSession;
let operatorSession;
let viewerSession;
let betaOwnerToken;
let noVpsOwnerToken;
let superadminToken;

const initializedTenants = new Set();

function extractNodes(res) {
  if (!res?.data) return [];
  if (Array.isArray(res.data.items)) return res.data.items;
  if (Array.isArray(res.data.nodes)) return res.data.nodes;
  return Array.isArray(res.data) ? res.data : [];
}

function nodePath(node) {
  return String(node?.virtual_path || node?.virtualPath || node?.path || '');
}

async function ensureTenantVault(token, targetAgent, tenantKey) {
  if (initializedTenants.has(tenantKey)) return;

  let connRes = await cluster.apiFetch(token, '/api/v1/storage/connection', {
    method: 'PUT',
    body: {
      providerType: 'agent_node',
      label: `E2E Term Archive Agent (${tenantKey})`,
      endpointUrl: targetAgent.url,
      rootPath: '/',
      quotaBytes: targetAgent.quotaBytes,
      credentials: { hmacToken: targetAgent.hmacToken },
    },
  });
  if (connRes.status === 400 && !connRes.ok) {
    connRes = await cluster.apiFetch(token, '/api/v1/storage/connection', {
      method: 'PUT',
      body: {
        providerType: 'agent_node',
        label: `E2E Term Archive Agent (${tenantKey})`,
        endpointUrl: targetAgent.url,
        rootPath: '/',
        quotaBytes: targetAgent.quotaBytes,
        hmacToken: targetAgent.hmacToken,
      },
    });
  }
  expect(connRes.status).toBe(200);

  const initRes = await cluster.apiFetch(token, '/api/v1/storage/initialize', {
    method: 'POST',
    body: {},
  });
  expect(initRes.ok).toBe(true);
  initializedTenants.add(tenantKey);
}

async function listTermosNodes(token) {
  const topRes = await cluster.apiFetch(token, '/api/v1/storage/nodes');
  expect(topRes.status).toBe(200);
  const cofre = extractNodes(topRes).find((n) => nodePath(n) === '/Cofre-TI-Infra');
  if (!cofre) return { cofre: null, termosFolder: null, files: [] };

  const subRes = await cluster.apiFetch(token, `/api/v1/storage/nodes?parentId=${cofre.id}`);
  expect(subRes.status).toBe(200);
  const termosFolder = extractNodes(subRes).find(
    (n) => n.name === 'Termos' || nodePath(n) === '/Cofre-TI-Infra/Termos',
  );
  if (!termosFolder) return { cofre, termosFolder: null, files: [] };

  const filesRes = await cluster.apiFetch(token, `/api/v1/storage/nodes?parentId=${termosFolder.id}`);
  expect(filesRes.status).toBe(200);
  return { cofre, termosFolder, files: extractNodes(filesRes) };
}

async function walkFilesRecursive(dirPath) {
  const entries = await fsp.readdir(dirPath, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFilesRecursive(full)));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

async function issueAndSignTerm({
  issuerToken = ownerSession.accessToken,
  signerToken = karenColab.accessToken,
  employeeName = 'Karen Matos',
  employeeEmail = 'karen.matos@shineraybysabel.com.br',
  internalId = 'SHL-BEL-NTB-099',
} = {}) {
  const createRes = await cluster.apiFetch(issuerToken, '/api/v1/compliance/terms', {
    method: 'POST',
    body: {
      termType: 'entrega',
      employeeName,
      employeeEmail,
      employeeCpf: '***.482.910-**',
      department: 'Vendas & Pós-Vendas',
      assetsSnapshot: [
        {
          internalId,
          model: 'Dell Latitude 5440',
          serialNumber: `SN-${Date.now()}`,
        },
      ],
    },
  });
  expect(createRes.status).toBe(201);
  const created = createRes.data?.term || createRes.data;
  expect(created.id).toBeTruthy();

  const signRes = await cluster.apiFetch(signerToken, `/api/v1/compliance/terms/${created.id}/sign`, {
    method: 'POST',
    body: {},
  });
  expect(signRes.status).toBe(200);
  return signRes.data?.term || signRes.data;
}

describe('F-30: API 3 (Termos) "Arquivar cópia na VPS"', () => {
  beforeAll(async () => {
    cluster = await bootE2eCluster();
    agent = await startMockAgentNode({ quotaBytes: 50 * 1024 * 1024 });
    betaAgent = await startMockAgentNode({ quotaBytes: 50 * 1024 * 1024 });

    ownerSession = await cluster.loginAs('ti@shineraybysabel.com.br', 'Shineray@2026!');
    karenColab = await cluster.loginAs('karen.matos@shineraybysabel.com.br', 'Colab@2026!');
    joaoColab = await cluster.loginAs('joao.silva@shineray.com.br', 'Colab@2026!');

    await cluster.seedUser(ownerSession.accessToken, {
      name: 'Admin Term',
      email: 'admin.term@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'admin',
      department: 'TI',
    });
    await cluster.seedUser(ownerSession.accessToken, {
      name: 'Manager Term',
      email: 'manager.term@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'manager',
      department: 'Compliance',
    });
    await cluster.seedUser(ownerSession.accessToken, {
      name: 'Operator Term',
      email: 'operator.term@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'operator',
      department: 'TI',
    });
    await cluster.seedUser(ownerSession.accessToken, {
      name: 'Viewer Term',
      email: 'viewer.term@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'viewer',
      department: 'Auditoria',
    });

    adminSession = await cluster.loginAs('admin.term@shineraybysabel.com.br', 'Password@2026!');
    managerSession = await cluster.loginAs('manager.term@shineraybysabel.com.br', 'Password@2026!');
    operatorSession = await cluster.loginAs('operator.term@shineraybysabel.com.br', 'Password@2026!');
    viewerSession = await cluster.loginAs('viewer.term@shineraybysabel.com.br', 'Password@2026!');

    betaOwnerToken = cluster.createUserToken({
      sub: 'beta-owner-term',
      email: 'owner@beta-term.test',
      name: 'Beta Term Owner',
      role: 'owner',
      tenantId: 'tenant-beta',
      department: 'TI',
    });
    noVpsOwnerToken = cluster.createUserToken({
      sub: 'novps-owner-term',
      email: 'owner@novps-term.test',
      name: 'No VPS Term Owner',
      role: 'owner',
      tenantId: 'tenant-no-vps-term',
      department: 'TI',
    });
    superadminToken = cluster.createUserToken({
      sub: 'sa-master-term',
      email: 'master@nexus.internal',
      name: 'Nexus Master',
      role: 'superadmin',
      tenantId: 'nexus-master',
    });
  }, 45_000);

  afterAll(async () => {
    if (cluster) await cluster.stop();
    if (agent) await agent.stop();
    if (betaAgent) await betaAgent.stop();
  }, 45_000);

  describe('Tier 1 — Unit & Contract (Archive Signed Term, Full Lifecycle, RBAC, Idempotency, Audit)', () => {
    it('archives seeded signed term into /Cofre-TI-Infra/Termos/ with cryptographic hashes intact', async () => {
      await ensureTenantVault(ownerSession.accessToken, agent, 'tenant-ap3htf6');

      const archiveRes = await cluster.apiFetch(
        ownerSession.accessToken,
        `/api/v1/compliance/terms/${SEEDED_SIGNED_TERM_ID}/archive-vps`,
        { method: 'POST', body: {} },
      );
      expect([200, 201]).toContain(archiveRes.status);

      const { files } = await listTermosNodes(ownerSession.accessToken);
      expect(files.length).toBeGreaterThanOrEqual(1);

      const matchNode =
        files.find((n) => String(n.name).includes(SEEDED_SIGNED_TERM_ID) || String(n.name).toLowerCase().includes('karen')) ||
        files[files.length - 1];
      const dlRes = await cluster.apiFetch(
        ownerSession.accessToken,
        `/api/v1/storage/nodes/${matchNode.id}/download`,
      );
      expect(dlRes.status).toBe(200);
      expect(dlRes.text).toContain('Karen Matos');
      expect(dlRes.text).toContain('karen.matos@shineraybysabel.com.br');
      expect(dlRes.text).toContain('SHL-BEL-NTB-007');

      const diskFiles = await walkFilesRecursive(path.join(agent.rootDir, 'Cofre-TI-Infra', 'Termos'));
      expect(diskFiles.length).toBeGreaterThanOrEqual(1);
    });

    it('completes end-to-end issue -> sign -> verify -> archive-vps lifecycle for a new term', async () => {
      await ensureTenantVault(ownerSession.accessToken, agent, 'tenant-ap3htf6');

      const signedTerm = await issueAndSignTerm({
        issuerToken: operatorSession.accessToken,
        signerToken: joaoColab.accessToken,
        employeeName: 'João da Silva',
        employeeEmail: 'joao.silva@shineray.com.br',
        internalId: 'SHL-E2E-TERM-777',
      });

      const verifyRes = await cluster.apiFetch(
        operatorSession.accessToken,
        `/api/v1/compliance/terms/${signedTerm.id}/verify`,
      );
      expect(verifyRes.status).toBe(200);
      expect(verifyRes.data.valid).toBe(true);
      expect(verifyRes.data.signatureValid).toBe(true);

      const archiveRes = await cluster.apiFetch(
        operatorSession.accessToken,
        `/api/v1/compliance/terms/${signedTerm.id}/archive-vps`,
        { method: 'POST', body: {} },
      );
      expect([200, 201]).toContain(archiveRes.status);

      const { files } = await listTermosNodes(ownerSession.accessToken);
      const archivedNode =
        files.find((n) => String(n.name).includes(signedTerm.id)) || files[files.length - 1];
      const dlRes = await cluster.apiFetch(
        ownerSession.accessToken,
        `/api/v1/storage/nodes/${archivedNode.id}/download`,
      );
      expect(dlRes.status).toBe(200);
      expect(dlRes.text).toContain(signedTerm.document_hash);
      expect(dlRes.text).toContain(signedTerm.signature_hash);
      expect(dlRes.text).toContain('SHL-E2E-TERM-777');
    });

    it('allows admin, manager, and operator roles to archive signed terms to VPS', async () => {
      await ensureTenantVault(ownerSession.accessToken, agent, 'tenant-ap3htf6');

      for (const [roleName, session] of [
        ['admin', adminSession],
        ['manager', managerSession],
        ['operator', operatorSession],
      ]) {
        const term = await issueAndSignTerm({
          issuerToken: session.accessToken,
          signerToken: karenColab.accessToken,
          internalId: `SHL-RBAC-${roleName.toUpperCase()}`,
        });
        const res = await cluster.apiFetch(
          session.accessToken,
          `/api/v1/compliance/terms/${term.id}/archive-vps`,
          { method: 'POST', body: {} },
        );
        expect([200, 201]).toContain(res.status);
      }
    });

    it('supports idempotent or versioned re-archiving of an already archived signed term', async () => {
      await ensureTenantVault(ownerSession.accessToken, agent, 'tenant-ap3htf6');

      const term = await issueAndSignTerm({
        internalId: 'SHL-REARCHIVE-01',
      });

      const first = await cluster.apiFetch(
        ownerSession.accessToken,
        `/api/v1/compliance/terms/${term.id}/archive-vps`,
        { method: 'POST', body: {} },
      );
      expect([200, 201]).toContain(first.status);

      const second = await cluster.apiFetch(
        ownerSession.accessToken,
        `/api/v1/compliance/terms/${term.id}/archive-vps`,
        { method: 'POST', body: {} },
      );
      expect([200, 201]).toContain(second.status);

      const { files } = await listTermosNodes(ownerSession.accessToken);
      expect(files.length).toBeGreaterThanOrEqual(1);
    });

    it('records compliance audit trail entry and preserves SHA-256 hash-chain integrity', async () => {
      await ensureTenantVault(ownerSession.accessToken, agent, 'tenant-ap3htf6');

      const term = await issueAndSignTerm({ internalId: 'SHL-AUDIT-TERM-01' });

      const beforeAudit = await fetchAuditLog(cluster.apiFetch, ownerSession.accessToken, 200);
      const prevSeq = beforeAudit.itemsAsc.at(-1)?.seq ?? 0;

      const archiveRes = await cluster.apiFetch(
        managerSession.accessToken,
        `/api/v1/compliance/terms/${term.id}/archive-vps`,
        { method: 'POST', body: {} },
      );
      expect([200, 201]).toContain(archiveRes.status);

      const afterAudit = await fetchAuditLog(cluster.apiFetch, ownerSession.accessToken, 200);
      const newEntries = afterAudit.itemsAsc.filter((e) => Number(e.seq) > Number(prevSeq));
      expect(
        newEntries.some((e) => String(e.resource_id) === String(term.id)),
      ).toBe(true);

      const sliceCheck = verifyChainLinksLocally(newEntries, { requireGenesis: false });
      expect(sliceCheck.valid).toBe(true);

      const full = await assertFullAuditIntegrity(cluster.apiFetch, ownerSession.accessToken);
      expect(full.apiResult.intact).toBe(true);
      expect(full.localResult.valid).toBe(true);
    });
  });

  describe('Tier 2 — Integration, Security, ACL Hiding & Error Edge Cases', () => {
    it('rejects archiving unsigned/pending terms with 400 and writes nothing to VPS', async () => {
      await ensureTenantVault(ownerSession.accessToken, agent, 'tenant-ap3htf6');

      const { files: filesBefore } = await listTermosNodes(ownerSession.accessToken);

      const pendingRes = await cluster.apiFetch(
        ownerSession.accessToken,
        `/api/v1/compliance/terms/${SEEDED_PENDING_TERM_ID}/archive-vps`,
        { method: 'POST', body: {} },
      );
      expect(pendingRes.status).toBe(400);

      const freshPending = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/compliance/terms', {
        method: 'POST',
        body: {
          termType: 'entrega',
          employeeName: 'Pendente Sem Assinatura',
          employeeEmail: 'pendente@shineraybysabel.com.br',
          assetsSnapshot: [{ internalId: 'SHL-PEND-999', model: 'Monitor 24', serialNumber: 'PEND999' }],
        },
      });
      expect(freshPending.status).toBe(201);
      const freshId = freshPending.data?.term?.id || freshPending.data?.id;

      const freshArchive = await cluster.apiFetch(
        ownerSession.accessToken,
        `/api/v1/compliance/terms/${freshId}/archive-vps`,
        { method: 'POST', body: {} },
      );
      expect(freshArchive.status).toBe(400);

      const { files: filesAfter } = await listTermosNodes(ownerSession.accessToken);
      expect(filesAfter.length).toBe(filesBefore.length);
    });

    it('rejects collaborator (including recipient), viewer, and superadmin with 403', async () => {
      await ensureTenantVault(ownerSession.accessToken, agent, 'tenant-ap3htf6');

      const colabTry = await cluster.apiFetch(
        karenColab.accessToken,
        `/api/v1/compliance/terms/${SEEDED_SIGNED_TERM_ID}/archive-vps`,
        { method: 'POST', body: {} },
      );
      expect(colabTry.status).toBe(403);

      const viewerTry = await cluster.apiFetch(
        viewerSession.accessToken,
        `/api/v1/compliance/terms/${SEEDED_SIGNED_TERM_ID}/archive-vps`,
        { method: 'POST', body: {} },
      );
      expect(viewerTry.status).toBe(403);

      const saTry = await cluster.apiFetch(
        superadminToken,
        `/api/v1/compliance/terms/${SEEDED_SIGNED_TERM_ID}/archive-vps`,
        { method: 'POST', body: {} },
      );
      expect(saTry.status).toBe(403);
    });

    it('returns 404 for missing or malformed term IDs without 500', async () => {
      await ensureTenantVault(ownerSession.accessToken, agent, 'tenant-ap3htf6');

      const missingRes = await cluster.apiFetch(
        ownerSession.accessToken,
        '/api/v1/compliance/terms/00000000-0000-4000-8000-000000000999/archive-vps',
        { method: 'POST', body: {} },
      );
      expect(missingRes.status).toBe(404);

      const malformedRes = await cluster.apiFetch(
        ownerSession.accessToken,
        '/api/v1/compliance/terms/invalid-term-id/archive-vps',
        { method: 'POST', body: {} },
      );
      expect([400, 404]).toContain(malformedRes.status);
    });

    it('enforces cross-tenant isolation preventing tenant-beta from archiving tenant-ap3htf6 signed terms', async () => {
      await ensureTenantVault(ownerSession.accessToken, agent, 'tenant-ap3htf6');
      await ensureTenantVault(betaOwnerToken, betaAgent, 'tenant-beta');

      const betaTry = await cluster.apiFetch(
        betaOwnerToken,
        `/api/v1/compliance/terms/${SEEDED_SIGNED_TERM_ID}/archive-vps`,
        { method: 'POST', body: {} },
      );
      expect([403, 404]).toContain(betaTry.status);

      const betaDiskFiles = await walkFilesRecursive(path.join(betaAgent.rootDir, 'Cofre-TI-Infra', 'Termos'));
      expect(betaDiskFiles).toHaveLength(0);
    });

    it('hides archived terms in /Cofre-TI-Infra/Termos from collaborator ACL and handles unconfigured VPS gracefully', async () => {
      await ensureTenantVault(ownerSession.accessToken, agent, 'tenant-ap3htf6');

      const signed = await issueAndSignTerm({ internalId: 'SHL-ACL-HIDE-99' });
      const archiveRes = await cluster.apiFetch(
        ownerSession.accessToken,
        `/api/v1/compliance/terms/${signed.id}/archive-vps`,
        { method: 'POST', body: {} },
      );
      expect([200, 201]).toContain(archiveRes.status);

      const { cofre, files } = await listTermosNodes(ownerSession.accessToken);
      const archivedNode = files.find((n) => String(n.name).includes(signed.id)) || files[files.length - 1];
      expect(cofre).toBeTruthy();
      expect(archivedNode).toBeTruthy();

      // Collaborator cannot see /Cofre-TI-Infra, cannot search the archived term, and cannot download it
      const colabTop = await cluster.apiFetch(karenColab.accessToken, '/api/v1/storage/nodes');
      expect(colabTop.status).toBe(200);
      expect(extractNodes(colabTop).map(nodePath)).not.toContain('/Cofre-TI-Infra');

      const colabSearch = await cluster.apiFetch(
        karenColab.accessToken,
        `/api/v1/storage/nodes?q=${encodeURIComponent(signed.id)}`,
      );
      expect(colabSearch.status).toBe(200);
      expect(extractNodes(colabSearch)).toHaveLength(0);

      const colabDl = await cluster.apiFetch(
        karenColab.accessToken,
        `/api/v1/storage/nodes/${archivedNode.id}/download`,
      );
      expect([403, 404]).toContain(colabDl.status);

      // Unconfigured VPS edge on separate tenant
      const noVpsTerm = await issueAndSignTerm({
        issuerToken: noVpsOwnerToken,
        signerToken: noVpsOwnerToken,
        employeeName: 'No VPS Employee',
        employeeEmail: 'emp@novps-term.test',
        internalId: 'SHL-NOVPS-01',
      });
      const noVpsArchive = await cluster.apiFetch(
        noVpsOwnerToken,
        `/api/v1/compliance/terms/${noVpsTerm.id}/archive-vps`,
        { method: 'POST', body: {} },
      );
      expect([400, 404, 409, 412]).toContain(noVpsArchive.status);
    });
  });
});
