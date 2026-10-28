import { PrismaClient } from '@prisma/client';
import { announceWrite } from './lib/realtime.js';

const base = new PrismaClient();

/**
 * The one database client the whole app uses. Every write is announced to the live-update hub afterwards, so no screen
 * has to be wired up by hand and a new feature is live automatically.
 */
export const prisma = base.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const result = await query(args);
        announceWrite(model, operation, args);
        return result;
      },
    },
  },
}); 

/** The database handle inside `prisma.$transaction(async (tx) => ...)`. */
export type Tx = Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;
