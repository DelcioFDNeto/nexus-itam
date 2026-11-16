// src/components/settings/CompanySection.jsx
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, CheckCircle, Lock, Users } from 'lucide-react';
import { countAssets, countMembers } from '../../services/tenantService';
import { FEATURES, formatUsage, hasFeature, usageRatio, usageTone } from '../../utils/entitlements';
import { can } from '../../utils/permissions';
import { Card, Field, SectionHeader } from './settingsUi';
import { inputClass } from './settingsStyles';

const toneBar = (tone) => (tone === 'critical' ? 'bg-rose-500' : tone === 'warning' ? 'bg-amber-500' : 'bg-brand');

/** Dados cadastrais da empresa e uso do plano. */
const CompanySection = ({ config, set, currentUser }) => {
  const tenantId = currentUser?.tenantId;
  const entitlements = currentUser?.entitlements;
  const [usageState, setUsageState] = useState({ tenantId: null, assets: null, users: null });
  const usage = usageState.tenantId === tenantId ? usageState : { assets: null, users: null };

  // Uso atual x limites do plano (contagem por agregacao, barata).
  useEffect(() => {
    if (!tenantId) return undefined;
    let cancelled = false;
    Promise.allSettled([countAssets(tenantId), countMembers(tenantId)]).then(([assets, users]) => {
      if (cancelled) return;
      setUsageState({
        tenantId,
        assets: assets.status === 'fulfilled' ? assets.value : null,
        users: users.status === 'fulfilled' ? users.value : null,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  return (
    <div className="space-y-6">
      <SectionHeader icon={Building2} title="Empresa e plano" description="Dados que identificam a empresa nos documentos e o que o plano contratado inclui." />

      <Card icon={Building2} title="Dados da empresa">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Nome da empresa" htmlFor="cfg-company">
            <input id="cfg-company" name="companyName" className={inputClass} value={config.companyName} onChange={(e) => set('companyName', e.target.value)} placeholder="Ex: ACME Indústria" maxLength={120} />
          </Field>
          <Field label="CNPJ" htmlFor="cfg-cnpj">
            <input id="cfg-cnpj" name="cnpj" className={inputClass} value={config.cnpj} onChange={(e) => set('cnpj', e.target.value)} placeholder="00.000.000/0001-00" />
          </Field>
          <Field label="Gestor de TI" hint="Assina os termos pela empresa." htmlFor="cfg-manager">
            <input id="cfg-manager" name="itManager" className={inputClass} value={config.itManager} onChange={(e) => set('itManager', e.target.value)} placeholder="Nome do responsável" />
          </Field>
        </div>
      </Card>

      <Card
        icon={CheckCircle}
        title="Plano da empresa"
        subtitle={entitlements?.legacy ? 'Conta sem plano definido (sem limites)' : entitlements?.planName}
        action={(
          <Link
            to="/plano"
            className="inline-flex items-center justify-center gap-1.5 px-4 min-h-[44px] rounded-xl bg-brand hover:bg-brand-dark text-brand-fg text-xs font-black uppercase tracking-wider shadow-sm transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            Personalizar Plano
          </Link>
        )}
      >
        {[
          ['Ativos', usage.assets, entitlements?.maxAssets],
          ['Usuários', usage.users, entitlements?.maxUsers],
        ].map(([label, current, limit]) => {
          const tone = usageTone(usageRatio(current ?? 0, limit));
          return (
            <div key={label}>
              <div className="flex justify-between text-xs font-bold text-slate-700 dark:text-zinc-300">
                <span>{label}</span>
                <span className="tabular-nums">{current === null ? '…' : formatUsage(current, limit)}</span>
              </div>
              {limit !== null && limit !== undefined && (
                <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 dark:bg-zinc-800 overflow-hidden">
                  <div className={`h-full rounded-full ${toneBar(tone)}`} style={{ width: `${Math.min(100, usageRatio(current ?? 0, limit) * 100)}%` }} />
                </div>
              )}
            </div>
          );
        })}
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-2">
          {FEATURES.map((feature) => {
            const on = hasFeature(currentUser, feature.id);
            return (
              <li key={feature.id} className={`flex items-center gap-2 text-xs ${on ? 'text-slate-700 dark:text-zinc-200' : 'text-slate-400 dark:text-zinc-500'}`}>
                {on ? <CheckCircle size={13} className="text-emerald-500 shrink-0" aria-hidden="true" /> : <Lock size={13} className="shrink-0" aria-hidden="true" />}
                {feature.label}
              </li>
            );
          })}
        </ul>
      </Card>

      {can(currentUser, 'users:manage') && (
        <Link to="/users" className="flex items-center gap-3 rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-4 min-h-[44px] hover:border-brand/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
          <Users size={18} className="text-brand-aa shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-sm font-bold text-slate-900 dark:text-[#fafafa]">Usuários e convites</span>
            <span className="block text-xs text-slate-500 dark:text-zinc-400">Quem acessa o sistema, com qual papel.</span>
          </span>
        </Link>
      )}
    </div>
  );
};

export default CompanySection;
