import { describe, it, expect } from 'vitest';
import { can, hasRole, hasValidTenant, isSuperadmin, isTenantAdmin } from './permissions';

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
