import { hash, verify } from '@node-rs/argon2';

// RF-3.5: senha guardada só como hash argon2id (parâmetros padrão recomendados pela OWASP).

export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** Hash fixo para gastar o mesmo tempo quando o e-mail não existe (não revela contas). */
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hash('senha-inexistente-0');
  return dummyHash;
}
