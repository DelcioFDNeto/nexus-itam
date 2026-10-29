// services/shared/tagEngine.js
// =============================================================================
// Motor Servidor de Geração Inteligente de Tag Patrimonial Sequencial
// Espelha no backend a inteligência adaptativa multi-empresa por tipo de ativo.
// =============================================================================

const TYPE_CODES = {
  notebook: 'NB',
  desktop: 'DT',
  computador: 'DT',
  monitor: 'MN',
  celular: 'CEL',
  smartphone: 'CEL',
  impressora: 'IMP',
  servidor: 'SRV',
  rede: 'NET',
  switch: 'NET',
  roteador: 'NET',
  periferico: 'PER',
  tablet: 'TAB',
  nobreak: 'UPS',
};

export function resolveTypeCode(assetType = '') {
  const normalized = String(assetType || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
  for (const [key, code] of Object.entries(TYPE_CODES)) {
    if (normalized.includes(key)) return code;
  }
  return 'TI';
}

export function generateSequentialTag({ existingAssets = [], assetType = 'Notebook', tenantPrefix = 'NEX' }) {
  const cleanPrefix = String(tenantPrefix || 'NEX')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6) || 'NEX';
  const typeCode = resolveTypeCode(assetType);

  const sameTypeTags = existingAssets
    .filter((a) => String(a.type || '').toLowerCase() === String(assetType || '').toLowerCase())
    .map((a) => String(a.internal_id || a.internalId || '').trim().toUpperCase())
    .filter(Boolean);

  const allTags = existingAssets
    .map((a) => String(a.internal_id || a.internalId || '').trim().toUpperCase())
    .filter(Boolean);

  const tagSet = new Set(allTags);

  // Detecta padrão existente no tipo (ex: NEX-NB-0042)
  const regex = /^([A-Z0-9-]+?-)(\d{2,6})$/;
  let detectedStem = `${cleanPrefix}-${typeCode}-`;
  let padWidth = 4;
  let maxNumber = 0;

  const pool = sameTypeTags.length > 0 ? sameTypeTags : allTags.filter((t) => t.includes(`-${typeCode}-`));

  for (const tag of pool) {
    const match = tag.match(regex);
    if (match) {
      detectedStem = match[1];
      padWidth = Math.max(padWidth, match[2].length);
      const num = parseInt(match[2], 10);
      if (!Number.isNaN(num) && num > maxNumber) {
        maxNumber = num;
      }
    }
  }

  // Garante unicidade absoluta dentro do tenant
  let nextNumber = maxNumber + 1;
  let candidate = `${detectedStem}${String(nextNumber).padStart(padWidth, '0')}`;
  while (tagSet.has(candidate)) {
    nextNumber += 1;
    candidate = `${detectedStem}${String(nextNumber).padStart(padWidth, '0')}`;
  }

  return {
    suggestedTag: candidate,
    stem: detectedStem,
    typeCode,
    nextNumber,
    padWidth,
  };
}
