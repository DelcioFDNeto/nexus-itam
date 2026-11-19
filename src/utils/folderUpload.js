// src/utils/folderUpload.js
// =============================================================================
// Leitor Recursivo de Pastas Locais (Input webkitdirectory + Drag & Drop OS)
// Permite enviar árvores inteiras de diretórios sem precisar compactar em ZIP/RAR.
// =============================================================================

const IGNORED_OS_FILES = new Set(['desktop.ini', 'thumbs.db', '.ds_store']);

export function isIgnoredSystemFile(fileName) {
  const clean = String(fileName || '').trim().toLowerCase();
  return !clean || IGNORED_OS_FILES.has(clean) || clean.startsWith('._');
}

export function normalizeRelativePath(rawPath) {
  return String(rawPath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s && s !== '.' && s !== '..')
    .join('/');
}

export function sortFolderPathsByDepth(paths = []) {
  const all = new Set();
  for (const p of paths) {
    const clean = normalizeRelativePath(p);
    if (!clean) continue;
    const parts = clean.split('/');
    for (let i = 1; i <= parts.length; i += 1) {
      all.add(parts.slice(0, i).join('/'));
    }
  }
  return Array.from(all).sort((a, b) => {
    const diff = a.split('/').length - b.split('/').length;
    return diff !== 0 ? diff : a.localeCompare(b, 'pt-BR');
  });
}

/**
 * Converte FileList vinda de <input type="file" webkitdirectory multiple> ou
 * seleção simples de arquivos em árvore estruturada `{ files, folderPaths }`.
 */
export function collectFilesFromInputList(fileList) {
  const rawFiles = Array.from(fileList || []);
  const files = [];
  const folderSet = new Set();

  for (const file of rawFiles) {
    if (!file || isIgnoredSystemFile(file.name)) continue;
    const rawRel = file.webkitRelativePath || file.name;
    const rel = normalizeRelativePath(rawRel);
    if (!rel) continue;
    const parts = rel.split('/');
    const fileName = parts[parts.length - 1];
    if (isIgnoredSystemFile(fileName)) continue;
    const dirPath = parts.slice(0, -1).join('/');
    if (dirPath) folderSet.add(dirPath);
    files.push({
      file,
      relativePath: rel,
      dirPath,
      fileName,
    });
  }

  return {
    files,
    folderPaths: sortFolderPathsByDepth(Array.from(folderSet)),
  };
}

function readAllDirectoryEntries(dirReader) {
  return new Promise((resolve) => {
    const collected = [];
    const readChunk = () => {
      try {
        dirReader.readEntries(
          (batch) => {
            if (!batch || batch.length === 0) {
              resolve(collected);
            } else {
              collected.push(...batch);
              readChunk();
            }
          },
          () => resolve(collected),
        );
      } catch {
        resolve(collected);
      }
    };
    readChunk();
  });
}

function readEntryFile(fileEntry) {
  return new Promise((resolve) => {
    try {
      fileEntry.file(
        (f) => resolve(f),
        () => resolve(null),
      );
    } catch {
      resolve(null);
    }
  });
}

async function walkFileSystemEntry(entry, prefixPath, filesOut, foldersOut) {
  if (!entry) return;
  const cleanName = String(entry.name || '').trim();
  if (!cleanName || cleanName === '.' || cleanName === '..') return;

  const currentRel = prefixPath ? `${prefixPath}/${cleanName}` : cleanName;

  if (entry.isDirectory) {
    if (cleanName === '__MACOSX') return;
    foldersOut.add(currentRel);
    const reader = entry.createReader();
    const children = await readAllDirectoryEntries(reader);
    for (const child of children) {
      await walkFileSystemEntry(child, currentRel, filesOut, foldersOut);
    }
    return;
  }

  if (entry.isFile) {
    if (isIgnoredSystemFile(cleanName)) return;
    const file = await readEntryFile(entry);
    if (!file) return;
    const dirPath = normalizeRelativePath(prefixPath);
    if (dirPath) foldersOut.add(dirPath);
    filesOut.push({
      file,
      relativePath: normalizeRelativePath(currentRel),
      dirPath,
      fileName: cleanName,
    });
  }
}

/**
 * Extrai recursivamente arquivos E pastas inteiras arrastadas do Windows/macOS/Linux
 * via `DataTransferItem.webkitGetAsEntry()`, com fallback seguro para `dataTransfer.files`.
 */
export async function collectEntriesFromDataTransfer(dataTransfer) {
  const items = Array.from(dataTransfer?.items || []);
  const entries = items
    .map((item) => (typeof item?.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null))
    .filter(Boolean);

  if (entries.length > 0) {
    const filesOut = [];
    const foldersOut = new Set();
    for (const entry of entries) {
      await walkFileSystemEntry(entry, '', filesOut, foldersOut);
    }
    return {
      files: filesOut,
      folderPaths: sortFolderPathsByDepth(Array.from(foldersOut)),
      hasDirectories: entries.some((e) => Boolean(e.isDirectory)),
    };
  }

  const fallback = collectFilesFromInputList(dataTransfer?.files || []);
  return {
    ...fallback,
    hasDirectories: fallback.folderPaths.length > 0,
  };
}

/**
 * Executa o upload ordenado de uma árvore `{ files, folderPaths }` para a VPS,
 * criando/reaproveitando subpastas em ordem de profundidade e reportando progresso.
 */
export async function uploadFolderTreeToVault({
  files = [],
  folderPaths = [],
  targetParentId = null,
  existingNodes = [],
  createFolderFn,
  uploadFileFn,
  onProgress,
}) {
  const allDirs = sortFolderPathsByDepth([
    ...folderPaths,
    ...files.map((f) => f.dirPath).filter(Boolean),
  ]);

  // Pré-indexa pastas já existentes para economizar chamadas HTTP
  const folderIdMap = new Map();
  folderIdMap.set('', targetParentId || null);

  const findExistingChildFolder = (parentId, name) => {
    const normParent = parentId || null;
    const lowerName = String(name || '').toLowerCase();
    return (existingNodes || []).find((n) => {
      const isDir = (n?.nodeType || n?.node_type || n?.type) === 'folder';
      if (!isDir || n.isTrashed || n.is_trashed) return false;
      const pid = n.parentId ?? n.parent_id ?? null;
      return pid === normParent && String(n.name || '').toLowerCase() === lowerName;
    });
  };

  let foldersCreated = 0;
  const createdNodes = [];
  const errors = [];

  for (const relDir of allDirs) {
    const parts = relDir.split('/');
    const dirName = parts[parts.length - 1];
    const parentRel = parts.slice(0, -1).join('/');
    const parentId = folderIdMap.has(parentRel) ? folderIdMap.get(parentRel) : targetParentId || null;

    const cachedExisting = findExistingChildFolder(parentId, dirName);
    if (cachedExisting?.id) {
      folderIdMap.set(relDir, cachedExisting.id);
      continue;
    }

    onProgress?.({
      phase: 'folders',
      current: foldersCreated + 1,
      total: allDirs.length,
      currentName: relDir,
      filesDone: 0,
      filesTotal: files.length,
    });

    try {
      const res = await createFolderFn({ parentId, name: dirName, ensure: true });
      const created = res?.node || res?.folder || res;
      if (created?.id) {
        folderIdMap.set(relDir, created.id);
        if (!res?.existed) {
          foldersCreated += 1;
          createdNodes.push(created);
        }
      }
    } catch (err) {
      errors.push({ path: relDir, message: err?.message || 'Falha ao criar subpasta.' });
    }
  }

  let filesUploaded = 0;
  for (let i = 0; i < files.length; i += 1) {
    const item = files[i];
    const dirId = folderIdMap.has(item.dirPath || '')
      ? folderIdMap.get(item.dirPath || '')
      : targetParentId || null;

    onProgress?.({
      phase: 'files',
      current: i + 1,
      total: files.length,
      currentName: item.relativePath || item.fileName,
      filesDone: filesUploaded,
      filesTotal: files.length,
    });

    try {
      const res = await uploadFileFn(item.file, {
        parentId: dirId,
        fileName: item.fileName || item.file?.name,
        conflictPolicy: 'version',
      });
      const uploaded = res?.node || res?.file || res;
      if (uploaded?.id) {
        createdNodes.push(uploaded);
      }
      filesUploaded += 1;
    } catch (err) {
      errors.push({
        path: item.relativePath || item.fileName,
        message: err?.message || 'Erro no envio do arquivo.',
      });
    }
  }

  return {
    foldersCreated,
    filesUploaded,
    totalFiles: files.length,
    totalFolders: allDirs.length,
    createdNodes,
    errors,
  };
}
