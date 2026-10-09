import { describe, it, expect } from 'vitest';
import {
  cleanPlace,
  formatTermNumber,
  parseMoney,
  receiptStatus,
  resolveTermOptions,
  snapshotAsset,
  toLocalDate,
  transferBlocker,
  DEFAULT_TRANSFER_CLAUSES,
} from './terms';

describe('numeracao', () => {
  it('gera numero com prefixo por tipo, ano e 4 digitos', () => {
    expect(formatTermNumber('responsabilidade', 2026, 1)).toBe('TR-2026-0001');
    expect(formatTermNumber('devolucao', 2026, 42)).toBe('TD-2026-0042');
    expect(formatTermNumber('transferencia', 2026, 12345)).toBe('TT-2026-12345');
  });
});

describe('snapshotAsset', () => {
  it('fotografa o ativo com status, local e responsavel anteriores', () => {
    const snap = snapshotAsset({
      id: 'a1', internalId: 'NB-01', model: 'Dell', status: 'Disponível', location: 'Matriz', assignedTo: 'Ana',
      accessories: 'Mouse', peripherals: [{ name: 'Carregador' }],
    }, 'Novo');
    expect(snap).toMatchObject({
      id: 'a1', internalId: 'NB-01', previousStatus: 'Disponível', previousLocation: 'Matriz', previousHolder: 'Ana',
      accessories: 'Mouse, Carregador', condition: 'Novo',
    });
  });

  it('estado desconhecido vira "Bom"', () => {
    expect(snapshotAsset({ id: 'a1' }, 'Quebrado demais').condition).toBe('Bom');
  });
});

describe('regras de transferencia', () => {
  it('bloqueia ativo ja em transito ou baixado', () => {
    expect(transferBlocker({ transit: { termId: 't1', number: 'TT-2026-0001' } })).toMatch(/TT-2026-0001/);
    expect(transferBlocker({ status: 'Baixado' })).toMatch(/baixado/);
    expect(transferBlocker({ status: 'Em Uso' })).toBeNull();
  });

  it('qualquer item fora do "ok" marca o recebimento com ressalvas', () => {
    expect(receiptStatus([{ outcome: 'ok' }, { outcome: 'ok' }])).toBe('recebido');
    expect(receiptStatus([{ outcome: 'ok' }, { outcome: 'ressalva' }])).toBe('recebido_ressalvas');
    expect(receiptStatus([{ outcome: 'nao_recebido' }])).toBe('recebido_ressalvas');
  });

  it('limpa os dados do local', () => {
    expect(cleanPlace({ name: ' Loja 1 ', extra: 'x' })).toEqual({ name: 'Loja 1', address: '', manager: '', phone: '' });
  });
});

describe('utilitarios', () => {
  it('entende valores em formato brasileiro e americano', () => {
    expect(parseMoney('1.234,56')).toBeCloseTo(1234.56);
    expect(parseMoney('1234.56')).toBeCloseTo(1234.56);
    expect(parseMoney('R$ 3.500,00')).toBe(3500);
    expect(parseMoney('')).toBeNaN();
  });

  it('data de formulario nao "volta um dia" no fuso do Brasil', () => {
    const date = toLocalDate('2026-10-09');
    expect(date.getDate()).toBe(9);
    expect(date.getMonth()).toBe(9);
  });

  it('opcoes do termo caem nos textos padrao', () => {
    const options = resolveTermOptions({});
    expect(options.transferClauses).toBe(DEFAULT_TRANSFER_CLAUSES);
    expect(options.showValue).toBe(false);
    expect(resolveTermOptions({ termWitnesses: true, termCity: 'Belém' })).toMatchObject({ witnesses: true, city: 'Belém' });
  });
});
