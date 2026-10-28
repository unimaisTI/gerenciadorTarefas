import cookie from '@fastify/cookie';
import Fastify, { type FastifyServerOptions } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Database } from '@hub/db';
import type { Env } from './env';
import type { Mailer } from './lib/mailer';
import type { Realtime } from './lib/realtime';
import { registerAuth } from './plugins/auth';
import { errorHandler } from './plugins/errors';
import { auditRoutes } from './modules/audit/routes';
import { authRoutes } from './modules/auth/routes';
import { calendarRoutes } from './modules/calendar/routes';
import { commentRoutes } from './modules/comments/routes';
import { dashboardRoutes } from './modules/dashboards/routes';
import { departmentRoutes } from './modules/departments/routes';
import { fileRoutes } from './modules/files/routes';
import { planningRoutes } from './modules/planning/routes';
import { healthRoutes } from './modules/health/routes';
import { meRoutes } from './modules/me/routes';
import { notificationRoutes } from './modules/notifications/routes';
import { projectRoutes } from './modules/projects/routes';
import { taskRoutes } from './modules/tasks/routes';
import { ticketRoutes } from './modules/tickets/routes';
import { userRoutes } from './modules/users/routes';

export interface AppDeps {
  db: Database;
  env: Env;
  mailer: Mailer;
  realtime: Pick<Realtime, 'subscribe'>;
}

export async function buildApp(deps: AppDeps, options: FastifyServerOptions = {}) {
  const app = Fastify(options).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({ error: { code: 'not_found', message: 'Rota não encontrada.' } }),
  );

  app.decorate('db', deps.db);
  app.decorate('env', deps.env);
  app.decorate('mailer', deps.mailer);
  app.decorate('realtime', deps.realtime);

  await app.register(cookie);
  registerAuth(app, new URL(deps.env.APP_URL).origin);

  for (const routes of [
    healthRoutes,
    authRoutes,
    meRoutes,
    userRoutes,
    departmentRoutes,
    projectRoutes,
    taskRoutes,
    commentRoutes,
    ticketRoutes,
    notificationRoutes,
    calendarRoutes,
    dashboardRoutes,
    auditRoutes,
    planningRoutes,
    fileRoutes,
  ]) {
    await app.register(routes, { prefix: '/api' });
  }

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
    env: Env;
    mailer: Mailer;
    realtime: Pick<Realtime, 'subscribe'>;
  }
}
