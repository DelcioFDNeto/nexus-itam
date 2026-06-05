import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAllAssets, createAsset, updateAsset, deleteAsset } from './assetService';
import { getDocs, addDoc, updateDoc, deleteDoc } from 'firebase/firestore';

vi.mock('firebase/firestore', () => {
  return {
    collection: vi.fn(),
    doc: vi.fn(),
    addDoc: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    getDocs: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    serverTimestamp: vi.fn(),
    getFirestore: vi.fn()
  };
});

vi.mock('./firebase', () => {
  return {
    db: {}
  };
});

describe('assetService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches assets successfully', async () => {
    const mockData = {
      docs: [
        { id: '1', data: () => ({ name: 'MacBook', tenantId: 'tenant1' }) },
        { id: '2', data: () => ({ name: 'Dell', tenantId: 'tenant1' }) }
      ]
    };
    getDocs.mockResolvedValueOnce(mockData);

    const assets = await getAllAssets('tenant1');
    
    expect(getDocs).toHaveBeenCalled();
    expect(assets.length).toBe(2);
    expect(assets[0].name).toBe('MacBook');
  });

  it('adds an asset successfully', async () => {
    const newAsset = { name: 'Iphone 13', tenantId: 'tenant1' };
    addDoc.mockResolvedValueOnce({ id: '3' });

    const docRef = await createAsset(newAsset);
    
    expect(addDoc).toHaveBeenCalled();
    expect(docRef.id).toBe('3');
  });

  it('updates an asset successfully', async () => {
    updateDoc.mockResolvedValueOnce();

    await updateAsset('1', { status: 'Ativo' });
    
    expect(updateDoc).toHaveBeenCalled();
  });

  it('deletes an asset successfully', async () => {
    deleteDoc.mockResolvedValueOnce();
    addDoc.mockResolvedValueOnce(); // for the history entry

    await deleteAsset('1', 'admin', 'tenant1', { name: 'MacBook' });
    
    expect(deleteDoc).toHaveBeenCalled();
    expect(addDoc).toHaveBeenCalled(); // checks if history was created
  });
});
