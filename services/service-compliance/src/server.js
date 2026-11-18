// services/service-compliance/src/server.js
// =============================================================================
// MICROSSERVIÇO 3 — Compliance Jurídico CLT & Auditoria (`service-compliance`)
// API 3 (REST): /api/v1/compliance
// =============================================================================
// Funcionalidades de Segurança Corporativa:
//  - Emissão e assinatura digital HMAC-SHA256 de Termos de Custódia CLT
//  - Verificação criptográfica independente de integridade documental
//  - Trilha de Auditoria Imutável (SHA-256 Hash-Chain) à prova de adulteração
// =============================================================================

import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import { pathToFileURL } from 'node:url';
import { checkDbHealth, complianceRepo, initDatabase } from '../../shared/db.js';
import { publishDomainEvent } from '../../shared/eventBus.js';
import {
  assertZeroKnowledgeAllowed,
  computeTermDocumentHash,
  requireRoles,
  sanitizeText,
  signInternalEvent,
  verifyGatewayOrJwt,
  verifyInternalEvent,
  verifyResponsibilityTermSignature,
} from '../../shared/security.js';

export async function buildComplianceService(opts = {}) {
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
      message: error.message || 'Erro no microsserviço de compliance.',
      service: 'service-compliance',
    });
  });

  app.get('/health', async () => {
    const db = await checkDbHealth();
    return {
      service: 'service-compliance',
      api: 'API 3 (REST) — Compliance CLT, Assinatura HMAC & Hash-Chain Audit',
      status: 'healthy',
      database: db,
      timestamp: new Date().toISOString(),
    };
  });

  // ---------------------------------------------------------------------------
  // GET /api/v1/compliance/terms — Lista termos (Colaborador vê os seus; TI vê todos)
  // ---------------------------------------------------------------------------
  app.get('/api/v1/compliance/terms', async (request) => {
    const user = verifyGatewayOrJwt(request);
    const { status } = request.query || {};

    const employeeEmail = user.role === 'collaborator' ? user.email : undefined;
    const items = await complianceRepo.listTerms(user.tenantId, {
      employeeEmail,
      status: status ? sanitizeText(status, 24) : undefined,
    });

    return {
      tenantId: user.tenantId,
      total: items.length,
      items,
    };
  });

  // ---------------------------------------------------------------------------
  // POST /api/v1/compliance/terms — Emite novo Termo de Responsabilidade CLT
  // ---------------------------------------------------------------------------
  app.post(
    '/api/v1/compliance/terms',
    {
      schema: {
        body: {
          type: 'object',
          required: ['employeeName', 'employeeEmail', 'assetsSnapshot'],
          properties: {
            termType: { type: 'string', enum: ['entrega', 'devolucao', 'emprestimo'] },
            employeeName: { type: 'string', minLength: 2, maxLength: 160 },
            employeeEmail: { type: 'string', minLength: 5, maxLength: 180 },
            employeeCpf: { type: ['string', 'null'], maxLength: 24 },
            department: { type: 'string', maxLength: 120 },
            legalClause: { type: 'string', maxLength: 3000 },
            assetsSnapshot: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                required: ['internalId', 'model'],
                properties: {
                  internalId: { type: 'string', maxLength: 64 },
                  model: { type: 'string', maxLength: 160 },
                  serialNumber: { type: ['string', 'null'], maxLength: 120 },
                },
              },
            },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const user = verifyGatewayOrJwt(request);
      requireRoles(user, ['owner', 'admin', 'manager', 'operator']);

      const body = request.body;
      const created = await complianceRepo.createTerm(
        user.tenantId,
        {
          termType: body.termType || 'entrega',
          employeeName: sanitizeText(body.employeeName, 160),
          employeeEmail: sanitizeText(body.employeeEmail, 180).toLowerCase(),
          employeeCpf: body.employeeCpf ? sanitizeText(body.employeeCpf, 24) : null,
          department: sanitizeText(body.department || 'Corporativo', 120),
          legalClause: body.legalClause ? sanitizeText(body.legalClause, 3000) : undefined,
          assetsSnapshot: body.assetsSnapshot,
        },
        user,
      );

      await complianceRepo.appendAuditLog(user.tenantId, {
        actorEmail: user.email,
        actorRole: user.role,
        action: 'TERM_ISSUED',
        resourceType: 'responsibility_term',
        resourceId: created.id,
        payload: {
          employeeEmail: created.employee_email,
          documentHash: created.document_hash,
          assetsCount: created.assets_snapshot.length,
        },
      });

      await publishDomainEvent('term.issued', user.tenantId, {
        id: created.id,
        employeeName: created.employee_name,
        employeeEmail: created.employee_email,
        termType: created.term_type,
        documentHash: created.document_hash,
      });

      return reply.code(201).send(created);
    },
  );

  // ---------------------------------------------------------------------------
  // POST /api/v1/compliance/terms/:id/sign — Assinatura Criptográfica Digital
  // ---------------------------------------------------------------------------
  app.post('/api/v1/compliance/terms/:id/sign', async (request, reply) => {
    const user = verifyGatewayOrJwt(request);
    const term = await complianceRepo.findTermById(user.tenantId, request.params.id);

    if (!term) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Termo não encontrado.' });
    }

    // Apenas o próprio colaborador destinatário ou um admin pode assinar
    const isRecipient = term.employee_email.toLowerCase() === user.email.toLowerCase();
    const isAdmin = ['owner', 'admin'].includes(user.role);
    if (!isRecipient && !isAdmin) {
      return reply.code(403).send({
        error: 'FORBIDDEN',
        message: 'Apenas o colaborador titular da custódia pode assinar este termo.',
      });
    }

    const signed = await complianceRepo.signTerm(user.tenantId, term.id, {
      signerIp: request.headers['x-forwarded-for'] || request.ip,
      signerUserAgent: sanitizeText(request.headers['user-agent'] || 'NexusPortal', 250),
    });

    const signedAtIso =
      signed.signed_at instanceof Date ? signed.signed_at.toISOString() : signed.signed_at;

    const auditEntry = await complianceRepo.appendAuditLog(user.tenantId, {
      actorEmail: user.email,
      actorRole: user.role,
      action: 'TERM_SIGNED_HMAC',
      resourceType: 'responsibility_term',
      resourceId: signed.id,
      payload: {
        documentHash: signed.document_hash,
        signatureHash: signed.signature_hash,
        signedAt: signedAtIso,
      },
    });

    await publishDomainEvent('term.signed', user.tenantId, {
      id: signed.id,
      employeeName: signed.employee_name,
      employeeEmail: signed.employee_email,
      signatureHash: signed.signature_hash,
      auditEntryHash: auditEntry.entry_hash,
    });

    return {
      message: 'Termo assinado digitalmente com selo criptográfico HMAC-SHA256.',
      term: signed,
      auditProof: {
        seq: auditEntry.seq,
        entryHash: auditEntry.entry_hash,
        prevHash: auditEntry.prev_hash,
      },
    };
  });

  // ---------------------------------------------------------------------------
  // GET /api/v1/compliance/terms/:id/verify — Auditoria Criptográfica do Documento
  // ---------------------------------------------------------------------------
  app.get('/api/v1/compliance/terms/:id/verify', async (request, reply) => {
    const user = verifyGatewayOrJwt(request);
    const term = await complianceRepo.findTermById(user.tenantId, request.params.id);

    if (!term) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Termo não encontrado.' });
    }

    if (
      user.role === 'collaborator' &&
      term.employee_email.toLowerCase() !== user.email.toLowerCase()
    ) {
      return reply.code(403).send({
        error: 'FORBIDDEN',
        message: 'Colaboradores podem auditar apenas os termos emitidos em seu próprio nome.',
      });
    }

    const recomputedDocHash = computeTermDocumentHash({
      tenantId: term.tenant_id,
      termType: term.term_type,
      employeeEmail: term.employee_email,
      assetsSnapshot: term.assets_snapshot,
      legalClause: term.legal_clause,
    });

    const documentIntact = recomputedDocHash === term.document_hash;
    const signedAtIso =
      term.signed_at instanceof Date ? term.signed_at.toISOString() : term.signed_at;

    const signatureValid =
      term.status === 'signed' &&
      documentIntact &&
      verifyResponsibilityTermSignature({
        termId: term.id,
        tenantId: term.tenant_id,
        employeeEmail: term.employee_email,
        documentHash: term.document_hash,
        signedAt: signedAtIso,
        signatureHash: term.signature_hash,
      });

    return {
      termId: term.id,
      status: term.status,
      valid: term.status === 'signed' ? Boolean(documentIntact && signatureValid) : Boolean(documentIntact),
      documentIntact,
      signatureValid,
      algorithm: 'HMAC-SHA256 + Canonical SHA-256',
      documentHash: term.document_hash,
      signatureHash: term.signature_hash,
      employeeEmail: term.employee_email,
      signedAt: signedAtIso,
      verifiedAt: new Date().toISOString(),
    };
  });

  // ---------------------------------------------------------------------------
  // DELETE /api/v1/compliance/terms/:id — Remoção administrativa de termo
  // ---------------------------------------------------------------------------
  app.delete('/api/v1/compliance/terms/:id', async (request, reply) => {
    const user = verifyGatewayOrJwt(request);
    requireRoles(user, ['owner', 'admin', 'manager']);

    const removed = await complianceRepo.deleteTerm(user.tenantId, request.params.id);
    if (!removed) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Termo não encontrado.' });
    }

    await publishDomainEvent('term.deleted', user.tenantId, {
      id: removed.id,
      employeeName: removed.employee_name,
    });

    return {
      message: 'Termo removido com sucesso.',
      term: removed,
    };
  });

  // ---------------------------------------------------------------------------
  // POST /api/v1/compliance/terms/:id/archive-vps — Arquiva Cópia Assinada no Cofre VPS
  // ---------------------------------------------------------------------------
  app.post('/api/v1/compliance/terms/:id/archive-vps', async (request, reply) => {
    const user = verifyGatewayOrJwt(request);
    assertZeroKnowledgeAllowed(user, 'Arquivamento de Termos na VPS');
    requireRoles(user, ['owner', 'admin', 'manager', 'operator']);

    const term = await complianceRepo.findTermById(user.tenantId, request.params.id);
    if (!term) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Termo não encontrado.' });
    }
    if (term.status !== 'signed') {
      return reply.code(400).send({
        error: 'TERM_NOT_SIGNED',
        message: 'Apenas termos assinados com selo HMAC podem ser arquivados na VPS.',
      });
    }

    const signedAtIso =
      term.signed_at instanceof Date ? term.signed_at.toISOString() : term.signed_at;
    const assetsList = Array.isArray(term.assets_snapshot) ? term.assets_snapshot : [];

    const docContent = [
      '========================================================================',
      'NEXUS ITAM — TERMO DE CUSTÓDIA PATRIMONIAL CLT ASSINADO DIGITALMENTE',
      '========================================================================',
      `ID do Termo:        ${term.id}`,
      `Empresa (Tenant):   ${term.tenant_id}`,
      `Tipo de Termo:      ${term.term_type}`,
      `Titular (Nome):     ${term.employee_name}`,
      `Titular (E-mail):   ${term.employee_email}`,
      `CPF:                ${term.employee_cpf || 'N/A'}`,
      `Departamento:       ${term.department || 'Corporativo'}`,
      `Status:             ${term.status}`,
      `Assinado em:        ${signedAtIso}`,
      `IP do Signatário:   ${term.signer_ip || 'N/A'}`,
      `Hash SHA-256 Doc:   ${term.document_hash}`,
      `Selo HMAC-SHA256:   ${term.signature_hash}`,
      '------------------------------------------------------------------------',
      'ATIVOS VINCULADOS:',
      ...assetsList.map(
        (a, i) =>
          `  ${i + 1}. [${a.internalId}] ${a.model} (S/N: ${a.serialNumber || 'S/N'})`,
      ),
      '------------------------------------------------------------------------',
      'CLÁUSULA LEGAL CLT:',
      term.legal_clause || '',
      '========================================================================',
    ].join('\n');

    const storageUrl =
      process.env.STORAGE_SERVICE_URL || 'http://127.0.0.1:8005';
    const fileName = `termo-${term.id}.txt`;
    const bodyStr = JSON.stringify({
      tenantId: user.tenantId,
      actor: user,
      folderSegments: ['Cofre-TI-Infra', 'Termos'],
      files: [
        {
          name: fileName,
          mimeType: 'text/plain; charset=utf-8',
          contentBase64: Buffer.from(docContent, 'utf8').toString('base64'),
        },
      ],
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
        message: data.message || 'Falha ao arquivar termo na VPS.',
      });
    }

    const auditEntry = await complianceRepo.appendAuditLog(user.tenantId, {
      actorEmail: user.email,
      actorRole: user.role,
      action: 'TERM_ARCHIVED_TO_VPS',
      resourceType: 'responsibility_term',
      resourceId: term.id,
      payload: {
        virtualPath: data.virtualPath || `/Cofre-TI-Infra/Termos/${fileName}`,
        documentHash: term.document_hash,
        signatureHash: term.signature_hash,
      },
    });

    return reply.code(200).send({
      archived: true,
      termId: term.id,
      virtualPath: data.virtualPath || `/Cofre-TI-Infra/Termos/${fileName}`,
      folderPath: '/Cofre-TI-Infra/Termos/',
      nodeId: data.nodeId || null,
      auditSeq: auditEntry.seq,
    });
  });

  // ---------------------------------------------------------------------------
  // POST /internal/audit — Ponte M2M Assinada HMAC para Outros Microsserviços
  // ---------------------------------------------------------------------------
  app.post('/internal/audit', async (request, reply) => {
    const rawBody = JSON.stringify(request.body || {});
    const valid = verifyInternalEvent(
      rawBody,
      request.headers['x-internal-ts'],
      request.headers['x-internal-sig'],
    );
    if (!valid) {
      return reply.code(401).send({
        error: 'INTERNAL_HMAC_INVALID',
        message: 'Assinatura HMAC M2M inválida ou ausente.',
      });
    }

    const body = request.body || {};
    if (!body.tenantId || !body.action || !body.resourceId) {
      return reply.code(400).send({ error: 'INVALID_AUDIT_PAYLOAD', message: 'Payload incompleto.' });
    }

    const entry = await complianceRepo.appendAuditLog(body.tenantId, {
      actorEmail: sanitizeText(body.actorEmail || 'system@nexus.local', 180),
      actorRole: sanitizeText(body.actorRole || 'system', 32),
      action: sanitizeText(body.action, 80).toUpperCase(),
      resourceType: sanitizeText(body.resourceType || 'storage_node', 64),
      resourceId: sanitizeText(String(body.resourceId), 120),
      payload: body.payload && typeof body.payload === 'object' ? body.payload : {},
    });

    return reply.code(201).send(entry);
  });

  // ---------------------------------------------------------------------------
  // GET /api/v1/compliance/audit — Consulta Trilha de Auditoria Imutável
  // ---------------------------------------------------------------------------
  app.get('/api/v1/compliance/audit', async (request) => {
    const user = verifyGatewayOrJwt(request);
    assertZeroKnowledgeAllowed(user, 'Consulta de Auditoria');
    requireRoles(user, ['owner', 'admin', 'manager', 'operator', 'viewer']);
    const limit = Math.min(Math.max(Number(request.query?.limit || 50), 1), 200);
    const items = await complianceRepo.listAuditChain(user.tenantId, limit);
    return {
      tenantId: user.tenantId,
      total: items.length,
      items,
    };
  });

  // ---------------------------------------------------------------------------
  // POST /api/v1/compliance/audit — Registra evento na Hash-Chain
  // ---------------------------------------------------------------------------
  app.post(
    '/api/v1/compliance/audit',
    {
      schema: {
        body: {
          type: 'object',
          required: ['action', 'resourceType', 'resourceId'],
          properties: {
            action: { type: 'string', minLength: 2, maxLength: 80 },
            resourceType: { type: 'string', minLength: 2, maxLength: 64 },
            resourceId: { type: 'string', minLength: 1, maxLength: 120 },
            payload: { type: 'object' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const user = verifyGatewayOrJwt(request);
      requireRoles(user, ['owner', 'admin', 'manager', 'operator']);

      const entry = await complianceRepo.appendAuditLog(user.tenantId, {
        actorEmail: user.email,
        actorRole: user.role,
        action: sanitizeText(request.body.action, 80).toUpperCase(),
        resourceType: sanitizeText(request.body.resourceType, 64),
        resourceId: sanitizeText(request.body.resourceId, 120),
        payload: request.body.payload || {},
      });

      return reply.code(201).send(entry);
    },
  );

  // ---------------------------------------------------------------------------
  // GET /api/v1/compliance/audit/verify-chain — Prova Matemática da Hash-Chain
  // ---------------------------------------------------------------------------
  app.get('/api/v1/compliance/audit/verify-chain', async (request) => {
    const user = verifyGatewayOrJwt(request);
    assertZeroKnowledgeAllowed(user, 'Verificação de Auditoria');
    requireRoles(user, ['owner', 'admin', 'manager', 'operator', 'viewer']);
    return complianceRepo.verifyAuditChainIntegrity(user.tenantId);
  });

  return app;
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const port = Number(process.env.PORT || 8003);
  const host = process.env.HOST || '0.0.0.0';
  buildComplianceService({ logger: true }).then((app) =>
    app.listen({ port, host }).then(() => {
      console.log(`[service-compliance] Online em http://${host}:${port}`);
    }),
  );
}
