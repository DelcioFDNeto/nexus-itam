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
  owner: 'Proprietário',
  superadmin: 'Nexus Master',
};

/** Papeis validos dentro de uma empresa (superadmin so existe no tenant master). */
export const TENANT_ROLES = ['owner', 'admin', 'manager', 'member', 'operator', 'viewer'];

export const ROLE_DESCRIPTIONS = {
  owner: 'Acesso total: identidade visual, termo, backup, restauração e administradores.',
  admin: 'Usuários (até Gestor), Agente ITAM, importação e locais.',
  manager: 'Gestão completa de ativos (inclusive exclusão), contratos e equipe.',
  member: 'Opera ativos, projetos, licenças e cadastro da equipe.',
  operator: 'Cadastra e movimenta ativos, executa tarefas e auditorias.',
  viewer: 'Somente leitura do inventário.',
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
  // Termos patrimoniais. Espelha /terms em firestore.rules: qualquer membro
  // le; operador emite, confirma recebimento e marca assinatura; cancelar
  // ou excluir um termo exige gestor.
  'terms:read': 'viewer',
  'terms:issue': 'operator',
  'terms:cancel': 'manager',
  'agent:read': 'manager',
  'agent:manage': 'admin',
  'users:manage': 'admin',
  'settings:read': 'admin',
  // Identidade visual, termo juridico e campos da empresa: so o owner.
  // firestore.rules espelha isto — admin grava em /settings apenas as chaves
  // do Agente ITAM (nomenclatura, IPs confiaveis e aceite automatico).
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

/**
 * Papeis que `actor` pode atribuir a membros da propria empresa.
 * Espelha `canAssignRole()` em firestore.rules: admin nunca cria outro admin nem
 * owner — antes um admin podia se promover a owner e rebaixar o dono da conta.
 */
export const assignableRoles = (actor) => {
  if (isSuperadmin(actor)) return [...TENANT_ROLES];
  if (actor?.role === 'owner') return [...TENANT_ROLES];
  if (actor?.role === 'admin') return ['manager', 'member', 'operator', 'viewer'];
  return [];
};

/**
 * `actor` pode alterar papel/status ou remover `target`?
 * Ninguem mexe no proprio acesso (evita empresa sem dono) e admin nao toca em
 * owner nem em outro admin.
 */
export const canManageMember = (actor, target) => {
  if (!actor || !target) return false;
  if (isSuperadmin(actor)) return true;
  const targetId = target.uid || target.id;
  if (actor.uid && targetId && actor.uid === targetId) return false;
  if (!target.tenantId || target.tenantId !== actor.tenantId) return false;
  return assignableRoles(actor).includes(target.role);
};

/** Tenant valido? Bloqueia perfis orfaos e o antigo placeholder 'default-tenant'. */
export const hasValidTenant = (user) =>
  typeof user?.tenantId === 'string' &&
  user.tenantId.length > 0 &&
  user.tenantId !== 'default-tenant';
