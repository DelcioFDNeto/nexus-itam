// tests/e2e_cloud_vault/f24_formula_engine.test.js
// =============================================================================
// E2E-M3 F-24: Nexus Sheets Live Formula Evaluation & Formatting Engine
// Tier 1 (Unit/Contract: 5) + Tier 2 (Boundary/Error/Security: 5)
// Target: src/utils/sheetFormulaEngine.js (M3 — loaded dynamically inside it())
// =============================================================================

import { describe, expect, it } from 'vitest';
import { requireModuleOrFail } from './helpers/uiTestHarness.js';

function evalCell(engine, sheetsOrCells, formulaOrTarget, activeTab = 'Planilha1') {
  const sheets = Array.isArray(sheetsOrCells)
    ? sheetsOrCells
    : sheetsOrCells && typeof sheetsOrCells === 'object' && !Array.isArray(sheetsOrCells) && typeof Object.values(sheetsOrCells)[0] === 'object' && !('value' in Object.values(sheetsOrCells)[0])
      ? Object.entries(sheetsOrCells).map(([name, cells]) => ({ name, cells }))
      : [{ name: activeTab, cells: sheetsOrCells || {} }];

  if (typeof engine.evaluateFormula === 'function') {
    const isCellRef = /^[A-Z]+\d+$/i.test(formulaOrTarget) || /^.+![A-Z]+\d+$/i.test(formulaOrTarget);
    const activeSheetObj = sheets.find((s) => s.name === activeTab) || sheets[0];
    const expr = isCellRef ? activeSheetObj?.cells?.[formulaOrTarget] : formulaOrTarget;
    if (!isCellRef) {
      return engine.evaluateFormula(expr, { sheets, activeTab, cells: activeSheetObj?.cells || {} });
    }
  }

  const evalWorkbook =
    engine.evaluateWorkbook ||
    engine.recalculateWorkbook ||
    engine.evaluateSheets ||
    engine.evaluateSheet;

  if (typeof evalWorkbook === 'function') {
    const wbResult = evalWorkbook({ sheets, activeTab });
    const resultSheets = wbResult?.sheets || wbResult;
    const targetSheet = Array.isArray(resultSheets)
      ? resultSheets.find((s) => s.name === activeTab) || resultSheets[0]
      : resultSheets?.[activeTab];
    const cellKey = /^[A-Z]+\d+$/i.test(formulaOrTarget) ? formulaOrTarget : '__EVAL__';
    if (cellKey === '__EVAL__' && typeof engine.evaluateFormula === 'function') {
      return engine.evaluateFormula(formulaOrTarget, { sheets, activeTab });
    }
    const cellVal = targetSheet?.cells?.[cellKey];
    return cellVal && typeof cellVal === 'object' && 'value' in cellVal ? cellVal.value : cellVal;
  }

  throw new Error('sheetFormulaEngine.js must export evaluateFormula or evaluateWorkbook/recalculateWorkbook');
}

function unwrapValue(res) {
  if (res && typeof res === 'object' && 'value' in res) return res.value;
  if (res && typeof res === 'object' && 'error' in res && res.error) return res.error;
  return res;
}

describe('F-24: Nexus Sheets Live Formula & Formatting Engine (src/utils/sheetFormulaEngine.js)', () => {
  describe('Tier 1 — Core PT-BR/EN Formulas, Cross-Tab Refs & Formatting', () => {
    it('F24-T1-01: evaluates SOMA/SUM, MÉDIA/AVERAGE, MÍN/MIN, MÁX/MAX, and arithmetic expressions', async () => {
      const engine = await requireModuleOrFail('src/utils/sheetFormulaEngine.js', 'M3');
      const cells = { A1: 10, A2: 20, A3: 30, A4: 40 };

      expect(unwrapValue(evalCell(engine, cells, '=SOMA(A1:A4)'))).toBe(100);
      expect(unwrapValue(evalCell(engine, cells, '=SUM(A1:A4)'))).toBe(100);
      expect(unwrapValue(evalCell(engine, cells, '=MÉDIA(A1:A4)'))).toBe(25);
      expect(unwrapValue(evalCell(engine, cells, '=AVERAGE(A1:A4)'))).toBe(25);
      expect(unwrapValue(evalCell(engine, cells, '=MÍN(A1:A4)'))).toBe(10);
      expect(unwrapValue(evalCell(engine, cells, '=MIN(A1:A4)'))).toBe(10);
      expect(unwrapValue(evalCell(engine, cells, '=MÁX(A1:A4)'))).toBe(40);
      expect(unwrapValue(evalCell(engine, cells, '=MAX(A1:A4)'))).toBe(40);
      expect(unwrapValue(evalCell(engine, cells, '=(A1+A2)*2'))).toBe(60);
    });

    it('F24-T1-02: evaluates conditional SE/IF and CONT.SE/COUNTIF with PT-BR arguments', async () => {
      const engine = await requireModuleOrFail('src/utils/sheetFormulaEngine.js', 'M3');
      const cells = {
        A1: 15,
        A2: 5,
        B1: 'Ativo',
        B2: 'Baixado',
        B3: 'Ativo',
        C1: 50,
        C2: 120,
        C3: 200,
      };

      expect(unwrapValue(evalCell(engine, cells, '=SE(A1>=10;"OK";"Baixo")'))).toBe('OK');
      expect(unwrapValue(evalCell(engine, cells, '=IF(A2>=10;"OK";"Baixo")'))).toBe('Baixo');
      expect(unwrapValue(evalCell(engine, cells, '=CONT.SE(B1:B3;"Ativo")'))).toBe(2);
      expect(unwrapValue(evalCell(engine, cells, '=COUNTIF(C1:C3;">100")'))).toBe(2);
    });

    it('F24-T1-03: supports PT-BR semicolon argument separator and comma decimal literals', async () => {
      const engine = await requireModuleOrFail('src/utils/sheetFormulaEngine.js', 'M3');
      const cells = { A1: '1.234,56', A2: 10.5 };

      expect(unwrapValue(evalCell(engine, cells, '=SOMA(10,5;20,25)'))).toBeCloseTo(30.75, 4);
      expect(unwrapValue(evalCell(engine, cells, '=MÉDIA(1,5;2,5;5,0)'))).toBeCloseTo(3, 4);
      expect(unwrapValue(evalCell(engine, cells, '=SE(2,5>1,5;"Maior";"Menor")'))).toBe('Maior');
      expect(unwrapValue(evalCell(engine, cells, '=SOMA(A1;A2)'))).toBeCloseTo(1245.06, 2);
    });

    it('F24-T1-04: resolves cross-tab references (Estoque!B2:B5) and chained cell dependencies', async () => {
      const engine = await requireModuleOrFail('src/utils/sheetFormulaEngine.js', 'M3');
      const workbook = [
        {
          name: 'Estoque',
          cells: { B2: 10, B3: 20, B4: 30, B5: 40 },
        },
        {
          name: 'Custos TI',
          cells: { A1: 500, A2: 250 },
        },
        {
          name: 'Resumo',
          cells: {
            A1: '=SOMA(Estoque!B2:B5)',
            A2: '=A1*2',
            A3: '=Estoque!B3+A2',
            A4: "=SOMA('Custos TI'!A1:A2)",
          },
        },
      ];

      expect(unwrapValue(evalCell(engine, workbook, 'A1', 'Resumo'))).toBe(100);
      expect(unwrapValue(evalCell(engine, workbook, 'A2', 'Resumo'))).toBe(200);
      expect(unwrapValue(evalCell(engine, workbook, 'A3', 'Resumo'))).toBe(220);
      expect(unwrapValue(evalCell(engine, workbook, 'A4', 'Resumo'))).toBe(750);
    });

    it('F24-T1-05: formats BRL currency (R$), percentage (%), PT-BR dates, and preserves style/freeze metadata', async () => {
      const engine = await requireModuleOrFail('src/utils/sheetFormulaEngine.js', 'M3');

      const fmt = engine.formatCellValue || engine.formatValue;
      expect(typeof fmt).toBe('function');

      const brlDisplay = fmt(1234.5, { type: 'currency', currency: 'BRL', numberFormat: 'R$ #,##0.00' });
      expect(brlDisplay).toContain('R$');
      expect(brlDisplay).toMatch(/1\.234,50/);

      const pctDisplay = fmt(0.255, { type: 'percent', numberFormat: '0.0%' });
      expect(pctDisplay).toMatch(/25[.,]5\s*%/);

      const dateDisplay = fmt('2026-11-17', { type: 'date', numberFormat: 'dd/mm/yyyy' });
      expect(dateDisplay).toContain('17/11/2026');

      if (typeof engine.evaluateWorkbook === 'function') {
        const wb = engine.evaluateWorkbook({
          sheets: [
            {
              name: 'Ativos',
              freezeRow: 1,
              cells: {
                A1: { value: 'Item', style: { bgColor: '#0f172a', textColor: '#ffffff', bold: true } },
                A2: { value: '=SOMA(100;200)', format: { type: 'currency' } },
              },
            },
          ],
        });
        const sheet = (wb.sheets || [])[0];
        expect(sheet.freezeRow).toBe(1);
        expect(sheet.cells.A1.style).toMatchObject({ bgColor: '#0f172a', textColor: '#ffffff' });
      }
    }, 15_000);
  });

  describe('Tier 2 — Error Tokens, Edge Ranges & Formula Injection Safety', () => {
    it('F24-T2-01: division by zero and empty AVERAGE return #DIV/0! safely without NaN/Infinity', async () => {
      const engine = await requireModuleOrFail('src/utils/sheetFormulaEngine.js', 'M3');
      const cells = { A1: 100, B1: 0, C1: '', D1: '', D2: null, D3: 'texto' };

      expect(unwrapValue(evalCell(engine, cells, '=10/0'))).toBe('#DIV/0!');
      expect(unwrapValue(evalCell(engine, cells, '=A1/B1'))).toBe('#DIV/0!');
      expect(unwrapValue(evalCell(engine, cells, '=A1/C1'))).toBe('#DIV/0!');
      expect(unwrapValue(evalCell(engine, cells, '=MÉDIA(D1:D3)'))).toBe('#DIV/0!');
    });

    it('F24-T2-02: direct, mutual, and cross-tab circular references return #CYCLE! without stack overflow', async () => {
      const engine = await requireModuleOrFail('src/utils/sheetFormulaEngine.js', 'M3');
      const workbook = [
        {
          name: 'Aba1',
          cells: {
            A1: '=A1+1',
            B1: '=C1+1',
            C1: '=B1+1',
            D1: '=Aba2!A1',
            E1: '=10+20',
          },
        },
        {
          name: 'Aba2',
          cells: {
            A1: '=Aba1!D1',
          },
        },
      ];

      expect(unwrapValue(evalCell(engine, workbook, 'A1', 'Aba1'))).toBe('#CYCLE!');
      expect(unwrapValue(evalCell(engine, workbook, 'B1', 'Aba1'))).toBe('#CYCLE!');
      expect(unwrapValue(evalCell(engine, workbook, 'C1', 'Aba1'))).toBe('#CYCLE!');
      expect(unwrapValue(evalCell(engine, workbook, 'D1', 'Aba1'))).toBe('#CYCLE!');
      // Non-cyclic sibling still evaluates normally
      expect(unwrapValue(evalCell(engine, workbook, 'E1', 'Aba1'))).toBe(30);
    });

    it('F24-T2-03: missing tabs, out-of-bounds refs, and unknown functions return #REF! or #NAME? cleanly', async () => {
      const engine = await requireModuleOrFail('src/utils/sheetFormulaEngine.js', 'M3');
      const cells = { A1: 10 };

      expect(unwrapValue(evalCell(engine, cells, '=SOMA(Inexistente!A1:A5)'))).toBe('#REF!');
      expect(unwrapValue(evalCell(engine, cells, '=#REF!'))).toBe('#REF!');
      expect(String(unwrapValue(evalCell(engine, cells, '=FUNCAO_DESCONHECIDA(A1)')))).toMatch(/^#(NAME\?|ERROR!)$/);
    });

    it('F24-T2-04: ignores empty/text cells in numeric aggregates and evaluates mixed CONT.SE criteria', async () => {
      const engine = await requireModuleOrFail('src/utils/sheetFormulaEngine.js', 'M3');
      const cells = {
        A1: 10,
        A2: '',
        A3: null,
        A4: 'texto',
        A5: 30,
        A6: -5,
      };

      expect(unwrapValue(evalCell(engine, cells, '=SOMA(A1:A6)'))).toBe(35);
      expect(unwrapValue(evalCell(engine, cells, '=MÉDIA(A1:A6)'))).toBeCloseTo(35 / 3, 4);
      expect(unwrapValue(evalCell(engine, cells, '=MÍN(A1:A6)'))).toBe(-5);
      expect(unwrapValue(evalCell(engine, cells, '=MÁX(A1:A6)'))).toBe(30);
      expect(unwrapValue(evalCell(engine, cells, '=CONT.SE(A1:A6;">=10")'))).toBe(2);
      expect(unwrapValue(evalCell(engine, cells, '=CONT.SE(A1:A6;"texto")'))).toBe(1);
    });

    it('F24-T2-05: blocks JS/formula injection, prototype pollution, and malformed syntax safely', async () => {
      const engine = await requireModuleOrFail('src/utils/sheetFormulaEngine.js', 'M3');
      const cells = { A1: 10 };

      delete globalThis.__nexusFormulaPwned;
      const payloads = [
        '=process.exit(1)',
        '=(()=>{globalThis.__nexusFormulaPwned=true;return 1})()',
        '=constructor.constructor("return this")()',
        '=__proto__',
        '=SOMA(A1:A3',
        '=1++2',
      ];

      for (const expr of payloads) {
        const res = unwrapValue(evalCell(engine, cells, expr));
        expect(globalThis.__nexusFormulaPwned).toBeUndefined();
        expect(String(res)).toMatch(/^#(ERROR!|NAME\?|VALUE!|REF!)$/);
      }

      // Non-formula plain text is preserved literally
      expect(unwrapValue(evalCell(engine, cells, 'Notebook Dell Latitude'))).toBe('Notebook Dell Latitude');
    });
  });
});
