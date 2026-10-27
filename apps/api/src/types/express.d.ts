import type { UserRole } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        email: string;
        role: UserRole;
      };
    }
  }
}

export {};
