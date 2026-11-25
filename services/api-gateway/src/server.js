// services/api-gateway/src/server.js
// =============================================================================
// NEXUS API GATEWAY & EDGE SECURITY (`api-gateway` — Porta 8000)
// =============================================================================
// Responsabilidades:
//  1. Terminação de Segurança: Helmet, CORS restritivo, Rate Limiting anti-abuso
//  2. Autenticação Stateless JWT (HS256) + Verificação de senha com Scrypt
//  3. Injeção de Assinatura Zero-Trust (`X-Gateway-Signature`) para microsserviços
//  4. Roteamento Reverso HTTP para as 4 APIs REST + Bridge WebSocket para API 5
//  5. Healthcheck distribuído (`/health`) e Catálogo OpenAPI 3.1 (`/docs`)
// =============================================================================

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import WebSocket from 'ws';

const UPSTREAM_HTTP_AGENT = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 60_000,
  maxSockets: 128,
  maxFreeSockets: 32,
  scheduling: 'lifo',
  timeout: 65_000,
});

const UPSTREAM_HTTPS_AGENT = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 60_000,
  maxSockets: 128,
  maxFreeSockets: 32,
  scheduling: 'lifo',
  timeout: 65_000,
});

function requestUpstreamKeepAlive(targetUrl, { method = 'GET', headers = {}, body = undefined, timeoutMs = 25_000 } = {}) {
  const parsed = new URL(targetUrl);
  const isHttps = parsed.protocol === 'https:';
  const transport = isHttps ? https : http;
  const agent = isHttps ? UPSTREAM_HTTPS_AGENT : UPSTREAM_HTTP_AGENT;
  const upperMethod = String(method || 'GET').toUpperCase();
  const bodyBuf =
    body === undefined || body === null || ['GET', 'HEAD'].includes(upperMethod)
      ? null
      : Buffer.isBuffer(body)
        ? body
        : Buffer.from(String(body), 'utf8');

  const reqHeaders = {
    Connection: 'keep-alive',
    ...headers,
  };
  if (!['GET', 'HEAD'].includes(upperMethod)) {
    reqHeaders['content-length'] = bodyBuf ? bodyBuf.length : 0;
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const req = transport.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: upperMethod,
        headers: reqHeaders,
        agent,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          if (settled) return;
          settled = true;
          const rawHeaders = res.headers || {};
          resolve({
            status: res.statusCode || 500,
            ok: (res.statusCode || 500) >= 200 && (res.statusCode || 500) < 300,
            buffer: Buffer.concat(chunks),
            headers: {
              get(name) {
                const v = rawHeaders[String(name || '').toLowerCase()];
                return Array.isArray(v) ? v.join(', ') : v !== undefined ? String(v) : null;
              },
            },
          });
        });
        res.on('error', (err) => {
          if (settled) return;
          settled = true;
          reject(err);
        });
      },
    );

    req.setNoDelay(true);
    req.setTimeout(timeoutMs, () => {
      if (!settled) {
        settled = true;
        const err = new Error('timeout');
        err.code = 'ETIMEDOUT';
        req.destroy(err);
        reject(err);
      }
    });
    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      err.reusedSocket = Boolean(req.reusedSocket);
      reject(err);
    });

    if (bodyBuf && bodyBuf.length > 0) {
      req.write(bodyBuf);
    }
    req.end();
  });
}
import { assetsRepo, authRepo, checkDbHealth, initDatabase, isAssetAssignedToUser } from '../../shared/db.js';
import {
  decryptVaultCredentials,
  encryptVaultCredentials,
  requireRoles,
  sanitizeText,
  signGatewayContext,
  signJwt,
  verifyJwt,
  verifyPassword,
} from '../../shared/security.js';
import { buildZipArchive } from '../../service-storage/src/services/zipBuilder.js';
import { buildOpenApiSpec, renderDocsHtml } from './openapiSpec.js';

const GATEWAY_DIR = path.dirname(fileURLToPath(import.meta.url));
const CURRENT_AGENT_VERSION = '3.5.0';
const COMPUTER_ASSET_TYPES_RE = /note|laptop|comp|desk|serv|workstation|all-in-one|pc/i;

function loadBundledAgentBinary() {
  const candidates = [
    path.resolve(GATEWAY_DIR, '../../shared/assets/NexusAgent.exe'),
    path.resolve(GATEWAY_DIR, '../../../public/downloads/NexusAgent.exe'),
    '/app/shared/assets/NexusAgent.exe',
    '/app/downloads/NexusAgent.exe',
  ];
  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath)) {
        const buf = fs.readFileSync(filePath);
        if (buf.length > 30_000) return buf;
      }
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

const isValidWsCloseCode = (code) =>
  typeof code === 'number' &&
  ((code >= 1000 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006) ||
    (code >= 3000 && code <= 4999));

export async function buildApiGateway(opts = {}) {
  await initDatabase();

  const upstreams = {
    assets: opts.assetsUrl || process.env.ASSETS_SERVICE_URL || 'http://127.0.0.1:8001',
    tickets: opts.ticketsUrl || process.env.TICKETS_SERVICE_URL || 'http://127.0.0.1:8002',
    compliance: opts.complianceUrl || process.env.COMPLIANCE_SERVICE_URL || 'http://127.0.0.1:8003',
    nexusdesk: opts.nexusdeskUrl || process.env.NEXUSDESK_SERVICE_URL || 'http://127.0.0.1:8004',
    storage: opts.storageUrl || process.env.STORAGE_SERVICE_URL || 'http://127.0.0.1:8005',
  };

  function isCloudStorageEntitled(contract) {
    if (!contract) return true;
    const planId = String(contract.plan || 'enterprise').toLowerCase().trim();
    const overrides = contract.overrides && typeof contract.overrides === 'object' ? contract.overrides : {};
    const featOverride = overrides.features?.cloud_storage ?? overrides.cloud_storage;
    if (typeof featOverride === 'boolean') return featOverride;

    const customContract =
      contract.customContract && typeof contract.customContract === 'object' ? contract.customContract : {};
    if (customContract.enabled && typeof customContract.features?.cloud_storage === 'boolean') {
      return customContract.features.cloud_storage;
    }

    if (planId === 'pro' || planId === 'enterprise') return true;
    return false;
  }

  const allowedOriginsEnv = (
    process.env.CORS_ALLOWED_ORIGINS ||
    process.env.CORS_ORIGINS ||
    ''
  ).trim();
  const corsOrigin =
    allowedOriginsEnv && allowedOriginsEnv !== '*'
      ? allowedOriginsEnv
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean)
      : true;

  const CONTRACT_CACHE_TTL_MS = 15_000;
  const tenantContractCache = new Map();

  async function getCachedTenantContract(tenantId) {
    const key = String(tenantId || '');
    const now = Date.now();
    const hit = tenantContractCache.get(key);
    if (hit && hit.expiresAt > now) {
      return hit.contract;
    }
    const contract = await authRepo.getTenantContract(tenantId);
    tenantContractCache.set(key, { contract, expiresAt: now + CONTRACT_CACHE_TTL_MS });
    return contract;
  }

  function invalidateTenantContractCache(tenantId) {
    if (tenantId) tenantContractCache.delete(String(tenantId));
  }

  const app = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: 110 * 1024 * 1024,
    trustProxy: true,
    keepAliveTimeout: 65_000,
    forceCloseConnections: 'idle',
  });

  app.addContentTypeParser('multipart/form-data', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  await app.register(cors, {
    origin: corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Agent-Token',
      'X-Tenant-Id',
      'X-Request-Id',
      'Range',
      'X-Share-Password',
      'X-Desktop-Session-Token',
    ],
    exposedHeaders: [
      'Content-Disposition',
      'X-Nexus-Agent-Version',
      'X-Nexus-Agent-Patrimony',
      'X-Nexus-Agent-Configured',
    ],
    credentials: true,
  });

  await app.register(rateLimit, {
    max: Number(process.env.RATE_LIMIT_MAX || 600),
    timeWindow: '1 minute',
    allowList: (req) => {
      const u = (req.url || '').split('?')[0];
      return u === '/health' || u === '/docs' || u === '/openapi.json' || u.startsWith('/ws/');
    },
  });

  await app.register(websocket, {
    options: { maxPayload: 4 * 1024 * 1024 },
  });

  // Correlation ID distribuído em todas as respostas
  app.addHook('onRequest', async (request, reply) => {
    const reqId = sanitizeText(request.headers['x-request-id'] || '', 64) || crypto.randomUUID();
    request.correlationId = reqId;
    reply.header('x-request-id', reqId);
    reply.header('x-powered-by', 'Nexus-ZeroTrust-Gateway/3.0');
  });

  app.setErrorHandler((error, request, reply) => {
    const status = error.statusCode || (error.validation ? 400 : 500);
    reply.code(status).send({
      error:
        status === 429
          ? 'RATE_LIMIT_EXCEEDED'
          : status >= 500
            ? 'GATEWAY_ERROR'
            : 'AUTH_OR_VALIDATION_ERROR',
      message: error.message || 'Erro no API Gateway.',
      requestId: request.correlationId,
    });
  });

  // ---------------------------------------------------------------------------
  // Documentação OpenAPI 3.1 & Healthcheck Distribuído
  // ---------------------------------------------------------------------------
  app.get('/openapi.json', async (request) => {
    const proto = request.headers['x-forwarded-proto'] || 'http';
    const host = request.headers.host || 'localhost:8000';
    return buildOpenApiSpec(`${proto}://${host}`);
  });

  app.get('/docs', async (_request, reply) => {
    reply.type('text/html; charset=utf-8').send(renderDocsHtml());
  });

  async function probeUpstream(name, baseUrl) {
    const started = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      const res = await fetch(`${baseUrl}/health`, { signal: controller.signal }).finally(() =>
        clearTimeout(timer),
      );
      const body = await res.json().catch(() => ({}));
      return {
        service: name,
        status: res.ok ? 'healthy' : 'degraded',
        latencyMs: Date.now() - started,
        details: body,
      };
    } catch (err) {
      return {
        service: name,
        status: 'unreachable',
        latencyMs: Date.now() - started,
        error: err.message,
      };
    }
  }

  app.get('/health', async () => {
    const [db, assets, tickets, compliance, nexusdesk, storage] = await Promise.all([
      checkDbHealth(),
      probeUpstream('service-assets', upstreams.assets),
      probeUpstream('service-tickets', upstreams.tickets),
      probeUpstream('service-compliance', upstreams.compliance),
      probeUpstream('service-nexusdesk', upstreams.nexusdesk),
      probeUpstream('service-storage', upstreams.storage),
    ]);

    const services = [assets, tickets, compliance, nexusdesk, storage];
    const allHealthy =
      db.status === 'healthy' && services.every((s) => s.status === 'healthy');

    return {
      gateway: 'nexus-api-gateway',
      version: '3.0.0',
      architecture: 'Microservices + Dual-Frontend (React 19 & Vue 3)',
      overallStatus: allHealthy ? 'healthy' : 'degraded',
      database: db,
      microservices: services,
      timestamp: new Date().toISOString(),
    };
  });

  // ---------------------------------------------------------------------------
  // Autenticação Centralizada & Proteção Anti-Brute-Force
  // ---------------------------------------------------------------------------
  app.post(
    '/api/v1/auth/login',
    {
      config: {
        rateLimit: {
          max: Number(process.env.LOGIN_RATE_LIMIT_MAX || 60),
          timeWindow: '1 minute',
        },
      },
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', minLength: 5, maxLength: 180 },
            password: { type: 'string', minLength: 4, maxLength: 128 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const email = sanitizeText(request.body.email, 180).toLowerCase();
      const user = await authRepo.findUserByEmail(email);

      if (!user || !user.active || !verifyPassword(request.body.password, user.password_hash)) {
        return reply.code(401).send({
          error: 'INVALID_CREDENTIALS',
          message: 'Credenciais inválidas ou conta desativada.',
        });
      }

      if (user.tenant_status !== 'active') {
        return reply.code(403).send({
          error: 'TENANT_SUSPENDED',
          message: 'A assinatura corporativa desta empresa encontra-se suspensa.',
        });
      }

      const accessToken = signJwt(
        {
          sub: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          tenantId: user.tenant_id,
          department: user.department,
        },
        8 * 3600,
      );

      return {
        accessToken,
        tokenType: 'Bearer',
        expiresIn: 8 * 3600,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          department: user.department,
          jobTitle: user.job_title,
          tenantId: user.tenant_id,
          tenantName: user.tenant_name,
          assetPrefix: user.asset_prefix,
          primaryColor: user.primary_color || null,
          logoUrl: user.logo_url || null,
          plan: user.tenant_plan || 'enterprise',
          overrides: user.tenant_overrides || {},
          customContract: user.tenant_custom_contract || {},
        },
      };
    },
  );

  app.get('/api/v1/auth/me', async (request, reply) => {
    let claims;
    try {
      claims = verifyJwt(request.headers.authorization || '');
    } catch (err) {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: err.message });
    }
    const user = await authRepo.findUserById(claims.sub);
    if (!user || !user.active) {
      return reply.code(401).send({ error: 'SESSION_INVALID', message: 'Usuário inativo.' });
    }
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      department: user.department,
      jobTitle: user.job_title,
      tenantId: user.tenant_id,
      tenantName: user.tenant_name,
      assetPrefix: user.asset_prefix,
      primaryColor: user.primary_color || null,
      logoUrl: user.logo_url || null,
      plan: user.tenant_plan || 'enterprise',
      overrides: user.tenant_overrides || {},
      customContract: user.tenant_custom_contract || {},
    };
  });

  app.get('/api/v1/auth/contract', async (request, reply) => {
    let claims;
    try {
      claims = verifyJwt(request.headers.authorization || '');
    } catch (err) {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: err.message });
    }
    requireRoles(claims, ['owner', 'admin', 'manager']);
    const contract = await authRepo.getTenantContract(claims.tenantId);
    if (!contract) {
      return reply.code(404).send({ error: 'TENANT_NOT_FOUND', message: 'Empresa não encontrada.' });
    }
    return contract;
  });

  app.put(
    '/api/v1/auth/contract',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            plan: { type: 'string', minLength: 2, maxLength: 32 },
            companyName: { type: ['string', 'null'], maxLength: 160 },
            primaryColor: { type: ['string', 'null'], maxLength: 32 },
            logoUrl: { type: ['string', 'null'], maxLength: 600000 },
            overrides: { type: 'object' },
            customContract: { type: 'object' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      let claims;
      try {
        claims = verifyJwt(request.headers.authorization || '');
      } catch (err) {
        return reply.code(401).send({ error: 'UNAUTHORIZED', message: err.message });
      }
      requireRoles(claims, ['owner']);
      const updated = await authRepo.updateTenantContract(claims.tenantId, request.body || {});
      invalidateTenantContractCache(claims.tenantId);
      return updated;
    },
  );

  // ---------------------------------------------------------------------------
  // Configuração Criptografada do Agente por Tenant + Pacote ZIP Pré-Configurado
  // ---------------------------------------------------------------------------
  app.put(
    '/api/v1/auth/agent-config',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            agentToken: { type: 'string', minLength: 8, maxLength: 256 },
            projectId: { type: 'string', minLength: 2, maxLength: 120 },
            apiKey: { type: 'string', minLength: 8, maxLength: 256 },
            relayBase: { type: 'string', maxLength: 256 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      let claims;
      try {
        claims = verifyJwt(request.headers.authorization || '');
      } catch (err) {
        return reply.code(401).send({ error: 'UNAUTHORIZED', message: err.message });
      }
      requireRoles(claims, ['owner', 'admin']);

      const body = request.body || {};
      const existingRec = await authRepo.getTenantAgentConfig(claims.tenantId);
      let existingCfg = {};
      if (existingRec?.encryptedConfig) {
        try {
          existingCfg = decryptVaultCredentials(existingRec.encryptedConfig) || {};
        } catch {
          existingCfg = {};
        }
      }

      const merged = {
        projectId: sanitizeText(body.projectId || existingCfg.projectId || process.env.VITE_FIREBASE_PROJECT_ID || 'itam-nexus', 120),
        apiKey: sanitizeText(body.apiKey || existingCfg.apiKey || process.env.VITE_FIREBASE_API_KEY || '', 256),
        agentToken: sanitizeText(body.agentToken || existingCfg.agentToken || '', 256),
        relayBase: sanitizeText(
          body.relayBase || existingCfg.relayBase || process.env.VITE_API_GATEWAY_URL || '',
          256,
        ).replace(/\/+$/, ''),
        updatedAt: new Date().toISOString(),
        updatedBy: claims.email,
      };

      const encryptedConfig = encryptVaultCredentials(merged);
      const saved = await authRepo.saveTenantAgentConfig(claims.tenantId, {
        encryptedConfig,
        rawAgentToken: merged.agentToken || undefined,
      });

      return {
        ok: true,
        tenantId: saved.tenantId,
        configured: Boolean(merged.agentToken && merged.projectId),
        hasToken: Boolean(merged.agentToken),
        agentVersion: CURRENT_AGENT_VERSION,
      };
    },
  );

  app.get('/api/v1/auth/agent-config/status', async (request, reply) => {
    let claims;
    try {
      claims = verifyJwt(request.headers.authorization || '');
    } catch (err) {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: err.message });
    }
    const rec = await authRepo.getTenantAgentConfig(claims.tenantId);
    let cfg = {};
    if (rec?.encryptedConfig) {
      try {
        cfg = decryptVaultCredentials(rec.encryptedConfig) || {};
      } catch {
        cfg = {};
      }
    }
    return {
      tenantId: claims.tenantId,
      configured: Boolean(cfg.agentToken),
      hasToken: Boolean(cfg.agentToken),
      projectId: cfg.projectId || process.env.VITE_FIREBASE_PROJECT_ID || 'itam-nexus',
      agentVersion: CURRENT_AGENT_VERSION,
    };
  });

  app.get('/api/v1/agent/package', async (request, reply) => {
    let claims;
    try {
      claims = verifyJwt(request.headers.authorization || '');
    } catch (err) {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: err.message });
    }

    const exeBuf = loadBundledAgentBinary();
    if (!exeBuf) {
      return reply.code(503).send({
        error: 'AGENT_BINARY_UNAVAILABLE',
        message: 'Binário NexusAgent.exe indisponível no servidor no momento.',
      });
    }

    const tenantId = claims.tenantId;
    const rec = await authRepo.getTenantAgentConfig(tenantId);
    let storedCfg = {};
    if (rec?.encryptedConfig) {
      try {
        storedCfg = decryptVaultCredentials(rec.encryptedConfig) || {};
      } catch {
        storedCfg = {};
      }
    }

    const reqAssetId = sanitizeText(request.query?.assetId || '', 120);
    const reqPatrimony = sanitizeText(request.query?.patrimony || '', 64).toUpperCase();
    const isColab = claims.role === 'collaborator';

    let resolvedPatrimony = '';
    let resolvedAssetLabel = '';

    const candidateAssets = await assetsRepo.list(tenantId, isColab ? {
      assignedToEmail: claims.email,
      assignedToName: claims.name,
    } : {});

    let matchedAsset = null;
    if (reqAssetId) {
      matchedAsset = candidateAssets.find((a) => String(a.id) === reqAssetId) || null;
      if (!matchedAsset && isColab) {
        return reply.code(403).send({
          error: 'ASSET_NOT_IN_CUSTODY',
          message: 'Você só pode gerar o pacote do agente para equipamentos sob sua custódia.',
        });
      }
    }
    if (!matchedAsset && reqPatrimony) {
      matchedAsset =
        candidateAssets.find(
          (a) => String(a.internal_id || '').trim().toUpperCase() === reqPatrimony,
        ) || null;
      if (!matchedAsset && isColab) {
        return reply.code(403).send({
          error: 'ASSET_NOT_IN_CUSTODY',
          message: 'O patrimônio informado não pertence à sua custódia ativa.',
        });
      }
    }
    if (!matchedAsset && isColab && candidateAssets.length > 0) {
      // Seleciona automaticamente o primeiro notebook/computador ativo sob custódia do colaborador
      matchedAsset =
        candidateAssets.find((a) => COMPUTER_ASSET_TYPES_RE.test(String(a.type || ''))) ||
        candidateAssets[0];
    }

    if (matchedAsset) {
      if (isColab && !isAssetAssignedToUser(matchedAsset, { email: claims.email, name: claims.name })) {
        return reply.code(403).send({
          error: 'ASSET_NOT_IN_CUSTODY',
          message: 'Ativo fora da custódia do usuário autenticado.',
        });
      }
      resolvedPatrimony = String(matchedAsset.internal_id || '').trim().toUpperCase();
      resolvedAssetLabel = [matchedAsset.internal_id, matchedAsset.model].filter(Boolean).join(' — ');
    } else if (!isColab && reqPatrimony) {
      resolvedPatrimony = reqPatrimony;
      resolvedAssetLabel = reqPatrimony;
    }

    const proto = String(request.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    const hostHeader = String(request.headers['x-forwarded-host'] || request.headers.host || '').split(',')[0].trim();
    const inferredRelay = hostHeader ? `${proto}://${hostHeader}` : '';

    const projectId = storedCfg.projectId || process.env.VITE_FIREBASE_PROJECT_ID || 'itam-nexus';
    const apiKey = storedCfg.apiKey || process.env.VITE_FIREBASE_API_KEY || '';
    const agentToken = storedCfg.agentToken || '';
    const relayBase = (
      storedCfg.relayBase ||
      process.env.VITE_API_GATEWAY_URL ||
      inferredRelay ||
      'https://itam-api-164-152-195-199.sslip.io'
    ).replace(/\/+$/, '');

    const configPayload = {
      projectId,
      apiKey,
      tenantId,
      agentToken,
      patrimony: resolvedPatrimony,
      relayBase,
    };

    const readmeLines = [
      `Nexus ITAM — Agente Windows v${CURRENT_AGENT_VERSION} (Pacote Pré-Configurado)`,
      '========================================================================',
      `Empresa (Tenant): ${rec?.companyName || tenantId} (${tenantId})`,
      resolvedAssetLabel
        ? `Equipamento / Patrimônio vinculado: ${resolvedAssetLabel}`
        : 'Equipamento / Patrimônio: Detecção automática pelo hostname/serial',
      `Relay VPS de Baixa Latência: ${relayBase}`,
      '',
      'COMO INSTALAR (1 CLIQUE):',
      '  1. Extraia TODO o conteúdo deste arquivo .ZIP para uma pasta (ex.: Área de Trabalho).',
      '     IMPORTANTE: mantenha o arquivo config.json na MESMA pasta do NexusAgent.exe.',
      '  2. Abra o NexusAgent.exe e clique em "Conectar este computador" (aceite o aviso de Administrador).',
      '  3. Pronto! O computador já entra vinculado à sua empresa e patrimônio, com NexusDesk 60 FPS',
      '     e edição sincronizada de arquivos (Excel/Word) na nuvem ativos.',
      '',
      agentToken
        ? 'Status da configuração: PRONTO PARA USO (config.json do tenant incluído).'
        : 'Aviso: token de matrícula do tenant ainda não sincronizado pelo administrador de TI.',
    ].join('\r\n');

    const zipBuffer = buildZipArchive([
      { name: 'NexusAgent.exe', buffer: exeBuf },
      { name: 'config.json', buffer: Buffer.from(JSON.stringify(configPayload, null, 2), 'utf8') },
      { name: 'LEIA-ME.txt', buffer: Buffer.from(`\uFEFF${readmeLines}`, 'utf8') },
    ]);

    const safeTag = (resolvedPatrimony || tenantId).replace(/[^A-Za-z0-9._-]+/g, '-');
    const fileName = `NexusAgent-${safeTag}.zip`;

    reply.header('content-type', 'application/zip');
    reply.header('content-disposition', `attachment; filename="${fileName}"`);
    reply.header('cache-control', 'no-store, no-cache, must-revalidate');
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-nexus-agent-version', CURRENT_AGENT_VERSION);
    reply.header('x-nexus-agent-patrimony', resolvedPatrimony || '');
    reply.header('x-nexus-agent-configured', agentToken ? 'true' : 'false');
    return reply.send(zipBuffer);
  });

  app.get('/api/v1/auth/users', async (request, reply) => {
    let claims;
    try {
      claims = verifyJwt(request.headers.authorization || '');
    } catch (err) {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: err.message });
    }
    requireRoles(claims, ['owner', 'admin', 'manager', 'operator']);
    const users = await authRepo.listTenantUsers(claims.tenantId);
    return { tenantId: claims.tenantId, total: users.length, items: users };
  });

  app.post(
    '/api/v1/auth/users',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name', 'email', 'password'],
          properties: {
            name: { type: 'string', minLength: 2, maxLength: 160 },
            email: { type: 'string', minLength: 5, maxLength: 180 },
            password: { type: 'string', minLength: 8, maxLength: 128 },
            role: {
              type: 'string',
              enum: ['owner', 'admin', 'manager', 'operator', 'viewer', 'collaborator'],
            },
            department: { type: 'string', maxLength: 120 },
            jobTitle: { type: 'string', maxLength: 120 },
            active: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      let claims;
      try {
        claims = verifyJwt(request.headers.authorization || '');
      } catch (err) {
        return reply.code(401).send({ error: 'UNAUTHORIZED', message: err.message });
      }
      requireRoles(claims, ['owner', 'admin', 'manager']);
      const body = request.body;
      const targetTenantId = claims.tenantId;

      try {
        const newUser = await authRepo.createUser({
          tenantId: targetTenantId,
          name: sanitizeText(body.name, 160),
          email: sanitizeText(body.email, 180),
          password: body.password,
          role: body.role || 'collaborator',
          department: sanitizeText(body.department || 'Geral', 120),
          jobTitle: sanitizeText(body.jobTitle || 'Colaborador', 120),
          active: body.active !== undefined ? body.active : true,
        });
        return reply.code(201).send({ user: newUser });
      } catch (err) {
        const status = err.statusCode || 400;
        return reply.code(status).send({
          error: 'USER_CREATION_FAILED',
          message: err.message,
        });
      }
    },
  );

  app.patch(
    '/api/v1/auth/users/:id',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 2, maxLength: 160 },
            department: { type: 'string', maxLength: 120 },
            jobTitle: { type: 'string', maxLength: 120 },
            active: { type: 'boolean' },
            password: { type: 'string', minLength: 8, maxLength: 128 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      let claims;
      try {
        claims = verifyJwt(request.headers.authorization || '');
      } catch (err) {
        return reply.code(401).send({ error: 'UNAUTHORIZED', message: err.message });
      }
      requireRoles(claims, ['owner', 'admin', 'manager']);
      const { id } = request.params;
      const target = await authRepo.findTenantUserById(id, claims.tenantId);
      if (!target) {
        return reply.code(404).send({ error: 'USER_NOT_FOUND', message: 'Usuário não encontrado.' });
      }
      if (target.role === 'owner' && claims.role !== 'owner') {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Apenas o proprietário pode alterar o acesso principal.' });
      }
      if (claims.role === 'manager' && target.role !== 'collaborator') {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Gestores só podem gerenciar acessos do Portal do Colaborador.' });
      }
      const body = request.body || {};
      const updated = await authRepo.updateUser(id, claims.tenantId, {
        name: body.name !== undefined ? sanitizeText(body.name, 160) : undefined,
        department: body.department !== undefined ? sanitizeText(body.department, 120) : undefined,
        jobTitle: body.jobTitle !== undefined ? sanitizeText(body.jobTitle, 120) : undefined,
        active: body.active,
        password: body.password,
      });
      return { user: updated };
    },
  );

  app.delete('/api/v1/auth/users/:id', async (request, reply) => {
    let claims;
    try {
      claims = verifyJwt(request.headers.authorization || '');
    } catch (err) {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: err.message });
    }
    requireRoles(claims, ['owner', 'admin', 'manager']);
    const { id } = request.params;
    const target = await authRepo.findTenantUserById(id, claims.tenantId);
    if (claims.role === 'manager' && target && target.role !== 'collaborator') {
      return reply.code(403).send({
        error: 'FORBIDDEN',
        message: 'Gestores só podem revogar contas do Portal do Colaborador.',
      });
    }
    try {
      const deleted = await authRepo.deleteUser(id, claims.tenantId);
      return { success: true, deletedUser: deleted };
    } catch (err) {
      const status = err.statusCode || 400;
      return reply.code(status).send({ error: 'USER_DELETION_FAILED', message: err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // Reverse Proxy Zero-Trust HTTP para os 4 Microsserviços
  // ---------------------------------------------------------------------------
  async function forwardToMicroservice(targetBaseUrl, request, reply, options = {}) {
    const urlObj = new URL(request.raw.url, 'http://gateway.internal');
    const targetUrl = `${targetBaseUrl}${urlObj.pathname}${urlObj.search}`;

    const forwardHeaders = {
      accept: 'application/json',
      'x-request-id': request.correlationId,
      'x-forwarded-for': request.headers['x-forwarded-for'] || request.ip,
      'user-agent': request.headers['user-agent'] || 'NexusGateway/3.0',
    };

    if (request.headers['content-type']) {
      forwardHeaders['content-type'] = request.headers['content-type'];
    }
    if (request.headers.range || request.headers.Range) {
      forwardHeaders.range = request.headers.range || request.headers.Range;
    }
    if (request.headers['x-share-password']) {
      forwardHeaders['x-share-password'] = String(request.headers['x-share-password']);
    }

    // Suporte híbrido para M2M X-Agent-Token, rotas públicas de share e Relay de sessão NexusDesk
    if (options.allowPublicShare) {
      // Sem autenticação JWT obrigatória para /api/v1/storage/share/:token
    } else if (options.allowRelaySession && !request.headers.authorization) {
      if (request.headers['x-tenant-id']) {
        forwardHeaders['x-tenant-id'] = String(request.headers['x-tenant-id']);
      }
    } else if (options.allowAgentToken && request.headers['x-agent-token']) {
      forwardHeaders['x-agent-token'] = String(request.headers['x-agent-token']);
      if (request.headers['x-tenant-id']) {
        forwardHeaders['x-tenant-id'] = String(request.headers['x-tenant-id']);
      }
    } else {
      let claims;
      try {
        claims = verifyJwt(request.headers.authorization || '');
      } catch (err) {
        return reply.code(401).send({
          error: 'UNAUTHORIZED',
          message: err.message,
          requestId: request.correlationId,
        });
      }

      if (options.requireFeature === 'cloud_storage') {
        if (String(claims.role || '').toLowerCase() === 'superadmin' || claims.tenantId === 'nexus-master') {
          return reply.code(403).send({
            error: 'ZERO_KNOWLEDGE_RESTRICTED',
            message: 'Superadmin bloqueado por Zero-Knowledge LGPD no módulo Cloud Vault.',
            requestId: request.correlationId,
          });
        }
        const contract = await getCachedTenantContract(claims.tenantId);
        if (contract && !isCloudStorageEntitled(contract)) {
          return reply.code(403).send({
            error: 'FEATURE_NOT_IN_PLAN',
            message: 'O módulo Nexus Cloud Vault & Conector VPS não está habilitado no plano atual desta empresa.',
            requestId: request.correlationId,
          });
        }
      }

      const signedHeaders = signGatewayContext({
        userId: claims.sub,
        email: claims.email,
        name: claims.name,
        role: claims.role,
        tenantId: claims.tenantId,
        department: claims.department || '',
        requestId: request.correlationId,
      });
      Object.assign(forwardHeaders, signedHeaders);
    }

    const hasBody = !['GET', 'HEAD'].includes(request.method) && request.body !== undefined;
    let serializedBody;
    if (hasBody) {
      if (Buffer.isBuffer(request.body)) {
        serializedBody = request.body;
      } else if (typeof request.body === 'string') {
        serializedBody = request.body;
      } else {
        serializedBody = JSON.stringify(request.body);
      }
    }

    let response;
    try {
      try {
        response = await requestUpstreamKeepAlive(targetUrl, {
          method: request.method,
          headers: forwardHeaders,
          body: serializedBody,
          timeoutMs: 25_000,
        });
      } catch (firstErr) {
        if (firstErr?.reusedSocket && ['ECONNRESET', 'EPIPE', 'ECONNABORTED'].includes(firstErr?.code)) {
          response = await requestUpstreamKeepAlive(targetUrl, {
            method: request.method,
            headers: forwardHeaders,
            body: serializedBody,
            timeoutMs: 25_000,
          });
        } else {
          throw firstErr;
        }
      }
    } catch (err) {
      return reply.code(502).send({
        error: 'UPSTREAM_UNAVAILABLE',
        message: `Microsserviço temporariamente indisponível (${err.message || 'timeout'}).`,
        requestId: request.correlationId,
      });
    }

    const rawBuf = response.buffer;
    reply.code(response.status);
    for (const hName of [
      'content-type',
      'content-disposition',
      'content-range',
      'accept-ranges',
      'cache-control',
      'x-content-type-options',
      'content-security-policy',
    ]) {
      const val = response.headers.get(hName);
      if (val) reply.header(hName, val);
    }
    if (!response.headers.get('content-type')) {
      reply.header('content-type', 'application/json');
    }
    return reply.send(rawBuf);
  }

  // Proxy Rotas — API 1 (Assets)
  app.all('/api/v1/assets', (req, rep) => forwardToMicroservice(upstreams.assets, req, rep));
  app.all('/api/v1/assets/*', (req, rep) => forwardToMicroservice(upstreams.assets, req, rep));

  // Proxy Rotas — API 2 (Tickets)
  app.all('/api/v1/tickets', (req, rep) => forwardToMicroservice(upstreams.tickets, req, rep));
  app.all('/api/v1/tickets/*', (req, rep) => forwardToMicroservice(upstreams.tickets, req, rep));

  // Proxy Rotas — API 3 (Compliance & Audit Chain)
  app.all('/api/v1/compliance/*', (req, rep) =>
    forwardToMicroservice(upstreams.compliance, req, rep),
  );

  // Proxy Rotas — API 4 (Telemetry RMM)
  app.all('/api/v1/telemetry/heartbeat', (req, rep) =>
    forwardToMicroservice(upstreams.nexusdesk, req, rep, { allowAgentToken: true }),
  );
  app.all('/api/v1/telemetry/remote-frame', (req, rep) =>
    forwardToMicroservice(upstreams.nexusdesk, req, rep, { allowRelaySession: true }),
  );
  app.all('/api/v1/telemetry/remote-control', (req, rep) =>
    forwardToMicroservice(upstreams.nexusdesk, req, rep, { allowRelaySession: true }),
  );
  app.all('/api/v1/telemetry/*', (req, rep) =>
    forwardToMicroservice(upstreams.nexusdesk, req, rep),
  );

  // Proxy Rotas — API 6 (Nexus Cloud Vault & Conector VPS)
  app.all('/api/v1/storage/share/:token', (req, rep) =>
    forwardToMicroservice(upstreams.storage, req, rep, { allowPublicShare: true }),
  );
  app.all('/api/v1/storage/desktop-sessions/*', (req, rep) =>
    forwardToMicroservice(upstreams.storage, req, rep, { allowPublicShare: true }),
  );
  app.all('/api/v1/storage', (req, rep) =>
    forwardToMicroservice(upstreams.storage, req, rep, { requireFeature: 'cloud_storage' }),
  );
  app.all('/api/v1/storage/*', (req, rep) =>
    forwardToMicroservice(upstreams.storage, req, rep, { requireFeature: 'cloud_storage' }),
  );

  // ---------------------------------------------------------------------------
  // Bridge WebSocket Bidirecional — API 5 (NÃO-REST `/ws/nexusdesk`)
  // ---------------------------------------------------------------------------
  app.get('/ws/nexusdesk', { websocket: true }, (clientSocket, request) => {
    const urlObj = new URL(request.raw.url, 'http://gateway.internal');
    const wsUpstreamBase = upstreams.nexusdesk.replace(/^http/i, 'ws');
    const upstreamWsUrl = `${wsUpstreamBase}/ws/nexusdesk${urlObj.search}`;

    const upstreamHeaders = {
      'x-forwarded-for': request.headers['x-forwarded-for'] || request.ip,
    };
    if (request.headers.authorization) {
      upstreamHeaders.authorization = request.headers.authorization;
    }
    if (request.headers['x-agent-token']) {
      upstreamHeaders['x-agent-token'] = request.headers['x-agent-token'];
    }
    if (request.headers['x-tenant-id']) {
      upstreamHeaders['x-tenant-id'] = request.headers['x-tenant-id'];
    }

    clientSocket._socket?.setNoDelay?.(true);

    const pendingMessages = [];
    const upstream = new WebSocket(upstreamWsUrl, {
      headers: upstreamHeaders,
      maxPayload: 4 * 1024 * 1024,
      perMessageDeflate: false,
    });

    upstream.on('open', () => {
      upstream._socket?.setNoDelay?.(true);
      while (pendingMessages.length > 0 && upstream.readyState === WebSocket.OPEN) {
        upstream.send(pendingMessages.shift());
      }
    });

    upstream.on('message', (data) => {
      if (clientSocket.readyState === 1) {
        clientSocket.send(String(data));
      }
    });

    upstream.on('close', (code, reason) => {
      if (clientSocket.readyState === 1) {
        const safeCode = isValidWsCloseCode(code) ? code : 1000;
        const safeReason = Buffer.from(String(reason || '')).subarray(0, 120).toString('utf8');
        try {
          clientSocket.close(safeCode, safeReason);
        } catch {
          clientSocket.terminate?.();
        }
      }
    });

    upstream.on('error', () => {
      if (clientSocket.readyState === 1) {
        try {
          clientSocket.close(1011, 'Upstream WebSocket unavailable');
        } catch {
          clientSocket.terminate?.();
        }
      }
    });

    clientSocket.on('message', (msg) => {
      const str = String(msg);
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(str);
      } else if (upstream.readyState === WebSocket.CONNECTING && pendingMessages.length < 32) {
        pendingMessages.push(str);
      }
    });

    clientSocket.on('error', () => {
      if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
        try {
          upstream.close();
        } catch {
          upstream.terminate?.();
        }
      }
    });

    clientSocket.on('close', () => {
      if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
        try {
          upstream.close();
        } catch {
          upstream.terminate?.();
        }
      }
    });
  });

  return app;
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const port = Number(process.env.PORT || 8000);
  const host = process.env.HOST || '0.0.0.0';
  buildApiGateway({ logger: true }).then((app) =>
    app.listen({ port, host }).then(() => {
      console.log(`[api-gateway] Online em http://${host}:${port} (Docs: /docs)`);
    }),
  );
}
