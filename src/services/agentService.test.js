import { describe, it, expect, vi, beforeEach } from 'vitest';

const batch = { set: vi.fn(), update: vi.fn(), commit: vi.fn().mockResolvedValue() };
const store = { inventory: null, inbox: {} };

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name) => ({ name })),
  doc: vi.fn((ref, name, id) => {
    if (typeof name === 'string' && id) return { path: `${name}/${id}`, id };
    if (typeof name === 'string') return { path: name, id: name };
    return { path: `${ref.name}/novo-id`, id: 'novo-id' };
  }),
  addDoc: vi.fn().mockResolvedValue({ id: 'inbox1' }),
  updateDoc: vi.fn(),
  deleteField: vi.fn(() => '__delete__'),
  getDoc: vi.fn(async (ref) => {
    if (ref.path.startsWith('assetInventory/')) return { exists: () => Boolean(store.inventory), data: () => ({ inventory: store.inventory }) };
    if (ref.path.startsWith('agentInbox/')) {
      const data = store.inbox[ref.id];
      return { id: ref.id, exists: () => Boolean(data), data: () => data };
    }
    return { exists: () => false, data: () => ({}) };
  }),
  getDocs: vi.fn().mockResolvedValue({ docs: [] }),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  serverTimestamp: vi.fn(() => '__now__'),
  writeBatch: vi.fn(() => batch),
  runTransaction: vi.fn(async (_db, fn) => fn({
    get: async (ref) => ({ id: ref.id, exists: () => Boolean(store.inbox[ref.id]), data: () => store.inbox[ref.id] }),
    update: (ref, patch) => { store.inbox[ref.id] = { ...store.inbox[ref.id], ...patch }; },
  })),
}));
vi.mock('./firebase', () => ({ db: {} }));
vi.mock('./licenseService', () => ({ getLicenses: vi.fn().mockResolvedValue([]), assignLicense: vi.fn(), unassignLicense: vi.fn() }));

const { registerAgentAsset, processAgentInbox, matchLicensesForSoftware, enqueueAgentSubmission } = await import('./agentService');
const { assignLicense } = await import('./licenseService');
const { normalizeInventory } = await import('../utils/agentInventory');

const payload = (extra = {}) => ({
  agentVersion: '2.0.0',
  deviceId: '6f1c2a3b-1111-2222-3333-444455556666',
  hostname: 'LOJA-CAST-PDV01',
  loggedUser: 'SHINERAY\\joao.silva',
  serialNumber: 'Default string',
  os: { name: 'Microsoft Windows 11 Pro', build: '22631' },
  hardware: { manufacturer: 'To Be Filled By O.E.M.', model: 'To Be Filled By O.E.M.', processor: 'Intel Core i5', ramGb: 16, pc_system_type: 1 },
  network: [{ name: 'Ethernet', mac: 'AA:BB:CC:00:00:01', ip: '10.20.1.15', gateway: '10.20.1.1' }],
  security: { antivirus: [{ name: 'Defender', enabled: true, upToDate: true }], firewall: 'Domain' },
  software: [{ name: 'Microsoft Office Professional 2019' }],
  ...extra,
});

const context = (assets = []) => ({
  existingAssets: assets,
  existingLicenses: [{ id: 'lic-office', softwareName: 'Microsoft Office', totalSeats: 10, assignedAssets: [] }],
  locations: [{ name: 'Loja Castanhal', networks: '10.20.1.0/24' }],
  employees: [{ id: 'emp-1', name: 'João da Silva', email: 'joao.silva@shineray.com.br' }],
  settings: {},
  policy: { blockedSoftware: [], requiredSoftware: [], staleDays: 15, diskFreeMinPct: 10, maxUptimeDays: 30, updateMaxDays: 45 },
  namingConfig: { companyPrefix: 'SHL', locationCode: 'BEL', padLength: 3 },
});

const historyWrites = () => batch.set.mock.calls.filter(([ref]) => ref.path.startsWith('history/'));

beforeEach(() => {
  vi.clearAllMocks();
  store.inventory = null;
  store.inbox = {};
});

describe('registerAgentAsset', () => {
  it('cadastra maquina nova com local pela rede, responsavel pelo login e licenca pelo software', async () => {
    const ctx = context([{ id: 'x', type: 'Computador', internalId: 'SHL-BEL-CPU-007' }]);
    const result = await registerAgentAsset(payload(), { tenantId: 'acme', user: 'ti@acme.com', context: ctx });

    expect(result).toMatchObject({ action: 'created', internalId: 'SHL-BEL-CPU-008' });
    const [, asset] = batch.set.mock.calls.find(([ref]) => ref.path.startsWith('assets/'));
    expect(asset).toMatchObject({
      tenantId: 'acme', location: 'Loja Castanhal', assignedTo: 'João da Silva', employeeId: 'emp-1', serialNumber: '', model: 'LOJA-CAST-PDV01',
    });
    expect(asset.agent).toMatchObject({ deviceId: '6f1c2a3b-1111-2222-3333-444455556666', softwareCount: 1 });
    expect(asset.specs.software).toBeUndefined();
    expect(batch.set.mock.calls.some(([ref, data]) => ref.path.startsWith('assetInventory/') && data.inventory.software.length === 1)).toBe(true);
    expect(historyWrites()).toHaveLength(1);
    expect(assignLicense).toHaveBeenCalledWith('lic-office', 'novo-id', 'LOJA-CAST-PDV01', 'agent');
    // o lote seguinte enxerga o ativo recem-criado
    expect(ctx.existingAssets.some((a) => a.id === 'novo-id')).toBe(true);
  });

  it('maquina batizada com o patrimonio herda o codigo do hostname', async () => {
    const result = await registerAgentAsset(payload({ hostname: 'shl-bel-ntb-045', hardware: { pc_system_type: 2 } }), { tenantId: 'acme', context: context() });
    expect(result).toMatchObject({ action: 'created', internalId: 'SHL-BEL-NTB-045' });
  });

  it('sincronizacao sem mudanca NAO polui a timeline', async () => {
    store.inventory = normalizeInventory(payload());
    const existing = { id: 'a1', internalId: 'SHL-BEL-CPU-001', location: 'Loja Castanhal', assignedTo: 'João da Silva', agent: { deviceId: '6f1c2a3b-1111-2222-3333-444455556666', mac: 'AA:BB:CC:00:00:01' }, specs: { software: ['velho'], ip: '1.1.1.1' } };
    const result = await registerAgentAsset(payload(), { tenantId: 'acme', context: context([existing]) });

    expect(result).toMatchObject({ action: 'updated', assetId: 'a1', matchField: 'deviceId', changes: 0 });
    const [, patch] = batch.update.mock.calls[0];
    expect(patch.specs.software).toBeUndefined();
    expect(patch.specs.ip).toBe('10.20.1.15');
    expect(patch.location).toBeUndefined();
    expect(historyWrites()).toHaveLength(0);
  });

  it('troca de memoria vira registro na timeline', async () => {
    store.inventory = normalizeInventory(payload());
    const existing = { id: 'a1', internalId: 'SHL-BEL-CPU-001', agent: { deviceId: '6f1c2a3b-1111-2222-3333-444455556666', mac: 'AA:BB:CC:00:00:01' } };
    const result = await registerAgentAsset(payload({ hardware: { processor: 'Intel Core i5', ramGb: 8 } }), { tenantId: 'acme', context: context([existing]) });

    expect(result.changes).toBe(1);
    const [[, entry]] = historyWrites();
    expect(entry).toMatchObject({ action: 'Mudanças Detectadas pelo Agente', type: 'agent-sync' });
    expect(entry.details).toContain('Memória RAM: 16 GB → 8 GB');
  });
});

describe('processAgentInbox', () => {
  it('reserva cada envio, processa e apaga o token do documento', async () => {
    store.inbox.e1 = { tenantId: 'acme', status: 'pending', agentToken: 'segredo', createdAt: 1, payload: payload() };
    const { getDocs } = await import('firebase/firestore');
    getDocs.mockImplementation(async () => ({ docs: [] }));
    const summary = await processAgentInbox({ tenantId: 'acme', user: 'ti@acme.com', ids: ['e1'] });

    expect(summary).toMatchObject({ processed: 1, created: 1 });
    expect(store.inbox.e1).toMatchObject({ status: 'processed', agentToken: '__delete__', claimedBy: 'ti@acme.com' });
  });

  it('pula envio ja reservado por outro administrador', async () => {
    store.inbox.e2 = { tenantId: 'acme', status: 'processing', claimedAt: Date.now(), payload: payload() };
    const summary = await processAgentInbox({ tenantId: 'acme', user: 'ti@acme.com', ids: ['e2'] });
    expect(summary).toMatchObject({ processed: 0, skipped: 1 });
  });

  it('limite do plano interrompe o lote sem perder o envio', async () => {
    store.inbox.e3 = { tenantId: 'acme', status: 'pending', createdAt: 1, payload: payload() };
    const summary = await processAgentInbox({
      tenantId: 'acme', user: 'ti', ids: ['e3'], canCreate: async () => { throw new Error('Limite do plano atingido.'); },
    });
    expect(summary.errors).toHaveLength(1);
    expect(store.inbox.e3.status).toBe('error');
  });
});

describe('compatibilidade', () => {
  it('matchLicensesForSoftware continua respondendo pelo nome', () => {
    const licenses = [{ id: 'l1', softwareName: 'Microsoft Office', totalSeats: 2, assignedAssets: [] }];
    expect(matchLicensesForSoftware(licenses, ['Microsoft Office Professional 2021'], 'a1').map((l) => l.id)).toEqual(['l1']);
  });

  it('enfileira envio manual com o tenant', async () => {
    await enqueueAgentSubmission(payload(), 'manual', 'acme');
    const { addDoc } = await import('firebase/firestore');
    expect(addDoc.mock.calls[0][1]).toMatchObject({ tenantId: 'acme', status: 'pending', hostname: 'LOJA-CAST-PDV01' });
  });
});
