// src/services/employeeService.js
import { db } from './firebase';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, orderBy } from 'firebase/firestore';

const empCollection = collection(db, 'employees');
const secCollection = collection(db, 'sectors');

// --- COLABORADORES ---
export const getEmployees = async () => {
  const q = query(empCollection, orderBy('name', 'asc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

export const addEmployee = async (employee) => {
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
export const getSectors = async () => {
  const q = query(secCollection, orderBy('name', 'asc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

export const addSector = async (sector) => {
  await addDoc(secCollection, sector);
};

// ADICIONE ESTA FUNÇÃO SE NÃO TIVER
export const updateSector = async (id, updatedData) => {
  const docRef = doc(db, 'sectors', id);
  await updateDoc(docRef, updatedData);
};

export const deleteSector = async (id) => {
  const docRef = doc(db, 'sectors', id);
  await deleteDoc(docRef);
};