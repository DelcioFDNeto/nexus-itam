// src/services/assetService.js
import { db } from './firebase';
import { 
  collection, 
  getDocs, 
  getDoc, 
  doc, 
  query, 
  orderBy, 
  where,
  limit,
  serverTimestamp,
  collectionGroup,
  writeBatch
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

/** Ativos sob responsabilidade de uma pessoa (pelo nome gravado em `assignedTo`). */
export const getAssetsAssignedTo = async (tenantId, holderName) => {
  if (!tenantId || !holderName) return [];
  const q = query(assetsCollection, where('tenantId', '==', tenantId), where('assignedTo', '==', holderName));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

export const getGlobalAssets = async () => {
  const q = query(collectionGroup(db, 'assets'), orderBy('createdAt', 'desc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

export const getAssetById = async (id, tenantId) => {
  const docRef = doc(db, 'assets', id);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    const data = docSnap.data();
    if (tenantId && data.tenantId !== tenantId) {
      throw new Error("Acesso negado: Este ativo pertence a outro inquilino.");
    }
    return { id: docSnap.id, ...data };
  }
  throw new Error("Ativo não encontrado");
};

// Busca histórico na coleção global filtrando pelo ID do ativo
export const getAssetHistory = async (assetId, tenantId, limitCount = 20) => {
  if (!tenantId) return [];
  // Sem o filtro de tenant a consulta varria o historico global: as regras
  // rejeitavam a query inteira e a timeline vinha vazia sem explicacao.
  const q = query(
    historyCollection,
    where('tenantId', '==', tenantId),
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

// Cria um novo ativo e registra na timeline atomicamente
export const createAsset = async (assetData) => {
  if (!assetData.tenantId) {
    throw new Error("Não é possível cadastrar um ativo sem especificar o inquilino (tenantId).");
  }

  const batch = writeBatch(db);
  const assetRef = doc(assetsCollection);
  const historyRef = doc(historyCollection);

  batch.set(assetRef, {
    ...assetData,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  // Log de Criação
  batch.set(historyRef, {
    assetId: assetRef.id,
    tenantId: assetData.tenantId,
    type: 'creation',
    action: 'Ativo Criado',
    date: serverTimestamp(),
    user: assetData.createdBy || 'Sistema',
    details: 'Cadastro inicial no sistema.'
  });

  await batch.commit();
  return assetRef;
};

/**
 * tenantId para o registro na timeline. As regras recusam historico sem
 * tenantId: chamadas que esqueciam de passa-lo (ex.: alteracao de status em
 * massa) atualizavam o ativo e em seguida falhavam no log — a tela acusava
 * erro e a trilha de auditoria ficava sem a alteracao. Na falta, le do ativo.
 */
const resolveTenantId = async (assetId, ...candidates) => {
  const known = candidates.find((value) => typeof value === 'string' && value);
  if (known) return known;
  const snap = await getDoc(doc(db, 'assets', assetId));
  return snap.exists() ? snap.data().tenantId || null : null;
};

// Atualiza dados e registra na timeline com detalhes personalizados atomicamente
export const updateAsset = async (id, assetData, historyOptions = null) => {
  const docRef = doc(db, 'assets', id);
  const tenantId = await resolveTenantId(id, assetData?.tenantId, historyOptions?.tenantId);
  const batch = writeBatch(db);
  const historyRef = doc(historyCollection);
  
  batch.update(docRef, {
    ...assetData,
    updatedAt: serverTimestamp()
  });

  // Log de Edição
  const historyPayload = historyOptions ? {
    assetId: id,
    tenantId,
    type: historyOptions.type || 'update',
    action: historyOptions.action || 'Dados Editados',
    date: serverTimestamp(),
    user: historyOptions.user || 'Sistema',
    details: historyOptions.details || 'Atualização realizada.'
  } : {
    assetId: id,
    tenantId,
    type: 'update',
    action: 'Dados Editados',
    date: serverTimestamp(),
    user: 'Sistema',
    details: 'Informações ou especificações atualizadas.'
  };

  batch.set(historyRef, historyPayload);
  await batch.commit();
};

export const deleteAsset = async (id, tenantId, user = 'Sistema') => {
  const assetRef = doc(db, 'assets', id);
  const batch = writeBatch(db);

  batch.delete(assetRef);
  
  // Log de Exclusão
  if (tenantId) {
    const historyRef = doc(historyCollection);
    batch.set(historyRef, {
      assetId: id,
      tenantId: tenantId,
      type: 'deletion',
      action: 'Ativo Excluído',
      date: serverTimestamp(),
      user: user,
      details: 'Registro removido permanentemente do banco de dados.'
    });
  }

  await batch.commit();
  return true;
};

// --- AÇÕES ESPECÍFICAS (TIMELINE RICA) ---

// Realiza a movimentação atomicamente
export const moveAsset = async (assetId, currentData, moveData, user = 'Sistema') => {
  const assetRef = doc(db, 'assets', assetId);
  const batch = writeBatch(db);
  const historyRef = doc(historyCollection);

  // 1. Atualiza o Ativo
  const updateData = {
    assignedTo: moveData.newResponsible || '',
    clientCpf: moveData.newCpf || '',
    location: moveData.newLocation,
    status: 'Em Uso',
    updatedAt: serverTimestamp()
  };

  batch.update(assetRef, updateData);

  // 2. Grava na Timeline Global
  const historyLog = {
    assetId: assetId,
    tenantId: currentData.tenantId,
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

  batch.set(historyRef, historyLog);
  await batch.commit();
  return true;
};

// --- BAIXA PATRIMONIAL ---

/**
 * Retira o ativo do patrimonio sem apagar o registro atomicamente.
 *
 * Antes so existia `deleteAsset`: aposentar um equipamento significava excluir
 * o documento e perder junto toda a timeline — movimentacoes, manutencoes e
 * responsaveis anteriores. A baixa preserva o historico e exige data e motivo.
 *
 * @param {string} assetId
 * @param {object} currentData ativo como esta hoje
 * @param {{status?:string, date:string, reason:string, notes?:string, residualValue?:string}} writeOff
 * @param {string} user quem registrou
 */
export const writeOffAsset = async (assetId, currentData, writeOff, user = 'Sistema') => {
  if (!writeOff?.reason) throw new Error('A baixa exige um motivo.');
  if (!writeOff?.date) throw new Error('A baixa exige a data.');

  const tenantId = currentData?.tenantId;
  if (!tenantId) throw new Error('Ativo sem inquilino: baixa nao registrada.');

  const status = writeOff.status || 'Baixado';
  const assetRef = doc(db, 'assets', assetId);
  const batch = writeBatch(db);
  const historyRef = doc(historyCollection);

  batch.update(assetRef, {
    status,
    writeOffDate: writeOff.date,
    writeOffReason: writeOff.reason,
    writeOffNotes: writeOff.notes || '',
    writeOffResidualValue: writeOff.residualValue || '',
    writeOffBy: user,
    // Solta o responsavel: um ativo baixado nao fica sob a guarda de ninguem.
    assignedTo: '',
    employeeId: '',
    updatedAt: serverTimestamp()
  });

  batch.set(historyRef, {
    assetId,
    tenantId,
    type: 'baixa',
    action: 'Baixa Patrimonial',
    date: serverTimestamp(),
    user,
    previousStatus: currentData.status || 'N/A',
    newStatus: status,
    reason: writeOff.reason,
    details: [
      `Motivo: ${writeOff.reason}`,
      `Data da baixa: ${writeOff.date}`,
      writeOff.residualValue ? `Valor residual: R$ ${writeOff.residualValue}` : null,
      writeOff.notes ? `Obs: ${writeOff.notes}` : null
    ].filter(Boolean).join(' | ')
  });

  await batch.commit();
  return true;
};

/** Desfaz a baixa, devolvendo o ativo ao inventario ativo atomicamente. */
export const reactivateAsset = async (assetId, currentData, user = 'Sistema', newStatus = 'Disponível') => {
  const tenantId = currentData?.tenantId;
  if (!tenantId) throw new Error('Ativo sem inquilino: reativacao nao registrada.');

  const assetRef = doc(db, 'assets', assetId);
  const batch = writeBatch(db);
  const historyRef = doc(historyCollection);

  batch.update(assetRef, {
    status: newStatus,
    writeOffDate: '',
    writeOffReason: '',
    writeOffNotes: '',
    writeOffResidualValue: '',
    reactivatedAt: serverTimestamp(),
    reactivatedBy: user,
    updatedAt: serverTimestamp()
  });

  batch.set(historyRef, {
    assetId,
    tenantId,
    type: 'reativacao',
    action: 'Reativação de Ativo',
    date: serverTimestamp(),
    user,
    previousStatus: currentData.status || 'Baixado',
    newStatus,
    details: `Ativo devolvido ao inventário como "${newStatus}". Baixa anterior: ${currentData.writeOffReason || 'não informada'}.`
  });

  await batch.commit();
  return true;
};

// Registra manutenção atomicamente
export const registerMaintenance = async (assetId, maintenanceData, user = 'Sistema') => {
  const assetRef = doc(db, 'assets', assetId);
  const tenantId = await resolveTenantId(assetId, maintenanceData?.tenantId);
  const batch = writeBatch(db);
  const historyRef = doc(historyCollection);

  // 1. Atualiza status do ativo
  batch.update(assetRef, {
    status: 'Manutenção',
    updatedAt: serverTimestamp()
  });

  // 2. Grava na Timeline Global
  const historyLog = {
    assetId: assetId,
    tenantId,
    type: 'manutencao',
    action: 'Manutenção Iniciada',
    date: serverTimestamp(),
    
    cost: maintenanceData.cost || '0,00',
    provider: maintenanceData.provider || 'Interno',
    defect: maintenanceData.defect || 'Não informado',
    description: maintenanceData.description || '',
    
    user: user
  };

  batch.set(historyRef, historyLog);
  await batch.commit();
  return true;
};