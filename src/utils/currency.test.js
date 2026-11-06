import { describe, it, expect } from 'vitest';
import { parseBRL, formatBRL } from './currency';

describe('currency utilities', () => {
  describe('parseBRL', () => {
    it('handles numeric inputs directly', () => {
      expect(parseBRL(50000)).toBe(50000);
      expect(parseBRL(0)).toBe(0);
      expect(parseBRL(1234.56)).toBe(1234.56);
      expect(parseBRL(-500)).toBe(-500);
    });

    it('handles standard Brazilian currency formatted strings', () => {
      expect(parseBRL('R$ 50.000,00')).toBe(50000);
      expect(parseBRL('R$ 1.250.000,50')).toBe(1250000.5);
      expect(parseBRL('500,75')).toBe(500.75);
    });

    it('handles thousand separator without cents', () => {
      expect(parseBRL('50.000')).toBe(50000);
      expect(parseBRL('1.500.000')).toBe(1500000);
    });

    it('handles raw strings and decimal floats', () => {
      expect(parseBRL('50000')).toBe(50000);
      expect(parseBRL('50000.50')).toBe(50000.5);
    });

    it('handles empty and null values safely', () => {
      expect(parseBRL(null)).toBe(0);
      expect(parseBRL(undefined)).toBe(0);
      expect(parseBRL('')).toBe(0);
      expect(parseBRL('invalid text')).toBe(0);
    });
  });

  describe('formatBRL', () => {
    it('formats numbers into Brazilian Real strings', () => {
      const formatted = formatBRL(50000);
      // Handles both regular and non-breaking spaces in currency symbol
      expect(formatted).toMatch(/R\$\s*50\.000,00/);
    });

    it('formats string inputs correctly', () => {
      expect(formatBRL('50.000,00')).toMatch(/R\$\s*50\.000,00/);
      expect(formatBRL('R$ 50.000,00')).toMatch(/R\$\s*50\.000,00/);
    });

    it('formats null/undefined as R$ 0,00', () => {
      expect(formatBRL(null)).toMatch(/R\$\s*0,00/);
      expect(formatBRL(undefined)).toMatch(/R\$\s*0,00/);
      expect(formatBRL(0)).toMatch(/R\$\s*0,00/);
    });
  });
});
