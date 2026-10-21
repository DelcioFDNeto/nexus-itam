// src/components/settings/BrandingSection.jsx
import React, { useState } from 'react';
import { AlertTriangle, Image as ImageIcon, Info, Palette, RotateCcw } from 'lucide-react';
import { contrastRatio, rgbChannels } from '../../utils/color';
import { safeCssColor, safeImageUrl } from '../../utils/sanitize';
import { Card, Field, SectionHeader } from './settingsUi';
import { inputClass, NEXUS_DEFAULT_COLOR } from './settingsStyles';

/** Pre-visualizacao da identidade antes de salvar (usa a cor em edicao, nao a aplicada). */
const BrandPreview = ({ companyName, logoUrl, color }) => {
  // Guarda QUAL url falhou: trocar a url limpa o aviso sem precisar de efeito.
  const [failedUrl, setFailedUrl] = useState(null);
  const channels = rgbChannels(color) || '79 70 229';
  const safeLogo = safeImageUrl(logoUrl);
  const logoFailed = Boolean(safeLogo) && failedUrl === safeLogo;
  const tint = `rgb(${channels} / 0.12)`;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-900">
        {safeLogo && !logoFailed ? (
          <img src={safeLogo} alt="" className="h-7 w-7 object-contain" onError={() => setFailedUrl(safeLogo)} />
        ) : (
          <div className="h-7 w-7 rounded-lg flex items-center justify-center text-white text-xs font-black" style={{ backgroundColor: color }}>
            {(companyName || 'N').charAt(0).toUpperCase()}
          </div>
        )}
        <span className="text-sm font-black text-gray-900 dark:text-white truncate">{companyName || 'Sua empresa'}</span>
      </div>
      <div className="p-4 flex flex-wrap items-center gap-2 bg-gray-50 dark:bg-slate-900/60">
        <span className="px-3 py-2 rounded-lg text-white text-xs font-bold" style={{ backgroundColor: color }}>Botão principal</span>
        <span className="px-3 py-2 rounded-lg text-xs font-bold" style={{ backgroundColor: tint, color }}>Item ativo</span>
        <span className="text-xs font-bold underline" style={{ color }}>Link</span>
      </div>
      {safeLogo && logoFailed && (
        <p className="px-4 py-2 text-[11px] font-bold text-amber-600 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400">
          Não foi possível carregar a imagem do logotipo. Verifique se a URL é pública (https).
        </p>
      )}
    </div>
  );
};

/** Logotipo e cor da marca: menu, etiquetas e termos. */
const BrandingSection = ({ config, set, whitelabel }) => {
  const effectiveColor = safeCssColor(config.primaryColor) || NEXUS_DEFAULT_COLOR;
  const contrast = contrastRatio(effectiveColor, '#ffffff');
  const lowContrast = contrast !== null && contrast < 3;

  return (
    <div className="space-y-6">
      <SectionHeader icon={Palette} title="Identidade visual" description="Logotipo e cor da marca no menu, nas etiquetas e nos termos de toda a equipe." />

      <Card icon={Palette} title="Marca">
        <Field label="URL do logotipo" hint="PNG, SVG ou WebP públicos (https). Ideal: fundo transparente." htmlFor="cfg-logo">
          <div className="relative">
            <ImageIcon size={14} className="absolute left-2.5 top-3 text-gray-400" />
            <input id="cfg-logo" className={`${inputClass} pl-8`} value={config.logoUrl} onChange={(e) => set('logoUrl', e.target.value.trim())} placeholder="https://..." />
          </div>
        </Field>

        <Field label="Cor da marca" hint="Botões, destaques e itens ativos do menu de toda a equipe.">
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="color"
              value={effectiveColor.startsWith('#') && effectiveColor.length === 7 ? effectiveColor : NEXUS_DEFAULT_COLOR}
              onChange={(e) => set('primaryColor', e.target.value)}
              className="h-10 w-14 rounded-lg border border-gray-200 dark:border-slate-700 bg-transparent p-1 cursor-pointer"
              aria-label="Selecionar cor da marca"
            />
            <input className={`${inputClass} w-32 font-mono`} value={config.primaryColor} onChange={(e) => set('primaryColor', e.target.value.trim())} placeholder={NEXUS_DEFAULT_COLOR} aria-label="Código da cor da marca" />
            {config.primaryColor && (
              <button type="button" onClick={() => set('primaryColor', '')} className="text-xs font-bold text-gray-500 hover:text-brand flex items-center gap-1">
                <RotateCcw size={12} /> Usar cor padrão Nexus
              </button>
            )}
          </div>
          {lowContrast && (
            <p className="mt-2 flex items-start gap-1.5 text-[11px] font-bold text-amber-600 dark:text-amber-400">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              Texto branco sobre esta cor fica difícil de ler (contraste {contrast.toFixed(1)}:1). Prefira um tom mais escuro.
            </p>
          )}
        </Field>

        <BrandPreview companyName={config.companyName} logoUrl={config.logoUrl} color={effectiveColor} />

        <p className="flex items-start gap-2 text-[11px] text-gray-500 dark:text-gray-400">
          <Info size={13} className="shrink-0 mt-0.5 text-brand" />
          {whitelabel
            ? 'Whitelabel completo ativo: a marca Nexus não aparece no menu, etiquetas nem termos.'
            : 'Seu plano exibe "Nexus ITAM" junto à sua marca. O whitelabel completo remove a marca Nexus dos impressos e do menu — fale com o suporte.'}
        </p>
      </Card>
    </div>
  );
};

export default BrandingSection;
