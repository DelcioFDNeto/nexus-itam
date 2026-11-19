import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import WindowsFileExplorer from './WindowsFileExplorer';

const SAMPLE_NODES = [
  {
    id: 'f-setores',
    parentId: null,
    name: 'Setores',
    type: 'folder',
    virtualPath: '/Setores',
    effectiveAccess: 'full_control',
    updatedAt: '2026-11-18T10:00:00Z',
  },
  {
    id: 'f-fin',
    parentId: 'f-setores',
    name: 'Financeiro',
    type: 'folder',
    virtualPath: '/Setores/Financeiro',
    effectiveAccess: 'full_control',
    updatedAt: '2026-11-18T10:05:00Z',
  },
  {
    id: 'doc-1',
    parentId: null,
    name: 'Manual-TI.pdf',
    type: 'file',
    mimeType: 'application/pdf',
    sizeBytes: 20480,
    virtualPath: '/Manual-TI.pdf',
    effectiveAccess: 'full_control',
    updatedAt: '2026-11-18T11:00:00Z',
  },
  {
    id: 'doc-readonly',
    parentId: null,
    name: 'Politica-Interna.pdf',
    type: 'file',
    mimeType: 'application/pdf',
    sizeBytes: 8192,
    virtualPath: '/Politica-Interna.pdf',
    effectiveAccess: 'viewer_online',
    updatedAt: '2026-11-18T11:30:00Z',
  },
];

function StatefulHarness(props) {
  const [folderId, setFolderId] = useState(null);
  const [selected, setSelected] = useState([]);
  const [search, setSearch] = useState('');
  return (
    <WindowsFileExplorer
      nodes={SAMPLE_NODES}
      canWrite
      canManageAcl
      currentFolderId={folderId}
      onChangeFolder={setFolderId}
      selectedNodeIds={selected}
      onChangeSelectedIds={setSelected}
      searchQuery={search}
      onChangeSearch={setSearch}
      {...props}
    />
  );
}

describe('WindowsFileExplorer (UX Estilo Windows Nativo)', () => {
  it('navega por duplo clique, breadcrumbs, Voltar e Subir mantendo apenas itens do nivel atual', () => {
    render(<StatefulHarness />);

    // Na raiz mostra Setores e os 2 arquivos raiz, sem vazar Financeiro (subpasta)
    expect(screen.getByText('Setores')).toBeInTheDocument();
    expect(screen.getByText('Manual-TI.pdf')).toBeInTheDocument();
    expect(screen.queryByText('Financeiro')).toBeNull();

    // Duplo clique na pasta Setores entra nela
    fireEvent.doubleClick(screen.getByTestId('vfs-node-Setores'));
    expect(screen.getByText('Financeiro')).toBeInTheDocument();
    expect(screen.queryByText('Manual-TI.pdf')).toBeNull();

    // Botao Voltar retorna para a raiz
    fireEvent.click(screen.getByRole('button', { name: 'Voltar pasta anterior' }));
    expect(screen.getByText('Manual-TI.pdf')).toBeInTheDocument();
  });

  it('cria pasta inline, renomeia via F2 e executa Ctrl+X / Ctrl+V entre pastas', async () => {
    const onCreateFolder = vi.fn().mockResolvedValue(true);
    const onRenameNode = vi.fn().mockResolvedValue(true);
    const onMoveNode = vi.fn().mockResolvedValue(true);

    render(
      <StatefulHarness
        onCreateFolder={onCreateFolder}
        onRenameNode={onRenameNode}
        onMoveNode={onMoveNode}
      />,
    );

    // Nova pasta inline
    fireEvent.click(screen.getByRole('button', { name: /Nova Pasta/i }));
    const folderInput = screen.getByLabelText('Nome da nova pasta');
    fireEvent.change(folderInput, { target: { value: 'Contratos-2026' } });
    fireEvent.submit(folderInput.closest('form'));
    await waitFor(() => {
      expect(onCreateFolder).toHaveBeenCalledWith('Contratos-2026', null);
    });

    // Seleciona Manual-TI.pdf e pressiona F2 para renomear inline
    const explorer = screen.getByLabelText('Explorador de Arquivos Windows Nexus Vault');
    fireEvent.click(screen.getByTestId('vfs-node-Manual-TI.pdf'));
    fireEvent.keyDown(explorer, { key: 'F2' });

    const renameInput = await screen.findByLabelText('Novo nome do item');
    fireEvent.change(renameInput, { target: { value: 'Manual-TI-v2.pdf' } });
    fireEvent.keyDown(renameInput, { key: 'Enter' });
    await waitFor(() => {
      expect(onRenameNode).toHaveBeenCalledWith(expect.objectContaining({ id: 'doc-1' }), 'Manual-TI-v2.pdf');
    });

    // Recortar (Ctrl+X) e Colar (Ctrl+V) dentro da pasta Setores
    fireEvent.keyDown(explorer, { key: 'x', ctrlKey: true });
    fireEvent.doubleClick(screen.getByTestId('vfs-node-Setores'));
    fireEvent.keyDown(explorer, { key: 'v', ctrlKey: true });
    await waitFor(() => {
      expect(onMoveNode).toHaveBeenCalledWith(expect.objectContaining({ id: 'doc-1' }), 'f-setores');
    });
  });

  it('exibe menu de contexto com botao direito, suprime download em viewer_online e alterna para Icones Grandes', () => {
    render(<StatefulHarness />);

    // Clique direito em arquivo viewer_online nao pode exibir Baixar
    fireEvent.contextMenu(screen.getByTestId('vfs-node-Politica-Interna.pdf'), { clientX: 200, clientY: 200 });
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /^Baixar$/i })).toBeNull();
    expect(screen.getByRole('menuitem', { name: /Visualizar/i })).toBeInTheDocument();

    // Alterna para visualizacao Icones Grandes (Grade)
    fireEvent.click(screen.getByRole('button', { name: 'Visualização Ícones Grandes' }));
    expect(screen.getByTestId('vfs-node-Setores')).toBeInTheDocument();
    expect(screen.getByTestId('vfs-node-Manual-TI.pdf')).toBeInTheDocument();
  });

  it('lista links temporarios ativos no modal de compartilhamento e permite excluir o link', async () => {
    const onLoadShareLinks = vi.fn().mockResolvedValue([]);
    const onRevokeShareLink = vi.fn().mockResolvedValue(true);
    const activeLinks = [
      {
        id: 'lnk-1',
        nodeId: 'doc-1',
        nodeName: 'Manual-TI.pdf',
        expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
        allowDownload: true,
        accessCount: 2,
        status: 'active',
      },
    ];

    render(
      <StatefulHarness
        shareLinks={activeLinks}
        onLoadShareLinks={onLoadShareLinks}
        onRevokeShareLink={onRevokeShareLink}
      />,
    );

    fireEvent.click(screen.getByTestId('vfs-node-Manual-TI.pdf'));
    fireEvent.click(screen.getByRole('button', { name: 'Compartilhar link' }));

    expect(onLoadShareLinks).toHaveBeenCalled();
    expect(screen.getByText(/Links ativos deste arquivo \(1\)/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Excluir link temporário' }));
    await waitFor(() => {
      expect(onRevokeShareLink).toHaveBeenCalledWith('lnk-1', { purge: false });
    });
  });

  it('aciona Edicao no PC (Auto-Sync via Agente) e Guia Passo a Passo Excel', async () => {
    const onEditOnDesktop = vi.fn();
    const onOpenDesktopGuide = vi.fn();

    render(
      <StatefulHarness
        onEditOnDesktop={onEditOnDesktop}
        onOpenDesktopGuide={onOpenDesktopGuide}
      />,
    );

    fireEvent.click(screen.getByTestId('vfs-node-Manual-TI.pdf'));
    fireEvent.click(screen.getByRole('button', { name: 'Editar no PC com Auto-Sync' }));
    expect(onEditOnDesktop).toHaveBeenCalledWith(expect.objectContaining({ id: 'doc-1' }));

    fireEvent.click(screen.getByRole('button', { name: /Sync Excel/i }));
    expect(onOpenDesktopGuide).toHaveBeenCalled();
  });

  it('permite enviar pasta inteira sem ZIP, descompactar arquivo .ZIP/.RAR e abrir permissoes da pasta', async () => {
    const onUploadFolderTree = vi.fn().mockResolvedValue(true);
    const onExtractArchive = vi.fn().mockResolvedValue(true);
    const onOpenPermissions = vi.fn();

    const nodesWithArchive = [
      ...SAMPLE_NODES,
      {
        id: 'zip-1',
        parentId: null,
        name: 'Documentos-Fiscal.zip',
        type: 'file',
        mimeType: 'application/zip',
        sizeBytes: 40960,
        virtualPath: '/Documentos-Fiscal.zip',
        effectiveAccess: 'full_control',
        updatedAt: '2026-11-18T12:00:00Z',
      },
    ];

    render(
      <StatefulHarness
        nodes={nodesWithArchive}
        onUploadFolderTree={onUploadFolderTree}
        onExtractArchive={onExtractArchive}
        onOpenPermissions={onOpenPermissions}
      />,
    );

    // 1. Enviar Pasta inteira (input webkitdirectory)
    const folderInput = screen.getByLabelText('Upload de pasta inteira');
    const nestedFile = new File(['conteudo'], 'nota.pdf', { type: 'application/pdf' });
    Object.defineProperty(nestedFile, 'webkitRelativePath', {
      value: 'Fiscal/2026/nota.pdf',
      configurable: true,
    });
    fireEvent.change(folderInput, { target: { files: [nestedFile] } });
    await waitFor(() => {
      expect(onUploadFolderTree).toHaveBeenCalledWith(
        expect.objectContaining({
          folderPaths: ['Fiscal', 'Fiscal/2026'],
          files: [expect.objectContaining({ relativePath: 'Fiscal/2026/nota.pdf' })],
        }),
        null,
      );
    });

    // 2. Descompactar arquivo .ZIP abre modal e envia opcoes corretas
    fireEvent.click(screen.getByTestId('vfs-node-Documentos-Fiscal.zip'));
    fireEvent.click(screen.getByRole('button', { name: 'Descompactar arquivo' }));
    expect(screen.getByTestId('archive-extract-modal')).toBeInTheDocument();
    expect(screen.getByLabelText('Nome da pasta de destino')).toHaveValue('Documentos-Fiscal');

    fireEvent.click(screen.getByRole('button', { name: /Descompactar Agora/i }));
    await waitFor(() => {
      expect(onExtractArchive).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'zip-1' }),
        expect.objectContaining({
          mode: 'subfolder',
          folderName: 'Documentos-Fiscal',
          conflictPolicy: 'rename',
        }),
      );
    });

    // 3. Botao Permissoes na barra abre painel de permissoes para o item selecionado
    fireEvent.click(screen.getByTestId('vfs-node-Setores'));
    fireEvent.click(screen.getByRole('button', { name: 'Gerenciar permissões da pasta' }));
    expect(onOpenPermissions).toHaveBeenCalledWith(expect.objectContaining({ id: 'f-setores' }));
  });
});
