// src/services/termFileService.js
// -----------------------------------------------------------------------------
// Termo assinado (PDF ou foto). O plano Spark nao tem Cloud Storage, entao o
// arquivo vai para /termFiles em pedacos de ~900 KB. Os pedacos sao gravados
// na MESMA transacao que conclui o termo (termService): nunca sobra anexo
// orfao nem termo concluido sem o arquivo.
// -----------------------------------------------------------------------------
import { Bytes, collection, doc, getDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { joinChunks, SIGNED_COPY_MAX_BYTES, splitIntoChunks } from '../utils/terms';

const IMAGE_MAX_SIDE = 2200;
const IMAGE_KEEP_BYTES = 1.5 * 1024 * 1024;
// Formatos aceitos como estao (os demais viram JPEG; ver regras de termFiles).
const KEEP_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export const isPdfFile = (file) => file?.type === 'application/pdf' || /\.pdf$/i.test(file?.name || '');

const megabytes = (bytes) => (bytes / 1024 / 1024).toFixed(1).replace('.', ',');

/** Foto de celular costuma ter 4-8 MB: reduz para ~2200 px, ainda legivel. */
const compressImage = async (file) => {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= IMAGE_KEEP_BYTES && KEEP_TYPES.includes(file.type)) {
    bitmap.close?.();
    return file;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  if (!blob) throw new Error('compressao falhou');
  return blob;
};

/**
 * Le o arquivo escolhido e deixa pronto para gravar.
 * @returns {Promise<{bytes: Uint8Array, name: string, contentType: string, size: number}>}
 */
export const prepareSignedCopy = async (file) => {
  if (!file) throw new Error('Selecione o arquivo do termo assinado.');
  const pdf = isPdfFile(file);
  if (!pdf && !String(file.type).startsWith('image/')) {
    throw new Error(`${file.name}: envie um PDF ou uma foto (JPG, PNG).`);
  }
  let blob = file;
  if (!pdf) {
    try {
      blob = await compressImage(file);
    } catch {
      throw new Error(`${file.name}: não foi possível ler a imagem. Envie JPG, PNG ou PDF.`);
    }
  }
  if (blob.size > SIGNED_COPY_MAX_BYTES) {
    throw new Error(`${file.name} tem ${megabytes(blob.size)} MB; o limite é 5 MB. Digitalize em 150–200 dpi ou envie uma foto.`);
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const converted = blob !== file;
  return {
    bytes,
    name: converted ? `${file.name.replace(/\.[^.]+$/, '') || 'termo'}.jpg` : file.name || 'termo',
    contentType: pdf ? 'application/pdf' : blob.type || file.type,
    size: bytes.length,
  };
};

/**
 * Grava os pedacos dentro da transacao do termo e devolve os metadados que
 * vao no proprio termo (campo signedCopy).
 */
export const writeSignedCopy = (tx, { tenantId, termId, prepared, actor }) => {
  const fileId = doc(collection(db, 'termFiles')).id;
  const chunks = splitIntoChunks(prepared.bytes);
  chunks.forEach((chunk, index) => {
    tx.set(doc(db, 'termFiles', `${fileId}_${index}`), {
      tenantId,
      termId,
      fileId,
      index,
      total: chunks.length,
      name: prepared.name,
      contentType: prepared.contentType,
      size: prepared.size,
      data: Bytes.fromUint8Array(chunk),
      createdAt: serverTimestamp(),
      createdBy: actor.email,
    });
  });
  return {
    fileId,
    chunks: chunks.length,
    name: prepared.name,
    contentType: prepared.contentType,
    size: prepared.size,
    uploadedAt: serverTimestamp(),
    uploadedBy: actor.email,
    uploadedByName: actor.name,
  };
};

/** Remonta o arquivo assinado. */
export const loadSignedCopy = async (signedCopy) => {
  if (!signedCopy?.fileId) throw new Error('Este termo não tem arquivo assinado.');
  const parts = await Promise.all(
    Array.from({ length: signedCopy.chunks || 1 }, (_, index) => getDoc(doc(db, 'termFiles', `${signedCopy.fileId}_${index}`))),
  );
  if (parts.some((p) => !p.exists())) throw new Error('O arquivo assinado está incompleto. Anexe novamente.');
  const bytes = joinChunks(parts.map((p) => p.data().data.toUint8Array()));
  return new Blob([bytes], { type: signedCopy.contentType || 'application/octet-stream' });
};

/** Baixa o arquivo com o nome original. */
export const downloadBlob = (blob, name) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name || 'termo-assinado';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
};
