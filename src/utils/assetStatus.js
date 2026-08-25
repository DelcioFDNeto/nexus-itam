// src/utils/assetStatus.js
// -----------------------------------------------------------------------------
// Ciclo de vida do ativo.
//
// A lista de status estava escrita em cada tela, e diferente em cada uma:
// o cadastro oferecia 5 opcoes, a listagem 7, e as cores do badge eram
// recalculadas com ternarios em quatro lugares. Faltava tambem um estado
// terminal — sem "Baixado", aposentar um equipamento so era possivel
// excluindo o registro, o que levava junto todo o historico patrimonial.
// -----------------------------------------------------------------------------

/**
 * `stage`:
 *   'active'  — faz parte do inventario vivo, entra em contagens e valor total
 *   'retired' — saiu do patrimonio; exige data e motivo de baixa
 */
export const ASSET_STATUSES = [
  { id: 'Em Uso',           label: 'Em Uso',           tone: 'green',  stage: 'active' },
  { id: 'Disponível',       label: 'Disponível',       tone: 'blue',   stage: 'active' },
  { id: 'Em Transferência', label: 'Em Transferência', tone: 'amber',  stage: 'active' },
  { id: 'Em Trânsito',      label: 'Em Trânsito',      tone: 'amber',  stage: 'active' },
  { id: 'Entregue',         label: 'Entregue',         tone: 'purple', stage: 'active' },
  { id: 'Manutenção',       label: 'Manutenção',       tone: 'orange', stage: 'active' },
  { id: 'Defeito',          label: 'Defeito',          tone: 'red',    stage: 'active' },
  { id: 'Extraviado',       label: 'Extraviado',       tone: 'rose',   stage: 'retired' },
  { id: 'Baixado',          label: 'Baixado',          tone: 'slate',  stage: 'retired' },
];

const BY_ID = Object.fromEntries(ASSET_STATUSES.map((s) => [s.id, s]));

const FALLBACK = { id: 'Desconhecido', label: 'Desconhecido', tone: 'slate', stage: 'active' };

export const getStatus = (id) => BY_ID[id] || { ...FALLBACK, id: id || 'Desconhecido', label: id || 'Desconhecido' };

export const ACTIVE_STATUSES = ASSET_STATUSES.filter((s) => s.stage === 'active');
export const RETIRED_STATUSES = ASSET_STATUSES.filter((s) => s.stage === 'retired');

/** O ativo saiu do patrimonio? Nao entra em contagem, valor nem auditoria. */
export const isRetired = (status) => getStatus(status).stage === 'retired';

/** Motivos de baixa aceitos. O motivo e obrigatorio para registrar a saida. */
export const WRITE_OFF_REASONS = [
  'Fim de vida útil',
  'Dano irreparável',
  'Extravio',
  'Roubo / Furto',
  'Venda',
  'Doação',
  'Descarte / Reciclagem',
  'Devolução ao fornecedor',
];

// Classes de badge por tom, escritas por extenso para o Tailwind conseguir
// enxerga-las na varredura de conteudo (nao aceita nome de classe montado).
const BADGE = {
  green:  'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-900',
  blue:   'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900',
  amber:  'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900',
  purple: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-900',
  orange: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-400 dark:border-orange-900',
  red:    'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900',
  rose:   'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-900',
  slate:  'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700',
};

const DOT = {
  green: 'bg-green-500', blue: 'bg-blue-500', amber: 'bg-amber-500', purple: 'bg-purple-500',
  orange: 'bg-orange-500', red: 'bg-red-500', rose: 'bg-rose-500', slate: 'bg-slate-400',
};

export const statusBadgeClass = (status) => BADGE[getStatus(status).tone] || BADGE.slate;
export const statusDotClass = (status) => DOT[getStatus(status).tone] || DOT.slate;

// ---------------------------------------------------------------------------
// GARANTIA
// ---------------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;

/**
 * Situacao da garantia a partir da data de termino.
 * @returns {{state:'vigente'|'expirando'|'expirada', days:number}|null}
 *          `days` e positivo enquanto vigente e negativo depois de vencida.
 */
export const warrantyStatus = (warrantyEnd, today = new Date()) => {
  if (!warrantyEnd) return null;
  const end = warrantyEnd instanceof Date ? warrantyEnd : new Date(warrantyEnd);
  if (Number.isNaN(end.getTime())) return null;

  const days = Math.ceil((end.setHours(23, 59, 59, 999) - today.getTime()) / DAY);
  if (days < 0) return { state: 'expirada', days };
  if (days <= 30) return { state: 'expirando', days };
  return { state: 'vigente', days };
};

export const WARRANTY_LABEL = {
  vigente: 'Garantia vigente',
  expirando: 'Garantia vencendo',
  expirada: 'Garantia expirada',
};

export const WARRANTY_BADGE = {
  vigente: BADGE.green,
  expirando: BADGE.amber,
  expirada: BADGE.slate,
};
