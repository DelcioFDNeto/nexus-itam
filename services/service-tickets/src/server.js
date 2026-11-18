// services/service-tickets/src/server.js
// =============================================================================
// MICROSSERVIÇO 2 — Central de Chamados & Autoatendimento (`service-tickets`)
// API 2 (REST): /api/v1/tickets
// =============================================================================

import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import { pathToFileURL } from 'node:url';
import { checkDbHealth, complianceRepo, initDatabase, ticketsRepo } from '../../shared/db.js';
import { publishDomainEvent } from '../../shared/eventBus.js';
import {
  assertZeroKnowledgeAllowed,
  requireRoles,
  sanitizeText,
  sanitizeTicketAttachments,
  signInternalEvent,
  verifyGatewayOrJwt,
} from '../../shared/security.js';

export async function buildTicketsService(opts = {}) {
  await initDatabase();

  const app = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: 4_194_304,
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
            description: { type: 'string', minLength: 3, maxLength: 3000 },
            category: { type: 'string', maxLength: 64 },
            priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
            department: { type: 'string', maxLength: 120 },
            assetId: { type: ['string', 'null'], maxLength: 64 },
            assetTag: { type: ['string', 'null'], maxLength: 64 },
            attachments: {
              type: 'array',
              maxItems: 4,
              items: {
                type: 'object',
                required: ['dataUrl'],
                properties: {
                  id: { type: 'string', maxLength: 64 },
                  name: { type: 'string', maxLength: 140 },
                  mimeType: { type: 'string', maxLength: 64 },
                  sizeBytes: { type: 'number', minimum: 1, maximum: 1_000_000 },
                  dataUrl: { type: 'string', minLength: 24, maxLength: 600_000 },
                },
                additionalProperties: false,
              },
            },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const user = verifyGatewayOrJwt(request);
      const body = request.body;
      const rawAttachments = Array.isArray(body.attachments) ? body.attachments : [];
      const attachments = sanitizeTicketAttachments(rawAttachments, { maxItems: 4 });
      if (rawAttachments.length > 0 && attachments.length < rawAttachments.length) {
        return reply.code(400).send({
          error: 'INVALID_ATTACHMENT',
          message: 'Formato ou tamanho de imagem inválido. Envie fotos/prints PNG, JPG, WEBP ou GIF.',
        });
      }

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
          attachments,
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
        attachmentsCount: attachments.length,
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
          properties: {
            message: { type: 'string', maxLength: 2000 },
            attachments: {
              type: 'array',
              maxItems: 4,
              items: {
                type: 'object',
                required: ['dataUrl'],
                properties: {
                  id: { type: 'string', maxLength: 64 },
                  name: { type: 'string', maxLength: 140 },
                  mimeType: { type: 'string', maxLength: 64 },
                  sizeBytes: { type: 'number', minimum: 1, maximum: 1_000_000 },
                  dataUrl: { type: 'string', minLength: 24, maxLength: 600_000 },
                },
                additionalProperties: false,
              },
            },
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

      const cleanMessage = sanitizeText(request.body?.message || '', 2000);
      const rawAttachments = Array.isArray(request.body?.attachments)
        ? request.body.attachments
        : [];
      const attachments = sanitizeTicketAttachments(rawAttachments, { maxItems: 4 });
      if (rawAttachments.length > 0 && attachments.length < rawAttachments.length) {
        return reply.code(400).send({
          error: 'INVALID_ATTACHMENT',
          message: 'Formato ou tamanho de imagem inválido. Envie fotos/prints PNG, JPG, WEBP ou GIF.',
        });
      }
      if (!cleanMessage && attachments.length === 0) {
        return reply.code(400).send({
          error: 'EMPTY_COMMENT',
          message: 'Escreva uma mensagem ou anexe pelo menos uma foto/print.',
        });
      }

      const comment = await ticketsRepo.addComment(
        user.tenantId,
        request.params.id,
        user,
        cleanMessage,
        attachments,
      );

      await publishDomainEvent('ticket.commented', user.tenantId, {
        commentId: comment.id,
        ticketId: ticket.id,
        protocol: ticket.protocol,
        requesterEmail: ticket.requester_email,
        authorName: comment.author_name,
        authorEmail: comment.author_email,
        authorRole: comment.author_role,
        message: comment.message,
        attachments: comment.attachments || [],
        createdAt: comment.created_at,
      });

      return reply.code(201).send(comment);
    },
  );

  // ---------------------------------------------------------------------------
  // POST /api/v1/tickets/:id/archive-vps — Arquiva Chamado + Anexos na VPS
  // ---------------------------------------------------------------------------
  app.post('/api/v1/tickets/:id/archive-vps', async (request, reply) => {
    const user = verifyGatewayOrJwt(request);
    assertZeroKnowledgeAllowed(user, 'Arquivamento de Chamados na VPS');
    requireRoles(user, ['owner', 'admin', 'manager', 'operator']);

    const ticket = await ticketsRepo.findById(user.tenantId, request.params.id);
    if (!ticket) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Chamado não encontrado.' });
    }

    const comments = Array.isArray(ticket.comments) ? ticket.comments : [];
    const summaryText = [
      '========================================================================',
      `NEXUS ITAM — DOSSIÊ DE CHAMADO TÉCNICO (${ticket.protocol})`,
      '========================================================================',
      `ID:               ${ticket.id}`,
      `Protocolo:        ${ticket.protocol}`,
      `Título:           ${ticket.title}`,
      `Status:           ${ticket.status}`,
      `Prioridade:       ${ticket.priority}`,
      `Categoria:        ${ticket.category || 'Suporte Técnico'}`,
      `Departamento:     ${ticket.department || 'Corporativo'}`,
      `Ativo (Tag):      ${ticket.asset_tag || 'N/A'}`,
      `Solicitante:      ${ticket.requester_name} <${ticket.requester_email}>`,
      `Técnico Resp.:    ${ticket.assigned_tech_name || 'N/A'}`,
      `Notas Resolução:  ${ticket.resolution_notes || 'N/A'}`,
      '------------------------------------------------------------------------',
      'DESCRIÇÃO ORIGINAL:',
      ticket.description || '',
      '------------------------------------------------------------------------',
      'HISTÓRICO DE ATENDIMENTO E COMENTÁRIOS:',
      ...(comments.length > 0
        ? comments.map(
            (c, idx) =>
              `  [${idx + 1}] ${c.author_name} (${c.author_email}): ${c.message || '(anexo)'}`,
          )
        : ['  (Sem comentários registrados)']),
      '========================================================================',
    ].join('\n');

    const filesToArchive = [
      {
        name: `resumo-${ticket.protocol}.txt`,
        mimeType: 'text/plain; charset=utf-8',
        contentBase64: Buffer.from(summaryText, 'utf8').toString('base64'),
      },
    ];

    const extractAttachmentBuffer = (att, prefix, idx) => {
      if (!att || !att.dataUrl) return null;
      const m = /^data:([^;]+);base64,(.+)$/i.exec(String(att.dataUrl));
      if (!m) return null;
      const mimeType = m[1].trim();
      const b64 = m[2].trim();
      const rawName = String(att.name || `${prefix}-${idx}.png`).replace(/[^a-zA-Z0-9._-]/g, '_');
      return {
        name: rawName,
        mimeType,
        contentBase64: b64,
      };
    };

    const ticketAtts = Array.isArray(ticket.attachments) ? ticket.attachments : [];
    ticketAtts.forEach((att, idx) => {
      const parsed = extractAttachmentBuffer(att, 'anexo-abertura', idx + 1);
      if (parsed) filesToArchive.push(parsed);
    });

    comments.forEach((c, cIdx) => {
      const cAtts = Array.isArray(c.attachments) ? c.attachments : [];
      cAtts.forEach((att, aIdx) => {
        const parsed = extractAttachmentBuffer(att, `comentario-${cIdx + 1}`, aIdx + 1);
        if (parsed) filesToArchive.push(parsed);
      });
    });

    const storageUrl =
      process.env.STORAGE_SERVICE_URL || 'http://127.0.0.1:8005';
    const bodyStr = JSON.stringify({
      tenantId: user.tenantId,
      actor: user,
      folderSegments: ['Chamados', ticket.protocol],
      files: filesToArchive,
    });

    const headers = {
      'content-type': 'application/json',
      ...signInternalEvent(bodyStr),
    };

    const res = await fetch(`${storageUrl}/internal/storage/archive`, {
      method: 'POST',
      headers,
      body: bodyStr,
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return reply.code(res.status).send({
        error: data.error || 'ARCHIVE_FAILED',
        message: data.message || 'Falha ao arquivar chamado na VPS.',
      });
    }

    // Record compliance audit log via /internal/audit or complianceRepo fallback
    const complianceUrl = process.env.COMPLIANCE_SERVICE_URL;
    let recordedAudit = false;
    if (complianceUrl) {
      try {
        const auditBody = JSON.stringify({
          tenantId: user.tenantId,
          actorEmail: user.email,
          actorRole: user.role,
          action: 'TICKET_ARCHIVED_TO_VPS',
          resourceType: 'ticket',
          resourceId: ticket.id,
          payload: {
            protocol: ticket.protocol,
            folderPath: `/Chamados/${ticket.protocol}/`,
            filesCount: filesToArchive.length,
          },
        });
        const auditRes = await fetch(`${complianceUrl}/internal/audit`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...signInternalEvent(auditBody),
          },
          body: auditBody,
          signal: AbortSignal.timeout(2500),
        });
        if (auditRes.ok) recordedAudit = true;
      } catch {
        recordedAudit = false;
      }
    }
    if (!recordedAudit) {
      await complianceRepo.appendAuditLog(user.tenantId, {
        actorEmail: user.email,
        actorRole: user.role,
        action: 'TICKET_ARCHIVED_TO_VPS',
        resourceType: 'ticket',
        resourceId: ticket.id,
        payload: {
          protocol: ticket.protocol,
          folderPath: `/Chamados/${ticket.protocol}/`,
          filesCount: filesToArchive.length,
        },
      });
    }

    return reply.code(200).send({
      archived: true,
      ticketId: ticket.id,
      protocol: ticket.protocol,
      folderPath: `/Chamados/${ticket.protocol}/`,
      files: data.files || filesToArchive.map((f) => f.name),
      nodes: data.nodes || [],
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE /api/v1/tickets/:id — Exclusão administrativa de chamado (Owner/Admin/Manager)
  // ---------------------------------------------------------------------------
  app.delete('/api/v1/tickets/:id', async (request, reply) => {
    const user = verifyGatewayOrJwt(request);
    requireRoles(user, ['owner', 'admin', 'manager']);

    const removed = await ticketsRepo.delete(user.tenantId, request.params.id);
    if (!removed) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Chamado não encontrado.' });
    }

    await publishDomainEvent('ticket.deleted', user.tenantId, {
      id: removed.id,
      protocol: removed.protocol,
    });

    return {
      message: `Chamado ${removed.protocol} removido com sucesso.`,
      ticket: removed,
    };
  });

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
