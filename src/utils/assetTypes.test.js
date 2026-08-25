import { describe, it, expect } from 'vitest';
import { ASSET_TYPES, SPEC_FIELDS, buildAssetCatalog, getAssetType, isRootSpec, specsForType } from './assetTypes';

describe('catalogo base', () => {
  it('nao repete id', () => {
    const ids = ASSET_TYPES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('da um icone distinto a cada tipo', () => {
    // Regressao visual: Computador, Notebook e Monitor usavam o mesmo icone,
    // e Celular e PGT tambem — ficavam indistinguiveis na grade de selecao.
    const icons = ASSET_TYPES.map((t) => t.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it('so referencia campos tecnicos que existem', () => {
    ASSET_TYPES.forEach((t) => {
      t.specs.forEach((field) => expect(SPEC_FIELDS).toHaveProperty(field));
    });
  });

  it('cobre as categorias corporativas basicas', () => {
    const ids = ASSET_TYPES.map((t) => t.id);
    ['Nobreak', 'Switch', 'Tablet', 'Scanner', 'Projetor', 'Camera', 'Storage', 'Periferico']
      .forEach((id) => expect(ids).toContain(id));
  });
});

describe('getAssetType', () => {
  it('resolve um tipo conhecido', () => {
    expect(getAssetType('Notebook').label).toBe('Notebook');
  });

  it('cai em Outros para tipo desconhecido ou ausente', () => {
    expect(getAssetType('Coletor').id).toBe('Outros');
    expect(getAssetType(undefined).id).toBe('Outros');
  });
});

describe('specsForType', () => {
  it('entrega campos de PC', () => {
    expect(specsForType('Notebook')).toContain('processor');
  });

  it('entrega IMEI para celular e nao para impressora', () => {
    expect(specsForType('Celular')).toContain('imei1');
    expect(specsForType('Impressora')).not.toContain('imei1');
  });

  it('IMEI mora na raiz do documento, nao em specs', () => {
    expect(isRootSpec('imei1')).toBe(true);
    expect(isRootSpec('ram')).toBe(false);
  });
});

describe('buildAssetCatalog', () => {
  it('sem tipos da empresa devolve o catalogo base', () => {
    expect(buildAssetCatalog([])).toHaveLength(ASSET_TYPES.length);
  });

  it('acrescenta tipos da empresa antes de Outros', () => {
    const cat = buildAssetCatalog([{ id: 'Empilhadeira', label: 'Empilhadeira' }]);
    expect(cat).toHaveLength(ASSET_TYPES.length + 1);
    expect(cat[cat.length - 1].id).toBe('Outros');
    expect(cat.find((t) => t.id === 'Empilhadeira')?.custom).toBe(true);
  });

  it('ignora tipo da empresa que colide com o catalogo base', () => {
    expect(buildAssetCatalog([{ id: 'Notebook', label: 'Meu Notebook' }])).toHaveLength(ASSET_TYPES.length);
  });

  it('descarta entradas invalidas', () => {
    const cat = buildAssetCatalog([null, {}, { id: '   ' }, 'texto']);
    expect(cat).toHaveLength(ASSET_TYPES.length);
  });

  it('filtra campos tecnicos inexistentes declarados pela empresa', () => {
    const cat = buildAssetCatalog([{ id: 'Coletor', label: 'Coletor', specs: ['ip', 'inventado'] }]);
    expect(cat.find((t) => t.id === 'Coletor').specs).toEqual(['ip']);
  });

  it('tolera argumento nao-array', () => {
    expect(buildAssetCatalog(undefined)).toHaveLength(ASSET_TYPES.length);
    expect(buildAssetCatalog('x')).toHaveLength(ASSET_TYPES.length);
  });
});
