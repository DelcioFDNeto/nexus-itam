// services/tests/e2e_cloud_vault/f26_sheets_autosave_history.test.js
// =============================================================================
// F-26: Per-Cell Change History & 2s Debounced Auto-Save on VPS (E2E Suite)
// =============================================================================

import * as XLSX from 'xlsx';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { bootE2eCluster } from './helpers/clusterHarness.js';
import { startMockAgentNode } from './helpers/mockAgentNode.js';
import { assertFullAuditIntegrity } from './helpers/auditHelper.js';

let cluster;
let agent;
let tightAgent;
let ownerSession;
let editorColab;
let betaOwnerToken;

const initializedTenants = new Set();
const openedSockets = [];

function trackSocket(wsClient) {
  openedSockets.push(wsClient);
  return wsClient;
}

function payloadOf(frame) {
  return frame?.data && typeof frame.data === 'object' ? frame.data : frame;
}

function extractNodes(res) {
  if (!res?.data) return [];
  if (Array.isArray(res.data.items)) return res.data.items;
  if (Array.isArray(res.data.nodes)) return res.data.nodes;
  return Array.isArray(res.data) ? res.data : [];
}

function extractHistory(res) {
  if (!res?.data) return [];
  if (Array.isArray(res.data.history)) return res.data.history;
  if (Array.isArray(res.data.items)) return res.data.items;
  return Array.isArray(res.data) ? res.data : [];
}

async function ensureTenantVault(token, targetAgent, tenantKey) {
  if (initializedTenants.has(tenantKey)) return;

  let connRes = await cluster.apiFetch(token, '/api/v1/storage/connection', {
    method: 'PUT',
    body: {
      providerType: 'agent_node',
      label: `E2E AutoSave Agent (${tenantKey})`,
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
        label: `E2E AutoSave Agent (${tenantKey})`,
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

async function createSheetInFinanceiro(name = `AutoSave-${Date.now()}.xlsx`, token = ownerSession.accessToken, targetAgent = agent, tenantKey = 'tenant-ap3htf6') {
  await ensureTenantVault(token, targetAgent, tenantKey);

  const topRes = await cluster.apiFetch(token, '/api/v1/storage/nodes');
  expect(topRes.status).toBe(200);
  const top = extractNodes(topRes);
  const setores = top.find((n) => (n.virtual_path || n.virtualPath || n.path) === '/Setores');
  const pub = top.find((n) => (n.virtual_path || n.virtualPath || n.path) === '/Corporativo-Publico');

  let parentId = pub?.id;
  if (setores && tenantKey === 'tenant-ap3htf6') {
    const secRes = await cluster.apiFetch(token, `/api/v1/storage/nodes?parentId=${setores.id}`);
    expect(secRes.status).toBe(200);
    let fin = extractNodes(secRes).find((n) => n.name === 'Financeiro');
    if (!fin) {
      const mkFin = await cluster.apiFetch(token, '/api/v1/storage/folders', {
        method: 'POST',
        body: { parentId: setores.id, name: 'Financeiro' },
      });
      expect([200, 201]).toContain(mkFin.status);
      fin = mkFin.data?.node || mkFin.data?.folder || mkFin.data;
    }
    parentId = fin.id;
  }

  const createRes = await cluster.apiFetch(token, '/api/v1/storage/sheets', {
    method: 'POST',
    body: {
      parentId,
      name,
      tabs: [
        {
          name: 'Planilha1',
          cells: {
            A1: { v: 'Inicial' },
            B1: { v: 100 },
          },
        },
      ],
    },
  });
  expect([200, 201]).toContain(createRes.status);
  const sheetId = createRes.data?.id || createRes.data?.node?.id || createRes.data?.sheet?.id;
  expect(sheetId).toBeTruthy();
  return sheetId;
}

describe('F-26: Per-Cell Change History & 2s Debounced Auto-Save on VPS', () => {
  beforeAll(async () => {
    cluster = await bootE2eCluster();
    agent = await startMockAgentNode({ quotaBytes: 50 * 1024 * 1024 });
    tightAgent = await startMockAgentNode({ quotaBytes: 300 });
    ownerSession = await cluster.loginAs('ti@shineraybysabel.com.br', 'Shineray@2026!');

    await cluster.seedUser(ownerSession.accessToken, {
      name: 'Editor History Colab',
      email: 'editor.hist@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'collaborator',
      department: 'Financeiro',
    });
    editorColab = await cluster.loginAs('editor.hist@shineraybysabel.com.br', 'Password@2026!');

    betaOwnerToken = cluster.createUserToken({
      sub: 'beta-owner-hist',
      email: 'owner@beta-hist.test',
      name: 'Beta Hist Owner',
      role: 'owner',
      tenantId: 'tenant-beta',
      department: 'TI',
    });
  }, 45_000);

  afterEach(async () => {
    while (openedSockets.length > 0) {
      const sock = openedSockets.pop();
      try {
        await sock.close();
      } catch {
        // Ignore already-closed socket
      }
    }
  });

  afterAll(async () => {
    if (cluster) await cluster.stop();
    if (agent) await agent.stop();
    if (tightAgent) await tightAgent.stop();
  }, 45_000);

  describe('Tier 1 — Unit & Contract (2s Debounce, Coalescing, VPS .xlsx Snapshot, Cell History)', () => {
    it('emits sheet.saved after ~2s debounce following WS sheet.cell.patch', async () => {
      const sheetId = await createSheetInFinanceiro('Debounce-Single.xlsx');
      const ownerWs = trackSocket(await cluster.openWsClient(ownerSession.accessToken, 'console-react'));

      const jIdx = ownerWs.frames.length;
      ownerWs.send({ action: 'sheet.join', fileId: sheetId });
      await ownerWs.waitForNextEvent('sheet.presence', 5000, jIdx);

      const beforePatchIdx = ownerWs.frames.length;
      const startMs = Date.now();
      ownerWs.send({
        action: 'sheet.cell.patch',
        fileId: sheetId,
        tab: 'Planilha1',
        cell: 'A1',
        value: 'Receita Mensal',
      });

      // Debounce should not fire immediately inside 350ms
      await expect(ownerWs.waitForNextEvent('sheet.saved', 350, beforePatchIdx)).rejects.toThrow();

      const savedFrame = await ownerWs.waitForNextEvent('sheet.saved', 6000, beforePatchIdx);
      const elapsed = Date.now() - startMs;
      const data = payloadOf(savedFrame);
      expect(data.fileId).toBe(sheetId);
      expect(Number(data.rev)).toBeGreaterThanOrEqual(2);
      expect(data.savedAt).toBeTruthy();
      expect(elapsed).toBeGreaterThanOrEqual(1400);
    }, 15_000);

    it('coalesces rapid burst WS patches into a single debounced auto-save commit', async () => {
      const sheetId = await createSheetInFinanceiro('Debounce-Coalesce.xlsx');
      const ownerWs = trackSocket(await cluster.openWsClient(ownerSession.accessToken, 'console-react'));

      const jIdx = ownerWs.frames.length;
      ownerWs.send({ action: 'sheet.join', fileId: sheetId });
      await ownerWs.waitForNextEvent('sheet.presence', 5000, jIdx);

      const startIdx = ownerWs.frames.length;
      ownerWs.send({ action: 'sheet.cell.patch', fileId: sheetId, tab: 'Planilha1', cell: 'B2', value: 10 });
      ownerWs.send({ action: 'sheet.cell.patch', fileId: sheetId, tab: 'Planilha1', cell: 'B2', value: 20 });
      ownerWs.send({ action: 'sheet.cell.patch', fileId: sheetId, tab: 'Planilha1', cell: 'B3', value: 30 });
      ownerWs.send({
        action: 'sheet.cell.patch',
        fileId: sheetId,
        tab: 'Planilha1',
        cell: 'B4',
        value: null,
        formula: '=SOMA(B2:B3)',
      });

      const saved = await ownerWs.waitForNextEvent('sheet.saved', 6500, startIdx);
      expect(payloadOf(saved).fileId).toBe(sheetId);

      // Give brief settle to confirm no duplicate bursts fire
      await new Promise((r) => setTimeout(r, 400));
      const savedCount = ownerWs.frames.slice(startIdx).filter((f) => f?.event === 'sheet.saved').length;
      expect(savedCount).toBe(1);

      const getRes = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/sheets/${sheetId}`);
      expect(getRes.status).toBe(200);
      const tab = (getRes.data?.sheets || getRes.data?.tabs || [])[0];
      expect(Number(tab.cells?.B2?.v)).toBe(20);
      expect(Number(tab.cells?.B3?.v)).toBe(30);
    }, 15_000);

    it('persists updated .xlsx binary on VPS mockAgentNode and creates version snapshot on auto-save', async () => {
      const sheetId = await createSheetInFinanceiro('VPS-AutoSave-Binary.xlsx');
      const ownerWs = trackSocket(await cluster.openWsClient(ownerSession.accessToken, 'console-react'));

      const jIdx = ownerWs.frames.length;
      ownerWs.send({ action: 'sheet.join', fileId: sheetId });
      await ownerWs.waitForNextEvent('sheet.presence', 5000, jIdx);

      const logCountBefore = agent.getRequestLog().length;
      const patchIdx = ownerWs.frames.length;
      ownerWs.send({
        action: 'sheet.cell.patch',
        fileId: sheetId,
        tab: 'Planilha1',
        cell: 'A2',
        value: 'PersistidoVPS',
      });

      await ownerWs.waitForNextEvent('sheet.saved', 6500, patchIdx);

      const writeRequests = agent
        .getRequestLog()
        .slice(logCountBefore)
        .filter((r) => r.method === 'PUT' || (r.method === 'POST' && r.path.includes('/write')));
      expect(writeRequests.length).toBeGreaterThanOrEqual(1);

      const versionsRes = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/nodes/${sheetId}/versions`);
      expect(versionsRes.status).toBe(200);
      const versions = versionsRes.data?.versions || versionsRes.data?.items || [];
      expect(versions.length).toBeGreaterThanOrEqual(1);

      const dlRes = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/nodes/${sheetId}/download`);
      expect(dlRes.status).toBe(200);
      const parsed = XLSX.read(dlRes.buffer, { type: 'buffer' });
      expect(parsed.Sheets.Planilha1.A2?.v).toBe('PersistidoVPS');
    }, 15_000);

    it('records chronological per-cell audit trail in GET /api/v1/storage/sheets/:id/history', async () => {
      const sheetId = await createSheetInFinanceiro('Cell-History.xlsx');
      const ownerWs = trackSocket(await cluster.openWsClient(ownerSession.accessToken, 'console-react'));

      const jIdx = ownerWs.frames.length;
      ownerWs.send({ action: 'sheet.join', fileId: sheetId });
      await ownerWs.waitForNextEvent('sheet.presence', 5000, jIdx);

      const p1 = ownerWs.frames.length;
      ownerWs.send({ action: 'sheet.cell.patch', fileId: sheetId, tab: 'Planilha1', cell: 'C2', value: 500 });
      ownerWs.send({ action: 'sheet.cell.patch', fileId: sheetId, tab: 'Planilha1', cell: 'C2', value: 750 });
      ownerWs.send({
        action: 'sheet.cell.patch',
        fileId: sheetId,
        tab: 'Planilha1',
        cell: 'D2',
        value: null,
        formula: '=C2*2',
      });
      await ownerWs.waitForNextEvent('sheet.saved', 6500, p1);

      const histRes = await cluster.apiFetch(
        ownerSession.accessToken,
        `/api/v1/storage/sheets/${sheetId}/history`,
      );
      expect(histRes.status).toBe(200);
      const entries = extractHistory(histRes);
      expect(entries.length).toBeGreaterThanOrEqual(3);

      const c2Entries = entries.filter((e) => (e.cell_ref || e.cellRef) === 'C2');
      expect(c2Entries.length).toBeGreaterThanOrEqual(2);
      const latestC2 = c2Entries[c2Entries.length - 1];
      expect(String(latestC2.new_value ?? latestC2.newValue)).toBe('750');
      expect(latestC2.actor_email || latestC2.actorEmail).toBe(ownerSession.user.email);

      const d2Entry = entries.find((e) => (e.cell_ref || e.cellRef) === 'D2');
      expect(d2Entry).toBeTruthy();
      expect(d2Entry.new_formula || d2Entry.newFormula).toBe('=C2*2');
    }, 15_000);

    it('records cell history and compliance SHA-256 audit entry on REST POST /sheets/:id/save', async () => {
      const sheetId = await createSheetInFinanceiro('Rest-Save-History.xlsx');

      const saveRes = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/sheets/${sheetId}/save`, {
        method: 'POST',
        body: {
          expectedRev: 1,
          tabs: [
            {
              name: 'Planilha1',
              cells: {
                A1: { v: 'Inicial' },
                B1: { v: 100 },
                E1: { v: 'RestEditedValue' },
              },
            },
          ],
        },
      });
      expect(saveRes.status).toBe(200);

      const histRes = await cluster.apiFetch(
        ownerSession.accessToken,
        `/api/v1/storage/sheets/${sheetId}/history`,
      );
      expect(histRes.status).toBe(200);
      const e1Entry = extractHistory(histRes).find((e) => (e.cell_ref || e.cellRef) === 'E1');
      expect(e1Entry).toBeTruthy();
      expect(e1Entry.new_value ?? e1Entry.newValue).toBe('RestEditedValue');

      const integrity = await assertFullAuditIntegrity(cluster.apiFetch, ownerSession.accessToken);
      expect(integrity.apiResult.intact).toBe(true);
      expect(integrity.localResult.valid).toBe(true);
    });
  });

  describe('Tier 2 — Integration, Security, Flush-on-Leave & Failure Protection', () => {
    it('flushes pending debounced edits when the last editor leaves or disconnects before 2s timer', async () => {
      const sheetId = await createSheetInFinanceiro('Flush-On-Leave.xlsx');
      const ownerWs = trackSocket(await cluster.openWsClient(ownerSession.accessToken, 'console-react'));

      const jIdx = ownerWs.frames.length;
      ownerWs.send({ action: 'sheet.join', fileId: sheetId });
      await ownerWs.waitForNextEvent('sheet.presence', 5000, jIdx);

      ownerWs.send({
        action: 'sheet.cell.patch',
        fileId: sheetId,
        tab: 'Planilha1',
        cell: 'F5',
        value: 'FlushOnLeaveValue',
      });
      ownerWs.send({ action: 'sheet.leave', fileId: sheetId });
      await ownerWs.close();

      await new Promise((r) => setTimeout(r, 600));

      const getRes = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/sheets/${sheetId}`);
      expect(getRes.status).toBe(200);
      const tab = (getRes.data?.sheets || getRes.data?.tabs || [])[0];
      expect(tab.cells?.F5?.v).toBe('FlushOnLeaveValue');
    });

    it('attributes multi-actor edits accurately between owner and collaborator in cell history', async () => {
      const sheetId = await createSheetInFinanceiro('Multi-Actor-Hist.xlsx');
      const ownerWs = trackSocket(await cluster.openWsClient(ownerSession.accessToken, 'console-react'));
      const editorWs = trackSocket(await cluster.openWsClient(editorColab.accessToken, 'portal-vue'));

      const oIdx = ownerWs.frames.length;
      ownerWs.send({ action: 'sheet.join', fileId: sheetId });
      await ownerWs.waitForNextEvent('sheet.presence', 5000, oIdx);

      const eIdx = editorWs.frames.length;
      editorWs.send({ action: 'sheet.join', fileId: sheetId });
      await editorWs.waitForNextEvent('sheet.presence', 5000, eIdx);

      const waitIdx = ownerWs.frames.length;
      ownerWs.send({ action: 'sheet.cell.patch', fileId: sheetId, tab: 'Planilha1', cell: 'G1', value: 'OwnerVal' });
      editorWs.send({ action: 'sheet.cell.patch', fileId: sheetId, tab: 'Planilha1', cell: 'G2', value: 'ColabVal' });
      await ownerWs.waitForNextEvent('sheet.saved', 6500, waitIdx);

      const histRes = await cluster.apiFetch(
        ownerSession.accessToken,
        `/api/v1/storage/sheets/${sheetId}/history`,
      );
      expect(histRes.status).toBe(200);
      const entries = extractHistory(histRes);
      const g1 = entries.find((e) => (e.cell_ref || e.cellRef) === 'G1');
      const g2 = entries.find((e) => (e.cell_ref || e.cellRef) === 'G2');
      expect(g1?.actor_email || g1?.actorEmail).toBe(ownerSession.user.email);
      expect(g2?.actor_email || g2?.actorEmail).toBe(editorColab.user.email);
    }, 15_000);

    it('blocks cross-tenant access to GET /api/v1/storage/sheets/:id/history', async () => {
      const sheetId = await createSheetInFinanceiro('CrossTenant-Hist.xlsx');

      const betaHist = await cluster.apiFetch(
        betaOwnerToken,
        `/api/v1/storage/sheets/${sheetId}/history`,
      );
      expect([403, 404]).toContain(betaHist.status);
    });

    it('blocks REST save (423 Locked) and WS cell.patch when file is locked by another user', async () => {
      const sheetId = await createSheetInFinanceiro('Locked-Sheet.xlsx');

      const lockRes = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/nodes/${sheetId}/lock`, {
        method: 'POST',
        body: {},
      });
      expect([200, 201]).toContain(lockRes.status);

      try {
        const colabSave = await cluster.apiFetch(editorColab.accessToken, `/api/v1/storage/sheets/${sheetId}/save`, {
          method: 'POST',
          body: {
            expectedRev: 1,
            tabs: [{ name: 'Planilha1', cells: { A1: { v: 'LockBypassAttempt' } } }],
          },
        });
        expect(colabSave.status).toBe(423);

        const editorWs = trackSocket(await cluster.openWsClient(editorColab.accessToken, 'portal-vue'));
        const jIdx = editorWs.frames.length;
        editorWs.send({ action: 'sheet.join', fileId: sheetId });
        await editorWs.waitForNextEvent('sheet.presence', 5000, jIdx);

        const pIdx = editorWs.frames.length;
        editorWs.send({
          action: 'sheet.cell.patch',
          fileId: sheetId,
          tab: 'Planilha1',
          cell: 'A1',
          value: 'WsLockBypassAttempt',
        });
        const errFrame = await editorWs.waitForNextEvent(
          (f) => f?.event === 'error' || f?.event === 'sheet.error',
          5000,
          pIdx,
        );
        expect(errFrame).toBeTruthy();
      } finally {
        await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/nodes/${sheetId}/lock`, {
          method: 'DELETE',
        });
      }
    });

    it('enforces quota limit (413 QUOTA_EXCEEDED) on oversized sheet creation/save without breaking audit chain', async () => {
      await ensureTenantVault(betaOwnerToken, tightAgent, 'tenant-beta-tight');

      const nodesRes = await cluster.apiFetch(betaOwnerToken, '/api/v1/storage/nodes');
      expect(nodesRes.status).toBe(200);
      const top = extractNodes(nodesRes);
      const pub = top.find((n) => (n.virtual_path || n.virtualPath || n.path) === '/Corporativo-Publico') || top[0];
      expect(pub).toBeTruthy();

      const hugeCells = {};
      for (let i = 1; i <= 40; i += 1) {
        hugeCells[`A${i}`] = { v: `PAYLOAD_ROW_${i}_${'X'.repeat(64)}` };
      }

      const overQuotaSheet = await cluster.apiFetch(betaOwnerToken, '/api/v1/storage/sheets', {
        method: 'POST',
        body: {
          parentId: pub.id,
          name: 'Quota-Overflow.xlsx',
          tabs: [{ name: 'Dados', cells: hugeCells }],
        },
      });
      expect([403, 413]).toContain(overQuotaSheet.status);

      const integrity = await assertFullAuditIntegrity(cluster.apiFetch, ownerSession.accessToken);
      expect(integrity.apiResult.intact).toBe(true);
      expect(integrity.localResult.valid).toBe(true);
    });
  });
});
