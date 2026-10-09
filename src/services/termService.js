// src/services/termService.js
// -----------------------------------------------------------------------------
// Termos patrimoniais: responsabilidade, devolucao e transferencia/recebimento.
//
// Cada termo emitido vira um registro em /terms com numero sequencial por ano
// (TR-2026-0001), uma FOTOGRAFIA dos ativos no momento da emissao (o documento
// reimpresso e identico ao assinado, mesmo que o cadastro mude depois) e um
// status que acompanha o papel: aguardando assinatura -> assinado, ou
// em transito -> recebido. Termo, contador, ativos e linha do tempo sao
// gravados na MESMA transacao: nunca sobra numero pulado nem ativo
// "em transito" sem documento.
// -----------------------------------------------------------------------------
import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { db } from './firebase';
import { writeSignedCopy } from './termFileService';
import {
  cleanPerson,
  defaultReceipt,
  cleanPlace,
  formatTermNumber,
  MAX_TERM_ASSETS,
  RECEIPT_OUTCOMES,
  receiptStatus,
  snapshotAsset,
  TERM_KINDS,
  transferBlocker,
} from '../utils/terms';

const text = (value) => String(value ?? '').trim();

const currentYear = () => new Date().getFullYear();

const counterRef = (tenantId, year) => doc(db, 'termCounters', tenantId, 'years', String(year));

const actorOf = (user) => ({
  email: text(user?.email) || 'Sistema',
  name: text(user?.name) || text(user?.email) || 'Sistema',
});

/**
 * Emissao generica: reserva o proximo numero, grava o termo, aplica as
 * mudancas nos ativos e registra a linha do tempo — tudo atomico.
 */
const issueTerm = async ({ kind, status, tenantId, user, assets, conditions = {}, fields = {}, assetChanges, history, validate }) => {
  if (!tenantId) throw new Error('Termo sem empresa: operação não registrada.');
  if (!TERM_KINDS[kind]) throw new Error('Tipo de termo desconhecido.');
  if (!assets?.length) throw new Error('Selecione ao menos um ativo.');
  if (assets.length > MAX_TERM_ASSETS) throw new Error(`Um termo comporta até ${MAX_TERM_ASSETS} ativos.`);
  if (new Set(assets.map((a) => a.id)).size !== assets.length) throw new Error('O mesmo ativo aparece duas vezes no termo.');

  const year = currentYear();
  const actor = actorOf(user);
  const termRef = doc(collection(db, 'terms'));

  return runTransaction(db, async (tx) => {
    // Todas as leituras antes das escritas. Os ativos sao relidos AQUI: o
    // termo fotografa o estado atual e duas emissoes simultaneas do mesmo
    // ativo (ex.: dois envios) nao passam juntas.
    const counter = await tx.get(counterRef(tenantId, year));
    const freshSnaps = await Promise.all(assets.map((a) => tx.get(doc(db, 'assets', a.id))));
    const freshAssets = freshSnaps.map((snap, index) => {
      if (!snap.exists()) throw new Error(`O ativo ${assets[index].internalId || assets[index].id} não existe mais.`);
      return { id: snap.id, ...snap.data() };
    });
    freshAssets.forEach((asset) => validate?.(asset));
    const snapshots = freshAssets.map((asset) => snapshotAsset(asset, conditions[asset.id]));

    const sequence = (counter.exists() ? Number(counter.data()[kind]) || 0 : 0) + 1;
    const number = formatTermNumber(kind, year, sequence);

    if (counter.exists()) tx.update(counterRef(tenantId, year), { [kind]: sequence, updatedAt: serverTimestamp() });
    else tx.set(counterRef(tenantId, year), { [kind]: sequence, updatedAt: serverTimestamp() });

    const term = {
      tenantId,
      kind,
      number,
      year,
      sequence,
      status,
      assets: snapshots,
      assetIds: snapshots.map((a) => a.id),
      ...fields,
      issuedAt: serverTimestamp(),
      issuedBy: actor.email,
      issuedByName: actor.name,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    tx.set(termRef, term);

    const ctx = { termId: termRef.id, number };
    freshAssets.forEach((asset) => {
      const changes = assetChanges?.(asset, ctx);
      if (changes && Object.keys(changes).length) {
        tx.update(doc(db, 'assets', asset.id), { ...changes, updatedAt: serverTimestamp() });
      }
      const entry = history(asset, ctx);
      tx.set(doc(collection(db, 'history')), {
        assetId: asset.id,
        tenantId,
        type: `termo_${kind}`,
        date: serverTimestamp(),
        user: actor.email,
        termId: termRef.id,
        termNumber: number,
        ...entry,
      });
    });

    return { ...term, id: termRef.id, issuedAt: new Date(), createdAt: new Date(), updatedAt: new Date() };
  });
};

// -----------------------------------------------------------------------------
// Responsabilidade (entrega ao colaborador)
// -----------------------------------------------------------------------------

/**
 * Entrega um ou mais ativos a um colaborador. Os ativos passam para o nome
 * dele (responsavel, CPF e setor), e "Disponível" vira "Em Uso".
 */
export const issueResponsibilityTerm = ({ tenantId, user, assets, holder, conditions, notes }) => {
  const person = cleanPerson(holder);
  if (!person.name) throw new Error('Informe o colaborador responsável.');
  return issueTerm({
    kind: 'responsabilidade',
    status: 'pendente',
    tenantId,
    user,
    assets,
    conditions,
    fields: { holder: person, notes: text(notes) },
    assetChanges: (asset) => ({
      assignedTo: person.name,
      clientCpf: person.cpf,
      employeeId: person.employeeId,
      ...(person.sector ? { sector: person.sector } : {}),
      ...(asset.status === 'Disponível' ? { status: 'Em Uso' } : {}),
    }),
    history: (asset, { number }) => ({
      action: 'Termo de Responsabilidade',
      newHolder: person.name,
      previousHolder: text(asset.assignedTo) || 'N/A',
      details: `Termo ${number} emitido: ativo entregue a ${person.name}.`,
    }),
  });
};

// -----------------------------------------------------------------------------
// Devolucao
// -----------------------------------------------------------------------------

/**
 * Registra a devolucao: os ativos ficam sem responsavel, voltam como
 * "Disponível" (ou "Defeito", se devolvidos avariados) e, se informado, passam
 * para o local onde foram recebidos.
 */
export const issueReturnTerm = ({ tenantId, user, assets, holder, conditions = {}, notes, returnLocation, receivedByName }) => {
  const person = cleanPerson(holder);
  if (!person.name) throw new Error('Informe quem está devolvendo.');
  const location = text(returnLocation);
  return issueTerm({
    kind: 'devolucao',
    status: 'pendente',
    tenantId,
    user,
    assets,
    conditions,
    fields: {
      holder: person,
      notes: text(notes),
      returnLocation: location,
      receivedByName: text(receivedByName) || actorOf(user).name,
    },
    assetChanges: (asset) => ({
      assignedTo: '',
      clientCpf: '',
      employeeId: '',
      status: conditions[asset.id] === 'Avariado' ? 'Defeito' : 'Disponível',
      ...(location ? { location } : {}),
    }),
    history: (asset, { number }) => ({
      action: 'Devolução de Ativo',
      previousHolder: text(asset.assignedTo) || person.name,
      newHolder: 'Sem responsável',
      details: `Termo ${number}: devolvido por ${person.name}. Estado: ${conditions[asset.id] || 'Bom'}.${location ? ` Recebido em ${location}.` : ''}`,
    }),
  });
};

// -----------------------------------------------------------------------------
// Transferencia e recebimento (matriz -> loja)
// -----------------------------------------------------------------------------

/**
 * Expede os ativos para outro local. Eles ficam "Em Trânsito" — ainda no
 * local de origem — ate a loja confirmar o recebimento.
 */
export const dispatchTransfer = ({ tenantId, user, assets, origin, destination, receiver, transport, expectedAt, conditions, notes }) => {
  const from = cleanPlace(origin);
  const to = cleanPlace(destination);
  if (!from.name) throw new Error('Informe o local de origem.');
  if (!to.name) throw new Error('Informe a loja ou local de destino.');
  if (from.name === to.name) throw new Error('Origem e destino precisam ser diferentes.');
  const assertTransferable = (asset) => {
    const reason = transferBlocker(asset);
    if (reason) throw new Error(`O ativo ${asset.internalId || asset.model} ${reason}.`);
  };
  (assets || []).forEach(assertTransferable);

  const person = cleanPerson(receiver);
  return issueTerm({
    kind: 'transferencia',
    status: 'em_transito',
    tenantId,
    user,
    assets,
    conditions,
    validate: assertTransferable,
    fields: {
      origin: from,
      destination: to,
      receiver: person,
      transport: {
        mode: text(transport?.mode),
        carrier: text(transport?.carrier),
        document: text(transport?.document),
      },
      expectedAt: text(expectedAt),
      notes: text(notes),
    },
    assetChanges: (asset, { termId, number }) => ({
      status: 'Em Trânsito',
      transit: { termId, number, from: from.name, to: to.name, since: new Date().toISOString() },
    }),
    history: (asset, { number }) => ({
      action: 'Transferência Enviada',
      previousLocation: text(asset.location) || from.name,
      newLocation: to.name,
      reason: `Termo ${number}`,
      details: `Termo ${number}: enviado de ${from.name} para ${to.name}${person.name ? ` (recebedor: ${person.name})` : ''}.`,
    }),
  });
};

/**
 * Conferencia na loja. Itens "ok" ou "com ressalva" passam para o local de
 * destino; "não recebido" continua em transito, marcado como faltante.
 * Com `signedCopy` (arquivo preparado por prepareSignedCopy), o termo assinado
 * e gravado na mesma transacao.
 *
 * @param {{ term: object, user: object, receivedByName: string, receivedAt: string,
 *           items: Array<{id:string, outcome:'ok'|'ressalva'|'nao_recebido', note?:string}>,
 *           newStatus?: string, assignToReceiver?: boolean, signedCopy?: object }} input
 */
export const confirmTransferReceipt = async ({ term, user, receivedByName, receivedAt, items, newStatus = 'Disponível', assignToReceiver = false, signedCopy = null }) => {
  if (!term?.id) throw new Error('Transferência inválida.');
  const actor = actorOf(user);
  const receiverName = text(receivedByName) || term.receiver?.name || actor.name;
  const byId = Object.fromEntries((items || []).map((i) => [i.id, i]));
  const outcomes = term.assets.map((a) => ({
    id: a.id,
    internalId: a.internalId,
    outcome: RECEIPT_OUTCOMES[byId[a.id]?.outcome] ? byId[a.id].outcome : 'ok',
    note: text(byId[a.id]?.note),
  }));
  const status = receiptStatus(outcomes);
  const termRef = doc(db, 'terms', term.id);

  await runTransaction(db, async (tx) => {
    const fresh = await tx.get(termRef);
    if (!fresh.exists()) throw new Error('Transferência não encontrada.');
    if (fresh.data().status !== 'em_transito') throw new Error('Esta transferência já foi conferida ou cancelada.');
    // Leituras antes das escritas (exigencia das transacoes do Firestore).
    const assetSnaps = await Promise.all(outcomes.map((o) => tx.get(doc(db, 'assets', o.id))));
    const copy = signedCopy ? writeSignedCopy(tx, { tenantId: term.tenantId, termId: term.id, prepared: signedCopy, actor }) : null;

    tx.update(termRef, {
      status,
      ...(copy ? { signedCopy: copy } : {}),
      receipt: {
        receivedByName: receiverName,
        receivedAt: text(receivedAt) || new Date().toISOString().slice(0, 10),
        confirmedBy: actor.email,
        confirmedByName: actor.name,
        confirmedAt: serverTimestamp(),
        newStatus,
        assignToReceiver: Boolean(assignToReceiver),
        items: outcomes,
      },
      updatedAt: serverTimestamp(),
    });

    outcomes.forEach((o, index) => {
      const snap = assetSnaps[index];
      if (!snap.exists()) return; // ativo excluido no meio do caminho
      const assetRef = doc(db, 'assets', o.id);
      if (o.outcome === 'nao_recebido') {
        tx.update(assetRef, { 'transit.missing': true, updatedAt: serverTimestamp() });
      } else {
        tx.update(assetRef, {
          location: term.destination.name,
          status: newStatus,
          transit: deleteField(),
          ...(assignToReceiver && receiverName ? { assignedTo: receiverName, clientCpf: term.receiver?.cpf || '', employeeId: term.receiver?.employeeId || '' } : {}),
          updatedAt: serverTimestamp(),
        });
      }
      tx.set(doc(collection(db, 'history')), {
        assetId: o.id,
        tenantId: term.tenantId,
        type: 'termo_transferencia',
        action: o.outcome === 'nao_recebido' ? 'Transferência: item não recebido' : 'Transferência Recebida',
        date: serverTimestamp(),
        user: actor.email,
        termId: term.id,
        termNumber: term.number,
        previousLocation: term.origin?.name || 'N/A',
        newLocation: o.outcome === 'nao_recebido' ? term.origin?.name || 'N/A' : term.destination.name,
        details:
          o.outcome === 'nao_recebido'
            ? `Termo ${term.number}: item NÃO recebido em ${term.destination.name}.${o.note ? ` Obs: ${o.note}` : ''}`
            : `Termo ${term.number}: recebido em ${term.destination.name} por ${receiverName}.${o.note ? ` Ressalva: ${o.note}` : ''}`,
      });
    });
  });

  return { status, outcomes };
};

/** Cancela um envio ainda em transito: cada ativo volta ao status anterior. */
export const cancelTransfer = async ({ term, user, reason }) => {
  if (!term?.id) throw new Error('Transferência inválida.');
  const actor = actorOf(user);
  const termRef = doc(db, 'terms', term.id);

  await runTransaction(db, async (tx) => {
    const fresh = await tx.get(termRef);
    if (!fresh.exists() || fresh.data().status !== 'em_transito') {
      throw new Error('Só é possível cancelar uma transferência em trânsito.');
    }
    const assetSnaps = await Promise.all(term.assets.map((a) => tx.get(doc(db, 'assets', a.id))));

    tx.update(termRef, {
      status: 'cancelado',
      cancelledAt: serverTimestamp(),
      cancelledBy: actor.email,
      cancelReason: text(reason),
      updatedAt: serverTimestamp(),
    });

    term.assets.forEach((snapshot, index) => {
      const snap = assetSnaps[index];
      // So reverte quem ainda esta preso a ESTA transferencia.
      if (!snap.exists() || snap.data().transit?.termId !== term.id) return;
      tx.update(doc(db, 'assets', snapshot.id), {
        status: snapshot.previousStatus || 'Disponível',
        transit: deleteField(),
        updatedAt: serverTimestamp(),
      });
      tx.set(doc(collection(db, 'history')), {
        assetId: snapshot.id,
        tenantId: term.tenantId,
        type: 'termo_transferencia',
        action: 'Transferência Cancelada',
        date: serverTimestamp(),
        user: actor.email,
        termId: term.id,
        termNumber: term.number,
        details: `Termo ${term.number} cancelado${reason ? `: ${text(reason)}` : ''}. Ativo permanece em ${snapshot.previousLocation || term.origin?.name || 'origem'}.`,
      });
    });
  });
};

/** O papel assinado voltou: o termo deixa a lista de pendencias. */
export const markTermSigned = async ({ term, user, signedCopy = null }) => {
  const actor = actorOf(user);
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'terms', term.id);
    const fresh = await tx.get(ref);
    if (!fresh.exists() || fresh.data().status !== 'pendente') throw new Error('Este termo não está aguardando assinatura.');
    const copy = signedCopy ? writeSignedCopy(tx, { tenantId: term.tenantId, termId: term.id, prepared: signedCopy, actor }) : null;
    tx.update(ref, {
      status: 'assinado',
      ...(copy ? { signedCopy: copy } : {}),
      signedAt: serverTimestamp(),
      signedBy: actor.email,
      signedByName: actor.name,
      updatedAt: serverTimestamp(),
    });
  });
};

/** Arquiva o assinado de um termo ja concluido (ex.: recebido antes do anexo existir). */
export const attachSignedCopy = async ({ term, user, signedCopy }) => {
  if (!signedCopy) throw new Error('Selecione o arquivo do termo assinado.');
  const actor = actorOf(user);
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'terms', term.id);
    const fresh = await tx.get(ref);
    if (!fresh.exists()) throw new Error('Termo não encontrado.');
    if (fresh.data().status === 'cancelado') throw new Error(`${term.number} está cancelado.`);
    if (fresh.data().signedCopy) throw new Error(`${term.number} já tem o termo assinado anexado.`);
    tx.update(ref, {
      signedCopy: writeSignedCopy(tx, { tenantId: term.tenantId, termId: term.id, prepared: signedCopy, actor }),
      updatedAt: serverTimestamp(),
    });
  });
};

/**
 * Fluxo automatico: anexar o termo assinado conclui o que estiver pendente.
 *   em transito -> recebido (todos os itens conferidos, salvo ressalvas informadas)
 *   aguardando assinatura -> assinado
 *   ja concluido -> so arquiva o assinado
 * @param {{ term: object, user: object, signedCopy?: object, receipt?: object, options?: object }} input
 *   receipt: ajustes da conferencia (itens com ressalva, recebedor, data...)
 *   options: resolveTermOptions(settings) — situacao dos itens na chegada etc.
 * @returns {Promise<string>} status final do termo
 */
export const concludeTerm = async ({ term, user, signedCopy = null, receipt = {}, options = {} }) => {
  if (!term?.id) throw new Error('Termo inválido.');
  if (term.status === 'em_transito') {
    const result = await confirmTransferReceipt({ term, user, signedCopy, ...defaultReceipt(term, options), ...receipt });
    return result.status;
  }
  if (term.status === 'pendente') {
    await markTermSigned({ term, user, signedCopy });
    return 'assinado';
  }
  await attachSignedCopy({ term, user, signedCopy });
  return term.status;
};

// -----------------------------------------------------------------------------
// Leitura
// -----------------------------------------------------------------------------

const toDate = (value) => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const withDates = (d) => {
  const data = d.data();
  return { id: d.id, ...data, issuedAtDate: toDate(data.issuedAt) };
};

export const listTerms = async (tenantId, max = 300) => {
  if (!tenantId) return [];
  const snap = await getDocs(
    query(collection(db, 'terms'), where('tenantId', '==', tenantId), orderBy('issuedAt', 'desc'), limit(max)),
  );
  return snap.docs.map(withDates);
};

export const listTermsForAsset = async (tenantId, assetId) => {
  if (!tenantId || !assetId) return [];
  const snap = await getDocs(
    query(collection(db, 'terms'), where('tenantId', '==', tenantId), where('assetIds', 'array-contains', assetId)),
  );
  return snap.docs.map(withDates).sort((a, b) => (b.issuedAtDate?.getTime() || 0) - (a.issuedAtDate?.getTime() || 0));
};

export const getTerm = async (termId) => {
  const snap = await getDoc(doc(db, 'terms', termId));
  return snap.exists() ? withDates(snap) : null;
};
