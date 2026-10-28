import { createHash, randomBytes } from 'node:crypto';

/** Token aleatório para cookie de sessão e links de e-mail; no banco só fica o hash. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
