import { describe, it, expect } from 'vitest';
import { buildLabelsDocument, escapeHtml, resolvePrintBranding } from './printTemplates';
import { buildTermDocument } from './termDocuments';

const XSS = '<img src=x onerror="alert(1)">';

describe('escapeHtml', () => {
  it('neutraliza marcacao', () => {
    expect(escapeHtml(XSS)).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(escapeHtml(null)).toBe('');
  });
});

describe('resolvePrintBranding', () => {
  it('nao herda o e-mail de suporte de outra empresa', () => {
    // Regressao: etiquetas e termos de TODAS as empresas saiam com o e-mail
    // de suporte fixo da primeira cliente quando o campo estava vazio.
    const branding = resolvePrintBranding({}, { companyName: 'ACME', role: 'owner', tenantId: 'acme' });
    expect(branding.supportEmail).toBe('');
    expect(branding.companyName).toBe('ACME');
  });

  it('recusa logo e cor maliciosos', () => {
    const branding = resolvePrintBranding({ logoUrl: 'javascript:alert(1)', primaryColor: 'red;background:url(x)' });
    expect(branding.logoUrl).toBe('');
    expect(branding.color).toBe('#4F46E5');
  });

  it('whitelabel remove a marca Nexus', () => {
    const user = { role: 'owner', tenantId: 'acme', entitlements: { features: { whitelabel: true } } };
    expect(resolvePrintBranding({}, user).showNexusBrand).toBe(false);
    const semPlano = { role: 'owner', tenantId: 'acme', entitlements: { features: { whitelabel: false } } };
    expect(resolvePrintBranding({}, semPlano).showNexusBrand).toBe(true);
  });
});

describe('documentos impressos', () => {
  const branding = resolvePrintBranding({ companyName: 'ACME', supportEmail: 'ti@acme.com' });

  it('etiqueta escapa patrimonio e modelo', () => {
    const html = buildLabelsDocument([{ code: 'NB-001', subtitle: XSS }], branding);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
    expect(html).toContain('ti@acme.com');
  });

  it('termo escapa todos os campos do ativo e da empresa', () => {
    const html = buildTermDocument({
      asset: { model: XSS, internalId: 'NB-1', type: 'Notebook', assignedTo: XSS, clientCpf: XSS, location: XSS },
      assetId: 'abc',
      branding: resolvePrintBranding({ companyName: XSS, cnpj: XSS, itManager: XSS }),
      termTitle: XSS,
      clauses: `1. ${XSS}`,
    });
    expect(html).not.toMatch(/<img src=x/i);
    expect(html).not.toContain('onerror="alert');
  });

  it('usa o logo da empresa no termo quando configurado', () => {
    const html = buildTermDocument({
      asset: { model: 'Dell', internalId: 'NB-1' },
      assetId: 'abc',
      branding: resolvePrintBranding({ companyName: 'ACME', logoUrl: 'https://cdn.acme.com/logo.png' }),
    });
    expect(html).toContain('src="https://cdn.acme.com/logo.png"');
  });
});
