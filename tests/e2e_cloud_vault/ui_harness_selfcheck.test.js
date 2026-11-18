// tests/e2e_cloud_vault/ui_harness_selfcheck.test.js
// =============================================================================
// E2E-M1 Self-Verification Suite for Frontend UI/Contract Harness (`uiTestHarness.js`)
// =============================================================================

import { afterEach, describe, expect, it } from 'vitest';
import {
  createMockStorageRoutes,
  inspectVueSfc,
  installMockFetch,
  installMockWebSocket,
  moduleExists,
  mountVueSfc,
  requireModuleOrFail,
  resetBrowserSessions,
  safeDynamicImport,
  seedPortalSession,
  seedReactGatewaySession,
} from './helpers/uiTestHarness.js';

describe('E2E-M1 Frontend UI & Contract Harness Selfcheck', () => {
  afterEach(() => {
    resetBrowserSessions();
  });

  describe('1. safeDynamicImport & requireModuleOrFail', () => {
    it('returns { ok: false, missing: true } cleanly for unimplemented M5/M6 modules without crashing Vitest', async () => {
      expect(moduleExists('src/pages/__nonexistent_m5__.jsx')).toBe(false);
      expect(moduleExists('src/pages/CloudVaultHub.jsx')).toBe(true);

      const missingReact = await safeDynamicImport('src/pages/__nonexistent_m5__.jsx');
      expect(missingReact.ok).toBe(false);
      expect(missingReact.missing).toBe(true);
      expect(missingReact.mod).toBeNull();

      const missingVue = await safeDynamicImport('portal-colaborador/src/components/__nonexistent_m6__.vue');
      expect(missingVue.ok).toBe(false);
      expect(missingVue.missing).toBe(true);

      await expect(requireModuleOrFail('src/pages/__nonexistent_m5__.jsx', 'M5')).rejects.toThrow(/M5/);
    });

    it('loads existing modules (permissions.js, entitlements.js) cleanly', async () => {
      const permsRes = await safeDynamicImport('src/utils/permissions.js');
      expect(permsRes.ok).toBe(true);
      expect(permsRes.missing).toBe(false);
      expect(typeof permsRes.mod.can).toBe('function');

      const entMod = await requireModuleOrFail('src/utils/entitlements.js', 'M1');
      expect(typeof entMod.resolveEntitlements).toBe('function');
    });
  });

  describe('2. inspectVueSfc & mountVueSfc', () => {
    it('returns { ok: false, missing: true } for missing Vue SFC (CorporateCloudDrive.vue)', async () => {
      const inspected = inspectVueSfc('portal-colaborador/src/components/__nonexistent_m6__.vue');
      expect(inspected.ok).toBe(false);
      expect(inspected.missing).toBe(true);

      const mounted = await mountVueSfc('portal-colaborador/src/components/__nonexistent_m6__.vue');
      expect(mounted.ok).toBe(false);
      expect(mounted.missing).toBe(true);
    });

    it('compiles and mounts existing PortalIcon.vue in happy-dom and inspects App.vue', async () => {
      const inspectedIcon = inspectVueSfc('portal-colaborador/src/components/PortalIcon.vue');
      expect(inspectedIcon.ok).toBe(true);
      expect(inspectedIcon.errors).toHaveLength(0);
      expect(inspectedIcon.props).toEqual(expect.arrayContaining(['name', 'size', 'strokeWidth']));

      const mountedIcon = await mountVueSfc('portal-colaborador/src/components/PortalIcon.vue', {
        props: { name: 'shield-check', size: 24 },
      });
      expect(mountedIcon.ok).toBe(true);
      expect(mountedIcon.html()).toContain('<svg');
      expect(mountedIcon.html()).toContain('width="24"');
      mountedIcon.unmount();

      const inspectedApp = inspectVueSfc('portal-colaborador/src/App.vue');
      expect(inspectedApp.ok).toBe(true);
      expect(inspectedApp.apiCalls.length).toBeGreaterThan(0);
    }, 15_000);

    it('mounts App.vue resolving sibling PortalIcon.vue reuse and extensionless relative imports', async () => {
      const mockFetch = installMockFetch((req) => {
        if (req.pathname === '/api/v1/assets' || req.pathname === '/api/v1/compliance/terms' || req.pathname === '/api/v1/tickets') {
          return { status: 200, json: { items: [] } };
        }
        return { status: 200, json: {} };
      });
      const mockWs = installMockWebSocket();
      try {
        seedPortalSession();
        const mountedApp = await mountVueSfc('portal-colaborador/src/App.vue');
        expect(mountedApp.ok).toBe(true);
        await new Promise((r) => setTimeout(r, 50));
        await mountedApp.nextTick();
        const html = mountedApp.html();
        expect(html).toContain('<svg');
        expect(html).not.toContain('data-vue-stub="PortalIcon"');
        mountedApp.unmount();
      } finally {
        mockWs.restore();
        mockFetch.restore();
      }
    }, 15_000);
  });

  describe('3. installMockFetch, createMockStorageRoutes & session seeding', () => {
    it('works end-to-end with microservicesClient.js and enforces superadmin 403 / viewer_online download 403 / quota 413', async () => {
      const mockFetch = installMockFetch(createMockStorageRoutes());
      try {
        const { token } = seedReactGatewaySession({
          user: { role: 'owner', tenantId: 'tenant-acme' },
        });
        const clientMod = await requireModuleOrFail('src/services/microservicesClient.js', 'baseline');

        const nodes = await clientMod.gatewayRequest('/api/v1/storage/nodes');
        expect(Array.isArray(nodes.items)).toBe(true);
        expect(nodes.items.some((n) => n.name === 'Corporativo-Publico')).toBe(true);

        const archiveTicket = await clientMod.gatewayRequest('/api/v1/tickets/tkt-99/archive-vps', {
          method: 'POST',
          body: {},
        });
        expect(archiveTicket.archived).toBe(true);
        expect(archiveTicket.folderPath).toBe('/Chamados/tkt-99/');

        expect(mockFetch.requests[0].authorization).toBe(`Bearer ${token}`);

        // Verify superadmin Zero-Knowledge 403 enforcement in mock routes
        seedReactGatewaySession({
          user: { role: 'superadmin', tenantId: 'nexus-master' },
        });
        await expect(clientMod.gatewayRequest('/api/v1/storage/connection')).rejects.toThrow(/Zero-Knowledge/i);

        // Verify viewer_online download 403 & inline preview 200
        const previewRes = await fetch('http://localhost:8000/api/v1/storage/nodes/node-manual/preview', {
          headers: { Authorization: `Bearer ${token}` },
        });
        expect(previewRes.status).toBe(200);
        expect(previewRes.headers.get('content-disposition')).toContain('inline');

        const blockedDownload = await fetch('http://localhost:8000/api/v1/storage/nodes/node-manual/download', {
          headers: { Authorization: `Bearer ${token}` },
        });
        expect(blockedDownload.status).toBe(403);

        // Verify starter plan gating (403 FEATURE_NOT_IN_PLAN)
        const starterSession = seedReactGatewaySession({
          user: { role: 'owner', tenantId: 'tenant-starter', plan: 'starter' },
        });
        const starterRes = await fetch('http://localhost:8000/api/v1/storage/nodes', {
          headers: { Authorization: `Bearer ${starterSession.token}` },
        });
        expect(starterRes.status).toBe(403);
        expect((await starterRes.json()).error).toBe('FEATURE_NOT_IN_PLAN');

        // Verify lock-holder / admin check on DELETE /lock
        const lockRes = await fetch('http://localhost:8000/api/v1/storage/nodes/node-manual/lock', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        expect(lockRes.status).toBe(200);

        const colabSession = seedPortalSession({
          user: { email: 'outro.colab@empresa.com.br', role: 'collaborator' },
        });
        const colabUnlockRes = await fetch('http://localhost:8000/api/v1/storage/nodes/node-manual/lock', {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${colabSession.token}` },
        });
        expect(colabUnlockRes.status).toBe(423);

        const ownerUnlockRes = await fetch('http://localhost:8000/api/v1/storage/nodes/node-manual/lock', {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        expect(ownerUnlockRes.status).toBe(200);
      } finally {
        mockFetch.restore();
      }
    });

    it('works end-to-end with portalApi (nexusApi.js) and triggers unauthorizedHandler on 401', async () => {
      let sawUnauthorized = false;
      const mockFetch = installMockFetch((req) => {
        if (req.pathname === '/api/v1/assets') {
          return { status: 200, json: { items: [{ id: 'a1', hostname: 'NB-TEST-01' }] } };
        }
        if (req.pathname === '/api/v1/tickets') {
          return { status: 401, json: { message: 'Sessão expirada' } };
        }
        return { status: 404, json: { error: 'NOT_FOUND' } };
      });

      try {
        const { token } = seedPortalSession();
        const portalMod = await requireModuleOrFail('portal-colaborador/src/services/nexusApi.js', 'baseline');
        portalMod.setUnauthorizedHandler(() => {
          sawUnauthorized = true;
        });

        const assets = await portalMod.portalApi.listMyAssets();
        expect(assets.items).toHaveLength(1);
        expect(mockFetch.requests[0].authorization).toBe(`Bearer ${token}`);

        await expect(portalMod.portalApi.listMyTickets()).rejects.toThrow(/Sessão expirada/i);
        expect(sawUnauthorized).toBe(true);
      } finally {
        mockFetch.restore();
      }
    });
  });

  describe('4. installMockWebSocket multi-client sheet.* frame dispatch', () => {
    it('supports simultaneous React Console + Vue Portal WebSocket clients and sheet.* frame broadcast', async () => {
      const mockWs = installMockWebSocket();
      try {
        const reactMod = await requireModuleOrFail('src/services/microservicesClient.js', 'baseline');
        const portalMod = await requireModuleOrFail('portal-colaborador/src/services/nexusApi.js', 'baseline');

        const reactFrames = [];
        const vueFrames = [];

        const reactSock = reactMod.microservicesApi.openNexusDeskSocket(
          'jwt-react-1',
          { onFrame: (frame) => reactFrames.push(frame) },
        );
        const vueSock = portalMod.portalApi.connectRealtimeStream(
          'jwt-vue-1',
          (frame) => vueFrames.push(frame),
        );

        // Allow microtask queue to open sockets and emit welcome
        await new Promise((r) => setTimeout(r, 15));

        expect(mockWs.getByClient('react19-console')).toHaveLength(1);
        expect(mockWs.getByClient('vue3-portal')).toHaveLength(1);
        expect(reactFrames.some((f) => f.event === 'welcome')).toBe(true);
        expect(vueFrames.some((f) => f.event === 'welcome')).toBe(true);

        // Simulate sending a sheet.cell.patch from React WS instance and broadcasting to room
        const reactWsInstance = mockWs.getByClient('react19-console')[0];
        reactWsInstance.send(
          JSON.stringify({
            action: 'sheet.cell.patch',
            fileId: 'sheet-1',
            tab: 'Planilha1',
            cell: 'C12',
            value: 4200,
            formula: '=SOMA(C2:C11)',
            baseRev: 1,
          }),
        );

        expect(mockWs.sentFrames(reactWsInstance)[0].action).toBe('sheet.cell.patch');

        mockWs.serverEmitToRoom({
          protocol: 'nexusdesk-ws/3.0',
          event: 'sheet.cell.patch',
          data: { fileId: 'sheet-1', tab: 'Planilha1', cell: 'C12', value: 4200, rev: 2 },
        });

        expect(reactFrames.some((f) => f.event === 'sheet.cell.patch' && f.data?.rev === 2)).toBe(true);
        expect(vueFrames.some((f) => f.event === 'sheet.cell.patch' && f.data?.rev === 2)).toBe(true);

        reactSock.close();
        vueSock.disconnect();
      } finally {
        mockWs.restore();
      }
    });
  });
});
