import { describe, it, expect, vi } from 'vitest';

vi.mock('./firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  addDoc: vi.fn(), collection: vi.fn(), deleteDoc: vi.fn(), doc: vi.fn(),
  getDocs: vi.fn(), orderBy: vi.fn(), query: vi.fn(), serverTimestamp: vi.fn(),
  updateDoc: vi.fn(), where: vi.fn(), writeBatch: vi.fn(),
}));

const {
  findHeadquarters, getLocations, groupLocations, groupLocationsByKind, locationKind, LEGACY_LOCATIONS, STARTER_LOCATIONS,
} = await import('./locationService');

describe('getLocations', () => {
  it('devolve vazio sem inquilino, sem consultar o banco', async () => {
    await expect(getLocations(null)).resolves.toEqual([]);
    await expect(getLocations(undefined)).resolves.toEqual([]);
  });
});

describe('groupLocations', () => {
  it('agrupa por regiao e ordena', () => {
    const groups = groupLocations([
      { id: '1', name: 'Fortaleza', region: 'Ceara' },
      { id: '2', name: 'Matriz', region: 'Para' },
      { id: '3', name: 'Castanhal', region: 'Para' },
    ]);
    expect(groups.map((g) => g.region)).toEqual(['Ceara', 'Para']);
    expect(groups[1].items).toHaveLength(2);
  });

  it('usa Geral quando a regiao nao foi informada', () => {
    expect(groupLocations([{ id: '1', name: 'Sede' }])[0].region).toBe('Geral');
  });

  it('tolera lista vazia', () => {
    expect(groupLocations()).toEqual([]);
  });
});

describe('presets', () => {
  it('as filiais legadas nao sao o padrao de uma empresa nova', () => {
    // O ponto da mudanca: nenhum cliente novo herda as filiais da Shineray.
    const nomes = STARTER_LOCATIONS.map((l) => l.name);
    expect(nomes).not.toContain('Matriz - Belem');
    expect(LEGACY_LOCATIONS.map((l) => l.name)).toContain('Matriz - Belem');
  });

  it('todo preset tem nome e regiao', () => {
    [...STARTER_LOCATIONS, ...LEGACY_LOCATIONS].forEach((l) => {
      expect(l.name).toBeTruthy();
      expect(l.region).toBeTruthy();
    });
  });
});

describe('tipo do local', () => {
  it('respeita o tipo gravado', () => {
    expect(locationKind({ name: 'Filial Centro', kind: 'matriz' })).toBe('matriz');
  });

  it('infere pelo nome em locais antigos', () => {
    expect(locationKind({ name: 'Matriz - Belem' })).toBe('matriz');
    expect(locationKind({ name: 'Filial Castanhal' })).toBe('loja');
    expect(locationKind({ name: 'Loja Shopping Boulevard' })).toBe('loja');
    expect(locationKind({ name: 'Almoxarifado' })).toBe('deposito');
    expect(locationKind({ name: 'Home Office' })).toBe('outro');
  });

  it('acha a matriz para ser a origem padrao', () => {
    const locais = [{ name: 'Filial A' }, { name: 'Matriz - Belem' }];
    expect(findHeadquarters(locais).name).toBe('Matriz - Belem');
    expect(findHeadquarters([{ name: 'Filial A' }])).toBeNull();
  });

  it('agrupa por tipo com a matriz primeiro', () => {
    const grupos = groupLocationsByKind([{ id: '1', name: 'Loja B' }, { id: '2', name: 'Matriz' }, { id: '3', name: 'Loja A' }]);
    expect(grupos.map((g) => g.kind)).toEqual(['matriz', 'loja']);
    expect(grupos[1].items.map((l) => l.name)).toEqual(['Loja A', 'Loja B']);
  });
});
