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
import { releaseAssetFromLicenses } from './licenseService';
import { lifecycleBlocker } from '../utils/assetStatus';
import { isGatewayActiveSession, microservicesApi } from './microservicesClient';

const assertOperable = (asset, action) => {
  const reason = lifecycleBlocker(asset, action);
  if (reason) throw new Error(reason);
};

const assetsCollection = collection(db, 'assets');
const historyCollection = collection(db, 'history'); // Coleção Global de Histórico

// --- MAPEADORES ADAPTER MICROSERVICES <-> REACT ---

export const mapGatewayAssetToReact = (row) => {
  if (!row) return null;
  const brand = row.brand || '';
  const model = row.model || '';
  const fullModel = brand && !model.toLowerCase().startsWith(brand.toLowerCase()) ? `${brand} ${model}`.trim() : model;
  const specs = row.specs && typeof row.specs === 'object' ? row.specs : {};

  return {
    id: row.id,
    tenantId: row.tenant_id,
    internalId: row.internal_id,
    type: specs.uiType || row.type || 'Computador',
    brand: row.brand || '',
    model: fullModel || row.internal_id,
    serialNumber: row.serial_number || '',
    status: row.status || 'Em Uso',
    location: row.location || '',
    department: row.department || '',
    sector: row.department || '',
    assignedTo: row.assigned_to_name || '',
    assignedToEmail: row.assigned_to_email || '',
    purchase_value: row.purchase_value,
    purchaseValue: row.purchase_value,
    valor: String(row.purchase_value ?? 0),
    notes: specs.notes || '',
    attachments: Array.isArray(specs.attachments) ? specs.attachments : [],
    peripherals: Array.isArray(specs.peripherals) ? specs.peripherals : [],
    clientCpf: specs.clientCpf || '',
    purchaseDate: specs.purchaseDate || '',
    warrantyEnd: specs.warrantyEnd || '',
    supplier: specs.supplier || '',
    invoiceNumber: specs.invoiceNumber || '',
    costCenter: specs.costCenter || '',
    category: specs.category || 'Corporativo',
    writeOffDate: specs.writeOffDate || '',
    writeOffReason: specs.writeOffReason || '',
    writeOffNotes: specs.writeOffNotes || '',
    specs: { ...specs, processor: specs.processor || specs.cpu || '' },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

export const mapReactAssetToGateway = (assetData) => {
  const modelStr = String(assetData.model || '').trim();
  const parts = modelStr.split(/\s+/);
  const brand = assetData.brand?.trim() || parts[0] || 'Geral';
  const model = parts.length > 1 ? parts.slice(1).join(' ') : (parts[0] || 'Equipamento');
  const purchaseValue = Number(
    String(assetData.valor ?? assetData.purchaseValue ?? 0)
      .replace(/[R$\s]/g, '')
      .replace(/\./g, '')
      .replace(',', '.')
  ) || 0;

  return {
    internalId: assetData.internalId ? String(assetData.internalId).trim().toUpperCase() : undefined,
    type: assetData.type || 'Notebook',
    brand: brand.slice(0, 80),
    model: model.slice(0, 120),
    serialNumber: assetData.serialNumber ? String(assetData.serialNumber).trim().slice(0, 120) : null,
    status: assetData.status || 'Em Uso',
    location: assetData.location ? String(assetData.location).trim().slice(0, 120) : undefined,
    department: (assetData.department || assetData.sector) ? String(assetData.department || assetData.sector).trim().slice(0, 120) : undefined,
    assignedToName: assetData.assignedTo ? String(assetData.assignedTo).trim().slice(0, 160) : null,
    assignedToEmail: assetData.assignedToEmail ? String(assetData.assignedToEmail).trim().toLowerCase().slice(0, 180) : null,
    purchaseValue,
    specs: {
      ...(assetData.specs || {}),
      uiType: assetData.type,
      notes: assetData.notes || '',
      category: assetData.category || 'Corporativo',
      supplier: assetData.supplier || '',
      invoiceNumber: assetData.invoiceNumber || '',
      costCenter: assetData.costCenter || '',
      clientCpf: assetData.clientCpf || '',
      purchaseDate: assetData.purchaseDate || '',
      warrantyEnd: assetData.warrantyEnd || '',
    },
  };
};

// --- LEITURA (READ) ---

export const getAllAssets = async (tenantId) => {
  if (!tenantId) return [];
  if (isGatewayActiveSession()) {
    const res = await microservicesApi.listAssets();
    return (res.items || []).map(mapGatewayAssetToReact);
  }
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
  if (isGatewayActiveSession()) {
    const res = await microservicesApi.listAssets();
    return (res.items || []).map(mapGatewayAssetToReact).filter((a) => a.assignedTo === holderName);
  }
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
  if (isGatewayActiveSession()) {
    const raw = await microservicesApi.getAssetById(id);
    return mapGatewayAssetToReact(raw);
  }
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

/** Busca um ativo pelo código de patrimônio (Tag) no mesmo inquilino. */
export const getAssetByInternalId = async (internalId, tenantId) => {
  if (!internalId || !tenantId) return null;
  if (isGatewayActiveSession()) {
    const res = await microservicesApi.listAssets({ search: internalId });
    const match = (res.items || []).find(
      (a) => String(a.internal_id).toUpperCase() === String(internalId).trim().toUpperCase(),
    );
    return match ? mapGatewayAssetToReact(match) : null;
  }
  const q = query(
    assetsCollection,
    where('tenantId', '==', tenantId),
    where('internalId', '==', String(internalId).trim().toUpperCase()),
    limit(1)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
};

// Busca histórico na coleção global filtrando pelo ID do ativo
export const getAssetHistory = async (assetId, tenantId, limitCount = 20) => {
  if (!tenantId) return [];
  if (isGatewayActiveSession()) {
    const asset = await microservicesApi.getAssetById(assetId).catch(() => null);
    if (!asset || !Array.isArray(asset.history)) return [];
    return asset.history.slice(0, limitCount).map((h) => ({
      id: h.id,
      assetId: h.asset_id,
      tenantId: h.tenant_id,
      action: h.action,
      details: h.details,
      user: h.actor_name || h.actor_email || 'Sistema',
      date: h.created_at,
      jsDate: new Date(h.created_at),
    }));
  }
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
  if (isGatewayActiveSession()) {
    const res = await microservicesApi.listAssets();
    const assets = (res.items || []).slice(0, 8);
    const detailed = await Promise.all(assets.map((a) => microservicesApi.getAssetById(a.id).catch(() => null)));
    const historyList = [];
    detailed.filter(Boolean).forEach((a) => {
      (a.history || []).forEach((h) => {
        historyList.push({
          id: h.id,
          assetId: h.asset_id,
          tenantId: h.tenant_id,
          action: h.action,
          details: h.details,
          user: h.actor_name || h.actor_email || 'Sistema',
          date: h.created_at,
          jsDate: new Date(h.created_at),
        });
      });
    });
    return historyList.sort((a, b) => b.jsDate - a.jsDate).slice(0, limitCount);
  }
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

  if (isGatewayActiveSession()) {
    const payload = mapReactAssetToGateway(assetData);
    const created = await microservicesApi.createAsset(payload);
    return { id: created.id };
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

const resolveTenantId = async (assetId, ...candidates) => {
  const known = candidates.find((value) => typeof value === 'string' && value);
  if (known) return known;
  const snap = await getDoc(doc(db, 'assets', assetId));
  return snap.exists() ? snap.data().tenantId || null : null;
};

// Atualiza dados e registra na timeline com detalhes personalizados atomicamente
export const updateAsset = async (id, assetData, historyOptions = null) => {
  if (isGatewayActiveSession()) {
    const payload = mapReactAssetToGateway(assetData);
    if (historyOptions?.details || historyOptions?.action) {
      payload.historyNote = `${historyOptions.action || 'Atualização'}: ${historyOptions.details || ''}`.trim();
    }
    await microservicesApi.updateAsset(id, payload);
    return;
  }

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
  if (isGatewayActiveSession()) {
    await microservicesApi.retireAsset(id, 'Exclusão solicitada pelo operador');
    return true;
  }

  const assetRef = doc(db, 'assets', id);
  const resolvedTenantId = await resolveTenantId(id, tenantId);
  const batch = writeBatch(db);

  batch.delete(assetRef);
  batch.delete(doc(db, 'assetInventory', id));
  
  // Log de Exclusão
  if (resolvedTenantId) {
    const historyRef = doc(historyCollection);
    batch.set(historyRef, {
      assetId: id,
      tenantId: resolvedTenantId,
      type: 'deletion',
      action: 'Ativo Excluído',
      date: serverTimestamp(),
      user: user,
      details: 'Registro removido permanentemente do banco de dados.'
    });
  }

  await batch.commit();

  // Libera assentos de licenças vinculadas a este ativo (não-bloqueante)
  if (resolvedTenantId) {
    try {
      await releaseAssetFromLicenses(resolvedTenantId, id);
    } catch (err) {
      console.warn('Falha ao desalocar licenças do ativo excluído:', err);
    }
  }

  return true;
};

// --- AÇÕES ESPECÍFICAS (TIMELINE RICA) ---

// Realiza a movimentação atomicamente
export const moveAsset = async (assetId, currentData, moveData, user = 'Sistema') => {
  assertOperable(currentData, 'movimentar');
  if (isGatewayActiveSession()) {
    const holder = (moveData.newResponsible || '').trim();
    const updatePayload = {
      location: moveData.newLocation,
      assignedToName: holder || null,
      status: holder ? 'Em Uso' : 'Disponível',
      historyNote: `Transferência para ${moveData.newLocation} (${holder || 'Sem responsável'}). Motivo: ${moveData.reason || 'Rotina'}`,
    };
    await microservicesApi.updateAsset(assetId, updatePayload);
    return true;
  }

  const assetRef = doc(db, 'assets', assetId);
  const batch = writeBatch(db);
  const historyRef = doc(historyCollection);

  const holder = (moveData.newResponsible || '').trim();
  const previousStatus = currentData.status || 'Disponível';
  const status = holder
    ? (['Disponível', 'Em Uso'].includes(previousStatus) ? 'Em Uso' : previousStatus)
    : (previousStatus === 'Em Uso' ? 'Disponível' : previousStatus);

  // 1. Atualiza o Ativo
  const updateData = {
    assignedTo: holder,
    clientCpf: holder ? moveData.newCpf || '' : '',
    location: moveData.newLocation,
    status,
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

export const writeOffAsset = async (assetId, currentData, writeOff, user = 'Sistema') => {
  if (!writeOff?.reason) throw new Error('A baixa exige um motivo.');
  if (!writeOff?.date) throw new Error('A baixa exige a data.');
  if (currentData?.transit?.termId) assertOperable(currentData, 'dar baixa');

  if (isGatewayActiveSession()) {
    await microservicesApi.retireAsset(assetId, writeOff.reason);
    return true;
  }

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
    assignedTo: '',
    employeeId: '',
    clientCpf: '',
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

  try {
    await releaseAssetFromLicenses(tenantId, assetId);
  } catch (err) {
    console.warn('Falha ao liberar licenças do ativo baixado:', err);
  }
  return true;
};

/** Desfaz a baixa, devolvendo o ativo ao inventario ativo atomicamente. */
export const reactivateAsset = async (assetId, currentData, user = 'Sistema', newStatus = 'Disponível') => {
  if (isGatewayActiveSession()) {
    await microservicesApi.updateAsset(assetId, {
      status: newStatus,
      assignedToName: null,
      assignedToEmail: null,
      historyNote: `Reativação de ativo como ${newStatus}`,
    });
    return true;
  }

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
  if (maintenanceData?.asset) assertOperable(maintenanceData.asset, 'enviar para manutenção');
  if (isGatewayActiveSession()) {
    await microservicesApi.updateAsset(assetId, {
      status: 'Manutenção',
      historyNote: `Manutenção iniciada: ${maintenanceData.defect || 'Reparo técnico'} (Custo R$ ${maintenanceData.cost || '0,00'}, Fornecedor: ${maintenanceData.provider || 'Interno'})`,
    });
    return true;
  }

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
    
    previousStatus: maintenanceData.asset?.status || 'N/A',
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
