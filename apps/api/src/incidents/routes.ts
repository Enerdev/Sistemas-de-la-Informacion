import { IncidentSeverity, IncidentStatus, UserRole } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../http/async-handler.js";
import { requireAuth } from "../auth/middleware.js";
import { transitionIncident } from "./lifecycle.js";

export const incidentQuerySchema = z.object({
  channelId: z.string().uuid().optional(),
  status: z.nativeEnum(IncidentStatus).optional(),
  severity: z.nativeEnum(IncidentSeverity).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
}).strict().refine(
  ({ from, to }) => !from || !to || Date.parse(from) <= Date.parse(to),
  { message: "from debe ser anterior o igual a to" },
);

export const incidentTransitionSchema = z.object({
  status: z.nativeEnum(IncidentStatus),
  comment: z.string().trim().max(500).optional(),
}).strict();

const idSchema = z.string().uuid();
const router = Router();
router.use(requireAuth);

router.get(
  "/",
  asyncHandler(async (request, response) => {
    const filters = incidentQuerySchema.parse(request.query);
    const incidents = await prisma.incident.findMany({
      where: {
        ...(filters.channelId ? { channelId: filters.channelId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.severity ? { severity: filters.severity } : {}),
        ...(filters.from || filters.to
          ? {
              detectedAt: {
                ...(filters.from ? { gte: new Date(filters.from) } : {}),
                ...(filters.to ? { lte: new Date(filters.to) } : {}),
              },
            }
          : {}),
      },
      include: {
        channel: { select: { id: true, code: true, name: true, currentStatus: true } },
        detectionCheck: true,
      },
      orderBy: [{ detectedAt: "desc" }, { id: "desc" }],
      take: filters.limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    });
    const hasMore = incidents.length > filters.limit;
    const page = hasMore ? incidents.slice(0, filters.limit) : incidents;
    response.status(200).json({
      data: {
        incidents: page,
        nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
      },
    });
  }),
);

router.get(
  "/:id",
  asyncHandler(async (request, response) => {
    const id = idSchema.parse(request.params.id);
    const incident = await prisma.incident.findUnique({
      where: { id },
      include: {
        channel: true,
        detectionCheck: true,
        events: {
          include: {
            actor: { select: { id: true, email: true, role: true } },
            check: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!incident) {
      throw new AppError("Incidencia no encontrada", 404);
    }
    response.status(200).json({ data: { incident } });
  }),
);

router.patch(
  "/:id/status",
  asyncHandler(async (request, response) => {
    const id = idSchema.parse(request.params.id);
    const input = incidentTransitionSchema.parse(request.body);
    const actor = request.auth;
    if (!actor) {
      throw new AppError("Autenticación requerida", 401);
    }
    if (actor.role === UserRole.VIEWER) {
      throw new AppError("No tienes permiso para gestionar incidencias", 403);
    }
    const incident = await transitionIncident(prisma, {
      incidentId: id,
      nextStatus: input.status,
      actor: { userId: actor.userId, role: actor.role },
      note: input.comment,
    });
    response.status(200).json({ data: { incident } });
  }),
);

export { router as incidentsRouter };
