// services/tests/microservices.test.js
// =============================================================================
// Suíte de Testes de Integração & Segurança Zero-Trust — 5 APIs & Gateway
// =============================================================================

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startAllMicroservices } from '../orchestrator.js';
import { DEFAULT_DEMO_AGENT_TOKEN, resetMemoryStoreWithSeed } from '../shared/db.js';
import {
  computeAuditChainHash,
  computeTermDocumentHash,
  signJwt,
} from '../shared/security.js';

describe('Nexus ITAM v3.0 — Malha de Microsserviços, Segurança Zero-Trust e 5 APIs', () => {
  let cluster;
  let adminToken;
  let colabToken;
  let rivalTenantToken;

  beforeAll(async () => {
    process.env.NEXUS_DB_MODE = 'memory';
    resetMemoryStoreWithSeed();
    cluster = await startAllMicroservices({ host: '127.0.0.1', basePort: 18100, logger: false });
  });

  afterAll(async () => {
    if (cluster) await cluster.closeAll();
  });

  it('1. Gateway /health reporta PostgreSQL/DB e todos os 4 microsserviços saudáveis + OpenAPI', async () => {
    const res = await fetch(`${cluster.gatewayUrl}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-request-id')).toBeTruthy();

    const body = await res.json();
    expect(body.overallStatus).toBe('healthy');
    expect(body.microservices).toHaveLength(4);
    expect(body.microservices.every((s) => s.status === 'healthy')).toBe(true);

    const specRes = await fetch(`${cluster.gatewayUrl}/openapi.json`);
    expect(specRes.status).toBe(200);
    const spec = await specRes.json();
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.paths['/ws/nexusdesk']).toBeDefined();
  });

  it('2. Autenticação Scrypt + JWT HS256 autentica Admin, Colaboradora e 2º Tenant e rejeita senha incorreta', async () => {
    const badRes = await fetch(`${cluster.gatewayUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@nexuscorp.com.br', password: 'WrongPassword!' }),
    });
    expect(badRes.status).toBe(401);

    const adminRes = await fetch(`${cluster.gatewayUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@nexuscorp.com.br', password: 'Nexus@2026!' }),
    });
    expect(adminRes.status).toBe(200);
    const adminData = await adminRes.json();
    expect(adminData.user.role).toBe('admin');
    expect(adminData.user.tenantId).toBe('nexus-corp');
    adminToken = adminData.accessToken;

    const meRes = await fetch(`${cluster.gatewayUrl}/api/v1/auth/me`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(meRes.status).toBe(200);

    const colabRes = await fetch(`${cluster.gatewayUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'mariana.costa@nexuscorp.com.br', password: 'Colab@2026!' }),
    });
    expect(colabRes.status).toBe(200);
    colabToken = (await colabRes.json()).accessToken;

    const rivalRes = await fetch(`${cluster.gatewayUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ti@alphalogistica.com.br', password: 'Alpha@2026!' }),
    });
    expect(rivalRes.status).toBe(200);
    rivalTenantToken = (await rivalRes.json()).accessToken;
  });

  it('3. Segurança Zero-Trust bloqueia tentativa de bypass direto no microsserviço com cabeçalho forjado', async () => {
    const spoofRes = await fetch(`http://127.0.0.1:${cluster.ports.assets}/api/v1/assets`, {
      headers: {
        'x-user-id': 'attacker',
        'x-user-role': 'owner',
        'x-tenant-id': 'nexus-corp',
        'x-gateway-timestamp': String(Date.now()),
        'x-gateway-signature': 'deadbeef0000forgedsignature',
      },
    });
    expect(spoofRes.status).toBe(403);
  });

  it('4. [API 1 - REST Assets] gera Tag Sequencial, cadastra ativo e garante isolamento Multi-Tenant e por Papel', async () => {
    const tagRes = await fetch(`${cluster.gatewayUrl}/api/v1/assets/next-tag?type=Notebook`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(tagRes.status).toBe(200);
    const tagInfo = await tagRes.json();
    expect(tagInfo.suggestedTag).toBe('NEX-NB-0003');

    const createRes = await fetch(`${cluster.gatewayUrl}/api/v1/assets`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        type: 'Notebook',
        brand: 'Apple',
        model: 'MacBook Pro 14 M3 Pro',
        serialNumber: 'C02ZM991L',
        assignedToName: 'Mariana Costa',
        assignedToEmail: 'mariana.costa@nexuscorp.com.br',
        purchaseValue: 15900,
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.internal_id).toBe('NEX-NB-0003');
    expect(typeof created.purchase_value).toBe('number');

    // Colaboradora Mariana só enxerga ativos alocados a ela (não enxerga NEX-NB-0002 do estoque!)
    const colabAssetsRes = await fetch(`${cluster.gatewayUrl}/api/v1/assets`, {
      headers: { authorization: `Bearer ${colabToken}` },
    });
    const colabAssets = await colabAssetsRes.json();
    expect(
      colabAssets.items.every(
        (a) => a.assigned_to_email === 'mariana.costa@nexuscorp.com.br',
      ),
    ).toBe(true);

    // Segundo Tenant (Alpha Logística) jamais enxerga ativos da Nexus Corp
    const rivalAssetsRes = await fetch(`${cluster.gatewayUrl}/api/v1/assets/${created.id}`, {
      headers: { authorization: `Bearer ${rivalTenantToken}` },
    });
    expect(rivalAssetsRes.status).toBe(404);

    // ID não-UUID nunca estoura 500
    const nonUuidRes = await fetch(`${cluster.gatewayUrl}/api/v1/assets/NEX-NB-0001`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(nonUuidRes.status).toBe(404);
  });

  it('5. [API 2 - REST Tickets] colaboradora abre chamado com SLA, comenta, RBAC bloqueia auto-fechamento e TI resolve', async () => {
    const createTkRes = await fetch(`${cluster.gatewayUrl}/api/v1/tickets`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${colabToken}`,
      },
      body: JSON.stringify({
        title: 'Solicitação de adaptador Thunderbolt Ethernet',
        description: 'Necessário para bancada de testes de hardware embarcado.',
        category: 'Periféricos',
        priority: 'medium',
        assetTag: 'NEX-NB-0001',
      }),
    });
    expect(createTkRes.status).toBe(201);
    const ticket = await createTkRes.json();
    expect(ticket.protocol).toMatch(/^CHM-\d{4}-\d{4,6}$/);

    // Comentário na thread de atendimento
    const commentRes = await fetch(
      `${cluster.gatewayUrl}/api/v1/tickets/${ticket.id}/comments`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ message: 'Separando adaptador no almoxarifado N2.' }),
      },
    );
    expect(commentRes.status).toBe(201);

    // RBAC: Colaboradora não pode mudar status operacional da fila de TI
    const forbiddenPatch = await fetch(
      `${cluster.gatewayUrl}/api/v1/tickets/${ticket.id}/status`,
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${colabToken}`,
        },
        body: JSON.stringify({ status: 'resolved' }),
      },
    );
    expect(forbiddenPatch.status).toBe(403);

    // Admin TI resolve o chamado
    const resolveRes = await fetch(
      `${cluster.gatewayUrl}/api/v1/tickets/${ticket.id}/status`,
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          status: 'resolved',
          resolutionNotes: 'Adaptador entregue no 4º andar e vinculado ao kit.',
        }),
      },
    );
    expect(resolveRes.status).toBe(200);
    const resolved = await resolveRes.json();
    expect(resolved.status).toBe('resolved');
  });

  it('6. [API 3 - REST Compliance] assina Termo CLT com HMAC-SHA256 e valida Hash-Chain imune à reordenação JSONB', async () => {
    // Prova unitária de determinismo contra reordenação de chaves PostgreSQL JSONB
    const docHashOrderA = computeTermDocumentHash({
      tenantId: 'nexus-corp',
      termType: 'entrega',
      employeeEmail: 'mariana.costa@nexuscorp.com.br',
      assetsSnapshot: [{ internalId: 'NEX-NB-0001', model: 'ThinkPad', serialNumber: 'PF4X' }],
      legalClause: 'Cláusula CLT',
    });
    const docHashOrderB = computeTermDocumentHash({
      tenantId: 'nexus-corp',
      termType: 'entrega',
      employeeEmail: 'mariana.costa@nexuscorp.com.br',
      assetsSnapshot: [{ model: 'ThinkPad', serialNumber: 'PF4X', internalId: 'NEX-NB-0001' }],
      legalClause: 'Cláusula CLT',
    });
    expect(docHashOrderA).toBe(docHashOrderB);

    const chainHashOrderA = computeAuditChainHash({
      prevHash: '0'.repeat(64),
      tenantId: 'nexus-corp',
      actorEmail: 'admin@nexuscorp.com.br',
      actorRole: 'admin',
      action: 'TEST',
      resourceType: 'term',
      resourceId: '1',
      payload: { termId: 'abc', tag: 'NEX-01', signedAt: new Date('2026-03-01T12:00:00.000Z') },
      createdAtIso: new Date('2026-03-01T12:00:00.000Z'),
    });
    const chainHashOrderB = computeAuditChainHash({
      prevHash: '0'.repeat(64),
      tenantId: 'nexus-corp',
      actorEmail: 'admin@nexuscorp.com.br',
      actorRole: 'admin',
      action: 'TEST',
      resourceType: 'term',
      resourceId: '1',
      payload: { tag: 'NEX-01', signedAt: '2026-03-01T12:00:00.000Z', termId: 'abc' },
      createdAtIso: '2026-03-01T12:00:00.000Z',
    });
    expect(chainHashOrderA).toBe(chainHashOrderB);

    const termsRes = await fetch(`${cluster.gatewayUrl}/api/v1/compliance/terms?status=pending`, {
      headers: { authorization: `Bearer ${colabToken}` },
    });
    const pendingList = await termsRes.json();
    expect(pendingList.items.length).toBeGreaterThanOrEqual(1);
    const pendingTerm = pendingList.items[0];

    const signRes = await fetch(
      `${cluster.gatewayUrl}/api/v1/compliance/terms/${pendingTerm.id}/sign`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${colabToken}` },
      },
    );
    expect(signRes.status).toBe(200);
    const signBody = await signRes.json();
    expect(signBody.term.signature_hash).toHaveLength(64);
    expect(signBody.auditProof.entryHash).toHaveLength(64);

    // Verificação criptográfica independente do documento assinado
    const verifyRes = await fetch(
      `${cluster.gatewayUrl}/api/v1/compliance/terms/${pendingTerm.id}/verify`,
      {
        headers: { authorization: `Bearer ${colabToken}` },
      },
    );
    const verifyBody = await verifyRes.json();
    expect(verifyBody.documentIntact).toBe(true);
    expect(verifyBody.signatureValid).toBe(true);

    // Prova matemática de integridade de toda a Hash-Chain de auditoria
    const chainRes = await fetch(
      `${cluster.gatewayUrl}/api/v1/compliance/audit/verify-chain`,
      {
        headers: { authorization: `Bearer ${adminToken}` },
      },
    );
    const chainBody = await chainRes.json();
    expect(chainBody.intact).toBe(true);
    expect(chainBody.checkedRecords).toBeGreaterThanOrEqual(2);
  });

  it('7. [API 4 - REST Telemetry] valida X-Agent-Token timing-safe, despacha comando remoto e consolida frota', async () => {
    const badAgent = await fetch(`${cluster.gatewayUrl}/api/v1/telemetry/heartbeat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-agent-token': 'invalid_token',
        'x-tenant-id': 'nexus-corp',
      },
      body: JSON.stringify({
        deviceKey: 'HACK-01',
        hostname: 'ROGUE-PC',
        cpuPercent: 10,
        ramPercent: 20,
      }),
    });
    expect(badAgent.status).toBe(401);

    const goodAgent = await fetch(`${cluster.gatewayUrl}/api/v1/telemetry/heartbeat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-agent-token': DEFAULT_DEMO_AGENT_TOKEN,
        'x-tenant-id': 'nexus-corp',
      },
      body: JSON.stringify({
        deviceKey: 'WKS-LAB-009',
        hostname: 'NEX-LAB-DEV09',
        serialNumber: 'SN-LAB-009',
        cpuPercent: 37.4,
        ramPercent: 58.1,
        diskPercent: 49.0,
      }),
    });
    expect(goodAgent.status).toBe(201);
    const hbBody = await goodAgent.json();
    expect(typeof hbBody.device.cpu_percent).toBe('number');

    const cmdRes = await fetch(`${cluster.gatewayUrl}/api/v1/telemetry/commands`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        deviceKey: 'WKS-LAB-009',
        commandType: 'force_inventory',
      }),
    });
    expect(cmdRes.status).toBe(201);

    const fleetRes = await fetch(`${cluster.gatewayUrl}/api/v1/telemetry/fleet`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(fleetRes.status).toBe(200);
    const fleet = await fleetRes.json();
    expect(fleet.summary.totalDevices).toBeGreaterThanOrEqual(3);
  });

  it('8. [API 5 - NÃO-REST WebSocket Bidirecional] realiza handshake, ping/pong, broadcast e aplica isolamento LGPD por colaborador', async () => {
    const adminFrames = [];
    const otherColabFrames = [];
    const otherColabToken = signJwt({
      sub: '11111111-1111-4111-8111-111111111199',
      email: 'joao.silva@nexuscorp.com.br',
      name: 'João Silva',
      role: 'collaborator',
      tenantId: 'nexus-corp',
      department: 'Financeiro',
    });

    const otherColabWs = new WebSocket(
      `${cluster.wsUrl}?token=${encodeURIComponent(otherColabToken)}&client=vitest-other`,
    );
    await new Promise((resolve, reject) => {
      otherColabWs.on('message', (raw) => {
        const f = JSON.parse(String(raw));
        otherColabFrames.push(f);
        if (f.event === 'welcome') resolve();
      });
      otherColabWs.on('error', reject);
    });

    let pendingTicketPost = Promise.resolve();

    await new Promise((resolve, reject) => {
      const ws = new WebSocket(`${cluster.wsUrl}?token=${encodeURIComponent(adminToken)}&client=vitest`);
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Timeout aguardando eventos WebSocket'));
      }, 8000);

      ws.on('message', (raw) => {
        const frame = JSON.parse(String(raw));
        adminFrames.push(frame);

        if (frame.event === 'welcome') {
          ws.send(JSON.stringify({ action: 'ping', id: 'hc-1' }));
        } else if (frame.event === 'pong') {
          // Dispara abertura de chamado de Mariana na API 2 e aguarda chegada no WebSocket Admin!
          pendingTicketPost = fetch(`${cluster.gatewayUrl}/api/v1/tickets`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${colabToken}`,
            },
            body: JSON.stringify({
              title: 'Evento em Tempo Real WebSocket Test',
              description: 'Validando propagação instantânea entre microsserviços.',
              priority: 'high',
            }),
          });
        } else if (frame.event === 'ticket.created') {
          clearTimeout(timeout);
          ws.once('close', () => resolve());
          ws.close();
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    await pendingTicketPost;
    await new Promise((resolve) => {
      otherColabWs.once('close', resolve);
      otherColabWs.close();
    });

    expect(adminFrames.some((f) => f.event === 'welcome')).toBe(true);
    expect(adminFrames.some((f) => f.event === 'pong' && f.echoId === 'hc-1')).toBe(true);
    expect(
      adminFrames.some(
        (f) =>
          f.event === 'ticket.created' &&
          f.data?.title === 'Evento em Tempo Real WebSocket Test',
      ),
    ).toBe(true);

    // LGPD: João Silva (outro colaborador do mesmo tenant) NÃO recebe o ticket de Mariana!
    expect(otherColabFrames.some((f) => f.event === 'ticket.created')).toBe(false);
  });
});
