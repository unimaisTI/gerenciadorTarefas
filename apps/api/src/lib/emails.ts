import { TICKET_STATUS_LABELS, type TicketStatus } from '@hub/shared';
import type { Mail } from './mailer';

// Modelos de e-mail em PT-BR, texto curto, sem emoji. O HTML é montado só com texto escapado.

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function layout(to: string, subject: string, lines: string[], action?: { label: string; url: string }): Mail {
  const text = [...lines, ...(action ? ['', `${action.label}: ${action.url}`] : []), '', 'UniMais Hub'].join('\n');
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f7f7f7;font-family:Poppins,Segoe UI,sans-serif;color:#282728">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:30px 15px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e2e2;border-radius:20px">
<tr><td style="background:#2b2f84;border-radius:20px 20px 0 0;padding:20px 30px;color:#ffffff;font-family:Montserrat,sans-serif;font-weight:800;font-size:18px">UniMais Hub</td></tr>
<tr><td style="padding:30px;font-size:15px;line-height:1.5">
${lines.map((l) => `<p style="margin:0 0 12px">${escapeHtml(l)}</p>`).join('')}
${action ? `<p style="margin:20px 0 0"><a href="${escapeHtml(action.url)}" style="display:inline-block;background:#2b2f84;color:#ffffff;text-decoration:none;font-weight:600;padding:10px 22px;border-radius:200px">${escapeHtml(action.label)}</a></p>` : ''}
</td></tr></table></td></tr></table></body></html>`;
  return { to, subject, text, html };
}

export function inviteEmail(to: string, name: string, url: string): Mail {
  return layout(
    to,
    'Seu acesso ao UniMais Hub',
    [`Olá, ${name}.`, 'Sua conta no UniMais Hub foi criada. Defina sua senha para entrar.', 'O link vale por 7 dias.'],
    { label: 'Definir minha senha', url },
  );
}

export function resetEmail(to: string, name: string, url: string): Mail {
  return layout(
    to,
    'Redefinição de senha do UniMais Hub',
    [`Olá, ${name}.`, 'Recebemos um pedido para redefinir sua senha. O link vale por 2 horas.', 'Se não foi você, ignore este e-mail.'],
    { label: 'Redefinir senha', url },
  );
}

/** E-mails de notificação (RF-8.8), gerados a partir da email_outbox. */
export function notificationEmail(
  to: string,
  template: string,
  payload: Record<string, unknown>,
  appUrl: string,
): Mail {
  const str = (k: string) => (typeof payload[k] === 'string' ? payload[k] : '');
  const name = str('recipientName');
  const actor = str('actorName') || 'Alguém';
  const code = str('ticketCode') || str('taskCode');
  const title = str('taskTitle');
  const note = str('note');
  const url = `${appUrl}/tarefas/${encodeURIComponent(str('taskCode'))}`;
  const ref = `${code} · ${title}`;
  const status = str('status') as TicketStatus;

  const map: Record<string, { subject: string; lines: string[] }> = {
    ticket_opened: {
      subject: `Novo chamado para o seu departamento: ${code}`,
      lines: [`${actor} abriu o chamado ${ref}.`],
    },
    ticket_awaiting_approval: {
      subject: `Chamado aguardando sua aprovação: ${code}`,
      lines: [`${actor} marcou o chamado ${ref} como entregue.`, ...(note ? [`Entrega: ${note}`] : []), 'Aprove ou devolva com o motivo.'],
    },
    ticket_returned: {
      subject: `Chamado devolvido: ${code}`,
      lines: [`${actor} devolveu o chamado ${ref}.`, ...(note ? [`Motivo: ${note}`] : [])],
    },
    ticket_approved: {
      subject: `Chamado aprovado: ${code}`,
      lines: [`${actor} aprovou a entrega do chamado ${ref}.`],
    },
    task_assigned: {
      subject: `Atribuído a você: ${code}`,
      lines: [`${actor} atribuiu a você ${ref}.`],
    },
    mentioned: {
      subject: `Você foi mencionado em ${code}`,
      lines: [`${actor} mencionou você em ${ref}.`],
    },
  };
  const entry = map[template] ?? {
    subject: `Atualização em ${code}`,
    lines: [`${ref}: ${status in TICKET_STATUS_LABELS ? TICKET_STATUS_LABELS[status] : 'atualizado'}.`],
  };
  return layout(to, entry.subject, [`Olá, ${name}.`, ...entry.lines], { label: 'Abrir no UniMais Hub', url });
}
