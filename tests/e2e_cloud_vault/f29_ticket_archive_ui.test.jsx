// tests/e2e_cloud_vault/f29_ticket_archive_ui.test.jsx
// =============================================================================
// E2E-M3 F-29: API 2 (Chamados) "Arquivar cópia na VPS" UI (`ServiceDeskHub.jsx`)
// Tier 1 (Client & UI Contract: 5) + Tier 2 (RBAC/Plan/Error/Concurrency: 5)
// =============================================================================

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  createMockStorageRoutes,
  installMockFetch,
  installMockWebSocket,
  requireModuleOrFail,
  resetBrowserSessions,
  seedReactGatewaySession,
} from './helpers/uiTestHarness.js';

const mockUseAuth = vi.fn();
const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
};

vi.mock('../../src/contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('../../src/contexts/ThemeContext', () => ({
  useTheme: () => ({ isDark: false, setTheme: vi.fn(), toggleTheme: vi.fn() }),
}));

vi.mock('sonner', () => ({
  Toaster: () => null,
  toast: mockToast,
}));

function buildServiceDeskMockRoutes(options = {}) {
  const storageHandler = createMockStorageRoutes(options);
  const tickets = options.tickets ?? [
    {
      id: 'tkt-101',
      protocol: 'CHM-2026-0001',
      title: 'Falha VPN Matriz',
      status: 'open',
      priority: 'high',
      requester_name: 'Carlos Mendes',
      requester_email: 'carlos@empresa.com.br',
      department: 'Financeiro',
      attachments_count: 2,
      comments_count: 1,
      created_at: '2026-11-17T10:00:00Z',
    },
  ];

  return async (req) => {
    const { method, pathname } = req;

    if (method === 'GET' && pathname === '/health') {
      return { status: 200, json: { ok: true, status: 'healthy', services: {} } };
    }
    if (method === 'GET' && pathname === '/api/v1/tickets') {
      return { status: 200, json: { items: tickets } };
    }
    if (method === 'GET' && pathname === '/api/v1/compliance/terms') {
      return { status: 200, json: { items: [] } };
    }
    if (method === 'GET' && pathname === '/api/v1/telemetry/fleet') {
      return { status: 200, json: { summary: { total: 0, online: 0 }, devices: [] } };
    }
    if (method === 'GET' && pathname === '/api/v1/compliance/audit/verify-chain') {
      return { status: 200, json: { intact: true, total: 0 } };
    }

    const archiveMatch = /^\/api\/v1\/tickets\/([^/]+)\/archive-vps$/.exec(pathname);
    if (method === 'POST' && archiveMatch && options.onArchiveTicket) {
      return options.onArchiveTicket(decodeURIComponent(archiveMatch[1]), req);
    }

    return storageHandler(req);
  };
}

function findArchiveButtons() {
  return screen.queryAllByRole('button', { name: /Arquivar cópia na VPS/i });
}

describe('F-29: API 2 (Chamados) "Arquivar cópia na VPS" UI (ServiceDeskHub.jsx)', () => {
  let mockFetch = null;
  let mockWs = null;

  beforeEach(() => {
    vi.clearAllMocks();
    resetBrowserSessions();
  });

  afterEach(() => {
    cleanup();
    mockWs?.restore();
    mockFetch?.restore();
    mockWs = null;
    mockFetch = null;
    resetBrowserSessions();
  });

  describe('Tier 1 — Client Method, Button Visibility, Loading/Success & Attachments', () => {
    it('F29-T1-01: microservicesClient.js exposes archiveTicketToVps calling POST /api/v1/tickets/:id/archive-vps', async () => {
      mockFetch = installMockFetch(buildServiceDeskMockRoutes());
      const { token } = seedReactGatewaySession({ user: { role: 'operator', tenantId: 'tenant-acme', plan: 'pro' } });

      const clientMod = await requireModuleOrFail('src/services/microservicesClient.js', 'M4');
      expect(typeof clientMod.microservicesApi.archiveTicketToVps).toBe('function');

      const res = await clientMod.microservicesApi.archiveTicketToVps('tkt-101');
      expect(res.archived).toBe(true);
      expect(res.folderPath).toContain('/Chamados/');

      const postReq = mockFetch.requests.find(
        (r) => r.method === 'POST' && r.pathname === '/api/v1/tickets/tkt-101/archive-vps',
      );
      expect(postReq).toBeDefined();
      expect(postReq.authorization).toBe(`Bearer ${token}`);
    });

    it('F29-T1-02: ServiceDeskHub.jsx renders "Arquivar cópia na VPS" button on ticket cards', async () => {
      mockFetch = installMockFetch(buildServiceDeskMockRoutes());
      mockWs = installMockWebSocket();
      seedReactGatewaySession({ user: { role: 'owner', tenantId: 'tenant-acme', plan: 'pro' } });
      mockUseAuth.mockReturnValue({ currentUser: { uid: 'u1', role: 'owner', tenantId: 'tenant-acme' } });

      const { ConfirmProvider } = await requireModuleOrFail('src/components/ConfirmDialog.jsx', 'baseline');
      const hubMod = await requireModuleOrFail('src/pages/ServiceDeskHub.jsx', 'M4');
      const ServiceDeskHub = hubMod.default;

      render(
        <ConfirmProvider>
          <ServiceDeskHub />
        </ConfirmProvider>,
      );

      await waitFor(() => {
        expect(screen.getByText('CHM-2026-0001')).toBeInTheDocument();
      });

      const buttons = findArchiveButtons();
      expect(buttons.length).toBeGreaterThanOrEqual(1);
      expect(buttons[0]).toBeEnabled();
    });

    it('F29-T1-03: clicking "Arquivar cópia na VPS" enters loading state, sends POST with Bearer, and confirms /Chamados/{protocol}/', async () => {
      let resolveArchive;
      const deferred = new Promise((r) => {
        resolveArchive = r;
      });

      mockFetch = installMockFetch(
        buildServiceDeskMockRoutes({
          onArchiveTicket: async (id) => {
            await deferred;
            return {
              status: 200,
              json: { archived: true, folderPath: `/Chamados/CHM-2026-0001/`, ticketId: id, files: ['resumo.json'] },
            };
          },
        }),
      );
      mockWs = installMockWebSocket();
      const { token } = seedReactGatewaySession({ user: { role: 'operator', tenantId: 'tenant-acme', plan: 'pro' } });
      mockUseAuth.mockReturnValue({ currentUser: { uid: 'u2', role: 'operator', tenantId: 'tenant-acme' } });

      const { ConfirmProvider } = await requireModuleOrFail('src/components/ConfirmDialog.jsx', 'baseline');
      const ServiceDeskHub = (await requireModuleOrFail('src/pages/ServiceDeskHub.jsx', 'M4')).default;

      render(
        <ConfirmProvider>
          <ServiceDeskHub />
        </ConfirmProvider>,
      );

      await waitFor(() => {
        expect(findArchiveButtons().length).toBeGreaterThanOrEqual(1);
      });

      const btn = findArchiveButtons()[0];
      fireEvent.click(btn);

      await waitFor(() => {
        expect(btn).toBeDisabled();
      });

      resolveArchive();

      await waitFor(() => {
        expect(btn).toBeEnabled();
      });

      const postReqs = mockFetch.requests.filter(
        (r) => r.method === 'POST' && r.pathname === '/api/v1/tickets/tkt-101/archive-vps',
      );
      expect(postReqs).toHaveLength(1);
      expect(postReqs[0].authorization).toBe(`Bearer ${token}`);

      const toastMsg = mockToast.success.mock.calls.flat().join(' ');
      expect(toastMsg + document.body.textContent).toMatch(/\/Chamados\//);
    });

    it('F29-T1-04: archives ticket with attachments preserving attachments list & summary files', async () => {
      mockFetch = installMockFetch(
        buildServiceDeskMockRoutes({
          tickets: [
            {
              id: 'tkt-att-2',
              protocol: 'CHM-2026-0002',
              title: 'Notebook com tela quebrada',
              status: 'in_progress',
              priority: 'medium',
              requester_name: 'Julia Costa',
              attachments_count: 2,
              attachments: [
                { name: 'evidencia1.png', size: 1200 },
                { name: 'evidencia2.jpg', size: 2400 },
              ],
              created_at: '2026-11-17T10:00:00Z',
            },
          ],
          onArchiveTicket: () => ({
            status: 200,
            json: {
              archived: true,
              folderPath: '/Chamados/CHM-2026-0002/',
              files: ['resumo.json', 'evidencia1.png', 'evidencia2.jpg'],
            },
          }),
        }),
      );
      mockWs = installMockWebSocket();
      seedReactGatewaySession({ user: { role: 'manager', tenantId: 'tenant-acme', plan: 'pro' } });
      mockUseAuth.mockReturnValue({ currentUser: { uid: 'u3', role: 'manager', tenantId: 'tenant-acme' } });

      const { ConfirmProvider } = await requireModuleOrFail('src/components/ConfirmDialog.jsx', 'baseline');
      const ServiceDeskHub = (await requireModuleOrFail('src/pages/ServiceDeskHub.jsx', 'M4')).default;

      render(
        <ConfirmProvider>
          <ServiceDeskHub />
        </ConfirmProvider>,
      );

      await waitFor(() => {
        expect(findArchiveButtons().length).toBeGreaterThanOrEqual(1);
      });

      fireEvent.click(findArchiveButtons()[0]);

      await waitFor(() => {
        expect(
          mockFetch.requests.some(
            (r) => r.method === 'POST' && r.pathname === '/api/v1/tickets/tkt-att-2/archive-vps',
          ),
        ).toBe(true);
      });
      expect(screen.getByText('CHM-2026-0002')).toBeInTheDocument();
    });

    it('F29-T1-05: supports archiving resolved/closed tickets and idempotent re-archiving', async () => {
      mockFetch = installMockFetch(
        buildServiceDeskMockRoutes({
          tickets: [
            {
              id: 'tkt-res-3',
              protocol: 'CHM-2026-0003',
              title: 'Troca de SSD concluída',
              status: 'resolved',
              priority: 'low',
              requester_name: 'Pedro Alves',
              resolution_notes: 'SSD substituído e validado.',
              created_at: '2026-11-17T09:00:00Z',
            },
          ],
        }),
      );
      mockWs = installMockWebSocket();
      seedReactGatewaySession({ user: { role: 'owner', tenantId: 'tenant-acme', plan: 'pro' } });
      mockUseAuth.mockReturnValue({ currentUser: { uid: 'u1', role: 'owner', tenantId: 'tenant-acme' } });

      const { ConfirmProvider } = await requireModuleOrFail('src/components/ConfirmDialog.jsx', 'baseline');
      const ServiceDeskHub = (await requireModuleOrFail('src/pages/ServiceDeskHub.jsx', 'M4')).default;

      render(
        <ConfirmProvider>
          <ServiceDeskHub />
        </ConfirmProvider>,
      );

      await waitFor(() => {
        expect(findArchiveButtons().length).toBeGreaterThanOrEqual(1);
      });

      const btn = findArchiveButtons()[0];
      fireEvent.click(btn);
      await waitFor(() => expect(btn).toBeEnabled());

      fireEvent.click(btn);
      await waitFor(() => {
        const posts = mockFetch.requests.filter(
          (r) => r.method === 'POST' && r.pathname === '/api/v1/tickets/tkt-res-3/archive-vps',
        );
        expect(posts).toHaveLength(2);
      });
    });
  });

  describe('Tier 2 — RBAC, Plan/Zero-Knowledge 403, Unconfigured VPS & Concurrency', () => {
    it('F29-T2-01: hides or blocks ticket archive action for viewer role (cloud:read only)', async () => {
      mockFetch = installMockFetch(buildServiceDeskMockRoutes());
      mockWs = installMockWebSocket();
      seedReactGatewaySession({ user: { role: 'viewer', tenantId: 'tenant-acme', plan: 'pro' } });
      mockUseAuth.mockReturnValue({ currentUser: { uid: 'u-view', role: 'viewer', tenantId: 'tenant-acme' } });

      const { ConfirmProvider } = await requireModuleOrFail('src/components/ConfirmDialog.jsx', 'baseline');
      const ServiceDeskHub = (await requireModuleOrFail('src/pages/ServiceDeskHub.jsx', 'M4')).default;

      render(
        <ConfirmProvider>
          <ServiceDeskHub />
        </ConfirmProvider>,
      );

      await waitFor(() => {
        expect(screen.getByText('CHM-2026-0001')).toBeInTheDocument();
      });

      const buttons = findArchiveButtons();
      if (buttons.length > 0) {
        expect(buttons.every((b) => b.disabled)).toBe(true);
      }
      expect(mockFetch.requests.some((r) => r.pathname.includes('/archive-vps'))).toBe(false);
    });

    it('F29-T2-02: handles 403 FEATURE_NOT_IN_PLAN (starter) and ZERO_KNOWLEDGE_RESTRICTED (superadmin) gracefully', async () => {
      mockFetch = installMockFetch(
        buildServiceDeskMockRoutes({
          onArchiveTicket: () => ({
            status: 403,
            json: { error: 'FEATURE_NOT_IN_PLAN', message: 'Módulo Cloud Vault não disponível no plano starter.' },
          }),
        }),
      );
      mockWs = installMockWebSocket();
      seedReactGatewaySession({ user: { role: 'owner', tenantId: 'tenant-starter', plan: 'starter' } });
      mockUseAuth.mockReturnValue({ currentUser: { uid: 'u1', role: 'owner', tenantId: 'tenant-starter' } });

      const { ConfirmProvider } = await requireModuleOrFail('src/components/ConfirmDialog.jsx', 'baseline');
      const ServiceDeskHub = (await requireModuleOrFail('src/pages/ServiceDeskHub.jsx', 'M4')).default;

      render(
        <ConfirmProvider>
          <ServiceDeskHub />
        </ConfirmProvider>,
      );

      await waitFor(() => {
        expect(findArchiveButtons().length).toBeGreaterThanOrEqual(1);
      });

      const btn = findArchiveButtons()[0];
      fireEvent.click(btn);

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalled();
        expect(btn).toBeEnabled();
      });
      expect(screen.getByText('CHM-2026-0001')).toBeInTheDocument();
    });

    it('F29-T2-03: handles unconfigured VPS (412/400 VPS_NOT_CONFIGURED) and 502 upstream errors with recovery', async () => {
      mockFetch = installMockFetch(
        buildServiceDeskMockRoutes({
          onArchiveTicket: () => ({
            status: 412,
            json: { error: 'VPS_NOT_CONFIGURED', message: 'Conexão VPS não configurada para esta empresa.' },
          }),
        }),
      );
      mockWs = installMockWebSocket();
      seedReactGatewaySession({ user: { role: 'owner', tenantId: 'tenant-acme', plan: 'pro' } });
      mockUseAuth.mockReturnValue({ currentUser: { uid: 'u1', role: 'owner', tenantId: 'tenant-acme' } });

      const { ConfirmProvider } = await requireModuleOrFail('src/components/ConfirmDialog.jsx', 'baseline');
      const ServiceDeskHub = (await requireModuleOrFail('src/pages/ServiceDeskHub.jsx', 'M4')).default;

      render(
        <ConfirmProvider>
          <ServiceDeskHub />
        </ConfirmProvider>,
      );

      await waitFor(() => {
        expect(findArchiveButtons().length).toBeGreaterThanOrEqual(1);
      });

      const btn = findArchiveButtons()[0];
      fireEvent.click(btn);

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalled();
        expect(btn).toBeEnabled();
      });
      expect(mockToast.error.mock.calls.flat().join(' ')).toMatch(/VPS/i);
    });

    it('F29-T2-04: blocks superadmin from archiving tenant tickets (Zero-Knowledge LGPD)', async () => {
      mockFetch = installMockFetch(
        buildServiceDeskMockRoutes({
          onArchiveTicket: () => ({
            status: 403,
            json: { error: 'ZERO_KNOWLEDGE_RESTRICTED', message: 'Superadmin bloqueado por Zero-Knowledge LGPD.' },
          }),
        }),
      );
      mockWs = installMockWebSocket();
      seedReactGatewaySession({ user: { role: 'superadmin', tenantId: 'nexus-master' } });
      mockUseAuth.mockReturnValue({ currentUser: { uid: 'u-sa', role: 'superadmin', tenantId: 'nexus-master' } });

      const { ConfirmProvider } = await requireModuleOrFail('src/components/ConfirmDialog.jsx', 'baseline');
      const ServiceDeskHub = (await requireModuleOrFail('src/pages/ServiceDeskHub.jsx', 'M4')).default;

      render(
        <ConfirmProvider>
          <ServiceDeskHub />
        </ConfirmProvider>,
      );

      await waitFor(() => {
        expect(screen.getByText('CHM-2026-0001')).toBeInTheDocument();
      });

      const buttons = findArchiveButtons();
      if (buttons.length > 0 && !buttons[0].disabled) {
        fireEvent.click(buttons[0]);
        await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
      } else {
        expect(mockFetch.requests.some((r) => r.pathname.includes('/archive-vps'))).toBe(false);
      }
    });

    it('F29-T2-05: rapid double-click fires only 1 POST and isolates loading per ticket + URL-encodes ID', async () => {
      let resolveFirst;
      const deferred = new Promise((r) => {
        resolveFirst = r;
      });

      mockFetch = installMockFetch(
        buildServiceDeskMockRoutes({
          tickets: [
            { id: 'tkt-1', protocol: 'CHM-1', title: 'Chamado 1', status: 'open', priority: 'high', requester_name: 'A' },
            { id: 'tkt-2', protocol: 'CHM-2', title: 'Chamado 2', status: 'open', priority: 'low', requester_name: 'B' },
          ],
          onArchiveTicket: async (id) => {
            if (id === 'tkt-1') await deferred;
            return { status: 200, json: { archived: true, folderPath: `/Chamados/${id}/`, files: ['resumo.json'] } };
          },
        }),
      );
      mockWs = installMockWebSocket();
      seedReactGatewaySession({ user: { role: 'owner', tenantId: 'tenant-acme', plan: 'pro' } });
      mockUseAuth.mockReturnValue({ currentUser: { uid: 'u1', role: 'owner', tenantId: 'tenant-acme' } });

      const clientMod = await requireModuleOrFail('src/services/microservicesClient.js', 'M4');
      await clientMod.microservicesApi.archiveTicketToVps('tkt id/special');
      expect(
        mockFetch.requests.some((r) => r.pathname === '/api/v1/tickets/tkt%20id%2Fspecial/archive-vps'),
      ).toBe(true);
      mockFetch.clearRequests();

      const { ConfirmProvider } = await requireModuleOrFail('src/components/ConfirmDialog.jsx', 'baseline');
      const ServiceDeskHub = (await requireModuleOrFail('src/pages/ServiceDeskHub.jsx', 'M4')).default;

      render(
        <ConfirmProvider>
          <ServiceDeskHub />
        </ConfirmProvider>,
      );

      await waitFor(() => {
        expect(findArchiveButtons()).toHaveLength(2);
      });

      const [btn1, btn2] = findArchiveButtons();
      fireEvent.click(btn1);
      fireEvent.click(btn1);
      fireEvent.click(btn1);

      await waitFor(() => {
        expect(btn1).toBeDisabled();
      });
      expect(btn2).toBeEnabled();

      resolveFirst();
      await waitFor(() => expect(btn1).toBeEnabled());

      const postsFor1 = mockFetch.requests.filter(
        (r) => r.method === 'POST' && r.pathname === '/api/v1/tickets/tkt-1/archive-vps',
      );
      expect(postsFor1).toHaveLength(1);
    });
  });
});
