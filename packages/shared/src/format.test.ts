import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatNumber } from './format';

describe('format', () => {
  it('formata datas em dd/mm/aaaa no fuso de São Paulo', () => {
    // 02:00 UTC ainda é dia 27 em São Paulo (UTC-3).
    expect(formatDate('2026-10-28T02:00:00Z')).toBe('27/10/2026');
    expect(formatDate('2026-10-28T15:00:00Z')).toBe('28/10/2026');
  });

  it('formata data e hora', () => {
    expect(formatDateTime('2026-10-28T17:32:00Z')).toBe('28/10/2026 14:32');
  });

  it('usa ponto como separador de milhar', () => {
    expect(formatNumber(1284)).toBe('1.284');
  });
});
