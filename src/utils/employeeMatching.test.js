import { describe, it, expect } from 'vitest';
import { isMatchingHolder } from './employeeMatching';

describe('employeeMatching utilities', () => {
  it('matches exact names case-insensitively', () => {
    expect(isMatchingHolder('João da Silva', 'joão da silva')).toBe(true);
    expect(isMatchingHolder('Admin Shineray', 'admin shineray')).toBe(true);
  });

  it('matches compound names where one is a subset of the other', () => {
    expect(isMatchingHolder('Délcio Farias', 'Délcio Farias Dias Neto')).toBe(true);
    expect(isMatchingHolder('Délcio Farias Dias Neto', 'Délcio Farias')).toBe(true);
    expect(isMatchingHolder('Danillo Sabel', 'Danillo Sabel Portal')).toBe(true);
    expect(isMatchingHolder('Karen Matos', 'Karen Cristina Matos')).toBe(true);
  });

  it('handles Portuguese prepositions', () => {
    expect(isMatchingHolder('João da Silva', 'João Silva')).toBe(true);
    expect(isMatchingHolder('Maria de Souza', 'Maria Souza')).toBe(true);
  });

  it('avoids false positive substring matches inside single words', () => {
    expect(isMatchingHolder('Ana', 'Mariana')).toBe(false);
    expect(isMatchingHolder('Paulo', 'Ana Paula')).toBe(false);
    expect(isMatchingHolder('Silva', 'João da Silva')).toBe(false); // single surname shouldn't match full name unless it is first name
  });

  it('handles null, empty or undefined gracefully', () => {
    expect(isMatchingHolder(null, 'João')).toBe(false);
    expect(isMatchingHolder('João', '')).toBe(false);
    expect(isMatchingHolder(undefined, undefined)).toBe(false);
  });
});
