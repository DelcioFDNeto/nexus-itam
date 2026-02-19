import { db } from './firebase';
import { collection, getDocs, writeBatch, doc, serverTimestamp } from 'firebase/firestore';

// Coleções que serão incluídas no backup
const COLLECTIONS_TO_BACKUP = [
  'assets',
  'employees',
  'history',
  'projects',
  'tasks',
  'sectors',
  'settings' // Incluindo configurações também
];

/**
 * Gera um objeto JSON contendo todos os dados do sistema.
 * @returns {Promise<Object>} Objeto de backup completo
 */
export const generateFullBackup = async () => {
  const backupData = {
    meta: {
      version: '2.0',
      date: new Date().toISOString(),
      type: 'full_backup',
      generator: 'BySabel ITAM Backup Service'
    },
    data: {}
  };

  try {
    const promises = COLLECTIONS_TO_BACKUP.map(async (colName) => {
      const snapshot = await getDocs(collection(db, colName));
      return {
        name: colName,
        docs: snapshot.docs.map(doc => {
            const data = doc.data();
            // Converte Timestamps do Firestore para String ISO para serialização segura
            const serializedData = Object.keys(data).reduce((acc, key) => {
                const value = data[key];
                if (value && typeof value === 'object' && value.toDate) {
                    acc[key] = value.toDate().toISOString(); // Timestamp -> String
                } else if (value && typeof value === 'object' && value.seconds) {
                     acc[key] = new Date(value.seconds * 1000).toISOString(); // Timestamp {seconds, nanoseconds} -> String
                } else {
                    acc[key] = value;
                }
                return acc;
            }, {});
            
            return { _id: doc.id, ...serializedData };
        })
      };
    });

    const results = await Promise.all(promises);
    
    results.forEach(res => {
      backupData.data[res.name] = res.docs;
    });

    return backupData;

  } catch (error) {
    console.error("Erro fatal ao gerar backup:", error);
    throw new Error("Falha ao coletar dados do Firebase.");
  }
};

/**
 * Restaura dados a partir de um objeto de backup.
 * @param {Object} backupData - O objeto JSON do backup
 * @param {Function} onProgress - Callback (percentage, message) para atualizar a UI
 * @returns {Promise<Object>} Estatísticas da importação
 */
export const restoreBackup = async (backupData, onProgress) => {
  // 1. Validação Básica
  if (!backupData || !backupData.meta || !backupData.data) {
    throw new Error("Arquivo de backup inválido ou corrompido.");
  }

  const stats = {
    totalDocsProcessed: 0,
    collectionsUpdated: [],
    errors: []
  };

  const collections = Object.keys(backupData.data);
  const totalCollections = collections.length;
  let processedCollections = 0;

  for (const colName of collections) {
    if (!COLLECTIONS_TO_BACKUP.includes(colName)) {
        console.warn(`Coleção desconhecida no backup: ${colName}, ignorando.`);
        continue;
    }

    const docs = backupData.data[colName];
    if (!Array.isArray(docs) || docs.length === 0) {
        processedCollections++;
        continue;
    }

    if (onProgress) onProgress(
        Math.round((processedCollections / totalCollections) * 100), 
        `Restaurando ${colName}... (${docs.length} itens)`
    );

    // Processamento em Batches (Chunk de 400 para segurança, limite é 500)
    const CHUNK_SIZE = 400;
    for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
      const chunk = docs.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);
      
      chunk.forEach(docItem => {
         const { _id, ...data } = docItem;
         if (!_id) return; // Pula se não tiver ID

         const docRef = doc(db, colName, _id);
         
         // Tratamento de Datas (String ISO -> Date Object) se necessário
         // O Firestore aceita Strings ISO, mas converter para Date garante o tipo Timestamp
         const processedData = Object.keys(data).reduce((acc, key) => {
             const value = data[key];
             // Verificação simplista de string de data ISO
             if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
                 acc[key] = new Date(value);
             } else {
                 acc[key] = value;
             }
             return acc;
         }, {});

         // Adiciona updated_at de restauração para rastreio
         processedData._restoredAt = serverTimestamp();

         // set(docRef, data, { merge: true }) garante que campos novos sejam adicionados e existentes atualizados
         // sem destruir campos que não estão no backup (opcional, pode ser sem merge para overwrite total)
         batch.set(docRef, processedData, { merge: true });
      });

      try {
          await batch.commit();
          stats.totalDocsProcessed += chunk.length;
      } catch (err) {
          console.error(`Erro ao gravar batch na coleção ${colName}:`, err);
          stats.errors.push(`Erro no lote ${i} da coleção ${colName}`);
      }
    }

    stats.collectionsUpdated.push(colName);
    processedCollections++;
  }

  if (onProgress) onProgress(100, "Restauração Finalizada!");
  return stats;
};
