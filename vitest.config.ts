import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    env: { DATABASE_URL: 'mysql://root:@localhost:3306/reimsis_test' },
  },
});
