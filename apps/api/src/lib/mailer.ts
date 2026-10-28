import nodemailer, { type Transporter } from 'nodemailer';
import type { FastifyBaseLogger } from 'fastify';
import type { Env } from '../env';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export function createMailer(env: Env, log: FastifyBaseLogger): Mailer {
  if (env.EMAIL_TRANSPORT === 'log') {
    return {
      send: (mail) => {
        log.info({ to: mail.to, subject: mail.subject }, `E-mail (modo log):\n${mail.text}`);
        return Promise.resolve();
      },
    };
  }
  const transport: Transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    ...(env.SMTP_USER && { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } }),
  });
  return {
    send: async (mail) => {
      await transport.sendMail({ from: env.EMAIL_FROM, ...mail });
    },
  };
}
