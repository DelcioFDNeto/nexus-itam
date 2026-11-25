// services/tests/agent_package_download.test.js
// =============================================================================
// Validação E2E — Pacote ZIP Pré-Configurado do Agente (Tenant + Patrimônio Ativo)
// =============================================================================

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAllMicroservices } from '../orchestrator.js';
import { resetMemoryStoreWithSeed } from '../shared/db.js';
import { signJwt } from '../shared/security.js';

function extractZipTextEntry(zipBuf, fileName) {
  // Parser simples de entradas PKZIP store (method 0) geradas por buildZipArchive
  let offset = 0;
  while (offset + 30 <= zipBuf.length) {
    const sig = zipBuf.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;
    const compSize = zipBuf.readUInt32LE(offset + 18);
    const nameLen = zipBuf.readUInt16LE(offset + 26);
    const extraLen = zipBuf.readUInt16LE(offset + 28);
    const name = zipBuf.subarray(offset + 30, offset + 30 + nameLen).toString('utf8');
    const dataStart = offset + 30 + nameLen + extraLen;
    const dataEnd = dataStart + compSize;
    if (name === fileName) {
      return zipBuf.subarray(dataStart, dataEnd);
    }
    offset = dataEnd;
  }
  return null;
}

describe('Pacote Pré-Configurado do Agente (/api/v1/agent/package)', () => {
  let cluster;
  let ownerToken;
  let colabToken;

  beforeAll(async () => {
    process.env.NEXUS_DB_MODE = 'memory';
    resetMemoryStoreWithSeed();
    cluster = await startAllMicroservices({ host: '127.0.0.1', basePort: 18460, logger: false });
    ownerToken = signJwt({
      sub: '11111111-2222-4333-8444-555555555555',
      email: 'ti@shineraybysabel.com.br',
      name: 'Délcio Farias',
      role: 'owner',
      tenantId: 'tenant-ap3htf6',
      department: 'TI',
    });
    colabToken = signJwt({
      sub: '22222222-3333-4444-8555-666666666666',
      email: 'karen.matos@shineraybysabel.com.br',
      name: 'Karen Matos',
      role: 'collaborator',
      tenantId: 'tenant-ap3htf6',
      department: 'Financeiro',
    });
  }, 45_000);

  afterAll(async () => {
    if (cluster) await cluster.closeAll();
  }, 45_000);

  it('sincroniza config do tenant (owner) e bloqueia colaborador em PUT /api/v1/auth/agent-config', async () => {
    const forbidden = await fetch(`${cluster.gatewayUrl}/api/v1/auth/agent-config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${colabToken}` },
      body: JSON.stringify({ agentToken: 'agt_forged_123456' }),
    });
    expect(forbidden.status).toBe(403);

    const okRes = await fetch(`${cluster.gatewayUrl}/api/v1/auth/agent-config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({
        agentToken: 'agt_tenant_real_token_2026',
        projectId: 'itam-nexus',
        apiKey: 'AIzaSyTestPublicWebApiKey123',
        relayBase: 'https://itam-api-164-152-195-199.sslip.io',
      }),
    });
    expect(okRes.status).toBe(200);
    const saved = await okRes.json();
    expect(saved.configured).toBe(true);
    expect(saved.agentVersion).toBe('3.5.0');

    const statusRes = await fetch(`${cluster.gatewayUrl}/api/v1/auth/agent-config/status`, {
      headers: { authorization: `Bearer ${colabToken}` },
    });
    expect(statusRes.status).toBe(200);
    const statusJson = await statusRes.json();
    expect(statusJson.configured).toBe(true);
    expect(JSON.stringify(statusJson)).not.toContain('agt_tenant_real_token_2026');
  });

  it('gera ZIP pré-configurado com NexusAgent.exe + config.json do tenant e patrimônio da custódia do colaborador, bloqueando patrimônio de terceiro', async () => {
    // Colaboradora baixa pacote para seu ativo em custódia (auto-detectado ou explícito)
    const pkgRes = await fetch(`${cluster.gatewayUrl}/api/v1/agent/package`, {
      headers: { authorization: `Bearer ${colabToken}` },
    });
    expect(pkgRes.status).toBe(200);
    expect(pkgRes.headers.get('content-type')).toContain('application/zip');
    expect(pkgRes.headers.get('x-nexus-agent-configured')).toBe('true');

    const zipBuf = Buffer.from(await pkgRes.arrayBuffer());
    expect(zipBuf.readUInt32LE(0)).toBe(0x04034b50);

    const exeBuf = extractZipTextEntry(zipBuf, 'NexusAgent.exe');
    expect(exeBuf).not.toBeNull();
    expect(exeBuf.length).toBeGreaterThan(30_000);

    const cfgRaw = extractZipTextEntry(zipBuf, 'config.json');
    expect(cfgRaw).not.toBeNull();
    const cfg = JSON.parse(cfgRaw.toString('utf8'));
    expect(cfg.tenantId).toBe('tenant-ap3htf6');
    expect(cfg.agentToken).toBe('agt_tenant_real_token_2026');
    expect(cfg.projectId).toBe('itam-nexus');
    expect(cfg.apiKey).toBe('AIzaSyTestPublicWebApiKey123');
    expect(cfg.relayBase).toBe('https://itam-api-164-152-195-199.sslip.io');
    expect(cfg.patrimony).toMatch(/^SHL-/);

    // Colaboradora tentando gerar pacote para patrimônio que não está em sua custódia -> 403
    const otherRes = await fetch(`${cluster.gatewayUrl}/api/v1/agent/package?patrimony=SHL-OUTRO-999`, {
      headers: { authorization: `Bearer ${colabToken}` },
    });
    expect(otherRes.status).toBe(403);
  });
});
