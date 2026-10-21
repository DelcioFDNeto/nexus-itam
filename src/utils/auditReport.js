// src/utils/auditReport.js
// Relatorio de auditoria em PDF (jsPDF + autotable carregados sob demanda).
//
// jspdf-autotable 5 so se acopla sozinho ao jsPDF GLOBAL (window.jsPDF); com
// o jsPDF importado como modulo, `doc.autoTable` nao existe e a exportacao da
// auditoria falhava sempre. Aqui a funcao e chamada direto: autoTable(doc, ...).
import { SCAN_RESULTS } from './audit';

const RESULT_ORDER = ['missing', 'other_location', 'retired', 'transit_out', 'transit_in', 'unknown', 'found'];

const formatDate = (value) => {
  const date = typeof value?.toDate === 'function' ? value.toDate() : value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
};

/** Monta o PDF do relatorio e devolve o documento jsPDF (salvo pelo chamador). */
export const buildAuditPdf = async (audit, { companyName = '' } = {}) => {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const pdf = new jsPDF();
  const width = pdf.internal.pageSize.getWidth();
  const stats = audit.stats || {};

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(14);
  pdf.text('Relatório de Auditoria Patrimonial', 14, 16);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  if (companyName) pdf.text(companyName, width - 14, 16, { align: 'right' });
  pdf.text(`Local: ${audit.location}`, 14, 24);
  pdf.text(`Data: ${formatDate(audit.dateValue || audit.date)}    Auditor: ${audit.auditedByName || audit.auditedBy || '—'}`, 14, 29);
  pdf.text(`Situação: ${audit.status}    Acuracidade: ${stats.accuracy ?? '—'}%`, 14, 34);

  autoTable(pdf, {
    startY: 39,
    head: [['Esperados', 'Encontrados', 'Não localizados', 'De outro local', 'Baixados presentes', 'Em trânsito', 'Não cadastrados']],
    body: [[stats.expected ?? 0, stats.found ?? 0, stats.missing ?? 0, stats.intruders ?? 0, stats.retired ?? 0, stats.transit ?? 0, stats.unknown ?? 0]],
    styles: { fontSize: 8, halign: 'center' },
    headStyles: { fillColor: [79, 70, 229] },
  });

  const items = [...(audit.items || [])].sort((a, b) => RESULT_ORDER.indexOf(a.result) - RESULT_ORDER.indexOf(b.result));
  autoTable(pdf, {
    startY: pdf.lastAutoTable.finalY + 6,
    head: [['Situação', 'Patrimônio', 'Equipamento', 'Local no cadastro', 'Conferência']],
    body: items.map((i) => [
      SCAN_RESULTS[i.result]?.label || i.result,
      i.internalId || '—',
      i.model || '—',
      i.from || '—',
      i.method === 'agent' ? 'Agente ITAM' : i.method === 'manual' ? 'Digitado' : i.method === 'qr' ? 'Leitura' : '—',
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [30, 41, 59] },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 0) {
        const result = items[data.row.index]?.result;
        if (result === 'missing' || result === 'retired') data.cell.styles.textColor = [190, 18, 60];
        else if (result !== 'found') data.cell.styles.textColor = [180, 83, 9];
      }
    },
  });

  let y = pdf.lastAutoTable.finalY + 8;
  if (audit.notes) {
    pdf.setFontSize(9);
    const lines = pdf.splitTextToSize(`Observações: ${audit.notes}`, width - 28);
    pdf.text(lines, 14, y);
    y += lines.length * 4 + 4;
  }
  if (y > pdf.internal.pageSize.getHeight() - 40) {
    pdf.addPage();
    y = 30;
  }
  y += 18;
  pdf.line(20, y, 90, y);
  pdf.line(width - 90, y, width - 20, y);
  pdf.setFontSize(8);
  pdf.text(audit.auditedByName || 'Auditor', 55, y + 4, { align: 'center' });
  pdf.text('Responsável pelo local', width - 55, y + 4, { align: 'center' });

  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    pdf.setPage(p);
    pdf.setFontSize(7);
    pdf.text(`Nexus ITAM · auditoria ${audit.id || ''} · página ${p} de ${pages}`, width / 2, pdf.internal.pageSize.getHeight() - 6, { align: 'center' });
  }
  return pdf;
};

export const auditPdfName = (audit) =>
  `Auditoria_${String(audit.location || 'local').replace(/[^\w-]+/g, '_')}_${(audit.dateValue || new Date()).toISOString().slice(0, 10)}.pdf`;
