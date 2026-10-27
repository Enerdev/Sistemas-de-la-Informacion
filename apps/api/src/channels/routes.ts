import { Router } from "express";
import { ChannelStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../http/async-handler.js";
import { requireAuth, requireChannelWritePermission } from "../auth/middleware.js";
import { runManualMonitoringCheck } from "../monitoring/runtime.js";
import {
  createChannelSchema,
  monitoringToggleSchema,
  updateMonitoringConfigSchema,
  updateChannelSchema,
} from "./schemas.js";

const idSchema = z.string().uuid();
const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().uuid().optional(),
}).strict();
const maintenanceStatusSchema = z.object({
  status: z.enum([ChannelStatus.UNKNOWN, ChannelStatus.MAINTENANCE]),
}).strict();
const router = Router();
router.use(requireAuth);

router.get(
  "/",
  asyncHandler(async (_request, response) => {
    const channels = await prisma.channel.findMany({
      include: {
        monitoringConfig: true,
        checks: { orderBy: { checkedAt: "desc" }, take: 1 },
      },
      orderBy: [{ name: "asc" }, { code: "asc" }],
    });
    response.status(200).json({ data: { channels } });
  }),
);

router.get(
  "/:id/checks",
  asyncHandler(async (request, response) => {
    const id = idSchema.parse(request.params.id);
    const { limit, cursor } = historyQuerySchema.parse(request.query);
    const channel = await prisma.channel.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!channel) {
      throw new AppError("Canal no encontrado", 404);
    }

    const checks = await prisma.channelCheck.findMany({
      where: { channelId: id },
      orderBy: { checkedAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = checks.length > limit;
    const page = hasMore ? checks.slice(0, limit) : checks;
    response.status(200).json({
      data: {
        checks: page,
        nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
      },
    });
  }),
);

router.post(
  "/:id/check",
  requireChannelWritePermission(),
  asyncHandler(async (request, response) => {
    const id = idSchema.parse(request.params.id);
    const check = await runManualMonitoringCheck(id);
    response.status(201).json({ data: { check } });
  }),
);

router.patch(
  "/:id/status",
  requireChannelWritePermission(),
  asyncHandler(async (request, response) => {
    const id = idSchema.parse(request.params.id);
    const { status } = maintenanceStatusSchema.parse(request.body);
    const channel = await prisma.$transaction(async (transaction) => {
      const existing = await transaction.channel.findUnique({
        where: { id },
        select: { currentStatus: true },
      });
      if (!existing) {
        throw new AppError("Canal no encontrado", 404);
      }
      const updated = await transaction.channel.update({
        where: { id },
        data: { currentStatus: status },
        include: { monitoringConfig: true },
      });
      if (existing.currentStatus !== status) {
        await transaction.channelStatusHistory.create({
          data: {
            channelId: id,
            previousStatus: existing.currentStatus,
            newStatus: status,
            source: "USER",
            actorId: request.auth?.userId,
          },
        });
      }
      return updated;
    });
    response.status(200).json({ data: { channel } });
  }),
);

router.get(
  "/:id",
  asyncHandler(async (request, response) => {
    const id = idSchema.parse(request.params.id);
    const channel = await prisma.channel.findUnique({
      where: { id },
      include: {
        monitoringConfig: true,
        checks: { orderBy: { checkedAt: "desc" }, take: 1 },
      },
    });
    if (!channel) {
      throw new AppError("Canal no encontrado", 404);
    }
    response.status(200).json({ data: { channel } });
  }),
);

router.post(
  "/",
  requireChannelWritePermission(),
  asyncHandler(async (request, response) => {
    const input = createChannelSchema.parse(request.body);
    const channel = await prisma.channel.create({
      data: {
        code: input.code,
        name: input.name,
        description: input.description,
        type: input.type,
        simulatedTarget: input.simulatedTarget,
        monitoringConfig: {
          create: input.monitoringConfig,
        },
      },
      include: { monitoringConfig: true },
    });
    response.status(201).json({ data: { channel } });
  }),
);

router.patch(
  "/:id",
  requireChannelWritePermission(),
  asyncHandler(async (request, response) => {
    const id = idSchema.parse(request.params.id);
    const input = updateChannelSchema.parse(request.body);
    const channel = await prisma.channel.update({
      where: { id },
      data: input,
      include: { monitoringConfig: true },
    });
    response.status(200).json({ data: { channel } });
  }),
);

router.patch(
  "/:id/monitoring",
  requireChannelWritePermission(),
  asyncHandler(async (request, response) => {
    const id = idSchema.parse(request.params.id);
    const input = monitoringToggleSchema.parse(request.body);
    const channel = await prisma.channel.update({
      where: { id },
      data: { monitoringEnabled: input.monitoringEnabled },
      include: { monitoringConfig: true },
    });
    response.status(200).json({ data: { channel } });
  }),
);

router.patch(
  "/:id/monitoring/config",
  requireChannelWritePermission(),
  asyncHandler(async (request, response) => {
    const id = idSchema.parse(request.params.id);
    const input = updateMonitoringConfigSchema.parse(request.body);
    const channelExists = await prisma.channel.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!channelExists) {
      throw new AppError("Canal no encontrado", 404);
    }

    const monitoringConfig = await prisma.monitoringConfig.upsert({
      where: { channelId: id },
      create: { channelId: id, ...input },
      update: input,
    });
    response.status(200).json({ data: { monitoringConfig } });
  }),
);

export { router as channelsRouter };
