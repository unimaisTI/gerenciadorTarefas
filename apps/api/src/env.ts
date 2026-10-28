import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.url(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** Endereço público da interface, usado nos links dos e-mails. */
  APP_URL: z.url().default('http://localhost:5173'),
  /** Cookie de sessão só por HTTPS (produção). */
  COOKIE_SECURE: bool,
  /** "log" escreve os e-mails no console (sem SMTP); "smtp" envia de verdade. */
  EMAIL_TRANSPORT: z.enum(['log', 'smtp']).default('log'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_SECURE: bool,
  EMAIL_FROM: z.string().default('UniMais Hub <nao-responda@unimais.edu.br>'),
  /** Onde ficam as imagens enviadas (prints). */
  UPLOAD_DIR: z.string().default('.local/uploads'),
  /**
   * Abrir chamado por e-mail: JSON com as caixas monitoradas, ex.:
   * [{"acronym":"TI","host":"imap.unimais.edu.br","port":993,"user":"ti@unimais.edu.br","password":"..."}]
   */
  INBOUND_MAILBOXES: z.string().default('[]'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Variáveis de ambiente inválidas:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
