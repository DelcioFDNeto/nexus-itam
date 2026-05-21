// src/services/employeeService.js
import { db } from './firebase';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, orderBy, where } from 'firebase/firestore';

const empCollection = collection(db, 'employees');
const secCollection = collection(db, 'sectors');

// --- COLABORADORES ---
export const getEmployees = async (tenantId) => {
  if (!tenantId) return [];
  const q = query(
    empCollection, 
    where('tenantId', '==', tenantId),
    orderBy('name', 'asc')
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

export const addEmployee = async (employee) => {
  if (!employee.tenantId) {
    throw new Error("Não é possível cadastrar um colaborador sem especificar o inquilino (tenantId).");
  }
  await addDoc(empCollection, employee);
};

export const updateEmployee = async (id, updatedData) => {
  const docRef = doc(db, 'employees', id);
  await updateDoc(docRef, updatedData);
};

export const deleteEmployee = async (id) => {
  const docRef = doc(db, 'employees', id);
  await deleteDoc(docRef);
};

// --- SETORES ---
export const getSectors = async (tenantId) => {
  if (!tenantId) return [];
  const q = query(
    secCollection, 
    where('tenantId', '==', tenantId),
    orderBy('name', 'asc')
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

export const addSector = async (sector) => {
  if (!sector.tenantId) {
    throw new Error("Não é possível cadastrar um setor sem especificar o inquilino (tenantId).");
  }
  await addDoc(secCollection, sector);
};

export const updateSector = async (id, updatedData) => {
  const docRef = doc(db, 'sectors', id);
  await updateDoc(docRef, updatedData);
};

export const deleteSector = async (id) => {
  const docRef = doc(db, 'sectors', id);
  await deleteDoc(docRef);
};