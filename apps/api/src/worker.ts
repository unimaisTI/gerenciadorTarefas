import { sql } from 'drizzle-orm';
import pino from 'pino';
import { createDb } from '@hub/db';
import { loadEnv } from './env';
import { notificationEmail } from './lib/emails';
import { parseMailboxes, pollMailbox } from './lib/inbound-email';
import { createMailer } from './lib/mailer';
import { rows } from './lib/sql';

/**
 * Tarefas agendadas (processo separado no PM2): avisos de prazo (RF-8.6), envio da fila de
 * e-mails (RF-8.8), limpeza (RF-8.12), tarefas recorrentes, SLA de chamados e abertura de
 * chamados por e-mail (INBOUND_MAILBOXES).
 * Roda sem usuário na sessão; só chama as funções app.job_* do banco.
 */
const env = loadEnv();
const log = pino({ level: env.LOG_LEVEL, ...(env.NODE_ENV === 'development' && { transport: { target: 'pino-pretty' } }) });
const { db, close } = createDb(env.DATABASE_URL, { max: 2 });
const mailer = createMailer(env, log);

interface OutboxRow {
  id: string;
  to_email: string;
  template: string;
  payload: Record<string, unknown>;
}

async function sendEmails() {
  const batch = await rows<OutboxRow>(db, sql`select id, to_email, template, payload from app.job_claim_emails(20)`);
  for (const mail of batch) {
    try {
      await mailer.send(notificationEmail(mail.to_email, mail.template, mail.payload, env.APP_URL));
      await db.execute(sql`select app.job_email_result(${mail.id}, null)`);
    } catch (error) {
      log.warn({ err: error, id: mail.id }, 'falha ao enviar e-mail; nova tentativa depois');
      await db.execute(sql`select app.job_email_result(${mail.id}, ${String(error)})`);
    }
  }
}

async function dueNotifications() {
  const [result] = await rows<{ n: number }>(db, sql`select app.job_due_notifications() as n`);
  if (result?.n) log.info(`${result.n} avisos de prazo gerados`);
}

async function recurrences() {
  const [result] = await rows<{ n: number }>(db, sql`select app.job_recurrences() as n`);
  if (result?.n) log.info(`${result.n} tarefas recorrentes criadas`);
}

async function sla() {
  const [result] = await rows<{ n: number }>(db, sql`select app.job_sla() as n`);
  if (result?.n) log.info(`${result.n} avisos de SLA gerados`);
}

const mailboxes = parseMailboxes(env.INBOUND_MAILBOXES);
async function inboundEmail() {
  for (const box of mailboxes) {
    const n = await pollMailbox(db, box, log);
    if (n) log.info(`${n} chamados abertos por e-mail (${box.acronym})`);
  }
}

async function cleanup() {
  await db.execute(sql`select app.job_cleanup()`);
}

function every(ms: number, name: string, job: () => Promise<void>) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await job();
    } catch (error) {
      log.error({ err: error }, `job ${name} falhou`);
    } finally {
      running = false;
    }
  };
  void tick();
  return setInterval(() => void tick(), ms);
}

const timers = [
  every(15_000, 'emails', sendEmails),
  every(5 * 60_000, 'prazos', dueNotifications),
  every(60 * 60_000, 'limpeza', cleanup),
  every(15 * 60_000, 'recorrencias', recurrences),
  every(5 * 60_000, 'sla', sla),
  ...(mailboxes.length ? [every(2 * 60_000, 'email-entrada', inboundEmail)] : []),
];
log.info('Worker no ar.');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    timers.forEach(clearInterval);
    void close().then(() => process.exit(0));
  });
}
