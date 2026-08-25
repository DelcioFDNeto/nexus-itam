// src/services/tenantSecretService.js
// -----------------------------------------------------------------------------
// O agentToken autentica maquinas sem login, entao vale como credencial.
// Ele ficava em /settings/{tenantId}, um documento legivel por qualquer usuario
// autenticado — inclusive de outro inquilino. Agora vive em
// /tenantSecrets/{tenantId}, acessivel apenas a owner/admin do proprio tenant.
// As regras do agentInbox continuam validando o token via get() server-side.
// -----------------------------------------------------------------------------
import { deleteField, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';

const secretRef = (tenantId) => doc(db, 'tenantSecrets', tenantId);

/** Le o token do agente. Retorna '' quando nao existe ou o perfil nao tem acesso. */
export const getAgentToken = async (tenantId) => {
  if (!tenantId) return '';
  const snap = await getDoc(secretRef(tenantId));
  return snap.exists() ? snap.data().agentToken || '' : '';
};

/** Gera e persiste um novo token, invalidando o anterior. */
export const rotateAgentToken = async (tenantId, rotatedBy = 'sistema') => {
  if (!tenantId) throw new Error('Tenant nao informado.');
  const token = crypto.randomUUID();
  await setDoc(
    secretRef(tenantId),
    { agentToken: token, rotatedAt: serverTimestamp(), rotatedBy },
    { merge: true },
  );
  return token;
};

/**
 * Migracao unica: move o token que ficou em /settings para /tenantSecrets e
 * apaga o campo exposto. Idempotente — pode rodar a cada carga da tela.
 */
export const migrateLegacyAgentToken = async (tenantId) => {
  if (!tenantId) return '';

  const current = await getAgentToken(tenantId);
  if (current) return current;

  const settingsSnap = await getDoc(doc(db, 'settings', tenantId));
  const legacyToken = settingsSnap.exists() ? settingsSnap.data().agentToken : null;
  if (!legacyToken) return '';

  await setDoc(
    secretRef(tenantId),
    { agentToken: legacyToken, migratedAt: serverTimestamp() },
    { merge: true },
  );
  await updateDoc(doc(db, 'settings', tenantId), { agentToken: deleteField() });

  return legacyToken;
};
