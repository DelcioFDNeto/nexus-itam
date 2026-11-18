// services/tests/e2e_cloud_vault/f29_ticket_archive.test.js
// =============================================================================
// F-29: API 2 (Chamados) "Arquivar cópia na VPS" (E2E Opaque-Box Suite)
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

const SAMPLE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const SAMPLE_PNG_DATA_URL = `data:image/png;base64,${SAMPLE_PNG_BASE64}`;
const SAMPLE_PNG_BUFFER = Buffer.from(SAMPLE_PNG_BASE64, 'base64');

let cluster;
let agent;
let betaAgent;
let tightAgent;

let ownerSession;
let colabSession;
let adminSession;
let managerSession;
let operatorSession;
let viewerSession;
let betaOwnerToken;
let noVpsOwnerToken;
let tightQuotaOwnerToken;
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
      label: `E2E Ticket Archive Agent (${tenantKey})`,
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
        label: `E2E Ticket Archive Agent (${tenantKey})`,
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

async function listFilesUnderProtocol(token, protocol) {
  const topRes = await cluster.apiFetch(token, '/api/v1/storage/nodes');
  expect(topRes.status).toBe(200);
  const chamados = extractNodes(topRes).find((n) => nodePath(n) === '/Chamados');
  if (!chamados) return [];

  const subRes = await cluster.apiFetch(token, `/api/v1/storage/nodes?parentId=${chamados.id}`);
  expect(subRes.status).toBe(200);
  const protoFolder = extractNodes(subRes).find((n) => n.name === protocol || nodePath(n) === `/Chamados/${protocol}`);
  if (!protoFolder) return [];

  const filesRes = await cluster.apiFetch(token, `/api/v1/storage/nodes?parentId=${protoFolder.id}`);
  expect(filesRes.status).toBe(200);
  return extractNodes(filesRes);
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

async function createSampleTicket(token = colabSession.accessToken, extra = {}) {
  const res = await cluster.apiFetch(token, '/api/v1/tickets', {
    method: 'POST',
    body: {
      title: extra.title || 'Falha VPN Filial Barcarena',
      description: extra.description || 'Link IPsec caiu apos atualizacao de firmware.',
      category: 'Infraestrutura & Redes',
      priority: 'high',
      department: 'Vendas & Pós-Vendas',
      assetTag: 'SHL-BEL-NTB-007',
      attachments: extra.attachments || [],
    },
  });
  expect(res.status).toBe(201);
  return res.data;
}

describe('F-29: API 2 (Chamados) "Arquivar cópia na VPS"', () => {
  beforeAll(async () => {
    cluster = await bootE2eCluster();
    agent = await startMockAgentNode({ quotaBytes: 50 * 1024 * 1024 });
    betaAgent = await startMockAgentNode({ quotaBytes: 50 * 1024 * 1024 });
    tightAgent = await startMockAgentNode({ quotaBytes: 250 });

    ownerSession = await cluster.loginAs('ti@shineraybysabel.com.br', 'Shineray@2026!');
    colabSession = await cluster.loginAs('karen.matos@shineraybysabel.com.br', 'Colab@2026!');

    await cluster.seedUser(ownerSession.accessToken, {
      name: 'Admin Archive',
      email: 'admin.tk@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'admin',
      department: 'TI',
    });
    await cluster.seedUser(ownerSession.accessToken, {
      name: 'Manager Archive',
      email: 'manager.tk@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'manager',
      department: 'TI',
    });
    await cluster.seedUser(ownerSession.accessToken, {
      name: 'Operator Archive',
      email: 'operator.tk@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'operator',
      department: 'Suporte',
    });
    await cluster.seedUser(ownerSession.accessToken, {
      name: 'Viewer Archive',
      email: 'viewer.tk@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'viewer',
      department: 'Auditoria',
    });

    adminSession = await cluster.loginAs('admin.tk@shineraybysabel.com.br', 'Password@2026!');
    managerSession = await cluster.loginAs('manager.tk@shineraybysabel.com.br', 'Password@2026!');
    operatorSession = await cluster.loginAs('operator.tk@shineraybysabel.com.br', 'Password@2026!');
    viewerSession = await cluster.loginAs('viewer.tk@shineraybysabel.com.br', 'Password@2026!');

    betaOwnerToken = cluster.createUserToken({
      sub: 'beta-owner-tk',
      email: 'owner@beta-tk.test',
      name: 'Beta Ticket Owner',
      role: 'owner',
      tenantId: 'tenant-beta',
      department: 'TI',
    });
    noVpsOwnerToken = cluster.createUserToken({
      sub: 'novps-owner-tk',
      email: 'owner@novps-tk.test',
      name: 'No VPS Owner',
      role: 'owner',
      tenantId: 'tenant-no-vps-tk',
      department: 'TI',
    });
    tightQuotaOwnerToken = cluster.createUserToken({
      sub: 'tight-owner-tk',
      email: 'owner@tight-tk.test',
      name: 'Tight Quota Owner',
      role: 'owner',
      tenantId: 'tenant-tight-tk',
      department: 'TI',
    });
    superadminToken = cluster.createUserToken({
      sub: 'sa-master-tk',
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
    if (tightAgent) await tightAgent.stop();
  }, 45_000);

  describe('Tier 1 — Unit & Contract (Archive Summary, Binary Attachments, RBAC, Idempotency, Audit)', () => {
    it('archives ticket summary with comments and resolution notes into /Chamados/{protocol}/', async () => {
      await ensureTenantVault(ownerSession.accessToken, agent, 'tenant-ap3htf6');

      const ticket = await createSampleTicket(colabSession.accessToken, {
        title: 'Erro Impressora Fiscal Recepção',
        description: 'Impressora nao responde na porta USB apos troca de cabo.',
      });

      const commentRes = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/tickets/${ticket.id}/comments`, {
        method: 'POST',
        body: { message: 'Driver reinstalado e fila limpa com sucesso.' },
      });
      expect(commentRes.status).toBe(201);

      const resolveRes = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/tickets/${ticket.id}/status`, {
        method: 'PATCH',
        body: {
          status: 'resolved',
          resolutionNotes: 'Substituido cabo USB e testada emissao de cupom.',
        },
      });
      expect(resolveRes.status).toBe(200);

      const archiveRes = await cluster.apiFetch(
        ownerSession.accessToken,
        `/api/v1/tickets/${ticket.id}/archive-vps`,
        { method: 'POST', body: {} },
      );
      expect([200, 201]).toContain(archiveRes.status);

      const archivedFiles = await listFilesUnderProtocol(ownerSession.accessToken, ticket.protocol);
      expect(archivedFiles.length).toBeGreaterThanOrEqual(1);

      const summaryNode =
        archivedFiles.find((n) => !String(n.name).toLowerCase().endsWith('.png')) || archivedFiles[0];
      const dlRes = await cluster.apiFetch(
        ownerSession.accessToken,
        `/api/v1/storage/nodes/${summaryNode.id}/download`,
      );
      expect(dlRes.status).toBe(200);
      expect(dlRes.text).toContain(ticket.protocol);
      expect(dlRes.text).toContain('Erro Impressora Fiscal');
      expect(dlRes.text).toContain('Driver reinstalado');
      expect(dlRes.text).toContain('Substituido cabo USB');
    });

    it('archives ticket and comment image attachments as intact binaries on VPS storage', async () => {
      await ensureTenantVault(ownerSession.accessToken, agent, 'tenant-ap3htf6');

      const ticket = await createSampleTicket(colabSession.accessToken, {
        title: 'Evidencia VPN com Anexos',
        description: 'Anexando captura de erro do cliente VPN.',
        attachments: [{ name: 'evidencia-vpn.png', dataUrl: SAMPLE_PNG_DATA_URL }],
      });

      const commentRes = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/tickets/${ticket.id}/comments`, {
        method: 'POST',
        body: {
          message: 'Captura apos restabelecimento do tunel.',
          attachments: [{ name: 'validacao-tunel.png', dataUrl: SAMPLE_PNG_DATA_URL }],
        },
      });
      expect(commentRes.status).toBe(201);

      const archiveRes = await cluster.apiFetch(
        ownerSession.accessToken,
        `/api/v1/tickets/${ticket.id}/archive-vps`,
        { method: 'POST', body: {} },
      );
      expect([200, 201]).toContain(archiveRes.status);

      const archivedFiles = await listFilesUnderProtocol(ownerSession.accessToken, ticket.protocol);
      const pngNodes = archivedFiles.filter((n) => String(n.name).toLowerCase().endsWith('.png'));
      expect(pngNodes.length).toBeGreaterThanOrEqual(2);

      for (const pngNode of pngNodes) {
        const dlRes = await cluster.apiFetch(
          ownerSession.accessToken,
          `/api/v1/storage/nodes/${pngNode.id}/download`,
        );
        expect(dlRes.status).toBe(200);
        expect(Buffer.compare(dlRes.buffer, SAMPLE_PNG_BUFFER)).toBe(0);
      }

      const diskFiles = await walkFilesRecursive(path.join(agent.rootDir, 'Chamados', ticket.protocol));
      expect(diskFiles.length).toBeGreaterThanOrEqual(3);
    });

    it('allows admin, manager, and operator roles to archive tickets to VPS', async () => {
      await ensureTenantVault(ownerSession.accessToken, agent, 'tenant-ap3htf6');

      for (const [roleName, session] of [
        ['admin', adminSession],
        ['manager', managerSession],
        ['operator', operatorSession],
      ]) {
        const tk = await createSampleTicket(colabSession.accessToken, {
          title: `Ticket RBAC ${roleName}`,
          description: `Validando permissao de arquivamento para ${roleName}.`,
        });
        const res = await cluster.apiFetch(
          session.accessToken,
          `/api/v1/tickets/${tk.id}/archive-vps`,
          { method: 'POST', body: {} },
        );
        expect([200, 201]).toContain(res.status);
      }
    });

    it('supports re-archiving a ticket after new updates without 409/500 failure', async () => {
      await ensureTenantVault(ownerSession.accessToken, agent, 'tenant-ap3htf6');

      const ticket = await createSampleTicket(colabSession.accessToken, {
        title: 'Ticket Re-Arquivo',
        description: 'Primeiro arquivamento antes do fechamento.',
      });

      const firstArchive = await cluster.apiFetch(
        ownerSession.accessToken,
        `/api/v1/tickets/${ticket.id}/archive-vps`,
        { method: 'POST', body: {} },
      );
      expect([200, 201]).toContain(firstArchive.status);

      await cluster.apiFetch(ownerSession.accessToken, `/api/v1/tickets/${ticket.id}/comments`, {
        method: 'POST',
        body: { message: 'Comentario pos-primeiro-arquivo.' },
      });
      await cluster.apiFetch(ownerSession.accessToken, `/api/v1/tickets/${ticket.id}/status`, {
        method: 'PATCH',
        body: { status: 'closed', resolutionNotes: 'Encerrado definitivamente.' },
      });

      const secondArchive = await cluster.apiFetch(
        ownerSession.accessToken,
        `/api/v1/tickets/${ticket.id}/archive-vps`,
        { method: 'POST', body: {} },
      );
      expect([200, 201]).toContain(secondArchive.status);

      const files = await listFilesUnderProtocol(ownerSession.accessToken, ticket.protocol);
      const summaryNode = files.find((n) => !String(n.name).toLowerCase().endsWith('.png')) || files[0];
      const dlRes = await cluster.apiFetch(
        ownerSession.accessToken,
        `/api/v1/storage/nodes/${summaryNode.id}/download`,
      );
      expect(dlRes.status).toBe(200);
      expect(dlRes.text).toContain('Comentario pos-primeiro-arquivo.');
    });

    it('records compliance audit event and preserves SHA-256 hash-chain integrity', async () => {
      await ensureTenantVault(ownerSession.accessToken, agent, 'tenant-ap3htf6');

      const beforeAudit = await fetchAuditLog(cluster.apiFetch, ownerSession.accessToken, 200);
      const prevSeq = beforeAudit.itemsAsc.at(-1)?.seq ?? 0;

      const ticket = await createSampleTicket(colabSession.accessToken, {
        title: 'Ticket Auditoria Chain',
        description: 'Validando gravacao de log SHA-256 no compliance.',
      });

      const archiveRes = await cluster.apiFetch(
        operatorSession.accessToken,
        `/api/v1/tickets/${ticket.id}/archive-vps`,
        { method: 'POST', body: {} },
      );
      expect([200, 201]).toContain(archiveRes.status);

      const afterAudit = await fetchAuditLog(cluster.apiFetch, ownerSession.accessToken, 200);
      const newEntries = afterAudit.itemsAsc.filter((e) => Number(e.seq) > Number(prevSeq));
      expect(
        newEntries.some(
          (e) =>
            String(e.resource_id) === String(ticket.id) ||
            JSON.stringify(e.payload || {}).includes(ticket.protocol),
        ),
      ).toBe(true);

      const sliceCheck = verifyChainLinksLocally(newEntries, { requireGenesis: false });
      expect(sliceCheck.valid).toBe(true);

      const full = await assertFullAuditIntegrity(cluster.apiFetch, ownerSession.accessToken);
      expect(full.apiResult.intact).toBe(true);
      expect(full.localResult.valid).toBe(true);
    });
  });

  describe('Tier 2 — Integration, Security, Multitenancy & Error Edge Cases', () => {
    it('rejects collaborator (even ticket requester), viewer, and superadmin with 403', async () => {
      await ensureTenantVault(ownerSession.accessToken, agent, 'tenant-ap3htf6');

      const ticket = await createSampleTicket(colabSession.accessToken, {
        title: 'Ticket Bloqueio RBAC',
        description: 'Solicitante colaborador nao pode arquivar na VPS.',
      });

      const colabTry = await cluster.apiFetch(
        colabSession.accessToken,
        `/api/v1/tickets/${ticket.id}/archive-vps`,
        { method: 'POST', body: {} },
      );
      expect(colabTry.status).toBe(403);

      const viewerTry = await cluster.apiFetch(
        viewerSession.accessToken,
        `/api/v1/tickets/${ticket.id}/archive-vps`,
        { method: 'POST', body: {} },
      );
      expect(viewerTry.status).toBe(403);

      const saTry = await cluster.apiFetch(
        superadminToken,
        `/api/v1/tickets/${ticket.id}/archive-vps`,
        { method: 'POST', body: {} },
      );
      expect(saTry.status).toBe(403);

      const files = await listFilesUnderProtocol(ownerSession.accessToken, ticket.protocol);
      expect(files).toHaveLength(0);
    });

    it('returns 404 for non-existent or malformed ticket IDs without 500', async () => {
      await ensureTenantVault(ownerSession.accessToken, agent, 'tenant-ap3htf6');

      const missingUuid = await cluster.apiFetch(
        ownerSession.accessToken,
        '/api/v1/tickets/00000000-0000-4000-8000-000000000999/archive-vps',
        { method: 'POST', body: {} },
      );
      expect(missingUuid.status).toBe(404);

      const malformedId = await cluster.apiFetch(
        ownerSession.accessToken,
        '/api/v1/tickets/not-a-valid-uuid/archive-vps',
        { method: 'POST', body: {} },
      );
      expect([400, 404]).toContain(malformedId.status);
    });

    it('enforces cross-tenant isolation preventing tenant-beta from archiving tenant-ap3htf6 ticket', async () => {
      await ensureTenantVault(ownerSession.accessToken, agent, 'tenant-ap3htf6');
      await ensureTenantVault(betaOwnerToken, betaAgent, 'tenant-beta');

      const ticket = await createSampleTicket(colabSession.accessToken, {
        title: 'Ticket Isolamento Multitenant',
        description: 'Nao deve vazar para tenant-beta.',
      });

      const betaAttempt = await cluster.apiFetch(
        betaOwnerToken,
        `/api/v1/tickets/${ticket.id}/archive-vps`,
        { method: 'POST', body: {} },
      );
      expect([403, 404]).toContain(betaAttempt.status);

      const betaDiskFiles = await walkFilesRecursive(path.join(betaAgent.rootDir, 'Chamados'));
      expect(betaDiskFiles).toHaveLength(0);
    });

    it('returns clean client error (400/404/409/412) when tenant has no VPS connection configured', async () => {
      await ensureTenantVault(ownerSession.accessToken, agent, 'tenant-ap3htf6');

      const noVpsTicket = await createSampleTicket(noVpsOwnerToken, {
        title: 'Ticket Sem VPS Configurada',
        description: 'Tenant ainda nao conectou VPS.',
      });

      const archiveRes = await cluster.apiFetch(
        noVpsOwnerToken,
        `/api/v1/tickets/${noVpsTicket.id}/archive-vps`,
        { method: 'POST', body: {} },
      );
      expect([400, 404, 409, 412]).toContain(archiveRes.status);
    });

    it('enforces storage quota (413/403/400) when archiving ticket exceeds tight tenant quota', async () => {
      await ensureTenantVault(tightQuotaOwnerToken, tightAgent, 'tenant-tight-tk');

      const tightTicket = await createSampleTicket(tightQuotaOwnerToken, {
        title: 'Ticket Excede Cota Tight',
        description: 'Descricao detalhada '.repeat(25),
        attachments: [{ name: 'big-evidencia.png', dataUrl: SAMPLE_PNG_DATA_URL }],
      });

      const archiveRes = await cluster.apiFetch(
        tightQuotaOwnerToken,
        `/api/v1/tickets/${tightTicket.id}/archive-vps`,
        { method: 'POST', body: {} },
      );
      expect([400, 403, 413]).toContain(archiveRes.status);

      const full = await assertFullAuditIntegrity(cluster.apiFetch, ownerSession.accessToken);
      expect(full.apiResult.intact).toBe(true);
    });
  });
});
