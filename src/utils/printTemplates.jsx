// src/utils/printTemplates.jsx
// -----------------------------------------------------------------------------
// Documentos impressos: etiquetas patrimoniais e termo de responsabilidade.
//
// Antes o HTML de etiqueta estava copiado em quatro lugares (AssetList x2,
// AssetDetail x2) e o termo em um quinto, todos interpolando campos do banco
// SEM escape dentro de `document.write` — um modelo ou hostname com
// `<img onerror=...>` (inclusive vindo do agente sem login) executava script
// na sessao de quem imprimia. Aqui todo valor passa por `escapeHtml`, e a
// identidade visual vem da empresa (logo, cor, e-mail de suporte) em vez do
// e-mail fixo da primeira cliente.
// -----------------------------------------------------------------------------
import ReactDOMServer from 'react-dom/server';
import { QRCodeSVG } from 'qrcode.react';
import { safeCssColor, safeImageUrl } from './sanitize';
import { hasFeature } from './entitlements';

export const NEXUS_INDIGO = '#4F46E5';

export const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const upper = (value) => escapeHtml(String(value ?? '').toLocaleUpperCase('pt-BR'));

const qrSvg = (value, size) =>
  ReactDOMServer.renderToStaticMarkup(<QRCodeSVG value={String(value || '-')} size={size} level="M" />);

export const NEXUS_MARK_SVG = (size) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/></svg>`;

/**
 * Identidade usada nos impressos da empresa.
 * @param {object} config   documento /settings/{tenantId}
 * @param {object} user     currentUser (plano e nome da empresa)
 */
export const resolvePrintBranding = (config = {}, user = null) => {
  const companyName = String(config.companyName || user?.companyName || '').trim() || 'Nexus ITAM';
  return {
    companyName,
    cnpj: String(config.cnpj || '').trim(),
    supportEmail: String(config.supportEmail || '').trim(),
    itManager: String(config.itManager || '').trim(),
    labelFooter: String(config.labelFooter || '').trim() || 'SUPORTE TI',
    logoUrl: safeImageUrl(config.logoUrl) || '',
    color: safeCssColor(config.primaryColor) || NEXUS_INDIGO,
    // Whitelabel completo remove a marca Nexus dos impressos.
    showNexusBrand: !hasFeature(user, 'whitelabel'),
  };
};

// -----------------------------------------------------------------------------
// Etiquetas
// -----------------------------------------------------------------------------

const brandLine = (branding, size) => {
  if (branding.logoUrl) {
    return `<img class="brand-logo" src="${escapeHtml(branding.logoUrl)}" alt="" />`;
  }
  if (!branding.showNexusBrand) {
    return `<span class="brand-text" style="color:${escapeHtml(branding.color)}">${upper(branding.companyName)}</span>`;
  }
  return `<span class="brand-text" style="color:${NEXUS_INDIGO}">${NEXUS_MARK_SVG(size)} Nexus<span style="color:#111827">ITAM</span></span>`;
};

const companyLine = (branding) =>
  // Quando a linha de marca ja mostra o nome da empresa, nao repete.
  !branding.logoUrl && !branding.showNexusBrand ? '' : `<div class="company-line">${upper(branding.companyName)}</div>`;

const LABEL_STYLES = {
  asset: `
  .label { width: 7cm; height: 3.5cm; padding: 4px; border: 2px solid black; border-radius: 6px; display: flex; align-items: center; gap: 6px; background: white; overflow: hidden; page-break-inside: avoid; }
  .qr { width: 68px; height: 68px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
  .logo-row { min-height: 32px; border-bottom: 1px solid #eee; padding-bottom: 2px; align-items: flex-start; }
  .brand-text { font-size: 14px; letter-spacing: -0.5px; }
  .brand-logo { max-height: 22px; max-width: 120px; }
  .company-line { font-size: 6px; margin-top: 2px; }
  .id-label { font-size: 7px; }
  .id-value { font-size: 18px; letter-spacing: -0.5px; line-height: 1.1; }
  .sub { font-size: 8px; max-width: 125px; margin-top: 2px; }
  .footer-row { border-top: 1.5px solid #000; }
  .footer-left { font-size: 6px; }
  .footer-right { font-size: 8px; }`,
  peripheral: `
  .label { width: 5cm; height: 2.5cm; padding: 3px; border: 1.5px solid black; border-radius: 4px; display: flex; align-items: center; gap: 4px; background: white; overflow: hidden; page-break-inside: avoid; }
  .qr { width: 44px; height: 44px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
  .logo-row { min-height: 20px; border-bottom: 1px solid #eee; padding-bottom: 1px; align-items: center; }
  .brand-text { font-size: 8px; letter-spacing: -0.2px; }
  .brand-logo { max-height: 14px; max-width: 90px; }
  .company-line { font-size: 4px; margin-top: 1px; text-align: center; }
  .id-label { font-size: 4.5px; }
  .id-value { font-size: 11px; letter-spacing: -0.2px; line-height: 1; }
  .sub { font-size: 6px; max-width: 95px; }
  .footer-row { border-top: 1px solid #000; }
  .footer-left { font-size: 4px; }
  .footer-right { font-size: 5px; }`,
};

/**
 * Documento HTML com uma ou varias etiquetas.
 * @param {Array<{code:string, title?:string, subtitle?:string}>} items
 *   code: patrimonio (vira QR); subtitle: modelo do ativo ou nome do acessorio
 * @param {object} branding resolvePrintBranding()
 * @param {{variant?: 'asset'|'peripheral', title?: string, grid?: boolean}} options
 */
export const buildLabelsDocument = (items, branding, { variant = 'asset', title = 'Etiquetas', grid = true } = {}) => {
  const isPeripheral = variant === 'peripheral';
  const qrSize = isPeripheral ? 42 : 68;
  const idLabel = isPeripheral ? 'Patrimônio / Periférico' : 'Patrimônio';

  const labels = items
    .map((item) => `<div class="label">
    <div class="qr">${qrSvg(item.code, qrSize)}</div>
    <div class="info">
      <div class="logo-row">${brandLine(branding, isPeripheral ? 8 : 14)}${companyLine(branding)}</div>
      <div class="id-section">
        <span class="id-label">${idLabel}</span>
        <span class="id-value">${escapeHtml(item.code)}</span>
        ${item.subtitle ? `<span class="sub">${escapeHtml(item.subtitle)}</span>` : ''}
      </div>
      <div class="footer-row">
        <span class="footer-left">${escapeHtml(branding.labelFooter)}</span>
        <span class="footer-right">${escapeHtml(branding.supportEmail)}</span>
      </div>
    </div>
  </div>`)
    .join('');

  const columns = isPeripheral ? 4 : 3;
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title>
<style>
  @page { size: ${grid ? 'A4' : 'auto'}; margin: 5mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { margin: 0; padding: ${grid ? '5mm' : '10px'}; font-family: Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact;
    ${grid ? '' : 'display: flex; justify-content: center; align-items: center; min-height: 100vh;'} }
  .print-grid { display: grid; grid-template-columns: repeat(${columns}, 1fr); gap: ${isPeripheral ? '3mm' : '5mm'}; justify-items: center; width: 100%; }
  .info { display: flex; flex-direction: column; height: 100%; flex-grow: 1; justify-content: space-between; overflow: hidden; }
  .logo-row { display: flex; flex-direction: column; justify-content: center; overflow: hidden; }
  .brand-text { display: flex; align-items: center; gap: 3px; font-weight: 900; line-height: 1; font-family: sans-serif; }
  .brand-logo { object-fit: contain; }
  .company-line { width: 100%; font-weight: 900; color: #111827; text-transform: uppercase; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .id-section { display: flex; flex-direction: column; justify-content: center; }
  .id-label { font-weight: bold; color: #666; text-transform: uppercase; line-height: 1; }
  .id-value { font-weight: 900; color: black; font-family: monospace; }
  .sub { font-weight: bold; color: #333; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .footer-row { padding-top: 1px; margin-top: auto; display: flex; justify-content: space-between; align-items: center; gap: 4px; }
  .footer-left { font-weight: bold; color: #444; white-space: nowrap; }
  .footer-right { font-weight: 900; color: #000; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  ${LABEL_STYLES[variant] || LABEL_STYLES.asset}
</style></head><body>
  ${grid ? `<div class="print-grid">${labels}</div>` : labels}
</body></html>`;
};

/**
 * Imprime quando o documento terminou de carregar (inclusive o logo). Antes um
 * atraso fixo de 500 ms podia imprimir a pagina sem a imagem.
 */
const printWhenReady = (printWindow) => {
  const started = Date.now();
  const tick = () => {
    if (printWindow.closed) return;
    const doc = printWindow.document;
    const ready = doc.readyState === 'complete' && [...doc.images].every((img) => img.complete);
    if (ready || Date.now() - started > 4000) {
      printWindow.focus();
      printWindow.print();
    } else {
      setTimeout(tick, 150);
    }
  };
  setTimeout(tick, 250);
};

const writeDocument = (printWindow, html) => {
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWhenReady(printWindow);
};

/**
 * Abre o documento numa janela nova e dispara a impressao (funciona no mobile,
 * onde imprimir um iframe oculto falha). Retorna false se o popup foi bloqueado.
 */
export const printHtml = (html) => {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return false;
  writeDocument(printWindow, html);
  return true;
};

/**
 * Abre a janela de impressao JA no clique, antes de uma operacao assincrona
 * (ex.: registrar o termo e obter o numero). Navegadores bloqueiam popups
 * abertos depois de um await. Retorna null se o popup foi bloqueado.
 *   const win = openPrintWindow();
 *   const term = await issue(...);
 *   win.print(html)   // ou win.close() em caso de erro
 */
export const openPrintWindow = (message = 'Gerando documento…') => {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return null;
  printWindow.document.write(`<p style="font-family:sans-serif;padding:32px;color:#555">${escapeHtml(message)}</p>`);
  return {
    print: (html) => writeDocument(printWindow, html),
    close: () => printWindow.close(),
  };
};
