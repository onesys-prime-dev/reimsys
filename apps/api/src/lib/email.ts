import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { enqueue, registerJob } from './jobs.js';

const transport = config.smtp
  ? nodemailer.createTransport({
      host: config.smtp.host, port: config.smtp.port, secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    })
  : null;

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
  if (!transport) {
    console.log(`[email not sent: SMTP is not configured] to=${row.toEmail} subject="${row.subject}"`);
    await prisma.emailLog.update({ where: { id: row.id }, data: { status: 'logged', error: 'SMTP is not configured' } });
    return;
  }
  try {
    await transport.sendMail({ from: config.mailFrom, to: row.toEmail, subject: row.subject, html: row.body });
    await prisma.emailLog.update({ where: { id: row.id }, data: { status: 'sent', sentAt: new Date(), error: null } });
  } catch (err) {
    await prisma.emailLog.update({ where: { id: row.id }, data: { status: 'failed', error: (err instanceof Error ? err.message : String(err)).slice(0, 300) } });
    throw err;
  }
});
