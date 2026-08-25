// src/utils/sanitize.js
// -----------------------------------------------------------------------------
// Todo dado que vem do Firestore e vira URL, cor CSS ou atributo de DOM passa
// por aqui. Conteudo de um tenant nunca deve conseguir executar codigo na sessao
// de outro usuario do mesmo tenant.
// -----------------------------------------------------------------------------

// Caracteres de controle C0 + DEL, montados por codigo para nao poluir o fonte.
const CONTROL_CHARS = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`, 'g');

const SAFE_LINK_PROTOCOLS = ['http:', 'https:', 'mailto:', 'tel:'];
const SAFE_IMAGE_PROTOCOLS = ['http:', 'https:'];

const parse = (value) => {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    // Base relativa permite aceitar caminhos internos ("/relatorios/x.pdf").
    return new URL(value.trim(), window.location.origin);
  } catch {
    return null;
  }
};

/**
 * URL segura para `href`. Bloqueia `javascript:`, `data:` e `vbscript:`,
 * que executariam script no clique.
 * @returns {string|null} URL normalizada ou null se nao for confiavel.
 */
export const safeLinkUrl = (value) => {
  const url = parse(value);
  if (!url) return null;
  return SAFE_LINK_PROTOCOLS.includes(url.protocol) ? url.href : null;
};

/** URL segura para `src` de imagem. Aceita tambem data:image/* ja validado. */
export const safeImageUrl = (value) => {
  if (typeof value === 'string' && /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(value.trim())) {
    return value.trim();
  }
  const url = parse(value);
  if (!url) return '';
  return SAFE_IMAGE_PROTOCOLS.includes(url.protocol) ? url.href : '';
};

/**
 * Cor CSS segura para injetar em custom property (whitelabel).
 * Aceita apenas hex, rgb()/rgba() e hsl()/hsla() — nada de `url()` ou `;`.
 */
export const safeCssColor = (value) => {
  if (typeof value !== 'string') return null;
  const color = value.trim();
  if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(color)) return color;
  if (/^rgba?\(\s*[\d.%]+\s*,\s*[\d.%]+\s*,\s*[\d.%]+\s*(?:,\s*[\d.]+\s*)?\)$/.test(color)) return color;
  if (/^hsla?\(\s*[\d.]+(?:deg)?\s*,\s*[\d.]+%\s*,\s*[\d.]+%\s*(?:,\s*[\d.]+\s*)?\)$/.test(color)) return color;
  return null;
};

/** Texto de exibicao normalizado: corta tamanho e remove caracteres de controle. */
export const safeText = (value, maxLength = 500) =>
  String(value ?? '')
    .replace(CONTROL_CHARS, '')
    .slice(0, maxLength);

/**
 * Impede injecao de formula em exportacoes CSV/XLSX.
 * Uma celula iniciada por = + - @ e executada pelo Excel ao abrir o arquivo.
 */
export const safeSpreadsheetCell = (value) => {
  if (value == null) return '';
  const text = String(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
};
