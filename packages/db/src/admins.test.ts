import { describe, expect, it } from 'vitest';
import { nameFromEmail, parseAdminEmails } from './admins';

describe('administradores do ADMIN_EMAILS', () => {
  it('lê a lista com vírgula, ponto e vírgula ou espaço, sem repetir e sem inválidos', () => {
    expect(parseAdminEmails(' Ana.Lima@unimais.edu.br, bruno@unimais.edu.br;ana.lima@unimais.edu.br invalido ')).toEqual([
      'ana.lima@unimais.edu.br',
      'bruno@unimais.edu.br',
    ]);
    expect(parseAdminEmails(undefined)).toEqual([]);
  });

  it('monta o nome a partir do e-mail', () => {
    expect(nameFromEmail('ana.lima@unimais.edu.br')).toBe('Ana Lima');
    expect(nameFromEmail('bruno@unimais.edu.br')).toBe('Bruno');
  });
});
