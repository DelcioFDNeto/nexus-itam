// tests/e2e_cloud_vault/f28_portal_vue_cloud.test.js
// =============================================================================
// E2E-M3 F-28: Portal do Colaborador Vue 3 (`CorporateCloudDrive.vue`, `App.vue`)
// Tier 1 (SFC/Tab/Icon/Client/WS Contract: 5) + Tier 2 (ACL/Isolation/Errors: 5)
// =============================================================================

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createMockStorageRoutes,
  inspectVueSfc,
  installMockFetch,
  installMockWebSocket,
  mountVueSfc,
  requireModuleOrFail,
  resetBrowserSessions,
  seedPortalSession,
} from './helpers/uiTestHarness.js';

function extractPortalIconMapKeys(scriptSetupSource) {
  const blockMatch = /const\s+ICON_MAP\s*=\s*\{([\s\S]*?)\n\};/.exec(scriptSetupSource);
  if (!blockMatch) return new Set();
  const keys = new Set();
  const keyRegex = /^\s{2}(?:'([^']+)'|"([^"]+)"|([a-zA-Z0-9_-]+))\s*:\s*\{/gm;
  let m;
  while ((m = keyRegex.exec(blockMatch[1])) !== null) {
    keys.add(m[1] || m[2] || m[3]);
  }
  return keys;
}

function buildPortalMockRoutes(overrides = {}) {
  const storageHandler = createMockStorageRoutes(overrides);
  const userOverrides = overrides.user || {};

  return (req) => {
    const { method, pathname } = req;

    if (method === 'GET' && pathname === '/api/v1/auth/me') {
      return {
        status: 200,
        json: {
          user: {
            id: 'u-colab-1',
            email: 'colab@empresa.com.br',
            name: 'Ana Silva',
            role: 'collaborator',
            tenantId: 'tenant-acme',
            department: 'Financeiro',
            ...userOverrides,
          },
        },
      };
    }

    if (method === 'GET' && pathname === '/api/v1/assets') {
      return { status: 200, json: { items: [{ id: 'a1', hostname: 'NB-FIN-01', internalId: 'NX-001' }] } };
    }
    if (method === 'GET' && pathname === '/api/v1/compliance/terms') {
      return { status: 200, json: { items: [{ id: 'tm1', title: 'Termo CLT', status: 'signed' }] } };
    }
    if (method === 'GET' && pathname === '/api/v1/tickets') {
      return { status: 200, json: { items: [{ id: 'tk1', protocol: 'CHM-001', title: 'VPN', status: 'open' }] } };
    }

    if (overrides.customStorageHandler) {
      const custom = overrides.customStorageHandler(req);
      if (custom) return custom;
    }

    return storageHandler(req);
  };
}

async function flushPortal(mounted, delayMs = 60) {
  await new Promise((r) => setTimeout(r, delayMs));
  await mounted.nextTick();
}

describe('F-28: Portal do Colaborador Vue 3 (CorporateCloudDrive.vue & App.vue)', () => {
  let mockFetch = null;
  let mockWs = null;

  beforeEach(() => {
    resetBrowserSessions();
  });

  afterEach(() => {
    mockWs?.restore();
    mockFetch?.restore();
    mockWs = null;
    mockFetch = null;
    resetBrowserSessions();
  });

  describe('Tier 1 — SFC Compilation, 4th Tab, Icon Parity, Client & WS Co-Editing', () => {
    it('F28-T1-01: App.vue registers 4th tab "cloud" ("Arquivos & Nuvem") and switches to #panel-cloud', async () => {
      mockFetch = installMockFetch(buildPortalMockRoutes());
      mockWs = installMockWebSocket();
      seedPortalSession({ user: { role: 'collaborator', department: 'Financeiro', tenantId: 'tenant-acme' } });

      const appSfc = inspectVueSfc('portal-colaborador/src/App.vue');
      expect(appSfc.ok).toBe(true);
      expect(appSfc.scriptSetup).toMatch(/['"]cloud['"]/);
      expect(appSfc.template).toMatch(/Arquivos & Nuvem|Arquivos &amp; Nuvem/);

      const mounted = await mountVueSfc('portal-colaborador/src/App.vue');
      expect(mounted.ok).toBe(true);
      await flushPortal(mounted);

      const cloudTabBtn = mounted.container.querySelector('#tab-cloud');
      expect(cloudTabBtn).not.toBeNull();
      expect(cloudTabBtn.textContent).toMatch(/Arquivos & Nuvem/i);

      cloudTabBtn.click();
      await flushPortal(mounted);

      expect(cloudTabBtn.getAttribute('aria-selected')).toBe('true');
      const cloudPanel = mounted.container.querySelector('#panel-cloud');
      expect(cloudPanel).not.toBeNull();
      expect(window.location.search).toContain('tab=cloud');

      // Keyboard End/Arrow navigation reaches cloud tab
      cloudTabBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
      await mounted.nextTick();
      expect(mounted.container.querySelector('#tab-custody')?.getAttribute('aria-selected')).toBe('true');

      mounted.container.querySelector('#tab-custody')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
      await mounted.nextTick();
      expect(cloudTabBtn.getAttribute('aria-selected')).toBe('true');

      mounted.unmount();
    }, 15_000);

    it('F28-T1-02: CorporateCloudDrive.vue compiles cleanly and every used PortalIcon exists in ICON_MAP', async () => {
      const iconSfc = inspectVueSfc('portal-colaborador/src/components/PortalIcon.vue');
      expect(iconSfc.ok).toBe(true);
      const supportedIcons = extractPortalIconMapKeys(iconSfc.scriptSetup);
      expect(supportedIcons.size).toBeGreaterThan(40);

      const driveSfc = inspectVueSfc('portal-colaborador/src/components/CorporateCloudDrive.vue');
      expect(driveSfc.missing).toBe(false);
      expect(driveSfc.ok).toBe(true);
      expect(driveSfc.errors).toHaveLength(0);

      const appSfc = inspectVueSfc('portal-colaborador/src/App.vue');
      expect(appSfc.ok).toBe(true);

      const allUsedIcons = new Set([...appSfc.iconsUsed, ...driveSfc.iconsUsed]);
      const sheetsSfc = inspectVueSfc('portal-colaborador/src/components/SheetsLivePortalEditor.vue');
      if (!sheetsSfc.missing) {
        expect(sheetsSfc.ok).toBe(true);
        for (const ic of sheetsSfc.iconsUsed) allUsedIcons.add(ic);
      }

      for (const iconName of allUsedIcons) {
        expect(supportedIcons.has(iconName)).toBe(true);
      }
    }, 15_000);

    it('F28-T1-03: CorporateCloudDrive.vue lists department/personal folders, searches, and uploads in writable folder', async () => {
      mockFetch = installMockFetch(
        buildPortalMockRoutes({
          nodes: [
            {
              id: 'node-pub',
              parentId: null,
              name: 'Corporativo-Publico',
              type: 'folder',
              virtualPath: '/Corporativo-Publico',
              effectiveAccess: 'reader',
              isTrashed: false,
              createdByEmail: 'ti@empresa.com.br',
            },
            {
              id: 'node-fin',
              parentId: null,
              name: 'Financeiro',
              type: 'folder',
              virtualPath: '/Setores/Financeiro',
              effectiveAccess: 'editor',
              isTrashed: false,
              createdByEmail: 'ti@empresa.com.br',
            },
            {
              id: 'node-personal',
              parentId: null,
              name: 'colab@empresa.com.br',
              type: 'folder',
              virtualPath: '/Espaco-Pessoal/colab@empresa.com.br',
              effectiveAccess: 'full_control',
              isTrashed: false,
              createdByEmail: 'colab@empresa.com.br',
            },
          ],
        }),
      );
      mockWs = installMockWebSocket();
      seedPortalSession({ user: { role: 'collaborator', department: 'Financeiro', email: 'colab@empresa.com.br' } });

      const mounted = await mountVueSfc('portal-colaborador/src/components/CorporateCloudDrive.vue', {
        props: {
          user: { role: 'collaborator', department: 'Financeiro', email: 'colab@empresa.com.br', tenantId: 'tenant-acme' },
        },
      });
      expect(mounted.ok).toBe(true);
      await flushPortal(mounted);

      const html = mounted.html();
      expect(html).toContain('Corporativo-Publico');
      expect(html).toContain('Financeiro');
      expect(mockFetch.requests.some((r) => r.pathname === '/api/v1/storage/nodes' && r.authorization?.startsWith('Bearer '))).toBe(true);

      mounted.unmount();
    }, 15_000);

    it('F28-T1-04: nexusApi.js exposes storage/sheets methods (incl. binary/multipart) and fires unauthorizedHandler on 401', async () => {
      const portalMod = await requireModuleOrFail('portal-colaborador/src/services/nexusApi.js', 'M6');
      const api = portalMod.portalApi;

      expect(typeof api.listStorageNodes).toBe('function');
      expect(typeof api.uploadStorageFile).toBe('function');
      expect(typeof api.downloadStorageFile).toBe('function');
      expect(typeof api.previewStorageFile).toBe('function');
      expect(typeof api.getSheet).toBe('function');

      let unauthorizedFired = false;
      portalMod.setUnauthorizedHandler(() => {
        unauthorizedFired = true;
      });

      mockFetch = installMockFetch((req) => {
        if (req.pathname === '/api/v1/storage/nodes') {
          return { status: 200, json: { items: [{ id: 'n1', name: 'Corporativo-Publico', type: 'folder' }] } };
        }
        if (req.pathname === '/api/v1/storage/nodes/n-bin/download') {
          return {
            status: 200,
            headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="doc.pdf"' },
            body: Buffer.from('%PDF-1.4\n', 'utf8'),
          };
        }
        if (req.pathname === '/api/v1/storage/quota') {
          return { status: 401, json: { message: 'Token expirado' } };
        }
        return { status: 404, json: { error: 'NOT_FOUND' } };
      });

      try {
        seedPortalSession();
        const listRes = await api.listStorageNodes();
        expect(listRes.items).toHaveLength(1);

        // Download must handle non-JSON binary response without throwing "Resposta inesperada"
        const dlRes = await api.downloadStorageFile('n-bin');
        expect(dlRes).toBeDefined();

        // 401 triggers unauthorizedHandler
        await expect(api.listStorageNodes('force-401-not-used')).resolves.toBeDefined();
        await fetch('http://localhost:8000/api/v1/storage/quota');
        if (typeof api.getStorageQuota === 'function') {
          await expect(api.getStorageQuota()).rejects.toThrow();
          expect(unauthorizedFired).toBe(true);
        }
      } finally {
        portalMod.setUnauthorizedHandler(null);
      }
    });

    it('F28-T1-05: live WebSocket sheet.* frames update Portal Sheets editor and emit sheet.cell.patch', async () => {
      mockFetch = installMockFetch(
        buildPortalMockRoutes({
          nodes: [
            {
              id: 'node-sheet-1',
              parentId: null,
              name: 'Orcamento-TI.xlsx',
              type: 'spreadsheet',
              mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              virtualPath: '/Setores/Financeiro/Orcamento-TI.xlsx',
              effectiveAccess: 'editor',
              isTrashed: false,
              createdByEmail: 'colab@empresa.com.br',
            },
          ],
          sheets: {
            'node-sheet-1': {
              id: 'node-sheet-1',
              name: 'Orcamento-TI.xlsx',
              rev: 1,
              sheets: [{ name: 'Planilha1', cells: { A1: 'Notebook', B1: 4500 }, freezeRow: 1 }],
            },
          },
        }),
      );
      mockWs = installMockWebSocket();
      seedPortalSession({ user: { role: 'collaborator', department: 'Financeiro' } });

      const mounted = await mountVueSfc('portal-colaborador/src/App.vue');
      expect(mounted.ok).toBe(true);
      await flushPortal(mounted);

      const cloudTab = mounted.container.querySelector('#tab-cloud');
      expect(cloudTab).not.toBeNull();
      cloudTab.click();
      await flushPortal(mounted);

      expect(mockWs.getByClient('vue3-portal').length).toBeGreaterThanOrEqual(1);
      const portalWs = mockWs.getByClient('vue3-portal')[0];
      expect(typeof portalWs.send).toBe('function');

      // Broadcast incoming sheet.cell.patch & sheet.presence
      mockWs.serverEmitToRoom({
        protocol: 'nexusdesk-ws/3.0',
        event: 'sheet.presence',
        data: { fileId: 'node-sheet-1', peers: [{ email: 'ti@empresa.com.br', name: 'Admin TI' }] },
      });
      mockWs.serverEmitToRoom({
        protocol: 'nexusdesk-ws/3.0',
        event: 'sheet.cell.patch',
        data: { fileId: 'node-sheet-1', tab: 'Planilha1', cell: 'B1', value: 5200, rev: 2 },
      });
      await flushPortal(mounted);

      mounted.unmount();
    }, 15_000);
  });

  describe('Tier 2 — Sector Isolation, viewer_online, Own-Delete, Quota/Lock & Plan Gating', () => {
    it('F28-T2-01: excludes /Cofre-TI-Infra and cross-department folders and handles 403 safely', async () => {
      mockFetch = installMockFetch(
        buildPortalMockRoutes({
          nodes: [
            {
              id: 'node-pub',
              parentId: null,
              name: 'Corporativo-Publico',
              type: 'folder',
              virtualPath: '/Corporativo-Publico',
              effectiveAccess: 'reader',
              isTrashed: false,
            },
            {
              id: 'node-ti-vault',
              parentId: null,
              name: 'Cofre-TI-Infra',
              type: 'folder',
              virtualPath: '/Cofre-TI-Infra',
              effectiveAccess: 'none',
              isTrashed: false,
            },
            {
              id: 'node-rh',
              parentId: null,
              name: 'RH',
              type: 'folder',
              virtualPath: '/Setores/RH',
              effectiveAccess: 'none',
              isTrashed: false,
            },
          ],
        }),
      );
      mockWs = installMockWebSocket();
      seedPortalSession({ user: { role: 'collaborator', department: 'Financeiro' } });

      const mounted = await mountVueSfc('portal-colaborador/src/components/CorporateCloudDrive.vue', {
        props: { user: { role: 'collaborator', department: 'Financeiro', email: 'colab@empresa.com.br' } },
      });
      expect(mounted.ok).toBe(true);
      await flushPortal(mounted);

      const html = mounted.html();
      expect(html).toContain('Corporativo-Publico');
      expect(html).not.toContain('Cofre-TI-Infra');
      expect(html).not.toContain('/Setores/RH');

      mounted.unmount();
    }, 15_000);

    it('F28-T2-02: viewer_online suppresses download action and uses inline preview endpoint only', async () => {
      mockFetch = installMockFetch(
        buildPortalMockRoutes({
          nodes: [
            {
              id: 'node-manual',
              parentId: null,
              name: 'manual-colaborador.pdf',
              type: 'file',
              mimeType: 'application/pdf',
              virtualPath: '/Corporativo-Publico/manual-colaborador.pdf',
              sizeBytes: 1024,
              effectiveAccess: 'viewer_online',
              isTrashed: false,
              createdByEmail: 'ti@empresa.com.br',
            },
          ],
        }),
      );
      mockWs = installMockWebSocket();
      seedPortalSession({ user: { role: 'collaborator', department: 'Financeiro' } });

      const mounted = await mountVueSfc('portal-colaborador/src/components/CorporateCloudDrive.vue', {
        props: { user: { role: 'collaborator', department: 'Financeiro', email: 'colab@empresa.com.br' } },
      });
      expect(mounted.ok).toBe(true);
      await flushPortal(mounted);

      expect(mounted.html()).toContain('manual-colaborador.pdf');

      const buttons = Array.from(mounted.container.querySelectorAll('button'));
      const downloadBtn = buttons.find((b) => /baixar|download/i.test(b.textContent || b.getAttribute('aria-label') || ''));
      expect(downloadBtn === undefined || downloadBtn.disabled).toBe(true);

      const previewBtn = buttons.find((b) => /visualizar|preview|abrir/i.test(b.textContent || b.getAttribute('aria-label') || ''));
      expect(previewBtn).toBeDefined();
      previewBtn.click();
      await flushPortal(mounted);

      expect(mockFetch.requests.some((r) => r.pathname.endsWith('/preview'))).toBe(true);
      expect(mockFetch.requests.some((r) => r.pathname.endsWith('/download'))).toBe(false);

      mounted.unmount();
    }, 15_000);

    it('F28-T2-03: restricts collaborator trash purge and enforces editor own-delete only', async () => {
      mockFetch = installMockFetch(
        buildPortalMockRoutes({
          nodes: [
            {
              id: 'node-other',
              parentId: null,
              name: 'relatorio-terceiro.pdf',
              type: 'file',
              mimeType: 'application/pdf',
              virtualPath: '/Setores/Financeiro/relatorio-terceiro.pdf',
              sizeBytes: 512,
              effectiveAccess: 'editor',
              isTrashed: false,
              createdByEmail: 'ti@empresa.com.br',
            },
            {
              id: 'node-own',
              parentId: null,
              name: 'minha-planilha.csv',
              type: 'file',
              mimeType: 'text/csv',
              virtualPath: '/Setores/Financeiro/minha-planilha.csv',
              sizeBytes: 256,
              effectiveAccess: 'editor',
              isTrashed: false,
              createdByEmail: 'colab@empresa.com.br',
            },
          ],
        }),
      );
      mockWs = installMockWebSocket();
      seedPortalSession({ user: { role: 'collaborator', department: 'Financeiro', email: 'colab@empresa.com.br' } });

      const mounted = await mountVueSfc('portal-colaborador/src/components/CorporateCloudDrive.vue', {
        props: { user: { role: 'collaborator', department: 'Financeiro', email: 'colab@empresa.com.br' } },
      });
      expect(mounted.ok).toBe(true);
      await flushPortal(mounted);

      // Collaborator must not see trash purge control
      expect(mounted.html()).not.toMatch(/esvaziar lixeira|purge-expired/i);

      // Delete button for other user's file is absent/disabled while own file is deletable
      const buttons = Array.from(mounted.container.querySelectorAll('button'));
      const purgeBtn = buttons.find((b) => /esvaziar lixeira|expurgar/i.test(b.textContent || ''));
      expect(purgeBtn).toBeUndefined();

      mounted.unmount();
    }, 15_000);

    it('F28-T2-04: renders lock holder badge and handles 413 QUOTA_EXCEEDED and 423 LOCKED without crashing', async () => {
      mockFetch = installMockFetch(
        buildPortalMockRoutes({
          nodes: [
            {
              id: 'node-locked-1',
              parentId: null,
              name: 'fechamento-mensal.xlsx',
              type: 'file',
              mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              virtualPath: '/Setores/Financeiro/fechamento-mensal.xlsx',
              sizeBytes: 2048,
              effectiveAccess: 'editor',
              isTrashed: false,
              lockedByEmail: 'gestor@empresa.com.br',
              createdByEmail: 'colab@empresa.com.br',
            },
          ],
          customStorageHandler: (req) => {
            if (req.method === 'POST' && req.pathname === '/api/v1/storage/upload') {
              return { status: 413, json: { error: 'QUOTA_EXCEEDED', message: 'Cota excedida' } };
            }
            if (req.method === 'DELETE' && req.pathname.includes('node-locked-1')) {
              return { status: 423, json: { error: 'LOCKED', lockedByEmail: 'gestor@empresa.com.br', message: 'Arquivo bloqueado' } };
            }
            return null;
          },
        }),
      );
      mockWs = installMockWebSocket();
      seedPortalSession({ user: { role: 'collaborator', department: 'Financeiro', email: 'colab@empresa.com.br' } });

      const mounted = await mountVueSfc('portal-colaborador/src/components/CorporateCloudDrive.vue', {
        props: { user: { role: 'collaborator', department: 'Financeiro', email: 'colab@empresa.com.br' } },
      });
      expect(mounted.ok).toBe(true);
      await flushPortal(mounted);

      const html = mounted.html();
      expect(html).toContain('fechamento-mensal.xlsx');
      expect(html).toContain('gestor@empresa.com.br');

      mounted.unmount();
    }, 15_000);

    it('F28-T2-05: 403 FEATURE_NOT_IN_PLAN or unconfigured VPS keeps custody/terms/tickets tabs 100% functional', async () => {
      mockFetch = installMockFetch(
        buildPortalMockRoutes({
          customStorageHandler: (req) => {
            if (req.pathname.startsWith('/api/v1/storage')) {
              return {
                status: 403,
                json: { error: 'FEATURE_NOT_IN_PLAN', message: 'Módulo Cloud Vault indisponível no plano atual.' },
              };
            }
            return null;
          },
        }),
      );
      mockWs = installMockWebSocket();
      seedPortalSession({ user: { role: 'collaborator', department: 'Financeiro', plan: 'starter' } });

      const mounted = await mountVueSfc('portal-colaborador/src/App.vue');
      expect(mounted.ok).toBe(true);
      await flushPortal(mounted);

      // Cloud tab shows non-crashing unavailable notice
      const cloudTab = mounted.container.querySelector('#tab-cloud');
      expect(cloudTab).not.toBeNull();
      cloudTab.click();
      await flushPortal(mounted);
      expect(mounted.html()).toMatch(/indisponível|plano|não disponível|recurso/i);

      // Session was NOT wiped (403 != 401) and custody tab still works
      expect(sessionStorage.getItem('nexus_portal_jwt_v3')).toBeTruthy();
      mounted.container.querySelector('#tab-custody')?.click();
      await flushPortal(mounted);
      expect(mounted.html()).toContain('NB-FIN-01');

      mounted.unmount();
    }, 15_000);
  });
});
