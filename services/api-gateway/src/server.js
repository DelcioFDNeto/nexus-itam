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
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import WebSocket from 'ws';
import { pathToFileURL } from 'node:url';
import { authRepo, checkDbHealth, initDatabase } from '../../shared/db.js';
import {
  requireRoles,
  sanitizeText,
  signGatewayContext,
  signJwt,
  verifyJwt,
  verifyPassword,
} from '../../shared/security.js';
import { buildOpenApiSpec, renderDocsHtml } from './openapiSpec.js';

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
  };

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

  const app = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: 1_048_576,
    trustProxy: true,
    forceCloseConnections: true,
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
    options: { maxPayload: 512 * 1024 },
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
    const [db, assets, tickets, compliance, nexusdesk] = await Promise.all([
      checkDbHealth(),
      probeUpstream('service-assets', upstreams.assets),
      probeUpstream('service-tickets', upstreams.tickets),
      probeUpstream('service-compliance', upstreams.compliance),
      probeUpstream('service-nexusdesk', upstreams.nexusdesk),
    ]);

    const services = [assets, tickets, compliance, nexusdesk];
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
      return updated;
    },
  );

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

    // Suporte híbrido para M2M X-Agent-Token no endpoint de heartbeat e Relay de sessão NexusDesk
    if (options.allowRelaySession && !request.headers.authorization) {
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

      const signedHeaders = signGatewayContext({
        userId: claims.sub,
        email: claims.email,
        name: claims.name,
        role: claims.role,
        tenantId: claims.tenantId,
        requestId: request.correlationId,
      });
      Object.assign(forwardHeaders, signedHeaders);
    }

    const hasBody = !['GET', 'HEAD'].includes(request.method) && request.body !== undefined;
    let response;
    try {
      response = await fetch(targetUrl, {
        method: request.method,
        headers: forwardHeaders,
        body: hasBody ? JSON.stringify(request.body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      return reply.code(502).send({
        error: 'UPSTREAM_UNAVAILABLE',
        message: `Microsserviço temporariamente indisponível (${err.message || 'timeout'}).`,
        requestId: request.correlationId,
      });
    }

    const text = await response.text();
    reply.code(response.status);
    reply.header('content-type', response.headers.get('content-type') || 'application/json');
    return reply.send(text);
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

    const pendingMessages = [];
    const upstream = new WebSocket(upstreamWsUrl, { headers: upstreamHeaders });

    upstream.on('open', () => {
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
