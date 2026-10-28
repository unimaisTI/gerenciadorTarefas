import { sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { hashPassword, verifyPassword } from '@hub/db';
import {
  EMAIL_EVENTS,
  changePasswordSchema,
  notificationPrefsSchema,
  updateProfileSchema,
  type MeDto,
} from '@hub/shared';
import { one, rows } from '../../lib/sql';
import { HttpError } from '../../plugins/errors';
import { asViewer } from '../../plugins/auth';
import { getUser } from '../users/queries';

// RF-4.7: "Meu perfil": foto, telefone, senha e preferências de notificação.
export const meRoutes: FastifyPluginAsyncZod = async (app) => {
  app.patch('/me', { schema: { body: updateProfileSchema } }, (request) =>
    asViewer(request, async (tx, viewer) => {
      const { phone, avatarUrl } = request.body;
      await tx.execute(sql`
        update users set
          phone = case when ${phone !== undefined} then ${phone ?? null} else phone end,
          avatar_url = case when ${avatarUrl !== undefined} then ${avatarUrl ?? null} else avatar_url end
        where id = ${viewer.id}`);
      return (await getUser(tx, viewer.id)) as MeDto;
    }),
  );

  app.post('/me/password', { schema: { body: changePasswordSchema } }, (request) =>
    asViewer(request, async (tx) => {
      const current = await one<{ hash: string | null }>(tx, sql`select app.auth_my_password_hash() as hash`);
      if (!current?.hash || !(await verifyPassword(current.hash, request.body.currentPassword))) {
        throw new HttpError(400, 'invalid_password', 'A senha atual não confere.');
      }
      const newHash = await hashPassword(request.body.newPassword);
      await tx.execute(
        sql`select app.auth_change_password(${newHash}, ${request.sessionTokenHash ?? ''})`,
      );
      return { ok: true };
    }),
  );

  app.get('/me/notification-prefs', (request) =>
    asViewer(request, async (tx, viewer) => {
      const saved = await rows<{ eventType: string; emailEnabled: boolean }>(
        tx,
        sql`select event_type as "eventType", email_enabled as "emailEnabled"
            from notification_prefs where user_id = ${viewer.id}`,
      );
      return EMAIL_EVENTS.map((eventType) => ({
        eventType,
        emailEnabled: saved.find((s) => s.eventType === eventType)?.emailEnabled ?? true,
      }));
    }),
  );

  app.put('/me/notification-prefs', { schema: { body: notificationPrefsSchema } }, (request) =>
    asViewer(request, async (tx, viewer) => {
      for (const p of request.body.prefs) {
        await tx.execute(sql`
          insert into notification_prefs (user_id, event_type, email_enabled)
          values (${viewer.id}, ${p.eventType}, ${p.emailEnabled})
          on conflict (user_id, event_type) do update set email_enabled = excluded.email_enabled, updated_at = now()`);
      }
      return { ok: true };
    }),
  );
};
