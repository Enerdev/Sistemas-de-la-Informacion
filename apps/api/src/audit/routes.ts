import { UserRole } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { asyncHandler } from "../http/async-handler.js";
import { requireAuth, requireRole } from "../auth/middleware.js";

export const auditQuerySchema = z.object({
  action: z.string().trim().max(60).optional(),
  entityType: z.string().trim().max(40).optional(),
  actor: z.string().trim().max(254).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional(),
}).strict();

const router = Router();
router.use(requireAuth);
router.use(requireRole([UserRole.ADMIN], "Solo ADMIN puede consultar la bitácora de auditoría"));

router.get(
  "/",
  asyncHandler(async (request, response) => {
    const filters = auditQuerySchema.parse(request.query);
    const entries = await prisma.auditLog.findMany({
      where: {
        ...(filters.action ? { action: { startsWith: filters.action } } : {}),
        ...(filters.entityType ? { entityType: filters.entityType } : {}),
        ...(filters.actor ? { actorEmail: { contains: filters.actor.toLowerCase() } } : {}),
        ...(filters.from || filters.to
          ? {
              createdAt: {
                ...(filters.from ? { gte: new Date(filters.from) } : {}),
                ...(filters.to ? { lte: new Date(filters.to) } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: filters.limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    });
    const hasMore = entries.length > filters.limit;
    const page = hasMore ? entries.slice(0, filters.limit) : entries;
    response.status(200).json({ data: { entries: page, nextCursor: hasMore ? page.at(-1)?.id ?? null : null } });
  }),
);

export { router as auditRouter };
