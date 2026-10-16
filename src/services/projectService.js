// src/services/projectService.js
import { db } from './firebase';
import { 
  collection, addDoc, updateDoc, deleteDoc, doc, getDoc, getDocs, 
  query, orderBy, where, collectionGroup, serverTimestamp, arrayUnion, writeBatch 
} from 'firebase/firestore';

const projectCollection = collection(db, 'projects');

export const createProject = async (data) => {
  if (!data.tenantId) {
    throw new Error("Não é possível criar um projeto sem especificar o inquilino (tenantId).");
  }
  return await addDoc(projectCollection, {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    progress: data.progress ?? 0
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

export const getProject = async (id) => {
  if (!id) return null;
  const docRef = doc(db, 'projects', id);
  const snap = await getDoc(docRef);
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
};

export const getGlobalProjects = async () => {
  const q = query(collectionGroup(db, 'projects'), orderBy('createdAt', 'desc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

export const updateProject = async (id, data) => {
  const docRef = doc(db, 'projects', id);
  await updateDoc(docRef, {
    ...data,
    updatedAt: serverTimestamp()
  });
};

export const addProjectLog = async (id, logEntry) => {
  const docRef = doc(db, 'projects', id);
  await updateDoc(docRef, {
    changelog: arrayUnion(logEntry),
    updatedAt: serverTimestamp()
  });
};

export const setProjectLogs = async (id, changelog) => {
  const docRef = doc(db, 'projects', id);
  await updateDoc(docRef, {
    changelog,
    updatedAt: serverTimestamp()
  });
};

export const deleteProject = async (id, tenantId) => {
  const docRef = doc(db, 'projects', id);
  await deleteDoc(docRef);

  // Desvincular tarefas atreladas a este projeto
  try {
    const taskConstraints = [where('projectId', '==', id)];
    if (tenantId) {
      taskConstraints.unshift(where('tenantId', '==', tenantId));
    }
    const q = query(collection(db, 'tasks'), ...taskConstraints);
    const snap = await getDocs(q);
    if (!snap.empty) {
      const batch = writeBatch(db);
      snap.docs.forEach(d => {
        batch.update(d.ref, { projectId: null, projectName: null, updatedAt: serverTimestamp() });
      });
      await batch.commit();
    }
  } catch (err) {
    console.warn('Erro ao desvincular tarefas do projeto excluído:', err);
  }
};