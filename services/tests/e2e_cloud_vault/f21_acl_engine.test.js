// services/tests/e2e_cloud_vault/f21_acl_engine.test.js
// =============================================================================
// F-21: 5-Level Granular ACL Engine & Inheritance (E2E Opaque-Box Suite)
// =============================================================================

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootE2eCluster } from './helpers/clusterHarness.js';
import { startMockAgentNode } from './helpers/mockAgentNode.js';

let cluster;
let agent;
let ownerSession;
let colabFin1;
let colabFin2;
let colabRh;
let operatorUser;
let betaOwnerToken;
let superadminToken;

const initializedTenants = new Set();

function extractNodes(res) {
  if (!res?.data) return [];
  if (Array.isArray(res.data.items)) return res.data.items;
  if (Array.isArray(res.data.nodes)) return res.data.nodes;
  if (Array.isArray(res.data)) return res.data;
  return [];
}

function nodePath(node) {
  return String(node?.virtual_path || node?.virtualPath || node?.path || '');
}

function nodeAccess(node) {
  return node?.effectiveAccess || node?.effective_access || node?.accessLevel || node?.access_level || null;
}

async function ensureVaultConnected(token = ownerSession.accessToken, tenantKey = 'tenant-ap3htf6') {
  if (initializedTenants.has(tenantKey)) {
    return { ready: true };
  }
  let connRes = await cluster.apiFetch(token, '/api/v1/storage/connection', {
    method: 'PUT',
    body: {
      providerType: 'agent_node',
      label: `E2E Agent (${tenantKey})`,
      endpointUrl: agent.url,
      rootPath: '/',
      quotaBytes: agent.quotaBytes,
      credentials: { hmacToken: agent.hmacToken },
    },
  });
  if (connRes.status === 400 && !connRes.ok) {
    connRes = await cluster.apiFetch(token, '/api/v1/storage/connection', {
      method: 'PUT',
      body: {
        providerType: 'agent_node',
        label: `E2E Agent (${tenantKey})`,
        endpointUrl: agent.url,
        rootPath: '/',
        quotaBytes: agent.quotaBytes,
        hmacToken: agent.hmacToken,
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
  return { ready: true, initRes };
}

async function listAllNodes(token) {
  const res = await cluster.apiFetch(token, '/api/v1/storage/nodes');
  expect(res.status).toBe(200);
  return extractNodes(res);
}

async function findFolderByPath(token, targetVirtualPath) {
  const top = await listAllNodes(token);
  const direct = top.find((n) => nodePath(n) === targetVirtualPath);
  if (direct) return direct;

  const segments = targetVirtualPath.split('/').filter(Boolean);
  let parentId = null;
  let current = null;
  for (let i = 0; i < segments.length; i += 1) {
    const partialPath = `/${segments.slice(0, i + 1).join('/')}`;
    const q = parentId ? `?parentId=${encodeURIComponent(parentId)}` : '';
    const res = await cluster.apiFetch(token, `/api/v1/storage/nodes${q}`);
    if (!res.ok) return null;
    const items = extractNodes(res);
    current =
      items.find((n) => nodePath(n) === partialPath) ||
      items.find((n) => n.name === segments[i]);
    if (!current) return null;
    parentId = current.id;
  }
  return current;
}

async function createFolder(token, parentId, name) {
  const res = await cluster.apiFetch(token, '/api/v1/storage/folders', {
    method: 'POST',
    body: { parentId, name },
  });
  expect([200, 201]).toContain(res.status);
  return res.data?.node || res.data?.folder || res.data;
}

async function uploadTextFile(token, parentId, fileName, content = 'conteudo teste') {
  const form = new FormData();
  if (parentId) form.append('parentId', String(parentId));
  form.append('conflictPolicy', 'version');
  form.append('file', new Blob([content], { type: 'text/plain' }), fileName);
  const res = await cluster.apiFetch(token, '/api/v1/storage/upload', {
    method: 'POST',
    body: form,
  });
  expect([200, 201]).toContain(res.status);
  return res.data?.node || res.data?.file || res.data;
}

async function setNodeAcl(token, nodeId, rules) {
  const res = await cluster.apiFetch(token, `/api/v1/storage/nodes/${nodeId}/acl`, {
    method: 'PUT',
    body: { rules },
  });
  expect([200, 201]).toContain(res.status);
  return res.data;
}

describe('F-21: 5-Level Granular ACL Engine & Inheritance', () => {
  beforeAll(async () => {
    cluster = await bootE2eCluster();
    agent = await startMockAgentNode({ quotaBytes: 50 * 1024 * 1024 });
    ownerSession = await cluster.loginAs('ti@shineraybysabel.com.br', 'Shineray@2026!');

    await cluster.seedUser(ownerSession.accessToken, {
      name: 'Colaborador Fin 1',
      email: 'fin1.acl@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'collaborator',
      department: 'Financeiro',
    });
    await cluster.seedUser(ownerSession.accessToken, {
      name: 'Colaborador Fin 2',
      email: 'fin2.acl@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'collaborator',
      department: 'Financeiro',
    });
    await cluster.seedUser(ownerSession.accessToken, {
      name: 'Colaborador RH',
      email: 'rh1.acl@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'collaborator',
      department: 'RH',
    });
    await cluster.seedUser(ownerSession.accessToken, {
      name: 'Operador ACL',
      email: 'op.acl@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'operator',
      department: 'Operacoes',
    });

    colabFin1 = await cluster.loginAs('fin1.acl@shineraybysabel.com.br', 'Password@2026!');
    colabFin2 = await cluster.loginAs('fin2.acl@shineraybysabel.com.br', 'Password@2026!');
    colabRh = await cluster.loginAs('rh1.acl@shineraybysabel.com.br', 'Password@2026!');
    operatorUser = await cluster.loginAs('op.acl@shineraybysabel.com.br', 'Password@2026!');

    betaOwnerToken = cluster.createUserToken({
      sub: 'beta-owner-acl',
      email: 'owner@beta-acl.test',
      name: 'Beta Owner',
      role: 'owner',
      tenantId: 'tenant-beta',
      department: 'TI',
    });

    superadminToken = cluster.createUserToken({
      sub: 'sa-master-acl',
      email: 'master@nexus.internal',
      name: 'Nexus Master',
      role: 'superadmin',
      tenantId: 'nexus-master',
    });
  }, 45_000);

  afterAll(async () => {
    if (cluster) await cluster.stop();
    if (agent) await agent.stop();
  }, 45_000);

  describe('Tier 1 — Unit & Contract (5-Level ACL, Inheritance, Precedence, Defaults)', () => {
    it('enforces collaborator defaults across provisioned corporate structure and hides /Cofre-TI-Infra', async () => {
      await ensureVaultConnected();

      const ownerCorp = await findFolderByPath(ownerSession.accessToken, '/Corporativo-Publico');
      const ownerCofre = await findFolderByPath(ownerSession.accessToken, '/Cofre-TI-Infra');
      expect(ownerCorp).toBeTruthy();
      expect(ownerCofre).toBeTruthy();

      const finFolder =
        (await findFolderByPath(ownerSession.accessToken, '/Setores/Financeiro')) ||
        (await createFolder(ownerSession.accessToken, (await findFolderByPath(ownerSession.accessToken, '/Setores')).id, 'Financeiro'));
      expect(finFolder).toBeTruthy();

      const colabTop = await listAllNodes(colabFin1.accessToken);
      const visiblePaths = colabTop.map(nodePath);
      expect(visiblePaths).not.toContain('/Cofre-TI-Infra');

      const pubNode = await findFolderByPath(colabFin1.accessToken, '/Corporativo-Publico');
      expect(pubNode).toBeTruthy();
      expect(nodeAccess(pubNode)).toBe('reader');

      const finSector = await findFolderByPath(colabFin1.accessToken, '/Setores/Financeiro');
      expect(finSector).toBeTruthy();
      expect(nodeAccess(finSector)).toBe('editor');

      const personalPath = `/Espaco-Pessoal/${colabFin1.user.email}`;
      const personalNode = await findFolderByPath(colabFin1.accessToken, personalPath);
      if (personalNode) {
        expect(nodeAccess(personalNode)).toBe('full_control');
      }

      const cofreDirect = await cluster.apiFetch(colabFin1.accessToken, `/api/v1/storage/nodes?parentId=${ownerCofre.id}`);
      expect([403, 404]).toContain(cofreDirect.status);
    });

    it('enforces all 5 ACL levels (none, viewer_online, reader, editor, full_control) on file actions', async () => {
      await ensureVaultConnected();

      const rootPub = await findFolderByPath(ownerSession.accessToken, '/Corporativo-Publico');
      const matrixFolder = await createFolder(ownerSession.accessToken, rootPub.id, 'ACL-Matrix-5Levels');

      const fNone = await createFolder(ownerSession.accessToken, matrixFolder.id, 'Lvl-None');
      const fileNone = await uploadTextFile(ownerSession.accessToken, fNone.id, 'none.txt', 'secret-none');
      await setNodeAcl(ownerSession.accessToken, fNone.id, [
        { targetType: 'user', targetValue: colabRh.user.email, accessLevel: 'none' },
      ]);

      const fViewer = await createFolder(ownerSession.accessToken, matrixFolder.id, 'Lvl-Viewer');
      const fileViewer = await uploadTextFile(ownerSession.accessToken, fViewer.id, 'viewer.txt', 'preview-only');
      await setNodeAcl(ownerSession.accessToken, fViewer.id, [
        { targetType: 'user', targetValue: colabRh.user.email, accessLevel: 'viewer_online' },
      ]);

      const fReader = await createFolder(ownerSession.accessToken, matrixFolder.id, 'Lvl-Reader');
      const fileReader = await uploadTextFile(ownerSession.accessToken, fReader.id, 'reader.txt', 'downloadable');
      await setNodeAcl(ownerSession.accessToken, fReader.id, [
        { targetType: 'user', targetValue: colabRh.user.email, accessLevel: 'reader' },
      ]);

      const fEditor = await createFolder(ownerSession.accessToken, matrixFolder.id, 'Lvl-Editor');
      const ownerFileInEditor = await uploadTextFile(ownerSession.accessToken, fEditor.id, 'owner-item.txt', 'owned-by-ti');
      await setNodeAcl(ownerSession.accessToken, fEditor.id, [
        { targetType: 'user', targetValue: colabRh.user.email, accessLevel: 'editor' },
      ]);

      const fFull = await createFolder(ownerSession.accessToken, matrixFolder.id, 'Lvl-FullControl');
      const ownerFileInFull = await uploadTextFile(ownerSession.accessToken, fFull.id, 'full-target.txt', 'deletable-by-fc');
      await setNodeAcl(ownerSession.accessToken, fFull.id, [
        { targetType: 'user', targetValue: colabRh.user.email, accessLevel: 'full_control' },
      ]);

      // 1. none -> hidden + 403/404 on preview/download
      const listMatrix = await cluster.apiFetch(colabRh.accessToken, `/api/v1/storage/nodes?parentId=${matrixFolder.id}`);
      expect(listMatrix.status).toBe(200);
      expect(extractNodes(listMatrix).map((n) => n.id)).not.toContain(fNone.id);
      const nonePreview = await cluster.apiFetch(colabRh.accessToken, `/api/v1/storage/nodes/${fileNone.id}/preview`);
      expect([403, 404]).toContain(nonePreview.status);

      // 2. viewer_online -> preview 200, download 403, rename 403
      const viewerPreview = await cluster.apiFetch(colabRh.accessToken, `/api/v1/storage/nodes/${fileViewer.id}/preview`);
      expect(viewerPreview.status).toBe(200);
      const viewerDownload = await cluster.apiFetch(colabRh.accessToken, `/api/v1/storage/nodes/${fileViewer.id}/download`);
      expect(viewerDownload.status).toBe(403);
      const viewerRename = await cluster.apiFetch(colabRh.accessToken, `/api/v1/storage/nodes/${fileViewer.id}`, {
        method: 'PATCH',
        body: { name: 'renamed-fail.txt' },
      });
      expect(viewerRename.status).toBe(403);

      // 3. reader -> download 200, rename 403
      const readerDownload = await cluster.apiFetch(colabRh.accessToken, `/api/v1/storage/nodes/${fileReader.id}/download`);
      expect(readerDownload.status).toBe(200);
      expect(readerDownload.text).toContain('downloadable');
      const readerRename = await cluster.apiFetch(colabRh.accessToken, `/api/v1/storage/nodes/${fileReader.id}`, {
        method: 'PATCH',
        body: { name: 'reader-rename-fail.txt' },
      });
      expect(readerRename.status).toBe(403);

      // 4. editor -> upload & own delete 200, deleting someone else's file 403
      const colabOwnFile = await uploadTextFile(colabRh.accessToken, fEditor.id, 'rh-own.txt', 'rh-created');
      const delOther = await cluster.apiFetch(colabRh.accessToken, `/api/v1/storage/nodes/${ownerFileInEditor.id}`, {
        method: 'DELETE',
      });
      expect(delOther.status).toBe(403);
      const delOwn = await cluster.apiFetch(colabRh.accessToken, `/api/v1/storage/nodes/${colabOwnFile.id}`, {
        method: 'DELETE',
      });
      expect([200, 204]).toContain(delOwn.status);

      // 5. full_control -> can delete another user's file
      const delFull = await cluster.apiFetch(colabRh.accessToken, `/api/v1/storage/nodes/${ownerFileInFull.id}`, {
        method: 'DELETE',
      });
      expect([200, 204]).toContain(delFull.status);
    });

    it('inherits parent ACL down through nested subfolders and files', async () => {
      await ensureVaultConnected();

      const cofre = await findFolderByPath(ownerSession.accessToken, '/Cofre-TI-Infra');
      const parentHeranca = await createFolder(ownerSession.accessToken, cofre.id, 'Heranca-Parent');
      await setNodeAcl(ownerSession.accessToken, parentHeranca.id, [
        { targetType: 'department', targetValue: 'RH', accessLevel: 'reader' },
      ]);

      const childFolder = await createFolder(ownerSession.accessToken, parentHeranca.id, 'Nested-Child');
      const nestedFile = await uploadTextFile(ownerSession.accessToken, childFolder.id, 'manual-rh.txt', 'inherited-reader-content');

      const childList = await cluster.apiFetch(colabRh.accessToken, `/api/v1/storage/nodes?parentId=${parentHeranca.id}`);
      expect(childList.status).toBe(200);
      const listedChild = extractNodes(childList).find((n) => n.id === childFolder.id);
      expect(listedChild).toBeTruthy();
      expect(nodeAccess(listedChild)).toBe('reader');

      const fileList = await cluster.apiFetch(colabRh.accessToken, `/api/v1/storage/nodes?parentId=${childFolder.id}`);
      expect(fileList.status).toBe(200);
      const listedFile = extractNodes(fileList).find((n) => n.id === nestedFile.id);
      expect(listedFile).toBeTruthy();
      expect(nodeAccess(listedFile)).toBe('reader');

      const dlRes = await cluster.apiFetch(colabRh.accessToken, `/api/v1/storage/nodes/${nestedFile.id}/download`);
      expect(dlRes.status).toBe(200);
      expect(dlRes.text).toContain('inherited-reader-content');
    });

    it('applies specificity precedence user > role > department over inherited ACLs', async () => {
      await ensureVaultConnected();

      const pub = await findFolderByPath(ownerSession.accessToken, '/Corporativo-Publico');
      const precFolder = await createFolder(ownerSession.accessToken, pub.id, 'Precedence-Check');
      await setNodeAcl(ownerSession.accessToken, precFolder.id, [
        { targetType: 'department', targetValue: 'Financeiro', accessLevel: 'editor' },
        { targetType: 'role', targetValue: 'collaborator', accessLevel: 'reader' },
        { targetType: 'user', targetValue: colabFin1.user.email, accessLevel: 'full_control' },
      ]);

      const fin1List = await cluster.apiFetch(colabFin1.accessToken, `/api/v1/storage/nodes?parentId=${pub.id}`);
      expect(fin1List.status).toBe(200);
      const fin1Node = extractNodes(fin1List).find((n) => n.id === precFolder.id);
      expect(nodeAccess(fin1Node)).toBe('full_control');

      const fin2List = await cluster.apiFetch(colabFin2.accessToken, `/api/v1/storage/nodes?parentId=${pub.id}`);
      expect(fin2List.status).toBe(200);
      const fin2Node = extractNodes(fin2List).find((n) => n.id === precFolder.id);
      expect(nodeAccess(fin2Node)).toBe('reader');
    });

    it('supports owner ACL CRUD (GET/PUT/DELETE) and denies cloud:acl to collaborator/operator', async () => {
      await ensureVaultConnected();

      const pub = await findFolderByPath(ownerSession.accessToken, '/Corporativo-Publico');
      const crudFolder = await createFolder(ownerSession.accessToken, pub.id, 'ACL-CRUD-Test');

      await setNodeAcl(ownerSession.accessToken, crudFolder.id, [
        { targetType: 'department', targetValue: 'RH', accessLevel: 'viewer_online' },
      ]);

      const getAclRes = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/nodes/${crudFolder.id}/acl`);
      expect(getAclRes.status).toBe(200);
      const rules = Array.isArray(getAclRes.data?.rules)
        ? getAclRes.data.rules
        : Array.isArray(getAclRes.data?.items)
          ? getAclRes.data.items
          : Array.isArray(getAclRes.data)
            ? getAclRes.data
            : [];
      expect(rules.length).toBeGreaterThanOrEqual(1);
      const rhRule = rules.find((r) => (r.target_value || r.targetValue) === 'RH');
      expect(rhRule).toBeTruthy();

      const colabPut = await cluster.apiFetch(colabFin1.accessToken, `/api/v1/storage/nodes/${crudFolder.id}/acl`, {
        method: 'PUT',
        body: { rules: [{ targetType: 'user', targetValue: colabFin1.user.email, accessLevel: 'full_control' }] },
      });
      expect(colabPut.status).toBe(403);

      const opPut = await cluster.apiFetch(operatorUser.accessToken, `/api/v1/storage/nodes/${crudFolder.id}/acl`, {
        method: 'PUT',
        body: { rules: [{ targetType: 'user', targetValue: operatorUser.user.email, accessLevel: 'full_control' }] },
      });
      expect(opPut.status).toBe(403);

      const delRuleRes = await cluster.apiFetch(
        ownerSession.accessToken,
        `/api/v1/storage/nodes/${crudFolder.id}/acl/${rhRule.id}`,
        { method: 'DELETE' },
      );
      expect([200, 204]).toContain(delRuleRes.status);
    });
  });

  describe('Tier 2 — Integration, Security, Multitenancy & Edge Cases', () => {
    it('enforces explicit child none override and lowest-wins tiebreaker at equal specificity', async () => {
      await ensureVaultConnected();

      const setores = await findFolderByPath(ownerSession.accessToken, '/Setores');
      const finRoot =
        (await findFolderByPath(ownerSession.accessToken, '/Setores/Financeiro')) ||
        (await createFolder(ownerSession.accessToken, setores.id, 'Financeiro'));

      const restrictedChild = await createFolder(ownerSession.accessToken, finRoot.id, 'Folha-Restrita');
      const secretFile = await uploadTextFile(ownerSession.accessToken, restrictedChild.id, 'salarios.txt', 'confidencial');
      await setNodeAcl(ownerSession.accessToken, restrictedChild.id, [
        { targetType: 'user', targetValue: colabFin1.user.email, accessLevel: 'none' },
      ]);

      // Lowest-wins tiebreaker at same specificity (duplicate/case-variant department rules if stored, or child explicit none)
      const tieFolder = await createFolder(ownerSession.accessToken, finRoot.id, 'Tiebreaker-Test');
      await setNodeAcl(ownerSession.accessToken, tieFolder.id, [
        { targetType: 'department', targetValue: 'Financeiro', accessLevel: 'full_control' },
        { targetType: 'department', targetValue: 'financeiro', accessLevel: 'viewer_online' },
      ]);

      const finList = await cluster.apiFetch(colabFin1.accessToken, `/api/v1/storage/nodes?parentId=${finRoot.id}`);
      expect(finList.status).toBe(200);
      const finItems = extractNodes(finList);
      expect(finItems.map((n) => n.id)).not.toContain(restrictedChild.id);

      const directDownload = await cluster.apiFetch(colabFin1.accessToken, `/api/v1/storage/nodes/${secretFile.id}/download`);
      expect([403, 404]).toContain(directDownload.status);

      const tieNode = finItems.find((n) => n.id === tieFolder.id);
      if (tieNode) {
        expect(['viewer_online', 'none', 'reader']).toContain(nodeAccess(tieNode));
        expect(nodeAccess(tieNode)).not.toBe('full_control');
      }
    });

    it('restricts editor delete strictly to created_by_email === user.email while manager/owner can delete any', async () => {
      await ensureVaultConnected();

      const finRoot = await findFolderByPath(ownerSession.accessToken, '/Setores/Financeiro');
      const f1File = await uploadTextFile(colabFin1.accessToken, finRoot.id, 'fin1-relatorio.txt', 'created-by-fin1');
      const f2File = await uploadTextFile(colabFin2.accessToken, finRoot.id, 'fin2-relatorio.txt', 'created-by-fin2');

      const fin2DelFin1 = await cluster.apiFetch(colabFin2.accessToken, `/api/v1/storage/nodes/${f1File.id}`, {
        method: 'DELETE',
      });
      expect(fin2DelFin1.status).toBe(403);

      const fin1DelOwn = await cluster.apiFetch(colabFin1.accessToken, `/api/v1/storage/nodes/${f1File.id}`, {
        method: 'DELETE',
      });
      expect([200, 204]).toContain(fin1DelOwn.status);

      const ownerDelFin2 = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/nodes/${f2File.id}`, {
        method: 'DELETE',
      });
      expect([200, 204]).toContain(ownerDelFin2.status);
    });

    it('filters GET /api/v1/storage/nodes?q= server-side so none-access files are never leaked', async () => {
      await ensureVaultConnected();

      const cofre = await findFolderByPath(ownerSession.accessToken, '/Cofre-TI-Infra');
      const secretFile = await uploadTextFile(
        ownerSession.accessToken,
        cofre.id,
        'segredo-diretoria-2026.txt',
        'top-secret-board-plan',
      );

      const ownerSearch = await cluster.apiFetch(
        ownerSession.accessToken,
        '/api/v1/storage/nodes?q=segredo-diretoria-2026',
      );
      expect(ownerSearch.status).toBe(200);
      expect(extractNodes(ownerSearch).map((n) => n.id)).toContain(secretFile.id);

      const colabSearch = await cluster.apiFetch(
        colabFin1.accessToken,
        '/api/v1/storage/nodes?q=segredo-diretoria-2026',
      );
      expect(colabSearch.status).toBe(200);
      expect(extractNodes(colabSearch)).toHaveLength(0);
    });

    it('enforces cross-tenant ACL isolation and superadmin Zero-Knowledge 403 block', async () => {
      await ensureVaultConnected();

      const pub = await findFolderByPath(ownerSession.accessToken, '/Corporativo-Publico');

      const betaGet = await cluster.apiFetch(betaOwnerToken, `/api/v1/storage/nodes/${pub.id}/acl`);
      expect([403, 404]).toContain(betaGet.status);

      const betaPut = await cluster.apiFetch(betaOwnerToken, `/api/v1/storage/nodes/${pub.id}/acl`, {
        method: 'PUT',
        body: { rules: [{ targetType: 'role', targetValue: 'collaborator', accessLevel: 'full_control' }] },
      });
      expect([403, 404]).toContain(betaPut.status);

      const saNodes = await cluster.apiFetch(superadminToken, '/api/v1/storage/nodes');
      expect(saNodes.status).toBe(403);

      const saAcl = await cluster.apiFetch(superadminToken, `/api/v1/storage/nodes/${pub.id}/acl`, {
        method: 'PUT',
        body: { rules: [{ targetType: 'role', targetValue: 'owner', accessLevel: 'full_control' }] },
      });
      expect(saAcl.status).toBe(403);
    });

    it('rejects invalid ACL payloads with 400 and blocks collaborator cloud:acl escalation even with full_control folder access', async () => {
      await ensureVaultConnected();

      const personalFolder = await findFolderByPath(
        ownerSession.accessToken,
        `/Espaco-Pessoal/${colabFin1.user.email}`,
      );
      const targetFolder =
        personalFolder ||
        (await createFolder(
          ownerSession.accessToken,
          (await findFolderByPath(ownerSession.accessToken, '/Corporativo-Publico')).id,
          'Escalation-Target',
        ));

      const badAccessRes = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/nodes/${targetFolder.id}/acl`, {
        method: 'PUT',
        body: { rules: [{ targetType: 'user', targetValue: colabFin1.user.email, accessLevel: 'root_admin' }] },
      });
      expect(badAccessRes.status).toBe(400);

      const badTypeRes = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/nodes/${targetFolder.id}/acl`, {
        method: 'PUT',
        body: { rules: [{ targetType: 'ip_address', targetValue: '127.0.0.1', accessLevel: 'reader' }] },
      });
      expect(badTypeRes.status).toBe(400);

      const colabEscalate = await cluster.apiFetch(colabFin1.accessToken, `/api/v1/storage/nodes/${targetFolder.id}/acl`, {
        method: 'PUT',
        body: { rules: [{ targetType: 'user', targetValue: colabRh.user.email, accessLevel: 'reader' }] },
      });
      expect(colabEscalate.status).toBe(403);
    });
  });
});
