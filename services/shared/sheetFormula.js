// services/shared/sheetFormula.js
// =============================================================================
// Motor de Fórmulas e Formatação — Nexus Sheets Live (PT-BR & EN)
// =============================================================================
// Suporta:
//  - Funções: SOMA/SUM, MÉDIA/AVERAGE, MÍN/MIN, MÁX/MAX, SE/IF, CONT.SE/COUNTIF
//  - Separadores PT-BR (;) e EN (,), literais decimais com vírgula (10,5)
//  - Referências simples (A1), intervalos (B2:B5) e cross-tab (Estoque!B2:B5, 'Custos TI'!A1:A2)
//  - Detecção de ciclos (#CYCLE!), #DIV/0!, #REF!, #NAME?, #VALUE!, #ERROR!
//  - Blindagem contra injeção de código JS e poluição de protótipo
//  - Formatação: R$ (#,##0.00), %, datas dd/mm/yyyy
// =============================================================================

const BLOCKED_IDENTIFIERS =
  /\b(constructor|__proto__|prototype|process|global|globalThis|require|import|eval|Function|window|document|fetch|XMLHttpRequest|child_process|fs)\b/i;

export function colLettersToIndex(letters) {
  const clean = String(letters || '').toUpperCase().trim();
  let num = 0;
  for (let i = 0; i < clean.length; i += 1) {
    num = num * 26 + (clean.charCodeAt(i) - 64);
  }
  return num - 1;
}

export function indexToColLetters(index) {
  let n = Number(index) + 1;
  let str = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    str = String.fromCharCode(65 + rem) + str;
    n = Math.floor((n - 1) / 26);
  }
  return str || 'A';
}

export function parseCellRef(refStr) {
  const str = String(refStr || '').trim();
  const m = /^(?:(?:'([^']+)'|([A-Za-z0-9_.\-\u00C0-\u017F ]+))!)?\$?([A-Za-z]{1,3})\$?(\d{1,6})$/.exec(str);
  if (!m) return null;
  const tab = (m[1] || m[2] || '').trim() || null;
  const col = m[3].toUpperCase();
  const row = Number.parseInt(m[4], 10);
  if (row < 1) return null;
  return {
    tab,
    col,
    row,
    cell: `${col}${row}`,
  };
}

export function expandCellRange(rangeStr, defaultTab = null) {
  const str = String(rangeStr || '').trim();
  const bangIdx = str.indexOf('!');
  let tab = defaultTab;
  let rangePart = str;
  if (bangIdx !== -1) {
    let rawTab = str.slice(0, bangIdx).trim();
    if (rawTab.startsWith("'") && rawTab.endsWith("'")) {
      rawTab = rawTab.slice(1, -1);
    }
    tab = rawTab;
    rangePart = str.slice(bangIdx + 1).trim();
  }

  const parts = rangePart.split(':');
  if (parts.length !== 2) return null;
  const start = parseCellRef(parts[0]);
  const end = parseCellRef(parts[1]);
  if (!start || !end) return null;

  const c1 = Math.min(colLettersToIndex(start.col), colLettersToIndex(end.col));
  const c2 = Math.max(colLettersToIndex(start.col), colLettersToIndex(end.col));
  const r1 = Math.min(start.row, end.row);
  const r2 = Math.max(start.row, end.row);

  if ((c2 - c1 + 1) * (r2 - r1 + 1) > 10000) return null;

  const refs = [];
  for (let r = r1; r <= r2; r += 1) {
    for (let c = c1; c <= c2; c += 1) {
      refs.push({
        tab: end.tab || start.tab || tab,
        cell: `${indexToColLetters(c)}${r}`,
      });
    }
  }
  return refs;
}

export function parseLocalizedNumber(val) {
  if (typeof val === 'number') return Number.isFinite(val) ? val : NaN;
  if (typeof val === 'boolean') return val ? 1 : 0;
  if (val === null || val === undefined) return NaN;
  const s = String(val).trim();
  if (!s) return NaN;
  const clean = s.replace(/^R\$\s*/i, '').replace(/%$/, '').trim();
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(clean)) {
    return Number(clean.replace(/\./g, '').replace(',', '.'));
  }
  if (/^-?\d+,\d+$/.test(clean)) {
    return Number(clean.replace(',', '.'));
  }
  if (/^-?\d+(\.\d+)?$/.test(clean)) {
    return Number(clean);
  }
  return NaN;
}

function normalizeSheetMap(context) {
  const map = new Map();
  let defaultTab = context?.activeTab || 'Planilha1';

  if (Array.isArray(context?.sheets || context?.tabs)) {
    const arr = context.sheets || context.tabs;
    for (const t of arr) {
      if (t && t.name) {
        map.set(String(t.name).trim(), t.cells || {});
      }
    }
    if (arr[0]?.name && !map.has(defaultTab)) {
      defaultTab = arr[0].name;
    }
  } else if (Array.isArray(context)) {
    for (const t of context) {
      if (t && t.name) {
        map.set(String(t.name).trim(), t.cells || {});
      }
    }
    if (context[0]?.name) defaultTab = context[0].name;
  } else if (context?.cells && typeof context.cells === 'object') {
    map.set(defaultTab, context.cells);
  } else if (context && typeof context === 'object') {
    map.set(defaultTab, context);
  }

  return { map, defaultTab };
}

function findTabCells(sheetMap, tabName) {
  if (!tabName) return null;
  if (sheetMap.has(tabName)) return { key: tabName, cells: sheetMap.get(tabName) };
  const lower = String(tabName).toLowerCase();
  for (const [k, v] of sheetMap.entries()) {
    if (k.toLowerCase() === lower) return { key: k, cells: v };
  }
  return null;
}

function extractRawCellSpec(cellEntry) {
  if (cellEntry === null || cellEntry === undefined) {
    return { rawValue: '', formula: null };
  }
  if (typeof cellEntry === 'object') {
    const f = cellEntry.f ?? cellEntry.formula ?? null;
    const v = cellEntry.v ?? cellEntry.value ?? '';
    if (typeof f === 'string' && f.trim()) {
      return {
        rawValue: v,
        formula: f.trim().startsWith('=') ? f.trim() : `=${f.trim()}`,
      };
    }
    if (typeof v === 'string' && v.trim().startsWith('=')) {
      return { rawValue: v, formula: v.trim() };
    }
    return { rawValue: v, formula: null };
  }
  if (typeof cellEntry === 'string' && cellEntry.trim().startsWith('=')) {
    return { rawValue: cellEntry, formula: cellEntry.trim() };
  }
  return { rawValue: cellEntry, formula: null };
}

function normalizeFuncName(rawName) {
  const upper = String(rawName || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (upper === 'SOMA' || upper === 'SUM') return 'SUM';
  if (upper === 'MEDIA' || upper === 'AVERAGE' || upper === 'AVG') return 'AVERAGE';
  if (upper === 'MIN' || upper === 'MINIMO') return 'MIN';
  if (upper === 'MAX' || upper === 'MAXIMO') return 'MAX';
  if (upper === 'SE' || upper === 'IF') return 'IF';
  if (upper === 'CONT.SE' || upper === 'CONTSE' || upper === 'COUNTIF') return 'COUNTIF';
  return null;
}

function splitTopLevelArgs(argsStr) {
  const s = String(argsStr || '');
  // If semicolon is present outside quotes/parens, use ';' as argument separator (allowing ',' as decimal!)
  let hasTopLevelSemicolon = false;
  let depth = 0;
  let inQuotes = false;
  let quoteChar = '';

  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === quoteChar) inQuotes = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuotes = true;
      quoteChar = ch;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0) {
      hasTopLevelSemicolon = true;
      break;
    }
  }

  const sep = hasTopLevelSemicolon ? ';' : ',';
  const parts = [];
  let cur = '';
  depth = 0;
  inQuotes = false;
  quoteChar = '';

  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inQuotes) {
      cur += ch;
      if (ch === quoteChar) inQuotes = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuotes = true;
      quoteChar = ch;
      cur += ch;
      continue;
    }
    if (ch === '(') {
      depth += 1;
      cur += ch;
      continue;
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1);
      cur += ch;
      continue;
    }
    if (ch === sep && depth === 0) {
      parts.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim() !== '' || parts.length > 0) {
    parts.push(cur.trim());
  }
  return parts;
}

function checkBalancedParens(expr) {
  let depth = 0;
  let inQuotes = false;
  let q = '';
  for (let i = 0; i < expr.length; i += 1) {
    const ch = expr[i];
    if (inQuotes) {
      if (ch === q) inQuotes = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuotes = true;
      q = ch;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0 && !inQuotes;
}

export function evaluateFormula(exprOrValue, context = {}, visiting = new Set()) {
  if (exprOrValue === null || exprOrValue === undefined) return '';
  if (typeof exprOrValue === 'number' || typeof exprOrValue === 'boolean') return exprOrValue;

  let rawStr = '';
  if (typeof exprOrValue === 'object') {
    const spec = extractRawCellSpec(exprOrValue);
    if (!spec.formula) return spec.rawValue;
    rawStr = spec.formula;
  } else {
    rawStr = String(exprOrValue);
  }

  if (!rawStr.trim().startsWith('=')) {
    return rawStr;
  }

  const body = rawStr.trim().slice(1).trim();
  if (!body) return '';
  if (body === '#REF!' || body === '#DIV/0!' || body === '#CYCLE!' || body === '#NAME?' || body === '#VALUE!' || body === '#ERROR!') {
    return body;
  }

  if (BLOCKED_IDENTIFIERS.test(body) || /=>|[{}[\];]/.test(body.replace(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/g, ';'))) {
    if (BLOCKED_IDENTIFIERS.test(body) || /=>|[{}[\]]/.test(body)) {
      return '#ERROR!';
    }
  }

  if (!checkBalancedParens(body)) {
    return '#ERROR!';
  }

  const { map: sheetMap, defaultTab } = normalizeSheetMap(context);

  function resolveSingleCell(tabName, cellCode) {
    const targetTab = tabName || defaultTab;
    const found = findTabCells(sheetMap, targetTab);
    if (!found) return '#REF!';
    const visitKey = `${found.key.toUpperCase()}!${cellCode.toUpperCase()}`;
    if (visiting.has(visitKey)) {
      return '#CYCLE!';
    }
    const rawEntry = found.cells?.[cellCode.toUpperCase()] ?? found.cells?.[cellCode];
    const spec = extractRawCellSpec(rawEntry);
    if (spec.formula) {
      const nextVisiting = new Set(visiting);
      nextVisiting.add(visitKey);
      return evaluateFormula(
        spec.formula,
        { sheets: Array.from(sheetMap.entries()).map(([name, cells]) => ({ name, cells })), activeTab: found.key },
        nextVisiting,
      );
    }
    return spec.rawValue;
  }

  function resolveRangeValues(rangeToken, currentTab) {
    const cleanRange = String(rangeToken || '').trim();
    const expanded = expandCellRange(cleanRange, currentTab);
    if (!expanded) return null;
    const values = [];
    for (const item of expanded) {
      const targetTab = item.tab || currentTab;
      if (!findTabCells(sheetMap, targetTab)) {
        return '#REF!';
      }
      const v = resolveSingleCell(targetTab, item.cell);
      if (typeof v === 'string' && v.startsWith('#')) {
        return v;
      }
      values.push(v);
    }
    return values;
  }

  function evalNode(nodeStr, currentTab) {
    const s = String(nodeStr ?? '').trim();
    if (!s) return 0;

    if (s.startsWith('#')) return s;

    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'") && !s.includes('!'))) {
      return s.slice(1, -1);
    }

    // Strip outer wrapping parens if balanced around the entire expression
    if (s.startsWith('(') && s.endsWith(')')) {
      let depth = 0;
      let wrapsAll = true;
      let inQ = false;
      let qChar = '';
      for (let i = 0; i < s.length - 1; i += 1) {
        const ch = s[i];
        if (inQ) {
          if (ch === qChar) inQ = false;
          continue;
        }
        if (ch === '"' || ch === "'") {
          inQ = true;
          qChar = ch;
          continue;
        }
        if (ch === '(') depth += 1;
        else if (ch === ')') depth -= 1;
        if (depth === 0) {
          wrapsAll = false;
          break;
        }
      }
      if (wrapsAll) return evalNode(s.slice(1, -1), currentTab);
    }

    // Comparison operators at top level (for IF conditions)
    const compMatch = splitBinaryTopLevel(s, ['>=', '<=', '<>', '!=', '=', '>', '<']);
    if (compMatch) {
      const left = evalNode(compMatch.left, currentTab);
      const right = evalNode(compMatch.right, currentTab);
      if (typeof left === 'string' && left.startsWith('#')) return left;
      if (typeof right === 'string' && right.startsWith('#')) return right;
      const lNum = parseLocalizedNumber(left);
      const rNum = parseLocalizedNumber(right);
      const bothNum = Number.isFinite(lNum) && Number.isFinite(rNum);
      const a = bothNum ? lNum : String(left ?? '').toLowerCase();
      const b = bothNum ? rNum : String(right ?? '').toLowerCase();
      switch (compMatch.op) {
        case '>=':
          return a >= b;
        case '<=':
          return a <= b;
        case '>':
          return a > b;
        case '<':
          return a < b;
        case '<>':
        case '!=':
          return a !== b;
        case '=':
          return a === b;
        default:
          return false;
      }
    }

    // Addition / Subtraction at top level
    const addSub = splitAddSubTopLevel(s);
    if (addSub) {
      const left = evalNode(addSub.left, currentTab);
      const right = evalNode(addSub.right, currentTab);
      if (typeof left === 'string' && left.startsWith('#')) return left;
      if (typeof right === 'string' && right.startsWith('#')) return right;
      const lNum = left === '' || left === null ? 0 : parseLocalizedNumber(left);
      const rNum = right === '' || right === null ? 0 : parseLocalizedNumber(right);
      if (!Number.isFinite(lNum) || !Number.isFinite(rNum)) return '#VALUE!';
      return addSub.op === '+' ? lNum + rNum : lNum - rNum;
    }

    // Multiplication / Division at top level
    const mulDiv = splitMulDivTopLevel(s);
    if (mulDiv) {
      const left = evalNode(mulDiv.left, currentTab);
      const right = evalNode(mulDiv.right, currentTab);
      if (typeof left === 'string' && left.startsWith('#')) return left;
      if (typeof right === 'string' && right.startsWith('#')) return right;
      const lNum = left === '' || left === null ? 0 : parseLocalizedNumber(left);
      const rNum = right === '' || right === null ? 0 : parseLocalizedNumber(right);
      if (!Number.isFinite(lNum) || !Number.isFinite(rNum)) return '#VALUE!';
      if (mulDiv.op === '/') {
        if (rNum === 0) return '#DIV/0!';
        return lNum / rNum;
      }
      return lNum * rNum;
    }

    // Function call: FUNC(args)
    const fnMatch = /^([A-Za-zÀ-ÿ0-9_.]+)\s*\(([\s\S]*)\)$/.exec(s);
    if (fnMatch) {
      const rawFn = fnMatch[1];
      const fnName = normalizeFuncName(rawFn);
      if (!fnName) {
        return '#NAME?';
      }
      const rawArgs = splitTopLevelArgs(fnMatch[2]);

      if (fnName === 'IF') {
        if (rawArgs.length < 2) return '#VALUE!';
        const cond = evalNode(rawArgs[0], currentTab);
        if (typeof cond === 'string' && cond.startsWith('#')) return cond;
        const truthy = Boolean(cond && cond !== '0' && cond !== 'false');
        const branch = truthy ? rawArgs[1] : rawArgs[2] ?? '';
        return evalNode(branch, currentTab);
      }

      if (fnName === 'COUNTIF') {
        if (rawArgs.length < 2) return '#VALUE!';
        const rangeVals = resolveRangeValues(rawArgs[0], currentTab);
        if (typeof rangeVals === 'string' && rangeVals.startsWith('#')) return rangeVals;
        if (!Array.isArray(rangeVals)) return '#VALUE!';
        const critRaw = evalNode(rawArgs[1], currentTab);
        const critStr = String(critRaw ?? '').trim();
        const opMatch = /^(>=|<=|<>|!=|>|<|=)(.*)$/.exec(critStr);
        let count = 0;
        for (const item of rangeVals) {
          if (item === null || item === undefined || item === '') continue;
          if (opMatch) {
            const op = opMatch[1];
            const rhsStr = opMatch[2].trim();
            const itemNum = parseLocalizedNumber(item);
            const rhsNum = parseLocalizedNumber(rhsStr);
            if (Number.isFinite(itemNum) && Number.isFinite(rhsNum)) {
              if (op === '>=' && itemNum >= rhsNum) count += 1;
              else if (op === '<=' && itemNum <= rhsNum) count += 1;
              else if (op === '>' && itemNum > rhsNum) count += 1;
              else if (op === '<' && itemNum < rhsNum) count += 1;
              else if ((op === '<>' || op === '!=') && itemNum !== rhsNum) count += 1;
              else if (op === '=' && itemNum === rhsNum) count += 1;
            }
          } else {
            const itemNum = parseLocalizedNumber(item);
            const critNum = parseLocalizedNumber(critStr);
            if (Number.isFinite(itemNum) && Number.isFinite(critNum)) {
              if (itemNum === critNum) count += 1;
            } else if (String(item).trim().toLowerCase() === critStr.toLowerCase()) {
              count += 1;
            }
          }
        }
        return count;
      }

      // Numeric aggregate functions: SUM, AVERAGE, MIN, MAX
      const nums = [];
      for (const arg of rawArgs) {
        if (arg.includes(':')) {
          const rVals = resolveRangeValues(arg, currentTab);
          if (typeof rVals === 'string' && rVals.startsWith('#')) return rVals;
          if (!Array.isArray(rVals)) return '#REF!';
          for (const rv of rVals) {
            const n = parseLocalizedNumber(rv);
            if (Number.isFinite(n)) nums.push(n);
          }
        } else {
          const val = evalNode(arg, currentTab);
          if (typeof val === 'string' && val.startsWith('#')) return val;
          const n = parseLocalizedNumber(val);
          if (Number.isFinite(n)) nums.push(n);
        }
      }

      if (fnName === 'SUM') {
        return nums.reduce((acc, n) => acc + n, 0);
      }
      if (fnName === 'AVERAGE') {
        if (nums.length === 0) return '#DIV/0!';
        return nums.reduce((acc, n) => acc + n, 0) / nums.length;
      }
      if (fnName === 'MIN') {
        if (nums.length === 0) return 0;
        return Math.min(...nums);
      }
      if (fnName === 'MAX') {
        if (nums.length === 0) return 0;
        return Math.max(...nums);
      }
    }

    // Cell reference (with optional tab prefix)
    const refParsed = parseCellRef(s);
    if (refParsed) {
      return resolveSingleCell(refParsed.tab || currentTab, refParsed.cell);
    }

    // Numeric literal (including PT-BR comma decimal like 10,5)
    const litNum = parseLocalizedNumber(s);
    if (Number.isFinite(litNum)) {
      return litNum;
    }

    return '#NAME?';
  }

  const startTab = context?.activeTab || defaultTab;
  const startCell = context?.currentCell ? `${startTab.toUpperCase()}!${String(context.currentCell).toUpperCase()}` : null;
  if (startCell) visiting.add(startCell);

  const result = evalNode(body, startTab);
  if (typeof result === 'number' && !Number.isFinite(result)) {
    return '#DIV/0!';
  }
  return result;
}

function splitBinaryTopLevel(s, operators) {
  let depth = 0;
  let inQ = false;
  let qChar = '';
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inQ) {
      if (ch === qChar) inQ = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQ = true;
      qChar = ch;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      for (const op of operators) {
        if (s.slice(i, i + op.length) === op) {
          const left = s.slice(0, i).trim();
          const right = s.slice(i + op.length).trim();
          if (!left || !right) return null;
          return { op, left, right };
        }
      }
    }
  }
  return null;
}

function splitAddSubTopLevel(s) {
  let depth = 0;
  let inQ = false;
  let qChar = '';
  for (let i = s.length - 1; i >= 0; i -= 1) {
    const ch = s[i];
    if (inQ) {
      if (ch === qChar) inQ = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQ = true;
      qChar = ch;
      continue;
    }
    if (ch === ')') depth += 1;
    else if (ch === '(') depth = Math.max(0, depth - 1);
    else if (depth === 0 && (ch === '+' || ch === '-')) {
      const prev = s.slice(0, i).trim();
      const next = s.slice(i + 1).trim();
      if (!next) return { op: ch, left: '', right: '' };
      if (!prev) {
        // Unary sign at start
        return { op: ch, left: '0', right: next };
      }
      const prevLast = prev[prev.length - 1];
      if (['+', '-', '*', '/', '(', '=', '<', '>', ';', ','].includes(prevLast)) {
        return null;
      }
      return { op: ch, left: prev, right: next };
    }
  }
  return null;
}

function splitMulDivTopLevel(s) {
  let depth = 0;
  let inQ = false;
  let qChar = '';
  for (let i = s.length - 1; i >= 0; i -= 1) {
    const ch = s[i];
    if (inQ) {
      if (ch === qChar) inQ = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQ = true;
      qChar = ch;
      continue;
    }
    if (ch === ')') depth += 1;
    else if (ch === '(') depth = Math.max(0, depth - 1);
    else if (depth === 0 && (ch === '*' || ch === '/')) {
      const left = s.slice(0, i).trim();
      const right = s.slice(i + 1).trim();
      return { op: ch, left, right };
    }
  }
  return null;
}

export function formatCellValue(value, formatOrPattern = {}) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string' && value.startsWith('#')) return value;

  const pattern =
    typeof formatOrPattern === 'string'
      ? formatOrPattern
      : formatOrPattern?.numFmt || formatOrPattern?.numberFormat || formatOrPattern?.type || '';
  const pLower = String(pattern || '').toLowerCase();

  if (pLower.includes('r$') || pLower.includes('currency') || pLower.includes('brl')) {
    const n = parseLocalizedNumber(value);
    if (!Number.isFinite(n)) return String(value);
    const formatted = new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
    return `R$ ${formatted}`;
  }

  if (pLower.includes('%') || pLower === 'percent') {
    const n = parseLocalizedNumber(value);
    if (!Number.isFinite(n)) return String(value);
    const pct = n * 100;
    const formatted = new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 2,
    }).format(pct);
    return `${formatted}%`;
  }

  if (pLower.includes('dd/mm/yyyy') || pLower === 'date') {
    const s = String(value).trim();
    const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (isoMatch) {
      return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
    }
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      const dd = String(d.getUTCDate()).padStart(2, '0');
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const yyyy = d.getUTCFullYear();
      return `${dd}/${mm}/${yyyy}`;
    }
    return s;
  }

  return String(value);
}

export const formatValue = formatCellValue;

export function evaluateWorkbook(input) {
  const isArrayInput = Array.isArray(input);
  const rawSheets = isArrayInput ? input : input?.sheets || input?.tabs || [];
  const normalizedSheets = rawSheets.map((s, idx) => ({
    name: String(s?.name || `Planilha${idx + 1}`),
    freezeRow: Number(s?.freezeRow ?? 0),
    cells: { ...(s?.cells || {}) },
  }));

  const evaluatedSheets = normalizedSheets.map((sheet) => {
    const outCells = {};
    for (const [cellKey, rawEntry] of Object.entries(sheet.cells)) {
      const key = String(cellKey).toUpperCase();
      const spec = extractRawCellSpec(rawEntry);
      if (spec.formula) {
        const computed = evaluateFormula(
          spec.formula,
          { sheets: normalizedSheets, activeTab: sheet.name, currentCell: key },
          new Set(),
        );
        if (rawEntry && typeof rawEntry === 'object') {
          outCells[key] = {
            ...rawEntry,
            f: spec.formula,
            v: computed,
            value: computed,
            computed,
          };
        } else {
          outCells[key] = {
            f: spec.formula,
            v: computed,
            value: computed,
            computed,
          };
        }
      } else if (rawEntry && typeof rawEntry === 'object') {
        const val = rawEntry.v !== undefined ? rawEntry.v : rawEntry.value;
        outCells[key] = {
          ...rawEntry,
          v: val,
          value: val,
          computed: val,
        };
      } else {
        outCells[key] = rawEntry;
      }
    }
    return {
      ...sheet,
      cells: outCells,
    };
  });

  if (isArrayInput) return evaluatedSheets;
  return {
    ...(typeof input === 'object' ? input : {}),
    sheets: evaluatedSheets,
    tabs: evaluatedSheets,
  };
}

export const recalculateWorkbook = evaluateWorkbook;
export const evaluateSheets = evaluateWorkbook;
export const evaluateSheet = evaluateWorkbook;
