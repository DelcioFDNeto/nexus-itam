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

// --- DASHBOARD & REPORTS ---

export const getRecentActivity = async (limitCount = 8) => {
  const q = query(historyCollection, orderBy('date', 'desc'), limit(limitCount));
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
  // Se historyOptions for fornecido, usa ele. Se não, usa o genérico apenas se NÃO for update automático
  if (historyOptions) {
      await addDoc(historyCollection, {
        assetId: id,
        type: historyOptions.type || 'update',
        action: historyOptions.action || 'Dados Editados',
        date: serverTimestamp(),
        user: historyOptions.user || 'Sistema',
        details: historyOptions.details || 'Atualização realizada.'
      });
  } else {
      // Setup padrão para edições genéricas (opcional: pode ser removido se quiser logar só o explícito)
      await addDoc(historyCollection, {
        assetId: id,
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
  // Opcional: Apagar histórico associado (geralmente mantemos para auditoria)
  return true;
};

// --- AÇÕES ESPECÍFICAS (TIMELINE RICA) ---

// Realiza a movimentação
export const moveAsset = async (assetId, currentData, moveData, user = 'Sistema') => {
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