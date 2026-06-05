// src/services/importService.js
import { db } from './firebase';
import { writeBatch, doc, collection } from 'firebase/firestore';

export const importAssetsBatch = async (dataArray) => {
  if (!dataArray || !Array.isArray(dataArray)) {
    throw new Error("Dados de importação inválidos.");
  }
  
  // Firestore permite max 500 operações por batch
  if (dataArray.length > 500) {
    throw new Error("O limite do Batch é 500 itens. Divida seu JSON.");
  }
  
  // Garantir que todos os itens tenham tenantId
  const tenantId = dataArray[0]?.tenantId;
  if (!tenantId) {
    throw new Error("Dados de importação não possuem tenantId.");
  }

  const batch = writeBatch(db);
  const collectionRef = collection(db, 'assets');

  let count = 0;

  dataArray.forEach((item) => {
    // Aqui está o segredo:
    // Estamos dizendo ao Firebase: "Use o internalId (ex: SHL-001) como o ID do documento"
    // Em vez de deixar o Firebase criar um ID aleatório (AxGh7...).
    // Isso torna o banco muito mais organizado.
    
    let docRef;
    if (item.internalId && String(item.internalId).trim() !== "undefined" && String(item.internalId).trim() !== "") {
      docRef = doc(collectionRef, String(item.internalId).trim()); 
    } else {
      docRef = doc(collectionRef); // ID gerado automaticamente
      item.internalId = docRef.id;
    } 
    
    // Preparando os dados (adicionando timestamps)
    const docData = {
      ...item,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    batch.set(docRef, docData);
    count++;
  });

  // Só aqui os dados são realmente enviados (commit)
  await batch.commit();
  return count;
};