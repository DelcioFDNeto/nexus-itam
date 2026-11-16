// src/utils/assetStatus.js
import { endOfLocalDay } from './dates';
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
  { id: 'Entregue',         label: 'Entregue',         tone: 'teal',   stage: 'active' },
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

/**
 * Status que so os fluxos proprios aplicam (transferencia com termo). Nao
 * aparecem para escolha manual: marcar "Em Trânsito" a mao deixava o ativo
 * preso sem documento, e tirar dele a mao deixava a transferencia orfa.
 */
export const SYSTEM_STATUSES = ['Em Trânsito'];

export const MANUAL_STATUSES = ACTIVE_STATUSES.filter((s) => !SYSTEM_STATUSES.includes(s.id));

/**
 * O que impede movimentar, mandar para manutencao, dar baixa ou trocar o
 * status do ativo? Devolve o motivo (ou null). Um ativo em transito so muda
 * pela transferencia; um baixado precisa ser reativado antes.
 * @param {object} asset
 * @param {string} action verbo para a mensagem ("movimentar", "dar baixa"...)
 */
export const lifecycleBlocker = (asset, action = 'alterar') => {
  if (asset?.transit?.termId) {
    return `O ativo está em trânsito (${asset.transit.number || 'transferência aberta'}). Conclua ou cancele a transferência em Termos antes de ${action}.`;
  }
  if (isRetired(asset?.status)) return `O ativo está baixado. Reative-o antes de ${action}.`;
  return null;
};

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
  green:  'bg-green-50 text-green-800 border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-900',
  blue:   'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900',
  amber:  'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900',
  teal:   'bg-teal-50 text-teal-800 border-teal-200 dark:bg-teal-950/40 dark:text-teal-400 dark:border-teal-900',
  sky:    'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/40 dark:text-sky-400 dark:border-sky-900',
  orange: 'bg-orange-50 text-orange-800 border-orange-200 dark:bg-orange-950/40 dark:text-orange-400 dark:border-orange-900',
  red:    'bg-red-50 text-red-800 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900',
  rose:   'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-900',
  slate:  'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
};

const DOT = {
  green: 'bg-green-600', blue: 'bg-blue-600', amber: 'bg-amber-600', teal: 'bg-teal-600', sky: 'bg-sky-600',
  orange: 'bg-orange-600', red: 'bg-red-600', rose: 'bg-rose-600', slate: 'bg-slate-500',
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
  const end = endOfLocalDay(warrantyEnd);
  if (!end || Number.isNaN(end.getTime())) return null;

  const todayEnd = endOfLocalDay(today);
  if (!todayEnd || Number.isNaN(todayEnd.getTime())) return null;

  const days = Math.round((end.getTime() - todayEnd.getTime()) / DAY);
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
