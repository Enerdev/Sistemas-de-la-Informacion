import { randomUUID } from "node:crypto";
import {
  ChannelStatus,
  ChannelType,
  CheckResult,
  CheckSource,
  FailureReportStatus,
  IncidentSeverity,
  IncidentStatus,
  NotificationKind,
  NotificationStatus,
} from "@prisma/client";
import { classifyChannelStatus } from "../monitoring/classification.js";
import type { CheckObservation } from "../monitoring/types.js";

/**
 * Datos de demostración: varias semanas de verificaciones simuladas, generadas con la misma
 * clasificación que usa el monitor real, para que estados, incidencias y recuperaciones sean
 * exactamente los que el sistema habría producido. Todo es ficticio.
 */

const minute = 60 * 1000;
const day = 24 * 60 * minute;
const limaOffset = 5 * 60 * minute;
export const demoCheckIntervalMinutes = 5;
export const demoSettings = { latencyWarningMillis: 1500, failureThreshold: 3, recoveryThreshold: 2 };

export const demoChannels = [
  { code: "APP_BN", name: "App BN", type: ChannelType.APP, simulatedTarget: "sim://app-bn", description: "Canal móvil simulado para el proyecto académico." },
  { code: "BANCA_INTERNET", name: "Banca por internet", type: ChannelType.INTERNET_BANKING, simulatedTarget: "sim://banca-internet", description: "Canal web simulado para el proyecto académico." },
  { code: "MULTIRED_VIRTUAL", name: "Multired Virtual", type: ChannelType.MULTIRED_VIRTUAL, simulatedTarget: "sim://multired-virtual", description: "Canal virtual simulado para el proyecto académico." },
] as const;

type ChannelCode = (typeof demoChannels)[number]["code"];

type AdminPlan = {
  /** Minutos tras la detección; null si aún no ocurre. */
  inProgressAfter: number | null;
  resolvedAfter: number | null;
  closedAfter: number | null;
  severity?: { to: IncidentSeverity; after: number; note: string };
  notes: { inProgress?: string; resolved?: string; closed?: string };
};

type Scenario =
  | { kind: "outage"; channel: ChannelCode; daysAgo: number; at: string; minutes: number; failure: "FAILURE" | "TIMEOUT"; admin: AdminPlan; reports?: number; failedDelivery?: boolean }
  | { kind: "slow"; channel: ChannelCode; daysAgo: number; at: string; minutes: number }
  | { kind: "maintenance"; channel: ChannelCode; daysAgo: number; at: string; minutes: number };

const closed = (notes: AdminPlan["notes"], severity?: AdminPlan["severity"]): AdminPlan => ({
  inProgressAfter: 6, resolvedAfter: 240, closedAfter: 1440, notes, severity,
});

export const demoScenarios: Scenario[] = [
  { kind: "outage", channel: "APP_BN", daysAgo: 38, at: "09:10", minutes: 25, failure: "FAILURE",
    admin: closed({ inProgress: "Se revisa el balanceador del servicio simulado.", resolved: "Reinicio del nodo de autenticación simulado.", closed: "Sin impacto en fechas de pago." },
      { to: IncidentSeverity.MEDIUM, after: 15, note: "Caída breve fuera de fecha de pago." }) },
  { kind: "slow", channel: "BANCA_INTERNET", daysAgo: 36, at: "18:00", minutes: 90 },
  { kind: "outage", channel: "MULTIRED_VIRTUAL", daysAgo: 35, at: "08:30", minutes: 140, failure: "TIMEOUT", reports: 3,
    admin: closed({ inProgress: "Tiempo de espera en el servicio de pagos simulado; se escala a proveedor.", resolved: "Proveedor simulado restablece la conexión.", closed: "Se documenta lección aprendida para fechas de pago." },
      { to: IncidentSeverity.CRITICAL, after: 20, note: "Ocurre en fecha de pago de remuneraciones." }) },
  { kind: "outage", channel: "APP_BN", daysAgo: 30, at: "10:05", minutes: 55, failure: "FAILURE", reports: 2,
    admin: closed({ inProgress: "Alta demanda en la fecha de pago.", resolved: "Se amplía capacidad del servicio simulado.", closed: "Cierre tras monitoreo de 24 h." }) },
  { kind: "maintenance", channel: "BANCA_INTERNET", daysAgo: 27, at: "01:00", minutes: 120 },
  { kind: "outage", channel: "BANCA_INTERNET", daysAgo: 21, at: "12:20", minutes: 35, failure: "FAILURE", reports: 1,
    admin: closed({ inProgress: "Error en certificado del servicio simulado.", resolved: "Certificado renovado.", closed: "Se agenda alerta de vencimiento." }) },
  { kind: "slow", channel: "APP_BN", daysAgo: 21, at: "19:00", minutes: 45 },
  { kind: "outage", channel: "MULTIRED_VIRTUAL", daysAgo: 17, at: "22:40", minutes: 20, failure: "TIMEOUT",
    admin: closed({ inProgress: "Ventana nocturna sin usuarios afectados.", resolved: "Se restablece solo.", closed: "Sin acciones adicionales." },
      { to: IncidentSeverity.LOW, after: 30, note: "Horario de baja demanda." }) },
  { kind: "outage", channel: "APP_BN", daysAgo: 14, at: "08:00", minutes: 190, failure: "FAILURE", reports: 4, failedDelivery: true,
    admin: closed({ inProgress: "Caída general de la app simulada en fecha de pago de pensiones.", resolved: "Se revierte la versión desplegada.", closed: "Informe enviado a Jefatura de TI." },
      { to: IncidentSeverity.CRITICAL, after: 12, note: "Afecta a pensionistas en fecha de pago." }) },
  { kind: "outage", channel: "BANCA_INTERNET", daysAgo: 9, at: "15:15", minutes: 30, failure: "FAILURE",
    admin: closed({ inProgress: "Fallo en base de datos simulada.", resolved: "Conmutación a réplica.", closed: "Verificado sin pérdida de datos." }) },
  { kind: "slow", channel: "MULTIRED_VIRTUAL", daysAgo: 6, at: "11:00", minutes: 60 },
  { kind: "outage", channel: "APP_BN", daysAgo: 2, at: "16:40", minutes: 40, failure: "FAILURE", reports: 2,
    admin: { inProgressAfter: 8, resolvedAfter: null, closedAfter: null, notes: { inProgress: "Se investiga la causa raíz; el servicio ya responde." } } },
  { kind: "outage", channel: "BANCA_INTERNET", daysAgo: 1, at: "09:30", minutes: 25, failure: "TIMEOUT", reports: 1,
    admin: { inProgressAfter: null, resolvedAfter: null, closedAfter: null, notes: {} } },
];

/** Fechas de pago ficticias relativas al día actual (días atrás; negativos = futuras). */
export const demoPaymentDays: Array<{ daysAgo: number; group: string; description: string }> = [
  { daysAgo: 35, group: "REMUNERACIONES", description: "Ejemplo ficticio: remuneraciones, primer grupo" },
  { daysAgo: 30, group: "PENSIONES", description: "Ejemplo ficticio: pago de pensiones" },
  { daysAgo: 21, group: "REMUNERACIONES", description: "Ejemplo ficticio: remuneraciones, segundo grupo" },
  { daysAgo: 14, group: "PENSIONES", description: "Ejemplo ficticio: pago de pensiones" },
  { daysAgo: 6, group: "REMUNERACIONES", description: "Ejemplo ficticio: remuneraciones, primer grupo" },
  { daysAgo: -4, group: "PENSIONES", description: "Ejemplo ficticio: pago de pensiones" },
  { daysAgo: -9, group: "REMUNERACIONES", description: "Ejemplo ficticio: remuneraciones y aguinaldo" },
];

const reportTexts = [
  "No puedo ingresar, la aplicación se queda cargando.",
  "Me sale error de conexión al intentar consultar mi pago.",
  "La página no abre desde esta mañana.",
  "Intenté varias veces y aparece que el servicio no está disponible.",
  "No carga el saldo, solo muestra una pantalla en blanco.",
];

export const demoRecipients = [
  { email: "jefatura-ti@simona.test", name: "Jefatura de TI (demo)", notifyDown: true, notifyRecovery: true },
  { email: "operaciones-ti@simona.test", name: "Operaciones TI (demo)", notifyDown: true, notifyRecovery: false },
  { email: "guardia-ti@simona.test", name: "Guardia TI (demo)", notifyDown: true, notifyRecovery: true },
];

/** PRNG determinista (mulberry32) para que la demo sea igual en cada carga. */
function createRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function limaMidnight(instant: number): number {
  const local = new Date(instant - limaOffset);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + limaOffset;
}

function scenarioWindow(scenario: Scenario, end: number) {
  const [hours, minutes] = scenario.at.split(":").map(Number);
  const start = limaMidnight(end) - scenario.daysAgo * day + (hours! * 60 + minutes!) * minute;
  return { start, end: start + scenario.minutes * minute };
}

export type DemoActors = { operatorId: string; adminId: string };

export function generateDemoData(endInstant: Date, actors: DemoActors, days = 42) {
  const random = createRandom(2026);
  const end = Math.floor(endInstant.getTime() / (demoCheckIntervalMinutes * minute)) * demoCheckIntervalMinutes * minute;
  const start = limaMidnight(end) - days * day;

  const channels = demoChannels.map((channel) => ({ ...channel, id: randomUUID(), createdAt: new Date(start - day) }));

  const checks: Array<{ id: string; channelId: string; source: CheckSource; result: CheckResult; observedStatus: ChannelStatus; responseTimeMs: number | null; httpStatusCode: number | null; detail: string; checkedAt: Date }> = [];
  const history: Array<{ channelId: string; previousStatus: ChannelStatus | null; newStatus: ChannelStatus; source: "CHECK" | "USER"; actorId: string | null; changedAt: Date }> = [];
  const incidents: Array<{ id: string; channelId: string; scenario: Extract<Scenario, { kind: "outage" }>; startedAt: Date; detectedAt: Date; recoveredAt: Date | null; detectionCheckId: string; consecutiveFailures: number }> = [];
  const finalStatus = new Map<string, ChannelStatus>();

  for (const channel of channels) {
    const scenarios = demoScenarios
      .filter((scenario) => scenario.channel === channel.code)
      .map((scenario) => ({ scenario, window: scenarioWindow(scenario, end) }));
    let status: ChannelStatus = ChannelStatus.UNKNOWN;
    const recent: CheckResult[] = [];
    let streakStart: number | null = null;
    let openIncident: (typeof incidents)[number] | null = null;

    for (let time = start; time <= end; time += demoCheckIntervalMinutes * minute) {
      const active = scenarios.find(({ window }) => time >= window.start && time < window.end);

      if (active?.scenario.kind === "maintenance") {
        if (status !== ChannelStatus.MAINTENANCE) {
          history.push({ channelId: channel.id, previousStatus: status, newStatus: ChannelStatus.MAINTENANCE, source: "USER", actorId: actors.operatorId, changedAt: new Date(time) });
          status = ChannelStatus.MAINTENANCE;
        }
        continue;
      }
      if (status === ChannelStatus.MAINTENANCE) {
        history.push({ channelId: channel.id, previousStatus: status, newStatus: ChannelStatus.UNKNOWN, source: "USER", actorId: actors.operatorId, changedAt: new Date(time - minute) });
        status = ChannelStatus.UNKNOWN;
      }

      let observation: CheckObservation;
      if (active?.scenario.kind === "outage") {
        observation = active.scenario.failure === "TIMEOUT"
          ? { source: CheckSource.SIMULATED, result: CheckResult.TIMEOUT, responseTimeMs: null, httpStatusCode: null, detail: "Timeout simulado: el servicio excedió el tiempo configurado." }
          : { source: CheckSource.SIMULATED, result: CheckResult.FAILURE, responseTimeMs: null, httpStatusCode: null, detail: "Fallo simulado: el servicio está configurado como caído." };
      } else {
        const slow = active?.scenario.kind === "slow";
        const latency = slow ? 1600 + Math.round(random() * 1100) : 25 + Math.round(random() * 330);
        observation = { source: CheckSource.SIMULATED, result: CheckResult.SUCCESS, responseTimeMs: latency, httpStatusCode: null, detail: `Respuesta simulada en ${latency} ms.` };
      }

      const observedStatus = classifyChannelStatus(status, observation, recent.map((result) => ({ result })), demoSettings);
      const check = { id: randomUUID(), channelId: channel.id, ...observation, observedStatus, detail: observation.detail ?? "", checkedAt: new Date(time) };
      checks.push(check);

      const failed = observation.result === CheckResult.FAILURE || observation.result === CheckResult.TIMEOUT;
      if (failed && streakStart === null) streakStart = time;
      if (!failed) streakStart = null;

      if (observedStatus !== status) {
        history.push({ channelId: channel.id, previousStatus: status, newStatus: observedStatus, source: "CHECK", actorId: null, changedAt: new Date(time) });
        if (observedStatus === ChannelStatus.UNAVAILABLE && active?.scenario.kind === "outage") {
          openIncident = {
            id: randomUUID(),
            channelId: channel.id,
            scenario: active.scenario,
            startedAt: new Date(streakStart ?? time),
            detectedAt: new Date(time),
            recoveredAt: null,
            detectionCheckId: check.id,
            consecutiveFailures: Math.round((time - (streakStart ?? time)) / (demoCheckIntervalMinutes * minute)) + 1,
          };
          incidents.push(openIncident);
        }
        if (status === ChannelStatus.UNAVAILABLE && openIncident) {
          openIncident.recoveredAt = new Date(time);
          openIncident = null;
        }
        status = observedStatus;
      }
      recent.unshift(observation.result);
      if (recent.length > 20) recent.pop();
    }
    finalStatus.set(channel.id, status);
  }

  const lastCheckBefore = (channel: string, instant: Date) =>
    checks.filter((check) => check.channelId === channel && check.checkedAt <= instant).at(-1);

  const incidentRows = incidents.map((incident) => {
    const plan = incident.scenario.admin;
    const at = (minutes: number | null) => (minutes === null ? null : new Date(incident.detectedAt.getTime() + minutes * minute));
    const inProgressAt = at(plan.inProgressAfter);
    const resolvedAt = at(plan.resolvedAfter);
    const closedAt = at(plan.closedAfter);
    const status = closedAt && closedAt.getTime() <= end ? IncidentStatus.CLOSED
      : resolvedAt && resolvedAt.getTime() <= end ? IncidentStatus.RESOLVED
        : inProgressAt && inProgressAt.getTime() <= end ? IncidentStatus.IN_PROGRESS
          : IncidentStatus.OPEN;
    const reason = `Canal CAÍDO tras ${incident.consecutiveFailures} fallos consecutivos; política: ${demoSettings.failureThreshold}.`;
    const severityChange = plan.severity && at(plan.severity.after)!.getTime() <= end ? plan.severity : undefined;

    const events: Array<{ id: string; incidentId: string; checkId: string | null; actorId: string | null; actorType: "SYSTEM" | "USER"; kind: "OPENED" | "STATUS_CHANGED" | "CHANNEL_RECOVERED" | "SEVERITY_CHANGED"; previousStatus: IncidentStatus | null; newStatus: IncidentStatus; note: string | null; createdAt: Date }> = [
      { id: randomUUID(), incidentId: incident.id, checkId: incident.detectionCheckId, actorId: null, actorType: "SYSTEM", kind: "OPENED", previousStatus: null, newStatus: IncidentStatus.OPEN, note: reason, createdAt: incident.detectedAt },
    ];
    let current: IncidentStatus = IncidentStatus.OPEN;
    const timeline: Array<{ at: Date; apply: () => void }> = [];
    if (inProgressAt && inProgressAt.getTime() <= end) {
      timeline.push({ at: inProgressAt, apply: () => {
        events.push({ id: randomUUID(), incidentId: incident.id, checkId: null, actorId: actors.operatorId, actorType: "USER", kind: "STATUS_CHANGED", previousStatus: current, newStatus: IncidentStatus.IN_PROGRESS, note: plan.notes.inProgress ?? null, createdAt: inProgressAt });
        current = IncidentStatus.IN_PROGRESS;
      } });
    }
    if (severityChange) {
      const changeAt = at(severityChange.after)!;
      timeline.push({ at: changeAt, apply: () => {
        events.push({ id: randomUUID(), incidentId: incident.id, checkId: null, actorId: actors.operatorId, actorType: "USER", kind: "SEVERITY_CHANGED", previousStatus: current, newStatus: current, note: `Severidad ALTA → ${{ LOW: "BAJA", MEDIUM: "MEDIA", HIGH: "ALTA", CRITICAL: "CRÍTICA" }[severityChange.to]}. ${severityChange.note}`, createdAt: changeAt });
      } });
    }
    if (incident.recoveredAt) {
      const recoveredAt = incident.recoveredAt;
      timeline.push({ at: recoveredAt, apply: () => {
        events.push({ id: randomUUID(), incidentId: incident.id, checkId: lastCheckBefore(incident.channelId, recoveredAt)?.id ?? null, actorId: null, actorType: "SYSTEM", kind: "CHANNEL_RECOVERED", previousStatus: current, newStatus: current, note: "Recuperación técnica detectada: el canal pasó a AVAILABLE. La gestión administrativa de la incidencia continúa.", createdAt: recoveredAt });
      } });
    }
    if (status === IncidentStatus.RESOLVED || status === IncidentStatus.CLOSED) {
      timeline.push({ at: resolvedAt!, apply: () => {
        events.push({ id: randomUUID(), incidentId: incident.id, checkId: null, actorId: actors.operatorId, actorType: "USER", kind: "STATUS_CHANGED", previousStatus: current, newStatus: IncidentStatus.RESOLVED, note: plan.notes.resolved ?? null, createdAt: resolvedAt! });
        current = IncidentStatus.RESOLVED;
      } });
    }
    if (status === IncidentStatus.CLOSED) {
      timeline.push({ at: closedAt!, apply: () => {
        events.push({ id: randomUUID(), incidentId: incident.id, checkId: null, actorId: actors.adminId, actorType: "USER", kind: "STATUS_CHANGED", previousStatus: current, newStatus: IncidentStatus.CLOSED, note: plan.notes.closed ?? null, createdAt: closedAt! });
        current = IncidentStatus.CLOSED;
      } });
    }
    timeline.sort((a, b) => a.at.getTime() - b.at.getTime()).forEach(({ apply }) => apply());

    return {
      incident: {
        id: incident.id,
        channelId: incident.channelId,
        detectionCheckId: incident.detectionCheckId,
        status,
        severity: severityChange?.to ?? IncidentSeverity.HIGH,
        summary: "Canal no disponible",
        reason,
        evidence: JSON.stringify({
          detectionCheckId: incident.detectionCheckId,
          result: incident.scenario.failure,
          consecutiveFailures: incident.consecutiveFailures,
          failureThreshold: demoSettings.failureThreshold,
          startedAt: incident.startedAt.toISOString(),
          detectedAt: incident.detectedAt.toISOString(),
        }),
        startedAt: incident.startedAt,
        detectedAt: incident.detectedAt,
        openedAt: incident.detectedAt,
        recoveredAt: incident.recoveredAt,
        resolvedAt: status === IncidentStatus.RESOLVED || status === IncidentStatus.CLOSED ? resolvedAt : null,
        closedAt: status === IncidentStatus.CLOSED ? closedAt : null,
      },
      events,
      source: incident,
    };
  });

  const recipients = demoRecipients.map((recipient) => ({ ...recipient, id: randomUUID() }));
  const notifications = incidentRows.flatMap(({ incident, source }) => {
    const channel = channels.find(({ id }) => id === incident.channelId)!;
    const build = (kind: NotificationKind, eventAt: Date) => recipients
      .filter((recipient) => (kind === NotificationKind.CHANNEL_DOWN ? recipient.notifyDown : recipient.notifyRecovery))
      .map((recipient) => {
        const failedDelivery = source.scenario.failedDelivery && recipient.email === "guardia-ti@simona.test";
        const sentAt = new Date(eventAt.getTime() + (4 + Math.round(random() * 11)) * 1000);
        return {
          id: randomUUID(),
          kind,
          status: failedDelivery ? NotificationStatus.FAILED : NotificationStatus.SENT,
          channelId: incident.channelId,
          incidentId: incident.id,
          recipientId: recipient.id,
          recipientEmail: recipient.email,
          subject: `[SIMONA-BN] ${kind === NotificationKind.CHANNEL_DOWN ? "CAÍDO" : "RESTABLECIDO"}: ${channel.name}`,
          body: `Mensaje de demostración (${kind === NotificationKind.CHANNEL_DOWN ? "caída" : "restablecimiento"} de ${channel.name}). Datos simulados; no proviene del Banco de la Nación.`,
          eventAt,
          attempts: failedDelivery ? 3 : 1,
          maxAttempts: 3,
          nextAttemptAt: failedDelivery ? new Date(eventAt.getTime() + 3 * minute) : eventAt,
          lastError: failedDelivery ? "Tiempo de espera agotado al conectar con el servidor SMTP (simulado)." : null,
          providerMessageId: failedDelivery ? null : `<demo-${randomUUID()}@simona.test>`,
          sentAt: failedDelivery ? null : sentAt,
          createdAt: eventAt,
        };
      });
    return [
      ...build(NotificationKind.CHANNEL_DOWN, incident.detectedAt),
      ...(incident.recoveredAt ? build(NotificationKind.CHANNEL_RECOVERED, incident.recoveredAt) : []),
    ];
  });

  let reportSequence = 0;
  const failureReports = incidentRows.flatMap(({ incident, source }) =>
    Array.from({ length: source.scenario.reports ?? 0 }, (_, index) => {
      reportSequence += 1;
      const createdAt = new Date(incident.startedAt.getTime() + (3 + index * 7) * minute);
      const isRecent = incident.status === IncidentStatus.OPEN || incident.status === IncidentStatus.IN_PROGRESS;
      const dismissed = !isRecent && index === 2;
      const status = isRecent && index > 0 ? FailureReportStatus.NEW
        : dismissed ? FailureReportStatus.DISMISSED : FailureReportStatus.LINKED;
      return {
        id: randomUUID(),
        referenceCode: `R-DEMO${String(reportSequence).padStart(4, "0")}`.replace(/[01]/g, (digit) => (digit === "0" ? "Q" : "L")),
        channelId: incident.channelId,
        incidentId: status === FailureReportStatus.LINKED ? incident.id : null,
        reviewedById: status === FailureReportStatus.NEW ? null : actors.operatorId,
        status,
        description: reportTexts[(reportSequence - 1) % reportTexts.length]!,
        contactEmail: index % 2 === 0 ? `ciudadano${reportSequence}@correo.test` : null,
        occurredAt: new Date(createdAt.getTime() - 2 * minute),
        reviewNote: status === FailureReportStatus.LINKED ? "Coincide con la caída detectada por el monitoreo."
          : status === FailureReportStatus.DISMISSED ? "Problema de conexión del usuario; el canal respondía con normalidad." : null,
        reviewedAt: status === FailureReportStatus.NEW ? null : new Date(createdAt.getTime() + 25 * minute),
        createdAt,
      };
    }));

  const paymentDates = demoPaymentDays.map(({ daysAgo, group, description }) => {
    const local = new Date(limaMidnight(end) - daysAgo * day - limaOffset);
    return { date: new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())), group, description };
  });

  return {
    period: { start: new Date(start), end: new Date(end) },
    channels: channels.map((channel) => ({ ...channel, currentStatus: finalStatus.get(channel.id)! })),
    checks,
    history,
    incidents: incidentRows.map(({ incident }) => incident),
    incidentEvents: incidentRows.flatMap(({ events }) => events),
    recipients,
    notifications,
    failureReports,
    paymentDates,
  };
}

export type DemoData = ReturnType<typeof generateDemoData>;
