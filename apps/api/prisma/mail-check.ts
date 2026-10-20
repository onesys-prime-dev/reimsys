/**
 * Finds out why email does not send from THIS computer or server. Run it on the server that has the problem:
 *   pnpm --filter @reimsys/api mail:check                    checks everything, sends nothing
 *   pnpm --filter @reimsys/api mail:check -- --to you@x.com  also sends one real test message
 * It looks at: the saved mail account, whether its password can be unlocked here, whether the server's name is found, whether the mail
 * ports can be reached from here (hosts often block them), whether the mail server accepts the login, and (with --to) a real send.
 */
import dns from 'node:dns/promises';
import net from 'node:net';
import { config } from '../src/config.js';
import { prisma } from '../src/db.js';
import { buildMessage, explainMailError, transportFor } from '../src/lib/email.js';
import { resolveMail } from '../src/lib/mailSettings.js';

const arg = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const ok = (m: string) => console.log('  ok    ' + m);
const bad = (m: string, fix?: string) => { console.log('  FAIL  ' + m); if (fix) console.log('        → ' + fix); problems++; };
let problems = 0;

const reach = (host: string, port: number) => new Promise<{ ok: boolean; why?: string; ms: number }>((resolve) => {
  const t0 = Date.now();
  const s = net.connect({ host, port, timeout: 7000 });
  s.once('connect', () => { s.destroy(); resolve({ ok: true, ms: Date.now() - t0 }); });
  s.once('timeout', () => { s.destroy(); resolve({ ok: false, why: 'no answer in 7 seconds (usually a firewall dropping it)', ms: Date.now() - t0 }); });
  s.once('error', (e: NodeJS.ErrnoException) => resolve({ ok: false, why: e.code === 'ECONNREFUSED' ? 'refused' : e.code ?? e.message, ms: Date.now() - t0 }));
});

async function main() {
  console.log(`Mail check on this server (${config.isProd ? 'production' : 'development'} mode, public address ${config.webOrigin})\n`);
  const mail = await resolveMail();
  console.log('1. The mail account');
  if (mail.source === 'none' || !mail.smtp) {
    bad('No mail account is set up on this server.', 'Open the app, then Access → Email, enter the account and Save (or put SMTP_HOST, SMTP_USER and SMTP_PASS in apps/api/.env). The account lives in the database, so a new server starts without one.');
    return;
  }
  ok(`${mail.source === 'database' ? 'Saved in the app' : 'From .env'}: ${mail.smtp.host}:${mail.smtp.port}${mail.smtp.secure ? ' (secure)' : ''}, user ${mail.smtp.user ?? '(none)'}, sends as ${mail.from}`);
  if (mail.redirectTo) console.log(`  note  Test mode is ON: every email goes to ${mail.redirectTo} instead of the real person.`);
  if (mail.passwordUnreadable) { bad('A password is saved but this server cannot unlock it.', 'The key that locked it is missing here. Open Access → Email, type the mail password again and Save. Set SETTINGS_KEY in .env first so it survives the next move.'); return; }
  if (mail.smtp.user && !mail.smtp.pass) bad('A username is set but there is no password.', 'Enter the password in Access → Email.');
  else ok(mail.smtp.user ? 'The password can be read on this server' : 'No login is needed for this mail server');

  console.log('\n2. Finding the mail server');
  let addrs: string[] = [];
  try { addrs = (await dns.lookup(mail.smtp.host, { all: true })).map((a) => a.address); ok(`${mail.smtp.host} is at ${addrs.join(', ')}`); }
  catch (e) { bad(`The name ${mail.smtp.host} was not found from this server (${(e as NodeJS.ErrnoException).code}).`, 'Check the spelling, and that this server can look up names (try: nslookup ' + mail.smtp.host + ').'); return; }

  console.log('\n3. Can this server reach the mail ports? (hosting providers often block them)');
  const ports = [...new Set([mail.smtp.port, 587, 465, 2525, 25])];
  const open: number[] = [];
  for (const p of ports) {
    const r = await reach(mail.smtp.host, p);
    if (r.ok) { ok(`port ${p} is reachable (${r.ms} ms)`); open.push(p); }
    else console.log(`  --    port ${p}: ${r.why}`);
  }
  if (!open.includes(mail.smtp.port)) {
    bad(`The configured port ${mail.smtp.port} cannot be reached from this server.`,
      open.length ? `Port ${open.join(' or ')} works from here. Use it instead (587 = secure connection OFF, 465 = secure connection ON), in Access → Email.`
        : 'Every mail port is blocked from this server. Ask your hosting provider to open outgoing SMTP (many block it by default on new accounts), or use a mail service that sends over HTTPS or port 2525, such as Brevo, Mailgun, SendGrid or Amazon SES.');
    if (!open.length) return;
  }

  console.log('\n4. Does the mail server accept the login?');
  try { await transportFor(mail.smtp).verify(); ok('Connected and signed in'); }
  catch (e) { bad(explainMailError(e)); }

  const to = arg('--to');
  if (to) {
    console.log(`\n5. Sending one real test message to ${to}`);
    try {
      const info = await transportFor(mail.smtp).sendMail(buildMessage({ id: 0, from: mail.from, to, subject: 'REIMSYS mail check', html: '<p>This message was sent by <b>mail:check</b> from the server to prove email works from here.</p>' }));
      const accepted = (info.accepted ?? []).map(String);
      if (accepted.length) ok(`The mail server accepted it for ${accepted.join(', ')}: ${info.response ?? ''}. If it does not arrive, look in the spam folder.`);
      else bad(`The mail server refused every recipient. ${info.response ?? ''}`);
    } catch (e) { bad(explainMailError(e)); }
  } else console.log('\n(Add  -- --to you@example.org  to also send one real test message.)');
}

main().catch((e) => { console.error('Unexpected error:', e); problems++; }).finally(async () => {
  await prisma.$disconnect();
  console.log(problems ? `\n${problems} problem(s) found. Fix the first FAIL above and run this again.` : '\nNothing wrong found.');
  process.exit(problems ? 1 : 0);
});
