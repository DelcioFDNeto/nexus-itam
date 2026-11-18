// services/service-storage/src/services/auditClient.js
// =============================================================================
// Cliente de Auditoria SHA-256 Hash-Chain (service-storage -> service-compliance)
// =============================================================================

import { complianceRepo } from '../../../shared/db.js';
import { publishDomainEvent } from '../../../shared/eventBus.js';
import { signInternalEvent } from '../../../shared/security.js';

export async function recordStorageAudit(tenantId, user, { action, resourceType = 'storage_node', resourceId, payload = {} }) {
  const actorEmail = String(user?.email || 'anonymous@public-share.local');
  const actorRole = String(user?.role || 'external');
  const cleanAction = String(action || 'STORAGE_EVENT').toUpperCase();
  const cleanResId = String(resourceId || 'root');

  const complianceUrl = process.env.COMPLIANCE_SERVICE_URL;
  if (complianceUrl) {
    try {
      const bodyStr = JSON.stringify({
        tenantId,
        actorEmail,
        actorRole,
        action: cleanAction,
        resourceType,
        resourceId: cleanResId,
        payload,
      });
      const headers = {
        'content-type': 'application/json',
        ...signInternalEvent(bodyStr),
      };
      const res = await fetch(`${complianceUrl}/internal/audit`, {
        method: 'POST',
        headers,
        body: bodyStr,
        signal: AbortSignal.timeout(2500),
      });
      if (res.ok) {
        const entry = await res.json().catch(() => null);
        return entry;
      }
    } catch {
      // Fallback to direct complianceRepo in same process/cluster
    }
  }

  const entry = await complianceRepo.appendAuditLog(tenantId, {
    actorEmail,
    actorRole,
    action: cleanAction,
    resourceType,
    resourceId: cleanResId,
    payload,
  });

  await publishDomainEvent(action, tenantId, {
    resourceId: cleanResId,
    actorEmail,
    ...payload,
  });

  return entry;
}
