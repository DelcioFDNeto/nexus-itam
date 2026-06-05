import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEmployees, addEmployee, updateEmployee, deleteEmployee } from './employeeService';
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

describe('employeeService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches employees successfully', async () => {
    const mockData = {
      docs: [
        { id: '1', data: () => ({ name: 'John Doe', tenantId: 'tenant1' }) },
        { id: '2', data: () => ({ name: 'Jane Doe', tenantId: 'tenant1' }) }
      ]
    };
    getDocs.mockResolvedValueOnce(mockData);

    const employees = await getEmployees('tenant1');
    
    expect(getDocs).toHaveBeenCalled();
    expect(employees.length).toBe(2);
    expect(employees[0].name).toBe('John Doe');
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
