import dns from 'node:dns/promises';
import net from 'node:net';
import { explainMailError, transportFor } from './email.js';
import { resolveMail } from './mailSettings.js';

/** One line of the mail check: what was tried, whether it worked, and what to do when it did not. */
export interface MailStep { id: 'account' | 'key' | 'name' | 'ports' | 'login'; label: string; state: 'ok' | 'fail' | 'skipped'; detail: string; fix?: string }
export interface MailDiagnosis { ok: boolean; steps: MailStep[] }

export interface PortResult { port: number; ok: boolean; why?: string; ms: number }
/** Can this computer open a connection to host:port? Hosting providers often block mail ports, so this is its own step. */
export const reachPort = (host: string, port: number, timeoutMs = 6000) => new Promise<PortResult>((resolve) => {
  const t0 = Date.now();
  const s = net.connect({ host, port, timeout: timeoutMs });
  s.once('connect', () => { s.destroy(); resolve({ port, ok: true, ms: Date.now() - t0 }); });
  s.once('timeout', () => { s.destroy(); resolve({ port, ok: false, why: `no answer in ${Math.round(timeoutMs / 1000)} seconds (usually a firewall dropping it)`, ms: Date.now() - t0 }); });
  s.once('error', (e: NodeJS.ErrnoException) => resolve({ port, ok: false, why: e.code === 'ECONNREFUSED' ? 'refused' : e.code ?? e.message, ms: Date.now() - t0 }));
});

/**
 * Finds out, step by step, why email might not go out from THIS server. Sends nothing. Used by the Email settings page ("Run full check")
 * and by `pnpm --filter @reimsys/api mail:check`.
 */
export async function diagnoseMail(): Promise<MailDiagnosis> {
  const steps: MailStep[] = [];
  const done = () => ({ ok: steps.every((s) => s.state !== 'fail'), steps });
  const skip = (ids: MailStep['id'][], labels: Record<string, string>) => { for (const id of ids) steps.push({ id, label: labels[id]!, state: 'skipped', detail: 'Not checked because an earlier step failed.' }); };
  const L = { account: 'A mail account is set up', key: 'The saved password can be unlocked on this server', name: 'The mail server’s name is found', ports: 'This server can reach the mail ports', login: 'The mail server accepts the login' };

  const mail = await resolveMail();
  if (mail.source === 'none' || !mail.smtp) {
    steps.push({ id: 'account', label: L.account, state: 'fail', detail: 'No mail account is set up on this server.', fix: 'In the app open Access, then Email, fill in the form and press Save. The account is stored in the database, so a new server starts without one.' });
    skip(['key', 'name', 'ports', 'login'], L);
    return done();
  }
  steps.push({ id: 'account', label: L.account, state: 'ok', detail: `${mail.source === 'database' ? 'Saved in the app' : 'From the server settings'}: ${mail.smtp.host}:${mail.smtp.port}${mail.smtp.secure ? ' (secure)' : ''}, user ${mail.smtp.user ?? '(none)'}.${mail.redirectTo ? ` Test mode is on: every email goes to ${mail.redirectTo}.` : ''}` });

  if (mail.passwordUnreadable) {
    steps.push({ id: 'key', label: L.key, state: 'fail', detail: 'A password is saved, but this server does not have the key it was locked with.', fix: 'In the app open Access, then Email, type the mail password again and press Save. Set SETTINGS_KEY in the server settings first so it survives the next move.' });
    skip(['name', 'ports', 'login'], L);
    return done();
  }
  steps.push({ id: 'key', label: L.key, state: 'ok', detail: mail.smtp.user ? (mail.smtp.pass ? 'The password can be read.' : 'A username is set but there is no password.') : 'No login is needed for this mail server.' });
  if (mail.smtp.user && !mail.smtp.pass) steps[steps.length - 1] = { ...steps[steps.length - 1]!, state: 'fail', fix: 'In the app open Access, then Email, type the mail password and press Save.' };

  let addrs: string[] = [];
  try {
    addrs = (await dns.lookup(mail.smtp.host, { all: true })).map((a) => a.address);
    steps.push({ id: 'name', label: L.name, state: 'ok', detail: `${mail.smtp.host} is at ${addrs.join(', ')}.` });
  } catch (e) {
    steps.push({ id: 'name', label: L.name, state: 'fail', detail: `The name ${mail.smtp.host} was not found from this server (${(e as NodeJS.ErrnoException).code ?? 'error'}).`, fix: 'Check the spelling of the server address, and that this server can look up names.' });
    skip(['ports', 'login'], L);
    return done();
  }

  const ports = [...new Set([mail.smtp.port, 587, 465, 2525])];
  const results = await Promise.all(ports.map((p) => reachPort(mail.smtp!.host, p)));
  const open = results.filter((r) => r.ok).map((r) => r.port);
  const list = results.map((r) => `${r.port}: ${r.ok ? `reachable (${r.ms} ms)` : r.why}`).join('; ');
  if (open.includes(mail.smtp.port)) steps.push({ id: 'ports', label: L.ports, state: 'ok', detail: list });
  else steps.push({
    id: 'ports', label: L.ports, state: 'fail', detail: `The saved port ${mail.smtp.port} cannot be reached from this server. ${list}.`,
    fix: open.length
      ? `Port ${open.join(' or ')} works from here. Use it instead in Access, then Email (587 = secure connection off, 465 = secure connection on) and Save.`
      : 'Every mail port is blocked from this server. Ask your hosting provider to allow outgoing mail, or use a mail service that works over port 2525 or the web (Brevo, Mailgun, SendGrid, Amazon SES).',
  });
  if (!open.includes(mail.smtp.port) && !open.length) { skip(['login'], L); return done(); }

  try {
    await transportFor(mail.smtp).verify();
    steps.push({ id: 'login', label: L.login, state: 'ok', detail: 'Connected and signed in. Nothing was sent.' });
  } catch (e) {
    steps.push({ id: 'login', label: L.login, state: 'fail', detail: explainMailError(e), fix: 'Fix the username, password, port or secure setting in Access, then Email, Save, and run the check again.' });
  }
  return done();
}
