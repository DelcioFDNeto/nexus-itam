// src/utils/permissions.js
// -----------------------------------------------------------------------------
// Fonte unica de verdade sobre "quem pode o que".
// O cliente usa isto para esconder/bloquear a UI; o Firestore usa firestore.rules
// para bloquear de fato. As duas camadas precisam contar a mesma historia.
// -----------------------------------------------------------------------------

export const MASTER_TENANT = 'nexus-master';

// Hierarquia crescente de privilegio. Comparacoes usam o indice.
export const ROLES = ['viewer', 'operator', 'member', 'manager', 'admin', 'owner', 'superadmin'];

export const ROLE_LABELS = {
  viewer: 'Visualizador',
  operator: 'Operador',
  member: 'Membro',
  manager: 'Gestor',
  admin: 'Administrador',
  owner: 'Proprietario',
  superadmin: 'Nexus Master',
};

const rank = (role) => {
  const index = ROLES.indexOf(role);
  return index === -1 ? -1 : index;
};

/** O papel do usuario e igual ou superior ao minimo exigido? */
export const hasRole = (user, minimumRole) => {
  if (!user?.role) return false;
  return rank(user.role) >= rank(minimumRole);
};

export const isSuperadmin = (user) =>
  user?.role === 'superadmin' && user?.tenantId === MASTER_TENANT;

export const isTenantAdmin = (user) => hasRole(user, 'admin');

/**
 * Capacidades nomeadas. Preferir estas a checar `role` espalhado pelas telas:
 * mudar a regra de negocio passa a ser uma edicao em um lugar so.
 */
export const CAPABILITIES = {
  'assets:read': 'viewer',
  'assets:write': 'operator',
  'assets:delete': 'manager',
  'assets:import': 'admin',
  'employees:write': 'member',
  'projects:write': 'member',
  'tasks:write': 'operator',
  'licenses:write': 'member',
  'contracts:write': 'manager',
  'audit:run': 'operator',
  'agent:read': 'manager',
  'agent:manage': 'admin',
  'users:manage': 'admin',
  'settings:read': 'admin',
  'settings:write': 'owner',
  'backup:create': 'owner',
  'backup:restore': 'owner',
  'tenant:manage': 'superadmin',
  'plans:manage': 'superadmin',
};

export const can = (user, capability) => {
  if (isSuperadmin(user)) return true;
  const required = CAPABILITIES[capability];
  if (!required) return false;
  if (required === 'superadmin') return false;
  return hasRole(user, required);
};

/** Tenant valido? Bloqueia perfis orfaos e o antigo placeholder 'default-tenant'. */
export const hasValidTenant = (user) =>
  typeof user?.tenantId === 'string' &&
  user.tenantId.length > 0 &&
  user.tenantId !== 'default-tenant';
