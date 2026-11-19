import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import FolderPermissionsPanel from './FolderPermissionsPanel';

const SAMPLE_NODES = [
  { id: 'n-setores', parentId: null, name: 'Setores', type: 'folder', virtualPath: '/Setores' },
  { id: 'n-fin', parentId: 'n-setores', name: 'Financeiro', type: 'folder', virtualPath: '/Setores/Financeiro' },
  { id: 'n-sub', parentId: 'n-fin', name: 'Balancos', type: 'folder', virtualPath: '/Setores/Financeiro/Balancos' },
];

describe('FolderPermissionsPanel (Permissoes Visuais e Intuitivas das Pastas VPS)', () => {
  it('permite selecionar setor real da empresa, escolher nivel visual e salvar regra sem termos tecnicos confusos', async () => {
    const onSaveRule = vi.fn().mockResolvedValue(true);

    render(
      <FolderPermissionsPanel
        nodes={SAMPLE_NODES}
        selectedNodeId="n-fin"
        onSelectNodeId={vi.fn()}
        canManageAcl
        rules={[]}
        inheritedRules={[]}
        defaultPolicy={{
          summary: 'Pasta de departamento: apenas colaboradores do setor Financeiro editam por padrão.',
        }}
        sectors={['Financeiro', 'RH', 'TI']}
        portalUsers={[
          { id: 'u1', name: 'Ana Paula', email: 'ana@empresa.com.br', department: 'Financeiro', role: 'collaborator' },
        ]}
        onSaveRule={onSaveRule}
        onDeleteRule={vi.fn()}
      />,
    );

    expect(screen.getByText(/apenas colaboradores do setor Financeiro/i)).toBeInTheDocument();

    // Escolhe o setor RH no select de setores reais
    fireEvent.change(screen.getByLabelText('Valor do Alvo ACL'), { target: { value: 'RH' } });

    // Escolhe o nivel visual "Leitor (Ver e Baixar)"
    fireEvent.click(screen.getByText('Leitor (Ver e Baixar)'));

    // Salva a permissao
    fireEvent.click(screen.getByRole('button', { name: /Salvar Permissão na Pasta/i }));

    await waitFor(() => {
      expect(onSaveRule).toHaveBeenCalledWith('n-fin', {
        targetType: 'department',
        targetValue: 'RH',
        accessLevel: 'reader',
      });
    });
  });

  it('exibe regras diretas com troca rapida de nivel, regras herdadas com link para origem e atalhos 1-clique', async () => {
    const onSaveRule = vi.fn().mockResolvedValue(true);
    const onDeleteRule = vi.fn().mockResolvedValue(true);
    const onSelectNodeId = vi.fn();

    render(
      <FolderPermissionsPanel
        nodes={SAMPLE_NODES}
        selectedNodeId="n-sub"
        onSelectNodeId={onSelectNodeId}
        canManageAcl
        rules={[
          { id: 'r1', targetType: 'user', targetValue: 'ana@empresa.com.br', accessLevel: 'reader' },
        ]}
        inheritedRules={[
          {
            id: 'inh-1',
            targetType: 'department',
            targetValue: 'Financeiro',
            accessLevel: 'editor',
            sourceNodeId: 'n-fin',
            sourceName: 'Financeiro',
            sourcePath: '/Setores/Financeiro',
          },
        ]}
        portalUsers={[
          { id: 'u1', name: 'Ana Paula', email: 'ana@empresa.com.br', department: 'Financeiro', role: 'collaborator' },
        ]}
        onSaveRule={onSaveRule}
        onDeleteRule={onDeleteRule}
      />,
    );

    // Troca rapida de nivel direto na regra existente
    const inlineSelect = screen.getByLabelText(/Alterar nível de acesso de Ana Paula/i);
    fireEvent.change(inlineSelect, { target: { value: 'full_control' } });
    await waitFor(() => {
      expect(onSaveRule).toHaveBeenCalledWith('n-sub', {
        targetType: 'user',
        targetValue: 'ana@empresa.com.br',
        accessLevel: 'full_control',
      });
    });

    // Botao "Editar na origem" da regra herdada navega para a pasta pai
    fireEvent.click(screen.getByRole('button', { name: /Editar na origem/i }));
    expect(onSelectNodeId).toHaveBeenCalledWith('n-fin');

    // Atalho rapido 1-clique "Liberar leitura p/ toda empresa"
    fireEvent.click(screen.getByRole('button', { name: /Liberar leitura p\/ toda empresa/i }));
    await waitFor(() => {
      expect(onSaveRule).toHaveBeenCalledWith('n-sub', {
        targetType: 'role',
        targetValue: 'collaborator',
        accessLevel: 'reader',
      });
    });

    // Excluir regra direta
    fireEvent.click(screen.getByRole('button', { name: /Remover regra de Ana Paula/i }));
    await waitFor(() => {
      expect(onDeleteRule).toHaveBeenCalledWith('n-sub', 'r1');
    });
  });
});
