// src/pages/ServiceDeskHub.test.jsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ServiceDeskHub from './ServiceDeskHub';
import {
  clearGatewaySession,
  microservicesApi,
  setGatewaySession,
} from '../services/microservicesClient';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('ServiceDeskHub (Integração Console React 19 <-> Malha Fastify)', () => {
  const mockSocketHandle = {
    pushLiveTelemetry: vi.fn(),
    ping: vi.fn(),
    close: vi.fn(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    clearGatewaySession();

    vi.spyOn(microservicesApi, 'probeClusterHealth').mockResolvedValue({
      status: 'healthy',
      database: { engine: 'postgresql-16', latencyMs: 2 },
      microservices: [
        { service: 'service-assets', status: 'healthy', latencyMs: 3 },
        { service: 'service-tickets', status: 'healthy', latencyMs: 4 },
        { service: 'service-compliance', status: 'healthy', latencyMs: 2 },
        { service: 'service-nexusdesk', status: 'healthy', latencyMs: 3 },
      ],
    });

    vi.spyOn(microservicesApi, 'listTickets').mockResolvedValue({
      items: [
        {
          id: 'tkt-1',
          protocol: 'CHM-2026-0001',
          asset_tag: 'SHL-BEL-NTB-016',
          requester_name: 'Karen Matos',
          title: 'Lentidão na VPN corporativa',
          description: 'Oscilação no túnel WireGuard.',
          status: 'open',
          priority: 'high',
          category: 'network',
        },
      ],
    });

    vi.spyOn(microservicesApi, 'listTerms').mockResolvedValue({
      items: [
        {
          id: 'trm-1',
          employee_name: 'Karen Matos',
          document_hash: 'abc123def456',
          status: 'signed',
        },
      ],
    });

    vi.spyOn(microservicesApi, 'getFleetTelemetry').mockResolvedValue({
      summary: { totalDevices: 1 },
      devices: [
        {
          id: 'dev-1',
          device_key: 'WKS-SHL-PF3Z881K',
          hostname: 'SHL-BEL-NTB-001',
          os_version: 'Windows 11 Pro 24H2',
          cpu_percent: 22.5,
          ram_percent: 48.1,
        },
      ],
    });

    vi.spyOn(microservicesApi, 'verifyAuditChain').mockResolvedValue({
      intact: true,
      checkedRecords: 4,
    });

    vi.spyOn(microservicesApi, 'openNexusDeskSocket').mockImplementation((_token, handlers) => {
      handlers?.onStatus?.('connected');
      handlers?.onFrame?.({ event: 'welcome', role: 'owner' });
      return mockSocketHandle;
    });

    vi.spyOn(microservicesApi, 'createTicket').mockResolvedValue({
      protocol: 'CHM-2026-0002',
      status: 'open',
    });
  });

  it('exibe a topologia de saúde distribuída e o formulário Zero-Trust quando desconectado', async () => {
    render(<ServiceDeskHub />);

    expect(
      await screen.findByText(/Service Desk & Orquestração de Microsserviços/i),
    ).toBeInTheDocument();
    expect(await screen.findByText('postgresql-16')).toBeInTheDocument();
    expect(screen.getByText('service-assets')).toBeInTheDocument();
    expect(screen.getByText('Conectar ao Cluster de Microsserviços')).toBeInTheDocument();
  });

  it('autentica via API Gateway e renderiza chamados, Hash-Chain SHA-256, frota e WebSocket', async () => {
    vi.spyOn(microservicesApi, 'authenticate').mockImplementation(async () => {
      const user = { id: 'u-1', name: 'Danillo Sabel Portal', role: 'owner', tenantId: 'tenant-ap3htf6' };
      setGatewaySession('jwt-test-token', user);
      return { accessToken: 'jwt-test-token', user };
    });

    render(<ServiceDeskHub />);

    const submitBtn = await screen.findByText('Conectar ao Cluster de Microsserviços');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(/API 5 WebSocket: CONNECTED/i)).toBeInTheDocument();
    });

    expect(await screen.findByText('CHM-2026-0001')).toBeInTheDocument();
    expect(screen.getByText('Lentidão na VPN corporativa')).toBeInTheDocument();
    expect(screen.getByText(/ÍNTEGRA \(4 blocos\)/i)).toBeInTheDocument();
    expect(screen.getByText('SHL-BEL-NTB-016')).toBeInTheDocument();
    expect(screen.getByText('HMAC Assinado')).toBeInTheDocument();
    expect(screen.getByText('P2 Alta')).toBeInTheDocument();
    expect(screen.getByText('Total Chamados')).toBeInTheDocument();
  });

  it('permite abrir o modal de novo chamado técnico e enviá-lo', async () => {
    const user = { id: 'u-1', name: 'Danillo Sabel Portal', role: 'owner', tenantId: 'tenant-ap3htf6' };
    setGatewaySession('jwt-test-token', user);

    render(<ServiceDeskHub />);

    expect(await screen.findByText('CHM-2026-0001')).toBeInTheDocument();

    const newTicketBtn = screen.getByText('Novo Chamado');
    fireEvent.click(newTicketBtn);

    expect(await screen.findByText('Novo Chamado Técnico')).toBeInTheDocument();

    const titleInput = screen.getByPlaceholderText(/Falha na conexão VPN corporativa/i);
    const descInput = screen.getByPlaceholderText(/Descreva o sintoma observado/i);

    fireEvent.change(titleInput, { target: { value: 'Falha no teclado mecânico' } });
    fireEvent.change(descInput, { target: { value: 'Teclas W e S não registram.' } });

    const submitBtn = screen.getByRole('button', { name: /Abrir Chamado/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(microservicesApi.createTicket).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Falha no teclado mecânico',
          description: 'Teclas W e S não registram.',
        })
      );
    });
  });
});
