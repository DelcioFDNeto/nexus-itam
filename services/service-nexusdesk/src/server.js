// services/service-nexusdesk/src/server.js
// =============================================================================
// MICROSSERVIÇO 4 — Telemetria RMM & NexusDesk Realtime (`service-nexusdesk`)
//  - API 4 (REST):     /api/v1/telemetry/*
//  - API 5 (NÃO-REST): WebSocket Bidirecional RFC 6455 `/ws/nexusdesk`
// =============================================================================

import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { pathToFileURL } from 'node:url';
import { authRepo, checkDbHealth, initDatabase, telemetryRepo } from '../../shared/db.js';
import {
  requireRoles,
  sanitizeText,
  verifyGatewayOrJwt,
  verifyInternalEvent,
  verifyJwt,
} from '../../shared/security.js';

function canCollaboratorReceiveEvent(peerEmail, envelope) {
  const email = String(peerEmail || '').toLowerCase().trim();
  if (!email) return false;

  const eventName = String(envelope?.event || '');
  const data = envelope?.data || {};

  // Colaboradores nunca recebem frames de telemetria RMM ou controle remoto
  if (eventName.startsWith('telemetry.') || eventName.startsWith('remote.')) {
    return false;
  }

  // Isolamento LGPD por titular nos eventos de domínio
  if (eventName.startsWith('ticket.')) {
    return String(data.requesterEmail || '').toLowerCase().trim() === email;
  }
  if (eventName.startsWith('term.')) {
    return String(data.employeeEmail || '').toLowerCase().trim() === email;
  }
  if (eventName.startsWith('asset.')) {
    return String(data.assignedToEmail || '').toLowerCase().trim() === email;
  }

  return false;
}

export async function buildNexusDeskService(opts = {}) {
  await initDatabase();

  const app = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: 1_048_576,
    forceCloseConnections: true,
  });

  // Salas multi-tenant isoladas em memória para streaming WebSocket em tempo real
  // Map<tenantId, Set<{ socket, userEmail, role, clientType, connectedAt }>>
  const tenantRooms = new Map();

  function addClientToRoom(tenantId, session) {
    if (!tenantRooms.has(tenantId)) {
      tenantRooms.set(tenantId, new Set());
    }
    tenantRooms.get(tenantId).add(session);
  }

  function removeClientFromRoom(tenantId, session) {
    const room = tenantRooms.get(tenantId);
    if (!room) return;
    room.delete(session);
    if (room.size === 0) tenantRooms.delete(tenantId);
  }

  function broadcastToTenant(tenantId, envelope, excludeSocket = null) {
    const room = tenantRooms.get(tenantId);
    if (!room || room.size === 0) return 0;
    const serialized = JSON.stringify(envelope);
    let delivered = 0;

    for (const peer of room) {
      if (excludeSocket && peer.socket === excludeSocket) continue;
      if (
        peer.role === 'collaborator' &&
        !canCollaboratorReceiveEvent(peer.userEmail, envelope)
      ) {
        continue;
      }
      if (peer.socket.readyState === 1) {
        peer.socket.send(serialized);
        delivered += 1;
      }
    }
    return delivered;
  }

  await app.register(helmet, { global: true, contentSecurityPolicy: false });
  await app.register(cors, { origin: true });
  await app.register(websocket, {
    options: { maxPayload: 512 * 1024 },
  });

  // Captura rawBody em /internal/events para verificação HMAC exata
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    try {
      const parsed = body ? JSON.parse(body) : {};
      done(null, parsed);
    } catch (err) {
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    const status = error.statusCode || (error.validation ? 400 : 500);
    reply.code(status).send({
      error: status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_REJECTED',
      message: error.message || 'Erro no microsserviço NexusDesk.',
      service: 'service-nexusdesk',
    });
  });

  app.get('/health', async () => {
    const db = await checkDbHealth();
    let activeSockets = 0;
    for (const room of tenantRooms.values()) activeSockets += room.size;

    return {
      service: 'service-nexusdesk',
      apis: [
        'API 4 (REST) — Ingestão de Telemetria RMM (/api/v1/telemetry)',
        'API 5 (NÃO-REST / WebSocket RFC 6455) — NexusDesk Live Stream (/ws/nexusdesk)',
      ],
      status: 'healthy',
      activeWebSocketConnections: activeSockets,
      database: db,
      timestamp: new Date().toISOString(),
    };
  });

  // ---------------------------------------------------------------------------
  // Barramento interno Zero-Trust para eventos dos demais microsserviços
  // ---------------------------------------------------------------------------
  app.post('/internal/events', async (request, reply) => {
    const raw = JSON.stringify(request.body || {});
    if (!verifyInternalEvent(request.headers, raw)) {
      return reply.code(403).send({
        error: 'ZERO_TRUST_REJECTED',
        message: 'Assinatura interna de barramento inválida.',
      });
    }

    const { event, tenantId, timestamp, data } = request.body;
    const delivered = broadcastToTenant(tenantId, {
      protocol: 'nexusdesk-ws/3.0',
      event,
      tenantId,
      timestamp: timestamp || new Date().toISOString(),
      data,
    });

    return { accepted: true, delivered };
  });

  // ===========================================================================
  // API 4 (REST) — Ingestão de Telemetria RMM & Comandos da Frota
  // ===========================================================================
  app.post(
    '/api/v1/telemetry/heartbeat',
    {
      schema: {
        body: {
          type: 'object',
          required: ['deviceKey', 'hostname', 'cpuPercent', 'ramPercent'],
          properties: {
            tenantId: { type: 'string', maxLength: 64 },
            deviceKey: { type: 'string', minLength: 2, maxLength: 120 },
            hostname: { type: 'string', minLength: 2, maxLength: 120 },
            serialNumber: { type: ['string', 'null'], maxLength: 120 },
            osVersion: { type: 'string', maxLength: 120 },
            agentVersion: { type: 'string', maxLength: 32 },
            ipAddress: { type: 'string', maxLength: 64 },
            loggedUser: { type: 'string', maxLength: 120 },
            cpuPercent: { type: 'number', minimum: 0, maximum: 100 },
            ramPercent: { type: 'number', minimum: 0, maximum: 100 },
            diskPercent: { type: 'number', minimum: 0, maximum: 100 },
            antivirusActive: { type: 'boolean' },
            firewallActive: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      let resolvedTenantId = null;

      // Suporta autenticação M2M por X-Agent-Token (Agente Windows/Linux) OU JWT humano
      const agentToken = request.headers['x-agent-token'];
      if (agentToken) {
        const claimedTenant = sanitizeText(
          request.body.tenantId || request.headers['x-tenant-id'] || '',
          64,
        );
        if (!claimedTenant) {
          return reply.code(400).send({
            error: 'TENANT_REQUIRED',
            message: 'Informe tenantId ao autenticar via X-Agent-Token.',
          });
        }
        const valid = await authRepo.verifyTenantAgentToken(claimedTenant, String(agentToken));
        if (!valid) {
          return reply.code(401).send({
            error: 'INVALID_AGENT_TOKEN',
            message: 'Token de agente inválido ou empresa suspensa.',
          });
        }
        resolvedTenantId = claimedTenant;
      } else {
        const user = verifyGatewayOrJwt(request);
        requireRoles(user, ['owner', 'admin', 'manager', 'operator']);
        resolvedTenantId = user.tenantId;
      }

      const saved = await telemetryRepo.upsertHeartbeat(resolvedTenantId, {
        deviceKey: sanitizeText(request.body.deviceKey, 120),
        hostname: sanitizeText(request.body.hostname, 120),
        serialNumber: request.body.serialNumber
          ? sanitizeText(request.body.serialNumber, 120)
          : null,
        osVersion: request.body.osVersion ? sanitizeText(request.body.osVersion, 120) : undefined,
        agentVersion: request.body.agentVersion
          ? sanitizeText(request.body.agentVersion, 32)
          : undefined,
        ipAddress: request.body.ipAddress
          ? sanitizeText(request.body.ipAddress, 64)
          : request.headers['x-forwarded-for'] || request.ip,
        loggedUser: request.body.loggedUser
          ? sanitizeText(request.body.loggedUser, 120)
          : undefined,
        cpuPercent: request.body.cpuPercent,
        ramPercent: request.body.ramPercent,
        diskPercent: request.body.diskPercent ?? 0,
        antivirusActive: request.body.antivirusActive,
        firewallActive: request.body.firewallActive,
      });

      const delivered = broadcastToTenant(resolvedTenantId, {
        protocol: 'nexusdesk-ws/3.0',
        event: 'telemetry.heartbeat',
        tenantId: resolvedTenantId,
        timestamp: new Date().toISOString(),
        data: saved,
      });

      return reply.code(201).send({
        device: saved,
        streamedToClients: delivered,
      });
    },
  );

  app.get('/api/v1/telemetry/fleet', async (request) => {
    const user = verifyGatewayOrJwt(request);
    requireRoles(user, ['owner', 'admin', 'manager', 'operator', 'viewer']);
    return telemetryRepo.listFleet(user.tenantId);
  });

  app.post(
    '/api/v1/telemetry/commands',
    {
      schema: {
        body: {
          type: 'object',
          required: ['deviceKey', 'commandType'],
          properties: {
            deviceKey: { type: 'string', minLength: 2, maxLength: 120 },
            commandType: {
              type: 'string',
              enum: ['force_inventory', 'flush_dns', 'system_health', 'restart_spooler', 'lock_screen'],
            },
            payload: { type: 'string', maxLength: 1000 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const user = verifyGatewayOrJwt(request);
      requireRoles(user, ['owner', 'admin', 'manager', 'operator']);

      const cmd = await telemetryRepo.queueCommand(
        user.tenantId,
        {
          deviceKey: sanitizeText(request.body.deviceKey, 120),
          commandType: request.body.commandType,
          payload: sanitizeText(request.body.payload || '', 1000),
        },
        user.email,
      );

      const delivered = broadcastToTenant(user.tenantId, {
        protocol: 'nexusdesk-ws/3.0',
        event: 'telemetry.command',
        tenantId: user.tenantId,
        timestamp: new Date().toISOString(),
        data: cmd,
      });

      return reply.code(201).send({ command: cmd, streamedToClients: delivered });
    },
  );

  // ===========================================================================
  // API 5 (NÃO-REST) — WebSocket Bidirecional Full-Duplex (`/ws/nexusdesk`)
  // ===========================================================================
  app.get('/ws/nexusdesk', { websocket: true }, async (socket, request) => {
    let session = null;

    socket.on('error', () => {
      if (session) removeClientFromRoom(session.tenantId, session);
    });

    try {
      const queryToken = request.query?.token;
      const authHeader = request.headers.authorization;
      const agentToken = request.headers['x-agent-token'] || request.query?.agentToken;
      const claimedTenant = request.headers['x-tenant-id'] || request.query?.tenantId;

      if (agentToken && claimedTenant) {
        const ok = await authRepo.verifyTenantAgentToken(String(claimedTenant), String(agentToken));
        if (!ok) {
          socket.send(JSON.stringify({ event: 'error', message: 'Token de agente inválido.' }));
          socket.close(1008, 'Unauthorized agent');
          return;
        }
        session = {
          socket,
          tenantId: String(claimedTenant),
          userEmail: `agent@${claimedTenant}`,
          role: 'operator',
          clientType: 'agent',
          connectedAt: new Date().toISOString(),
        };
      } else {
        const claims = verifyJwt(queryToken || authHeader || '');
        session = {
          socket,
          tenantId: claims.tenantId,
          userEmail: claims.email,
          role: claims.role,
          clientType: request.query?.client || 'web-console',
          connectedAt: new Date().toISOString(),
        };
      }
    } catch (err) {
      socket.send(
        JSON.stringify({
          protocol: 'nexusdesk-ws/3.0',
          event: 'auth.rejected',
          message: err.message || 'Falha na autenticação WebSocket.',
        }),
      );
      socket.close(1008, 'Authentication required');
      return;
    }

    addClientToRoom(session.tenantId, session);
    const roomSize = tenantRooms.get(session.tenantId)?.size || 1;

    // Frame inicial de boas-vindas do protocolo Não-REST
    socket.send(
      JSON.stringify({
        protocol: 'nexusdesk-ws/3.0',
        event: 'welcome',
        tenantId: session.tenantId,
        role: session.role,
        connectedPeers: roomSize,
        timestamp: new Date().toISOString(),
      }),
    );

    socket.on('message', async (rawBuffer) => {
      try {
        const msg = JSON.parse(String(rawBuffer));
        const action = msg?.action || msg?.type;

        if (action === 'ping') {
          socket.send(
            JSON.stringify({
              protocol: 'nexusdesk-ws/3.0',
              event: 'pong',
              echoId: msg.id || null,
              serverTime: new Date().toISOString(),
            }),
          );
          return;
        }

        // Streaming direto de telemetria via WebSocket (sem overhead HTTP REST!)
        if (action === 'telemetry.push') {
          if (session.role === 'collaborator') {
            socket.send(
              JSON.stringify({ event: 'error', message: 'Permissão insuficiente para telemetria.' }),
            );
            return;
          }
          const payload = msg.data || {};
          if (!payload.deviceKey || !payload.hostname) return;

          const saved = await telemetryRepo.upsertHeartbeat(session.tenantId, {
            deviceKey: sanitizeText(payload.deviceKey, 120),
            hostname: sanitizeText(payload.hostname, 120),
            serialNumber: payload.serialNumber ? sanitizeText(payload.serialNumber, 120) : null,
            osVersion: payload.osVersion ? sanitizeText(payload.osVersion, 120) : undefined,
            ipAddress: payload.ipAddress
              ? sanitizeText(payload.ipAddress, 64)
              : request.headers['x-forwarded-for'] || request.ip,
            loggedUser: payload.loggedUser
              ? sanitizeText(payload.loggedUser, 120)
              : session.userEmail,
            cpuPercent: Number(payload.cpuPercent ?? 15),
            ramPercent: Number(payload.ramPercent ?? 45),
            diskPercent: Number(payload.diskPercent ?? 40),
          });

          broadcastToTenant(session.tenantId, {
            protocol: 'nexusdesk-ws/3.0',
            event: 'telemetry.heartbeat',
            tenantId: session.tenantId,
            source: 'websocket-stream',
            timestamp: new Date().toISOString(),
            data: saved,
          });
          return;
        }

        // Sinalização bidirecional de sessão remota NexusDesk
        if (action === 'remote.signal') {
          if (session.role === 'collaborator') return;
          broadcastToTenant(
            session.tenantId,
            {
              protocol: 'nexusdesk-ws/3.0',
              event: 'remote.signal',
              tenantId: session.tenantId,
              sender: session.userEmail,
              timestamp: new Date().toISOString(),
              data: {
                targetDevice: sanitizeText(msg.targetDevice || '', 120),
                signalType: sanitizeText(msg.signalType || 'session_ping', 64),
                note: sanitizeText(msg.note || '', 240),
              },
            },
            socket,
          );
        }
      } catch {
        socket.send(
          JSON.stringify({
            protocol: 'nexusdesk-ws/3.0',
            event: 'error',
            message: 'Frame JSON malformado no canal WebSocket.',
          }),
        );
      }
    });

    socket.on('close', () => {
      if (session) removeClientFromRoom(session.tenantId, session);
    });
  });

  return app;
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const port = Number(process.env.PORT || 8004);
  const host = process.env.HOST || '0.0.0.0';
  buildNexusDeskService({ logger: true }).then((app) =>
    app.listen({ port, host }).then(() => {
      console.log(`[service-nexusdesk] REST + WebSocket Online em http://${host}:${port}`);
    }),
  );
}
