// services/service-storage/src/services/sheetCodec.js
// =============================================================================
// Codec Bidirecional .xlsx / .csv / .nexusheet <-> Workbook JSON
// =============================================================================

import * as XLSX from 'xlsx';
import { evaluateWorkbook } from '../../../shared/sheetFormula.js';

export function normalizeWorkbookTabs(rawTabs) {
  const list = Array.isArray(rawTabs) && rawTabs.length > 0
    ? rawTabs
    : [{ name: 'Planilha1', freezeRow: 1, cells: {} }];

  const normalized = list.map((tab, i) => {
    const cleanCells = {};
    const srcCells = tab?.cells && typeof tab.cells === 'object' ? tab.cells : {};
    for (const [k, raw] of Object.entries(srcCells)) {
      const ref = String(k).toUpperCase().trim();
      if (!/^[A-Z]{1,3}\d{1,6}$/.test(ref)) continue;
      if (raw && typeof raw === 'object') {
        const entry = {};
        if (raw.v !== undefined) entry.v = raw.v;
        else if (raw.value !== undefined) entry.v = raw.value;
        if (raw.f !== undefined && raw.f !== null && String(raw.f).trim() !== '') {
          const fStr = String(raw.f).trim();
          entry.f = fStr.startsWith('=') ? fStr : `=${fStr}`;
        } else if (raw.formula !== undefined && raw.formula !== null && String(raw.formula).trim() !== '') {
          const fStr = String(raw.formula).trim();
          entry.f = fStr.startsWith('=') ? fStr : `=${fStr}`;
        } else if (typeof entry.v === 'string' && entry.v.trim().startsWith('=')) {
          entry.f = entry.v.trim();
        }
        if (raw.style && typeof raw.style === 'object') {
          entry.style = { ...raw.style };
        }
        if (raw.format && typeof raw.format === 'object') {
          entry.format = { ...raw.format };
        }
        cleanCells[ref] = entry;
      } else if (typeof raw === 'string' && raw.trim().startsWith('=')) {
        cleanCells[ref] = { f: raw.trim(), v: null };
      } else {
        cleanCells[ref] = { v: raw };
      }
    }
    return {
      name: String(tab?.name || `Planilha${i + 1}`).trim() || `Planilha${i + 1}`,
      freezeRow: Number(tab?.freezeRow ?? 0),
      cells: cleanCells,
    };
  });

  return evaluateWorkbook(normalized);
}

export function serializeWorkbookToBinary(tabs, fileName = 'Planilha.xlsx') {
  const evaluated = normalizeWorkbookTabs(tabs);
  const lower = String(fileName || '').toLowerCase();

  if (lower.endsWith('.nexusheet') || lower.endsWith('.json')) {
    return Buffer.from(JSON.stringify({ version: '1.0', sheets: evaluated }, null, 2), 'utf8');
  }

  if (lower.endsWith('.csv')) {
    return Buffer.from(exportTabsToCsvString(evaluated), 'utf8');
  }

  const wb = XLSX.utils.book_new();
  for (const tab of evaluated) {
    const ws = {};
    let maxCol = 0;
    let maxRow = 0;

    for (const [ref, cellObj] of Object.entries(tab.cells || {})) {
      const decoded = XLSX.utils.decode_cell(ref);
      if (decoded.c > maxCol) maxCol = decoded.c;
      if (decoded.r > maxRow) maxRow = decoded.r;

      const val = cellObj?.computed !== undefined ? cellObj.computed : cellObj?.v;
      const formula = cellObj?.f ? String(cellObj.f).replace(/^=/, '') : null;

      const xlsxCell = {};
      if (typeof val === 'number' && Number.isFinite(val)) {
        xlsxCell.t = 'n';
        xlsxCell.v = val;
      } else if (typeof val === 'boolean') {
        xlsxCell.t = 'b';
        xlsxCell.v = val;
      } else {
        xlsxCell.t = 's';
        xlsxCell.v = val !== undefined && val !== null ? String(val) : '';
      }
      if (formula) {
        xlsxCell.f = formula;
      }
      ws[ref] = xlsxCell;
    }

    ws['!ref'] = XLSX.utils.encode_range({
      s: { c: 0, r: 0 },
      e: { c: Math.max(maxCol, 1), r: Math.max(maxRow, 1) },
    });

    XLSX.utils.book_append_sheet(wb, ws, tab.name.slice(0, 31));
  }

  // Embed Nexus metadata sheet or custom property so styles/freezeRow survive .xlsx roundtrip if needed
  wb.Custprops = {
    nexus_meta_v1: JSON.stringify(
      evaluated.map((t) => ({
        name: t.name,
        freezeRow: t.freezeRow,
        styles: Object.fromEntries(
          Object.entries(t.cells || {})
            .filter(([, c]) => c?.style || c?.format)
            .map(([k, c]) => [k, { style: c.style, format: c.format }]),
        ),
      })),
    ),
  };

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

export function exportTabsToCsvString(tabs) {
  const evaluated = normalizeWorkbookTabs(tabs);
  const firstTab = evaluated[0] || { cells: {} };
  const ws = {};
  let maxCol = 0;
  let maxRow = 0;

  for (const [ref, cellObj] of Object.entries(firstTab.cells || {})) {
    const decoded = XLSX.utils.decode_cell(ref);
    if (decoded.c > maxCol) maxCol = decoded.c;
    if (decoded.r > maxRow) maxRow = decoded.r;
    const val = cellObj?.computed !== undefined ? cellObj.computed : cellObj?.v;
    ws[ref] = {
      t: typeof val === 'number' && Number.isFinite(val) ? 'n' : 's',
      v: val !== undefined && val !== null ? val : '',
    };
  }
  ws['!ref'] = XLSX.utils.encode_range({
    s: { c: 0, r: 0 },
    e: { c: maxCol, r: maxRow },
  });
  return XLSX.utils.sheet_to_csv(ws);
}

export function parseBinaryToWorkbookTabs(buffer, fileName = 'Planilha.xlsx') {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
  const lower = String(fileName || '').toLowerCase();

  if (lower.endsWith('.nexusheet') || lower.endsWith('.json')) {
    try {
      const parsed = JSON.parse(buf.toString('utf8'));
      const raw = parsed?.sheets || parsed?.tabs || (Array.isArray(parsed) ? parsed : []);
      return normalizeWorkbookTabs(raw);
    } catch {
      const err = new Error('Arquivo .nexusheet inválido ou corrompido.');
      err.statusCode = 422;
      throw err;
    }
  }

  if (lower.endsWith('.csv')) {
    const text = buf.toString('utf8');
    const wb = XLSX.read(text, { type: 'string', raw: false });
    return extractTabsFromXlsxWorkbook(wb);
  }

  // Validate PKZIP signature for .xlsx files (0x50 0x4b 0x03 0x04)
  if (lower.endsWith('.xlsx')) {
    if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
      const err = new Error('Binário .xlsx inválido ou corrompido (assinatura ZIP ausente).');
      err.code = 'CORRUPT_XLSX';
      err.statusCode = 422;
      throw err;
    }
  }

  let wb;
  try {
    wb = XLSX.read(buf, { type: 'buffer', cellFormula: true, cellStyles: true });
  } catch (readErr) {
    const err = new Error(`Falha ao decodificar planilha: ${readErr.message}`);
    err.code = 'CORRUPT_WORKBOOK';
    err.statusCode = 422;
    throw err;
  }

  if (!wb || !Array.isArray(wb.SheetNames) || wb.SheetNames.length === 0) {
    const err = new Error('Planilha sem abas válidas.');
    err.statusCode = 422;
    throw err;
  }

  return extractTabsFromXlsxWorkbook(wb);
}

function extractTabsFromXlsxWorkbook(wb) {
  let metaMap = new Map();
  if (wb.Custprops?.nexus_meta_v1) {
    try {
      const metaArr = JSON.parse(wb.Custprops.nexus_meta_v1);
      for (const m of metaArr) {
        if (m?.name) metaMap.set(m.name, m);
      }
    } catch {
      metaMap = new Map();
    }
  }

  const tabs = wb.SheetNames.map((sheetName) => {
    const ws = wb.Sheets[sheetName] || {};
    const meta = metaMap.get(sheetName) || {};
    const cells = {};

    for (const [key, cell] of Object.entries(ws)) {
      if (key.startsWith('!')) continue;
      if (!cell || typeof cell !== 'object') continue;
      const ref = key.toUpperCase();
      const entry = {};
      if (cell.v !== undefined) {
        const numCandidate = typeof cell.v === 'string' && /^-?\d+(\.\d+)?$/.test(cell.v.trim())
          ? Number(cell.v)
          : cell.v;
        entry.v = numCandidate;
      }
      if (cell.f) {
        entry.f = String(cell.f).startsWith('=') ? String(cell.f) : `=${cell.f}`;
      }
      if (meta.styles?.[ref]?.style) {
        entry.style = meta.styles[ref].style;
      }
      if (meta.styles?.[ref]?.format) {
        entry.format = meta.styles[ref].format;
      }
      cells[ref] = entry;
    }

    return {
      name: sheetName,
      freezeRow: Number(meta.freezeRow ?? 0),
      cells,
    };
  });

  return normalizeWorkbookTabs(tabs);
}

export function diffWorkbookCells(oldTabs = [], newTabs = []) {
  const oldByTab = new Map((oldTabs || []).map((t) => [t.name, t.cells || {}]));
  const changes = [];

  for (const newTab of newTabs || []) {
    const tabName = newTab.name || 'Planilha1';
    const prevCells = oldByTab.get(tabName) || {};
    const nextCells = newTab.cells || {};
    const allRefs = new Set([...Object.keys(prevCells), ...Object.keys(nextCells)]);

    for (const ref of allRefs) {
      const p = prevCells[ref];
      const n = nextCells[ref];
      const oldVal = p?.v !== undefined ? String(p.v ?? '') : '';
      const newVal = n?.v !== undefined ? String(n.v ?? '') : '';
      const oldForm = p?.f ? String(p.f) : null;
      const newForm = n?.f ? String(n.f) : null;

      if (oldVal !== newVal || oldForm !== newForm) {
        changes.push({
          tabName,
          cellRef: ref,
          oldValue: oldVal || null,
          newValue: newVal || null,
          oldFormula: oldForm,
          newFormula: newForm,
        });
      }
    }
  }

  return changes;
}
