// src/utils/terms.js
// -----------------------------------------------------------------------------
// Catalogo dos termos patrimoniais (sem Firebase: testavel e reaproveitado
// pelo servico, pelas telas e pelos documentos impressos).
// -----------------------------------------------------------------------------

export const TERM_KINDS = {
  responsabilidade: { prefix: 'TR', label: 'Termo de Responsabilidade', short: 'Responsabilidade' },
  devolucao: { prefix: 'TD', label: 'Termo de Devolução', short: 'Devolução' },
  transferencia: { prefix: 'TT', label: 'Termo de Transferência e Recebimento', short: 'Transferência' },
};

export const TERM_STATUS = {
  pendente: { label: 'Aguardando assinatura', tone: 'amber' },
  assinado: { label: 'Assinado', tone: 'green' },
  em_transito: { label: 'Em trânsito', tone: 'blue' },
  recebido: { label: 'Recebido', tone: 'green' },
  recebido_ressalvas: { label: 'Recebido com ressalvas', tone: 'orange' },
  cancelado: { label: 'Cancelado', tone: 'slate' },
};

/** Estados que ainda pedem uma acao (assinatura ou conferencia na loja). */
export const OPEN_TERM_STATUSES = ['pendente', 'em_transito'];

export const ASSET_CONDITIONS = ['Novo', 'Bom', 'Regular', 'Avariado'];

export const TRANSPORT_MODES = [
  'Motorista da empresa',
  'Transportadora',
  'Malote / Correios',
  'Retirada pelo destinatário',
  'Outro',
];

/** Resultado da conferencia de cada item na loja. */
export const RECEIPT_OUTCOMES = {
  ok: 'Recebido OK',
  ressalva: 'Recebido com ressalva',
  nao_recebido: 'Não recebido',
};

export const MAX_TERM_ASSETS = 150;

export const formatTermNumber = (kind, year, sequence) =>
  `${TERM_KINDS[kind]?.prefix || 'TM'}-${year}-${String(sequence).padStart(4, '0')}`;

const text = (value) => String(value ?? '').trim();

const accessoryList = (asset) => {
  const fromField = Array.isArray(asset.accessories)
    ? asset.accessories
    : text(asset.accessories) ? [text(asset.accessories)] : [];
  const fromPeripherals = (asset.peripherals || []).map((p) => p?.name).filter(Boolean);
  return [...fromField, ...fromPeripherals].join(', ');
};

/**
 * Fotografia do ativo gravada no termo. Guarda tambem status, local e
 * responsavel de antes da operacao: e com eles que um envio cancelado
 * devolve o ativo ao estado anterior.
 */
export const snapshotAsset = (asset, condition = 'Bom') => ({
  id: asset.id,
  internalId: text(asset.internalId),
  model: text(asset.model),
  type: text(asset.type),
  serialNumber: text(asset.serialNumber),
  category: text(asset.category),
  valor: text(asset.valor),
  accessories: accessoryList(asset),
  previousStatus: text(asset.status),
  previousLocation: text(asset.location),
  previousHolder: text(asset.assignedTo || asset.clientName),
  condition: ASSET_CONDITIONS.includes(condition) ? condition : 'Bom',
});

/** Dados de quem recebe/devolve, sem campos soltos do formulario. */
export const cleanPerson = (person = {}) => ({
  name: text(person.name),
  cpf: text(person.cpf),
  role: text(person.role),
  sector: text(person.sector),
  branch: text(person.branch),
  employeeId: text(person.employeeId),
});

/** Local com os dados que saem no termo de transferencia. */
export const cleanPlace = (place = {}) => ({
  name: text(place.name),
  address: text(place.address),
  manager: text(place.manager),
  phone: text(place.phone),
});

export const EMPTY_PERSON = { name: '', cpf: '', role: '', sector: '', branch: '', employeeId: '' };

/** Colaborador inicial a partir dos ativos (quando todos estao com a mesma pessoa). */
export const personFromAssets = (assets = []) => {
  const holders = [...new Set(assets.map((a) => (a.assignedTo || a.clientName || '').trim()).filter(Boolean))];
  if (holders.length !== 1) return { ...EMPTY_PERSON };
  const first = assets.find((a) => (a.assignedTo || a.clientName || '').trim() === holders[0]);
  return {
    ...EMPTY_PERSON,
    name: holders[0],
    cpf: first?.clientCpf || '',
    sector: first?.sector || '',
    branch: first?.location || '',
    employeeId: first?.employeeId || '',
  };
};

/** O ativo pode entrar numa transferencia? Retorna o motivo quando nao. */
export const transferBlocker = (asset) => {
  if (asset?.transit?.termId) return `já está em trânsito (${asset.transit.number || 'transferência aberta'})`;
  if (['Baixado', 'Extraviado'].includes(asset?.status)) return 'está baixado';
  return null;
};

/** Situacao da transferencia depois da conferencia dos itens. */
export const receiptStatus = (items = []) =>
  items.some((i) => i.outcome && i.outcome !== 'ok') ? 'recebido_ressalvas' : 'recebido';

/** "1.234,56", "1234.56" ou 1234.56 -> 1234.56 (NaN quando vazio/invalido). */
export const parseMoney = (value) => {
  if (typeof value === 'number') return value;
  const raw = text(value).replace(/[^\d.,-]/g, '');
  if (!raw) return NaN;
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  return Number.parseFloat(normalized);
};

/** Data de formulario (AAAA-MM-DD), Date ou Timestamp -> Date local. */
export const toLocalDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  // "2026-10-09" via new Date() vira meia-noite UTC: no Brasil, dia 08.
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

// -----------------------------------------------------------------------------
// Textos padrao (editaveis em Configuracoes)
// -----------------------------------------------------------------------------

export const DEFAULT_TERM_CLAUSES = `1. DO USO E FINALIDADE: O(a) Responsável declara ter recebido o equipamento acima descrito em perfeito estado de conservação e funcionamento. Compromete-se a utilizá-lo estrita e exclusivamente para fins profissionais, sendo vedado o uso para fins pessoais, empréstimo a terceiros ou instalação de softwares não autorizados pela TI.
2. DA GUARDA E CONSERVAÇÃO: É responsabilidade do(a) Responsável zelar pela guarda, segurança e conservação do equipamento. O mau uso, negligência, imprudência ou imperícia que resultar em danos ao equipamento sujeitará o(a) Responsável às sanções cíveis e disciplinares previstas em lei.
3. DA RESTITUIÇÃO: O equipamento deverá ser devolvido imediatamente à Empresa, em perfeito estado (salvo desgaste natural), nas seguintes hipóteses: a) Rescisão do contrato de trabalho ou encerramento da prestação de serviços; b) Mudança de cargo ou função; c) Solicitação expressa da Empresa a qualquer tempo.
4. DO EXTRAVIO, DANO OU FURTO: Em conformidade com o Art. 186 do Código Civil e, quando aplicável, Art. 462, §1º da CLT, o(a) Responsável AUTORIZA EXPRESSAMENTE o desconto em seus recebimentos (faturas/notas fiscais), folha de pagamento ou verbas rescisórias dos valores correspondentes ao reparo ou reposição do equipamento, caso seja comprovado que os danos ou o extravio decorreram de DOLO (intenção), NEGLIGÊNCIA (falta de cuidado) ou uso em desconformidade com as normas da empresa (mau uso).
5. DA SEGURANÇA DA INFORMAÇÃO: O(a) Responsável está ciente de que o equipamento é monitorado e que não deve armazenar dados pessoais sensíveis, responsabilizando-se pelo sigilo de suas senhas e cumprimento das normas de LGPD da empresa.`;

export const DEFAULT_TRANSFER_CLAUSES = `1. DA CONFERÊNCIA: O(a) recebedor(a) deverá conferir quantidade, identificação patrimonial e estado de cada item no ato do recebimento, registrando neste termo qualquer divergência, avaria ou falta.
2. DA GUARDA: A partir do recebimento, a guarda e a conservação dos equipamentos passam a ser de responsabilidade da unidade de destino, na pessoa do(a) responsável indicado(a).
3. DO PRAZO: Divergências não registradas no ato do recebimento deverão ser comunicadas ao Departamento de TI em até 24 (vinte e quatro) horas.
4. DO REMANEJAMENTO: Os equipamentos destinam-se às atividades da unidade de destino e não podem ser remanejados para outro local sem nova transferência registrada.`;

/** Situacoes possiveis dos itens quando a transferencia e concluida. */
export const ARRIVAL_STATUSES = ['Disponível', 'Em Uso'];

export const DEFAULT_OVERDUE_DAYS = 7;

/** Opcoes dos termos gravadas em /settings/{tenantId}. */
export const resolveTermOptions = (config = {}) => {
  const overdue = Number.parseInt(config.termOverdueDays, 10);
  return {
    city: text(config.termCity),
    showValue: Boolean(config.termShowValue),
    witnesses: Boolean(config.termWitnesses),
    termTitle: text(config.termTitle),
    clauses: text(config.termClauses) || DEFAULT_TERM_CLAUSES,
    transferClauses: text(config.transferClauses) || DEFAULT_TRANSFER_CLAUSES,
    // Fluxo automatico: o que acontece com os itens quando o termo assinado e anexado.
    arrivalStatus: ARRIVAL_STATUSES.includes(config.transferArrivalStatus) ? config.transferArrivalStatus : 'Disponível',
    assignReceiver: Boolean(config.transferAssignReceiver),
    overdueDays: Number.isFinite(overdue) ? Math.min(Math.max(overdue, 1), 90) : DEFAULT_OVERDUE_DAYS,
  };
};

// -----------------------------------------------------------------------------
// Termo assinado (anexo) e conclusao automatica
// -----------------------------------------------------------------------------

/**
 * O arquivo assinado fica no Firestore, em pedacos (o plano Spark nao tem
 * Cloud Storage e um documento comporta ate 1 MiB).
 */
export const SIGNED_COPY_MAX_BYTES = 5 * 1024 * 1024;
export const SIGNED_COPY_CHUNK_BYTES = 900 * 1024;
export const SIGNED_COPY_MAX_CHUNKS = Math.ceil(SIGNED_COPY_MAX_BYTES / SIGNED_COPY_CHUNK_BYTES);
export const SIGNED_COPY_ACCEPT = 'application/pdf,image/*';

/** Aceita anexo: termos abertos concluem; concluidos sem anexo so arquivam o papel. */
export const canAttachSignedCopy = (term) => Boolean(term?.id) && term.status !== 'cancelado' && !term.signedCopy;

/** O que anexar o assinado faz com o termo (texto curto para as telas). */
export const attachOutcome = (term) => {
  if (term?.status === 'em_transito') return `Recebido em ${term.destination?.name || 'destino'}`;
  if (term?.status === 'pendente') return 'Assinado';
  return 'Arquivar o assinado';
};

export const splitIntoChunks = (bytes, size = SIGNED_COPY_CHUNK_BYTES) => {
  const chunks = [];
  for (let start = 0; start < bytes.length; start += size) chunks.push(bytes.subarray(start, start + size));
  return chunks.length ? chunks : [new Uint8Array(0)];
};

export const joinChunks = (chunks) => {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    out.set(chunk, offset);
    offset += chunk.length;
  });
  return out;
};

/** Id do termo no texto do QR impresso (".../termos/{id}"). */
export const termIdFromQr = (value) => {
  const match = String(value ?? '').match(/\/termos\/([A-Za-z0-9_-]{6,64})(?=$|[/?#])/);
  return match ? match[1] : null;
};

/** Numero do termo escrito no nome do arquivo ("TT-2026-0001.pdf", "tt_2026_1 assinado.jpg"). */
export const termNumberFromText = (value) => {
  const match = String(value ?? '').match(/(?:^|[^a-z])(TR|TD|TT)[\s._-]*(\d{4})[\s._-]*(\d{1,6})(?!\d)/i);
  return match ? `${match[1].toUpperCase()}-${match[2]}-${match[3].padStart(4, '0')}` : null;
};

/**
 * Descobre de qual termo e o arquivo digitalizado: primeiro pelo QR impresso,
 * depois pelo numero no nome do arquivo. Quando o QR aponta para um termo fora
 * da lista carregada, devolve so o id (quem chamou busca o termo).
 */
export const matchSignedCopy = ({ qrText, fileName } = {}, terms = []) => {
  const termId = termIdFromQr(qrText);
  if (termId) {
    const term = terms.find((t) => t.id === termId);
    return term ? { term, via: 'qr' } : { termId, via: 'qr' };
  }
  const number = termNumberFromText(fileName);
  const term = number ? terms.find((t) => t.number === number) : null;
  return term ? { term, via: 'nome' } : null;
};

/** Recebedor quando o termo nao nomeia ninguem: o nome esta no papel assinado. */
export const RECEIVER_FROM_PAPER = 'Conforme termo assinado';

const isoDay = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/**
 * Recebimento padrao quando a loja devolve o termo assinado: todos os itens
 * conferidos, recebedor do proprio termo e situacao definida em Configuracoes.
 */
export const defaultReceipt = (term, options = {}, now = new Date()) => {
  const receiver = text(term?.receiver?.name) || text(term?.destination?.manager);
  return {
    receivedByName: receiver || RECEIVER_FROM_PAPER,
    receivedAt: isoDay(now),
    items: (term?.assets || []).map((a) => ({ id: a.id, outcome: 'ok', note: '' })),
    newStatus: ARRIVAL_STATUSES.includes(options.arrivalStatus) ? options.arrivalStatus : 'Disponível',
    // So vira responsavel quem esta identificado no termo.
    assignToReceiver: Boolean(options.assignReceiver && text(term?.receiver?.name)),
  };
};

const DAY_MS = 24 * 60 * 60 * 1000;


/** Dias inteiros desde a emissao. */
export const daysSinceIssue = (term, now = new Date()) => {
  const issued = toLocalDate(term?.issuedAtDate || term?.issuedAt);
  return issued ? Math.max(0, Math.floor((now - issued) / DAY_MS)) : 0;
};

/**
 * Pendencia atrasada: transferencia que passou da previsao de chegada (ou,
 * sem previsao, do prazo padrao) e termo sem assinatura alem do prazo.
 */
export const isOverdue = (term, { days = DEFAULT_OVERDUE_DAYS, now = new Date() } = {}) => {
  if (!OPEN_TERM_STATUSES.includes(term?.status)) return false;
  const expected = term.status === 'em_transito' ? toLocalDate(term.expectedAt) : null;
  if (expected) return now > new Date(expected.getFullYear(), expected.getMonth(), expected.getDate() + 1);
  return daysSinceIssue(term, now) > days;
};
