// services/service-assets/src/server.js
// =============================================================================
// MICROSSERVIÇO 1 — Gestão de Ativos & Patrimônio (`service-assets`)
// API 1 (REST): /api/v1/assets
// =============================================================================

import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import { pathToFileURL } from 'node:url';
import { assetsRepo, authRepo, checkDbHealth, initDatabase } from '../../shared/db.js';
import { publishDomainEvent } from '../../shared/eventBus.js';
import { requireRoles, sanitizeText, verifyGatewayOrJwt } from '../../shared/security.js';
import { generateSequentialTag } from '../../shared/tagEngine.js';

export async function buildAssetsService(opts = {}) {
  await initDatabase();

  const app = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: 1_048_576, // 1 MB anti-DoS payload limit
    forceCloseConnections: true,
  });

  await app.register(helmet, { global: true, contentSecurityPolicy: false });
  await app.register(cors, { origin: true });

  app.setErrorHandler((error, _request, reply) => {
    const status = error.statusCode || (error.validation ? 400 : 500);
    reply.code(status).send({
      error: status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_REJECTED',
      message: error.message || 'Erro interno no microsserviço de ativos.',
      service: 'service-assets',
    });
  });

  app.get('/health', async () => {
    const db = await checkDbHealth();
    return {
      service: 'service-assets',
      api: 'API 1 (REST) — Gestão de Ativos & Patrimônio',
      status: 'healthy',
      database: db,
      timestamp: new Date().toISOString(),
    };
  });

  // ---------------------------------------------------------------------------
  // GET /api/v1/assets — Listagem multi-tenant (Colaborador vê apenas sua custódia)
  // ---------------------------------------------------------------------------
  app.get('/api/v1/assets', async (request) => {
    const user = verifyGatewayOrJwt(request);
    const { status, type, search, assignedToEmail } = request.query || {};

    // Row-Level Role Isolation: colaborador só enxerga seus próprios ativos
    const enforcedEmail =
      user.role === 'collaborator'
        ? user.email
        : assignedToEmail
          ? String(assignedToEmail)
          : undefined;

    const items = await assetsRepo.list(user.tenantId, {
      status: status ? sanitizeText(status, 40) : undefined,
      type: type ? sanitizeText(type, 64) : undefined,
      search: search ? sanitizeText(search, 120) : undefined,
      assignedToEmail: enforcedEmail,
    });

    return {
      tenantId: user.tenantId,
      total: items.length,
      items,
    };
  });

  // ---------------------------------------------------------------------------
  // GET /api/v1/assets/next-tag — Motor inteligente de Tag Patrimonial Sequencial
  // ---------------------------------------------------------------------------
  app.get('/api/v1/assets/next-tag', async (request) => {
    const user = verifyGatewayOrJwt(request);
    requireRoles(user, ['owner', 'admin', 'manager', 'operator', 'viewer']);

    const assetType = sanitizeText(request.query?.type || 'Notebook', 64);
    const tenant = await authRepo.findTenantById(user.tenantId);
    const existingAssets = await assetsRepo.list(user.tenantId);

    return generateSequentialTag({
      existingAssets,
      assetType,
      tenantPrefix: tenant?.asset_prefix || 'NEX',
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/v1/assets/:id — Detalhe + Timeline de Histórico Imutável
  // ---------------------------------------------------------------------------
  app.get('/api/v1/assets/:id', async (request, reply) => {
    const user = verifyGatewayOrJwt(request);
    const asset = await assetsRepo.findById(user.tenantId, request.params.id);

    if (!asset) {
      return reply.code(404).send({
        error: 'NOT_FOUND',
        message: 'Ativo não encontrado nesta empresa.',
      });
    }

    if (
      user.role === 'collaborator' &&
      String(asset.assigned_to_email || '').toLowerCase() !== user.email.toLowerCase()
    ) {
      return reply.code(403).send({
        error: 'FORBIDDEN',
        message: 'Colaboradores podem visualizar apenas ativos sob sua custódia.',
      });
    }

    return asset;
  });

  // ---------------------------------------------------------------------------
  // POST /api/v1/assets — Criação validada por JSON Schema
  // ---------------------------------------------------------------------------
  app.post(
    '/api/v1/assets',
    {
      schema: {
        body: {
          type: 'object',
          required: ['type', 'brand', 'model'],
          properties: {
            internalId: { type: 'string', maxLength: 64 },
            type: { type: 'string', minLength: 2, maxLength: 64 },
            brand: { type: 'string', minLength: 1, maxLength: 80 },
            model: { type: 'string', minLength: 1, maxLength: 120 },
            serialNumber: { type: ['string', 'null'], maxLength: 120 },
            status: { type: 'string', maxLength: 40 },
            location: { type: 'string', maxLength: 120 },
            department: { type: 'string', maxLength: 120 },
            assignedToName: { type: ['string', 'null'], maxLength: 160 },
            assignedToEmail: { type: ['string', 'null'], maxLength: 180 },
            purchaseValue: { type: 'number', minimum: 0 },
            specs: { type: 'object' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const user = verifyGatewayOrJwt(request);
      requireRoles(user, ['owner', 'admin', 'manager', 'operator']);

      const body = request.body;
      let internalId = sanitizeText(body.internalId || '', 64).toUpperCase();
      if (!internalId) {
        const tenant = await authRepo.findTenantById(user.tenantId);
        const existingAssets = await assetsRepo.list(user.tenantId);
        internalId = generateSequentialTag({
          existingAssets,
          assetType: body.type,
          tenantPrefix: tenant?.asset_prefix || 'NEX',
        }).suggestedTag;
      }

      const created = await assetsRepo.create(
        user.tenantId,
        {
          internalId,
          type: sanitizeText(body.type, 64),
          brand: sanitizeText(body.brand, 80),
          model: sanitizeText(body.model, 120),
          serialNumber: body.serialNumber ? sanitizeText(body.serialNumber, 120) : null,
          status: body.status ? sanitizeText(body.status, 40) : undefined,
          location: body.location ? sanitizeText(body.location, 120) : undefined,
          department: body.department ? sanitizeText(body.department, 120) : undefined,
          assignedToName: body.assignedToName ? sanitizeText(body.assignedToName, 160) : null,
          assignedToEmail: body.assignedToEmail ? sanitizeText(body.assignedToEmail, 180) : null,
          purchaseValue: body.purchaseValue ?? 0,
          specs: body.specs || {},
        },
        user,
      );

      await publishDomainEvent('asset.created', user.tenantId, {
        id: created.id,
        internalId: created.internal_id,
        model: `${created.brand} ${created.model}`,
        assignedToEmail: created.assigned_to_email,
        actor: user.email,
      });

      return reply.code(201).send(created);
    },
  );

  // ---------------------------------------------------------------------------
  // PUT /api/v1/assets/:id — Atualização cadastral / Alocação
  // ---------------------------------------------------------------------------
  app.put('/api/v1/assets/:id', async (request, reply) => {
    const user = verifyGatewayOrJwt(request);
    requireRoles(user, ['owner', 'admin', 'manager', 'operator']);

    const body = request.body || {};
    const updated = await assetsRepo.update(
      user.tenantId,
      request.params.id,
      {
        type: body.type ? sanitizeText(body.type, 64) : undefined,
        brand: body.brand ? sanitizeText(body.brand, 80) : undefined,
        model: body.model ? sanitizeText(body.model, 120) : undefined,
        serialNumber:
          body.serialNumber !== undefined
            ? body.serialNumber
              ? sanitizeText(body.serialNumber, 120)
              : null
            : undefined,
        status: body.status ? sanitizeText(body.status, 40) : undefined,
        location: body.location ? sanitizeText(body.location, 120) : undefined,
        department: body.department ? sanitizeText(body.department, 120) : undefined,
        assignedToName:
          body.assignedToName !== undefined
            ? body.assignedToName
              ? sanitizeText(body.assignedToName, 160)
              : null
            : undefined,
        assignedToEmail:
          body.assignedToEmail !== undefined
            ? body.assignedToEmail
              ? sanitizeText(body.assignedToEmail, 180)
              : null
            : undefined,
        purchaseValue: body.purchaseValue,
        specs: body.specs,
        historyNote: body.historyNote ? sanitizeText(body.historyNote, 240) : undefined,
      },
      user,
    );

    if (!updated) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Ativo não encontrado.' });
    }

    await publishDomainEvent('asset.updated', user.tenantId, {
      id: updated.id,
      internalId: updated.internal_id,
      status: updated.status,
      assignedToEmail: updated.assigned_to_email,
    });

    return updated;
  });

  // ---------------------------------------------------------------------------
  // DELETE /api/v1/assets/:id — Baixa patrimonial auditada
  // ---------------------------------------------------------------------------
  app.delete('/api/v1/assets/:id', async (request, reply) => {
    const user = verifyGatewayOrJwt(request);
    requireRoles(user, ['owner', 'admin', 'manager']);

    const existing = await assetsRepo.findById(user.tenantId, request.params.id);
    if (!existing) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Ativo não encontrado.' });
    }

    const reason = sanitizeText(
      request.body?.reason || request.query?.reason || 'Descarte / obsolescência técnica',
      240,
    );
    const retired = await assetsRepo.retire(user.tenantId, request.params.id, reason, user);

    await publishDomainEvent('asset.retired', user.tenantId, {
      id: retired.id,
      internalId: retired.internal_id,
      assignedToEmail: existing.assigned_to_email || null,
      reason,
    });

    return { message: 'Baixa patrimonial registrada com sucesso.', asset: retired };
  });

  return app;
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const port = Number(process.env.PORT || 8001);
  const host = process.env.HOST || '0.0.0.0';
  buildAssetsService({ logger: true }).then((app) =>
    app.listen({ port, host }).then(() => {
      console.log(`[service-assets] Online em http://${host}:${port}`);
    }),
  );
}
