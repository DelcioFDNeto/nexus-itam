// services/shared/eventBus.js
// =============================================================================
// Publicador Assíncrono Zero-Trust de Eventos de Domínio para o WebSocket Hub
// =============================================================================
// Permite que `service-assets`, `service-tickets` e `service-compliance`
// notifiquem `service-nexusdesk` em tempo real sem acoplamento direto de banco.
// Assinado com HMAC-SHA256 (`signInternalEvent`) para impedir injeção externa.
// =============================================================================

import { signInternalEvent } from './security.js';

export async function publishDomainEvent(eventType, tenantId, data) {
  const nexusdeskUrl =
    process.env.NEXUSDESK_SERVICE_URL ||
    process.env.NEXUSDESK_INTERNAL_URL ||
    'http://127.0.0.1:8004';
  const body = JSON.stringify({
    event: eventType,
    tenantId,
    timestamp: new Date().toISOString(),
    data,
  });

  try {
    const headers = {
      'content-type': 'application/json',
      ...signInternalEvent(body),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);

    await fetch(`${nexusdeskUrl}/internal/events`, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
  } catch {
    // Resiliência (Graceful Degradation): se o barramento WS estiver reiniciando,
    // a transação REST principal nunca falha.
  }
}
