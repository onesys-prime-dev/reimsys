import { execSync } from 'node:child_process';

/**
 * Which version of the code this server is running, and when it started. Lets anyone see that a new version was really deployed and the
 * server restarted (a server running old code next to a new web page is the usual cause of "Not found." on a new button).
 * The commit comes from BUILD_COMMIT (set by the deploy) or from git; it is "unknown" when neither is available.
 */
const commit = (): string => {
  const fromEnv = process.env.BUILD_COMMIT?.trim();
  if (fromEnv) return fromEnv.slice(0, 7);
  try { return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).toString().trim() || 'unknown'; } catch { return 'unknown'; }
};

export const buildInfo = { commit: commit(), startedAt: new Date().toISOString() };
