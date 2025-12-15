// src/services/taskService.js
import { db } from './firebase';
import { collection, addDoc, updateDoc, deleteDoc, doc, getDocs, query, orderBy } from 'firebase/firestore';

const taskCollection = collection(db, 'tasks');

export const getTasks = async () => {
  const q = query(taskCollection, orderBy('createdAt', 'desc')); // Ordena por mais recente
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

// Agora aceita projectId dentro do objeto task
export const addTask = async (task) => {
  await addDoc(taskCollection, {
    ...task,
    createdAt: new Date()
  });
};

export const updateTask = async (id, updatedFields) => {
  const taskDoc = doc(db, 'tasks', id);
  await updateDoc(taskDoc, updatedFields);
};

export const deleteTask = async (id) => {
  const taskDoc = doc(db, 'tasks', id);
  await deleteDoc(taskDoc);
};