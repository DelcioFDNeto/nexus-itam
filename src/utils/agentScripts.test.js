import { describe, it, expect } from 'vitest';
import { buildAgentScript, buildWindowsScript } from './agentScripts';

const base = { projectId: 'proj-123', apiKey: 'AIzaKey_x-1', tenantId: 'tenant-abc', agentToken: 'tok456' };
const PLACEHOLDER = /__[A-Z_]+__/;

const decodeBase64Utf8 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));

describe('scripts do agente', () => {
  it('Windows coleta unica: parametros preenchidos, BOM e CRLF', () => {
    const { content, filename } = buildAgentScript({ ...base, os: 'windows', mode: 'portable' });
    expect(filename).toBe('nexus-agente-windows-coleta.ps1');
    expect(content.startsWith('\uFEFF')).toBe(true);
    expect(content).toContain("$TenantId = 'tenant-abc'");
    expect(content).toContain("$AgentToken = 'tok456'");
    expect(content).toContain("$FirestoreBase = 'https://firestore.googleapis.com/v1'");
    expect(content).toContain('-Method Patch');
    expect(content).not.toMatch(PLACEHOLDER);
    expect(content).not.toMatch(/[^\r]\n/);
  });

  it('Windows instalador embute o agente em base64 e restringe a pasta', () => {
    const { content } = buildAgentScript({ ...base, os: 'windows', mode: 'service' });
    expect(content).toContain('#Requires -RunAsAdministrator');
    expect(content).toContain('Register-ScheduledTask');
    expect(content).toContain('/inheritance:r');
    const b64 = content.match(/FromBase64String\('([^']+)'\)/)[1];
    const agent = decodeBase64Utf8(b64);
    expect(agent).toContain("$TenantId = 'tenant-abc'");
    expect(agent).not.toMatch(PLACEHOLDER);
  });

  it('Linux e macOS: LF, sem marcadores e com "$$" preservado', () => {
    for (const os of ['linux', 'mac']) {
      for (const mode of ['portable', 'service']) {
        const { content } = buildAgentScript({ ...base, os, mode });
        expect(content).not.toMatch(PLACEHOLDER);
        expect(content).not.toContain('\r');
        expect(content).toContain("TENANT_ID='tenant-abc'");
        expect(content).toContain('nexus-agent-response.$$');
      }
    }
    const linux = buildAgentScript({ ...base, os: 'linux', mode: 'portable' }).content;
    // Regressao: mandava a VERSAO da BIOS como numero de serie.
    expect(linux).toContain('SERIAL=$(read_file /sys/class/dmi/id/product_serial)');
    expect(linux).not.toContain('bios_serial');
    expect(buildAgentScript({ ...base, os: 'linux', mode: 'service' }).content).toContain('/etc/cron.d/nexus-itam');
    expect(buildAgentScript({ ...base, os: 'mac', mode: 'service' }).content).toContain('<key>StartInterval</key>');
  });

  it('desinstalacao nao leva token', () => {
    const { content } = buildAgentScript({ os: 'windows', mode: 'uninstall' });
    expect(content).toContain('Unregister-ScheduledTask');
    expect(content).not.toContain('tok456');
  });

  it('recusa parametro que injetaria codigo no script', () => {
    expect(() => buildAgentScript({ ...base, tenantId: "x'; Remove-Item C:\\ -Recurse; '" })).toThrow(/inválido/);
    expect(() => buildAgentScript({ ...base, agentToken: '' })).toThrow(/inválido/);
    expect(() => buildAgentScript({ ...base, firestoreBase: 'javascript:alert(1)' })).toThrow(/inválido/);
  });

  it('mantem a assinatura antiga', () => {
    expect(buildWindowsScript('proj-123', 'AIzaKey_x-1', 'tenant-abc', 'tok456', 'portable')).toContain("$ProjectId = 'proj-123'");
  });
});
