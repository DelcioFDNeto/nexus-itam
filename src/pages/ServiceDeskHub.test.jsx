// src/pages/ServiceDeskHub.test.jsx
import React from 'react';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ServiceDeskHub from './ServiceDeskHub';
import { ConfirmProvider } from '../components/ConfirmDialog';
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
          asset_tag: 'NTB-001',
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
          device_key: 'WKS-002-PF3Z881K',
          hostname: 'WS-002',
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

  afterEach(() => {
    clearGatewaySession();
    vi.restoreAllMocks();
  });

  it('exibe a topologia de saúde distribuída e o formulário Zero-Trust quando desconectado', async () => {
    render(<ServiceDeskHub />);

    expect(
      await screen.findByText(/Service Desk & Orquestração de Microsserviços/i),
    ).toBeInTheDocument();
    expect(await screen.findByText('postgresql-16')).toBeInTheDocument();
    expect(screen.getByText('service-assets')).toBeInTheDocument();
    expect(screen.getByText('Conectar ao Cluster de Microsserviços')).toBeInTheDocument();

    const emailInput = screen.getByLabelText(/E-mail de Operador \/ Gestor de TI/i);
    const passwordInput = screen.getByLabelText(/Senha de Acesso/i);
    expect(emailInput).toHaveValue('');
    expect(passwordInput).toHaveValue('');
    expect(document.body.textContent).not.toMatch(/Shineray@2026!|@shineray|npm run dev:microservices|docker compose/i);
  });

  it('exibe alerta sem vazar comandos CLI quando o healthcheck falha', async () => {
    vi.spyOn(microservicesApi, 'probeClusterHealth').mockRejectedValueOnce(new Error('ECONNREFUSED'));
    render(<ServiceDeskHub />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Aviso de Conectividade do Cluster/i);
    expect(alert.textContent).not.toMatch(/npm run dev:microservices|docker compose/i);
    expect(screen.getByRole('button', { name: /Tentar novamente/i })).toBeInTheDocument();
  });

  it('autentica via API Gateway e renderiza chamados, Hash-Chain SHA-256, frota e WebSocket', async () => {
    vi.spyOn(microservicesApi, 'authenticate').mockImplementation(async (email, password) => {
      const user = { id: 'u-1', name: 'TI Operações', role: 'owner', tenantId: 'tenant-corp' };
      setGatewaySession('jwt-test-token', user);
      return { accessToken: 'jwt-test-token', user, email, password };
    });

    render(<ServiceDeskHub />);

    const emailInput = await screen.findByLabelText(/E-mail de Operador \/ Gestor de TI/i);
    const passwordInput = screen.getByLabelText(/Senha de Acesso/i);
    fireEvent.change(emailInput, { target: { value: 'gestor@empresa.com.br' } });
    fireEvent.change(passwordInput, { target: { value: 'SenhaForte#2026' } });

    const submitBtn = screen.getByText('Conectar ao Cluster de Microsserviços');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(microservicesApi.authenticate).toHaveBeenCalledWith('gestor@empresa.com.br', 'SenhaForte#2026');
      expect(screen.getByText(/API 5 WebSocket: CONNECTED/i)).toBeInTheDocument();
    });

    expect(await screen.findByText('CHM-2026-0001')).toBeInTheDocument();
    expect(screen.getByText('Lentidão na VPN corporativa')).toBeInTheDocument();
    expect(screen.getByText(/ÍNTEGRA \(4 blocos\)/i)).toBeInTheDocument();
    expect(screen.getByText('NTB-001')).toBeInTheDocument();
    expect(screen.getByText('HMAC Assinado')).toBeInTheDocument();
    expect(screen.getByText('P2 Alta')).toBeInTheDocument();
    expect(screen.getByText('Total Chamados')).toBeInTheDocument();
  });

  it('permite abrir o modal de novo chamado técnico e enviá-lo', async () => {
    const user = { id: 'u-1', name: 'TI Operações', role: 'owner', tenantId: 'tenant-corp' };
    setGatewaySession('jwt-test-token', user);

    render(<ServiceDeskHub />);

    expect(await screen.findByText('CHM-2026-0001')).toBeInTheDocument();

    const newTicketBtn = screen.getByText('Novo Chamado');
    fireEvent.click(newTicketBtn);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Novo Chamado Técnico')).toBeInTheDocument();

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

  it('exige confirmação antes de excluir chamado e não exclui se cancelado', async () => {
    const user = { id: 'u-1', name: 'TI Operações', role: 'owner', tenantId: 'tenant-corp' };
    setGatewaySession('jwt-test-token', user);
    const deleteTicketSpy = vi.spyOn(microservicesApi, 'deleteTicket').mockResolvedValue({});

    render(
      <ConfirmProvider>
        <ServiceDeskHub />
      </ConfirmProvider>,
    );

    const deleteBtn = await screen.findByRole('button', { name: /Excluir chamado CHM-2026-0001/i });
    fireEvent.click(deleteBtn);

    expect(await screen.findByText(/Excluir chamado CHM-2026-0001\?/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Cancelar$/i }));

    await waitFor(() => {
      expect(screen.queryByText(/Excluir chamado CHM-2026-0001\?/i)).not.toBeInTheDocument();
    });
    expect(deleteTicketSpy).not.toHaveBeenCalled();
    expect(screen.getByText('CHM-2026-0001')).toBeInTheDocument();

    fireEvent.click(deleteBtn);
    fireEvent.click(await screen.findByRole('button', { name: /Excluir chamado$/i }));
    await waitFor(() => {
      expect(deleteTicketSpy).toHaveBeenCalledWith('tkt-1');
    });
  });

  it('exige confirmação antes de remover termo CLT e não remove se cancelado', async () => {
    const user = { id: 'u-1', name: 'TI Operações', role: 'owner', tenantId: 'tenant-corp' };
    setGatewaySession('jwt-test-token', user);
    const deleteTermSpy = vi.spyOn(microservicesApi, 'deleteTerm').mockResolvedValue({});

    render(
      <ConfirmProvider>
        <ServiceDeskHub />
      </ConfirmProvider>,
    );

    const removeBtn = await screen.findByRole('button', { name: /Remover termo de Karen Matos/i });
    fireEvent.click(removeBtn);

    expect(await screen.findByText(/Remover termo de custódia CLT\?/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Cancelar$/i }));

    await waitFor(() => {
      expect(screen.queryByText(/Remover termo de custódia CLT\?/i)).not.toBeInTheDocument();
    });
    expect(deleteTermSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/Doc: abc123def456/i)).toBeInTheDocument();

    fireEvent.click(removeBtn);
    fireEvent.click(await screen.findByRole('button', { name: /Remover termo$/i }));
    await waitFor(() => {
      expect(deleteTermSpy).toHaveBeenCalledWith('trm-1');
    });
  });

  it('limpa chamados, termos, frota e feed ao desconectar do gateway', async () => {
    const user = { id: 'u-1', name: 'TI Operações', role: 'owner', tenantId: 'tenant-corp' };
    setGatewaySession('jwt-test-token', user);

    render(<ServiceDeskHub />);

    expect(await screen.findByText('CHM-2026-0001')).toBeInTheDocument();
    expect(screen.getByText('WS-002')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Desconectar/i }));

    await waitFor(() => {
      expect(screen.getByText('Conectar ao Cluster de Microsserviços')).toBeInTheDocument();
    });
    expect(screen.queryByText('CHM-2026-0001')).not.toBeInTheDocument();
    expect(screen.queryByText('WS-002')).not.toBeInTheDocument();
  });

  it('não fecha modal de novo chamado ao pressionar Escape quando há alertdialog empilhado', async () => {
    const user = { id: 'u-1', name: 'TI Operações', role: 'owner', tenantId: 'tenant-corp' };
    setGatewaySession('jwt-test-token', user);

    render(
      <>
        <ServiceDeskHub />
        <div role="alertdialog" aria-modal="true">
          <button type="button">Cancelar</button>
        </div>
      </>,
    );

    expect(await screen.findByText('CHM-2026-0001')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Novo Chamado'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('permite aplicar atalho rápido e anexar imagem no modal de novo chamado', async () => {
    const user = { id: 'u-1', name: 'TI Operações', role: 'owner', tenantId: 'tenant-corp' };
    setGatewaySession('jwt-test-token', user);

    render(<ServiceDeskHub />);
    expect(await screen.findByText('CHM-2026-0001')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Novo Chamado'));
    expect(await screen.findByText('Novo Chamado Técnico')).toBeInTheDocument();

    // Aplica template em 1 clique
    fireEvent.click(screen.getByRole('button', { name: 'VPN / Acesso' }));
    const titleInput = screen.getByPlaceholderText(/Falha na conexão VPN corporativa/i);
    expect(titleInput.value).toBe('Falha na conexão VPN corporativa');

    // Anexa print PNG no modal
    const modal = screen.getByRole('dialog');
    const fileInput = modal.querySelector('input[type="file"]');
    const tinyPngBytes = Uint8Array.from(
      atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),
      (c) => c.charCodeAt(0),
    );
    const pngFile = new File([tinyPngBytes], 'vpn-erro.png', { type: 'image/png' });
    fireEvent.change(fileInput, { target: { files: [pngFile] } });

    expect(await screen.findByAltText(/vpn-erro/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Abrir Chamado/i }));

    await waitFor(() => {
      expect(microservicesApi.createTicket).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Falha na conexão VPN corporativa',
          category: 'network',
          attachments: expect.arrayContaining([
            expect.objectContaining({
              dataUrl: expect.stringMatching(/^data:image\/(png|jpeg);base64,/),
            }),
          ]),
        }),
      );
    });
  });

  it('abre chat em tempo real no TicketChatPanel, exibe indicador digitando e envia mensagem com print', async () => {
    const user = { id: 'u-1', name: 'TI Operações', role: 'owner', tenantId: 'tenant-corp' };
    setGatewaySession('jwt-test-token', user);

    const samplePng =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

    let capturedHandlers = null;
    vi.spyOn(microservicesApi, 'openNexusDeskSocket').mockImplementation((_token, handlers) => {
      capturedHandlers = handlers;
      handlers?.onStatus?.('connected');
      handlers?.onFrame?.({ event: 'welcome', role: 'owner' });
      return {
        ping: vi.fn(),
        close: vi.fn(),
        pushLiveTelemetry: vi.fn(),
        pushRemoteControl: vi.fn(),
        sendTicketTyping: vi.fn(),
      };
    });

    vi.spyOn(microservicesApi, 'getTicketById').mockResolvedValue({
      id: 'tkt-1',
      protocol: 'CHM-2026-0001',
      asset_tag: 'NTB-001',
      requester_name: 'Karen Matos',
      requester_email: 'karen.matos@empresa.com.br',
      department: 'Financeiro',
      title: 'Lentidão na VPN corporativa',
      description: 'Oscilação no túnel WireGuard.',
      category: 'network',
      status: 'open',
      priority: 'high',
      attachments: [{ id: 'att-open-1', name: 'print-abertura.png', dataUrl: samplePng, sizeBytes: 120 }],
      comments: [],
    });

    const addCommentSpy = vi.spyOn(microservicesApi, 'addTicketComment').mockResolvedValue({
      id: 'cm-99',
      ticket_id: 'tkt-1',
      author_name: 'TI Operações',
      author_email: 'ti@empresa.com.br',
      author_role: 'owner',
      message: 'Analisando seu túnel agora.',
      attachments: [],
      created_at: new Date().toISOString(),
    });

    render(
      <ConfirmProvider>
        <ServiceDeskHub />
      </ConfirmProvider>,
    );

    expect(await screen.findByText('CHM-2026-0001')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Diálogo Técnico/i }));

    expect(await screen.findByAltText('print-abertura.png')).toBeInTheDocument();

    // Simula evento WebSocket de colaborador digitando
    act(() => {
      capturedHandlers?.onFrame?.({
        event: 'ticket.typing',
        data: {
          ticketId: 'tkt-1',
          senderName: 'Karen Matos',
          senderEmail: 'karen.matos@empresa.com.br',
          senderRole: 'collaborator',
          isTyping: true,
        },
      });
    });

    expect(await screen.findByText(/Karen Matos está digitando/i)).toBeInTheDocument();

    // Simula mensagem recebida com print via WebSocket
    act(() => {
      capturedHandlers?.onFrame?.({
        event: 'ticket.commented',
        data: {
          commentId: 'cm-ws-1',
          ticketId: 'tkt-1',
          protocol: 'CHM-2026-0001',
          authorName: 'Karen Matos',
          authorEmail: 'karen.matos@empresa.com.br',
          authorRole: 'collaborator',
          message: 'Acabou de travar aqui de novo.',
          attachments: [{ id: 'att-ws-1', name: 'tela-travada.png', dataUrl: samplePng, sizeBytes: 240 }],
          createdAt: new Date().toISOString(),
        },
      });
    });

    const chatPanel = screen.getByRole('region', {
      name: /Atendimento em tempo real do chamado CHM-2026-0001/i,
    });
    expect(await within(chatPanel).findByText('Acabou de travar aqui de novo.')).toBeInTheDocument();
    expect(within(chatPanel).getByAltText('tela-travada.png')).toBeInTheDocument();

    // Envia resposta no chat
    const chatInput = within(chatPanel).getByLabelText('Mensagem do atendimento');
    fireEvent.change(chatInput, { target: { value: 'Analisando seu túnel agora.' } });
    fireEvent.click(within(chatPanel).getByRole('button', { name: 'Enviar mensagem no chat' }));

    await waitFor(() => {
      expect(addCommentSpy).toHaveBeenCalledWith('tkt-1', {
        message: 'Analisando seu túnel agora.',
        attachments: [],
      });
    });

    expect(await within(chatPanel).findByText('Analisando seu túnel agora.')).toBeInTheDocument();
  });
});
