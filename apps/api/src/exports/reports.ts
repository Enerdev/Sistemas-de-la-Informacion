import { IncidentStatus } from "@prisma/client";
import type { IncidentSeverity, PrismaClient } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import {
  addDurations,
  availabilityPercent,
  emptyDurations,
  isWithinWindows,
  limaDateKey,
  limaDateTime,
  limaDayWindows,
  paymentDayWindows,
  statusDurations,
} from "../indicators/calculations.js";
import type { StatusDurations, TimeWindow } from "../indicators/calculations.js";
import { clampPeriod, loadPaymentDates, loadStatusTimeline } from "../indicators/service.js";
import type { Report, ReportCell } from "./report.js";

type ReportRepository = Pick<
  PrismaClient,
  "channel" | "channelStatusHistory" | "incident" | "notification" | "paymentDate"
>;

export type ReportContext = { generatedAt: Date; generatedBy: string };

const maximumIncidentRows = 5000;

const statusLabels: Record<IncidentStatus, string> = {
  OPEN: "Abierta",
  ACKNOWLEDGED: "Reconocida",
  IN_PROGRESS: "En investigación",
  RESOLVED: "Resuelta",
  CLOSED: "Cerrada",
};

const severityLabels: Record<IncidentSeverity, string> = {
  LOW: "Baja",
  MEDIUM: "Media",
  HIGH: "Alta",
  CRITICAL: "Crítica",
};

const percent = (value: number | null): ReportCell => (value === null ? null : Number(value.toFixed(3)));
const minutes = (milliseconds: number | null): ReportCell =>
  milliseconds === null ? null : Number((milliseconds / 60_000).toFixed(1));
const dateTime = (value: Date | null): ReportCell => (value ? limaDateTime(value) : null);

function baseMeta(period: TimeWindow, context: ReportContext): Array<[string, string]> {
  return [
    ["Periodo (hora de Lima)", `${limaDateTime(period.start)} a ${limaDateTime(period.end)}`],
    ["Generado", `${limaDateTime(context.generatedAt)} por ${context.generatedBy}`],
    ["Origen de los datos", "Canales y servicios simulados; no corresponde a sistemas reales del Banco de la Nación"],
  ];
}

const availabilityNote =
  "Disponibilidad = tiempo operativo / (operativo + caído) x 100. DEGRADADO cuenta como operativo; MANTENIMIENTO y Sin verificar se excluyen.";

export async function buildAvailabilityReport(
  query: { from: Date; to: Date; targetPercent: number; channelId?: string; granularity: "channel" | "day" },
  context: ReportContext,
  database: ReportRepository = prisma,
): Promise<Report> {
  const period = clampPeriod(query.from, query.to, context.generatedAt);
  const [timeline, paymentDates] = await Promise.all([
    loadStatusTimeline(database, period),
    loadPaymentDates(database, period),
  ]);
  const paymentDays = new Set(
    paymentDayWindows(paymentDates.map(({ date }) => date), period).map(({ start }) => limaDateKey(start)),
  );
  const channels = timeline.channels.filter((channel) => !query.channelId || channel.id === query.channelId);

  const durationCells = (durations: StatusDurations) => ({
    availability: percent(availabilityPercent(durations)),
    operationalMinutes: minutes(durations.operationalMs),
    downMinutes: minutes(durations.downMs),
    maintenanceMinutes: minutes(durations.maintenanceMs),
    unknownMinutes: minutes(durations.unknownMs),
  });
  const belowTarget = (durations: StatusDurations) => {
    const value = availabilityPercent(durations);
    return value === null ? "Sin datos" : value < query.targetPercent ? "Sí" : "No";
  };

  const rows: Report["rows"] = [];
  for (const channel of channels) {
    const initial = timeline.initialStatusOf(channel.id);
    const transitions = timeline.transitionsOf(channel.id);
    const windows = query.granularity === "day" ? limaDayWindows(period) : [{ ...period, day: null }];
    for (const window of windows) {
      const durations = statusDurations(initial, transitions, window);
      rows.push({
        channel: channel.name,
        code: channel.code,
        ...(query.granularity === "day"
          ? { day: window.day, paymentDay: paymentDays.has(window.day!) ? "Sí" : "No" }
          : {}),
        ...durationCells(durations),
        belowTarget: belowTarget(durations),
      });
    }
  }

  return {
    title: query.granularity === "day" ? "Reporte de disponibilidad diaria por canal" : "Reporte de disponibilidad por canal",
    fileName: `simona-disponibilidad-${query.granularity === "day" ? "diaria-" : ""}${limaDateKey(period.start)}_${limaDateKey(period.end)}`,
    meta: [
      ...baseMeta(period, context),
      ["Meta de disponibilidad", `${query.targetPercent} %`],
      ["Canal", query.channelId ? channels[0]?.name ?? "No encontrado" : "Todos"],
    ],
    summary: [
      ["Canales", String(channels.length)],
      ["Filas bajo la meta", String(rows.filter((row) => row.belowTarget === "Sí").length)],
      ["Días de pago en el periodo", String(paymentDays.size)],
    ],
    columns: [
      { key: "channel", label: "Canal", width: 1.6 },
      { key: "code", label: "Código", width: 1.3 },
      ...(query.granularity === "day"
        ? [
            { key: "day", label: "Fecha", width: 1 },
            { key: "paymentDay", label: "Día de pago", width: 0.8 },
          ]
        : []),
      { key: "availability", label: "Disponibilidad (%)", width: 1, align: "right" as const },
      { key: "operationalMinutes", label: "Operativo (min)", width: 1, align: "right" as const },
      { key: "downMinutes", label: "Caído (min)", width: 1, align: "right" as const },
      { key: "maintenanceMinutes", label: "Mantenimiento (min)", width: 1, align: "right" as const },
      { key: "unknownMinutes", label: "Sin verificar (min)", width: 1, align: "right" as const },
      { key: "belowTarget", label: "Bajo la meta", width: 0.8 },
    ],
    rows,
    notes: [availabilityNote, "Los días se cuentan en hora de Lima (UTC-5)."],
  };
}

export async function buildIncidentReport(
  query: {
    from: Date;
    to: Date;
    channelId?: string;
    status?: IncidentStatus;
    severity?: IncidentSeverity;
  },
  context: ReportContext,
  database: ReportRepository = prisma,
): Promise<Report> {
  const period = clampPeriod(query.from, query.to, context.generatedAt);
  const [incidents, paymentDates] = await Promise.all([
    database.incident.findMany({
      where: {
        detectedAt: { gte: period.start, lte: period.end },
        ...(query.channelId ? { channelId: query.channelId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.severity ? { severity: query.severity } : {}),
      },
      include: {
        channel: { select: { code: true, name: true } },
        _count: { select: { failureReports: true } },
        notifications: { where: { status: "SENT" }, select: { id: true } },
      },
      orderBy: [{ detectedAt: "asc" }, { id: "asc" }],
      take: maximumIncidentRows,
    }),
    loadPaymentDates(database, period),
  ]);
  const paymentWindows = paymentDayWindows(paymentDates.map(({ date }) => date), period);

  const rows = incidents.map((incident) => {
    const start = incident.startedAt ?? incident.detectedAt;
    return {
      id: incident.id.slice(0, 8),
      channel: incident.channel.name,
      status: statusLabels[incident.status],
      severity: severityLabels[incident.severity],
      startedAt: dateTime(incident.startedAt),
      detectedAt: dateTime(incident.detectedAt),
      recoveredAt: dateTime(incident.recoveredAt),
      resolvedAt: dateTime(incident.resolvedAt),
      closedAt: dateTime(incident.closedAt),
      outageMinutes: minutes(incident.recoveredAt ? incident.recoveredAt.getTime() - start.getTime() : null),
      paymentDay: isWithinWindows(start, paymentWindows) ? "Sí" : "No",
      summary: incident.summary,
      reason: incident.reason,
      citizenReports: incident._count.failureReports,
      notificationsSent: incident.notifications.length,
    };
  });

  const filters = [
    query.channelId ? `canal ${incidents[0]?.channel.name ?? query.channelId}` : null,
    query.status ? `estado ${statusLabels[query.status]}` : null,
    query.severity ? `severidad ${severityLabels[query.severity]}` : null,
  ].filter(Boolean);

  return {
    title: "Reporte de incidencias",
    fileName: `simona-incidencias-${limaDateKey(period.start)}_${limaDateKey(period.end)}`,
    meta: [...baseMeta(period, context), ["Filtros", filters.length ? filters.join(", ") : "Ninguno"]],
    summary: [
      ["Incidencias", String(rows.length)],
      ["Activas", String(incidents.filter(({ status }) => status === "OPEN" || status === "ACKNOWLEDGED" || status === "IN_PROGRESS").length)],
      ["En fechas de pago", String(rows.filter((row) => row.paymentDay === "Sí").length)],
      ["Sin recuperación técnica", String(incidents.filter(({ recoveredAt }) => !recoveredAt).length)],
    ],
    columns: [
      { key: "id", label: "ID", width: 1 },
      { key: "channel", label: "Canal", width: 1.3 },
      { key: "status", label: "Estado", width: 1.2 },
      { key: "severity", label: "Severidad", width: 1.2 },
      { key: "startedAt", label: "Inicio real", width: 1.35 },
      { key: "detectedAt", label: "Detección", width: 1.35 },
      { key: "recoveredAt", label: "Recuperación", width: 1.4 },
      { key: "resolvedAt", label: "Resolución", width: 1.35 },
      { key: "closedAt", label: "Cierre", width: 1.35 },
      { key: "outageMinutes", label: "Caída (min)", width: 0.9, align: "right" },
      { key: "paymentDay", label: "Día de pago", width: 0.8 },
      { key: "summary", label: "Resumen", width: 1.4 },
      { key: "reason", label: "Motivo", width: 2 },
      { key: "citizenReports", label: "Reportes", width: 1, align: "right" },
      { key: "notificationsSent", label: "Alertas", width: 0.9, align: "right" },
    ],
    rows,
    notes: [
      "Se incluyen las incidencias detectadas dentro del periodo.",
      "Caída = recuperación técnica - inicio real (o detección si no hay inicio real registrado).",
      "Reportes = reportes ciudadanos vinculados; Alertas = notificaciones enviadas.",
      ...(incidents.length === maximumIncidentRows ? [`El reporte se limitó a ${maximumIncidentRows} filas.`] : []),
    ],
  };
}

export async function buildExceptionReport(
  query: { from: Date; to: Date; targetPercent: number },
  context: ReportContext,
  database: ReportRepository = prisma,
): Promise<Report> {
  const period = clampPeriod(query.from, query.to, context.generatedAt);
  const [timeline, paymentDates] = await Promise.all([
    loadStatusTimeline(database, period),
    loadPaymentDates(database, period),
  ]);
  const groupsByDay = new Map<string, string[]>();
  for (const { date, group } of paymentDates) {
    const day = date.toISOString().slice(0, 10);
    groupsByDay.set(day, [...(groupsByDay.get(day) ?? []), group]);
  }
  const windows = paymentDayWindows(paymentDates.map(({ date }) => date), period);

  const rows: Report["rows"] = [];
  const channelsBelowTarget: string[] = [];
  for (const channel of timeline.channels) {
    const channelTotal = emptyDurations();
    for (const window of windows) {
      const durations = statusDurations(timeline.initialStatusOf(channel.id), timeline.transitionsOf(channel.id), window);
      addDurations(channelTotal, durations);
      const value = availabilityPercent(durations);
      if (value === null || value >= query.targetPercent) continue;
      const day = limaDateKey(window.start);
      rows.push({
        channel: channel.name,
        code: channel.code,
        day,
        groups: (groupsByDay.get(day) ?? []).join(" / "),
        availability: percent(value),
        target: query.targetPercent,
        gap: percent(value - query.targetPercent),
        downMinutes: minutes(durations.downMs),
      });
    }
    const total = availabilityPercent(channelTotal);
    if (total !== null && total < query.targetPercent) {
      channelsBelowTarget.push(`${channel.name} (${total.toFixed(2)} %)`);
    }
  }

  return {
    title: "Reporte por excepción: disponibilidad bajo la meta en fechas de pago",
    fileName: `simona-excepcion-fechas-pago-${limaDateKey(period.start)}_${limaDateKey(period.end)}`,
    meta: [...baseMeta(period, context), ["Meta de disponibilidad", `${query.targetPercent} %`]],
    summary: [
      ["Días de pago en el periodo", String(windows.length)],
      ["Canal-días bajo la meta", String(rows.length)],
      [
        "Canales bajo la meta en el conjunto de fechas de pago",
        channelsBelowTarget.length ? channelsBelowTarget.join(", ") : "Ninguno",
      ],
    ],
    columns: [
      { key: "channel", label: "Canal", width: 1.6 },
      { key: "code", label: "Código", width: 1.3 },
      { key: "day", label: "Fecha de pago", width: 1 },
      { key: "groups", label: "Grupos", width: 1.6 },
      { key: "availability", label: "Disponibilidad (%)", width: 1, align: "right" },
      { key: "target", label: "Meta (%)", width: 0.7, align: "right" },
      { key: "gap", label: "Diferencia (pp)", width: 0.9, align: "right" },
      { key: "downMinutes", label: "Caído (min)", width: 0.9, align: "right" },
    ],
    rows,
    notes: [
      availabilityNote,
      "Solo se listan los canales y días de pago con disponibilidad inferior a la meta. Sin filas significa que todos la cumplieron o no hubo datos.",
      ...(windows.length === 0 ? ["No hay fechas de pago cargadas en el periodo: importa el cronograma en la pestaña Indicadores."] : []),
    ],
  };
}
