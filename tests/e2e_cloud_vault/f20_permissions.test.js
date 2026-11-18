// tests/e2e_cloud_vault/f20_permissions.test.js
// =============================================================================
// E2E-M3 F-20: Global RBAC Capabilities & Zero-Knowledge LGPD (`permissions.js`)
// Tier 1 (Unit/Contract: 5) + Tier 2 (Security/Boundary/Multitenancy: 5)
// =============================================================================

import { describe, expect, it } from 'vitest';
import { requireModuleOrFail } from './helpers/uiTestHarness.js';

const TENANT_ROLES_ORDERED = ['owner', 'admin', 'manager', 'member', 'operator', 'viewer', 'collaborator'];
const makeUser = (role, tenantId = 'tenant-acme', extra = {}) => ({
  uid: `uid-${role}-${tenantId}`,
  email: `${role}@empresa.com.br`,
  role,
  tenantId,
  ...extra,
});

describe('F-20: Global RBAC Capabilities (src/utils/permissions.js)', () => {
  describe('Tier 1 — Capability Matrix & Collaborator Contract', () => {
    it('F20-T1-01: cloud:connect capability grants only owner and admin', async () => {
      const perms = await requireModuleOrFail('src/utils/permissions.js', 'M1');

      expect(perms.CAPABILITIES['cloud:connect']).toBe('admin');
      expect(perms.TENANT_ONLY_CAPABILITIES.has('cloud:connect')).toBe(true);

      const expected = {
        owner: true,
        admin: true,
        manager: false,
        member: false,
        operator: false,
        viewer: false,
        collaborator: false,
      };

      for (const role of TENANT_ROLES_ORDERED) {
        expect(perms.can(makeUser(role), 'cloud:connect')).toBe(expected[role]);
      }
    });

    it('F20-T1-02: cloud:acl capability grants manager, admin, and owner only', async () => {
      const perms = await requireModuleOrFail('src/utils/permissions.js', 'M1');

      expect(perms.CAPABILITIES['cloud:acl']).toBe('manager');
      expect(perms.TENANT_ONLY_CAPABILITIES.has('cloud:acl')).toBe(true);

      const expected = {
        owner: true,
        admin: true,
        manager: true,
        member: false,
        operator: false,
        viewer: false,
        collaborator: false,
      };

      for (const role of TENANT_ROLES_ORDERED) {
        expect(perms.can(makeUser(role), 'cloud:acl')).toBe(expected[role]);
      }
    });

    it('F20-T1-03: cloud:write capability grants operator and above, denying viewer and collaborator', async () => {
      const perms = await requireModuleOrFail('src/utils/permissions.js', 'M1');

      expect(perms.CAPABILITIES['cloud:write']).toBe('operator');
      expect(perms.TENANT_ONLY_CAPABILITIES.has('cloud:write')).toBe(true);

      const expected = {
        owner: true,
        admin: true,
        manager: true,
        member: true,
        operator: true,
        viewer: false,
        collaborator: false,
      };

      for (const role of TENANT_ROLES_ORDERED) {
        expect(perms.can(makeUser(role), 'cloud:write')).toBe(expected[role]);
      }
    });

    it('F20-T1-04: cloud:read capability grants all tenant roles and collaborator via COLLABORATOR_CAPABILITIES', async () => {
      const perms = await requireModuleOrFail('src/utils/permissions.js', 'M1');

      expect(perms.CAPABILITIES['cloud:read']).toBe('viewer');
      expect(perms.TENANT_ONLY_CAPABILITIES.has('cloud:read')).toBe(true);
      expect(perms.COLLABORATOR_CAPABILITIES instanceof Set).toBe(true);
      expect(perms.COLLABORATOR_CAPABILITIES.has('cloud:read')).toBe(true);
      expect(perms.COLLABORATOR_CAPABILITIES.size).toBe(1);

      for (const role of TENANT_ROLES_ORDERED) {
        expect(perms.can(makeUser(role), 'cloud:read')).toBe(true);
      }
    });

    it('F20-T1-05: collaborator stays isolated at rank -1 in frontend and lowest hierarchy in backend security.js', async () => {
      const perms = await requireModuleOrFail('src/utils/permissions.js', 'M1');
      const sec = await requireModuleOrFail('services/shared/security.js', 'M1');

      const colab = makeUser('collaborator');
      expect(perms.ROLES.includes('collaborator')).toBe(false);
      expect(perms.TENANT_ROLES.includes('collaborator')).toBe(false);
      expect(perms.TENANT_ROLES.includes('superadmin')).toBe(false);
      expect(perms.ROLE_LABELS.collaborator).toBe('Colaborador');
      expect(perms.hasRole(colab, 'viewer')).toBe(false);
      expect(perms.isTenantAdmin(colab)).toBe(false);
      expect(perms.assignableRoles(colab)).toEqual([]);

      expect(sec.ROLE_HIERARCHY).toBeDefined();
      expect(sec.ROLE_HIERARCHY.collaborator).toBeLessThan(sec.ROLE_HIERARCHY.viewer);
      expect(sec.ROLE_HIERARCHY.viewer).toBeLessThan(sec.ROLE_HIERARCHY.operator);
      expect(sec.ROLE_HIERARCHY.manager).toBeLessThan(sec.ROLE_HIERARCHY.admin);
      expect(sec.ROLE_HIERARCHY.admin).toBeLessThan(sec.ROLE_HIERARCHY.owner);
    });
  });

  describe('Tier 2 — Zero-Knowledge LGPD, Anti-Escalation & Fail-Closed Guards', () => {
    it('F20-T2-01: Zero-Knowledge LGPD blocks master superadmin on all cloud:* and agent:* capabilities', async () => {
      const perms = await requireModuleOrFail('src/utils/permissions.js', 'M1');
      const sec = await requireModuleOrFail('services/shared/security.js', 'M1');

      const master = makeUser('superadmin', perms.MASTER_TENANT);
      expect(perms.isSuperadmin(master)).toBe(true);

      const expectedTenantOnly = [
        'agent:read',
        'agent:remote',
        'agent:manage',
        'cloud:connect',
        'cloud:acl',
        'cloud:write',
        'cloud:read',
      ];
      for (const cap of expectedTenantOnly) {
        expect(perms.TENANT_ONLY_CAPABILITIES.has(cap)).toBe(true);
        expect(perms.can(master, cap)).toBe(false);
      }

      // Commercial / platform governance capabilities remain allowed for legitimate master
      expect(perms.can(master, 'tenant:manage')).toBe(true);
      expect(perms.can(master, 'plans:manage')).toBe(true);
      expect(perms.can(master, 'settings:write')).toBe(true);

      // Backend parity check
      expect(sec.isZeroKnowledgeRestricted(master)).toBe(true);
      expect(() => sec.assertZeroKnowledgeAllowed(master)).toThrow(/Zero-Knowledge/i);
    });

    it('F20-T2-02: planted or spoofed superadmin outside nexus-master tenant is completely powerless', async () => {
      const perms = await requireModuleOrFail('src/utils/permissions.js', 'M1');

      const planted = makeUser('superadmin', 'acme-1234');
      const emptyTenantSuper = makeUser('superadmin', '');

      for (const spoof of [planted, emptyTenantSuper]) {
        expect(perms.isSuperadmin(spoof)).toBe(false);
        expect(perms.hasRole(spoof, 'viewer')).toBe(false);
        expect(perms.isTenantAdmin(spoof)).toBe(false);
        expect(perms.assignableRoles(spoof)).toEqual([]);

        for (const cap of Object.keys(perms.CAPABILITIES)) {
          expect(perms.can(spoof, cap)).toBe(false);
        }
      }
    });

    it('F20-T2-03: collaborator cannot escalate to any non-cloud:read capability or member management', async () => {
      const perms = await requireModuleOrFail('src/utils/permissions.js', 'M1');
      const colab = makeUser('collaborator', 'acme-1', { uid: 'u-colab-1' });

      const forbiddenCaps = Object.keys(perms.CAPABILITIES).filter((c) => c !== 'cloud:read');
      expect(forbiddenCaps.length).toBeGreaterThan(15);

      for (const cap of forbiddenCaps) {
        expect(perms.can(colab, cap)).toBe(false);
      }

      expect(perms.canManageMember(colab, { id: 'u-v1', role: 'viewer', tenantId: 'acme-1' })).toBe(false);
      expect(perms.canManageMember(colab, { id: 'u-c2', role: 'collaborator', tenantId: 'acme-1' })).toBe(false);
    });

    it('F20-T2-04: fail-closed behavior for null users, unknown roles, and unknown capabilities', async () => {
      const perms = await requireModuleOrFail('src/utils/permissions.js', 'M1');
      const master = makeUser('superadmin', perms.MASTER_TENANT);
      const owner = makeUser('owner', 'acme-1');

      expect(perms.can(null, 'cloud:read')).toBe(false);
      expect(perms.can(undefined, 'cloud:read')).toBe(false);
      expect(perms.can({}, 'cloud:read')).toBe(false);
      expect(perms.can(makeUser('unknown_role'), 'cloud:read')).toBe(false);
      expect(perms.can(owner, 'cloud:nonexistent')).toBe(false);
      expect(perms.can(owner, '')).toBe(false);
      expect(perms.can(master, 'cloud:nonexistent')).toBe(false);
      expect(perms.hasRole(null, 'viewer')).toBe(false);
      expect(perms.hasRole(makeUser('hacker'), 'viewer')).toBe(false);
    });

    it('F20-T2-05: hasValidTenant rejects orphan/default tenants and canManageMember enforces tenant & privilege bounds', async () => {
      const perms = await requireModuleOrFail('src/utils/permissions.js', 'M1');

      expect(perms.hasValidTenant(null)).toBe(false);
      expect(perms.hasValidTenant({})).toBe(false);
      expect(perms.hasValidTenant({ tenantId: '' })).toBe(false);
      expect(perms.hasValidTenant({ tenantId: 'default-tenant' })).toBe(false);
      expect(perms.hasValidTenant({ tenantId: 12345 })).toBe(false);
      expect(perms.hasValidTenant({ tenantId: 'acme-real' })).toBe(true);

      const ownerA = makeUser('owner', 'acme-a', { uid: 'uid-owner-a' });
      const adminA = makeUser('admin', 'acme-a', { uid: 'uid-admin-a' });

      // Cannot self-modify
      expect(perms.canManageMember(ownerA, { uid: 'uid-owner-a', role: 'owner', tenantId: 'acme-a' })).toBe(false);
      // Admin cannot manage owner or another admin, but can manage manager..viewer
      expect(perms.canManageMember(adminA, { uid: 'uid-owner-a', role: 'owner', tenantId: 'acme-a' })).toBe(false);
      expect(perms.canManageMember(adminA, { uid: 'uid-admin-2', role: 'admin', tenantId: 'acme-a' })).toBe(false);
      expect(perms.canManageMember(adminA, { uid: 'uid-mgr-1', role: 'manager', tenantId: 'acme-a' })).toBe(true);
      // Cross-tenant always blocked
      expect(perms.canManageMember(ownerA, { uid: 'uid-mgr-b', role: 'manager', tenantId: 'acme-b' })).toBe(false);
    });
  });
});
