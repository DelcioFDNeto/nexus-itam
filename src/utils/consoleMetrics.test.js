import { describe, it, expect } from 'vitest';
import { daysSince, relativeDays, tenantAlerts } from './consoleMetrics';

const baseTenant = (overrides = {}) => ({
  id: 'acme',
  status: 'active',
  legacy: false,
  owner: { id: 'o1' },
  usersCount: 2,
  assetsCount: 10,
  lastActivity: new Date(),
  entitlements: { maxAssets: 100, maxUsers: 10 },
  ...overrides,
});

describe('tenantAlerts', () => {
  it('empresa saudavel nao gera alertas', () => {
    expect(tenantAlerts(baseTenant())).toEqual([]);
  });

  it('sinaliza limite atingido como critico', () => {
    const alerts = tenantAlerts(baseTenant({ assetsCount: 100 }));
    expect(alerts[0].level).toBe('critical');
  });

  it('sinaliza oportunidade de upgrade perto do limite', () => {
    const alerts = tenantAlerts(baseTenant({ usersCount: 9 }));
    expect(alerts.some((a) => a.level === 'warning')).toBe(true);
  });

  it('aponta empresa legada, sem dono e inativa', () => {
    const legacy = tenantAlerts(baseTenant({ legacy: true, entitlements: { maxAssets: null, maxUsers: null } }));
    expect(legacy.some((a) => a.text.includes('regularize'))).toBe(true);

    const orphan = tenantAlerts(baseTenant({ owner: null }));
    expect(orphan.some((a) => a.text.includes('proprietário'))).toBe(true);

    const idle = tenantAlerts(baseTenant({ lastActivity: new Date(Date.now() - 45 * 86400000) }));
    expect(idle.some((a) => a.text.includes('risco'))).toBe(true);
  });

  it('ilimitado nunca estoura', () => {
    expect(tenantAlerts(baseTenant({ assetsCount: 50000, entitlements: { maxAssets: null, maxUsers: null } }))).toEqual([]);
  });
});

describe('datas relativas', () => {
  it('descreve intervalos', () => {
    expect(relativeDays(new Date())).toBe('hoje');
    expect(relativeDays(null)).toBe('nunca');
    expect(relativeDays(new Date(Date.now() - 3 * 86400000))).toBe('há 3 dias');
    expect(daysSince(null)).toBe(Infinity);
  });
});
