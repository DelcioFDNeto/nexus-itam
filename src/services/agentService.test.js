import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerAgentAsset, enqueueAgentSubmission } from './agentService';
import { getDocs, addDoc, updateDoc } from 'firebase/firestore';

vi.mock('firebase/firestore', () => {
  return {
    collection: vi.fn(),
    doc: vi.fn(),
    addDoc: vi.fn().mockResolvedValue({ id: 'mock-doc-id' }),
    updateDoc: vi.fn(),
    getDocs: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    serverTimestamp: vi.fn(),
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
    expect(addDoc).toHaveBeenCalled();
  });

  it('updates existing asset if duplicate is found', async () => {
    getDocs
      .mockResolvedValueOnce({
        empty: false,
        docs: [{ id: 'existing1', data: () => ({ name: 'Dell-001', customData: {} }) }]
      })
      .mockResolvedValue({ empty: true, docs: [] });
    updateDoc.mockResolvedValueOnce(); // Update asset
    addDoc.mockResolvedValue({ id: 'history1' }); // Create history
    
    const payload = { internalId: 'Dell-001', hardware: { manufacturer: 'Dell' } };
    const options = { tenantId: 'tenant1', user: 'agent', namingConfig: {} };
    
    const result = await registerAgentAsset(payload, options);
    
    expect(result.action).toBe('updated');
    expect(updateDoc).toHaveBeenCalled();
  });
});
