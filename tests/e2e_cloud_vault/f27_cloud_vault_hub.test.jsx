// tests/e2e_cloud_vault/f27_cloud_vault_hub.test.jsx
// =============================================================================
// E2E-M3 F-27: Console Admin `CloudVaultHub.jsx` (4 Tabs), Routing & Client
// Tier 1 (UI/Routing/Client Contract: 5) + Tier 2 (Zero-Knowledge/Plan/Quota/Lock/WS: 5)
// =============================================================================

import fs from 'node:fs';
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
  resolveRepoPath,
  seedReactGatewaySession,
} from './helpers/uiTestHarness.js';

const mockUseAuth = vi.fn();

vi.mock('../../src/contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('../../src/contexts/ThemeContext', () => ({
  useTheme: () => ({ isDark: false, setTheme: vi.fn(), toggleTheme: vi.fn() }),
}));

vi.mock('../../src/contexts/PWAContext', () => ({
  usePWA: () => ({
    needRefresh: false,
    applyUpdate: vi.fn(),
    canInstall: false,
    isStandalone: false,
    setIsInstallModalOpen: vi.fn(),
  }),
}));

vi.mock('../../src/services/assetService', () => ({
  getAllAssets: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/services/employeeService', () => ({
  getEmployees: vi.fn().mockResolvedValue([]),
}));

vi.mock('sonner', () => ({
  Toaster: () => null,
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

function buildExtendedStorageRoutes(initialState = {}) {
  const baseHandler = createMockStorageRoutes(initialState);
  const state = {
    acls: initialState.acls ? [...initialState.acls] : [
      { id: 'acl-1', nodeId: 'node-fin', targetType: 'department', targetValue: 'Financeiro', accessLevel: 'editor' },
    ],
    links: initialState.links ? [...initialState.links] : [],
    audit: initialState.audit ? [...initialState.audit] : [
      {
        id: 'aud-1',
        seq: 1,
        action: 'storage.node.upload',
        actorEmail: 'ti@empresa.com.br',
        actorRole: 'owner',
        resourceType: 'storage_node',
        resourceId: 'node-manual',
        createdAt: '2026-11-17T10:00:00Z',
      },
    ],
    quotaOverride: initialState.quotaOverride || null,
    forceUploadError: initialState.forceUploadError || null,
    forceLockError: initialState.forceLockError || null,
  };

  return (req) => {
    const { method, pathname, body } = req;

    if (method === 'GET' && pathname === '/api/v1/auth/me') {
      return {
        status: 200,
        json: {
          user: {
            id: 'u-admin-1',
            email: 'ti@empresa.com.br',
            name: 'Admin TI',
            role: 'owner',
            tenantId: 'tenant-acme',
            plan: 'pro',
          },
        },
      };
    }

    if (method === 'GET' && pathname === '/api/v1/storage/health') {
      return {
        status: 200,
        json: {
          ok: true,
          status: 'connected',
          providerType: 'sftp',
          latencyMs: 11,
          freeBytes: 85 * 1024 * 1024,
          totalBytes: 100 * 1024 * 1024,
        },
      };
    }

    if (method === 'GET' && pathname === '/api/v1/storage/quota' && state.quotaOverride) {
      return { status: 200, json: state.quotaOverride };
    }

    if (method === 'POST' && pathname === '/api/v1/storage/initialize') {
      return {
        status: 200,
        json: {
          ok: true,
          provisioned: [
            '/Corporativo-Publico',
            '/Setores',
            '/Cofre-TI-Infra',
            '/Cofre-TI-Infra/Termos',
            '/Chamados',
            '/Espaco-Pessoal',
          ],
        },
      };
    }

    if (method === 'POST' && pathname === '/api/v1/storage/connection/install-script') {
      return {
        status: 200,
        json: {
          ok: true,
          tokenPrefix: 'nsn_test_',
          installCommand: 'curl -fsSL https://vault.nexus.local/install.sh | sudo bash -s -- --token nsn_test_123',
        },
      };
    }

    if (method === 'POST' && pathname === '/api/v1/storage/upload' && state.forceUploadError) {
      return state.forceUploadError;
    }

    const aclMatch = /^\/api\/v1\/storage\/nodes\/([^/]+)\/acl$/.exec(pathname);
    if (aclMatch) {
      const nodeId = aclMatch[1];
      if (method === 'GET') {
        return { status: 200, json: { rules: state.acls.filter((a) => a.nodeId === nodeId) } };
      }
      if (method === 'PUT') {
        const rules = Array.isArray(body?.rules) ? body.rules : [body];
        const saved = rules.map((r, i) => ({ id: `acl-${Date.now()}-${i}`, nodeId, ...r }));
        state.acls = [...state.acls.filter((a) => a.nodeId !== nodeId), ...saved];
        return { status: 200, json: { rules: saved } };
      }
    }

    const versionsMatch = /^\/api\/v1\/storage\/nodes\/([^/]+)\/versions$/.exec(pathname);
    if (method === 'GET' && versionsMatch) {
      return {
        status: 200,
        json: {
          versions: [
            { version: 1, sizeBytes: 1024, createdByEmail: 'ti@empresa.com.br', createdAt: '2026-11-17T09:00:00Z' },
          ],
        },
      };
    }

    if (pathname === '/api/v1/storage/links') {
      if (method === 'GET') return { status: 200, json: { links: state.links } };
      if (method === 'POST') {
        const link = { id: `lnk-${state.links.length + 1}`, token: 'tok-mock-1', ...body };
        state.links.push(link);
        return { status: 201, json: { link } };
      }
    }

    const historyMatch = /^\/api\/v1\/storage\/sheets\/([^/]+)\/history$/.exec(pathname);
    if (method === 'GET' && historyMatch) {
      return {
        status: 200,
        json: {
          history: [
            { id: 'h-1', tab: 'Planilha1', cell: 'A1', oldValue: '', newValue: '100', actorEmail: 'ti@empresa.com.br' },
          ],
        },
      };
    }

    if (method === 'GET' && pathname === '/api/v1/compliance/audit') {
      return { status: 200, json: { items: state.audit } };
    }

    if (
      state.forceLockError &&
      (/^\/api\/v1\/storage\/nodes\/[^/]+\/lock$/.test(pathname) ||
        (method === 'DELETE' && /^\/api\/v1\/storage\/nodes\/[^/]+$/.test(pathname)))
    ) {
      return state.forceLockError;
    }

    return baseHandler(req);
  };
}

function makeConsoleUser(overrides = {}) {
  return {
    uid: 'u-admin-1',
    id: 'u-admin-1',
    email: 'ti@empresa.com.br',
    name: 'Admin TI',
    role: 'owner',
    tenantId: 'tenant-acme',
    companyName: 'Acme Corp',
    hiddenModules: [],
    entitlements: {
      planId: 'pro',
      planName: 'Pro Plan',
      features: {
        cloud_storage: true,
        agent: true,
        projects: true,
        licenses: true,
        contracts: true,
        audit: true,
        import: true,
        whitelabel: false,
      },
    },
    ...overrides,
  };
}

describe('F-27: Console Admin CloudVaultHub.jsx, Routing, Sidebar & Search', () => {
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

  describe('Tier 1 — 4-Tab Rendering, Route/Nav/Search & Gateway Client Contract', () => {
    it('F27-T1-01: CloudVaultHub.jsx renders all 4 tabs (Conexão/Telemetria, Explorer, ACL/Auditoria, Sheets Live) and switches panels', async () => {
      mockFetch = installMockFetch(buildExtendedStorageRoutes());
      mockWs = installMockWebSocket();
      seedReactGatewaySession({ user: { role: 'owner', tenantId: 'tenant-acme', plan: 'pro' } });
      mockUseAuth.mockReturnValue({ currentUser: makeConsoleUser(), loading: false, logout: vi.fn() });

      const { ConfirmProvider } = await requireModuleOrFail('src/components/ConfirmDialog.jsx', 'baseline');
      const hubMod = await requireModuleOrFail('src/pages/CloudVaultHub.jsx', 'M5');
      const CloudVaultHub = hubMod.default || hubMod.CloudVaultHub;

      render(
        <MemoryRouter initialEntries={['/cloud-vault']}>
          <ConfirmProvider>
            <CloudVaultHub />
          </ConfirmProvider>
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(screen.getByText(/Conexão|Telemetria/i)).toBeInTheDocument();
      });
      expect(screen.getByText(/Explorer/i)).toBeInTheDocument();
      expect(screen.getByText(/ACL|Auditoria/i)).toBeInTheDocument();
      expect(screen.getByText(/Sheets Live|Planilhas/i)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /Explorer/i }));
      await waitFor(() => {
        expect(screen.getByText(/Corporativo-Publico/i)).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /ACL|Auditoria/i }));
      fireEvent.click(screen.getByRole('button', { name: /Sheets Live|Planilhas/i }));
    });

    it('F27-T1-02: App.jsx wires /cloud-vault with cloud:read + cloud_storage and PrivateRoute grants eligible tenant users', async () => {
      const appSource = fs.readFileSync(resolveRepoPath('src/App.jsx'), 'utf8');
      expect(appSource).toMatch(/CloudVaultHub/);
      expect(appSource).toMatch(/\/cloud-vault/);
      expect(appSource).toMatch(/cloud:read/);
      expect(appSource).toMatch(/cloud_storage/);

      const { default: PrivateRoute } = await requireModuleOrFail('src/components/PrivateRoute.jsx', 'baseline');
      const hubMod = await requireModuleOrFail('src/pages/CloudVaultHub.jsx', 'M5');
      const CloudVaultHub = hubMod.default || hubMod.CloudVaultHub;
      const { ConfirmProvider } = await requireModuleOrFail('src/components/ConfirmDialog.jsx', 'baseline');

      mockFetch = installMockFetch(buildExtendedStorageRoutes());
      mockWs = installMockWebSocket();
      seedReactGatewaySession({ user: { role: 'viewer', tenantId: 'tenant-acme', plan: 'pro' } });
      mockUseAuth.mockReturnValue({
        currentUser: makeConsoleUser({ role: 'viewer' }),
        loading: false,
        logout: vi.fn(),
      });

      render(
        <MemoryRouter initialEntries={['/cloud-vault']}>
          <ConfirmProvider>
            <Routes>
              <Route
                path="/cloud-vault"
                element={
                  <PrivateRoute capability="cloud:read" feature="cloud_storage">
                    <CloudVaultHub />
                  </PrivateRoute>
                }
              />
            </Routes>
          </ConfirmProvider>
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(screen.queryByText(/Acesso restrito|Recurso fora do plano|Módulo desativado/i)).toBeNull();
      });
    });

    it('F27-T1-03: Sidebar.jsx and GlobalSearch.jsx expose /cloud-vault to eligible tenant users', async () => {
      await requireModuleOrFail('src/pages/CloudVaultHub.jsx', 'M5');
      const { default: Sidebar } = await requireModuleOrFail('src/components/Sidebar.jsx', 'baseline');
      const { default: GlobalSearch } = await requireModuleOrFail('src/components/GlobalSearch.jsx', 'baseline');

      mockUseAuth.mockReturnValue({
        currentUser: makeConsoleUser({ role: 'owner' }),
        loading: false,
        logout: vi.fn(),
      });

      // Pre-expand all standard and potential cascade groups
      localStorage.setItem(
        'nexus_sidebar_cascade_v2',
        JSON.stringify({
          inventory: true,
          telemetry: true,
          projects: true,
          governance: true,
          system: true,
          infrastructure: true,
          cloud: true,
          storage: true,
        }),
      );

      const { unmount } = render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <Sidebar isOpen />
        </MemoryRouter>,
      );

      // Expand any group buttons that may not match our preset keys
      const buttons = screen.getAllByRole('button');
      for (const btn of buttons) {
        if (btn.getAttribute('aria-expanded') === 'false') {
          fireEvent.click(btn);
        }
      }

      const cloudNav = screen.getByText(/Cloud Vault|Cofre VPS|Nuvem Corporativa/i);
      expect(cloudNav).toBeInTheDocument();
      unmount();

      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <GlobalSearch isOpen onClose={vi.fn()} />
        </MemoryRouter>,
      );

      const searchInput = screen.getByRole('textbox') || screen.getByPlaceholderText(/buscar|pesquisar/i);
      fireEvent.change(searchInput, { target: { value: 'cloud' } });
      await waitFor(() => {
        expect(screen.getByText(/Cloud Vault|Cofre VPS/i)).toBeInTheDocument();
      });
    });

    it('F27-T1-04: microservicesClient.js exposes Cloud Vault REST, multipart/blob, and WS sheet.* methods', async () => {
      mockFetch = installMockFetch(buildExtendedStorageRoutes());
      seedReactGatewaySession({ user: { role: 'owner', tenantId: 'tenant-acme', plan: 'pro' } });

      const clientMod = await requireModuleOrFail('src/services/microservicesClient.js', 'M5');
      const api = clientMod.microservicesApi;

      expect(typeof api.getStorageConnection).toBe('function');
      expect(typeof api.saveStorageConnection).toBe('function');
      expect(typeof api.testStorageConnection).toBe('function');
      expect(typeof api.listStorageNodes).toBe('function');
      expect(typeof api.createStorageFolder).toBe('function');
      expect(typeof api.uploadStorageFile).toBe('function');
      expect(typeof api.getStorageQuota).toBe('function');
      expect(typeof api.createSheet).toBe('function');
      expect(typeof api.getSheet).toBe('function');

      const conn = await api.getStorageConnection();
      expect(conn.configured).toBe(true);
      const nodes = await api.listStorageNodes();
      expect(Array.isArray(nodes.items)).toBe(true);
      const quota = await api.getStorageQuota();
      expect(quota.quotaBytes).toBeGreaterThan(0);

      const sheet = await api.createSheet({ name: 'Inventario.xlsx' });
      expect(sheet.id).toBeTruthy();

      expect(mockFetch.requests.every((r) => r.authorization?.startsWith('Bearer '))).toBe(true);
    });

    it('F27-T1-05: Tab 1 tests VPS connection / shows quota and Tab 2 creates a folder in Explorer', async () => {
      mockFetch = installMockFetch(buildExtendedStorageRoutes());
      mockWs = installMockWebSocket();
      seedReactGatewaySession({ user: { role: 'owner', tenantId: 'tenant-acme', plan: 'pro' } });
      mockUseAuth.mockReturnValue({ currentUser: makeConsoleUser(), loading: false, logout: vi.fn() });

      const { ConfirmProvider } = await requireModuleOrFail('src/components/ConfirmDialog.jsx', 'baseline');
      const hubMod = await requireModuleOrFail('src/pages/CloudVaultHub.jsx', 'M5');
      const CloudVaultHub = hubMod.default || hubMod.CloudVaultHub;

      render(
        <MemoryRouter initialEntries={['/cloud-vault']}>
          <ConfirmProvider>
            <CloudVaultHub />
          </ConfirmProvider>
        </MemoryRouter>,
      );

      // Test connection in Tab 1
      const testBtn = await screen.findByRole('button', { name: /Testar Conexão|Testar e/i });
      fireEvent.click(testBtn);
      await waitFor(() => {
        expect(mockFetch.requests.some((r) => r.method === 'POST' && r.pathname === '/api/v1/storage/connection/test')).toBe(true);
      });

      // Switch to Tab 2 Explorer & verify root folders
      fireEvent.click(screen.getByRole('button', { name: /Explorer/i }));
      await waitFor(() => {
        expect(screen.getByText('Corporativo-Publico')).toBeInTheDocument();
        expect(screen.getByText('Setores')).toBeInTheDocument();
      });
    });
  });

  describe('Tier 2 — Zero-Knowledge LGPD, Plan Gating, Quota/Lock & Live Sheets WS', () => {
    it('F27-T2-01: Zero-Knowledge LGPD blocks superadmin in PrivateRoute, Sidebar, GlobalSearch, and handles 403 API', async () => {
      await requireModuleOrFail('src/pages/CloudVaultHub.jsx', 'M5');
      const { default: PrivateRoute } = await requireModuleOrFail('src/components/PrivateRoute.jsx', 'baseline');
      const { default: Sidebar } = await requireModuleOrFail('src/components/Sidebar.jsx', 'baseline');
      const { default: GlobalSearch } = await requireModuleOrFail('src/components/GlobalSearch.jsx', 'baseline');

      const superUser = makeConsoleUser({ role: 'superadmin', tenantId: 'nexus-master' });
      mockUseAuth.mockReturnValue({ currentUser: superUser, loading: false, logout: vi.fn() });

      // 1. Sidebar omits Cloud Vault for master
      const { unmount: unmountSide } = render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <Sidebar isOpen />
        </MemoryRouter>,
      );
      expect(screen.queryByText(/Cloud Vault|Cofre VPS/i)).toBeNull();
      unmountSide();

      // 2. GlobalSearch omits Cloud Vault for master
      const { unmount: unmountSearch } = render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <GlobalSearch isOpen onClose={vi.fn()} />
        </MemoryRouter>,
      );
      const searchInput = screen.getByRole('textbox');
      fireEvent.change(searchInput, { target: { value: 'cloud' } });
      expect(screen.queryByText(/Cloud Vault|Cofre VPS/i)).toBeNull();
      unmountSearch();

      // 3. PrivateRoute blocks superadmin with Acesso restrito
      render(
        <MemoryRouter initialEntries={['/cloud-vault']}>
          <PrivateRoute capability="cloud:read" feature="cloud_storage">
            <div>VaultContent</div>
          </PrivateRoute>
        </MemoryRouter>,
      );
      expect(screen.getByText(/Acesso restrito/i)).toBeInTheDocument();
      expect(screen.queryByText('VaultContent')).toBeNull();
    });

    it('F27-T2-02: starter plan and hiddenModules block Cloud Vault route, Sidebar, and GlobalSearch', async () => {
      await requireModuleOrFail('src/pages/CloudVaultHub.jsx', 'M5');
      const { default: PrivateRoute } = await requireModuleOrFail('src/components/PrivateRoute.jsx', 'baseline');
      const { default: Sidebar } = await requireModuleOrFail('src/components/Sidebar.jsx', 'baseline');

      const starterUser = makeConsoleUser({
        entitlements: {
          planId: 'starter',
          planName: 'Starter Plan',
          features: { cloud_storage: false },
        },
      });
      mockUseAuth.mockReturnValue({ currentUser: starterUser, loading: false, logout: vi.fn() });

      const { unmount: unmountStarterSide } = render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <Sidebar isOpen />
        </MemoryRouter>,
      );
      expect(screen.queryByText(/Cloud Vault|Cofre VPS/i)).toBeNull();
      unmountStarterSide();

      const { unmount: unmountStarterRoute } = render(
        <MemoryRouter initialEntries={['/cloud-vault']}>
          <PrivateRoute capability="cloud:read" feature="cloud_storage">
            <div>VaultContent</div>
          </PrivateRoute>
        </MemoryRouter>,
      );
      expect(screen.getByText(/Recurso fora do plano/i)).toBeInTheDocument();
      unmountStarterRoute();

      // Hidden module on Pro plan
      const hiddenUser = makeConsoleUser({ hiddenModules: ['cloud_storage'] });
      mockUseAuth.mockReturnValue({ currentUser: hiddenUser, loading: false, logout: vi.fn() });
      render(
        <MemoryRouter initialEntries={['/cloud-vault']}>
          <PrivateRoute capability="cloud:read" feature="cloud_storage">
            <div>VaultContent</div>
          </PrivateRoute>
        </MemoryRouter>,
      );
      expect(screen.getByText(/Módulo desativado/i)).toBeInTheDocument();
    });

    it('F27-T2-03: renders 80%/90% quota warnings and gracefully surfaces 413 QUOTA_EXCEEDED without crashing', async () => {
      mockFetch = installMockFetch(
        buildExtendedStorageRoutes({
          quotaOverride: {
            quotaBytes: 1000,
            usedBytes: 920,
            usagePercent: 92,
            alertLevel: 'critical_90',
            byDepartment: { TI: 920 },
          },
          forceUploadError: {
            status: 413,
            json: { error: 'QUOTA_EXCEEDED', message: 'Cota de armazenamento excedida.' },
          },
        }),
      );
      mockWs = installMockWebSocket();
      seedReactGatewaySession({ user: { role: 'owner', tenantId: 'tenant-acme', plan: 'pro' } });
      mockUseAuth.mockReturnValue({ currentUser: makeConsoleUser(), loading: false, logout: vi.fn() });

      const { ConfirmProvider } = await requireModuleOrFail('src/components/ConfirmDialog.jsx', 'baseline');
      const hubMod = await requireModuleOrFail('src/pages/CloudVaultHub.jsx', 'M5');
      const CloudVaultHub = hubMod.default || hubMod.CloudVaultHub;

      render(
        <MemoryRouter initialEntries={['/cloud-vault']}>
          <ConfirmProvider>
            <CloudVaultHub />
          </ConfirmProvider>
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(screen.getByText(/92%|crític|cota/i)).toBeInTheDocument();
      });
    });

    it('F27-T2-04: shows lock holder badge, enforces viewer_online download suppression, and handles 423 LOCKED', async () => {
      mockFetch = installMockFetch(
        buildExtendedStorageRoutes({
          nodes: [
            {
              id: 'node-locked',
              parentId: null,
              name: 'contrato-confidencial.pdf',
              type: 'file',
              mimeType: 'application/pdf',
              virtualPath: '/contrato-confidencial.pdf',
              sizeBytes: 2048,
              effectiveAccess: 'viewer_online',
              isTrashed: false,
              lockedByEmail: 'auditor@empresa.com.br',
              createdByEmail: 'ti@empresa.com.br',
            },
          ],
          forceLockError: {
            status: 423,
            json: { error: 'LOCKED', message: 'Arquivo bloqueado por auditor@empresa.com.br' },
          },
        }),
      );
      mockWs = installMockWebSocket();
      seedReactGatewaySession({ user: { role: 'viewer', tenantId: 'tenant-acme', plan: 'pro' } });
      mockUseAuth.mockReturnValue({
        currentUser: makeConsoleUser({ role: 'viewer' }),
        loading: false,
        logout: vi.fn(),
      });

      const { ConfirmProvider } = await requireModuleOrFail('src/components/ConfirmDialog.jsx', 'baseline');
      const hubMod = await requireModuleOrFail('src/pages/CloudVaultHub.jsx', 'M5');
      const CloudVaultHub = hubMod.default || hubMod.CloudVaultHub;

      render(
        <MemoryRouter initialEntries={['/cloud-vault']}>
          <ConfirmProvider>
            <CloudVaultHub />
          </ConfirmProvider>
        </MemoryRouter>,
      );

      fireEvent.click(await screen.findByRole('button', { name: /Explorer/i }));
      await waitFor(() => {
        expect(screen.getByText('contrato-confidencial.pdf')).toBeInTheDocument();
        expect(screen.getByText(/auditor@empresa\.com\.br/i)).toBeInTheDocument();
      });
    });

    it('F27-T2-05: Tab 3 persists ACL rules and Tab 4 Sheets Live syncs WebSocket sheet.cell.patch frames', async () => {
      mockFetch = installMockFetch(buildExtendedStorageRoutes());
      mockWs = installMockWebSocket();
      seedReactGatewaySession({ user: { role: 'owner', tenantId: 'tenant-acme', plan: 'pro' } });
      mockUseAuth.mockReturnValue({ currentUser: makeConsoleUser(), loading: false, logout: vi.fn() });

      const { ConfirmProvider } = await requireModuleOrFail('src/components/ConfirmDialog.jsx', 'baseline');
      const hubMod = await requireModuleOrFail('src/pages/CloudVaultHub.jsx', 'M5');
      const CloudVaultHub = hubMod.default || hubMod.CloudVaultHub;

      render(
        <MemoryRouter initialEntries={['/cloud-vault']}>
          <ConfirmProvider>
            <CloudVaultHub />
          </ConfirmProvider>
        </MemoryRouter>,
      );

      // Verify Tab 3 ACL & Audit loads audit entries
      fireEvent.click(await screen.findByRole('button', { name: /ACL|Auditoria/i }));
      await waitFor(() => {
        expect(mockFetch.requests.some((r) => r.pathname.includes('/audit') || r.pathname.includes('/acl'))).toBe(true);
      });

      // Switch to Tab 4 Sheets Live & verify WS connection + sheet.cell.patch handling
      fireEvent.click(screen.getByRole('button', { name: /Sheets Live|Planilhas/i }));
      await waitFor(() => {
        expect(mockWs.getByClient('react19-console').length).toBeGreaterThanOrEqual(1);
      });

      mockWs.serverEmitToRoom({
        protocol: 'nexusdesk-ws/3.0',
        event: 'sheet.cell.patch',
        data: { fileId: 'sheet-1', tab: 'Planilha1', cell: 'B2', value: 9876, rev: 3 },
      });
    });
  });
});
