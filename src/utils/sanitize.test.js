import { describe, it, expect } from 'vitest';
import { safeCssColor, safeImageUrl, safeLinkUrl, safeSpreadsheetCell, safeText } from './sanitize';

describe('safeLinkUrl', () => {
  it('aceita http e https', () => {
    expect(safeLinkUrl('https://exemplo.com/nota.pdf')).toBe('https://exemplo.com/nota.pdf');
    expect(safeLinkUrl('http://intranet/doc')).toBe('http://intranet/doc');
  });

  it('aceita mailto e tel', () => {
    expect(safeLinkUrl('mailto:ti@empresa.com')).toBe('mailto:ti@empresa.com');
    expect(safeLinkUrl('tel:+5591999999999')).toBe('tel:+5591999999999');
  });

  it('bloqueia javascript:', () => {
    // Anexo salvo no banco por um usuario vira XSS armazenado no clique.
    expect(safeLinkUrl('javascript:alert(document.cookie)')).toBeNull();
    expect(safeLinkUrl('  JaVaScRiPt:alert(1)  ')).toBeNull();
  });

  it('bloqueia data: e vbscript:', () => {
    expect(safeLinkUrl('data:text/html;base64,PHNjcmlwdD4=')).toBeNull();
    expect(safeLinkUrl('vbscript:msgbox(1)')).toBeNull();
  });

  it('devolve null para entrada vazia ou nao-string', () => {
    expect(safeLinkUrl('')).toBeNull();
    expect(safeLinkUrl(null)).toBeNull();
    expect(safeLinkUrl(42)).toBeNull();
  });
});

describe('safeImageUrl', () => {
  it('aceita https', () => {
    expect(safeImageUrl('https://cdn.exemplo.com/logo.png')).toBe('https://cdn.exemplo.com/logo.png');
  });

  it('aceita data:image base64', () => {
    const inline = 'data:image/png;base64,iVBORw0KGgo=';
    expect(safeImageUrl(inline)).toBe(inline);
  });

  it('bloqueia javascript: e devolve string vazia', () => {
    expect(safeImageUrl('javascript:alert(1)')).toBe('');
  });

  it('bloqueia data: nao-imagem', () => {
    expect(safeImageUrl('data:text/html,<script>alert(1)</script>')).toBe('');
  });
});

describe('safeCssColor', () => {
  it('aceita hex, rgb e hsl', () => {
    expect(safeCssColor('#4F46E5')).toBe('#4F46E5');
    expect(safeCssColor('#fff')).toBe('#fff');
    expect(safeCssColor('rgb(79, 70, 229)')).toBe('rgb(79, 70, 229)');
    expect(safeCssColor('hsla(240, 60%, 50%, 0.5)')).toBe('hsla(240, 60%, 50%, 0.5)');
  });

  it('bloqueia url() e quebra de declaracao', () => {
    // A cor vem do whitelabel do inquilino e e injetada numa custom property.
    expect(safeCssColor('url(https://evil.tld/pixel)')).toBeNull();
    expect(safeCssColor('red; background: url(https://evil.tld)')).toBeNull();
    expect(safeCssColor('expression(alert(1))')).toBeNull();
  });

  it('bloqueia palavras-chave livres', () => {
    expect(safeCssColor('red')).toBeNull();
    expect(safeCssColor('')).toBeNull();
    expect(safeCssColor(null)).toBeNull();
  });
});

describe('safeSpreadsheetCell', () => {
  it('neutraliza formulas do Excel', () => {
    expect(safeSpreadsheetCell('=1+1')).toBe("'=1+1");
    expect(safeSpreadsheetCell('+CMD|calc')).toBe("'+CMD|calc");
    expect(safeSpreadsheetCell('-2+3')).toBe("'-2+3");
    expect(safeSpreadsheetCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('preserva texto comum', () => {
    expect(safeSpreadsheetCell('NTB-001')).toBe('NTB-001');
    expect(safeSpreadsheetCell(123)).toBe('123');
    expect(safeSpreadsheetCell(null)).toBe('');
  });
});

describe('safeText', () => {
  it('remove caracteres de controle e preserva o espaco', () => {
    expect(safeText('linha  um')).toBe('linha  um');
    expect(safeText('a' + String.fromCharCode(9) + 'bc')).toBe('abc');
    expect(safeText('x' + String.fromCharCode(0) + 'y')).toBe('xy');
  });

  it('limita o tamanho e normaliza nulos', () => {
    expect(safeText('abcdef', 3)).toBe('abc');
    expect(safeText(null)).toBe('');
    expect(safeText(undefined)).toBe('');
  });
});
