import { describe, it, expect } from 'vitest';
import { toLocalDate, isoDay, formatDateBR, endOfLocalDay } from './dates';

describe('dates', () => {
  it('le AAAA-MM-DD como data local, sem voltar um dia', () => {
    const d = toLocalDate('2026-10-09');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(9);
    expect(d.getDate()).toBe(9);
  });

  it('aceita Timestamp, {seconds} e vazio', () => {
    const date = new Date(2026, 0, 2);
    expect(toLocalDate({ toDate: () => date })).toBe(date);
    expect(toLocalDate({ seconds: date.getTime() / 1000 }).getTime()).toBe(date.getTime());
    expect(toLocalDate('')).toBeNull();
    expect(toLocalDate('lixo')).toBeNull();
  });

  it('isoDay usa o fuso local, nao UTC', () => {
    expect(isoDay(new Date(2026, 9, 16, 23, 30))).toBe('2026-10-16');
  });

  it('formata em pt-BR com fallback', () => {
    expect(formatDateBR('2026-10-09')).toBe('09/10/2026');
    expect(formatDateBR(null, 'N/A')).toBe('N/A');
  });

  it('fim do dia local nao muta a entrada', () => {
    const input = new Date(2026, 4, 1, 8);
    const end = endOfLocalDay(input);
    expect(end.getHours()).toBe(23);
    expect(input.getHours()).toBe(8);
  });
});
