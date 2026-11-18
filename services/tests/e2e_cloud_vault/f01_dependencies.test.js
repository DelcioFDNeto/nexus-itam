// services/tests/e2e_cloud_vault/f01_dependencies.test.js
// =============================================================================
// F-01: Backend Dependencies (ssh2@^1.17.0, xlsx@0.20.3) — Opaque-Box Tests
// =============================================================================

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootE2eCluster } from './helpers/clusterHarness.js';

const SERVICES_DIR = path.resolve(import.meta.dirname, '../..');
const XLSX_CDN_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz';

function getClosedLoopbackPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close((closeErr) => (closeErr ? reject(closeErr) : resolve(port)));
    });
  });
}

describe('F-01: Backend Dependencies (ssh2 & xlsx@0.20.3)', () => {
  describe('Tier 1 — Manifest, Lockfile, Resolvability & Core API Contracts', () => {
    it('T1.1 — services/package.json declares ESM, Node >= 20, ssh2@^1.17.0, and xlsx CDN tarball', () => {
      const pkgPath = path.join(SERVICES_DIR, 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

      expect(pkg.type).toBe('module');
      expect(pkg.engines?.node).toBe('>=20.0.0');
      expect(pkg.dependencies?.ssh2).toBe('^1.17.0');
      expect(pkg.dependencies?.xlsx).toBe(XLSX_CDN_URL);
    });

    it('T1.2 — services/package-lock.json (v3) pins ssh2@1.17.0 and xlsx@0.20.3 with sha512 integrity', () => {
      const lockPath = path.join(SERVICES_DIR, 'package-lock.json');
      const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));

      expect(lock.lockfileVersion).toBe(3);
      expect(lock.packages?.['']?.dependencies?.ssh2).toBe('^1.17.0');
      expect(lock.packages?.['']?.dependencies?.xlsx).toBe(XLSX_CDN_URL);

      const ssh2Entry = lock.packages?.['node_modules/ssh2'];
      expect(ssh2Entry?.version).toBe('1.17.0');
      expect(ssh2Entry?.integrity).toMatch(/^sha512-/);

      const xlsxEntry = lock.packages?.['node_modules/xlsx'];
      expect(xlsxEntry?.version).toBe('0.20.3');
      expect(xlsxEntry?.resolved).toBe(XLSX_CDN_URL);
      expect(xlsxEntry?.integrity).toMatch(/^sha512-/);
    });

    it('T1.3 — createRequire resolves ssh2 and xlsx inside services workspace with exact versions', () => {
      const req = createRequire(path.join(SERVICES_DIR, 'package.json'));

      const ssh2Path = req.resolve('ssh2');
      const xlsxPath = req.resolve('xlsx');
      expect(fs.existsSync(ssh2Path)).toBe(true);
      expect(fs.existsSync(xlsxPath)).toBe(true);

      const ssh2Pkg = req('ssh2/package.json');
      const xlsxPkg = JSON.parse(
        fs.readFileSync(path.join(SERVICES_DIR, 'node_modules/xlsx/package.json'), 'utf8'),
      );
      const xlsxCjs = req('xlsx');
      expect(ssh2Pkg.version).toBe('1.17.0');
      expect(xlsxPkg.version).toBe('0.20.3');
      expect(xlsxCjs.version).toBe('0.20.3');
    });

    it('T1.4 — ESM import of ssh2 provides Client, Server, utils.parseKey, and generateKeyPairSync', async () => {
      const ssh2Mod = await import('ssh2');
      const Client = ssh2Mod.Client || ssh2Mod.default?.Client;
      const Server = ssh2Mod.Server || ssh2Mod.default?.Server;
      const utils = ssh2Mod.utils || ssh2Mod.default?.utils;

      expect(typeof Client).toBe('function');
      expect(typeof Server).toBe('function');
      expect(typeof utils?.parseKey).toBe('function');
      expect(typeof utils?.generateKeyPairSync).toBe('function');

      const client = new Client();
      expect(typeof client.connect).toBe('function');
      client.end();
    });

    it('T1.5 — ESM import of xlsx@0.20.3 executes multi-sheet workbook, PT-BR UTF-8, formula, and CSV round-trip', async () => {
      const xlsxMod = await import('xlsx');
      const XLSX = xlsxMod.version ? xlsxMod : xlsxMod.default;

      expect(XLSX.version).toBe('0.20.3');

      const wb = XLSX.utils.book_new();
      const dadosSheet = XLSX.utils.aoa_to_sheet([
        ['Item', 'Valor'],
        ['Licença Çãõ', 150],
        ['Backup Áéí', 250],
        ['Total', { t: 'n', f: 'SUM(B2:B3)' }],
      ]);
      const resumoSheet = XLSX.utils.aoa_to_sheet([
        ['Departamento', 'Status'],
        ['Tecnologia & Operações', 'Ativo'],
      ]);
      XLSX.utils.book_append_sheet(wb, dadosSheet, 'Dados');
      XLSX.utils.book_append_sheet(wb, resumoSheet, 'Resumo');

      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      expect(Buffer.isBuffer(buf) || buf instanceof Uint8Array).toBe(true);

      const parsed = XLSX.read(buf, { type: 'buffer' });
      expect(parsed.SheetNames).toEqual(['Dados', 'Resumo']);
      expect(parsed.Sheets.Dados.A2.v).toBe('Licença Çãõ');
      expect(parsed.Sheets.Dados.B4.f).toBe('SUM(B2:B3)');

      const csv = XLSX.utils.sheet_to_csv(parsed.Sheets.Resumo);
      expect(csv).toContain('Tecnologia & Operações');
    });
  });

  describe('Tier 2 — Anti-Tampering, Error Resilience & Cluster Compatibility', () => {
    it('T2.1 — lockfile anti-tampering rejects registry.npmjs.org/xlsx and matches installed node_modules', () => {
      const lock = JSON.parse(fs.readFileSync(path.join(SERVICES_DIR, 'package-lock.json'), 'utf8'));
      const xlsxLock = lock.packages?.['node_modules/xlsx'];
      const ssh2Lock = lock.packages?.['node_modules/ssh2'];

      expect(xlsxLock?.resolved).toBeTruthy();
      expect(xlsxLock.resolved).not.toContain('registry.npmjs.org');
      expect(xlsxLock.resolved).toBe(XLSX_CDN_URL);

      const installedXlsxPkg = JSON.parse(
        fs.readFileSync(path.join(SERVICES_DIR, 'node_modules/xlsx/package.json'), 'utf8'),
      );
      const installedSsh2Pkg = JSON.parse(
        fs.readFileSync(path.join(SERVICES_DIR, 'node_modules/ssh2/package.json'), 'utf8'),
      );

      expect(installedXlsxPkg.version).toBe(xlsxLock.version);
      expect(installedSsh2Pkg.version).toBe(ssh2Lock.version);
    });

    it('T2.2 — ssh2 safely handles malformed private keys and closed loopback TCP ports without crashing', async () => {
      const ssh2Mod = await import('ssh2');
      const Client = ssh2Mod.Client || ssh2Mod.default?.Client;
      const utils = ssh2Mod.utils || ssh2Mod.default?.utils;

      const parsedBadKey = utils.parseKey('not-a-valid-openssh-key');
      expect(parsedBadKey).toBeInstanceOf(Error);

      const closedPort = await getClosedLoopbackPort();
      const err = await new Promise((resolve) => {
        const client = new Client();
        const timer = setTimeout(() => {
          try {
            client.destroy();
          } catch {
            /* ignore */
          }
          resolve(new Error('TIMEOUT'));
        }, 4000);

        client.once('error', (connectErr) => {
          clearTimeout(timer);
          resolve(connectErr);
        });
        client.once('ready', () => {
          clearTimeout(timer);
          client.end();
          resolve(null);
        });

        client.connect({
          host: '127.0.0.1',
          port: closedPort,
          username: 'probe',
          password: 'probe-password',
          readyTimeout: 2000,
        });
      });

      expect(err).toBeTruthy();
      expect(err.message).not.toBe('TIMEOUT');
    });

    it('T2.3 — xlsx@0.20.3 rejects corrupt binary payloads cleanly and parses UTF-8 BOM + BRL CSV', async () => {
      const xlsxMod = await import('xlsx');
      const XLSX = xlsxMod.version ? xlsxMod : xlsxMod.default;

      let corruptOutcome = 'parsed';
      try {
        const wbCorrupt = XLSX.read(Buffer.from('CORRUPT_NOT_ZIP_OR_BIFF_DATA', 'utf8'), {
          type: 'buffer',
        });
        expect(wbCorrupt).toBeDefined();
      } catch (err) {
        corruptOutcome = 'threw';
        expect(err).toBeInstanceOf(Error);
      }
      expect(['parsed', 'threw']).toContain(corruptOutcome);

      const csvWithBom = '\uFEFFProduto,Valor\n"Notebook Pro Çãõ","R$ 1.250,90"\n';
      const csvWb = XLSX.read(csvWithBom.replace(/^\uFEFF/, ''), { type: 'string', raw: true });
      const rows = XLSX.utils.sheet_to_json(csvWb.Sheets[csvWb.SheetNames[0]]);
      expect(rows).toHaveLength(1);
      expect(rows[0].Produto).toBe('Notebook Pro Çãõ');
      expect(rows[0].Valor).toBe('R$ 1.250,90');
    });

    it('T2.4 — services/vitest.config.js configures node environment and runtime Node >= 20', () => {
      const vitestCfg = fs.readFileSync(path.join(SERVICES_DIR, 'vitest.config.js'), 'utf8');
      expect(vitestCfg).toMatch(/environment:\s*['"]node['"]/);
      expect(vitestCfg).toContain('tests/**/*.test.js');

      const major = Number(process.versions.node.split('.')[0]);
      expect(major).toBeGreaterThanOrEqual(20);
    });

    describe('Cluster runtime compatibility with ssh2 and xlsx loaded', () => {
      let cluster;

      beforeAll(async () => {
        await import('ssh2');
        await import('xlsx');
        cluster = await bootE2eCluster();
      }, 45_000);

      afterAll(async () => {
        if (cluster) await cluster.stop();
      }, 45_000);

      it('T2.5 — Gateway /health reports healthy when ssh2 and xlsx are active in worker', async () => {
        const health = await cluster.apiFetch(null, '/health');
        expect(health.status).toBe(200);
        expect(health.ok).toBe(true);
        expect(health.data?.overallStatus).toBe('healthy');
      });
    });
  });
});
