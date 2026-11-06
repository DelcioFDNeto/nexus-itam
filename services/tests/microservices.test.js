// services/tests/microservices.test.js
// =============================================================================
// Suíte de Testes de Integração & Segurança Zero-Trust — 5 APIs & Gateway
// 100% Produção Shineray — Sem Perfis ou Tenants de Demonstração Hardcoded
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

describe('Nexus ITAM v3.0 — Malha de Microsserviços, Segurança Zero-Trust e 5 APIs (Produção Shineray)', () => {
  let cluster;
  let adminToken;
  let ownerToken;
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

  it('2. Autenticação Scrypt + JWT HS256 autentica TI (Dono & Admin), Colaboradora e isola Tenants rejeitando senha incorreta', async () => {
    const badRes = await fetch(`${cluster.gatewayUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ti@shineraybysabel.com.br', password: 'WrongPassword!' }),
    });
    expect(badRes.status).toBe(401);

    // ti@shineraybysabel.com.br é o Dono (owner) e Gestor de TI oficial
    const tiRes = await fetch(`${cluster.gatewayUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ti@shineraybysabel.com.br', password: 'Shineray@2026!' }),
    });
    expect(tiRes.status).toBe(200);
    const tiData = await tiRes.json();
    expect(tiData.user.role).toBe('owner');
    expect(tiData.user.tenantId).toBe('tenant-ap3htf6');
    adminToken = tiData.accessToken;
    ownerToken = tiData.accessToken;

    const meRes = await fetch(`${cluster.gatewayUrl}/api/v1/auth/me`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(meRes.status).toBe(200);

    // Perfil de Colaboradora (collaborator) ativo para Portal do Colaborador
    const colabRes = await fetch(`${cluster.gatewayUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'karen.matos@shineraybysabel.com.br', password: 'Colab@2026!' }),
    });
    expect(colabRes.status).toBe(200);
    colabToken = (await colabRes.json()).accessToken;

    // Token criptográfico de inquilino externo para prova de isolamento estrito
    rivalTenantToken = signJwt({
      sub: '99999999-9999-4999-8999-999999999999',
      email: 'auditor@externo-isolado.com.br',
      name: 'Auditor Externo',
      role: 'admin',
      tenantId: 'tenant-externo-isolado',
    });
  });

  it('3. Segurança Zero-Trust bloqueia tentativa de bypass direto no microsserviço com cabeçalho forjado', async () => {
    const spoofRes = await fetch(`http://127.0.0.1:${cluster.ports.assets}/api/v1/assets`, {
      headers: {
        'x-user-id': 'attacker',
        'x-user-role': 'owner',
        'x-tenant-id': 'tenant-ap3htf6',
        'x-gateway-timestamp': String(Date.now()),
        'x-gateway-signature': 'deadbeef0000forgedsignature',
      },
    });
    expect(spoofRes.status).toBe(403);
  });

  it('4. [API 1 - REST Assets] gera Tag Sequencial Shineray (SHL), cadastra ativo e garante isolamento Multi-Tenant e por Papel', async () => {
    const tagRes = await fetch(`${cluster.gatewayUrl}/api/v1/assets/next-tag?type=Notebook`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(tagRes.status).toBe(200);
    const tagInfo = await tagRes.json();
    expect(tagInfo.suggestedTag).toMatch(/^SHL-[A-Z0-9-]+-\d+$/);

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
        assignedToName: 'Karen Matos',
        assignedToEmail: 'karen.matos@shineraybysabel.com.br',
        purchaseValue: 15900,
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.internal_id).toBe(tagInfo.suggestedTag);
    expect(typeof created.purchase_value).toBe('number');

    // Colaboradora Karen só enxerga ativos alocados a ela (não enxerga SHL-BEL-NTB-003 do estoque!)
    const colabAssetsRes = await fetch(`${cluster.gatewayUrl}/api/v1/assets`, {
      headers: { authorization: `Bearer ${colabToken}` },
    });
    const colabAssets = await colabAssetsRes.json();
    expect(
      colabAssets.items.every(
        (a) => a.assigned_to_email === 'karen.matos@shineraybysabel.com.br',
      ),
    ).toBe(true);

    // Inquilino externo jamais enxerga ativos da Shineray
    const rivalAssetsRes = await fetch(`${cluster.gatewayUrl}/api/v1/assets/${created.id}`, {
      headers: { authorization: `Bearer ${rivalTenantToken}` },
    });
    expect(rivalAssetsRes.status).toBe(404);

    // ID não-UUID nunca estoura 500
    const nonUuidRes = await fetch(`${cluster.gatewayUrl}/api/v1/assets/SHL-BEL-NTB-001`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(nonUuidRes.status).toBe(404);
  });

  it('5. [API 2 - REST Tickets] colaboradora abre chamado, Dono opera cluster comentando e resolvendo com RBAC', async () => {
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
        assetTag: 'SHL-BEL-NTB-007',
      }),
    });
    expect(createTkRes.status).toBe(201);
    const ticket = await createTkRes.json();
    expect(ticket.protocol).toMatch(/^CHM-\d{4}-\d{4,6}$/);

    // Operação do Dono (role: owner): Comentário na thread de atendimento
    const commentRes = await fetch(
      `${cluster.gatewayUrl}/api/v1/tickets/${ticket.id}/comments`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({ message: 'Aprovado pela Diretoria para aquisição imediata.' }),
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

    // Dono (role: owner) opera o cluster e resolve o chamado
    const resolveRes = await fetch(
      `${cluster.gatewayUrl}/api/v1/tickets/${ticket.id}/status`,
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          status: 'resolved',
          resolutionNotes: 'Adaptador entregue e ativado com homologação do Dono.',
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
      tenantId: 'tenant-ap3htf6',
      termType: 'entrega',
      employeeEmail: 'karen.matos@shineraybysabel.com.br',
      assetsSnapshot: [{ internalId: 'SHL-BEL-NTB-007', model: 'Dell Inspiron 15', serialNumber: '8XYZ123' }],
      legalClause: 'Cláusula CLT',
    });
    const docHashOrderB = computeTermDocumentHash({
      tenantId: 'tenant-ap3htf6',
      termType: 'entrega',
      employeeEmail: 'karen.matos@shineraybysabel.com.br',
      assetsSnapshot: [{ model: 'Dell Inspiron 15', serialNumber: '8XYZ123', internalId: 'SHL-BEL-NTB-007' }],
      legalClause: 'Cláusula CLT',
    });
    expect(docHashOrderA).toBe(docHashOrderB);

    const chainHashOrderA = computeAuditChainHash({
      prevHash: '0'.repeat(64),
      tenantId: 'tenant-ap3htf6',
      actorEmail: 'ti@shineraybysabel.com.br',
      actorRole: 'owner',
      action: 'TEST',
      resourceType: 'term',
      resourceId: '1',
      payload: { termId: 'abc', tag: 'SHL-BEL-NTB-007', signedAt: new Date('2026-03-01T12:00:00.000Z') },
      createdAtIso: new Date('2026-03-01T12:00:00.000Z'),
    });
    const chainHashOrderB = computeAuditChainHash({
      prevHash: '0'.repeat(64),
      tenantId: 'tenant-ap3htf6',
      actorEmail: 'ti@shineraybysabel.com.br',
      actorRole: 'owner',
      action: 'TEST',
      resourceType: 'term',
      resourceId: '1',
      payload: { tag: 'SHL-BEL-NTB-007', signedAt: '2026-03-01T12:00:00.000Z', termId: 'abc' },
      createdAtIso: '2026-03-01T12:00:00.000Z',
    });
    expect(chainHashOrderA).toBe(chainHashOrderB);

    // João da Silva possui termo pendente no seed Shineray
    const joaoLogin = await fetch(`${cluster.gatewayUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'joao.silva@shineray.com.br', password: 'Colab@2026!' }),
    });
    expect(joaoLogin.status).toBe(200);
    const joaoToken = (await joaoLogin.json()).accessToken;

    const termsRes = await fetch(`${cluster.gatewayUrl}/api/v1/compliance/terms?status=pending`, {
      headers: { authorization: `Bearer ${joaoToken}` },
    });
    const pendingList = await termsRes.json();
    expect(pendingList.items.length).toBeGreaterThanOrEqual(1);
    const pendingTerm = pendingList.items[0];

    const signRes = await fetch(
      `${cluster.gatewayUrl}/api/v1/compliance/terms/${pendingTerm.id}/sign`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${joaoToken}` },
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
        headers: { authorization: `Bearer ${joaoToken}` },
      },
    );
    const verifyBody = await verifyRes.json();
    expect(verifyBody.documentIntact).toBe(true);
    expect(verifyBody.signatureValid).toBe(true);

    // Prova matemática de integridade de toda a Hash-Chain de auditoria
    const chainRes = await fetch(
      `${cluster.gatewayUrl}/api/v1/compliance/audit/verify-chain`,
      {
        headers: { authorization: `Bearer ${ownerToken}` },
      },
    );
    const chainBody = await chainRes.json();
    expect(chainBody.intact).toBe(true);
    expect(chainBody.checkedRecords).toBeGreaterThanOrEqual(2);
  });

  it('7. [API 4 - REST Telemetry] valida X-Agent-Token timing-safe, Dono despacha comando remoto e consolida frota', async () => {
    const badAgent = await fetch(`${cluster.gatewayUrl}/api/v1/telemetry/heartbeat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-agent-token': 'invalid_token',
        'x-tenant-id': 'tenant-ap3htf6',
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
        'x-tenant-id': 'tenant-ap3htf6',
      },
      body: JSON.stringify({
        deviceKey: 'WKS-SHL-LAB-009',
        hostname: 'SHL-LAB-DEV09',
        serialNumber: 'SN-SHL-009',
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
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        deviceKey: 'WKS-SHL-LAB-009',
        commandType: 'force_inventory',
      }),
    });
    expect(cmdRes.status).toBe(201);

    const fleetRes = await fetch(`${cluster.gatewayUrl}/api/v1/telemetry/fleet`, {
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(fleetRes.status).toBe(200);
    const fleet = await fleetRes.json();
    expect(fleet.summary.totalDevices).toBeGreaterThanOrEqual(1);
  });

  it('8. [API 5 - NÃO-REST WebSocket Bidirecional] realiza handshake, ping/pong, broadcast e aplica isolamento LGPD por colaborador', async () => {
    const adminFrames = [];
    const otherColabFrames = [];
    const otherColabToken = signJwt({
      sub: '33333333-3333-4333-8333-333333333302',
      email: 'joao.silva@shineray.com.br',
      name: 'João da Silva',
      role: 'collaborator',
      tenantId: 'tenant-ap3htf6',
      department: 'Vendas Concessionária',
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
          // Dispara abertura de chamado de Karen na API 2 e aguarda chegada no WebSocket Admin!
          pendingTicketPost = fetch(`${cluster.gatewayUrl}/api/v1/tickets`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${colabToken}`,
            },
            body: JSON.stringify({
              title: 'Evento em Tempo Real WebSocket Shineray Test',
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
          f.data?.title === 'Evento em Tempo Real WebSocket Shineray Test',
      ),
    ).toBe(true);

    // LGPD: João Silva (outro colaborador do mesmo tenant) NÃO recebe o ticket de Karen!
    expect(otherColabFrames.some((f) => f.event === 'ticket.created')).toBe(false);
  });

  it('9. [Cadastro de Colaborador] Dono cadastra colaborador com senha aleatória e permite acesso imediato ao portal', async () => {
    const randomPassword = 'Shl#' + Math.random().toString(36).slice(2, 10) + '9!';
    const regRes = await fetch(`${cluster.gatewayUrl}/api/v1/auth/users`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        name: 'Roberto Souza Belém',
        email: 'roberto.souza@shineraybysabel.com.br',
        password: randomPassword,
        role: 'collaborator',
        department: 'Logística & Distribuição',
        jobTitle: 'Assistente de Logística',
      }),
    });
    expect(regRes.status).toBe(201);
    const regBody = await regRes.json();
    expect(regBody.user.email).toBe('roberto.souza@shineraybysabel.com.br');
    expect(regBody.user.role).toBe('collaborator');

    // Novo colaborador consegue autenticar imediatamente com a senha gerada
    const newLoginRes = await fetch(`${cluster.gatewayUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'roberto.souza@shineraybysabel.com.br',
        password: randomPassword,
      }),
    });
    expect(newLoginRes.status).toBe(200);
    const newLoginData = await newLoginRes.json();
    expect(newLoginData.user.role).toBe('collaborator');
    expect(newLoginData.user.tenantId).toBe('tenant-ap3htf6');
  });

  it('10. [Validação de Erros] Rejeita e-mail duplicado com 409, e-mail malformado e senha curta (< 8 chars)', async () => {
    // 1. E-mail duplicado
    const dupRes = await fetch(`${cluster.gatewayUrl}/api/v1/auth/users`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        name: 'Roberto Duplicado',
        email: 'roberto.souza@shineraybysabel.com.br',
        password: 'SenhaForte@2026!',
        role: 'collaborator',
      }),
    });
    expect(dupRes.status).toBe(409);
    const dupBody = await dupRes.json();
    expect(dupBody.error).toBe('USER_CREATION_FAILED');
    expect(dupBody.message).toMatch(/já cadastrado/i);

    // 2. E-mail malformado
    const badEmailRes = await fetch(`${cluster.gatewayUrl}/api/v1/auth/users`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        name: 'Email Invalido',
        email: 'email-sem-arroba-e-dominio',
        password: 'SenhaForte@2026!',
        role: 'collaborator',
      }),
    });
    expect(badEmailRes.status).toBe(400);

    // 3. Senha menor que 8 caracteres
    const shortPwdRes = await fetch(`${cluster.gatewayUrl}/api/v1/auth/users`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        name: 'Senha Curta',
        email: 'senha.curta@shineraybysabel.com.br',
        password: '12345',
        role: 'collaborator',
      }),
    });
    expect(shortPwdRes.status).toBe(400);
  });

  it('11. [Robustez Criptográfica] Senha com caracteres especiais complexos (!@#$%^&*()_+~|}{[]:;?><,./-=) funciona perfeitamente', async () => {
    const complexPassword = 'Shl!@#$%^&*()_+~|}{[]:;?><,./-=2026';
    const regComplexRes = await fetch(`${cluster.gatewayUrl}/api/v1/auth/users`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        name: 'Colaborador Símbolos Complexos',
        email: 'complex.symbols@shineraybysabel.com.br',
        password: complexPassword,
        role: 'collaborator',
        department: 'Vendas Concessionária',
      }),
    });
    expect(regComplexRes.status).toBe(201);

    const loginComplexRes = await fetch(`${cluster.gatewayUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'complex.symbols@shineraybysabel.com.br',
        password: complexPassword,
      }),
    });
    expect(loginComplexRes.status).toBe(200);
    const loginComplexData = await loginComplexRes.json();
    expect(loginComplexData.user.email).toBe('complex.symbols@shineraybysabel.com.br');
  });

  it('12. [Cluster de Chamados pelo Dono] Dono cria chamado, adiciona comentário de governança e resolve com sucesso', async () => {
    // 1. Dono abre chamado
    const createRes = await fetch(`${cluster.gatewayUrl}/api/v1/tickets`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        title: 'Auditoria de Conectividade e VPN Matriz-Concessionárias',
        description: 'Verificação periódica dos túneis de comunicação IPsec/WireGuard.',
        category: 'Infraestrutura & Redes',
        priority: 'high',
        department: 'Diretoria Executiva',
        assetTag: 'SHL-BEL-NTB-016',
      }),
    });
    expect(createRes.status).toBe(201);
    const ticket = await createRes.json();
    expect(ticket.protocol).toMatch(/^CHM-2026-/);
    expect(ticket.requester_name).toBe('TI & Gestão Shineray');

    // 2. Dono adiciona comentário
    const commentRes = await fetch(`${cluster.gatewayUrl}/api/v1/tickets/${ticket.id}/comments`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        message: 'Diretoria acompanhando resolução e validação de segurança.',
      }),
    });
    expect(commentRes.status).toBe(201);
    const comment = await commentRes.json();
    expect(comment.author_role).toBe('owner');

    // 3. Dono resolve o chamado
    const statusRes = await fetch(`${cluster.gatewayUrl}/api/v1/tickets/${ticket.id}/status`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        status: 'resolved',
        resolutionNotes: 'Auditoria concluída e homologada pela Diretoria Executiva Shineray By Sabel.',
      }),
    });
    expect(statusRes.status).toBe(200);
    const resolvedTicket = await statusRes.json();
    expect(resolvedTicket.status).toBe('resolved');
  });
});
