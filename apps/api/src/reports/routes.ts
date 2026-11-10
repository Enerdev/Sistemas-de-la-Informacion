import { FailureReportStatus, UserRole } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../http/async-handler.js";
import { getAuthenticatedUser, requireAuth, requireRole } from "../auth/middleware.js";

export const failureReportQuerySchema = z.object({
  status: z.nativeEnum(FailureReportStatus).optional(),
  channelId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
}).strict();

export const reviewFailureReportSchema = z.object({
  status: z.enum([FailureReportStatus.REVIEWED, FailureReportStatus.LINKED, FailureReportStatus.DISMISSED]),
  incidentId: z.string().uuid().optional(),
  note: z.string().trim().max(500).optional(),
}).strict().refine(
  ({ status, incidentId }) => (status === FailureReportStatus.LINKED) === Boolean(incidentId),
  { message: "Indica una incidencia solo al vincular el reporte", path: ["incidentId"] },
);

const idSchema = z.string().uuid();
const router = Router();
router.use(requireAuth);
router.use(requireRole([UserRole.ADMIN, UserRole.OPERATOR], "No tienes permiso para gestionar reportes ciudadanos"));

router.get(
  "/",
  asyncHandler(async (request, response) => {
    const filters = failureReportQuerySchema.parse(request.query);
    const reports = await prisma.failureReport.findMany({
      where: {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.channelId ? { channelId: filters.channelId } : {}),
      },
      include: {
        channel: { select: { id: true, code: true, name: true, currentStatus: true } },
        incident: { select: { id: true, status: true, summary: true, detectedAt: true } },
        reviewedBy: { select: { email: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: filters.limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    });
    const hasMore = reports.length > filters.limit;
    const page = hasMore ? reports.slice(0, filters.limit) : reports;
    response.status(200).json({
      data: { reports: page, nextCursor: hasMore ? page.at(-1)?.id ?? null : null },
    });
  }),
);

router.patch(
  "/:id",
  asyncHandler(async (request, response) => {
    const id = idSchema.parse(request.params.id);
    const input = reviewFailureReportSchema.parse(request.body);
    const actor = getAuthenticatedUser(request);

    const report = await prisma.failureReport.findUnique({ where: { id }, select: { channelId: true } });
    if (!report) {
      throw new AppError("Reporte no encontrado", 404);
    }
    if (input.incidentId) {
      const incident = await prisma.incident.findUnique({
        where: { id: input.incidentId },
        select: { channelId: true },
      });
      if (!incident) {
        throw new AppError("Incidencia no encontrada", 404);
      }
      if (incident.channelId !== report.channelId) {
        throw new AppError("La incidencia pertenece a otro canal", 409);
      }
    }

    const updated = await prisma.failureReport.update({
      where: { id },
      data: {
        status: input.status,
        incidentId: input.incidentId ?? null,
        reviewNote: input.note || null,
        reviewedAt: new Date(),
        reviewedById: actor.userId,
      },
      include: {
        channel: { select: { id: true, code: true, name: true, currentStatus: true } },
        incident: { select: { id: true, status: true, summary: true, detectedAt: true } },
        reviewedBy: { select: { email: true } },
      },
    });
    response.status(200).json({ data: { report: updated } });
  }),
);

export { router as failureReportsRouter };
