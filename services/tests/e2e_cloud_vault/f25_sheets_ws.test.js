// services/tests/e2e_cloud_vault/f25_sheets_ws.test.js
// =============================================================================
// F-25: WebSocket sheet.* Real-Time Co-Editing on /ws/nexusdesk (E2E Suite)
// =============================================================================

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { bootE2eCluster } from './helpers/clusterHarness.js';
import { startMockAgentNode } from './helpers/mockAgentNode.js';

let cluster;
let agent;
let ownerSession;
let editorColab;
let viewerColab;
let outsiderColab;
let betaOwnerToken;

let sharedSheetId = null;
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

async function ensureSharedLiveSheet() {
  if (sharedSheetId) return sharedSheetId;

  let connRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/connection', {
    method: 'PUT',
    body: {
      providerType: 'agent_node',
      label: 'E2E WS Sheets Agent',
      endpointUrl: agent.url,
      rootPath: '/',
      quotaBytes: agent.quotaBytes,
      credentials: { hmacToken: agent.hmacToken },
    },
  });
  if (connRes.status === 400 && !connRes.ok) {
    connRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/connection', {
      method: 'PUT',
      body: {
        providerType: 'agent_node',
        label: 'E2E WS Sheets Agent',
        endpointUrl: agent.url,
        rootPath: '/',
        quotaBytes: agent.quotaBytes,
        hmacToken: agent.hmacToken,
      },
    });
  }
  expect(connRes.status).toBe(200);

  const initRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/initialize', {
    method: 'POST',
    body: {},
  });
  expect(initRes.ok).toBe(true);

  const nodesRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/nodes');
  expect(nodesRes.status).toBe(200);
  const topNodes = extractNodes(nodesRes);
  const setores = topNodes.find((n) => (n.virtual_path || n.virtualPath || n.path) === '/Setores');
  expect(setores).toBeTruthy();

  const secRes = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/nodes?parentId=${setores.id}`);
  expect(secRes.status).toBe(200);
  let finFolder = extractNodes(secRes).find((n) => n.name === 'Financeiro');
  if (!finFolder) {
    const mkFin = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/folders', {
      method: 'POST',
      body: { parentId: setores.id, name: 'Financeiro' },
    });
    expect([200, 201]).toContain(mkFin.status);
    finFolder = mkFin.data?.node || mkFin.data?.folder || mkFin.data;
  }

  const sheetRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/sheets', {
    method: 'POST',
    body: {
      parentId: finFolder.id,
      name: 'PlanilhaLive.xlsx',
      tabs: [
        {
          name: 'Planilha1',
          cells: {
            A1: { v: 'Item' },
            B1: { v: 'Valor' },
            A2: { v: 'Servidor' },
            B2: { v: 1000 },
          },
        },
      ],
    },
  });
  expect([200, 201]).toContain(sheetRes.status);
  sharedSheetId = sheetRes.data?.id || sheetRes.data?.node?.id || sheetRes.data?.sheet?.id;
  expect(sharedSheetId).toBeTruthy();

  // Grant viewerColab strictly viewer_online on this sheet
  const aclRes = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/nodes/${sharedSheetId}/acl`, {
    method: 'PUT',
    body: {
      rules: [{ targetType: 'user', targetValue: viewerColab.user.email, accessLevel: 'viewer_online' }],
    },
  });
  expect([200, 201]).toContain(aclRes.status);

  return sharedSheetId;
}

describe('F-25: WebSocket sheet.* Real-Time Co-Editing on /ws/nexusdesk', () => {
  beforeAll(async () => {
    cluster = await bootE2eCluster();
    agent = await startMockAgentNode({ quotaBytes: 50 * 1024 * 1024 });
    ownerSession = await cluster.loginAs('ti@shineraybysabel.com.br', 'Shineray@2026!');

    await cluster.seedUser(ownerSession.accessToken, {
      name: 'Editor Financeiro',
      email: 'editor.ws@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'collaborator',
      department: 'Financeiro',
    });
    await cluster.seedUser(ownerSession.accessToken, {
      name: 'Viewer Auditoria',
      email: 'viewer.ws@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'collaborator',
      department: 'Auditoria',
    });
    await cluster.seedUser(ownerSession.accessToken, {
      name: 'Outsider Vendas',
      email: 'outsider.ws@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'collaborator',
      department: 'Vendas',
    });

    editorColab = await cluster.loginAs('editor.ws@shineraybysabel.com.br', 'Password@2026!');
    viewerColab = await cluster.loginAs('viewer.ws@shineraybysabel.com.br', 'Password@2026!');
    outsiderColab = await cluster.loginAs('outsider.ws@shineraybysabel.com.br', 'Password@2026!');

    betaOwnerToken = cluster.createUserToken({
      sub: 'beta-owner-ws',
      email: 'owner@beta-ws.test',
      name: 'Beta WS Owner',
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
  }, 45_000);

  describe('Tier 1 — Unit & Contract (Join, Cursor, Cell Patch, Format/Tab Sync, Leave)', () => {
    it('joins room via sheet.join and receives sheet.presence listing active peers', async () => {
      const sheetId = await ensureSharedLiveSheet();

      const ownerWs = trackSocket(await cluster.openWsClient(ownerSession.accessToken, 'console-react'));
      const editorWs = trackSocket(await cluster.openWsClient(editorColab.accessToken, 'portal-vue'));

      const ownerIdx = ownerWs.frames.length;
      ownerWs.send({ action: 'sheet.join', fileId: sheetId });
      const ownerPresence = await ownerWs.waitForNextEvent('sheet.presence', 5000, ownerIdx);
      expect(ownerPresence.protocol).toBe('nexusdesk-ws/3.0');
      const ownerPeers = payloadOf(ownerPresence).peers || [];
      expect(ownerPeers.some((p) => (p.email || p.userEmail) === ownerSession.user.email)).toBe(true);

      const ownerIdx2 = ownerWs.frames.length;
      const editorIdx = editorWs.frames.length;
      editorWs.send({ action: 'sheet.join', fileId: sheetId });

      const [editorPresence, ownerUpdate] = await Promise.all([
        editorWs.waitForNextEvent('sheet.presence', 5000, editorIdx),
        ownerWs.waitForNextEvent('sheet.presence', 5000, ownerIdx2),
      ]);
      const peersA = payloadOf(editorPresence).peers || [];
      const peersB = payloadOf(ownerUpdate).peers || [];
      expect(peersA.some((p) => (p.email || p.userEmail) === editorColab.user.email)).toBe(true);
      expect(peersB.some((p) => (p.email || p.userEmail) === editorColab.user.email)).toBe(true);
    });

    it('broadcasts sheet.cursor position and user identity to room members', async () => {
      const sheetId = await ensureSharedLiveSheet();

      const ownerWs = trackSocket(await cluster.openWsClient(ownerSession.accessToken, 'console-react'));
      const editorWs = trackSocket(await cluster.openWsClient(editorColab.accessToken, 'portal-vue'));

      const oJoinIdx = ownerWs.frames.length;
      ownerWs.send({ action: 'sheet.join', fileId: sheetId });
      await ownerWs.waitForNextEvent('sheet.presence', 5000, oJoinIdx);

      const eJoinIdx = editorWs.frames.length;
      editorWs.send({ action: 'sheet.join', fileId: sheetId });
      await editorWs.waitForNextEvent('sheet.presence', 5000, eJoinIdx);

      const cursorIdx = ownerWs.frames.length;
      editorWs.send({
        action: 'sheet.cursor',
        fileId: sheetId,
        tab: 'Planilha1',
        cell: 'B4',
        range: 'B4:C5',
      });

      const cursorFrame = await ownerWs.waitForNextEvent('sheet.cursor', 5000, cursorIdx);
      expect(cursorFrame.protocol).toBe('nexusdesk-ws/3.0');
      const data = payloadOf(cursorFrame);
      expect(data.fileId).toBe(sheetId);
      expect(data.tab).toBe('Planilha1');
      expect(data.cell).toBe('B4');
      expect(data.userEmail || data.email).toBe(editorColab.user.email);
    });

    it('delivers sheet.cell.patch to collaborator peers via canCollaboratorReceiveEvent and increments rev', async () => {
      const sheetId = await ensureSharedLiveSheet();

      const ownerWs = trackSocket(await cluster.openWsClient(ownerSession.accessToken, 'console-react'));
      const editorWs = trackSocket(await cluster.openWsClient(editorColab.accessToken, 'portal-vue'));

      const oIdx = ownerWs.frames.length;
      ownerWs.send({ action: 'sheet.join', fileId: sheetId });
      await ownerWs.waitForNextEvent('sheet.presence', 5000, oIdx);

      const eIdx = editorWs.frames.length;
      editorWs.send({ action: 'sheet.join', fileId: sheetId });
      await editorWs.waitForNextEvent('sheet.presence', 5000, eIdx);

      const sheetState = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/sheets/${sheetId}`);
      const baseRev = sheetState.data?.rev ?? 1;

      const patchIdx = editorWs.frames.length;
      ownerWs.send({
        action: 'sheet.cell.patch',
        fileId: sheetId,
        tab: 'Planilha1',
        cell: 'B2',
        value: 1500,
        baseRev,
      });

      const patchFrame = await editorWs.waitForNextEvent('sheet.cell.patch', 5000, patchIdx);
      const patchData = payloadOf(patchFrame);
      expect(patchData.fileId).toBe(sheetId);
      expect(patchData.cell).toBe('B2');
      expect(Number(patchData.value)).toBe(1500);
      expect(Number(patchData.rev)).toBeGreaterThan(baseRev);
    });

    it('synchronizes sheet.format.patch, sheet.tab.add, and sheet.tab.rename across peers', async () => {
      const sheetId = await ensureSharedLiveSheet();

      const ownerWs = trackSocket(await cluster.openWsClient(ownerSession.accessToken, 'console-react'));
      const editorWs = trackSocket(await cluster.openWsClient(editorColab.accessToken, 'portal-vue'));

      const oIdx = ownerWs.frames.length;
      ownerWs.send({ action: 'sheet.join', fileId: sheetId });
      await ownerWs.waitForNextEvent('sheet.presence', 5000, oIdx);

      const eIdx = editorWs.frames.length;
      editorWs.send({ action: 'sheet.join', fileId: sheetId });
      await editorWs.waitForNextEvent('sheet.presence', 5000, eIdx);

      const fmtIdx = ownerWs.frames.length;
      editorWs.send({
        action: 'sheet.format.patch',
        fileId: sheetId,
        tab: 'Planilha1',
        cell: 'B2',
        style: { bgColor: '#FEF08A', numFmt: 'R$ #,##0.00' },
        freezeRow: 1,
      });
      const fmtFrame = await ownerWs.waitForNextEvent('sheet.format.patch', 5000, fmtIdx);
      expect(payloadOf(fmtFrame).style?.bgColor).toBe('#FEF08A');

      const addIdx = ownerWs.frames.length;
      editorWs.send({
        action: 'sheet.tab.add',
        fileId: sheetId,
        tabName: 'Custos',
      });
      const addFrame = await ownerWs.waitForNextEvent('sheet.tab.add', 5000, addIdx);
      expect(payloadOf(addFrame).tabName).toBe('Custos');

      const renIdx = ownerWs.frames.length;
      editorWs.send({
        action: 'sheet.tab.rename',
        fileId: sheetId,
        oldName: 'Custos',
        tabName: 'Custos2026',
      });
      const renFrame = await ownerWs.waitForNextEvent('sheet.tab.rename', 5000, renIdx);
      expect(payloadOf(renFrame).tabName).toBe('Custos2026');
    });

    it('removes peer on sheet.leave, updates sheet.presence, and stops future patch delivery', async () => {
      const sheetId = await ensureSharedLiveSheet();

      const ownerWs = trackSocket(await cluster.openWsClient(ownerSession.accessToken, 'console-react'));
      const editorWs = trackSocket(await cluster.openWsClient(editorColab.accessToken, 'portal-vue'));

      const oIdx = ownerWs.frames.length;
      ownerWs.send({ action: 'sheet.join', fileId: sheetId });
      await ownerWs.waitForNextEvent('sheet.presence', 5000, oIdx);

      const eIdx = editorWs.frames.length;
      editorWs.send({ action: 'sheet.join', fileId: sheetId });
      await editorWs.waitForNextEvent('sheet.presence', 5000, eIdx);

      const leaveIdx = ownerWs.frames.length;
      editorWs.send({ action: 'sheet.leave', fileId: sheetId });
      const presenceAfterLeave = await ownerWs.waitForNextEvent(
        (f) =>
          f?.event === 'sheet.presence' &&
          !(payloadOf(f).peers || []).some((p) => (p.email || p.userEmail) === editorColab.user.email),
        5000,
        leaveIdx,
      );
      expect(presenceAfterLeave.event).toBe('sheet.presence');

      const editorPostLeaveIdx = editorWs.frames.length;
      ownerWs.send({
        action: 'sheet.cell.patch',
        fileId: sheetId,
        tab: 'Planilha1',
        cell: 'A3',
        value: 'AfterLeaveOnly',
      });

      await expect(editorWs.waitForNextEvent('sheet.cell.patch', 450, editorPostLeaveIdx)).rejects.toThrow();
    });
  });

  describe('Tier 2 — Integration, Security, Multitenancy & Edge Cases', () => {
    it('blocks cross-tenant WS sheet.join and prevents eavesdropping on tenant-ap3htf6 patches', async () => {
      const sheetId = await ensureSharedLiveSheet();

      const ownerWs = trackSocket(await cluster.openWsClient(ownerSession.accessToken, 'console-react'));
      const betaWs = trackSocket(await cluster.openWsClient(betaOwnerToken, 'console-react'));

      const oIdx = ownerWs.frames.length;
      ownerWs.send({ action: 'sheet.join', fileId: sheetId });
      await ownerWs.waitForNextEvent('sheet.presence', 5000, oIdx);

      const betaIdx = betaWs.frames.length;
      betaWs.send({ action: 'sheet.join', fileId: sheetId });
      const betaReply = await betaWs.waitForNextEvent(
        (f) => f?.event === 'error' || f?.event === 'sheet.error' || f?.event === 'sheet.presence',
        5000,
        betaIdx,
      );
      expect(betaReply.event).not.toBe('sheet.presence');

      const postJoinIdx = betaWs.frames.length;
      ownerWs.send({
        action: 'sheet.cell.patch',
        fileId: sheetId,
        tab: 'Planilha1',
        cell: 'C1',
        value: 'TenantSecretValue',
      });

      await expect(betaWs.waitForNextEvent('sheet.cell.patch', 450, postJoinIdx)).rejects.toThrow();
    });

    it('isolates unjoined same-tenant collaborator peers from receiving room sheet.* events', async () => {
      const sheetId = await ensureSharedLiveSheet();

      const ownerWs = trackSocket(await cluster.openWsClient(ownerSession.accessToken, 'console-react'));
      const outsiderWs = trackSocket(await cluster.openWsClient(outsiderColab.accessToken, 'portal-vue'));

      const oIdx = ownerWs.frames.length;
      ownerWs.send({ action: 'sheet.join', fileId: sheetId });
      await ownerWs.waitForNextEvent('sheet.presence', 5000, oIdx);

      const outsiderIdx = outsiderWs.frames.length;
      ownerWs.send({
        action: 'sheet.cursor',
        fileId: sheetId,
        tab: 'Planilha1',
        cell: 'D1',
      });
      ownerWs.send({
        action: 'sheet.cell.patch',
        fileId: sheetId,
        tab: 'Planilha1',
        cell: 'D1',
        value: 'RoomOnlySecret',
      });

      await expect(
        outsiderWs.waitForNextEvent((f) => String(f?.event || '').startsWith('sheet.'), 450, outsiderIdx),
      ).rejects.toThrow();
    });

    it('allows viewer_online peer to join read-only but rejects sheet.cell.patch, format, and tab mutations', async () => {
      const sheetId = await ensureSharedLiveSheet();

      const ownerWs = trackSocket(await cluster.openWsClient(ownerSession.accessToken, 'console-react'));
      const viewerWs = trackSocket(await cluster.openWsClient(viewerColab.accessToken, 'portal-vue'));

      const oIdx = ownerWs.frames.length;
      ownerWs.send({ action: 'sheet.join', fileId: sheetId });
      await ownerWs.waitForNextEvent('sheet.presence', 5000, oIdx);

      const vIdx = viewerWs.frames.length;
      viewerWs.send({ action: 'sheet.join', fileId: sheetId });
      const vPresence = await viewerWs.waitForNextEvent('sheet.presence', 5000, vIdx);
      expect(vPresence.event).toBe('sheet.presence');

      const ownerBeforePatchIdx = ownerWs.frames.length;
      const errIdx1 = viewerWs.frames.length;
      viewerWs.send({
        action: 'sheet.cell.patch',
        fileId: sheetId,
        tab: 'Planilha1',
        cell: 'A1',
        value: 'UnauthorizedEdit',
      });
      const err1 = await viewerWs.waitForNextEvent(
        (f) => f?.event === 'error' || f?.event === 'sheet.error',
        5000,
        errIdx1,
      );
      expect(err1).toBeTruthy();

      const errIdx2 = viewerWs.frames.length;
      viewerWs.send({
        action: 'sheet.tab.add',
        fileId: sheetId,
        tabName: 'UnauthorizedTab',
      });
      const err2 = await viewerWs.waitForNextEvent(
        (f) => f?.event === 'error' || f?.event === 'sheet.error',
        5000,
        errIdx2,
      );
      expect(err2).toBeTruthy();

      await expect(ownerWs.waitForNextEvent('sheet.cell.patch', 400, ownerBeforePatchIdx)).rejects.toThrow();
    });

    it('cleans up ghost presence automatically when an active editor socket disconnects abruptly', async () => {
      const sheetId = await ensureSharedLiveSheet();

      const ownerWs = trackSocket(await cluster.openWsClient(ownerSession.accessToken, 'console-react'));
      const editorWs = trackSocket(await cluster.openWsClient(editorColab.accessToken, 'portal-vue'));

      const oIdx = ownerWs.frames.length;
      ownerWs.send({ action: 'sheet.join', fileId: sheetId });
      await ownerWs.waitForNextEvent('sheet.presence', 5000, oIdx);

      const oJoinIdx = ownerWs.frames.length;
      editorWs.send({ action: 'sheet.join', fileId: sheetId });
      await ownerWs.waitForNextEvent(
        (f) =>
          f?.event === 'sheet.presence' &&
          (payloadOf(f).peers || []).some((p) => (p.email || p.userEmail) === editorColab.user.email),
        5000,
        oJoinIdx,
      );

      const disconnectIdx = ownerWs.frames.length;
      await editorWs.close();

      const cleanedPresence = await ownerWs.waitForNextEvent(
        (f) =>
          f?.event === 'sheet.presence' &&
          !(payloadOf(f).peers || []).some((p) => (p.email || p.userEmail) === editorColab.user.email),
        5000,
        disconnectIdx,
      );
      expect(cleanedPresence.event).toBe('sheet.presence');
    });

    it('rejects unauthenticated WS connections and handles malformed sheet.* frames without dropping session', async () => {
      await ensureSharedLiveSheet();

      await expect(cluster.openWsClient('', 'unauth-client', { timeoutMs: 2500 })).rejects.toThrow();

      const ownerWs = trackSocket(await cluster.openWsClient(ownerSession.accessToken, 'console-react'));
      const badIdx = ownerWs.frames.length;
      ownerWs.send({ action: 'sheet.cell.patch' });
      const errFrame = await ownerWs.waitForNextEvent(
        (f) => f?.event === 'error' || f?.event === 'sheet.error',
        5000,
        badIdx,
      );
      expect(errFrame).toBeTruthy();

      const pingIdx = ownerWs.frames.length;
      ownerWs.send({ action: 'ping', id: 'still-alive' });
      const pong = await ownerWs.waitForNextEvent((f) => f?.event === 'pong', 3000, pingIdx);
      expect(pong.event).toBe('pong');
    });
  });
});
