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
        <ul className="divide-y divide-gray-100 dark:divide-slate-700">
          {MODULES.map((mod) => {
            const entitled = hasFeature(currentUser, mod.id);
            const visible = !(config.hiddenModules || []).includes(mod.id);
            return (
              <li key={mod.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                    {mod.label}
                    {!entitled && <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-gray-300">Fora do plano</span>}
                  </p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{mod.description}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={entitled && visible}
                  aria-label={`Exibir ${mod.label}`}
                  disabled={!entitled || disabled}
                  onClick={() => toggle(mod.id)}
                  className={`relative h-6 min-h-0 w-11 shrink-0 rounded-full p-0 transition-colors disabled:opacity-40 ${entitled && visible ? 'bg-brand' : 'bg-gray-300 dark:bg-slate-600'}`}
                >
                  <span className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${entitled && visible ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
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
