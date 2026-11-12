// src/utils/portalBranding.js
import { safeCssColor, safeImageUrl } from './sanitize';

/**
 * Monta a URL do Portal do Colaborador preservando parametros de Whitelabel
 * (empresa, cor da marca, logotipo e flag whitelabel) para que a tela de
 * login em Vue 3 carregue a identidade da empresa antes mesmo da autenticacao.
 */
export const buildBrandedPortalUrl = (baseUrl, branding = {}) => {
  const cleanBase = String(baseUrl || '').trim().replace(/\/$/, '');
  if (!cleanBase) return '';

  const companyName = String(branding?.companyName || branding?.tenantName || '').trim();
  const primaryColor = safeCssColor(branding?.primaryColor);
  const logoUrl = safeImageUrl(branding?.logoUrl);
  const whitelabel = Boolean(
    branding?.whitelabel ?? branding?.entitlements?.features?.whitelabel,
  );

  try {
    const url = new URL(cleanBase);
    if (companyName && companyName !== 'Nexus ITAM') {
      url.searchParams.set('empresa', companyName);
    }
    if (primaryColor) {
      url.searchParams.set('cor', primaryColor);
    }
    if (logoUrl) {
      url.searchParams.set('logo', logoUrl);
    }
    if (whitelabel) {
      url.searchParams.set('wl', '1');
    }
    return url.toString();
  } catch {
    return cleanBase;
  }
};
