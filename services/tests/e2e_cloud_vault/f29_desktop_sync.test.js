// services/tests/e2e_cloud_vault/f29_desktop_sync.test.js
// =============================================================================
// F-29: Nexus Vault Desktop Auto-Sync Sessions (Agente Windows / Excel & Apps)
// =============================================================================

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootE2eCluster } from './helpers/clusterHarness.js';
import { startMockAgentNode } from './helpers/mockAgentNode.js';
import { assertFullAuditIntegrity } from './helpers/auditHelper.js';

describe('F-29: Nexus Vault Desktop Edit & Auto-Sync Sessions', () => {
  let cluster;
  let agent;
  let ownerToken;
  let collabFinToken;
  let collabRhToken;
  let finFolderId;
  let excelNodeId;
  const initialExcelBytes = Buffer.from('PK\x03\x04EXCEL_V1_INITIAL_CONTENT_2026', 'utf8');
  const updatedExcelBytes = Buffer.from('PK\x03\x04EXCEL_V2_AUTOSAVED_FROM_WINDOWS_AGENT', 'utf8');

  function extractNodesList(res) {
    if (Array.isArray(res.data)) return res.data;
    return res.data?.items || res.data?.nodes || [];
  }

  beforeAll(async () => {
    cluster = await bootE2eCluster();
    ownerToken = (await cluster.loginAs('ti@shineraybysabel.com.br', 'Shineray@2026!')).accessToken;

    await cluster.seedUser(ownerToken, {
      name: 'Ana Financeiro',
      email: 'ana.fin@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'collaborator',
      department: 'Financeiro',
    });
    collabFinToken = (await cluster.loginAs('ana.fin@shineraybysabel.com.br', 'Password@2026!')).accessToken;

    await cluster.seedUser(ownerToken, {
      name: 'Bruno RH',
      email: 'bruno.rh@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'collaborator',
      department: 'RH',
    });
    collabRhToken = (await cluster.loginAs('bruno.rh@shineraybysabel.com.br', 'Password@2026!')).accessToken;

    agent = await startMockAgentNode({ quotaBytes: 20 * 1024 * 1024 });
    const parsed = new URL(agent.url);
    const putConn = await cluster.apiFetch(ownerToken, '/api/v1/storage/connection', {
      method: 'PUT',
      body: {
        providerType: 'agent_node',
        label: 'E2E Desktop Sync Node',
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
    const setoresNode = roots.find((n) => n.name === 'Setores');
    expect(setoresNode).toBeTruthy();

    const createFin = await cluster.apiFetch(ownerToken, '/api/v1/storage/folders', {
      method: 'POST',
      body: { parentId: setoresNode.id, name: 'Financeiro', departmentScope: 'Financeiro' },
    });
    expect([200, 201]).toContain(createFin.status);
    finFolderId = (createFin.data?.node || createFin.data).id;

    // Concede acesso editor para departamento Financeiro e viewer_online para RH
    await cluster.apiFetch(ownerToken, `/api/v1/storage/nodes/${finFolderId}/acls`, {
      method: 'POST',
      body: { targetType: 'department', targetValue: 'Financeiro', accessLevel: 'editor' },
    });
    await cluster.apiFetch(ownerToken, `/api/v1/storage/nodes/${finFolderId}/acls`, {
      method: 'POST',
      body: { targetType: 'department', targetValue: 'RH', accessLevel: 'viewer_online' },
    });

    const form = new FormData();
    form.append('parentId', finFolderId);
    form.append('fileName', 'Fluxo-Caixa-2026.xlsx');
    form.append('conflictPolicy', 'version');
    form.append(
      'file',
      new Blob([initialExcelBytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      'Fluxo-Caixa-2026.xlsx',
    );
    const up = await cluster.apiFetch(ownerToken, '/api/v1/storage/upload', {
      method: 'POST',
      body: form,
    });
    expect([200, 201]).toContain(up.status);
    excelNodeId = (up.data?.node || up.data).id;
  }, 45_000);

  afterAll(async () => {
    try {
      if (agent) await agent.stop();
    } finally {
      if (cluster) await cluster.stop();
    }
  }, 45_000);

  it('blocks viewer_online from opening a desktop sync session (403)', async () => {
    const res = await cluster.apiFetch(collabRhToken, `/api/v1/storage/nodes/${excelNodeId}/desktop-session`, {
      method: 'POST',
      body: {},
    });
    expect(res.status).toBe(403);
  });

  it('runs full desktop edit lifecycle: lock -> download -> autosave upload -> dedup -> heartbeat -> close/unlock', async () => {
    // 1. Collaborator with editor permission starts Desktop Edit Session
    const createRes = await cluster.apiFetch(
      collabFinToken,
      `/api/v1/storage/nodes/${excelNodeId}/desktop-session`,
      { method: 'POST', body: {} },
    );
    expect(createRes.status).toBe(201);
    const sessionToken = createRes.data.sessionToken;
    expect(sessionToken).toMatch(/^nxd_/);
    expect(createRes.data.fileName).toBe('Fluxo-Caixa-2026.xlsx');
    expect(createRes.data.lockedByEmail).toBe('ana.fin@shineraybysabel.com.br');

    // 2. Another user (owner) cannot start a concurrent desktop edit session while locked (423)
    const conflictRes = await cluster.apiFetch(
      ownerToken,
      `/api/v1/storage/nodes/${excelNodeId}/desktop-session`,
      { method: 'POST', body: {} },
    );
    expect(conflictRes.status).toBe(423);

    // 3. Agent downloads file using scoped token (no user JWT required!)
    const dlRes = await cluster.apiFetch(null, `/api/v1/storage/desktop-sessions/${sessionToken}/download`);
    expect(dlRes.status).toBe(200);
    expect(dlRes.buffer.equals(initialExcelBytes)).toBe(true);

    // Status reflects 'opened'
    const statusOpened = await cluster.apiFetch(null, `/api/v1/storage/desktop-sessions/${sessionToken}/status`);
    expect(statusOpened.status).toBe(200);
    expect(statusOpened.data.status).toBe('opened');
    expect(statusOpened.data.openedAt).toBeTruthy();

    // 4. Agent uploads updated file binary on Ctrl+S
    const upRes = await cluster.apiFetch(null, `/api/v1/storage/desktop-sessions/${sessionToken}/upload`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: updatedExcelBytes,
    });
    expect(upRes.status).toBe(200);
    expect(upRes.data.ok).toBe(true);
    expect(upRes.data.unchanged).toBe(false);
    expect(upRes.data.version).toBe(2);
    expect(upRes.data.syncCount).toBe(1);

    // 5. Re-uploading identical bytes skips redundant versioning
    const dupRes = await cluster.apiFetch(null, `/api/v1/storage/desktop-sessions/${sessionToken}/upload`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: updatedExcelBytes,
    });
    expect(dupRes.status).toBe(200);
    expect(dupRes.data.unchanged).toBe(true);
    expect(dupRes.data.version).toBe(2);

    // 6. Heartbeat keeps session alive
    const hbRes = await cluster.apiFetch(null, `/api/v1/storage/desktop-sessions/${sessionToken}/heartbeat`, {
      method: 'POST',
      body: {},
    });
    expect(hbRes.status).toBe(200);
    expect(hbRes.data.ok).toBe(true);

    // 7. Close session unlocks file automatically
    const closeRes = await cluster.apiFetch(null, `/api/v1/storage/desktop-sessions/${sessionToken}/close`, {
      method: 'POST',
      body: {},
    });
    expect(closeRes.status).toBe(200);
    expect(closeRes.data.unlocked).toBe(true);
    expect(closeRes.data.status).toBe('closed');

    // 8. Subsequent upload on closed session fails with 410 Gone
    const afterCloseUp = await cluster.apiFetch(
      null,
      `/api/v1/storage/desktop-sessions/${sessionToken}/upload`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: updatedExcelBytes,
      },
    );
    expect(afterCloseUp.status).toBe(410);

    // 9. File downloaded from Vault now contains updated Excel bytes and is unlocked
    const verifyDl = await cluster.apiFetch(ownerToken, `/api/v1/storage/nodes/${excelNodeId}/download`);
    expect(verifyDl.status).toBe(200);
    expect(verifyDl.buffer.equals(updatedExcelBytes)).toBe(true);

    const integrity = await assertFullAuditIntegrity(cluster.apiFetch, ownerToken);
    expect(integrity.apiResult.intact).toBe(true);
    expect(integrity.localResult.valid).toBe(true);
  });
});
