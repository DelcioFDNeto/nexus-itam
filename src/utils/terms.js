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

/** Opcoes dos termos gravadas em /settings/{tenantId}. */
export const resolveTermOptions = (config = {}) => ({
  city: text(config.termCity),
  showValue: Boolean(config.termShowValue),
  witnesses: Boolean(config.termWitnesses),
  termTitle: text(config.termTitle),
  clauses: text(config.termClauses) || DEFAULT_TERM_CLAUSES,
  transferClauses: text(config.transferClauses) || DEFAULT_TRANSFER_CLAUSES,
});
