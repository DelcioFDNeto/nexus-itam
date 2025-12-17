// src/services/assetService.js
import { db } from './firebase';
import { 
  collection, 
  getDocs, 
  getDoc, 
  doc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  orderBy, 
  where,
  serverTimestamp 
} from 'firebase/firestore';

const assetsCollection = collection(db, 'assets');
const historyCollection = collection(db, 'history'); // Coleção Global de Histórico

// --- LEITURA (READ) ---

export const getAllAssets = async () => {
  const q = query(assetsCollection, orderBy('createdAt', 'desc')); 
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

export const getAssetById = async (id) => {
  const docRef = doc(db, 'assets', id);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) return { id: docSnap.id, ...docSnap.data() };
  throw new Error("Ativo não encontrado");
};

// Busca histórico na coleção global filtrando pelo ID do ativo
export const getAssetHistory = async (assetId) => {
  const q = query(
    historyCollection, 
    where('assetId', '==', assetId), 
    orderBy('date', 'desc')
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

// --- ESCRITA (CREATE / UPDATE / DELETE) ---

// Cria um novo ativo e registra na timeline
export const createAsset = async (assetData) => {
  const docRef = await addDoc(assetsCollection, {
    ...assetData,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  // Log de Criação
  await addDoc(historyCollection, {
    assetId: docRef.id,
    type: 'creation',
    action: 'Ativo Criado',
    date: serverTimestamp(),
    user: 'Sistema',
    details: 'Cadastro inicial no sistema.'
  });

  return docRef;
};

// Atualiza dados e registra na timeline que houve edição
export const updateAsset = async (id, assetData) => {
  const docRef = doc(db, 'assets', id);
  
  await updateDoc(docRef, {
    ...assetData,
    updatedAt: serverTimestamp()
  });

  // Log de Edição (Se não for uma atualização automática de sistema)
  // Filtramos para não poluir a timeline se for apenas update interno
  await addDoc(historyCollection, {
    assetId: id,
    type: 'update',
    action: 'Dados Editados',
    date: serverTimestamp(),
    user: 'Admin TI',
    details: 'Informações ou especificações atualizadas.'
  });
};

export const deleteAsset = async (id) => {
  const assetRef = doc(db, 'assets', id);
  await deleteDoc(assetRef);
  // Opcional: Apagar histórico associado (geralmente mantemos para auditoria)
  return true;
};

// --- AÇÕES ESPECÍFICAS (TIMELINE RICA) ---

// Realiza a movimentação
export const moveAsset = async (assetId, currentData, moveData) => {
  const assetRef = doc(db, 'assets', assetId);

  // 1. Atualiza o Ativo
  const updateData = {
    assignedTo: moveData.newResponsible || '', // Garante string vazia se undefined
    location: moveData.newLocation,
    status: 'Em Uso', // Assume 'Em Uso' ao transferir, ou mantenha o status anterior se preferir
    updatedAt: serverTimestamp()
  };

  await updateDoc(assetRef, updateData);

  // 2. Grava na Timeline Global
  const historyLog = {
    assetId: assetId,
    type: 'movimentacao',
    action: 'Transferência',
    date: serverTimestamp(),
    
    // Dados para exibição no card
    previousLocation: currentData.location || 'N/A',
    newLocation: moveData.newLocation,
    previousHolder: currentData.assignedTo || 'N/A',
    newHolder: moveData.newResponsible || 'Sem responsável',
    
    reason: moveData.reason || 'Movimentação de rotina',
    user: 'Admin TI' 
  };

  await addDoc(historyCollection, historyLog);
  return true;
};

// Registra manutenção
export const registerMaintenance = async (assetId, maintenanceData) => {
  const assetRef = doc(db, 'assets', assetId);

  // 1. Atualiza status do ativo
  await updateDoc(assetRef, {
    status: 'Manutenção',
    updatedAt: serverTimestamp()
  });

  // 2. Grava na Timeline Global
  const historyLog = {
    assetId: assetId,
    type: 'manutencao',
    action: 'Manutenção Iniciada',
    date: serverTimestamp(),
    
    cost: maintenanceData.cost || '0,00',
    provider: maintenanceData.provider || 'Interno',
    defect: maintenanceData.defect || 'Não informado',
    description: maintenanceData.description || '',
    
    user: 'Admin TI'
  };

  await addDoc(historyCollection, historyLog);
  return true;
};