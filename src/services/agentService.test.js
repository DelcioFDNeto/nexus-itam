import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerAgentAsset, enqueueAgentSubmission, matchLicensesForSoftware } from './agentService';
import { getDocs, addDoc } from 'firebase/firestore';

const mockBatch = {
  set: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  commit: vi.fn().mockResolvedValue()
};

vi.mock('firebase/firestore', () => {
  return {
    collection: vi.fn(),
    doc: vi.fn((_col, id) => ({ id: id || 'mock-doc-id' })),
    addDoc: vi.fn().mockResolvedValue({ id: 'mock-doc-id' }),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    getDocs: vi.fn(),
    getDoc: vi.fn().mockResolvedValue({ exists: () => true, data: () => ({ tenantId: 'tenant1' }) }),
    query: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    serverTimestamp: vi.fn(),
    collectionGroup: vi.fn(),
    writeBatch: vi.fn(() => mockBatch),
    getFirestore: vi.fn()
  };
});

vi.mock('./firebase', () => ({
  db: {}
}));

describe('agentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enqueues agent submission successfully', async () => {
    addDoc.mockResolvedValueOnce({ id: 'inbox1' });
    const payload = { hardware: { manufacturer: 'Dell' } };
    
    await enqueueAgentSubmission(payload, 'tenant1', '1.0');
    
    expect(addDoc).toHaveBeenCalled();
  });

  it('registers agent asset successfully and handles SAM', async () => {
    getDocs.mockResolvedValue({ empty: true, docs: [] });
    addDoc.mockResolvedValue({ id: 'asset1' }); // Create asset
    
    const payload = {
      internalId: 'Dell-001',
      hardware: { manufacturer: 'Dell', model: 'Latitude' },
      software: 'Office 365||Google Chrome',
      security: { antivirus: true }
    };
    const options = { tenantId: 'tenant1', user: 'agent', namingConfig: {} };
    
    const result = await registerAgentAsset(payload, options);
    
    expect(result.action).toBe('created');
    expect(mockBatch.commit).toHaveBeenCalled();
  });

  it('updates existing asset if duplicate is found', async () => {
    getDocs
      .mockResolvedValueOnce({
        empty: false,
        docs: [{ id: 'existing1', data: () => ({ name: 'Dell-001', customData: {} }) }]
      })
      .mockResolvedValue({ empty: true, docs: [] });
    
    const payload = { internalId: 'Dell-001', hardware: { manufacturer: 'Dell' } };
    const options = { tenantId: 'tenant1', user: 'agent', namingConfig: {} };
    
    const result = await registerAgentAsset(payload, options);
    
    expect(result.action).toBe('updated');
    expect(mockBatch.commit).toHaveBeenCalled();
  });
});

describe('matchLicensesForSoftware (SAM)', () => {
  const licenses = [
    { id: 'l1', softwareName: 'Microsoft Office', totalSeats: 2, assignedAssets: [] },
    { id: 'l2', softwareName: 'AutoCAD', totalSeats: 1, assignedAssets: [{ id: 'outro', name: 'PC' }] },
    { id: 'l3', softwareName: 'Adobe Reader', totalSeats: 5, assignedAssets: [{ id: 'asset-1', name: 'NB' }] },
  ];

  it('usa os campos reais da licenca (softwareName/totalSeats)', () => {
    // Regressao: lia license.name (inexistente) e a deducao sempre falhava.
    const found = matchLicensesForSoftware(licenses, ['Microsoft Office Professional 2021', 'Google Chrome'], 'asset-1');
    expect(found.map((l) => l.id)).toEqual(['l1']);
  });

  it('respeita o numero de ativacoes', () => {
    expect(matchLicensesForSoftware(licenses, ['Autodesk AutoCAD 2024'], 'asset-1')).toEqual([]);
  });

  it('nao consome duas vezes para o mesmo equipamento', () => {
    expect(matchLicensesForSoftware(licenses, ['Adobe Reader DC'], 'asset-1')).toEqual([]);
  });

  it('ignora lista vazia', () => {
    expect(matchLicensesForSoftware(licenses, [], 'asset-1')).toEqual([]);
  });
});
