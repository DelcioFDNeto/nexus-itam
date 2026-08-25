import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ThemeProvider, useTheme } from './ThemeContext';

vi.mock('./AuthContext', () => ({ useAuth: vi.fn(() => mockAuth) }));

let mockAuth = { currentUser: null };

/** matchMedia controlavel: permite simular a troca de tema do sistema operacional. */
const installMatchMedia = (initialDark) => {
  let dark = initialDark;
  const listeners = new Set();
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    get matches() {
      return query.includes('dark') ? dark : false;
    },
    media: query,
    addEventListener: (_, cb) => listeners.add(cb),
    removeEventListener: (_, cb) => listeners.delete(cb),
    addListener: (cb) => listeners.add(cb),
    removeListener: (cb) => listeners.delete(cb),
    dispatchEvent: () => true,
  }));
  return {
    setSystemDark(next) {
      dark = next;
      act(() => listeners.forEach((cb) => cb({ matches: next })));
    },
  };
};

const Probe = () => {
  const { theme, resolvedTheme, isDark, setTheme, accentColor, setAccentColor } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <span data-testid="dark">{String(isDark)}</span>
      <span data-testid="accent">{accentColor || 'auto'}</span>
      <button onClick={() => setTheme('dark')}>dark</button>
      <button onClick={() => setTheme('light')}>light</button>
      <button onClick={() => setTheme('system')}>system</button>
      <button onClick={() => setAccentColor('green')}>verde</button>
      <button onClick={() => setAccentColor(null)}>auto</button>
    </div>
  );
};

const setup = () => render(<ThemeProvider><Probe /></ThemeProvider>);
const brand = () => document.documentElement.style.getPropertyValue('--color-brand');

describe('ThemeContext', () => {
  beforeEach(() => {
    localStorage.clear();
    mockAuth = { currentUser: null };
    document.documentElement.className = '';
    document.documentElement.removeAttribute('style');
    installMatchMedia(false);
  });

  it('inicia em system e resolve para o tema do SO', () => {
    setup();
    expect(screen.getByTestId('theme')).toHaveTextContent('system');
    expect(screen.getByTestId('resolved')).toHaveTextContent('light');
  });

  it('acompanha a troca de tema do sistema operacional em tempo real', () => {
    // Regressao: o efeito so dependia de `theme`, entao mudar o tema do SO
    // nao surtia efeito nenhum ate recarregar a pagina.
    const media = installMatchMedia(false);
    setup();
    expect(screen.getByTestId('dark')).toHaveTextContent('false');

    media.setSystemDark(true);
    expect(screen.getByTestId('dark')).toHaveTextContent('true');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('ignora o SO quando o usuario escolhe um tema explicito', () => {
    const media = installMatchMedia(false);
    setup();
    fireEvent.click(screen.getByText('dark'));
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');

    media.setSystemDark(true);
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
  });

  it('define color-scheme para os controles nativos seguirem o tema', () => {
    // Sem isto a barra de rolagem e os <select> ficam claros na pagina escura.
    setup();
    fireEvent.click(screen.getByText('dark'));
    expect(document.documentElement.style.colorScheme).toBe('dark');
    fireEvent.click(screen.getByText('light'));
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('persiste a escolha de tema', () => {
    setup();
    fireEvent.click(screen.getByText('dark'));
    expect(localStorage.getItem('nexus_theme')).toBe('dark');
  });

  it('usa o indigo padrao sem inquilino e sem acento', () => {
    setup();
    expect(brand()).toBe('#4F46E5');
  });

  it('herda a cor da empresa quando o acento esta em automatico', () => {
    mockAuth = { currentUser: { primaryColor: '#FF0000' } };
    setup();
    expect(brand()).toBe('#FF0000');
  });

  it('acento pessoal tem precedencia sobre a cor da empresa', () => {
    // Antes, AuthContext e ThemeContext escreviam --color-brand
    // independentemente e o ultimo a rodar vencia.
    mockAuth = { currentUser: { primaryColor: '#FF0000' } };
    setup();
    fireEvent.click(screen.getByText('verde'));
    expect(brand()).toBe('#10B981');
  });

  it('voltar para automatico devolve a cor da empresa', () => {
    mockAuth = { currentUser: { primaryColor: '#FF0000' } };
    setup();
    fireEvent.click(screen.getByText('verde'));
    fireEvent.click(screen.getByText('auto'));
    expect(brand()).toBe('#FF0000');
    expect(screen.getByTestId('accent')).toHaveTextContent('auto');
  });

  it('recusa cor de inquilino invalida e cai no padrao', () => {
    mockAuth = { currentUser: { primaryColor: 'url(https://evil.tld)' } };
    setup();
    expect(brand()).toBe('#4F46E5');
  });

  it('deriva um tom escuro da cor efetiva', () => {
    setup();
    const dark = document.documentElement.style.getPropertyValue('--color-brand-dark');
    expect(dark).toMatch(/^#[0-9a-f]{6}$/);
    expect(dark).not.toBe('#4F46E5');
  });
});
