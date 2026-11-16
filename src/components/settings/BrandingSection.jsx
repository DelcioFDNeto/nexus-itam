// src/components/settings/BrandingSection.jsx
import React, { useState } from 'react';
import { AlertTriangle, Image as ImageIcon, Info, Palette, RotateCcw } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { contrastRatio, ensureContrastOnSurface, pickContrastFg, rgbChannels } from '../../utils/color';
import { getNonShareableLogoNotice } from '../../utils/portalBranding';
import { safeCssColor, safeImageUrl } from '../../utils/sanitize';
import { Card, Field, SectionHeader } from './settingsUi';
import { inputClass, NEXUS_DEFAULT_COLOR } from './settingsStyles';

/** Pre-visualizacao da identidade antes de salvar (usa a cor em edicao, nao a aplicada). */
const BrandPreview = ({ companyName, logoUrl, color }) => {
  // Guarda QUAL url falhou: trocar a url limpa o aviso sem precisar de efeito.
  const [failedUrl, setFailedUrl] = useState(null);
  const { isDark } = useTheme() || {};
  const channels = rgbChannels(color) || '12 92 171';
  const safeLogo = safeImageUrl(logoUrl);
  const logoFailed = Boolean(safeLogo) && failedUrl === safeLogo;
  const tint = `rgb(${channels} / 0.12)`;
  const fg = pickContrastFg(color);
  const readableText = ensureContrastOnSurface(color, isDark ? '#111113' : '#f8fafc', 4.5) || color;

  return (
    <div className="rounded-xl border border-slate-200 dark:border-zinc-700 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 dark:border-zinc-800 bg-white dark:bg-[#111113]">
        {safeLogo && !logoFailed ? (
          <img src={safeLogo} alt="" className="h-7 w-7 object-contain" onError={() => setFailedUrl(safeLogo)} />
        ) : (
          <div
            className="h-7 w-7 rounded-lg flex items-center justify-center text-xs font-bold"
            style={{ backgroundColor: color, color: fg }}
          >
            {(companyName || 'N').charAt(0).toUpperCase()}
          </div>
        )}
        <span className="text-sm font-bold text-slate-900 dark:text-white truncate">{companyName || 'Sua empresa'}</span>
      </div>
      <div className="p-4 flex flex-wrap items-center gap-2 bg-slate-50 dark:bg-zinc-900/60">
        <span className="px-3 py-2 rounded-lg text-xs font-bold" style={{ backgroundColor: color, color: fg }}>
          Botão principal
        </span>
        <span className="px-3 py-2 rounded-lg text-xs font-bold" style={{ backgroundColor: tint, color: readableText }}>
          Item ativo
        </span>
        <span className="text-xs font-bold underline" style={{ color: readableText }}>
          Link
        </span>
      </div>
      {safeLogo && logoFailed && (
        <p className="px-4 py-2 text-xs font-bold text-amber-800 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400">
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
  const lowContrast = contrast !== null && contrast < 4.5;
  const logoNotice = getNonShareableLogoNotice(config.logoUrl);

  return (
    <div className="space-y-6">
      <SectionHeader icon={Palette} title="Identidade visual" description="Logotipo e cor da marca no menu, nas etiquetas e nos termos de toda a equipe." />

      <Card icon={Palette} title="Marca">
        <Field label="URL do logotipo" hint="PNG, SVG ou WebP públicos (https). Ideal: fundo transparente." htmlFor="cfg-logo">
          <div className="relative">
            <ImageIcon
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 pointer-events-none"
              aria-hidden="true"
            />
            <input
              id="cfg-logo"
              type="url"
              autoComplete="url"
              spellCheck={false}
              className={`${inputClass} pl-9`}
              value={config.logoUrl}
              onChange={(e) => set('logoUrl', e.target.value.trim())}
              placeholder="https://…"
            />
          </div>
          {logoNotice && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-slate-600 dark:text-slate-400">
              <Info size={14} className="shrink-0 mt-0.5 text-brand-aa" aria-hidden="true" />
              <span>{logoNotice}</span>
            </p>
          )}
        </Field>

        <Field label="Cor da marca" hint="Botões, destaques e itens ativos do menu de toda a equipe.">
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="color"
              value={effectiveColor.startsWith('#') && effectiveColor.length === 7 ? effectiveColor : NEXUS_DEFAULT_COLOR}
              onChange={(e) => set('primaryColor', e.target.value)}
              className="h-11 min-h-[44px] w-14 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent p-1 cursor-pointer transition-colors hover:border-slate-300 dark:hover:border-slate-500 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              aria-label="Selecionar cor da marca"
            />
            <input
              className={`${inputClass} w-32 font-mono`}
              value={config.primaryColor}
              onChange={(e) => set('primaryColor', e.target.value.trim())}
              placeholder={NEXUS_DEFAULT_COLOR}
              spellCheck={false}
              aria-label="Código da cor da marca"
            />
            {config.primaryColor && (
              <button
                type="button"
                onClick={() => set('primaryColor', '')}
                className="min-h-[44px] px-3 rounded-lg text-xs font-bold text-slate-600 dark:text-slate-400 hover:text-brand-aa hover:bg-slate-100 dark:hover:bg-zinc-800 active:bg-slate-200 dark:active:bg-zinc-700 active:scale-[0.98] flex items-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <RotateCcw size={13} aria-hidden="true" /> Usar cor padrão Nexus
              </button>
            )}
          </div>
          {lowContrast && (
            <p className="mt-2 flex items-start gap-1.5 text-xs font-bold text-amber-800 dark:text-amber-400">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
              Texto branco sobre esta cor fica abaixo do mínimo WCAG AA ({contrast.toFixed(1)}:1, ideal ≥ 4.5:1). Prefira um tom mais escuro.
            </p>
          )}
        </Field>

        <BrandPreview companyName={config.companyName} logoUrl={config.logoUrl} color={effectiveColor} />

        <p className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-400">
          <Info size={14} className="shrink-0 mt-0.5 text-brand-aa" aria-hidden="true" />
          {whitelabel
            ? 'Whitelabel completo ativo: a marca Nexus não aparece no menu, etiquetas nem termos.'
            : 'Seu plano exibe "Nexus ITAM" junto à sua marca. O whitelabel completo remove a marca Nexus dos impressos e do menu — fale com o suporte.'}
        </p>
      </Card>
    </div>
  );
};

export default BrandingSection;
