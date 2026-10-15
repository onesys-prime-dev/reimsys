import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEMO_EMAILS, DEMO_USERS, demoUsersToCreate } from '../prisma/demoUsers';

describe('demo accounts', () => {
  it('lists every seeded demo account, including the Accounting one', () => {
    expect(DEMO_EMAILS).toContain('accounting@example.com');
    expect(DEMO_EMAILS).toEqual(DEMO_USERS.map((u) => u.email));
  });
  it('are never created again once they have been switched off', () => {
    expect(demoUsersToCreate(false)).toEqual(DEMO_USERS);
    expect(demoUsersToCreate(true)).toEqual([]);
  });
  it('the switch-off script and the seed use the same list', () => {
    expect(fs.readFileSync(new URL('../prisma/retire-demo.ts', import.meta.url), 'utf8')).toMatch(/from '\.\/demoUsers\.js'/);
    expect(fs.readFileSync(new URL('../prisma/seed.ts', import.meta.url), 'utf8')).toMatch(/demoUsersToCreate\(/);
  });
});
