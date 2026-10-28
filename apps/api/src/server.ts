import pino from 'pino';
import { createDb } from '@hub/db';
import { buildApp } from './app';
import { loadEnv } from './env';
import { createMailer } from './lib/mailer';
import { Realtime } from './lib/realtime';

const env = loadEnv();
const logger = pino({
  level: env.LOG_LEVEL,
  ...(env.NODE_ENV === 'development' && { transport: { target: 'pino-pretty' } }),
});

const { db, close } = createDb(env.DATABASE_URL);
const realtime = new Realtime(env.DATABASE_URL, logger);
await realtime.start();

const app = await buildApp(
  { db, env, mailer: createMailer(env, logger), realtime },
  { loggerInstance: logger, trustProxy: env.NODE_ENV === 'production' },
);

app.addHook('onClose', async () => {
  await realtime.stop();
  await close();
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ host: env.API_HOST, port: env.API_PORT });
