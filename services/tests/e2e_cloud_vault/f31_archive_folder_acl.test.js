// services/tests/e2e_cloud_vault/f31_archive_folder_acl.test.js
// =============================================================================
// F-31: Folder Tree Upload (ensure:true), Archive Extraction (.zip/.tar.gz +
// Zip-Slip/Executable protection) & Enhanced Folder Permissions API
// =============================================================================

import zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootE2eCluster } from './helpers/clusterHarness.js';
import { startMockAgentNode } from './helpers/mockAgentNode.js';

let cluster;
let agent;
let ownerSession;
let colabReader;
let colabEditor;

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildTestZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const rawData = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data || '', 'utf8');
    const useDeflate = entry.deflate === true && rawData.length > 0;
    const compData = useDeflate ? zlib.deflateRawSync(rawData) : rawData;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(rawData);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compData.length, 18);
    local.writeUInt32LE(rawData.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    localParts.push(local, nameBuf, compData);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compData.length, 20);
    central.writeUInt32LE(rawData.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);

    centralParts.push(central, nameBuf);
    offset += local.length + nameBuf.length + compData.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, centralBuf, eocd]);
}

function buildTestTarGz(entries) {
  const blocks = [];
  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data || '', 'utf8');
    const header = Buffer.alloc(512, 0);
    header.write(entry.name, 0, Math.min(entry.name.length, 100), 'utf8');
    header.write('0000644\0', 100, 8, 'ascii');
    header.write('0000000\0', 108, 8, 'ascii');
    header.write('0000000\0', 116, 8, 'ascii');
    header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
    header.write(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, '0')}\0`, 136, 12, 'ascii');
    header.write('        ', 148, 8, 'ascii');
    header.write(entry.isDir ? '5' : '0', 156, 1, 'ascii');
    header.write('ustar\0', 257, 6, 'ascii');
    header.write('00', 263, 2, 'ascii');

    let checksum = 0;
    for (let i = 0; i < 512; i += 1) checksum += header[i];
    header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
    blocks.push(header);

    if (!entry.isDir && data.length > 0) {
      blocks.push(data);
      const pad = (512 - (data.length % 512)) % 512;
      if (pad > 0) blocks.push(Buffer.alloc(pad, 0));
    }
  }
  blocks.push(Buffer.alloc(1024, 0));
  return zlib.gzipSync(Buffer.concat(blocks));
}

async function uploadBuffer(token, parentId, fileName, buffer, mimeType = 'application/octet-stream') {
  const form = new FormData();
  if (parentId) form.append('parentId', String(parentId));
  form.append('conflictPolicy', 'version');
  form.append('file', new Blob([buffer], { type: mimeType }), fileName);
  const res = await cluster.apiFetch(token, '/api/v1/storage/upload', {
    method: 'POST',
    body: form,
  });
  expect([200, 201]).toContain(res.status);
  return res.data?.node || res.data?.file || res.data;
}

describe('F-31: Folder Tree Ensure, Archive Extraction & Enhanced Folder ACLs', () => {
  let setoresFolder;

  beforeAll(async () => {
    cluster = await bootE2eCluster();
    agent = await startMockAgentNode({ quotaBytes: 50 * 1024 * 1024 });
    ownerSession = await cluster.loginAs('ti@shineraybysabel.com.br', 'Shineray@2026!');

    await cluster.seedUser(ownerSession.accessToken, {
      name: 'Leitor Archive',
      email: 'reader.f31@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'collaborator',
      department: 'Juridico',
    });
    await cluster.seedUser(ownerSession.accessToken, {
      name: 'Editor Archive',
      email: 'editor.f31@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'collaborator',
      department: 'Engenharia',
    });

    colabReader = await cluster.loginAs('reader.f31@shineraybysabel.com.br', 'Password@2026!');
    colabEditor = await cluster.loginAs('editor.f31@shineraybysabel.com.br', 'Password@2026!');

    const connRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/connection', {
      method: 'PUT',
      body: {
        providerType: 'agent_node',
        label: 'E2E F31 Agent',
        endpointUrl: agent.url,
        rootPath: '/',
        quotaBytes: agent.quotaBytes,
        credentials: { hmacToken: agent.hmacToken },
      },
    });
    expect(connRes.status).toBe(200);

    const initRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/initialize', {
      method: 'POST',
      body: {},
    });
    expect(initRes.ok).toBe(true);

    const nodesRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/nodes');
    const items = nodesRes.data?.items || [];
    setoresFolder = items.find((n) => (n.virtualPath || n.virtual_path) === '/Setores');
    expect(setoresFolder?.id).toBeTruthy();
  }, 45_000);

  afterAll(async () => {
    if (cluster) await cluster.stop();
    if (agent) await agent.stop();
  }, 45_000);

  it('POST /folders com ensure:true e idempotente para upload de pastas inteiras e bloqueia colisao com arquivo', async () => {
    const first = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/folders', {
      method: 'POST',
      body: { parentId: setoresFolder.id, name: 'UploadPastaDireta', ensure: true },
    });
    expect(first.status).toBe(201);
    expect(first.data.existed).toBe(false);
    const folderId = first.data.node.id;

    // Second call with ensure:true returns 200 and same folder id instead of 409
    const second = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/folders', {
      method: 'POST',
      body: { parentId: setoresFolder.id, name: 'UploadPastaDireta', ensure: true },
    });
    expect(second.status).toBe(200);
    expect(second.data.existed).toBe(true);
    expect(second.data.node.id).toBe(folderId);

    // Nested subfolder: ensure:true is idempotent (201 -> 200), while omitting ensure returns 409
    const subFirst = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/folders', {
      method: 'POST',
      body: { parentId: folderId, name: 'SubNivel1', ensure: true },
    });
    expect(subFirst.status).toBe(201);
    expect(subFirst.data.existed).toBe(false);

    const subSecond = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/folders', {
      method: 'POST',
      body: { parentId: folderId, name: 'SubNivel1', ensure: true },
    });
    expect(subSecond.status).toBe(200);
    expect(subSecond.data.existed).toBe(true);
    expect(subSecond.data.node.id).toBe(subFirst.data.node.id);

    // Without ensure:true on nested folder, duplicate returns 409
    const dup = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/folders', {
      method: 'POST',
      body: { parentId: folderId, name: 'SubNivel1' },
    });
    expect(dup.status).toBe(409);

    // File collision still returns 409 even with ensure:true
    await uploadBuffer(ownerSession.accessToken, folderId, 'conflito.txt', Buffer.from('oi'), 'text/plain');
    const fileCollision = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/folders', {
      method: 'POST',
      body: { parentId: folderId, name: 'conflito.txt', ensure: true },
    });
    expect(fileCollision.status).toBe(409);
  });

  it('POST /nodes/:id/extract extrai .zip (Store + Deflate + subpastas), bloqueia .exe e ignora lixo OS', async () => {
    const workDir = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/folders', {
      method: 'POST',
      body: { parentId: setoresFolder.id, name: 'TestExtractZip', ensure: true },
    });
    const workDirId = workDir.data.node.id;

    const zipBuf = buildTestZip([
      { name: 'docs/2026/resumo.txt', data: 'Relatorio financeiro 2026', deflate: true },
      { name: 'notas.txt', data: 'Conteudo sem compressao', deflate: false },
      { name: 'malware/trojan.exe', data: 'MZ_FAKE_EXE', deflate: false },
      { name: '__MACOSX/._resumo.txt', data: 'junk', deflate: false },
      { name: 'Thumbs.db', data: 'junk', deflate: false },
    ]);

    const zipNode = await uploadBuffer(
      ownerSession.accessToken,
      workDirId,
      'pacote-mensal.zip',
      zipBuf,
      'application/zip',
    );

    const extractRes = await cluster.apiFetch(
      ownerSession.accessToken,
      `/api/v1/storage/nodes/${zipNode.id}/extract`,
      {
        method: 'POST',
        body: { mode: 'subfolder', folderName: 'Pacote-Extraido', conflictPolicy: 'rename' },
      },
    );

    expect(extractRes.status).toBe(200);
    expect(extractRes.data.ok).toBe(true);
    expect(extractRes.data.format).toBe('zip');
    expect(extractRes.data.filesExtracted).toBe(2);
    expect(extractRes.data.destinationFolder?.name).toBe('Pacote-Extraido');
    expect(extractRes.data.blockedExecutables).toContain('malware/trojan.exe');

    const allNodesRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/nodes');
    const allNodes = allNodesRes.data?.items || [];
    const resumo = allNodes.find((n) =>
      String(n.virtualPath || n.virtual_path).endsWith('/Pacote-Extraido/docs/2026/resumo.txt'),
    );
    const notas = allNodes.find((n) =>
      String(n.virtualPath || n.virtual_path).endsWith('/Pacote-Extraido/notas.txt'),
    );
    const exeNode = allNodes.find((n) => String(n.name) === 'trojan.exe');

    expect(resumo?.id).toBeTruthy();
    expect(notas?.id).toBeTruthy();
    expect(exeNode).toBeUndefined();

    // Verify exact bytes round-trip via download
    const dl = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/nodes/${resumo.id}/download`);
    expect(dl.status).toBe(200);
    expect(dl.text).toBe('Relatorio financeiro 2026');
  });

  it('POST /nodes/:id/extract suporta .tar.gz em mode:here e politicas de conflito (version/skip/rename)', async () => {
    const workDir = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/folders', {
      method: 'POST',
      body: { parentId: setoresFolder.id, name: 'TestExtractTar', ensure: true },
    });
    const workDirId = workDir.data.node.id;

    const tgzBuf = buildTestTarGz([
      { name: 'sub/log.txt', data: 'linha 1 tar.gz' },
    ]);
    const tgzNode = await uploadBuffer(
      ownerSession.accessToken,
      workDirId,
      'backup-logs.tar.gz',
      tgzBuf,
      'application/gzip',
    );

    // 1. Extract here
    const first = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/nodes/${tgzNode.id}/extract`, {
      method: 'POST',
      body: { mode: 'here', conflictPolicy: 'rename' },
    });
    expect(first.status).toBe(200);
    expect(first.data.format).toBe('tar.gz');
    expect(first.data.filesExtracted).toBe(1);

    // 2. Extract again with conflictPolicy: 'skip'
    const skipped = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/nodes/${tgzNode.id}/extract`, {
      method: 'POST',
      body: { mode: 'here', conflictPolicy: 'skip' },
    });
    expect(skipped.status).toBe(200);
    expect(skipped.data.filesExtracted).toBe(0);
    expect(skipped.data.skipped.length).toBe(1);

    // 3. Extract again with conflictPolicy: 'version'
    const versioned = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/nodes/${tgzNode.id}/extract`, {
      method: 'POST',
      body: { mode: 'here', conflictPolicy: 'version' },
    });
    expect(versioned.status).toBe(200);
    expect(versioned.data.filesExtracted).toBe(1);
    expect(versioned.data.nodes[0].currentVersion).toBeGreaterThanOrEqual(2);
  });

  it('rejeita Zip-Slip (Path Traversal ../) com 400 ARCHIVE_PATH_TRAVERSAL e bloqueia extracao para leitor (403)', async () => {
    const workDir = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/folders', {
      method: 'POST',
      body: { parentId: setoresFolder.id, name: 'TestSecurityZip', ensure: true },
    });
    const workDirId = workDir.data.node.id;

    // Grant Juridico only reader on TestSecurityZip
    await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/nodes/${workDirId}/acl`, {
      method: 'PUT',
      body: { rules: [{ targetType: 'department', targetValue: 'Juridico', accessLevel: 'reader' }] },
    });

    const evilZip = buildTestZip([{ name: '../../etc/passwd', data: 'root:x:0:0' }]);
    const evilNode = await uploadBuffer(ownerSession.accessToken, workDirId, 'malicioso.zip', evilZip, 'application/zip');

    // Owner tries to extract evil zip -> rejected with 400 ARCHIVE_PATH_TRAVERSAL
    const evilRes = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/nodes/${evilNode.id}/extract`, {
      method: 'POST',
      body: { mode: 'subfolder', folderName: 'EvilOut' },
    });
    expect(evilRes.status).toBe(400);
    expect(evilRes.data?.error).toBe('ARCHIVE_PATH_TRAVERSAL');

    // Collaborator with reader permission tries to extract -> rejected with 403
    const goodZip = buildTestZip([{ name: 'ok.txt', data: 'ok' }]);
    const goodNode = await uploadBuffer(ownerSession.accessToken, workDirId, 'normal.zip', goodZip, 'application/zip');
    const readerAttempt = await cluster.apiFetch(colabReader.accessToken, `/api/v1/storage/nodes/${goodNode.id}/extract`, {
      method: 'POST',
      body: { mode: 'subfolder', folderName: 'ReaderOut' },
    });
    expect(readerAttempt.status).toBe(403);

    // Collaborator with editor permission CAN extract cleanly!
    await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/nodes/${workDirId}/acl`, {
      method: 'PUT',
      body: { rules: [{ targetType: 'department', targetValue: 'Engenharia', accessLevel: 'editor' }] },
    });
    const editorAttempt = await cluster.apiFetch(colabEditor.accessToken, `/api/v1/storage/nodes/${goodNode.id}/extract`, {
      method: 'POST',
      body: { mode: 'subfolder', folderName: 'EngenhariaOut' },
    });
    expect(editorAttempt.status).toBe(200);
    expect(editorAttempt.data.filesExtracted).toBe(1);
  });

  it('PUT /acl preserva todas as regras anteriores e GET /acl expoe inheritedRules e defaultPolicy em portugues', async () => {
    const parentRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/folders', {
      method: 'POST',
      body: { parentId: setoresFolder.id, name: 'AreaComercial', ensure: true },
    });
    const parentId = parentRes.data.node.id;

    const childRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/folders', {
      method: 'POST',
      body: { parentId, name: 'Propostas2026', ensure: true },
    });
    const childId = childRes.data.node.id;

    // Add 1st custom rule on parent (AreaComercial already has auto department rule -> 2 total)
    const put1 = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/nodes/${parentId}/acl`, {
      method: 'PUT',
      body: { rules: [{ targetType: 'department', targetValue: 'Comercial', accessLevel: 'editor' }] },
    });
    expect(put1.status).toBe(200);
    expect(put1.data.rules.length).toBe(2);

    // Add 2nd custom rule on parent -> response MUST preserve ALL previous rules (3 total)
    const put2 = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/nodes/${parentId}/acl`, {
      method: 'PUT',
      body: { rules: [{ targetType: 'role', targetValue: 'viewer', accessLevel: 'reader' }] },
    });
    expect(put2.status).toBe(200);
    expect(put2.data.rules.length).toBe(3);

    // GET /acl on child folder MUST include inheritedRules from AreaComercial + defaultPolicy
    const childAcl = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/nodes/${childId}/acl`);
    expect(childAcl.status).toBe(200);
    expect(Array.isArray(childAcl.data.inheritedRules)).toBe(true);
    expect(childAcl.data.inheritedRules.length).toBe(3);
    expect(childAcl.data.inheritedRules[0].sourceNodeId).toBe(parentId);
    expect(childAcl.data.inheritedRules[0].sourceName).toBe('AreaComercial');
    expect(childAcl.data.defaultPolicy?.summary).toBeTruthy();
  });
});
