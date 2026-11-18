// services/tests/e2e_cloud_vault/helpers/auditHelper.js
// =============================================================================
// Compliance SHA-256 Hash-Chain Verifier for E2E Tests
// =============================================================================
// - Fetches /api/v1/compliance/audit (sorts ascending by seq)
// - Locally verifies GENESIS_HASH, prev_hash links, and computeAuditChainHash
// - Cross-checks against /api/v1/compliance/audit/verify-chain
// =============================================================================

import { GENESIS_HASH, computeAuditChainHash } from '../../../shared/security.js';

export async function fetchAuditLog(apiFetch, token, limit = 200) {
  const res = await apiFetch(token, `/api/v1/compliance/audit?limit=${limit}`);
  if (!res.ok) {
    throw new Error(
      `GET /api/v1/compliance/audit failed (${res.status}): ${res.data?.message || res.text}`,
    );
  }
  const rawItems = Array.isArray(res.data?.items) ? res.data.items : [];
  const itemsAsc = [...rawItems].sort((a, b) => Number(a.seq) - Number(b.seq));
  return {
    total: res.data?.total ?? itemsAsc.length,
    itemsAsc,
  };
}

export async function verifyAuditChainViaApi(apiFetch, token) {
  const res = await apiFetch(token, '/api/v1/compliance/audit/verify-chain');
  if (!res.ok) {
    throw new Error(
      `GET /api/v1/compliance/audit/verify-chain failed (${res.status}): ${res.data?.message || res.text}`,
    );
  }
  return res.data;
}

export function verifyChainLinksLocally(entriesAsc, { requireGenesis = true, totalCount } = {}) {
  if (!Array.isArray(entriesAsc) || entriesAsc.length === 0) {
    return { valid: true, checkedRecords: 0, headHash: GENESIS_HASH };
  }

  const shouldCheckGenesis =
    requireGenesis &&
    (Number(entriesAsc[0].seq) === 1 ||
      (totalCount !== undefined &&
        (entriesAsc.length >= Number(totalCount) || Number(totalCount) <= 200)));

  if (shouldCheckGenesis && entriesAsc[0].prev_hash !== GENESIS_HASH) {
    return {
      valid: false,
      checkedRecords: 1,
      brokenAtSeq: entriesAsc[0].seq,
      reason: `GENESIS_HASH mismatch on seq=${entriesAsc[0].seq}`,
    };
  }

  for (let i = 0; i < entriesAsc.length; i += 1) {
    const entry = entriesAsc[i];
    if (i > 0) {
      const prev = entriesAsc[i - 1];
      if (Number(entry.seq) <= Number(prev.seq)) {
        return {
          valid: false,
          checkedRecords: i + 1,
          brokenAtSeq: entry.seq,
          reason: `Non-monotonic seq ${entry.seq} after ${prev.seq}`,
        };
      }
      if (entry.prev_hash !== prev.entry_hash) {
        return {
          valid: false,
          checkedRecords: i + 1,
          brokenAtSeq: entry.seq,
          reason: `prev_hash mismatch at seq=${entry.seq}`,
        };
      }
    }

    const expectedHash = computeAuditChainHash({
      prevHash: entry.prev_hash,
      tenantId: entry.tenant_id,
      actorEmail: entry.actor_email,
      actorRole: entry.actor_role,
      action: entry.action,
      resourceType: entry.resource_type,
      resourceId: entry.resource_id,
      payload: entry.payload,
      createdAtIso: entry.created_at,
    });

    if (expectedHash !== entry.entry_hash) {
      return {
        valid: false,
        checkedRecords: i + 1,
        brokenAtSeq: entry.seq,
        reason: `entry_hash mismatch at seq=${entry.seq}`,
      };
    }
  }

  return {
    valid: true,
    checkedRecords: entriesAsc.length,
    headHash: entriesAsc[entriesAsc.length - 1].entry_hash,
  };
}

export async function assertFullAuditIntegrity(apiFetch, token) {
  const apiResult = await verifyAuditChainViaApi(apiFetch, token);
  const { total, itemsAsc } = await fetchAuditLog(apiFetch, token, 200);

  const allFetched = itemsAsc.length > 0 && (itemsAsc.length >= total || total <= 200);
  const requireGenesis =
    itemsAsc.length > 0 && (Number(itemsAsc[0].seq) === 1 || allFetched);
  const localResult = verifyChainLinksLocally(itemsAsc, {
    requireGenesis,
    totalCount: total,
  });

  if (!apiResult?.intact) {
    throw new Error(`Compliance verify-chain reported intact=false: ${JSON.stringify(apiResult)}`);
  }
  if (!localResult.valid) {
    throw new Error(`Local SHA-256 chain check failed: ${localResult.reason}`);
  }
  if (itemsAsc.length > 0 && apiResult.checkedRecords === itemsAsc.length) {
    const localHead = itemsAsc[itemsAsc.length - 1].entry_hash;
    if (apiResult.headHash !== localHead) {
      throw new Error(`headHash mismatch: API=${apiResult.headHash} vs local=${localHead}`);
    }
  }

  return {
    apiResult,
    localResult,
    itemsAsc,
  };
}

export async function findAuditEvents(apiFetch, token, filter = {}) {
  const { itemsAsc } = await fetchAuditLog(apiFetch, token, 200);
  return itemsAsc.filter((item) => {
    if (filter.action && item.action !== filter.action) return false;
    if (filter.resourceType && item.resource_type !== filter.resourceType) return false;
    if (filter.resourceId && String(item.resource_id) !== String(filter.resourceId)) return false;
    if (filter.actorEmail && item.actor_email !== filter.actorEmail) return false;
    if (filter.actorRole && item.actor_role !== filter.actorRole) return false;
    return true;
  });
}

export async function expectAuditEvent(apiFetch, token, filter = {}) {
  const matches = await findAuditEvents(apiFetch, token, filter);
  if (matches.length === 0) {
    throw new Error(`Expected audit event matching ${JSON.stringify(filter)}, found none`);
  }
  return matches[matches.length - 1];
}
