import type { Role, Session, User } from '@prisma/client';

export interface AuthContext {
  user: User & { role: Role };
  session: Session;
  permissions: Set<string>;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}
