// tests/e2e_cloud_vault/helpers/uiTestHarness.js
// =============================================================================
// Frontend UI & Contract Opaque-Box Harness (React 19 + Vue 3 SFC + Mock Fetch/WS)
// =============================================================================
// - fs.existsSync-guarded dynamic imports prevent Vitest discovery crashes pre-M6
// - Compiles & mounts Vue 3 SFCs via portal-colaborador/node_modules/@vue/compiler-sfc & vue
// - Provides session seeding, MockGatewayFetch, MockWebSocket, and createMockStorageRoutes
// =============================================================================

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { vi } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const REPO_ROOT = path.resolve(__dirname, '../../..');

const requireFromHere = createRequire(import.meta.url);
const PORTAL_COMPILER_SFC_PATH = path.join(
  REPO_ROOT,
  'portal-colaborador',
  'node_modules',
  '@vue',
  'compiler-sfc',
  'dist',
  'compiler-sfc.cjs.js',
);
const PORTAL_VUE_PATH = path.join(
  REPO_ROOT,
  'portal-colaborador',
  'node_modules',
  'vue',
);

const mountedApps = new Set();

export function resolveRepoPath(relPath) {
  const clean = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const resolved = path.resolve(REPO_ROOT, clean);
  const rootWithSep = REPO_ROOT.endsWith(path.sep) ? REPO_ROOT : `${REPO_ROOT}${path.sep}`;
  if (resolved !== REPO_ROOT && !resolved.startsWith(rootWithSep)) {
    throw new Error(`Path traversal blocked in resolveRepoPath: ${relPath}`);
  }
  return resolved;
}

export function moduleExists(relPath) {
  try {
    return fs.existsSync(resolveRepoPath(relPath));
  } catch {
    return false;
  }
}

function isModuleNotFoundError(err) {
  const code = err?.code || '';
  const msg = String(err?.message || '');
  return (
    code === 'ERR_MODULE_NOT_FOUND' ||
    code === 'MODULE_NOT_FOUND' ||
    /Cannot find module|Failed to load url|Does not exist/i.test(msg)
  );
}

export async function safeDynamicImport(relPath) {
  let absPath;
  try {
    absPath = resolveRepoPath(relPath);
  } catch (err) {
    return { ok: false, missing: false, path: String(relPath), error: err, mod: null };
  }

  if (!fs.existsSync(absPath)) {
    return {
      ok: false,
      missing: true,
      path: absPath,
      error: new Error(`MODULE_MISSING: ${relPath}`),
      mod: null,
    };
  }

  const cleanRel = path.relative(REPO_ROOT, absPath).replace(/\\/g, '/');
  try {
    // Route through Vite transform pipeline when running inside Vitest
    const mod = await import(/* @vite-ignore */ `/${cleanRel}`);
    return { ok: true, missing: false, path: absPath, error: null, mod };
  } catch (viteErr) {
    try {
      const mod = await import(/* @vite-ignore */ pathToFileURL(absPath).href);
      return { ok: true, missing: false, path: absPath, error: null, mod };
    } catch (fileErr) {
      const err = fileErr || viteErr;
      return {
        ok: false,
        missing: isModuleNotFoundError(err),
        path: absPath,
        error: err,
        mod: null,
      };
    }
  }
}

export async function requireModuleOrFail(relPath, milestoneHint = 'M1-M6') {
  const res = await safeDynamicImport(relPath);
  if (!res.ok) {
    throw new Error(
      `Target module not available yet (${relPath}, expected in ${milestoneHint}): ${res.error?.message || 'unknown error'}`,
    );
  }
  return res.mod;
}

function loadCompilerSfc() {
  if (fs.existsSync(PORTAL_COMPILER_SFC_PATH)) {
    return requireFromHere(PORTAL_COMPILER_SFC_PATH);
  }
  return requireFromHere(path.join(REPO_ROOT, 'portal-colaborador', 'node_modules', '@vue', 'compiler-sfc'));
}

function loadPortalVue() {
  return requireFromHere(PORTAL_VUE_PATH);
}

function extractRegexMatches(source, regex) {
  const out = [];
  let match;
  while ((match = regex.exec(source)) !== null) {
    if (match[1] && !out.includes(match[1])) {
      out.push(match[1]);
    }
  }
  return out;
}

export function inspectVueSfc(relPath) {
  let absPath;
  try {
    absPath = resolveRepoPath(relPath);
  } catch (err) {
    return {
      ok: false,
      missing: false,
      errors: [err],
      descriptor: null,
      scriptSetup: '',
      template: '',
      props: [],
      emits: [],
      imports: [],
      iconsUsed: [],
      apiCalls: [],
    };
  }

  if (!fs.existsSync(absPath)) {
    return {
      ok: false,
      missing: true,
      errors: [new Error(`VUE_SFC_MISSING: ${relPath}`)],
      descriptor: null,
      scriptSetup: '',
      template: '',
      props: [],
      emits: [],
      imports: [],
      iconsUsed: [],
      apiCalls: [],
    };
  }

  const source = fs.readFileSync(absPath, 'utf8');
  const sfc = loadCompilerSfc();
  const id = `sfc-${Buffer.from(relPath).toString('hex').slice(0, 12)}`;
  const { descriptor, errors: parseErrors } = sfc.parse(source, { filename: absPath });

  const allErrors = [...(parseErrors || [])];
  let compiledScript = null;
  let compiledTemplate = null;

  if (descriptor.script || descriptor.scriptSetup) {
    try {
      compiledScript = sfc.compileScript(descriptor, { id, inlineTemplate: false });
    } catch (err) {
      allErrors.push(err);
    }
  }

  if (descriptor.template) {
    try {
      compiledTemplate = sfc.compileTemplate({
        source: descriptor.template.content,
        filename: absPath,
        id,
        compilerOptions: {
          bindingMetadata: compiledScript?.bindings,
        },
      });
      if (compiledTemplate.errors?.length) {
        allErrors.push(...compiledTemplate.errors);
      }
    } catch (err) {
      allErrors.push(err);
    }
  }

  const scriptSetupContent = descriptor.scriptSetup?.content || descriptor.script?.content || '';
  const templateContent = descriptor.template?.content || '';

  let props = [];
  if (compiledScript && typeof sfc.extractRuntimeProps === 'function') {
    try {
      const ctx = {
        descriptor,
        ast: compiledScript.scriptSetupAst || [],
        scriptAst: compiledScript.scriptAst,
        source,
        filename: absPath,
      };
      const extracted = sfc.extractRuntimeProps(ctx);
      if (extracted && typeof extracted === 'object') {
        props = Object.keys(extracted);
      }
    } catch {
      /* fallback below */
    }
  }
  if (props.length === 0) {
    const propsBlock = /defineProps\s*\(\s*\{([\s\S]*?)\}\s*\)/.exec(scriptSetupContent);
    if (propsBlock) {
      props = extractRegexMatches(propsBlock[1], /^\s*([a-zA-Z_$][\w$]*)\s*:/gm);
    }
  }

  const emitsMatch = /defineEmits\s*\(\s*\[([^\]]*)\]\s*\)/.exec(scriptSetupContent);
  const emits = emitsMatch
    ? extractRegexMatches(emitsMatch[1], /['"]([^'"]+)['"]/g)
    : [];

  const imports = extractRegexMatches(scriptSetupContent, /import\s+[\s\S]*?from\s+['"]([^'"]+)['"]/g);
  const iconsUsed = extractRegexMatches(templateContent, /<PortalIcon[^>]*?\bname=["']([^"']+)["']/g);
  const apiCalls = extractRegexMatches(scriptSetupContent, /\bportalApi\.([a-zA-Z0-9_]+)/g);

  return {
    ok: allErrors.length === 0,
    missing: false,
    errors: allErrors,
    descriptor,
    scriptSetup: scriptSetupContent,
    template: templateContent,
    props,
    emits,
    imports,
    iconsUsed,
    apiCalls,
  };
}

function createVueStubComponent(name) {
  const Vue = loadPortalVue();
  return {
    name: name || 'VueStub',
    inheritAttrs: false,
    setup(_, { slots, attrs }) {
      return () => Vue.h('div', { 'data-vue-stub': name || 'Stub', ...attrs }, slots.default ? slots.default() : []);
    },
  };
}

async function compileAndEvalVueSfc(
  absPath,
  options = {},
  context = { activeStack: new Set(), compiledCache: new Map() },
) {
  const Vue = loadPortalVue();
  const sfc = loadCompilerSfc();
  const esbuild = requireFromHere('esbuild');

  if (context.compiledCache.has(absPath)) {
    return context.compiledCache.get(absPath);
  }
  if (context.activeStack.has(absPath)) {
    return createVueStubComponent(path.basename(absPath, '.vue'));
  }

  context.activeStack.add(absPath);
  try {
    const source = fs.readFileSync(absPath, 'utf8');
    const id = `sfc-${Buffer.from(absPath).toString('hex').slice(0, 12)}`;
    const { descriptor, errors } = sfc.parse(source, { filename: absPath });
    if (errors?.length) {
      throw new Error(`Vue parse errors in ${absPath}: ${errors.map((e) => e.message || String(e)).join('; ')}`);
    }

    let esmCode = '';
    if (descriptor.script || descriptor.scriptSetup) {
      const compiled = sfc.compileScript(descriptor, {
        id,
        inlineTemplate: Boolean(descriptor.template),
        templateOptions: descriptor.template
          ? {
              compilerOptions: {},
            }
          : undefined,
      });
      esmCode = compiled.content;
    } else if (descriptor.template) {
      const tpl = sfc.compileTemplate({
        source: descriptor.template.content,
        filename: absPath,
        id,
      });
      esmCode = `${tpl.code}\nexport default { render };`;
    } else {
      esmCode = 'export default {};';
    }

    const cjsResult = esbuild.transformSync(esmCode, {
      format: 'cjs',
      loader: 'js',
      target: 'es2022',
    });

    const importSpecifiers = extractRegexMatches(cjsResult.code, /require\(["']([^"']+)["']\)/g);
    const resolvedDeps = new Map();
    const dir = path.dirname(absPath);
    const stubs = options.stubs || {};
    const deps = options.deps || {};

    for (const spec of importSpecifiers) {
      if (spec === 'vue') {
        resolvedDeps.set(spec, Vue);
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(deps, spec)) {
        resolvedDeps.set(spec, deps[spec]);
        continue;
      }

      const base = path.basename(spec, '.vue');
      if (spec.endsWith('.vue')) {
        if (Object.prototype.hasOwnProperty.call(stubs, spec)) {
          resolvedDeps.set(spec, stubs[spec]);
          continue;
        }
        if (Object.prototype.hasOwnProperty.call(stubs, base)) {
          resolvedDeps.set(spec, stubs[base]);
          continue;
        }
        const childAbs = path.resolve(dir, spec);
        if (fs.existsSync(childAbs) && options.recursive !== false) {
          const childComp = await compileAndEvalVueSfc(childAbs, options, context);
          resolvedDeps.set(spec, childComp);
        } else {
          resolvedDeps.set(spec, createVueStubComponent(base));
        }
        continue;
      }

      if (spec.startsWith('.')) {
        const targetAbs = path.resolve(dir, spec);
        const rawRelToRepo = path.relative(REPO_ROOT, targetAbs).replace(/\\/g, '/');
        if (Object.prototype.hasOwnProperty.call(deps, rawRelToRepo)) {
          resolvedDeps.set(spec, deps[rawRelToRepo]);
          continue;
        }

        const candidateAbsPaths = [];
        if (fs.existsSync(targetAbs) && fs.statSync(targetAbs).isFile()) {
          candidateAbsPaths.push(targetAbs);
        } else {
          for (const ext of ['.js', '.jsx', '.mjs', '.ts']) {
            candidateAbsPaths.push(`${targetAbs}${ext}`);
          }
          candidateAbsPaths.push(path.join(targetAbs, 'index.js'));
        }

        let resolved = false;
        for (const candidateAbs of candidateAbsPaths) {
          if (!fs.existsSync(candidateAbs) || !fs.statSync(candidateAbs).isFile()) continue;
          const relToRepo = path.relative(REPO_ROOT, candidateAbs).replace(/\\/g, '/');
          if (Object.prototype.hasOwnProperty.call(deps, relToRepo)) {
            resolvedDeps.set(spec, deps[relToRepo]);
            resolved = true;
            break;
          }
          const imported = await safeDynamicImport(relToRepo);
          if (imported.ok) {
            resolvedDeps.set(spec, imported.mod);
            resolved = true;
            break;
          }
        }
        if (!resolved) {
          resolvedDeps.set(spec, {});
        }
        continue;
      }

      try {
        resolvedDeps.set(spec, requireFromHere(spec));
      } catch {
        resolvedDeps.set(spec, {});
      }
    }

    const moduleObj = { exports: {} };
    const localRequire = (spec) => {
      if (resolvedDeps.has(spec)) return resolvedDeps.get(spec);
      return requireFromHere(spec);
    };

    const fn = new Function('require', 'module', 'exports', cjsResult.code);
    fn(localRequire, moduleObj, moduleObj.exports);

    const component = moduleObj.exports.default || moduleObj.exports;
    context.compiledCache.set(absPath, component);
    return component;
  } finally {
    context.activeStack.delete(absPath);
  }
}

export async function mountVueSfc(relPath, options = {}) {
  let absPath;
  try {
    absPath = resolveRepoPath(relPath);
  } catch (err) {
    return {
      ok: false,
      missing: false,
      errors: [err],
      container: null,
      app: null,
      vm: null,
      html: () => '',
      nextTick: async () => {},
      unmount: () => {},
    };
  }

  if (!fs.existsSync(absPath)) {
    return {
      ok: false,
      missing: true,
      errors: [new Error(`VUE_SFC_MISSING: ${relPath}`)],
      container: null,
      app: null,
      vm: null,
      html: () => '',
      nextTick: async () => {},
      unmount: () => {},
    };
  }

  const Vue = loadPortalVue();
  const errors = [];
  let component;
  try {
    component = await compileAndEvalVueSfc(absPath, options);
  } catch (err) {
    errors.push(err);
    return {
      ok: false,
      missing: false,
      errors,
      container: null,
      app: null,
      vm: null,
      html: () => '',
      nextTick: async () => {},
      unmount: () => {},
    };
  }

  const container = options.attachTo || document.createElement('div');
  if (!options.attachTo && document.body) {
    document.body.appendChild(container);
  }

  const app = Vue.createApp(component, options.props || {});
  if (options.stubs && typeof options.stubs === 'object') {
    for (const [k, v] of Object.entries(options.stubs)) {
      app.component(k, v);
    }
  }

  const vm = app.mount(container);
  await Vue.nextTick();

  const unmount = () => {
    try {
      app.unmount();
    } catch {
      /* ignore */
    }
    if (!options.attachTo && container.parentNode) {
      container.parentNode.removeChild(container);
    }
    mountedApps.delete(unmount);
  };

  mountedApps.add(unmount);

  return {
    ok: true,
    missing: false,
    errors: [],
    container,
    app,
    vm,
    html: () => container.innerHTML,
    nextTick: () => Vue.nextTick(),
    unmount,
  };
}

export function resetBrowserSessions() {
  for (const cleanup of Array.from(mountedApps)) {
    cleanup();
  }
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
  } catch {
    /* ignore */
  }
  try {
    if (typeof localStorage !== 'undefined') localStorage.clear();
  } catch {
    /* ignore */
  }
}

function makeFakeJwt(claims) {
  const encodeB64Url = (obj) =>
    Buffer.from(JSON.stringify(obj), 'utf8')
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  return `${encodeB64Url({ alg: 'HS256', typ: 'JWT' })}.${encodeB64Url(claims)}.mock-sig`;
}

export function seedReactGatewaySession(overrides = {}) {
  const defaultUser = {
    id: 'u-admin-1',
    email: 'ti@empresa.com.br',
    name: 'Admin TI',
    role: 'owner',
    tenantId: 'tenant-acme',
    department: 'TI',
  };
  const user = { ...defaultUser, ...(overrides.user || {}) };
  const token =
    overrides.token ||
    makeFakeJwt({
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenantId,
      department: user.department,
      ...(user.plan ? { plan: user.plan } : {}),
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem('nexus_ms_gateway_jwt', token);
    sessionStorage.setItem('nexus_ms_gateway_user', JSON.stringify(user));
  }
  return { token, user };
}

export function seedPortalSession(overrides = {}) {
  const defaultUser = {
    id: 'u-colab-1',
    email: 'colab@empresa.com.br',
    name: 'Ana Silva',
    role: 'collaborator',
    tenantId: 'tenant-acme',
    department: 'Financeiro',
  };
  const user = { ...defaultUser, ...(overrides.user || {}) };
  const token =
    overrides.token ||
    makeFakeJwt({
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenantId,
      department: user.department,
      ...(user.plan ? { plan: user.plan } : {}),
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem('nexus_portal_jwt_v3', token);
    sessionStorage.setItem('nexus_portal_user_v3', JSON.stringify(user));
  }
  return { token, user };
}

function buildFetchResponse(result) {
  if (result instanceof Response) return result;
  const status = result?.status ?? 200;
  const headers = new Headers(result?.headers || {});

  if (result?.body !== undefined) {
    return new Response(result.body, { status, headers });
  }
  if (result?.text !== undefined) {
    if (!headers.has('content-type')) headers.set('content-type', 'text/plain; charset=utf-8');
    return new Response(String(result.text), { status, headers });
  }
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json; charset=utf-8');
  }
  const payload = result?.json !== undefined ? result.json : result ?? {};
  return new Response(JSON.stringify(payload), { status, headers });
}

export function installMockFetch(handlerOrRoutes) {
  let currentHandler = handlerOrRoutes;
  const requests = [];

  const fetchMock = vi.fn(async (input, init = {}) => {
    const urlStr = typeof input === 'string' ? input : input?.url || String(input);
    const parsedUrl = new URL(urlStr, 'http://localhost:8000');
    const method = String(init?.method || (typeof input !== 'string' ? input?.method : null) || 'GET').toUpperCase();

    const headersObj = {};
    const h = new Headers(init?.headers || (typeof input !== 'string' ? input?.headers : undefined) || {});
    h.forEach((v, k) => {
      headersObj[k.toLowerCase()] = v;
    });

    const rawBody = init?.body;
    const isFormData = typeof FormData !== 'undefined' && rawBody instanceof FormData;
    let body = rawBody;
    if (typeof rawBody === 'string' && (headersObj['content-type'] || '').includes('application/json')) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = rawBody;
      }
    }

    const reqCtx = {
      method,
      url: urlStr,
      pathname: parsedUrl.pathname,
      searchParams: parsedUrl.searchParams,
      headers: headersObj,
      authorization: headersObj.authorization || null,
      body,
      rawBody,
      isFormData,
    };
    requests.push(reqCtx);

    let result = null;
    if (typeof currentHandler === 'function') {
      result = await currentHandler(reqCtx);
    } else if (Array.isArray(currentHandler)) {
      for (const route of currentHandler) {
        if (route.method && route.method.toUpperCase() !== method) continue;
        const matched =
          typeof route.match === 'string'
            ? parsedUrl.pathname === route.match
            : route.match instanceof RegExp
              ? route.match.test(parsedUrl.pathname)
              : typeof route.match === 'function'
                ? route.match(reqCtx)
                : false;
        if (matched) {
          result = typeof route.handler === 'function' ? await route.handler(reqCtx) : route.handler;
          break;
        }
      }
    } else if (currentHandler && typeof currentHandler === 'object') {
      const keyWithMethod = `${method} ${parsedUrl.pathname}`;
      const match = currentHandler[keyWithMethod] ?? currentHandler[parsedUrl.pathname];
      if (match !== undefined) {
        result = typeof match === 'function' ? await match(reqCtx) : match;
      }
    }

    if (!result) {
      return buildFetchResponse({ status: 404, json: { error: 'MOCK_ROUTE_NOT_FOUND', path: parsedUrl.pathname } });
    }
    return buildFetchResponse(result);
  });

  vi.stubGlobal('fetch', fetchMock);

  return {
    fetchMock,
    requests,
    clearRequests() {
      requests.length = 0;
    },
    setHandler(nextHandler) {
      currentHandler = nextHandler;
    },
    restore() {
      vi.unstubAllGlobals();
    },
  };
}

export function installMockWebSocket(options = {}) {
  const instances = [];

  class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url) {
      this.CONNECTING = 0;
      this.OPEN = 1;
      this.CLOSING = 2;
      this.CLOSED = 3;
      this.url = String(url);
      this.readyState = MockWebSocket.CONNECTING;
      this.sentRaw = [];
      this.sentJson = [];
      this.listeners = new Map();

      const parsed = new URL(this.url, 'ws://localhost:8000');
      this.queryParams = Object.fromEntries(parsed.searchParams.entries());
      this.clientTag = this.queryParams.client || 'unknown';
      this.token = this.queryParams.token || null;

      this.onopen = null;
      this.onmessage = null;
      this.onclose = null;
      this.onerror = null;

      instances.push(this);

      queueMicrotask(() => {
        if (options.autoRejectCode) {
          this.readyState = MockWebSocket.CLOSED;
          this._dispatch('message', {
            data: JSON.stringify({
              protocol: 'nexusdesk-ws/3.0',
              event: 'auth.rejected',
              message: options.autoRejectMessage || 'Unauthorized',
            }),
          });
          this._dispatch('close', { code: options.autoRejectCode, reason: 'auth.rejected' });
          return;
        }
        if (this.readyState === MockWebSocket.CONNECTING) {
          this.readyState = MockWebSocket.OPEN;
          this._dispatch('open', {});
          if (options.autoWelcome !== false) {
            this._dispatch('message', {
              data: JSON.stringify({
                protocol: 'nexusdesk-ws/3.0',
                event: 'welcome',
                client: this.clientTag,
                timestamp: new Date().toISOString(),
              }),
            });
          }
        }
      });
    }

    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(fn);
    }

    removeEventListener(type, fn) {
      this.listeners.get(type)?.delete(fn);
    }

    _dispatch(type, eventObj) {
      const handler = this[`on${type}`];
      if (typeof handler === 'function') {
        handler.call(this, eventObj);
      }
      const set = this.listeners.get(type);
      if (set) {
        for (const fn of set) {
          fn.call(this, eventObj);
        }
      }
    }

    send(data) {
      const str = typeof data === 'string' ? data : String(data);
      this.sentRaw.push(str);
      try {
        this.sentJson.push(JSON.parse(str));
      } catch {
        /* non-JSON frame */
      }
    }

    close(code = 1000, reason = '') {
      if (this.readyState === MockWebSocket.CLOSED) return;
      this.readyState = MockWebSocket.CLOSED;
      this._dispatch('close', { code, reason });
    }
  }

  vi.stubGlobal('WebSocket', MockWebSocket);

  const serverEmit = (frame, targetInstance = instances[instances.length - 1]) => {
    if (!targetInstance) return;
    const payload = typeof frame === 'string' ? frame : JSON.stringify(frame);
    targetInstance._dispatch('message', { data: payload });
  };

  return {
    MockWebSocket,
    instances,
    getLatest() {
      return instances[instances.length - 1] || null;
    },
    getByClient(clientTag) {
      return instances.filter((ws) => ws.clientTag === clientTag);
    },
    sentFrames(targetInstance) {
      if (targetInstance) return [...targetInstance.sentJson];
      return instances.flatMap((ws) => ws.sentJson);
    },
    serverEmit,
    serverEmitToRoom(frame, predicate) {
      for (const ws of instances) {
        if (ws.readyState !== MockWebSocket.OPEN) continue;
        if (!predicate || predicate(ws)) {
          serverEmit(frame, ws);
        }
      }
    },
    serverClose(code = 1000, reason = '', targetInstance = instances[instances.length - 1]) {
      targetInstance?.close(code, reason);
    },
    restore() {
      vi.unstubAllGlobals();
    },
  };
}

function decodeJwtPayload(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

export function createMockStorageRoutes(initialState = {}) {
  const state = {
    connection: initialState.connection ?? {
      configured: true,
      providerType: 'sftp',
      host: 'mock-vps.internal',
      port: 22,
      username: 'nexus-vault',
      rootPath: '/srv/nexus-vault',
      quotaBytes: 100 * 1024 * 1024,
      usedBytes: 1024,
      status: 'connected',
      latencyMs: 12,
    },
    nodes: initialState.nodes
      ? [...initialState.nodes]
      : [
          {
            id: 'node-corp',
            parentId: null,
            name: 'Corporativo-Publico',
            type: 'folder',
            virtualPath: '/Corporativo-Publico',
            sizeBytes: 0,
            effectiveAccess: 'reader',
            isTrashed: false,
            lockedByEmail: null,
            createdByEmail: 'ti@empresa.com.br',
          },
          {
            id: 'node-fin',
            parentId: null,
            name: 'Setores',
            type: 'folder',
            virtualPath: '/Setores',
            sizeBytes: 0,
            effectiveAccess: 'editor',
            isTrashed: false,
            lockedByEmail: null,
            createdByEmail: 'ti@empresa.com.br',
          },
          {
            id: 'node-manual',
            parentId: 'node-corp',
            name: 'manual-colaborador.pdf',
            type: 'file',
            mimeType: 'application/pdf',
            virtualPath: '/Corporativo-Publico/manual-colaborador.pdf',
            sizeBytes: 1024,
            effectiveAccess: 'viewer_online',
            isTrashed: false,
            lockedByEmail: null,
            createdByEmail: 'ti@empresa.com.br',
            content: Buffer.from('%PDF-1.4\n%Nexus Mock PDF\n', 'utf8'),
          },
        ],
    acls: initialState.acls ? [...initialState.acls] : [],
    links: initialState.links ? [...initialState.links] : [],
    audit: initialState.audit ? [...initialState.audit] : [],
    sheets: initialState.sheets ? { ...initialState.sheets } : {},
    archivedTickets: [],
    archivedTerms: [],
  };

  return (req) => {
    const claims = decodeJwtPayload(req.authorization);
    const { method, pathname, searchParams, body } = req;

    if (method === 'POST' && pathname === '/api/v1/auth/login') {
      const email = body?.email || 'ti@empresa.com.br';
      const user = {
        id: 'u-mock-1',
        email,
        name: 'Mock User',
        role: email.includes('colab') ? 'collaborator' : 'owner',
        tenantId: 'tenant-acme',
        department: 'TI',
      };
      return {
        status: 200,
        json: { accessToken: makeFakeJwt(user), tokenType: 'Bearer', expiresIn: 28800, user },
      };
    }

    if (pathname.startsWith('/api/v1/storage')) {
      if (claims?.role === 'superadmin') {
        return {
          status: 403,
          json: { error: 'ZERO_KNOWLEDGE_RESTRICTED', message: 'Superadmin blocked by LGPD Zero-Knowledge.' },
        };
      }
      if (claims?.plan === 'starter' && !pathname.startsWith('/api/v1/storage/share/')) {
        return {
          status: 403,
          json: {
            error: 'FEATURE_NOT_IN_PLAN',
            message: 'Módulo Cloud Vault não disponível no plano starter.',
          },
        };
      }

      if (method === 'GET' && pathname === '/api/v1/storage/connection') {
        return { status: 200, json: state.connection || { configured: false } };
      }

      if (method === 'PUT' && pathname === '/api/v1/storage/connection') {
        state.connection = { ...state.connection, ...body, configured: true };
        return { status: 200, json: state.connection };
      }

      if (method === 'POST' && pathname === '/api/v1/storage/connection/test') {
        return {
          status: 200,
          json: {
            ok: true,
            status: 'connected',
            latencyMs: 9,
            freeBytes: (state.connection?.quotaBytes || 100000) - (state.connection?.usedBytes || 0),
            totalBytes: state.connection?.quotaBytes || 100000,
          },
        };
      }

      if (method === 'GET' && pathname === '/api/v1/storage/quota') {
        const quotaBytes = state.connection?.quotaBytes ?? 100 * 1024 * 1024;
        const usedBytes = state.nodes
          .filter((n) => n.type === 'file')
          .reduce((acc, n) => acc + (n.sizeBytes || 0), 0);
        const pct = quotaBytes > 0 ? Math.round((usedBytes / quotaBytes) * 100) : 0;
        const alertLevel = pct >= 100 ? 'exceeded' : pct >= 90 ? 'critical_90' : pct >= 80 ? 'warning_80' : 'ok';
        return {
          status: 200,
          json: { quotaBytes, usedBytes, usagePercent: pct, alertLevel, byDepartment: {} },
        };
      }

      if (method === 'GET' && pathname === '/api/v1/storage/nodes') {
        const parentId = searchParams.get('parentId') || null;
        const q = (searchParams.get('q') || '').toLowerCase();
        const items = state.nodes.filter((n) => {
          if (n.isTrashed) return false;
          if (n.effectiveAccess === 'none') return false;
          if (q) return n.name.toLowerCase().includes(q);
          return (n.parentId || null) === (parentId || null);
        });
        return { status: 200, json: { items } };
      }

      if (method === 'POST' && pathname === '/api/v1/storage/folders') {
        const created = {
          id: `node-${state.nodes.length + 1}`,
          parentId: body?.parentId || null,
          name: body?.name || 'Nova Pasta',
          type: 'folder',
          virtualPath: `/${body?.name || 'Nova Pasta'}`,
          sizeBytes: 0,
          effectiveAccess: 'full_control',
          isTrashed: false,
          lockedByEmail: null,
          createdByEmail: claims?.email || 'ti@empresa.com.br',
        };
        state.nodes.push(created);
        return { status: 201, json: { node: created } };
      }

      if (method === 'POST' && pathname === '/api/v1/storage/upload') {
        const sizeBytes = Number(req.headers['x-file-size'] || 256);
        const quotaBytes = state.connection?.quotaBytes ?? 100 * 1024 * 1024;
        const usedBytes = state.nodes.filter((n) => n.type === 'file').reduce((s, n) => s + (n.sizeBytes || 0), 0);
        if (usedBytes + sizeBytes > quotaBytes) {
          return { status: 413, json: { error: 'QUOTA_EXCEEDED', message: 'Cota excedida' } };
        }
        const name = req.headers['x-file-name'] || body?.name || `upload-${state.nodes.length + 1}.txt`;
        const created = {
          id: `node-${state.nodes.length + 1}`,
          parentId: req.headers['x-parent-id'] || body?.parentId || null,
          name,
          type: 'file',
          mimeType: 'text/plain',
          virtualPath: `/${name}`,
          sizeBytes,
          effectiveAccess: 'full_control',
          isTrashed: false,
          lockedByEmail: null,
          createdByEmail: claims?.email || 'ti@empresa.com.br',
          content: Buffer.from('mock uploaded content', 'utf8'),
        };
        state.nodes.push(created);
        return { status: 201, json: { node: created } };
      }

      const previewMatch = /^\/api\/v1\/storage\/nodes\/([^/]+)\/preview$/.exec(pathname);
      if (method === 'GET' && previewMatch) {
        const node = state.nodes.find((n) => n.id === previewMatch[1] && !n.isTrashed);
        if (!node) return { status: 404, json: { error: 'NOT_FOUND' } };
        return {
          status: 200,
          headers: {
            'content-type': node.mimeType || 'application/octet-stream',
            'content-disposition': `inline; filename="${node.name}"`,
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          },
          body: node.content || Buffer.from('preview-bytes', 'utf8'),
        };
      }

      const downloadMatch = /^\/api\/v1\/storage\/nodes\/([^/]+)\/download$/.exec(pathname);
      if (method === 'GET' && downloadMatch) {
        const node = state.nodes.find((n) => n.id === downloadMatch[1] && !n.isTrashed);
        if (!node) return { status: 404, json: { error: 'NOT_FOUND' } };
        if (node.effectiveAccess === 'viewer_online') {
          return { status: 403, json: { error: 'FORBIDDEN', message: 'Download bloqueado para viewer_online' } };
        }
        return {
          status: 200,
          headers: {
            'content-type': node.mimeType || 'application/octet-stream',
            'content-disposition': `attachment; filename="${node.name}"`,
          },
          body: node.content || Buffer.from('download-bytes', 'utf8'),
        };
      }

      const lockMatch = /^\/api\/v1\/storage\/nodes\/([^/]+)\/lock$/.exec(pathname);
      if (lockMatch) {
        const node = state.nodes.find((n) => n.id === lockMatch[1]);
        if (!node) return { status: 404, json: { error: 'NOT_FOUND' } };
        if (method === 'POST') {
          if (node.lockedByEmail && node.lockedByEmail !== claims?.email) {
            return { status: 423, json: { error: 'LOCKED', lockedByEmail: node.lockedByEmail } };
          }
          node.lockedByEmail = claims?.email || 'ti@empresa.com.br';
          return { status: 200, json: { node } };
        }
        if (method === 'DELETE') {
          if (
            node.lockedByEmail &&
            node.lockedByEmail !== claims?.email &&
            !['owner', 'admin'].includes(claims?.role)
          ) {
            return {
              status: 423,
              json: {
                error: 'LOCKED',
                message: 'Somente o detentor do lock ou administrador pode desbloquear.',
                lockedByEmail: node.lockedByEmail,
              },
            };
          }
          node.lockedByEmail = null;
          return { status: 200, json: { node } };
        }
      }

      const nodeMatch = /^\/api\/v1\/storage\/nodes\/([^/]+)$/.exec(pathname);
      if (method === 'DELETE' && nodeMatch) {
        const node = state.nodes.find((n) => n.id === nodeMatch[1]);
        if (!node) return { status: 404, json: { error: 'NOT_FOUND' } };
        if (node.lockedByEmail && node.lockedByEmail !== claims?.email) {
          return { status: 423, json: { error: 'LOCKED' } };
        }
        node.isTrashed = true;
        return { status: 200, json: { ok: true, id: node.id } };
      }

      if (method === 'GET' && pathname === '/api/v1/storage/trash') {
        return { status: 200, json: { items: state.nodes.filter((n) => n.isTrashed) } };
      }

      if (method === 'POST' && pathname === '/api/v1/storage/sheets') {
        const id = `sheet-${Object.keys(state.sheets).length + 1}`;
        const workbook = {
          id,
          name: body?.name || 'Planilha.xlsx',
          rev: 1,
          sheets: body?.tabs || [{ name: 'Planilha1', cells: {}, freezeRow: 1 }],
        };
        state.sheets[id] = workbook;
        return { status: 201, json: workbook };
      }

      const sheetMatch = /^\/api\/v1\/storage\/sheets\/([^/]+)$/.exec(pathname);
      if (method === 'GET' && sheetMatch) {
        const sheet = state.sheets[sheetMatch[1]];
        if (!sheet) return { status: 404, json: { error: 'NOT_FOUND' } };
        return { status: 200, json: sheet };
      }
    }

    const ticketArchiveMatch = /^\/api\/v1\/tickets\/([^/]+)\/archive-vps$/.exec(pathname);
    if (method === 'POST' && ticketArchiveMatch) {
      const id = ticketArchiveMatch[1];
      state.archivedTickets.push(id);
      return {
        status: 200,
        json: { archived: true, folderPath: `/Chamados/${id}/`, files: ['resumo.json'] },
      };
    }

    const termArchiveMatch = /^\/api\/v1\/compliance\/terms\/([^/]+)\/archive-vps$/.exec(pathname);
    if (method === 'POST' && termArchiveMatch) {
      const id = termArchiveMatch[1];
      state.archivedTerms.push(id);
      return {
        status: 200,
        json: { archived: true, virtualPath: `/Cofre-TI-Infra/Termos/termo-${id}.txt`, nodeId: `term-${id}` },
      };
    }

    return { status: 404, json: { error: 'MOCK_ROUTE_NOT_FOUND', path: pathname } };
  };
}
