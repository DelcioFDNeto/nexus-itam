// services/service-storage/src/services/aclService.js
// =============================================================================
// Motor de Permissões Granulares em 5 Níveis (ACL) + Herança + Teto RBAC
// =============================================================================

import { storageRepo } from '../../../shared/db.js';
import { isZeroKnowledgeRestricted } from '../../../shared/security.js';

export const ACCESS_RANK = {
  none: 0,
  viewer_online: 1,
  reader: 2,
  editor: 3,
  full_control: 4,
};

export const VALID_ACCESS_LEVELS = new Set(Object.keys(ACCESS_RANK));
export const VALID_TARGET_TYPES = new Set(['user', 'role', 'department']);

export function canPerformGlobalCapability(user, capability) {
  if (!user || isZeroKnowledgeRestricted(user)) return false;
  const role = String(user.role || '').toLowerCase();
  if (capability === 'cloud:connect') {
    return role === 'owner' || role === 'admin';
  }
  if (capability === 'cloud:acl') {
    return role === 'owner' || role === 'admin' || role === 'manager';
  }
  if (capability === 'cloud:write') {
    return ['owner', 'admin', 'manager', 'member', 'operator', 'collaborator'].includes(role);
  }
  if (capability === 'cloud:read') {
    return ['owner', 'admin', 'manager', 'member', 'operator', 'viewer', 'collaborator'].includes(role);
  }
  return false;
}

export function applyGlobalRoleCeiling(user, resolvedLevel) {
  if (!user || isZeroKnowledgeRestricted(user)) return 'none';
  const role = String(user.role || '').toLowerCase();
  if (role === 'viewer') {
    if (ACCESS_RANK[resolvedLevel] > ACCESS_RANK.reader) {
      return 'reader';
    }
  }
  return resolvedLevel;
}

function defaultImplicitAccessForPath(user, virtualPath) {
  const role = String(user?.role || '').toLowerCase();
  const email = String(user?.email || '').toLowerCase();
  const department = String(user?.department || '').trim();
  const vPath = String(virtualPath || '/');

  if (['owner', 'admin', 'manager'].includes(role)) {
    return 'full_control';
  }

  if (['operator', 'member'].includes(role)) {
    if (vPath === '/Cofre-TI-Infra' || vPath.startsWith('/Cofre-TI-Infra/')) {
      return department.toLowerCase().includes('ti') || department.toLowerCase().includes('tecnologia')
        ? 'editor'
        : 'reader';
    }
    return 'editor';
  }

  if (role === 'viewer') {
    return 'reader';
  }

  if (role === 'collaborator') {
    if (vPath === '/Cofre-TI-Infra' || vPath.startsWith('/Cofre-TI-Infra/')) {
      return 'none';
    }
    if (vPath === '/Chamados' || vPath.startsWith('/Chamados/')) {
      return 'none';
    }
    if (vPath === '/Corporativo-Publico' || vPath.startsWith('/Corporativo-Publico/')) {
      return 'reader';
    }
    if (vPath === '/Setores') {
      return 'reader';
    }
    if (vPath.startsWith('/Setores/')) {
      const rest = vPath.slice('/Setores/'.length);
      const sectorName = rest.split('/')[0] || '';
      if (department && sectorName.toLowerCase() === department.toLowerCase()) {
        return 'editor';
      }
      return 'none';
    }
    if (vPath === '/Espaco-Pessoal') {
      return 'reader';
    }
    if (vPath.startsWith('/Espaco-Pessoal/')) {
      const rest = vPath.slice('/Espaco-Pessoal/'.length);
      const ownerFolder = rest.split('/')[0] || '';
      if (email && ownerFolder.toLowerCase() === email) {
        return 'full_control';
      }
      return 'none';
    }
    return 'none';
  }

  return 'none';
}

function matchAclRulesOnSingleNode(user, rules = []) {
  const email = String(user?.email || '').toLowerCase();
  const userId = String(user?.id || user?.userId || '').toLowerCase();
  const role = String(user?.role || '').toLowerCase();
  const dept = String(user?.department || '').trim().toLowerCase();

  const userMatches = [];
  const roleMatches = [];
  const deptMatches = [];

  for (const r of rules) {
    const tType = String(r.target_type || r.targetType || '').toLowerCase();
    const tVal = String(r.target_value || r.targetValue || '').trim().toLowerCase();
    const level = String(r.access_level || r.accessLevel || '').toLowerCase();
    if (!VALID_ACCESS_LEVELS.has(level)) continue;

    if (tType === 'user' && tVal && (tVal === email || tVal === userId)) {
      userMatches.push(level);
    } else if (tType === 'role' && tVal && (tVal === role || tVal === '*')) {
      roleMatches.push(level);
    } else if (tType === 'department' && tVal && ((dept && tVal === dept) || tVal === '*')) {
      deptMatches.push(level);
    }
  }

  const pickLowest = (levels) =>
    levels.reduce((min, cur) => (ACCESS_RANK[cur] < ACCESS_RANK[min] ? cur : min), levels[0]);

  if (userMatches.length > 0) return pickLowest(userMatches);
  if (roleMatches.length > 0) return pickLowest(roleMatches);
  if (deptMatches.length > 0) return pickLowest(deptMatches);
  return null;
}

export async function resolveEffectiveNodeAccess(tenantId, user, node, { nodesMap, aclsByNodeId } = {}) {
  if (!user || isZeroKnowledgeRestricted(user)) return 'none';
  const role = String(user.role || '').toLowerCase();
  if (role === 'owner' || role === 'admin') {
    return 'full_control';
  }
  if (!node) {
    return applyGlobalRoleCeiling(user, ['manager', 'operator', 'member'].includes(role) ? 'editor' : 'reader');
  }

  // Walk from current node up to root
  const chain = [];
  let cur = node;
  const visited = new Set();
  while (cur && !visited.has(cur.id)) {
    visited.add(cur.id);
    chain.push(cur);
    const parentId = cur.parent_id ?? cur.parentId ?? null;
    if (!parentId) break;
    if (nodesMap && nodesMap.has(parentId)) {
      cur = nodesMap.get(parentId);
    } else {
      cur = await storageRepo.getNodeById(tenantId, parentId);
    }
  }

  const vPath = node.virtual_path || node.virtualPath || '/';
  const isInsideSectorOrPersonal =
    vPath.startsWith('/Setores/') || vPath.startsWith('/Espaco-Pessoal/');

  for (const item of chain) {
    const itemPath = item.virtual_path || item.virtualPath || '/';
    if (
      role === 'collaborator' &&
      isInsideSectorOrPersonal &&
      (itemPath === '/Setores' || itemPath === '/Espaco-Pessoal')
    ) {
      // Do not inherit root /Setores or /Espaco-Pessoal 'reader' rule into another sector's or user's subfolder
      break;
    }
    let rules;
    if (aclsByNodeId && aclsByNodeId.has(item.id)) {
      rules = aclsByNodeId.get(item.id) || [];
    } else {
      rules = await storageRepo.listNodeAcls(tenantId, item.id);
    }
    const matched = matchAclRulesOnSingleNode(user, rules);
    if (matched !== null) {
      return applyGlobalRoleCeiling(user, matched);
    }
  }

  const fallback = defaultImplicitAccessForPath(user, vPath);
  return applyGlobalRoleCeiling(user, fallback);
}

export function canAccessLevelPerform(accessLevel, requiredAction, { user, node } = {}) {
  const rank = ACCESS_RANK[accessLevel] ?? 0;
  if (requiredAction === 'view_list' || requiredAction === 'preview') {
    return rank >= ACCESS_RANK.viewer_online;
  }
  if (requiredAction === 'download') {
    return rank >= ACCESS_RANK.reader;
  }
  if (requiredAction === 'write' || requiredAction === 'create' || requiredAction === 'rename' || requiredAction === 'lock') {
    if (!canPerformGlobalCapability(user, 'cloud:write')) return false;
    return rank >= ACCESS_RANK.editor;
  }
  if (requiredAction === 'delete') {
    if (!canPerformGlobalCapability(user, 'cloud:write')) return false;
    if (rank >= ACCESS_RANK.full_control) return true;
    if (rank === ACCESS_RANK.editor) {
      const creator = String(node?.created_by_email || node?.createdByEmail || '').toLowerCase();
      const actor = String(user?.email || '').toLowerCase();
      if (['owner', 'admin', 'manager', 'operator'].includes(String(user?.role || '').toLowerCase())) {
        return true;
      }
      return Boolean(creator && actor && creator === actor);
    }
    return false;
  }
  return false;
}
