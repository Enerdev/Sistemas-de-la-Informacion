import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "./api";

type ChannelStatus = "UNKNOWN" | "AVAILABLE" | "DEGRADED" | "UNAVAILABLE" | "MAINTENANCE";

type Durations = { operationalMs: number; downMs: number; maintenanceMs: number; unknownMs: number };

type ChannelIndicator = {
  id: string;
  code: string;
  name: string;
  currentStatus: ChannelStatus;
  availabilityPercent: number | null;
  paymentDayAvailabilityPercent: number | null;
  durations: Durations;
  incidents: number;
  incidentsOnPaymentDays: number;
  meanTimeToRestoreMs: number | null;
  belowTarget: boolean;
  belowTargetOnPaymentDays: boolean;
};

type Indicators = {
  period: { from: string; to: string };
  targetPercent: number;
  summary: {
    availabilityPercent: number | null;
    paymentDayAvailabilityPercent: number | null;
    meanTimeToDetectMs: number | null;
    meanTimeToRestoreMs: number | null;
    meanTimeToResolveMs: number | null;
    meanTimeToCommunicateMs: number | null;
    incidents: number;
    incidentsOnPaymentDays: number;
    notifications: { sent: number; failed: number; pending: number; deliveryRatePercent: number | null };
    paymentDaysInPeriod: number;
  };
  channels: ChannelIndicator[];
  exceptions: Array<{ id: string; name: string; paymentDayAvailabilityPercent: number | null }>;
  paymentDates: Array<{ date: string; group: string; description: string | null }>;
};

type PaymentDate = { id: string; date: string; group: string; description: string | null };
type ScheduleImport = {
  id: string;
  fileName: string;
  rowCount: number;
  createdCount: number;
  updatedCount: number;
  importedAt: string;
  importedBy: { email: string } | null;
};

type ImportError = Error & { details?: Array<{ field: string; message: string }> };

const statusLabels: Record<ChannelStatus, string> = {
  UNKNOWN: "Sin verificar",
  AVAILABLE: "OPERATIVO",
  DEGRADED: "DEGRADADO",
  UNAVAILABLE: "CAÍDO",
  MAINTENANCE: "MANTENIMIENTO",
};

const presets = [
  { value: "1", label: "Últimas 24 horas" },
  { value: "7", label: "Últimos 7 días" },
  { value: "30", label: "Últimos 30 días" },
  { value: "90", label: "Últimos 90 días" },
  { value: "custom", label: "Personalizado" },
];

function formatPercent(value: number | null): string {
  if (value === null) return "Sin datos";
  return `${value.toLocaleString("es-PE", { maximumFractionDigits: value >= 99.9 && value < 100 ? 3 : 2 })} %`;
}

export function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null) return "Sin datos";
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ${seconds % 60} s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}

function localDateInput(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function periodFor(preset: string, customFrom: string, customTo: string): { from: Date; to: Date } {
  if (preset === "custom") {
    return {
      from: new Date(`${customFrom}T00:00:00`),
      to: new Date(`${customTo}T23:59:59.999`),
    };
  }
  const to = new Date();
  return { from: new Date(to.getTime() - Number(preset) * 24 * 60 * 60 * 1000), to };
}

async function uploadSchedule(fileName: string, content: string) {
  const response = await fetch("/api/payment-schedule/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName, content }),
  });
  const body = (await response.json()) as {
    data?: { import: ScheduleImport };
    error?: { message?: string; details?: Array<{ field: string; message: string }> };
  };
  if (!response.ok || !body.data) {
    const error: ImportError = new Error(body.error?.message ?? `La importación falló (${response.status})`);
    error.details = body.error?.details;
    throw error;
  }
  return body.data.import;
}

function AvailabilityMeter({ value, target }: { value: number | null; target: number }) {
  if (value === null) return <span className="indicator-muted">Sin datos</span>;
  return (
    <div className="availability-meter" title={`${formatPercent(value)} (meta ${target} %)`}>
      <span className="availability-meter-track">
        <span className="availability-meter-fill" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
        <span className="availability-meter-target" style={{ left: `${target}%` }} />
      </span>
      <span>{formatPercent(value)}</span>
    </div>
  );
}

function BelowTarget({ show }: { show: boolean }) {
  return show ? <span className="below-target"><span aria-hidden="true">⚠</span> Bajo la meta</span> : null;
}

export function IndicatorsPanel({
  canImport,
  isAdmin,
  setNotice,
}: {
  canImport: boolean;
  isAdmin: boolean;
  setNotice: (message: string) => void;
}) {
  const today = localDateInput(new Date());
  const [preset, setPreset] = useState("30");
  const [customFrom, setCustomFrom] = useState(localDateInput(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)));
  const [customTo, setCustomTo] = useState(today);
  const [target, setTarget] = useState("99");
  const [indicators, setIndicators] = useState<Indicators | null>(null);
  const [loading, setLoading] = useState(false);

  const [dates, setDates] = useState<PaymentDate[]>([]);
  const [imports, setImports] = useState<ScheduleImport[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importErrors, setImportErrors] = useState<Array<{ field: string; message: string }>>([]);
  const [importMessage, setImportMessage] = useState("");

  const loadIndicators = useCallback(async () => {
    setLoading(true);
    try {
      const { from, to } = periodFor(preset, customFrom, customTo);
      const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), target });
      setIndicators(await apiRequest<Indicators>(`/api/indicators?${params.toString()}`));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudieron calcular los indicadores");
    } finally {
      setLoading(false);
    }
  }, [customFrom, customTo, preset, setNotice, target]);

  const loadSchedule = useCallback(async () => {
    try {
      const data = await apiRequest<{ dates: PaymentDate[]; imports: ScheduleImport[] }>(
        `/api/payment-schedule?from=${localDateInput(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000))}`,
      );
      setDates(data.dates);
      setImports(data.imports);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo cargar el cronograma");
    }
  }, [setNotice]);

  useEffect(() => {
    // Solo al abrir la pestaña; luego el usuario recalcula con el botón.
    void loadIndicators();
  }, []);

  useEffect(() => {
    void loadSchedule();
  }, [loadSchedule]);

  async function importFile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    setImporting(true);
    setImportErrors([]);
    setImportMessage("");
    try {
      const summary = await uploadSchedule(file.name, await file.text());
      setImportMessage(
        `${summary.fileName}: ${summary.rowCount} fechas importadas (${summary.createdCount} nuevas, ${summary.updatedCount} actualizadas).`,
      );
      await Promise.all([loadSchedule(), loadIndicators()]);
    } catch (error) {
      const importError = error as ImportError;
      setImportMessage(importError.message);
      setImportErrors(importError.details ?? []);
    } finally {
      setImporting(false);
    }
  }

  async function removeDate(id: string) {
    try {
      await apiRequest(`/api/payment-schedule/${id}`, { method: "DELETE" });
      await Promise.all([loadSchedule(), loadIndicators()]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo eliminar la fecha");
    }
  }

  const summary = indicators?.summary;
  const tiles = summary
    ? [
        {
          label: "Disponibilidad global",
          value: formatPercent(summary.availabilityPercent),
          formula: "Tiempo operativo ÷ (operativo + caído) × 100",
          alert: summary.availabilityPercent !== null && summary.availabilityPercent < indicators.targetPercent,
        },
        {
          label: "Disponibilidad en fechas de pago",
          value: formatPercent(summary.paymentDayAvailabilityPercent),
          formula: `${summary.paymentDaysInPeriod} día(s) de pago en el periodo`,
          alert: summary.paymentDayAvailabilityPercent !== null
            && summary.paymentDayAvailabilityPercent < indicators.targetPercent,
        },
        {
          label: "Tiempo medio de detección",
          value: formatDuration(summary.meanTimeToDetectMs),
          formula: "Σ(detección − inicio real) ÷ incidencias",
        },
        {
          label: "Tiempo medio de restablecimiento",
          value: formatDuration(summary.meanTimeToRestoreMs),
          formula: "Σ(recuperación técnica − inicio real) ÷ incidencias recuperadas",
        },
        {
          label: "Tiempo medio de comunicación",
          value: formatDuration(summary.meanTimeToCommunicateMs),
          formula: "Primera alerta enviada − detección",
        },
        {
          label: "Notificaciones entregadas",
          value: formatPercent(summary.notifications.deliveryRatePercent),
          formula: `${summary.notifications.sent} enviadas · ${summary.notifications.failed} fallidas · ${summary.notifications.pending} pendientes`,
        },
        {
          label: "Incidencias",
          value: summary.incidents.toString(),
          formula: `${summary.incidentsOnPaymentDays} en fechas de pago`,
        },
        {
          label: "Tiempo medio de resolución",
          value: formatDuration(summary.meanTimeToResolveMs),
          formula: "Resolución administrativa − detección",
        },
      ]
    : [];

  return (
    <section className="incident-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">PANEL M5 · JEFATURA DE TI</p>
          <h2>Indicadores</h2>
        </div>
        <span className="simulation-label"><span /> Calculado con datos simulados</span>
      </div>

      <form
        className="incident-filters indicator-filters"
        onSubmit={(event) => {
          event.preventDefault();
          void loadIndicators();
        }}
      >
        <label>
          Periodo
          <select value={preset} onChange={(event) => setPreset(event.target.value)}>
            {presets.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        {preset === "custom" && (
          <>
            <label>
              Desde
              <input type="date" required max={customTo} value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} />
            </label>
            <label>
              Hasta
              <input type="date" required min={customFrom} max={today} value={customTo} onChange={(event) => setCustomTo(event.target.value)} />
            </label>
          </>
        )}
        <label>
          Meta de disponibilidad (%)
          <input type="number" required min={50} max={100} step={0.1} value={target} onChange={(event) => setTarget(event.target.value)} />
        </label>
        <button className="toggle-button" type="submit" disabled={loading}>
          {loading ? "Calculando…" : "Calcular"}
        </button>
      </form>

      {indicators && (
        <>
          <p className="indicator-period">
            Periodo: {new Date(indicators.period.from).toLocaleString("es-PE")} — {new Date(indicators.period.to).toLocaleString("es-PE")}
          </p>
          <div className="indicator-tiles">
            {tiles.map((tile) => (
              <article className="indicator-tile" key={tile.label}>
                <span>{tile.label}</span>
                <strong>{tile.value}</strong>
                {tile.alert && <BelowTarget show />}
                <small>{tile.formula}</small>
              </article>
            ))}
          </div>

          <div className={`indicator-exceptions ${indicators.exceptions.length > 0 ? "has-exceptions" : ""}`}>
            <h3>Reporte por excepción: canales bajo la meta en fechas de pago</h3>
            {indicators.summary.paymentDaysInPeriod === 0 ? (
              <p>No hay fechas de pago en el periodo. Importa el cronograma para evaluar los días críticos.</p>
            ) : indicators.exceptions.length === 0 ? (
              <p>Ningún canal estuvo por debajo de {indicators.targetPercent} % en las fechas de pago del periodo.</p>
            ) : (
              <ul>
                {indicators.exceptions.map((exception) => (
                  <li key={exception.id}>
                    <span aria-hidden="true">⚠</span> {exception.name}: {formatPercent(exception.paymentDayAvailabilityPercent)}
                    {" "}(meta {indicators.targetPercent} %)
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="indicator-table-wrap">
            <table className="indicator-table">
              <caption>Indicadores por canal</caption>
              <thead>
                <tr>
                  <th scope="col">Canal</th>
                  <th scope="col">Estado actual</th>
                  <th scope="col">Disponibilidad</th>
                  <th scope="col">En fechas de pago</th>
                  <th scope="col">Tiempo caído</th>
                  <th scope="col">Incidencias</th>
                  <th scope="col">Restablecimiento medio</th>
                </tr>
              </thead>
              <tbody>
                {indicators.channels.map((channel) => (
                  <tr key={channel.id}>
                    <th scope="row">
                      {channel.name}
                      <span>{channel.code}</span>
                    </th>
                    <td>
                      <span className={`channel-status status-${channel.currentStatus.toLowerCase()}`}>
                        <span />{statusLabels[channel.currentStatus]}
                      </span>
                    </td>
                    <td>
                      <AvailabilityMeter value={channel.availabilityPercent} target={indicators.targetPercent} />
                      <BelowTarget show={channel.belowTarget} />
                    </td>
                    <td>
                      <AvailabilityMeter value={channel.paymentDayAvailabilityPercent} target={indicators.targetPercent} />
                      <BelowTarget show={channel.belowTargetOnPaymentDays} />
                    </td>
                    <td>{formatDuration(channel.durations.downMs)}</td>
                    <td>{channel.incidents} <span className="indicator-muted">({channel.incidentsOnPaymentDays} en pago)</span></td>
                    <td>{formatDuration(channel.meanTimeToRestoreMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="scope-note">
            DEGRADADO cuenta como operativo; MANTENIMIENTO y "Sin verificar" se excluyen del tiempo total. El inicio real es el primer fallo de la racha que llevó a detectar la caída.
          </p>
        </>
      )}

      <div className="recipient-section schedule-section">
        <h3>Cronograma de pagos</h3>
        <p className="scope-note">
          CSV con columnas <code>fecha,grupo,descripcion</code> (fecha AAAA-MM-DD o DD/MM/AAAA; separador coma o punto y coma).
          {" "}<a className="text-link" href="/ejemplos/cronograma-pagos-ejemplo.csv" download>Descargar ejemplo ficticio</a>.
          Si una fila tiene errores, no se importa ninguna.
        </p>
        {canImport && (
          <form className="recipient-form" onSubmit={(event) => void importFile(event)}>
            <input
              type="file"
              accept=".csv,text/csv"
              aria-label="Archivo CSV del cronograma"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <button className="primary-button" type="submit" disabled={!file || importing}>
              {importing ? "Importando…" : "Importar cronograma"}
            </button>
          </form>
        )}
        {importMessage && (
          <p className={importErrors.length > 0 ? "notice" : "portal-success"} role="status">{importMessage}</p>
        )}
        {importErrors.length > 0 && (
          <ul className="import-errors">
            {importErrors.map((error) => <li key={`${error.field}-${error.message}`}><strong>{error.field}:</strong> {error.message}</li>)}
          </ul>
        )}
        <ul className="recipient-list">
          {dates.length === 0 && <li>No hay fechas de pago registradas desde hace 90 días.</li>}
          {dates.map((paymentDate) => (
            <li key={paymentDate.id}>
              <div>
                <strong>{new Date(`${paymentDate.date}T12:00:00`).toLocaleDateString("es-PE", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })} · {paymentDate.group}</strong>
                <span>{paymentDate.description ?? "Sin descripción"}</span>
              </div>
              {isAdmin && (
                <button className="toggle-button" onClick={() => void removeDate(paymentDate.id)}>Eliminar</button>
              )}
            </li>
          ))}
        </ul>
        {imports.length > 0 && (
          <p className="scope-note">
            Última importación: {imports[0]!.fileName} · {new Date(imports[0]!.importedAt).toLocaleString("es-PE")} · {imports[0]!.importedBy?.email ?? "usuario eliminado"} · {imports[0]!.rowCount} filas
          </p>
        )}
      </div>
    </section>
  );
}
