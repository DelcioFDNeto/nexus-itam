// src/utils/dates.js
// -----------------------------------------------------------------------------
// Datas no fuso local. `new Date('2026-10-09')` e meia-noite UTC — no Brasil
// (-03:00) isso e dia 08 as 21h. E `toISOString().slice(0, 10)` depois das 21h
// ja devolve o dia seguinte. Use estas funcoes para datas de formulario.
// -----------------------------------------------------------------------------

const DAY_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Data de formulario (AAAA-MM-DD), Date, Timestamp ou {seconds} -> Date local. */
export const toLocalDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000);
  }
  const match = String(value).match(DAY_ONLY);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const pad = (n) => String(n).padStart(2, '0');

/** Date -> "AAAA-MM-DD" no fuso local (valor de <input type="date">). */
export const isoDay = (date = new Date()) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** Hoje em "AAAA-MM-DD" no fuso local. */
export const today = () => isoDay(new Date());

/** Qualquer formato aceito por toLocalDate -> "dd/mm/aaaa" (ou fallback). */
export const formatDateBR = (value, fallback = '-') => {
  const date = toLocalDate(value);
  return date ? date.toLocaleDateString('pt-BR') : fallback;
};

/** Qualquer formato aceito por toLocalDate -> "dd/mm/aaaa hh:mm" (ou fallback). */
export const formatDateTimeBR = (value, fallback = '-') => {
  const date = toLocalDate(value);
  return date
    ? date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    : fallback;
};

/** Fim do dia local de uma data de formulario (para vencimentos). */
export const endOfLocalDay = (value) => {
  const date = toLocalDate(value);
  if (!date) return null;
  const end = new Date(date.getTime());
  end.setHours(23, 59, 59, 999);
  return end;
};
