// src/services/tenantService.js
// -----------------------------------------------------------------------------
// Operacoes sobre empresas (tenants): cadastro, uso de limites e a visao
// consolidada que alimenta o console Nexus Master.
// -----------------------------------------------------------------------------
import { deleteApp, initializeApp } from 'firebase/app';
import { createUserWithEmailAndPassword, getAuth, signOut } from 'firebase/auth';
import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { connectAuthIfEmulated, db, firebaseConfig } from './firebase';
import { MASTER_TENANT } from '../utils/permissions';
import { DEFAULT_PLANS, resolveEntitlements } from '../utils/entitlements';

// -----------------------------------------------------------------------------
// Identidade de uma empresa nova
// -----------------------------------------------------------------------------

export const slugify = (value, max = 24) =>
  String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max);

const randomSuffix = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10);
};

/** ID legivel e dificil de adivinhar: `acme-industria-3f9a1c2b`. */
export const newTenantId = (companyName) => `${slugify(companyName) || 'empresa'}-${randomSuffix()}`;

/** Prefixo de patrimonio sugerido a partir do nome (ACME Industria -> ACM). */
export const assetPrefixFor = (companyName) => {
  const letters = String(companyName || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return (letters.slice(0, 3) || 'ATV').padEnd(3, 'X');
};

/**
 * Configuracoes iniciais de uma empresa recem-criada. Antes nenhuma era gravada:
 * o app mostrava "Nexus ITAM" como nome da empresa e o agente numerava os
 * ativos com o prefixo da primeira cliente (SHL-BEL-...).
 */
export const buildInitialSettings = (companyName) => ({
  companyName: String(companyName || '').trim(),
  termTitle: 'Termo de Responsabilidade',
  agentNaming: {
    companyPrefix: assetPrefixFor(companyName),
    locationCode: 'MTZ',
    padLength: 3,
  },
  createdAt: serverTimestamp(),
});

// -----------------------------------------------------------------------------
// Uso de limites (contagem por agregacao: 1 leitura a cada 1.000 documentos)
// -----------------------------------------------------------------------------

const countWhere = async (collectionName, tenantId, extra = []) => {
  const snap = await getCountFromServer(
    query(collection(db, collectionName), where('tenantId', '==', tenantId), ...extra),
  );
  return snap.data().count;
};

export const countAssets = (tenantId) => countWhere('assets', tenantId);

export const countMembers = (tenantId) => countWhere('users', tenantId);

export const countPendingInvites = (tenantId) =>
  countWhere('invites', tenantId, [where('status', '==', 'pending')]);

/**
 * Garante espaco no limite antes de criar itens. Nao consulta nada quando o
 * plano e ilimitado. Lanca erro com mensagem pronta para a UI.
 *
 * @param {object} user   currentUser (precisa de tenantId e entitlements)
 * @param {'assets'|'users'} resource
 * @param {number} extra  quantos itens serao criados
 */
export const assertWithinLimit = async (user, resource, extra = 1) => {
  const limit = resource === 'assets' ? user?.entitlements?.maxAssets : user?.entitlements?.maxUsers;
  if (limit === null || limit === undefined || !user?.tenantId) return;

  const current = resource === 'assets'
    ? await countAssets(user.tenantId)
    : (await countMembers(user.tenantId)) + (await countPendingInvites(user.tenantId));

  if (current + extra > limit) {
    const label = resource === 'assets' ? 'ativos' : 'usuários';
    const plan = user.entitlements?.planName || 'atual';
    const room = Math.max(0, limit - current);
    throw new Error(
      room === 0
        ? `Limite de ${limit} ${label} do plano ${plan} atingido. Fale com o suporte para ampliar.`
        : `O plano ${plan} permite mais ${room} ${label} (limite ${limit}). Reduza a quantidade ou amplie o plano.`,
    );
  }
};

// -----------------------------------------------------------------------------
// Planos
// -----------------------------------------------------------------------------

/** Planos do banco mesclados aos padroes embutidos, indexados por id. */
export const loadPlans = async () => {
  const snap = await getDocs(collection(db, 'plans'));
  const stored = Object.fromEntries(snap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
  const merged = {};
  Object.keys(DEFAULT_PLANS).forEach((id) => {
    merged[id] = { ...DEFAULT_PLANS[id], ...(stored[id] || {}), id };
  });
  Object.keys(stored).forEach((id) => {
    if (!merged[id]) merged[id] = stored[id];
  });
  return merged;
};

// -----------------------------------------------------------------------------
// Console master
// -----------------------------------------------------------------------------

const toDate = (value) => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const latest = (dates) => dates.filter(Boolean).sort((a, b) => b - a)[0] || null;

/**
 * Visao consolidada de todas as empresas: cadastro, plano efetivo, membros,
 * uso de limites e ultimo acesso. Inclui empresas LEGADAS — tenantIds usados
 * por perfis mas sem documento em /tenants — que antes eram invisiveis no console.
 */
export const loadConsoleSnapshot = async () => {
  const [tenantsSnap, usersSnap, plans] = await Promise.all([
    getDocs(collection(db, 'tenants')),
    getDocs(collection(db, 'users')),
    loadPlans(),
  ]);

  const users = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const registered = tenantsSnap.docs
    .map((d) => ({ ...d.data(), id: d.id }))
    .filter((t) => t.id !== MASTER_TENANT);

  const known = new Set(registered.map((t) => t.id));
  const legacyIds = [
    ...new Set(
      users
        .map((u) => u.tenantId)
        .filter((id) => id && id !== MASTER_TENANT && id !== 'default-tenant' && !known.has(id)),
    ),
  ];

  const legacy = await Promise.all(
    legacyIds.map(async (id) => {
      const settings = await getDoc(doc(db, 'settings', id)).catch(() => null);
      return {
        id,
        legacy: true,
        companyName: settings?.exists() ? settings.data().companyName || null : null,
        status: 'active',
      };
    }),
  );

  const all = [...registered, ...legacy];

  const assetCounts = Object.fromEntries(
    await Promise.all(all.map(async (t) => [t.id, await countAssets(t.id).catch(() => null)])),
  );

  const tenants = all.map((tenant) => {
    const members = users.filter((u) => u.tenantId === tenant.id);
    const owner =
      members.find((u) => u.id === tenant.ownerUid) ||
      members.find((u) => u.role === 'owner') ||
      members.find((u) => u.role === 'admin') ||
      null;
    const entitlements = resolveEntitlements({
      tenant: tenant.legacy ? null : tenant,
      plan: tenant.plan ? plans[String(tenant.plan).toLowerCase()] : null,
    });
    const billable = !tenant.legacy && ['active', 'trial'].includes(tenant.status || 'active');

    return {
      ...tenant,
      legacy: Boolean(tenant.legacy),
      status: tenant.status || 'active',
      members,
      owner,
      usersCount: members.length,
      assetsCount: assetCounts[tenant.id],
      entitlements,
      mrr: billable ? entitlements.monthlyPrice : 0,
      createdAtDate: toDate(tenant.createdAt),
      lastActivity: latest(members.map((u) => toDate(u.lastLoginAt))),
    };
  });

  tenants.sort((a, b) => (b.createdAtDate?.getTime() || 0) - (a.createdAtDate?.getTime() || 0));

  return {
    tenants,
    users,
    plans,
    masterUsers: users.filter((u) => u.tenantId === MASTER_TENANT),
    loadedAt: new Date(),
  };
};

/** Plano, status, nome e ajustes individuais (limites, recursos, preco). */
export const updateTenant = (tenantId, data) =>
  updateDoc(doc(db, 'tenants', tenantId), { ...data, updatedAt: serverTimestamp() });

/** Identidade visual gravada pelo master em nome da empresa. */
export const saveTenantBranding = (tenantId, branding) =>
  setDoc(doc(db, 'settings', tenantId), { ...branding, updatedAt: serverTimestamp() }, { merge: true });

export const getTenantBranding = async (tenantId) => {
  const snap = await getDoc(doc(db, 'settings', tenantId));
  return snap.exists() ? snap.data() : {};
};

/** Anotacoes comerciais internas (so o master le e grava). */
export const getTenantInternal = async (tenantId) => {
  const snap = await getDoc(doc(db, 'tenantInternal', tenantId));
  return snap.exists() ? snap.data() : {};
};

export const saveTenantInternal = (tenantId, data) =>
  setDoc(doc(db, 'tenantInternal', tenantId), { ...data, updatedAt: serverTimestamp() }, { merge: true });

/** Cria o cadastro que faltava para uma empresa legada, sem mexer nos dados dela. */
export const regularizeLegacyTenant = (tenantId, { companyName, plan, ownerUid }) =>
  setDoc(doc(db, 'tenants', tenantId), {
    id: tenantId,
    companyName: companyName || tenantId,
    plan,
    status: 'active',
    ownerUid: ownerUid || null,
    regularizedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

/**
 * Provisiona empresa + owner pelo console. A conta e criada numa instancia
 * secundaria do Firebase (a sessao do master continua intacta). Se a gravacao
 * no Firestore falhar, a conta recem-criada e removida — antes ela ficava orfa
 * e o e-mail nao podia mais ser usado.
 */
export const provisionTenant = async ({ companyName, adminName, email, password, plan }) => {
  const tempApp = initializeApp(firebaseConfig, `provision-${Date.now()}`);
  const tempAuth = connectAuthIfEmulated(getAuth(tempApp));
  let createdUser = null;

  try {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const credential = await createUserWithEmailAndPassword(tempAuth, normalizedEmail, password);
    createdUser = credential.user;

    const cleanCompany = String(companyName || '').trim();
    const tenantId = newTenantId(cleanCompany);
    const batch = writeBatch(db);
    batch.set(doc(db, 'tenants', tenantId), {
      id: tenantId,
      companyName: cleanCompany,
      ownerUid: createdUser.uid,
      plan,
      status: 'active',
      provisionedBy: 'console',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'users', createdUser.uid), {
      id: createdUser.uid,
      email: normalizedEmail,
      name: String(adminName || '').trim(),
      tenantId,
      role: 'owner',
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'settings', tenantId), buildInitialSettings(cleanCompany), { merge: true });
    await batch.commit();

    return { tenantId, uid: createdUser.uid };
  } catch (error) {
    if (createdUser) await createdUser.delete().catch(() => {});
    throw error;
  } finally {
    await signOut(tempAuth).catch(() => {});
    await deleteApp(tempApp).catch(() => {});
  }
};

/** Mensagens legiveis para os erros mais comuns do Firebase Auth/Firestore. */
export const describeFirebaseError = (error, fallback = 'Não foi possível concluir a operação.') => {
  const map = {
    'auth/email-already-in-use': 'Este e-mail já possui uma conta.',
    'auth/invalid-email': 'E-mail inválido.',
    'auth/weak-password': 'Senha fraca: use pelo menos 6 caracteres.',
    'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
    'auth/network-request-failed': 'Sem conexão com o servidor. Verifique a internet.',
    'auth/invalid-credential': 'E-mail ou senha incorretos.',
    'auth/wrong-password': 'E-mail ou senha incorretos.',
    'auth/user-not-found': 'E-mail ou senha incorretos.',
    'auth/user-disabled': 'Esta conta foi desativada.',
    'permission-denied': 'Permissão negada para esta operação.',
    unavailable: 'Serviço indisponível no momento. Tente novamente.',
  };
  return map[error?.code] || error?.message || fallback;
};
