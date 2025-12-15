import { db } from './firebase';
import { collection, addDoc, updateDoc, deleteDoc, doc, getDocs, query, orderBy, where } from 'firebase/firestore';

const projectCollection = collection(db, 'projects');

export const createProject = async (data) => {
  return await addDoc(projectCollection, {
    ...data,
    createdAt: new Date(),
    progress: 0 // Começa com 0%
  });
};

export const getProjects = async () => {
  const q = query(projectCollection, orderBy('createdAt', 'desc'));
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