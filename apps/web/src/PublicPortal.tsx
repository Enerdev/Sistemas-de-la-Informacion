import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "./api";

type ChannelStatus = "UNKNOWN" | "AVAILABLE" | "DEGRADED" | "UNAVAILABLE" | "MAINTENANCE";
type IncidentStatus = "OPEN" | "ACKNOWLEDGED" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
type ReportStatus = "NEW" | "REVIEWED" | "LINKED" | "DISMISSED";

type PublicChannel = {
  id: string;
  code: string;
  name: string;
  type: "APP" | "INTERNET_BANKING" | "MULTIRED_VIRTUAL";
  currentStatus: ChannelStatus;
  lastCheckedAt: string | null;
};

type PublicIncident = {
  id: string;
  status: IncidentStatus;
  summary: string;
  detectedAt: string;
  recoveredAt: string | null;
  resolvedAt: string | null;
  channel: { code: string; name: string };
};

type ReportLookup = {
  referenceCode: string;
  status: ReportStatus;
  createdAt: string;
  reviewedAt: string | null;
  channel: { name: string };
  incident: { status: IncidentStatus; summary: string; recoveredAt: string | null } | null;
};

const statusLabels: Record<ChannelStatus, string> = {
  UNKNOWN: "Sin verificar",
  AVAILABLE: "Operativo",
  DEGRADED: "Degradado",
  UNAVAILABLE: "Caído",
  MAINTENANCE: "Mantenimiento",
};

const incidentLabels: Record<IncidentStatus, string> = {
  OPEN: "Detectada",
  ACKNOWLEDGED: "En atención",
  IN_PROGRESS: "En atención",
  RESOLVED: "Resuelta",
  CLOSED: "Cerrada",
};

export const reportStatusLabels: Record<ReportStatus, string> = {
  NEW: "Recibido",
  REVIEWED: "Revisado por el equipo de TI",
  LINKED: "Vinculado a una incidencia",
  DISMISSED: "Descartado tras la revisión",
};

const refreshMilliseconds = 30_000;

function formatDate(value: string): string {
  return new Date(value).toLocaleString("es-PE");
}

function overallSummary(channels: PublicChannel[]): { tone: string; title: string } {
  if (channels.some(({ currentStatus }) => currentStatus === "UNAVAILABLE")) {
    return { tone: "unavailable", title: "Hay canales con interrupción del servicio" };
  }
  if (channels.some(({ currentStatus }) => currentStatus === "DEGRADED")) {
    return { tone: "degraded", title: "Algunos canales funcionan con lentitud o fallos intermitentes" };
  }
  if (channels.some(({ currentStatus }) => currentStatus === "MAINTENANCE")) {
    return { tone: "maintenance", title: "Hay canales en mantenimiento programado" };
  }
  if (channels.length > 0 && channels.every(({ currentStatus }) => currentStatus === "AVAILABLE")) {
    return { tone: "available", title: "Todos los canales están operativos" };
  }
  return { tone: "unknown", title: "Aún no hay verificaciones para todos los canales" };
}

function toIsoOrEmpty(localValue: string): string {
  return localValue ? new Date(localValue).toISOString() : "";
}

function localNow(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

export function PublicPortal() {
  const [channels, setChannels] = useState<PublicChannel[]>([]);
  const [incidents, setIncidents] = useState<PublicIncident[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");

  const [channelId, setChannelId] = useState("");
  const [description, setDescription] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState("");
  const [submitted, setSubmitted] = useState<{ referenceCode: string; channel: string } | null>(null);

  const [lookupCode, setLookupCode] = useState("");
  const [lookup, setLookup] = useState<ReportLookup | null>(null);
  const [lookupError, setLookupError] = useState("");

  const load = useCallback(async () => {
    try {
      const [status, recent] = await Promise.all([
        apiRequest<{ channels: PublicChannel[]; generatedAt: string }>("/api/public/status"),
        apiRequest<{ incidents: PublicIncident[] }>("/api/public/incidents"),
      ]);
      setChannels(status.channels);
      setUpdatedAt(status.generatedAt);
      setIncidents(recent.incidents);
      setLoadError("");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "No se pudo consultar el estado");
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), refreshMilliseconds);
    return () => window.clearInterval(timer);
  }, [load]);

  async function submitReport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    setFormError("");
    try {
      const { report } = await apiRequest<{ report: { referenceCode: string; channel: { name: string } } }>(
        "/api/public/reports",
        {
          method: "POST",
          body: JSON.stringify({
            channelId,
            description,
            occurredAt: toIsoOrEmpty(occurredAt),
            contactEmail,
            website,
          }),
        },
      );
      setSubmitted({ referenceCode: report.referenceCode, channel: report.channel.name });
      setLookupCode(report.referenceCode);
      setDescription("");
      setOccurredAt("");
      setContactEmail("");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "No se pudo enviar el reporte");
    } finally {
      setSending(false);
    }
  }

  async function lookupReport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLookupError("");
    setLookup(null);
    try {
      const { report } = await apiRequest<{ report: ReportLookup }>(
        `/api/public/reports/${encodeURIComponent(lookupCode.trim().toUpperCase())}`,
      );
      setLookup(report);
    } catch (error) {
      setLookupError(error instanceof Error ? error.message : "No se pudo consultar el reporte");
    }
  }

  const summary = overallSummary(channels);
  const activeIncidents = incidents.filter(({ status }) => ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS"].includes(status));
  const pastIncidents = incidents.filter((incident) => !activeIncidents.includes(incident));

  return (
    <div className="dashboard-shell portal-shell">
      <header className="topbar">
        <a className="brand" href="/estado" aria-label="SIMONA-BN, estado de los canales">
          <span className="brand-mark" aria-hidden="true">S</span>
          <span>SIMONA<span className="brand-accent">-BN</span></span>
        </a>
        <nav aria-label="Portal público">
          <a className="nav-link active" href="#estado">Estado</a>
          <a className="nav-link" href="#incidencias">Incidencias</a>
          <a className="nav-link" href="#reportar">Reportar una falla</a>
        </nav>
        <a className="text-button portal-staff-link" href="/">Acceso del personal</a>
      </header>

      <main>
        <section className="dashboard-hero portal-hero" id="estado">
          <div>
            <p className="eyebrow"><span className="eyebrow-line" /> PORTAL PÚBLICO · DATOS SIMULADOS</p>
            <h1>Estado de los canales digitales</h1>
            <p>Consulta si los canales funcionan antes de intentar una operación y repórtanos una falla sin depender de redes sociales.</p>
          </div>
        </section>

        {loadError && <p className="notice" role="alert">{loadError}</p>}

        <section className={`portal-summary portal-${summary.tone}`} aria-live="polite">
          <span className="portal-summary-dot" aria-hidden="true" />
          <div>
            <strong>{summary.title}</strong>
            <span>{updatedAt ? `Actualizado ${formatDate(updatedAt)} · se actualiza cada 30 s` : "Consultando…"}</span>
          </div>
        </section>

        <section className="portal-section">
          <ul className="portal-channels">
            {channels.map((channel) => (
              <li key={channel.id}>
                <div>
                  <strong>{channel.name}</strong>
                  <span>
                    {channel.lastCheckedAt ? `Última verificación ${formatDate(channel.lastCheckedAt)}` : "Sin verificaciones"}
                  </span>
                </div>
                <span className={`channel-status status-${channel.currentStatus.toLowerCase()}`}>
                  <span />{statusLabels[channel.currentStatus]}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="portal-section" id="incidencias">
          <div className="section-heading">
            <div>
              <p className="eyebrow">ÚLTIMOS 7 DÍAS</p>
              <h2>Incidencias</h2>
            </div>
          </div>
          {incidents.length === 0 && (
            <div className="empty-state">
              <h3>Sin incidencias recientes</h3>
              <p>No se registraron interrupciones en los últimos 7 días.</p>
            </div>
          )}
          <ul className="portal-incidents">
            {[...activeIncidents, ...pastIncidents].map((incident) => (
              <li key={incident.id} className={activeIncidents.includes(incident) ? "active" : ""}>
                <div>
                  <strong>{incident.channel.name}: {incident.summary}</strong>
                  <span>
                    Detectada {formatDate(incident.detectedAt)}
                    {incident.recoveredAt && ` · servicio restablecido ${formatDate(incident.recoveredAt)}`}
                  </span>
                </div>
                <span className="portal-incident-status">{incidentLabels[incident.status]}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="portal-section portal-forms" id="reportar">
          <form className="portal-card" onSubmit={(event) => void submitReport(event)} noValidate={false}>
            <p className="eyebrow">REPORTAR UNA FALLA</p>
            <h2>¿Un canal no te funciona?</h2>
            <p className="portal-hint">
              Tu reporte llega al equipo de TI. No escribas contraseñas, números de tarjeta ni datos de tu cuenta.
            </p>
            {formError && <p className="notice" role="alert">{formError}</p>}
            {submitted && (
              <p className="portal-success" role="status">
                Recibimos tu reporte sobre {submitted.channel}. Tu código de seguimiento es{" "}
                <strong>{submitted.referenceCode}</strong>.
              </p>
            )}
            <label>
              Canal
              <select required value={channelId} onChange={(event) => setChannelId(event.target.value)}>
                <option value="">Selecciona un canal</option>
                {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
              </select>
            </label>
            <label>
              ¿Qué ocurrió?
              <textarea
                required
                minLength={10}
                maxLength={1000}
                rows={4}
                placeholder="Ejemplo: la aplicación muestra un error al iniciar sesión."
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
              <span className="field-hint">{description.trim().length}/1000 · mínimo 10 caracteres</span>
            </label>
            <label>
              ¿Cuándo ocurrió? (opcional)
              <input
                type="datetime-local"
                max={localNow()}
                value={occurredAt}
                onChange={(event) => setOccurredAt(event.target.value)}
              />
            </label>
            <label>
              Correo de contacto (opcional)
              <input
                type="email"
                maxLength={254}
                autoComplete="email"
                value={contactEmail}
                onChange={(event) => setContactEmail(event.target.value)}
              />
            </label>
            <label className="portal-trap" aria-hidden="true">
              Sitio web
              <input tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} />
            </label>
            <button className="primary-button" type="submit" disabled={sending}>
              {sending ? "Enviando…" : "Enviar reporte"}
            </button>
          </form>

          <form className="portal-card" onSubmit={(event) => void lookupReport(event)}>
            <p className="eyebrow">SEGUIMIENTO</p>
            <h2>Consulta tu reporte</h2>
            <label>
              Código de seguimiento
              <input
                required
                pattern="[Rr]-[A-Za-z2-9]{8}"
                placeholder="R-XXXXXXXX"
                value={lookupCode}
                onChange={(event) => setLookupCode(event.target.value)}
              />
            </label>
            <button className="primary-button" type="submit">Consultar</button>
            {lookupError && <p className="notice" role="alert">{lookupError}</p>}
            {lookup && (
              <dl className="incident-dates portal-lookup">
                <div><dt>Canal</dt><dd>{lookup.channel.name}</dd></div>
                <div><dt>Estado</dt><dd>{reportStatusLabels[lookup.status]}</dd></div>
                <div><dt>Enviado</dt><dd>{formatDate(lookup.createdAt)}</dd></div>
                <div><dt>Revisado</dt><dd>{lookup.reviewedAt ? formatDate(lookup.reviewedAt) : "Pendiente"}</dd></div>
                {lookup.incident && (
                  <div>
                    <dt>Incidencia vinculada</dt>
                    <dd>{lookup.incident.summary} · {incidentLabels[lookup.incident.status]}</dd>
                  </div>
                )}
              </dl>
            )}
          </form>
        </section>
      </main>

      <footer>
        <span>SIMONA-BN <span className="footer-separator">·</span> Proyecto académico</span>
        <span>No es un servicio del Banco de la Nación. Canales y datos simulados.</span>
      </footer>
    </div>
  );
}
