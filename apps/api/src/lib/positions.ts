import { generateKeyBetween } from 'fractional-indexing';

/**
 * Posição fracionária entre dois cartões. Se alguma chave vizinha estiver corrompida
 * (ex.: dado antigo ou inserido à mão), cai para uma posição válida em vez de dar erro 500.
 */
export function keyBetween(before: string | null, after: string | null): string {
  try {
    return generateKeyBetween(before, after);
  } catch {
    try {
      return generateKeyBetween(before, null);
    } catch {
      return generateKeyBetween(null, null);
    }
  }
}

export const keyAfter = (last: string | null) => keyBetween(last, null);
