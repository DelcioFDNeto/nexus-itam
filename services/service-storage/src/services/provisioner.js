// services/service-storage/src/services/provisioner.js
// =============================================================================
// Provisionador Idempotente da Árvore Corporativa Padrão na VPS
// =============================================================================

import { authRepo, storageRepo } from '../../../shared/db.js';
import { normalizeVirtualVaultPath } from '../../../shared/security.js';

function isSafeSingleSegment(seg) {
  if (!seg || typeof seg !== 'string') return false;
  const trimmed = seg.trim();
  if (!trimmed || trimmed === '.' || trimmed === '..') return false;
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('\0') || trimmed.includes('..')) {
    return false;
  }
  return true;
}

export async function provisionCorporateVault(tenantId, user, driver) {
  // 1. Ensure physical connectivity first so offline nodes fail BEFORE creating DB rows
  await driver.mkdir('/.nexus_versions');
  await driver.mkdir('/.nexus_trash');

  const provisionedPaths = [];

  async function ensureFolder({ parentId = null, name, virtualPath, departmentScope = null, defaultRules = [] }) {
    const normPath = normalizeVirtualVaultPath(virtualPath);
    await driver.mkdir(normPath);

    let node = await storageRepo.getNodeByPath(tenantId, normPath);
    if (!node) {
      node = await storageRepo.createNode(tenantId, {
        parentId,
        name,
        virtualPath: normPath,
        storageKey: normPath,
        nodeType: 'folder',
        mimeType: 'inode/directory',
        sizeBytes: 0,
        departmentScope,
        createdByEmail: user.email,
      });
    }
    provisionedPaths.push(normPath);

    for (const rule of defaultRules) {
      await storageRepo.upsertNodeAcl(tenantId, node.id, {
        targetType: rule.targetType,
        targetValue: rule.targetValue,
        accessLevel: rule.accessLevel,
        grantedByEmail: user.email,
      });
    }

    return node;
  }

  // Root standard folders
  const corpPublic = await ensureFolder({
    parentId: null,
    name: 'Corporativo-Publico',
    virtualPath: '/Corporativo-Publico',
    defaultRules: [
      { targetType: 'role', targetValue: 'collaborator', accessLevel: 'reader' },
      { targetType: 'role', targetValue: 'viewer', accessLevel: 'reader' },
      { targetType: 'role', targetValue: 'operator', accessLevel: 'editor' },
      { targetType: 'role', targetValue: 'member', accessLevel: 'editor' },
      { targetType: 'role', targetValue: 'manager', accessLevel: 'full_control' },
    ],
  });

  const setoresRoot = await ensureFolder({
    parentId: null,
    name: 'Setores',
    virtualPath: '/Setores',
    defaultRules: [
      { targetType: 'role', targetValue: 'collaborator', accessLevel: 'reader' },
      { targetType: 'role', targetValue: 'viewer', accessLevel: 'reader' },
      { targetType: 'role', targetValue: 'operator', accessLevel: 'editor' },
    ],
  });

  const cofreTi = await ensureFolder({
    parentId: null,
    name: 'Cofre-TI-Infra',
    virtualPath: '/Cofre-TI-Infra',
    departmentScope: 'TI',
    defaultRules: [
      { targetType: 'role', targetValue: 'collaborator', accessLevel: 'none' },
      { targetType: 'role', targetValue: 'owner', accessLevel: 'full_control' },
      { targetType: 'role', targetValue: 'admin', accessLevel: 'full_control' },
      { targetType: 'role', targetValue: 'manager', accessLevel: 'full_control' },
      { targetType: 'role', targetValue: 'operator', accessLevel: 'editor' },
    ],
  });

  await ensureFolder({
    parentId: cofreTi.id,
    name: 'Termos',
    virtualPath: '/Cofre-TI-Infra/Termos',
    departmentScope: 'TI',
    defaultRules: [{ targetType: 'role', targetValue: 'collaborator', accessLevel: 'none' }],
  });

  await ensureFolder({
    parentId: null,
    name: 'Chamados',
    virtualPath: '/Chamados',
    departmentScope: 'TI',
    defaultRules: [
      { targetType: 'role', targetValue: 'collaborator', accessLevel: 'none' },
      { targetType: 'role', targetValue: 'operator', accessLevel: 'editor' },
      { targetType: 'role', targetValue: 'manager', accessLevel: 'full_control' },
    ],
  });

  const espacoPessoal = await ensureFolder({
    parentId: null,
    name: 'Espaco-Pessoal',
    virtualPath: '/Espaco-Pessoal',
    defaultRules: [{ targetType: 'role', targetValue: 'collaborator', accessLevel: 'reader' }],
  });

  // Discover tenant users and departments
  const tenantUsers = await authRepo.listTenantUsers(tenantId).catch(() => []);
  const departments = new Set(['TI', 'Financeiro', 'RH', 'Comercial']);
  if (user.department && isSafeSingleSegment(user.department)) {
    departments.add(user.department.trim());
  }
  for (const u of tenantUsers) {
    if (u.department && isSafeSingleSegment(u.department)) {
      departments.add(u.department.trim());
    }
  }

  for (const dept of departments) {
    if (!isSafeSingleSegment(dept)) continue;
    await ensureFolder({
      parentId: setoresRoot.id,
      name: dept,
      virtualPath: `/Setores/${dept}`,
      departmentScope: dept,
      defaultRules: [
        { targetType: 'department', targetValue: dept, accessLevel: 'editor' },
      ],
    });
  }

  const userEmails = new Set();
  if (user.email && isSafeSingleSegment(user.email)) {
    userEmails.add(user.email.toLowerCase());
  }
  for (const u of tenantUsers) {
    if (u.email && isSafeSingleSegment(u.email)) {
      userEmails.add(u.email.toLowerCase());
    }
  }

  for (const email of userEmails) {
    await ensureFolder({
      parentId: espacoPessoal.id,
      name: email,
      virtualPath: `/Espaco-Pessoal/${email}`,
      defaultRules: [
        { targetType: 'user', targetValue: email, accessLevel: 'full_control' },
      ],
    });
  }

  const updatedConn = await storageRepo.updateConnectionStatus(tenantId, {
    status: 'connected',
    initializedAt: new Date().toISOString(),
    lastCheckAt: new Date().toISOString(),
    lastError: null,
  });

  return {
    ok: true,
    connection: updatedConn,
    provisioned: provisionedPaths,
    roots: {
      corpPublicId: corpPublic.id,
      setoresId: setoresRoot.id,
      cofreTiId: cofreTi.id,
      espacoPessoalId: espacoPessoal.id,
    },
  };
}
