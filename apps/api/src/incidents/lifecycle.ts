import {
  ChannelStatus,
  CheckResult,
  IncidentActorType,
  IncidentEventKind,
  IncidentSeverity,
  IncidentStatus,
} from "@prisma/client";
import type { Prisma, PrismaClient } from "@prisma/client";
import { AppError } from "../errors/app-error.js";

const failureResults: CheckResult[] = [CheckResult.FAILURE, CheckResult.TIMEOUT];
const activeStatuses = [
  IncidentStatus.OPEN,
  IncidentStatus.ACKNOWLEDGED,
  IncidentStatus.IN_PROGRESS,
];

type Transaction = Prisma.TransactionClient;
type IncidentRepository = Pick<PrismaClient, "$transaction">;

export type IncidentActor = {
  userId: string;
  role: "ADMIN" | "OPERATOR" | "VIEWER";
};

export const incidentTransitions: Record<IncidentStatus, IncidentStatus[]> = {
  OPEN: [IncidentStatus.IN_PROGRESS],
  ACKNOWLEDGED: [IncidentStatus.IN_PROGRESS],
  IN_PROGRESS: [IncidentStatus.RESOLVED],
  RESOLVED: [IncidentStatus.CLOSED],
  CLOSED: [],
};

export function assertIncidentTransition(input: {
  currentStatus: IncidentStatus;
  nextStatus: IncidentStatus;
  role: IncidentActor["role"];
}): void {
  if (input.role === "VIEWER") {
    throw new AppError("No tienes permiso para gestionar incidencias", 403);
  }
  if (input.nextStatus === IncidentStatus.CLOSED && input.role !== "ADMIN") {
    throw new AppError("Solo ADMIN puede cerrar incidencias", 403);
  }
  if (!incidentTransitions[input.currentStatus].includes(input.nextStatus)) {
    throw new AppError(
      `Transición no permitida: ${input.currentStatus} → ${input.nextStatus}`,
      409,
    );
  }
}

export async function recordMonitoringIncident(
  transaction: Transaction,
  input: {
    channelId: string;
    previousStatus: ChannelStatus;
    newStatus: ChannelStatus;
    checkId: string;
    checkedAt: Date;
    result: CheckResult;
    detail: string | null;
    failureThreshold: number;
    previousResultsNewestFirst: CheckResult[];
  },
): Promise<void> {
  if (
    input.previousStatus === ChannelStatus.UNAVAILABLE
    && input.newStatus !== ChannelStatus.UNAVAILABLE
  ) {
    const latestIncident = await transaction.incident.findFirst({
      where: { channelId: input.channelId, recoveredAt: null },
      orderBy: { openedAt: "desc" },
    });
    if (latestIncident) {
      await transaction.incident.update({
        where: { id: latestIncident.id },
        data: { recoveredAt: input.checkedAt },
      });
      await transaction.incidentEvent.create({
        data: {
          incidentId: latestIncident.id,
          checkId: input.checkId,
          actorType: IncidentActorType.SYSTEM,
          kind: IncidentEventKind.CHANNEL_RECOVERED,
          previousStatus: latestIncident.status,
          newStatus: latestIncident.status,
          note: `Recuperación técnica detectada: el canal pasó a ${input.newStatus}. La gestión administrativa de la incidencia continúa.`,
          createdAt: input.checkedAt,
        },
      });
    }
    return;
  }

  if (input.newStatus !== ChannelStatus.UNAVAILABLE) return;

  let consecutiveFailures = 1;
  for (const result of input.previousResultsNewestFirst) {
    if (!failureResults.includes(result)) break;
    consecutiveFailures += 1;
  }
  if (consecutiveFailures < input.failureThreshold) return;

  const activeIncident = await transaction.incident.findFirst({
    where: { channelId: input.channelId, status: { in: activeStatuses } },
    select: { id: true },
  });
  if (activeIncident) return;

  const latestIncident = await transaction.incident.findFirst({
    where: { channelId: input.channelId },
    orderBy: { openedAt: "desc" },
  });
  if (latestIncident && latestIncident.recoveredAt === null) {
    return;
  }

  const reason = `Canal CAÍDO tras ${consecutiveFailures} fallos consecutivos; política: ${input.failureThreshold}.`;
  const evidence = JSON.stringify({
    detectionCheckId: input.checkId,
    result: input.result,
    detail: input.detail,
    consecutiveFailures,
    failureThreshold: input.failureThreshold,
    detectedAt: input.checkedAt.toISOString(),
  }).slice(0, 2000);
  const incident = await transaction.incident.create({
    data: {
      channelId: input.channelId,
      detectionCheckId: input.checkId,
      status: IncidentStatus.OPEN,
      severity: IncidentSeverity.HIGH,
      summary: "Canal no disponible",
      reason,
      evidence,
      detectedAt: input.checkedAt,
      openedAt: input.checkedAt,
      events: {
        create: {
          checkId: input.checkId,
          actorType: IncidentActorType.SYSTEM,
          kind: IncidentEventKind.OPENED,
          previousStatus: null,
          newStatus: IncidentStatus.OPEN,
          note: reason,
          createdAt: input.checkedAt,
        },
      },
    },
  });

  if (!incident.id) {
    throw new Error("No se pudo asignar un identificador a la incidencia automática");
  }
}

export async function transitionIncident(
  repository: IncidentRepository,
  input: {
    incidentId: string;
    nextStatus: IncidentStatus;
    actor: IncidentActor;
    note?: string;
    now?: Date;
  },
) {
  return repository.$transaction(async (transaction) => {
    await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "incidents" WHERE "id" = ${input.incidentId}::uuid FOR UPDATE
    `;
    const incident = await transaction.incident.findUnique({
      where: { id: input.incidentId },
    });
    if (!incident) {
      throw new AppError("Incidencia no encontrada", 404);
    }

    assertIncidentTransition({
      currentStatus: incident.status,
      nextStatus: input.nextStatus,
      role: input.actor.role,
    });

    const now = input.now ?? new Date();
    const updated = await transaction.incident.update({
      where: { id: incident.id },
      data: {
        status: input.nextStatus,
        ...(input.nextStatus === IncidentStatus.RESOLVED ? { resolvedAt: now } : {}),
        ...(input.nextStatus === IncidentStatus.CLOSED ? { closedAt: now } : {}),
      },
    });
    await transaction.incidentEvent.create({
      data: {
        incidentId: incident.id,
        actorId: input.actor.userId,
        actorType: IncidentActorType.USER,
        kind: IncidentEventKind.STATUS_CHANGED,
        previousStatus: incident.status,
        newStatus: input.nextStatus,
        note: input.note,
        createdAt: now,
      },
    });

    return updated;
  });
}
