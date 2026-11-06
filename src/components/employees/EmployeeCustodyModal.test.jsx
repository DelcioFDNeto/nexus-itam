import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import EmployeeCustodyModal from './EmployeeCustodyModal';

describe('EmployeeCustodyModal', () => {
  const mockEmployee = {
    id: 'emp-1',
    name: 'João da Silva',
    role: 'Analista de Suporte',
    sector: 'TI & Infraestrutura',
    branch: 'Filial Belém',
    email: 'joao.silva@shineray.com.br',
    cpf: '123.456.789-00',
    login: 'joao.silva'
  };

  const mockAssets = [
    {
      id: 'ast-1',
      internalId: 'SHL-BEL-NTB-001',
      model: 'Latitude 3420',
      brand: 'Dell',
      type: 'Notebook',
      serialNumber: 'BRG1234567',
      status: 'Em Uso',
      valor: '4500.00',
      location: 'Filial Belém'
    },
    {
      id: 'ast-2',
      internalId: 'SHL-BEL-CEL-001',
      model: 'Galaxy A15',
      brand: 'Samsung',
      type: 'Smartphone',
      serialNumber: 'SM-A15-9988',
      status: 'Em Uso',
      valor: '1200.00',
      location: 'Filial Belém'
    }
  ];

  it('renders employee custody details and summary KPIs', () => {
    render(
      <BrowserRouter>
        <EmployeeCustodyModal
          employee={mockEmployee}
          assets={mockAssets}
          onClose={vi.fn()}
          onOpenTerm={vi.fn()}
          canIssueTerms={true}
        />
      </BrowserRouter>
    );

    expect(screen.getByText('João da Silva')).toBeInTheDocument();
    expect(screen.getByText(/Analista de Suporte/)).toBeInTheDocument();
    expect(screen.getByText(/TI & Infraestrutura/)).toBeInTheDocument();
    expect(screen.getByText('2 ativos')).toBeInTheDocument();
    expect(screen.getByText(/5\.700,00/)).toBeInTheDocument();
    expect(screen.getByText('SHL-BEL-NTB-001')).toBeInTheDocument();
    expect(screen.getByText('SHL-BEL-CEL-001')).toBeInTheDocument();
  });

  it('triggers onOpenTerm with responsabilidade and devolucao', () => {
    const handleOpenTerm = vi.fn();

    render(
      <BrowserRouter>
        <EmployeeCustodyModal
          employee={mockEmployee}
          assets={mockAssets}
          onClose={vi.fn()}
          onOpenTerm={handleOpenTerm}
          canIssueTerms={true}
        />
      </BrowserRouter>
    );

    const termBtn = screen.getByText('Emitir Termo');
    fireEvent.click(termBtn);
    expect(handleOpenTerm).toHaveBeenCalledWith('responsabilidade');

    const devBtn = screen.getByText('Devolução');
    fireEvent.click(devBtn);
    expect(handleOpenTerm).toHaveBeenCalledWith('devolucao');
  });

  it('renders empty state when employee has no assets', () => {
    render(
      <BrowserRouter>
        <EmployeeCustodyModal
          employee={mockEmployee}
          assets={[]}
          onClose={vi.fn()}
          onOpenTerm={vi.fn()}
          canIssueTerms={true}
        />
      </BrowserRouter>
    );

    expect(screen.getByText('0 ativos')).toBeInTheDocument();
    expect(screen.getByText('Nenhum ativo atribuído a este colaborador')).toBeInTheDocument();
  });
});
