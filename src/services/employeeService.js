// src/services/employeeService.js
import { db } from './firebase';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, where, collectionGroup, serverTimestamp } from 'firebase/firestore';

const empCollection = collection(db, 'employees');
const secCollection = collection(db, 'sectors');

const sortByName = (list) =>
  [...list].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR', { sensitivity: 'base' }));

// --- COLABORADORES ---
export const getEmployees = async (tenantId) => {
  if (!tenantId) return [];
  const q = query(
    empCollection, 
    where('tenantId', '==', tenantId)
  );
  const snapshot = await getDocs(q);
  const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  return sortByName(list);
};

export const getGlobalEmployees = async () => {
  const q = query(collectionGroup(db, 'employees'));
  const snapshot = await getDocs(q);
  const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  return sortByName(list);
};

export const addEmployee = async (employee) => {
  if (!employee.tenantId) {
    throw new Error("Não é possível cadastrar um colaborador sem especificar o inquilino (tenantId).");
  }
  return await addDoc(empCollection, {
    ...employee,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
};

export const updateEmployee = async (id, updatedData) => {
  const docRef = doc(db, 'employees', id);
  await updateDoc(docRef, {
    ...updatedData,
    updatedAt: serverTimestamp()
  });
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
    where('tenantId', '==', tenantId)
  );
  const snapshot = await getDocs(q);
  const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  return sortByName(list);
};

export const getGlobalSectors = async () => {
  const q = query(collectionGroup(db, 'sectors'));
  const snapshot = await getDocs(q);
  const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  return sortByName(list);
};

export const addSector = async (sector) => {
  if (!sector.tenantId) {
    throw new Error("Não é possível cadastrar um setor sem especificar o inquilino (tenantId).");
  }
  return await addDoc(secCollection, {
    ...sector,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
};

export const updateSector = async (id, updatedData) => {
  const docRef = doc(db, 'sectors', id);
  await updateDoc(docRef, {
    ...updatedData,
    updatedAt: serverTimestamp()
  });
};

export const deleteSector = async (id) => {
  const docRef = doc(db, 'sectors', id);
  await deleteDoc(docRef);
};