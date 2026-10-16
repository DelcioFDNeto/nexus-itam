import { describe, it, expect } from 'vitest';
import { buildWindowsScript, buildLinuxScript, buildMacScript } from './agentScripts';

describe('agentScripts', () => {
  const params = ['proj-123', 'api-key-xyz', 'tenant-abc', 'token-456'];

  it('gera script Windows portatil com parametros e sem ${baseScript} literal', () => {
    const script = buildWindowsScript(...params, 'portable');
    expect(script).toContain('$ProjectId = "proj-123"');
    expect(script).toContain('$TenantId = "tenant-abc"');
    expect(script).toContain('$AgentToken = "token-456"');
    expect(script).toContain('Select-Object -First 1');
    expect(script).not.toContain('${baseScript}');
  });

  it('gera script Windows em modo servico preservando o codigo do agente dentro de @\'', () => {
    const script = buildWindowsScript(...params, 'service');
    expect(script).toContain("$AgentCode = @'\n");
    expect(script).toContain('$ProjectId = "proj-123"');
    expect(script).toContain("Register-ScheduledTask");
    // Não pode ter a barra invertida \${baseScript} nem a variavel nao interpolada
    expect(script).not.toContain('${baseScript}');
    expect(script).not.toContain('\\${baseScript}');
  });

  it('gera script Linux com export LC_ALL=C, json_escape e sudo tee no modo servico', () => {
    const portable = buildLinuxScript(...params, 'portable');
    expect(portable).toContain('export LC_ALL=C');
    expect(portable).toContain('json_escape()');
    expect(portable).toContain('RAM_GB=${RAM_GB:-0}');

    const service = buildLinuxScript(...params, 'service');
    expect(service).toContain('sudo tee "$SCRIPT_PATH"');
    expect(service).toContain('@reboot $SCRIPT_PATH');
  });

  it('gera script macOS com export LC_ALL=C, sw_vers com aspas e sudo tee no LaunchDaemon', () => {
    const portable = buildMacScript(...params, 'portable');
    expect(portable).toContain('export LC_ALL=C');
    expect(portable).toContain('OS_CAPTION="$(sw_vers -productName');
    expect(portable).toContain('RAM_GB=${RAM_GB:-0}');

    const service = buildMacScript(...params, 'service');
    expect(service).toContain('cat << \'EOFAGENT\' | sudo tee "$SCRIPT_PATH"');
    expect(service).toContain('cat << \'EOFPLIST\' | sudo tee "$PLIST_PATH"');
    expect(service).toContain('com.nexus.agent.plist');
  });
});
