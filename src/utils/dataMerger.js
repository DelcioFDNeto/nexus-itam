// src/utils/dataMerger.js
import rawMaster from '../data/rawMaster.json';
import rawComments from '../data/rawComments.json';

// ======================================================
// 1. CORREÇÃO DE ENCODING (UTF-8 quebrado do Excel)
// ======================================================
const fixEncoding = (str) => {
  if (!str) return "";
  let fixed = String(str);

  const replacements = {
    'Ã¡': 'á', 'Ã ': 'à', 'Ã¢': 'â', 'Ã£': 'ã', 'Ã¤': 'ä',
    'Ã‰': 'É', 'Ã©': 'é', 'Ãª': 'ê', 'Ã«': 'ë',
    'ÃÍ': 'Í', 'Ãí': 'í', 'Ã¬': 'ì', 'Ãee': 'î', 'Ã¯': 'ï',
    'Ã“': 'Ó', 'Ã³': 'ó', 'Ã²': 'ò', 'Ã´': 'ô', 'Ã¶': 'ö', 'Ãµ': 'õ',
    'Ãš': 'Ú', 'Ãº': 'ú', 'Ã¹': 'ù', 'Ã»': 'û', 'Ã¼': 'ü',
    'Ã§': 'ç', 'Ã‡': 'Ç', 'Ã±': 'ñ', 'Ã‘': 'Ñ',
    'Âº': 'º', 'Â°': '°', 'Âª': 'ª',
  };

  // Ordenado por tamanho para evitar conflitos
  const sortedKeys = Object.keys(replacements).sort((a, b) => b.length - a.length);

  sortedKeys.forEach(bad => {
    fixed = fixed.replace(new RegExp(bad, 'g'), replacements[bad]);
  });

  return fixed.trim();
};

// ======================================================
// 2. BUSCA DE CHAVE COM NOME PARCIAL (case insensitive)
// ======================================================
const findKey = (obj, partial) => {
  if (!obj) return null;
  return Object.keys(obj).find(k => k.toUpperCase().includes(partial.toUpperCase()));
};

// ======================================================
// 3. GERAÇÃO DE DADOS LIMPOS
// ======================================================
export const generateCleanData = () => {
  console.log("=== INICIANDO DATA MERGER ===");

  // ------------------------------------------------------
  // 3.1 Normalizar lista de comentários
  // ------------------------------------------------------
  let commentsList = [];

  if (Array.isArray(rawComments)) {
    commentsList = rawComments;
  } else if (rawComments && typeof rawComments === 'object') {
    const keys = Object.keys(rawComments);
    for (const k of keys) {
      if (Array.isArray(rawComments[k])) {
        commentsList = rawComments[k];
        break;
      }
    }
  }

  // ------------------------------------------------------
  // 3.2 Criar assetsByRow — AQUI está a correção principal
  // ------------------------------------------------------
  const assetsByRow = {};
  const assetsList = [];

  rawMaster.forEach((item, idx) => {
    if (!item) return;

    // Excel row = índice + 2 (linha 1 = cabeçalho, linha 2 = item 0)
    const excelRow = idx + 2;

    const idKey = findKey(item, "ID DO ATIVO") || findKey(item, "ID");
    if (!idKey || !item[idKey]) return;

    const modelKey = findKey(item, "NOME");
    const localKey = findKey(item, "LOCAL");
    const statusKey = findKey(item, "STATUS");
    const dateKey = findKey(item, "AQUISI") || findKey(item, "DATA");
    const valueKey = findKey(item, "VALOR");

    let rawLocation = item[localKey];
    if (typeof rawLocation === "object") rawLocation = JSON.stringify(rawLocation);

    const asset = {
      internalId: String(item[idKey]).trim(),
      model: fixEncoding(item[modelKey]),
      locationRaw: fixEncoding(rawLocation),
      statusRaw: fixEncoding(item[statusKey]),
      purchaseDate: item[dateKey] || "",
      valor: item[valueKey] || "",
      serialNumber: "",
      imei1: null,
      imei2: null,
      clientName: "",
      clientCpf: "",
      specs: { ip: "" },
      __excelRow: excelRow,
    };

    assetsByRow[excelRow] = asset;
    assetsList.push(asset);
  });

  // ======================================================
  // 4. CRUZAMENTO DE COMENTÁRIOS → ASSETS (SEM ERROS)
  // ======================================================
  let imeiCount = 0;
  let serialCount = 0;

  commentsList.forEach(comment => {
    const textRaw =
      comment["ns1:t"] ||
      comment["t"] ||
      comment["#text"] ||
      comment["text"] ||
      Object.values(comment).find(v => typeof v === "string") ||
      "";

    const text = fixEncoding(textRaw);
    const ref = comment["ref"] || comment["_ref"];
    if (!ref) return;

    const rowMatch = ref.match(/(\d+)/);
    if (!rowMatch) return;

    const excelRow = Number(rowMatch[1]);
    const asset = assetsByRow[excelRow];
    if (!asset) return;

    // ------------------------------------------------------
    // SERIAL
    // ------------------------------------------------------
    const serialMatch = text.match(/(?:S[/.]?N|Serial|Tag|Série|Serie)[\W_]*?([A-Z0-9][A-Z0-9\-/]{3,})/i);

    if (serialMatch && !serialMatch[1].match(/^\d{15}$/)) {
      asset.serialNumber = serialMatch[1].trim();
      serialCount++;
    }

    // ------------------------------------------------------
    // IMEI
    // ------------------------------------------------------
    const imeis = text.match(/\b\d{15}\b/g);
    if (imeis) {
      asset.imei1 = imeis[0];
      if (imeis[1]) asset.imei2 = imeis[1];
      imeiCount++;
    }

    // ------------------------------------------------------
    // CPF
    // ------------------------------------------------------
    const cpfMatch = text.match(/(\d{3}\.\d{3}\.\d{3}-\d{2})/);
    if (cpfMatch) asset.clientCpf = cpfMatch[1];

    // ------------------------------------------------------
    // NOME DO CLIENTE
    // ------------------------------------------------------
    const personMatch = text.match(/(?:Cliente|Usuário|Usuario)[:\s]*([^\n\r(]+)/i);
    if (personMatch) asset.clientName = personMatch[1].trim();
  });

  console.log(`→ Total encontrados: ${imeiCount} IMEIs | ${serialCount} Seriais.`);

  // ======================================================
  // 5. FORMATAÇÃO FINAL — tipo, categoria, status
  // ======================================================
  return assetsList.map(asset => {
    const id = asset.internalId.toUpperCase();
    const model = asset.model ? asset.model.toLowerCase() : "";

    // ------------------------------------
    // TIPO
    // ------------------------------------
    let type = "Outro";

    if (id.includes("NTB") || model.includes("notebook") || model.includes("book")) type = "Notebook";
    else if (id.includes("CEL") || id.includes("PRM") || model.includes("redmi") || model.includes("galaxy"))
      type = "Celular";
    else if (id.includes("IMP") || model.includes("epson") || model.includes("workforce")) type = "Impressora";
    else if (id.includes("PC") || model.includes("all in one")) type = "Computador";
    else if (id.includes("PGT") || model.includes("pay") || model.includes("sunmi") || model.includes("l400"))
      type = "PGT";

    // ------------------------------------
    // STATUS
    // ------------------------------------
    let status = "Em Uso";
    const sr = (asset.statusRaw || "").toLowerCase();

    if (sr.includes("dispon")) status = "Disponível";
    if (sr.includes("manuten") || sr.includes("defeito")) status = "Manutenção";
    if (sr.includes("transf")) status = "Em Transferência";
    if (sr.includes("entreg")) status = "Entregue";

    // ------------------------------------
    // CATEGORIA (CORRIGIDO)
    // ------------------------------------
    // Agora só classifica como promocional se PRM for uma PALAVRA/NÚMERO exato no ID
    const category = /\bPRM\b/i.test(id) ? "Promocional" : "Corporativo";

    // ------------------------------------
    // OBJ FINAL
    // ------------------------------------
    return {
      internalId: asset.internalId,
      model: asset.model,
      type,
      category,
      status,
      serialNumber: asset.serialNumber,
      imei1: asset.imei1,
      imei2: asset.imei2,
      location: asset.locationRaw,
      assignedTo: asset.clientName || asset.locationRaw,
      clientName: asset.clientName || null,
      clientCpf: asset.clientCpf || null,
      purchaseDate: asset.purchaseDate,
      valor: asset.valor,
      updatedAt: new Date()
    };
  });
};