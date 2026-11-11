import { NotificationKind, NotificationStatus, UserRole } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { recordAudit } from "../audit/audit.js";
import { prisma } from "../db/prisma.js";
import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../http/async-handler.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { getNotificationDispatcher, triggerNotificationDispatch } from "./runtime.js";

export const notificationQuerySchema = z.object({
  status: z.nativeEnum(NotificationStatus).optional(),
  kind: z.nativeEnum(NotificationKind).optional(),
  channelId: z.string().uuid().optional(),
  incidentId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
}).strict();

const recipientEmailSchema = z.string().trim().email().max(254).transform((email) => email.toLowerCase());
const recipientNameSchema = z.string().trim().min(2).max(120);

export const createRecipientSchema = z.object({
  email: recipientEmailSchema,
  name: recipientNameSchema.optional(),
  notifyDown: z.boolean().default(true),
  notifyRecovery: z.boolean().default(true),
}).strict();

export const updateRecipientSchema = z.object({
  name: recipientNameSchema.nullable().optional(),
  active: z.boolean().optional(),
  notifyDown: z.boolean().optional(),
  notifyRecovery: z.boolean().optional(),
}).strict().refine(
  (value) => Object.keys(value).length > 0,
  { message: "Incluye al menos un campo para actualizar" },
);

const idSchema = z.string().uuid();
const technicalRoles = [UserRole.ADMIN, UserRole.OPERATOR];
const router = Router();
router.use(requireAuth);
router.use(requireRole(technicalRoles, "No tienes permiso para consultar notificaciones"));

router.get(
  "/recipients",
  asyncHandler(async (_request, response) => {
    const recipients = await prisma.notificationRecipient.findMany({
      orderBy: [{ active: "desc" }, { email: "asc" }],
    });
    response.status(200).json({ data: { recipients } });
  }),
);

router.post(
  "/recipients",
  requireRole([UserRole.ADMIN], "Solo ADMIN puede gestionar destinatarios"),
  asyncHandler(async (request, response) => {
    const input = createRecipientSchema.parse(request.body);
    const recipient = await prisma.notificationRecipient.create({ data: input });
    await recordAudit(request, {
      action: "recipient.create",
      entityType: "notification_recipient",
      entityId: recipient.id,
      summary: `Agregó el destinatario de alertas ${recipient.email}`,
    });
    response.status(201).json({ data: { recipient } });
  }),
);

router.patch(
  "/recipients/:id",
  requireRole([UserRole.ADMIN], "Solo ADMIN puede gestionar destinatarios"),
  asyncHandler(async (request, response) => {
    const id = idSchema.parse(request.params.id);
    const input = updateRecipientSchema.parse(request.body);
    const recipient = await prisma.notificationRecipient.update({ where: { id }, data: input });
    await recordAudit(request, {
      action: "recipient.update",
      entityType: "notification_recipient",
      entityId: id,
      summary: `Modificó el destinatario ${recipient.email}: ${Object.entries(input).map(([key, value]) => `${key}=${value}`).join(", ")}`,
    });
    response.status(200).json({ data: { recipient } });
  }),
);

router.get(
  "/",
  asyncHandler(async (request, response) => {
    const filters = notificationQuerySchema.parse(request.query);
    const notifications = await prisma.notification.findMany({
      where: {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.kind ? { kind: filters.kind } : {}),
        ...(filters.channelId ? { channelId: filters.channelId } : {}),
        ...(filters.incidentId ? { incidentId: filters.incidentId } : {}),
      },
      include: {
        channel: { select: { id: true, code: true, name: true } },
        incident: { select: { id: true, status: true, detectedAt: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: filters.limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    });
    const hasMore = notifications.length > filters.limit;
    const page = hasMore ? notifications.slice(0, filters.limit) : notifications;
    response.status(200).json({
      data: {
        notifications: page,
        nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
        driver: getNotificationDispatcher().driver,
      },
    });
  }),
);

router.post(
  "/:id/retry",
  asyncHandler(async (request, response) => {
    const id = idSchema.parse(request.params.id);
    const notification = await prisma.notification.findUnique({
      where: { id },
      select: { attempts: true },
    });
    if (!notification) {
      throw new AppError("Notificación no encontrada", 404);
    }
    const requeued = await prisma.notification.updateMany({
      where: { id, status: NotificationStatus.FAILED },
      data: {
        status: NotificationStatus.PENDING,
        maxAttempts: notification.attempts + 1,
        nextAttemptAt: new Date(),
      },
    });
    if (requeued.count !== 1) {
      throw new AppError("Solo se pueden reintentar notificaciones fallidas", 409);
    }
    await recordAudit(request, {
      action: "notification.retry",
      entityType: "notification",
      entityId: id,
      summary: `Reprogramó el envío fallido de la notificación ${id.slice(0, 8)}`,
    });
    triggerNotificationDispatch();
    const updated = await prisma.notification.findUniqueOrThrow({ where: { id } });
    response.status(202).json({ data: { notification: updated } });
  }),
);

export { router as notificationsRouter };
