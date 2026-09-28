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

const NEXUS_INDIGO = '#4F46E5';

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

const NEXUS_MARK_SVG = (size) =>
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

// -----------------------------------------------------------------------------
// Termo de responsabilidade
// -----------------------------------------------------------------------------

export const DEFAULT_TERM_CLAUSES = `1. DO USO E FINALIDADE: O(a) Responsável declara ter recebido o equipamento acima descrito em perfeito estado de conservação e funcionamento. Compromete-se a utilizá-lo estrita e exclusivamente para fins profissionais, sendo vedado o uso para fins pessoais, empréstimo a terceiros ou instalação de softwares não autorizados pela TI.
2. DA GUARDA E CONSERVAÇÃO: É responsabilidade do(a) Responsável zelar pela guarda, segurança e conservação do equipamento. O mau uso, negligência, imprudência ou imperícia que resultar em danos ao equipamento sujeitará o(a) Responsável às sanções cíveis e disciplinares previstas em lei.
3. DA RESTITUIÇÃO: O equipamento deverá ser devolvido imediatamente à Empresa, em perfeito estado (salvo desgaste natural), nas seguintes hipóteses: a) Rescisão do contrato de trabalho ou encerramento da prestação de serviços; b) Mudança de cargo ou função; c) Solicitação expressa da Empresa a qualquer tempo.
4. DO EXTRAVIO, DANO OU FURTO: Em conformidade com o Art. 186 do Código Civil e, quando aplicável, Art. 462, §1º da CLT, o(a) Responsável AUTORIZA EXPRESSAMENTE o desconto em seus recebimentos (faturas/notas fiscais), folha de pagamento ou verbas rescisórias dos valores correspondentes ao reparo ou reposição do equipamento, caso seja comprovado que os danos ou o extravio decorreram de DOLO (intenção), NEGLIGÊNCIA (falta de cuidado) ou uso em desconformidade com as normas da empresa (mau uso).
5. DA SEGURANÇA DA INFORMAÇÃO: O(a) Responsável está ciente de que o equipamento é monitorado e que não deve armazenar dados pessoais sensíveis, responsabilizando-se pelo sigilo de suas senhas e cumprimento das normas de LGPD da empresa.`;

/**
 * Termo de entrega e responsabilidade (A4).
 * @param {{ asset: object, assetId: string, branding: object, termTitle?: string, clauses?: string }} input
 */
export const buildTermDocument = ({ asset, assetId, branding, termTitle, clauses }) => {
  const responsible = asset.assignedTo || asset.clientName || '';
  const cnpj = branding.cnpj || '00.000.000/0001-00';
  const accessories = Array.isArray(asset.accessories) ? asset.accessories.join(', ') : asset.accessories || '';
  const peripherals = (asset.peripherals || []).map((p) => p?.name).filter(Boolean).join(', ');
  const clauseItems = String(clauses || DEFAULT_TERM_CLAUSES)
    .split('\n')
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => `<li class="clause-item">${escapeHtml(c)}</li>`)
    .join('');

  const logo = branding.logoUrl
    ? `<img class="logo-img" src="${escapeHtml(branding.logoUrl)}" alt="" />`
    : branding.showNexusBrand
      ? `<div class="nexus-mark">${NEXUS_MARK_SVG(22)} NEXUS<span style="color:#111827">ITAM</span></div>`
      : '';

  const footer = branding.showNexusBrand
    ? `Documento gerado eletronicamente pela plataforma Nexus ITAM. ID: ${escapeHtml(assetId)}`
    : `Documento gerado eletronicamente por ${escapeHtml(branding.companyName)}. ID: ${escapeHtml(assetId)}`;

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Termo_${escapeHtml(asset.internalId || assetId)}</title>
<style>
  @page { size: A4; margin: 14mm 15mm; }
  body { font-family: 'Times New Roman', Times, serif; color: #000; line-height: 1.4; margin: 0; padding: 15px 20px; }
  .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid ${escapeHtml(branding.color)}; padding-bottom: 12px; margin-bottom: 14px; }
  .header-left { display: flex; align-items: center; gap: 14px; }
  .logo-img { height: 44px; max-width: 160px; object-fit: contain; }
  .nexus-mark { font-weight: 900; font-family: sans-serif; display: flex; align-items: center; gap: 6px; color: ${NEXUS_INDIGO}; font-size: 22px; letter-spacing: -0.5px; }
  .title { text-align: center; font-weight: bold; font-size: 14px; text-transform: uppercase; margin: 14px 0; }
  .content { font-size: 10.5px; text-align: justify; margin-bottom: 8px; line-height: 1.4; }
  .box { border: 1px solid #000; padding: 8px 10px; margin: 10px 0; background-color: #f9f9f9; }
  .box-title { font-weight: bold; font-size: 11px; margin-bottom: 4px; text-decoration: underline; }
  .grid-info { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size: 10.5px; }
  .label { font-weight: bold; text-transform: uppercase; font-size: 8.5px; color: #333; }
  .value { font-weight: bold; font-size: 10.5px; margin-left: 3px; }
  .clauses { padding-left: 0; list-style-type: none; }
  .clause-item { margin-bottom: 6px; font-size: 10px; line-height: 1.35; text-align: justify; }
  .signatures { display: flex; justify-content: space-between; margin-top: 40px; text-align: center; }
  .line { border-top: 1px solid #000; width: 210px; margin-bottom: 5px; }
  .footer { margin-top: 20px; font-size: 8.5px; text-align: center; border-top: 1px solid #ccc; padding-top: 5px; }
</style></head><body>
  <div class="header">
    <div class="header-left">
      ${logo}
      <div>
        <h1 style="font-size:18px;margin:0;font-weight:900">${upper(branding.companyName)}</h1>
        <p style="margin:2px 0 0;font-size:9.5px">CNPJ: ${escapeHtml(cnpj)}</p>
        <p style="margin:0;font-size:9.5px">Departamento de Tecnologia da Informação</p>
      </div>
    </div>
    <div style="text-align:right"><p style="margin:0;font-size:9.5px">Emitido em: ${new Date().toLocaleDateString('pt-BR')}</p></div>
  </div>
  <h2 class="title">${escapeHtml(termTitle || 'Termo de Entrega e Responsabilidade')}</h2>
  <p class="content">
    Pelo presente instrumento particular, de um lado a empresa <strong>${escapeHtml(branding.companyName)}</strong>, inscrita no CNPJ sob o nº <strong>${escapeHtml(cnpj)}</strong>, e de outro lado o(a) responsável abaixo qualificado(a),
    celebram o presente termo de responsabilidade e comodato, regido pelas cláusulas e condições seguintes, em conformidade com a legislação civil pertinente e, quando aplicável, com o Art. 462 da CLT.
  </p>
  <div class="box">
    <div class="box-title">1. DADOS DO COLABORADOR(A) / RESPONSÁVEL</div>
    <div class="grid-info">
      <div><span class="label">Nome:</span> <span class="value">${upper(responsible || '__________________________')}</span></div>
      <div><span class="label">CPF:</span> <span class="value">${escapeHtml(asset.clientCpf || '___.___.___-__')}</span></div>
      <div><span class="label">Departamento/Setor:</span> <span class="value">${upper(asset.sector || 'Adm/Op.')}</span></div>
      <div><span class="label">Local de Trabalho:</span> <span class="value">${upper(asset.location || 'Local não definido')}</span></div>
    </div>
  </div>
  <div class="box">
    <div class="box-title">2. OBJETO (EQUIPAMENTO EM COMODATO)</div>
    <div style="font-size:10.5px;margin-bottom:5px">A empresa cede ao(à) responsável, a título de comodato, para uso EXCLUSIVO no desempenho de suas atividades profissionais, o(s) seguinte(s) bem(ns):</div>
    <div class="grid-info">
      <div><span class="label">Equipamento:</span> <span class="value">${escapeHtml(asset.model)}</span></div>
      <div><span class="label">Tipo:</span> <span class="value">${upper(asset.type || 'N/A')}</span></div>
      <div><span class="label">Patrimônio (ID):</span> <span class="value">${escapeHtml(asset.internalId)}</span></div>
      <div><span class="label">Número de Série:</span> <span class="value">${escapeHtml(asset.serialNumber || 'N/A')}</span></div>
      ${accessories ? `<div><span class="label">Acessórios/Periféricos:</span> <span class="value">${escapeHtml(accessories)}</span></div>` : ''}
      ${peripherals ? `<div><span class="label">Itens Adicionais:</span> <span class="value">${escapeHtml(peripherals)}</span></div>` : ''}
    </div>
  </div>
  <div class="content">
    <p style="font-weight:bold;margin-bottom:4px;font-size:10.5px">CLÁUSULAS CONTRATUAIS:</p>
    <ul class="clauses">${clauseItems}</ul>
  </div>
  <div style="margin-top:20px;font-size:10.5px">
    <p>Li, compreendi e aceito integralmente os termos acima descritos.</p>
    <p>_______________________, _____ de _______________________ de _________.</p>
  </div>
  <div class="signatures">
    <div><div class="line"></div><span style="font-size:10.5px">${escapeHtml(responsible || '__________________________')}</span><br/><small style="font-size:9px">RECEBEDOR(A) / RESPONSÁVEL</small>${asset.clientCpf ? '' : '<br/><small style="font-size:8px;color:#666">CPF: ___.___.___-__</small>'}</div>
    <div><div class="line"></div><span style="font-size:10.5px">${escapeHtml(branding.itManager || '__________________________')}</span><br/><small style="font-size:9px">GESTOR DE TI</small></div>
  </div>
  <div class="footer">${footer}</div>
</body></html>`;
};

/**
 * Abre o documento numa janela nova e dispara a impressao (funciona no mobile,
 * onde imprimir um iframe oculto falha). Retorna false se o popup foi bloqueado.
 */
export const printHtml = (html) => {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return false;
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.onload = () => {
    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 500);
  };
  return true;
};
