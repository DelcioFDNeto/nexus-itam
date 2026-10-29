// services/shared/security.js
// =============================================================================
// Núcleo de Segurança Corporativa Zero-Trust — Nexus ITAM Microservices v3.0
// =============================================================================
// Implementa usando exclusivamente primitivas auditáveis do `node:crypto`:
//  1. Hashing de senhas com `scrypt` + salt aleatório de 16 bytes + timingSafeEqual
//  2. Assinatura e verificação JWT (RFC 7519 HS256) sem dependências inchadas
//  3. Assinatura Zero-Trust entre API Gateway e Microsserviços (X-Gateway-Signature)
//  4. Assinatura Criptográfica HMAC-SHA256 de Termos Jurídicos CLT
//  5. Encadeamento Imutável de Auditoria (Hash-Chain / Tamper-Evident Log)
//  6. Sanitização de strings e verificação RBAC por papel
// =============================================================================

import crypto from 'node:crypto';

const IS_PROD = process.env.NODE_ENV === 'production';

const resolveSecret = (envNames, devFallback) => {
  const candidates = Array.isArray(envNames) ? envNames : [envNames];
  for (const name of candidates) {
    const val = process.env[name];
    if (val && val.trim().length >= 24) return val.trim();
  }
  if (IS_PROD) {
    throw new Error(
      `[SECURITY FATAL] Variável ${candidates[0]} ausente ou menor que 24 caracteres em produção.`,
    );
  }
  return devFallback;
};

export const JWT_SECRET = () =>
  resolveSecret(['NEXUS_JWT_SECRET', 'JWT_SECRET'], 'nexus-itam-dev-jwt-secret-key-2026-academic-v3');

export const INTERNAL_GATEWAY_SECRET = () =>
  resolveSecret(
    ['NEXUS_INTERNAL_SECRET', 'INTERNAL_GATEWAY_SECRET'],
    'nexus-itam-zero-trust-gateway-hmac-secret-2026',
  );

export const COMPLIANCE_SIGNING_SECRET = () =>
  resolveSecret(
    ['NEXUS_COMPLIANCE_SECRET', 'LEGAL_SIGNING_SECRET'],
    'nexus-itam-clt-compliance-hmac-seal-2026-key',
  );

// -----------------------------------------------------------------------------
// 1. Password Hashing (Scrypt + Timing-Safe Verification)
// -----------------------------------------------------------------------------
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(plainPassword) {
  const password = String(plainPassword || '');
  if (password.length < 8) {
    throw new Error('A senha deve possuir no mínimo 8 caracteres.');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto
    .scryptSync(password, salt, SCRYPT_PARAMS.keylen, {
      N: SCRYPT_PARAMS.N,
      r: SCRYPT_PARAMS.r,
      p: SCRYPT_PARAMS.p,
    })
    .toString('hex');
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt}$${derived}`;
}

export function verifyPassword(plainPassword, storedHash) {
  if (!plainPassword || !storedHash || typeof storedHash !== 'string') return false;
  const parts = storedHash.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, salt, expectedHex] = parts;
  try {
    const derived = crypto.scryptSync(String(plainPassword), salt, expectedHex.length / 2, {
      N: Number(nStr),
      r: Number(rStr),
      p: Number(pStr),
    });
    const expectedBuf = Buffer.from(expectedHex, 'hex');
    if (derived.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(derived, expectedBuf);
  } catch {
    return false;
  }
}

// -----------------------------------------------------------------------------
// 2. Stateless JWT (RFC 7519 — HS256 com Timing-Safe Signature Check)
// -----------------------------------------------------------------------------
const base64UrlEncode = (input) =>
  Buffer.from(typeof input === 'string' ? input : JSON.stringify(input))
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

const base64UrlDecode = (str) => {
  const pad = 4 - (str.length % 4 || 4);
  const normalized = str.replace(/-/g, '+').replace(/_/g, '/') + (pad < 4 ? '='.repeat(pad) : '');
  return Buffer.from(normalized, 'base64').toString('utf8');
};

export function signJwt(claims, expiresInSeconds = 8 * 3600) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    ...claims,
    jti: claims.jti || crypto.randomUUID(),
    iss: 'nexus-itam-gateway',
    iat: now,
    exp: now + expiresInSeconds,
  };

  const encodedHeader = base64UrlEncode(header);
  const encodedPayload = base64UrlEncode(payload);
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto
    .createHmac('sha256', JWT_SECRET())
    .update(signingInput)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${signingInput}.${signature}`;
}

export function verifyJwt(token) {
  if (!token || typeof token !== 'string') {
    throw new Error('Token de autenticação ausente.');
  }
  const clean = token.replace(/^Bearer\s+/i, '').trim();
  const segments = clean.split('.');
  if (segments.length !== 3) {
    throw new Error('Formato de token JWT inválido.');
  }

  const [encodedHeader, encodedPayload, providedSig] = segments;
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expectedSig = crypto
    .createHmac('sha256', JWT_SECRET())
    .update(signingInput)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('Assinatura criptográfica do JWT inválida.');
  }

  const header = JSON.parse(base64UrlDecode(encodedHeader));
  if (header.alg !== 'HS256') {
    throw new Error('Algoritmo JWT não permitido.');
  }

  const payload = JSON.parse(base64UrlDecode(encodedPayload));
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) {
    throw new Error('Sessão expirada. Realize novo login.');
  }
  if (!payload.sub || !payload.tenantId || !payload.role) {
    throw new Error('Claims obrigatórias ausentes no token.');
  }

  return payload;
}

// -----------------------------------------------------------------------------
// 3. Zero-Trust Inter-Service Gateway Signature (Anti-Spoofing)
// -----------------------------------------------------------------------------
export function signGatewayContext({ userId, email, name, role, tenantId, requestId }) {
  const timestamp = String(Date.now());
  const canonical = `${userId}|${email}|${role}|${tenantId}|${requestId}|${timestamp}`;
  const sig = crypto
    .createHmac('sha256', INTERNAL_GATEWAY_SECRET())
    .update(canonical)
    .digest('hex');

  return {
    'x-user-id': String(userId),
    'x-user-email': String(email),
    'x-user-name': encodeURIComponent(String(name || '')),
    'x-user-role': String(role),
    'x-tenant-id': String(tenantId),
    'x-request-id': String(requestId),
    'x-gateway-timestamp': timestamp,
    'x-gateway-signature': sig,
  };
}

export function verifyGatewayOrJwt(request) {
  const gwSig = request.headers['x-gateway-signature'];
  const gwTs = request.headers['x-gateway-timestamp'];

  if (gwSig && gwTs) {
    const ageMs = Math.abs(Date.now() - Number(gwTs));
    if (Number.isNaN(ageMs) || ageMs > 60_000) {
      const err = new Error('Assinatura interna do Gateway expirada (replay protection).');
      err.statusCode = 401;
      throw err;
    }

    const userId = request.headers['x-user-id'] || '';
    const email = request.headers['x-user-email'] || '';
    const rawName = request.headers['x-user-name'] || '';
    const role = request.headers['x-user-role'] || '';
    const tenantId = request.headers['x-tenant-id'] || '';
    const requestId = request.headers['x-request-id'] || '';

    const canonical = `${userId}|${email}|${role}|${tenantId}|${requestId}|${gwTs}`;
    const expected = crypto
      .createHmac('sha256', INTERNAL_GATEWAY_SECRET())
      .update(canonical)
      .digest('hex');

    const a = Buffer.from(String(gwSig));
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      const err = new Error('Violação Zero-Trust: cabeçalhos internos adulterados.');
      err.statusCode = 403;
      throw err;
    }

    return {
      sub: userId,
      email,
      name: decodeURIComponent(rawName),
      role,
      tenantId,
    };
  }

  // Fallback direto: permite testes diretos com Bearer JWT válido
  const authHeader = request.headers.authorization;
  if (!authHeader) {
    const err = new Error('Autenticação obrigatória (Bearer JWT ou Gateway Zero-Trust).');
    err.statusCode = 401;
    throw err;
  }

  try {
    return verifyJwt(authHeader);
  } catch (e) {
    const err = new Error(e.message || 'Token inválido.');
    err.statusCode = 401;
    throw err;
  }
}

export function signInternalEvent(payloadString) {
  const ts = String(Date.now());
  const sig = crypto
    .createHmac('sha256', INTERNAL_GATEWAY_SECRET())
    .update(`${ts}.${payloadString}`)
    .digest('hex');
  return { 'x-internal-ts': ts, 'x-internal-sig': sig };
}

export function verifyInternalEvent(headers, payloadString) {
  const ts = headers['x-internal-ts'];
  const sig = headers['x-internal-sig'];
  if (!ts || !sig) return false;
  if (Math.abs(Date.now() - Number(ts)) > 60_000) return false;
  const expected = crypto
    .createHmac('sha256', INTERNAL_GATEWAY_SECRET())
    .update(`${ts}.${payloadString}`)
    .digest('hex');
  const a = Buffer.from(String(sig));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// -----------------------------------------------------------------------------
// 4. Compliance Cryptographic Seals & Hash-Chain (JSONB-Deterministic)
// -----------------------------------------------------------------------------
export const GENESIS_HASH = '0'.repeat(64);

/**
 * Ordena recursivamente chaves de objetos e converte instâncias Date para ISO,
 * garantindo que a serialização canônica seja 100% idêntica antes e depois de
 * persistir em colunas PostgreSQL 16 `JSONB` (que reordenam chaves internamente).
 */
export function canonicalizeForHash(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalizeForHash);
  if (value !== null && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) {
        sorted[key] = canonicalizeForHash(value[key]);
      }
    }
    return sorted;
  }
  return value;
}

export function sha256Hex(data) {
  const serialized = typeof data === 'string' ? data : JSON.stringify(canonicalizeForHash(data));
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

export function computeTermDocumentHash({ tenantId, termType, employeeEmail, assetsSnapshot, legalClause }) {
  const canonical = JSON.stringify(
    canonicalizeForHash({
      tenantId,
      termType,
      employeeEmail: String(employeeEmail || '').toLowerCase().trim(),
      assets: Array.isArray(assetsSnapshot) ? assetsSnapshot : [],
      legalClause: String(legalClause || '').trim(),
    }),
  );
  return sha256Hex(canonical);
}

export function signResponsibilityTerm({ termId, tenantId, employeeEmail, documentHash, signedAt }) {
  const normalizedSignedAt =
    signedAt instanceof Date ? signedAt.toISOString() : String(signedAt || '');
  const canonical = `${termId}|${tenantId}|${String(employeeEmail).toLowerCase().trim()}|${documentHash}|${normalizedSignedAt}`;
  return crypto
    .createHmac('sha256', COMPLIANCE_SIGNING_SECRET())
    .update(canonical)
    .digest('hex');
}

export function verifyResponsibilityTermSignature({
  termId,
  tenantId,
  employeeEmail,
  documentHash,
  signedAt,
  signatureHash,
}) {
  if (!signatureHash || !signedAt) return false;
  const normalizedSignedAt =
    signedAt instanceof Date ? signedAt.toISOString() : String(signedAt || '');
  const expected = signResponsibilityTerm({
    termId,
    tenantId,
    employeeEmail,
    documentHash,
    signedAt: normalizedSignedAt,
  });
  const a = Buffer.from(String(signatureHash));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function computeAuditChainHash({
  prevHash,
  tenantId,
  actorEmail,
  actorRole,
  action,
  resourceType,
  resourceId,
  payload,
  createdAtIso,
}) {
  const normalizedCreatedAt =
    createdAtIso instanceof Date ? createdAtIso.toISOString() : String(createdAtIso || '');
  const canonical = JSON.stringify(
    canonicalizeForHash({
      prevHash: prevHash || GENESIS_HASH,
      tenantId,
      actorEmail,
      actorRole,
      action,
      resourceType: String(resourceType),
      resourceId: String(resourceId),
      payload: payload || {},
      createdAtIso: normalizedCreatedAt,
    }),
  );
  return sha256Hex(canonical);
}

// -----------------------------------------------------------------------------
// 5. Agent Token Hashing & Verification
// -----------------------------------------------------------------------------
export function hashAgentToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken || '')).digest('hex');
}

export function verifyAgentToken(rawToken, expectedHash) {
  if (!rawToken || !expectedHash) return false;
  const actual = Buffer.from(hashAgentToken(rawToken), 'hex');
  const expected = Buffer.from(String(expectedHash), 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// -----------------------------------------------------------------------------
// 6. RBAC Guard & Input Sanitization
// -----------------------------------------------------------------------------
export const ROLE_HIERARCHY = {
  collaborator: 10,
  viewer: 20,
  operator: 30,
  manager: 40,
  admin: 50,
  owner: 60,
};

export function requireRoles(user, allowedRoles) {
  if (!user || !allowedRoles.includes(user.role)) {
    const err = new Error(
      `Acesso negado (RBAC): papel '${user?.role || 'anônimo'}' não possui permissão para esta operação.`,
    );
    err.statusCode = 403;
    throw err;
  }
}

export function sanitizeText(value, maxLength = 500) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/[<>]/g, (ch) => (ch === '<' ? '‹' : '›'))
    .trim()
    .slice(0, maxLength);
}
