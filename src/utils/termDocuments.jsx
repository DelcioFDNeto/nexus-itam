// src/utils/termDocuments.jsx
// -----------------------------------------------------------------------------
// Documentos A4 dos termos patrimoniais: responsabilidade (entrega),
// devolucao e transferencia/recebimento entre unidades.
//
// Todo valor vindo do banco passa por escapeHtml (o HTML vai para
// document.write). O documento e montado a partir do REGISTRO do termo — a
// fotografia gravada na emissao —, entao a reimpressao sai identica a via
// assinada, mesmo que o cadastro do ativo tenha mudado depois.
// -----------------------------------------------------------------------------
import ReactDOMServer from 'react-dom/server';
import { QRCodeSVG } from 'qrcode.react';
import { escapeHtml, NEXUS_INDIGO, NEXUS_MARK_SVG } from './printTemplates';
import {
  cleanPerson,
  DEFAULT_TERM_CLAUSES,
  DEFAULT_TRANSFER_CLAUSES,
  parseMoney,
  RECEIPT_OUTCOMES,
  snapshotAsset,
  TERM_STATUS,
  toLocalDate,
} from './terms';

const upper = (value) => escapeHtml(String(value ?? '').toLocaleUpperCase('pt-BR'));

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const shortDate = (value) => {
  const date = toLocalDate(value);
  return date ? date.toLocaleDateString('pt-BR') : '';
};

const longDate = (value) => {
  const date = toLocalDate(value);
  return date ? date.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
};

const qrSvg = (value, size) =>
  ReactDOMServer.renderToStaticMarkup(<QRCodeSVG value={String(value)} size={size} level="M" />);

const clauseList = (clauses) =>
  String(clauses || '')
    .split('\n')
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => `<li>${escapeHtml(c)}</li>`)
    .join('');

const BASE_STYLES = (color) => `
  @page { size: A4; margin: 12mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Times New Roman', Times, serif; color: #000; line-height: 1.38; margin: 0; padding: 6px 10px; font-size: 10.5px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .header { display: flex; justify-content: space-between; align-items: center; gap: 16px; border-bottom: 2px solid ${escapeHtml(color)}; padding-bottom: 10px; margin-bottom: 12px; }
  .header-left { display: flex; align-items: center; gap: 14px; min-width: 0; }
  .logo-img { height: 44px; max-width: 160px; object-fit: contain; }
  .nexus-mark { font-weight: 900; font-family: sans-serif; display: flex; align-items: center; gap: 6px; color: ${NEXUS_INDIGO}; font-size: 20px; letter-spacing: -0.5px; }
  .company h1 { font-size: 16px; margin: 0; font-weight: 900; }
  .company p { margin: 1px 0 0; font-size: 9.5px; }
  .header-right { display: flex; align-items: center; gap: 10px; text-align: right; }
  .doc-number { font-family: Arial, sans-serif; font-size: 15px; font-weight: 900; letter-spacing: 0.5px; }
  .doc-meta { margin: 2px 0 0; font-size: 9px; }
  .title { text-align: center; font-weight: bold; font-size: 13.5px; text-transform: uppercase; margin: 10px 0 8px; }
  .content { text-align: justify; margin: 0 0 6px; }
  .box { border: 1px solid #000; padding: 7px 10px; margin: 8px 0; background: #fafafa; page-break-inside: avoid; }
  .box-title { font-weight: bold; font-size: 10.5px; margin-bottom: 4px; text-decoration: underline; text-transform: uppercase; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 14px; }
  .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 3px 14px; }
  .two-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .two-cols .box { margin: 0; }
  .label { font-weight: bold; text-transform: uppercase; font-size: 8px; color: #333; }
  .value { font-weight: bold; margin-left: 3px; }
  table.items { width: 100%; border-collapse: collapse; margin-top: 4px; font-family: Arial, sans-serif; font-size: 9px; }
  table.items th { background: #eee; text-transform: uppercase; font-size: 7.5px; text-align: left; }
  table.items th, table.items td { border: 1px solid #555; padding: 3px 4px; vertical-align: top; }
  table.items td.mono { font-family: 'Courier New', monospace; font-weight: bold; }
  table.items td.num, table.items th.num { text-align: right; white-space: nowrap; }
  table.items td.check { width: 46px; text-align: center; }
  .checkbox { display: inline-block; width: 10px; height: 10px; border: 1px solid #000; vertical-align: middle; margin-right: 4px; }
  .clauses { padding-left: 0; list-style: none; margin: 4px 0 0; }
  .clauses li { margin-bottom: 4px; font-size: 9.8px; text-align: justify; }
  .notes { border-left: 3px solid ${escapeHtml(color)}; padding: 4px 8px; margin: 8px 0; background: #fafafa; white-space: pre-wrap; }
  .signatures { display: flex; justify-content: space-around; gap: 24px; margin-top: 34px; text-align: center; page-break-inside: avoid; }
  .signatures.compact { margin-top: 26px; }
  .sig { flex: 1; max-width: 260px; }
  .sig .line { border-top: 1px solid #000; margin-bottom: 4px; }
  .sig strong { display: block; font-size: 10px; }
  .sig small { display: block; font-size: 8.5px; text-transform: uppercase; }
  .write-lines div { border-bottom: 1px solid #999; height: 16px; }
  .stamp { margin-top: 6px; font-size: 9px; text-align: right; }
  .footer { margin-top: 16px; font-size: 8px; text-align: center; border-top: 1px solid #ccc; padding-top: 4px; color: #444; }
  .footer-hint { font-size: 8.5px; font-weight: bold; color: #111; margin-bottom: 2px; }
  .status-banner { margin: 8px 0; padding: 6px 10px; border: 2px solid #000; font-family: Arial, sans-serif; font-weight: 900; text-align: center; text-transform: uppercase; }
  .draft-mark { position: fixed; top: 42%; left: 0; right: 0; text-align: center; font: 900 54px Arial, sans-serif; color: rgba(200, 0, 0, 0.13); transform: rotate(-28deg); pointer-events: none; z-index: 10; }
  .page-block { page-break-inside: avoid; }
`;

/** Cabecalho comum: identidade, numero do termo, data e QR para abrir no app. */
const header = ({ branding, number, issuedAt, url }) => {
  const logo = branding.logoUrl
    ? `<img class="logo-img" src="${escapeHtml(branding.logoUrl)}" alt="" />`
    : branding.showNexusBrand
      ? `<div class="nexus-mark">${NEXUS_MARK_SVG(20)} NEXUS<span style="color:#111827">ITAM</span></div>`
      : '';
  return `<div class="header">
    <div class="header-left">
      ${logo}
      <div class="company">
        <h1>${upper(branding.companyName)}</h1>
        <p>CNPJ: ${escapeHtml(branding.cnpj || '00.000.000/0001-00')}</p>
        <p>Departamento de Tecnologia da Informação</p>
      </div>
    </div>
    <div class="header-right">
      <div>
        <div class="doc-number">${escapeHtml(number || 'RASCUNHO')}</div>
        <p class="doc-meta">Emitido em ${escapeHtml(shortDate(issuedAt) || shortDate(new Date()))}</p>
      </div>
      ${url ? qrSvg(url, 72) : ''}
    </div>
  </div>`;
};

const footer = ({ branding, number, id }) => {
  const ref = [number, id].filter(Boolean).map(escapeHtml).join(' · ');
  // Termo emitido (com numero): orienta a devolver o assinado, que o QR identifica.
  const hint = number
    ? '<div class="footer-hint">Depois de assinado, digitalize ou fotografe este termo e anexe no sistema — o QR code do cabeçalho identifica o documento e conclui o processo.</div>'
    : '';
  return branding.showNexusBrand
    ? `<div class="footer">${hint}Documento gerado eletronicamente pela plataforma Nexus ITAM${ref ? ` · ${ref}` : ''}</div>`
    : `<div class="footer">${hint}Documento gerado eletronicamente por ${escapeHtml(branding.companyName)}${ref ? ` · ${ref}` : ''}</div>`;
};

const signature = (name, role, extra = '') =>
  `<div class="sig"><div class="line"></div><strong>${String(name ?? '').trim() ? escapeHtml(String(name).trim()) : '&nbsp;'}</strong><small>${escapeHtml(role)}</small>${extra}</div>`;

const cityDateLine = (city, issuedAt) =>
  city
    ? `${escapeHtml(city)}, ${escapeHtml(longDate(issuedAt) || longDate(new Date()))}.`
    : '_______________________, _____ de _______________________ de _________.';

const witnessesBlock = () => `<div class="signatures compact">
    ${signature('', 'Testemunha 1', '<small>CPF: ___.___.___-__</small>')}
    ${signature('', 'Testemunha 2', '<small>CPF: ___.___.___-__</small>')}
  </div>`;

const documentShell = ({ title, color, draft, body }) => `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title>
<style>${BASE_STYLES(color)}</style></head><body>
  ${draft ? '<div class="draft-mark">RASCUNHO — SEM VALIDADE</div>' : ''}
  ${body}
</body></html>`;

/**
 * Tabela de itens.
 * @param {Array} assets fotografias do termo
 * @param {{ showValue?: boolean, conditionLabel?: string, checkColumn?: string, outcomes?: object }} opts
 */
const itemsTable = (assets, { showValue = false, conditionLabel = 'Estado', checkColumn = '', outcomes = null, showType = false } = {}) => {
  let total = 0;
  const rows = assets
    .map((a, index) => {
      const value = parseMoney(a.valor);
      if (Number.isFinite(value)) total += value;
      const outcome = outcomes?.[a.id];
      const check = checkColumn
        ? `<td class="check">${outcome ? escapeHtml(outcome.outcome === 'ok' ? 'OK' : outcome.outcome === 'ressalva' ? 'Ressalva' : 'Faltou') : '<span class="checkbox"></span>'}</td>`
        : '';
      return `<tr>
        <td class="num">${index + 1}</td>
        <td class="mono">${escapeHtml(a.internalId || '—')}</td>
        <td>${escapeHtml(a.model || '—')}${!showType && a.type ? `<br/><small>${escapeHtml(a.type)}</small>` : ''}</td>
        ${showType ? `<td>${escapeHtml(a.type || '—')}</td>` : ''}
        <td class="mono">${escapeHtml(a.serialNumber || '—')}</td>
        <td>${escapeHtml(a.accessories || '—')}</td>
        <td>${escapeHtml(a.condition || 'Bom')}</td>
        ${showValue ? `<td class="num">${Number.isFinite(value) ? brl.format(value) : '—'}</td>` : ''}
        ${check}
      </tr>`;
    })
    .join('');

  return `<table class="items">
    <thead><tr>
      <th class="num">#</th><th>Patrimônio</th><th>Equipamento</th>${showType ? '<th>Tipo</th>' : ''}<th>Nº de série</th><th>Acessórios</th><th>${escapeHtml(conditionLabel)}</th>
      ${showValue ? '<th class="num">Valor</th>' : ''}
      ${checkColumn ? `<th>${escapeHtml(checkColumn)}</th>` : ''}
    </tr></thead>
    <tbody>${rows}</tbody>
    ${showValue && total > 0 ? `<tfoot><tr><td colspan="${showType ? 7 : 6}" class="num"><strong>Valor total</strong></td><td class="num"><strong>${brl.format(total)}</strong></td>${checkColumn ? '<td></td>' : ''}</tr></tfoot>` : ''}
  </table>`;
};

const personBox = (title, person, fallbackPlace = '') => `<div class="box">
    <div class="box-title">${escapeHtml(title)}</div>
    <div class="grid">
      <div><span class="label">Nome:</span> <span class="value">${upper(person.name || '__________________________')}</span></div>
      <div><span class="label">CPF:</span> <span class="value">${escapeHtml(person.cpf || '___.___.___-__')}</span></div>
      <div><span class="label">Cargo/Função:</span> <span class="value">${escapeHtml(person.role || '—')}</span></div>
      <div><span class="label">Setor:</span> <span class="value">${escapeHtml(person.sector || '—')}</span></div>
      <div><span class="label">Unidade / Local:</span> <span class="value">${escapeHtml(person.branch || fallbackPlace || '—')}</span></div>
    </div>
  </div>`;

const statusBanner = (term) =>
  term.status === 'cancelado'
    ? `<div class="status-banner">Termo cancelado${term.cancelReason ? ` — ${escapeHtml(term.cancelReason)}` : ''}</div>`
    : '';

// -----------------------------------------------------------------------------
// Responsabilidade
// -----------------------------------------------------------------------------

/**
 * Termo de entrega e responsabilidade (um ou varios equipamentos).
 * @param {{ term: object, branding: object, options: object, url?: string, draft?: boolean }} input
 */
export const buildResponsibilityTermDocument = ({ term, branding, options, url, draft = false }) => {
  const holder = cleanPerson(term.holder);
  const assets = term.assets || [];
  const plural = assets.length > 1;
  const title = options.termTitle || 'Termo de Entrega e Responsabilidade';

  const body = `
  ${header({ branding, number: draft ? '' : term.number, issuedAt: term.issuedAtDate || term.issuedAt, url: draft ? '' : url })}
  <h2 class="title">${escapeHtml(title)}</h2>
  ${statusBanner(term)}
  <p class="content">
    Pelo presente instrumento particular, de um lado a empresa <strong>${escapeHtml(branding.companyName)}</strong>, inscrita no CNPJ sob o nº
    <strong>${escapeHtml(branding.cnpj || '00.000.000/0001-00')}</strong>, e de outro lado o(a) responsável abaixo qualificado(a), celebram o presente
    termo de responsabilidade e comodato, regido pelas cláusulas seguintes, em conformidade com a legislação civil e, quando aplicável, com o Art. 462 da CLT.
  </p>
  ${personBox('1. Dados do colaborador(a) / responsável', holder, assets[0]?.previousLocation)}
  <div class="box">
    <div class="box-title">2. Objeto (${plural ? `${assets.length} equipamentos` : 'equipamento'} em comodato)</div>
    <div>A empresa cede ao(à) responsável, a título de comodato, para uso EXCLUSIVO no desempenho de suas atividades profissionais, ${plural ? 'os seguintes bens' : 'o seguinte bem'}:</div>
    ${itemsTable(assets, { showValue: options.showValue, conditionLabel: 'Estado na entrega' })}
  </div>
  <div class="content">
    <p style="font-weight:bold;margin:6px 0 2px">CLÁUSULAS CONTRATUAIS:</p>
    <ul class="clauses">${clauseList(options.clauses || DEFAULT_TERM_CLAUSES)}</ul>
  </div>
  ${term.notes ? `<div class="notes"><strong>Observações:</strong> ${escapeHtml(term.notes)}</div>` : ''}
  <div class="page-block">
    <p class="content" style="margin-top:10px">Li, compreendi e aceito integralmente os termos acima descritos.</p>
    <p class="content">${cityDateLine(options.city, term.issuedAtDate || term.issuedAt)}</p>
    <div class="signatures">
      ${signature(holder.name, 'Recebedor(a) / Responsável', holder.cpf ? '' : '<small>CPF: ___.___.___-__</small>')}
      ${signature(branding.itManager, 'Gestor(a) de TI')}
    </div>
    ${options.witnesses ? witnessesBlock() : ''}
  </div>
  ${footer({ branding, number: draft ? '' : term.number, id: term.id })}`;

  return documentShell({ title: `${draft ? 'Rascunho' : term.number || 'Termo'} - Responsabilidade`, color: branding.color, draft, body });
};

// -----------------------------------------------------------------------------
// Devolucao
// -----------------------------------------------------------------------------

export const buildReturnTermDocument = ({ term, branding, options, url, draft = false }) => {
  const holder = cleanPerson(term.holder);
  const assets = term.assets || [];
  const damaged = assets.filter((a) => a.condition === 'Avariado');

  const body = `
  ${header({ branding, number: draft ? '' : term.number, issuedAt: term.issuedAtDate || term.issuedAt, url: draft ? '' : url })}
  <h2 class="title">Termo de Devolução de Equipamento${assets.length > 1 ? 's' : ''}</h2>
  ${statusBanner(term)}
  <p class="content">
    Pelo presente instrumento, o(a) colaborador(a) abaixo qualificado(a) devolve à empresa <strong>${escapeHtml(branding.companyName)}</strong>
    ${assets.length > 1 ? 'os equipamentos relacionados, recebidos' : 'o equipamento relacionado, recebido'} anteriormente a título de comodato.
  </p>
  ${personBox('1. Colaborador(a) que devolve', holder)}
  <div class="box">
    <div class="box-title">2. ${assets.length > 1 ? 'Equipamentos devolvidos' : 'Equipamento devolvido'}</div>
    ${itemsTable(assets, { conditionLabel: 'Estado na devolução' })}
  </div>
  <p class="content">
    A empresa declara ter recebido de volta ${assets.length > 1 ? 'os equipamentos acima' : 'o equipamento acima'}, nas condições descritas.
    Com a devolução, cessa a responsabilidade do(a) colaborador(a) pela guarda ${assets.length > 1 ? 'dos bens' : 'do bem'},
    ${damaged.length ? '<strong>ressalvadas as avarias apontadas neste termo</strong>, que poderão ser apuradas nos termos do Termo de Responsabilidade anteriormente assinado' : 'não havendo avarias ou faltas a registrar'}.
  </p>
  ${term.returnLocation ? `<p class="content"><span class="label">Local de recebimento:</span> <span class="value">${escapeHtml(term.returnLocation)}</span></p>` : ''}
  ${term.notes ? `<div class="notes"><strong>Observações:</strong> ${escapeHtml(term.notes)}</div>` : ''}
  <div class="page-block">
    <p class="content" style="margin-top:10px">${cityDateLine(options.city, term.issuedAtDate || term.issuedAt)}</p>
    <div class="signatures">
      ${signature(holder.name, 'Colaborador(a) — devolveu', holder.cpf ? `<small>CPF: ${escapeHtml(holder.cpf)}</small>` : '<small>CPF: ___.___.___-__</small>')}
      ${signature(term.receivedByName || branding.itManager, 'Recebido por (TI)')}
    </div>
    ${options.witnesses ? witnessesBlock() : ''}
  </div>
  ${footer({ branding, number: draft ? '' : term.number, id: term.id })}`;

  return documentShell({ title: `${draft ? 'Rascunho' : term.number || 'Termo'} - Devolucao`, color: branding.color, draft, body });
};

// -----------------------------------------------------------------------------
// Transferencia e recebimento
// -----------------------------------------------------------------------------

const placeBox = (title, place, extra = '') => `<div class="box">
    <div class="box-title">${escapeHtml(title)}</div>
    <div><span class="label">Local:</span> <span class="value">${upper(place.name || '—')}</span></div>
    <div><span class="label">Endereço:</span> <span class="value">${escapeHtml(place.address || '—')}</span></div>
    <div><span class="label">Responsável:</span> <span class="value">${escapeHtml(place.manager || '—')}</span></div>
    ${place.phone ? `<div><span class="label">Telefone:</span> <span class="value">${escapeHtml(place.phone)}</span></div>` : ''}
    ${extra}
  </div>`;

const receiptSection = (term) => {
  const receipt = term.receipt;
  if (term.status === 'cancelado') return '';

  if (receipt) {
    const issues = (receipt.items || []).filter((i) => i.outcome !== 'ok');
    return `<div class="box page-block">
      <div class="box-title">5. Recebimento na unidade de destino — ${escapeHtml(TERM_STATUS[term.status]?.label || 'Recebido')}</div>
      <div class="grid">
        <div><span class="label">Recebido por:</span> <span class="value">${escapeHtml(receipt.receivedByName || '—')}</span></div>
        <div><span class="label">Data do recebimento:</span> <span class="value">${escapeHtml(shortDate(receipt.receivedAt) || '—')}</span></div>
        <div><span class="label">Conferência registrada por:</span> <span class="value">${escapeHtml(receipt.confirmedByName || receipt.confirmedBy || '—')}</span></div>
        <div><span class="label">Situação:</span> <span class="value">${issues.length ? `${issues.length} item(ns) com ressalva ou falta` : 'Todos os itens conferidos'}</span></div>
      </div>
      ${issues.length ? `<ul class="clauses" style="margin-top:6px">${issues
        .map((i) => `<li><strong>${escapeHtml(i.internalId || i.id)}</strong> — ${escapeHtml(RECEIPT_OUTCOMES[i.outcome] || i.outcome)}${i.note ? `: ${escapeHtml(i.note)}` : ''}</li>`)
        .join('')}</ul>` : ''}
      <div class="signatures compact">
        ${signature(receipt.receivedByName, 'Recebedor(a) na unidade')}
      </div>
    </div>`;
  }

  return `<div class="box page-block">
    <div class="box-title">5. Recebimento na unidade de destino</div>
    <p class="content">Declaro ter recebido os itens relacionados neste termo:</p>
    <p class="content"><span class="checkbox"></span> em perfeito estado e na quantidade indicada.</p>
    <p class="content"><span class="checkbox"></span> com as ressalvas abaixo (avarias, faltas ou divergências):</p>
    <div class="write-lines"><div></div><div></div><div></div></div>
    <p class="content" style="margin-top:8px">Data do recebimento: ____/____/________ &nbsp;&nbsp; Hora: ____:____</p>
    <div class="signatures compact">
      ${signature(term.receiver?.name || term.destination?.manager, 'Recebedor(a) — nome legível e assinatura')}
      ${signature('', 'Carimbo da unidade')}
    </div>
  </div>`;
};

export const buildTransferTermDocument = ({ term, branding, options, url, draft = false }) => {
  const assets = term.assets || [];
  const origin = term.origin || {};
  const destination = term.destination || {};
  const receiver = cleanPerson(term.receiver);
  const transport = term.transport || {};
  const outcomes = term.receipt ? Object.fromEntries((term.receipt.items || []).map((i) => [i.id, i])) : null;

  const body = `
  ${header({ branding, number: draft ? '' : term.number, issuedAt: term.issuedAtDate || term.issuedAt, url: draft ? '' : url })}
  <h2 class="title">Termo de Transferência e Recebimento de Equipamentos</h2>
  ${statusBanner(term)}
  <p class="content">
    Registra a remessa ${assets.length > 1 ? `dos ${assets.length} equipamentos relacionados` : 'do equipamento relacionado'} abaixo, de
    <strong>${escapeHtml(origin.name)}</strong> para <strong>${escapeHtml(destination.name)}</strong>, e o seu recebimento pela unidade de destino.
  </p>
  <div class="two-cols">
    ${placeBox('1. Origem (expedição)', origin)}
    ${placeBox('2. Destino (recebimento)', { ...destination, manager: receiver.name || destination.manager },
      receiver.role ? `<div><span class="label">Função:</span> <span class="value">${escapeHtml(receiver.role)}</span></div>` : '')}
  </div>
  <div class="box">
    <div class="box-title">3. Dados da remessa</div>
    <div class="grid-3">
      <div><span class="label">Data de envio:</span> <span class="value">${escapeHtml(shortDate(term.issuedAtDate || term.issuedAt) || shortDate(new Date()))}</span></div>
      <div><span class="label">Previsão de chegada:</span> <span class="value">${escapeHtml(shortDate(term.expectedAt) || '—')}</span></div>
      <div><span class="label">Transporte:</span> <span class="value">${escapeHtml(transport.mode || '—')}</span></div>
      <div><span class="label">Transportador/Motorista:</span> <span class="value">${escapeHtml(transport.carrier || '—')}</span></div>
      <div><span class="label">NF / Romaneio:</span> <span class="value">${escapeHtml(transport.document || '—')}</span></div>
      <div><span class="label">Emitido por:</span> <span class="value">${escapeHtml(term.issuedByName || term.issuedBy || '—')}</span></div>
    </div>
  </div>
  <div class="box">
    <div class="box-title">4. Itens transferidos (${assets.length})</div>
    ${itemsTable(assets, { conditionLabel: 'Estado no envio', checkColumn: 'Conferido', outcomes, showType: true })}
  </div>
  <div class="content">
    <p style="font-weight:bold;margin:6px 0 2px">CONDIÇÕES DA TRANSFERÊNCIA:</p>
    <ul class="clauses">${clauseList(options.transferClauses || DEFAULT_TRANSFER_CLAUSES)}</ul>
  </div>
  ${term.notes ? `<div class="notes"><strong>Observações:</strong> ${escapeHtml(term.notes)}</div>` : ''}
  <div class="signatures page-block">
    ${signature(term.issuedByName || term.issuedBy, 'Responsável pela expedição')}
    ${signature(transport.carrier, 'Transportador(a) / Motorista')}
  </div>
  ${receiptSection(term)}
  ${footer({ branding, number: draft ? '' : term.number, id: term.id })}`;

  return documentShell({ title: `${draft ? 'Rascunho' : term.number || 'Termo'} - Transferencia`, color: branding.color, draft, body });
};

/** Documento certo para o tipo do termo. */
export const buildTermDocumentFor = (term, branding, options, { url, draft } = {}) => {
  const input = { term, branding, options, url, draft };
  if (term.kind === 'devolucao') return buildReturnTermDocument(input);
  if (term.kind === 'transferencia') return buildTransferTermDocument(input);
  return buildResponsibilityTermDocument(input);
};

/**
 * Compatibilidade: termo de um unico ativo montado direto do cadastro (sem
 * registro numerado). Usado so como pre-visualizacao.
 */
export const buildTermDocument = ({ asset, assetId, branding, termTitle, clauses }) =>
  buildResponsibilityTermDocument({
    term: {
      id: assetId,
      number: '',
      holder: { name: asset.assignedTo || asset.clientName, cpf: asset.clientCpf, sector: asset.sector, branch: asset.location },
      assets: [snapshotAsset({ ...asset, id: assetId })],
    },
    branding,
    options: { termTitle, clauses: clauses || DEFAULT_TERM_CLAUSES },
  });
