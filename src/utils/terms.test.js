import { describe, it, expect } from 'vitest';
import {
  canAttachSignedCopy,
  cleanPlace,
  daysSinceIssue,
  defaultReceipt,
  isOverdue,
  joinChunks,
  matchSignedCopy,
  splitIntoChunks,
  termIdFromQr,
  termNumberFromText,
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

describe('termo assinado e conclusao automatica', () => {
  const terms = [
    { id: 'abc123XYZ789', number: 'TT-2026-0001', status: 'em_transito' },
    { id: 'def456', number: 'TR-2026-0012', status: 'pendente' },
  ];

  it('le o id do termo no QR impresso', () => {
    expect(termIdFromQr('https://nexus.app/termos/abc123XYZ789')).toBe('abc123XYZ789');
    expect(termIdFromQr('http://localhost:5173/termos/abc123XYZ789?x=1')).toBe('abc123XYZ789');
    expect(termIdFromQr('https://nexus.app/assets/abc123XYZ789')).toBeNull();
    expect(termIdFromQr(null)).toBeNull();
  });

  it('le o numero do termo no nome do arquivo', () => {
    expect(termNumberFromText('TT-2026-0001 assinado.pdf')).toBe('TT-2026-0001');
    expect(termNumberFromText('scan_tr_2026_12.jpg')).toBe('TR-2026-0012');
    expect(termNumberFromText('Digitalizar_20261009.pdf')).toBeNull();
  });

  it('casa o arquivo pelo QR antes do nome e avisa QR de termo fora da lista', () => {
    expect(matchSignedCopy({ qrText: 'https://x/termos/abc123XYZ789', fileName: 'TR-2026-0012.pdf' }, terms)).toMatchObject({ term: { number: 'TT-2026-0001' }, via: 'qr' });
    expect(matchSignedCopy({ fileName: 'tr-2026-12.pdf' }, terms)).toMatchObject({ term: { id: 'def456' }, via: 'nome' });
    expect(matchSignedCopy({ qrText: 'https://x/termos/outroTermo1' }, terms)).toEqual({ termId: 'outroTermo1', via: 'qr' });
    expect(matchSignedCopy({ fileName: 'foto.jpg' }, terms)).toBeNull();
  });

  it('so aceita um anexo por termo e nunca em cancelado', () => {
    expect(canAttachSignedCopy({ id: 'a', status: 'em_transito' })).toBe(true);
    expect(canAttachSignedCopy({ id: 'a', status: 'recebido' })).toBe(true);
    expect(canAttachSignedCopy({ id: 'a', status: 'assinado', signedCopy: { fileId: 'f' } })).toBe(false);
    expect(canAttachSignedCopy({ id: 'a', status: 'cancelado' })).toBe(false);
  });

  it('divide e remonta o arquivo sem perder bytes', () => {
    const bytes = Uint8Array.from({ length: 2500 }, (_, i) => i % 251);
    const chunks = splitIntoChunks(bytes, 1000);
    expect(chunks.map((c) => c.length)).toEqual([1000, 1000, 500]);
    expect(joinChunks(chunks)).toEqual(bytes);
    expect(splitIntoChunks(new Uint8Array(0))).toHaveLength(1);
  });

  it('recebimento padrao: tudo OK, recebedor do termo e situacao da empresa', () => {
    const term = { receiver: { name: 'Carlos' }, destination: { name: 'Loja', manager: 'Outro' }, assets: [{ id: 'a1' }, { id: 'a2' }] };
    const receipt = defaultReceipt(term, { arrivalStatus: 'Em Uso', assignReceiver: true }, new Date(2026, 9, 9));
    expect(receipt).toMatchObject({ receivedByName: 'Carlos', receivedAt: '2026-10-09', newStatus: 'Em Uso', assignToReceiver: true });
    expect(receipt.items.every((i) => i.outcome === 'ok')).toBe(true);
    // sem recebedor identificado: nao atribui a ninguem
    const blank = defaultReceipt({ destination: { name: 'Loja' }, assets: [] }, { assignReceiver: true });
    expect(blank).toMatchObject({ receivedByName: 'Conforme termo assinado', assignToReceiver: false, newStatus: 'Disponível' });
  });

  it('marca como atrasado pela previsao de chegada ou pelo prazo padrao', () => {
    const now = new Date(2026, 9, 20, 10);
    const old = { status: 'em_transito', issuedAtDate: new Date(2026, 9, 1) };
    expect(daysSinceIssue(old, now)).toBe(19);
    expect(isOverdue(old, { now })).toBe(true);
    expect(isOverdue({ ...old, expectedAt: '2026-10-25' }, { now })).toBe(false);
    expect(isOverdue({ status: 'em_transito', issuedAtDate: new Date(2026, 9, 18), expectedAt: '2026-10-19' }, { now })).toBe(true);
    expect(isOverdue({ status: 'pendente', issuedAtDate: new Date(2026, 9, 15) }, { now, days: 7 })).toBe(false);
    expect(isOverdue({ status: 'recebido', issuedAtDate: new Date(2026, 0, 1) }, { now })).toBe(false);
  });

  it('opcoes do fluxo automatico tem padrao seguro', () => {
    expect(resolveTermOptions({})).toMatchObject({ arrivalStatus: 'Disponível', assignReceiver: false, overdueDays: 7 });
    expect(resolveTermOptions({ transferArrivalStatus: 'Baixado', termOverdueDays: '500' })).toMatchObject({ arrivalStatus: 'Disponível', overdueDays: 90 });
  });
});
