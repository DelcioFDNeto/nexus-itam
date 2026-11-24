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
  if (typeof driver.mkdirBatch === 'function') {
    await driver.mkdirBatch(['/.nexus_versions', '/.nexus_trash']);
  } else {
    await driver.mkdir('/.nexus_versions');
    await driver.mkdir('/.nexus_trash');
  }

  const provisionedPaths = [];

  async function ensureFolderRecord({ parentId = null, name, virtualPath, departmentScope = null, defaultRules = [], skipPhysicalMkdir = false }) {
    const normPath = normalizeVirtualVaultPath(virtualPath);
    if (!skipPhysicalMkdir) {
      await driver.mkdir(normPath);
    }

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

    if (defaultRules.length > 0) {
      await Promise.all(
        defaultRules.map((rule) =>
          storageRepo.upsertNodeAcl(tenantId, node.id, {
            targetType: rule.targetType,
            targetValue: rule.targetValue,
            accessLevel: rule.accessLevel,
            grantedByEmail: user.email,
          }),
        ),
      );
    }

    return node;
  }

  // Discover tenant users and departments upfront so we can batch all physical mkdirs in 1 round-trip
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

  const userEmails = new Set();
  if (user.email && isSafeSingleSegment(user.email)) {
    userEmails.add(user.email.toLowerCase());
  }
  for (const u of tenantUsers) {
    if (u.email && isSafeSingleSegment(u.email)) {
      userEmails.add(u.email.toLowerCase());
    }
  }

  const safeDepts = [...departments].filter(isSafeSingleSegment);
  const safeEmails = [...userEmails];

  const allPhysicalPaths = [
    '/Corporativo-Publico',
    '/Setores',
    '/Cofre-TI-Infra',
    '/Cofre-TI-Infra/Termos',
    '/Chamados',
    '/Espaco-Pessoal',
    ...safeDepts.map((dept) => `/Setores/${dept}`),
    ...safeEmails.map((email) => `/Espaco-Pessoal/${email}`),
  ];

  const batchedPhysically = typeof driver.mkdirBatch === 'function';
  if (batchedPhysically) {
    await driver.mkdirBatch(allPhysicalPaths);
  } else {
    await Promise.all(allPhysicalPaths.map((vp) => driver.mkdir(vp)));
  }

  // Root standard folders (parallel DB creation)
  const [corpPublic, setoresRoot, cofreTi, , espacoPessoal] = await Promise.all([
    ensureFolderRecord({
      parentId: null,
      name: 'Corporativo-Publico',
      virtualPath: '/Corporativo-Publico',
      skipPhysicalMkdir: true,
      defaultRules: [
        { targetType: 'role', targetValue: 'collaborator', accessLevel: 'reader' },
        { targetType: 'role', targetValue: 'viewer', accessLevel: 'reader' },
        { targetType: 'role', targetValue: 'operator', accessLevel: 'editor' },
        { targetType: 'role', targetValue: 'member', accessLevel: 'editor' },
        { targetType: 'role', targetValue: 'manager', accessLevel: 'full_control' },
      ],
    }),
    ensureFolderRecord({
      parentId: null,
      name: 'Setores',
      virtualPath: '/Setores',
      skipPhysicalMkdir: true,
      defaultRules: [
        { targetType: 'role', targetValue: 'collaborator', accessLevel: 'reader' },
        { targetType: 'role', targetValue: 'viewer', accessLevel: 'reader' },
        { targetType: 'role', targetValue: 'operator', accessLevel: 'editor' },
      ],
    }),
    ensureFolderRecord({
      parentId: null,
      name: 'Cofre-TI-Infra',
      virtualPath: '/Cofre-TI-Infra',
      departmentScope: 'TI',
      skipPhysicalMkdir: true,
      defaultRules: [
        { targetType: 'role', targetValue: 'collaborator', accessLevel: 'none' },
        { targetType: 'role', targetValue: 'owner', accessLevel: 'full_control' },
        { targetType: 'role', targetValue: 'admin', accessLevel: 'full_control' },
        { targetType: 'role', targetValue: 'manager', accessLevel: 'full_control' },
        { targetType: 'role', targetValue: 'operator', accessLevel: 'editor' },
      ],
    }),
    ensureFolderRecord({
      parentId: null,
      name: 'Chamados',
      virtualPath: '/Chamados',
      departmentScope: 'TI',
      skipPhysicalMkdir: true,
      defaultRules: [
        { targetType: 'role', targetValue: 'collaborator', accessLevel: 'none' },
        { targetType: 'role', targetValue: 'operator', accessLevel: 'editor' },
        { targetType: 'role', targetValue: 'manager', accessLevel: 'full_control' },
      ],
    }),
    ensureFolderRecord({
      parentId: null,
      name: 'Espaco-Pessoal',
      virtualPath: '/Espaco-Pessoal',
      skipPhysicalMkdir: true,
      defaultRules: [{ targetType: 'role', targetValue: 'collaborator', accessLevel: 'reader' }],
    }),
  ]);

  // Child standard folders in parallel
  await Promise.all([
    ensureFolderRecord({
      parentId: cofreTi.id,
      name: 'Termos',
      virtualPath: '/Cofre-TI-Infra/Termos',
      departmentScope: 'TI',
      skipPhysicalMkdir: true,
      defaultRules: [{ targetType: 'role', targetValue: 'collaborator', accessLevel: 'none' }],
    }),
    ...safeDepts.map((dept) =>
      ensureFolderRecord({
        parentId: setoresRoot.id,
        name: dept,
        virtualPath: `/Setores/${dept}`,
        departmentScope: dept,
        skipPhysicalMkdir: true,
        defaultRules: [{ targetType: 'department', targetValue: dept, accessLevel: 'editor' }],
      }),
    ),
    ...safeEmails.map((email) =>
      ensureFolderRecord({
        parentId: espacoPessoal.id,
        name: email,
        virtualPath: `/Espaco-Pessoal/${email}`,
        skipPhysicalMkdir: true,
        defaultRules: [{ targetType: 'user', targetValue: email, accessLevel: 'full_control' }],
      }),
    ),
  ]);

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
