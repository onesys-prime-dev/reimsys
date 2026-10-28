import { randomUUID } from 'node:crypto';
import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { enqueue, onJobGivesUp, registerJob } from './jobs.js';
import { EMAIL_LOGO_PNG_BASE64 } from './emailLogo.js';
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
 * Addresses on example.com, .test and similar are reserved: they can never be real mailboxes. Sending to them only
 * produces bounce messages, so they are recorded as "logged" instead. A local test mailbox is still allowed to receive them.
 */
const RESERVED_DOMAIN = /(^|\.)(example(\.(com|net|org))?|test|invalid|localhost)$/i;
export const isReservedAddress = (addr: string) => RESERVED_DOMAIN.test((addr.split('@').pop() ?? '').trim());
const isLocalTestServer = (host: string) => ['localhost', '127.0.0.1', '::1'].includes(host);

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
    attachments: m.html.includes('cid:logo@reimsys')
      ? [{ filename: 'logo.png', content: Buffer.from(EMAIL_LOGO_PNG_BASE64, 'base64'), cid: 'logo@reimsys', contentDisposition: 'inline' as const }]
      : [],
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

/** The saved mail password was locked with a key this server does not have (a restored database without its storage folder, or a different SETTINGS_KEY). */
export const PASSWORD_UNREADABLE = 'The saved mail password cannot be unlocked on this server (the key it was saved with is missing). Open Access, then Email, and enter the mail password again.';

/** Records the email and queues it. Sending happens in the worker, with retries. */
export async function queueEmail(input: { userId?: number; to: string; template: string; subject: string; html: string }) {
  const row = await prisma.emailLog.create({
    data: { userId: input.userId ?? null, toEmail: input.to, template: input.template, subject: input.subject.slice(0, 200), body: input.html },
  });
  await enqueue('email', { emailLogId: row.id });
}

/** An email that could not be sent for about a day: the people who look after settings are told, so it is not lost silently. */
onJobGivesUp('email', async ({ emailLogId }: { emailLogId: number }, message) => {
  const row = await prisma.emailLog.findUnique({ where: { id: emailLogId } });
  if (!row || row.status === 'sent') return;
  const admins = await prisma.user.findMany({ where: { isActive: true, role: { permissions: { some: { permission: { code: 'settings.manage' } } } } }, select: { id: true } });
  if (!admins.length) return;
  await prisma.notification.createMany({ data: admins.map((a) => ({ userId: a.id, type: 'email_failed', text: `An email to ${row.toEmail} ("${row.subject.slice(0, 80)}") could not be sent after a day of trying: ${message.slice(0, 120)}`.slice(0, 300), receiptId: null })) });
});

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
  if (mail.passwordUnreadable) {
    // Retrying cannot help: someone has to enter the mail password again on this server.
    await prisma.emailLog.update({ where: { id: row.id }, data: { status: 'failed', error: PASSWORD_UNREADABLE } });
    return;
  }
  try {
    // Test mode: deliver to the test address, and say who it was really for so nobody is confused.
    const redirected = mail.redirectTo && mail.redirectTo !== row.toEmail;
    const to = redirected ? mail.redirectTo! : row.toEmail;
    if (isReservedAddress(to) && !isLocalTestServer(mail.smtp.host)) {
      await prisma.emailLog.update({ where: { id: row.id }, data: { status: 'logged', error: 'Example address, not a real mailbox, so it was not sent' } });
      return;
    }
    const subject = redirected ? `[TEST for ${row.toEmail}] ${row.subject}` : row.subject;
    const html = redirected ? row.body.replace('<td style="padding:24px">', `<td style="padding:24px"><p style="margin:0 0 14px;padding:8px 10px;background:#fbf0d3;color:#8a5a00;border-radius:6px;font-size:13px">Test mode: this email was meant for ${esc(row.toEmail)}.</p>`) : row.body;
    const info = await transportFor(mail.smtp).sendMail(buildMessage({ id: row.id, from: mail.from, to, subject, html }));
    const accepted = (info.accepted ?? []).map(String), rejected = (info.rejected ?? []).map(String);
    // The server can accept the connection and still refuse the recipient, so look at who was actually accepted.
    if (!accepted.length) throw new Error(`The mail server refused every recipient (${rejected.join(', ') || 'none accepted'}). ${info.response ?? ''}`.trim());
    const response = `Accepted for ${accepted.join(', ')}${rejected.length ? `; refused ${rejected.join(', ')}` : ''}. Server said: ${info.response ?? 'no reply'}`.slice(0, 300);
    await prisma.emailLog.update({ where: { id: row.id }, data: { status: 'sent', sentAt: new Date(), error: null, response } });
  } catch (err) {
    await prisma.emailLog.update({ where: { id: row.id }, data: { status: 'failed', error: explainMailError(err).slice(0, 300) } });
    throw err;
  }
});
