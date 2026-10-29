// services/orchestrator.js
// =============================================================================
// Orquestrador Local de Desenvolvimento & Demonstração Rápida
// Sobe os 4 Microsserviços + API Gateway simultaneamente em um único comando!
// Em produção na VPS, cada serviço roda isolado em seu próprio container Docker.
// =============================================================================

import { buildAssetsService } from './service-assets/src/server.js';
import { buildTicketsService } from './service-tickets/src/server.js';
import { buildComplianceService } from './service-compliance/src/server.js';
import { buildNexusDeskService } from './service-nexusdesk/src/server.js';
import { buildApiGateway } from './api-gateway/src/server.js';

export async function startAllMicroservices({
  host = process.env.HOST || '127.0.0.1',
  basePort = 8000,
  logger = false,
} = {}) {
  const ports = {
    gateway: basePort,
    assets: basePort + 1,
    tickets: basePort + 2,
    compliance: basePort + 3,
    nexusdesk: basePort + 4,
  };

  process.env.NEXUSDESK_SERVICE_URL = `http://127.0.0.1:${ports.nexusdesk}`;

  const [assetsApp, ticketsApp, complianceApp, nexusdeskApp] = await Promise.all([
    buildAssetsService({ logger }),
    buildTicketsService({ logger }),
    buildComplianceService({ logger }),
    buildNexusDeskService({ logger }),
  ]);

  await Promise.all([
    assetsApp.listen({ host, port: ports.assets }),
    ticketsApp.listen({ host, port: ports.tickets }),
    complianceApp.listen({ host, port: ports.compliance }),
    nexusdeskApp.listen({ host, port: ports.nexusdesk }),
  ]);

  const gatewayApp = await buildApiGateway({
    logger,
    assetsUrl: `http://127.0.0.1:${ports.assets}`,
    ticketsUrl: `http://127.0.0.1:${ports.tickets}`,
    complianceUrl: `http://127.0.0.1:${ports.compliance}`,
    nexusdeskUrl: `http://127.0.0.1:${ports.nexusdesk}`,
  });

  await gatewayApp.listen({ host, port: ports.gateway });

  const closeAll = async () => {
    await gatewayApp.close();
    await Promise.all([
      assetsApp.close(),
      ticketsApp.close(),
      complianceApp.close(),
      nexusdeskApp.close(),
    ]);
  };

  return {
    ports,
    gatewayUrl: `http://127.0.0.1:${ports.gateway}`,
    wsUrl: `ws://127.0.0.1:${ports.gateway}/ws/nexusdesk`,
    closeAll,
    stopAll: closeAll,
  };
}

if (process.argv[1] && process.argv[1].endsWith('orchestrator.js')) {
  startAllMicroservices({ host: '0.0.0.0', basePort: Number(process.env.PORT || 8000) })
    .then(({ ports }) => {
      console.log('===================================================================');
      console.log(' NEXUS ITAM v3.0 — Malha de Microsserviços Ativa');
      console.log('-------------------------------------------------------------------');
      console.log(` [Gateway & Docs]     http://localhost:${ports.gateway}/docs`);
      console.log(` [Healthcheck]        http://localhost:${ports.gateway}/health`);
      console.log(` [API 1 - Assets]     http://localhost:${ports.assets}/health`);
      console.log(` [API 2 - Tickets]    http://localhost:${ports.tickets}/health`);
      console.log(` [API 3 - Compliance] http://localhost:${ports.compliance}/health`);
      console.log(` [API 4 & 5 - WS/RMM] ws://localhost:${ports.gateway}/ws/nexusdesk`);
      console.log('===================================================================');
    })
    .catch((err) => {
      console.error('Erro ao iniciar malha de microsserviços:', err);
      process.exit(1);
    });
}
