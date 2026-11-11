import { ChannelStatus } from "@prisma/client";

// Lima no usa horario de verano: un día calendario empieza a las 05:00 UTC.
const limaOffsetMillis = 5 * 60 * 60 * 1000;
const dayMillis = 24 * 60 * 60 * 1000;

export type StatusTransition = { changedAt: Date; newStatus: ChannelStatus };

export type StatusDurations = {
  operationalMs: number;
  downMs: number;
  maintenanceMs: number;
  unknownMs: number;
};

export type TimeWindow = { start: Date; end: Date };

export const emptyDurations = (): StatusDurations => ({
  operationalMs: 0,
  downMs: 0,
  maintenanceMs: 0,
  unknownMs: 0,
});

function bucketFor(status: ChannelStatus): keyof StatusDurations {
  switch (status) {
    case ChannelStatus.AVAILABLE:
    case ChannelStatus.DEGRADED:
      return "operationalMs";
    case ChannelStatus.UNAVAILABLE:
      return "downMs";
    case ChannelStatus.MAINTENANCE:
      return "maintenanceMs";
    default:
      return "unknownMs";
  }
}

/**
 * Tiempo pasado en cada grupo de estados dentro de una ventana.
 * `initialStatus` es el estado vigente al inicio; `transitions` deben estar ordenadas por fecha.
 * DEGRADADO cuenta como operativo (el servicio responde); MANTENIMIENTO y sin verificar no cuentan.
 */
export function statusDurations(
  initialStatus: ChannelStatus,
  transitions: StatusTransition[],
  window: TimeWindow,
): StatusDurations {
  const durations = emptyDurations();
  if (window.end <= window.start) return durations;

  let status = initialStatus;
  let cursor = window.start.getTime();
  for (const transition of transitions) {
    const at = transition.changedAt.getTime();
    if (at <= window.start.getTime()) {
      status = transition.newStatus;
      continue;
    }
    if (at >= window.end.getTime()) break;
    durations[bucketFor(status)] += at - cursor;
    cursor = at;
    status = transition.newStatus;
  }
  durations[bucketFor(status)] += window.end.getTime() - cursor;
  return durations;
}

export function addDurations(target: StatusDurations, source: StatusDurations): StatusDurations {
  target.operationalMs += source.operationalMs;
  target.downMs += source.downMs;
  target.maintenanceMs += source.maintenanceMs;
  target.unknownMs += source.unknownMs;
  return target;
}

/** Disponibilidad (%) = tiempo operativo ÷ (operativo + caído) × 100. */
export function availabilityPercent(durations: StatusDurations): number | null {
  const observed = durations.operationalMs + durations.downMs;
  return observed === 0 ? null : (durations.operationalMs / observed) * 100;
}

export function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Convierte fechas calendario (DATE de PostgreSQL, medianoche UTC) en ventanas de 24 h de Lima. */
export function paymentDayWindows(dates: Date[], period: TimeWindow): TimeWindow[] {
  const uniqueDays = [...new Set(dates.map((date) => date.getTime()))].sort((a, b) => a - b);
  const windows: TimeWindow[] = [];
  for (const day of uniqueDays) {
    const start = Math.max(day + limaOffsetMillis, period.start.getTime());
    const end = Math.min(day + limaOffsetMillis + dayMillis, period.end.getTime());
    if (end > start) windows.push({ start: new Date(start), end: new Date(end) });
  }
  return windows;
}

export function isWithinWindows(instant: Date, windows: TimeWindow[]): boolean {
  const time = instant.getTime();
  return windows.some(({ start, end }) => time >= start.getTime() && time < end.getTime());
}

export function limaDateKey(instant: Date): string {
  return new Date(instant.getTime() - limaOffsetMillis).toISOString().slice(0, 10);
}
