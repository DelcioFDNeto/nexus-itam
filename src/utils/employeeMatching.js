// src/utils/employeeMatching.js

const BRAZILIAN_STOP_WORDS = new Set(['de', 'da', 'do', 'dos', 'das', 'e']);

/**
 * Compara dois nomes (ex: nome do colaborador no cadastro vs nome no ativo sob custódia)
 * com suporte a nomes compostos, sobrenomes intermediários e preposições da língua portuguesa.
 *
 * Exemplo:
 * - "Délcio Farias" casa com "Délcio Farias Dias Neto"
 * - "Carlos Alberto" casa com "Carlos Alberto Souza"
 * - "João da Silva" casa com "João Silva"
 * - "Ana" NÃO casa falsamente com "Mariana"
 */
export const isMatchingHolder = (name1, name2) => {
  if (!name1 || !name2) return false;
  const n1 = String(name1).trim().toLowerCase();
  const n2 = String(name2).trim().toLowerCase();
  if (n1 === n2) return true;

  const rawWords1 = n1.split(/\s+/).filter(Boolean);
  const rawWords2 = n2.split(/\s+/).filter(Boolean);

  if (rawWords1.length === 0 || rawWords2.length === 0) return false;

  const words1 = rawWords1.filter(w => !BRAZILIAN_STOP_WORDS.has(w));
  const words2 = rawWords2.filter(w => !BRAZILIAN_STOP_WORDS.has(w));

  if (words1.length === 0 || words2.length === 0) return false;

  const [shorter, longer] = words1.length <= words2.length ? [words1, words2] : [words2, words1];

  // Se o nome mais curto possui 2 ou mais termos significativos (ex: "Délcio Farias"):
  // todos os termos devem estar presentes no nome mais longo
  if (shorter.length >= 2) {
    return shorter.every(w => longer.includes(w));
  }

  // Se o nome mais curto possui apenas 1 termo (ex: "Délcio"), exige igualdade exata com o primeiro nome
  if (shorter.length === 1 && shorter[0].length >= 3) {
    return longer[0] === shorter[0];
  }

  return false;
};
