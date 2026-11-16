// src/components/settings/AppearanceSection.jsx
import React from 'react';
import { CheckCircle, UserCog } from 'lucide-react';
import { ACCENTS, useTheme } from '../../contexts/ThemeContext';
import { pickContrastFg } from '../../utils/color';
import { safeCssColor } from '../../utils/sanitize';
import { Card, SectionHeader } from './settingsUi';
import { NEXUS_DEFAULT_COLOR } from './settingsStyles';

const ACCENT_LABELS = {
  blue: 'Azul corporativo',
  green: 'Verde esmeralda',
  teal: 'Petróleo',
  orange: 'Laranja',
  cyan: 'Ciano',
};

/** Preferencias visuais de quem esta usando (so este navegador). */
const AppearanceSection = () => {
  const { theme, setTheme, accentColor, setAccentColor, tenantBrand } = useTheme();

  return (
    <div className="space-y-6">
      <SectionHeader icon={UserCog} title="Minha aparência" description="Só para você, neste navegador. Não muda nada para o resto da equipe." />
      <Card icon={UserCog} title="Tema e destaque">
        <div>
          <h3 className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest mb-2">Modo de exibição</h3>
          <div className="grid grid-cols-3 gap-2 max-w-md">
            {[
              ['light', 'Claro', 'bg-white border-slate-200'],
              ['dark', 'Escuro', 'bg-zinc-900 border-zinc-700'],
              ['system', 'Sistema', 'bg-gradient-to-tr from-zinc-900 to-white border-slate-300'],
            ].map(([value, label, swatch]) => (
              <button
                key={value}
                type="button"
                onClick={() => setTheme(value)}
                aria-pressed={theme === value}
                className={`min-h-[44px] py-3 border-2 rounded-xl text-xs font-bold flex flex-col items-center gap-2 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#111113] ${
                  theme === value
                    ? 'border-brand text-brand-aa bg-brand/5 active:bg-brand/10'
                    : 'border-slate-200 dark:border-zinc-700 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-zinc-500 active:bg-slate-100 dark:active:bg-zinc-800'
                }`}
              >
                <span className={`w-7 h-7 rounded-full border shadow-sm ${swatch}`} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <h3 className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest mb-2">Cor de destaque</h3>
          <div className="flex flex-wrap gap-3 items-center">
            {/* "Empresa" devolve a cor da marca */}
            <button
              type="button"
              onClick={() => setAccentColor(null)}
              title="Automático: cor da empresa"
              aria-pressed={!accentColor}
              className={`min-h-[44px] px-4 rounded-full flex items-center gap-2 text-xs font-bold border-2 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#111113] ${
                !accentColor
                  ? 'border-brand text-brand-aa bg-brand/5 active:bg-brand/10'
                  : 'border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-zinc-500 active:bg-slate-100 dark:active:bg-zinc-800'
              }`}
            >
              <span
                className="w-4 h-4 rounded-full shrink-0"
                aria-hidden="true"
                style={{ backgroundColor: safeCssColor(tenantBrand) || NEXUS_DEFAULT_COLOR }}
              />
              Empresa
            </button>
            {Object.entries(ACCENTS).map(([id, color]) => {
              const label = ACCENT_LABELS[id] || id;
              const fg = pickContrastFg(color);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setAccentColor(id)}
                  aria-label={`Destaque ${label}`}
                  title={label}
                  aria-pressed={accentColor === id}
                  className={`min-w-[44px] min-h-[44px] w-11 h-11 rounded-full flex items-center justify-center transition-colors active:scale-95 active:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#111113] ${
                    accentColor === id
                      ? 'ring-4 ring-offset-2 ring-brand dark:ring-offset-[#111113]'
                      : 'hover:opacity-90'
                  }`}
                  style={{ backgroundColor: color }}
                >
                  {accentColor === id && (
                    <CheckCircle size={18} style={{ color: fg }} aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </Card>
    </div>
  );
};

export default AppearanceSection;
