/**
 * Utilitário de geração de senhas seguras com alta entropia para o Portal do Colaborador.
 * Garante presença de caracteres maiúsculos, minúsculos, números e símbolos especiais.
 */
export const generateRandomSecurePassword = (length = 14) => {
  const safeLength = Math.max(8, length);
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const numbers = '23456789';
  const symbols = '@#$!%&*+=?';
  const all = upper + lower + numbers + symbols;

  const getRandomInt = (max) => {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const buffer = new Uint32Array(1);
      crypto.getRandomValues(buffer);
      return buffer[0] % max;
    }
    return Math.floor(Math.random() * max);
  };

  const pwd = [
    upper[getRandomInt(upper.length)],
    lower[getRandomInt(lower.length)],
    numbers[getRandomInt(numbers.length)],
    symbols[getRandomInt(symbols.length)],
  ];

  for (let i = pwd.length; i < safeLength; i++) {
    pwd.push(all[getRandomInt(all.length)]);
  }

  // Fisher-Yates shuffle
  for (let i = pwd.length - 1; i > 0; i--) {
    const j = getRandomInt(i + 1);
    [pwd[i], pwd[j]] = [pwd[j], pwd[i]];
  }

  return pwd.join('');
};
