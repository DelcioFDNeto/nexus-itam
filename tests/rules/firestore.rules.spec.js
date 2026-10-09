// tests/rules/firestore.rules.spec.js
// -----------------------------------------------------------------------------
// Testes das regras do Firestore contra o emulador.
//   npm run test:rules
// (sobe o emulador via `firebase emulators:exec`; exige Java instalado)
// -----------------------------------------------------------------------------
import { readFileSync } from 'node:fs';
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

  it('ninguem altera o proprio papel ou status', async () => {
    await assertFails(updateDoc(doc(as('op1'), 'users', 'op1'), { role: 'manager' }));
    await assertFails(updateDoc(doc(as('blocked1'), 'users', 'blocked1'), { status: 'active' }));
    await assertSucceeds(updateDoc(doc(as('op1'), 'users', 'op1'), { name: 'Novo Nome' }));
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
  });

  it('segredo do agente e restrito a owner/admin da propria empresa', async () => {
    await assertSucceeds(getDoc(doc(as('admin1'), 'tenantSecrets', 'acme')));
    await assertFails(getDoc(doc(as('op1'), 'tenantSecrets', 'acme')));
    await assertFails(getDoc(doc(as('betaOwner'), 'tenantSecrets', 'acme')));
  });

  it('caixa do agente (que carrega o token) nao e legivel por operador', async () => {
    await assertFails(getDoc(doc(as('op1'), 'agentInbox', 'in1')));
    await assertSucceeds(getDoc(doc(as('manager1'), 'agentInbox', 'in1')));
  });
});

// -----------------------------------------------------------------------------
describe('agente sem login (drop-box)', () => {
  const submission = (tenantId, agentToken) => ({
    tenantId, agentToken, status: 'pending', hostname: 'PC-01', createdAt: new Date().toISOString(),
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
