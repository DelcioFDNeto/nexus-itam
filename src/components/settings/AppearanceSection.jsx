// src/components/settings/AppearanceSection.jsx
import React from 'react';
import { CheckCircle, UserCog } from 'lucide-react';
import { ACCENTS, useTheme } from '../../contexts/ThemeContext';
import { safeCssColor } from '../../utils/sanitize';
import { Card, SectionHeader } from './settingsUi';
import { NEXUS_DEFAULT_COLOR } from './settingsStyles';

/** Preferencias visuais de quem esta usando (so este navegador). */
const AppearanceSection = () => {
  const { theme, setTheme, accentColor, setAccentColor, tenantBrand } = useTheme();

  return (
    <div className="space-y-6">
      <SectionHeader icon={UserCog} title="Minha aparência" description="Só para você, neste navegador. Não muda nada para o resto da equipe." />
      <Card icon={UserCog} title="Tema e destaque">
        <div>
          <h3 className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-2">Modo de exibição</h3>
          <div className="grid grid-cols-3 gap-2 max-w-md">
            {[
              ['light', 'Claro', 'bg-white border-gray-200'],
              ['dark', 'Escuro', 'bg-slate-900 border-slate-700'],
              ['system', 'Sistema', 'bg-gradient-to-tr from-slate-900 to-white border-gray-300'],
            ].map(([value, label, swatch]) => (
              <button
                key={value}
                type="button"
                onClick={() => setTheme(value)}
                aria-pressed={theme === value}
                className={`py-3 border-2 rounded-xl text-xs font-bold flex flex-col items-center gap-2 transition-all ${theme === value ? 'border-brand text-brand bg-brand/5' : 'border-gray-200 dark:border-slate-600 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-slate-500'}`}
              >
                <span className={`w-7 h-7 rounded-full border shadow-sm ${swatch}`} />
                {label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <h3 className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-2">Cor de destaque</h3>
          <div className="flex flex-wrap gap-3 items-center">
            {/* "Empresa" devolve a cor da marca */}
            <button
              type="button"
              onClick={() => setAccentColor(null)}
              title="Automático: cor da empresa"
              aria-pressed={!accentColor}
              className={`h-10 px-3 rounded-full flex items-center gap-2 text-[11px] font-black border-2 transition-all ${!accentColor ? 'border-brand text-brand' : 'border-gray-200 dark:border-slate-600 text-gray-500 dark:text-gray-400'}`}
            >
              <span className="w-4 h-4 rounded-full" style={{ backgroundColor: safeCssColor(tenantBrand) || NEXUS_DEFAULT_COLOR }} />
              Empresa
            </button>
            {Object.entries(ACCENTS).map(([id, color]) => (
              <button
                key={id}
                type="button"
                onClick={() => setAccentColor(id)}
                aria-label={`Destaque ${id}`}
                aria-pressed={accentColor === id}
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${accentColor === id ? 'ring-4 ring-offset-2 ring-brand dark:ring-offset-slate-800 scale-110' : 'hover:scale-105'}`}
                style={{ backgroundColor: color }}
              >
                {accentColor === id && <CheckCircle size={16} className="text-white drop-shadow-md" />}
              </button>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
};

export default AppearanceSection;
