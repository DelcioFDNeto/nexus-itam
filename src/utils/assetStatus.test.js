import { describe, it, expect } from 'vitest';
import {
  ACTIVE_STATUSES, ASSET_STATUSES, RETIRED_STATUSES, WRITE_OFF_REASONS,
  getStatus, isRetired, statusBadgeClass, statusDotClass, warrantyStatus,
} from './assetStatus';

describe('catalogo de status', () => {
  it('nao repete id', () => {
    const ids = ASSET_STATUSES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('preserva os status legados gravados no banco', () => {
    // Estes valores ja existem nos documentos; renomear quebraria os filtros.
    const ids = ASSET_STATUSES.map((s) => s.id);
    ['Em Uso', 'Disponível', 'Manutenção', 'Entregue', 'Defeito', 'Em Transferência', 'Em Trânsito']
      .forEach((legado) => expect(ids).toContain(legado));
  });

  it('separa ativos de aposentados sem sobreposicao', () => {
    expect(ACTIVE_STATUSES.length + RETIRED_STATUSES.length).toBe(ASSET_STATUSES.length);
    expect(RETIRED_STATUSES.map((s) => s.id)).toEqual(['Extraviado', 'Baixado']);
  });

  it('oferece motivos de baixa', () => {
    expect(WRITE_OFF_REASONS.length).toBeGreaterThan(3);
    expect(WRITE_OFF_REASONS).toContain('Fim de vida útil');
  });
});

describe('isRetired', () => {
  it('reconhece os estados terminais', () => {
    expect(isRetired('Baixado')).toBe(true);
    expect(isRetired('Extraviado')).toBe(true);
  });

  it('trata operacionais como inventario vivo', () => {
    ['Em Uso', 'Disponível', 'Manutenção', 'Defeito'].forEach((st) => expect(isRetired(st)).toBe(false));
  });

  it('status desconhecido ou ausente conta como ativo', () => {
    // Nunca sumir com um ativo do inventario por causa de um valor legado.
    expect(isRetired('Sei la')).toBe(false);
    expect(isRetired(undefined)).toBe(false);
  });
});

describe('getStatus', () => {
  it('resolve status conhecido', () => {
    expect(getStatus('Baixado').tone).toBe('slate');
  });

  it('devolve rotulo do proprio valor quando desconhecido', () => {
    expect(getStatus('Emprestado').label).toBe('Emprestado');
  });

  it('sempre entrega classes de badge validas', () => {
    ['Em Uso', 'Baixado', 'Inventado', undefined].forEach((st) => {
      expect(statusBadgeClass(st)).toContain('bg-');
      expect(statusDotClass(st)).toContain('bg-');
    });
  });
});

describe('warrantyStatus', () => {
  const hoje = new Date('2026-06-15T12:00:00Z');
  const em = (dias) => new Date(hoje.getTime() + dias * 86400000).toISOString().slice(0, 10);

  it('sem data nao ha situacao', () => {
    expect(warrantyStatus(null, hoje)).toBeNull();
    expect(warrantyStatus('', hoje)).toBeNull();
    expect(warrantyStatus('data-invalida', hoje)).toBeNull();
  });

  it('garantia distante esta vigente', () => {
    expect(warrantyStatus(em(200), hoje).state).toBe('vigente');
  });

  it('avisa quando faltam 30 dias ou menos', () => {
    expect(warrantyStatus(em(30), hoje).state).toBe('expirando');
    expect(warrantyStatus(em(5), hoje).state).toBe('expirando');
    expect(warrantyStatus(em(31), hoje).state).toBe('vigente');
  });

  it('marca vencida e devolve dias negativos', () => {
    const r = warrantyStatus(em(-10), hoje);
    expect(r.state).toBe('expirada');
    expect(r.days).toBeLessThan(0);
  });

  it('o ultimo dia ainda conta como coberto', () => {
    expect(warrantyStatus(em(0), hoje).state).toBe('expirando');
  });
});
