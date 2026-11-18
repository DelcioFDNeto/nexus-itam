// services/tests/e2e_cloud_vault/f24_formula_backend.test.js
// =============================================================================
// F-24: Backend Formula Evaluation & Formatting Engine (E2E Opaque-Box Suite)
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootE2eCluster } from './helpers/clusterHarness.js';
import { startMockAgentNode } from './helpers/mockAgentNode.js';

const SHEET_FORMULA_PATH = path.resolve(import.meta.dirname, '../../shared/sheetFormula.js');

let cluster;
let agent;
let ownerSession;
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

function getCell(tab, ref) {
  return tab?.cells?.[ref] ?? null;
}

function cellComputedValue(cell) {
  if (cell === null || cell === undefined) return undefined;
  if (cell.computed !== undefined) return cell.computed;
  if (cell.value !== undefined) return cell.value;
  return cell.v;
}

async function ensureVaultConnected() {
  if (vaultReady) return;
  let connRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/connection', {
    method: 'PUT',
    body: {
      providerType: 'agent_node',
      label: 'E2E Formula Agent',
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
        label: 'E2E Formula Agent',
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
  const pub = extractNodes(res).find(
    (n) => (n.virtual_path || n.virtualPath || n.path) === '/Corporativo-Publico',
  );
  expect(pub).toBeTruthy();
  return pub.id;
}

async function createAndReadSheet(name, tabs) {
  await ensureVaultConnected();
  const parentId = await getPublicFolderId();
  const createRes = await cluster.apiFetch(ownerSession.accessToken, '/api/v1/storage/sheets', {
    method: 'POST',
    body: { parentId, name, tabs },
  });
  expect([200, 201]).toContain(createRes.status);
  const sheetId = createRes.data?.id || createRes.data?.node?.id || createRes.data?.sheet?.id;
  expect(sheetId).toBeTruthy();

  const getRes = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/sheets/${sheetId}`);
  expect(getRes.status).toBe(200);
  return { sheetId, workbook: getRes.data };
}

async function maybeLoadSharedFormulaModule() {
  if (!fs.existsSync(SHEET_FORMULA_PATH)) return null;
  return import(/* @vite-ignore */ pathToFileURL(SHEET_FORMULA_PATH).href);
}

describe('F-24: Backend Formula Evaluation & Formatting Engine', () => {
  beforeAll(async () => {
    cluster = await bootE2eCluster();
    agent = await startMockAgentNode({ quotaBytes: 50 * 1024 * 1024 });
    ownerSession = await cluster.loginAs('ti@shineraybysabel.com.br', 'Shineray@2026!');
  }, 45_000);

  afterAll(async () => {
    if (cluster) await cluster.stop();
    if (agent) await agent.stop();
  }, 45_000);

  describe('Tier 1 — Unit & Contract (PT-BR/EN Functions, Formatting, Cross-Tab)', () => {
    it('evaluates SOMA/SUM, MEDIA/AVERAGE, MIN/MIN, and MAX/MAX aggregates accurately', async () => {
      const { workbook } = await createAndReadSheet('Aggregates.xlsx', [
        {
          name: 'Calc',
          cells: {
            B2: { v: 100 },
            B3: { v: 200 },
            B4: { v: 300 },
            B5: { v: 400 },
            C2: { f: '=SOMA(B2:B5)' },
            C3: { f: '=SUM(B2:B5)' },
            C4: { f: '=MÉDIA(B2:B5)' },
            C5: { f: '=AVERAGE(B2:B5)' },
            C6: { f: '=MÍN(B2:B5)' },
            C7: { f: '=MIN(B2:B5)' },
            C8: { f: '=MÁX(B2:B5)' },
            C9: { f: '=MAX(B2:B5)' },
          },
        },
      ]);

      const tab = getSheetArray(workbook)[0];
      expect(Number(cellComputedValue(getCell(tab, 'C2')))).toBe(1000);
      expect(Number(cellComputedValue(getCell(tab, 'C3')))).toBe(1000);
      expect(Number(cellComputedValue(getCell(tab, 'C4')))).toBe(250);
      expect(Number(cellComputedValue(getCell(tab, 'C5')))).toBe(250);
      expect(Number(cellComputedValue(getCell(tab, 'C6')))).toBe(100);
      expect(Number(cellComputedValue(getCell(tab, 'C7')))).toBe(100);
      expect(Number(cellComputedValue(getCell(tab, 'C8')))).toBe(400);
      expect(Number(cellComputedValue(getCell(tab, 'C9')))).toBe(400);

      const mod = await maybeLoadSharedFormulaModule();
      if (mod?.evaluateWorkbook) {
        const evaluated = mod.evaluateWorkbook(getSheetArray(workbook));
        expect(evaluated).toBeTruthy();
      }
    });

    it('evaluates SE/IF conditional formulas with both semicolon (;) and comma (,) separators', async () => {
      const { workbook } = await createAndReadSheet('Conditionals.xlsx', [
        {
          name: 'Regras',
          cells: {
            B2: { v: 350 },
            B3: { v: 120 },
            C2: { f: '=SE(B2>=300;"Acima";"Abaixo")' },
            C3: { f: '=IF(B3<200,"Baixo","Normal")' },
            C4: { f: '=SE(B3>=300;"Acima";"Abaixo")' },
            C5: { f: '=IF(B2<200,"Baixo","Normal")' },
          },
        },
      ]);

      const tab = getSheetArray(workbook)[0];
      expect(cellComputedValue(getCell(tab, 'C2'))).toBe('Acima');
      expect(cellComputedValue(getCell(tab, 'C3'))).toBe('Baixo');
      expect(cellComputedValue(getCell(tab, 'C4'))).toBe('Abaixo');
      expect(cellComputedValue(getCell(tab, 'C5'))).toBe('Normal');
    });

    it('evaluates CONT.SE/COUNTIF for exact string match and numeric threshold criteria', async () => {
      const { workbook } = await createAndReadSheet('CountIf.xlsx', [
        {
          name: 'Ativos',
          cells: {
            C2: { v: 'Ativo' },
            C3: { v: 'Manutenção' },
            C4: { v: 'Ativo' },
            C5: { v: 'Baixado' },
            C6: { v: 'Ativo' },
            D2: { v: 10 },
            D3: { v: 50 },
            D4: { v: 80 },
            D5: { v: 100 },
            E2: { f: '=CONT.SE(C2:C6;"Ativo")' },
            E3: { f: '=COUNTIF(D2:D5,">=50")' },
          },
        },
      ]);

      const tab = getSheetArray(workbook)[0];
      expect(Number(cellComputedValue(getCell(tab, 'E2')))).toBe(3);
      expect(Number(cellComputedValue(getCell(tab, 'E3')))).toBe(3);
    });

    it('preserves and applies BRL R$, %, date formatting, cell colors, and freezeRow', async () => {
      const { sheetId, workbook } = await createAndReadSheet('Formatting.xlsx', [
        {
          name: 'Relatorio',
          freezeRow: 1,
          cells: {
            A1: { v: 'Valor BRL', style: { bgColor: '#0F172A', textColor: '#FFFFFF' } },
            B1: { v: 'Taxa %', style: { bgColor: '#0F172A', textColor: '#FFFFFF' } },
            C1: { v: 'Data' },
            A2: { v: 1234.5, style: { numFmt: 'R$ #,##0.00' } },
            B2: { v: 0.254, style: { numFmt: '0.0%' } },
            C2: { v: '2026-11-17', style: { numFmt: 'dd/mm/yyyy' } },
          },
        },
      ]);

      const tab = getSheetArray(workbook)[0];
      expect(tab.freezeRow).toBe(1);
      expect(getCell(tab, 'A1')?.style?.bgColor).toBe('#0F172A');
      expect(getCell(tab, 'A1')?.style?.textColor).toBe('#FFFFFF');
      expect(getCell(tab, 'A2')?.style?.numFmt).toBe('R$ #,##0.00');
      expect(getCell(tab, 'B2')?.style?.numFmt).toBe('0.0%');
      expect(getCell(tab, 'C2')?.style?.numFmt).toBe('dd/mm/yyyy');

      const mod = await maybeLoadSharedFormulaModule();
      if (mod?.formatCellValue) {
        const brlText = String(mod.formatCellValue(1234.5, 'R$ #,##0.00'));
        expect(brlText).toContain('R$');
        const pctText = String(mod.formatCellValue(0.254, '0.0%'));
        expect(pctText).toContain('%');
      }

      const csvRes = await cluster.apiFetch(
        ownerSession.accessToken,
        `/api/v1/storage/sheets/${sheetId}/export?format=csv`,
      );
      expect(csvRes.status).toBe(200);
      expect(csvRes.text).toContain('Valor BRL');
    });

    it('recalculates cross-tab formula references dynamically when source tab values change', async () => {
      const { sheetId, workbook } = await createAndReadSheet('CrossTab.xlsx', [
        {
          name: 'Estoque',
          cells: { B2: { v: 10 }, B3: { v: 20 }, B4: { v: 30 } },
        },
        {
          name: 'Resumo',
          cells: {
            A1: { f: '=SOMA(Estoque!B2:B4)' },
            A2: { f: '=Resumo!A1*2' },
          },
        },
      ]);

      const resumo1 = getSheetArray(workbook).find((t) => t.name === 'Resumo');
      expect(Number(cellComputedValue(getCell(resumo1, 'A1')))).toBe(60);
      expect(Number(cellComputedValue(getCell(resumo1, 'A2')))).toBe(120);

      const saveRes = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/sheets/${sheetId}/save`, {
        method: 'POST',
        body: {
          expectedRev: 1,
          tabs: [
            { name: 'Estoque', cells: { B2: { v: 25 }, B3: { v: 20 }, B4: { v: 30 } } },
            {
              name: 'Resumo',
              cells: {
                A1: { f: '=SOMA(Estoque!B2:B4)' },
                A2: { f: '=Resumo!A1*2' },
              },
            },
          ],
        },
      });
      expect(saveRes.status).toBe(200);

      const getUpdated = await cluster.apiFetch(ownerSession.accessToken, `/api/v1/storage/sheets/${sheetId}`);
      expect(getUpdated.status).toBe(200);
      const resumo2 = getSheetArray(getUpdated.data).find((t) => t.name === 'Resumo');
      expect(Number(cellComputedValue(getCell(resumo2, 'A1')))).toBe(75);
      expect(Number(cellComputedValue(getCell(resumo2, 'A2')))).toBe(150);
    });
  });

  describe('Tier 2 — Integration, Security, Error Tokens & Hardening', () => {
    it('returns safe #DIV/0!, #REF!, and #NAME?/#VALUE! tokens without server crash', async () => {
      const { workbook } = await createAndReadSheet('ErrorTokens.xlsx', [
        {
          name: 'Erros',
          cells: {
            A1: { v: 10 },
            A2: { v: 0 },
            B1: { f: '=A1/A2' },
            B2: { f: '=10/0' },
            B3: { f: '=Inexistente!A1' },
            B4: { f: '=FUNCAOINEXISTENTE(A1)' },
          },
        },
      ]);

      const tab = getSheetArray(workbook)[0];
      expect(cellComputedValue(getCell(tab, 'B1'))).toBe('#DIV/0!');
      expect(cellComputedValue(getCell(tab, 'B2'))).toBe('#DIV/0!');
      expect(['#REF!', '#ERROR!', '#VALUE!']).toContain(cellComputedValue(getCell(tab, 'B3')));
      expect(['#NAME?', '#ERROR!', '#VALUE!']).toContain(cellComputedValue(getCell(tab, 'B4')));
    });

    it('detects direct, 2-node, and cross-tab circular references and emits #CYCLE! safely', async () => {
      const { workbook } = await createAndReadSheet('Cycles.xlsx', [
        {
          name: 'Tab1',
          cells: {
            A1: { f: '=A1+1' },
            A2: { f: '=B2' },
            B2: { f: '=A2' },
            C1: { f: '=Tab2!B1' },
            D1: { f: '=C1+5' },
          },
        },
        {
          name: 'Tab2',
          cells: {
            B1: { f: '=Tab1!D1' },
          },
        },
      ]);

      const tab1 = getSheetArray(workbook).find((t) => t.name === 'Tab1');
      const tab2 = getSheetArray(workbook).find((t) => t.name === 'Tab2');
      expect(cellComputedValue(getCell(tab1, 'A1'))).toBe('#CYCLE!');
      expect(cellComputedValue(getCell(tab1, 'A2'))).toBe('#CYCLE!');
      expect(cellComputedValue(getCell(tab1, 'B2'))).toBe('#CYCLE!');
      expect(cellComputedValue(getCell(tab1, 'C1'))).toBe('#CYCLE!');
      expect(cellComputedValue(getCell(tab2, 'B1'))).toBe('#CYCLE!');
    });

    it('hardens formula evaluator against JS code execution and prototype pollution payloads', async () => {
      const { workbook } = await createAndReadSheet('InjectionGuard.xlsx', [
        {
          name: 'Seguranca',
          cells: {
            A1: { f: '=constructor.constructor("return process.env")()' },
            A2: { f: '=require("node:fs").readFileSync("/etc/passwd")' },
            A3: { f: '=__proto__.polluted' },
            A4: { f: '=SUM(1,2)' },
          },
        },
      ]);

      const tab = getSheetArray(workbook)[0];
      const v1 = String(cellComputedValue(getCell(tab, 'A1')) ?? '');
      const v2 = String(cellComputedValue(getCell(tab, 'A2')) ?? '');
      const v3 = String(cellComputedValue(getCell(tab, 'A3')) ?? '');
      expect(v1).not.toContain('NEXUS_STORAGE_MASTER_KEY');
      expect(v2).not.toContain('root:x:0:0');
      expect(Object.prototype.polluted).toBeUndefined();
      expect(v1.startsWith('#')).toBe(true);
      expect(v2.startsWith('#')).toBe(true);
      expect(v3.startsWith('#')).toBe(true);
      expect(Number(cellComputedValue(getCell(tab, 'A4')))).toBe(3);
    });

    it('handles lowercase/whitespace formulas, empty/non-numeric range cells, and empty AVERAGE', async () => {
      const { workbook } = await createAndReadSheet('MixedRanges.xlsx', [
        {
          name: 'Bordas',
          cells: {
            B2: { v: 10 },
            B3: { v: '' },
            B4: { v: 'Texto' },
            B5: { v: 30 },
            C2: { f: '=soma( b2 : b5 )' },
            C3: { f: '=average(B2:B5)' },
            C4: { f: '=MIN(B2:B5)' },
            C5: { f: '=MAX(B2:B5)' },
            C6: { f: '=AVERAGE(D2:D5)' },
          },
        },
      ]);

      const tab = getSheetArray(workbook)[0];
      expect(Number(cellComputedValue(getCell(tab, 'C2')))).toBe(40);
      expect(Number(cellComputedValue(getCell(tab, 'C3')))).toBe(20);
      expect(Number(cellComputedValue(getCell(tab, 'C4')))).toBe(10);
      expect(Number(cellComputedValue(getCell(tab, 'C5')))).toBe(30);
      expect(['#DIV/0!', 0]).toContain(cellComputedValue(getCell(tab, 'C6')));
    });

    it('persists evaluated formula outputs and exports computed values to CSV', async () => {
      const { sheetId } = await createAndReadSheet('CsvExportEval.xlsx', [
        {
          name: 'Fechamento',
          cells: {
            A1: { v: 'Item' },
            B1: { v: 'Total' },
            A2: { v: 'Licencas' },
            B2: { v: 250 },
            A3: { v: 'Suporte' },
            B3: { v: 150 },
            A4: { v: 'Soma' },
            B4: { f: '=SOMA(B2:B3)', style: { numFmt: 'R$ #,##0.00' } },
            A5: { v: 'Status' },
            B5: { f: '=SE(B4>=300;"Aprovado";"Revisar")' },
          },
        },
      ]);

      const csvRes = await cluster.apiFetch(
        ownerSession.accessToken,
        `/api/v1/storage/sheets/${sheetId}/export?format=csv`,
      );
      expect(csvRes.status).toBe(200);
      expect(csvRes.text).toContain('Licencas');
      expect(csvRes.text).toContain('400');
      expect(csvRes.text).toContain('Aprovado');
    });
  });
});
