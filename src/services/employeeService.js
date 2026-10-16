// src/services/employeeService.js
import { db } from './firebase';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, where, collectionGroup, serverTimestamp, writeBatch } from 'firebase/firestore';

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

export const updateEmployee = async (id, updatedData, oldName = null, tenantId = null) => {
  const docRef = doc(db, 'employees', id);
  await updateDoc(docRef, {
    ...updatedData,
    updatedAt: serverTimestamp()
  });

  let updatedAssetsCount = 0;
  const newName = updatedData?.name?.trim();
  if (oldName && newName && oldName.trim() !== newName && tenantId) {
    const assetsQuery = query(
      collection(db, 'assets'),
      where('tenantId', '==', tenantId),
      where('assignedTo', '==', oldName.trim())
    );
    const snap = await getDocs(assetsQuery);
    if (!snap.empty) {
      const CHUNK = 400;
      for (let i = 0; i < snap.docs.length; i += CHUNK) {
        const batch = writeBatch(db);
        snap.docs.slice(i, i + CHUNK).forEach((d) => {
          batch.update(d.ref, {
            assignedTo: newName,
            updatedAt: serverTimestamp()
          });
        });
        await batch.commit();
      }
      updatedAssetsCount = snap.docs.length;
    }
  }

  return { updatedAssetsCount };
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

export const updateSector = async (id, updatedData, oldName = null, tenantId = null) => {
  const docRef = doc(db, 'sectors', id);
  await updateDoc(docRef, {
    ...updatedData,
    updatedAt: serverTimestamp()
  });

  let updatedEmployeesCount = 0;
  let updatedAssetsCount = 0;
  const newName = updatedData?.name?.trim();
  if (oldName && newName && oldName.trim() !== newName && tenantId) {
    // Atualiza employees vinculados ao setor antigo
    const empQ = query(
      collection(db, 'employees'),
      where('tenantId', '==', tenantId),
      where('sector', '==', oldName.trim())
    );
    const empSnap = await getDocs(empQ);
    if (!empSnap.empty) {
      const CHUNK = 400;
      for (let i = 0; i < empSnap.docs.length; i += CHUNK) {
        const batch = writeBatch(db);
        empSnap.docs.slice(i, i + CHUNK).forEach((d) => {
          batch.update(d.ref, { sector: newName, updatedAt: serverTimestamp() });
        });
        await batch.commit();
      }
      updatedEmployeesCount = empSnap.docs.length;
    }

    // Atualiza assets vinculados ao setor antigo
    const assetQ = query(
      collection(db, 'assets'),
      where('tenantId', '==', tenantId),
      where('sector', '==', oldName.trim())
    );
    const assetSnap = await getDocs(assetQ);
    if (!assetSnap.empty) {
      const CHUNK = 400;
      for (let i = 0; i < assetSnap.docs.length; i += CHUNK) {
        const batch = writeBatch(db);
        assetSnap.docs.slice(i, i + CHUNK).forEach((d) => {
          batch.update(d.ref, { sector: newName, updatedAt: serverTimestamp() });
        });
        await batch.commit();
      }
      updatedAssetsCount = assetSnap.docs.length;
    }
  }

  return { updatedEmployeesCount, updatedAssetsCount };
};

export const deleteSector = async (id) => {
  const docRef = doc(db, 'sectors', id);
  await deleteDoc(docRef);
};