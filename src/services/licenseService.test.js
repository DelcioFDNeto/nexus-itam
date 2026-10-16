import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getLicenses, assignLicense, unassignLicense, releaseAssetFromLicenses } from './licenseService';
import { getDocs, updateDoc, runTransaction } from 'firebase/firestore';

vi.mock('firebase/firestore', () => {
  return {
    collection: vi.fn(),
    doc: vi.fn((_col, id) => ({ id: id || '1' })),
    addDoc: vi.fn(),
    updateDoc: vi.fn(),
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    serverTimestamp: vi.fn(),
    getFirestore: vi.fn(),
    increment: vi.fn((val) => val),
    arrayUnion: vi.fn((val) => val),
    arrayRemove: vi.fn((val) => val),
    runTransaction: vi.fn()
  };
});

vi.mock('./firebase', () => {
  return {
    db: {}
  };
});

describe('licenseService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches licenses successfully', async () => {
    const mockData = {
      docs: [
        { id: '1', data: () => ({ name: 'Office 365', tenantId: 'tenant1' }) },
      ]
    };
    getDocs.mockResolvedValueOnce(mockData);

    const licenses = await getLicenses('tenant1');
    
    expect(getDocs).toHaveBeenCalled();
    expect(licenses.length).toBe(1);
    expect(licenses[0].name).toBe('Office 365');
  });

  it('assigns a license via transaction and updates usedCount', async () => {
    const mockTransaction = {
      get: vi.fn().mockResolvedValue({
        exists: () => true,
        data: () => ({ assignedAssets: [] })
      }),
      update: vi.fn()
    };
    runTransaction.mockImplementation(async (_db, fn) => fn(mockTransaction));

    await assignLicense('1', 'asset1', 'Dell Latitude (NTB-001)');
    
    expect(mockTransaction.get).toHaveBeenCalled();
    expect(mockTransaction.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        assignedAssets: [{ id: 'asset1', name: 'Dell Latitude (NTB-001)' }],
        usedCount: 1
      })
    );
  });

  it('unassigns a license via transaction and updates usedCount', async () => {
    const mockTransaction = {
      get: vi.fn().mockResolvedValue({
        exists: () => true,
        data: () => ({ assignedAssets: [{ id: 'asset1', name: 'Dell Latitude' }] })
      }),
      update: vi.fn()
    };
    runTransaction.mockImplementation(async (_db, fn) => fn(mockTransaction));

    await unassignLicense('1', 'asset1');
    
    expect(mockTransaction.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        assignedAssets: [],
        usedCount: 0
      })
    );
  });

  it('releases an asset from all tenant licenses', async () => {
    const mockDocs = [
      {
        id: 'lic1',
        ref: { id: 'lic1' },
        data: () => ({
          assignedAssets: [{ id: 'asset1', name: 'Notebook' }, { id: 'asset2', name: 'Desktop' }]
        })
      },
      {
        id: 'lic2',
        ref: { id: 'lic2' },
        data: () => ({
          assignedAssets: [{ id: 'asset3', name: 'Monitor' }]
        })
      }
    ];
    getDocs.mockResolvedValueOnce({ docs: mockDocs });
    updateDoc.mockResolvedValue();

    const released = await releaseAssetFromLicenses('tenant1', 'asset1');

    expect(released).toBe(1);
    expect(updateDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        assignedAssets: [{ id: 'asset2', name: 'Desktop' }],
        usedCount: 1
      })
    );
  });
});
