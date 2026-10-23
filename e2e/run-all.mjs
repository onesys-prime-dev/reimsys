// Runs every automatic check in turn and prints one summary: typecheck, unit tests, then the API checks and the browser checks.
// Needs the API (4000) and web app (5173) running. Start the API with RATE_LIMIT_OFF=1 (development only) so repeated sign-ins are not refused;
// the two checks that look for the rate limit itself (password-links, security) are skipped in this run, and pass when you run them alone on a normal API.
// It adds some test records and test users while it runs, so use it on a development copy, never on live data.
// Usage: node e2e/run-all.mjs [--quick]   (--quick skips the slowest browser checks)
import { spawnSync } from 'node:child_process';

const quick = process.argv.includes('--quick');
const STEPS = [
  ['typecheck', 'pnpm', ['typecheck']],
  ['unit tests', 'pnpm', ['test']],
  // API
  ...['api-flow', 'privacy-flow', 'profile-flow', 'payment-flow', 'return-issues-flow', 'client-form', 'password-links', 'realtime-api', 'session', 'security', 'reminders', 'list-total', 'retention', 'mail-check', 'blank-text', 'friendly-error'].map((n) => [n, 'node', [`e2e/${n}.mjs`]]),
  // browser
  ...['ui-flow', 'blank-ui', 'error-toast', 'guide-loading', 'privacy-ui', 'privacy-settings-ui', 'profile-ui', 'password-eye', 'access-tabs', 'help-ui', 'payment-ui', 'return-ui', 'scan-ui', 'scan-live', 'zoom-ui', 'scan-scroll', 'phone-fixes', 'settings-input', 'profile-photo', 'role-sweep', ...(quick ? [] : ['dark-sweep', 'client-form-ui', 'more-proof-ui', 'guide-ui'])].map((n) => [n, 'node', [`e2e/${n}.mjs`]]),
];
const results = [];
for (const [name, cmd, args] of STEPS) {
  const t0 = Date.now();
  const r = spawnSync(cmd, args, { env: { ...process.env, RATE_LIMIT_OFF: '1' }, encoding: 'utf8', shell: process.platform === 'win32', timeout: 480_000, maxBuffer: 1 << 26 });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const ok = r.status === 0 && !r.error;
  const secs = Math.round((Date.now() - t0) / 1000);
  results.push({ name, ok, secs, tail: out.split('\n').filter((l) => /FAIL|FAILED|Error|passed|All |problems|Tests |low-contrast/.test(l)).slice(-4).join(' | ').slice(0, 220) });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(20)} ${String(secs).padStart(4)}s  ${ok ? '' : results.at(-1).tail}`);
}
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length} of ${results.length} checks passed${bad.length ? `. Not passed: ${bad.map((b) => b.name).join(', ')}` : '.'}`);
process.exit(bad.length ? 1 : 0);
