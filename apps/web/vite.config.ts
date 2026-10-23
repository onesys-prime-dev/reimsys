import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

/** The commit this web build was made from (BUILD_COMMIT from the deploy, or git), shown on the Help page next to the server's. */
const commit = (() => {
  if (process.env.BUILD_COMMIT?.trim()) return process.env.BUILD_COMMIT.trim().slice(0, 7);
  try { return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'unknown'; } catch { return 'unknown'; }
})();

export default defineConfig({
  plugins: [react()],
  define: { __WEB_BUILD__: JSON.stringify({ commit, builtAt: new Date().toISOString() }) },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: false } },
  },
});
