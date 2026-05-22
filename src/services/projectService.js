import { db } from './firebase';
import { collection, addDoc, updateDoc, deleteDoc, doc, getDocs, query, orderBy, where, collectionGroup } from 'firebase/firestore';

const projectCollection = collection(db, 'projects');

export const createProject = async (data) => {
  if (!data.tenantId) {
    throw new Error("Não é possível criar um projeto sem especificar o inquilino (tenantId).");
  }
  return await addDoc(projectCollection, {
    ...data,
    createdAt: new Date(),
    progress: 0 // Começa com 0%
  });
};

export const getProjects = async (tenantId) => {
  if (!tenantId) return [];
  const q = query(
    projectCollection, 
    where('tenantId', '==', tenantId),
    orderBy('createdAt', 'desc')
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

export const getGlobalProjects = async () => {
  const q = query(collectionGroup(db, 'projects'), orderBy('createdAt', 'desc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

export const updateProject = async (id, data) => {
  const docRef = doc(db, 'projects', id);
  await updateDoc(docRef, data);
};

export const deleteProject = async (id) => {
  const docRef = doc(db, 'projects', id);
  await deleteDoc(docRef);
};