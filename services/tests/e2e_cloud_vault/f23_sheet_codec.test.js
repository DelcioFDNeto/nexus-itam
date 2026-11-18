// services/tests/e2e_cloud_vault/f23_sheet_codec.test.js
// =============================================================================
// F-23: Bidirectional .xlsx / .csv / .nexusheet <-> Workbook JSON Codec (E2E)
// =============================================================================

import * as XLSX from 'xlsx';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootE2eCluster } from './helpers/clusterHarness.js';
import { startMockAgentNode } from './helpers/mockAgentNode.js';

let cluster;
let agent;
let ownerSession;
let viewerColab;
let betaOwnerToken;
let vaultReady = false;

function extractNodes(res) {
  if (!res?.data) return [];
  if (Array.isArray(res.data.items)) return res.data.items;
  if (Array.isArray(res.data.nodes)) return res.data.nodes;
  return Array.isArray(res.data) ? res.data : [];
}

function getSheetArray(workbookData) {
  return workbookData?.sheets || workbookData?.tabs || [];
}

function getCellEntry(tab, ref) {
  if (!tab) return null;
  if (tab.cells && typeof tab.cells === 'object') return tab.cells[ref] ?? null;
  return null;
}

async function ensureVaultConnected() {
  if (vaultReady) return;
  let connRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/connection', {
    method: 'PUT',
    body: {
      providerType: 'agent_node',
      label: 'E2E Sheet Codec Agent',
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
        label: 'E2E Sheet Codec Agent',
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
  vaultReady = true;
}

async function getPublicFolderId() {
  const res = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/nodes');
  expect(res.status).toBe(200);
  const items = extractNodes(res);
  const pub = items.find((n) => (n.virtual_path || n.virtualPath || n.path) === '/Corporativo-Publico');
  expect(pub).toBeTruthy();
  return pub.id;
}

async function uploadBuffer(parentId, fileName, buffer, mimeType) {
  const form = new FormData();
  form.append('parentId', String(parentId));
  form.append('conflictPolicy', 'version');
  form.append('file', new Blob([buffer], { type: mimeType }), fileName);
  const res = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/upload', {
    method: 'POST',
    body: form,
  });
  expect([200, 201]).toContain(res.status);
  return res.data?.node || res.data?.file || res.data;
}

describe('F-23: Bidirectional .xlsx / .csv / .nexusheet <-> JSON Engine', () => {
  beforeAll(async () => {
    cluster = await bootE2eCluster();
    agent = await startMockAgentNode({ quotaBytes: 50 * 1024 * 1024 });
    ownerSession = await cluster.loginAs('ti@shineraybysabel.com.br', 'Shineray@2026!');

    await cluster.seedUser(ownerSession.accessToken, {
      name: 'Viewer Sheet Colab',
      email: 'viewer.sheet@shineraybysabel.com.br',
      password: 'Password@2026!',
      role: 'collaborator',
      department: 'Auditoria',
    });
    viewerColab = await cluster.loginAs('viewer.sheet@shineraybysabel.com.br', 'Password@2026!');

    betaOwnerToken = cluster.createUserToken({
      sub: 'beta-owner-f23',
      email: 'owner@beta-f23.test',
      name: 'Beta Owner',
      role: 'owner',
      tenantId: 'tenant-beta',
      department: 'TI',
    });
  }, 45_000);

  afterAll(async () => {
    if (cluster) await cluster.stop();
    if (agent) await agent.stop();
  }, 45_000);

  describe('Tier 1 — Unit & Contract (Create, Multi-Tab Import, Save, Export XLSX & CSV)', () => {
    it('creates a workbook via POST /sheets and reads structured JSON via GET /sheets/:id', async () => {
      await ensureVaultConnected();
      const parentId = await getPublicFolderId();

      const createRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/sheets', {
        method: 'POST',
        body: {
          parentId,
          name: 'Orcamento-TI.xlsx',
          tabs: [
            {
              name: 'Resumo',
              freezeRow: 1,
              cells: {
                A1: { v: 'Item' },
                B1: { v: 'Valor' },
                A2: { v: 'Notebook' },
                B2: { v: 4500 },
              },
            },
          ],
        },
      });
      expect([200, 201]).toContain(createRes.status);
      const sheetId = createRes.data?.id || createRes.data?.node?.id || createRes.data?.sheet?.id;
      expect(sheetId).toBeTruthy();

      const getRes = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/sheets/${sheetId}`);
      expect(getRes.status).toBe(200);
      expect(getRes.data.rev).toBe(1);
      const tabs = getSheetArray(getRes.data);
      expect(tabs.length).toBeGreaterThanOrEqual(1);
      expect(tabs[0].name).toBe('Resumo');
      expect(getCellEntry(tabs[0], 'A2')?.v).toBe('Notebook');
      expect(Number(getCellEntry(tabs[0], 'B2')?.v)).toBe(4500);

      const listRes = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/nodes?parentId=${parentId}`);
      expect(listRes.status).toBe(200);
      expect(extractNodes(listRes).some((n) => n.id === sheetId)).toBe(true);
    });

    it('imports multi-tab .xlsx binary preserving tabs, values, and formulas', async () => {
      await ensureVaultConnected();
      const parentId = await getPublicFolderId();

      const wb = XLSX.utils.book_new();
      const wsEstoque = XLSX.utils.aoa_to_sheet([
        ['Equipamento', 'Qtd'],
        ['Switch 24p', 4],
        ['Access Point', 6],
      ]);
      const wsResumo = XLSX.utils.aoa_to_sheet([
        ['Metrica', 'Valor'],
        ['Total Itens', { t: 'n', f: 'SUM(Estoque!B2:B3)' }],
      ]);
      XLSX.utils.book_append_sheet(wb, wsEstoque, 'Estoque');
      XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo');
      const xlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      const uploaded = await uploadBuffer(
        parentId,
        'inventario-multitab.xlsx',
        xlsxBuffer,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );

      const getRes = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/sheets/${uploaded.id}`);
      expect(getRes.status).toBe(200);
      const tabs = getSheetArray(getRes.data);
      expect(tabs.map((t) => t.name)).toEqual(['Estoque', 'Resumo']);
      expect(getCellEntry(tabs[0], 'A2')?.v).toBe('Switch 24p');
      expect(Number(getCellEntry(tabs[0], 'B2')?.v)).toBe(4);
      const formulaCell = getCellEntry(tabs[1], 'B2');
      expect(String(formulaCell?.f || '')).toContain('Estoque!B2:B3');
    });

    it('saves changes via POST /sheets/:id/save incrementing rev and preserving styles & freezeRow', async () => {
      await ensureVaultConnected();
      const parentId = await getPublicFolderId();

      const createRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/sheets', {
        method: 'POST',
        body: {
          parentId,
          name: 'Estilos-Save.xlsx',
          tabs: [
            {
              name: 'Financeiro',
              cells: { A1: { v: 'Descricao' }, B1: { v: 'Custo' }, A2: { v: 'Link Fibra' }, B2: { v: 1200 } },
            },
          ],
        },
      });
      expect([200, 201]).toContain(createRes.status);
      const sheetId = createRes.data?.id || createRes.data?.node?.id || createRes.data?.sheet?.id;

      const saveRes = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/sheets/${sheetId}/save`, {
        method: 'POST',
        body: {
          expectedRev: 1,
          tabs: [
            {
              name: 'Financeiro',
              freezeRow: 1,
              cells: {
                A1: { v: 'Descricao', style: { bgColor: '#1E293B', textColor: '#FFFFFF' } },
                B1: { v: 'Custo', style: { bgColor: '#1E293B', textColor: '#FFFFFF' } },
                A2: { v: 'Link Fibra' },
                B2: { v: 1850.75, style: { numFmt: 'R$ #,##0.00' } },
                B3: { v: 1850.75, f: '=SUM(B2:B2)', style: { numFmt: 'R$ #,##0.00' } },
              },
            },
          ],
        },
      });
      expect(saveRes.status).toBe(200);
      expect(saveRes.data.rev).toBe(2);

      const getRes = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/sheets/${sheetId}`);
      expect(getRes.status).toBe(200);
      expect(getRes.data.rev).toBe(2);
      const tab = getSheetArray(getRes.data)[0];
      expect(tab.freezeRow).toBe(1);
      expect(getCellEntry(tab, 'A1')?.style?.bgColor).toBe('#1E293B');
      expect(getCellEntry(tab, 'B2')?.style?.numFmt).toBe('R$ #,##0.00');
      expect(Number(getCellEntry(tab, 'B2')?.v)).toBe(1850.75);
    });

    it('exports workbook to .xlsx preserving multi-tab structure, values, and formulas', async () => {
      await ensureVaultConnected();
      const parentId = await getPublicFolderId();

      const createRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/sheets', {
        method: 'POST',
        body: {
          parentId,
          name: 'Export-Check.xlsx',
          tabs: [
            {
              name: 'Dados',
              cells: {
                A1: { v: 'Qtd' },
                A2: { v: 15 },
                A3: { v: 25 },
                A4: { f: '=SUM(A2:A3)' },
              },
            },
            {
              name: 'Notas',
              cells: { A1: { v: 'Observacao' }, A2: { v: 'Auditoria OK' } },
            },
          ],
        },
      });
      expect([200, 201]).toContain(createRes.status);
      const sheetId = createRes.data?.id || createRes.data?.node?.id || createRes.data?.sheet?.id;

      const exportRes = await cluster.apiFetch(
        ownerSession.accessToken,
        `/api/v1/storage/sheets/${sheetId}/export?format=xlsx`,
      );
      expect(exportRes.status).toBe(200);
      expect(exportRes.buffer.length).toBeGreaterThan(100);

      const parsed = XLSX.read(exportRes.buffer, { type: 'buffer' });
      expect(parsed.SheetNames).toEqual(['Dados', 'Notas']);
      expect(parsed.Sheets.Dados.A2?.v).toBe(15);
      expect(parsed.Sheets.Dados.A3?.v).toBe(25);
      expect(String(parsed.Sheets.Dados.A4?.f || '')).toContain('A2:A3');
      expect(parsed.Sheets.Notas.A2?.v).toBe('Auditoria OK');
    });

    it('exports sheet to .csv and imports uploaded .csv into workbook JSON', async () => {
      await ensureVaultConnected();
      const parentId = await getPublicFolderId();

      const csvInput = Buffer.from('Produto,Quantidade,Preco\nMouse,10,55\nTeclado,5,120\n', 'utf8');
      const uploadedCsv = await uploadBuffer(parentId, 'catalogo.csv', csvInput, 'text/csv');

      const getCsvSheet = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/sheets/${uploadedCsv.id}`);
      expect(getCsvSheet.status).toBe(200);
      const tabs = getSheetArray(getCsvSheet.data);
      expect(tabs.length).toBeGreaterThanOrEqual(1);
      expect(getCellEntry(tabs[0], 'A2')?.v).toBe('Mouse');
      expect(Number(getCellEntry(tabs[0], 'B2')?.v)).toBe(10);

      const exportCsvRes = await cluster.apiFetch(
        ownerSession.accessToken,
        `/api/v1/storage/sheets/${uploadedCsv.id}/export?format=csv`,
      );
      expect(exportCsvRes.status).toBe(200);
      expect(exportCsvRes.headers.get('content-type') || '').toContain('text/csv');
      expect(exportCsvRes.text).toContain('Mouse');
      expect(exportCsvRes.text).toContain('Teclado');
    });
  });

  describe('Tier 2 — Integration, Security, Concurrency & Edge Cases', () => {
    it('rejects stale expectedRev with 409 SHEET_REV_CONFLICT without overwriting newer data', async () => {
      await ensureVaultConnected();
      const parentId = await getPublicFolderId();

      const createRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/sheets', {
        method: 'POST',
        body: {
          parentId,
          name: 'Conflict-Rev.xlsx',
          tabs: [{ name: 'Principal', cells: { A1: { v: 'v1' } } }],
        },
      });
      expect([200, 201]).toContain(createRes.status);
      const sheetId = createRes.data?.id || createRes.data?.node?.id || createRes.data?.sheet?.id;

      const save2 = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/sheets/${sheetId}/save`, {
        method: 'POST',
        body: {
          expectedRev: 1,
          tabs: [{ name: 'Principal', cells: { A1: { v: 'v2-commit' } } }],
        },
      });
      expect(save2.status).toBe(200);
      expect(save2.data.rev).toBe(2);

      const staleSave = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/sheets/${sheetId}/save`, {
        method: 'POST',
        body: {
          expectedRev: 1,
          tabs: [{ name: 'Principal', cells: { A1: { v: 'stale-overwrite' } } }],
        },
      });
      expect(staleSave.status).toBe(409);

      const checkRes = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/sheets/${sheetId}`);
      expect(checkRes.status).toBe(200);
      expect(checkRes.data.rev).toBe(2);
      expect(getCellEntry(getSheetArray(checkRes.data)[0], 'A1')?.v).toBe('v2-commit');
    });

    it('preserves extended styles, colors, freezeRow, and formulas in .nexusheet native format', async () => {
      await ensureVaultConnected();
      const parentId = await getPublicFolderId();

      const createRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/sheets', {
        method: 'POST',
        body: {
          parentId,
          name: 'Native-Format.nexusheet',
          tabs: [
            {
              name: 'KPIs',
              freezeRow: 2,
              cells: {
                A1: { v: 'Indicador', style: { bgColor: '#0F172A', textColor: '#F8FAFC' } },
                A2: { v: 'Meta', style: { bgColor: '#DCFCE7', textColor: '#166534' } },
                B2: { v: 0.95, style: { numFmt: '0.0%' } },
                B3: { f: '=B2*100' },
              },
            },
          ],
        },
      });
      expect([200, 201]).toContain(createRes.status);
      const sheetId = createRes.data?.id || createRes.data?.node?.id || createRes.data?.sheet?.id;

      const dlRaw = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/nodes/${sheetId}/download`);
      expect(dlRaw.status).toBe(200);
      expect(dlRaw.text).toContain('#0F172A');

      const getRes = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/sheets/${sheetId}`);
      expect(getRes.status).toBe(200);
      const tab = getSheetArray(getRes.data)[0];
      expect(tab.freezeRow).toBe(2);
      expect(getCellEntry(tab, 'A2')?.style?.bgColor).toBe('#DCFCE7');
      expect(getCellEntry(tab, 'B2')?.style?.numFmt).toBe('0.0%');
      expect(String(getCellEntry(tab, 'B3')?.f || '')).toContain('B2*100');
    });

    it('handles corrupted .xlsx bytes (400/422) and invalid export format (400) gracefully without crashing', async () => {
      await ensureVaultConnected();
      const parentId = await getPublicFolderId();

      const corruptNode = await uploadBuffer(
        parentId,
        'corrupt-file.xlsx',
        Buffer.from('NOT_A_VALID_ZIP_OR_XLSX_BINARY_0000', 'utf8'),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );

      const parseCorrupt = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/sheets/${corruptNode.id}`);
      expect([400, 422]).toContain(parseCorrupt.status);

      const validRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/sheets', {
        method: 'POST',
        body: { parentId, name: 'Healthy-After-Corrupt.xlsx' },
      });
      expect([200, 201]).toContain(validRes.status);
      const validId = validRes.data?.id || validRes.data?.node?.id || validRes.data?.sheet?.id;

      const badExport = await cluster.apiFetch(
        ownerSession.accessToken,
        `/api/v1/storage/sheets/${validId}/export?format=exe`,
      );
      expect(badExport.status).toBe(400);
    });

    it('enforces cross-tenant sheet isolation and blocks viewer_online from saving or exporting', async () => {
      await ensureVaultConnected();
      const parentId = await getPublicFolderId();

      const createRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/sheets', {
        method: 'POST',
        body: {
          parentId,
          name: 'ACL-Isolation-Sheet.xlsx',
          tabs: [{ name: 'Dados', cells: { A1: { v: 'Privado' } } }],
        },
      });
      expect([200, 201]).toContain(createRes.status);
      const sheetId = createRes.data?.id || createRes.data?.node?.id || createRes.data?.sheet?.id;

      const aclRes = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/nodes/${sheetId}/acl`, {
        method: 'PUT',
        body: {
          rules: [{ targetType: 'user', targetValue: viewerColab.user.email, accessLevel: 'viewer_online' }],
        },
      });
      expect([200, 201]).toContain(aclRes.status);

      // viewer_online can view online via GET /sheets/:id
      const viewerGet = await cluster.apiFetch(viewerColab.accessToken, `/api/v1/storage/sheets/${sheetId}`);
      expect(viewerGet.status).toBe(200);

      // viewer_online cannot save or export
      const viewerSave = await cluster.apiFetch(viewerColab.accessToken, `/api/v1/storage/sheets/${sheetId}/save`, {
        method: 'POST',
        body: { expectedRev: 1, tabs: [{ name: 'Dados', cells: { A1: { v: 'Tamper' } } }] },
      });
      expect(viewerSave.status).toBe(403);

      const viewerExport = await cluster.apiFetch(
        viewerColab.accessToken,
        `/api/v1/storage/sheets/${sheetId}/export?format=xlsx`,
      );
      expect(viewerExport.status).toBe(403);

      // Cross-tenant isolation
      const betaGet = await cluster.apiFetch(betaOwnerToken, `/api/v1/storage/sheets/${sheetId}`);
      expect([403, 404]).toContain(betaGet.status);

      const betaSave = await cluster.apiFetch(betaOwnerToken, `/api/v1/storage/sheets/${sheetId}/save`, {
        method: 'POST',
        body: { expectedRev: 1, tabs: [{ name: 'Dados', cells: { A1: { v: 'CrossTenant' } } }] },
      });
      expect([403, 404]).toContain(betaSave.status);
    });

    it('creates version snapshots on save and persists updated .xlsx bytes on VPS storage', async () => {
      await ensureVaultConnected();
      const parentId = await getPublicFolderId();

      const createRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/sheets', {
        method: 'POST',
        body: {
          parentId,
          name: 'Versioned-Sheet.xlsx',
          tabs: [{ name: 'Planilha1', cells: { A1: { v: 'Versao 1' } } }],
        },
      });
      expect([200, 201]).toContain(createRes.status);
      const sheetId = createRes.data?.id || createRes.data?.node?.id || createRes.data?.sheet?.id;

      const save2 = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/sheets/${sheetId}/save`, {
        method: 'POST',
        body: { expectedRev: 1, tabs: [{ name: 'Planilha1', cells: { A1: { v: 'Versao 2' } } }] },
      });
      expect(save2.status).toBe(200);

      const save3 = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/sheets/${sheetId}/save`, {
        method: 'POST',
        body: { expectedRev: 2, tabs: [{ name: 'Planilha1', cells: { A1: { v: 'Versao 3' } } }] },
      });
      expect(save3.status).toBe(200);

      const versionsRes = await cluster.apiFetch(
        ownerSession.accessToken,
        `/api/v1/storage/nodes/${sheetId}/versions`,
      );
      expect(versionsRes.status).toBe(200);
      const versions = versionsRes.data?.versions || versionsRes.data?.items || [];
      expect(versions.length).toBeGreaterThanOrEqual(2);

      const dlRes = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/nodes/${sheetId}/download`);
      expect(dlRes.status).toBe(200);
      const onVpsWb = XLSX.read(dlRes.buffer, { type: 'buffer' });
      expect(onVpsWb.Sheets.Planilha1.A1?.v).toBe('Versao 3');
    });
  });
});
