// src/services/termScanService.js
// -----------------------------------------------------------------------------
// Le o QR impresso no cabecalho do termo a partir do arquivo digitalizado
// (foto ou PDF) para identificar sozinho de qual termo e cada anexo.
// pdf.js e o leitor de QR so sao carregados quando alguem anexa um arquivo.
// -----------------------------------------------------------------------------
import { isPdfFile } from './termFileService';

let pdfjsPromise = null;

/** pdf.js sob demanda (com o worker servido pelo proprio app — CSP 'self'). */
export const loadPdfjs = () => {
  pdfjsPromise ||= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(
    ([lib, worker]) => {
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    },
  );
  return pdfjsPromise;
};

/**
 * Renderiza paginas de um PDF em canvas.
 * @param {Uint8Array|ArrayBuffer} data
 * @param {{ pages?: 'all'|'edges', width?: number, maxPages?: number }} options
 *   'edges' = primeira e ultima pagina (onde o QR pode estar).
 */
export const renderPdfPages = async (data, { pages = 'all', width = 1400, maxPages = 20 } = {}) => {
  const pdfjs = await loadPdfjs();
  // O pdf.js transfere o buffer para o worker: manda uma copia.
  const source = data instanceof Uint8Array ? data.slice() : new Uint8Array(data).slice();
  const pdf = await pdfjs.getDocument({ data: source, isEvalSupported: false }).promise;
  try {
    const numbers =
      pages === 'edges'
        ? [...new Set([1, pdf.numPages])]
        : Array.from({ length: Math.min(pdf.numPages, maxPages) }, (_, i) => i + 1);
    const canvases = [];
    for (const number of numbers) {
      const page = await pdf.getPage(number);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: width / base.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const canvasContext = canvas.getContext('2d');
      canvasContext.fillStyle = '#fff';
      canvasContext.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext, viewport }).promise;
      canvases.push(canvas);
    }
    return { canvases, numPages: pdf.numPages };
  } finally {
    pdf.destroy();
  }
};

// --- leitor de QR (html5-qrcode ja e usado no scanner de etiquetas) ---------

let readerPromise = null;
let queue = Promise.resolve();

const getReader = () => {
  readerPromise ||= import('html5-qrcode').then(({ Html5Qrcode, Html5QrcodeSupportedFormats }) => {
    const host = document.createElement('div');
    host.id = 'nexus-term-qr-reader';
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:hidden;';
    document.body.appendChild(host);
    return new Html5Qrcode(host.id, {
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
      verbose: false,
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    });
  });
  return readerPromise;
};

/** Uma leitura por vez: a biblioteca nao aceita duas ao mesmo tempo. */
const scanImageFile = (file) => {
  const run = queue.then(async () => {
    const reader = await getReader();
    try {
      return await reader.scanFile(file, false);
    } catch {
      return null;
    } finally {
      try {
        reader.clear();
      } catch {
        /* nada para limpar */
      }
    }
  });
  queue = run.catch(() => null);
  return run;
};

const canvasToFile = (canvas) =>
  new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ? new File([blob], 'pagina.png', { type: 'image/png' }) : null), 'image/png');
  });

const crop = (source, x, y, width, height, scale = 1) => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, x, y, width, height, 0, 0, canvas.width, canvas.height);
  return canvas;
};

/**
 * Procura o QR primeiro no canto do cabecalho (onde o termo o imprime, ampliado
 * para ajudar digitalizacoes de baixa resolucao), depois no canto oposto (folha
 * de cabeca para baixo) e por fim na pagina inteira (fotos tortas).
 */
const decodeCanvas = async (canvas) => {
  const { width: w, height: h } = canvas;
  const attempts = [
    () => crop(canvas, w * 0.55, 0, w * 0.45, h * 0.2, 1.5),
    () => crop(canvas, 0, h * 0.8, w * 0.45, h * 0.2, 1.5),
    () => canvas,
  ];
  for (const attempt of attempts) {
    const file = await canvasToFile(attempt());
    const text = file ? await scanImageFile(file) : null;
    if (text) return text;
  }
  return null;
};

const imageToCanvas = async (file) => {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas;
};

/**
 * Texto do QR encontrado no arquivo, ou null (sem QR legivel, formato que o
 * navegador nao abre etc.). Nunca lanca erro: quem chama cai na escolha manual.
 */
export const readTermQr = async (file) => {
  try {
    if (isPdfFile(file)) {
      const { canvases } = await renderPdfPages(await file.arrayBuffer(), { pages: 'edges', width: 1700 });
      for (const canvas of canvases) {
        const text = await decodeCanvas(canvas);
        if (text) return text;
      }
      return null;
    }
    if (!String(file?.type).startsWith('image/')) return null;
    return await decodeCanvas(await imageToCanvas(file));
  } catch (error) {
    console.warn('Leitura do QR do termo falhou:', error);
    return null;
  }
};
