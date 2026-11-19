// services/service-storage/src/services/archiveExtractor.js
// =============================================================================
// Motor Seguro de Descompactação em Memória (ZIP, RAR, TAR, TAR.GZ / TGZ)
// Proteções: Anti-Zip-Slip (Path Traversal), Anti-Zip-Bomb (RAM/Cota),
//            Bloqueio de Executáveis e Limpeza de Metadados de SO.
// =============================================================================

import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const MAX_EXTRACT_FILES = 500;
export const MAX_EXTRACT_SINGLE_FILE_BYTES = 100 * 1024 * 1024; // 100 MB
export const MAX_EXTRACT_TOTAL_BYTES = 250 * 1024 * 1024; // 250 MB

const BLOCKED_EXTENSIONS = new Set([
  '.exe',
  '.bat',
  '.cmd',
  '.msi',
  '.ps1',
  '.vbs',
  '.scr',
  '.com',
  '.pif',
]);

const SYSTEM_JUNK_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);

export function isSupportedArchiveName(fileName) {
  const lower = String(fileName || '').trim().toLowerCase();
  return (
    lower.endsWith('.zip') ||
    lower.endsWith('.rar') ||
    lower.endsWith('.tar') ||
    lower.endsWith('.tgz') ||
    lower.endsWith('.tar.gz')
  );
}

export function detectArchiveFormat(fileName, buffer = null) {
  const lower = String(fileName || '').trim().toLowerCase();
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'tar.gz';
  if (lower.endsWith('.tar')) return 'tar';
  if (lower.endsWith('.zip')) return 'zip';
  if (lower.endsWith('.rar')) return 'rar';

  if (Buffer.isBuffer(buffer) && buffer.length >= 7) {
    if (buffer[0] === 0x50 && buffer[1] === 0x4b && (buffer[2] === 0x03 || buffer[2] === 0x05)) {
      return 'zip';
    }
    if (
      buffer[0] === 0x52 &&
      buffer[1] === 0x61 &&
      buffer[2] === 0x72 &&
      buffer[3] === 0x21 &&
      buffer[4] === 0x1a &&
      buffer[5] === 0x07
    ) {
      return 'rar';
    }
    if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
      return 'tar.gz';
    }
  }
  return null;
}

export function stripArchiveExtension(fileName) {
  const raw = String(fileName || 'extraido').trim();
  const lower = raw.toLowerCase();
  if (lower.endsWith('.tar.gz')) return raw.slice(0, -7) || 'extraido';
  for (const ext of ['.zip', '.rar', '.tar', '.tgz']) {
    if (lower.endsWith(ext)) return raw.slice(0, -ext.length) || 'extraido';
  }
  return `${raw}_extraido`;
}

function makeArchiveError(code, message, statusCode = 400) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  return err;
}

/**
 * Sanitiza e valida um caminho relativo dentro de um arquivo compactado.
 * Bloqueia qualquer tentativa de Zip-Slip (.., caminhos absolutos, drive C:, null bytes).
 */
export function sanitizeArchiveEntryPath(rawPath, { isDirectory = false } = {}) {
  let str = String(rawPath || '').replace(/\\/g, '/').trim();
  if (!str) return { skip: true, reason: 'empty' };
  if (str.includes('\0')) {
    throw makeArchiveError('ARCHIVE_PATH_TRAVERSAL', 'Entrada inválida (null byte) detectada no arquivo compactado.');
  }

  // Remove prefixos ./ inofensivos comuns em arquivos TAR
  while (str.startsWith('./')) {
    str = str.slice(2);
  }
  if (isDirectory || str.endsWith('/')) {
    str = str.replace(/\/+$/, '');
  }
  if (!str) return { skip: true, reason: 'root_marker' };

  if (str.startsWith('/') || /^[a-zA-Z]:/.test(str)) {
    throw makeArchiveError(
      'ARCHIVE_PATH_TRAVERSAL',
      `Caminho absoluto bloqueado por segurança (Zip-Slip): ${rawPath}`,
    );
  }

  const segments = str.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) return { skip: true, reason: 'empty' };

  const cleanSegments = [];
  for (const seg of segments) {
    const trimmed = seg.trim();
    if (
      !trimmed ||
      trimmed === '.' ||
      trimmed === '..' ||
      /%2e%2e|%252e|%2f|%5c/i.test(trimmed)
    ) {
      throw makeArchiveError(
        'ARCHIVE_PATH_TRAVERSAL',
        `Tentativa de Path Traversal (Zip-Slip) bloqueada no arquivo compactado: ${rawPath}`,
      );
    }
    cleanSegments.push(trimmed);
  }

  // Ignora metadados de sistema operacional (__MACOSX, .DS_Store, Thumbs.db, ._*)
  if (
    cleanSegments.some((s) => s === '__MACOSX' || s.startsWith('._')) ||
    SYSTEM_JUNK_NAMES.has(cleanSegments[cleanSegments.length - 1].toLowerCase())
  ) {
    return { skip: true, reason: 'system_junk', relativePath: cleanSegments.join('/') };
  }

  const relativePath = cleanSegments.join('/');
  const fileName = cleanSegments[cleanSegments.length - 1];
  const dirPath = cleanSegments.slice(0, -1).join('/');

  return {
    skip: false,
    relativePath,
    dirPath,
    fileName,
    segments: cleanSegments,
  };
}

function isBlockedExecutable(fileName) {
  const ext = path.posix.extname(String(fileName || '')).toLowerCase();
  return BLOCKED_EXTENSIONS.has(ext);
}

// -----------------------------------------------------------------------------
// 1. Extrator ZIP nativo (PKZIP Store + Deflate via node:zlib)
// -----------------------------------------------------------------------------
function findZipEocdOffset(buf) {
  const minPos = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= minPos; i -= 1) {
    if (
      buf[i] === 0x50 &&
      buf[i + 1] === 0x4b &&
      buf[i + 2] === 0x05 &&
      buf[i + 3] === 0x06
    ) {
      const commentLen = buf.readUInt16LE(i + 20);
      if (i + 22 + commentLen === buf.length) {
        return i;
      }
    }
  }
  return -1;
}

function parseZip64Extra(extraBuf, needUncomp, needComp, needOffset) {
  let pos = 0;
  const out = {};
  while (pos + 4 <= extraBuf.length) {
    const headerId = extraBuf.readUInt16LE(pos);
    const dataSize = extraBuf.readUInt16LE(pos + 2);
    pos += 4;
    if (headerId === 0x0001 && pos + dataSize <= extraBuf.length) {
      let cur = pos;
      if (needUncomp && cur + 8 <= pos + dataSize) {
        out.uncompressedSize = Number(extraBuf.readBigUInt64LE(cur));
        cur += 8;
      }
      if (needComp && cur + 8 <= pos + dataSize) {
        out.compressedSize = Number(extraBuf.readBigUInt64LE(cur));
        cur += 8;
      }
      if (needOffset && cur + 8 <= pos + dataSize) {
        out.localHeaderOffset = Number(extraBuf.readBigUInt64LE(cur));
      }
      return out;
    }
    pos += dataSize;
  }
  return out;
}

function extractZipBuffer(buf, limits) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) {
    throw makeArchiveError('INVALID_ARCHIVE', 'Arquivo ZIP inválido ou corrompido.');
  }

  const eocdOffset = findZipEocdOffset(buf);
  if (eocdOffset < 0) {
    throw makeArchiveError('INVALID_ARCHIVE', 'Cabeçalho central do arquivo ZIP não encontrado (arquivo corrompido).');
  }

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const centralDirSize = buf.readUInt32LE(eocdOffset + 12);
  const centralDirOffset = buf.readUInt32LE(eocdOffset + 16);

  if (centralDirOffset + centralDirSize > buf.length) {
    throw makeArchiveError('INVALID_ARCHIVE', 'Estrutura interna do arquivo ZIP está truncada.');
  }

  const directories = new Set();
  const files = [];
  const skipped = [];
  const blockedExecutables = [];
  let totalBytes = 0;

  let ptr = centralDirOffset;
  let parsedEntries = 0;
  while (ptr + 46 <= centralDirOffset + centralDirSize && parsedEntries < totalEntries + 1024) {
    const sig = buf.readUInt32LE(ptr);
    if (sig !== 0x02014b50) break;
    parsedEntries += 1;

    const flags = buf.readUInt16LE(ptr + 8);
    const method = buf.readUInt16LE(ptr + 10);
    let compSize = buf.readUInt32LE(ptr + 20);
    let uncompSize = buf.readUInt32LE(ptr + 24);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const externalAttr = buf.readUInt32LE(ptr + 38);
    let localHeaderOffset = buf.readUInt32LE(ptr + 42);

    const nameStart = ptr + 46;
    const nameBuf = buf.subarray(nameStart, nameStart + nameLen);
    const extraBuf = buf.subarray(nameStart + nameLen, nameStart + nameLen + extraLen);
    ptr = nameStart + nameLen + extraLen + commentLen;

    const isUtf8 = (flags & 0x0800) !== 0;
    const rawName = nameBuf.toString(isUtf8 ? 'utf8' : 'latin1');

    if (compSize === 0xffffffff || uncompSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      const z64 = parseZip64Extra(
        extraBuf,
        uncompSize === 0xffffffff,
        compSize === 0xffffffff,
        localHeaderOffset === 0xffffffff,
      );
      if (z64.uncompressedSize !== undefined) uncompSize = z64.uncompressedSize;
      if (z64.compressedSize !== undefined) compSize = z64.compressedSize;
      if (z64.localHeaderOffset !== undefined) localHeaderOffset = z64.localHeaderOffset;
    }

    // Rejeita symlinks Unix (mode 0120000)
    const unixMode = (externalAttr >>> 16) & 0xf000;
    if (unixMode === 0xa000) {
      skipped.push(rawName);
      continue;
    }

    const isDir = rawName.endsWith('/') || rawName.endsWith('\\') || unixMode === 0x4000;
    const clean = sanitizeArchiveEntryPath(rawName, { isDirectory: isDir });
    if (clean.skip) {
      if (clean.relativePath) skipped.push(clean.relativePath);
      continue;
    }

    if (isDir) {
      directories.add(clean.relativePath);
      continue;
    }

    if ((flags & 0x0001) !== 0) {
      throw makeArchiveError(
        'ARCHIVE_PASSWORD_REQUIRED',
        'Este arquivo ZIP está protegido por senha. Remova a senha antes de descompactar na nuvem.',
        422,
      );
    }

    if (isBlockedExecutable(clean.fileName)) {
      blockedExecutables.push(clean.relativePath);
      continue;
    }

    if (files.length >= limits.maxFiles) {
      throw makeArchiveError(
        'ARCHIVE_LIMIT_EXCEEDED',
        `O arquivo compactado excede o limite de segurança de ${limits.maxFiles} arquivos por extração.`,
        413,
      );
    }

    if (uncompSize > limits.maxSingleFileBytes) {
      throw makeArchiveError(
        'ARCHIVE_LIMIT_EXCEEDED',
        `O item "${clean.fileName}" excede o tamanho máximo permitido por arquivo (${Math.round(limits.maxSingleFileBytes / (1024 * 1024))} MB).`,
        413,
      );
    }

    const remainingBudget = limits.maxTotalBytes - totalBytes;
    if (uncompSize > remainingBudget || remainingBudget <= 0) {
      throw makeArchiveError(
        'ARCHIVE_LIMIT_EXCEEDED',
        `Tamanho total descomprimido excede o limite de segurança (${Math.round(limits.maxTotalBytes / (1024 * 1024))} MB).`,
        413,
      );
    }

    if (localHeaderOffset + 30 > buf.length || buf.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw makeArchiveError('INVALID_ARCHIVE', `Cabeçalho local corrompido para "${clean.fileName}".`);
    }

    const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compSize;
    if (dataEnd > buf.length) {
      throw makeArchiveError('INVALID_ARCHIVE', `Dados compactados truncados para "${clean.fileName}".`);
    }

    const compressedSlice = buf.subarray(dataStart, dataEnd);
    let outputBuffer;

    if (method === 0) {
      outputBuffer = Buffer.from(compressedSlice);
    } else if (method === 8) {
      try {
        outputBuffer = zlib.inflateRawSync(compressedSlice, {
          maxOutputLength: Math.min(limits.maxSingleFileBytes, remainingBudget),
        });
      } catch (err) {
        if (err?.code === 'ERR_BUFFER_TOO_LARGE') {
          throw makeArchiveError(
            'ARCHIVE_LIMIT_EXCEEDED',
            'Arquivo compactado bloqueado por segurança (taxa de compressão/tamanho excede o limite anti-Zip-Bomb).',
            413,
          );
        }
        throw makeArchiveError(
          'INVALID_ARCHIVE',
          `Falha ao descompactar "${clean.fileName}": ${err?.message || 'dados inválidos'}.`,
        );
      }
    } else {
      throw makeArchiveError(
        'UNSUPPORTED_COMPRESSION_METHOD',
        `Método de compressão ZIP (${method}) não suportado para "${clean.fileName}". Utilize ZIP padrão (Store/Deflate).`,
        422,
      );
    }

    if (outputBuffer.length > limits.maxSingleFileBytes || totalBytes + outputBuffer.length > limits.maxTotalBytes) {
      throw makeArchiveError(
        'ARCHIVE_LIMIT_EXCEEDED',
        'Limite máximo de tamanho descomprimido excedido (proteção anti-Zip-Bomb).',
        413,
      );
    }

    totalBytes += outputBuffer.length;
    if (clean.dirPath) directories.add(clean.dirPath);
    files.push({
      relativePath: clean.relativePath,
      dirPath: clean.dirPath,
      fileName: clean.fileName,
      buffer: outputBuffer,
    });
  }

  return {
    directories: collectAllAncestorDirs(directories),
    files,
    skipped,
    blockedExecutables,
    totalBytes,
  };
}

// -----------------------------------------------------------------------------
// 2. Extrator TAR / TAR.GZ (POSIX USTAR + GNU LongName + PAX)
// -----------------------------------------------------------------------------
function readTarString(buf, start, length) {
  const slice = buf.subarray(start, start + length);
  const nullIdx = slice.indexOf(0);
  return (nullIdx >= 0 ? slice.subarray(0, nullIdx) : slice).toString('utf8');
}

function readTarOctal(buf, start, length) {
  const raw = readTarString(buf, start, length).trim();
  if (!raw) return 0;
  return parseInt(raw, 8) || 0;
}

function parsePaxPath(paxBuf) {
  const text = paxBuf.toString('utf8');
  let pos = 0;
  while (pos < text.length) {
    const spaceIdx = text.indexOf(' ', pos);
    if (spaceIdx < 0) break;
    const len = parseInt(text.slice(pos, spaceIdx), 10);
    if (!Number.isFinite(len) || len <= 0) break;
    const record = text.slice(spaceIdx + 1, pos + len).replace(/\n$/, '');
    if (record.startsWith('path=')) {
      return record.slice(5);
    }
    pos += len;
  }
  return null;
}

function extractTarBuffer(tarBuf, limits) {
  const directories = new Set();
  const files = [];
  const skipped = [];
  const blockedExecutables = [];
  let totalBytes = 0;

  let offset = 0;
  let pendingLongName = null;
  let pendingPaxPath = null;

  while (offset + 512 <= tarBuf.length) {
    const header = tarBuf.subarray(offset, offset + 512);
    // Dois blocos zerados indicam fim do arquivo TAR
    let allZero = true;
    for (let i = 0; i < 512; i += 1) {
      if (header[i] !== 0) {
        allZero = false;
        break;
      }
    }
    if (allZero) break;

    const nameField = readTarString(header, 0, 100);
    const size = readTarOctal(header, 124, 12);
    const typeFlag = String.fromCharCode(header[156] || 48);
    const prefixField = readTarString(header, 345, 155);

    const dataStart = offset + 512;
    const paddedSize = Math.ceil(size / 512) * 512;
    if (dataStart + size > tarBuf.length) {
      throw makeArchiveError('INVALID_ARCHIVE', 'Arquivo TAR truncado ou corrompido.');
    }
    const contentBuf = tarBuf.subarray(dataStart, dataStart + size);
    offset = dataStart + paddedSize;

    if (typeFlag === 'L') {
      pendingLongName = contentBuf.toString('utf8').replace(/\0+$/, '');
      continue;
    }
    if (typeFlag === 'x') {
      pendingPaxPath = parsePaxPath(contentBuf);
      continue;
    }
    if (typeFlag === 'g') {
      continue;
    }

    const rawName =
      pendingPaxPath ||
      pendingLongName ||
      (prefixField ? `${prefixField}/${nameField}` : nameField);
    pendingLongName = null;
    pendingPaxPath = null;

    // Ignora symlinks / hardlinks / devices por segurança
    if (typeFlag === '1' || typeFlag === '2' || typeFlag === '3' || typeFlag === '4' || typeFlag === '6') {
      skipped.push(rawName);
      continue;
    }

    const isDir = typeFlag === '5' || rawName.endsWith('/');
    const clean = sanitizeArchiveEntryPath(rawName, { isDirectory: isDir });
    if (clean.skip) {
      if (clean.relativePath) skipped.push(clean.relativePath);
      continue;
    }

    if (isDir) {
      directories.add(clean.relativePath);
      continue;
    }

    if (typeFlag !== '0' && typeFlag !== '\0') {
      continue;
    }

    if (isBlockedExecutable(clean.fileName)) {
      blockedExecutables.push(clean.relativePath);
      continue;
    }

    if (files.length >= limits.maxFiles) {
      throw makeArchiveError(
        'ARCHIVE_LIMIT_EXCEEDED',
        `O arquivo compactado excede o limite de segurança de ${limits.maxFiles} arquivos por extração.`,
        413,
      );
    }

    if (size > limits.maxSingleFileBytes || totalBytes + size > limits.maxTotalBytes) {
      throw makeArchiveError(
        'ARCHIVE_LIMIT_EXCEEDED',
        'Limite máximo de tamanho descomprimido excedido (proteção anti-Zip-Bomb).',
        413,
      );
    }

    totalBytes += size;
    if (clean.dirPath) directories.add(clean.dirPath);
    files.push({
      relativePath: clean.relativePath,
      dirPath: clean.dirPath,
      fileName: clean.fileName,
      buffer: Buffer.from(contentBuf),
    });
  }

  return {
    directories: collectAllAncestorDirs(directories),
    files,
    skipped,
    blockedExecutables,
    totalBytes,
  };
}

// -----------------------------------------------------------------------------
// 3. Extrator RAR (RAR4 & RAR5 via node-unrar-js WASM)
// -----------------------------------------------------------------------------
async function extractRarBuffer(buf, limits, { password } = {}) {
  const { createExtractorFromData } = require('node-unrar-js');
  const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

  let extractor;
  try {
    extractor = await createExtractorFromData({
      data: arrayBuf,
      ...(password ? { password: String(password) } : {}),
    });
  } catch (err) {
    throw makeArchiveError(
      'INVALID_ARCHIVE',
      `Arquivo RAR inválido ou não suportado: ${err?.message || 'erro ao abrir'}.`,
    );
  }

  let headers = [];
  try {
    const list = extractor.getFileList();
    if (list.arcHeader?.flags?.headerEncrypted && !password) {
      throw makeArchiveError(
        'ARCHIVE_PASSWORD_REQUIRED',
        'Este arquivo RAR está protegido por senha. Informe a senha para descompactar.',
        422,
      );
    }
    headers = [...list.fileHeaders];
  } catch (err) {
    if (err?.code === 'ARCHIVE_PASSWORD_REQUIRED') throw err;
    const reason = String(err?.reason || err?.message || '');
    if (/PASSWORD/i.test(reason)) {
      throw makeArchiveError(
        'ARCHIVE_PASSWORD_REQUIRED',
        'Senha obrigatória ou incorreta para descompactar este arquivo RAR.',
        422,
      );
    }
    throw makeArchiveError('INVALID_ARCHIVE', `Falha ao ler índice do arquivo RAR: ${err?.message || reason}.`);
  }

  // Pré-validação de limites anti-Zip-Bomb e Zip-Slip antes de alocar extração
  let predictedFiles = 0;
  let predictedBytes = 0;
  const filesToExtract = [];
  const directories = new Set();
  const skipped = [];
  const blockedExecutables = [];

  for (const h of headers) {
    if (h.flags?.encrypted && !password) {
      throw makeArchiveError(
        'ARCHIVE_PASSWORD_REQUIRED',
        'Este arquivo RAR contém itens protegidos por senha. Informe a senha para descompactar.',
        422,
      );
    }
    const clean = sanitizeArchiveEntryPath(h.name, { isDirectory: Boolean(h.flags?.directory) });
    if (clean.skip) {
      if (clean.relativePath) skipped.push(clean.relativePath);
      continue;
    }
    if (h.flags?.directory) {
      directories.add(clean.relativePath);
      continue;
    }
    if (isBlockedExecutable(clean.fileName)) {
      blockedExecutables.push(clean.relativePath);
      continue;
    }
    predictedFiles += 1;
    if (predictedFiles > limits.maxFiles) {
      throw makeArchiveError(
        'ARCHIVE_LIMIT_EXCEEDED',
        `O arquivo RAR excede o limite de segurança de ${limits.maxFiles} arquivos por extração.`,
        413,
      );
    }
    const unpSize = Number(h.unpSize || 0);
    if (unpSize > limits.maxSingleFileBytes || predictedBytes + unpSize > limits.maxTotalBytes) {
      throw makeArchiveError(
        'ARCHIVE_LIMIT_EXCEEDED',
        'Tamanho descomprimido do arquivo RAR excede o limite de segurança (proteção anti-Zip-Bomb).',
        413,
      );
    }
    predictedBytes += unpSize;
    filesToExtract.push(h.name);
  }

  const files = [];
  let totalBytes = 0;

  if (filesToExtract.length > 0) {
    try {
      const extracted = extractor.extract({
        files: filesToExtract,
        ...(password ? { password: String(password) } : {}),
      });
      for (const item of extracted.files) {
        if (item.fileHeader?.flags?.directory) continue;
        const clean = sanitizeArchiveEntryPath(item.fileHeader.name, { isDirectory: false });
        if (clean.skip) continue;
        const outBuf = item.extraction ? Buffer.from(item.extraction) : Buffer.alloc(0);
        if (outBuf.length > limits.maxSingleFileBytes || totalBytes + outBuf.length > limits.maxTotalBytes) {
          throw makeArchiveError(
            'ARCHIVE_LIMIT_EXCEEDED',
            'Limite máximo de tamanho descomprimido excedido.',
            413,
          );
        }
        totalBytes += outBuf.length;
        if (clean.dirPath) directories.add(clean.dirPath);
        files.push({
          relativePath: clean.relativePath,
          dirPath: clean.dirPath,
          fileName: clean.fileName,
          buffer: outBuf,
        });
      }
    } catch (err) {
      if (err?.code) throw err;
      const reason = String(err?.reason || err?.message || '');
      if (/PASSWORD/i.test(reason)) {
        throw makeArchiveError(
          'ARCHIVE_PASSWORD_REQUIRED',
          'Senha obrigatória ou incorreta para descompactar este arquivo RAR.',
          422,
        );
      }
      throw makeArchiveError('INVALID_ARCHIVE', `Falha ao extrair arquivo RAR: ${err?.message || reason}.`);
    }
  }

  return {
    directories: collectAllAncestorDirs(directories),
    files,
    skipped,
    blockedExecutables,
    totalBytes,
  };
}

function collectAllAncestorDirs(dirSet) {
  const all = new Set();
  for (const dir of dirSet) {
    const parts = String(dir || '').split('/').filter(Boolean);
    for (let i = 1; i <= parts.length; i += 1) {
      all.add(parts.slice(0, i).join('/'));
    }
  }
  return Array.from(all).sort((a, b) => {
    const depthDiff = a.split('/').length - b.split('/').length;
    return depthDiff !== 0 ? depthDiff : a.localeCompare(b);
  });
}

/**
 * Extrai com segurança um buffer ZIP, RAR, TAR ou TAR.GZ/TGZ em memória.
 */
export async function extractArchiveBuffer(buffer, fileName, options = {}) {
  const limits = {
    maxFiles: Number(options.maxFiles || MAX_EXTRACT_FILES),
    maxSingleFileBytes: Number(options.maxSingleFileBytes || MAX_EXTRACT_SINGLE_FILE_BYTES),
    maxTotalBytes: Number(options.maxTotalBytes || MAX_EXTRACT_TOTAL_BYTES),
  };

  const format = detectArchiveFormat(fileName, buffer);
  if (!format) {
    throw makeArchiveError(
      'UNSUPPORTED_ARCHIVE_FORMAT',
      'Formato não suportado para descompactação. Utilize arquivos .zip, .rar, .tar ou .tar.gz/.tgz.',
      415,
    );
  }

  if (format === 'zip') {
    return { format, ...extractZipBuffer(buffer, limits) };
  }
  if (format === 'tar') {
    return { format, ...extractTarBuffer(buffer, limits) };
  }
  if (format === 'tar.gz') {
    let gunzipped;
    try {
      gunzipped = zlib.gunzipSync(buffer, { maxOutputLength: limits.maxTotalBytes + 2 * 1024 * 1024 });
    } catch (err) {
      if (err?.code === 'ERR_BUFFER_TOO_LARGE') {
        throw makeArchiveError(
          'ARCHIVE_LIMIT_EXCEEDED',
          'Arquivo .tar.gz excede o limite de segurança ao descompactar (proteção anti-Zip-Bomb).',
          413,
        );
      }
      throw makeArchiveError('INVALID_ARCHIVE', `Arquivo .tar.gz corrompido: ${err?.message || 'erro gzip'}.`);
    }
    return { format, ...extractTarBuffer(gunzipped, limits) };
  }
  if (format === 'rar') {
    return { format, ...(await extractRarBuffer(buffer, limits, { password: options.password })) };
  }

  throw makeArchiveError('UNSUPPORTED_ARCHIVE_FORMAT', 'Formato compactado não suportado.', 415);
}
