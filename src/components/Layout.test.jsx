import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import Layout from './Layout';
import { useAuth } from '../contexts/AuthContext';

vi.mock('../contexts/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}));
vi.mock('./GlobalSearch', () => ({ default: () => null }));
vi.mock('sonner', () => ({ Toaster: () => null, toast: { success: vi.fn(), error: vi.fn() } }));

const renderLayout = (user) => {
  useAuth.mockReturnValue({ currentUser: user, logout: vi.fn(), loading: false });
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Layout>
        <div data-testid="conteudo">Conteudo da pagina</div>
      </Layout>
    </MemoryRouter>,
  );
};

describe('Layout', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renderiza os filhos UMA unica vez', () => {
    // Regressao: a versao anterior montava duas arvores (uma para mobile, outra
    // para desktop) escondendo uma por CSS. Toda pagina montava em dobro e cada
    // efeito de carregamento disparava duas vezes contra o Firestore.
    renderLayout({ uid: 'u1', name: 'Ana Souza', role: 'owner', tenantId: 'acme-1234' });
    expect(screen.getAllByTestId('conteudo')).toHaveLength(1);
  });

  it('monta uma unica barra de navegacao inferior', () => {
    // A Sidebar aparece duas vezes (coluna do desktop + drawer), mas e chrome
    // estatico sem efeitos nem busca de dados. O conteudo e a barra inferior
    // sao os que precisam ser unicos.
    renderLayout({ uid: 'u1', name: 'Ana Souza', role: 'owner', tenantId: 'acme-1234' });
    expect(screen.getAllByRole('navigation', { name: 'Navegacao rapida' })).toHaveLength(1);
  });

  it('esconde o atalho de criar ativo de quem so tem leitura', () => {
    renderLayout({ uid: 'u2', name: 'Bruno Lima', role: 'viewer', tenantId: 'acme-1234' });
    expect(screen.queryByLabelText('Novo')).toBeNull();
  });

  it('mostra o atalho de criar ativo para quem pode escrever', () => {
    renderLayout({ uid: 'u1', name: 'Ana Souza', role: 'owner', tenantId: 'acme-1234' });
    expect(screen.getByLabelText('Novo')).toBeTruthy();
  });

  it('nao oferece rotas de master para owner de tenant comum', () => {
    renderLayout({ uid: 'u1', name: 'Ana Souza', role: 'owner', tenantId: 'acme-1234' });
    expect(screen.queryByLabelText('Empresas')).toBeNull();
    expect(screen.queryByLabelText('Planos')).toBeNull();
  });

  it('oferece o console global apenas ao superadmin no tenant master', () => {
    renderLayout({ uid: 'root', name: 'Nexus', role: 'superadmin', tenantId: 'nexus-master' });
    expect(screen.getByLabelText('Empresas')).toBeTruthy();
    expect(screen.getByLabelText('Planos')).toBeTruthy();
  });

  it('trata superadmin plantado em tenant comum como usuario normal', () => {
    // Escalonamento: role adulterado sem o tenant master nao abre o console.
    renderLayout({ uid: 'x', name: 'Fake', role: 'superadmin', tenantId: 'acme-1234' });
    expect(screen.queryByLabelText('Empresas')).toBeNull();
  });
});
