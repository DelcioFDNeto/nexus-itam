// src/services/contractService.js
import { db } from './firebase';
import { 
  collection, getDocs, addDoc, deleteDoc, updateDoc, doc, query, orderBy, serverTimestamp, where 
} from 'firebase/firestore';

const collectionRef = collection(db, 'contracts');

export const getContracts = async (tenantId) => {
  if (!tenantId) return [];
  const q = query(
    collectionRef, 
    where('tenantId', '==', tenantId),
    orderBy('provider', 'asc')
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

export const createContract = async (data) => {
  if (!data.tenantId) {
    throw new Error("Não é possível criar um contrato sem especificar o inquilino (tenantId).");
  }
  return await addDoc(collectionRef, {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
};

export const updateContract = async (id, data) => {
  const docRef = doc(db, 'contracts', id);
  await updateDoc(docRef, {
    ...data,
    updatedAt: serverTimestamp()
  });
};

export const deleteContract = async (id) => {
  const docRef = doc(db, 'contracts', id);
  await deleteDoc(docRef);
};