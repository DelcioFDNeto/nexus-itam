// services/tests/storage_foundation.test.js
// =============================================================================
// Suíte de Testes M1 — Foundation, Dependencies, Schema, Security, RBAC & Quota
// =============================================================================
import crypto from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.NEXUS_DB_MODE = 'memory';

const security = await import('../shared/security.js');
const db = await import('../shared/db.js');

const {
  ROLE_HIERARCHY,
  assertZeroKnowledgeAllowed,
  decryptVaultCredentials,
  encryptVaultCredentials,
  isZeroKnowledgeRestricted,
  normalizeVirtualVaultPath,
  requireRoles,
  resolveSafeVaultPath,
  resolveStorageMasterKey,
  signGatewayContext,
  verifyGatewayOrJwt,
} = security;

const { initDatabase, resetMemoryStoreWithSeed, storageRepo } = db;

describe('F-01 — Dependências ESM (ssh2 & xlsx@0.20.3)', () => {
  it('importa ssh2 com Client constructor válido', async () => {
    const ssh2 = await import('ssh2');
    const Client = ssh2.Client || ssh2.default?.Client;
    expect(typeof Client).toBe('function');
  });

  it('importa xlsx@0.20.3 e executa round-trip completo de workbook em memória', async () => {
    const XLSX = await import('xlsx');
    expect(XLSX.version).toBe('0.20.3');

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['Item', 'Valor', 'Total'],
      ['Notebook Pro', 5500, { t: 'n', f: 'B2*2' }],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'Inventario');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);

    const parsed = XLSX.read(buffer, { type: 'buffer' });
    expect(parsed.SheetNames).toEqual(['Inventario']);
    const sheet = parsed.Sheets.Inventario;
    expect(sheet.A1.v).toBe('Item');
    expect(sheet.A2.v).toBe('Notebook Pro');
    expect(sheet.B2.v).toBe(5500);
    expect(sheet.C2.f).toBe('B2*2');
  });
});

describe('F-03 — Criptografia AES-256-GCM e Chave Mestra do Cofre', () => {
  it('deriva chave determinística de 32 bytes e rejeita overrides fracos', () => {
    const k1 = resolveStorageMasterKey();
    const k2 = resolveStorageMasterKey();
    expect(Buffer.isBuffer(k1)).toBe(true);
    expect(k1.length).toBe(32);
    expect(k1.equals(k2)).toBe(true);

    expect(() => resolveStorageMasterKey('curta-demais')).toThrow(/inválida/i);
    try {
      resolveStorageMasterKey('short');
    } catch (err) {
      expect(err.code).toBe('INVALID_STORAGE_MASTER_KEY');
    }
  });

  it('falha fechado (fail-closed) em NODE_ENV=production sem NEXUS_STORAGE_MASTER_KEY', () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevKeys = {
      NEXUS_STORAGE_MASTER_KEY: process.env.NEXUS_STORAGE_MASTER_KEY,
      STORAGE_MASTER_KEY: process.env.STORAGE_MASTER_KEY,
      NEXUS_VAULT_SECRET: process.env.NEXUS_VAULT_SECRET,
    };
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.NEXUS_STORAGE_MASTER_KEY;
      delete process.env.STORAGE_MASTER_KEY;
      delete process.env.NEXUS_VAULT_SECRET;

      expect(() => resolveStorageMasterKey()).toThrow(/\[SECURITY FATAL\]/);
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
      for (const [k, v] of Object.entries(prevKeys)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it('cifra e decifra credenciais VPS com IV aleatório único por operação', () => {
    const masterKey = 'super-strong-tenant-vault-master-key-2026';
    const payload = {
      authMethod: 'privateKey',
      privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nTESTKEYDATA\n-----END OPENSSH PRIVATE KEY-----',
      passphrase: 'segredo-vps-123',
      accessKeyId: 'AKIA_TEST_123',
      secretAccessKey: 'SECRET_TEST_456',
    };

    const c1 = encryptVaultCredentials(payload, masterKey);
    const c2 = encryptVaultCredentials(payload, masterKey);

    expect(c1).toMatch(/^v1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/i);
    expect(c2).toMatch(/^v1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/i);
    expect(c1).not.toBe(c2);

    const plain1 = decryptVaultCredentials(c1, masterKey);
    const plain2 = decryptVaultCredentials(c2, masterKey);
    expect(plain1).toEqual(payload);
    expect(plain2).toEqual(payload);
  });

  it('detecta adulteração de IV, AuthTag, Ciphertext e chave incorreta', () => {
    const keyA = 'master-key-alpha-2026-very-secure-key';
    const keyB = 'master-key-beta-2026-different-key-x';
    const token = encryptVaultCredentials({ password: 'secret-password' }, keyA);
    const [ver, ivHex, tagHex, cipherHex] = token.split(':');

    const flipFirstHex = (hex) => (hex[0] === '0' ? '1' : '0') + hex.slice(1);

    expect(() =>
      decryptVaultCredentials(`${ver}:${flipFirstHex(ivHex)}:${tagHex}:${cipherHex}`, keyA),
    ).toThrow();
    expect(() =>
      decryptVaultCredentials(`${ver}:${ivHex}:${flipFirstHex(tagHex)}:${cipherHex}`, keyA),
    ).toThrow();
    expect(() =>
      decryptVaultCredentials(`${ver}:${ivHex}:${tagHex}:${flipFirstHex(cipherHex)}`, keyA),
    ).toThrow();

    try {
      decryptVaultCredentials(token, keyB);
      expect.unreachable('Deveria falhar com chave errada');
    } catch (err) {
      expect(err.code).toBe('VAULT_DECRYPT_FAILED');
    }

    for (const bad of ['', 'bad', 'v2:00:00:00', `${ver}:${ivHex}:${tagHex}:zzzz`, `${ver}:${ivHex}:${tagHex}:abc`]) {
      try {
        decryptVaultCredentials(bad, keyA);
        expect.unreachable(`Deveria rejeitar formato inválido: ${bad}`);
      } catch (err) {
        expect(err.code).toBe('VAULT_CIPHERTEXT_INVALID');
      }
    }
  });
});

describe('F-04 — Confinamento Lógico resolveSafeVaultPath', () => {
  it('normaliza e confina caminhos legítimos dentro do rootPath', () => {
    expect(normalizeVirtualVaultPath('')).toBe('/');
    expect(normalizeVirtualVaultPath('/')).toBe('/');
    expect(normalizeVirtualVaultPath('///')).toBe('/');
    expect(normalizeVirtualVaultPath('//Setores//TI///arq.pdf/')).toBe('/Setores/TI/arq.pdf');

    expect(resolveSafeVaultPath('/srv/nexus-vault', '')).toBe('/srv/nexus-vault');
    expect(resolveSafeVaultPath('/srv/nexus-vault', '/')).toBe('/srv/nexus-vault');
    expect(resolveSafeVaultPath('/srv/nexus-vault', '/Setores/TI/relatorio.pdf')).toBe(
      '/srv/nexus-vault/Setores/TI/relatorio.pdf',
    );
    expect(resolveSafeVaultPath('/srv/nexus-vault', '.nexus_versions/v1.bin')).toBe(
      '/srv/nexus-vault/.nexus_versions/v1.bin',
    );
    expect(resolveSafeVaultPath('/srv/nexus-vault', '.nexus_trash/item-123')).toBe(
      '/srv/nexus-vault/.nexus_trash/item-123',
    );
    expect(resolveSafeVaultPath('/srv/nexus-vault', 'docs/report..v2.xlsx')).toBe(
      '/srv/nexus-vault/docs/report..v2.xlsx',
    );
    expect(resolveSafeVaultPath('/srv/nexus-vault', 'docs/meta_100%.pdf')).toBe(
      '/srv/nexus-vault/docs/meta_100%.pdf',
    );
  });

  it('bloqueia todos os vetores de path traversal e prefix escape', () => {
    const vectors = [
      '../etc/passwd',
      '/a/../../b',
      '..',
      '.',
      '/./secret',
      '..\\secret',
      'a\\b',
      '%2e%2e/etc/passwd',
      '%2E%2E/%2e%2e/x',
      '%2e%2e%2fetc',
      'a%2fb',
      'a%5cb',
      '%252e%252e/x',
      '.%2e/x',
      '/a\0.txt',
      '/a%00.txt',
      'C:/Windows/win.ini',
      'c:\\boot.ini',
      '../nexus-vault-evil/secret.txt',
    ];

    for (const vec of vectors) {
      try {
        resolveSafeVaultPath('/srv/nexus-vault', vec);
        expect.unreachable(`Vetor deveria ser bloqueado: ${vec}`);
      } catch (err) {
        expect(err.code).toBe('PATH_TRAVERSAL_BLOCKED');
        expect(err.statusCode).toBe(400);
      }
    }

    expect(() => resolveSafeVaultPath('/srv/../etc', 'passwd')).toThrow();
    expect(() => resolveSafeVaultPath('', 'ok.txt')).toThrow();
  });
});

describe('F-05 — Gateway HMAC x-user-department, Hierarquia RBAC & Zero-Knowledge LGPD', () => {
  it('propaga x-user-department assinado por HMAC e mantém compatibilidade retroativa', () => {
    const baseCtx = {
      userId: 'u-1',
      email: 'ana@empresa.com',
      name: 'Ana Silva',
      role: 'collaborator',
      tenantId: 'tenant-alpha',
      requestId: 'req-123',
    };

    const withDeptHeaders = signGatewayContext({ ...baseCtx, department: 'Vendas & Pós-Vendas' });
    expect(withDeptHeaders['x-user-department']).toBeDefined();
    const verifiedWithDept = verifyGatewayOrJwt({ headers: withDeptHeaders });
    expect(verifiedWithDept.department).toBe('Vendas & Pós-Vendas');
    expect(verifiedWithDept.tenantId).toBe('tenant-alpha');

    // Backwards compatibility without department
    const legacyHeaders = signGatewayContext(baseCtx);
    expect(legacyHeaders['x-user-department']).toBeUndefined();
    const verifiedLegacy = verifyGatewayOrJwt({ headers: legacyHeaders });
    expect(verifiedLegacy.department).toBe('');
    expect(verifiedLegacy.email).toBe('ana@empresa.com');

    // Tamper department value
    expect(() =>
      verifyGatewayOrJwt({
        headers: { ...withDeptHeaders, 'x-user-department': encodeURIComponent('Diretoria') },
      }),
    ).toThrow();

    // Inject department on legacy-signed headers
    expect(() =>
      verifyGatewayOrJwt({
        headers: { ...legacyHeaders, 'x-user-department': 'TI' },
      }),
    ).toThrow();

    // Strip department from dept-signed headers
    const stripped = { ...withDeptHeaders };
    delete stripped['x-user-department'];
    expect(() => verifyGatewayOrJwt({ headers: stripped })).toThrow();
  });

  it('inclui member em ROLE_HIERARCHY e bloqueia superadmin via Zero-Knowledge LGPD', () => {
    expect(ROLE_HIERARCHY.operator).toBeLessThan(ROLE_HIERARCHY.member);
    expect(ROLE_HIERARCHY.member).toBeLessThan(ROLE_HIERARCHY.manager);

    expect(isZeroKnowledgeRestricted({ role: 'superadmin', tenantId: 'nexus-master' })).toBe(true);
    expect(isZeroKnowledgeRestricted({ role: 'superadmin', tenantId: 'tenant-alpha' })).toBe(true);
    for (const role of ['owner', 'admin', 'manager', 'member', 'operator', 'viewer', 'collaborator']) {
      expect(isZeroKnowledgeRestricted({ role, tenantId: 'tenant-alpha' })).toBe(false);
    }

    try {
      assertZeroKnowledgeAllowed({ role: 'superadmin', tenantId: 'nexus-master' });
      expect.unreachable('superadmin deve ser bloqueado');
    } catch (err) {
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe('ZERO_KNOWLEDGE_RESTRICTED');
    }

    try {
      requireRoles({ role: 'superadmin', tenantId: 'nexus-master' }, ['owner', 'admin']);
      expect.unreachable('requireRoles deve bloquear superadmin');
    } catch (err) {
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe('ZERO_KNOWLEDGE_RESTRICTED');
    }
  });
});

describe('F-02 / F-05 — storageRepo Isolamento Multitenant (7 Entidades) & Cota Atômica', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(() => {
    resetMemoryStoreWithSeed();
  });

  it('isola completamente todas as 7 entidades entre Tenant A e Tenant B', async () => {
    const tenantA = 'tenant-alpha';
    const tenantB = 'tenant-beta';

    // 1. vps_connections
    const connA = await storageRepo.upsertConnection(tenantA, {
      providerType: 'sftp',
      label: 'VPS Alpha',
      host: '10.0.0.10',
      port: 22,
      username: 'vault_a',
      rootPath: '/srv/alpha',
      encryptedCredentials: encryptVaultCredentials({ password: 'p1' }),
      quotaBytes: 5000,
      status: 'connected',
    });
    expect(connA.tenant_id).toBe(tenantA);
    expect(await storageRepo.getConnection(tenantB)).toBeNull();
    expect(await storageRepo.deleteConnection(tenantB)).toBeNull();
    expect(await storageRepo.getConnection(tenantA)).not.toBeNull();

    // 2. storage_nodes
    const folderA = await storageRepo.createNode(tenantA, {
      name: 'TI',
      nodeType: 'folder',
      virtualPath: '/TI',
      departmentScope: 'TI',
      createdByEmail: 'admin@alpha.com',
    });
    const sheetA = await storageRepo.createNode(tenantA, {
      parentId: folderA.id,
      name: 'Orcamento.xlsx',
      nodeType: 'spreadsheet',
      virtualPath: '/TI/Orcamento.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: 1200,
      sha256Hash: 'a'.repeat(64),
      departmentScope: 'TI',
      createdByEmail: 'admin@alpha.com',
    });
    const fileB = await storageRepo.createNode(tenantB, {
      name: 'Contrato.pdf',
      nodeType: 'file',
      virtualPath: '/Contrato.pdf',
      sizeBytes: 300,
      createdByEmail: 'admin@beta.com',
    });

    const listA = await storageRepo.listNodes(tenantA);
    const listB = await storageRepo.listNodes(tenantB);
    expect(listA.map((n) => n.id)).toContain(sheetA.id);
    expect(listA.map((n) => n.id)).not.toContain(fileB.id);
    expect(listB.map((n) => n.id)).toEqual([fileB.id]);

    expect(await storageRepo.getNodeById(tenantB, sheetA.id)).toBeNull();
    expect(await storageRepo.getNodeByPath(tenantB, '/TI/Orcamento.xlsx')).toBeNull();
    expect(await storageRepo.updateNode(tenantB, sheetA.id, { name: 'Hacked' })).toBeNull();
    expect(await storageRepo.trashNode(tenantB, sheetA.id, { trashedByEmail: 'b@beta.com' })).toBeNull();
    expect(await storageRepo.getNodeById(tenantA, sheetA.id)).not.toBeNull();

    // 3. storage_acls
    const aclA = await storageRepo.upsertNodeAcl(tenantA, folderA.id, {
      targetType: 'department',
      targetValue: 'TI',
      accessLevel: 'editor',
      grantedByEmail: 'admin@alpha.com',
    });
    expect(await storageRepo.listNodeAcls(tenantA, folderA.id)).toHaveLength(1);
    expect(await storageRepo.listNodeAcls(tenantB, folderA.id)).toEqual([]);
    expect(await storageRepo.deleteNodeAcl(tenantB, folderA.id, aclA.id)).toBeNull();
    await expect(
      storageRepo.upsertNodeAcl(tenantB, folderA.id, {
        targetType: 'user',
        targetValue: 'x@beta.com',
        accessLevel: 'full_control',
      }),
    ).rejects.toThrow();

    // 4. storage_versions
    const verA = await storageRepo.createVersion(tenantA, sheetA.id, {
      sizeBytes: 1200,
      sha256Hash: 'a'.repeat(64),
      storageKey: '.nexus_versions/v1.xlsx',
      uploadedByEmail: 'admin@alpha.com',
      comment: 'Versão inicial',
    });
    expect(verA.version_number).toBe(1);
    expect(await storageRepo.listVersions(tenantA, sheetA.id)).toHaveLength(1);
    expect(await storageRepo.listVersions(tenantB, sheetA.id)).toEqual([]);
    expect(await storageRepo.getVersion(tenantB, sheetA.id, 1)).toBeNull();
    await expect(storageRepo.createVersion(tenantB, sheetA.id, { sizeBytes: 10 })).rejects.toThrow();

    // 5. storage_temp_links
    const tokenHash = crypto.createHash('sha256').update('secret-share-token-a').digest('hex');
    const linkA = await storageRepo.createTempLink(tenantA, sheetA.id, {
      tokenHash,
      createdByEmail: 'admin@alpha.com',
      allowDownload: true,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect(await storageRepo.listTempLinks(tenantA)).toHaveLength(1);
    expect(await storageRepo.listTempLinks(tenantB)).toEqual([]);
    expect(await storageRepo.revokeTempLink(tenantB, linkA.id)).toBeNull();
    const resolvedLink = await storageRepo.getTempLinkByTokenHash(tokenHash);
    expect(resolvedLink.tenant_id).toBe(tenantA);

    // 6. sheet_sessions
    const sessionA = await storageRepo.upsertSheetSession(tenantA, sheetA.id, {
      workbookJson: { sheets: [{ name: 'Dados', cells: { A1: { v: 10 } } }] },
      lastSavedByEmail: 'admin@alpha.com',
    });
    expect(sessionA.rev).toBe(1);
    expect(await storageRepo.getSheetSession(tenantB, sheetA.id)).toBeNull();
    await expect(
      storageRepo.upsertSheetSession(tenantB, sheetA.id, { workbookJson: {} }),
    ).rejects.toThrow();

    // 7. sheet_cell_history
    await storageRepo.appendSheetCellHistory(tenantA, sheetA.id, {
      rev: 1,
      tabName: 'Dados',
      cellRef: 'A1',
      oldValue: '',
      newValue: '10',
      oldFormula: null,
      newFormula: '=5+5',
      actorEmail: 'admin@alpha.com',
      actorName: 'Admin Alpha',
    });
    const histA = await storageRepo.listSheetCellHistory(tenantA, sheetA.id);
    expect(histA).toHaveLength(1);
    expect(histA[0].tab_name).toBe('Dados');
    expect(histA[0].old_value).toBe('');
    expect(histA[0].new_value).toBe('10');
    expect(histA[0].new_formula).toBe('=5+5');
    expect(await storageRepo.listSheetCellHistory(tenantB, sheetA.id)).toEqual([]);
    await expect(
      storageRepo.appendSheetCellHistory(tenantB, sheetA.id, {
        rev: 2,
        tabName: 'Dados',
        cellRef: 'A1',
        actorEmail: 'b@beta.com',
      }),
    ).rejects.toThrow();
  });

  it('aplica cota atômica (incremento, bloqueio QUOTA_EXCEEDED, decremento com clamp e alertas)', async () => {
    const tenantA = 'tenant-quota-a';
    const tenantB = 'tenant-quota-b';

    await storageRepo.upsertConnection(tenantA, {
      providerType: 's3',
      bucket: 'bucket-a',
      encryptedCredentials: encryptVaultCredentials({ accessKeyId: 'a', secretAccessKey: 'b' }),
      quotaBytes: 1000,
    });
    await storageRepo.upsertConnection(tenantB, {
      providerType: 's3',
      bucket: 'bucket-b',
      encryptedCredentials: encryptVaultCredentials({ accessKeyId: 'c', secretAccessKey: 'd' }),
      quotaBytes: 2000,
    });

    const after600 = await storageRepo.reserveQuota(tenantA, 600);
    expect(after600.used_bytes).toBe(600);
    expect((await storageRepo.getQuotaSummary(tenantA)).alertLevel).toBe('ok');

    // Exceed 1000 -> QUOTA_EXCEEDED, used_bytes stays 600
    try {
      await storageRepo.reserveQuota(tenantA, 500);
      expect.unreachable('Deveria bloquear acima da cota');
    } catch (err) {
      expect(err.code).toBe('QUOTA_EXCEEDED');
      expect(err.statusCode).toBe(413);
    }
    expect((await storageRepo.getConnection(tenantA)).used_bytes).toBe(600);

    // 80% warning & 90% critical alerts
    await storageRepo.reserveQuota(tenantA, 200); // 800 / 1000 = 80%
    expect((await storageRepo.getQuotaSummary(tenantA)).alertLevel).toBe('warning_80');

    await storageRepo.reserveQuota(tenantA, 150); // 950 / 1000 = 95%
    expect((await storageRepo.getQuotaSummary(tenantA)).alertLevel).toBe('critical_90');

    // Decrement & clamp at 0
    const afterRelease = await storageRepo.releaseQuota(tenantA, 250);
    expect(afterRelease.used_bytes).toBe(700);
    const clamped = await storageRepo.releaseQuota(tenantA, 5000);
    expect(clamped.used_bytes).toBe(0);

    // Tenant B stays completely isolated
    expect((await storageRepo.getConnection(tenantB)).used_bytes).toBe(0);
  });

  it('normaliza aliases de tenant (shineray -> tenant-ap3htf6) sem split-brain', async () => {
    await storageRepo.upsertConnection('shineray', {
      providerType: 'agent_node',
      host: '192.168.1.50',
      encryptedCredentials: encryptVaultCredentials({ hmacToken: 'tok-123' }),
      quotaBytes: 4096,
    });

    const viaCanonical = await storageRepo.getConnection('tenant-ap3htf6');
    expect(viaCanonical).not.toBeNull();
    expect(viaCanonical.tenant_id).toBe('tenant-ap3htf6');
    expect(viaCanonical.quota_bytes).toBe(4096);
  });

  it('preserva campos omitidos em upsertConnection e lastError em updateConnectionStatus (limpando apenas com null explícito)', async () => {
    const tenant = 'tenant-conn-partial';
    await storageRepo.upsertConnection(tenant, {
      providerType: 'sftp',
      label: 'VPS Principal',
      host: '10.10.0.10',
      port: 2222,
      username: 'vault_user',
      rootPath: '/srv/custom-vault',
      encryptedCredentials: encryptVaultCredentials({ password: 'secret' }),
      quotaBytes: 8192,
      status: 'connected',
    });

    const partial = await storageRepo.upsertConnection(tenant, {
      quotaBytes: 16384,
    });
    expect(partial.provider_type).toBe('sftp');
    expect(partial.label).toBe('VPS Principal');
    expect(partial.host).toBe('10.10.0.10');
    expect(partial.port).toBe(2222);
    expect(partial.username).toBe('vault_user');
    expect(partial.root_path).toBe('/srv/custom-vault');
    expect(partial.quota_bytes).toBe(16384);
    expect(partial.status).toBe('connected');

    const clearedLabel = await storageRepo.upsertConnection(tenant, {
      label: null,
    });
    expect(clearedLabel.label).toBeNull();
    expect(clearedLabel.host).toBe('10.10.0.10');

    const withErr = await storageRepo.updateConnectionStatus(tenant, {
      status: 'error',
      lastError: 'SSH timeout',
      latencyMs: 120,
    });
    expect(withErr.last_error).toBe('SSH timeout');

    const preservedErr = await storageRepo.updateConnectionStatus(tenant, {
      latencyMs: 95,
    });
    expect(preservedErr.last_error).toBe('SSH timeout');
    expect(preservedErr.latency_ms).toBe(95);

    const clearedErr = await storageRepo.updateConnectionStatus(tenant, {
      status: 'connected',
      lastError: null,
    });
    expect(clearedErr.last_error).toBeNull();
    expect(clearedErr.status).toBe('connected');
  });

  it('suporta moveNodeSubtree para raiz (newParentId: null) e rejeita newParentId inválido com 400', async () => {
    const tenant = 'tenant-move-root';
    const rootFolder = await storageRepo.createNode(tenant, {
      name: 'Setores',
      nodeType: 'folder',
      virtualPath: '/Setores',
    });
    const subFolder = await storageRepo.createNode(tenant, {
      parentId: rootFolder.id,
      name: 'TI',
      nodeType: 'folder',
      virtualPath: '/Setores/TI',
    });
    const childFile = await storageRepo.createNode(tenant, {
      parentId: subFolder.id,
      name: 'Manual.pdf',
      nodeType: 'file',
      virtualPath: '/Setores/TI/Manual.pdf',
      sizeBytes: 512,
    });

    await expect(
      storageRepo.moveNodeSubtree(tenant, subFolder.id, {
        newParentId: 'not-a-uuid',
        oldPrefix: '/Setores/TI',
        newPrefix: '/TI',
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    const moved = await storageRepo.moveNodeSubtree(tenant, subFolder.id, {
      newParentId: null,
      oldPrefix: '/Setores/TI',
      newPrefix: '/TI',
      updatedByEmail: 'admin@acme.com',
    });
    expect(moved.parent_id).toBeNull();
    expect(moved.virtual_path).toBe('/TI');

    const movedChild = await storageRepo.getNodeById(tenant, childFile.id);
    expect(movedChild.virtual_path).toBe('/TI/Manual.pdf');
    expect(movedChild.parent_id).toBe(subFolder.id);
  });

  it('isola pastas com caracteres _ e % em listDescendants, moveNodeSubtree e trashNode', async () => {
    const tenant = 'tenant-wildcards';
    const setores = await storageRepo.createNode(tenant, {
      name: 'Setores',
      nodeType: 'folder',
      virtualPath: '/Setores',
    });
    const tiUnderscore = await storageRepo.createNode(tenant, {
      parentId: setores.id,
      name: 'TI_1',
      nodeType: 'folder',
      virtualPath: '/Setores/TI_1',
    });
    const tiHyphen = await storageRepo.createNode(tenant, {
      parentId: setores.id,
      name: 'TI-1',
      nodeType: 'folder',
      virtualPath: '/Setores/TI-1',
    });
    const tiPercent = await storageRepo.createNode(tenant, {
      parentId: setores.id,
      name: 'Meta_100%',
      nodeType: 'folder',
      virtualPath: '/Setores/Meta_100%',
    });
    const tiUnderscoreFile = await storageRepo.createNode(tenant, {
      parentId: tiUnderscore.id,
      name: 'a.txt',
      nodeType: 'file',
      virtualPath: '/Setores/TI_1/a.txt',
    });
    const tiHyphenFile = await storageRepo.createNode(tenant, {
      parentId: tiHyphen.id,
      name: 'b.txt',
      nodeType: 'file',
      virtualPath: '/Setores/TI-1/b.txt',
    });
    const tiPercentFile = await storageRepo.createNode(tenant, {
      parentId: tiPercent.id,
      name: 'c.txt',
      nodeType: 'file',
      virtualPath: '/Setores/Meta_100%/c.txt',
    });

    const descUnderscore = await storageRepo.listDescendants(tenant, '/Setores/TI_1');
    expect(descUnderscore.map((n) => n.virtual_path)).toEqual([
      '/Setores/TI_1',
      '/Setores/TI_1/a.txt',
    ]);
    expect(descUnderscore.map((n) => n.id)).not.toContain(tiHyphenFile.id);

    const descPercent = await storageRepo.listDescendants(tenant, '/Setores/Meta_100%');
    expect(descPercent.map((n) => n.virtual_path)).toEqual([
      '/Setores/Meta_100%',
      '/Setores/Meta_100%/c.txt',
    ]);

    await storageRepo.moveNodeSubtree(tenant, tiUnderscore.id, {
      oldPrefix: '/Setores/TI_1',
      newPrefix: '/Setores/TI_1_Moved',
    });
    expect((await storageRepo.getNodeById(tenant, tiHyphenFile.id)).virtual_path).toBe('/Setores/TI-1/b.txt');
    expect((await storageRepo.getNodeById(tenant, tiUnderscoreFile.id)).virtual_path).toBe(
      '/Setores/TI_1_Moved/a.txt',
    );

    await storageRepo.trashNode(tenant, tiUnderscore.id, { trashedByEmail: 'admin@acme.com' });
    expect(await storageRepo.getNodeById(tenant, tiUnderscoreFile.id)).toBeNull();
    expect(await storageRepo.getNodeById(tenant, tiHyphenFile.id)).not.toBeNull();
    expect(await storageRepo.getNodeById(tenant, tiPercentFile.id)).not.toBeNull();
  });

  it('restaura subárvore completa em restoreNode (inclusive para raiz e com rebase de caminho)', async () => {
    const tenant = 'tenant-restore-subtree';
    const parent = await storageRepo.createNode(tenant, {
      name: 'Projetos',
      nodeType: 'folder',
      virtualPath: '/Projetos',
    });
    const folder = await storageRepo.createNode(tenant, {
      parentId: parent.id,
      name: 'Alpha',
      nodeType: 'folder',
      virtualPath: '/Projetos/Alpha',
    });
    const sub = await storageRepo.createNode(tenant, {
      parentId: folder.id,
      name: 'Docs',
      nodeType: 'folder',
      virtualPath: '/Projetos/Alpha/Docs',
    });
    const doc = await storageRepo.createNode(tenant, {
      parentId: sub.id,
      name: 'Spec.pdf',
      nodeType: 'file',
      virtualPath: '/Projetos/Alpha/Docs/Spec.pdf',
      sizeBytes: 400,
    });

    await storageRepo.trashNode(tenant, folder.id, { trashedByEmail: 'admin@acme.com' });
    expect(await storageRepo.getNodeById(tenant, doc.id)).toBeNull();

    // Conflito em descendente (/AlphaConflito/Docs) impede restauração parcial do pai
    await storageRepo.createNode(tenant, {
      name: 'Docs',
      nodeType: 'folder',
      virtualPath: '/AlphaConflito/Docs',
    });
    await expect(
      storageRepo.restoreNode(tenant, folder.id, {
        targetParentId: null,
        targetVirtualPath: '/AlphaConflito',
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PATH_ALREADY_EXISTS' });
    // Nenhum descendente deve ter sido restaurado parcialmente
    expect(await storageRepo.getNodeById(tenant, doc.id)).toBeNull();
    expect((await storageRepo.getNodeById(tenant, folder.id, { includeTrashed: true })).is_trashed).toBe(true);

    // Restaura para raiz com novo caminho limpo (/AlphaLive)
    const restored = await storageRepo.restoreNode(tenant, folder.id, {
      targetParentId: null,
      targetVirtualPath: '/AlphaLive',
    });
    expect(restored.is_trashed).toBe(false);
    expect(restored.parent_id).toBeNull();
    expect(restored.virtual_path).toBe('/AlphaLive');
    expect(restored.name).toBe('AlphaLive');

    const restoredSub = await storageRepo.getNodeById(tenant, sub.id);
    const restoredDoc = await storageRepo.getNodeById(tenant, doc.id);
    expect(restoredSub.is_trashed).toBe(false);
    expect(restoredSub.virtual_path).toBe('/AlphaLive/Docs');
    expect(restoredDoc.is_trashed).toBe(false);
    expect(restoredDoc.virtual_path).toBe('/AlphaLive/Docs/Spec.pdf');
  });

  it('purgeExpiredTrash faz cascata em filhos não expirados de pasta expirada e soma freedBytes corretamente', async () => {
    const tenant = 'tenant-purge-cascade';
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const folder = await storageRepo.createNode(tenant, {
        name: 'Antiga',
        nodeType: 'folder',
        virtualPath: '/Antiga',
        sizeBytes: 0,
      });
      await storageRepo.trashNode(tenant, folder.id, { trashedByEmail: 'admin@acme.com' });

      vi.setSystemTime(new Date('2026-01-25T00:00:00.000Z'));
      const child = await storageRepo.createNode(tenant, {
        name: 'Anexo.bin',
        nodeType: 'file',
        virtualPath: '/Antiga/Anexo.bin',
        sizeBytes: 2500,
      });
      await storageRepo.createVersion(tenant, child.id, { sizeBytes: 2500 });
      await storageRepo.trashNode(tenant, child.id, { trashedByEmail: 'admin@acme.com' });
      await storageRepo.updateNode(tenant, child.id, { parentId: folder.id });

      // 35 dias após folder (expirado) e apenas 11 dias após child (não expirado por si só)
      vi.setSystemTime(new Date('2026-02-05T00:00:00.000Z'));
      const purged = await storageRepo.purgeExpiredTrash(tenant, 30);
      expect(purged.freedBytes).toBe(2500);
      expect(purged.purgedNodes.map((n) => n.id).sort()).toEqual([folder.id, child.id].sort());
      expect(await storageRepo.getNodeById(tenant, folder.id, { includeTrashed: true })).toBeNull();
      expect(await storageRepo.getNodeById(tenant, child.id, { includeTrashed: true })).toBeNull();
      expect(await storageRepo.listVersions(tenant, child.id)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('appendSheetCellHistory coage valores numéricos/booleanos não nulos para string (paridade TEXT PG16)', async () => {
    const tenant = 'tenant-sheet-coerce';
    const sheet = await storageRepo.createNode(tenant, {
      name: 'Plan.xlsx',
      nodeType: 'spreadsheet',
      virtualPath: '/Plan.xlsx',
    });

    const [entry] = await storageRepo.appendSheetCellHistory(tenant, sheet.id, {
      rev: 2,
      tabName: 'Dados',
      cellRef: 'B2',
      oldValue: 0,
      newValue: false,
      oldFormula: null,
      newFormula: 42,
      actorEmail: 'user@acme.com',
      actorName: 99,
    });

    expect(entry.old_value).toBe('0');
    expect(entry.new_value).toBe('false');
    expect(entry.old_formula).toBeNull();
    expect(entry.new_formula).toBe('42');
    expect(entry.actor_name).toBe('99');
  });

  it('rejeita ciclos, parent cross-tenant, trashed ou não-pasta em createNode e moveNodeSubtree', async () => {
    const tenantA = 'tenant-guard-a';
    const tenantB = 'tenant-guard-b';

    const rootA = await storageRepo.createNode(tenantA, {
      name: 'RootA',
      nodeType: 'folder',
      virtualPath: '/RootA',
    });
    const subA = await storageRepo.createNode(tenantA, {
      parentId: rootA.id,
      name: 'SubA',
      nodeType: 'folder',
      virtualPath: '/RootA/SubA',
    });
    const fileA = await storageRepo.createNode(tenantA, {
      parentId: subA.id,
      name: 'doc.txt',
      nodeType: 'file',
      virtualPath: '/RootA/SubA/doc.txt',
    });
    const otherFileA = await storageRepo.createNode(tenantA, {
      name: 'standalone.txt',
      nodeType: 'file',
      virtualPath: '/standalone.txt',
    });
    const trashedFolderA = await storageRepo.createNode(tenantA, {
      name: 'TrashedA',
      nodeType: 'folder',
      virtualPath: '/TrashedA',
    });
    await storageRepo.trashNode(tenantA, trashedFolderA.id, { trashedByEmail: 'a@acme.com' });

    const folderB = await storageRepo.createNode(tenantB, {
      name: 'FolderB',
      nodeType: 'folder',
      virtualPath: '/FolderB',
    });

    // createNode parent guards
    await expect(
      storageRepo.createNode(tenantA, {
        parentId: 'bad-uuid',
        name: 'x.txt',
        nodeType: 'file',
        virtualPath: '/x.txt',
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_PARENT_NODE' });

    await expect(
      storageRepo.createNode(tenantA, {
        parentId: folderB.id,
        name: 'cross.txt',
        nodeType: 'file',
        virtualPath: '/FolderB/cross.txt',
      }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'INVALID_PARENT_NODE' });

    await expect(
      storageRepo.createNode(tenantA, {
        parentId: trashedFolderA.id,
        name: 'in-trash.txt',
        nodeType: 'file',
        virtualPath: '/TrashedA/in-trash.txt',
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_PARENT_NODE' });

    await expect(
      storageRepo.createNode(tenantA, {
        parentId: fileA.id,
        name: 'under-file.txt',
        nodeType: 'file',
        virtualPath: '/RootA/SubA/doc.txt/under-file.txt',
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_PARENT_NODE' });

    // moveNodeSubtree self-cycle, descendant cycle, path-prefix cycle, cross-tenant, trashed, non-folder
    await expect(
      storageRepo.moveNodeSubtree(tenantA, rootA.id, {
        newParentId: rootA.id,
        oldPrefix: '/RootA',
        newPrefix: '/MovedSelf',
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'CYCLE_DETECTED' });

    await expect(
      storageRepo.moveNodeSubtree(tenantA, rootA.id, {
        newParentId: subA.id,
        oldPrefix: '/RootA',
        newPrefix: '/RootA/SubA/RootA',
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'CYCLE_DETECTED' });

    await expect(
      storageRepo.moveNodeSubtree(tenantA, rootA.id, {
        newParentId: null,
        oldPrefix: '/RootA',
        newPrefix: '/RootA/SubA/Nested',
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'CYCLE_DETECTED' });

    await expect(
      storageRepo.moveNodeSubtree(tenantA, rootA.id, {
        newParentId: folderB.id,
        oldPrefix: '/RootA',
        newPrefix: '/FolderB/RootA',
      }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'INVALID_PARENT_NODE' });

    await expect(
      storageRepo.moveNodeSubtree(tenantA, rootA.id, {
        newParentId: trashedFolderA.id,
        oldPrefix: '/RootA',
        newPrefix: '/TrashedA/RootA',
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_PARENT_NODE' });

    await expect(
      storageRepo.moveNodeSubtree(tenantA, rootA.id, {
        newParentId: otherFileA.id,
        oldPrefix: '/RootA',
        newPrefix: '/standalone.txt/RootA',
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_PARENT_NODE' });

    // Tree remains uncorrupted
    expect((await storageRepo.getNodeById(tenantA, rootA.id)).parent_id).toBeNull();
    expect((await storageRepo.getNodeById(tenantA, subA.id)).parent_id).toBe(rootA.id);
  });

  it('restoreNode bloqueia pai na lixeira (PARENT_IS_TRASHED), atualiza name no rebase e isola snapshot de lixeira', async () => {
    const tenant = 'tenant-restore-snapshot';
    const docs = await storageRepo.createNode(tenant, {
      name: 'Docs',
      nodeType: 'folder',
      virtualPath: '/Docs',
    });
    const oldFile = await storageRepo.createNode(tenant, {
      parentId: docs.id,
      name: 'spec.pdf',
      nodeType: 'file',
      virtualPath: '/Docs/spec.pdf',
      sizeBytes: 100,
    });

    // 1. Trash oldFile independently, then recreate /Docs/spec.pdf, then trash /Docs
    await storageRepo.trashNode(tenant, oldFile.id, { trashedByEmail: 'a@acme.com' });
    const newFile = await storageRepo.createNode(tenant, {
      parentId: docs.id,
      name: 'spec.pdf',
      nodeType: 'file',
      virtualPath: '/Docs/spec.pdf',
      sizeBytes: 200,
    });
    await storageRepo.trashNode(tenant, docs.id, { trashedByEmail: 'a@acme.com' });

    // 2. Restoring oldFile or newFile without targetParentId must fail with PARENT_IS_TRASHED
    await expect(storageRepo.restoreNode(tenant, newFile.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'PARENT_IS_TRASHED',
    });

    // 3. Restoring /Docs succeeds cleanly despite oldFile sharing original path in trash
    const restoredDocs = await storageRepo.restoreNode(tenant, docs.id);
    expect(restoredDocs.is_trashed).toBe(false);
    expect(restoredDocs.virtual_path).toBe('/Docs');

    const restoredNewFile = await storageRepo.getNodeById(tenant, newFile.id);
    expect(restoredNewFile.is_trashed).toBe(false);
    expect(restoredNewFile.virtual_path).toBe('/Docs/spec.pdf');

    const stillTrashedOld = await storageRepo.getNodeById(tenant, oldFile.id, { includeTrashed: true });
    expect(stillTrashedOld.is_trashed).toBe(true);

    // 4. Restoring oldFile with targetParentId: null and targetVirtualPath updates name
    const rebasedOld = await storageRepo.restoreNode(tenant, oldFile.id, {
      targetParentId: null,
      targetVirtualPath: '/spec-restaurado.pdf',
    });
    expect(rebasedOld.is_trashed).toBe(false);
    expect(rebasedOld.parent_id).toBeNull();
    expect(rebasedOld.virtual_path).toBe('/spec-restaurado.pdf');
    expect(rebasedOld.name).toBe('spec-restaurado.pdf');

    // 5. restoreNode guards targetParentId against cycle, non-folder, and cross-tenant
    const tenantOther = 'tenant-restore-other';
    const otherFolder = await storageRepo.createNode(tenantOther, {
      name: 'Other',
      nodeType: 'folder',
      virtualPath: '/Other',
    });
    const subFolder = await storageRepo.createNode(tenant, {
      parentId: restoredDocs.id,
      name: 'Sub',
      nodeType: 'folder',
      virtualPath: '/Docs/Sub',
    });
    await storageRepo.trashNode(tenant, restoredDocs.id, { trashedByEmail: 'a@acme.com' });

    await expect(
      storageRepo.restoreNode(tenant, restoredDocs.id, { targetParentId: restoredDocs.id }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'CYCLE_DETECTED' });
    await expect(
      storageRepo.restoreNode(tenant, restoredDocs.id, { targetParentId: subFolder.id }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'CYCLE_DETECTED' });
    await expect(
      storageRepo.restoreNode(tenant, restoredDocs.id, { targetParentId: otherFolder.id }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'INVALID_PARENT_NODE' });
    await expect(
      storageRepo.restoreNode(tenant, restoredDocs.id, { targetParentId: rebasedOld.id }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_PARENT_NODE' });
  });

  it('purgeExpiredTrash nunca exclui nó ativo (is_trashed = FALSE) mesmo se parent_id apontar para pasta expirada', async () => {
    const tenant = 'tenant-purge-active-safe';
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const expiredParent = await storageRepo.createNode(tenant, {
        name: 'Expired',
        nodeType: 'folder',
        virtualPath: '/Expired',
      });
      await storageRepo.trashNode(tenant, expiredParent.id, { trashedByEmail: 'a@acme.com' });

      vi.setSystemTime(new Date('2026-02-05T00:00:00.000Z'));
      const activeNode = await storageRepo.createNode(tenant, {
        name: 'ActiveChild.txt',
        nodeType: 'file',
        virtualPath: '/ActiveChild.txt',
        sizeBytes: 999,
      });
      // Simulate legacy/stale parent_id pointing to expired trashed folder
      await storageRepo.updateNode(tenant, activeNode.id, { parentId: expiredParent.id });

      const purged = await storageRepo.purgeExpiredTrash(tenant, 30);
      expect(purged.purgedNodes.map((n) => n.id)).toEqual([expiredParent.id]);
      expect(purged.freedBytes).toBe(0);

      const activeAfter = await storageRepo.getNodeById(tenant, activeNode.id);
      expect(activeAfter).not.toBeNull();
      expect(activeAfter.is_trashed).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('upsertConnection valida quotaBytes e port numericamente (400) e updateConnectionStatus limpa campos com null explícito', async () => {
    const tenant = 'tenant-conn-validation';
    const creds = encryptVaultCredentials({ password: 'secret' });

    for (const badQuota of ['not-a-number', NaN, Infinity, -1, 12.5, '', true, null]) {
      await expect(
        storageRepo.upsertConnection(tenant, {
          providerType: 'sftp',
          encryptedCredentials: creds,
          quotaBytes: badQuota,
        }),
      ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_QUOTA_BYTES' });
    }

    for (const badPort of [0, -1, 65536, 70000, 'abc', '', true, 22.5, NaN]) {
      await expect(
        storageRepo.upsertConnection(tenant, {
          providerType: 'sftp',
          encryptedCredentials: creds,
          quotaBytes: 1000,
          port: badPort,
        }),
      ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_PORT' });
    }

    // Valid connection still enforces reserveQuota
    const conn = await storageRepo.upsertConnection(tenant, {
      providerType: 'sftp',
      encryptedCredentials: creds,
      quotaBytes: 500,
      port: 22,
    });
    expect(conn.quota_bytes).toBe(500);
    expect(conn.port).toBe(22);

    await expect(storageRepo.reserveQuota(tenant, 600)).rejects.toMatchObject({
      statusCode: 413,
      code: 'QUOTA_EXCEEDED',
    });

    // updateConnectionStatus preserves omitted fields and clears explicit null fields
    await storageRepo.updateConnectionStatus(tenant, {
      status: 'connected',
      latencyMs: 35,
      freeBytes: 10_000,
      totalBytes: 20_000,
      initializedAt: '2026-01-01T00:00:00.000Z',
      lastError: 'warn',
    });

    const cleared = await storageRepo.updateConnectionStatus(tenant, {
      latencyMs: null,
      freeBytes: null,
      totalBytes: null,
      initializedAt: null,
      lastError: null,
    });
    expect(cleared.latency_ms).toBeNull();
    expect(cleared.free_bytes).toBeNull();
    expect(cleared.total_bytes).toBeNull();
    expect(cleared.initialized_at).toBeNull();
    expect(cleared.last_error).toBeNull();
  });
});
