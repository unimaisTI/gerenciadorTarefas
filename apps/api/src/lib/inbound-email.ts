import { sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { z } from 'zod';
import { withUser, type Database } from '@hub/db';
import { textToRichDoc } from '@hub/shared';
import { one } from './sql';

/**
 * Abrir chamado por e-mail: cada caixa (ex.: ti@unimais.edu.br) pertence a um departamento.
 * Um e-mail de um usuário ativo vira chamado aberto por ele, como se usasse a tela
 * "Abrir chamado" (mesma função do banco, mesmas regras). Remetente desconhecido é ignorado.
 */
const mailboxSchema = z.array(
  z.object({
    acronym: z.string().min(2),
    host: z.string().min(1),
    port: z.number().int().default(993),
    secure: z.boolean().default(true),
    user: z.string().min(1),
    password: z.string().min(1),
  }),
);
export type InboundMailbox = z.infer<typeof mailboxSchema>[number];

export function parseMailboxes(raw: string): InboundMailbox[] {
  return mailboxSchema.parse(JSON.parse(raw));
}

export interface InboundTicket {
  fromEmail: string;
  title: string;
  body: string;
}

/** Monta o chamado a partir do e-mail: assunto vira título; texto vira descrição. */
export function toInboundTicket(from: string | undefined, subject: string | undefined, text: string | undefined): InboundTicket | null {
  const email = /<?([^<>\s]+@[^<>\s]+)>?\s*$/.exec(from ?? '')?.[1]?.toLowerCase();
  if (!email) return null;
  const title = (subject ?? '').replace(/^\s*((re|fw|fwd|enc|res)\s*:\s*)+/i, '').trim().slice(0, 200) || 'Chamado recebido por e-mail';
  const body = (text ?? '').replace(/\r\n/g, '\n').trim().slice(0, 5000);
  return { fromEmail: email, title, body };
}

export async function openTicketFromEmail(db: Database, acronym: string, t: InboundTicket): Promise<string | null> {
  // Sem usuário na sessão o RLS esconde tudo: o remetente é resolvido pela função de login
  // e o resto é feito em nome dele, como se usasse a tela.
  const sender = await one<{ userId: string }>(
    db,
    sql`select user_id as "userId" from app.auth_get_login(${t.fromEmail}) where is_active`,
  );
  if (!sender) return null;
  const description = textToRichDoc(t.body || '(sem texto)');
  return withUser(db, sender.userId, async (tx) => {
    const target = await one<{ deptId: string; typeId: string | null }>(
      tx,
      sql`select d.id as "deptId",
            (select id from ticket_types where department_id = d.id and is_active order by created_at limit 1) as "typeId"
          from departments d where d.acronym = ${acronym}`,
    );
    if (!target?.typeId) return null;
    const row = await one<{ id: string }>(
      tx,
      sql`select app.ticket_open(${target.deptId}, ${target.typeId}, ${t.title}, ${JSON.stringify(description)}::jsonb,
            ${t.body}, 'medium'::priority, null::date, null::uuid) as id`,
    );
    return row?.id ?? null;
  });
}

export async function pollMailbox(db: Database, box: InboundMailbox, log: FastifyBaseLogger): Promise<number> {
  const client = new ImapFlow({
    host: box.host,
    port: box.port,
    secure: box.secure,
    auth: { user: box.user, pass: box.password },
    logger: false,
  });
  let opened = 0;
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  try {
    const unseen = await client.search({ seen: false }, { uid: true });
    for (const uid of unseen || []) {
      const message = await client.fetchOne(String(uid), { source: true }, { uid: true });
      if (!message || !message.source) continue;
      const parsed = await simpleParser(message.source);
      const ticket = toInboundTicket(parsed.from?.text, parsed.subject, parsed.text);
      try {
        const id = ticket ? await openTicketFromEmail(db, box.acronym, ticket) : null;
        if (id) opened += 1;
        else log.info({ from: parsed.from?.text, mailbox: box.user }, 'e-mail ignorado: remetente não é usuário ativo');
      } catch (error) {
        // Ex.: remetente do próprio departamento. Marca como lido para não repetir.
        log.warn({ err: error, mailbox: box.user }, 'e-mail não virou chamado');
      }
      await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
    }
  } finally {
    lock.release();
    await client.logout();
  }
  return opened;
}
