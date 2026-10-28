import { sql, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Executor } from '@hub/db';
import {
  isoDate,
  myTicketsQuery,
  openTicketSchema,
  parseDriveLink,
  permissions,
  richDocToText,
  sanitizeRichDoc,
  ticketAssignSchema,
  ticketTransitionSchema,
  uuid,
  type TicketListItemDto,
} from '@hub/shared';
import { one, rows } from '../../lib/sql';
import { asViewer } from '../../plugins/auth';
import { forbidden, unprocessable } from '../../plugins/errors';
import { userRef } from '../tasks/queries';

const idParams = z.object({ id: uuid });

const CLOSED = sql`('approved', 'rejected', 'cancelled')`;

export function listTickets(tx: Executor, where: SQL, order: SQL = sql`k.submitted_at desc`) {
  return rows<TicketListItemDto>(
    tx,
    sql`select k.id, k.code, p.key || '-' || t.number as "taskCode", t.title, k.status, t.priority,
          k.revision_count as "revisionCount",
          json_build_object('id', td.id, 'acronym', td.acronym, 'name', td.name) as "targetDepartment",
          json_build_object('id', rd.id, 'acronym', rd.acronym, 'name', rd.name) as "requesterDepartment",
          ${userRef('r')} as requester, ${userRef('a')} as assignee,
          k.desired_due_date::text as "desiredDueDate", t.due_date::text as "dueDate",
          app.iso(k.submitted_at) as "submittedAt", app.iso(k.updated_at) as "updatedAt"
        from tickets k
        join tasks t on t.id = k.task_id
        join projects p on p.id = t.project_id
        join departments td on td.id = k.target_department_id
        join departments rd on rd.id = k.requester_department_id
        join users r on r.id = k.requester_id
        left join users a on a.id = t.assignee_id
        where ${where}
        order by ${order}
        limit 300`,
  );
}

/** Chamados aguardando aprovação do usuário (solicitante, aprovador ou gestor do lado solicitante). */
export const awaitingMyApproval = (userId: string) => sql`
  k.status = 'awaiting_approval' and (k.requester_id = ${userId} or k.approver_id = ${userId}
    or exists (select 1 from department_members m where m.user_id = ${userId}
               and m.department_id = k.requester_department_id and m.is_manager))`;

async function ticketById(tx: Executor, id: string) {
  const row = await one<{ id: string }>(tx, sql`select id from tickets where id = ${id}`);
  if (!row) throw forbidden('Chamado não encontrado ou sem acesso.');
  return row;
}

export const ticketRoutes: FastifyPluginAsyncZod = async (app) => {
  // RF-7.1 e RF-7.2: abre o chamado (função do banco cria a tarefa no quadro do executor).
  app.post('/tickets', { schema: { body: openTicketSchema } }, (request, reply) =>
    asViewer(request, async (tx, viewer) => {
      if (!permissions.openTicket(viewer)) throw forbidden();
      const b = request.body;
      const links = b.attachments.map((a) => ({ ...a, parsed: parseDriveLink(a.url) }));
      if (links.some((l) => !l.parsed)) {
        throw unprocessable('Anexos precisam ser links do Google Drive ou Google Docs.');
      }
      const description = b.description ? sanitizeRichDoc(b.description) : null;
      const opened = await one<{ id: string }>(
        tx,
        sql`select app.ticket_open(${b.targetDepartmentId}, ${b.ticketTypeId}, ${b.title},
              ${description ? JSON.stringify(description) : null}::jsonb, ${richDocToText(description)},
              ${b.priority}::priority, ${b.desiredDueDate ?? null}::date, ${b.approverId ?? null}::uuid) as id`,
      );
      if (!opened) throw new Error('Falha ao abrir chamado');
      const ticket = await one<{ code: string; taskId: string; taskCode: string }>(
        tx,
        sql`select k.code, k.task_id as "taskId", p.key || '-' || t.number as "taskCode"
            from tickets k join tasks t on t.id = k.task_id join projects p on p.id = t.project_id
            where k.id = ${opened.id}`,
      );
      if (!ticket) throw new Error('Falha ao abrir chamado');
      for (const l of links) {
        if (!l.parsed) continue;
        await tx.execute(sql`
          insert into attachments (task_id, url, provider, drive_file_id, name, mime_type, added_by)
          values (${ticket.taskId}, ${l.parsed.url}, 'gdrive', ${l.parsed.driveFileId}, ${l.name ?? null}, ${l.parsed.kind}, ${viewer.id})`);
      }
      return reply.status(201).send({ id: opened.id, code: ticket.code, taskCode: ticket.taskCode });
    }),
  );

  // Meus chamados: "Abertos por mim", "Aguardando minha aprovação" e "Encerrados".
  app.get('/tickets/mine', { schema: { querystring: myTicketsQuery } }, (request) =>
    asViewer(request, (tx, viewer) => {
      const tab = request.query.tab;
      if (tab === 'approval') return listTickets(tx, awaitingMyApproval(viewer.id), sql`k.delivered_at`);
      if (tab === 'closed') {
        return listTickets(
          tx,
          sql`k.status in ${CLOSED} and (k.requester_id = ${viewer.id} or k.approver_id = ${viewer.id})`,
          sql`k.closed_at desc`,
        );
      }
      return listTickets(tx, sql`k.status not in ${CLOSED} and k.requester_id = ${viewer.id}`);
    }),
  );

  /** Lista de chamados recebidos/enviados por um departamento (visão em tabela). */
  app.get(
    '/departments/:id/tickets',
    { schema: { params: idParams, querystring: z.object({ direction: z.enum(['received', 'sent']).default('received') }) } },
    (request) =>
      asViewer(request, (tx) =>
        listTickets(
          tx,
          request.query.direction === 'received'
            ? sql`k.target_department_id = ${request.params.id}`
            : sql`k.requester_department_id = ${request.params.id}`,
        ),
      ),
  );

  // Seção 7: única porta para mudar o status. As regras e as permissões são checadas no banco.
  app.post('/tickets/:id/transition', { schema: { params: idParams, body: ticketTransitionSchema } }, (request) =>
    asViewer(request, async (tx) => {
      await ticketById(tx, request.params.id);
      await tx.execute(
        sql`select app.ticket_transition(${request.params.id}, ${request.body.to}::ticket_status, ${request.body.note ?? null})`,
      );
      return { ok: true };
    }),
  );

  app.post('/tickets/:id/assign', { schema: { params: idParams, body: ticketAssignSchema } }, (request) =>
    asViewer(request, async (tx) => {
      await ticketById(tx, request.params.id);
      await tx.execute(sql`select app.ticket_assign(${request.params.id}, ${request.body.assigneeId})`);
      return { ok: true };
    }),
  );

  app.post(
    '/tickets/:id/due',
    {
      schema: {
        params: idParams,
        body: z.object({ dueDate: isoDate.nullable(), reason: z.string().trim().min(1, 'Informe o motivo.').max(500) }),
      },
    },
    (request) =>
      asViewer(request, async (tx) => {
        await ticketById(tx, request.params.id);
        await tx.execute(
          sql`select app.ticket_set_due(${request.params.id}, ${request.body.dueDate}::date, ${request.body.reason})`,
        );
        return { ok: true };
      }),
  );
};
