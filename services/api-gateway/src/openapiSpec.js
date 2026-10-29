// services/api-gateway/src/openapiSpec.js
// =============================================================================
// Especificação OpenAPI 3.1.0 & Portal Interativo de Documentação das 5 APIs
// =============================================================================

export function buildOpenApiSpec(gatewayBaseUrl = 'http://localhost:8000') {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Nexus ITAM v3.0 — Enterprise Microservices & Realtime Gateway',
      version: '3.0.0',
      description:
        'Arquitetura orientada a microsserviços com Segurança Zero-Trust (HMAC-SHA256 inter-serviços, JWT RFC 7519, Scrypt, Rate Limiting, Hash-Chain Audit). Contempla 4 APIs REST de domínio e 1 API Não-REST (WebSocket Bidirecional Full-Duplex RFC 6455).',
      contact: {
        name: 'Engenharia de Plataforma Nexus ITAM',
      },
    },
    servers: [{ url: gatewayBaseUrl, description: 'API Gateway Principal' }],
    tags: [
      { name: 'Gateway & Auth', description: 'Autenticação Stateless JWT, Identidade e Saúde Distribuída' },
      { name: 'API 1 (REST) — Ativos', description: 'Microsserviço `service-assets` (:8001) — Patrimônio, Ciclo de Vida e Tags Sequenciais' },
      { name: 'API 2 (REST) — Chamados', description: 'Microsserviço `service-tickets` (:8002) — Central de Suporte TI, SLA e Portal Vue 3' },
      { name: 'API 3 (REST) — Compliance', description: 'Microsserviço `service-compliance` (:8003) — Termos CLT Assinados HMAC-SHA256 e Hash-Chain' },
      { name: 'API 4 (REST) — Telemetria', description: 'Microsserviço `service-nexusdesk` (:8004) — Ingestão M2M de Hardware/Software e Comandos RMM' },
      { name: 'API 5 (NÃO-REST) — WebSocket', description: 'Protocolo Bidirecional RFC 6455 (`ws://.../ws/nexusdesk`) — Streaming Live & Eventos' },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
        AgentTokenAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Agent-Token',
        },
      },
    },
    paths: {
      '/health': {
        get: {
          tags: ['Gateway & Auth'],
          summary: 'Healthcheck distribuído do Gateway, PostgreSQL 16 e dos 4 Microsserviços',
          responses: { 200: { description: 'Topologia íntegra' } },
        },
      },
      '/api/v1/auth/login': {
        post: {
          tags: ['Gateway & Auth'],
          summary: 'Autentica operador ou colaborador (Scrypt + emissão de JWT HS256)',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                example: { email: 'admin@nexuscorp.com.br', password: 'Nexus@2026!' },
              },
            },
          },
          responses: { 200: { description: 'Token JWT emitido' }, 401: { description: 'Credenciais inválidas' } },
        },
      },
      '/api/v1/auth/me': {
        get: {
          tags: ['Gateway & Auth'],
          security: [{ BearerAuth: [] }],
          summary: 'Retorna perfil autenticado e escopo multi-tenant',
          responses: { 200: { description: 'Perfil verificado' } },
        },
      },
      '/api/v1/assets': {
        get: {
          tags: ['API 1 (REST) — Ativos'],
          security: [{ BearerAuth: [] }],
          summary: 'Lista ativos do inquilino (isolamento automático por papel)',
          responses: { 200: { description: 'Inventário retornado' } },
        },
        post: {
          tags: ['API 1 (REST) — Ativos'],
          security: [{ BearerAuth: [] }],
          summary: 'Cadastra novo ativo com geração automática de Tag Patrimonial Sequencial',
          responses: { 201: { description: 'Ativo registrado' } },
        },
      },
      '/api/v1/assets/next-tag': {
        get: {
          tags: ['API 1 (REST) — Ativos'],
          security: [{ BearerAuth: [] }],
          summary: 'Sugere a próxima Tag Patrimonial sequencial para o tipo de equipamento',
          responses: { 200: { description: 'Próxima tag calculada' } },
        },
      },
      '/api/v1/tickets': {
        get: {
          tags: ['API 2 (REST) — Chamados'],
          security: [{ BearerAuth: [] }],
          summary: 'Lista chamados de suporte TI com cálculo automático de SLA',
          responses: { 200: { description: 'Fila de chamados' } },
        },
        post: {
          tags: ['API 2 (REST) — Chamados'],
          security: [{ BearerAuth: [] }],
          summary: 'Abre chamado pelo Portal Vue 3 ou Console React e notifica via WebSocket',
          responses: { 201: { description: 'Chamado aberto' } },
        },
      },
      '/api/v1/tickets/{id}/status': {
        patch: {
          tags: ['API 2 (REST) — Chamados'],
          security: [{ BearerAuth: [] }],
          summary: 'Atualiza status operacional do chamado e notifica colaborador em tempo real',
          responses: { 200: { description: 'Status atualizado' } },
        },
      },
      '/api/v1/compliance/terms': {
        get: {
          tags: ['API 3 (REST) — Compliance'],
          security: [{ BearerAuth: [] }],
          summary: 'Lista Termos de Responsabilidade CLT e selos criptográficos',
          responses: { 200: { description: 'Lista de termos' } },
        },
        post: {
          tags: ['API 3 (REST) — Compliance'],
          security: [{ BearerAuth: [] }],
          summary: 'Emite Termo CLT com hash canônico SHA-256',
          responses: { 201: { description: 'Termo emitido' } },
        },
      },
      '/api/v1/compliance/terms/{id}/sign': {
        post: {
          tags: ['API 3 (REST) — Compliance'],
          security: [{ BearerAuth: [] }],
          summary: 'Assina digitalmente o termo com HMAC-SHA256 e grava na Hash-Chain',
          responses: { 200: { description: 'Termo assinado e encadeado' } },
        },
      },
      '/api/v1/compliance/audit/verify-chain': {
        get: {
          tags: ['API 3 (REST) — Compliance'],
          security: [{ BearerAuth: [] }],
          summary: 'Recalcula todos os elos SHA-256 desde o bloco Gênesis comprovando imutabilidade',
          responses: { 200: { description: 'Integridade matemática comprovada' } },
        },
      },
      '/api/v1/telemetry/heartbeat': {
        post: {
          tags: ['API 4 (REST) — Telemetria'],
          security: [{ AgentTokenAuth: [] }, { BearerAuth: [] }],
          summary: 'Ingestão de telemetria de máquina (CPU, RAM, Disco, Antivírus) + Broadcast WS',
          responses: { 201: { description: 'Heartbeat processado' } },
        },
      },
      '/api/v1/telemetry/fleet': {
        get: {
          tags: ['API 4 (REST) — Telemetria'],
          security: [{ BearerAuth: [] }],
          summary: 'Resumo executivo e saúde ao vivo do parque de máquinas monitoradas',
          responses: { 200: { description: 'Frota consolidada' } },
        },
      },
      '/ws/nexusdesk': {
        get: {
          tags: ['API 5 (NÃO-REST) — WebSocket'],
          summary: 'Upgrade RFC 6455 para Canal Bidirecional Full-Duplex (Streaming & Eventos)',
          description:
            'Conecte via `ws://<host>:8000/ws/nexusdesk?token=<JWT>`. Suporta frames `ping`/`pong`, `telemetry.push`, `remote.signal` e broadcast automático de `ticket.*`, `term.*`, `asset.*` e `telemetry.heartbeat`.',
          responses: { 101: { description: 'Switching Protocols (WebSocket Ativo)' } },
        },
      },
    },
  };
}

export function renderDocsHtml() {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Nexus ITAM v3.0 — Catálogo das 5 APIs & Microsserviços</title>
  <style>
    :root { --bg: #090d16; --panel: #111827; --border: #1f2937; --text: #f3f4f6; --muted: #9ca3af; --accent: #6366f1; --ok: #10b981; --ws: #f59e0b; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; }
    header { padding: 28px 32px; border-bottom: 1px solid var(--border); background: #0d1321; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px; }
    .eyebrow { font-family: ui-monospace, monospace; font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: #818cf8; }
    h1 { margin: 4px 0 0; font-size: 22px; font-weight: 800; }
    main { max-width: 1160px; margin: 0 auto; padding: 28px 24px 64px; display: grid; gap: 20px; }
    .card { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 20px; }
    .badge { font-family: ui-monospace, monospace; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 6px; display: inline-block; }
    .rest { background: rgba(16,185,129,.15); color: #34d399; border: 1px solid rgba(16,185,129,.3); }
    .ws { background: rgba(245,158,11,.15); color: #fbbf24; border: 1px solid rgba(245,158,11,.35); }
    .route { font-family: ui-monospace, monospace; font-size: 13px; padding: 10px 12px; background: #0b111e; border: 1px solid var(--border); border-radius: 8px; margin-top: 8px; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    button { background: var(--accent); color: white; border: 0; border-radius: 8px; padding: 8px 14px; font-weight: 700; cursor: pointer; font-size: 12px; }
    button:hover { opacity: .92; }
    pre { background: #060911; border: 1px solid var(--border); border-radius: 8px; padding: 14px; overflow: auto; font-size: 12px; color: #cbd5e1; max-height: 300px; }
  </style>
</head>
<body>
  <header>
    <div>
      <div class="eyebrow">NEXUS ITAM v3.0 // FASTIFY API GATEWAY & ZERO-TRUST MESH</div>
      <h1>Catálogo Interativo — 5 APIs (4 REST + 1 WebSocket Bidirecional)</h1>
    </div>
    <div style="display:flex;gap:10px;">
      <a href="/openapi.json" target="_blank"><button type="button">Abrir OpenAPI 3.1 JSON</button></a>
      <button type="button" onclick="probeHealth()">Testar /health Ao Vivo</button>
    </div>
  </header>
  <main>
    <div class="card">
      <strong>Status em Tempo Real da Malha de Microsserviços</strong>
      <pre id="healthOut">Clique em "Testar /health Ao Vivo" para inspecionar o Gateway, PostgreSQL 16 e os 4 Microsserviços...</pre>
    </div>
    <div class="card">
      <span class="badge rest">API 1 • REST</span> <strong>Microsserviço de Ativos (` + '`service-assets :8001`' + `)</strong>
      <div class="route"><span>GET / POST / PUT / DELETE  /api/v1/assets  •  GET /api/v1/assets/next-tag</span></div>
    </div>
    <div class="card">
      <span class="badge rest">API 2 • REST</span> <strong>Microsserviço de Chamados & SLA (` + '`service-tickets :8002`' + `)</strong>
      <div class="route"><span>GET / POST /api/v1/tickets  •  PATCH /api/v1/tickets/:id/status  •  POST /api/v1/tickets/:id/comments</span></div>
    </div>
    <div class="card">
      <span class="badge rest">API 3 • REST</span> <strong>Microsserviço de Compliance CLT & Hash-Chain (` + '`service-compliance :8003`' + `)</strong>
      <div class="route"><span>GET / POST /api/v1/compliance/terms  •  POST /:id/sign  •  GET /api/v1/compliance/audit/verify-chain</span></div>
    </div>
    <div class="card">
      <span class="badge rest">API 4 • REST</span> <strong>Microsserviço de Telemetria RMM (` + '`service-nexusdesk :8004`' + `)</strong>
      <div class="route"><span>POST /api/v1/telemetry/heartbeat (X-Agent-Token)  •  GET /api/v1/telemetry/fleet  •  POST /commands</span></div>
    </div>
    <div class="card">
      <span class="badge ws">API 5 • NÃO-REST (RFC 6455)</span> <strong>NexusDesk Bidirectional WebSocket Stream (` + '`service-nexusdesk :8004`' + `)</strong>
      <div class="route"><span>WS  ws://localhost:8000/ws/nexusdesk?token=&lt;JWT&gt;  (Frames: welcome, ping/pong, telemetry.push, ticket.*, term.*)</span></div>
    </div>
  </main>
  <script>
    async function probeHealth() {
      const el = document.getElementById('healthOut');
      el.textContent = 'Consultando malha de microsserviços...';
      const res = await fetch('/health');
      const data = await res.json();
      el.textContent = JSON.stringify(data, null, 2);
    }
    probeHealth();
  </script>
</body>
</html>`;
}
