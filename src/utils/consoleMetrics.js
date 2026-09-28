// src/utils/consoleMetrics.js
// Calculos e formatacao do console Nexus Master (sem JSX, testaveis).
import { formatUsage, usageRatio } from './entitlements';

export const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
export const brlCompact = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 });

const DAY = 86400000;

/** "hoje", "há 3 dias", "há 2 meses", "nunca". */
export const relativeDays = (date) => {
  if (!date) return 'nunca';
  const days = Math.floor((Date.now() - date.getTime()) / DAY);
  if (days <= 0) return 'hoje';
  if (days === 1) return 'ontem';
  if (days < 30) return `há ${days} dias`;
  const months = Math.floor(days / 30);
  if (months < 12) return `há ${months} ${months === 1 ? 'mês' : 'meses'}`;
  const years = Math.floor(months / 12);
  return `há ${years} ${years === 1 ? 'ano' : 'anos'}`;
};

export const daysSince = (date) => (date ? Math.floor((Date.now() - date.getTime()) / DAY) : Infinity);

/**
 * Pontos de atencao de uma empresa, do mais grave ao mais leve.
 * @returns {Array<{ level: 'critical'|'warning'|'info', text: string }>}
 */
export const tenantAlerts = (tenant) => {
  const alerts = [];
  const e = tenant.entitlements || {};
  if (tenant.legacy) alerts.push({ level: 'warning', text: 'Sem cadastro comercial: regularize para aplicar plano e limites.' });
  if (!tenant.legacy && ['suspended', 'cancelled'].includes(tenant.status)) {
    alerts.push({ level: 'info', text: tenant.status === 'cancelled' ? 'Conta encerrada.' : 'Conta suspensa: acesso bloqueado.' });
  }
  const assetsRatio = usageRatio(tenant.assetsCount || 0, e.maxAssets);
  const usersRatio = usageRatio(tenant.usersCount || 0, e.maxUsers);
  if (assetsRatio >= 1) alerts.push({ level: 'critical', text: `Limite de ativos atingido (${formatUsage(tenant.assetsCount, e.maxAssets)}).` });
  else if (assetsRatio >= 0.85) alerts.push({ level: 'warning', text: `Ativos em ${Math.round(assetsRatio * 100)}% do limite: oportunidade de upgrade.` });
  if (usersRatio >= 1) alerts.push({ level: 'critical', text: `Limite de usuários atingido (${formatUsage(tenant.usersCount, e.maxUsers)}).` });
  else if (usersRatio >= 0.85) alerts.push({ level: 'warning', text: `Usuários em ${Math.round(usersRatio * 100)}% do limite.` });
  if (!tenant.owner && tenant.status !== 'cancelled') alerts.push({ level: 'warning', text: 'Nenhum proprietário/administrador vinculado.' });
  if (['active', 'trial'].includes(tenant.status) && !tenant.legacy && daysSince(tenant.lastActivity) > 30) {
    alerts.push({ level: 'info', text: tenant.lastActivity ? `Sem acessos ${relativeDays(tenant.lastActivity)}: risco de cancelamento.` : 'Nenhum acesso registrado ainda.' });
  }
  return alerts;
};

export const ALERT_STYLE = {
  critical: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300',
  warning: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300',
  info: 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300',
};
