import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  getEmployees, addEmployee, updateEmployee, deleteEmployee,
  getSectors, addSector, updateSector, deleteSector,
  getGlobalEmployees, getGlobalSectors
} from './employeeService';
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
    collectionGroup: vi.fn(),
    serverTimestamp: vi.fn(),
    getFirestore: vi.fn()
  };
});

vi.mock('./firebase', () => {
  return {
    db: {}
  };
});

describe('employeeService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('employees', () => {
    it('returns empty array when tenantId is missing', async () => {
      const result = await getEmployees(null);
      expect(result).toEqual([]);
      expect(getDocs).not.toHaveBeenCalled();
    });

    it('fetches and sorts employees alphabetically by name', async () => {
      const mockData = {
        docs: [
          { id: '1', data: () => ({ name: 'Zenon Silva', tenantId: 'tenant1' }) },
          { id: '2', data: () => ({ name: 'Ana Pereira', tenantId: 'tenant1' }) }
        ]
      };
      getDocs.mockResolvedValueOnce(mockData);

      const employees = await getEmployees('tenant1');
      
      expect(getDocs).toHaveBeenCalled();
      expect(employees.length).toBe(2);
      expect(employees[0].name).toBe('Ana Pereira');
      expect(employees[1].name).toBe('Zenon Silva');
    });

    it('fetches global employees sorted', async () => {
      const mockData = {
        docs: [
          { id: '1', data: () => ({ name: 'Bruno', tenantId: 'tenant1' }) },
          { id: '2', data: () => ({ name: 'Alice', tenantId: 'tenant2' }) }
        ]
      };
      getDocs.mockResolvedValueOnce(mockData);

      const employees = await getGlobalEmployees();
      expect(employees[0].name).toBe('Alice');
      expect(employees[1].name).toBe('Bruno');
    });

    it('throws error when adding employee without tenantId', async () => {
      await expect(addEmployee({ name: 'Mark' })).rejects.toThrow("tenantId");
    });

    it('adds an employee successfully', async () => {
      const newEmployee = { name: 'Mark', tenantId: 'tenant1' };
      addDoc.mockResolvedValueOnce({ id: '3' });

      await addEmployee(newEmployee);
      expect(addDoc).toHaveBeenCalled();
    });

    it('updates an employee successfully', async () => {
      updateDoc.mockResolvedValueOnce();

      await updateEmployee('1', { role: 'Developer' });
      expect(updateDoc).toHaveBeenCalled();
    });

    it('deletes an employee successfully', async () => {
      deleteDoc.mockResolvedValueOnce();

      await deleteEmployee('1');
      expect(deleteDoc).toHaveBeenCalled();
    });
  });

  describe('sectors', () => {
    it('returns empty array when tenantId is missing', async () => {
      const result = await getSectors(null);
      expect(result).toEqual([]);
      expect(getDocs).not.toHaveBeenCalled();
    });

    it('fetches and sorts sectors alphabetically', async () => {
      const mockData = {
        docs: [
          { id: '1', data: () => ({ name: 'Vendas', tenantId: 'tenant1' }) },
          { id: '2', data: () => ({ name: 'Almoxarifado', tenantId: 'tenant1' }) }
        ]
      };
      getDocs.mockResolvedValueOnce(mockData);

      const sectors = await getSectors('tenant1');
      expect(sectors.length).toBe(2);
      expect(sectors[0].name).toBe('Almoxarifado');
      expect(sectors[1].name).toBe('Vendas');
    });

    it('fetches global sectors', async () => {
      const mockData = {
        docs: [
          { id: '1', data: () => ({ name: 'TI', tenantId: 'tenant1' }) }
        ]
      };
      getDocs.mockResolvedValueOnce(mockData);

      const sectors = await getGlobalSectors();
      expect(sectors.length).toBe(1);
    });

    it('throws error when adding sector without tenantId', async () => {
      await expect(addSector({ name: 'Financeiro' })).rejects.toThrow("tenantId");
    });

    it('adds a sector successfully', async () => {
      addDoc.mockResolvedValueOnce({ id: 's1' });
      await addSector({ name: 'Financeiro', tenantId: 'tenant1' });
      expect(addDoc).toHaveBeenCalled();
    });

    it('updates a sector successfully', async () => {
      updateDoc.mockResolvedValueOnce();
      await updateSector('s1', { name: 'Contabilidade' });
      expect(updateDoc).toHaveBeenCalled();
    });

    it('deletes a sector successfully', async () => {
      deleteDoc.mockResolvedValueOnce();
      await deleteSector('s1');
      expect(deleteDoc).toHaveBeenCalled();
    });
  });
});

