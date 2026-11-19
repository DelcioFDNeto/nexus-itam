// tests/e2e_cloud_vault/f32_portal_first_access_tour.test.js
// =============================================================================
// F-32: Tour Guiado de Primeiro Acesso do Colaborador (`FirstAccessTour.vue` + `App.vue`)
// =============================================================================

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createMockStorageRoutes,
  inspectVueSfc,
  installMockFetch,
  installMockWebSocket,
  mountVueSfc,
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

function buildRoutes({
  user = {},
  assets = [{ id: 'a1', hostname: 'Galaxy Book 2', internalId: 'SHL-BEL-NTB-001' }],
  terms = [{ id: 'tm1', title: 'Termo CLT Notebook', status: 'pending' }],
  tickets = [],
} = {}) {
  const storageHandler = createMockStorageRoutes();
  return (req) => {
    const { method, pathname } = req;
    if (method === 'GET' && pathname === '/api/v1/auth/me') {
      return {
        status: 200,
        json: {
          id: 'u-colab-tour-1',
          email: 'maria.silva@shineraybysabel.com.br',
          name: 'Maria Silva',
          role: 'collaborator',
          tenantId: 'tenant-shineray',
          companyName: 'Shineray By Sabel',
          department: 'Financeiro',
          ...user,
        },
      };
    }
    if (method === 'GET' && pathname === '/api/v1/assets') {
      return { status: 200, json: { items: assets } };
    }
    if (method === 'GET' && pathname === '/api/v1/compliance/terms') {
      return { status: 200, json: { items: terms } };
    }
    if (method === 'GET' && pathname === '/api/v1/tickets') {
      return { status: 200, json: { items: tickets } };
    }
    return storageHandler(req);
  };
}

async function flush(mounted, ms = 60) {
  await new Promise((r) => setTimeout(r, ms));
  await mounted.nextTick();
}

describe('F-32: Tour Guiado de Primeiro Acesso no Portal do Colaborador', () => {
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

  it('compila FirstAccessTour.vue e garante paridade de todos os icones no PortalIcon.vue', () => {
    const iconSfc = inspectVueSfc('portal-colaborador/src/components/PortalIcon.vue');
    expect(iconSfc.ok).toBe(true);
    const supportedIcons = extractPortalIconMapKeys(iconSfc.scriptSetup);

    const tourSfc = inspectVueSfc('portal-colaborador/src/components/FirstAccessTour.vue');
    expect(tourSfc.missing).toBe(false);
    expect(tourSfc.ok).toBe(true);
    expect(tourSfc.errors).toHaveLength(0);

    const appSfc = inspectVueSfc('portal-colaborador/src/App.vue');
    expect(appSfc.ok).toBe(true);

    // Check static PortalIcon names in templates (excluding dynamic :name="...") and literal icon props in script
    const staticTemplateIcons = [];
    for (const tpl of [tourSfc.template, appSfc.template]) {
      const re = /<PortalIcon\b[^>]*?(?<!:)\bname=["']([^"']+)["']/g;
      let m;
      while ((m = re.exec(tpl)) !== null) staticTemplateIcons.push(m[1]);
    }
    const scriptIcons = [];
    const scriptRe = /\bicon:\s*['"]([a-z0-9-]+)['"]/g;
    let sm;
    while ((sm = scriptRe.exec(tourSfc.scriptSetup)) !== null) scriptIcons.push(sm[1]);

    expect(staticTemplateIcons.length).toBeGreaterThan(5);
    expect(scriptIcons.length).toBeGreaterThan(5);

    for (const iconName of new Set([...staticTemplateIcons, ...scriptIcons])) {
      expect(supportedIcons.has(iconName)).toBe(true);
    }
  });

  it('abre automaticamente no primeiro acesso, percorre todas as 7 etapas trocando abas ao vivo e navega para termos pendentes', async () => {
    mockFetch = installMockFetch(buildRoutes());
    mockWs = installMockWebSocket();
    seedPortalSession({
      user: {
        email: 'maria.silva@shineraybysabel.com.br',
        name: 'Maria Silva',
        role: 'collaborator',
        tenantId: 'tenant-shineray',
        companyName: 'Shineray By Sabel',
        department: 'Financeiro',
      },
    });

    const mounted = await mountVueSfc('portal-colaborador/src/App.vue');
    expect(mounted.ok).toBe(true);
    await flush(mounted, 90);

    // Step 1: Welcome
    const dialog = mounted.container.querySelector('[data-testid="portal-first-access-tour"]');
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain('Bem-vindo(a), Maria!');
    expect(dialog.textContent).toContain('Shineray By Sabel');
    expect(dialog.textContent).toContain('1 termo CLT aguardando');

    const clickNext = async () => {
      const btn = mounted.container.querySelector('[data-testid="tour-next-btn"]');
      expect(btn).not.toBeNull();
      btn.click();
      await flush(mounted, 30);
    };

    // Step 2: Summary
    await clickNext();
    expect(mounted.container.querySelector('[data-step-id="summary"]')).not.toBeNull();

    // Step 3: Custody
    await clickNext();
    expect(mounted.container.querySelector('[data-step-id="custody"]')).not.toBeNull();
    expect(mounted.container.querySelector('#tab-custody')?.getAttribute('aria-selected')).toBe('true');

    // Step 4: Terms (switches tab to terms!)
    await clickNext();
    expect(mounted.container.querySelector('[data-step-id="terms"]')).not.toBeNull();
    expect(mounted.container.querySelector('#tab-terms')?.getAttribute('aria-selected')).toBe('true');

    // Step 5: Tickets (switches tab to tickets!)
    await clickNext();
    expect(mounted.container.querySelector('[data-step-id="tickets"]')).not.toBeNull();
    expect(mounted.container.querySelector('#tab-tickets')?.getAttribute('aria-selected')).toBe('true');

    // Step 6: Cloud (switches tab to cloud!)
    await clickNext();
    expect(mounted.container.querySelector('[data-step-id="cloud"]')).not.toBeNull();
    expect(mounted.container.querySelector('#tab-cloud')?.getAttribute('aria-selected')).toBe('true');
    expect(mounted.container.textContent).toContain('Subir pastas inteiras');
    expect(mounted.container.textContent).toContain('Descompactar direto na nuvem');

    // Step 7: Done -> CTA "Assinar Termo Pendente" closes tour & jumps to terms tab
    await clickNext();
    expect(mounted.container.querySelector('[data-step-id="done"]')).not.toBeNull();

    const gotoTermsBtn = mounted.container.querySelector('[data-testid="tour-goto-terms-btn"]');
    expect(gotoTermsBtn).not.toBeNull();
    gotoTermsBtn.click();
    await flush(mounted, 30);

    expect(mounted.container.querySelector('[data-testid="portal-first-access-tour"]')).toBeNull();
    expect(mounted.container.querySelector('#tab-terms')?.getAttribute('aria-selected')).toBe('true');

    // Persisted in localStorage per tenant+email
    const persisted = localStorage.getItem('nexus_portal_tour_v1:tenant-shineray:maria.silva@shineraybysabel.com.br');
    expect(persisted).toContain('completed');

    mounted.unmount();

    // 2nd visit for same user: does NOT auto-open, but Replay button opens on demand
    const mounted2 = await mountVueSfc('portal-colaborador/src/App.vue');
    await flush(mounted2, 90);
    expect(mounted2.container.querySelector('[data-testid="portal-first-access-tour"]')).toBeNull();

    const replayBtn = mounted2.container.querySelector('[data-testid="portal-replay-tour-btn"]');
    expect(replayBtn).not.toBeNull();
    replayBtn.click();
    await flush(mounted2, 30);
    expect(mounted2.container.querySelector('[data-testid="portal-first-access-tour"]')).not.toBeNull();

    mounted2.unmount();
  }, 15_000);

  it('permite pular o tour sem reexibir para o mesmo usuario, mas exibe para outro colaborador no mesmo computador', async () => {
    mockFetch = installMockFetch(buildRoutes());
    mockWs = installMockWebSocket();
    seedPortalSession({
      user: {
        email: 'maria.silva@shineraybysabel.com.br',
        name: 'Maria Silva',
        role: 'collaborator',
        tenantId: 'tenant-shineray',
      },
    });

    const m1 = await mountVueSfc('portal-colaborador/src/App.vue');
    await flush(m1, 90);
    const skipBtn = m1.container.querySelector('[data-testid="tour-skip-btn"]');
    expect(skipBtn).not.toBeNull();
    skipBtn.click();
    await flush(m1, 30);
    expect(m1.container.querySelector('[data-testid="portal-first-access-tour"]')).toBeNull();
    m1.unmount();

    // Another user logs in on the same browser (without clearing localStorage)
    mockFetch.restore();
    mockFetch = installMockFetch(
      buildRoutes({
        user: {
          id: 'u-colab-tour-2',
          email: 'joao.costa@shineraybysabel.com.br',
          name: 'João Costa',
        },
        terms: [],
      }),
    );
    localStorage.setItem(
      'nexus_portal_session_v3',
      JSON.stringify({
        token: 'tok-joao',
        user: {
          id: 'u-colab-tour-2',
          email: 'joao.costa@shineraybysabel.com.br',
          name: 'João Costa',
          role: 'collaborator',
          tenantId: 'tenant-shineray',
          companyName: 'Shineray By Sabel',
        },
      }),
    );

    const m2 = await mountVueSfc('portal-colaborador/src/App.vue');
    await flush(m2, 90);
    const dialog2 = m2.container.querySelector('[data-testid="portal-first-access-tour"]');
    expect(dialog2).not.toBeNull();
    expect(dialog2.textContent).toContain('Bem-vindo(a), João!');
    m2.unmount();
  }, 15_000);
});
