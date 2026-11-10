import { randomBytes } from "node:crypto";
import { IncidentStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../http/async-handler.js";
import { createRateLimit } from "../http/rate-limit.js";

const publicIncidentWindowMillis = 7 * 24 * 60 * 60 * 1000;
const maximumReportAgeMillis = 30 * 24 * 60 * 60 * 1000;
const futureToleranceMillis = 5 * 60 * 1000;
const activeStatuses = [IncidentStatus.OPEN, IncidentStatus.ACKNOWLEDGED, IncidentStatus.IN_PROGRESS];
const referenceAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function createFailureReportSchema(now: () => Date = () => new Date()) {
  return z.object({
    channelId: z.string().uuid({ message: "Selecciona un canal válido" }),
    description: z.string().trim()
      .min(10, "Describe la falla con al menos 10 caracteres")
      .max(1000, "La descripción admite hasta 1000 caracteres"),
    contactEmail: z.union([
      z.literal("").transform(() => undefined),
      z.string().trim().email("El correo de contacto no es válido").max(254)
        .transform((email) => email.toLowerCase()),
    ]).optional(),
    occurredAt: z.union([
      z.literal("").transform(() => undefined),
      z.string().datetime({ offset: true, message: "La fecha de la falla no es válida" })
        .transform((value) => new Date(value)),
    ]).optional()
      .refine(
        (date) => !date || date.getTime() <= now().getTime() + futureToleranceMillis,
        "La fecha de la falla no puede estar en el futuro",
      )
      .refine(
        (date) => !date || now().getTime() - date.getTime() <= maximumReportAgeMillis,
        "Solo se aceptan fallas ocurridas en los últimos 30 días",
      ),
    // Campo trampa: las personas no lo ven; los bots suelen completarlo.
    website: z.string().max(0, "Solicitud no válida").optional(),
  }).strict();
}

export function generateReferenceCode(): string {
  const bytes = randomBytes(8);
  return `R-${Array.from(bytes, (byte) => referenceAlphabet[byte % referenceAlphabet.length]).join("")}`;
}

const referenceSchema = z.string().trim().toUpperCase().regex(/^R-[A-Z2-9]{8}$/);
const router = Router();

router.get(
  "/status",
  asyncHandler(async (_request, response) => {
    const channels = await prisma.channel.findMany({
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
        currentStatus: true,
        updatedAt: true,
        checks: { orderBy: { checkedAt: "desc" }, take: 1, select: { checkedAt: true } },
      },
      orderBy: [{ name: "asc" }, { code: "asc" }],
    });
    response.status(200).json({
      data: {
        generatedAt: new Date().toISOString(),
        channels: channels.map(({ checks, ...channel }) => ({
          ...channel,
          lastCheckedAt: checks[0]?.checkedAt ?? null,
        })),
      },
    });
  }),
);

router.get(
  "/incidents",
  asyncHandler(async (_request, response) => {
    const since = new Date(Date.now() - publicIncidentWindowMillis);
    const incidents = await prisma.incident.findMany({
      where: { OR: [{ status: { in: activeStatuses } }, { detectedAt: { gte: since } }] },
      select: {
        id: true,
        status: true,
        severity: true,
        summary: true,
        detectedAt: true,
        recoveredAt: true,
        resolvedAt: true,
        closedAt: true,
        channel: { select: { code: true, name: true } },
      },
      orderBy: [{ detectedAt: "desc" }, { id: "desc" }],
      take: 20,
    });
    response.status(200).json({ data: { incidents } });
  }),
);

router.post(
  "/reports",
  createRateLimit({
    windowMillis: 15 * 60 * 1000,
    max: 5,
    message: "Recibimos varios reportes desde tu conexión. Intenta nuevamente en unos minutos.",
  }),
  asyncHandler(async (request, response) => {
    const { website: _website, ...input } = createFailureReportSchema().parse(request.body);
    const channel = await prisma.channel.findUnique({
      where: { id: input.channelId },
      select: { id: true, name: true },
    });
    if (!channel) {
      throw new AppError("Canal no encontrado", 404);
    }

    const report = await prisma.failureReport.create({
      data: { ...input, referenceCode: generateReferenceCode() },
      select: { referenceCode: true, status: true, createdAt: true },
    });
    response.status(201).json({ data: { report: { ...report, channel: { name: channel.name } } } });
  }),
);

router.get(
  "/reports/:referenceCode",
  createRateLimit({
    windowMillis: 15 * 60 * 1000,
    max: 30,
    message: "Demasiadas consultas desde tu conexión. Intenta nuevamente en unos minutos.",
  }),
  asyncHandler(async (request, response) => {
    const referenceCode = referenceSchema.parse(request.params.referenceCode);
    const report = await prisma.failureReport.findUnique({
      where: { referenceCode },
      select: {
        referenceCode: true,
        status: true,
        createdAt: true,
        reviewedAt: true,
        channel: { select: { name: true } },
        incident: { select: { status: true, summary: true, recoveredAt: true } },
      },
    });
    if (!report) {
      throw new AppError("No encontramos un reporte con ese código", 404);
    }
    response.status(200).json({ data: { report } });
  }),
);

export { router as publicRouter };
