// src/utils/currency.js

/**
 * Converte qualquer representação numérica ou em string BRL para número Float puro.
 * Suporta:
 * - Números puros: 50000 -> 50000
 * - Moeda formatada: "R$ 50.000,00" -> 50000
 * - Notação brasileira com vírgula: "1.250,50" -> 1250.50
 * - Notação brasileira sem centavos: "50.000" -> 50000
 * - Strings padrão US / inteiras: "50000.00", "50000" -> 50000
 * - Valores nulos, indefinidos ou vazios -> 0
 */
export const parseBRL = (val) => {
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (!val && val !== 0) return 0;
  const str = String(val).trim();
  if (!str) return 0;

  // Se possui vírgula, segue o padrão pt-BR: pontos são milhares e vírgula é decimal
  if (str.includes(',')) {
    const cleaned = str.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }

  // Se possui pontos de milhar sem vírgula decimal (ex: "50.000" ou "1.250.000")
  const numericOnly = str.replace(/[^\d.]/g, '');
  if (/^\d{1,3}(\.\d{3})+$/.test(numericOnly)) {
    const cleaned = numericOnly.replace(/\./g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }

  // Notação numérica padrão decimal ou inteira (ex: "50000", "50000.50")
  const cleaned = str.replace(/[^\d.-]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
};

/**
 * Formata um valor numérico ou string como moeda brasileira (BRL).
 */
export const formatBRL = (val) => {
  if (!val && val !== 0) return 'R$ 0,00';
  const num = parseBRL(val);
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};
