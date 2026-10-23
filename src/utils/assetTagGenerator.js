// src/utils/assetTagGenerator.js
// -----------------------------------------------------------------------------
// Gerador Universal e Inteligente de Códigos de Patrimônio (Tags / internalId)
// -----------------------------------------------------------------------------
// Analisa dinamicamente os códigos de patrimônio adotados pela empresa (tenant),
// identifica a convenção de nomenclatura existente para o tipo de ativo (ou padrão
// geral da empresa) e dá prosseguimento estrito à numeração (preservando prefixo,
// delimitadores, códigos de filial e zero-padding).
//
// Funciona para qualquer empresa (multi-tenant):
//  - Padrão composto com filial: SHL-BEL-NTB-001 -> SHL-BEL-NTB-002
//  - Padrão empresa + tipo: ACME-CPU-042 -> ACME-CPU-043
//  - Padrão tipo + número: NB-001 -> NB-002, PC-01 -> PC-02
//  - Padrão sequencial unificado: PAT-0125 -> PAT-0126
//  - Padrão numérico puro: 000142 -> 000143
//  - Delimitadores diversos: '-', '.', '/', '_', ' ' ou sem separador
//  - Adaptação inteligente para novos tipos de ativo usando a máscara da empresa
//  - Fallback limpo corporativo para empresas novas sem ativos prévios
//  - Garantia de unicidade (evita duplicidade caso haja saltos na numeração)
// -----------------------------------------------------------------------------

import { assetPrefixFor } from '../services/tenantService';

/**
 * Mapeamento padrão de códigos de tipo de ativo (ordem de preferência).
 */
export const TYPE_CODE_MAP = {
  Notebook: ['NTB', 'NB', 'NOTE'],
  Computador: ['CPU', 'PC', 'DESK', 'COMP'],
  Servidor: ['SRV', 'SRVR'],
  Tablet: ['TAB', 'TBL'],
  Monitor: ['MON', 'TELA'],
  Celular: ['CEL', 'SMART', 'TEL'],
  PGT: ['PGT', 'POS'],
  Impressora: ['IMP', 'PRT', 'PRINT'],
  Scanner: ['SCN', 'SCAN'],
  Rede: ['RED', 'NET'],
  Switch: ['SW', 'AP'],
  Storage: ['STO', 'NAS', 'SAN'],
  Nobreak: ['NBK', 'UPS'],
  Projetor: ['PRJ', 'PROJ'],
  Camera: ['CAM', 'CFTV'],
  Periferico: ['PER', 'ACC'],
  Outros: ['OTR', 'AST', 'PAT'],
};

/**
 * Decompõe qualquer tag patrimonial extraindo prefixo, número sequencial e sufixo.
 * Ex: 'SHL-BEL-NTB-045' -> { prefix: 'SHL-BEL-NTB-', sequence: 45, padLength: 3, suffix: '' }
 * Ex: 'NB-01'           -> { prefix: 'NB-', sequence: 1, padLength: 2, suffix: '' }
 * Ex: '001452'          -> { prefix: '', sequence: 1452, padLength: 6, suffix: '' }
 * Ex: 'PAT-009-A'       -> { prefix: 'PAT-', sequence: 9, padLength: 3, suffix: '-A' }
 */
export const parseTag = (tag) => {
  if (!tag || typeof tag !== 'string') return null;
  const clean = tag.trim().toUpperCase();
  // Busca o último bloco de dígitos contínuos na string
  const match = clean.match(/^(.*?)(\d+)([^0-9]*)$/);
  if (!match) return null;

  const [, prefix, numStr, suffix] = match;
  const sequence = parseInt(numStr, 10);
  if (!Number.isFinite(sequence)) return null;

  return {
    raw: clean,
    prefix,
    numStr,
    sequence,
    padLength: numStr.length,
    suffix: suffix || '',
  };
};

/**
 * Normaliza strings para comparações insensíveis a acentos e maiúsculas.
 */
const fold = (val) =>
  String(val || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

/**
 * Deriva uma sigla de 3 caracteres a partir do nome de uma localização ou filial.
 * Ex: "Matriz - Belém" -> "BEL", "Loja Castanhal" -> "CAS", "Matriz" -> "MTZ"
 */
export const locationCodeFor = (locationName) => {
  if (!locationName || typeof locationName !== 'string') return '';
  let text = locationName.trim();

  // Se contiver hífen/barra (ex: "Matriz - Belém" ou "PA - Castanhal")
  const parts = text.split(/[-–—/]/).map((p) => p.trim()).filter(Boolean);
  let target = parts.length > 1 ? parts[parts.length - 1] : parts[0];

  // Remove prefixos comuns de filiais ("Loja", "Filial", "Unidade", "CD", "Ponto")
  target = target.replace(/^(loja|filial|unidade|cd|deposito|fabrica|ponto\s+de\s+venda|pdv)\s+/i, '').trim();

  const letters = target
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

  if (!letters) return 'MTZ';
  if (letters.startsWith('MATRIZ') || letters.startsWith('SEDE')) return 'MTZ';
  return letters.slice(0, 3).padEnd(3, 'X');
};

/**
 * Descobre o código de tipo utilizado pela empresa para um tipo de ativo.
 * Se já existirem ativos desse tipo na empresa, analisa qual código (sigla) é mais usado.
 */
export const resolveTypeCode = (type, existingTagsForType = []) => {
  const defaults = TYPE_CODE_MAP[type] || [fold(type).slice(0, 3).toUpperCase() || 'AST'];
  
  if (!existingTagsForType.length) {
    return defaults[0];
  }

  // Verifica se alguma das siglas conhecidas aparece nas tags existentes
  const candidateScores = {};
  existingTagsForType.forEach((tag) => {
    const parsed = parseTag(tag);
    if (!parsed) return;
    const tokens = parsed.prefix.split(/[^A-Z0-9]+/).filter(Boolean);
    tokens.forEach((token) => {
      // Se o token bate com alguma sigla conhecida para este tipo
      if (defaults.includes(token)) {
        candidateScores[token] = (candidateScores[token] || 0) + 1;
      }
    });
  });

  const sortedCandidates = Object.entries(candidateScores).sort((a, b) => b[1] - a[1]);
  if (sortedCandidates.length > 0) {
    return sortedCandidates[0][0];
  }

  return defaults[0];
};

/**
 * Extrai o delimitador dominante em um prefixo (ex: '-' em 'SHL-BEL-NTB-').
 */
const detectDelimiter = (prefix) => {
  if (!prefix) return '-';
  const delims = ['-', '.', '_', '/', ' '];
  for (const d of delims) {
    if (prefix.includes(d)) return d;
  }
  return '-';
};

/**
 * Analisa a coleção de ativos existentes de um inquilino e gera a próxima tag
 * de patrimônio em estrita conformidade com o padrão adotado pela empresa.
 *
 * @param {Object} options
 * @param {Array<Object>} [options.existingAssets=[]] - Ativos já cadastrados no tenant.
 * @param {string} [options.targetType='Notebook']   - Tipo do ativo atual (ex: 'Computador', 'Notebook').
 * @param {string} [options.targetLocation='']       - Localização atual selecionada (opcional).
 * @param {Object} [options.tenantSettings={}]       - Configurações do tenant (agentNaming, etc.).
 * @param {string} [options.companyName='']          - Razão social ou nome fantasia da empresa.
 * @returns {Object} { tag, prefix, sequence, padLength, patternType, description }
 */
export const generateNextAssetTag = ({
  existingAssets = [],
  targetType = 'Computador',
  targetLocation = '',
  tenantSettings = {},
  companyName = '',
} = {}) => {
  const assets = Array.isArray(existingAssets) ? existingAssets : [];
  const takenTags = new Set(
    assets
      .map((a) => (typeof a?.internalId === 'string' ? a.internalId.trim().toUpperCase() : ''))
      .filter(Boolean)
  );

  const parsedAssets = assets
    .map((a) => ({
      ...a,
      parsed: parseTag(a.internalId),
    }))
    .filter((a) => a.parsed !== null);

  // ---------------------------------------------------------------------------
  // CASO 1: Existem ativos do MESMO TIPO já cadastrados na empresa
  // ---------------------------------------------------------------------------
  const sameTypeAssets = parsedAssets.filter((a) => fold(a.type) === fold(targetType));

  if (sameTypeAssets.length > 0) {
    // Se uma localização foi informada, verifica se há padrão específico para essa localização
    let candidateAssets = sameTypeAssets;
    if (targetLocation) {
      const locMatch = sameTypeAssets.filter(
        (a) => fold(a.location) === fold(targetLocation)
      );
      if (locMatch.length > 0) {
        candidateAssets = locMatch;
      }
    }

    // Agrupa por prefixo exato para encontrar o padrão mais representativo
    const prefixFrequencies = {};
    candidateAssets.forEach((a) => {
      const p = a.parsed.prefix;
      prefixFrequencies[p] = (prefixFrequencies[p] || 0) + 1;
    });

    const dominantPrefix = Object.entries(prefixFrequencies)
      .sort((a, b) => b[1] - a[1])[0][0];

    // Filtra ativos que usam o prefixo dominante
    const matchingAssets = sameTypeAssets.filter((a) => a.parsed.prefix === dominantPrefix);

    const maxSequence = matchingAssets.reduce((max, a) => Math.max(max, a.parsed.sequence), 0);
    // Usa a maior quantidade de dígitos de padding observada
    const padLength = matchingAssets.reduce((max, a) => Math.max(max, a.parsed.padLength), 3);
    const suffix = matchingAssets[0]?.parsed?.suffix || '';

    let nextSequence = maxSequence + 1;
    let candidateTag = `${dominantPrefix}${String(nextSequence).padStart(padLength, '0')}${suffix}`;

    // Garantia de unicidade: evita colisões caso já exista algum ativo com este número
    while (takenTags.has(candidateTag.toUpperCase())) {
      nextSequence += 1;
      candidateTag = `${dominantPrefix}${String(nextSequence).padStart(padLength, '0')}${suffix}`;
    }

    return {
      tag: candidateTag,
      prefix: dominantPrefix,
      sequence: nextSequence,
      padLength,
      patternType: 'exact_type_match',
      description: `Sequência continuada do padrão existente para ${targetType} (${dominantPrefix}...)`,
    };
  }

  // ---------------------------------------------------------------------------
  // CASO 2: A empresa NÃO possui ativos deste tipo, mas possui OUTROS tipos
  // ---------------------------------------------------------------------------
  if (parsedAssets.length > 0) {
    // 2.A: Verifica se a empresa adota um padrão UNIFICADO invariante ao tipo
    // Ex: todos os ativos são PAT-001, PAT-002, ou 000142 independente do tipo
    const allPrefixes = [...new Set(parsedAssets.map((a) => a.parsed.prefix))];
    if (allPrefixes.length === 1 && !allPrefixes[0].trim()) {
      // Padrão numérico puro sem prefixo (ex: 000100)
      const maxSeq = parsedAssets.reduce((max, a) => Math.max(max, a.parsed.sequence), 0);
      const padLength = parsedAssets.reduce((max, a) => Math.max(max, a.parsed.padLength), 4);
      let nextSeq = maxSeq + 1;
      let candidateTag = String(nextSeq).padStart(padLength, '0');
      while (takenTags.has(candidateTag)) {
        nextSeq += 1;
        candidateTag = String(nextSeq).padStart(padLength, '0');
      }
      return {
        tag: candidateTag,
        prefix: '',
        sequence: nextSeq,
        padLength,
        patternType: 'unified_pure_numeric',
        description: 'Sequência numérica contínua da empresa (sem prefixo)',
      };
    }

    if (allPrefixes.length === 1 && parsedAssets.length >= 2) {
      // Todos os ativos de tipos diferentes compartilham o mesmo prefixo (ex: PAT-, ATV-)
      const unifiedPrefix = allPrefixes[0];
      const maxSeq = parsedAssets.reduce((max, a) => Math.max(max, a.parsed.sequence), 0);
      const padLength = parsedAssets.reduce((max, a) => Math.max(max, a.parsed.padLength), 3);
      let nextSeq = maxSeq + 1;
      let candidateTag = `${unifiedPrefix}${String(nextSeq).padStart(padLength, '0')}`;
      while (takenTags.has(candidateTag.toUpperCase())) {
        nextSeq += 1;
        candidateTag = `${unifiedPrefix}${String(nextSeq).padStart(padLength, '0')}`;
      }
      return {
        tag: candidateTag,
        prefix: unifiedPrefix,
        sequence: nextSeq,
        padLength,
        patternType: 'unified_tenant_sequence',
        description: `Sequência unificada da empresa (${unifiedPrefix}...)`,
      };
    }

    // 2.B: A empresa usa padrão estruturado por tipo (ex: SHL-BEL-CPU-001 ou NB-001)
    // Extrai o modelo de máscara decompondo os prefixos existentes
    const sample = parsedAssets[0];
    const samplePrefix = sample.parsed.prefix;
    const delimiter = detectDelimiter(samplePrefix);
    const padLength = parsedAssets.reduce((max, a) => Math.max(max, a.parsed.padLength), 3);

    // Identifica tokens do prefixo
    const rawTokens = samplePrefix.split(delimiter).filter(Boolean);
    const targetTypeCode = resolveTypeCode(targetType);

    let adaptedPrefix = '';

    if (rawTokens.length >= 3) {
      // Estrutura tipo [EMPRESA]-[FILIAL]-[TIPO]- (ex: SHL-BEL-CPU-)
      const companyToken = rawTokens[0];
      const locCode = targetLocation
        ? locationCodeFor(targetLocation)
        : rawTokens[1];
      adaptedPrefix = `${companyToken}${delimiter}${locCode}${delimiter}${targetTypeCode}${delimiter}`;
    } else if (rawTokens.length === 2) {
      // Estrutura tipo [EMPRESA]-[TIPO]- (ex: SHL-NTB-)
      const companyToken = rawTokens[0];
      adaptedPrefix = `${companyToken}${delimiter}${targetTypeCode}${delimiter}`;
    } else if (rawTokens.length === 1) {
      // Estrutura tipo [TIPO]- (ex: PC-001 -> NB-001)
      adaptedPrefix = `${targetTypeCode}${delimiter}`;
    } else {
      adaptedPrefix = `${targetTypeCode}${delimiter}`;
    }

    let nextSeq = 1;
    let candidateTag = `${adaptedPrefix}${String(nextSeq).padStart(padLength, '0')}`;
    while (takenTags.has(candidateTag.toUpperCase())) {
      nextSeq += 1;
      candidateTag = `${adaptedPrefix}${String(nextSeq).padStart(padLength, '0')}`;
    }

    return {
      tag: candidateTag,
      prefix: adaptedPrefix,
      sequence: nextSeq,
      padLength,
      patternType: 'company_convention_adapted',
      description: `Padrão adaptado da empresa para novo tipo (${targetType} -> ${adaptedPrefix}...)`,
    };
  }

  // ---------------------------------------------------------------------------
  // CASO 3: Empresa NOVA sem nenhum ativo cadastrado (Fallback Inteligente)
  // ---------------------------------------------------------------------------
  const agentNaming = tenantSettings?.agentNaming || {};
  const companyPrefix =
    agentNaming.companyPrefix ||
    (companyName ? assetPrefixFor(companyName) : '');
  const locationCode =
    targetLocation
      ? locationCodeFor(targetLocation)
      : agentNaming.locationCode || '';
  const padLength = Number(agentNaming.padLength) || 3;
  const targetTypeCode = resolveTypeCode(targetType);

  let prefix = '';
  if (companyPrefix && locationCode) {
    prefix = `${companyPrefix}-${locationCode}-${targetTypeCode}-`;
  } else if (companyPrefix) {
    prefix = `${companyPrefix}-${targetTypeCode}-`;
  } else {
    prefix = `${targetTypeCode}-`;
  }

  const tag = `${prefix}${String(1).padStart(padLength, '0')}`;

  return {
    tag,
    prefix,
    sequence: 1,
    padLength,
    patternType: 'clean_fallback',
    description: `Padrão inicial corporativo (${prefix}...)`,
  };
};
