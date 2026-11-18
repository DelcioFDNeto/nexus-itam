import { describe, it, expect } from 'vitest';
import {
  assignableRoles, can, canManageMember, COLLABORATOR_CAPABILITIES, hasRole, hasValidTenant, isSuperadmin, isTenantAdmin, TENANT_ONLY_CAPABILITIES, TENANT_ROLES,
} from './permissions';

const user = (role, tenantId = 'acme-1234') => ({ role, tenantId });

describe('hasRole', () => {
  it('respeita a hierarquia de papeis', () => {
    expect(hasRole(user('owner'), 'member')).toBe(true);
    expect(hasRole(user('member'), 'owner')).toBe(false);
    expect(hasRole(user('admin'), 'admin')).toBe(true);
  });

  it('nega quando nao ha papel', () => {
    expect(hasRole({ tenantId: 'acme-1234' }, 'viewer')).toBe(false);
    expect(hasRole(null, 'viewer')).toBe(false);
  });

  it('nega papel desconhecido', () => {
    expect(hasRole(user('hacker'), 'viewer')).toBe(false);
  });
});

describe('isSuperadmin', () => {
  it('exige papel superadmin E o tenant master', () => {
    expect(isSuperadmin({ role: 'superadmin', tenantId: 'nexus-master' })).toBe(true);
  });

  it('nega superadmin plantado em um tenant comum', () => {
    // Cenario de escalonamento: o usuario altera o proprio doc para
    // role=superadmin mas continua no tenant dele.
    expect(isSuperadmin({ role: 'superadmin', tenantId: 'acme-1234' })).toBe(false);
  });

  it('nega owner que se coloca no tenant master', () => {
    expect(isSuperadmin({ role: 'owner', tenantId: 'nexus-master' })).toBe(false);
  });
});

describe('can', () => {
  it('libera leitura de ativos ate para viewer', () => {
    expect(can(user('viewer'), 'assets:read')).toBe(true);
  });

  it('bloqueia escrita para viewer', () => {
    expect(can(user('viewer'), 'assets:write')).toBe(false);
  });

  it('so owner grava configuracoes', () => {
    expect(can(user('owner'), 'settings:write')).toBe(true);
    expect(can(user('admin'), 'settings:write')).toBe(false);
  });

  it('capacidades de master sao negadas a owner de tenant', () => {
    expect(can(user('owner'), 'tenant:manage')).toBe(false);
    expect(can(user('owner'), 'plans:manage')).toBe(false);
  });

  it('o master real recebe todas as capacidades', () => {
    const master = { role: 'superadmin', tenantId: 'nexus-master' };
    expect(can(master, 'tenant:manage')).toBe(true);
    expect(can(master, 'settings:write')).toBe(true);
  });

  it('o master nao acessa nem comanda as maquinas dos clientes (LGPD)', () => {
    const master = { role: 'superadmin', tenantId: 'nexus-master' };
    expect(can(master, 'agent:read')).toBe(false);
    expect(can(master, 'agent:remote')).toBe(false);
    expect(can(master, 'agent:manage')).toBe(false);
    expect(can({ role: 'manager', tenantId: 'acme' }, 'agent:remote')).toBe(true);
  });

  it('capacidade inexistente e sempre negada', () => {
    expect(can(user('owner'), 'nao:existe')).toBe(false);
  });

  it('usuario sem perfil nao pode nada', () => {
    expect(can(null, 'assets:read')).toBe(false);
    expect(can({ role: null, tenantId: null }, 'assets:read')).toBe(false);
  });
});

describe('hasValidTenant', () => {
  it('aceita um tenant real', () => {
    expect(hasValidTenant(user('member'))).toBe(true);
  });

  it('recusa o placeholder legado default-tenant', () => {
    // Era o fallback silencioso que juntava usuarios de empresas diferentes.
    expect(hasValidTenant({ tenantId: 'default-tenant' })).toBe(false);
  });

  it('recusa tenant ausente ou vazio', () => {
    expect(hasValidTenant({ tenantId: '' })).toBe(false);
    expect(hasValidTenant({})).toBe(false);
    expect(hasValidTenant(null)).toBe(false);
  });
});

describe('isTenantAdmin', () => {
  it('vale para admin e owner', () => {
    expect(isTenantAdmin(user('admin'))).toBe(true);
    expect(isTenantAdmin(user('owner'))).toBe(true);
    expect(isTenantAdmin(user('manager'))).toBe(false);
  });
});

describe('assignableRoles', () => {
  it('owner atribui qualquer papel da empresa', () => {
    expect(assignableRoles(user('owner'))).toEqual(TENANT_ROLES);
  });

  it('admin nao cria admin nem owner', () => {
    // Regressao: o admin podia se promover a owner e rebaixar o dono da conta.
    const roles = assignableRoles(user('admin'));
    expect(roles).not.toContain('owner');
    expect(roles).not.toContain('admin');
    expect(roles).toContain('manager');
  });

  it('papeis operacionais nao atribuem nada', () => {
    expect(assignableRoles(user('manager'))).toEqual([]);
    expect(assignableRoles(null)).toEqual([]);
  });

  it('superadmin plantado em tenant comum nao herda poderes', () => {
    expect(assignableRoles({ role: 'superadmin', tenantId: 'acme-1234' })).toEqual([]);
  });
});

describe('canManageMember', () => {
  const owner = { uid: 'o1', role: 'owner', tenantId: 'acme-1234' };
  const admin = { uid: 'a1', role: 'admin', tenantId: 'acme-1234' };

  it('ninguem altera o proprio acesso', () => {
    expect(canManageMember(owner, { id: 'o1', role: 'owner', tenantId: 'acme-1234' })).toBe(false);
  });

  it('admin nao toca em owner nem em outro admin', () => {
    expect(canManageMember(admin, { id: 'o1', role: 'owner', tenantId: 'acme-1234' })).toBe(false);
    expect(canManageMember(admin, { id: 'a2', role: 'admin', tenantId: 'acme-1234' })).toBe(false);
    expect(canManageMember(admin, { id: 'm1', role: 'operator', tenantId: 'acme-1234' })).toBe(true);
  });

  it('nunca gerencia membro de outra empresa', () => {
    expect(canManageMember(owner, { id: 'x', role: 'viewer', tenantId: 'outra-9999' })).toBe(false);
  });

  it('owner gerencia outros owners', () => {
    expect(canManageMember(owner, { id: 'o2', role: 'owner', tenantId: 'acme-1234' })).toBe(true);
  });
});

describe('Cloud Vault RBAC & Zero-Knowledge LGPD', () => {
  it('cloud:connect exige admin ou owner', () => {
    expect(can(user('owner'), 'cloud:connect')).toBe(true);
    expect(can(user('admin'), 'cloud:connect')).toBe(true);
    expect(can(user('manager'), 'cloud:connect')).toBe(false);
    expect(can(user('member'), 'cloud:connect')).toBe(false);
    expect(can(user('operator'), 'cloud:connect')).toBe(false);
    expect(can(user('viewer'), 'cloud:connect')).toBe(false);
    expect(can(user('collaborator'), 'cloud:connect')).toBe(false);
  });

  it('cloud:acl exige manager ou superior', () => {
    expect(can(user('owner'), 'cloud:acl')).toBe(true);
    expect(can(user('admin'), 'cloud:acl')).toBe(true);
    expect(can(user('manager'), 'cloud:acl')).toBe(true);
    expect(can(user('member'), 'cloud:acl')).toBe(false);
    expect(can(user('operator'), 'cloud:acl')).toBe(false);
    expect(can(user('viewer'), 'cloud:acl')).toBe(false);
    expect(can(user('collaborator'), 'cloud:acl')).toBe(false);
  });

  it('cloud:write exige operator ou superior', () => {
    expect(can(user('owner'), 'cloud:write')).toBe(true);
    expect(can(user('admin'), 'cloud:write')).toBe(true);
    expect(can(user('manager'), 'cloud:write')).toBe(true);
    expect(can(user('member'), 'cloud:write')).toBe(true);
    expect(can(user('operator'), 'cloud:write')).toBe(true);
    expect(can(user('viewer'), 'cloud:write')).toBe(false);
    expect(can(user('collaborator'), 'cloud:write')).toBe(false);
  });

  it('cloud:read libera viewer+ e collaborator (Portal do Colaborador)', () => {
    expect(COLLABORATOR_CAPABILITIES.has('cloud:read')).toBe(true);
    ['collaborator', 'viewer', 'operator', 'member', 'manager', 'admin', 'owner'].forEach((role) => {
      expect(can(user(role), 'cloud:read')).toBe(true);
    });
  });

  it('collaborator nao sofre escalonamento de privilegio fora de cloud:read', () => {
    const colab = user('collaborator');
    expect(can(colab, 'assets:read')).toBe(false);
    expect(can(colab, 'terms:read')).toBe(false);
    expect(can(colab, 'nao:existe')).toBe(false);
    expect(hasRole(colab, 'viewer')).toBe(false);
    expect(isTenantAdmin(colab)).toBe(false);
    expect(assignableRoles(colab)).toEqual([]);
  });

  it('superadmin sofre bloqueio Zero-Knowledge LGPD em todas as capacidades cloud:*', () => {
    const master = { role: 'superadmin', tenantId: 'nexus-master' };
    ['cloud:connect', 'cloud:acl', 'cloud:write', 'cloud:read'].forEach((cap) => {
      expect(TENANT_ONLY_CAPABILITIES.has(cap)).toBe(true);
      expect(can(master, cap)).toBe(false);
    });
  });

  it('superadmin plantado em tenant comum nao recebe nenhuma capacidade nem papel administrativo', () => {
    const planted = { role: 'superadmin', tenantId: 'acme-1' };
    [
      'cloud:connect',
      'cloud:acl',
      'cloud:write',
      'cloud:read',
      'agent:read',
      'assets:read',
      'settings:write',
      'plans:manage',
      'tenant:manage',
    ].forEach((cap) => {
      expect(can(planted, cap)).toBe(false);
    });
    expect(isTenantAdmin(planted)).toBe(false);
    expect(hasRole(planted, 'viewer')).toBe(false);
    expect(hasRole(planted, 'owner')).toBe(false);
    expect(isSuperadmin(planted)).toBe(false);
    expect(assignableRoles(planted)).toEqual([]);
  });

  it('superadmin master tambem recebe false para capacidade inexistente', () => {
    const master = { role: 'superadmin', tenantId: 'nexus-master' };
    expect(can(master, 'nonexistent:cap')).toBe(false);
  });
});
