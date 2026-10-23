// src/utils/assetTagGenerator.test.js
import { describe, it, expect } from 'vitest';
import {
  parseTag,
  locationCodeFor,
  resolveTypeCode,
  generateNextAssetTag,
} from './assetTagGenerator';

describe('assetTagGenerator', () => {
  describe('parseTag', () => {
    it('decompoe tags compostas com multiplos prefixos e delimitador hífen', () => {
      const parsed = parseTag('SHL-BEL-NTB-045');
      expect(parsed).toEqual({
        raw: 'SHL-BEL-NTB-045',
        prefix: 'SHL-BEL-NTB-',
        numStr: '045',
        sequence: 45,
        padLength: 3,
        suffix: '',
      });
    });

    it('decompoe tags curtas de tipo e numero', () => {
      const parsed = parseTag('NB-007');
      expect(parsed).toEqual({
        raw: 'NB-007',
        prefix: 'NB-',
        numStr: '007',
        sequence: 7,
        padLength: 3,
        suffix: '',
      });
    });

    it('decompoe tags com padding de 2 digitos', () => {
      const parsed = parseTag('PC-09');
      expect(parsed).toEqual({
        raw: 'PC-09',
        prefix: 'PC-',
        numStr: '09',
        sequence: 9,
        padLength: 2,
        suffix: '',
      });
    });

    it('decompoe tags puramente numericas', () => {
      const parsed = parseTag('000142');
      expect(parsed).toEqual({
        raw: '000142',
        prefix: '',
        numStr: '000142',
        sequence: 142,
        padLength: 6,
        suffix: '',
      });
    });

    it('suporta delimitador barra e ponto', () => {
      expect(parseTag('PAT/2026/015')).toEqual({
        raw: 'PAT/2026/015',
        prefix: 'PAT/2026/',
        numStr: '015',
        sequence: 15,
        padLength: 3,
        suffix: '',
      });

      expect(parseTag('AST.008')).toEqual({
        raw: 'AST.008',
        prefix: 'AST.',
        numStr: '008',
        sequence: 8,
        padLength: 3,
        suffix: '',
      });
    });

    it('preserva sufixos alfanumericos se existirem', () => {
      const parsed = parseTag('NB-001-A');
      expect(parsed).toEqual({
        raw: 'NB-001-A',
        prefix: 'NB-',
        numStr: '001',
        sequence: 1,
        padLength: 3,
        suffix: '-A',
      });
    });

    it('retorna null para tags sem nenhum digito ou vazias', () => {
      expect(parseTag('')).toBeNull();
      expect(parseTag(null)).toBeNull();
      expect(parseTag('SEM-NUMERO')).toBeNull();
    });
  });

  describe('locationCodeFor', () => {
    it('extrai codigo de filial com hífen', () => {
      expect(locationCodeFor('Matriz - Belém')).toBe('BEL');
      expect(locationCodeFor('Loja Castanhal')).toBe('CAS');
      expect(locationCodeFor('PA - Ananindeua')).toBe('ANA');
      expect(locationCodeFor('Sede')).toBe('MTZ');
      expect(locationCodeFor('Matriz')).toBe('MTZ');
      expect(locationCodeFor('')).toBe('');
    });
  });

  describe('resolveTypeCode', () => {
    it('retorna a sigla padrao se nao houver historico', () => {
      expect(resolveTypeCode('Notebook')).toBe('NTB');
      expect(resolveTypeCode('Computador')).toBe('CPU');
      expect(resolveTypeCode('Impressora')).toBe('IMP');
      expect(resolveTypeCode('Celular')).toBe('CEL');
    });

    it('aprende a sigla usada pela empresa se houver historico', () => {
      // Empresa que usa PC ao inves de CPU
      const tagsPC = ['SHL-BEL-PC-001', 'SHL-BEL-PC-002'];
      expect(resolveTypeCode('Computador', tagsPC)).toBe('PC');

      // Empresa que usa NB ao inves de NTB
      const tagsNB = ['ACME-NB-001', 'ACME-NB-002'];
      expect(resolveTypeCode('Notebook', tagsNB)).toBe('NB');
    });
  });

  describe('generateNextAssetTag', () => {
    it('caso 1: da prosseguimento na sequencia existente para o mesmo tipo', () => {
      const existingAssets = [
        { internalId: 'SHL-BEL-NTB-001', type: 'Notebook', location: 'Matriz - Belém' },
        { internalId: 'SHL-BEL-NTB-002', type: 'Notebook', location: 'Matriz - Belém' },
        { internalId: 'SHL-BEL-NTB-003', type: 'Notebook', location: 'Matriz - Belém' },
      ];

      const result = generateNextAssetTag({
        existingAssets,
        targetType: 'Notebook',
        targetLocation: 'Matriz - Belém',
      });

      expect(result.tag).toBe('SHL-BEL-NTB-004');
      expect(result.sequence).toBe(4);
      expect(result.prefix).toBe('SHL-BEL-NTB-');
      expect(result.patternType).toBe('exact_type_match');
    });

    it('caso 1 com filial especifica: prioriza o padrao da filial selecionada', () => {
      const existingAssets = [
        { internalId: 'SHL-BEL-NTB-016', type: 'Notebook', location: 'Matriz - Belém' },
        { internalId: 'SHL-CAS-NTB-004', type: 'Notebook', location: 'Loja Castanhal' },
      ];

      const resultBelem = generateNextAssetTag({
        existingAssets,
        targetType: 'Notebook',
        targetLocation: 'Matriz - Belém',
      });
      expect(resultBelem.tag).toBe('SHL-BEL-NTB-017');

      const resultCastanhal = generateNextAssetTag({
        existingAssets,
        targetType: 'Notebook',
        targetLocation: 'Loja Castanhal',
      });
      expect(resultCastanhal.tag).toBe('SHL-CAS-NTB-005');
    });

    it('caso 1 com saltos na numeracao: garante unicidade e acha a proxima livre', () => {
      const existingAssets = [
        { internalId: 'NB-001', type: 'Notebook' },
        { internalId: 'NB-002', type: 'Notebook' },
        { internalId: 'NB-004', type: 'Notebook' }, // 003 pulou
      ];

      const result = generateNextAssetTag({
        existingAssets,
        targetType: 'Notebook',
      });

      // Como o maior é 004, o próximo na sequência natural é 005
      expect(result.tag).toBe('NB-005');
      expect(result.sequence).toBe(5);
    });

    it('caso 1 com colisao forcada: continua incrementando ate ficar unico', () => {
      const existingAssets = [
        { internalId: 'NB-001', type: 'Notebook' },
        { internalId: 'NB-002', type: 'Notebook' },
        { internalId: 'NB-003', type: 'Outros' }, // Colisao cruzada
      ];

      const result = generateNextAssetTag({
        existingAssets,
        targetType: 'Notebook',
      });

      // maior notebook é 002 -> proximo seria 003, mas 003 já está ocupado por outro ativo!
      // então deve avançar para 004!
      expect(result.tag).toBe('NB-004');
    });

    it('caso 2.A: padrao unificado da empresa (ex: PAT-001, PAT-002 independente do tipo)', () => {
      const existingAssets = [
        { internalId: 'PAT-001', type: 'Computador' },
        { internalId: 'PAT-002', type: 'Notebook' },
        { internalId: 'PAT-003', type: 'Monitor' },
      ];

      const result = generateNextAssetTag({
        existingAssets,
        targetType: 'Impressora',
      });

      expect(result.tag).toBe('PAT-004');
      expect(result.patternType).toBe('unified_tenant_sequence');
    });

    it('caso 2.A: padrao puramente numerico global', () => {
      const existingAssets = [
        { internalId: '00100', type: 'Computador' },
        { internalId: '00101', type: 'Notebook' },
      ];

      const result = generateNextAssetTag({
        existingAssets,
        targetType: 'Monitor',
      });

      expect(result.tag).toBe('00102');
      expect(result.patternType).toBe('unified_pure_numeric');
    });

    it('caso 2.B: adapta o padrao da empresa para um novo tipo com filial', () => {
      // Empresa possui computadores e impressoras, mas nenhum notebook
      const existingAssets = [
        { internalId: 'SHL-BEL-CPU-001', type: 'Computador', location: 'Matriz - Belém' },
        { internalId: 'SHL-BEL-CPU-002', type: 'Computador', location: 'Matriz - Belém' },
        { internalId: 'SHL-BEL-IMP-001', type: 'Impressora', location: 'Matriz - Belém' },
      ];

      const result = generateNextAssetTag({
        existingAssets,
        targetType: 'Notebook',
        targetLocation: 'Matriz - Belém',
      });

      expect(result.tag).toBe('SHL-BEL-NTB-001');
      expect(result.patternType).toBe('company_convention_adapted');
    });

    it('caso 2.B: adapta o padrao de empresa simples [EMPRESA]-[TIPO]-[NUM]', () => {
      const existingAssets = [
        { internalId: 'ACME-CPU-010', type: 'Computador' },
      ];

      const result = generateNextAssetTag({
        existingAssets,
        targetType: 'Notebook',
      });

      expect(result.tag).toBe('ACME-NTB-001');
      expect(result.patternType).toBe('company_convention_adapted');
    });

    it('caso 2.B: adapta o padrao de tipo simples [TIPO]-[NUM]', () => {
      const existingAssets = [
        { internalId: 'PC-042', type: 'Computador' },
      ];

      const result = generateNextAssetTag({
        existingAssets,
        targetType: 'Notebook',
      });

      expect(result.tag).toBe('NTB-001');
      expect(result.patternType).toBe('company_convention_adapted');
    });

    it('caso 3: empresa nova sem ativos usa configuracao do tenant', () => {
      const result = generateNextAssetTag({
        existingAssets: [],
        targetType: 'Notebook',
        targetLocation: 'Matriz - Belém',
        tenantSettings: {
          agentNaming: {
            companyPrefix: 'VIB',
            locationCode: 'BEL',
            padLength: 3,
          },
        },
      });

      expect(result.tag).toBe('VIB-BEL-NTB-001');
      expect(result.patternType).toBe('clean_fallback');
    });

    it('caso 3: empresa nova sem ativos deriva prefixo do companyName', () => {
      const result = generateNextAssetTag({
        existingAssets: [],
        targetType: 'Computador',
        companyName: 'Acme Corporação',
      });

      expect(result.tag).toBe('ACM-CPU-001');
      expect(result.patternType).toBe('clean_fallback');
    });

    it('caso 3: empresa nova sem nenhuma configuracao gera fallback limpo', () => {
      const result = generateNextAssetTag({
        existingAssets: [],
        targetType: 'Monitor',
      });

      expect(result.tag).toBe('MON-001');
      expect(result.patternType).toBe('clean_fallback');
    });

    it('reproduz com precisao o cenario real de producao da Shineray', () => {
      const shinerayAssets = [
        { internalId: 'SHL-BEL-NTB-001', type: 'Notebook', location: 'Matriz - Belém' },
        { internalId: 'SHL-BEL-NTB-016', type: 'Notebook', location: 'Matriz - Belém' },
        { internalId: 'SHL-CAS-NTB-004', type: 'Notebook', location: 'Loja Castanhal' },
        { internalId: 'SHL-BEL-IMP-002', type: 'Impressora', location: 'Matriz - Belém' },
        { internalId: 'SHL-FAB-PC-002', type: 'Computador', location: 'Fábrica' },
        { internalId: 'SHL-BEL-CEL-004', type: 'Celular', location: 'Matriz - Belém' },
      ];

      // Proximo notebook em Belem
      const nextNtb = generateNextAssetTag({
        existingAssets: shinerayAssets,
        targetType: 'Notebook',
        targetLocation: 'Matriz - Belém',
      });
      expect(nextNtb.tag).toBe('SHL-BEL-NTB-017');

      // Proximo PC na Fabrica
      const nextPc = generateNextAssetTag({
        existingAssets: shinerayAssets,
        targetType: 'Computador',
        targetLocation: 'Fábrica',
      });
      expect(nextPc.tag).toBe('SHL-FAB-PC-003');

      // Tipo inedito: Servidor na Matriz Belém
      const nextSrv = generateNextAssetTag({
        existingAssets: shinerayAssets,
        targetType: 'Servidor',
        targetLocation: 'Matriz - Belém',
      });
      expect(nextSrv.tag).toBe('SHL-BEL-SRV-001');
      expect(nextSrv.patternType).toBe('company_convention_adapted');
    });

    it('expande o padding quando o numero ultrapassa a quantidade de digitos', () => {
      const existingAssets = [
        { internalId: 'PAT-999', type: 'Notebook' },
      ];

      const result = generateNextAssetTag({
        existingAssets,
        targetType: 'Notebook',
      });

      expect(result.tag).toBe('PAT-1000');
      expect(result.sequence).toBe(1000);
    });
  });
});
