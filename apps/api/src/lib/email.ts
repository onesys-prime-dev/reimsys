import { randomUUID } from 'node:crypto';
import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { enqueue, registerJob } from './jobs.js';
import { resolveMail } from './mailSettings.js';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * A link is only worth putting in an email when it is a normal https address.
 * Links to a bare IP address, localhost, or plain http are a classic spam signal, so they are left out.
 */
export function isPublicLink(url: string) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    if (/^(localhost|.*\.local|.*\.test|.*\.internal)$/i.test(u.hostname)) return false;
    return !/^\d{1,3}(\.\d{1,3}){3}$/.test(u.hostname) && !u.hostname.includes(':');
  } catch {
    return false;
  }
}

export function renderHtml(heading: string, lines: string[], rawLink?: { url: string; label: string }) {
  const link = rawLink && isPublicLink(rawLink.url) ? rawLink : undefined;
  const body = rawLink && !link ? [...lines, `Sign in to ${config.orgName} to open it.`] : lines;
  return `<!doctype html><html><body style="margin:0;background:#f4f7f8;font-family:Arial,Helvetica,sans-serif;color:#12232b">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #e0e7ea;border-radius:10px">
<tr><td style="padding:18px 24px;border-bottom:1px solid #e0e7ea;font-weight:700;color:#0c7480">${esc(config.orgName)}</td></tr>
<tr><td style="padding:24px"><h2 style="margin:0 0 12px;font-size:18px">${esc(heading)}</h2>
${body.map((l) => `<p style="margin:8px 0;line-height:1.5">${esc(l)}</p>`).join('')}
${link ? `<p style="margin:20px 0 0"><a href="${esc(link.url)}" style="background:#0c7480;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;display:inline-block">${esc(link.label)}</a></p>` : ''}
</td></tr></table></td></tr></table></body></html>`;
}

/** Plain-text twin of an HTML email. Mail that carries both versions is trusted more by spam filters. */
export function htmlToText(html: string) {
  return html
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/gi, (_m, href: string, label: string) => `${label}: ${href}`)
    .replace(/<\/(p|h\d|tr|div)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Everything about how a message looks to the receiving mail system, in one place so it can be tested without sending.
 * Spam filters like: a plain-text twin, a message id on the sender's own domain, and honest "automated mail" headers.
 */
export function buildMessage(m: { id: number; from: string; to: string; subject: string; html: string }) {
  const domain = /@([^>\s]+)>?\s*$/.exec(m.from)?.[1] ?? 'localhost';
  return {
    from: m.from, to: m.to, subject: m.subject, html: m.html, text: htmlToText(m.html),
    messageId: `<${randomUUID()}@${domain}>`,
    headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All', 'X-Entity-Ref-ID': String(m.id) },
  };
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
  if (code === 'ETIMEDOUT' || (code === 'ESOCKET' && /timeout/i.test(msg))) return 'The server did not answer in time. Check the address and port, and that your network allows outgoing mail.';
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
    // Test mode: deliver to the test address, and say who it was really for so nobody is confused.
    const redirected = mail.redirectTo && mail.redirectTo !== row.toEmail;
    const to = redirected ? mail.redirectTo! : row.toEmail;
    const subject = redirected ? `[TEST for ${row.toEmail}] ${row.subject}` : row.subject;
    const html = redirected ? row.body.replace('<td style="padding:24px">', `<td style="padding:24px"><p style="margin:0 0 14px;padding:8px 10px;background:#fbf0d3;color:#8a5a00;border-radius:6px;font-size:13px">Test mode: this email was meant for ${esc(row.toEmail)}.</p>`) : row.body;
    await transportFor(mail.smtp).sendMail(buildMessage({ id: row.id, from: mail.from, to, subject, html }));
    await prisma.emailLog.update({ where: { id: row.id }, data: { status: 'sent', sentAt: new Date(), error: null } });
  } catch (err) {
    await prisma.emailLog.update({ where: { id: row.id }, data: { status: 'failed', error: explainMailError(err).slice(0, 300) } });
    throw err;
  }
});
