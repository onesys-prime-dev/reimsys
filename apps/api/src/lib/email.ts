import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { enqueue, registerJob } from './jobs.js';
import { resolveMail } from './mailSettings.js';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function renderHtml(heading: string, lines: string[], link?: { url: string; label: string }) {
  return `<!doctype html><html><body style="margin:0;background:#f4f7f8;font-family:Arial,Helvetica,sans-serif;color:#12232b">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #e0e7ea;border-radius:10px">
<tr><td style="padding:18px 24px;border-bottom:1px solid #e0e7ea;font-weight:700;color:#0c7480">${esc(config.orgName)}</td></tr>
<tr><td style="padding:24px"><h2 style="margin:0 0 12px;font-size:18px">${esc(heading)}</h2>
${lines.map((l) => `<p style="margin:8px 0;line-height:1.5">${esc(l)}</p>`).join('')}
${link ? `<p style="margin:20px 0 0"><a href="${esc(link.url)}" style="background:#0c7480;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;display:inline-block">${esc(link.label)}</a></p>` : ''}
</td></tr></table></td></tr></table></body></html>`;
}

/** One transport per distinct mail account. It is rebuilt automatically when the account changes. */
let current: { sig: string; transport: Transporter } | null = null;
export function transportFor(smtp: { host: string; port: number; secure: boolean; user?: string; pass?: string }): Transporter {
  const sig = JSON.stringify(smtp);
  if (current?.sig === sig) return current.transport;
  const transport = nodemailer.createTransport({
    host: smtp.host, port: smtp.port, secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
  });
  current = { sig, transport };
  return transport;
}

/** Turns a connection error into a sentence an administrator can act on. */
export function explainMailError(err: unknown): string {
  const first = err instanceof AggregateError ? err.errors[0] : (err as { code?: string; message?: string; responseCode?: number; address?: string; port?: number });
  const code = first?.code ?? '';
  const msg = first?.message || (err as Error)?.message || '';
  if (code === 'EAUTH' || first?.responseCode === 535) return 'The server rejected the username or password. For Gmail, use an App password, not your normal password.';
  if (code === 'ECONNREFUSED') return `Could not connect to ${first?.address ?? 'the server'}:${first?.port ?? ''}. Check the server address and port.`;
  if (code === 'ENOTFOUND' || code === 'EDNS') return 'That server address was not found. Check the spelling.';
  if (code === 'ETIMEDOUT' || code === 'ESOCKET' && /timeout/i.test(msg)) return 'The server did not answer in time. Check the address and port, and that your network allows outgoing mail.';
  if (/wrong version number|SSL|TLS|ssl3/i.test(msg)) return 'Secure connection failed. Port 465 needs "Secure connection" on; port 587 needs it off.';
  return (msg || code || 'Could not reach the mail server').slice(0, 250);
}

/** Records the email and queues it. Sending happens in the worker, with retries. */
export async function queueEmail(input: { userId?: number; to: string; template: string; subject: string; html: string }) {
  const row = await prisma.emailLog.create({
    data: { userId: input.userId ?? null, toEmail: input.to, template: input.template, subject: input.subject.slice(0, 200), body: input.html },
  });
  await enqueue('email', { emailLogId: row.id });
}

registerJob('email', async ({ emailLogId }: { emailLogId: number }) => {
  const row = await prisma.emailLog.findUnique({ where: { id: emailLogId } });
  if (!row || row.status === 'sent') return;
  await prisma.emailLog.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
  const mail = await resolveMail();
  if (!mail.smtp) {
    console.log(`[email not sent: no mail account is set up] to=${row.toEmail} subject="${row.subject}"`);
    await prisma.emailLog.update({ where: { id: row.id }, data: { status: 'logged', error: 'No mail account is set up yet' } });
    return;
  }
  try {
    await transportFor(mail.smtp).sendMail({ from: mail.from, to: row.toEmail, subject: row.subject, html: row.body });
    await prisma.emailLog.update({ where: { id: row.id }, data: { status: 'sent', sentAt: new Date(), error: null } });
  } catch (err) {
    await prisma.emailLog.update({ where: { id: row.id }, data: { status: 'failed', error: explainMailError(err).slice(0, 300) } });
    throw err;
  }
});
