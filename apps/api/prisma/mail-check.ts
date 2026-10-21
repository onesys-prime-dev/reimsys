/**
 * Finds out why email does not send from THIS computer or server. Run it on the server that has the problem:
 *   pnpm --filter @reimsys/api mail:check                    checks everything, sends nothing
 *   pnpm --filter @reimsys/api mail:check -- --to you@x.com  also sends one real test message
 * The same checks run from the app (Access → Email → Run full check): the saved account, whether its password can be unlocked here, whether the
 * server's name is found, whether the mail ports can be reached from here (hosts often block them), and whether the login is accepted.
 */
import { config } from '../src/config.js';
import { prisma } from '../src/db.js';
import { buildMessage, explainMailError, transportFor } from '../src/lib/email.js';
import { diagnoseMail } from '../src/lib/mailDiagnose.js';
import { resolveMail } from '../src/lib/mailSettings.js';

const arg = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
let problems = 0;

async function main() {
  console.log(`Mail check on this server (${config.isProd ? 'production' : 'development'} mode, public address ${config.webOrigin})\n`);
  const { steps } = await diagnoseMail();
  for (const [i, s] of steps.entries()) {
    console.log(`${i + 1}. ${s.label}`);
    console.log(`  ${s.state === 'ok' ? 'ok   ' : s.state === 'fail' ? 'FAIL ' : 'skip '} ${s.detail}`);
    if (s.fix) console.log(`        → ${s.fix}`);
    if (s.state === 'fail') problems++;
  }
  const to = arg('--to');
  if (!to) { console.log('\n(Add  -- --to you@example.org  to also send one real test message.)'); return; }
  if (problems) { console.log('\nNo test message was sent because a step above failed.'); return; }
  const mail = await resolveMail();
  console.log(`\nSending one real test message to ${to}`);
  try {
    const info = await transportFor(mail.smtp!).sendMail(buildMessage({ id: 0, from: mail.from, to, subject: 'REIMSYS mail check', html: '<p>This message was sent by <b>mail:check</b> from the server to prove email works from here.</p>' }));
    const accepted = (info.accepted ?? []).map(String);
    if (accepted.length) console.log(`  ok    The mail server accepted it for ${accepted.join(', ')}: ${info.response ?? ''}. If it does not arrive, look in the spam folder.`);
    else { console.log(`  FAIL  The mail server refused every recipient. ${info.response ?? ''}`); problems++; }
  } catch (e) { console.log('  FAIL  ' + explainMailError(e)); problems++; }
}

main().catch((e) => { console.error('Unexpected error:', e); problems++; }).finally(async () => {
  await prisma.$disconnect();
  console.log(problems ? `\n${problems} problem(s) found. Fix the first FAIL above and run this again.` : '\nNothing wrong found.');
  process.exit(problems ? 1 : 0);
});
