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
import { authRepo, canonicalTenantId, checkDbHealth, initDatabase, storageRepo, telemetryRepo } from '../../shared/db.js';
import {
  isZeroKnowledgeRestricted,
  requireRoles,
  sanitizeText,
  signInternalEvent,
  verifyGatewayOrJwt,
  verifyInternalEvent,
  verifyJwt,
} from '../../shared/security.js';
import {
  canAccessLevelPerform,
  resolveEffectiveNodeAccess,
} from '../../service-storage/src/services/aclService.js';
import { normalizeWorkbookTabs } from '../../service-storage/src/services/sheetCodec.js';

function canCollaboratorReceiveEvent(peerEmail, envelope) {
  const email = String(peerEmail || '').toLowerCase().trim();
  if (!email) return false;

  const eventName = String(envelope?.event || '');
  const data = envelope?.data || {};

  // Colaboradores nunca recebem frames de telemetria RMM ou controle remoto
  if (eventName.startsWith('telemetry.') || eventName.startsWith('remote.')) {
    return false;
  }

  // Coedição de planilhas em tempo real (Nexus Sheets Live) e Sync Desktop
  if (eventName.startsWith('sheet.')) {
    if (Array.isArray(data.allowedPeerEmails)) {
      return data.allowedPeerEmails.some((e) => String(e || '').toLowerCase().trim() === email);
    }
    return true;
  }
  if (eventName === 'storage.node.synced') {
    return true;
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
    bodyLimit: 4_194_304,
    keepAliveTimeout: 65_000,
    forceCloseConnections: 'idle',
  });

  // Salas multi-tenant isoladas em memória para streaming WebSocket em tempo real
  // Map<tenantId, Set<{ socket, userEmail, role, clientType, connectedAt }>>
  const tenantRooms = new Map();
  // Salas de coedição de planilhas em tempo real (Nexus Sheets Live)
  // Map<`${tenantId}:${fileId}`, { tenantId, fileId, peers: Set<session>, tabs, rev, dirty, timer, pendingHistory: [], lastActor: null }>
  const sheetRooms = new Map();
  // Relay de sessões remotas em memória (zero latência de banco para frames e inputs)
  // Map<`${canonicalTenantId}_${deviceKey}`, { sessionId, status, mode, quality, viewerSeenAt, inputEvents, updatedAt }>
  const remoteSessions = new Map();

  function buildSheetRoomKey(tenantId, fileId) {
    return `${canonicalTenantId(tenantId)}:${String(fileId || '').trim()}`;
  }

  function broadcastToSheetRoom(room, eventName, dataPayload, excludeSocket = null) {
    if (!room || !room.peers) return 0;
    const allowedPeerEmails = Array.from(room.peers).map((p) => p.userEmail);
    let delivered = 0;
    for (const peer of room.peers) {
      if (excludeSocket && peer.socket === excludeSocket) continue;
      const env = {
        protocol: 'nexusdesk-ws/3.0',
        event: eventName,
        tenantId: room.tenantId,
        timestamp: new Date().toISOString(),
        data: {
          ...dataPayload,
          allowedPeerEmails,
        },
      };
      if (peer.role === 'collaborator' && !canCollaboratorReceiveEvent(peer.userEmail, env)) {
        continue;
      }
      if (peer.socket.readyState === 1) {
        const cleanData = { ...dataPayload };
        peer.socket.send(
          JSON.stringify({
            protocol: 'nexusdesk-ws/3.0',
            event: eventName,
            tenantId: room.tenantId,
            timestamp: env.timestamp,
            data: cleanData,
          }),
        );
        delivered += 1;
      }
    }
    return delivered;
  }

  function broadcastSheetPresence(room) {
    if (!room) return;
    const peersList = Array.from(room.peers).map((p) => ({
      email: p.userEmail,
      userEmail: p.userEmail,
      name: p.userName || p.userEmail,
      role: p.role,
      accessLevel: p.sheetAccessMap?.get(room.fileId) || 'editor',
      clientType: p.clientType,
    }));
    broadcastToSheetRoom(room, 'sheet.presence', {
      fileId: room.fileId,
      peers: peersList,
      rev: room.rev,
    });
  }

  async function flushSheetRoomAutoSave(room) {
    if (!room || !room.dirty) return;
    if (room.timer) {
      clearTimeout(room.timer);
      room.timer = null;
    }
    room.dirty = false;
    const pendingHistory = room.pendingHistory.splice(0, room.pendingHistory.length);
    const actor = room.lastActor || { email: 'ws-autosave@nexus.local', name: 'AutoSave' };

    const storageUrl = process.env.STORAGE_SERVICE_URL || 'http://127.0.0.1:8005';
    const bodyObj = {
      tenantId: room.tenantId,
      fileId: room.fileId,
      rev: room.rev,
      user: actor,
      tabs: room.tabs,
      cellHistoryEntries: pendingHistory,
    };
    const bodyStr = JSON.stringify(bodyObj);

    try {
      const res = await fetch(`${storageUrl}/internal/storage/sheets/autosave`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...signInternalEvent(bodyStr),
        },
        body: bodyStr,
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const saved = await res.json().catch(() => ({}));
        room.rev = Number(saved.rev ?? room.rev);
        broadcastToSheetRoom(room, 'sheet.saved', {
          fileId: room.fileId,
          rev: room.rev,
          version: saved.version,
          savedAt: saved.savedAt || new Date().toISOString(),
        });
        return;
      }
    } catch {
      /* fallback below */
    }

    // Direct storageRepo fallback if HTTP call failed
    try {
      const savedSession = await storageRepo.upsertSheetSession(room.tenantId, room.fileId, {
        workbookJson: { sheets: room.tabs, tabs: room.tabs },
        lastSavedByEmail: actor.email,
        force: true,
      });
      if (pendingHistory.length > 0) {
        await storageRepo.appendSheetCellHistory(
          room.tenantId,
          room.fileId,
          pendingHistory.map((h) => ({
            rev: room.rev,
            tabName: h.tabName || 'Planilha1',
            cellRef: h.cellRef,
            oldValue: h.oldValue,
            newValue: h.newValue,
            oldFormula: h.oldFormula,
            newFormula: h.newFormula,
            actorEmail: h.actorEmail,
            actorName: h.actorName,
          })),
        );
      }
      broadcastToSheetRoom(room, 'sheet.saved', {
        fileId: room.fileId,
        rev: room.rev,
        savedAt: savedSession.updated_at || new Date().toISOString(),
      });
    } catch {
      /* ignore */
    }
  }

  function scheduleSheetRoomAutoSave(room) {
    room.dirty = true;
    if (room.timer) {
      clearTimeout(room.timer);
    }
    room.timer = setTimeout(() => {
      flushSheetRoomAutoSave(room);
    }, 1800);
  }

  async function removeSessionFromAllSheetRooms(session) {
    if (!session) return;
    for (const [key, room] of sheetRooms.entries()) {
      if (room.peers.has(session)) {
        room.peers.delete(session);
        if (room.peers.size === 0) {
          if (room.dirty) {
            await flushSheetRoomAutoSave(room);
          }
          if (room.timer) clearTimeout(room.timer);
          sheetRooms.delete(key);
        } else {
          broadcastSheetPresence(room);
        }
      }
    }
  }

  function upsertRemoteControlState(tenantId, payload = {}) {
    const cleanTenant = canonicalTenantId(tenantId);
    const deviceKey = sanitizeText(payload.deviceKey || '', 120);
    if (!cleanTenant || !deviceKey) return null;
    const key = `${cleanTenant}_${deviceKey}`;
    const existing = remoteSessions.get(key) || {
      tenantId: cleanTenant,
      deviceKey,
      sessionId: '',
      status: 'active',
      mode: 'attended',
      quality: 'balanced',
      viewerSeenAt: new Date().toISOString(),
      inputEvents: [],
      updatedAt: Date.now(),
    };

    if (payload.sessionId !== undefined) {
      const nextId = sanitizeText(payload.sessionId, 120);
      if (nextId !== existing.sessionId) {
        existing.inputEvents = [];
      }
      existing.sessionId = nextId;
    }
    if (payload.status) existing.status = sanitizeText(payload.status, 32);
    if (payload.mode) existing.mode = payload.mode === 'unattended' ? 'unattended' : 'attended';
    if (['low', 'balanced', 'high', 'ultra'].includes(payload.quality)) {
      existing.quality = payload.quality;
    }
    if (payload.targetFps) {
      existing.targetFps = Math.max(10, Math.min(60, Number(payload.targetFps) || 45));
    }
    if (payload.monitorIndex !== undefined && payload.monitorIndex !== null) {
      const mIdx = Number(payload.monitorIndex);
      if (Number.isInteger(mIdx) && mIdx >= -1 && mIdx <= 15) {
        existing.monitorIndex = mIdx;
      }
    }
    if (payload.touchMode) {
      existing.touchMode = sanitizeText(payload.touchMode, 32);
    }
    existing.viewerSeenAt = new Date().toISOString();
    existing.updatedAt = Date.now();

    if (Array.isArray(payload.inputEvents)) {
      if (payload.inputEvents.length === 0 && payload.clearInputs) {
        existing.inputEvents = [];
      } else {
        const bySeq = new Map(existing.inputEvents.map((ev) => [Number(ev.seq) || 0, ev]));
        for (const ev of payload.inputEvents) {
          if (ev && typeof ev === 'object' && Number(ev.seq) > 0) {
            bySeq.set(Number(ev.seq), ev);
          }
        }
        existing.inputEvents = Array.from(bySeq.values())
          .sort((a, b) => Number(a.seq) - Number(b.seq))
          .slice(-64);
      }
    }

    if (existing.status === 'closed' || existing.status === 'ended' || !existing.sessionId) {
      existing.inputEvents = [];
    }

    remoteSessions.set(key, existing);
    return existing;
  }

  function addClientToRoom(tenantId, session) {
    const cleanTenant = canonicalTenantId(tenantId);
    if (!tenantRooms.has(cleanTenant)) {
      tenantRooms.set(cleanTenant, new Set());
    }
    tenantRooms.get(cleanTenant).add(session);
  }

  function removeClientFromRoom(tenantId, session) {
    const cleanTenant = canonicalTenantId(tenantId);
    const room = tenantRooms.get(cleanTenant);
    if (!room) return;
    room.delete(session);
    if (room.size === 0) tenantRooms.delete(cleanTenant);
  }

  function broadcastToTenant(tenantId, envelope, excludeSocket = null) {
    const cleanTenant = canonicalTenantId(tenantId);
    const room = tenantRooms.get(cleanTenant);
    if (!room || room.size === 0) return 0;
    const eventName = String(envelope?.event || '');
    const eventDeviceKey = envelope?.data?.deviceKey || envelope?.data?.targetDevice || '';
    const serialized = JSON.stringify(envelope);
    let delivered = 0;

    for (const peer of room) {
      if (excludeSocket && peer.socket === excludeSocket) continue;

      // Sandbox estrito para conexões M2M do NexusAgent: nunca recebem frames de vídeo ou eventos de domínio,
      // apenas sinais/controles endereçados especificamente ao seu próprio deviceKey.
      if (peer.role === 'agent' || peer.clientType === 'nexusdesk-agent') {
        if (eventName !== 'remote.control' && eventName !== 'remote.signal') {
          continue;
        }
        if (peer.deviceKey && eventDeviceKey && peer.deviceKey !== eventDeviceKey) {
          continue;
        }
      } else if (peer.clientType === 'agent' && eventName === 'remote.frame') {
        // Outros agentes autenticados por token nunca precisam receber quadros JPEG de tela
        continue;
      }

      // Viewers dedicados a um dispositivo específico só recebem quadros daquele dispositivo
      if (
        eventName === 'remote.frame' &&
        peer.watchDeviceKey &&
        eventDeviceKey &&
        peer.watchDeviceKey !== eventDeviceKey
      ) {
        continue;
      }

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
    options: {
      maxPayload: 4 * 1024 * 1024,
      perMessageDeflate: false,
    },
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

  // ---------------------------------------------------------------------------
  // Relay de Alta Velocidade NexusDesk (Frames + Input/Qualidade em Memória)
  // ---------------------------------------------------------------------------
  app.post('/api/v1/telemetry/remote-control', async (request, reply) => {
    const body = request.body || {};
    let resolvedTenantId = '';
    if (request.headers['x-gateway-signature'] || request.headers.authorization) {
      const user = verifyGatewayOrJwt(request);
      requireRoles(user, ['owner', 'admin', 'manager', 'operator']);
      resolvedTenantId = canonicalTenantId(user.tenantId);
    } else {
      const claimedTenant = canonicalTenantId(
        sanitizeText(body.tenantId || request.headers['x-tenant-id'] || '', 64),
      );
      const sessionId = sanitizeText(body.sessionId || '', 120);
      if (!claimedTenant || !sessionId || !/^(rem|ses)-[A-Za-z0-9-]+$/.test(sessionId)) {
        return reply.code(401).send({
          error: 'UNAUTHORIZED',
          message: 'Sessão remota ou token de autenticação obrigatório.',
        });
      }
      resolvedTenantId = claimedTenant;
    }

    const state = upsertRemoteControlState(resolvedTenantId, body);
    if (!state) {
      return reply.code(400).send({
        error: 'INVALID_REMOTE_CONTROL',
        message: 'Informe deviceKey válido para atualizar a sessão remota.',
      });
    }
    const delivered = broadcastToTenant(resolvedTenantId, {
      protocol: 'nexusdesk-ws/3.0',
      event: 'remote.control',
      tenantId: resolvedTenantId,
      timestamp: new Date().toISOString(),
      data: state,
    });
    return { accepted: true, delivered, control: state };
  });

  app.post('/api/v1/telemetry/remote-frame', async (request, reply) => {
    const body = request.body || {};
    const claimedTenant = canonicalTenantId(
      sanitizeText(body.tenantId || request.headers['x-tenant-id'] || '', 64),
    );
    const deviceKey = sanitizeText(body.deviceKey || '', 120);
    const sessionId = sanitizeText(body.sessionId || body.frame?.sessionId || '', 120);

    if (!claimedTenant || !deviceKey || !sessionId || !/^(rem|ses)-[A-Za-z0-9-]+$/.test(sessionId)) {
      return reply.code(400).send({
        error: 'INVALID_FRAME_ENVELOPE',
        message: 'tenantId, deviceKey e sessionId ativo são obrigatórios.',
      });
    }

    const key = `${claimedTenant}_${deviceKey}`;
    let state = remoteSessions.get(key);
    if (!state || state.sessionId !== sessionId) {
      state = upsertRemoteControlState(claimedTenant, {
        deviceKey,
        sessionId,
        status: 'active',
        quality: body.frame?.quality || body.quality || 'balanced',
      });
    }

    const ackSeq = Number(body.ackInputSeq || body.remoteState?.lastInputSeq || 0);
    if (ackSeq > 0 && Array.isArray(state.inputEvents) && state.inputEvents.length > 0) {
      state.inputEvents = state.inputEvents.filter((ev) => Number(ev.seq) > ackSeq);
    }

    const delivered = body.frame
      ? broadcastToTenant(claimedTenant, {
          protocol: 'nexusdesk-ws/3.0',
          event: 'remote.frame',
          tenantId: claimedTenant,
          timestamp: new Date().toISOString(),
          data: {
            deviceKey,
            sessionId,
            frame: body.frame,
            remoteState: body.remoteState || null,
          },
        })
      : 0;

    return {
      accepted: true,
      delivered,
      control: {
        sessionId: state.sessionId,
        status: state.status,
        mode: state.mode,
        quality: state.quality,
        targetFps: state.targetFps || 45,
        monitorIndex: state.monitorIndex ?? 0,
        viewerSeenAt: state.viewerSeenAt,
        inputEvents: state.inputEvents || [],
      },
    };
  });

  // ===========================================================================
  // API 5 (NÃO-REST) — WebSocket Bidirecional Full-Duplex (`/ws/nexusdesk`)
  // ===========================================================================
  app.get('/ws/nexusdesk', { websocket: true }, async (socket, request) => {
    let session = null;
    socket._socket?.setNoDelay?.(true);

    socket.on('error', () => {
      if (session) removeClientFromRoom(session.tenantId, session);
    });

    try {
      const queryToken = request.query?.token;
      const authHeader = request.headers.authorization;
      const agentToken = request.headers['x-agent-token'] || request.query?.agentToken;
      const claimedTenant = request.headers['x-tenant-id'] || request.query?.tenantId;
      const queryDeviceKey = sanitizeText(request.query?.deviceKey || '', 120);

      if (agentToken && claimedTenant) {
        const ok = await authRepo.verifyTenantAgentToken(String(claimedTenant), String(agentToken));
        if (!ok) {
          socket.send(JSON.stringify({ event: 'error', message: 'Token de agente inválido.' }));
          socket.close(1008, 'Unauthorized agent');
          return;
        }
        session = {
          socket,
          tenantId: canonicalTenantId(String(claimedTenant)),
          userEmail: `agent@${claimedTenant}`,
          role: 'operator',
          clientType: 'agent',
          deviceKey: queryDeviceKey || null,
          connectedAt: new Date().toISOString(),
        };
      } else if (
        claimedTenant &&
        request.query?.client === 'nexusdesk-agent' &&
        /^[A-Za-z0-9-]{3,120}$/.test(queryDeviceKey)
      ) {
        // Canal WebSocket dedicado e isolado para NexusAgent.exe matriculado (sem expor agentToken em disco)
        session = {
          socket,
          tenantId: canonicalTenantId(String(claimedTenant)),
          userEmail: `agent-${queryDeviceKey}@nexusdesk`,
          role: 'agent',
          clientType: 'nexusdesk-agent',
          deviceKey: queryDeviceKey,
          connectedAt: new Date().toISOString(),
        };
      } else if (queryToken || authHeader) {
        const claims = verifyJwt(queryToken || authHeader || '');
        session = {
          socket,
          tenantId: canonicalTenantId(claims.tenantId),
          userEmail: claims.email,
          userName: claims.name || claims.email,
          role: claims.role,
          department: claims.department || 'Geral',
          clientType: request.query?.client || 'web-console',
          watchDeviceKey: queryDeviceKey || null,
          connectedAt: new Date().toISOString(),
          sheetAccessMap: new Map(),
        };
      } else if (claimedTenant && request.query?.client === 'nexusdesk-viewer') {
        session = {
          socket,
          tenantId: canonicalTenantId(String(claimedTenant)),
          userEmail: 'viewer@nexusdesk',
          role: 'operator',
          clientType: 'nexusdesk-viewer',
          watchDeviceKey: queryDeviceKey || null,
          connectedAt: new Date().toISOString(),
        };
      } else {
        const claims = verifyJwt('');
        session = {
          socket,
          tenantId: canonicalTenantId(claims.tenantId),
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

        // Streaming direto de frames de tela de alta velocidade via WebSocket (30-60 FPS sem overhead HTTP)
        if (action === 'remote.frame' || action === 'remote.push_frame') {
          if (session.role === 'collaborator') return;
          const payload = msg.data || msg;
          const deviceKey =
            session.role === 'agent' && session.deviceKey
              ? session.deviceKey
              : sanitizeText(payload.deviceKey || '', 120);
          const sessionId = sanitizeText(payload.sessionId || payload.frame?.sessionId || '', 120);
          if (!deviceKey || !sessionId || !/^(rem|ses)-[A-Za-z0-9-]+$/.test(sessionId)) return;

          const cleanTenant = canonicalTenantId(session.tenantId);
          const key = `${cleanTenant}_${deviceKey}`;
          let state = remoteSessions.get(key);
          if (!state || state.sessionId !== sessionId) {
            state = upsertRemoteControlState(cleanTenant, {
              deviceKey,
              sessionId,
              status: 'active',
              quality: payload.frame?.quality || payload.quality || 'balanced',
              targetFps: payload.frame?.targetFps || payload.targetFps || 45,
            });
          }

          const ackSeq = Number(payload.ackInputSeq || payload.remoteState?.lastInputSeq || 0);
          if (ackSeq > 0 && Array.isArray(state.inputEvents) && state.inputEvents.length > 0) {
            state.inputEvents = state.inputEvents.filter((ev) => Number(ev.seq) > ackSeq);
          }

          if (payload.frame) {
            broadcastToTenant(
              cleanTenant,
              {
                protocol: 'nexusdesk-ws/3.0',
                event: 'remote.frame',
                tenantId: cleanTenant,
                sender: session.userEmail,
                timestamp: new Date().toISOString(),
                data: {
                  deviceKey,
                  sessionId,
                  frame: payload.frame,
                  remoteState: payload.remoteState || state || null,
                },
              },
              socket,
            );
          }

          // Sincroniza de volta ao agente caso existam inputs pendentes ou sessão encerrada
          if (
            socket.readyState === 1 &&
            (state.status === 'closed' ||
              state.status === 'ended' ||
              (Array.isArray(state.inputEvents) && state.inputEvents.length > 0))
          ) {
            socket.send(
              JSON.stringify({
                protocol: 'nexusdesk-ws/3.0',
                event: 'remote.control',
                tenantId: cleanTenant,
                timestamp: new Date().toISOString(),
                data: {
                  sessionId: state.sessionId,
                  status: state.status,
                  mode: state.mode,
                  quality: state.quality,
                  targetFps: state.targetFps || 45,
                  monitorIndex: state.monitorIndex ?? 0,
                  viewerSeenAt: state.viewerSeenAt,
                  inputEvents: state.inputEvents || [],
                },
              }),
            );
          }
          return;
        }

        // Sandbox: conexões M2M de agente não acessam controle de terceiros, chat ou planilhas
        if (session.role === 'agent') {
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
          return;
        }

        // Controle em tempo real de qualidade e inputs de mouse/teclado via WebSocket
        if (action === 'remote.control') {
          if (session.role === 'collaborator') return;
          const state = upsertRemoteControlState(session.tenantId, msg.data || msg);
          if (!state) return;
          broadcastToTenant(
            session.tenantId,
            {
              protocol: 'nexusdesk-ws/3.0',
              event: 'remote.control',
              tenantId: canonicalTenantId(session.tenantId),
              sender: session.userEmail,
              timestamp: new Date().toISOString(),
              data: state,
            },
            socket,
          );
          return;
        }

        // Indicador "digitando..." em tempo real entre Portal do Colaborador e Console TI
        if (action === 'ticket.typing') {
          const ticketId = sanitizeText(msg.ticketId || msg.data?.ticketId || '', 64);
          if (!ticketId) return;
          const isTyping = Boolean(msg.isTyping ?? msg.data?.isTyping ?? true);
          const safeRequesterEmail =
            session.role === 'collaborator'
              ? String(session.userEmail || '').toLowerCase().trim()
              : sanitizeText(msg.requesterEmail || msg.data?.requesterEmail || '', 180)
                  .toLowerCase()
                  .trim();

          broadcastToTenant(
            session.tenantId,
            {
              protocol: 'nexusdesk-ws/3.0',
              event: 'ticket.typing',
              tenantId: canonicalTenantId(session.tenantId),
              sender: session.userEmail,
              timestamp: new Date().toISOString(),
              data: {
                ticketId,
                requesterEmail: safeRequesterEmail,
                senderEmail: String(session.userEmail || '').toLowerCase(),
                senderName: sanitizeText(session.userName || session.userEmail || '', 160),
                senderRole: session.role,
                isTyping,
              },
            },
            socket,
          );
          return;
        }

        // =====================================================================
        // NEXUS SHEETS LIVE — Coedição Colaborativa em Tempo Real via WebSocket
        // =====================================================================
        if (typeof action === 'string' && action.startsWith('sheet.')) {
          const fileId = sanitizeText(msg.fileId || msg.data?.fileId || '', 64);
          if (!fileId) {
            socket.send(
              JSON.stringify({
                protocol: 'nexusdesk-ws/3.0',
                event: 'sheet.error',
                message: 'fileId obrigatório em eventos sheet.*',
              }),
            );
            return;
          }

          const userCtx = {
            id: session.userEmail,
            email: session.userEmail,
            name: session.userName || session.userEmail,
            role: session.role,
            tenantId: session.tenantId,
            department: session.department || 'Geral',
          };

          if (isZeroKnowledgeRestricted(userCtx)) {
            socket.send(
              JSON.stringify({
                protocol: 'nexusdesk-ws/3.0',
                event: 'sheet.error',
                error: 'ZERO_KNOWLEDGE_RESTRICTED',
                message: 'Superadmin bloqueado por Zero-Knowledge LGPD.',
              }),
            );
            return;
          }

          const node = await storageRepo.getNodeById(session.tenantId, fileId);
          if (!node || node.is_trashed) {
            socket.send(
              JSON.stringify({
                protocol: 'nexusdesk-ws/3.0',
                event: 'sheet.error',
                error: 'SHEET_NOT_FOUND',
                message: 'Planilha não encontrada neste tenant.',
              }),
            );
            return;
          }

          const effectiveAccess = await resolveEffectiveNodeAccess(session.tenantId, userCtx, node);
          if (!canAccessLevelPerform(effectiveAccess, 'preview', { user: userCtx, node })) {
            socket.send(
              JSON.stringify({
                protocol: 'nexusdesk-ws/3.0',
                event: 'sheet.error',
                error: 'FORBIDDEN',
                message: 'Sem permissão para acessar esta planilha.',
              }),
            );
            return;
          }

          const roomKey = buildSheetRoomKey(session.tenantId, fileId);
          let room = sheetRooms.get(roomKey);
          if (!room) {
            const dbSession = await storageRepo.getSheetSession(session.tenantId, fileId);
            const initialTabs = normalizeWorkbookTabs(
              dbSession?.workbook_json?.sheets || dbSession?.workbook_json?.tabs || [],
            );
            room = {
              tenantId: session.tenantId,
              fileId,
              peers: new Set(),
              tabs: initialTabs,
              rev: Number(dbSession?.rev ?? dbSession?.revision ?? 1),
              dirty: false,
              timer: null,
              pendingHistory: [],
              lastActor: userCtx,
            };
            sheetRooms.set(roomKey, room);
          }

          if (!session.sheetAccessMap) session.sheetAccessMap = new Map();
          session.sheetAccessMap.set(fileId, effectiveAccess);

          if (action === 'sheet.join') {
            room.peers.add(session);
            broadcastSheetPresence(room);
            return;
          }

          if (action === 'sheet.leave') {
            room.peers.delete(session);
            if (room.peers.size === 0 && room.dirty) {
              await flushSheetRoomAutoSave(room);
            } else {
              broadcastSheetPresence(room);
            }
            return;
          }

          if (action === 'sheet.cursor') {
            room.peers.add(session);
            const tab = sanitizeText(msg.tab || msg.data?.tab || 'Planilha1', 64);
            const cell = sanitizeText(msg.cell || msg.data?.cell || 'A1', 16).toUpperCase();
            const range = msg.range || msg.data?.range || cell;
            broadcastToSheetRoom(
              room,
              'sheet.cursor',
              {
                fileId,
                tab,
                cell,
                range,
                email: session.userEmail,
                userEmail: session.userEmail,
                userName: session.userName || session.userEmail,
              },
              socket,
            );
            return;
          }

          // Write mutations require editor/full_control + cloud:write + not locked by another user
          if (['sheet.cell.patch', 'sheet.format.patch', 'sheet.tab.add', 'sheet.tab.rename'].includes(action)) {
            if (!canAccessLevelPerform(effectiveAccess, 'write', { user: userCtx, node })) {
              socket.send(
                JSON.stringify({
                  protocol: 'nexusdesk-ws/3.0',
                  event: 'sheet.error',
                  error: 'READ_ONLY_ACCESS',
                  message: 'Permissão somente leitura (viewer_online/reader) nesta planilha.',
                }),
              );
              return;
            }

            const lockedBy = node.locked_by_email || node.lockedByEmail || null;
            if (lockedBy && String(lockedBy).toLowerCase() !== String(session.userEmail || '').toLowerCase()) {
              socket.send(
                JSON.stringify({
                  protocol: 'nexusdesk-ws/3.0',
                  event: 'sheet.error',
                  error: 'NODE_LOCKED',
                  message: `Planilha bloqueada para edição por ${lockedBy}.`,
                }),
              );
              return;
            }

            room.peers.add(session);
            room.lastActor = userCtx;

            if (action === 'sheet.cell.patch') {
              const tabName = sanitizeText(msg.tab || msg.data?.tab || 'Planilha1', 64);
              const cellRef = sanitizeText(msg.cell || msg.data?.cell || '', 16).toUpperCase();
              if (!cellRef || !/^[A-Z]{1,3}\d{1,6}$/.test(cellRef)) {
                socket.send(
                  JSON.stringify({
                    protocol: 'nexusdesk-ws/3.0',
                    event: 'sheet.error',
                    message: 'Referência de célula inválida em sheet.cell.patch.',
                  }),
                );
                return;
              }

              const value = msg.value !== undefined ? msg.value : msg.data?.value;
              const formula = msg.formula !== undefined ? msg.formula : msg.data?.formula;

              let targetTab = room.tabs.find((t) => t.name === tabName);
              if (!targetTab) {
                targetTab = { name: tabName, freezeRow: 0, cells: {} };
                room.tabs.push(targetTab);
              }

              const prevCell = targetTab.cells?.[cellRef] || {};
              const oldVal = prevCell.v !== undefined ? String(prevCell.v ?? '') : null;
              const oldForm = prevCell.f ? String(prevCell.f) : null;

              const nextCell = { ...prevCell };
              if (formula !== undefined && formula !== null && String(formula).trim() !== '') {
                const fStr = String(formula).trim();
                nextCell.f = fStr.startsWith('=') ? fStr : `=${fStr}`;
                nextCell.v = value ?? null;
              } else if (typeof value === 'string' && value.trim().startsWith('=')) {
                nextCell.f = value.trim();
                nextCell.v = null;
              } else {
                delete nextCell.f;
                nextCell.v = value;
              }
              targetTab.cells[cellRef] = nextCell;

              room.tabs = normalizeWorkbookTabs(room.tabs);
              room.rev += 1;

              const evalTab = room.tabs.find((t) => t.name === tabName) || room.tabs[0];
              const evalCell = evalTab?.cells?.[cellRef] || nextCell;

              room.pendingHistory.push({
                tabName,
                cellRef,
                oldValue: oldVal,
                newValue: evalCell.v !== undefined && evalCell.v !== null ? String(evalCell.v) : null,
                oldFormula: oldForm,
                newFormula: evalCell.f || null,
                actorEmail: session.userEmail,
                actorName: session.userName || session.userEmail,
              });

              const savedSess = await storageRepo.upsertSheetSession(session.tenantId, fileId, {
                workbookJson: { sheets: room.tabs, tabs: room.tabs },
                lastSavedByEmail: session.userEmail,
                force: true,
              });
              room.rev = Number(savedSess.rev ?? room.rev);

              broadcastToSheetRoom(room, 'sheet.cell.patch', {
                fileId,
                tab: tabName,
                cell: cellRef,
                value: evalCell.computed !== undefined ? evalCell.computed : evalCell.v,
                formula: evalCell.f || null,
                rev: room.rev,
                actorEmail: session.userEmail,
                actorName: session.userName || session.userEmail,
              });

              scheduleSheetRoomAutoSave(room);
              return;
            }

            if (action === 'sheet.format.patch') {
              const tabName = sanitizeText(msg.tab || msg.data?.tab || 'Planilha1', 64);
              const cellRef = sanitizeText(msg.cell || msg.data?.cell || 'A1', 16).toUpperCase();
              const style = msg.style || msg.data?.style || {};
              const freezeRow = msg.freezeRow ?? msg.data?.freezeRow;

              let targetTab = room.tabs.find((t) => t.name === tabName);
              if (!targetTab) {
                targetTab = { name: tabName, freezeRow: 0, cells: {} };
                room.tabs.push(targetTab);
              }
              if (freezeRow !== undefined) {
                targetTab.freezeRow = Number(freezeRow) || 0;
              }
              if (cellRef && style && typeof style === 'object') {
                const prev = targetTab.cells[cellRef] || { v: '' };
                targetTab.cells[cellRef] = {
                  ...prev,
                  style: { ...(prev.style || {}), ...style },
                };
              }
              const savedSess = await storageRepo.upsertSheetSession(session.tenantId, fileId, {
                workbookJson: { sheets: room.tabs, tabs: room.tabs },
                lastSavedByEmail: session.userEmail,
                force: true,
              });
              room.rev = Number(savedSess.rev ?? room.rev);

              broadcastToSheetRoom(room, 'sheet.format.patch', {
                fileId,
                tab: tabName,
                cell: cellRef,
                style,
                freezeRow: targetTab.freezeRow,
                rev: room.rev,
                actorEmail: session.userEmail,
              });
              scheduleSheetRoomAutoSave(room);
              return;
            }

            if (action === 'sheet.tab.add') {
              const tabName = sanitizeText(msg.tabName || msg.data?.tabName || `Planilha${room.tabs.length + 1}`, 64);
              if (!room.tabs.some((t) => t.name === tabName)) {
                room.tabs.push({ name: tabName, freezeRow: 0, cells: {} });
              }
              const savedSess = await storageRepo.upsertSheetSession(session.tenantId, fileId, {
                workbookJson: { sheets: room.tabs, tabs: room.tabs },
                lastSavedByEmail: session.userEmail,
                force: true,
              });
              room.rev = Number(savedSess.rev ?? room.rev);

              broadcastToSheetRoom(room, 'sheet.tab.add', {
                fileId,
                tabName,
                rev: room.rev,
                actorEmail: session.userEmail,
              });
              scheduleSheetRoomAutoSave(room);
              return;
            }

            if (action === 'sheet.tab.rename') {
              const oldName = sanitizeText(msg.oldName || msg.data?.oldName || '', 64);
              const tabName = sanitizeText(msg.tabName || msg.data?.tabName || '', 64);
              const found = room.tabs.find((t) => t.name === oldName);
              if (found && tabName) {
                found.name = tabName;
              }
              const savedSess = await storageRepo.upsertSheetSession(session.tenantId, fileId, {
                workbookJson: { sheets: room.tabs, tabs: room.tabs },
                lastSavedByEmail: session.userEmail,
                force: true,
              });
              room.rev = Number(savedSess.rev ?? room.rev);

              broadcastToSheetRoom(room, 'sheet.tab.rename', {
                fileId,
                oldName,
                tabName,
                rev: room.rev,
                actorEmail: session.userEmail,
              });
              scheduleSheetRoomAutoSave(room);
              return;
            }
          }
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
      if (session) {
        removeClientFromRoom(session.tenantId, session);
        removeSessionFromAllSheetRooms(session);
      }
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
