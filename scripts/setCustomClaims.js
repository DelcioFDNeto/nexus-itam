/* eslint-env node */
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

// Inicialize o SDK admin com as credenciais do seu projeto
// Para isso, você precisa gerar uma chave privada em:
// Configurações do Projeto -> Contas de Serviço -> Gerar nova chave privada
// E salvar o arquivo JSON gerado como 'serviceAccountKey.json' na raiz do projeto (não comite este arquivo!)
const serviceAccount = JSON.parse(
  readFileSync(new URL('../serviceAccountKey.json', import.meta.url))
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const setClaims = async (uid, tenantId, role) => {
  try {
    await admin.auth().setCustomUserClaims(uid, { tenantId, role });
    console.log(`Claims definidas para o usuário ${uid}: tenantId=${tenantId}, role=${role}`);
  } catch (error) {
    console.error('Erro ao definir claims:', error);
  }
};

// Exemplo de uso:
const uid = process.argv[2];
const tenantId = process.argv[3];
const role = process.argv[4] || 'admin';

if (!uid || !tenantId) {
  console.log('Uso: node setCustomClaims.js <uid> <tenantId> [role]');
  process.exit(1);
}

setClaims(uid, tenantId, role).then(() => process.exit(0));
