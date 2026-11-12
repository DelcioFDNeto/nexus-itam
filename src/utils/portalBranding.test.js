// src/utils/portalBranding.test.js
import { describe, expect, it } from 'vitest';
import { buildBrandedPortalUrl } from './portalBranding';

describe('buildBrandedPortalUrl', () => {
  it('anexa parametros whitelabel seguros (empresa, cor, logo, wl)', () => {
    const result = buildBrandedPortalUrl('https://portal.shinerayitam.com.br/', {
      companyName: 'Shineray By Sabel',
      primaryColor: '#E11D48',
      logoUrl: 'https://cdn.example.com/logo.png',
      whitelabel: true,
    });

    const parsed = new URL(result);
    expect(parsed.origin).toBe('https://portal.shinerayitam.com.br');
    expect(parsed.searchParams.get('empresa')).toBe('Shineray By Sabel');
    expect(parsed.searchParams.get('cor')).toBe('#E11D48');
    expect(parsed.searchParams.get('logo')).toBe('https://cdn.example.com/logo.png');
    expect(parsed.searchParams.get('wl')).toBe('1');
  });

  it('remove URL de logo insegura, cor invalida e nome padrao Nexus ITAM', () => {
    const result = buildBrandedPortalUrl('https://portal.nexus.local', {
      companyName: 'Nexus ITAM',
      primaryColor: 'javascript:alert(1)',
      logoUrl: 'javascript:alert(1)',
      entitlements: { features: { whitelabel: false } },
    });

    const parsed = new URL(result);
    expect(parsed.searchParams.get('empresa')).toBeNull();
    expect(parsed.searchParams.get('cor')).toBeNull();
    expect(parsed.searchParams.get('logo')).toBeNull();
    expect(parsed.searchParams.get('wl')).toBeNull();
  });

  it('retorna vazio se baseUrl estiver ausente', () => {
    expect(buildBrandedPortalUrl('')).toBe('');
  });
});
