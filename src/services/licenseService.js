// src/services/licenseService.js
import { db } from './firebase';
import { 
  collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, orderBy, serverTimestamp, arrayUnion, arrayRemove, where 
} from 'firebase/firestore';

const licenseCollection = collection(db, 'licenses');

// Listar todas as licenças (ordem alfabética)
export const getLicenses = async (tenantId) => {
  if (!tenantId) return [];
  const q = query(
    licenseCollection, 
    where('tenantId', '==', tenantId),
    orderBy('softwareName', 'asc')
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

// Criar nova licença
export const createLicense = async (data) => {
  if (!data.tenantId) {
    throw new Error("Não é possível criar uma licença sem especificar o inquilino (tenantId).");
  }
  return await addDoc(licenseCollection, {
    ...data,
    usedCount: 0, // Começa com 0 ativações
    assignedAssets: [], // Lista de quem está usando
    createdAt: serverTimestamp()
  });
};

// Atualizar dados da licença
export const updateLicense = async (id, data) => {
  const docRef = doc(db, 'licenses', id);
  await updateDoc(docRef, { ...data, updatedAt: serverTimestamp() });
};

// Excluir licença
export const deleteLicense = async (id) => {
  const docRef = doc(db, 'licenses', id);
  await deleteDoc(docRef);
};

// VINCULAR: Adiciona o ativo na lista da licença
export const assignLicense = async (licenseId, assetId, assetName) => {
  const licenseRef = doc(db, 'licenses', licenseId);
  
  await updateDoc(licenseRef, {
    assignedAssets: arrayUnion({ id: assetId, name: assetName }),
    updatedAt: serverTimestamp()
  });
};

// DESVINCULAR: Libera a vaga da licença
export const unassignLicense = async (licenseId, assetObjectToRemove) => {
  const licenseRef = doc(db, 'licenses', licenseId);
  
  await updateDoc(licenseRef, {
    assignedAssets: arrayRemove(assetObjectToRemove),
    updatedAt: serverTimestamp()
  });
};