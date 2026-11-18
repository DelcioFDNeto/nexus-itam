// services/tests/e2e_cloud_vault/agent_node_installer.test.js
// =============================================================================
// Verificação Completa do Instalador 1-Click Linux & Daemon Real Nexus Storage Node
// =============================================================================

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootE2eCluster } from './helpers/clusterHarness.js';
import { startNexusStorageNodeAgent } from '../../service-storage/src/agent/nexusStorageNodeServer.js';
import { createAgentNodeDriver, signAgentNodeHeaders } from '../../service-storage/src/drivers/agentNodeDriver.js';
import { buildAgentInstallScript } from '../../service-storage/src/services/installScriptBuilder.js';

describe('Nexus Storage Node 1-Click Installer & Standalone Agent Daemon', () => {
  let tmpDirs = [];

  async function makeTempDir(prefix = 'nexus-real-agent-') {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
    tmpDirs.push(dir);
    return dir;
  }

  afterAll(async () => {
    for (const dir of tmpDirs) {
      if (fs.existsSync(dir)) {
        await fsp.rm(dir, { recursive: true, force: true });
      }
    }
  });

  describe('1. buildAgentInstallScript & Segurança Shell', () => {
    it('gera script bash completo (Node, systemd, env, firewall, /health HMAC) sem CRLF e com JS embarcado válido', () => {
      const token = `nsn_${crypto.randomBytes(24).toString('hex')}`;
      const script = buildAgentInstallScript({
        rootPath: '/srv/nexus-vault',
        quotaBytes: 10_737_418_240,
        hmacToken: token,
        port: 9443,
      });

      expect(script).not.toContain('\r');
      expect(script.startsWith('#!/usr/bin/env bash\n')).toBe(true);
      expect(script).toContain('export NEXUS_VAULT_ROOT="/srv/nexus-vault"');
      expect(script).toContain('export NEXUS_VAULT_QUOTA_BYTES="10737418240"');
      expect(script).toContain(`export NEXUS_NODE_HMAC_TOKEN="${token}"`);
      expect(script).toContain('export NEXUS_NODE_PORT="9443"');
      expect(script).toContain("bash -euo pipefail <<'__NEXUS_INSTALLER_EOF__'");
      expect(script).toContain('/opt/nexus-storage-node/server.mjs');
      expect(script).toContain('/etc/nexus-storage-node/agent.env');
      expect(script).toContain('/etc/systemd/system/nexus-storage-node.service');
      expect(script).toContain('systemctl restart nexus-storage-node');
      expect(script).toContain('ufw allow');
      expect(script).toContain('__NEXUS_INSTALLER_EOF__');

      // Validate extracted JS module syntax via vm.SourceTextModule when available or syntax check
      const match = /cat <<'__NEXUS_NODE_JS__' > \/opt\/nexus-storage-node\/server\.mjs\n([\s\S]*?)\n__NEXUS_NODE_JS__/.exec(script);
      expect(match).toBeTruthy();
      expect(match[1]).toContain('startNexusStorageNodeAgent');
      expect(match[1]).toContain('createHmac');
      if (typeof vm.SourceTextModule === 'function') {
        expect(() => new vm.SourceTextModule(match[1])).not.toThrow();
      }
    });

    it('bloqueia command injection no rootPath, raiz "/" e portas/cotas inválidas', () => {
      const token = `nsn_${crypto.randomBytes(24).toString('hex')}`;
      for (const badRoot of ['/srv/$(id)', '/srv/`id`', '/srv/vault;rm -rf /', '/srv/../etc', '/', '/srv/a b']) {
        expect(() => buildAgentInstallScript({ rootPath: badRoot, hmacToken: token })).toThrow();
      }
      expect(() => buildAgentInstallScript({ rootPath: '/srv/vault', hmacToken: token, port: 70000 })).toThrow();
      expect(() => buildAgentInstallScript({ rootPath: '/srv/vault', hmacToken: token, quotaBytes: 0 })).toThrow();
      expect(() => buildAgentInstallScript({ rootPath: '/srv/vault', hmacToken: 'short' })).toThrow();
    });
  });

  describe('2. Daemon Real nexusStorageNodeServer.js com agentNodeDriver', () => {
    it('executa ciclo completo VFS, Range 206, cota 413 e evita double-nesting quando rootPath coincide com NEXUS_VAULT_ROOT', async () => {
      const rootDir = await makeTempDir();
      const hmacToken = `nsn_${crypto.randomBytes(24).toString('hex')}`;
      const agent = await startNexusStorageNodeAgent({
        rootDir,
        quotaBytes: 4096,
        hmacToken,
        host: '127.0.0.1',
        port: 0,
      });

      try {
        // Test with rootPath='/' AND rootPath matching POSIX rootDir
        const posixRoot = rootDir.replace(/\\/g, '/');
        const driverSlash = createAgentNodeDriver({ endpointUrl: agent.url, rootPath: '/' }, { hmacToken });

        const health = await driverSlash.testConnection();
        expect(health.ok).toBe(true);
        expect(health.driver).toBe('agent_node');
        expect(health.totalBytes).toBe(4096);

        await driverSlash.mkdir('/Corporativo-Publico');
        await driverSlash.writeFile('/Corporativo-Publico/hello.txt', Buffer.from('0123456789ABCDEF', 'utf8'));

        const fullRead = await driverSlash.readFile('/Corporativo-Publico/hello.txt');
        expect(fullRead.status).toBe(200);
        expect(fullRead.buffer.toString('utf8')).toBe('0123456789ABCDEF');

        const partial = await driverSlash.readFile('/Corporativo-Publico/hello.txt', { rangeHeader: 'bytes=5-9' });
        expect(partial.status).toBe(206);
        expect(partial.contentRange).toBe('bytes 5-9/16');
        expect(partial.buffer.toString('utf8')).toBe('56789');

        // Verify POSIX prefix deduplication when console connection rootPath equals daemon rootDir
        if (posixRoot.startsWith('/')) {
          const driverSameRoot = createAgentNodeDriver({ endpointUrl: agent.url, rootPath: posixRoot }, { hmacToken });
          const sameRead = await driverSameRoot.readFile('/Corporativo-Publico/hello.txt');
          expect(sameRead.buffer.toString('utf8')).toBe('0123456789ABCDEF');
        }

        // Copy & Rename & Quota enforcement
        await driverSlash.copy('/Corporativo-Publico/hello.txt', '/Corporativo-Publico/hello-copy.txt');
        await driverSlash.rename('/Corporativo-Publico/hello-copy.txt', '/Corporativo-Publico/hello-renamed.txt');
        expect((await driverSlash.readFile('/Corporativo-Publico/hello-renamed.txt')).buffer.toString('utf8')).toBe('0123456789ABCDEF');

        await expect(
          driverSlash.writeFile('/Corporativo-Publico/too-big.bin', Buffer.alloc(5000, 0x41)),
        ).rejects.toMatchObject({ statusCode: 413 });

        await driverSlash.remove('/Corporativo-Publico/hello-renamed.txt');
      } finally {
        await agent.stop();
      }
    });

    it('bloqueia acesso não autenticado, anti-replay expirado e symlinks apontando para fora do cofre', async () => {
      const rootDir = await makeTempDir();
      const outsideDir = await makeTempDir('nexus-outside-');
      const hmacToken = `nsn_${crypto.randomBytes(24).toString('hex')}`;
      await fsp.writeFile(path.join(outsideDir, 'secret.txt'), 'OUTSIDE_SECRET', 'utf8');

      const agent = await startNexusStorageNodeAgent({
        rootDir,
        quotaBytes: 1024 * 1024,
        hmacToken,
        host: '127.0.0.1',
        port: 0,
      });

      try {
        const unauth = await fetch(`${agent.url}/health`);
        expect(unauth.status).toBe(401);

        const expiredHeaders = signAgentNodeHeaders({
          hmacToken,
          method: 'GET',
          pathWithQuery: '/health',
          ts: Date.now() - 120_000,
        });
        const expiredRes = await fetch(`${agent.url}/health`, { headers: expiredHeaders });
        expect(expiredRes.status).toBe(401);

        // Symlink trap (where OS user permits symlink creation)
        const linkPath = path.join(rootDir, 'escape-link');
        let symlinkCreated = false;
        try {
          await fsp.symlink(outsideDir, linkPath, 'dir');
          symlinkCreated = true;
        } catch {
          symlinkCreated = false;
        }

        if (symlinkCreated) {
          const query = '/files?path=%2Fescape-link%2Fsecret.txt';
          const headers = signAgentNodeHeaders({ hmacToken, method: 'GET', pathWithQuery: query });
          const res = await fetch(`${agent.url}${query}`, { headers });
          expect(res.status).toBe(403);
        }
      } finally {
        await agent.stop();
      }
    });
  });

  describe('3. Integração E2E Gateway + Service-Storage: Sync Token, Rotação & Preservação ao Salvar Endpoint', () => {
    let cluster;

    beforeAll(async () => {
      cluster = await bootE2eCluster();
    }, 45_000);

    afterAll(async () => {
      if (cluster) await cluster.stop();
    }, 45_000);

    it('gera script com daemon real, preserva hmacToken ao salvar só endpointUrl, conecta de fato e suporta rotateToken', async () => {
      const tenantToken = cluster.createUserToken({
        sub: 'real-agent-owner',
        email: 'ops@cliente-vps.com.br',
        role: 'owner',
        tenantId: 'tenant-real-agent',
      });

      // 1. Admin gera Script 1-Click antes de informar endpoint
      const script1 = await cluster.apiFetch(tenantToken, '/api/v1/storage/connection/install-script', {
        method: 'POST',
        body: { rootPath: '/srv/nexus-vault', quotaBytes: 50_000_000, port: 9443 },
      });
      expect(script1.status).toBe(200);
      const tokenMatch1 = /export NEXUS_NODE_HMAC_TOKEN="([^"]+)"/.exec(script1.data.script);
      expect(tokenMatch1?.[1]).toMatch(/^nsn_/);
      const token1 = tokenMatch1[1];

      // 2. Segunda chamada sem rotateToken deve devolver EXATAMENTE o mesmo token do banco
      const script2 = await cluster.apiFetch(tenantToken, '/api/v1/storage/connection/install-script', {
        method: 'POST',
        body: { rootPath: '/srv/nexus-vault', quotaBytes: 50_000_000 },
      });
      expect(script2.status).toBe(200);
      const tokenMatch2 = /export NEXUS_NODE_HMAC_TOKEN="([^"]+)"/.exec(script2.data.script);
      expect(tokenMatch2?.[1]).toBe(token1);

      // 3. Inicia o daemon real na VPS usando o token do script
      const rootDir = await makeTempDir();
      const realAgent = await startNexusStorageNodeAgent({
        rootDir,
        quotaBytes: 50_000_000,
        hmacToken: token1,
        host: '127.0.0.1',
        port: 0,
      });

      try {
        // 4. Admin cola APENAS o endpointUrl no Console (credentials com hmacToken vazio) -> NÃO pode apagar o token!
        const saveRes = await cluster.apiFetch(tenantToken, '/api/v1/storage/connection', {
          method: 'PUT',
          body: {
            providerType: 'agent_node',
            label: 'VPS Produção Real',
            endpointUrl: realAgent.url,
            rootPath: '/',
            quotaBytes: 50_000_000,
            credentials: { hmacToken: '' },
          },
        });
        expect(saveRes.status).toBe(200);

        // 5. Diagnóstico e provisionamento funcionam direto!
        const diagRes = await cluster.apiFetch(tenantToken, '/api/v1/storage/connection/test', { method: 'POST', body: {} });
        expect(diagRes.status).toBe(200);
        expect(diagRes.data?.ok).toBe(true);
        expect(diagRes.data?.driver).toBe('agent_node');

        const initRes = await cluster.apiFetch(tenantToken, '/api/v1/storage/initialize', { method: 'POST', body: {} });
        expect([200, 201]).toContain(initRes.status);

        // 6. Rotacionar token invalida o daemon antigo e emite novo token sincronizado no banco
        const rotated = await cluster.apiFetch(tenantToken, '/api/v1/storage/connection/install-script', {
          method: 'POST',
          body: { rootPath: '/srv/nexus-vault', quotaBytes: 50_000_000, rotateToken: true },
        });
        expect(rotated.status).toBe(200);
        const tokenMatch3 = /export NEXUS_NODE_HMAC_TOKEN="([^"]+)"/.exec(rotated.data.script);
        expect(tokenMatch3?.[1]).toMatch(/^nsn_/);
        expect(tokenMatch3[1]).not.toBe(token1);

        const failedDiag = await cluster.apiFetch(tenantToken, '/api/v1/storage/connection/test', { method: 'POST', body: {} });
        expect(failedDiag.data?.ok).toBe(false);
      } finally {
        await realAgent.stop();
      }
    });
  });
});
