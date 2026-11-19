import { describe, expect, it, vi } from 'vitest';
import {
  collectEntriesFromDataTransfer,
  collectFilesFromInputList,
  sortFolderPathsByDepth,
  uploadFolderTreeToVault,
} from './folderUpload';

function makeFileWithRelPath(name, relPath, content = 'dados') {
  const file = new File([content], name, { type: 'text/plain' });
  Object.defineProperty(file, 'webkitRelativePath', { value: relPath, configurable: true });
  return file;
}

describe('folderUpload (Upload Recursivo de Pastas Inteiras)', () => {
  it('coleta arquivos de input webkitdirectory, ignora lixo do sistema e ordena subpastas por profundidade', () => {
    const f1 = makeFileWithRelPath('contrato.pdf', 'Clientes/2026/Q1/contrato.pdf');
    const f2 = makeFileWithRelPath('resumo.txt', 'Clientes/resumo.txt');
    const junk1 = makeFileWithRelPath('Thumbs.db', 'Clientes/Thumbs.db');
    const junk2 = makeFileWithRelPath('.DS_Store', 'Clientes/2026/.DS_Store');

    const collected = collectFilesFromInputList([f1, f2, junk1, junk2]);

    expect(collected.files).toHaveLength(2);
    expect(collected.folderPaths).toEqual(['Clientes', 'Clientes/2026', 'Clientes/2026/Q1']);
    expect(collected.files[0].dirPath).toBe('Clientes/2026/Q1');
    expect(collected.files[1].dirPath).toBe('Clientes');
  });

  it('percorre recursivamente arvores de diretorios arrastadas via webkitGetAsEntry (incluindo pastas vazias)', async () => {
    const fileA = new File(['abc'], 'planilha.xlsx');
    const emptySubDir = {
      name: 'Vazia',
      isDirectory: true,
      isFile: false,
      createReader: () => {
        let called = false;
        return {
          readEntries: (cb) => {
            if (!called) {
              called = true;
              cb([]);
            }
          },
        };
      },
    };
    const fileEntryA = {
      name: 'planilha.xlsx',
      isDirectory: false,
      isFile: true,
      file: (cb) => cb(fileA),
    };
    const junkEntry = {
      name: 'desktop.ini',
      isDirectory: false,
      isFile: true,
      file: (cb) => cb(new File(['junk'], 'desktop.ini')),
    };
    const rootDirEntry = {
      name: 'ProjetoX',
      isDirectory: true,
      isFile: false,
      createReader: () => {
        let batchIdx = 0;
        const batches = [[fileEntryA, junkEntry], [emptySubDir], []];
        return {
          readEntries: (cb) => {
            const current = batches[batchIdx] || [];
            batchIdx += 1;
            cb(current);
          },
        };
      },
    };

    const collected = await collectEntriesFromDataTransfer({
      items: [{ webkitGetAsEntry: () => rootDirEntry }],
      files: [],
    });

    expect(collected.hasDirectories).toBe(true);
    expect(collected.folderPaths).toEqual(['ProjetoX', 'ProjetoX/Vazia']);
    expect(collected.files).toHaveLength(1);
    expect(collected.files[0].relativePath).toBe('ProjetoX/planilha.xlsx');
  });

  it('reaproveita pastas existentes, cria subpastas faltantes em ordem com ensure:true e envia arquivos com progresso', async () => {
    let seq = 1;
    const createFolderFn = vi.fn().mockImplementation(async ({ parentId, name }) => {
      const id = `dir-new-${seq++}`;
      return { node: { id, parentId, name, type: 'folder' }, existed: false };
    });
    const uploadFileFn = vi.fn().mockImplementation(async (file, { parentId, fileName }) => ({
      node: { id: `file-${fileName}`, parentId, name: fileName, type: 'file' },
    }));
    const onProgress = vi.fn();

    const f1 = makeFileWithRelPath('a.txt', 'Projeto/Docs/a.txt');
    const f2 = makeFileWithRelPath('b.txt', 'Projeto/b.txt');
    const collected = collectFilesFromInputList([f1, f2]);

    const summary = await uploadFolderTreeToVault({
      files: collected.files,
      folderPaths: collected.folderPaths,
      targetParentId: 'root-setor',
      existingNodes: [
        { id: 'existing-projeto', parentId: 'root-setor', name: 'Projeto', type: 'folder', isTrashed: false },
      ],
      createFolderFn,
      uploadFileFn,
      onProgress,
    });

    // 'Projeto' was reused, only 'Docs' was created under 'existing-projeto'
    expect(createFolderFn).toHaveBeenCalledTimes(1);
    expect(createFolderFn).toHaveBeenCalledWith({
      parentId: 'existing-projeto',
      name: 'Docs',
      ensure: true,
    });

    expect(uploadFileFn).toHaveBeenCalledTimes(2);
    expect(uploadFileFn).toHaveBeenCalledWith(
      f1,
      expect.objectContaining({ parentId: 'dir-new-1', fileName: 'a.txt' }),
    );
    expect(uploadFileFn).toHaveBeenCalledWith(
      f2,
      expect.objectContaining({ parentId: 'existing-projeto', fileName: 'b.txt' }),
    );
    expect(summary.foldersCreated).toBe(1);
    expect(summary.filesUploaded).toBe(2);
    expect(summary.errors).toEqual([]);
    expect(onProgress).toHaveBeenCalled();
    expect(sortFolderPathsByDepth(['a/b/c', 'a'])).toEqual(['a', 'a/b', 'a/b/c']);
  });
});
