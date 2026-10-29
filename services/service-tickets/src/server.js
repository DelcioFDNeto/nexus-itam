// services/service-tickets/src/server.js
// =============================================================================
// MICROSSERVIÇO 2 — Central de Chamados & Autoatendimento (`service-tickets`)
// API 2 (REST): /api/v1/tickets
// =============================================================================

import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import { pathToFileURL } from 'node:url';
import { checkDbHealth, initDatabase, ticketsRepo } from '../../shared/db.js';
import { publishDomainEvent } from '../../shared/eventBus.js';
import { requireRoles, sanitizeText, verifyGatewayOrJwt } from '../../shared/security.js';

export async function buildTicketsService(opts = {}) {
  await initDatabase();

  const app = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: 1_048_576,
    forceCloseConnections: true,
  });

  await app.register(helmet, { global: true, contentSecurityPolicy: false });
  await app.register(cors, { origin: true });

  app.setErrorHandler((error, _request, reply) => {
    const status = error.statusCode || (error.validation ? 400 : 500);
    reply.code(status).send({
      error: status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_REJECTED',
      message: error.message || 'Erro no microsserviço de chamados.',
      service: 'service-tickets',
    });
  });

  app.get('/health', async () => {
    const db = await checkDbHealth();
    return {
      service: 'service-tickets',
      api: 'API 2 (REST) — Helpdesk & Autoatendimento TI',
      status: 'healthy',
      database: db,
      timestamp: new Date().toISOString(),
    };
  });

  // ---------------------------------------------------------------------------
  // GET /api/v1/tickets — Lista chamados (Colaborador vê os seus; TI vê fila completa)
  // ---------------------------------------------------------------------------
  app.get('/api/v1/tickets', async (request) => {
    const user = verifyGatewayOrJwt(request);
    const { status, priority } = request.query || {};

    const requesterEmail = user.role === 'collaborator' ? user.email : undefined;
    const items = await ticketsRepo.list(user.tenantId, {
      requesterEmail,
      status: status ? sanitizeText(status, 32) : undefined,
      priority: priority ? sanitizeText(priority, 24) : undefined,
    });

    return {
      tenantId: user.tenantId,
      total: items.length,
      items,
    };
  });

  // ---------------------------------------------------------------------------
  // GET /api/v1/tickets/metrics — Indicadores de SLA e fila operacional
  // ---------------------------------------------------------------------------
  app.get('/api/v1/tickets/metrics', async (request) => {
    const user = verifyGatewayOrJwt(request);
    return ticketsRepo.getMetrics(user.tenantId);
  });

  // ---------------------------------------------------------------------------
  // GET /api/v1/tickets/:id — Detalhe do chamado + thread de comentários
  // ---------------------------------------------------------------------------
  app.get('/api/v1/tickets/:id', async (request, reply) => {
    const user = verifyGatewayOrJwt(request);
    const ticket = await ticketsRepo.findById(user.tenantId, request.params.id);

    if (!ticket) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Chamado não encontrado.' });
    }

    if (
      user.role === 'collaborator' &&
      ticket.requester_email.toLowerCase() !== user.email.toLowerCase()
    ) {
      return reply.code(403).send({
        error: 'FORBIDDEN',
        message: 'Acesso restrito aos chamados abertos pelo próprio colaborador.',
      });
    }

    return ticket;
  });

  // ---------------------------------------------------------------------------
  // POST /api/v1/tickets — Abertura de chamado (Portal Vue 3 ou Console React)
  // ---------------------------------------------------------------------------
  app.post(
    '/api/v1/tickets',
    {
      schema: {
        body: {
          type: 'object',
          required: ['title', 'description'],
          properties: {
            title: { type: 'string', minLength: 4, maxLength: 200 },
            description: { type: 'string', minLength: 6, maxLength: 3000 },
            category: { type: 'string', maxLength: 64 },
            priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
            department: { type: 'string', maxLength: 120 },
            assetId: { type: ['string', 'null'], maxLength: 64 },
            assetTag: { type: ['string', 'null'], maxLength: 64 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const user = verifyGatewayOrJwt(request);
      const body = request.body;

      const created = await ticketsRepo.create(
        user.tenantId,
        {
          title: sanitizeText(body.title, 200),
          description: sanitizeText(body.description, 3000),
          category: sanitizeText(body.category || 'Suporte Técnico', 64),
          priority: body.priority || 'medium',
          department: sanitizeText(body.department || 'Corporativo', 120),
          assetId: body.assetId ? sanitizeText(body.assetId, 64) : null,
          assetTag: body.assetTag ? sanitizeText(body.assetTag, 64).toUpperCase() : null,
        },
        user,
      );

      await publishDomainEvent('ticket.created', user.tenantId, {
        id: created.id,
        protocol: created.protocol,
        title: created.title,
        priority: created.priority,
        requesterName: created.requester_name,
        requesterEmail: created.requester_email,
        assetTag: created.asset_tag,
      });

      return reply.code(201).send(created);
    },
  );

  // ---------------------------------------------------------------------------
  // PATCH /api/v1/tickets/:id/status — Triagem e Resolução pela Equipe de TI
  // ---------------------------------------------------------------------------
  app.patch(
    '/api/v1/tickets/:id/status',
    {
      schema: {
        body: {
          type: 'object',
          required: ['status'],
          properties: {
            status: { type: 'string', enum: ['open', 'in_progress', 'resolved', 'closed'] },
            resolutionNotes: { type: ['string', 'null'], maxLength: 2000 },
            assignedTechName: { type: ['string', 'null'], maxLength: 160 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const user = verifyGatewayOrJwt(request);
      requireRoles(user, ['owner', 'admin', 'manager', 'operator']);

      const updated = await ticketsRepo.updateStatus(user.tenantId, request.params.id, {
        status: request.body.status,
        resolutionNotes: request.body.resolutionNotes
          ? sanitizeText(request.body.resolutionNotes, 2000)
          : undefined,
        assignedTechName: sanitizeText(
          request.body.assignedTechName || user.name || user.email,
          160,
        ),
      });

      if (!updated) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Chamado não encontrado.' });
      }

      await publishDomainEvent('ticket.updated', user.tenantId, {
        id: updated.id,
        protocol: updated.protocol,
        status: updated.status,
        assignedTechName: updated.assigned_tech_name,
        resolutionNotes: updated.resolution_notes,
        requesterEmail: updated.requester_email,
      });

      return updated;
    },
  );

  // ---------------------------------------------------------------------------
  // POST /api/v1/tickets/:id/comments — Mensagem no histórico de atendimento
  // ---------------------------------------------------------------------------
  app.post(
    '/api/v1/tickets/:id/comments',
    {
      schema: {
        body: {
          type: 'object',
          required: ['message'],
          properties: {
            message: { type: 'string', minLength: 1, maxLength: 2000 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const user = verifyGatewayOrJwt(request);
      const ticket = await ticketsRepo.findById(user.tenantId, request.params.id);
      if (!ticket) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Chamado não encontrado.' });
      }
      if (
        user.role === 'collaborator' &&
        ticket.requester_email.toLowerCase() !== user.email.toLowerCase()
      ) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Acesso negado ao chamado.' });
      }

      const comment = await ticketsRepo.addComment(
        user.tenantId,
        request.params.id,
        user,
        sanitizeText(request.body.message, 2000),
      );

      await publishDomainEvent('ticket.commented', user.tenantId, {
        ticketId: ticket.id,
        protocol: ticket.protocol,
        requesterEmail: ticket.requester_email,
        authorName: comment.author_name,
        authorRole: comment.author_role,
        message: comment.message,
      });

      return reply.code(201).send(comment);
    },
  );

  return app;
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const port = Number(process.env.PORT || 8002);
  const host = process.env.HOST || '0.0.0.0';
  buildTicketsService({ logger: true }).then((app) =>
    app.listen({ port, host }).then(() => {
      console.log(`[service-tickets] Online em http://${host}:${port}`);
    }),
  );
}
