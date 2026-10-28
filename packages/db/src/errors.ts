/**
 * As funções SQL levantam exceções com mensagem em PT-BR e SQLSTATE padrão.
 * Isto traduz o SQLSTATE em status HTTP; a mensagem segue para o usuário.
 */
export interface PgErrorInfo {
  status: number;
  code: string;
  message: string;
}

const STATES: Record<string, { status: number; code: string }> = {
  '42501': { status: 403, code: 'forbidden' }, // insufficient_privilege / RLS
  '23514': { status: 422, code: 'rule_violation' }, // check_violation
  P0002: { status: 404, code: 'not_found' }, // no_data_found
  '23505': { status: 409, code: 'conflict' }, // unique_violation
  '23503': { status: 422, code: 'invalid_reference' }, // foreign_key_violation
  '22P02': { status: 400, code: 'invalid_input' },
};

export function translatePgError(error: unknown): PgErrorInfo | null {
  const e = (error as { cause?: unknown }).cause ?? error;
  if (typeof e !== 'object' || e === null || !('code' in e)) return null;
  const state = String((e).code);
  const mapped = STATES[state];
  if (!mapped) return null;
  const raw = 'message' in e ? String((e as { message: unknown }).message) : '';
  let message = raw;
  // Mensagens nativas do Postgres (em inglês) citam tabelas e constraints: nunca vão ao usuário.
  // As que levantamos nas funções SQL já estão em PT-BR e seguem como estão.
  if (state === '42501' && (raw.includes('row-level security') || raw.startsWith('permission denied'))) {
    message = 'Você não tem permissão para esta ação.';
  } else if (state === '23514' && raw.includes('violates check constraint')) {
    message = 'Dados inválidos.';
  } else if (state === '23505') {
    message = 'Já existe um registro com esses dados.';
  } else if (state === '23503') {
    message = 'Referência inválida.';
  } else if (state === '22P02') {
    message = 'Dados inválidos.';
  }
  return { ...mapped, message };
}
