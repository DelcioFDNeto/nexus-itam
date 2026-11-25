// tests/e2e_cloud_vault/portal_document_preview.test.js
// =============================================================================
// Validação — Visualizador Inline de PDF, Word e Excel do Portal do Colaborador
// =============================================================================

import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  classifyPreviewKind,
  parseExcelPreview,
  parseWordPreview,
  sanitizeWordHtml,
} from '../../portal-colaborador/src/utils/documentPreview.js';

describe('Portal do Colaborador — Visualização Inline de PDF, Word e Excel', () => {
  it('classifica corretamente PDF, Excel, Word, Imagem e Texto', () => {
    expect(classifyPreviewKind('ADIANTAMENTOS.pdf', 'application/pdf')).toBe('pdf');
    expect(classifyPreviewKind('Planilha-Financeira.xlsx', 'application/octet-stream')).toBe('excel');
    expect(classifyPreviewKind('Relatorio.xls', 'application/vnd.ms-excel')).toBe('excel');
    expect(classifyPreviewKind('Contrato.docx', 'application/octet-stream')).toBe('word');
    expect(classifyPreviewKind('Termo.doc', 'application/msword')).toBe('word');
    expect(classifyPreviewKind('comprovante.png', 'image/png')).toBe('image');
    expect(classifyPreviewKind('notas.txt', 'text/plain')).toBe('text');
  });

  it('decodifica planilha Excel (.xlsx) multi-aba preservando cabeçalhos, linhas e valores', async () => {
    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.aoa_to_sheet([
      ['Colaborador', 'Valor', 'Status'],
      ['Karen Matos', 1250.5, 'Aprovado'],
      ['João Silva', 890, 'Pendente'],
    ]);
    const ws2 = XLSX.utils.aoa_to_sheet([
      ['Resumo', 'Total'],
      ['Geral', 2140.5],
    ]);
    XLSX.utils.book_append_sheet(wb, ws1, 'Adiantamentos');
    XLSX.utils.book_append_sheet(wb, ws2, 'Totais');

    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const parsed = await parseExcelPreview(buf, 'Adiantamentos.xlsx');

    expect(parsed.kind).toBe('excel');
    expect(parsed.sheets).toHaveLength(2);
    expect(parsed.sheets[0].name).toBe('Adiantamentos');
    expect(parsed.sheets[0].colHeaders).toEqual(['A', 'B', 'C']);
    expect(parsed.sheets[0].rows[0].cells).toEqual(['Colaborador', 'Valor', 'Status']);
    expect(parsed.sheets[0].rows[1].cells[0]).toBe('Karen Matos');
    expect(parsed.sheets[1].name).toBe('Totais');
  });

  it('sanitiza HTML de documentos Word removendo XSS e preservando estrutura legível', async () => {
    const dirty = `
      <h1>Política Corporativa</h1>
      <script>alert('xss')</script>
      <p onclick="evil()">Texto <strong>importante</strong> com <a href="javascript:alert(1)">link ruim</a> e <a href="https://itam-nexus.web.app">link seguro</a>.</p>
      <table><tr><th>Coluna</th></tr><tr><td>Valor</td></tr></table>
      <iframe src="https://evil.test"></iframe>
    `;
    const clean = sanitizeWordHtml(dirty);
    expect(clean).toContain('<h1>Política Corporativa</h1>');
    expect(clean).toContain('<strong>importante</strong>');
    expect(clean).toContain('<table>');
    expect(clean).toContain('https://itam-nexus.web.app');
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('<iframe');
    expect(clean).not.toContain('onclick');
    expect(clean).not.toContain('javascript:');

    // Fallback seguro para .doc legado sem assinatura ZIP
    const legacy = await parseWordPreview(new TextEncoder().encode('Contrato de comodato corporativo Shineray 2026'), 'antigo.doc');
    expect(legacy.kind).toBe('word');
    expect(legacy.legacyDoc).toBe(true);
    expect(legacy.html).toContain('Contrato de comodato corporativo Shineray 2026');
  });
});
