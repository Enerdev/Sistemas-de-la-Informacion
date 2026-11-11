import express, { Router } from "express";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { recordAudit } from "../audit/audit.js";
import { prisma } from "../db/prisma.js";
import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../http/async-handler.js";
import { getAuthenticatedUser, requireAuth, requireRole } from "../auth/middleware.js";
import { parsePaymentSchedule } from "./csv.js";

const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Usa el formato AAAA-MM-DD");

export const scheduleQuerySchema = z.object({
  from: calendarDateSchema.optional(),
  to: calendarDateSchema.optional(),
}).strict();

export const scheduleImportSchema = z.object({
  fileName: z.string().trim().min(1).max(200).refine(
    (name) => name.toLowerCase().endsWith(".csv"),
    "El archivo debe tener extensión .csv",
  ),
  content: z.string().min(1, "El archivo está vacío").max(200_000, "El archivo supera 200 KB"),
}).strict();

const idSchema = z.string().uuid();
const router = Router();
// El CSV viaja como texto dentro de JSON, por eso esta ruta admite un cuerpo mayor que el resto de la API.
router.use(express.json({ limit: "256kb" }));
router.use(requireAuth);

router.get(
  "/",
  asyncHandler(async (request, response) => {
    const { from, to } = scheduleQuerySchema.parse(request.query);
    const [dates, imports] = await Promise.all([
      prisma.paymentDate.findMany({
        where: {
          date: {
            ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
            ...(to ? { lte: new Date(`${to}T00:00:00.000Z`) } : {}),
          },
        },
        orderBy: [{ date: "asc" }, { group: "asc" }],
        take: 500,
      }),
      prisma.paymentScheduleImport.findMany({
        orderBy: { importedAt: "desc" },
        take: 5,
        include: { importedBy: { select: { email: true } } },
      }),
    ]);
    response.status(200).json({
      data: {
        dates: dates.map((row) => ({ ...row, date: row.date.toISOString().slice(0, 10) })),
        imports,
      },
    });
  }),
);

router.post(
  "/import",
  requireRole([UserRole.ADMIN, UserRole.OPERATOR], "No tienes permiso para importar el cronograma"),
  asyncHandler(async (request, response) => {
    const input = scheduleImportSchema.parse(request.body);
    const { rows, errors } = parsePaymentSchedule(input.content);
    if (errors.length > 0) {
      throw new AppError(
        `El archivo tiene ${errors.length} ${errors.length === 1 ? "error" : "errores"}; no se importó ninguna fila`,
        422,
        errors.slice(0, 50).map(({ line, message }) => ({ field: `línea ${line}`, message })),
      );
    }

    const actor = getAuthenticatedUser(request);
    const summary = await prisma.$transaction(async (transaction) => {
      const existing = await transaction.paymentDate.findMany({
        where: { OR: rows.map(({ date, group }) => ({ date: new Date(`${date}T00:00:00.000Z`), group })) },
        select: { date: true, group: true },
      });
      const existingKeys = new Set(existing.map(({ date, group }) => `${date.toISOString().slice(0, 10)}|${group}`));
      const updatedCount = rows.filter(({ date, group }) => existingKeys.has(`${date}|${group}`)).length;
      const scheduleImport = await transaction.paymentScheduleImport.create({
        data: {
          fileName: input.fileName,
          rowCount: rows.length,
          createdCount: rows.length - updatedCount,
          updatedCount,
          importedById: actor.userId,
        },
      });
      for (const row of rows) {
        const date = new Date(`${row.date}T00:00:00.000Z`);
        await transaction.paymentDate.upsert({
          where: { date_group: { date, group: row.group } },
          create: { date, group: row.group, description: row.description, importId: scheduleImport.id },
          update: { description: row.description, importId: scheduleImport.id },
        });
      }
      await recordAudit(request, {
        action: "schedule.import",
        entityType: "payment_schedule_import",
        entityId: scheduleImport.id,
        summary: `Importó ${input.fileName}: ${rows.length} fechas (${rows.length - updatedCount} nuevas, ${updatedCount} actualizadas)`,
      }, transaction);
      return scheduleImport;
    }, { timeout: 30_000 });

    response.status(201).json({ data: { import: summary } });
  }),
);

router.delete(
  "/:id",
  requireRole([UserRole.ADMIN], "Solo ADMIN puede eliminar fechas del cronograma"),
  asyncHandler(async (request, response) => {
    const id = idSchema.parse(request.params.id);
    const removed = await prisma.paymentDate.delete({ where: { id } });
    await recordAudit(request, {
      action: "schedule.delete",
      entityType: "payment_date",
      entityId: id,
      summary: `Eliminó la fecha de pago ${removed.date.toISOString().slice(0, 10)} (${removed.group})`,
    });
    response.status(204).end();
  }),
);

export { router as paymentScheduleRouter };
