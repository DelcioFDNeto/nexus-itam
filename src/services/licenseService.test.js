import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getLicenses, assignLicense } from './licenseService';
import { getDocs, updateDoc } from 'firebase/firestore';

vi.mock('firebase/firestore', () => {
  return {
    collection: vi.fn(),
    doc: vi.fn(),
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
    arrayRemove: vi.fn((val) => val)
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

  it('assigns a license successfully', async () => {
    updateDoc.mockResolvedValueOnce();

    await assignLicense('1', 'emp1', 'John Doe');
    
    expect(updateDoc).toHaveBeenCalled();
  });
});
