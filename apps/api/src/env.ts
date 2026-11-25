import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

/** Chave vazia no .env ("GOOGLE_CLIENT_ID=") conta como não definida. */
const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalText = z.preprocess(blankToUndefined, z.string().min(1).optional());
const optionalUrl = z.preprocess(blankToUndefined, z.url().optional());

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
  /**
   * Login com Google (OAuth do Google Cloud). Sem ID e segredo, o botão não aparece.
   * O endereço de retorno tem de estar cadastrado no Google exatamente igual; o Google não aceita
   * IP de rede local (192.168...), só localhost ou um domínio com HTTPS.
   */
  GOOGLE_CLIENT_ID: optionalText,
  GOOGLE_CLIENT_SECRET: optionalText,
  /** Padrão: APP_URL + /api/auth/google/callback. */
  GOOGLE_REDIRECT_URI: optionalUrl,
  /** Domínios aceitos no login com Google, separados por vírgula (ex.: facmais.edu.br). Vazio = qualquer um. */
  GOOGLE_ALLOWED_DOMAINS: optionalText,
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Variáveis de ambiente inválidas:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
