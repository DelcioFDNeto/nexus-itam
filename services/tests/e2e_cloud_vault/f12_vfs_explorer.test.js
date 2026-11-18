// services/tests/e2e_cloud_vault/f12_vfs_explorer.test.js
// =============================================================================
// F-12: Complete VFS Explorer (CRUD, Search, Zip Download) (Opaque-Box E2E)
// =============================================================================

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootE2eCluster } from './helpers/clusterHarness.js';
import { startMockAgentNode } from './helpers/mockAgentNode.js';

describe('F-12: Complete VFS Explorer (CRUD, Search, Zip Download)', () => {
  let cluster;
  let agent;
  let ownerToken;
  let operatorToken;
  let collabToken;
  let betaToken;
  let corpPublicId;
  let cofreId;

  function extractNodesList(res) {
    if (Array.isArray(res.data)) return res.data;
    return res.data?.items || res.data?.nodes || [];
  }

  async function uploadFile(token, parentId, fileName, contentBuffer, mimeType = 'text/plain') {
    const form = new FormData();
    if (parentId) form.append('parentId', parentId);
    form.append('fileName', fileName);
    form.append('conflictPolicy', 'version');
    form.append('file', new Blob([contentBuffer], { type: mimeType }), fileName);
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
      name: 'VFS Operator TI',
      email: 'vfs.op@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'operator',
      department: 'Tecnologia',
    });
    operatorToken = (await cluster.loginAs('vfs.op@shineraybysabel.com.br', 'Password@2026!')).accessToken;

    await cluster.seedUser(ownerToken, {
      name: 'VFS Collab Fin',
      email: 'vfs.collab@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'collaborator',
      department: 'Financeiro',
    });
    collabToken = (await cluster.loginAs('vfs.collab@shineraybysabel.com.br', 'Password@2026!')).accessToken;

    betaToken = cluster.createUserToken({
      sub: 'beta-vfs-owner',
      email: 'owner@beta-vfs.example.com',
      role: 'owner',
      tenantId: 'tenant-beta',
      department: 'Geral',
    });

    agent = await startMockAgentNode({ quotaBytes: 20 * 1024 * 1024 });
    const parsed = new URL(agent.url);
    const putConn = await cluster.apiFetch(ownerToken, '/api/v1/storage/connection', {
      method: 'PUT',
      body: {
        providerType: 'agent_node',
        label: 'E2E VFS Node',
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
    expect(corpPublicId).toBeTruthy();
    expect(cofreId).toBeTruthy();
  }, 45_000);

  afterAll(async () => {
    try {
      if (agent) await agent.stop();
    } finally {
      if (cluster) await cluster.stop();
    }
  }, 45_000);

  describe('Tier 1 — Core VFS Folder CRUD, Move, Copy, Download & Zip Archive', () => {
    it('creates folders and nested subfolders and lists children via GET /nodes?parentId=', async () => {
      const pRes = await cluster.apiFetch(operatorToken, '/api/v1/storage/folders', {
        method: 'POST',
        body: { parentId: corpPublicId, name: 'F12-Projetos' },
      });
      expect(pRes.status).toBe(201);
      const projetos = pRes.data?.node || pRes.data;
      expect(projetos.node_type).toBe('folder');

      const subRes = await cluster.apiFetch(operatorToken, '/api/v1/storage/folders', {
        method: 'POST',
        body: { parentId: projetos.id, name: '2026' },
      });
      expect(subRes.status).toBe(201);

      const listRes = await cluster.apiFetch(operatorToken, `/api/v1/storage/nodes?parentId=${projetos.id}`);
      expect(listRes.status).toBe(200);
      const children = extractNodesList(listRes);
      const sub = children.find((n) => n.name === '2026');
      expect(sub).toBeTruthy();
      expect(sub.node_type).toBe('folder');
      expect(sub.virtual_path).toContain('/F12-Projetos/2026');
    });

    it('renames and moves a folder subtree via PATCH /nodes/:id, updating virtual_path of descendants', async () => {
      const srcParent = (
        await cluster.apiFetch(operatorToken, '/api/v1/storage/folders', {
          method: 'POST',
          body: { parentId: corpPublicId, name: 'F12-Move-Src' },
        })
      ).data;
      const targetParent = (
        await cluster.apiFetch(operatorToken, '/api/v1/storage/folders', {
          method: 'POST',
          body: { parentId: corpPublicId, name: 'F12-Move-Dst' },
        })
      ).data;

      const srcId = (srcParent?.node || srcParent)?.id;
      const dstId = (targetParent?.node || targetParent)?.id;
      expect(srcId).toBeTruthy();
      expect(dstId).toBeTruthy();

      const childRes = await cluster.apiFetch(operatorToken, '/api/v1/storage/folders', {
        method: 'POST',
        body: { parentId: srcId, name: 'SubPasta' },
      });
      expect(childRes.status).toBe(201);
      const childId = (childRes.data?.node || childRes.data).id;

      const patchRes = await cluster.apiFetch(operatorToken, `/api/v1/storage/nodes/${srcId}`, {
        method: 'PATCH',
        body: { name: 'Arquivos-2026', parentId: dstId },
      });
      expect(patchRes.status).toBe(200);
      const moved = patchRes.data?.node || patchRes.data;
      expect(moved.name).toBe('Arquivos-2026');
      expect(moved.virtual_path).toContain('/F12-Move-Dst/Arquivos-2026');

      const descList = extractNodesList(
        await cluster.apiFetch(operatorToken, `/api/v1/storage/nodes?parentId=${srcId}`),
      );
      const movedChild = descList.find((n) => n.id === childId);
      expect(movedChild?.virtual_path).toContain('/F12-Move-Dst/Arquivos-2026/SubPasta');
    });

    it('copies a file node preserving exact binary content and creating a distinct node ID', async () => {
      const payload = Buffer.from('F12-Copy-Exact-Binary-Payload-0123456789', 'utf8');
      const up = await uploadFile(operatorToken, corpPublicId, 'f12-original.txt', payload);
      expect([200, 201]).toContain(up.status);
      const origId = (up.data?.node || up.data).id;

      const copyRes = await cluster.apiFetch(operatorToken, `/api/v1/storage/nodes/${origId}/copy`, {
        method: 'POST',
        body: { targetParentId: corpPublicId, name: 'f12-copia.txt' },
      });
      expect([200, 201]).toContain(copyRes.status);
      const copied = copyRes.data?.node || copyRes.data;
      expect(copied.id).toBeTruthy();
      expect(copied.id).not.toBe(origId);

      const dlRes = await cluster.apiFetch(operatorToken, `/api/v1/storage/nodes/${copied.id}/download`);
      expect(dlRes.status).toBe(200);
      expect(dlRes.buffer.equals(payload)).toBe(true);
    });

    it('downloads a single file with Content-Disposition attachment and exact bytes', async () => {
      const binaryBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xde, 0xad, 0xbe, 0xef]);
      const up = await uploadFile(operatorToken, corpPublicId, 'f12-download.bin', binaryBytes, 'application/octet-stream');
      expect([200, 201]).toContain(up.status);
      const fileId = (up.data?.node || up.data).id;

      const dl = await cluster.apiFetch(operatorToken, `/api/v1/storage/nodes/${fileId}/download`);
      expect(dl.status).toBe(200);
      const disp = dl.headers.get('content-disposition') || '';
      expect(disp.toLowerCase()).toContain('attachment');
      expect(disp).toContain('f12-download.bin');
      expect(dl.buffer.equals(binaryBytes)).toBe(true);
    });

    it('downloads multi-item ZIP archive via POST /nodes/download-zip with valid PK header and entry names', async () => {
      const f1 = await uploadFile(operatorToken, corpPublicId, 'f12-zip-one.txt', Buffer.from('ZIP_ONE_DATA', 'utf8'));
      expect([200, 201]).toContain(f1.status);
      const f1Id = (f1.data?.node || f1.data).id;

      const subFolder = await cluster.apiFetch(operatorToken, '/api/v1/storage/folders', {
        method: 'POST',
        body: { parentId: corpPublicId, name: 'f12-zip-dir' },
      });
      expect(subFolder.status).toBe(201);
      const dirId = (subFolder.data?.node || subFolder.data).id;

      const f2 = await uploadFile(operatorToken, dirId, 'f12-zip-two.txt', Buffer.from('ZIP_TWO_DATA', 'utf8'));
      expect([200, 201]).toContain(f2.status);

      const zipRes = await cluster.apiFetch(operatorToken, '/api/v1/storage/nodes/download-zip', {
        method: 'POST',
        body: { nodeIds: [f1Id, dirId] },
      });
      expect(zipRes.status).toBe(200);
      const contentType = zipRes.headers.get('content-type') || '';
      expect(contentType.toLowerCase()).toContain('zip');
      expect(zipRes.buffer.length).toBeGreaterThan(22);
      expect(zipRes.buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe(true);
      expect(zipRes.buffer.includes(Buffer.from('f12-zip-one.txt'))).toBe(true);
      expect(zipRes.buffer.includes(Buffer.from('f12-zip-two.txt'))).toBe(true);
    });
  });

  describe('Tier 2 — Search ACL Filtering, Conflict/Cycle/Traversal & Cross-Tenant Isolation', () => {
    it('filters server-side search GET /nodes?q= by ACL, omitting none-access nodes', async () => {
      const secretUp = await uploadFile(
        ownerToken,
        cofreId,
        'f12-contrato-confidencial.pdf',
        Buffer.from('%PDF-1.4 SECRET', 'utf8'),
        'application/pdf',
      );
      expect([200, 201]).toContain(secretUp.status);

      const pubUp = await uploadFile(
        ownerToken,
        corpPublicId,
        'f12-contrato-rh.pdf',
        Buffer.from('%PDF-1.4 PUBLIC', 'utf8'),
        'application/pdf',
      );
      expect([200, 201]).toContain(pubUp.status);

      const searchRes = await cluster.apiFetch(collabToken, '/api/v1/storage/nodes?q=f12-contrato');
      expect(searchRes.status).toBe(200);
      const items = extractNodesList(searchRes);
      const names = items.map((n) => n.name);
      expect(names).toContain('f12-contrato-rh.pdf');
      expect(names).not.toContain('f12-contrato-confidencial.pdf');
    });

    it('rejects duplicate folder name conflict at same parent with 409 PATH_ALREADY_EXISTS', async () => {
      const first = await cluster.apiFetch(operatorToken, '/api/v1/storage/folders', {
        method: 'POST',
        body: { parentId: corpPublicId, name: 'F12-DupFolder' },
      });
      expect(first.status).toBe(201);

      const second = await cluster.apiFetch(operatorToken, '/api/v1/storage/folders', {
        method: 'POST',
        body: { parentId: corpPublicId, name: 'F12-DupFolder' },
      });
      expect(second.status).toBe(409);
      expect(JSON.stringify(second.data || second.text)).toContain('PATH_ALREADY_EXISTS');
    });

    it('rejects moving a folder into its own descendant (400 CYCLE_DETECTED) and traversal names', async () => {
      const parentRes = await cluster.apiFetch(operatorToken, '/api/v1/storage/folders', {
        method: 'POST',
        body: { parentId: corpPublicId, name: 'F12-Cycle-Parent' },
      });
      expect(parentRes.status).toBe(201);
      const parentId = (parentRes.data?.node || parentRes.data).id;

      const childRes = await cluster.apiFetch(operatorToken, '/api/v1/storage/folders', {
        method: 'POST',
        body: { parentId, name: 'F12-Cycle-Child' },
      });
      expect(childRes.status).toBe(201);
      const childId = (childRes.data?.node || childRes.data).id;

      const cycleMove = await cluster.apiFetch(operatorToken, `/api/v1/storage/nodes/${parentId}`, {
        method: 'PATCH',
        body: { parentId: childId },
      });
      expect(cycleMove.status).toBe(400);
      expect(JSON.stringify(cycleMove.data || cycleMove.text)).toContain('CYCLE_DETECTED');

      const traversalFolder = await cluster.apiFetch(operatorToken, '/api/v1/storage/folders', {
        method: 'POST',
        body: { parentId: corpPublicId, name: '../../etc' },
      });
      expect([400, 403]).toContain(traversalFolder.status);
    });

    it('blocks single download and download-zip when user has only viewer_online ACL (403)', async () => {
      const voFolderRes = await cluster.apiFetch(ownerToken, '/api/v1/storage/folders', {
        method: 'POST',
        body: { parentId: corpPublicId, name: 'F12-ViewerOnly-Folder' },
      });
      expect(voFolderRes.status).toBe(201);
      const voFolderId = (voFolderRes.data?.node || voFolderRes.data).id;

      const aclRes = await cluster.apiFetch(ownerToken, `/api/v1/storage/nodes/${voFolderId}/acl`, {
        method: 'PUT',
        body: {
          rules: [
            { targetType: 'user', targetValue: 'vfs.collab@shineraybysabel.com.br', accessLevel: 'viewer_online' },
          ],
        },
      });
      expect([200, 201]).toContain(aclRes.status);

      const up = await uploadFile(ownerToken, voFolderId, 'f12-vo-secret.txt', Buffer.from('VIEW_ONLY', 'utf8'));
      expect([200, 201]).toContain(up.status);
      const fileId = (up.data?.node || up.data).id;

      const dlRes = await cluster.apiFetch(collabToken, `/api/v1/storage/nodes/${fileId}/download`);
      expect(dlRes.status).toBe(403);

      const zipRes = await cluster.apiFetch(collabToken, '/api/v1/storage/nodes/download-zip', {
        method: 'POST',
        body: { nodeIds: [fileId] },
      });
      expect(zipRes.status).toBe(403);
    });

    it('enforces strict cross-tenant isolation across download, patch, copy, and download-zip', async () => {
      const up = await uploadFile(ownerToken, corpPublicId, 'f12-tenant-a.txt', Buffer.from('TENANT_A', 'utf8'));
      expect([200, 201]).toContain(up.status);
      const nodeId = (up.data?.node || up.data).id;

      const dl = await cluster.apiFetch(betaToken, `/api/v1/storage/nodes/${nodeId}/download`);
      expect([403, 404]).toContain(dl.status);

      const patch = await cluster.apiFetch(betaToken, `/api/v1/storage/nodes/${nodeId}`, {
        method: 'PATCH',
        body: { name: 'hijacked.txt' },
      });
      expect([403, 404]).toContain(patch.status);

      const copy = await cluster.apiFetch(betaToken, `/api/v1/storage/nodes/${nodeId}/copy`, {
        method: 'POST',
        body: { targetParentId: null, name: 'stolen.txt' },
      });
      expect([403, 404]).toContain(copy.status);

      const zip = await cluster.apiFetch(betaToken, '/api/v1/storage/nodes/download-zip', {
        method: 'POST',
        body: { nodeIds: [nodeId] },
      });
      expect([403, 404]).toContain(zip.status);
    });
  });
});
