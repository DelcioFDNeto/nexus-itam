// src/components/settings/ModulesSection.jsx
import React from 'react';
import { Layers } from 'lucide-react';
import { FEATURES, hasFeature } from '../../utils/entitlements';
import { Card, SectionHeader } from './settingsUi';

const MODULES = FEATURES.filter((f) => f.module);

/** Liga e desliga modulos do menu (os dados continuam salvos). */
const ModulesSection = ({ config, set, currentUser, disabled }) => {
  const toggle = (moduleId) => {
    const hidden = new Set(config.hiddenModules || []);
    if (hidden.has(moduleId)) hidden.delete(moduleId);
    else hidden.add(moduleId);
    set('hiddenModules', [...hidden]);
  };

  return (
    <div className="space-y-6">
      <SectionHeader icon={Layers} title="Módulos" description="Oculte do menu o que sua equipe não usa. Os dados continuam salvos e voltam ao religar." />
      <Card icon={Layers} title="Módulos do menu">
        <ul className="divide-y divide-slate-100 dark:divide-zinc-800">
          {MODULES.map((mod) => {
            const entitled = hasFeature(currentUser, mod.id);
            const visible = !(config.hiddenModules || []).includes(mod.id);
            return (
              <li key={mod.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900 dark:text-[#fafafa] flex flex-wrap items-center gap-2">
                    {mod.label}
                    {!entitled && <span className="text-xs font-bold uppercase px-2 py-0.5 rounded bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-300">Fora do plano</span>}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">{mod.description}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={entitled && visible}
                  aria-label={`Exibir ${mod.label}`}
                  disabled={!entitled || disabled}
                  onClick={() => toggle(mod.id)}
                  className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] shrink-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand active:scale-[0.98] disabled:opacity-40"
                >
                  <span className={`relative block h-6 w-11 rounded-full transition-colors ${entitled && visible ? 'bg-brand' : 'bg-slate-300 dark:bg-zinc-700'}`}>
                    <span className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${entitled && visible ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
};

export default ModulesSection;
