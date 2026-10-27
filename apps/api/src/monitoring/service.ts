import { ChannelStatus } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { AppError } from "../errors/app-error.js";
import { classifyChannelStatus } from "./classification.js";
import type { CheckObservation, CheckResultRecord } from "./types.js";
import type { ServiceVerifier } from "./verifiers.js";
import { recordMonitoringIncident } from "../incidents/lifecycle.js";

const maximumThreshold = 20;

type CheckMode = "manual" | "scheduled";

type MonitoringRepository = Pick<PrismaClient, "$transaction" | "channel" | "channelCheck">;

export class MonitoringService {
  private readonly inFlightChannels = new Set<string>();

  constructor(
    private readonly verifier: ServiceVerifier,
    private readonly database: MonitoringRepository = prisma,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async runManualCheck(channelId: string): Promise<CheckResultRecord> {
    const result = await this.runCheck(channelId, "manual");
    if (result.kind === "skipped") {
      throw new AppError("El canal está en mantenimiento y no se verificó", 409);
    }
    return result.check;
  }

  async runScheduledCheck(channelId: string, scheduledAt: Date): Promise<CheckResultRecord | null> {
    const result = await this.runCheck(channelId, "scheduled", scheduledAt);
    return result.kind === "skipped" ? null : result.check;
  }

  async runDueChecks(): Promise<void> {
    const channels = await this.database.channel.findMany({
      where: {
        monitoringEnabled: true,
        currentStatus: { not: ChannelStatus.MAINTENANCE },
        monitoringConfig: { isNot: null },
      },
      include: {
        monitoringConfig: true,
        checks: { orderBy: { checkedAt: "desc" }, take: 1, select: { checkedAt: true } },
      },
    });
    const now = this.now();

    for (const channel of channels) {
      const config = channel.monitoringConfig;
      if (!config) continue;
      const lastCheckAt = channel.checks[0]?.checkedAt;
      const due = !lastCheckAt
        || now.getTime() - lastCheckAt.getTime() >= config.checkIntervalSeconds * 1000;
      if (!due) continue;

      try {
        await this.runScheduledCheck(channel.id, now);
      } catch (error) {
        console.error(
          "No se pudo ejecutar una verificación programada:",
          error instanceof Error ? error.name : "UnknownError",
        );
      }
    }
  }

  private async runCheck(
    channelId: string,
    mode: CheckMode,
    scheduledAt?: Date,
  ): Promise<{ kind: "checked"; check: CheckResultRecord } | { kind: "skipped" }> {
    if (this.inFlightChannels.has(channelId)) {
      throw new AppError("Ya hay una verificación en curso para este canal", 409);
    }

    this.inFlightChannels.add(channelId);
    try {
      const channel = await this.database.channel.findUnique({
        where: { id: channelId },
        include: {
          monitoringConfig: true,
          checks: {
            orderBy: { checkedAt: "desc" },
            take: maximumThreshold,
            select: { result: true },
          },
        },
      });

      if (!channel) {
        throw new AppError("Canal no encontrado", 404);
      }
      const monitoringConfig = channel.monitoringConfig;
      if (!monitoringConfig) {
        throw new AppError("El canal no tiene configuración de monitoreo", 409);
      }
      if (channel.currentStatus === ChannelStatus.MAINTENANCE) {
        return { kind: "skipped" };
      }
      if (mode === "scheduled") {
        if (!channel.monitoringEnabled) return { kind: "skipped" };
        const lastCheck = await this.database.channelCheck.findFirst({
          where: { channelId },
          orderBy: { checkedAt: "desc" },
          select: { checkedAt: true },
        });
        const checkedAt = scheduledAt ?? this.now();
        if (
          lastCheck
          && checkedAt.getTime() - lastCheck.checkedAt.getTime()
            < monitoringConfig.checkIntervalSeconds * 1000
        ) {
          return { kind: "skipped" };
        }
      }

      const observation = await this.verifier.verify(
        channel.simulatedTarget,
        monitoringConfig.timeoutMillis,
      );
      const checkedAt = scheduledAt ?? this.now();
      const check = await this.persistCheck(
        { id: channel.id, currentStatus: channel.currentStatus, monitoringConfig },
        observation,
        checkedAt,
      );

      return { kind: "checked", check };
    } finally {
      this.inFlightChannels.delete(channelId);
    }
  }

  private async persistCheck(
    channel: {
      id: string;
      currentStatus: ChannelStatus;
      monitoringConfig: {
        latencyWarningMillis: number;
        failureThreshold: number;
        recoveryThreshold: number;
      };
    },
    observation: CheckObservation,
    checkedAt: Date,
  ): Promise<CheckResultRecord> {
    return this.database.$transaction(async (transaction) => {
      await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "channels" WHERE "id" = ${channel.id}::uuid FOR UPDATE
      `;
      const current = await transaction.channel.findUnique({
        where: { id: channel.id },
        select: { currentStatus: true },
      });
      if (!current) {
        throw new AppError("Canal no encontrado", 404);
      }
      const previousChecks = await transaction.channelCheck.findMany({
        where: { channelId: channel.id },
        orderBy: { checkedAt: "desc" },
        take: maximumThreshold,
        select: { result: true },
      });
      const observedStatus = classifyChannelStatus(
        current.currentStatus,
        observation,
        previousChecks,
        channel.monitoringConfig,
      );
      const check = await transaction.channelCheck.create({
        data: {
          channelId: channel.id,
          source: observation.source,
          result: observation.result,
          observedStatus,
          responseTimeMs: observation.responseTimeMs,
          httpStatusCode: observation.httpStatusCode,
          detail: observation.detail,
          checkedAt,
        },
      });

      if (current.currentStatus !== observedStatus) {
        await transaction.channel.update({
          where: { id: channel.id },
          data: { currentStatus: observedStatus },
        });
        await transaction.channelStatusHistory.create({
          data: {
            channelId: channel.id,
            previousStatus: current.currentStatus,
            newStatus: observedStatus,
            source: "CHECK",
            changedAt: checkedAt,
          },
        });
      }

      await recordMonitoringIncident(transaction, {
        channelId: channel.id,
        previousStatus: current.currentStatus,
        newStatus: observedStatus,
        checkId: check.id,
        checkedAt,
        result: observation.result,
        detail: observation.detail,
        failureThreshold: channel.monitoringConfig.failureThreshold,
        previousResultsNewestFirst: previousChecks.map(({ result }) => result),
      });

      return check;
    });
  }
}
