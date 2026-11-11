import type { Prisma, PrismaClient } from "@prisma/client";
import type { Request } from "express";
import { prisma } from "../db/prisma.js";

export type AuditEntry = {
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  details?: Prisma.InputJsonValue;
  /** Solo cuando no hay sesión, por ejemplo un inicio de sesión fallido. */
  actor?: { id?: string; email: string; role?: string };
};

type AuditRepository = Pick<PrismaClient, "auditLog"> | Prisma.TransactionClient;

/** Registra una acción en la bitácora; el actor y la IP salen de la sesión de la solicitud. */
export async function recordAudit(
  request: Request | null,
  entry: AuditEntry,
  database: AuditRepository = prisma,
): Promise<void> {
  const actor = request?.auth
    ? { id: request.auth.userId, email: request.auth.email, role: request.auth.role }
    : entry.actor;
  await database.auditLog.create({
    data: {
      actorId: actor?.id ?? null,
      actorEmail: actor?.email ?? null,
      actorRole: actor?.role ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      summary: entry.summary.slice(0, 500),
      details: entry.details,
      ip: request?.ip?.slice(0, 64) ?? null,
    },
  });
}
