// tests/e2e_cloud_vault/f30_term_archive_ui.test.jsx
// =============================================================================
// E2E-M3 F-30: API 3 (Termos) "Arquivar cópia na VPS" UI
// Covers BOTH `ServiceDeskHub.jsx` (Gateway CLT) AND `TermsPage.jsx` (Firestore)
// Tier 1 (Client & UI Contract: 5) + Tier 2 (Unsigned/RBAC/Plan/Error/Concurrency: 5)
// =============================================================================

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  createMockStorageRoutes,
  installMockFetch,
  installMockWebSocket,
  requireModuleOrFail,
  resetBrowserSessions,
  seedReactGatewaySession,
} from './helpers/uiTestHarness.js';

const mockUseAuth = vi.fn();
const mockListTerms = vi.fn();
const mockGetTerm = vi.fn();
const mockLoadSignedCopy = vi.fn();
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

vi.mock('../../src/services/termService', () => ({
  listTerms: (...args) => mockListTerms(...args),
  getTerm: (...args) => mockGetTerm(...args),
  cancelTransfer: vi.fn(),
}));

vi.mock('../../src/services/termFileService', () => ({
  loadSignedCopy: (...args) => mockLoadSignedCopy(...args),
  prepareSignedCopy: vi.fn(),
}));

vi.mock('../../src/hooks/useTermPrinter', () => ({
  useTermPrinter: () => ({
    printTerm: vi.fn(),
    settings: { overdueDays: 5 },
  }),
}));

vi.mock('sonner', () => ({
  Toaster: () => null,
  toast: mockToast,
}));

function buildTermMockRoutes(options = {}) {
  const storageHandler = createMockStorageRoutes(options);
  const gatewayTerms = options.gatewayTerms ?? [
    {
      id: 'tm-signed-1',
      employee_name: 'Maria Souza',
      document_hash: 'sha256-abc123',
      status: 'signed',
    },
  ];

  return async (req) => {
    const { method, pathname } = req;

    if (method === 'GET' && pathname === '/health') {
      return { status: 200, json: { ok: true, status: 'healthy', services: {} } };
    }
    if (method === 'GET' && pathname === '/api/v1/tickets') {
      return { status: 200, json: { items: [] } };
    }
    if (method === 'GET' && pathname === '/api/v1/compliance/terms') {
      return { status: 200, json: { items: gatewayTerms } };
    }
    if (method === 'GET' && pathname === '/api/v1/telemetry/fleet') {
      return { status: 200, json: { summary: { total: 0, online: 0 }, devices: [] } };
    }
    if (method === 'GET' && pathname === '/api/v1/compliance/audit/verify-chain') {
      return { status: 200, json: { intact: true, total: 0 } };
    }

    const termArchiveMatch = /^\/api\/v1\/compliance\/terms\/([^/]+)\/archive-vps$/.exec(pathname);
    if (method === 'POST' && termArchiveMatch && options.onArchiveTerm) {
      return options.onArchiveTerm(decodeURIComponent(termArchiveMatch[1]), req);
    }

    if (method === 'POST' && pathname === '/api/v1/storage/upload' && options.onUpload) {
      return options.onUpload(req);
    }

    return storageHandler(req);
  };
}

function makeFirestoreTerm(overrides = {}) {
  return {
    id: 'tm-fs-1',
    number: 'TR-2026-0001',
    kind: 'responsabilidade',
    status: 'assinado',
    tenantId: 'tenant-acme',
    holder: { name: 'Maria Souza', cpf: '123.456.789-00' },
    assets: [{ id: 'a1', internalId: 'NX-010', model: 'Dell Latitude', serialNumber: 'SN10' }],
    signedCopy: {
      fileId: 'tf-1',
      chunks: 1,
      name: 'TR-2026-0001-assinado.pdf',
      contentType: 'application/pdf',
      size: 2048,
    },
    createdAt: new Date('2026-11-10T10:00:00Z'),
    ...overrides,
  };
}

function findArchiveButtons() {
  return screen.queryAllByRole('button', { name: /Arquivar cópia na VPS/i });
}

describe('F-30: API 3 (Termos) "Arquivar cópia na VPS" UI (ServiceDeskHub & TermsPage)', () => {
  let mockFetch = null;
  let mockWs = null;

  beforeEach(() => {
    vi.clearAllMocks();
    resetBrowserSessions();
    mockListTerms.mockResolvedValue([]);
    mockGetTerm.mockResolvedValue(null);
    mockLoadSignedCopy.mockResolvedValue({
      dataUrl: 'data:application/pdf;base64,JVBERi0xLjQK',
      contentType: 'application/pdf',
      name: 'TR-2026-0001-assinado.pdf',
    });
  });

  afterEach(() => {
    cleanup();
    mockWs?.restore();
    mockFetch?.restore();
    mockWs = null;
    mockFetch = null;
    resetBrowserSessions();
  });

  describe('Tier 1 — Client Contract, ServiceDeskHub CLT Terms & TermsPage Signed Copy', () => {
    it('F30-T1-01: microservicesClient.js exposes archiveTermToVps calling POST /api/v1/compliance/terms/:id/archive-vps', async () => {
      mockFetch = installMockFetch(buildTermMockRoutes());
      const { token } = seedReactGatewaySession({ user: { role: 'operator', tenantId: 'tenant-acme', plan: 'pro' } });

      const clientMod = await requireModuleOrFail('src/services/microservicesClient.js', 'M4');
      expect(typeof clientMod.microservicesApi.archiveTermToVps).toBe('function');

      const res = await clientMod.microservicesApi.archiveTermToVps('term-55');
      expect(res.archived).toBe(true);
      expect(res.virtualPath).toContain('/Cofre-TI-Infra/Termos/');

      const postReq = mockFetch.requests.find(
        (r) => r.method === 'POST' && r.pathname === '/api/v1/compliance/terms/term-55/archive-vps',
      );
      expect(postReq).toBeDefined();
      expect(postReq.authorization).toBe(`Bearer ${token}`);
    });

    it('F30-T1-02: ServiceDeskHub.jsx renders "Arquivar cópia na VPS" for signed CLT terms', async () => {
      mockFetch = installMockFetch(buildTermMockRoutes());
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
        expect(screen.getByText('Maria Souza')).toBeInTheDocument();
      });

      const btns = findArchiveButtons();
      expect(btns.length).toBeGreaterThanOrEqual(1);
      expect(btns[0]).toBeEnabled();
    });

    it('F30-T1-03: clicking "Arquivar cópia na VPS" in ServiceDeskHub archives signed term to /Cofre-TI-Infra/Termos', async () => {
      let resolveArchive;
      const deferred = new Promise((r) => {
        resolveArchive = r;
      });

      mockFetch = installMockFetch(
        buildTermMockRoutes({
          onArchiveTerm: async (id) => {
            await deferred;
            return {
              status: 200,
              json: { archived: true, virtualPath: `/Cofre-TI-Infra/Termos/termo-${id}.txt`, nodeId: `node-${id}` },
            };
          },
        }),
      );
      mockWs = installMockWebSocket();
      seedReactGatewaySession({ user: { role: 'operator', tenantId: 'tenant-acme', plan: 'pro' } });
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
      await waitFor(() => expect(btn).toBeDisabled());

      resolveArchive();
      await waitFor(() => expect(btn).toBeEnabled());

      expect(
        mockFetch.requests.filter(
          (r) => r.method === 'POST' && r.pathname === '/api/v1/compliance/terms/tm-signed-1/archive-vps',
        ),
      ).toHaveLength(1);
      expect(mockToast.success.mock.calls.flat().join(' ') + document.body.textContent).toMatch(/\/Cofre-TI-Infra\/Termos/);
    });

    it('F30-T1-04: TermsPage.jsx renders "Arquivar cópia na VPS" for signed terms with signedCopy and archives to /Cofre-TI-Infra/Termos', async () => {
      const signedTerm = makeFirestoreTerm();
      mockListTerms.mockResolvedValue([signedTerm]);
      mockFetch = installMockFetch(
        buildTermMockRoutes({
          nodes: [
            { id: 'folder-termos', parentId: null, name: 'Termos', type: 'folder', virtualPath: '/Cofre-TI-Infra/Termos', effectiveAccess: 'full_control' },
          ],
        }),
      );
      seedReactGatewaySession({ user: { role: 'operator', tenantId: 'tenant-acme', plan: 'pro' } });
      mockUseAuth.mockReturnValue({
        currentUser: {
          uid: 'u2',
          role: 'operator',
          tenantId: 'tenant-acme',
          entitlements: { features: { cloud_storage: true } },
        },
      });

      const { ConfirmProvider } = await requireModuleOrFail('src/components/ConfirmDialog.jsx', 'baseline');
      const TermsPage = (await requireModuleOrFail('src/pages/TermsPage.jsx', 'M4')).default;

      render(
        <MemoryRouter initialEntries={['/termos']}>
          <ConfirmProvider>
            <Routes>
              <Route path="/termos" element={<TermsPage />} />
            </Routes>
          </ConfirmProvider>
        </MemoryRouter>,
      );

      // Switch filter to 'Todos' because 'Pendências' hides assinado terms
      fireEvent.click(await screen.findByRole('button', { name: 'Todos' }));

      await waitFor(() => {
        expect(screen.getByText('TR-2026-0001')).toBeInTheDocument();
      });

      const archiveBtns = findArchiveButtons();
      expect(archiveBtns.length).toBeGreaterThanOrEqual(1);
      fireEvent.click(archiveBtns[0]);

      await waitFor(() => {
        const archiveReq = mockFetch.requests.find(
          (r) =>
            r.method === 'POST' &&
            (r.pathname === '/api/v1/storage/upload' || r.pathname.includes('/archive-vps')),
        );
        expect(archiveReq).toBeDefined();
      });
    });

    it('F30-T1-05: post-archive state preserves HMAC Assinado badge and audit verification control in ServiceDeskHub', async () => {
      mockFetch = installMockFetch(buildTermMockRoutes());
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

      fireEvent.click(findArchiveButtons()[0]);

      await waitFor(() => {
        expect(mockFetch.requests.some((r) => r.pathname.includes('/archive-vps'))).toBe(true);
      });

      expect(screen.getByText(/HMAC Assinado/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Auditar termo de Maria Souza/i })).toBeEnabled();
    });
  });

  describe('Tier 2 — Unsigned Rejection, RBAC/Plan Guards, Failures & Concurrency', () => {
    it('F30-T2-01: unsigned/pending CLT terms cannot be archived in ServiceDeskHub (disabled/hidden & 400 TERM_NOT_SIGNED)', async () => {
      mockFetch = installMockFetch(
        buildTermMockRoutes({
          gatewayTerms: [
            { id: 'tm-pend-1', employee_name: 'João Pendente', document_hash: 'sha256-pend', status: 'pending' },
          ],
          onArchiveTerm: () => ({
            status: 400,
            json: { error: 'TERM_NOT_SIGNED', message: 'Termo ainda não foi assinado pelo colaborador.' },
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
        expect(screen.getByText('João Pendente')).toBeInTheDocument();
      });

      const btns = findArchiveButtons();
      if (btns.length > 0) {
        expect(btns.every((b) => b.disabled)).toBe(true);
      }
      expect(mockFetch.requests.some((r) => r.pathname.includes('/archive-vps'))).toBe(false);
    });

    it('F30-T2-02: TermsPage.jsx blocks/hides archive action for pendente, em_transito, and cancelado terms', async () => {
      mockListTerms.mockResolvedValue([
        makeFirestoreTerm({ id: 'tm-p', number: 'TR-2026-P001', status: 'pendente', signedCopy: null }),
        makeFirestoreTerm({ id: 'tm-t', number: 'TT-2026-T001', kind: 'transferencia', status: 'em_transito', signedCopy: null }),
        makeFirestoreTerm({ id: 'tm-c', number: 'TR-2026-C001', status: 'cancelado', signedCopy: null }),
      ]);
      mockFetch = installMockFetch(buildTermMockRoutes());
      seedReactGatewaySession({ user: { role: 'owner', tenantId: 'tenant-acme', plan: 'pro' } });
      mockUseAuth.mockReturnValue({
        currentUser: {
          uid: 'u1',
          role: 'owner',
          tenantId: 'tenant-acme',
          entitlements: { features: { cloud_storage: true } },
        },
      });

      const { ConfirmProvider } = await requireModuleOrFail('src/components/ConfirmDialog.jsx', 'baseline');
      const TermsPage = (await requireModuleOrFail('src/pages/TermsPage.jsx', 'M4')).default;

      render(
        <MemoryRouter initialEntries={['/termos']}>
          <ConfirmProvider>
            <Routes>
              <Route path="/termos" element={<TermsPage />} />
            </Routes>
          </ConfirmProvider>
        </MemoryRouter>,
      );

      fireEvent.click(await screen.findByRole('button', { name: 'Todos' }));
      await waitFor(() => {
        expect(screen.getByText('TR-2026-P001')).toBeInTheDocument();
        expect(screen.getByText('TR-2026-C001')).toBeInTheDocument();
      });

      const btns = findArchiveButtons();
      if (btns.length > 0) {
        expect(btns.every((b) => b.disabled)).toBe(true);
      }
    });

    it('F30-T2-03: handles VPS_NOT_CONFIGURED (412/400) cleanly in ServiceDeskHub and TermsPage', async () => {
      mockFetch = installMockFetch(
        buildTermMockRoutes({
          onArchiveTerm: () => ({
            status: 412,
            json: { error: 'VPS_NOT_CONFIGURED', message: 'VPS não configurada.' },
          }),
          onUpload: () => ({
            status: 412,
            json: { error: 'VPS_NOT_CONFIGURED', message: 'VPS não configurada.' },
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

      await waitFor(() => expect(findArchiveButtons().length).toBeGreaterThanOrEqual(1));
      const btn = findArchiveButtons()[0];
      fireEvent.click(btn);

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalled();
        expect(btn).toBeEnabled();
      });
      expect(mockToast.error.mock.calls.flat().join(' ')).toMatch(/VPS/i);
    });

    it('F30-T2-04: enforces viewer role, starter plan, and superadmin Zero-Knowledge blocks on term archive', async () => {
      mockListTerms.mockResolvedValue([makeFirestoreTerm()]);
      mockFetch = installMockFetch(
        buildTermMockRoutes({
          onArchiveTerm: () => ({
            status: 403,
            json: { error: 'ZERO_KNOWLEDGE_RESTRICTED', message: 'Superadmin bloqueado.' },
          }),
        }),
      );
      seedReactGatewaySession({ user: { role: 'viewer', tenantId: 'tenant-acme', plan: 'starter' } });
      mockUseAuth.mockReturnValue({
        currentUser: {
          uid: 'u-view',
          role: 'viewer',
          tenantId: 'tenant-acme',
          entitlements: { features: { cloud_storage: false } },
        },
      });

      const { ConfirmProvider } = await requireModuleOrFail('src/components/ConfirmDialog.jsx', 'baseline');
      const TermsPage = (await requireModuleOrFail('src/pages/TermsPage.jsx', 'M4')).default;

      render(
        <MemoryRouter initialEntries={['/termos']}>
          <ConfirmProvider>
            <Routes>
              <Route path="/termos" element={<TermsPage />} />
            </Routes>
          </ConfirmProvider>
        </MemoryRouter>,
      );

      fireEvent.click(await screen.findByRole('button', { name: 'Todos' }));
      await waitFor(() => expect(screen.getByText('TR-2026-0001')).toBeInTheDocument());

      const btns = findArchiveButtons();
      if (btns.length > 0) {
        expect(btns.every((b) => b.disabled)).toBe(true);
      }
      expect(mockFetch.requests.some((r) => r.pathname.includes('/archive-vps') || r.pathname.includes('/storage/upload'))).toBe(false);
    });

    it('F30-T2-05: concurrency double-click guard in ServiceDeskHub and loadSignedCopy failure recovery in TermsPage', async () => {
      // Part 1: loadSignedCopy failure in TermsPage resets busy state & shows error toast
      mockListTerms.mockResolvedValue([makeFirestoreTerm()]);
      mockLoadSignedCopy.mockRejectedValueOnce(new Error('Falha ao ler anexo assinado'));
      mockFetch = installMockFetch(buildTermMockRoutes());
      seedReactGatewaySession({ user: { role: 'operator', tenantId: 'tenant-acme', plan: 'pro' } });
      mockUseAuth.mockReturnValue({
        currentUser: {
          uid: 'u2',
          role: 'operator',
          tenantId: 'tenant-acme',
          entitlements: { features: { cloud_storage: true } },
        },
      });

      const { ConfirmProvider } = await requireModuleOrFail('src/components/ConfirmDialog.jsx', 'baseline');
      const TermsPage = (await requireModuleOrFail('src/pages/TermsPage.jsx', 'M4')).default;

      const { unmount } = render(
        <MemoryRouter initialEntries={['/termos']}>
          <ConfirmProvider>
            <Routes>
              <Route path="/termos" element={<TermsPage />} />
            </Routes>
          </ConfirmProvider>
        </MemoryRouter>,
      );

      fireEvent.click(await screen.findByRole('button', { name: 'Todos' }));
      await waitFor(() => expect(findArchiveButtons().length).toBeGreaterThanOrEqual(1));
      const fsBtn = findArchiveButtons()[0];
      fireEvent.click(fsBtn);

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalled();
        expect(fsBtn).toBeEnabled();
      });
      unmount();

      // Part 2: Double-click guard in ServiceDeskHub
      let resolveArchive;
      const deferred = new Promise((r) => {
        resolveArchive = r;
      });
      mockFetch.setHandler(
        buildTermMockRoutes({
          onArchiveTerm: async (id) => {
            await deferred;
            return { status: 200, json: { archived: true, virtualPath: `/Cofre-TI-Infra/Termos/termo-${id}.txt` } };
          },
        }),
      );
      mockWs = installMockWebSocket();
      const ServiceDeskHub = (await requireModuleOrFail('src/pages/ServiceDeskHub.jsx', 'M4')).default;

      render(
        <ConfirmProvider>
          <ServiceDeskHub />
        </ConfirmProvider>,
      );

      await waitFor(() => expect(findArchiveButtons().length).toBeGreaterThanOrEqual(1));
      const sdBtn = findArchiveButtons()[0];
      fireEvent.click(sdBtn);
      fireEvent.click(sdBtn);

      await waitFor(() => expect(sdBtn).toBeDisabled());
      resolveArchive();
      await waitFor(() => expect(sdBtn).toBeEnabled());

      expect(
        mockFetch.requests.filter(
          (r) => r.method === 'POST' && r.pathname === '/api/v1/compliance/terms/tm-signed-1/archive-vps',
        ),
      ).toHaveLength(1);
    });
  });
});
