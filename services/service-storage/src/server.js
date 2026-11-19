// services/service-storage/src/server.js
// =============================================================================
// MICROSSERVIÇO 6 — Nexus Cloud Vault & Conector VPS (`service-storage` — :8005)
// API 6 (REST): /api/v1/storage
// =============================================================================
// Responsabilidades:
//  - Gestão multitenant de conexões VPS (SFTP/SSH, Agent Node HMAC, S3/MinIO/R2, WebDAV)
//  - Criptografia de credenciais AES-256-GCM at-rest e mascaramento Zero-Leakage
//  - Confinamento lógico de caminhos (Chroot Virtual) contra Path Traversal
//  - Zero-Knowledge LGPD: superadmin (nexus-master) bloqueado (403)
//  - Provisionamento idempotente da estrutura corporativa (/Corporativo-Publico, /Setores, etc.)
//  - Explorador VFS completo: pastas, upload streaming/multipart/raw (100MB), versionamento (10),
//    locks (423), lixeira 30 dias (.nexus_trash/), preview inline seguro + HTTP Range (206/416),
//    links temporários auditados com senha opcional, e motor Nexus Sheets Live (.xlsx/.csv/.nexusheet)
// =============================================================================

import crypto from 'node:crypto';
import path from 'node:path';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import { pathToFileURL } from 'node:url';
import { checkDbHealth, initDatabase, storageRepo } from '../../shared/db.js';
import {
  assertZeroKnowledgeAllowed,
  decryptVaultCredentials,
  encryptVaultCredentials,
  hashPassword,
  maskVaultCredentials,
  normalizeVirtualVaultPath,
  resolveSafeVaultPath,
  sanitizeText,
  signInternalEvent,
  verifyGatewayOrJwt,
  verifyInternalEvent,
  verifyPassword,
} from '../../shared/security.js';
import { resolveStorageDriver } from './drivers/driverRegistry.js';
import { parseHttpByteRange } from './drivers/sftpDriver.js';
import { buildAgentInstallScript } from './services/installScriptBuilder.js';
import {
  VALID_ACCESS_LEVELS,
  VALID_TARGET_TYPES,
  canAccessLevelPerform,
  canPerformGlobalCapability,
  resolveEffectiveNodeAccess,
} from './services/aclService.js';
import { recordStorageAudit } from './services/auditClient.js';
import { provisionCorporateVault } from './services/provisioner.js';
import {
  diffWorkbookCells,
  exportTabsToCsvString,
  normalizeWorkbookTabs,
  parseBinaryToWorkbookTabs,
  serializeWorkbookToBinary,
} from './services/sheetCodec.js';
import { buildZipArchive } from './services/zipBuilder.js';
import {
  extractArchiveBuffer,
  isSupportedArchiveName,
  stripArchiveExtension,
} from './services/archiveExtractor.js';

const BLOCKED_EXTENSIONS = new Set([
  '.exe',
  '.bat',
  '.cmd',
  '.msi',
  '.ps1',
  '.vbs',
  '.scr',
  '.com',
  '.pif',
]);

const BLOCKED_MIMES = new Set([
  'application/x-msdownload',
  'application/x-executable',
  'application/x-dosexec',
  'application/x-msdos-program',
]);

const VALID_PROVIDERS = new Set(['sftp', 'agent_node', 's3', 'webdav']);

function isUnsafeSegmentName(rawName) {
  if (rawName === null || rawName === undefined) return true;
  const str = String(rawName);
  if (!str.trim()) return true;
  if (str.includes('\0') || /%00/i.test(str)) return true;
  if (/%2e%2e|%252e|%2f|%5c/i.test(str)) return true;
  let decoded = str;
  try {
    decoded = decodeURIComponent(str);
  } catch {
    /* keep raw */
  }
  if (decoded.includes('\0') || decoded.includes('/') || decoded.includes('\\')) return true;
  if (str.includes('/') || str.includes('\\')) return true;
  if (/^[a-zA-Z]:/.test(str) || /^[a-zA-Z]:/.test(decoded)) return true;
  const trimmed = str.trim();
  if (trimmed === '.' || trimmed === '..') return true;
  if (decoded.trim() === '.' || decoded.trim() === '..') return true;
  return false;
}

function validateSafeSingleName(rawName, label = 'Nome') {
  if (isUnsafeSegmentName(rawName)) {
    const err = new Error(`${label} inválido ou contém tentativa de Path Traversal.`);
    err.code = 'PATH_TRAVERSAL_BLOCKED';
    err.statusCode = 400;
    throw err;
  }
  return String(rawName).trim();
}

function inferMimeType(fileName, providedMime) {
  const ext = path.posix.extname(String(fileName || '')).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.html' || ext === '.htm') return 'text/html';
  if (ext === '.txt' || ext === '.log' || ext === '.md') return 'text/plain; charset=utf-8';
  if (ext === '.csv') return 'text/csv; charset=utf-8';
  if (ext === '.json' || ext === '.nexusheet') return 'application/json; charset=utf-8';
  if (ext === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.mp3') return 'audio/mpeg';
  if (providedMime && providedMime !== 'application/octet-stream') return providedMime;
  return 'application/octet-stream';
}

function assertAllowedFileType(fileName, mimeType) {
  const ext = path.posix.extname(String(fileName || '')).toLowerCase();
  const mime = String(mimeType || '').toLowerCase().split(';')[0].trim();
  if (BLOCKED_EXTENSIONS.has(ext) || BLOCKED_MIMES.has(mime)) {
    const err = new Error(`Extensão ou tipo de arquivo executável bloqueado por segurança (${ext || mime}).`);
    err.code = 'EXECUTABLE_FILE_BLOCKED';
    err.statusCode = 415;
    throw err;
  }
}

function serializePublicConnection(conn) {
  if (!conn) return null;
  let maskedCreds = {};
  const cipher = conn.encrypted_credentials || conn.encryptedCredentials;
  if (cipher) {
    try {
      const plain = decryptVaultCredentials(cipher);
      maskedCreds = maskVaultCredentials(plain);
    } catch {
      maskedCreds = {};
    }
  }
  return {
    id: conn.id,
    tenantId: conn.tenant_id || conn.tenantId,
    providerType: conn.provider_type || conn.providerType,
    label: conn.label,
    host: conn.host || null,
    port: conn.port !== null && conn.port !== undefined ? Number(conn.port) : null,
    username: conn.username || null,
    rootPath: conn.root_path || conn.rootPath || '/',
    endpointUrl: conn.endpoint_url || conn.endpointUrl || null,
    bucket: conn.bucket || null,
    region: conn.region || null,
    quotaBytes: Number(conn.quota_bytes ?? conn.quotaBytes ?? 0),
    usedBytes: Number(conn.used_bytes ?? conn.usedBytes ?? 0),
    status: conn.status || 'unconfigured',
    lastCheckAt: conn.last_check_at || conn.last_healthcheck_at || conn.lastHealthcheckAt || null,
    lastHealthcheckAt: conn.last_check_at || conn.last_healthcheck_at || conn.lastHealthcheckAt || null,
    lastLatencyMs: conn.latency_ms ?? conn.last_latency_ms ?? conn.lastLatencyMs ?? null,
    latencyMs: conn.latency_ms ?? conn.last_latency_ms ?? conn.lastLatencyMs ?? null,
    lastError: conn.last_error || conn.lastError || null,
    initializedAt: conn.initialized_at || conn.initializedAt || null,
    credentialsMasked: maskedCreds,
    updatedAt: conn.updated_at || conn.updatedAt || null,
  };
}

function serializeNode(node, effectiveAccess = null) {
  if (!node) return null;
  const access = effectiveAccess ?? node.effectiveAccess ?? node.effective_access ?? 'full_control';
  return {
    id: node.id,
    tenantId: node.tenant_id || node.tenantId,
    parentId: node.parent_id ?? node.parentId ?? null,
    parent_id: node.parent_id ?? node.parentId ?? null,
    name: node.name,
    virtualPath: node.virtual_path || node.virtualPath,
    virtual_path: node.virtual_path || node.virtualPath,
    storageKey: node.storage_key || node.storageKey,
    storage_key: node.storage_key || node.storageKey,
    type: node.node_type || node.nodeType || node.type || 'file',
    nodeType: node.node_type || node.nodeType || node.type || 'file',
    node_type: node.node_type || node.nodeType || node.type || 'file',
    mimeType: node.mime_type || node.mimeType || 'application/octet-stream',
    mime_type: node.mime_type || node.mimeType || 'application/octet-stream',
    sizeBytes: Number(node.size_bytes ?? node.sizeBytes ?? 0),
    size_bytes: Number(node.size_bytes ?? node.sizeBytes ?? 0),
    sha256Hash: node.sha256_hash || node.sha256Hash || null,
    sha256_hash: node.sha256_hash || node.sha256Hash || null,
    currentVersion: Number(node.current_version ?? node.currentVersion ?? 1),
    current_version: Number(node.current_version ?? node.currentVersion ?? 1),
    departmentScope: node.department_scope || node.departmentScope || null,
    department_scope: node.department_scope || node.departmentScope || null,
    lockedByEmail: node.locked_by_email || node.lockedByEmail || null,
    locked_by_email: node.locked_by_email || node.lockedByEmail || null,
    lockedAt: node.locked_at || node.lockedAt || null,
    locked_at: node.locked_at || node.lockedAt || null,
    isTrashed: Boolean(node.is_trashed ?? node.isTrashed),
    is_trashed: Boolean(node.is_trashed ?? node.isTrashed),
    trashedAt: node.trashed_at || node.trashedAt || null,
    trashed_at: node.trashed_at || node.trashedAt || null,
    trashedByEmail: node.trashed_by_email || node.trashedByEmail || null,
    trashed_by_email: node.trashed_by_email || node.trashedByEmail || null,
    originalVirtualPath: node.original_virtual_path || node.originalVirtualPath || null,
    original_virtual_path: node.original_virtual_path || node.originalVirtualPath || null,
    createdByEmail: node.created_by_email || node.createdByEmail || null,
    created_by_email: node.created_by_email || node.createdByEmail || null,
    createdAt: node.created_at || node.createdAt || null,
    updatedAt: node.updated_at || node.updatedAt || null,
    effectiveAccess: access,
    effective_access: access,
    accessLevel: access,
  };
}

function parseMultipartFormBuffer(rawBuffer, contentTypeHeader) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(String(contentTypeHeader || ''));
  if (!boundaryMatch) {
    const err = new Error('Boundary multipart/form-data ausente.');
    err.statusCode = 400;
    throw err;
  }
  const boundary = (boundaryMatch[1] || boundaryMatch[2]).trim();
  const delimiter = Buffer.from(`--${boundary}`, 'utf8');
  const fields = {};
  let filePart = null;

  let pos = rawBuffer.indexOf(delimiter);
  while (pos !== -1) {
    const start = pos + delimiter.length;
    if (rawBuffer.subarray(start, start + 2).toString('utf8') === '--') {
      break;
    }
    const nextPos = rawBuffer.indexOf(delimiter, start);
    if (nextPos === -1) break;

    let partBuf = rawBuffer.subarray(start, nextPos);
    if (partBuf.subarray(0, 2).toString('utf8') === '\r\n') {
      partBuf = partBuf.subarray(2);
    } else if (partBuf[0] === 0x0a) {
      partBuf = partBuf.subarray(1);
    }
    if (partBuf.subarray(partBuf.length - 2).toString('utf8') === '\r\n') {
      partBuf = partBuf.subarray(0, partBuf.length - 2);
    } else if (partBuf[partBuf.length - 1] === 0x0a) {
      partBuf = partBuf.subarray(0, partBuf.length - 1);
    }

    let headerEnd = partBuf.indexOf(Buffer.from('\r\n\r\n'));
    let sepLen = 4;
    if (headerEnd === -1) {
      headerEnd = partBuf.indexOf(Buffer.from('\n\n'));
      sepLen = 2;
    }
    if (headerEnd !== -1) {
      const headerStr = partBuf.subarray(0, headerEnd).toString('utf8');
      const bodyBuf = partBuf.subarray(headerEnd + sepLen);
      const nameMatch = /\bname="([^"]+)"/i.exec(headerStr);
      const fileNameMatch = /\bfilename="([^"]*)"/i.exec(headerStr);
      const ctMatch = /content-type:\s*([^\r\n;]+)/i.exec(headerStr);

      const fieldName = nameMatch ? nameMatch[1] : '';
      if (fileNameMatch || fieldName === 'file') {
        filePart = {
          fieldName,
          filename: fileNameMatch ? fileNameMatch[1] : 'upload.bin',
          mimeType: ctMatch ? ctMatch[1].trim() : 'application/octet-stream',
          buffer: Buffer.from(bodyBuf),
        };
      } else if (fieldName) {
        fields[fieldName] = bodyBuf.toString('utf8');
      }
    }

    pos = nextPos;
  }

  return { fields, filePart };
}

export async function buildStorageService(opts = {}) {
  await initDatabase();

  const app = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: 110 * 1024 * 1024, // 110 MB to support 100 MB streaming uploads
    forceCloseConnections: true,
  });

  await app.register(helmet, { global: true, contentSecurityPolicy: false });
  await app.register(cors, { origin: true });

  // Support multipart/form-data and application/octet-stream as raw Buffer
  app.addContentTypeParser('multipart/form-data', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

  app.setErrorHandler((error, _request, reply) => {
    const status = error.statusCode || (error.validation ? 400 : 500);
    reply.code(status).send({
      error: error.code || (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_REJECTED'),
      message: error.message || 'Erro no microsserviço de storage.',
      service: 'service-storage',
    });
  });

  function authenticateStorageUser(request) {
    const user = verifyGatewayOrJwt(request);
    assertZeroKnowledgeAllowed(user, 'Cloud Vault & VPS Storage');
    return user;
  }

  function requireGlobalCapability(user, capability) {
    if (!canPerformGlobalCapability(user, capability)) {
      const err = new Error(`Permissão insuficiente: requer capacidade '${capability}'.`);
      err.code = 'FORBIDDEN';
      err.statusCode = 403;
      throw err;
    }
  }

  async function buildTenantAccessContext(tenantId) {
    const allActive = await storageRepo.listNodes(tenantId, { includeTrash: false });
    const nodesMap = new Map(allActive.map((n) => [n.id, n]));
    const rawAcls = await storageRepo.listAclsForNodes(
      tenantId,
      allActive.map((n) => n.id),
    );
    const aclsByNodeId = new Map();
    if ( rawAcls instanceof Map ) {
      for (const [k, v] of rawAcls.entries()) aclsByNodeId.set(k, v);
    } else if (Array.isArray(rawAcls)) {
      for (const acl of rawAcls) {
        const nid = acl.node_id || acl.nodeId;
        if (!aclsByNodeId.has(nid)) aclsByNodeId.set(nid, []);
        aclsByNodeId.get(nid).push(acl);
      }
    }
    return { allActive, nodesMap, aclsByNodeId };
  }

  async function getConfiguredDriverOrThrow(tenantId) {
    const conn = await storageRepo.getConnection(tenantId);
    if (!conn) {
      const err = new Error('Conexão VPS não configurada para esta empresa.');
      err.code = 'VPS_NOT_CONFIGURED';
      err.statusCode = 412;
      throw err;
    }
    return { conn, driver: resolveStorageDriver(conn) };
  }

  function assertNodeNotLockedByAnother(node, user) {
    const lockedBy = node?.locked_by_email || node?.lockedByEmail || null;
    if (!lockedBy) return;
    if (String(lockedBy).toLowerCase() === String(user?.email || '').toLowerCase()) return;
    const err = new Error(`Arquivo bloqueado para edição por ${lockedBy}.`);
    err.code = 'NODE_LOCKED';
    err.statusCode = 423;
    throw err;
  }

  app.get('/health', async () => {
    const db = await checkDbHealth();
    return {
      service: 'service-storage',
      api: 'API 6 (REST) — Nexus Cloud Vault, Conector Híbrido VPS & Sheets Live',
      status: 'healthy',
      database: db,
      timestamp: new Date().toISOString(),
    };
  });

  // ---------------------------------------------------------------------------
  // 1. CONEXÃO VPS & TELEMETRIA
  // ---------------------------------------------------------------------------
  app.get('/api/v1/storage/connection', async (request) => {
    const user = authenticateStorageUser(request);
    requireGlobalCapability(user, 'cloud:connect');
    const conn = await storageRepo.getConnection(user.tenantId);
    if (!conn) {
      return {
        configured: false,
        connection: null,
        rootPath: '/',
      };
    }
    return {
      configured: true,
      connection: serializePublicConnection(conn),
      ...serializePublicConnection(conn),
    };
  });

  app.put('/api/v1/storage/connection', async (request) => {
    const user = authenticateStorageUser(request);
    requireGlobalCapability(user, 'cloud:connect');
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const existing = await storageRepo.getConnection(user.tenantId);

    const providerTypeRaw = body.providerType || body.provider_type || existing?.provider_type || 'sftp';
    const providerType = String(providerTypeRaw).toLowerCase().trim();
    if (!VALID_PROVIDERS.has(providerType)) {
      const err = new Error(`Provider '${providerType}' não suportado. Use sftp, agent_node, s3 ou webdav.`);
      err.code = 'INVALID_PROVIDER_TYPE';
      err.statusCode = 400;
      throw err;
    }

    if (body.quotaBytes !== undefined && body.quotaBytes !== null) {
      const q = Number(body.quotaBytes);
      if (!Number.isFinite(q) || q < 0) {
        const err = new Error('quotaBytes deve ser um número não-negativo.');
        err.code = 'INVALID_QUOTA';
        err.statusCode = 400;
        throw err;
      }
    }

    if (body.port !== undefined && body.port !== null && body.port !== '') {
      const p = Number(body.port);
      if (!Number.isInteger(p) || p < 1 || p > 65535 || typeof body.port === 'boolean') {
        const err = new Error('Porta TCP inválida (deve estar entre 1 e 65535).');
        err.code = 'INVALID_PORT';
        err.statusCode = 400;
        throw err;
      }
    }

    let rootPath = existing?.root_path || '/';
    if (body.rootPath !== undefined && body.rootPath !== null) {
      const rawRoot = String(body.rootPath);
      if (rawRoot.includes('\0') || rawRoot.includes('\\') || /%2e%2e|%2f|%5c|%00/i.test(rawRoot) || rawRoot.includes('..')) {
        const err = new Error('rootPath inválido ou contém tentativa de Path Traversal.');
        err.code = 'PATH_TRAVERSAL_BLOCKED';
        err.statusCode = 400;
        throw err;
      }
      rootPath = normalizeVirtualVaultPath(rawRoot);
    }

    // Validate SFTP specific fields when configuring sftp
    if (providerType === 'sftp') {
      const usernameVal = body.username !== undefined ? body.username : existing?.username;
      if (body.username !== undefined && !String(body.username || '').trim()) {
        const err = new Error('Usuário SFTP obrigatório.');
        err.statusCode = 400;
        throw err;
      }
      const pkCandidate = body.privateKey ?? body.credentials?.privateKey;
      if (pkCandidate !== undefined && pkCandidate !== null && String(pkCandidate).trim() !== '') {
        const pkStr = String(pkCandidate).trim();
        if (!pkStr.includes('BEGIN') || !pkStr.includes('PRIVATE KEY')) {
          const err = new Error('Formato de chave privada SSH inválido (esperado PEM/OpenSSH).');
          err.code = 'INVALID_PRIVATE_KEY';
          err.statusCode = 400;
          throw err;
        }
      }
      if (!existing && !usernameVal) {
        const err = new Error('Usuário SFTP obrigatório.');
        err.statusCode = 400;
        throw err;
      }
    }

    let currentCreds = {};
    if (existing?.encrypted_credentials) {
      try {
        currentCreds = decryptVaultCredentials(existing.encrypted_credentials) || {};
      } catch {
        currentCreds = {};
      }
    }

    const incomingCreds = body.credentials && typeof body.credentials === 'object' ? body.credentials : {};
    const isUnmaskedSecret = (val) =>
      val !== undefined &&
      val !== null &&
      String(val).trim() !== '' &&
      !String(val).includes('••••') &&
      !String(val).includes('***');
    const mergedCreds = {
      ...currentCreds,
    };
    for (const [k, v] of Object.entries(incomingCreds)) {
      if (isUnmaskedSecret(v)) {
        mergedCreds[k] = v;
      }
    }
    for (const secretKey of [
      'password',
      'privateKey',
      'passphrase',
      'hmacToken',
      'token',
      'accessKey',
      'secretKey',
      'bearerToken',
      'authMethod',
    ]) {
      if (isUnmaskedSecret(body[secretKey])) {
        mergedCreds[secretKey] = body[secretKey];
      }
    }

    const encryptedCredentials = encryptVaultCredentials(mergedCreds);

    const saved = await storageRepo.upsertConnection(user.tenantId, {
      providerType,
      label: body.label !== undefined ? sanitizeText(body.label, 120) : existing?.label || 'VPS Principal',
      host: body.host !== undefined ? sanitizeText(body.host, 255) : existing?.host || null,
      port: body.port !== undefined && body.port !== null ? Number(body.port) : existing?.port ?? 22,
      username: body.username !== undefined ? sanitizeText(body.username, 120) : existing?.username || null,
      rootPath,
      endpointUrl:
        body.endpointUrl !== undefined ? sanitizeText(body.endpointUrl, 500) : existing?.endpoint_url || null,
      bucket: body.bucket !== undefined ? sanitizeText(body.bucket, 120) : existing?.bucket || null,
      region: body.region !== undefined ? sanitizeText(body.region, 64) : existing?.region || 'us-east-1',
      encryptedCredentials,
      quotaBytes:
        body.quotaBytes !== undefined && body.quotaBytes !== null
          ? Number(body.quotaBytes)
          : Number(existing?.quota_bytes ?? 53_687_091_200),
      status: existing?.status && existing.status !== 'unconfigured' ? existing.status : 'connected',
      createdByEmail: user.email,
    });

    await recordStorageAudit(user.tenantId, user, {
      action: 'STORAGE_CONNECTION_UPDATED',
      resourceType: 'vps_connection',
      resourceId: saved.id,
      payload: {
        providerType: saved.provider_type,
        label: saved.label,
        rootPath: saved.root_path,
        quotaBytes: Number(saved.quota_bytes),
      },
    });

    const pub = serializePublicConnection(saved);
    return {
      ok: true,
      configured: true,
      connection: pub,
      ...pub,
    };
  });

  app.post('/api/v1/storage/connection/test', async (request) => {
    const user = authenticateStorageUser(request);
    requireGlobalCapability(user, 'cloud:connect');

    const conn = await storageRepo.getConnection(user.tenantId);
    if (!conn) {
      const err = new Error('Conexão VPS não configurada para esta empresa.');
      err.code = 'VPS_NOT_CONFIGURED';
      err.statusCode = 412;
      throw err;
    }

    const driver = resolveStorageDriver(conn);
    const result = await driver.testConnection();

    const updated = await storageRepo.updateConnectionStatus(user.tenantId, {
      status: result.ok ? 'connected' : 'error',
      lastCheckAt: new Date().toISOString(),
      latencyMs: result.latencyMs ?? null,
      freeBytes: result.freeBytes ?? undefined,
      totalBytes: result.totalBytes ?? undefined,
      lastError: result.ok ? null : result.error || 'Falha no diagnóstico da conexão.',
    });

    await recordStorageAudit(user.tenantId, user, {
      action: result.ok ? 'STORAGE_CONNECTION_TEST_OK' : 'STORAGE_CONNECTION_TEST_FAILED',
      resourceType: 'vps_connection',
      resourceId: conn.id,
      payload: {
        providerType: conn.provider_type,
        ok: result.ok,
        latencyMs: result.latencyMs,
      },
    });

    return {
      ok: result.ok,
      status: result.ok ? 'connected' : 'error',
      driver: conn.provider_type,
      providerType: conn.provider_type,
      latencyMs: result.latencyMs ?? 0,
      freeBytes: result.freeBytes ?? null,
      totalBytes: result.totalBytes ?? null,
      error: result.error || null,
      connection: serializePublicConnection(updated),
    };
  });

  app.post('/api/v1/storage/connection/install-script', async (request) => {
    const user = authenticateStorageUser(request);
    requireGlobalCapability(user, 'cloud:connect');
    const body = request.body && typeof request.body === 'object' ? request.body : {};

    let rootPath = '/srv/nexus-vault';
    if (body.rootPath) {
      const raw = String(body.rootPath);
      if (raw.includes('..') || raw.includes('\\') || raw.includes('\0')) {
        const err = new Error('rootPath inválido.');
        err.statusCode = 400;
        throw err;
      }
      rootPath = normalizeVirtualVaultPath(raw);
    }

    const quotaBytes = Number(body.quotaBytes ?? 53_687_091_200);
    const safeQuota = Number.isFinite(quotaBytes) && quotaBytes > 0 ? Math.trunc(quotaBytes) : 53_687_091_200;
    const port = body.port !== undefined && body.port !== null && body.port !== '' ? Number(body.port) : 9443;
    const rotateToken = body.rotateToken === true;

    const existing = await storageRepo.getConnection(user.tenantId);
    let existingCreds = {};
    if (existing?.encrypted_credentials) {
      try {
        existingCreds = decryptVaultCredentials(existing.encrypted_credentials) || {};
      } catch {
        existingCreds = {};
      }
    }

    const freshToken = `nsn_${crypto.randomBytes(24).toString('hex')}`;
    const hasReusableToken =
      !rotateToken &&
      typeof existingCreds.hmacToken === 'string' &&
      /^[a-zA-Z0-9._-]{12,256}$/.test(existingCreds.hmacToken.trim());
    const activeHmacToken = hasReusableToken ? existingCreds.hmacToken.trim() : freshToken;
    const tokenPrefix = `${activeHmacToken.slice(0, 10)}...`;

    const installCommand = buildAgentInstallScript({
      rootPath,
      quotaBytes: safeQuota,
      hmacToken: activeHmacToken,
      port,
    });

    if (!existing || rotateToken || !existingCreds.hmacToken) {
      await storageRepo.upsertConnection(user.tenantId, {
        providerType: existing && !rotateToken ? existing.provider_type : 'agent_node',
        label: existing?.label || 'Nexus Storage Node 1-Click',
        host: existing?.host || null,
        port: existing?.port ?? port,
        username: existing?.username || null,
        rootPath: existing?.root_path || rootPath,
        endpointUrl: existing?.endpoint_url || null,
        bucket: existing?.bucket || null,
        region: existing?.region || 'us-east-1',
        quotaBytes: existing?.quota_bytes !== undefined ? Number(existing.quota_bytes) : safeQuota,
        encryptedCredentials: encryptVaultCredentials({
          ...existingCreds,
          hmacToken: activeHmacToken,
        }),
        status: existing?.status || 'unconfigured',
        createdByEmail: user.email,
      });
    }

    return {
      ok: true,
      tokenPrefix,
      rotated: !hasReusableToken && Boolean(existingCreds.hmacToken),
      rootPath,
      quotaBytes: safeQuota,
      port,
      script: installCommand,
      command: installCommand,
      installCommand,
    };
  });

  app.post('/api/v1/storage/initialize', async (request, reply) => {
    const user = authenticateStorageUser(request);
    requireGlobalCapability(user, 'cloud:connect');
    const { driver } = await getConfiguredDriverOrThrow(user.tenantId);

    const result = await provisionCorporateVault(user.tenantId, user, driver);

    await recordStorageAudit(user.tenantId, user, {
      action: 'STORAGE_VAULT_INITIALIZED',
      resourceType: 'vps_connection',
      resourceId: result.connection?.id || user.tenantId,
      payload: {
        provisionedCount: result.provisioned.length,
        provisioned: result.provisioned,
      },
    });

    return reply.code(200).send({
      ok: true,
      provisioned: result.provisioned,
      roots: result.roots,
      connection: serializePublicConnection(result.connection),
    });
  });

  app.get('/api/v1/storage/health', async (request) => {
    const user = authenticateStorageUser(request);
    requireGlobalCapability(user, 'cloud:read');
    const conn = await storageRepo.getConnection(user.tenantId);
    if (!conn) {
      return {
        ok: false,
        configured: false,
        status: 'unconfigured',
        latencyMs: 0,
      };
    }

    const driver = resolveStorageDriver(conn);
    const probe = await driver.testConnection();
    const updated = await storageRepo.updateConnectionStatus(user.tenantId, {
      status: probe.ok ? 'connected' : 'error',
      lastCheckAt: new Date().toISOString(),
      latencyMs: probe.latencyMs ?? 0,
      freeBytes: probe.freeBytes ?? undefined,
      totalBytes: probe.totalBytes ?? undefined,
      lastError: probe.ok ? null : probe.error || 'Falha no healthcheck da VPS.',
    });

    return {
      ok: probe.ok,
      configured: true,
      status: probe.ok ? 'connected' : 'error',
      providerType: conn.provider_type,
      driver: conn.provider_type,
      latencyMs: probe.latencyMs ?? 0,
      freeBytes: probe.freeBytes ?? null,
      totalBytes: probe.totalBytes ?? Number(conn.quota_bytes ?? 0),
      lastCheckAt: updated.last_check_at || new Date().toISOString(),
      lastHealthcheckAt: updated.last_check_at || new Date().toISOString(),
      lastError: updated.last_error || null,
      error: probe.error || null,
    };
  });

  app.get('/api/v1/storage/quota', async (request) => {
    const user = authenticateStorageUser(request);
    requireGlobalCapability(user, 'cloud:read');
    const summary = await storageRepo.getQuotaSummary(user.tenantId);
    return summary;
  });

  // ---------------------------------------------------------------------------
  // 2. EXPLORADOR VFS (PASTAS, NÓS, UPLOAD, DOWNLOAD, PREVIEW, ZIP, VERSÕES, LOCKS)
  // ---------------------------------------------------------------------------
  app.get('/api/v1/storage/nodes', async (request, reply) => {
    const user = authenticateStorageUser(request);
    requireGlobalCapability(user, 'cloud:read');

    const { parentId, q } = request.query || {};
    const { allActive, nodesMap, aclsByNodeId } = await buildTenantAccessContext(user.tenantId);

    if (parentId !== undefined && parentId !== null && parentId !== '' && parentId !== 'null') {
      const parentNode = nodesMap.get(String(parentId));
      if (!parentNode) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Pasta pai não encontrada.' });
      }
      const parentAccess = await resolveEffectiveNodeAccess(user.tenantId, user, parentNode, {
        nodesMap,
        aclsByNodeId,
      });
      if (!canAccessLevelPerform(parentAccess, 'view_list', { user, node: parentNode })) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Sem permissão para listar esta pasta.' });
      }
    }

    let candidates;
    if (q !== undefined && String(q).trim() !== '') {
      const needle = String(q).trim().toLowerCase();
      candidates = allActive.filter(
        (n) =>
          String(n.name || '').toLowerCase().includes(needle) ||
          String(n.virtual_path || '').toLowerCase().includes(needle),
      );
    } else if (parentId !== undefined && parentId !== '' && parentId !== 'null') {
      candidates = allActive.filter((n) => String(n.parent_id || '') === String(parentId));
    } else if (parentId === 'null' || parentId === '') {
      candidates = allActive.filter((n) => !n.parent_id);
    } else {
      // No parentId query param: return all accessible nodes so both root browsers and path finders work
      candidates = allActive;
    }

    const visibleItems = [];
    for (const node of candidates) {
      const eff = await resolveEffectiveNodeAccess(user.tenantId, user, node, {
        nodesMap,
        aclsByNodeId,
      });
      if (canAccessLevelPerform(eff, 'view_list', { user, node })) {
        visibleItems.push(serializeNode(node, eff));
      }
    }

    return {
      tenantId: user.tenantId,
      total: visibleItems.length,
      items: visibleItems,
      nodes: visibleItems,
    };
  });

  app.post('/api/v1/storage/folders', async (request, reply) => {
    const user = authenticateStorageUser(request);
    requireGlobalCapability(user, 'cloud:write');

    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const cleanName = validateSafeSingleName(body.name, 'Nome da pasta');
    const parentId = body.parentId || null;

    let parentNode = null;
    if (parentId) {
      parentNode = await storageRepo.getNodeById(user.tenantId, parentId);
      if (!parentNode || parentNode.is_trashed) {
        return reply.code(404).send({ error: 'PARENT_NOT_FOUND', message: 'Pasta pai não encontrada.' });
      }
      if ((parentNode.node_type || parentNode.nodeType) !== 'folder') {
        return reply.code(400).send({ error: 'INVALID_PARENT_TYPE', message: 'O nó pai precisa ser uma pasta.' });
      }
    }

    const parentAccess = await resolveEffectiveNodeAccess(user.tenantId, user, parentNode);
    if (!canAccessLevelPerform(parentAccess, 'create', { user, node: parentNode })) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Sem permissão de escrita nesta pasta.' });
    }

    const parentPath = parentNode ? parentNode.virtual_path : '/';
    const virtualPath = normalizeVirtualVaultPath(
      parentPath === '/' ? `/${cleanName}` : `${parentPath}/${cleanName}`,
    );

    const existingAtPath = await storageRepo.getNodeByPath(user.tenantId, virtualPath);
    if (existingAtPath) {
      const isExistingFolder = (existingAtPath.node_type || existingAtPath.nodeType) === 'folder';
      if (
        isExistingFolder &&
        (Boolean(body.ensure) || parentPath === '/Setores' || parentPath === '/Espaco-Pessoal')
      ) {
        const existingAccess = await resolveEffectiveNodeAccess(user.tenantId, user, existingAtPath);
        if (Boolean(body.ensure) && !canAccessLevelPerform(existingAccess, 'write', { user, node: existingAtPath })) {
          return reply.code(403).send({
            error: 'FORBIDDEN',
            message: `Sem permissão de escrita na pasta existente "${cleanName}".`,
          });
        }
        const serializedExisting = serializeNode(existingAtPath, existingAccess || 'full_control');
        return reply.code(200).send({
          node: serializedExisting,
          folder: serializedExisting,
          existed: true,
          ...serializedExisting,
        });
      }
      return reply.code(409).send({
        error: 'PATH_ALREADY_EXISTS',
        message: `Já existe um item ativo em ${virtualPath}.`,
      });
    }

    const { conn, driver } = await getConfiguredDriverOrThrow(user.tenantId);
    resolveSafeVaultPath(conn.root_path || '/', virtualPath);
    await driver.mkdir(virtualPath);

    const departmentScope =
      body.departmentScope !== undefined
        ? sanitizeText(body.departmentScope, 120)
        : parentNode?.department_scope || (parentPath === '/Setores' ? cleanName : null);

    const created = await storageRepo.createNode(user.tenantId, {
      parentId: parentNode ? parentNode.id : null,
      name: cleanName,
      virtualPath,
      storageKey: virtualPath,
      nodeType: 'folder',
      mimeType: 'inode/directory',
      sizeBytes: 0,
      departmentScope,
      createdByEmail: user.email,
    });

    if (parentPath === '/Setores' && departmentScope) {
      await storageRepo.upsertNodeAcl(user.tenantId, created.id, {
        targetType: 'department',
        targetValue: departmentScope,
        accessLevel: 'editor',
        grantedByEmail: user.email,
      });
    } else if (parentPath === '/Espaco-Pessoal' && cleanName.includes('@')) {
      await storageRepo.upsertNodeAcl(user.tenantId, created.id, {
        targetType: 'user',
        targetValue: cleanName.toLowerCase(),
        accessLevel: 'full_control',
        grantedByEmail: user.email,
      });
    }

    await recordStorageAudit(user.tenantId, user, {
      action: 'STORAGE_FOLDER_CREATED',
      resourceType: 'storage_node',
      resourceId: created.id,
      payload: { name: created.name, virtualPath: created.virtual_path },
    });

    const serialized = serializeNode(created, 'full_control');
    return reply.code(201).send({
      node: serialized,
      folder: serialized,
      existed: false,
      ...serialized,
    });
  });

  app.post('/api/v1/storage/upload', async (request, reply) => {
    const user = authenticateStorageUser(request);
    requireGlobalCapability(user, 'cloud:write');

    const ct = String(request.headers['content-type'] || '').toLowerCase();
    let parentId = request.query?.parentId || null;
    let fileName = request.query?.fileName || null;
    let conflictPolicy = request.query?.conflictPolicy || 'version';
    let mimeType = request.query?.mimeType || 'application/octet-stream';
    let fileBuffer = null;

    if (ct.includes('multipart/form-data')) {
      const rawBuf = Buffer.isBuffer(request.body)
        ? request.body
        : Buffer.from(String(request.body || ''), 'binary');
      const { fields, filePart } = parseMultipartFormBuffer(rawBuf, request.headers['content-type']);
      if (fields.parentId !== undefined && fields.parentId !== '' && fields.parentId !== 'null') {
        parentId = fields.parentId;
      }
      if (fields.fileName) fileName = fields.fileName;
      if (fields.conflictPolicy) conflictPolicy = fields.conflictPolicy;
      if (!filePart) {
        return reply.code(400).send({ error: 'MISSING_FILE', message: 'Nenhum arquivo enviado no formulário.' });
      }
      if (!fileName) fileName = filePart.filename;
      mimeType = filePart.mimeType || mimeType;
      fileBuffer = filePart.buffer;
    } else if (Buffer.isBuffer(request.body)) {
      fileBuffer = request.body;
    } else if (request.body && typeof request.body === 'object' && request.body.contentBase64) {
      parentId = request.body.parentId ?? parentId;
      fileName = request.body.fileName ?? fileName;
      conflictPolicy = request.body.conflictPolicy ?? conflictPolicy;
      mimeType = request.body.mimeType ?? mimeType;
      fileBuffer = Buffer.from(String(request.body.contentBase64), 'base64');
    } else if (typeof request.body === 'string') {
      fileBuffer = Buffer.from(request.body, 'utf8');
    } else {
      return reply.code(400).send({ error: 'INVALID_UPLOAD_BODY', message: 'Payload de upload inválido.' });
    }

    const cleanFileName = validateSafeSingleName(fileName, 'Nome do arquivo');
    const resolvedMime = inferMimeType(cleanFileName, mimeType);
    assertAllowedFileType(cleanFileName, resolvedMime);

    let parentNode = null;
    if (parentId && parentId !== 'null' && parentId !== 'undefined') {
      parentNode = await storageRepo.getNodeById(user.tenantId, parentId);
      if (!parentNode || parentNode.is_trashed) {
        return reply.code(404).send({ error: 'PARENT_NOT_FOUND', message: 'Pasta de destino não encontrada.' });
      }
      if ((parentNode.node_type || parentNode.nodeType) !== 'folder') {
        return reply.code(400).send({ error: 'INVALID_PARENT', message: 'O destino precisa ser uma pasta.' });
      }
    }

    const parentAccess = await resolveEffectiveNodeAccess(user.tenantId, user, parentNode);
    if (!canAccessLevelPerform(parentAccess, 'write', { user, node: parentNode })) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Sem permissão de upload nesta pasta.' });
    }

    const { conn, driver } = await getConfiguredDriverOrThrow(user.tenantId);

    const parentPath = parentNode ? parentNode.virtual_path : '/';
    let targetName = cleanFileName;
    let targetVirtualPath = normalizeVirtualVaultPath(
      parentPath === '/' ? `/${targetName}` : `${parentPath}/${targetName}`,
    );
    resolveSafeVaultPath(conn.root_path || '/', targetVirtualPath);

    const sha256Hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    const allTenantNodes = await storageRepo.listNodes(user.tenantId, { includeTrashed: false });
    const duplicateMatch = allTenantNodes.find(
      (n) => n.sha256_hash === sha256Hash && n.virtual_path !== targetVirtualPath,
    );

    const existingNode = await storageRepo.getNodeByPath(user.tenantId, targetVirtualPath);
    const policy = String(conflictPolicy || 'version').toLowerCase();

    if (existingNode && policy === 'reject') {
      return reply.code(409).send({
        error: 'PATH_ALREADY_EXISTS',
        message: `O arquivo '${cleanFileName}' já existe nesta pasta.`,
      });
    }

    if (existingNode && policy === 'rename') {
      const ext = path.posix.extname(cleanFileName);
      const base = ext ? cleanFileName.slice(0, -ext.length) : cleanFileName;
      let counter = 1;
      while (counter < 1000) {
        const candidateName = `${base} (${counter})${ext}`;
        const candidatePath = normalizeVirtualVaultPath(
          parentPath === '/' ? `/${candidateName}` : `${parentPath}/${candidateName}`,
        );
        const collision = await storageRepo.getNodeByPath(user.tenantId, candidatePath);
        if (!collision) {
          targetName = candidateName;
          targetVirtualPath = candidatePath;
          break;
        }
        counter += 1;
      }
    }

    // Versioning overwrite flow
    if (existingNode && policy === 'version') {
      assertNodeNotLockedByAnother(existingNode, user);
      const oldSize = Number(existingNode.size_bytes ?? 0);
      const deltaBytes = fileBuffer.length - oldSize;
      if (deltaBytes > 0) {
        await storageRepo.reserveQuota(user.tenantId, deltaBytes);
      }

      const nextVer = Number(existingNode.current_version ?? 1) + 1;
      const versionKey = `/.nexus_versions/${existingNode.id}/v${nextVer}_${existingNode.name}`;
      try {
        await driver.writeFile(existingNode.storage_key || existingNode.virtual_path, fileBuffer);
        await driver.writeFile(versionKey, fileBuffer);
      } catch (writeErr) {
        if (deltaBytes > 0) await storageRepo.releaseQuota(user.tenantId, deltaBytes);
        throw writeErr;
      }

      if (deltaBytes < 0) {
        await storageRepo.releaseQuota(user.tenantId, Math.abs(deltaBytes));
      }

      await storageRepo.createVersion(user.tenantId, existingNode.id, {
        storageKey: versionKey,
        sizeBytes: fileBuffer.length,
        sha256Hash,
        uploadedByEmail: user.email,
      });

      // Enforce 10-version retention cap
      const allVers = await storageRepo.listVersions(user.tenantId, existingNode.id);
      if (allVers.length > 10) {
        for (const oldVer of allVers.slice(10)) {
          if (oldVer.storage_key) {
            try {
              await driver.remove(oldVer.storage_key, { recursive: false });
            } catch {
              /* ignore */
            }
          }
        }
      }

      const updatedNode = await storageRepo.updateNode(user.tenantId, existingNode.id, {
        sizeBytes: fileBuffer.length,
        sha256Hash,
        mimeType: resolvedMime,
        currentVersion: nextVer,
      });

      // If spreadsheet, also sync sheet_sessions
      const lowerName = existingNode.name.toLowerCase();
      if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.csv') || lowerName.endsWith('.nexusheet')) {
        try {
          const tabs = parseBinaryToWorkbookTabs(fileBuffer, existingNode.name);
          await storageRepo.upsertSheetSession(user.tenantId, existingNode.id, {
            workbookJson: { sheets: tabs, tabs },
            lastSavedByEmail: user.email,
            force: true,
          });
        } catch {
          /* ignore corrupt sheet on raw binary upload */
        }
      }

      await recordStorageAudit(user.tenantId, user, {
        action: 'STORAGE_FILE_VERSIONED',
        resourceType: 'storage_node',
        resourceId: existingNode.id,
        payload: {
          name: existingNode.name,
          version: nextVer,
          sizeBytes: fileBuffer.length,
          sha256Hash,
        },
      });

      const serialized = serializeNode(updatedNode, 'editor');
      return reply.code(200).send({
        node: serialized,
        file: serialized,
        version: nextVer,
        isDuplicate: Boolean(duplicateMatch),
        duplicateOf: duplicateMatch?.id || null,
        ...serialized,
      });
    }

    // New file creation flow
    await storageRepo.reserveQuota(user.tenantId, fileBuffer.length);
    const nodeType = /\.(xlsx|csv|nexusheet)$/i.test(targetName) ? 'spreadsheet' : 'file';

    try {
      await driver.writeFile(targetVirtualPath, fileBuffer);
    } catch (writeErr) {
      await storageRepo.releaseQuota(user.tenantId, fileBuffer.length);
      throw writeErr;
    }

    let createdNode;
    try {
      createdNode = await storageRepo.createNode(user.tenantId, {
        parentId: parentNode ? parentNode.id : null,
        name: targetName,
        virtualPath: targetVirtualPath,
        storageKey: targetVirtualPath,
        nodeType,
        mimeType: resolvedMime,
        sizeBytes: fileBuffer.length,
        sha256Hash,
        currentVersion: 1,
        departmentScope: parentNode?.department_scope || null,
        createdByEmail: user.email,
      });
    } catch (dbErr) {
      await storageRepo.releaseQuota(user.tenantId, fileBuffer.length);
      throw dbErr;
    }

    const v1Key = `/.nexus_versions/${createdNode.id}/v1_${createdNode.name}`;
    try {
      await driver.writeFile(v1Key, fileBuffer);
    } catch {
      /* optional snapshot copy */
    }
    await storageRepo.createVersion(user.tenantId, createdNode.id, {
      storageKey: v1Key,
      sizeBytes: fileBuffer.length,
      sha256Hash,
      uploadedByEmail: user.email,
    });

    const lowerCreatedName = createdNode.name.toLowerCase();
    if (
      lowerCreatedName.endsWith('.xlsx') ||
      lowerCreatedName.endsWith('.csv') ||
      lowerCreatedName.endsWith('.nexusheet')
    ) {
      try {
        const tabs = parseBinaryToWorkbookTabs(fileBuffer, createdNode.name);
        await storageRepo.upsertSheetSession(user.tenantId, createdNode.id, {
          workbookJson: { sheets: tabs, tabs },
          lastSavedByEmail: user.email,
          force: true,
        });
      } catch {
        /* corrupt spreadsheet binary will fail on GET /sheets/:id with 422 */
      }
    }

    await recordStorageAudit(user.tenantId, user, {
      action: 'STORAGE_FILE_UPLOADED',
      resourceType: 'storage_node',
      resourceId: createdNode.id,
      payload: {
        name: createdNode.name,
        virtualPath: createdNode.virtual_path,
        sizeBytes: fileBuffer.length,
        sha256Hash,
      },
    });

    const serialized = serializeNode(createdNode, 'full_control');
    return reply.code(201).send({
      node: serialized,
      file: serialized,
      version: 1,
      isDuplicate: Boolean(duplicateMatch),
      duplicateOf: duplicateMatch?.id || null,
      ...serialized,
    });
  });

  app.get('/api/v1/storage/nodes/:id/download', async (request, reply) => {
    const user = authenticateStorageUser(request);
    requireGlobalCapability(user, 'cloud:read');

    const node = await storageRepo.getNodeById(user.tenantId, request.params.id);
    if (!node || node.is_trashed) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Arquivo não encontrado.' });
    }
    if ((node.node_type || node.nodeType) === 'folder') {
      return reply.code(400).send({ error: 'CANNOT_DOWNLOAD_FOLDER', message: 'Use /download-zip para pastas.' });
    }

    const access = await resolveEffectiveNodeAccess(user.tenantId, user, node);
    if (!canAccessLevelPerform(access, 'download', { user, node })) {
      return reply.code(403).send({
        error: 'FORBIDDEN',
        message: 'Seu nível de permissão (viewer_online/none) não permite download local deste arquivo.',
      });
    }

    const { driver } = await getConfiguredDriverOrThrow(user.tenantId);
    const readRes = await driver.readFile(node.storage_key || node.virtual_path);

    reply.code(200);
    reply.header('content-type', node.mime_type || 'application/octet-stream');
    reply.header(
      'content-disposition',
      `attachment; filename="${encodeURIComponent(node.name)}"; filename*=UTF-8''${encodeURIComponent(node.name)}`,
    );
    reply.header('x-content-type-options', 'nosniff');
    return reply.send(readRes.buffer);
  });

  app.get('/api/v1/storage/nodes/:id/preview', async (request, reply) => {
    const user = authenticateStorageUser(request);
    requireGlobalCapability(user, 'cloud:read');

    const node = await storageRepo.getNodeById(user.tenantId, request.params.id, { includeTrashed: true });
    if (!node) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Arquivo não encontrado.' });
    }
    if (node.is_trashed) {
      return reply.code(410).send({ error: 'NODE_TRASHED', message: 'Arquivo está na lixeira.' });
    }
    if ((node.node_type || node.nodeType) === 'folder') {
      return reply.code(400).send({ error: 'CANNOT_PREVIEW_FOLDER', message: 'Pastas não possuem preview inline.' });
    }

    const access = await resolveEffectiveNodeAccess(user.tenantId, user, node);
    if (!canAccessLevelPerform(access, 'preview', { user, node })) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Sem permissão para visualizar este arquivo.' });
    }

    const { driver } = await getConfiguredDriverOrThrow(user.tenantId);
    const rangeHeader = request.headers.range || request.headers.Range || undefined;
    const readRes = await driver.readFile(node.storage_key || node.virtual_path, { rangeHeader });

    let contentType = node.mime_type || inferMimeType(node.name);
    const lowerMime = String(contentType).toLowerCase();
    const lowerName = String(node.name || '').toLowerCase();
    const isPotentiallyActive =
      lowerMime.includes('text/html') ||
      lowerMime.includes('image/svg') ||
      lowerName.endsWith('.html') ||
      lowerName.endsWith('.htm') ||
      lowerName.endsWith('.svg');

    if (isPotentiallyActive) {
      contentType = 'text/plain; charset=utf-8';
      reply.header('content-security-policy', "sandbox; default-src 'none'; script-src 'none'");
    }

    if (rangeHeader && readRes.status === 200) {
      const parsed = parseHttpByteRange(rangeHeader, readRes.buffer.length);
      if (!parsed.valid) {
        return reply.code(416).send({ error: 'RANGE_NOT_SATISFIABLE', message: 'Intervalo de bytes inválido.' });
      }
      const slice = readRes.buffer.subarray(parsed.start, parsed.end + 1);
      reply.code(206);
      reply.header('content-range', `bytes ${parsed.start}-${parsed.end}/${readRes.buffer.length}`);
      reply.header('accept-ranges', 'bytes');
      reply.header('content-type', contentType);
      reply.header('content-disposition', `inline; filename="${encodeURIComponent(node.name)}"`);
      reply.header('cache-control', 'no-store, no-cache, must-revalidate');
      reply.header('x-content-type-options', 'nosniff');
      return reply.send(slice);
    }

    reply.code(readRes.status || 200);
    if (readRes.contentRange) {
      reply.header('content-range', readRes.contentRange);
    }
    reply.header('accept-ranges', 'bytes');
    reply.header('content-type', contentType);
    reply.header('content-disposition', `inline; filename="${encodeURIComponent(node.name)}"`);
    reply.header('cache-control', 'no-store, no-cache, must-revalidate');
    reply.header('x-content-type-options', 'nosniff');
    return reply.send(readRes.buffer);
  });

  app.post('/api/v1/storage/nodes/download-zip', async (request, reply) => {
    const user = authenticateStorageUser(request);
    requireGlobalCapability(user, 'cloud:read');

    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const nodeIds = Array.isArray(body.nodeIds) ? body.nodeIds : [];
    if (nodeIds.length === 0) {
      return reply.code(400).send({ error: 'EMPTY_NODE_LIST', message: 'Informe nodeIds para compactação ZIP.' });
    }

    const { allActive, nodesMap, aclsByNodeId } = await buildTenantAccessContext(user.tenantId);
    const resolvedNodes = [];

    for (const id of nodeIds) {
      const node = nodesMap.get(String(id));
      if (!node || node.is_trashed) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: `Nó ${id} não encontrado.` });
      }
      const access = await resolveEffectiveNodeAccess(user.tenantId, user, node, { nodesMap, aclsByNodeId });
      if (!canAccessLevelPerform(access, 'download', { user, node })) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: `Sem permissão de download para ${node.name}.` });
      }
      resolvedNodes.push(node);
    }

    const { driver } = await getConfiguredDriverOrThrow(user.tenantId);
    const zipEntries = [];

    for (const node of resolvedNodes) {
      if ((node.node_type || node.nodeType) === 'folder') {
        const prefix = `${node.virtual_path}/`;
        const descendants = allActive.filter(
          (c) => (c.node_type || c.nodeType) !== 'folder' && String(c.virtual_path || '').startsWith(prefix),
        );
        for (const child of descendants) {
          const childAccess = await resolveEffectiveNodeAccess(user.tenantId, user, child, { nodesMap, aclsByNodeId });
          if (!canAccessLevelPerform(childAccess, 'download', { user, node: child })) continue;
          const relName = `${node.name}/${child.virtual_path.slice(prefix.length)}`;
          const readRes = await driver.readFile(child.storage_key || child.virtual_path);
          zipEntries.push({ name: relName, buffer: readRes.buffer });
        }
      } else {
        const readRes = await driver.readFile(node.storage_key || node.virtual_path);
        zipEntries.push({ name: node.name, buffer: readRes.buffer });
      }
    }

    const zipBuf = buildZipArchive(zipEntries);
    reply.code(200);
    reply.header('content-type', 'application/zip');
    reply.header('content-disposition', 'attachment; filename="nexus-vault-bundle.zip"');
    return reply.send(zipBuf);
  });

  // ---------------------------------------------------------------------------
  // 4.5 DESCOMPACTAÇÃO SEGURA NA VPS (ZIP, RAR, TAR, TAR.GZ / TGZ)
  // ---------------------------------------------------------------------------
  app.post('/api/v1/storage/nodes/:id/extract', async (request, reply) => {
    const user = authenticateStorageUser(request);
    requireGlobalCapability(user, 'cloud:write');

    const archiveNode = await storageRepo.getNodeById(user.tenantId, request.params.id);
    if (!archiveNode || archiveNode.is_trashed) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Arquivo compactado não encontrado.' });
    }
    if ((archiveNode.node_type || archiveNode.nodeType) === 'folder') {
      return reply.code(400).send({ error: 'NOT_AN_ARCHIVE', message: 'Selecione um arquivo compactado (.zip, .rar, .tar, .tar.gz) para descompactar.' });
    }
    if (!isSupportedArchiveName(archiveNode.name)) {
      return reply.code(415).send({
        error: 'UNSUPPORTED_ARCHIVE_FORMAT',
        message: 'Formato não suportado para descompactação. Formatos aceitos: .zip, .rar, .tar, .tar.gz e .tgz.',
      });
    }

    const archiveAccess = await resolveEffectiveNodeAccess(user.tenantId, user, archiveNode);
    if (!canAccessLevelPerform(archiveAccess, 'download', { user, node: archiveNode })) {
      return reply.code(403).send({
        error: 'FORBIDDEN',
        message: 'Sem permissão para ler/descompactar este arquivo.',
      });
    }

    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const mode = String(body.mode || 'subfolder').toLowerCase() === 'here' ? 'here' : 'subfolder';
    const conflictPolicy = ['rename', 'version', 'skip'].includes(String(body.conflictPolicy || '').toLowerCase())
      ? String(body.conflictPolicy).toLowerCase()
      : 'rename';
    const password = body.password ? String(body.password) : undefined;

    const baseParentId = body.targetParentId !== undefined ? body.targetParentId || null : archiveNode.parent_id || null;
    let baseParentNode = null;
    if (baseParentId) {
      baseParentNode = await storageRepo.getNodeById(user.tenantId, baseParentId);
      if (!baseParentNode || baseParentNode.is_trashed || (baseParentNode.node_type || baseParentNode.nodeType) !== 'folder') {
        return reply.code(404).send({ error: 'PARENT_NOT_FOUND', message: 'Pasta de destino não encontrada.' });
      }
    }

    const destAccess = await resolveEffectiveNodeAccess(user.tenantId, user, baseParentNode);
    if (!canAccessLevelPerform(destAccess, 'write', { user, node: baseParentNode })) {
      return reply.code(403).send({
        error: 'FORBIDDEN',
        message: 'Sem permissão de escrita na pasta de destino para descompactar arquivos.',
      });
    }

    const { conn, driver } = await getConfiguredDriverOrThrow(user.tenantId);
    const readRes = await driver.readFile(archiveNode.storage_key || archiveNode.virtual_path);
    const extracted = await extractArchiveBuffer(readRes.buffer, archiveNode.name, { password });

    if (extracted.files.length === 0 && extracted.directories.length === 0) {
      return reply.code(400).send({
        error: 'EMPTY_ARCHIVE',
        message:
          extracted.blockedExecutables.length > 0
            ? `Nenhum arquivo seguro encontrado (${extracted.blockedExecutables.length} executável(is) bloqueado(s) por segurança).`
            : 'O arquivo compactado está vazio.',
      });
    }

    const ensureFolderAt = async (parentNodeObj, folderName) => {
      const cleanName = validateSafeSingleName(folderName, 'Nome da pasta');
      const pPath = parentNodeObj ? parentNodeObj.virtual_path : '/';
      const vPath = normalizeVirtualVaultPath(pPath === '/' ? `/${cleanName}` : `${pPath}/${cleanName}`);
      resolveSafeVaultPath(conn.root_path || '/', vPath);

      const existing = await storageRepo.getNodeByPath(user.tenantId, vPath);
      if (existing && (existing.node_type || existing.nodeType) === 'folder') {
        return { node: existing, created: false };
      }

      let finalName = cleanName;
      let finalPath = vPath;
      if (existing) {
        let idx = 1;
        while (idx < 1000) {
          const cand = `${cleanName} (${idx})`;
          const candPath = normalizeVirtualVaultPath(pPath === '/' ? `/${cand}` : `${pPath}/${cand}`);
          const hit = await storageRepo.getNodeByPath(user.tenantId, candPath);
          if (!hit) {
            finalName = cand;
            finalPath = candPath;
            break;
          }
          idx += 1;
        }
      }

      await driver.mkdir(finalPath);
      const created = await storageRepo.createNode(user.tenantId, {
        parentId: parentNodeObj ? parentNodeObj.id : null,
        name: finalName,
        virtualPath: finalPath,
        storageKey: finalPath,
        nodeType: 'folder',
        mimeType: 'inode/directory',
        sizeBytes: 0,
        departmentScope: parentNodeObj?.department_scope || null,
        createdByEmail: user.email,
      });
      return { node: created, created: true };
    };

    let extractionRootNode = baseParentNode;
    let extractedFoldersCount = 0;
    const createdNodes = [];

    if (mode === 'subfolder') {
      const desiredRootName = body.folderName
        ? validateSafeSingleName(body.folderName, 'Nome da pasta de destino')
        : stripArchiveExtension(archiveNode.name);
      const { node: rootFolder, created } = await ensureFolderAt(baseParentNode, desiredRootName);
      extractionRootNode = rootFolder;
      if (created) {
        extractedFoldersCount += 1;
        createdNodes.push(serializeNode(rootFolder, destAccess));
      }
    }

    // Cria hierarquia de subpastas em ordem de profundidade
    const dirMap = new Map();
    dirMap.set('', extractionRootNode);

    for (const relDir of extracted.directories) {
      const segments = relDir.split('/').filter(Boolean);
      let cursorPath = '';
      let cursorNode = extractionRootNode;
      for (const seg of segments) {
        const nextPath = cursorPath ? `${cursorPath}/${seg}` : seg;
        if (dirMap.has(nextPath)) {
          cursorNode = dirMap.get(nextPath);
        } else {
          const { node: subFolder, created } = await ensureFolderAt(cursorNode, seg);
          dirMap.set(nextPath, subFolder);
          cursorNode = subFolder;
          if (created) {
            extractedFoldersCount += 1;
            createdNodes.push(serializeNode(subFolder, destAccess));
          }
        }
        cursorPath = nextPath;
      }
    }

    // Grava os arquivos extraídos na VPS respeitando cota e política de conflito
    let extractedFilesCount = 0;
    const skippedFiles = [...extracted.skipped];

    for (const entry of extracted.files) {
      const parentForFile = dirMap.get(entry.dirPath || '') || extractionRootNode;
      const pPath = parentForFile ? parentForFile.virtual_path : '/';
      const cleanFileName = validateSafeSingleName(entry.fileName, 'Nome do arquivo extraído');
      const resolvedMime = inferMimeType(cleanFileName, 'application/octet-stream');
      assertAllowedFileType(cleanFileName, resolvedMime);

      let targetName = cleanFileName;
      let targetPath = normalizeVirtualVaultPath(pPath === '/' ? `/${targetName}` : `${pPath}/${targetName}`);
      resolveSafeVaultPath(conn.root_path || '/', targetPath);

      const existing = await storageRepo.getNodeByPath(user.tenantId, targetPath);
      if (existing && conflictPolicy === 'skip') {
        skippedFiles.push(entry.relativePath);
        continue;
      }

      if (existing && conflictPolicy === 'rename') {
        const ext = path.posix.extname(cleanFileName);
        const base = ext ? cleanFileName.slice(0, -ext.length) : cleanFileName;
        let counter = 1;
        while (counter < 1000) {
          const candName = `${base} (${counter})${ext}`;
          const candPath = normalizeVirtualVaultPath(pPath === '/' ? `/${candName}` : `${pPath}/${candName}`);
          const hit = await storageRepo.getNodeByPath(user.tenantId, candPath);
          if (!hit) {
            targetName = candName;
            targetPath = candPath;
            break;
          }
          counter += 1;
        }
      }

      const sha256Hash = crypto.createHash('sha256').update(entry.buffer).digest('hex');

      if (existing && conflictPolicy === 'version' && (existing.node_type || existing.nodeType) !== 'folder') {
        assertNodeNotLockedByAnother(existing, user);
        const oldSize = Number(existing.size_bytes ?? 0);
        const deltaBytes = entry.buffer.length - oldSize;
        if (deltaBytes > 0) await storageRepo.reserveQuota(user.tenantId, deltaBytes);
        const nextVer = Number(existing.current_version ?? 1) + 1;
        const verKey = `/.nexus_versions/${existing.id}/v${nextVer}_${existing.name}`;
        try {
          await driver.writeFile(existing.storage_key || existing.virtual_path, entry.buffer);
          await driver.writeFile(verKey, entry.buffer);
        } catch (err) {
          if (deltaBytes > 0) await storageRepo.releaseQuota(user.tenantId, deltaBytes);
          throw err;
        }
        if (deltaBytes < 0) await storageRepo.releaseQuota(user.tenantId, Math.abs(deltaBytes));
        await storageRepo.createVersion(user.tenantId, existing.id, {
          storageKey: verKey,
          sizeBytes: entry.buffer.length,
          sha256Hash,
          uploadedByEmail: user.email,
        });
        const updated = await storageRepo.updateNode(user.tenantId, existing.id, {
          sizeBytes: entry.buffer.length,
          sha256Hash,
          mimeType: resolvedMime,
          currentVersion: nextVer,
        });
        createdNodes.push(serializeNode(updated, destAccess));
        extractedFilesCount += 1;
        continue;
      }

      await storageRepo.reserveQuota(user.tenantId, entry.buffer.length);
      const nodeType = /\.(xlsx|csv|nexusheet)$/i.test(targetName) ? 'spreadsheet' : 'file';
      try {
        await driver.writeFile(targetPath, entry.buffer);
      } catch (err) {
        await storageRepo.releaseQuota(user.tenantId, entry.buffer.length);
        throw err;
      }

      let createdFile;
      try {
        createdFile = await storageRepo.createNode(user.tenantId, {
          parentId: parentForFile ? parentForFile.id : null,
          name: targetName,
          virtualPath: targetPath,
          storageKey: targetPath,
          nodeType,
          mimeType: resolvedMime,
          sizeBytes: entry.buffer.length,
          sha256Hash,
          currentVersion: 1,
          departmentScope: parentForFile?.department_scope || null,
          createdByEmail: user.email,
        });
      } catch (dbErr) {
        await storageRepo.releaseQuota(user.tenantId, entry.buffer.length);
        throw dbErr;
      }

      const v1Key = `/.nexus_versions/${createdFile.id}/v1_${createdFile.name}`;
      try {
        await driver.writeFile(v1Key, entry.buffer);
      } catch {
        /* snapshot opcional */
      }
      await storageRepo.createVersion(user.tenantId, createdFile.id, {
        storageKey: v1Key,
        sizeBytes: entry.buffer.length,
        sha256Hash,
        uploadedByEmail: user.email,
      });

      if (nodeType === 'spreadsheet') {
        try {
          const tabs = parseBinaryToWorkbookTabs(entry.buffer, createdFile.name);
          await storageRepo.upsertSheetSession(user.tenantId, createdFile.id, {
            workbookJson: { sheets: tabs, tabs },
            lastSavedByEmail: user.email,
            force: true,
          });
        } catch {
          /* planilha corrompida ignorada na extração */
        }
      }

      createdNodes.push(serializeNode(createdFile, destAccess));
      extractedFilesCount += 1;
    }

    await recordStorageAudit(user.tenantId, user, {
      action: 'STORAGE_ARCHIVE_EXTRACTED',
      resourceType: 'storage_node',
      resourceId: archiveNode.id,
      payload: {
        archiveName: archiveNode.name,
        mode,
        targetFolderId: extractionRootNode?.id || null,
        targetFolderPath: extractionRootNode?.virtual_path || '/',
        extractedFolders: extractedFoldersCount,
        extractedFiles: extractedFilesCount,
        blockedExecutablesCount: extracted.blockedExecutables.length,
      },
    });

    await emitStorageRealtimeEvent(user.tenantId, 'storage.node.synced', {
      action: 'extract',
      nodeId: archiveNode.id,
      targetFolderId: extractionRootNode?.id || null,
    });

    return reply.code(200).send({
      ok: true,
      format: extracted.format || null,
      archiveName: archiveNode.name,
      targetFolderId: extractionRootNode?.id || null,
      targetFolderName: extractionRootNode?.name || 'Raiz do Cofre',
      targetFolderPath: extractionRootNode?.virtual_path || '/',
      destinationFolder: extractionRootNode
        ? {
            id: extractionRootNode.id,
            name: extractionRootNode.name,
            virtualPath: extractionRootNode.virtual_path || '/',
          }
        : null,
      extractedFolders: extractedFoldersCount,
      foldersCreated: extractedFoldersCount,
      extractedFiles: extractedFilesCount,
      filesExtracted: extractedFilesCount,
      skipped: skippedFiles,
      blockedExecutables: extracted.blockedExecutables,
      nodes: createdNodes,
    });
  });

  app.patch('/api/v1/storage/nodes/:id', async (request, reply) => {
    const user = authenticateStorageUser(request);
    requireGlobalCapability(user, 'cloud:write');

    const node = await storageRepo.getNodeById(user.tenantId, request.params.id);
    if (!node || node.is_trashed) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Nó não encontrado.' });
    }

    assertNodeNotLockedByAnother(node, user);

    const access = await resolveEffectiveNodeAccess(user.tenantId, user, node);
    if (!canAccessLevelPerform(access, 'rename', { user, node })) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Sem permissão para alterar este item.' });
    }

    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const newName = body.name !== undefined ? validateSafeSingleName(body.name, 'Novo nome') : node.name;
    const newParentId = body.parentId !== undefined ? body.parentId : node.parent_id;

    let targetParent = null;
    if (newParentId) {
      if (String(newParentId) === String(node.id)) {
        return reply.code(400).send({ error: 'CYCLE_DETECTED', message: 'Não é possível mover uma pasta para si mesma.' });
      }
      targetParent = await storageRepo.getNodeById(user.tenantId, newParentId);
      if (!targetParent || targetParent.is_trashed) {
        return reply.code(404).send({ error: 'PARENT_NOT_FOUND', message: 'Pasta de destino não encontrada.' });
      }
      if ((targetParent.node_type || targetParent.nodeType) !== 'folder') {
        return reply.code(400).send({ error: 'INVALID_PARENT', message: 'O destino precisa ser uma pasta.' });
      }
      if ((node.node_type || node.nodeType) === 'folder') {
        const descendants = await storageRepo.listDescendants(user.tenantId, node.virtual_path);
        if (descendants.some((d) => String(d.id) === String(newParentId))) {
          return reply.code(400).send({
            error: 'CYCLE_DETECTED',
            message: 'Não é possível mover uma pasta para dentro de sua própria subpasta.',
          });
        }
      }
    }

    const parentPath = targetParent ? targetParent.virtual_path : '/';
    const newVirtualPath = normalizeVirtualVaultPath(
      parentPath === '/' ? `/${newName}` : `${parentPath}/${newName}`,
    );

    if (newVirtualPath !== node.virtual_path) {
      const conflict = await storageRepo.getNodeByPath(user.tenantId, newVirtualPath);
      if (conflict && String(conflict.id) !== String(node.id)) {
        return reply.code(409).send({
          error: 'PATH_ALREADY_EXISTS',
          message: `Já existe um item em ${newVirtualPath}.`,
        });
      }

      const { conn, driver } = await getConfiguredDriverOrThrow(user.tenantId);
      resolveSafeVaultPath(conn.root_path || '/', newVirtualPath);
      await driver.rename(node.storage_key || node.virtual_path, newVirtualPath);
    }

    const updated = await storageRepo.moveNodeSubtree(user.tenantId, node.id, {
      newParentId: targetParent ? targetParent.id : null,
      newName,
      oldPrefix: node.virtual_path,
      newPrefix: newVirtualPath,
      updatedByEmail: user.email,
    });

    await recordStorageAudit(user.tenantId, user, {
      action: 'STORAGE_NODE_MOVED_OR_RENAMED',
      resourceType: 'storage_node',
      resourceId: node.id,
      payload: {
        oldPath: node.virtual_path,
        newPath: newVirtualPath,
        newName,
      },
    });

    const serialized = serializeNode(updated, access);
    return {
      node: serialized,
      ...serialized,
    };
  });

  app.post('/api/v1/storage/nodes/:id/copy', async (request, reply) => {
    const user = authenticateStorageUser(request);
    requireGlobalCapability(user, 'cloud:write');

    const srcNode = await storageRepo.getNodeById(user.tenantId, request.params.id);
    if (!srcNode || srcNode.is_trashed) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Item de origem não encontrado.' });
    }

    const srcAccess = await resolveEffectiveNodeAccess(user.tenantId, user, srcNode);
    if (!canAccessLevelPerform(srcAccess, 'download', { user, node: srcNode })) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Sem permissão para copiar este arquivo.' });
    }

    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const targetParentId = body.targetParentId !== undefined ? body.targetParentId : srcNode.parent_id;
    const copyName = body.name ? validateSafeSingleName(body.name, 'Nome da cópia') : `Cópia de ${srcNode.name}`;

    let targetParent = null;
    if (targetParentId) {
      targetParent = await storageRepo.getNodeById(user.tenantId, targetParentId);
      if (!targetParent || targetParent.is_trashed) {
        return reply.code(404).send({ error: 'PARENT_NOT_FOUND', message: 'Pasta de destino não encontrada.' });
      }
    }

    const dstAccess = await resolveEffectiveNodeAccess(user.tenantId, user, targetParent);
    if (!canAccessLevelPerform(dstAccess, 'write', { user, node: targetParent })) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Sem permissão de escrita na pasta de destino.' });
    }

    const parentPath = targetParent ? targetParent.virtual_path : '/';
    const newVirtualPath = normalizeVirtualVaultPath(
      parentPath === '/' ? `/${copyName}` : `${parentPath}/${copyName}`,
    );

    const existing = await storageRepo.getNodeByPath(user.tenantId, newVirtualPath);
    if (existing) {
      return reply.code(409).send({ error: 'PATH_ALREADY_EXISTS', message: 'Destino já possui arquivo com este nome.' });
    }

    const sizeBytes = Number(srcNode.size_bytes ?? 0);
    await storageRepo.reserveQuota(user.tenantId, sizeBytes);

    const { conn, driver } = await getConfiguredDriverOrThrow(user.tenantId);
    resolveSafeVaultPath(conn.root_path || '/', newVirtualPath);

    try {
      await driver.copy(srcNode.storage_key || srcNode.virtual_path, newVirtualPath);
    } catch (copyErr) {
      await storageRepo.releaseQuota(user.tenantId, sizeBytes);
      throw copyErr;
    }

    const copiedNode = await storageRepo.createNode(user.tenantId, {
      parentId: targetParent ? targetParent.id : null,
      name: copyName,
      virtualPath: newVirtualPath,
      storageKey: newVirtualPath,
      nodeType: srcNode.node_type || 'file',
      mimeType: srcNode.mime_type,
      sizeBytes,
      sha256Hash: srcNode.sha256_hash,
      currentVersion: 1,
      departmentScope: targetParent?.department_scope || srcNode.department_scope || null,
      createdByEmail: user.email,
    });

    await recordStorageAudit(user.tenantId, user, {
      action: 'STORAGE_NODE_COPIED',
      resourceType: 'storage_node',
      resourceId: copiedNode.id,
      payload: { sourceId: srcNode.id, newVirtualPath, sizeBytes },
    });

    const serialized = serializeNode(copiedNode, dstAccess);
    return reply.code(201).send({
      node: serialized,
      ...serialized,
    });
  });

  app.delete('/api/v1/storage/nodes/:id', async (request, reply) => {
    const user = authenticateStorageUser(request);
    requireGlobalCapability(user, 'cloud:write');

    const node = await storageRepo.getNodeById(user.tenantId, request.params.id);
    if (!node || node.is_trashed) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Item não encontrado.' });
    }

    assertNodeNotLockedByAnother(node, user);

    const access = await resolveEffectiveNodeAccess(user.tenantId, user, node);
    if (!canAccessLevelPerform(access, 'delete', { user, node })) {
      return reply.code(403).send({
        error: 'FORBIDDEN',
        message: 'Sem permissão para excluir este item (editores só podem excluir arquivos próprios).',
      });
    }

    const { driver } = await getConfiguredDriverOrThrow(user.tenantId);
    const trashStorageKey = `/.nexus_trash/${node.id}_${node.name}`;
    try {
      await driver.mkdir('/.nexus_trash');
      await driver.rename(node.storage_key || node.virtual_path, trashStorageKey);
    } catch {
      /* keep logical soft-delete even if physical rename is simulated */
    }

    const trashed = await storageRepo.trashNode(user.tenantId, node.id, {
      trashedByEmail: user.email,
      trashKey: trashStorageKey,
    });

    await recordStorageAudit(user.tenantId, user, {
      action: 'STORAGE_NODE_TRASHED',
      resourceType: 'storage_node',
      resourceId: node.id,
      payload: { name: node.name, originalVirtualPath: node.virtual_path },
    });

    return {
      ok: true,
      node: serializeNode(trashed, access),
    };
  });

  // ---------------------------------------------------------------------------
  // 3. VERSIONAMENTO & LOCKS
  // ---------------------------------------------------------------------------
  app.get('/api/v1/storage/nodes/:id/versions', async (request, reply) => {
    const user = authenticateStorageUser(request);
    requireGlobalCapability(user, 'cloud:read');

    const node = await storageRepo.getNodeById(user.tenantId, request.params.id);
    if (!node) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Arquivo não encontrado.' });
    }

    const access = await resolveEffectiveNodeAccess(user.tenantId, user, node);
    if (!canAccessLevelPerform(access, 'view_list', { user, node })) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Sem permissão para consultar versões.' });
    }

    const versions = await storageRepo.listVersions(user.tenantId, node.id);
    return {
      nodeId: node.id,
      versions,
      items: versions,
    };
  });

  app.post('/api/v1/storage/nodes/:id/versions/:ver/restore', async (request, reply) => {
    const user = authenticateStorageUser(request);
    requireGlobalCapability(user, 'cloud:write');

    const node = await storageRepo.getNodeById(user.tenantId, request.params.id);
    if (!node || node.is_trashed) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Arquivo não encontrado.' });
    }

    assertNodeNotLockedByAnother(node, user);

    const access = await resolveEffectiveNodeAccess(user.tenantId, user, node);
    if (!canAccessLevelPerform(access, 'write', { user, node })) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Sem permissão para restaurar versões.' });
    }

    const targetVerNum = Number.parseInt(request.params.ver, 10);
    const targetVer = await storageRepo.getVersion(user.tenantId, node.id, targetVerNum);
    if (!targetVer) {
      return reply.code(404).send({ error: 'VERSION_NOT_FOUND', message: 'Versão solicitada não encontrada.' });
    }

    const { driver } = await getConfiguredDriverOrThrow(user.tenantId);
    const readSnap = await driver.readFile(targetVer.storage_key);
    const snapBuf = readSnap.buffer;

    const oldSize = Number(node.size_bytes ?? 0);
    const delta = snapBuf.length - oldSize;
    if (delta > 0) await storageRepo.reserveQuota(user.tenantId, delta);

    const newVerNum = Number(node.current_version ?? 1) + 1;
    const newVerKey = `/.nexus_versions/${node.id}/v${newVerNum}_${node.name}`;

    await driver.writeFile(node.storage_key || node.virtual_path, snapBuf);
    await driver.writeFile(newVerKey, snapBuf);

    if (delta < 0) await storageRepo.releaseQuota(user.tenantId, Math.abs(delta));

    await storageRepo.createVersion(user.tenantId, node.id, {
      storageKey: newVerKey,
      sizeBytes: snapBuf.length,
      sha256Hash: targetVer.sha256_hash,
      uploadedByEmail: user.email,
    });

    const updated = await storageRepo.updateNode(user.tenantId, node.id, {
      sizeBytes: snapBuf.length,
      sha256Hash: targetVer.sha256_hash,
      currentVersion: newVerNum,
    });

    await recordStorageAudit(user.tenantId, user, {
      action: 'STORAGE_VERSION_RESTORED',
      resourceType: 'storage_node',
      resourceId: node.id,
      payload: { restoredFromVersion: targetVerNum, newVersion: newVerNum },
    });

    const serialized = serializeNode(updated, access);
    return {
      ok: true,
      restoredFrom: targetVerNum,
      version: newVerNum,
      node: serialized,
      ...serialized,
    };
  });

  app.post('/api/v1/storage/nodes/:id/lock', async (request, reply) => {
    const user = authenticateStorageUser(request);
    requireGlobalCapability(user, 'cloud:write');

    const node = await storageRepo.getNodeById(user.tenantId, request.params.id);
    if (!node || node.is_trashed) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Arquivo não encontrado.' });
    }

    const access = await resolveEffectiveNodeAccess(user.tenantId, user, node);
    if (!canAccessLevelPerform(access, 'lock', { user, node })) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Sem permissão para bloquear este arquivo.' });
    }

    const locked = await storageRepo.lockNode(user.tenantId, node.id, user.email);
    await recordStorageAudit(user.tenantId, user, {
      action: 'STORAGE_NODE_LOCKED',
      resourceType: 'storage_node',
      resourceId: node.id,
      payload: { lockedByEmail: user.email },
    });

    const serialized = serializeNode(locked, access);
    return {
      ok: true,
      node: serialized,
      ...serialized,
    };
  });

  app.delete('/api/v1/storage/nodes/:id/lock', async (request, reply) => {
    const user = authenticateStorageUser(request);
    requireGlobalCapability(user, 'cloud:write');

    const node = await storageRepo.getNodeById(user.tenantId, request.params.id);
    if (!node || node.is_trashed) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Arquivo não encontrado.' });
    }

    const isForceAdmin = ['owner', 'admin', 'manager'].includes(String(user.role || '').toLowerCase());
    const unlocked = await storageRepo.unlockNode(user.tenantId, node.id, user.email, {
      force: isForceAdmin,
    });

    await recordStorageAudit(user.tenantId, user, {
      action: 'STORAGE_NODE_UNLOCKED',
      resourceType: 'storage_node',
      resourceId: node.id,
      payload: { unlockedByEmail: user.email, forced: isForceAdmin },
    });

    const serialized = serializeNode(unlocked);
    return {
      ok: true,
      node: serialized,
      ...serialized,
    };
  });

  // ---------------------------------------------------------------------------
  // 4. LIXEIRA CORPORATIVA 30 DIAS (.nexus_trash/)
  // ---------------------------------------------------------------------------
  app.get('/api/v1/storage/trash', async (request) => {
    const user = authenticateStorageUser(request);
    requireGlobalCapability(user, 'cloud:acl');
    const items = await storageRepo.listTrash(user.tenantId);
    const serialized = items.map((n) => serializeNode(n, 'full_control'));
    return {
      tenantId: user.tenantId,
      total: serialized.length,
      items: serialized,
      nodes: serialized,
      trash: serialized,
    };
  });

  app.post('/api/v1/storage/trash/:id/restore', async (request, reply) => {
    const user = authenticateStorageUser(request);
    requireGlobalCapability(user, 'cloud:acl');

    const node = await storageRepo.getNodeById(user.tenantId, request.params.id, { includeTrashed: true });
    if (!node || !node.is_trashed) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Item não encontrado na lixeira.' });
    }

    const body = request.body && typeof request.body === 'object' ? request.body : {};
    let targetVirtualPath;
    if (body.targetParentId) {
      const targetParent = await storageRepo.getNodeById(user.tenantId, body.targetParentId);
      if (!targetParent || targetParent.is_trashed) {
        return reply.code(404).send({ error: 'PARENT_NOT_FOUND', message: 'Pasta de destino não encontrada.' });
      }
      targetVirtualPath = normalizeVirtualVaultPath(
        targetParent.virtual_path === '/' ? `/${node.name}` : `${targetParent.virtual_path}/${node.name}`,
      );
    }

    const restored = await storageRepo.restoreNode(user.tenantId, node.id, {
      targetParentId: body.targetParentId,
      targetVirtualPath,
    });

    try {
      const { driver } = await getConfiguredDriverOrThrow(user.tenantId);
      const trashStorageKey = node.trash_key || `/.nexus_trash/${node.id}_${node.name}`;
      await driver.rename(trashStorageKey, restored.virtual_path);
    } catch {
      /* ignore if driver already kept original key */
    }

    await recordStorageAudit(user.tenantId, user, {
      action: 'STORAGE_TRASH_RESTORED',
      resourceType: 'storage_node',
      resourceId: node.id,
      payload: { virtualPath: restored.virtual_path },
    });

    const serialized = serializeNode(restored, 'full_control');
    return {
      ok: true,
      node: serialized,
      ...serialized,
    };
  });

  app.delete('/api/v1/storage/trash/:id', async (request, reply) => {
    const user = authenticateStorageUser(request);
    requireGlobalCapability(user, 'cloud:acl');

    const node = await storageRepo.getNodeById(user.tenantId, request.params.id, { includeTrashed: true });
    if (!node || !node.is_trashed) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Item não encontrado na lixeira.' });
    }

    try {
      const { driver } = await getConfiguredDriverOrThrow(user.tenantId);
      await driver.remove(node.trash_key || `/.nexus_trash/${node.id}_${node.name}`, { recursive: true });
      await driver.remove(node.storage_key || node.virtual_path, { recursive: true });
    } catch {
      /* ignore physical cleanup error */
    }

    const purgeResult = await storageRepo.purgeNode(user.tenantId, node.id);
    if (purgeResult?.freedBytes > 0) {
      await storageRepo.releaseQuota(user.tenantId, purgeResult.freedBytes);
    }

    await recordStorageAudit(user.tenantId, user, {
      action: 'STORAGE_TRASH_PURGED',
      resourceType: 'storage_node',
      resourceId: node.id,
      payload: { name: node.name, freedBytes: purgeResult.freedBytes },
    });

    return {
      ok: true,
      ...purgeResult,
    };
  });

  app.post('/api/v1/storage/trash/purge-expired', async (request) => {
    const user = authenticateStorageUser(request);
    requireGlobalCapability(user, 'cloud:acl');
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const retentionDays = body.retentionDays !== undefined ? Number(body.retentionDays) : 30;

    let sweep;
    if (retentionDays <= 0) {
      const trashedList = await storageRepo.listTrash(user.tenantId);
      let totalFreed = 0;
      const purgedNodes = [];
      for (const item of trashedList) {
        const res = await storageRepo.purgeNode(user.tenantId, item.id);
        if (res) {
          totalFreed += Number(res.freedBytes || 0);
          purgedNodes.push(res.deletedNode);
        }
      }
      if (totalFreed > 0) {
        await storageRepo.releaseQuota(user.tenantId, totalFreed);
      }
      sweep = { purgedCount: purgedNodes.length, purgedNodes, freedBytes: totalFreed };
    } else {
      sweep = await storageRepo.purgeExpiredTrash(user.tenantId, retentionDays);
      if (sweep?.freedBytes > 0) {
        await storageRepo.releaseQuota(user.tenantId, sweep.freedBytes);
      }
    }

    await recordStorageAudit(user.tenantId, user, {
      action: 'STORAGE_TRASH_SWEEP',
      resourceType: 'storage_node',
      resourceId: 'trash',
      payload: { retentionDays, purgedCount: sweep.purgedCount, freedBytes: sweep.freedBytes },
    });

    return {
      ok: true,
      ...sweep,
    };
  });

  // ---------------------------------------------------------------------------
  // 5. MATRIZ ACL GRANULAR (5 NÍVEIS) + HERANÇA VISÍVEL
  // ---------------------------------------------------------------------------
  function describeDefaultPathPolicy(virtualPath) {
    const vPath = String(virtualPath || '/');
    if (vPath === '/Corporativo-Publico' || vPath.startsWith('/Corporativo-Publico/')) {
      return {
        scopeType: 'public_company',
        title: 'Pasta Pública da Empresa',
        summary: 'Todos os colaboradores podem ver e baixar arquivos; administradores e gestores têm controle total.',
        collaboratorDefault: 'reader',
      };
    }
    if (vPath === '/Cofre-TI-Infra' || vPath.startsWith('/Cofre-TI-Infra/')) {
      return {
        scopeType: 'restricted_it',
        title: 'Cofre Restrito de TI & Termos',
        summary: 'Oculto para colaboradores comuns. Apenas Administradores, Gestores e equipe de TI acessam por padrão.',
        collaboratorDefault: 'none',
      };
    }
    if (vPath === '/Chamados' || vPath.startsWith('/Chamados/')) {
      return {
        scopeType: 'restricted_tickets',
        title: 'Arquivo de Chamados TI',
        summary: 'Restrito à equipe técnica, gestores e administradores. Oculto para colaboradores comuns.',
        collaboratorDefault: 'none',
      };
    }
    if (vPath === '/Setores') {
      return {
        scopeType: 'sectors_root',
        title: 'Raiz de Departamentos',
        summary: 'Colaboradores enxergam apenas a pasta do próprio setor dentro deste diretório.',
        collaboratorDefault: 'reader',
      };
    }
    if (vPath.startsWith('/Setores/')) {
      const sectorName = vPath.slice('/Setores/'.length).split('/')[0] || '';
      return {
        scopeType: 'department_folder',
        title: `Pasta do Setor "${sectorName}"`,
        summary: `Apenas colaboradores do setor "${sectorName}" podem editar/enviar arquivos por padrão; outros setores ficam bloqueados.`,
        collaboratorDefault: 'none',
        sectorName,
      };
    }
    if (vPath === '/Espaco-Pessoal') {
      return {
        scopeType: 'personal_root',
        title: 'Espaço Pessoal',
        summary: 'Cada colaborador enxerga apenas a própria subpasta individual.',
        collaboratorDefault: 'reader',
      };
    }
    if (vPath.startsWith('/Espaco-Pessoal/')) {
      const ownerEmail = vPath.slice('/Espaco-Pessoal/'.length).split('/')[0] || '';
      return {
        scopeType: 'personal_folder',
        title: `Pasta Pessoal de ${ownerEmail}`,
        summary: `Somente ${ownerEmail} e administradores têm acesso a esta pasta por padrão.`,
        collaboratorDefault: 'none',
        ownerEmail,
      };
    }
    return {
      scopeType: 'custom_folder',
      title: 'Pasta Personalizada na Raiz',
      summary: 'Apenas administradores, gestores e operadores acessam por padrão. Adicione regras abaixo para liberar setores ou pessoas.',
      collaboratorDefault: 'none',
    };
  }

  function formatAclRow(r, extra = {}) {
    return {
      id: r.id,
      nodeId: r.node_id || r.nodeId,
      targetType: r.target_type || r.targetType,
      target_type: r.target_type || r.targetType,
      targetValue: r.target_value || r.targetValue,
      target_value: r.target_value || r.targetValue,
      accessLevel: r.access_level || r.accessLevel,
      access_level: r.access_level || r.accessLevel,
      inherited: Boolean(extra.inherited ?? r.inherited),
      createdByEmail: r.created_by_email || r.createdByEmail || r.granted_by_email || null,
      ...extra,
    };
  }

  app.get('/api/v1/storage/nodes/:id/acl', async (request, reply) => {
    const user = authenticateStorageUser(request);
    requireGlobalCapability(user, 'cloud:acl');

    const node = await storageRepo.getNodeById(user.tenantId, request.params.id);
    if (!node) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Nó não encontrado.' });
    }

    const rules = await storageRepo.listNodeAcls(user.tenantId, node.id);
    const formatted = rules.map((r) => formatAclRow(r, { inherited: false }));

    // Coleta regras herdadas das pastas superiores para exibir com clareza na UI
    const inheritedRules = [];
    const vPath = String(node.virtual_path || node.virtualPath || '/');
    const isInsideSectorOrPersonal =
      vPath.startsWith('/Setores/') || vPath.startsWith('/Espaco-Pessoal/');
    const visited = new Set([node.id]);
    let cursorParentId = node.parent_id ?? node.parentId ?? null;

    while (cursorParentId && !visited.has(cursorParentId)) {
      visited.add(cursorParentId);
      const ancestor = await storageRepo.getNodeById(user.tenantId, cursorParentId);
      if (!ancestor) break;
      const ancPath = String(ancestor.virtual_path || ancestor.virtualPath || '/');
      if (isInsideSectorOrPersonal && (ancPath === '/Setores' || ancPath === '/Espaco-Pessoal')) {
        break;
      }
      const ancRules = await storageRepo.listNodeAcls(user.tenantId, ancestor.id);
      for (const r of ancRules) {
        inheritedRules.push(
          formatAclRow(r, {
            inherited: true,
            sourceNodeId: ancestor.id,
            sourceName: ancestor.name,
            sourcePath: ancPath,
          }),
        );
      }
      cursorParentId = ancestor.parent_id ?? ancestor.parentId ?? null;
    }

    return {
      nodeId: node.id,
      nodeName: node.name,
      virtualPath: vPath,
      rules: formatted,
      acls: formatted,
      items: formatted,
      inheritedRules,
      defaultPolicy: describeDefaultPathPolicy(vPath),
    };
  });

  app.put('/api/v1/storage/nodes/:id/acl', async (request, reply) => {
    const user = authenticateStorageUser(request);
    requireGlobalCapability(user, 'cloud:acl');

    const node = await storageRepo.getNodeById(user.tenantId, request.params.id);
    if (!node) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Nó não encontrado.' });
    }

    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const rawRules = Array.isArray(body.rules)
      ? body.rules
      : body.targetType
        ? [body]
        : [];

    if (rawRules.length === 0) {
      return reply.code(400).send({ error: 'INVALID_ACL_RULES', message: 'Informe ao menos uma regra ACL.' });
    }

    const upsertedList = [];
    for (const rule of rawRules) {
      const targetType = String(rule.targetType || rule.target_type || '').toLowerCase().trim();
      const targetValue = String(rule.targetValue || rule.target_value || '').trim();
      const accessLevel = String(rule.accessLevel || rule.access_level || '').toLowerCase().trim();

      if (!VALID_TARGET_TYPES.has(targetType) || !targetValue || !VALID_ACCESS_LEVELS.has(accessLevel)) {
        return reply.code(400).send({
          error: 'INVALID_ACL_RULE',
          message: 'Regra ACL inválida (targetType: user|role|department, accessLevel: none|viewer_online|reader|editor|full_control).',
        });
      }

      const upserted = await storageRepo.upsertNodeAcl(user.tenantId, node.id, {
        targetType,
        targetValue,
        accessLevel,
        grantedByEmail: user.email,
      });
      upsertedList.push(formatAclRow(upserted, { inherited: false }));
    }

    const allCurrentRules = (await storageRepo.listNodeAcls(user.tenantId, node.id)).map((r) =>
      formatAclRow(r, { inherited: false }),
    );

    await recordStorageAudit(user.tenantId, user, {
      action: 'STORAGE_ACL_UPDATED',
      resourceType: 'storage_node',
      resourceId: node.id,
      payload: { rules: upsertedList },
    });

    return {
      ok: true,
      nodeId: node.id,
      rules: allCurrentRules,
      acls: allCurrentRules,
      items: allCurrentRules,
      updatedRules: upsertedList,
    };
  });

  app.delete('/api/v1/storage/nodes/:id/acl/:aclId', async (request, reply) => {
    const user = authenticateStorageUser(request);
    requireGlobalCapability(user, 'cloud:acl');

    const node = await storageRepo.getNodeById(user.tenantId, request.params.id);
    if (!node) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Nó não encontrado.' });
    }

    const existingAcls = await storageRepo.listNodeAcls(user.tenantId, node.id);
    const targetAcl = existingAcls.find((a) => String(a.id) === String(request.params.aclId));
    const removed = await storageRepo.deleteNodeAcl(user.tenantId, node.id, request.params.aclId);
    if (!removed) {
      return reply.code(404).send({ error: 'ACL_NOT_FOUND', message: 'Regra ACL não encontrada.' });
    }

    await recordStorageAudit(user.tenantId, user, {
      action: 'STORAGE_ACL_DELETED',
      resourceType: 'storage_node',
      resourceId: node.id,
      payload: {
        aclId: request.params.aclId,
        targetType: targetAcl?.target_type || targetAcl?.targetType || null,
        targetValue: targetAcl?.target_value || targetAcl?.targetValue || null,
        accessLevel: targetAcl?.access_level || targetAcl?.accessLevel || null,
      },
    });

    return { ok: true, deleted: removed };
  });

  // ---------------------------------------------------------------------------
  // 6. LINKS TEMPORÁRIOS AUDITADOS
  // ---------------------------------------------------------------------------
  app.post('/api/v1/storage/links', async (request, reply) => {
    const user = authenticateStorageUser(request);
    if (!['owner', 'admin', 'manager', 'operator', 'member'].includes(String(user.role || '').toLowerCase())) {
      return reply.code(403).send({
        error: 'FORBIDDEN',
        message: 'Apenas operadores ou gestores podem emitir links temporários de compartilhamento.',
      });
    }

    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const nodeId = body.nodeId;
    const rawMinutes =
      body.expiresInMinutes !== undefined && body.expiresInMinutes !== null
        ? Number(body.expiresInMinutes)
        : body.expiresInHours !== undefined && body.expiresInHours !== null
          ? Number(body.expiresInHours) * 60
          : 60;
    const expiresInMinutes = rawMinutes;
    if (!nodeId || !Number.isFinite(expiresInMinutes) || expiresInMinutes <= 0) {
      return reply.code(400).send({
        error: 'INVALID_LINK_PARAMS',
        message: 'nodeId e expiresInMinutes (> 0) são obrigatórios.',
      });
    }

    const node = await storageRepo.getNodeById(user.tenantId, nodeId);
    if (!node || node.is_trashed) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Arquivo não encontrado.' });
    }

    const rawToken = `nxl_${crypto.randomBytes(24).toString('hex')}`;
    const tokenHash = crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex');
    const passwordHash = body.password ? hashPassword(String(body.password)) : null;
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString();

    const created = await storageRepo.createTempLink(user.tenantId, node.id, {
      tokenHash,
      passwordHash,
      allowDownload: body.allowDownload !== undefined ? Boolean(body.allowDownload) : true,
      expiresAt,
      createdByEmail: user.email,
    });

    await recordStorageAudit(user.tenantId, user, {
      action: 'STORAGE_TEMP_LINK_CREATED',
      resourceType: 'storage_temp_link',
      resourceId: created.id,
      payload: { nodeId: node.id, expiresAt, allowDownload: created.allow_download },
    });

    const sharePath = `/api/v1/storage/share/${rawToken}`;
    const maskedLink = {
      id: created.id,
      tenantId: created.tenant_id,
      nodeId: created.node_id,
      nodeName: node.name,
      nodePath: node.virtual_path || `/${node.name}`,
      sharePath,
      allowDownload: Boolean(created.allow_download),
      allow_download: Boolean(created.allow_download),
      hasPassword: Boolean(created.password_hash),
      accessCount: Number(created.access_count ?? 0),
      access_count: Number(created.access_count ?? 0),
      expiresAt: created.expires_at,
      expires_at: created.expires_at,
      revokedAt: created.revoked_at,
      revoked_at: created.revoked_at,
      createdByEmail: created.created_by_email,
      createdAt: created.created_at,
      token: rawToken,
    };

    return reply.code(201).send({
      token: rawToken,
      sharePath,
      link: maskedLink,
      ...maskedLink,
    });
  });

  app.get('/api/v1/storage/links', async (request) => {
    const user = authenticateStorageUser(request);
    requireGlobalCapability(user, 'cloud:read');
    const nodeIdFilter = request.query?.nodeId ? String(request.query.nodeId) : undefined;
    const [links, allNodes] = await Promise.all([
      storageRepo.listTempLinks(user.tenantId, { nodeId: nodeIdFilter }),
      storageRepo.listNodes(user.tenantId, { includeTrash: true }),
    ]);
    const nodesMap = new Map(allNodes.map((n) => [n.id, n]));
    const nowMs = Date.now();
    const sanitized = links.map((l) => {
      const targetNode = nodesMap.get(l.node_id);
      const expMs = new Date(l.expires_at).getTime();
      const isRevoked = Boolean(l.revoked_at);
      const isExpired = !isRevoked && Number.isFinite(expMs) && expMs <= nowMs;
      return {
        id: l.id,
        tenantId: l.tenant_id,
        nodeId: l.node_id,
        nodeName: targetNode?.name || null,
        nodePath: targetNode?.virtual_path || null,
        allowDownload: Boolean(l.allow_download),
        allow_download: Boolean(l.allow_download),
        hasPassword: Boolean(l.password_hash),
        accessCount: Number(l.access_count ?? 0),
        access_count: Number(l.access_count ?? 0),
        expiresAt: l.expires_at,
        expires_at: l.expires_at,
        revokedAt: l.revoked_at,
        revoked_at: l.revoked_at,
        status: isRevoked ? 'revoked' : isExpired ? 'expired' : 'active',
        createdByEmail: l.created_by_email,
        createdAt: l.created_at,
      };
    });
    return {
      tenantId: user.tenantId,
      links: sanitized,
      items: sanitized,
    };
  });

  app.delete('/api/v1/storage/links/:id', async (request, reply) => {
    const user = authenticateStorageUser(request);
    if (!['owner', 'admin', 'manager', 'operator', 'member'].includes(String(user.role || '').toLowerCase())) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Sem permissão para revogar links.' });
    }

    const purge = String(request.query?.purge || '').toLowerCase() === 'true';
    const result = purge
      ? await storageRepo.deleteTempLink(user.tenantId, request.params.id)
      : await storageRepo.revokeTempLink(user.tenantId, request.params.id);
    if (!result) {
      return reply.code(404).send({ error: 'LINK_NOT_FOUND', message: 'Link temporário não encontrado.' });
    }

    await recordStorageAudit(user.tenantId, user, {
      action: purge ? 'STORAGE_TEMP_LINK_DELETED' : 'STORAGE_TEMP_LINK_REVOKED',
      resourceType: 'storage_temp_link',
      resourceId: result.id,
      payload: { nodeId: result.node_id, purged: purge },
    });

    return { ok: true, purged: purge, link: result };
  });

  async function handlePublicShareAccess(request, reply) {
    const rawToken = String(request.params.token || '').trim();
    if (!rawToken || rawToken.includes('..') || rawToken.includes('/') || rawToken.includes('\\')) {
      return reply.code(400).send({ error: 'INVALID_SHARE_TOKEN', message: 'Token inválido.' });
    }

    const tokenHash = crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex');
    const link = await storageRepo.getTempLinkByTokenHash(tokenHash);
    if (!link) {
      return reply.code(404).send({ error: 'LINK_NOT_FOUND', message: 'Link temporário inexistente.' });
    }

    if (link.revoked_at) {
      return reply.code(410).send({ error: 'LINK_REVOKED', message: 'Este link temporário foi revogado.' });
    }

    const expMs = new Date(link.expires_at).getTime();
    if (Number.isNaN(expMs) || expMs <= Date.now()) {
      return reply.code(410).send({ error: 'LINK_EXPIRED', message: 'Este link temporário expirou.' });
    }

    if (link.password_hash) {
      const providedPass =
        request.body?.password || request.query?.password || request.headers['x-share-password'] || '';
      if (!providedPass || !verifyPassword(String(providedPass), link.password_hash)) {
        return reply.code(401).send({
          error: 'PASSWORD_REQUIRED',
          message: 'Senha obrigatória ou inválida para acessar este link compartilhado.',
        });
      }
    }

    const wantsDownload = String(request.query?.download || '') === '1' || request.query?.download === 'true';
    if (wantsDownload && !link.allow_download) {
      return reply.code(403).send({
        error: 'DOWNLOAD_DISABLED',
        message: 'Este link permite apenas visualização online (download desativado).',
      });
    }

    const node = await storageRepo.getNodeById(link.tenant_id, link.node_id);
    if (!node || node.is_trashed) {
      return reply.code(410).send({ error: 'FILE_UNAVAILABLE', message: 'O arquivo compartilhado não está mais disponível.' });
    }

    const { driver } = await getConfiguredDriverOrThrow(link.tenant_id);
    const readRes = await driver.readFile(node.storage_key || node.virtual_path);

    await storageRepo.incrementTempLinkAccess(link.id);

    await recordStorageAudit(
      link.tenant_id,
      { email: link.created_by_email || 'public-share@nexus.local', role: 'external' },
      {
        action: 'STORAGE_TEMP_LINK_ACCESSED',
        resourceType: 'storage_temp_link',
        resourceId: link.id,
        payload: { nodeId: node.id, allowDownload: Boolean(link.allow_download) },
      },
    );

    const dispType = wantsDownload && link.allow_download ? 'attachment' : 'inline';
    reply.code(200);
    reply.header('content-type', node.mime_type || 'application/octet-stream');
    reply.header('content-disposition', `${dispType}; filename="${encodeURIComponent(node.name)}"`);
    reply.header('x-content-type-options', 'nosniff');
    return reply.send(readRes.buffer);
  }

  app.get('/api/v1/storage/share/:token', handlePublicShareAccess);
  app.post('/api/v1/storage/share/:token', handlePublicShareAccess);

  // ---------------------------------------------------------------------------
  // 6.5 SESSÕES DE EDIÇÃO DESKTOP AUTO-SYNC (`nexusvault://` via Agente Windows)
  // ---------------------------------------------------------------------------
  async function emitStorageRealtimeEvent(tenantId, event, data) {
    const nexusDeskUrl = process.env.NEXUSDESK_SERVICE_URL || 'http://127.0.0.1:8004';
    const bodyStr = JSON.stringify({
      event,
      tenantId,
      timestamp: new Date().toISOString(),
      data,
    });
    try {
      await fetch(`${nexusDeskUrl}/internal/events`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...signInternalEvent(bodyStr),
        },
        body: bodyStr,
        signal: AbortSignal.timeout(2500),
      });
    } catch {
      /* best-effort realtime broadcast */
    }
  }

  async function resolveDesktopSessionOrThrow(rawToken, { allowClosed = false } = {}) {
    const cleanToken = String(rawToken || '').trim();
    if (!cleanToken || !/^nxd_[A-Za-z0-9_-]{24,128}$/.test(cleanToken)) {
      const err = new Error('Token de sessão desktop inválido.');
      err.code = 'INVALID_DESKTOP_SESSION';
      err.statusCode = 400;
      throw err;
    }
    const tokenHash = crypto.createHash('sha256').update(cleanToken, 'utf8').digest('hex');
    const session = await storageRepo.getDesktopEditSessionByTokenHash(tokenHash);
    if (!session) {
      const err = new Error('Sessão de edição desktop não encontrada.');
      err.code = 'DESKTOP_SESSION_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }
    if (!allowClosed) {
      if (session.closed_at || session.status === 'closed') {
        const err = new Error('Esta sessão de edição desktop já foi encerrada.');
        err.code = 'DESKTOP_SESSION_CLOSED';
        err.statusCode = 410;
        throw err;
      }
      const expMs = new Date(session.expires_at).getTime();
      if (Number.isNaN(expMs) || expMs <= Date.now()) {
        const err = new Error('Esta sessão de edição desktop expirou. Abra o arquivo novamente pelo sistema.');
        err.code = 'DESKTOP_SESSION_EXPIRED';
        err.statusCode = 410;
        throw err;
      }
    }
    const node = await storageRepo.getNodeById(session.tenant_id, session.node_id, { includeTrashed: true });
    if (!node || (!allowClosed && node.is_trashed)) {
      const err = new Error('Arquivo associado à sessão não está mais disponível.');
      err.code = 'FILE_UNAVAILABLE';
      err.statusCode = 410;
      throw err;
    }
    return { session, node };
  }

  app.post('/api/v1/storage/nodes/:id/desktop-session', async (request, reply) => {
    const user = authenticateStorageUser(request);
    requireGlobalCapability(user, 'cloud:read');

    const node = await storageRepo.getNodeById(user.tenantId, request.params.id);
    if (!node || node.is_trashed) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Arquivo não encontrado.' });
    }
    if ((node.node_type || node.nodeType) === 'folder') {
      return reply.code(400).send({ error: 'CANNOT_EDIT_FOLDER', message: 'Selecione um arquivo (planilha, documento, etc.) para edição no computador.' });
    }

    const access = await resolveEffectiveNodeAccess(user.tenantId, user, node);
    if (!canAccessLevelPerform(access, 'write', { user, node })) {
      return reply.code(403).send({
        error: 'FORBIDDEN',
        message: 'Seu nível de permissão neste arquivo é apenas leitura/visualização. Edição sincronizada requer permissão de editor.',
      });
    }

    assertNodeNotLockedByAnother(node, user);
    await storageRepo.lockNode(user.tenantId, node.id, user.email);

    const rawToken = `nxd_${crypto.randomBytes(28).toString('hex')}`;
    const tokenHash = crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex');
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();

    const created = await storageRepo.createDesktopEditSession(user.tenantId, node.id, {
      tokenHash,
      userEmail: user.email,
      userName: user.name || user.email,
      userRole: user.role,
      lastVersion: Number(node.current_version || 1),
      expiresAt,
    });

    await recordStorageAudit(user.tenantId, user, {
      action: 'STORAGE_DESKTOP_SESSION_CREATED',
      resourceType: 'storage_node',
      resourceId: node.id,
      payload: {
        sessionId: created.id,
        fileName: node.name,
        virtualPath: node.virtual_path,
        expiresAt,
      },
    });

    return reply.code(201).send({
      sessionId: created.id,
      sessionToken: rawToken,
      nodeId: node.id,
      fileName: node.name,
      virtualPath: node.virtual_path,
      mimeType: node.mime_type || inferMimeType(node.name),
      sizeBytes: Number(node.size_bytes || 0),
      currentVersion: Number(node.current_version || 1),
      status: created.status,
      syncCount: 0,
      lockedByEmail: user.email,
      expiresAt: created.expires_at,
    });
  });

  app.get('/api/v1/storage/desktop-sessions/:token/status', async (request) => {
    const { session, node } = await resolveDesktopSessionOrThrow(request.params.token, { allowClosed: true });
    const expMs = new Date(session.expires_at).getTime();
    const isExpired = !session.closed_at && Number.isFinite(expMs) && expMs <= Date.now();
    return {
      sessionId: session.id,
      nodeId: node.id,
      fileName: node.name,
      virtualPath: node.virtual_path,
      mimeType: node.mime_type || inferMimeType(node.name),
      sizeBytes: Number(node.size_bytes || 0),
      currentVersion: Number(node.current_version || 1),
      sha256Hash: node.sha256_hash || null,
      userEmail: session.user_email,
      userName: session.user_name || session.user_email,
      status: session.closed_at || session.status === 'closed' ? 'closed' : isExpired ? 'expired' : session.status,
      syncCount: Number(session.sync_count || 0),
      lastVersion: Number(session.last_version || node.current_version || 1),
      lastSyncedAt: session.last_synced_at,
      openedAt: session.opened_at,
      expiresAt: session.expires_at,
      closedAt: session.closed_at,
      lockedByEmail: node.locked_by_email || null,
    };
  });

  app.get('/api/v1/storage/desktop-sessions/:token/download', async (request, reply) => {
    const { session, node } = await resolveDesktopSessionOrThrow(request.params.token);
    const { driver } = await getConfiguredDriverOrThrow(session.tenant_id);
    const readRes = await driver.readFile(node.storage_key || node.virtual_path);

    const firstOpen = !session.opened_at;
    await storageRepo.updateDesktopEditSession(session.id, {
      status: 'opened',
      openedAt: session.opened_at || new Date().toISOString(),
    });

    if (firstOpen) {
      await recordStorageAudit(
        session.tenant_id,
        { email: session.user_email, role: session.user_role, name: session.user_name },
        {
          action: 'STORAGE_DESKTOP_SESSION_OPENED',
          resourceType: 'storage_node',
          resourceId: node.id,
          payload: { sessionId: session.id, fileName: node.name, source: 'NexusAgent-DesktopSync' },
        },
      );
    }

    reply.code(200);
    reply.header('content-type', node.mime_type || inferMimeType(node.name));
    reply.header(
      'content-disposition',
      `attachment; filename="${encodeURIComponent(node.name)}"; filename*=UTF-8''${encodeURIComponent(node.name)}`,
    );
    reply.header('x-content-type-options', 'nosniff');
    return reply.send(readRes.buffer);
  });

  app.post('/api/v1/storage/desktop-sessions/:token/upload', async (request, reply) => {
    const { session, node } = await resolveDesktopSessionOrThrow(request.params.token);
    assertNodeNotLockedByAnother(node, { email: session.user_email });

    let fileBuffer = null;
    if (Buffer.isBuffer(request.body)) {
      const ct = String(request.headers['content-type'] || '').toLowerCase();
      if (ct.includes('multipart/form-data')) {
        const parsed = parseMultipartFormBuffer(request.body, request.headers['content-type']);
        fileBuffer = parsed.filePart?.buffer || null;
      } else {
        fileBuffer = request.body;
      }
    } else if (typeof request.body === 'string') {
      fileBuffer = Buffer.from(request.body, 'utf8');
    }

    if (!fileBuffer || fileBuffer.length === 0) {
      return reply.code(400).send({ error: 'EMPTY_FILE', message: 'Nenhum dado recebido para sincronização.' });
    }
    if (fileBuffer.length > 100 * 1024 * 1024) {
      return reply.code(413).send({ error: 'FILE_TOO_LARGE', message: 'O arquivo excede o limite de 100 MB.' });
    }
    assertAllowedFileType(node.name, node.mime_type || inferMimeType(node.name));

    const sha256Hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    const nowIso = new Date().toISOString();
    if (node.sha256_hash && node.sha256_hash === sha256Hash) {
      const updated = await storageRepo.updateDesktopEditSession(session.id, {
        status: 'opened',
        lastSyncedAt: nowIso,
      });
      return {
        ok: true,
        unchanged: true,
        version: Number(node.current_version || 1),
        sizeBytes: fileBuffer.length,
        sha256Hash,
        syncCount: Number(updated?.sync_count ?? session.sync_count ?? 0),
        syncedAt: nowIso,
      };
    }

    const oldSize = Number(node.size_bytes || 0);
    const deltaBytes = fileBuffer.length - oldSize;
    if (deltaBytes > 0) {
      await storageRepo.reserveQuota(session.tenant_id, deltaBytes);
    }

    const { conn, driver } = await getConfiguredDriverOrThrow(session.tenant_id);
    const targetKey = node.storage_key || node.virtual_path;
    resolveSafeVaultPath(conn.root_path || '/', targetKey);

    try {
      await driver.writeFile(targetKey, fileBuffer);
    } catch (writeErr) {
      if (deltaBytes > 0) {
        await storageRepo.releaseQuota(session.tenant_id, deltaBytes);
      }
      throw writeErr;
    }

    if (deltaBytes < 0) {
      await storageRepo.releaseQuota(session.tenant_id, Math.abs(deltaBytes));
    }

    const nextVersion = Number(node.current_version || 1) + 1;
    const versionKey = `/.nexus_versions/${node.id}/v${nextVersion}_${node.name}`;
    try {
      await driver.writeFile(versionKey, fileBuffer);
    } catch {
      /* ignore snapshot failure */
    }

    await storageRepo.createVersion(session.tenant_id, node.id, {
      storageKey: versionKey,
      sizeBytes: fileBuffer.length,
      sha256Hash,
      uploadedByEmail: session.user_email,
      comment: 'Sincronização automática Desktop (Agente Nexus)',
    });

    await storageRepo.updateNode(session.tenant_id, node.id, {
      sizeBytes: fileBuffer.length,
      sha256Hash,
      currentVersion: nextVersion,
      updatedByEmail: session.user_email,
    });

    // Mantém lock e renova expiração da sessão por mais 4h
    await storageRepo.lockNode(session.tenant_id, node.id, session.user_email);
    const nextExpiry = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
    const updatedSession = await storageRepo.updateDesktopEditSession(session.id, {
      status: 'opened',
      incrementSync: true,
      lastVersion: nextVersion,
      lastSyncedAt: nowIso,
      expiresAt: nextExpiry,
    });

    await recordStorageAudit(
      session.tenant_id,
      { email: session.user_email, role: session.user_role, name: session.user_name },
      {
        action: 'STORAGE_DESKTOP_SYNC_SAVED',
        resourceType: 'storage_node',
        resourceId: node.id,
        payload: {
          sessionId: session.id,
          fileName: node.name,
          version: nextVersion,
          sizeBytes: fileBuffer.length,
          sha256Hash,
          source: 'NexusAgent-DesktopSync',
        },
      },
    );

    await emitStorageRealtimeEvent(session.tenant_id, 'storage.node.synced', {
      nodeId: node.id,
      fileName: node.name,
      version: nextVersion,
      sizeBytes: fileBuffer.length,
      syncedByEmail: session.user_email,
      syncedAt: nowIso,
      action: 'saved',
    });

    return {
      ok: true,
      unchanged: false,
      version: nextVersion,
      sizeBytes: fileBuffer.length,
      sha256Hash,
      syncCount: Number(updatedSession?.sync_count ?? 1),
      syncedAt: nowIso,
    };
  });

  app.post('/api/v1/storage/desktop-sessions/:token/heartbeat', async (request) => {
    const { session, node } = await resolveDesktopSessionOrThrow(request.params.token);
    const nextExpiry = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
    await storageRepo.updateDesktopEditSession(session.id, { expiresAt: nextExpiry });
    if (!node.locked_by_email || String(node.locked_by_email).toLowerCase() === String(session.user_email).toLowerCase()) {
      await storageRepo.lockNode(session.tenant_id, node.id, session.user_email);
    }
    return { ok: true, status: session.status, expiresAt: nextExpiry };
  });

  app.post('/api/v1/storage/desktop-sessions/:token/close', async (request) => {
    const { session, node } = await resolveDesktopSessionOrThrow(request.params.token, { allowClosed: true });
    if (session.closed_at || session.status === 'closed') {
      return { ok: true, status: 'closed', alreadyClosed: true, unlocked: false };
    }

    let unlocked = false;
    if (
      node &&
      !node.is_trashed &&
      node.locked_by_email &&
      String(node.locked_by_email).toLowerCase() === String(session.user_email).toLowerCase()
    ) {
      await storageRepo.unlockNode(session.tenant_id, node.id, session.user_email, { force: true });
      unlocked = true;
    }

    const closedAt = new Date().toISOString();
    await storageRepo.updateDesktopEditSession(session.id, {
      status: 'closed',
      closedAt,
    });

    await recordStorageAudit(
      session.tenant_id,
      { email: session.user_email, role: session.user_role, name: session.user_name },
      {
        action: 'STORAGE_DESKTOP_SESSION_CLOSED',
        resourceType: 'storage_node',
        resourceId: session.node_id,
        payload: {
          sessionId: session.id,
          fileName: node?.name || null,
          unlocked,
          syncCount: Number(session.sync_count || 0),
          lastVersion: Number(session.last_version || 1),
        },
      },
    );

    await emitStorageRealtimeEvent(session.tenant_id, 'storage.node.synced', {
      nodeId: session.node_id,
      fileName: node?.name || null,
      version: Number(session.last_version || node?.current_version || 1),
      syncedByEmail: session.user_email,
      syncedAt: closedAt,
      action: 'closed',
    });

    return {
      ok: true,
      status: 'closed',
      unlocked,
      syncCount: Number(session.sync_count || 0),
      lastVersion: Number(session.last_version || 1),
    };
  });

  // ---------------------------------------------------------------------------
  // 7. NEXUS SHEETS LIVE (PLANILHAS COLABORATIVAS EM TEMPO REAL)
  // ---------------------------------------------------------------------------
  app.post('/api/v1/storage/sheets', async (request, reply) => {
    const user = authenticateStorageUser(request);
    requireGlobalCapability(user, 'cloud:write');

    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const rawName = body.name || 'Nova-Planilha.xlsx';
    const cleanName = validateSafeSingleName(rawName, 'Nome da planilha');
    const parentId = body.parentId || null;

    let parentNode = null;
    if (parentId) {
      parentNode = await storageRepo.getNodeById(user.tenantId, parentId);
      if (!parentNode || parentNode.is_trashed) {
        return reply.code(404).send({ error: 'PARENT_NOT_FOUND', message: 'Pasta pai não encontrada.' });
      }
    }

    const parentAccess = await resolveEffectiveNodeAccess(user.tenantId, user, parentNode);
    if (!canAccessLevelPerform(parentAccess, 'create', { user, node: parentNode })) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Sem permissão para criar planilha nesta pasta.' });
    }

    const parentPath = parentNode ? parentNode.virtual_path : '/';
    const virtualPath = normalizeVirtualVaultPath(
      parentPath === '/' ? `/${cleanName}` : `${parentPath}/${cleanName}`,
    );

    const existing = await storageRepo.getNodeByPath(user.tenantId, virtualPath);
    if (existing) {
      return reply.code(409).send({ error: 'PATH_ALREADY_EXISTS', message: 'Já existe uma planilha com este nome.' });
    }

    const tabs = normalizeWorkbookTabs(body.tabs || body.sheets);
    const binaryBuf = serializeWorkbookToBinary(tabs, cleanName);
    const sha256Hash = crypto.createHash('sha256').update(binaryBuf).digest('hex');

    await storageRepo.reserveQuota(user.tenantId, binaryBuf.length);
    const { conn, driver } = await getConfiguredDriverOrThrow(user.tenantId);
    resolveSafeVaultPath(conn.root_path || '/', virtualPath);

    try {
      await driver.writeFile(virtualPath, binaryBuf);
    } catch (writeErr) {
      await storageRepo.releaseQuota(user.tenantId, binaryBuf.length);
      throw writeErr;
    }

    const createdNode = await storageRepo.createNode(user.tenantId, {
      parentId: parentNode ? parentNode.id : null,
      name: cleanName,
      virtualPath,
      storageKey: virtualPath,
      nodeType: 'spreadsheet',
      mimeType: inferMimeType(cleanName),
      sizeBytes: binaryBuf.length,
      sha256Hash,
      currentVersion: 1,
      departmentScope: parentNode?.department_scope || null,
      createdByEmail: user.email,
    });

    const v1Key = `/.nexus_versions/${createdNode.id}/v1_${createdNode.name}`;
    try {
      await driver.writeFile(v1Key, binaryBuf);
    } catch {
      /* ignore */
    }
    await storageRepo.createVersion(user.tenantId, createdNode.id, {
      storageKey: v1Key,
      sizeBytes: binaryBuf.length,
      sha256Hash,
      uploadedByEmail: user.email,
    });

    await storageRepo.upsertSheetSession(user.tenantId, createdNode.id, {
      workbookJson: { sheets: tabs, tabs },
      lastSavedByEmail: user.email,
      force: true,
    });

    await recordStorageAudit(user.tenantId, user, {
      action: 'STORAGE_SHEET_CREATED',
      resourceType: 'storage_node',
      resourceId: createdNode.id,
      payload: { name: cleanName, virtualPath, sizeBytes: binaryBuf.length },
    });

    const serialized = serializeNode(createdNode, 'full_control');
    return reply.code(201).send({
      id: createdNode.id,
      rev: 1,
      name: createdNode.name,
      sheets: tabs,
      tabs,
      node: serialized,
      sheet: { id: createdNode.id, rev: 1, name: createdNode.name, sheets: tabs, tabs },
    });
  });

  app.get('/api/v1/storage/sheets/:id', async (request, reply) => {
    const user = authenticateStorageUser(request);
    requireGlobalCapability(user, 'cloud:read');

    const node = await storageRepo.getNodeById(user.tenantId, request.params.id);
    if (!node || node.is_trashed) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Planilha não encontrada.' });
    }

    const access = await resolveEffectiveNodeAccess(user.tenantId, user, node);
    if (!canAccessLevelPerform(access, 'preview', { user, node })) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Sem permissão para visualizar esta planilha.' });
    }

    let session = await storageRepo.getSheetSession(user.tenantId, node.id);
    let tabs;
    let rev = 1;

    if (session && session.workbook_json) {
      const rawTabs = session.workbook_json.sheets || session.workbook_json.tabs || [];
      tabs = normalizeWorkbookTabs(rawTabs);
      rev = Number(session.rev ?? session.revision ?? 1);
    } else {
      const { driver } = await getConfiguredDriverOrThrow(user.tenantId);
      const readRes = await driver.readFile(node.storage_key || node.virtual_path);
      tabs = parseBinaryToWorkbookTabs(readRes.buffer, node.name);
      session = await storageRepo.upsertSheetSession(user.tenantId, node.id, {
        workbookJson: { sheets: tabs, tabs },
        lastSavedByEmail: user.email,
        force: true,
      });
      rev = Number(session.rev ?? session.revision ?? 1);
    }

    return {
      id: node.id,
      name: node.name,
      virtualPath: node.virtual_path,
      rev,
      revision: rev,
      effectiveAccess: access,
      lockedByEmail: node.locked_by_email || null,
      sheets: tabs,
      tabs,
    };
  });

  async function commitSheetSave({ tenantId, node, user, incomingTabs, expectedRev, isAutoSave = false }) {
    assertNodeNotLockedByAnother(node, user);

    let session = await storageRepo.getSheetSession(tenantId, node.id);
    if (!session) {
      const { driver } = await getConfiguredDriverOrThrow(tenantId);
      const readRes = await driver.readFile(node.storage_key || node.virtual_path);
      const parsedTabs = parseBinaryToWorkbookTabs(readRes.buffer, node.name);
      session = await storageRepo.upsertSheetSession(tenantId, node.id, {
        workbookJson: { sheets: parsedTabs, tabs: parsedTabs },
        lastSavedByEmail: user.email,
        force: true,
      });
    }

    const currentRev = Number(session.rev ?? session.revision ?? 1);
    if (expectedRev !== undefined && expectedRev !== null && Number(expectedRev) !== currentRev) {
      const err = new Error(`Conflito de revisão da planilha (esperado ${expectedRev}, atual ${currentRev}).`);
      err.code = 'SHEET_REV_CONFLICT';
      err.statusCode = 409;
      throw err;
    }

    const oldTabs = session.workbook_json?.sheets || session.workbook_json?.tabs || [];
    const evaluatedTabs = normalizeWorkbookTabs(incomingTabs);
    const cellDiffs = diffWorkbookCells(oldTabs, evaluatedTabs);

    const binaryBuf = serializeWorkbookToBinary(evaluatedTabs, node.name);
    const sha256Hash = crypto.createHash('sha256').update(binaryBuf).digest('hex');

    const oldSize = Number(node.size_bytes ?? 0);
    const delta = binaryBuf.length - oldSize;
    if (delta > 0) await storageRepo.reserveQuota(tenantId, delta);

    const { driver } = await getConfiguredDriverOrThrow(tenantId);
    const nextVer = Number(node.current_version ?? 1) + 1;
    const verKey = `/.nexus_versions/${node.id}/v${nextVer}_${node.name}`;

    try {
      await driver.writeFile(node.storage_key || node.virtual_path, binaryBuf);
      await driver.writeFile(verKey, binaryBuf);
    } catch (writeErr) {
      if (delta > 0) await storageRepo.releaseQuota(tenantId, delta);
      throw writeErr;
    }

    if (delta < 0) await storageRepo.releaseQuota(tenantId, Math.abs(delta));

    await storageRepo.createVersion(tenantId, node.id, {
      storageKey: verKey,
      sizeBytes: binaryBuf.length,
      sha256Hash,
      uploadedByEmail: user.email,
    });

    await storageRepo.updateNode(tenantId, node.id, {
      sizeBytes: binaryBuf.length,
      sha256Hash,
      currentVersion: nextVer,
    });

    const updatedSession = await storageRepo.upsertSheetSession(tenantId, node.id, {
      workbookJson: { sheets: evaluatedTabs, tabs: evaluatedTabs },
      expectedRev: currentRev,
      lastSavedByEmail: user.email,
      force: true,
    });
    const nextRev = Number(updatedSession.rev ?? currentRev + 1);

    if (cellDiffs.length > 0) {
      await storageRepo.appendSheetCellHistory(
        tenantId,
        node.id,
        cellDiffs.map((diff) => ({
          rev: nextRev,
          tabName: diff.tabName,
          cellRef: diff.cellRef,
          oldValue: diff.oldValue,
          newValue: diff.newValue,
          oldFormula: diff.oldFormula,
          newFormula: diff.newFormula,
          actorEmail: user.email,
          actorName: user.name || user.email,
        })),
      );
    }

    await recordStorageAudit(tenantId, user, {
      action: isAutoSave ? 'STORAGE_SHEET_AUTOSAVED' : 'STORAGE_SHEET_SAVED',
      resourceType: 'storage_node',
      resourceId: node.id,
      payload: {
        rev: nextRev,
        version: nextVer,
        changedCellsCount: cellDiffs.length,
      },
    });

    return {
      id: node.id,
      rev: nextRev,
      revision: nextRev,
      version: nextVer,
      savedAt: updatedSession.updated_at || new Date().toISOString(),
      sheets: evaluatedTabs,
      tabs: evaluatedTabs,
    };
  }

  app.post('/api/v1/storage/sheets/:id/save', async (request, reply) => {
    const user = authenticateStorageUser(request);
    requireGlobalCapability(user, 'cloud:write');

    const node = await storageRepo.getNodeById(user.tenantId, request.params.id);
    if (!node || node.is_trashed) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Planilha não encontrada.' });
    }

    const access = await resolveEffectiveNodeAccess(user.tenantId, user, node);
    if (!canAccessLevelPerform(access, 'write', { user, node })) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Sem permissão para salvar alterações nesta planilha.' });
    }

    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const incomingTabs = body.tabs || body.sheets || [];
    const saved = await commitSheetSave({
      tenantId: user.tenantId,
      node,
      user,
      incomingTabs,
      expectedRev: body.expectedRev,
      isAutoSave: false,
    });

    return saved;
  });

  app.get('/api/v1/storage/sheets/:id/export', async (request, reply) => {
    const user = authenticateStorageUser(request);
    requireGlobalCapability(user, 'cloud:read');

    const format = String(request.query?.format || 'xlsx').toLowerCase().trim();
    if (!['xlsx', 'csv', 'nexusheet'].includes(format)) {
      return reply.code(400).send({
        error: 'INVALID_EXPORT_FORMAT',
        message: "Formato de exportação inválido (use 'xlsx' ou 'csv').",
      });
    }

    const node = await storageRepo.getNodeById(user.tenantId, request.params.id);
    if (!node || node.is_trashed) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Planilha não encontrada.' });
    }

    const access = await resolveEffectiveNodeAccess(user.tenantId, user, node);
    if (!canAccessLevelPerform(access, 'download', { user, node })) {
      return reply.code(403).send({
        error: 'FORBIDDEN',
        message: 'Permissão insuficiente para exportar/baixar esta planilha.',
      });
    }

    let session = await storageRepo.getSheetSession(user.tenantId, node.id);
    let tabs;
    if (session?.workbook_json) {
      tabs = normalizeWorkbookTabs(session.workbook_json.sheets || session.workbook_json.tabs);
    } else {
      const { driver } = await getConfiguredDriverOrThrow(user.tenantId);
      const readRes = await driver.readFile(node.storage_key || node.virtual_path);
      tabs = parseBinaryToWorkbookTabs(readRes.buffer, node.name);
    }

    const baseName = node.name.replace(/\.(xlsx|csv|nexusheet)$/i, '');
    if (format === 'csv') {
      const csvText = exportTabsToCsvString(tabs);
      reply.code(200);
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('content-disposition', `attachment; filename="${encodeURIComponent(`${baseName}.csv`)}"`);
      return reply.send(csvText);
    }

    const outBuf = serializeWorkbookToBinary(tabs, `${baseName}.${format}`);
    reply.code(200);
    reply.header(
      'content-type',
      format === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/json; charset=utf-8',
    );
    reply.header('content-disposition', `attachment; filename="${encodeURIComponent(`${baseName}.${format}`)}"`);
    return reply.send(outBuf);
  });

  app.get('/api/v1/storage/sheets/:id/history', async (request, reply) => {
    const user = authenticateStorageUser(request);
    requireGlobalCapability(user, 'cloud:read');

    const node = await storageRepo.getNodeById(user.tenantId, request.params.id);
    if (!node) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Planilha não encontrada.' });
    }

    const access = await resolveEffectiveNodeAccess(user.tenantId, user, node);
    if (!canAccessLevelPerform(access, 'preview', { user, node })) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Sem permissão para ver histórico desta planilha.' });
    }

    const history = await storageRepo.listSheetCellHistory(user.tenantId, node.id, {
      cellRef: request.query?.cellRef,
      limit: Number(request.query?.limit || 100),
    });

    // Return chronological ascending so latest entry is last, while keeping all fields
    const chronological = [...history].reverse().map((h) => ({
      ...h,
      tabName: h.tab_name || h.tabName,
      cellRef: h.cell_ref || h.cellRef,
      oldValue: h.old_value ?? h.oldValue,
      newValue: h.new_value ?? h.newValue,
      oldFormula: h.old_formula ?? h.oldFormula,
      newFormula: h.new_formula ?? h.newFormula,
      actorEmail: h.actor_email || h.actorEmail,
      actorName: h.actor_name || h.actorName,
      createdAt: h.created_at || h.createdAt,
    }));

    return {
      nodeId: node.id,
      history: chronological,
      items: chronological,
    };
  });

  // ---------------------------------------------------------------------------
  // 8. ROTAS INTERNAS M2M (CHAMADOS, TERMOS E WEBSOCKET SHEETS)
  // ---------------------------------------------------------------------------
  app.post('/internal/storage/archive', async (request, reply) => {
    const rawBody = JSON.stringify(request.body || {});
    const valid = verifyInternalEvent(request.headers, rawBody);
    if (!valid) {
      return reply.code(401).send({ error: 'INTERNAL_AUTH_FAILED', message: 'Assinatura M2M inválida.' });
    }

    const { tenantId, actor, folderSegments = [], files = [] } = request.body || {};
    if (!tenantId || !actor) {
      return reply.code(400).send({ error: 'INVALID_ARCHIVE_PAYLOAD', message: 'tenantId e actor obrigatórios.' });
    }
    assertZeroKnowledgeAllowed(actor, 'Archive VPS');

    const { conn, driver } = await getConfiguredDriverOrThrow(tenantId);

    // Ensure folder hierarchy exists
    let currentParentId = null;
    let currentPath = '';
    for (const seg of folderSegments) {
      const cleanSeg = validateSafeSingleName(seg, 'Segmento de pasta');
      currentPath = normalizeVirtualVaultPath(`${currentPath}/${cleanSeg}`);
      resolveSafeVaultPath(conn.root_path || '/', currentPath);
      await driver.mkdir(currentPath);

      let folderNode = await storageRepo.getNodeByPath(tenantId, currentPath);
      if (!folderNode) {
        folderNode = await storageRepo.createNode(tenantId, {
          parentId: currentParentId,
          name: cleanSeg,
          virtualPath: currentPath,
          storageKey: currentPath,
          nodeType: 'folder',
          mimeType: 'inode/directory',
          sizeBytes: 0,
          departmentScope: 'TI',
          createdByEmail: actor.email,
        });
        if (currentPath === '/Cofre-TI-Infra' || currentPath === '/Chamados') {
          await storageRepo.upsertNodeAcl(tenantId, folderNode.id, {
            targetType: 'role',
            targetValue: 'collaborator',
            accessLevel: 'none',
            grantedByEmail: actor.email,
          });
        }
      }
      currentParentId = folderNode.id;
    }

    const archivedNodes = [];
    for (const item of files) {
      const cleanFileName = validateSafeSingleName(item.name, 'Arquivo de arquivamento');
      const buf = item.contentBase64
        ? Buffer.from(String(item.contentBase64), 'base64')
        : Buffer.from(String(item.contentText || ''), 'utf8');
      const mimeType = inferMimeType(cleanFileName, item.mimeType);
      const sha256Hash = crypto.createHash('sha256').update(buf).digest('hex');
      const fileVirtualPath = normalizeVirtualVaultPath(`${currentPath}/${cleanFileName}`);

      const existing = await storageRepo.getNodeByPath(tenantId, fileVirtualPath);
      if (existing) {
        const oldSize = Number(existing.size_bytes ?? 0);
        const delta = buf.length - oldSize;
        if (delta > 0) await storageRepo.reserveQuota(tenantId, delta);
        const nextVer = Number(existing.current_version ?? 1) + 1;
        const verKey = `/.nexus_versions/${existing.id}/v${nextVer}_${existing.name}`;
        await driver.writeFile(fileVirtualPath, buf);
        await driver.writeFile(verKey, buf);
        if (delta < 0) await storageRepo.releaseQuota(tenantId, Math.abs(delta));
        await storageRepo.createVersion(tenantId, existing.id, {
          storageKey: verKey,
          sizeBytes: buf.length,
          sha256Hash,
          uploadedByEmail: actor.email,
        });
        const updated = await storageRepo.updateNode(tenantId, existing.id, {
          sizeBytes: buf.length,
          sha256Hash,
          mimeType,
          currentVersion: nextVer,
        });
        archivedNodes.push(serializeNode(updated, 'full_control'));
      } else {
        await storageRepo.reserveQuota(tenantId, buf.length);
        try {
          await driver.writeFile(fileVirtualPath, buf);
        } catch (wErr) {
          await storageRepo.releaseQuota(tenantId, buf.length);
          throw wErr;
        }
        const created = await storageRepo.createNode(tenantId, {
          parentId: currentParentId,
          name: cleanFileName,
          virtualPath: fileVirtualPath,
          storageKey: fileVirtualPath,
          nodeType: 'file',
          mimeType,
          sizeBytes: buf.length,
          sha256Hash,
          currentVersion: 1,
          departmentScope: 'TI',
          createdByEmail: actor.email,
        });
        const v1Key = `/.nexus_versions/${created.id}/v1_${created.name}`;
        try {
          await driver.writeFile(v1Key, buf);
        } catch {
          /* ignore */
        }
        await storageRepo.createVersion(tenantId, created.id, {
          storageKey: v1Key,
          sizeBytes: buf.length,
          sha256Hash,
          uploadedByEmail: actor.email,
        });
        archivedNodes.push(serializeNode(created, 'full_control'));
      }
    }

    return {
      ok: true,
      archived: true,
      folderPath: `${currentPath}/`,
      virtualPath: archivedNodes[0]?.virtualPath || `${currentPath}/`,
      nodeId: archivedNodes[0]?.id || null,
      files: archivedNodes.map((n) => n.name),
      nodes: archivedNodes,
    };
  });

  app.post('/internal/storage/sheets/autosave', async (request, reply) => {
    const rawBody = JSON.stringify(request.body || {});
    const valid = verifyInternalEvent(request.headers, rawBody);
    if (!valid) {
      return reply.code(401).send({ error: 'INTERNAL_AUTH_FAILED', message: 'Assinatura M2M inválida.' });
    }

    const { tenantId, fileId, user, tabs, cellHistoryEntries = [] } = request.body || {};
    const node = await storageRepo.getNodeById(tenantId, fileId);
    if (!node || node.is_trashed) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Planilha não encontrada.' });
    }

    // Record explicit per-actor history entries if supplied by WS hub
    if (Array.isArray(cellHistoryEntries) && cellHistoryEntries.length > 0) {
      await storageRepo.appendSheetCellHistory(
        tenantId,
        node.id,
        cellHistoryEntries.map((h) => ({
          rev: Number(request.body?.rev || 1),
          tabName: h.tabName || 'Planilha1',
          cellRef: h.cellRef,
          oldValue: h.oldValue,
          newValue: h.newValue,
          oldFormula: h.oldFormula,
          newFormula: h.newFormula,
          actorEmail: h.actorEmail || user?.email,
          actorName: h.actorName || user?.name || user?.email,
        })),
      );
    }

    const evaluatedTabs = normalizeWorkbookTabs(tabs);
    const binaryBuf = serializeWorkbookToBinary(evaluatedTabs, node.name);
    const sha256Hash = crypto.createHash('sha256').update(binaryBuf).digest('hex');

    const oldSize = Number(node.size_bytes ?? 0);
    const delta = binaryBuf.length - oldSize;
    if (delta > 0) await storageRepo.reserveQuota(tenantId, delta);

    const { driver } = await getConfiguredDriverOrThrow(tenantId);
    const nextVer = Number(node.current_version ?? 1) + 1;
    const verKey = `/.nexus_versions/${node.id}/v${nextVer}_${node.name}`;

    try {
      await driver.writeFile(node.storage_key || node.virtual_path, binaryBuf);
      await driver.writeFile(verKey, binaryBuf);
    } catch (writeErr) {
      if (delta > 0) await storageRepo.releaseQuota(tenantId, delta);
      throw writeErr;
    }

    if (delta < 0) await storageRepo.releaseQuota(tenantId, Math.abs(delta));

    await storageRepo.createVersion(tenantId, node.id, {
      storageKey: verKey,
      sizeBytes: binaryBuf.length,
      sha256Hash,
      uploadedByEmail: user?.email || 'ws-autosave@nexus.local',
    });

    await storageRepo.updateNode(tenantId, node.id, {
      sizeBytes: binaryBuf.length,
      sha256Hash,
      currentVersion: nextVer,
    });

    const savedSession = await storageRepo.upsertSheetSession(tenantId, node.id, {
      workbookJson: { sheets: evaluatedTabs, tabs: evaluatedTabs },
      lastSavedByEmail: user?.email || 'ws-autosave@nexus.local',
      force: true,
    });

    return {
      ok: true,
      fileId: node.id,
      rev: Number(savedSession.rev ?? 2),
      version: nextVer,
      savedAt: savedSession.updated_at || new Date().toISOString(),
    };
  });

  return app;
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const port = Number(process.env.PORT || 8005);
  const host = process.env.HOST || '0.0.0.0';
  buildStorageService({ logger: true }).then((app) =>
    app.listen({ port, host }).then(() => {
      console.log(`[service-storage] Online em http://${host}:${port}`);
    }),
  );
}
