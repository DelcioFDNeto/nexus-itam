// tests/rules/firestore.rules.spec.js
// -----------------------------------------------------------------------------
// Testes das regras do Firestore contra o emulador.
//   npm run test:rules
// (sobe o emulador via `firebase emulators:exec`; exige Java instalado)
// -----------------------------------------------------------------------------
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  setDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  writeBatch,
  serverTimestamp,
  Timestamp,
  Bytes,
} from 'firebase/firestore';

const PROJECT_ID = 'demo-nexus-itam';
let env;

const USERS = {
  owner1: { tenantId: 'acme', role: 'owner', status: 'active', email: 'owner@acme.com' },
  admin1: { tenantId: 'acme', role: 'admin', status: 'active', email: 'admin@acme.com' },
  manager1: { tenantId: 'acme', role: 'manager', status: 'active', email: 'manager@acme.com' },
  member1: { tenantId: 'acme', role: 'member', status: 'active', email: 'member@acme.com' },
  op1: { tenantId: 'acme', role: 'operator', status: 'active', email: 'op@acme.com' },
  viewer1: { tenantId: 'acme', role: 'viewer', status: 'active', email: 'viewer@acme.com' },
  blocked1: { tenantId: 'acme', role: 'operator', status: 'suspended', email: 'blocked@acme.com' },
  betaOwner: { tenantId: 'beta', role: 'owner', status: 'active', email: 'owner@beta.com' },
  suspOwner: { tenantId: 'susp', role: 'owner', status: 'active', email: 'owner@susp.com' },
  master: { tenantId: 'nexus-master', role: 'superadmin', status: 'active', email: 'root@nexus.com' },
};

/** Firestore autenticado como um usuario (sem custom claims: cai no perfil). */
const as = (uid, email = USERS[uid]?.email) => env.authenticatedContext(uid, { email }).firestore();
const anon = () => env.unauthenticatedContext().firestore();

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(process.env.RULES_FILE || 'firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const seed = [
      ['tenants/acme', { id: 'acme', companyName: 'ACME', plan: 'starter', status: 'active', ownerUid: 'owner1' }],
      ['tenants/beta', { id: 'beta', companyName: 'Beta', plan: 'pro', status: 'active', ownerUid: 'betaOwner' }],
      ['tenants/susp', { id: 'susp', companyName: 'Suspensa', plan: 'pro', status: 'suspended', ownerUid: 'suspOwner' }],
      ['settings/acme', { companyName: 'ACME' }],
      ['tenantSecrets/acme', { agentToken: 'tok-acme' }],
      ['tenantSecrets/susp', { agentToken: 'tok-susp' }],
      ['tenantInternal/acme', { notes: 'cliente estrategico' }],
      ['assets/a1', { tenantId: 'acme', model: 'Notebook' }],
      ['assets/b1', { tenantId: 'beta', model: 'Desktop' }],
      ['assets/s1', { tenantId: 'susp', model: 'Impressora' }],
      ['agentInbox/in1', { tenantId: 'acme', status: 'pending', agentToken: 'tok-acme' }],
      ['agentInbox/beta_dev1', { tenantId: 'beta', status: 'processed', deviceKey: 'dev1' }],
      ['assetInventory/a1', { tenantId: 'acme', assetId: 'a1', inventory: { hostname: 'PC' } }],
      ['audits/au1', { tenantId: 'acme', location: 'Loja', status: 'Parcial', stats: { expected: 2, found: 1 } }],
      ['terms/tr1', { tenantId: 'acme', kind: 'responsabilidade', number: 'TR-2026-0001', status: 'pendente', assets: [{ id: 'a1' }], assetIds: ['a1'] }],
      ['terms/tt1', { tenantId: 'acme', kind: 'transferencia', number: 'TT-2026-0003', status: 'em_transito', assets: [{ id: 'a1' }], assetIds: ['a1'] }],
      ['terms/tr2', { tenantId: 'acme', kind: 'responsabilidade', number: 'TR-2026-0002', status: 'assinado', assets: [{ id: 'a1' }], assetIds: ['a1'], signedCopy: { fileId: 'f0', chunks: 1 } }],
      ['termFiles/f0_0', { tenantId: 'acme', termId: 'tr2', fileId: 'f0', index: 0, total: 1, contentType: 'application/pdf', size: 3 }],
      ['termCounters/acme/years/2026', { transferencia: 3, responsabilidade: 1 }],
      ['invites/inv1', { tenantId: 'acme', email: 'novo@acme.com', role: 'operator', status: 'pending' }],
      ['invites/expired', {
        tenantId: 'acme', email: 'atrasado@acme.com', role: 'operator', status: 'pending',
        expiresAt: Timestamp.fromDate(new Date('2020-01-01')),
      }],
    ];
    for (const [path, data] of seed) await setDoc(doc(db, path), data);
    for (const [uid, data] of Object.entries(USERS)) await setDoc(doc(db, 'users', uid), { id: uid, ...data });
  });
});

// -----------------------------------------------------------------------------
describe('entrada de novos membros', () => {
  it('permite fundar uma empresa nova com o proprio perfil de owner', async () => {
    const db = as('founder', 'founder@newco.com');
    const batch = writeBatch(db);
    batch.set(doc(db, 'tenants', 'newco-abc123'), {
      id: 'newco-abc123', companyName: 'NewCo', ownerUid: 'founder', plan: 'starter', status: 'active',
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'users', 'founder'), {
      id: 'founder', email: 'founder@newco.com', name: 'Fundador', tenantId: 'newco-abc123', role: 'owner', status: 'active',
    });
    await assertSucceeds(batch.commit());
  });

  it('BLOQUEIA conta nova que se declara owner de empresa existente', async () => {
    // Falha critica anterior: bastava gravar o tenantId de outra empresa.
    const db = as('attacker', 'x@evil.com');
    await assertFails(setDoc(doc(db, 'users', 'attacker'), { tenantId: 'acme', role: 'owner', status: 'active' }));
    await assertFails(setDoc(doc(db, 'users', 'attacker'), { tenantId: 'acme', role: 'viewer', status: 'active' }));
  });

  it('BLOQUEIA sequestro de empresa existente via batch de "fundacao"', async () => {
    const db = as('attacker', 'x@evil.com');
    const batch = writeBatch(db);
    batch.set(doc(db, 'tenants', 'acme'), { id: 'acme', companyName: 'ACME', ownerUid: 'attacker', plan: 'starter', status: 'active' });
    batch.set(doc(db, 'users', 'attacker'), { tenantId: 'acme', role: 'owner', status: 'active' });
    await assertFails(batch.commit());
  });

  it('BLOQUEIA autocadastro em plano pago ou com limites proprios', async () => {
    const db = as('founder', 'founder@newco.com');
    await assertFails(setDoc(doc(db, 'tenants', 'rich-1'), {
      id: 'rich-1', companyName: 'Rich', ownerUid: 'founder', plan: 'enterprise', status: 'active',
    }));
    await assertFails(setDoc(doc(db, 'tenants', 'rich-2'), {
      id: 'rich-2', companyName: 'Rich', ownerUid: 'founder', plan: 'starter', status: 'active', overrides: { maxAssets: 999999 },
    }));
  });

  it('BLOQUEIA quem ja pertence a uma empresa de fundar outra', async () => {
    const db = as('op1');
    await assertFails(setDoc(doc(db, 'tenants', 'side-1'), {
      id: 'side-1', companyName: 'Paralela', ownerUid: 'op1', plan: 'starter', status: 'active',
    }));
  });

  it('aceita convite pendente endereçado ao e-mail autenticado', async () => {
    const db = as('novo', 'novo@acme.com');
    const batch = writeBatch(db);
    batch.set(doc(db, 'users', 'novo'), {
      id: 'novo', email: 'novo@acme.com', tenantId: 'acme', role: 'operator', status: 'active', inviteId: 'inv1',
    });
    batch.update(doc(db, 'invites', 'inv1'), { status: 'accepted', acceptedBy: 'novo', acceptedAt: serverTimestamp() });
    await assertSucceeds(batch.commit());
  });

  it('BLOQUEIA convite usado com papel acima do convidado', async () => {
    const db = as('novo', 'novo@acme.com');
    const batch = writeBatch(db);
    batch.set(doc(db, 'users', 'novo'), { tenantId: 'acme', role: 'owner', status: 'active', inviteId: 'inv1' });
    batch.update(doc(db, 'invites', 'inv1'), { status: 'accepted', acceptedBy: 'novo', acceptedAt: serverTimestamp() });
    await assertFails(batch.commit());
  });

  it('BLOQUEIA convite usado por outro e-mail', async () => {
    const db = as('intruso', 'intruso@evil.com');
    const batch = writeBatch(db);
    batch.set(doc(db, 'users', 'intruso'), { tenantId: 'acme', role: 'operator', status: 'active', inviteId: 'inv1' });
    batch.update(doc(db, 'invites', 'inv1'), { status: 'accepted', acceptedBy: 'intruso', acceptedAt: serverTimestamp() });
    await assertFails(batch.commit());
  });

  it('BLOQUEIA convite expirado', async () => {
    const db = as('atrasado', 'atrasado@acme.com');
    const batch = writeBatch(db);
    batch.set(doc(db, 'users', 'atrasado'), { tenantId: 'acme', role: 'operator', status: 'active', inviteId: 'expired' });
    batch.update(doc(db, 'invites', 'expired'), { status: 'accepted', acceptedBy: 'atrasado', acceptedAt: serverTimestamp() });
    await assertFails(batch.commit());
  });

  it('BLOQUEIA perfil criado com convite sem consumir o convite', async () => {
    const db = as('novo', 'novo@acme.com');
    await assertFails(setDoc(doc(db, 'users', 'novo'), { tenantId: 'acme', role: 'operator', status: 'active', inviteId: 'inv1' }));
  });

  it('o convidado le o proprio convite; terceiros nao', async () => {
    await assertSucceeds(getDoc(doc(as('novo', 'novo@acme.com'), 'invites', 'inv1')));
    await assertFails(getDoc(doc(as('curioso', 'curioso@x.com'), 'invites', 'inv1')));
    await assertFails(getDoc(doc(anon(), 'invites', 'inv1')));
  });
});

// -----------------------------------------------------------------------------
describe('gestao de papeis', () => {
  it('BLOQUEIA admin se promovendo a owner', async () => {
    await assertFails(updateDoc(doc(as('admin1'), 'users', 'admin1'), { role: 'owner' }));
  });

  it('BLOQUEIA admin rebaixando ou removendo o owner', async () => {
    await assertFails(updateDoc(doc(as('admin1'), 'users', 'owner1'), { role: 'viewer' }));
    await assertFails(deleteDoc(doc(as('admin1'), 'users', 'owner1')));
  });

  it('BLOQUEIA admin criando outro admin', async () => {
    await assertFails(updateDoc(doc(as('admin1'), 'users', 'op1'), { role: 'admin' }));
  });

  it('admin gerencia papeis abaixo do seu', async () => {
    await assertSucceeds(updateDoc(doc(as('admin1'), 'users', 'op1'), { role: 'manager' }));
    await assertSucceeds(updateDoc(doc(as('admin1'), 'users', 'op1'), { status: 'suspended' }));
  });

  it('owner promove a admin', async () => {
    await assertSucceeds(updateDoc(doc(as('owner1'), 'users', 'op1'), { role: 'admin' }));
  });

  it('ninguem altera o proprio papel ou status e respeita allowlist', async () => {
    await assertFails(updateDoc(doc(as('op1'), 'users', 'op1'), { role: 'manager' }));
    await assertFails(updateDoc(doc(as('blocked1'), 'users', 'blocked1'), { status: 'active' }));
    await assertFails(updateDoc(doc(as('blocked1'), 'users', 'blocked1'), { name: 'Troca' }));
    await assertFails(updateDoc(doc(as('op1'), 'users', 'op1'), { arbitraryField: 'bad' }));
    await assertSucceeds(updateDoc(doc(as('op1'), 'users', 'op1'), { name: 'Novo Nome', theme: 'dark' }));
  });

  it('BLOQUEIA admin convidando owner/admin', async () => {
    const db = as('admin1');
    await assertFails(setDoc(doc(db, 'invites', 'x1'), { tenantId: 'acme', email: 'a@acme.com', role: 'owner', status: 'pending' }));
    await assertFails(setDoc(doc(db, 'invites', 'x2'), { tenantId: 'acme', email: 'a@acme.com', role: 'admin', status: 'pending' }));
    await assertSucceeds(setDoc(doc(db, 'invites', 'x3'), { tenantId: 'acme', email: 'a@acme.com', role: 'operator', status: 'pending' }));
  });

  it('BLOQUEIA convite para outra empresa', async () => {
    await assertFails(setDoc(doc(as('owner1'), 'invites', 'x4'), { tenantId: 'beta', email: 'a@beta.com', role: 'viewer', status: 'pending' }));
  });
});

// -----------------------------------------------------------------------------
describe('suspensao e isolamento', () => {
  it('usuario suspenso perde acesso aos dados, mas le o proprio perfil', async () => {
    const db = as('blocked1');
    await assertFails(getDoc(doc(db, 'assets', 'a1')));
    await assertFails(setDoc(doc(db, 'assets', 'nova'), { tenantId: 'acme', model: 'X' }));
    await assertSucceeds(getDoc(doc(db, 'users', 'blocked1')));
  });

  it('empresa suspensa perde acesso aos dados, mas le o proprio cadastro', async () => {
    const db = as('suspOwner');
    await assertFails(getDoc(doc(db, 'assets', 's1')));
    await assertFails(getDocs(query(collection(db, 'assets'), where('tenantId', '==', 'susp'))));
    await assertSucceeds(getDoc(doc(db, 'tenants', 'susp')));
  });

  it('isola dados entre empresas', async () => {
    await assertSucceeds(getDoc(doc(as('owner1'), 'assets', 'a1')));
    await assertFails(getDoc(doc(as('owner1'), 'assets', 'b1')));
    await assertFails(getDocs(query(collection(as('owner1'), 'assets'), where('tenantId', '==', 'beta'))));
  });

  it('viewer le mas nao grava', async () => {
    await assertSucceeds(getDoc(doc(as('viewer1'), 'assets', 'a1')));
    await assertFails(setDoc(doc(as('viewer1'), 'assets', 'v1'), { tenantId: 'acme', model: 'X' }));
  });

  it('exclusao de ativo exige gestor', async () => {
    await assertFails(deleteDoc(doc(as('op1'), 'assets', 'a1')));
    await assertSucceeds(deleteDoc(doc(as('manager1'), 'assets', 'a1')));
  });

  it('BLOQUEIA mover ativo para outra empresa', async () => {
    await assertFails(updateDoc(doc(as('owner1'), 'assets', 'a1'), { tenantId: 'beta' }));
  });

  it('aplica RBAC por papel minimo em colecoes operacionais', async () => {
    // employees e projects: member+
    await assertFails(setDoc(doc(as('op1'), 'employees', 'e1'), { tenantId: 'acme', name: 'Fulano' }));
    await assertSucceeds(setDoc(doc(as('member1'), 'employees', 'e1'), { tenantId: 'acme', name: 'Fulano' }));
    await assertFails(setDoc(doc(as('op1'), 'projects', 'p1'), { tenantId: 'acme', name: 'Proj' }));
    await assertSucceeds(setDoc(doc(as('member1'), 'projects', 'p1'), { tenantId: 'acme', name: 'Proj' }));

    // contracts: manager+
    await assertFails(setDoc(doc(as('member1'), 'contracts', 'c1'), { tenantId: 'acme', title: 'Contrato' }));
    await assertSucceeds(setDoc(doc(as('manager1'), 'contracts', 'c1'), { tenantId: 'acme', title: 'Contrato' }));

    // tasks: operator+
    await assertFails(setDoc(doc(as('viewer1'), 'tasks', 't1'), { tenantId: 'acme', title: 'Tarefa' }));
    await assertSucceeds(setDoc(doc(as('op1'), 'tasks', 't1'), { tenantId: 'acme', title: 'Tarefa' }));
  });
});

// -----------------------------------------------------------------------------
describe('empresa, configuracoes e segredos', () => {
  it('owner renomeia a empresa, mas nao troca plano, status ou limites', async () => {
    const db = as('owner1');
    await assertSucceeds(updateDoc(doc(db, 'tenants', 'acme'), { companyName: 'ACME S.A.' }));
    await assertFails(updateDoc(doc(db, 'tenants', 'acme'), { plan: 'enterprise' }));
    await assertFails(updateDoc(doc(db, 'tenants', 'acme'), { status: 'active', overrides: { maxAssets: 1 } }));
  });

  it('master altera plano e ajustes da empresa', async () => {
    await assertSucceeds(updateDoc(doc(as('master'), 'tenants', 'acme'), { plan: 'pro', overrides: { maxAssets: 5000 } }));
  });

  it('anotacoes internas sao exclusivas do master', async () => {
    await assertFails(getDoc(doc(as('owner1'), 'tenantInternal', 'acme')));
    await assertSucceeds(getDoc(doc(as('master'), 'tenantInternal', 'acme')));
  });

  it('owner grava identidade visual; admin so as chaves do agente', async () => {
    await assertSucceeds(setDoc(doc(as('owner1'), 'settings', 'acme'), { primaryColor: '#FF0000' }, { merge: true }));
    await assertFails(setDoc(doc(as('admin1'), 'settings', 'acme'), { primaryColor: '#000000' }, { merge: true }));
    await assertSucceeds(setDoc(doc(as('admin1'), 'settings', 'acme'), { agentNaming: { companyPrefix: 'ACM' }, trustedIps: '10.0.' }, { merge: true }));
    await assertFails(setDoc(doc(as('admin1'), 'settings', 'acme'), { agentToken: 'vazado' }, { merge: true }));
    await assertSucceeds(setDoc(doc(as('admin1'), 'settings', 'acme'), { agentPolicy: { blockedSoftware: ['utorrent'], staleDays: 10 } }, { merge: true }));
  });

  it('segredo do agente e restrito a owner/admin da propria empresa (nem o master le)', async () => {
    await assertSucceeds(getDoc(doc(as('admin1'), 'tenantSecrets', 'acme')));
    await assertFails(getDoc(doc(as('op1'), 'tenantSecrets', 'acme')));
    await assertFails(getDoc(doc(as('betaOwner'), 'tenantSecrets', 'acme')));
    await assertFails(getDoc(doc(as('master'), 'tenantSecrets', 'acme')));
  });

  it('caixa do agente (que carrega o token) nao e legivel por operador', async () => {
    await assertFails(getDoc(doc(as('op1'), 'agentInbox', 'in1')));
    await assertSucceeds(getDoc(doc(as('manager1'), 'agentInbox', 'in1')));
  });
});

// -----------------------------------------------------------------------------
// Agente: maquina autenticada (login anonimo) matriculada em uma empresa.
const agentAs = (uid) =>
  env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous', identities: {} } }).firestore();
const proofFor = (token, uid) => createHash('sha256').update(`${token}:${uid}`).digest('hex');
const enrollment = (uid, extra = {}) => ({
  tenantId: 'acme',
  deviceKey: 'dev01',
  tokenProof: proofFor('tok-acme', uid),
  hostname: 'SHL-BEL-NTB-001',
  agentVersion: '3.1.0',
  createdAt: Timestamp.now(),
  ...extra,
});

/** Matricula pronta (sem passar pelas regras) para os testes de canal. */
const seedEnrollment = (uid, extra = {}) =>
  env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'agentEnrollments', uid), enrollment(uid, extra)));

const seedPolicy = (data) =>
  env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'agentPolicies', 'acme'), data));

describe('agente: conta anonima nunca e pessoa', () => {
  it('nao le planos, perfis nem cria empresa', async () => {
    const db = agentAs('agentA');
    await assertFails(getDocs(collection(db, 'plans')));
    await assertFails(getDoc(doc(db, 'users', 'owner1')));
    await assertFails(setDoc(doc(db, 'tenants', 'nova'), {
      id: 'nova', companyName: 'Nova', ownerUid: 'agentA', plan: 'starter', status: 'active',
    }));
  });
});

describe('agente: matricula da maquina (NexusAgent.exe)', () => {
  it('matricula com prova do token sem gravar o token', async () => {
    await assertSucceeds(setDoc(doc(agentAs('agentA'), 'agentEnrollments', 'agentA'), enrollment('agentA')));
    await assertSucceeds(getDoc(doc(agentAs('agentA'), 'agentEnrollments', 'agentA')));
  });

  it('BLOQUEIA prova errada, prova de outra conta ou token em texto', async () => {
    await assertFails(setDoc(doc(agentAs('agentA'), 'agentEnrollments', 'agentA'), enrollment('agentA', { tokenProof: proofFor('chute', 'agentA') })));
    await assertFails(setDoc(doc(agentAs('agentA'), 'agentEnrollments', 'agentA'), enrollment('agentA', { tokenProof: proofFor('tok-acme', 'agentB') })));
    await assertFails(setDoc(doc(agentAs('agentA'), 'agentEnrollments', 'agentA'), { ...enrollment('agentA'), agentToken: 'tok-acme' }));
  });

  it('BLOQUEIA matricular outra conta, pessoa logada ou empresa suspensa', async () => {
    await assertFails(setDoc(doc(agentAs('agentA'), 'agentEnrollments', 'agentB'), enrollment('agentB')));
    await assertFails(setDoc(doc(as('admin1'), 'agentEnrollments', 'admin1'), enrollment('admin1')));
    await assertFails(setDoc(doc(agentAs('agentS'), 'agentEnrollments', 'agentS'), enrollment('agentS', {
      tenantId: 'susp', tokenProof: proofFor('tok-susp', 'agentS'),
    })));
  });

  it('BLOQUEIA chave de maquina que invade o espaco de IDs de outra empresa', async () => {
    await assertFails(setDoc(doc(agentAs('agentA'), 'agentEnrollments', 'agentA'), enrollment('agentA', { deviceKey: 'corp_dev01' })));
  });

  it('admin da empresa lista e revoga; gestor, outra empresa e master nao', async () => {
    await seedEnrollment('agentA');
    const list = (db) => getDocs(query(collection(db, 'agentEnrollments'), where('tenantId', '==', 'acme')));
    await assertSucceeds(list(as('admin1')));
    await assertFails(list(as('manager1')));
    await assertFails(getDoc(doc(as('betaOwner'), 'agentEnrollments', 'agentA')));
    await assertFails(getDoc(doc(as('master'), 'agentEnrollments', 'agentA')));
    await assertFails(deleteDoc(doc(as('master'), 'agentEnrollments', 'agentA')));
    await assertSucceeds(deleteDoc(doc(as('admin1'), 'agentEnrollments', 'agentA')));
  });

  it('o proprio agente se desmatricula ao desinstalar', async () => {
    await seedEnrollment('agentA');
    await assertFails(deleteDoc(doc(agentAs('agentB'), 'agentEnrollments', 'agentA')));
    await assertSucceeds(deleteDoc(doc(agentAs('agentA'), 'agentEnrollments', 'agentA')));
  });
});

// -----------------------------------------------------------------------------
describe('agente: caixa de entrada (scripts com token e exe matriculado)', () => {
  const submission = (tenantId, agentToken) => ({
    tenantId, agentToken, status: 'pending', hostname: 'PC-01', createdAt: new Date().toISOString(), payload: { hostname: 'PC-01' },
  });
  const v2 = (extra = {}) => ({
    ...submission('acme', 'tok-acme'), deviceKey: 'abc123', agentVersion: '2.0.0', createdAt: Timestamp.now(), ...extra,
  });
  const enrolled = (extra = {}) => ({
    tenantId: 'acme', deviceKey: 'dev01', status: 'pending', source: 'agent-windows-exe', agentVersion: '3.1.0',
    hostname: 'PC-01', createdAt: Timestamp.now(), payload: { hostname: 'PC-01' }, ...extra,
  });

  it('aceita envio com o token correto', async () => {
    await assertSucceeds(setDoc(doc(anon(), 'agentInbox', 'ok1'), submission('acme', 'tok-acme')));
  });

  it('recusa token errado', async () => {
    await assertFails(setDoc(doc(anon(), 'agentInbox', 'bad1'), submission('acme', 'chute')));
  });

  it('recusa envio de empresa suspensa', async () => {
    await assertFails(setDoc(doc(anon(), 'agentInbox', 'susp1'), submission('susp', 'tok-susp')));
  });

  it('2.x: um documento por maquina, regravado a cada coleta', async () => {
    await assertSucceeds(setDoc(doc(anon(), 'agentInbox', 'acme_abc123'), v2()));
    await assertSucceeds(setDoc(doc(anon(), 'agentInbox', 'acme_abc123'), v2({ hostname: 'PC-01-NOVO' })));
  });

  it('2.x: ID precisa ser a maquina da propria empresa', async () => {
    await assertFails(setDoc(doc(anon(), 'agentInbox', 'acme_outro'), v2()));
    await assertFails(setDoc(doc(anon(), 'agentInbox', 'beta_dev1'), v2({ deviceKey: 'dev1' })));
  });

  it('BLOQUEIA "_" na chave: acme + corp_1 nao ocupa o ID da empresa acme_corp', async () => {
    await assertFails(setDoc(doc(anon(), 'agentInbox', 'acme_corp_1'), v2({ deviceKey: 'corp_1' })));
  });

  it('formato fechado: sem campos extras nem status ja processado', async () => {
    await assertFails(setDoc(doc(anon(), 'agentInbox', 'x1'), { ...submission('acme', 'tok-acme'), result: { action: 'created' } }));
    await assertFails(setDoc(doc(anon(), 'agentInbox', 'x2'), { ...submission('acme', 'tok-acme'), status: 'processed' }));
    await assertFails(setDoc(doc(anon(), 'agentInbox', 'x3'), { ...submission('acme', 'tok-acme'), payload: 'texto' }));
  });

  it('exe matriculado envia sem token, so para a propria maquina', async () => {
    await seedEnrollment('agentA');
    await assertSucceeds(setDoc(doc(agentAs('agentA'), 'agentInbox', 'acme_dev01'), enrolled()));
    await assertFails(setDoc(doc(agentAs('agentA'), 'agentInbox', 'acme_dev02'), enrolled({ deviceKey: 'dev02' })));
    await assertFails(setDoc(doc(agentAs('agentA'), 'agentInbox', 'beta_dev01'), enrolled({ tenantId: 'beta' })));
    await assertFails(setDoc(doc(agentAs('naoMatriculado'), 'agentInbox', 'acme_dev01'), enrolled()));
  });

  it('ninguem sem gestao le a fila; master tambem nao', async () => {
    await assertFails(getDoc(doc(anon(), 'agentInbox', 'in1')));
    await seedEnrollment('agentA');
    await assertFails(getDoc(doc(agentAs('agentA'), 'agentInbox', 'in1')));
    await assertFails(getDoc(doc(as('master'), 'agentInbox', 'in1')));
  });
});

// -----------------------------------------------------------------------------
describe('agente: telemetria (agentDevices)', () => {
  const devicePayload = (extra = {}) => ({
    tenantId: 'acme',
    deviceKey: 'dev01',
    accessId: '842 910 305',
    hostname: 'SHL-BEL-NTB-001',
    status: 'online',
    metrics: { cpuPercent: 18, ramPercent: 54, diskPercent: 41 },
    lastSeenAt: serverTimestamp(),
    ...extra,
  });

  it('maquina matriculada grava a propria telemetria e o frame da sessao', async () => {
    await seedEnrollment('agentA');
    await assertSucceeds(setDoc(doc(agentAs('agentA'), 'agentDevices', 'acme_dev01'), devicePayload()));
    await assertSucceeds(setDoc(doc(agentAs('agentA'), 'agentDevices', 'acme_dev01'), devicePayload({ screenFrame: { data: 'base64jpeg', seq: 1 } })));
  });

  it('BLOQUEIA outra maquina, outra empresa, token no documento e quem nao e agente', async () => {
    await seedEnrollment('agentA');
    await assertFails(setDoc(doc(agentAs('agentA'), 'agentDevices', 'acme_dev02'), devicePayload({ deviceKey: 'dev02' })));
    await assertFails(setDoc(doc(agentAs('agentA'), 'agentDevices', 'beta_dev01'), devicePayload({ tenantId: 'beta' })));
    await assertFails(setDoc(doc(agentAs('agentA'), 'agentDevices', 'acme_dev01'), devicePayload({ agentToken: 'tok-acme' })));
    await assertFails(setDoc(doc(anon(), 'agentDevices', 'acme_dev01'), devicePayload()));
    await assertFails(setDoc(doc(agentAs('naoMatriculado'), 'agentDevices', 'acme_dev01'), devicePayload()));
  });

  it('maquina revogada ou de empresa suspensa para de gravar', async () => {
    await seedEnrollment('agentA');
    await env.withSecurityRulesDisabled((ctx) => deleteDoc(doc(ctx.firestore(), 'agentEnrollments', 'agentA')));
    await assertFails(setDoc(doc(agentAs('agentA'), 'agentDevices', 'acme_dev01'), devicePayload()));
    await seedEnrollment('agentS', { tenantId: 'susp', tokenProof: proofFor('tok-susp', 'agentS') });
    await assertFails(setDoc(doc(agentAs('agentS'), 'agentDevices', 'susp_dev01'), devicePayload({ tenantId: 'susp' })));
  });

  it('so a gestao da empresa le; operador, outra empresa e master nao', async () => {
    await seedEnrollment('agentA');
    await setDoc(doc(agentAs('agentA'), 'agentDevices', 'acme_dev01'), devicePayload());
    await assertSucceeds(getDoc(doc(as('manager1'), 'agentDevices', 'acme_dev01')));
    await assertFails(getDoc(doc(anon(), 'agentDevices', 'acme_dev01')));
    await assertFails(getDoc(doc(as('op1'), 'agentDevices', 'acme_dev01')));
    await assertFails(getDoc(doc(as('betaOwner'), 'agentDevices', 'acme_dev01')));
    await assertFails(getDoc(doc(as('master'), 'agentDevices', 'acme_dev01')));
  });

  it('gestor apaga o token deixado por agentes 3.0; operador nao', async () => {
    await env.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), 'agentDevices', 'acme_old30'), { tenantId: 'acme', deviceKey: 'old30', agentToken: 'tok-acme', status: 'online' }));
    await assertFails(updateDoc(doc(as('op1'), 'agentDevices', 'acme_old30'), { agentToken: deleteField() }));
    await assertSucceeds(updateDoc(doc(as('manager1'), 'agentDevices', 'acme_old30'), { agentToken: deleteField() }));
  });

  it('gestor "acorda" a maquina; o agente segue gravando com o campo do console', async () => {
    await seedEnrollment('agentA');
    await setDoc(doc(agentAs('agentA'), 'agentDevices', 'acme_dev01'), devicePayload());
    await assertSucceeds(updateDoc(doc(as('manager1'), 'agentDevices', 'acme_dev01'), { consoleWakeAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(as('manager1'), 'agentDevices', 'acme_dev01'), { deviceKey: 'dev02' }));
    await assertSucceeds(updateDoc(doc(agentAs('agentA'), 'agentDevices', 'acme_dev01'), { status: 'online', lastSeenAt: serverTimestamp() }));
  });
});

// -----------------------------------------------------------------------------
describe('agente: comandos e acesso remoto (agentControl)', () => {
  const auditEntry = (id, action, by = 'manager1', extra = {}) => [
    doc(as(by), 'agentAudit', id),
    { tenantId: 'acme', deviceKey: 'dev01', hostname: 'PC-01', action, detail: 'detalhe', mode: '', byUid: by, byName: 'Gestor', at: serverTimestamp(), ...extra },
  ];

  /** Comando + auditoria no mesmo batch, como o console faz. */
  const sendCommand = (by = 'manager1', { cmd = {}, audit = true, auditBy = by } = {}) => {
    const db = as(by);
    const batch = writeBatch(db);
    const id = cmd.id || 'cmd-1';
    if (audit) {
      const [, data] = auditEntry(id, 'command', auditBy);
      batch.set(doc(db, 'agentAudit', id), data);
    }
    batch.set(doc(db, 'agentControl', 'acme_dev01'), {
      tenantId: 'acme',
      deviceKey: 'dev01',
      updatedAt: serverTimestamp(),
      pendingCommand: { id, type: 'powershell', command: 'ipconfig', requestedByUid: by, issuedAt: serverTimestamp(), ...cmd },
    }, { merge: true });
    return batch.commit();
  };

  const openSession = (by = 'manager1', { mode = 'attended', sessionId = 'rem-1', audit = true } = {}) => {
    const db = as(by);
    const batch = writeBatch(db);
    if (audit) {
      const [, data] = auditEntry(sessionId, 'remote_request', by, { mode });
      batch.set(doc(db, 'agentAudit', sessionId), data);
    }
    batch.set(doc(db, 'agentControl', 'acme_dev01'), {
      tenantId: 'acme',
      deviceKey: 'dev01',
      remoteSession: { sessionId, status: 'requesting', mode, requestedByUid: by, requestedBy: 'Gestor', inputEvents: [] },
    }, { merge: true });
    return batch.commit();
  };

  it('gestor envia comando auditado; sem auditoria, auditoria de outro ou hora do cliente nao', async () => {
    await assertSucceeds(sendCommand());
    await assertFails(sendCommand('manager1', { cmd: { id: 'cmd-2' }, audit: false }));
    await assertFails(sendCommand('manager1', { cmd: { id: 'cmd-3', requestedByUid: 'admin1' } }));
    await assertFails(sendCommand('manager1', { cmd: { id: 'cmd-4', issuedAt: Timestamp.fromDate(new Date('2024-01-01')) } }));
  });

  it('comando reaproveitando auditoria antiga nao passa', async () => {
    await assertSucceeds(sendCommand('manager1', { cmd: { id: 'cmd-1' } }));
    await assertSucceeds(updateDoc(doc(as('manager1'), 'agentControl', 'acme_dev01'), { updatedAt: serverTimestamp() }));
    await assertFails(sendCommand('manager1', { cmd: { id: 'cmd-1', command: 'outra coisa' }, audit: false }));
  });

  it('empresa que desliga comandos remotos bloqueia o envio', async () => {
    await seedPolicy({ remoteAccess: 'consent', commandsEnabled: false, heartbeatSeconds: 120 });
    await assertFails(sendCommand());
  });

  it('operador, outra empresa e master nao comandam maquinas', async () => {
    await assertFails(sendCommand('op1'));
    await assertFails(sendCommand('betaOwner'));
    await assertFails(sendCommand('master'));
  });

  it('sessao com consentimento e o padrao; sem supervisao so se a empresa liberar', async () => {
    await assertSucceeds(openSession('manager1', { mode: 'attended', sessionId: 'rem-1' }));
    await assertFails(openSession('manager1', { mode: 'unattended', sessionId: 'rem-2' }));
    await seedPolicy({ remoteAccess: 'unattended', commandsEnabled: true, heartbeatSeconds: 120 });
    await assertSucceeds(openSession('manager1', { mode: 'unattended', sessionId: 'rem-3' }));
  });

  it('acesso remoto desligado bloqueia qualquer sessao, mas encerrar sempre pode', async () => {
    await assertSucceeds(openSession('manager1', { sessionId: 'rem-1' }));
    await seedPolicy({ remoteAccess: 'disabled', commandsEnabled: true, heartbeatSeconds: 120 });
    await assertFails(openSession('manager1', { sessionId: 'rem-2' }));
    await assertSucceeds(setDoc(doc(as('manager1'), 'agentControl', 'acme_dev01'), {
      tenantId: 'acme', deviceKey: 'dev01', remoteSession: { sessionId: '', status: 'closed', inputEvents: [] },
    }, { merge: true }));
  });

  it('sessao nova exige auditoria; eventos da mesma sessao nao', async () => {
    await assertFails(openSession('manager1', { sessionId: 'rem-9', audit: false }));
    await assertSucceeds(openSession('manager1', { sessionId: 'rem-1' }));
    await assertSucceeds(setDoc(doc(as('manager1'), 'agentControl', 'acme_dev01'), {
      remoteSession: { sessionId: 'rem-1', status: 'active', mode: 'attended', requestedByUid: 'manager1', inputEvents: [{ seq: 1, type: 'click', x: 0.5, y: 0.5 }] },
    }, { merge: true }));
  });

  it('so a propria maquina le o canal; outra maquina, anonimo e master nao', async () => {
    await assertSucceeds(sendCommand());
    await seedEnrollment('agentA');
    await seedEnrollment('agentB', { deviceKey: 'dev02' });
    await assertSucceeds(getDoc(doc(agentAs('agentA'), 'agentControl', 'acme_dev01')));
    await assertFails(getDoc(doc(agentAs('agentB'), 'agentControl', 'acme_dev01')));
    await assertFails(getDoc(doc(anon(), 'agentControl', 'acme_dev01')));
    await assertFails(getDoc(doc(as('master'), 'agentControl', 'acme_dev01')));
    await assertFails(updateDoc(doc(agentAs('agentA'), 'agentControl', 'acme_dev01'), { remoteSession: { status: 'closed' } }));
  });

  it('canal inexistente: o agente recebe "nao existe" em vez de erro', async () => {
    await seedEnrollment('agentA');
    await assertSucceeds(getDoc(doc(agentAs('agentA'), 'agentControl', 'acme_semcanal')));
  });

  it('formato fechado: token nao entra no canal', async () => {
    await assertFails(setDoc(doc(as('manager1'), 'agentControl', 'acme_dev01'), {
      tenantId: 'acme', deviceKey: 'dev01', agentToken: 'tok-acme',
    }));
  });
});

// -----------------------------------------------------------------------------
describe('agente: politica e trilha de acessos', () => {
  const policy = (extra = {}) => ({
    remoteAccess: 'consent', commandsEnabled: true, heartbeatSeconds: 120, updatedAt: serverTimestamp(), updatedBy: 'Admin', ...extra,
  });

  it('admin grava a politica; gestor e master nao; valores fora da faixa nao', async () => {
    await assertSucceeds(setDoc(doc(as('admin1'), 'agentPolicies', 'acme'), policy({ updatedByUid: 'admin1' })));
    await assertFails(setDoc(doc(as('manager1'), 'agentPolicies', 'acme'), policy({ updatedByUid: 'manager1' })));
    await assertFails(setDoc(doc(as('master'), 'agentPolicies', 'acme'), policy({ updatedByUid: 'master' })));
    await assertFails(setDoc(doc(as('admin1'), 'agentPolicies', 'acme'), policy({ updatedByUid: 'admin1', remoteAccess: 'sempre' })));
    await assertFails(setDoc(doc(as('admin1'), 'agentPolicies', 'acme'), policy({ updatedByUid: 'admin1', heartbeatSeconds: 5 })));
  });

  it('maquinas da empresa leem a politica; de outra empresa nao', async () => {
    await seedPolicy(policy({ updatedByUid: 'admin1' }));
    await seedEnrollment('agentA');
    await seedEnrollment('agentX', { tenantId: 'beta', tokenProof: 'x' });
    await assertSucceeds(getDoc(doc(agentAs('agentA'), 'agentPolicies', 'acme')));
    await assertFails(getDoc(doc(agentAs('agentX'), 'agentPolicies', 'acme')));
  });

  it('trilha: autor e hora do servidor obrigatorios, imutavel, so owner/admin le', async () => {
    const entry = (extra = {}) => ({
      tenantId: 'acme', deviceKey: 'dev01', hostname: 'PC-01', action: 'remote_end', detail: '', mode: '', byUid: 'manager1', byName: 'Gestor', at: serverTimestamp(), ...extra,
    });
    await assertSucceeds(setDoc(doc(as('manager1'), 'agentAudit', 'e1'), entry()));
    await assertFails(setDoc(doc(as('manager1'), 'agentAudit', 'e2'), entry({ byUid: 'admin1' })));
    await assertFails(setDoc(doc(as('manager1'), 'agentAudit', 'e3'), entry({ at: Timestamp.fromDate(new Date('2024-01-01')) })));
    await assertFails(updateDoc(doc(as('admin1'), 'agentAudit', 'e1'), { detail: 'apagado' }));
    await assertFails(deleteDoc(doc(as('owner1'), 'agentAudit', 'e1')));
    await assertSucceeds(getDoc(doc(as('admin1'), 'agentAudit', 'e1')));
    await assertFails(getDoc(doc(as('manager1'), 'agentAudit', 'e1')));
    await assertFails(getDoc(doc(as('master'), 'agentAudit', 'e1')));
  });
});

// -----------------------------------------------------------------------------
describe('inventario das maquinas e trilha de auditoria', () => {
  it('inventario: empresa le, operador grava, outra empresa nao', async () => {
    await assertSucceeds(getDoc(doc(as('viewer1'), 'assetInventory', 'a1')));
    await assertSucceeds(setDoc(doc(as('op1'), 'assetInventory', 'a2'), { tenantId: 'acme', assetId: 'a2', inventory: {} }));
    await assertFails(setDoc(doc(as('op1'), 'assetInventory', 'a3'), { tenantId: 'acme', assetId: 'outro', inventory: {} }));
    await assertFails(getDoc(doc(as('betaOwner'), 'assetInventory', 'a1')));
    await assertFails(getDoc(doc(as('master'), 'assetInventory', 'a1')));
    await assertFails(setDoc(doc(as('viewer1'), 'assetInventory', 'a4'), { tenantId: 'acme', assetId: 'a4', inventory: {} }));
  });

  it('relatorio de auditoria: operador registra, ninguem reescreve, gestor exclui', async () => {
    const audit = (date) => ({ tenantId: 'acme', location: 'Loja', status: 'Completa', stats: { expected: 1, found: 1 }, date });
    await assertSucceeds(setDoc(doc(as('op1'), 'audits', 'au2'), audit(serverTimestamp())));
    await assertFails(setDoc(doc(as('op1'), 'audits', 'au3'), audit(Timestamp.fromDate(new Date('2024-01-01')))));
    await assertFails(updateDoc(doc(as('op1'), 'audits', 'au1'), { status: 'Completa' }));
    await assertFails(updateDoc(doc(as('manager1'), 'audits', 'au1'), { stats: { expected: 2, found: 2 } }));
    await assertFails(deleteDoc(doc(as('op1'), 'audits', 'au1')));
    await assertFails(getDoc(doc(as('betaOwner'), 'audits', 'au1')));
    await assertSucceeds(deleteDoc(doc(as('manager1'), 'audits', 'au1')));
  });

  it('historico so com a data do servidor; owner restaura data antiga', async () => {
    const entry = (date) => ({ tenantId: 'acme', assetId: 'a1', action: 'Teste', user: 'op@acme.com', date });
    await assertSucceeds(setDoc(doc(as('op1'), 'history', 'h1'), entry(serverTimestamp())));
    await assertFails(setDoc(doc(as('op1'), 'history', 'h2'), entry(Timestamp.fromDate(new Date('2024-01-01')))));
    await assertSucceeds(setDoc(doc(as('owner1'), 'history', 'h3'), entry(Timestamp.fromDate(new Date('2024-01-01')))));
  });
});

// -----------------------------------------------------------------------------
describe('termos (responsabilidade, devolucao, transferencia)', () => {
  const novoTermo = (extra = {}) => ({
    tenantId: 'acme', kind: 'transferencia', number: 'TT-2026-0004', status: 'em_transito',
    assets: [{ id: 'a1', internalId: 'NB-1' }], assetIds: ['a1'], ...extra,
  });

  it('operador emite termo e avanca o contador em 1 no mesmo batch', async () => {
    const db = as('op1');
    const batch = writeBatch(db);
    batch.update(doc(db, 'termCounters/acme/years/2026'), { transferencia: 4, updatedAt: serverTimestamp() });
    batch.set(doc(db, 'terms', 'novo'), novoTermo());
    await assertSucceeds(batch.commit());
  });

  it('contador novo comeca em 1', async () => {
    await assertSucceeds(setDoc(doc(as('op1'), 'termCounters/acme/years/2027'), { devolucao: 1 }));
    await assertFails(setDoc(doc(as('op1'), 'termCounters/acme/years/2028'), { devolucao: 50 }));
    await assertFails(setDoc(doc(as('op1'), 'termCounters/acme/years/2029'), { devolucao: -1 }));
    await assertFails(setDoc(doc(as('op1'), 'termCounters/acme/years/2029'), { devolucao: '1' }));
  });

  it('BLOQUEIA pular numeracao ou mexer no contador de outra empresa', async () => {
    await assertFails(updateDoc(doc(as('op1'), 'termCounters/acme/years/2026'), { transferencia: 9 }));
    await assertFails(updateDoc(doc(as('op1'), 'termCounters/acme/years/2026'), { transferencia: 2 }));
    await assertFails(setDoc(doc(as('betaOwner'), 'termCounters/acme/years/2030'), { transferencia: 1 }));
    await assertFails(getDoc(doc(as('betaOwner'), 'termCounters/acme/years/2026')));
  });

  it('visualizador le, mas nao emite termos', async () => {
    await assertSucceeds(getDoc(doc(as('viewer1'), 'terms', 'tr1')));
    await assertFails(setDoc(doc(as('viewer1'), 'terms', 'x'), novoTermo()));
  });

  it('BLOQUEIA termo sem itens ou de tipo desconhecido', async () => {
    await assertFails(setDoc(doc(as('op1'), 'terms', 'x1'), novoTermo({ assets: [], assetIds: [] })));
    await assertFails(setDoc(doc(as('op1'), 'terms', 'x2'), novoTermo({ kind: 'qualquer' })));
  });

  it('termo emitido nao tem itens nem numero alterados', async () => {
    await assertFails(updateDoc(doc(as('op1'), 'terms', 'tr1'), { assets: [{ id: 'b1' }] }));
    await assertFails(updateDoc(doc(as('op1'), 'terms', 'tr1'), { number: 'TR-2026-9999' }));
    await assertSucceeds(updateDoc(doc(as('op1'), 'terms', 'tr1'), { status: 'assinado', signedCopy: { fileId: 'f1', chunks: 1 } }));
  });

  it('a loja confirma o recebimento; cancelar exige gestor', async () => {
    await assertFails(updateDoc(doc(as('op1'), 'terms', 'tt1'), { status: 'cancelado' }));
    await assertSucceeds(updateDoc(doc(as('manager1'), 'terms', 'tt1'), { status: 'cancelado' }));
  });

  it('operador conclui anexando o termo assinado; sem anexo so o gestor', async () => {
    await assertFails(updateDoc(doc(as('op1'), 'terms', 'tt1'), { status: 'recebido', receipt: { receivedByName: 'Gerente' } }));
    await assertFails(updateDoc(doc(as('op1'), 'terms', 'tr1'), { status: 'assinado' }));
    await assertSucceeds(updateDoc(doc(as('op1'), 'terms', 'tt1'), { status: 'recebido', receipt: { receivedByName: 'Gerente' }, signedCopy: { fileId: 'f2', chunks: 1 } }));
    await assertSucceeds(updateDoc(doc(as('manager1'), 'terms', 'tr1'), { status: 'assinado' }));
  });

  it('anexo gravado so o gestor substitui', async () => {
    await assertFails(updateDoc(doc(as('op1'), 'terms', 'tr2'), { signedCopy: { fileId: 'outro', chunks: 1 } }));
    await assertSucceeds(updateDoc(doc(as('manager1'), 'terms', 'tr2'), { signedCopy: { fileId: 'outro', chunks: 1 } }));
  });

  it('arquivo do termo assinado: grava em pedacos, nunca edita, isolado por empresa', async () => {
    const pedaco = (extra = {}) => ({
      tenantId: 'acme', termId: 'tr1', fileId: 'f9', index: 0, total: 1, name: 'TR.pdf',
      contentType: 'application/pdf', size: 3, data: Bytes.fromUint8Array(new Uint8Array([1, 2, 3])), createdBy: 'op@acme.com', ...extra,
    });
    await assertSucceeds(setDoc(doc(as('op1'), 'termFiles', 'f9_0'), pedaco()));
    await assertSucceeds(getDoc(doc(as('viewer1'), 'termFiles', 'f0_0')));
    await assertFails(getDoc(doc(as('betaOwner'), 'termFiles', 'f0_0')));
    // id precisa ser {fileId}_{index}; tipo e tamanho limitados; termo da mesma empresa
    await assertFails(setDoc(doc(as('op1'), 'termFiles', 'qualquer'), pedaco()));
    await assertFails(setDoc(doc(as('op1'), 'termFiles', 'f8_0'), pedaco({ fileId: 'f8', contentType: 'text/html' })));
    await assertFails(setDoc(doc(as('op1'), 'termFiles', 'f7_0'), pedaco({ fileId: 'f7', data: 'nao-e-bytes' })));
    await assertFails(setDoc(doc(as('betaOwner'), 'termFiles', 'f6_0'), pedaco({ fileId: 'f6', tenantId: 'beta' })));
    await assertFails(setDoc(doc(as('viewer1'), 'termFiles', 'f5_0'), pedaco({ fileId: 'f5' })));
    await assertFails(updateDoc(doc(as('op1'), 'termFiles', 'f0_0'), { name: 'trocado.pdf' }));
    await assertFails(deleteDoc(doc(as('op1'), 'termFiles', 'f0_0')));
    await assertSucceeds(deleteDoc(doc(as('manager1'), 'termFiles', 'f0_0')));
  });

  it('isola termos entre empresas e exige gestor para excluir', async () => {
    await assertFails(getDoc(doc(as('betaOwner'), 'terms', 'tr1')));
    await assertFails(deleteDoc(doc(as('op1'), 'terms', 'tr1')));
    await assertSucceeds(deleteDoc(doc(as('manager1'), 'terms', 'tr1')));
  });
});
