import { ChannelStatus, NotificationKind, NotificationStatus } from "@prisma/client";
import type { IncidentSeverity, PrismaClient } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import {
  addDurations,
  availabilityPercent,
  emptyDurations,
  isWithinWindows,
  mean,
  paymentDayWindows,
  statusDurations,
} from "./calculations.js";
import type { StatusTransition, TimeWindow } from "./calculations.js";

type IndicatorRepository = Pick<
  PrismaClient,
  "channel" | "channelStatusHistory" | "incident" | "notification" | "paymentDate"
>;

const dayMillis = 24 * 60 * 60 * 1000;

export type IndicatorQuery = { from: Date; to: Date; targetPercent: number };

export async function computeIndicators(
  query: IndicatorQuery,
  database: IndicatorRepository = prisma,
  now: Date = new Date(),
) {
  const period: TimeWindow = {
    start: query.from,
    end: new Date(Math.min(query.to.getTime(), now.getTime())),
  };

  const [channels, statusBefore, transitions, incidents, notifications, paymentDates] = await Promise.all([
    database.channel.findMany({
      select: { id: true, code: true, name: true, currentStatus: true, createdAt: true },
      orderBy: [{ name: "asc" }, { code: "asc" }],
    }),
    database.channelStatusHistory.findMany({
      where: { changedAt: { lte: period.start } },
      orderBy: [{ channelId: "asc" }, { changedAt: "desc" }],
      distinct: ["channelId"],
      select: { channelId: true, newStatus: true },
    }),
    database.channelStatusHistory.findMany({
      where: { changedAt: { gt: period.start, lt: period.end } },
      orderBy: { changedAt: "asc" },
      select: { channelId: true, changedAt: true, newStatus: true },
    }),
    database.incident.findMany({
      where: { detectedAt: { gte: period.start, lte: period.end } },
      select: {
        id: true,
        channelId: true,
        severity: true,
        startedAt: true,
        detectedAt: true,
        recoveredAt: true,
        resolvedAt: true,
        notifications: {
          where: { kind: NotificationKind.CHANNEL_DOWN, status: NotificationStatus.SENT },
          orderBy: { sentAt: "asc" },
          take: 1,
          select: { sentAt: true },
        },
      },
    }),
    database.notification.groupBy({
      by: ["status"],
      where: { createdAt: { gte: period.start, lte: period.end } },
      _count: { _all: true },
    }),
    database.paymentDate.findMany({
      where: {
        date: {
          gte: new Date(period.start.getTime() - dayMillis),
          lte: new Date(period.end.getTime() + dayMillis),
        },
      },
      orderBy: { date: "asc" },
      select: { date: true, group: true, description: true },
    }),
  ]);

  const paymentWindows = paymentDayWindows(paymentDates.map(({ date }) => date), period);
  const initialStatus = new Map(statusBefore.map(({ channelId, newStatus }) => [channelId, newStatus]));
  const transitionsByChannel = new Map<string, StatusTransition[]>();
  for (const transition of transitions) {
    const list = transitionsByChannel.get(transition.channelId) ?? [];
    list.push(transition);
    transitionsByChannel.set(transition.channelId, list);
  }

  const startOf = (incident: (typeof incidents)[number]) => incident.startedAt ?? incident.detectedAt;
  const totals = emptyDurations();
  const paymentTotals = emptyDurations();

  const channelRows = channels.map((channel) => {
    const channelTransitions = transitionsByChannel.get(channel.id) ?? [];
    const start = initialStatus.get(channel.id) ?? ChannelStatus.UNKNOWN;
    const durations = statusDurations(start, channelTransitions, period);
    const paymentDurations = emptyDurations();
    for (const window of paymentWindows) {
      addDurations(paymentDurations, statusDurations(start, channelTransitions, window));
    }
    addDurations(totals, durations);
    addDurations(paymentTotals, paymentDurations);

    const channelIncidents = incidents.filter((incident) => incident.channelId === channel.id);
    const availability = availabilityPercent(durations);
    const paymentAvailability = availabilityPercent(paymentDurations);
    return {
      id: channel.id,
      code: channel.code,
      name: channel.name,
      currentStatus: channel.currentStatus,
      availabilityPercent: availability,
      paymentDayAvailabilityPercent: paymentAvailability,
      durations,
      incidents: channelIncidents.length,
      incidentsOnPaymentDays: channelIncidents.filter((incident) => isWithinWindows(startOf(incident), paymentWindows)).length,
      meanTimeToRestoreMs: mean(channelIncidents
        .filter((incident) => incident.recoveredAt)
        .map((incident) => incident.recoveredAt!.getTime() - startOf(incident).getTime())),
      belowTarget: availability !== null && availability < query.targetPercent,
      belowTargetOnPaymentDays: paymentAvailability !== null && paymentAvailability < query.targetPercent,
    };
  });

  const countBy = (status: NotificationStatus) =>
    notifications.find((row) => row.status === status)?._count._all ?? 0;
  const sent = countBy(NotificationStatus.SENT);
  const failed = countBy(NotificationStatus.FAILED);
  const severityCounts = incidents.reduce<Partial<Record<IncidentSeverity, number>>>((counts, incident) => {
    counts[incident.severity] = (counts[incident.severity] ?? 0) + 1;
    return counts;
  }, {});

  return {
    period: { from: period.start.toISOString(), to: period.end.toISOString() },
    targetPercent: query.targetPercent,
    summary: {
      availabilityPercent: availabilityPercent(totals),
      paymentDayAvailabilityPercent: availabilityPercent(paymentTotals),
      meanTimeToDetectMs: mean(incidents.map((incident) => incident.detectedAt.getTime() - startOf(incident).getTime())),
      meanTimeToRestoreMs: mean(incidents
        .filter((incident) => incident.recoveredAt)
        .map((incident) => incident.recoveredAt!.getTime() - startOf(incident).getTime())),
      meanTimeToResolveMs: mean(incidents
        .filter((incident) => incident.resolvedAt)
        .map((incident) => incident.resolvedAt!.getTime() - incident.detectedAt.getTime())),
      meanTimeToCommunicateMs: mean(incidents
        .filter((incident) => incident.notifications[0]?.sentAt)
        .map((incident) => incident.notifications[0]!.sentAt!.getTime() - incident.detectedAt.getTime())),
      incidents: incidents.length,
      incidentsOnPaymentDays: incidents.filter((incident) => isWithinWindows(startOf(incident), paymentWindows)).length,
      incidentsBySeverity: severityCounts,
      notifications: {
        sent,
        failed,
        pending: countBy(NotificationStatus.PENDING),
        deliveryRatePercent: sent + failed === 0 ? null : (sent / (sent + failed)) * 100,
      },
      paymentDaysInPeriod: paymentWindows.length,
    },
    channels: channelRows,
    exceptions: channelRows
      .filter((channel) => channel.belowTargetOnPaymentDays)
      .map(({ id, code, name, paymentDayAvailabilityPercent }) => ({ id, code, name, paymentDayAvailabilityPercent })),
    paymentDates: paymentDates
      .filter(({ date }) => paymentDayWindows([date], period).length > 0)
      .map(({ date, group, description }) => ({ date: date.toISOString().slice(0, 10), group, description })),
  };
}
