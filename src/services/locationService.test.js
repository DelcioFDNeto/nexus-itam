import { describe, it, expect, vi } from 'vitest';

vi.mock('./firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  addDoc: vi.fn(), collection: vi.fn(), deleteDoc: vi.fn(), doc: vi.fn(),
  getDocs: vi.fn(), orderBy: vi.fn(), query: vi.fn(), serverTimestamp: vi.fn(),
  updateDoc: vi.fn(), where: vi.fn(), writeBatch: vi.fn(),
}));

const { getLocations, groupLocations, LEGACY_LOCATIONS, STARTER_LOCATIONS } = await import('./locationService');

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
