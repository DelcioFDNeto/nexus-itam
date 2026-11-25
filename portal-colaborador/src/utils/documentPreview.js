// portal-colaborador/src/utils/documentPreview.js
// =============================================================================
// Visualizador Inline Nativo (Zero Iframe Bloqueado) para PDF, Word e Excel
// =============================================================================

const MAX_EXCEL_PREVIEW_ROWS = 500;
const MAX_EXCEL_PREVIEW_COLS = 40;
const MAX_PDF_RENDER_PAGES = 40;

const ALLOWED_WORD_TAGS = new Set([
  'p', 'div', 'span', 'br', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup',
  'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'blockquote', 'pre', 'code', 'a', 'img',
]);

const SAFE_DATA_IMAGE_RE = /^data:image\/(png|jpe?g|gif|webp|bmp);base64,[A-Za-z0-9+/=\s]+$/i;
const SAFE_HTTP_LINK_RE = /^https?:\/\//i;

export function classifyPreviewKind(fileName = '', contentType = '') {
  const name = String(fileName || '').toLowerCase().trim();
  const ct = String(contentType || '').toLowerCase().trim();

  if (name.endsWith('.pdf') || ct.includes('application/pdf')) return 'pdf';
  if (
    /\.(xlsx|xls|xlsm|xlsb|ods|csv)$/i.test(name) ||
    ct.includes('spreadsheetml') ||
    ct.includes('ms-excel') ||
    ct.includes('opendocument.spreadsheet')
  ) {
    return 'excel';
  }
  if (
    /\.(docx|doc)$/i.test(name) ||
    ct.includes('wordprocessingml') ||
    ct.includes('application/msword')
  ) {
    return 'word';
  }
  if (
    /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(name) ||
    ct.startsWith('image/')
  ) {
    return 'image';
  }
  if (
    /\.(txt|md|json|log|xml|yaml|yml|ini|conf|sh|ps1)$/i.test(name) ||
    ct.startsWith('text/') ||
    ct.includes('json')
  ) {
    return 'text';
  }
  return 'unknown';
}

export function columnIndexToLetters(index) {
  let n = Number(index) + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out || 'A';
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeWordHtml(rawHtml = '') {
  const input = String(rawHtml || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[\s\S]*?<\/object>/gi, '')
    .replace(/<embed\b[^>]*>/gi, '');
  if (!input.trim()) return '';

  if (typeof DOMParser === 'function' && typeof document !== 'undefined') {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(`<div>${input}</div>`, 'text/html');
      const root = doc.body.firstElementChild || doc.body;

      const cleanNode = (node) => {
        if (!node) return '';
        if (node.nodeType === 3) {
          return escapeHtml(node.textContent || '');
        }
        if (node.nodeType !== 1) return '';

        const tag = String(node.tagName || '').toLowerCase();
        if (['script', 'style', 'iframe', 'object', 'embed', 'svg', 'form', 'input', 'textarea', 'button'].includes(tag)) {
          return '';
        }

        const inner = Array.from(node.childNodes).map(cleanNode).join('');
        if (!ALLOWED_WORD_TAGS.has(tag)) {
          return inner;
        }

        if (tag === 'br' || tag === 'hr') {
          return `<${tag} />`;
        }

        const attrs = [];
        if (tag === 'a') {
          const href = String(node.getAttribute('href') || '').trim();
          if (SAFE_HTTP_LINK_RE.test(href)) {
            attrs.push(`href="${escapeHtml(href)}"`);
            attrs.push('target="_blank"');
            attrs.push('rel="noopener noreferrer"');
          }
        } else if (tag === 'img') {
          const src = String(node.getAttribute('src') || '').trim();
          if (!SAFE_DATA_IMAGE_RE.test(src)) return '';
          const alt = escapeHtml(node.getAttribute('alt') || 'Imagem do documento');
          return `<img src="${src}" alt="${alt}" />`;
        } else if (tag === 'td' || tag === 'th') {
          const colspan = Number(node.getAttribute('colspan'));
          const rowspan = Number(node.getAttribute('rowspan'));
          if (Number.isInteger(colspan) && colspan > 1 && colspan <= 30) attrs.push(`colspan="${colspan}"`);
          if (Number.isInteger(rowspan) && rowspan > 1 && rowspan <= 50) attrs.push(`rowspan="${rowspan}"`);
        }

        const attrStr = attrs.length ? ` ${attrs.join(' ')}` : '';
        return `<${tag}${attrStr}>${inner}</${tag}>`;
      };

      return Array.from(root.childNodes).map(cleanNode).join('');
    } catch {
      /* fallback below */
    }
  }

  return input
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
}

function toArrayBuffer(input) {
  if (!input) return new ArrayBuffer(0);
  if (input instanceof ArrayBuffer) return input;
  if (ArrayBuffer.isView(input)) {
    return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  }
  return new ArrayBuffer(0);
}

function extractLegacyDocParagraphs(bytes) {
  const out = [];
  // Tenta extrair sequencias legiveis UTF-16LE e ASCII/Latin-1 do binario .doc
  try {
    const utf16 = new TextDecoder('utf-16le', { fatal: false }).decode(bytes);
    const matches = utf16.match(/[A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9 ,.;:()\-–—/%$R@'"!?]{14,}/g) || [];
    for (const m of matches) {
      const clean = m.replace(/\s+/g, ' ').trim();
      if (clean.length >= 16 && !/^Root Entry|WordDocument|Microsoft|Normal\.dot/i.test(clean)) {
        out.push(clean);
      }
      if (out.length >= 250) break;
    }
  } catch {
    /* ignore */
  }
  if (out.length === 0) {
    try {
      const latin = new TextDecoder('latin1', { fatal: false }).decode(bytes);
      const matches = latin.match(/[A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9 ,.;:()\-–—/%$R@'"!?]{18,}/g) || [];
      for (const m of matches) {
        const clean = m.replace(/\s+/g, ' ').trim();
        if (clean.length >= 18 && !/Root Entry|WordDocument|MSWordDoc|Table/i.test(clean)) {
          out.push(clean);
        }
        if (out.length >= 250) break;
      }
    } catch {
      /* ignore */
    }
  }
  return Array.from(new Set(out));
}

export async function parseExcelPreview(rawBuffer, fileName = '') {
  const ab = toArrayBuffer(rawBuffer);
  const bytes = new Uint8Array(ab);
  const xlsxMod = await import('xlsx');
  const XLSX = xlsxMod.default && xlsxMod.default.read ? xlsxMod.default : xlsxMod;

  const isCsv = String(fileName || '').toLowerCase().endsWith('.csv');
  const wb = isCsv
    ? XLSX.read(new TextDecoder('utf-8', { fatal: false }).decode(bytes), { type: 'string' })
    : XLSX.read(bytes, { type: 'array', cellDates: true });

  const sheetNames = Array.isArray(wb?.SheetNames) ? wb.SheetNames : [];
  const sheets = sheetNames.map((name) => {
    const ws = wb.Sheets[name] || {};
    const ref = ws['!ref'];
    if (!ref) {
      return {
        name,
        colHeaders: ['A', 'B', 'C', 'D'],
        rows: [],
        totalRows: 0,
        totalCols: 0,
        truncated: false,
      };
    }
    const range = XLSX.utils.decode_range(ref);
    const totalRows = Math.max(0, range.e.r - range.s.r + 1);
    const totalCols = Math.max(0, range.e.c - range.s.c + 1);
    const maxR = Math.min(range.e.r, range.s.r + MAX_EXCEL_PREVIEW_ROWS - 1);
    const maxC = Math.min(range.e.c, range.s.c + MAX_EXCEL_PREVIEW_COLS - 1);

    const colHeaders = [];
    for (let c = range.s.c; c <= maxC; c += 1) {
      colHeaders.push(columnIndexToLetters(c));
    }

    const rows = [];
    for (let r = range.s.r; r <= maxR; r += 1) {
      const cells = [];
      let hasAnyValue = false;
      for (let c = range.s.c; c <= maxC; c += 1) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        let text = '';
        if (cell) {
          if (cell.w !== undefined && cell.w !== null) {
            text = String(cell.w);
          } else if (cell.v instanceof Date) {
            text = cell.v.toLocaleDateString('pt-BR');
          } else if (cell.v !== undefined && cell.v !== null) {
            text = String(cell.v);
          }
        }
        if (text !== '') hasAnyValue = true;
        cells.push(text);
      }
      if (hasAnyValue || rows.length < 30) {
        rows.push({ rowNumber: r + 1, cells });
      }
    }

    return {
      name,
      colHeaders,
      rows,
      totalRows,
      totalCols,
      truncated: totalRows > MAX_EXCEL_PREVIEW_ROWS || totalCols > MAX_EXCEL_PREVIEW_COLS,
    };
  });

  return {
    kind: 'excel',
    sheets,
  };
}

export async function parseWordPreview(rawBuffer, fileName = '') {
  const ab = toArrayBuffer(rawBuffer);
  const bytes = new Uint8Array(ab);
  const isZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;

  if (!isZip) {
    const paragraphs = extractLegacyDocParagraphs(bytes);
    const html = paragraphs.length
      ? paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('')
      : '<p>Não foi possível extrair texto visualizável deste arquivo Word legado (.doc).</p>';
    return {
      kind: 'word',
      html,
      legacyDoc: true,
      note: `Documento Word legado (${fileName || '.doc'}) exibido em leitura simplificada. Para formatação completa, clique em "Editar no PC" ou converta para .docx.`,
    };
  }

  let mammothLib;
  try {
    const mod = await import('mammoth/mammoth.browser');
    mammothLib = mod.default || mod;
  } catch {
    const mod = await import('mammoth');
    mammothLib = mod.default || mod;
  }

  const result = await mammothLib.convertToHtml({ arrayBuffer: ab });
  const sanitized = sanitizeWordHtml(result?.value || '');
  return {
    kind: 'word',
    html: sanitized || '<p>(Documento Word vazio)</p>',
    legacyDoc: false,
    note: '',
  };
}

let pdfjsPromise = null;

async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]).then(([lib, worker]) => {
      if (lib?.GlobalWorkerOptions && worker?.default) {
        lib.GlobalWorkerOptions.workerSrc = worker.default;
      }
      return lib;
    });
  }
  return pdfjsPromise;
}

export async function openPdfPreviewDocument(rawBuffer) {
  const ab = toArrayBuffer(rawBuffer);
  const bytes = new Uint8Array(ab);
  const pdfjs = await loadPdfjs();
  const loadingTask = pdfjs.getDocument({
    data: bytes.slice(),
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;
  const numPages = Number(pdf.numPages || 0);
  const renderablePages = Math.min(numPages, MAX_PDF_RENDER_PAGES);

  return {
    numPages,
    renderablePages,
    truncated: numPages > MAX_PDF_RENDER_PAGES,
    async renderPage(pageNum, canvas, scale = 1.15) {
      if (!canvas) return;
      const page = await pdf.getPage(pageNum);
      const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
      const viewport = page.getViewport({ scale });
      const hiViewport = page.getViewport({ scale: scale * dpr });

      canvas.width = Math.max(1, Math.floor(hiViewport.width));
      canvas.height = Math.max(1, Math.floor(hiViewport.height));
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({ canvas, canvasContext: ctx, viewport: hiViewport }).promise;
    },
    destroy() {
      try {
        pdf.destroy();
      } catch {
        /* ignore */
      }
    },
  };
}
