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
  limit,
  serverTimestamp,
  collectionGroup
} from 'firebase/firestore';

const assetsCollection = collection(db, 'assets');
const historyCollection = collection(db, 'history'); // Coleção Global de Histórico

// --- LEITURA (READ) ---

export const getAllAssets = async (tenantId) => {
  if (!tenantId) return [];
  const q = query(
    assetsCollection, 
    where('tenantId', '==', tenantId),
    orderBy('createdAt', 'desc')
  ); 
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

export const getGlobalAssets = async () => {
  const q = query(collectionGroup(db, 'assets'), orderBy('createdAt', 'desc'));
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
export const getAssetHistory = async (assetId, limitCount = 20) => {
  const q = query(
    historyCollection, 
    where('assetId', '==', assetId), 
    orderBy('date', 'desc'),
    limit(limitCount)
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

export const getGlobalActivity = async (limitCount = 20) => {
  const q = query(historyCollection, orderBy('date', 'desc'), limit(limitCount));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => {
      const data = doc.data();
      return { 
          id: doc.id, 
          ...data,
          jsDate: data.date?.toDate ? data.date.toDate() : new Date(data.date)
      };
  });
};

// --- DASHBOARD & REPORTS ---

export const getRecentActivity = async (tenantId, limitCount = 8) => {
  if (!tenantId) return [];
  const q = query(
    historyCollection, 
    where('tenantId', '==', tenantId),
    orderBy('date', 'desc'), 
    limit(limitCount)
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => {
      const data = doc.data();
      return { 
          id: doc.id, 
          ...data,
          // Normaliza data para evitar erros no frontend
          jsDate: data.date?.toDate ? data.date.toDate() : new Date(data.date)
      };
  });
};

// --- ESCRITA (CREATE / UPDATE / DELETE) ---

// Cria um novo ativo e registra na timeline
export const createAsset = async (assetData) => {
  if (!assetData.tenantId) {
    throw new Error("Não é possível cadastrar um ativo sem especificar o inquilino (tenantId).");
  }
  const docRef = await addDoc(assetsCollection, {
    ...assetData,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  // Log de Criação
  await addDoc(historyCollection, {
    assetId: docRef.id,
    tenantId: assetData.tenantId,
    type: 'creation',
    action: 'Ativo Criado',
    date: serverTimestamp(),
    user: assetData.createdBy || 'Sistema',
    details: 'Cadastro inicial no sistema.'
  });

  return docRef;
};

// Atualiza dados e registra na timeline com detalhes personalizados
export const updateAsset = async (id, assetData, historyOptions = null) => {
  const docRef = doc(db, 'assets', id);
  
  await updateDoc(docRef, {
    ...assetData,
    updatedAt: serverTimestamp()
  });

  // Log de Edição
  if (historyOptions) {
      await addDoc(historyCollection, {
        assetId: id,
        tenantId: assetData.tenantId || historyOptions.tenantId || 'default-tenant',
        type: historyOptions.type || 'update',
        action: historyOptions.action || 'Dados Editados',
        date: serverTimestamp(),
        user: historyOptions.user || 'Sistema',
        details: historyOptions.details || 'Atualização realizada.'
      });
  } else {
      await addDoc(historyCollection, {
        assetId: id,
        tenantId: assetData.tenantId || 'default-tenant',
        type: 'update',
        action: 'Dados Editados',
        date: serverTimestamp(),
        user: 'Sistema',
        details: 'Informações ou especificações atualizadas.'
      });
  }
};

export const deleteAsset = async (id) => {
  const assetRef = doc(db, 'assets', id);
  await deleteDoc(assetRef);
  return true;
};

// --- AÇÕES ESPECÍFICAS (TIMELINE RICA) ---

// Realiza a movimentação
export const moveAsset = async (assetId, currentData, moveData, user = 'Sistema') => {
  const assetRef = doc(db, 'assets', assetId);

  // 1. Atualiza o Ativo
  const updateData = {
    assignedTo: moveData.newResponsible || '',
    clientCpf: moveData.newCpf || '',
    location: moveData.newLocation,
    status: 'Em Uso',
    updatedAt: serverTimestamp()
  };

  await updateDoc(assetRef, updateData);

  // 2. Grava na Timeline Global
  const historyLog = {
    assetId: assetId,
    tenantId: currentData.tenantId || 'default-tenant',
    type: 'movimentacao',
    action: 'Transferência',
    date: serverTimestamp(),
    
    previousLocation: currentData.location || 'N/A',
    newLocation: moveData.newLocation,
    previousHolder: currentData.assignedTo || 'N/A',
    newHolder: moveData.newResponsible || 'Sem responsável',
    
    reason: moveData.reason || 'Movimentação de rotina',
    user: user 
  };

  await addDoc(historyCollection, historyLog);
  return true;
};

// Registra manutenção
export const registerMaintenance = async (assetId, maintenanceData, user = 'Sistema') => {
  const assetRef = doc(db, 'assets', assetId);

  // 1. Atualiza status do ativo
  await updateDoc(assetRef, {
    status: 'Manutenção',
    updatedAt: serverTimestamp()
  });

  // 2. Grava na Timeline Global
  const historyLog = {
    assetId: assetId,
    tenantId: maintenanceData.tenantId || 'default-tenant',
    type: 'manutencao',
    action: 'Manutenção Iniciada',
    date: serverTimestamp(),
    
    cost: maintenanceData.cost || '0,00',
    provider: maintenanceData.provider || 'Interno',
    defect: maintenanceData.defect || 'Não informado',
    description: maintenanceData.description || '',
    
    user: user
  };

  await addDoc(historyCollection, historyLog);
  return true;
};