// src/utils/portalBranding.test.js
import { describe, expect, it } from 'vitest';
import { buildBrandedPortalUrl, resolveShareableLogoUrl } from './portalBranding';

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

  it('omite data URI base64 e URLs muito longas de logo para evitar HTTP 414 URI Too Long', () => {
    const hugeBase64 = `data:image/jpeg;base64,${'A'.repeat(20000)}`;
    const resultBase64 = buildBrandedPortalUrl('https://portal-itam-nexus.web.app', {
      companyName: 'Shineray By Sabel',
      primaryColor: '#ed0202',
      logoUrl: hugeBase64,
      whitelabel: true,
    });

    const parsedBase64 = new URL(resultBase64);
    expect(parsedBase64.searchParams.get('empresa')).toBe('Shineray By Sabel');
    expect(parsedBase64.searchParams.get('cor')).toBe('#ed0202');
    expect(parsedBase64.searchParams.get('wl')).toBe('1');
    expect(parsedBase64.searchParams.get('logo')).toBeNull();
    expect(resultBase64.length).toBeLessThan(200);

    const longHttpsUrl = `https://cdn.example.com/${'a'.repeat(1100)}.png`;
    const resultLong = buildBrandedPortalUrl('https://portal-itam-nexus.web.app', {
      companyName: 'Shineray By Sabel',
      primaryColor: '#ed0202',
      logoUrl: longHttpsUrl,
    });

    expect(new URL(resultLong).searchParams.get('logo')).toBeNull();
    expect(resolveShareableLogoUrl(hugeBase64)).toBe('');
    expect(resolveShareableLogoUrl(longHttpsUrl)).toBe('');
    expect(resolveShareableLogoUrl('https://cdn.example.com/logo.png')).toBe('https://cdn.example.com/logo.png');
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

  it('herda cor ativa do console (--color-brand) e tema claro/escuro na URL do portal', () => {
    document.documentElement.style.setProperty('--color-brand', '#ed0202');
    document.documentElement.classList.add('dark');

    const result = buildBrandedPortalUrl('https://portal-itam-nexus.web.app', {
      companyName: 'Shineray By Sabel',
      primaryColor: null,
      whitelabel: true,
    });

    const parsed = new URL(result);
    expect(parsed.searchParams.get('cor')).toBe('#ed0202');
    expect(parsed.searchParams.get('tema')).toBe('dark');

    document.documentElement.style.removeProperty('--color-brand');
    document.documentElement.classList.remove('dark');
  });

  it('retorna vazio se baseUrl estiver ausente ou usar protocolo inseguro', () => {
    expect(buildBrandedPortalUrl('')).toBe('');
    expect(buildBrandedPortalUrl('javascript:alert(1)', { companyName: 'Acme' })).toBe('');
    expect(buildBrandedPortalUrl('not-a-valid-url')).toBe('');
  });
});
