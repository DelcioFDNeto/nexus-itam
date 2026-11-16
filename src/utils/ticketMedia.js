// src/utils/ticketMedia.js
// =============================================================================
// Utilitários compartilhados de mídia, prints e atendimento em tempo real
// para abertura rápida e chat de chamados.
// =============================================================================

export const MAX_TICKET_ATTACHMENTS = 4;
export const MAX_ATTACHMENT_DATA_URL_LENGTH = 500_000;
export const MAX_RAW_IMAGE_BYTES = 12 * 1024 * 1024;

export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
]);

export const STAFF_ROLES = new Set(['owner', 'admin', 'manager', 'operator']);

/**
 * Retorna true para perfis da equipe técnica de TI (nunca confundir owner/admin com colaborador).
 */
export function isSupportStaffRole(role) {
  return STAFF_ROLES.has(String(role || '').toLowerCase().trim());
}

/**
 * Templates de abertura em 1 clique para agilizar o autoatendimento.
 */
export const TICKET_QUICK_TEMPLATES = [
  {
    id: 'vpn',
    label: 'VPN / Acesso',
    category: 'network',
    priority: 'high',
    title: 'Falha na conexão VPN corporativa',
    description: 'Não consigo conectar na VPN ou a sessão cai durante o expediente.',
  },
  {
    id: 'slow',
    label: 'PC Lento',
    category: 'hardware',
    priority: 'medium',
    title: 'Equipamento lento ou travando com frequência',
    description: 'O sistema operacional apresenta lentidão severa ou congelamentos nos aplicativos.',
  },
  {
    id: 'erp',
    label: 'Erro em Sistema',
    category: 'software',
    priority: 'high',
    title: 'Erro ao acessar sistema corporativo ou ERP',
    description: 'O aplicativo exibiu mensagem de falha ou bloqueio ao tentar executar minha rotina.',
  },
  {
    id: 'printer',
    label: 'Impressora / Periférico',
    category: 'hardware',
    priority: 'medium',
    title: 'Falha em impressora, monitor ou periférico',
    description: 'O dispositivo não responde ou apresenta falha de impressão/conexão na estação.',
  },
  {
    id: 'network',
    label: 'Sem Internet',
    category: 'network',
    priority: 'critical',
    title: 'Sem conexão com a internet ou rede interna',
    description: 'Estação offline no Wi-Fi ou cabo de rede, impedindo a continuidade do trabalho.',
  },
  {
    id: 'password',
    label: 'Senha / Bloqueio',
    category: 'access',
    priority: 'high',
    title: 'Conta bloqueada ou redefinição de senha',
    description: 'Preciso liberar meu acesso ou redefinir credencial bloqueada.',
  },
];

export function formatAttachmentBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function isSupportedRasterImage(file) {
  if (!file) return false;
  const mime = String(file.type || '').toLowerCase().trim();
  if (mime === 'image/svg+xml' || /\.svg$/i.test(file.name || '')) {
    return false;
  }
  if (mime && ALLOWED_IMAGE_MIME_TYPES.has(mime)) {
    return true;
  }
  return /\.(png|jpe?g|webp|gif)$/i.test(file.name || '');
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Falha ao ler arquivo de imagem selecionado.'));
    reader.readAsDataURL(file);
  });
}

function loadHtmlImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Não foi possível decodificar a imagem enviada.'));
    img.src = src;
  });
}

function encodeCanvasWithinBudget(source, width, height, { maxDimension, quality, maxDataUrlLength }) {
  const longestSide = Math.max(width || 1, height || 1);
  const baseScale = longestSide > maxDimension ? maxDimension / longestSide : 1;

  const attemptSteps = [
    { scale: baseScale, q: quality },
    { scale: baseScale, q: 0.68 },
    { scale: Math.min(baseScale, 0.72), q: 0.54 },
  ];

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  for (const step of attemptSteps) {
    const targetW = Math.max(1, Math.round(width * step.scale));
    const targetH = Math.max(1, Math.round(height * step.scale));
    canvas.width = targetW;
    canvas.height = targetH;
    // Evita fundo preto ao converter PNGs/prints com canal alfa para JPEG
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, targetW, targetH);
    ctx.drawImage(source, 0, 0, targetW, targetH);

    const dataUrl = canvas.toDataURL('image/jpeg', step.q);
    if (dataUrl && dataUrl.length <= maxDataUrlLength) {
      return {
        dataUrl,
        mimeType: 'image/jpeg',
        sizeBytes: Math.floor((dataUrl.length * 3) / 4),
      };
    }
  }

  return null;
}

/**
 * Converte e comprime fotos de celular ou prints Ctrl+V para PNG/JPG leves prontos para envio em tempo real.
 */
export async function compressImageFile(
  file,
  {
    maxDimension = 1440,
    quality = 0.82,
    maxDataUrlLength = MAX_ATTACHMENT_DATA_URL_LENGTH,
  } = {},
) {
  if (!isSupportedRasterImage(file)) {
    throw new Error('Formato não suportado. Envie imagens PNG, JPG, WEBP ou GIF.');
  }
  if (typeof file.size === 'number' && file.size > MAX_RAW_IMAGE_BYTES) {
    throw new Error('Imagem excede o limite bruto de 12 MB.');
  }

  const rawDataUrl = await readFileAsDataUrl(file);
  const rawMime = String(file.type || 'image/jpeg').toLowerCase();
  const baseName = String(file.name || 'evidencia.png').trim() || 'evidencia.png';

  // GIF pequeno pode manter animação intacta
  if (rawMime === 'image/gif' && rawDataUrl.length <= maxDataUrlLength) {
    return {
      id: `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: baseName.slice(0, 120),
      mimeType: 'image/gif',
      sizeBytes: Math.floor((rawDataUrl.length * 3) / 4),
      dataUrl: rawDataUrl,
    };
  }

  let encoded = null;
  try {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(file);
      try {
        encoded = encodeCanvasWithinBudget(bitmap, bitmap.width, bitmap.height, {
          maxDimension,
          quality,
          maxDataUrlLength,
        });
      } finally {
        bitmap.close?.();
      }
    } else if (typeof document !== 'undefined' && typeof Image !== 'undefined') {
      const img = await loadHtmlImage(rawDataUrl);
      encoded = encodeCanvasWithinBudget(
        img,
        img.naturalWidth || img.width,
        img.naturalHeight || img.height,
        { maxDimension, quality, maxDataUrlLength },
      );
    }
  } catch {
    // Fallback seguro quando o ambiente headless/teste não possui Canvas 2D
    encoded = null;
  }

  if (!encoded) {
    if (
      /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(rawDataUrl) &&
      rawDataUrl.length <= maxDataUrlLength
    ) {
      return {
        id: `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        name: baseName.slice(0, 120),
        mimeType: rawMime === 'image/jpg' ? 'image/jpeg' : rawMime,
        sizeBytes: Math.floor((rawDataUrl.length * 3) / 4),
        dataUrl: rawDataUrl,
      };
    }
    throw new Error('A imagem é muito grande mesmo após compressão. Recorte ou reduza a resolução.');
  }

  return {
    id: `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: `${baseName.replace(/\.[^.]+$/, '')}.jpg`.slice(0, 120),
    mimeType: encoded.mimeType,
    sizeBytes: encoded.sizeBytes,
    dataUrl: encoded.dataUrl,
  };
}

/**
 * Processa um lote de arquivos respeitando o máximo de anexos permitido.
 */
export async function processTicketImageFiles(
  fileList,
  existingAttachments = [],
  maxItems = MAX_TICKET_ATTACHMENTS,
) {
  const files = Array.from(fileList || []).filter(Boolean);
  const availableSlots = Math.max(0, maxItems - (existingAttachments?.length || 0));
  const added = [];
  const errors = [];

  if (files.length > 0 && availableSlots === 0) {
    errors.push(`Limite máximo de ${maxItems} fotos/prints por mensagem atingido.`);
    return { added, errors };
  }

  if (files.length > availableSlots) {
    errors.push(`Apenas as primeiras ${availableSlots} imagem(ns) foram adicionadas (limite de ${maxItems}).`);
  }

  for (const file of files.slice(0, availableSlots)) {
    try {
      const processed = await compressImageFile(file);
      added.push(processed);
    } catch (err) {
      errors.push(err?.message || `Falha ao processar ${file.name || 'imagem'}.`);
    }
  }

  return { added, errors };
}

/**
 * Extrai imagens coladas via Ctrl+V da área de transferência.
 */
export function extractClipboardImages(clipboardData) {
  const items = Array.from(clipboardData?.items || []);
  const images = [];
  for (const item of items) {
    if (item.kind === 'file' && String(item.type || '').toLowerCase().startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        if (!file.name || file.name === 'image.png') {
          try {
            images.push(
              new File([file], `print-${Date.now().toString(36)}.png`, {
                type: file.type || 'image/png',
              }),
            );
            continue;
          } catch {
            // Fallback se construtor File não estiver disponível
          }
        }
        images.push(file);
      }
    }
  }
  return images;
}
