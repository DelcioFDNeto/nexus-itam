// src/utils/portalBranding.js
import { safeCssColor, safeImageUrl, safeText } from './sanitize';

const ALLOWED_PORTAL_PROTOCOLS = ['http:', 'https:'];
const MAX_QUERY_LOGO_LENGTH = 1024;
const MAX_PORTAL_URL_LENGTH = 1800;

/**
 * Resolve uma URL de logotipo segura e compacta para envio na query string.
 * Omite Data URIs (`data:image/...;base64,...`), `blob:` e URLs muito longas
 * para impedir erros HTTP 414 (`URI Too Long`) ao abrir ou compartilhar o Portal.
 */
export const resolveShareableLogoUrl = (rawValue) => {
  const raw = String(rawValue || '').trim();
  if (!raw || /^data:/i.test(raw) || /^blob:/i.test(raw)) return '';

  const safeUrl = safeImageUrl(raw);
  if (!safeUrl || !/^https?:\/\//i.test(safeUrl)) return '';
  if (safeUrl.length > MAX_QUERY_LOGO_LENGTH) return '';

  return safeUrl;
};

/**
 * Retorna aviso explicativo quando o logotipo salvo funciona localmente (Base64/longo),
 * mas não pode ser incluído como query param no link do Portal do Colaborador.
 */
export const getNonShareableLogoNotice = (logoUrl) => {
  if (!safeImageUrl(logoUrl) || resolveShareableLogoUrl(logoUrl)) return '';
  return 'Logotipos em Base64 (Data URI) ou URLs longas funcionam no console, etiquetas e termos, mas não são enviados no link do Portal do Colaborador para evitar erro HTTP 414 (URI Too Long). Para exibir no login do Portal, use uma URL https:// pública.';
};

const readActiveDomBrandColor = () => {
  if (typeof document === 'undefined' || !document.documentElement?.style) return '';
  return safeCssColor(document.documentElement.style.getPropertyValue('--color-brand').trim()) || '';
};

const readActiveDomTheme = (explicitTheme) => {
  if (explicitTheme === 'dark' || explicitTheme === 'light') return explicitTheme;
  if (typeof document === 'undefined' || !document.documentElement?.classList) return '';
  if (document.documentElement.classList.contains('dark')) return 'dark';
  if (document.documentElement.classList.contains('light')) return 'light';
  return '';
};

/**
 * Monta a URL do Portal do Colaborador preservando parametros de Whitelabel
 * (empresa, cor da marca, logotipo publico curto, tema e flag whitelabel) para que
 * a tela de login em Vue 3 carregue a mesma paleta do console antes da autenticacao.
 */
export const buildBrandedPortalUrl = (baseUrl, branding = {}) => {
  const cleanBase = String(baseUrl || '').trim().replace(/\/$/, '');
  if (!cleanBase) return '';

  const companyName = safeText(branding?.companyName || branding?.tenantName || branding?.tenant_name || '', 120).trim();
  const rawColor = branding?.primaryColor ?? branding?.primary_color;
  const primaryColor =
    rawColor != null && String(rawColor).trim() !== ''
      ? safeCssColor(rawColor)
      : readActiveDomBrandColor();
  const logoUrl = resolveShareableLogoUrl(branding?.logoUrl || branding?.logo_url);
  const themeMode = readActiveDomTheme(branding?.theme);
  const whitelabel = Boolean(
    branding?.whitelabel ?? branding?.entitlements?.features?.whitelabel,
  );

  try {
    const url = new URL(cleanBase);
    if (!ALLOWED_PORTAL_PROTOCOLS.includes(url.protocol)) return '';

    if (companyName && companyName !== 'Nexus ITAM') {
      url.searchParams.set('empresa', companyName);
    }
    if (primaryColor) {
      url.searchParams.set('cor', primaryColor);
    }
    if (themeMode) {
      url.searchParams.set('tema', themeMode);
    }
    if (whitelabel) {
      url.searchParams.set('wl', '1');
    }
    if (logoUrl) {
      url.searchParams.set('logo', logoUrl);
      if (url.toString().length > MAX_PORTAL_URL_LENGTH) {
        url.searchParams.delete('logo');
      }
    }
    return url.toString();
  } catch {
    return '';
  }
};
