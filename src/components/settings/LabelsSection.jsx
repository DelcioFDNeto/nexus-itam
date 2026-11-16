// src/components/settings/LabelsSection.jsx
import React from 'react';
import { Tag } from 'lucide-react';
import { safeCssColor, safeImageUrl } from '../../utils/sanitize';
import { Card, Field, SectionHeader } from './settingsUi';
import { inputClass, NEXUS_DEFAULT_COLOR } from './settingsStyles';

/** Etiqueta patrimonial: contato de suporte e rodape, com previa. */
const LabelsSection = ({ config, set, whitelabel }) => {
  const color = safeCssColor(config.primaryColor) || NEXUS_DEFAULT_COLOR;
  const logo = safeImageUrl(config.logoUrl);

  return (
    <div className="space-y-6">
      <SectionHeader icon={Tag} title="Etiquetas" description="O que sai na etiqueta patrimonial com QR code colada em cada equipamento." />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card icon={Tag} title="Conteúdo da etiqueta">
          <Field label="E-mail de suporte" hint="Quem achar o equipamento sabe a quem avisar." htmlFor="cfg-support">
            <input id="cfg-support" name="supportEmail" type="email" className={inputClass} value={config.supportEmail} onChange={(e) => set('supportEmail', e.target.value)} placeholder="suporte@empresa.com" />
          </Field>
          <Field label="Texto do rodapé" hint="Até 24 caracteres, em maiúsculas." htmlFor="cfg-footer">
            <input id="cfg-footer" name="labelFooter" className={inputClass} value={config.labelFooter} onChange={(e) => set('labelFooter', e.target.value.toUpperCase())} placeholder="SUPORTE TI" maxLength={24} />
          </Field>
          <p className="text-xs text-slate-500 dark:text-zinc-400">Logotipo e nome vêm de Identidade visual e Empresa.</p>
        </Card>

        <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-[#111113] p-5">
          <p className="text-xs font-black text-slate-600 dark:text-zinc-400 uppercase mb-3 flex items-center gap-1.5">
            <Tag size={14} aria-hidden="true" /> Prévia
          </p>
          <div className="mx-auto w-full max-w-[280px] rounded-lg border-2 border-slate-900 bg-white p-3 font-sans text-slate-900" aria-label="Prévia da etiqueta">
            <div className="border-b border-slate-200 pb-2 flex items-center gap-2 min-h-[28px]">
              {logo ? (
                <img src={logo} alt="" className="h-5 max-w-[110px] object-contain" />
              ) : whitelabel ? (
                <span className="text-sm font-black uppercase" style={{ color }}>{config.companyName || 'Sua empresa'}</span>
              ) : (
                <span className="text-sm font-black leading-none" style={{ color: NEXUS_DEFAULT_COLOR }}>Nexus<span className="text-slate-900">ITAM</span></span>
              )}
            </div>
            {(!whitelabel || logo) && <p className="mt-1.5 truncate text-xs font-black uppercase">{config.companyName || 'Sua empresa'}</p>}
            <p className="pt-2 text-xs font-black uppercase text-slate-600">Patrimônio</p>
            <p className="font-mono text-xl font-black tabular-nums">TAG-001</p>
            <div className="mt-2 flex items-center justify-between border-t border-slate-900 pt-1.5 gap-2">
              <span className="text-xs font-black text-slate-700">{config.labelFooter || 'SUPORTE TI'}</span>
              <span className="truncate text-xs font-black">{config.supportEmail}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LabelsSection;
