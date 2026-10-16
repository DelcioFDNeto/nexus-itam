// src/services/licenseService.js
import { db } from './firebase';
import { 
  collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, orderBy, serverTimestamp, where, runTransaction 
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

export const assignLicense = async (licenseId, assetId, assetName) => {
  const licenseRef = doc(db, 'licenses', licenseId);
  return await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(licenseRef);
    if (!snap.exists()) throw new Error("Licença não encontrada.");
    const data = snap.data();
    const current = Array.isArray(data.assignedAssets) ? data.assignedAssets : [];
    const filtered = current.filter(a => a?.id !== assetId);
    const updated = [...filtered, { id: assetId, name: assetName }];
    transaction.update(licenseRef, {
      assignedAssets: updated,
      usedCount: updated.length,
      updatedAt: serverTimestamp()
    });
  });
};

export const unassignLicense = async (licenseId, assetIdOrObject) => {
  const targetId = typeof assetIdOrObject === 'string' ? assetIdOrObject : assetIdOrObject?.id;
  const licenseRef = doc(db, 'licenses', licenseId);
  return await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(licenseRef);
    if (!snap.exists()) throw new Error("Licença não encontrada.");
    const data = snap.data();
    const current = Array.isArray(data.assignedAssets) ? data.assignedAssets : [];
    const updated = current.filter(a => a?.id !== targetId);
    transaction.update(licenseRef, {
      assignedAssets: updated,
      usedCount: updated.length,
      updatedAt: serverTimestamp()
    });
  });
};

export const releaseAssetFromLicenses = async (tenantId, assetId) => {
  if (!tenantId || !assetId) return 0;
  const q = query(licenseCollection, where('tenantId', '==', tenantId));
  const snapshot = await getDocs(q);
  let updatedCount = 0;
  const docs = snapshot?.docs || [];
  for (const docSnap of docs) {
    const data = docSnap.data();
    const current = Array.isArray(data.assignedAssets) ? data.assignedAssets : [];
    if (current.some(a => a?.id === assetId)) {
      const updated = current.filter(a => a?.id !== assetId);
      await updateDoc(docSnap.ref, {
        assignedAssets: updated,
        usedCount: updated.length,
        updatedAt: serverTimestamp()
      });
      updatedCount++;
    }
  }
  return updatedCount;
};