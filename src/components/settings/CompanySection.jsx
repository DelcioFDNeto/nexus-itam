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
  const [usage, setUsage] = useState({ assets: null, users: null });

  // Uso atual x limites do plano (contagem por agregacao, barata).
  useEffect(() => {
    if (!tenantId) return;
    Promise.allSettled([countAssets(tenantId), countMembers(tenantId)]).then(([assets, users]) => {
      setUsage({
        assets: assets.status === 'fulfilled' ? assets.value : null,
        users: users.status === 'fulfilled' ? users.value : null,
      });
    });
  }, [tenantId]);

  return (
    <div className="space-y-6">
      <SectionHeader icon={Building2} title="Empresa e plano" description="Dados que identificam a empresa nos documentos e o que o plano contratado inclui." />

      <Card icon={Building2} title="Dados da empresa">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Nome da empresa" htmlFor="cfg-company">
            <input id="cfg-company" className={inputClass} value={config.companyName} onChange={(e) => set('companyName', e.target.value)} placeholder="Ex: ACME Indústria" maxLength={120} />
          </Field>
          <Field label="CNPJ" htmlFor="cfg-cnpj">
            <input id="cfg-cnpj" className={inputClass} value={config.cnpj} onChange={(e) => set('cnpj', e.target.value)} placeholder="00.000.000/0001-00" />
          </Field>
          <Field label="Gestor de TI" hint="Assina os termos pela empresa." htmlFor="cfg-manager">
            <input id="cfg-manager" className={inputClass} value={config.itManager} onChange={(e) => set('itManager', e.target.value)} placeholder="Nome do responsável" />
          </Field>
        </div>
      </Card>

      <Card icon={CheckCircle} title="Plano da empresa" subtitle={entitlements?.legacy ? 'Conta sem plano definido (sem limites)' : entitlements?.planName}>
        {[
          ['Ativos', usage.assets, entitlements?.maxAssets],
          ['Usuários', usage.users, entitlements?.maxUsers],
        ].map(([label, current, limit]) => {
          const tone = usageTone(usageRatio(current ?? 0, limit));
          return (
            <div key={label}>
              <div className="flex justify-between text-xs font-bold text-gray-600 dark:text-gray-300">
                <span>{label}</span>
                <span className="tabular-nums">{current === null ? '…' : formatUsage(current, limit)}</span>
              </div>
              {limit !== null && limit !== undefined && (
                <div className="mt-1.5 h-1.5 rounded-full bg-gray-100 dark:bg-slate-700 overflow-hidden">
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
              <li key={feature.id} className={`flex items-center gap-2 text-xs ${on ? 'text-gray-700 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500'}`}>
                {on ? <CheckCircle size={13} className="text-green-500 shrink-0" /> : <Lock size={13} className="shrink-0" />}
                {feature.label}
              </li>
            );
          })}
        </ul>
      </Card>

      {can(currentUser, 'users:manage') && (
        <Link to="/users" className="flex items-center gap-3 rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 hover:border-brand/50 transition-colors">
          <Users size={18} className="text-brand" />
          <span className="min-w-0">
            <span className="block text-sm font-bold text-gray-800 dark:text-gray-100">Usuários e convites</span>
            <span className="block text-[11px] text-gray-500 dark:text-gray-400">Quem acessa o sistema, com qual papel.</span>
          </span>
        </Link>
      )}
    </div>
  );
};

export default CompanySection;
