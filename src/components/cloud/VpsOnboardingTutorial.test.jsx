import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import VpsOnboardingTutorial from './VpsOnboardingTutorial';

describe('VpsOnboardingTutorial', () => {
  it('inicia expandido quando nao configurado e alterna entre os 4 drivers', () => {
    const onSelectProvider = vi.fn();
    render(
      <VpsOnboardingTutorial
        providerType="agent_node"
        isConfigured={false}
        isConnected={false}
        hasFolders={false}
        onSelectProvider={onSelectProvider}
      />,
    );

    expect(screen.getByText('0/3 etapas')).toBeInTheDocument();
    expect(screen.getByText(/Agente 1-Click Linux \(Nexus Storage Node\)/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'SFTP / SSH Nativo' }));
    expect(screen.getByText(/SFTP \/ SSH Nativo para Linux, VPS ou NAS/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Usar este driver no formulário/i }));
    expect(onSelectProvider).toHaveBeenCalledWith('sftp');

    fireEvent.click(screen.getByRole('button', { name: 'S3 / MinIO / R2' }));
    expect(screen.getByText(/Amazon S3, MinIO/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'WebDAV / Nextcloud' }));
    expect(screen.getByText(/WebDAV Corporativo ou Nextcloud/i)).toBeInTheDocument();
  });

  it('inicia recolhido quando 3/3 etapas concluidas e abre sob demanda', () => {
    const onOpenExplorerTab = vi.fn();
    render(
      <VpsOnboardingTutorial
        providerType="agent_node"
        isConfigured
        isConnected
        hasFolders
        onOpenExplorerTab={onOpenExplorerTab}
      />,
    );

    expect(screen.getByText('3/3 etapas')).toBeInTheDocument();
    expect(screen.queryByText(/Escolha o cenário da sua empresa/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Abrir Tutorial Passo a Passo/i }));
    expect(screen.getByText(/Escolha o cenário da sua empresa/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Abrir Gerenciador de Arquivos/i }));
    expect(onOpenExplorerTab).toHaveBeenCalledTimes(1);
  });
});
