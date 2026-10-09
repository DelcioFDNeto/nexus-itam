import { describe, it, expect } from 'vitest';
import { resolvePrintBranding } from './printTemplates';
import {
  buildResponsibilityTermDocument,
  buildReturnTermDocument,
  buildTermDocumentFor,
  buildTransferTermDocument,
} from './termDocuments';
import { resolveTermOptions } from './terms';

const XSS = '<img src=x onerror="alert(1)">';
const branding = resolvePrintBranding({ companyName: 'ACME', cnpj: '12.345.678/0001-90', itManager: 'Gestora TI' });

const asset = (id, extra = {}) => ({
  id, internalId: `NB-${id}`, model: 'Dell Latitude', type: 'Notebook', serialNumber: `SN${id}`, valor: '3.500,00',
  accessories: 'Carregador', condition: 'Bom', ...extra,
});

describe('termo de responsabilidade', () => {
  const term = {
    id: 't1', kind: 'responsabilidade', number: 'TR-2026-0007', status: 'pendente',
    holder: { name: 'Ana Souza', cpf: '111.222.333-44', role: 'Vendedora', sector: 'Comercial', branch: 'Loja Centro' },
    assets: [asset('1'), asset('2')],
    issuedAtDate: new Date(2026, 9, 9),
  };

  it('lista todos os itens, numero, QR e dados do colaborador', () => {
    const html = buildResponsibilityTermDocument({ term, branding, options: resolveTermOptions({}), url: 'https://app/termos/t1' });
    expect(html).toContain('TR-2026-0007');
    expect(html).toContain('NB-1');
    expect(html).toContain('NB-2');
    expect(html).toContain('2 equipamentos');
    expect(html).toContain('111.222.333-44');
    expect(html).toContain('<svg'); // QR do termo
  });

  it('mostra valor total, cidade e testemunhas quando configurado', () => {
    const html = buildResponsibilityTermDocument({
      term, branding, options: resolveTermOptions({ termShowValue: true, termWitnesses: true, termCity: 'Belém' }),
    });
    expect(html).toContain('Valor total');
    expect(html).toMatch(/R\$\s?7\.000,00/);
    expect(html).toContain('Belém, 9 de outubro de 2026');
    expect(html).toContain('Testemunha 2');
    // assinatura em branco nao pode imprimir o texto "&nbsp;"
    expect(html).not.toContain('&amp;nbsp;');
  });

  it('rascunho sai sem numero e com marca d agua', () => {
    const html = buildResponsibilityTermDocument({ term, branding, options: resolveTermOptions({}), draft: true, url: 'x' });
    expect(html).toContain('RASCUNHO — SEM VALIDADE');
    expect(html).not.toContain('TR-2026-0007');
  });
});

describe('termo de devolucao', () => {
  it('registra avaria como ressalva', () => {
    const html = buildReturnTermDocument({
      term: { id: 't2', number: 'TD-2026-0001', holder: { name: 'Ana' }, assets: [asset('1', { condition: 'Avariado' })], receivedByName: 'TI Matriz' },
      branding,
      options: resolveTermOptions({}),
    });
    expect(html).toContain('ressalvadas as avarias');
    expect(html).toContain('TI Matriz');
  });
});

describe('termo de transferencia', () => {
  const base = {
    id: 't3', kind: 'transferencia', number: 'TT-2026-0003', status: 'em_transito',
    origin: { name: 'Matriz - Belém', address: 'Av. Principal, 100' },
    destination: { name: 'Loja Castanhal', address: 'Rua B, 20', phone: '(91) 3333-0000' },
    receiver: { name: 'Gerente Loja', role: 'Gerente' },
    transport: { mode: 'Transportadora', carrier: 'Rápido Norte', document: 'NF 1234' },
    expectedAt: '2026-10-12',
    assets: [asset('1'), asset('2'), asset('3')],
    issuedByName: 'Técnico TI',
  };

  it('tem origem, destino, transporte, itens e campo de conferencia em branco', () => {
    const html = buildTransferTermDocument({ term: base, branding, options: resolveTermOptions({}) });
    expect(html).toContain('Matriz - Belém');
    expect(html).toContain('LOJA CASTANHAL');
    expect(html).toContain('NF 1234');
    expect(html).toContain('12/10/2026');
    expect(html).toContain('dos 3 equipamentos');
    expect(html).toContain('Carimbo da unidade');
    expect(html).toContain('DA CONFERÊNCIA');
  });

  it('depois da conferencia mostra quem recebeu e as ressalvas', () => {
    const html = buildTermDocumentFor(
      {
        ...base,
        status: 'recebido_ressalvas',
        receipt: {
          receivedByName: 'Gerente Loja', receivedAt: '2026-10-11', confirmedByName: 'Gerente Loja',
          items: [{ id: '1', internalId: 'NB-1', outcome: 'ok' }, { id: '2', internalId: 'NB-2', outcome: 'ressalva', note: 'Tela riscada' }],
        },
      },
      branding,
      resolveTermOptions({}),
    );
    expect(html).toContain('Recebido com ressalvas');
    expect(html).toContain('Tela riscada');
    expect(html).toContain('11/10/2026');
    expect(html).not.toContain('Carimbo da unidade');
  });

  it('transferencia cancelada sai com aviso', () => {
    const html = buildTransferTermDocument({ term: { ...base, status: 'cancelado', cancelReason: 'Loja fechada' }, branding, options: resolveTermOptions({}) });
    expect(html).toContain('Termo cancelado');
    expect(html).toContain('Loja fechada');
  });
});

describe('seguranca', () => {
  it('escapa todos os campos vindos do banco nos tres termos', () => {
    const evil = {
      id: XSS, number: XSS, notes: XSS, cancelReason: XSS, receivedByName: XSS, returnLocation: XSS, issuedByName: XSS,
      holder: { name: XSS, cpf: XSS, role: XSS, sector: XSS, branch: XSS },
      origin: { name: XSS, address: XSS, manager: XSS }, destination: { name: XSS, address: XSS, manager: XSS, phone: XSS },
      receiver: { name: XSS, role: XSS }, transport: { mode: XSS, carrier: XSS, document: XSS },
      assets: [asset(XSS, { model: XSS, serialNumber: XSS, accessories: XSS, internalId: XSS, type: XSS })],
    };
    const options = resolveTermOptions({ termCity: XSS, termClauses: XSS, transferClauses: XSS });
    const evilBranding = resolvePrintBranding({ companyName: XSS, cnpj: XSS, itManager: XSS });
    ['responsabilidade', 'devolucao', 'transferencia'].forEach((kind) => {
      const html = buildTermDocumentFor({ ...evil, kind }, evilBranding, options);
      expect(html).not.toMatch(/<img src=x/i);
    });
  });
});
