import { describe, it, expect } from 'vitest';
import {
  auditCoverage, buildAssetIndex, buildAuditRecord, classifyScan, expectedAt, resolveScan, seenByAgentAt, summarizeAudit,
} from './audit';

const assets = [
  { id: 'a1', internalId: 'SHL-NTB-001', serialNumber: '5CG1234XYZ', location: 'Loja Castanhal', status: 'Em Uso', model: 'Dell' },
  { id: 'a2', internalId: 'shl-cpu-002', serialNumber: 'Default string', location: 'Loja Castanhal', status: 'Disponível', model: 'PC' },
  { id: 'a3', internalId: 'SHL-CPU-003', location: 'Matriz - Belém', status: 'Em Uso', model: 'HP' },
  { id: 'a4', internalId: 'SHL-CPU-004', location: 'Loja Castanhal', status: 'Baixado', model: 'Velho' },
  { id: 'a5', internalId: 'SHL-NTB-005', location: 'Loja Castanhal', status: 'Em Trânsito', transit: { termId: 't', from: 'Loja Castanhal', to: 'Matriz - Belém' } },
  { id: 'a6', internalId: 'SHL-NTB-006', location: 'Matriz - Belém', status: 'Em Trânsito', transit: { termId: 't2', from: 'Matriz - Belém', to: 'Loja Castanhal' } },
  { id: 'a7', internalId: 'SHL-PRM-007', location: 'Loja Castanhal', status: 'Em Uso', category: 'Promocional' },
];

describe('leitura', () => {
  const index = buildAssetIndex(assets);

  it('acha pelo patrimonio (sem diferenciar caixa), serial util ou link do ativo', () => {
    expect(resolveScan(' shl-ntb-001 ', index)?.id).toBe('a1');
    expect(resolveScan('SHL-CPU-002', index)?.id).toBe('a2');
    expect(resolveScan('5cg1234xyz', index)?.id).toBe('a1');
    expect(resolveScan('https://app.nexus/assets/a3', index)?.id).toBe('a3');
    expect(resolveScan('DEFAULTSTRING', index)).toBeNull();
    expect(resolveScan('XYZ-999', index)).toBeNull();
  });

  it('classifica: encontrado, outro local, baixado, transito e desconhecido', () => {
    const at = 'Loja Castanhal';
    expect(classifyScan(assets[0], at)).toBe('found');
    expect(classifyScan(assets[2], at)).toBe('other_location');
    expect(classifyScan(assets[3], at)).toBe('retired');
    expect(classifyScan(assets[4], at)).toBe('transit_out');
    expect(classifyScan(assets[5], at)).toBe('transit_in');
    expect(classifyScan(null, at)).toBe('unknown');
  });
});

describe('conferencia', () => {
  it('esperados: sem baixados, sem transferencia em andamento e sem comodato', () => {
    expect(expectedAt(assets, 'loja castanhal').map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  it('resume com acuracidade e gera relatorio com fotografia dos itens', () => {
    const expected = expectedAt(assets, 'Loja Castanhal');
    const scans = [
      { assetId: 'a1', code: 'SHL-NTB-001', internalId: 'SHL-NTB-001', result: 'found', method: 'qr' },
      { assetId: 'a3', code: 'SHL-CPU-003', internalId: 'SHL-CPU-003', model: 'HP', from: 'Matriz - Belém', result: 'other_location', method: 'manual' },
      { code: 'ZZZ', result: 'unknown', method: 'manual' },
    ];
    const summary = summarizeAudit(expected, scans);
    expect(summary).toMatchObject({ expected: 2, found: 1, missing: 1, otherLocation: 1, unknown: 1, accuracy: 50 });

    const record = buildAuditRecord({ tenantId: 't', location: 'Loja Castanhal', auditedBy: 'ana@x', expected, scans, startedAt: new Date('2026-10-21T10:00:00Z') });
    expect(record.status).toBe('Parcial');
    expect(record.stats).toMatchObject({ expected: 2, found: 1, missing: 1, intruders: 1, accuracy: 50 });
    expect(record.items.map((i) => `${i.internalId}:${i.result}`)).toEqual(['shl-cpu-002:missing', 'SHL-CPU-003:other_location', 'ZZZ:unknown', 'SHL-NTB-001:found']);
    expect(record.missingItems).toEqual(['shl-cpu-002']);
  });

  it('local vazio conferido conta como 100%', () => {
    expect(summarizeAudit([], []).accuracy).toBe(100);
  });
});

describe('agente e cobertura', () => {
  const now = new Date('2026-10-21T12:00:00Z');
  const loja = { name: 'Loja Castanhal', networks: '10.20.1.0/24' };

  it('maquina vista pelo agente hoje na rede do local', () => {
    expect(seenByAgentAt({ agent: { lastSeenAt: new Date('2026-10-21T08:00:00Z'), ip: '10.20.1.15' } }, loja, { now })).toBe(true);
    expect(seenByAgentAt({ agent: { lastSeenAt: new Date('2026-10-19T08:00:00Z'), ip: '10.20.1.15' } }, loja, { now })).toBe(false);
    expect(seenByAgentAt({ agent: { lastSeenAt: new Date('2026-10-21T08:00:00Z'), ip: '10.30.1.15' } }, loja, { now })).toBe(false);
    expect(seenByAgentAt({ agent: { lastSeenAt: now, ip: '10.20.1.15' } }, { name: 'Sem rede' }, { now })).toBe(false);
  });

  it('cobertura aponta locais nunca auditados ou vencidos', () => {
    const audits = [
      { location: 'Loja Castanhal', date: new Date('2026-10-01T00:00:00Z') },
      { location: 'Matriz - Belém', date: new Date('2026-05-01T00:00:00Z') },
    ];
    const coverage = auditCoverage(['Loja Castanhal', 'Matriz - Belém', 'Depósito'], audits, { now });
    expect(coverage.map((c) => [c.name, c.overdue])).toEqual([['Loja Castanhal', false], ['Matriz - Belém', true], ['Depósito', true]]);
    expect(coverage[0].daysSince).toBe(20);
  });
});
