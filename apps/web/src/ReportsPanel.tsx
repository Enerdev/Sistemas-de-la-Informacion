import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "./api";
import { reportStatusLabels } from "./PublicPortal";

type ReportStatus = keyof typeof reportStatusLabels;

type FailureReport = {
  id: string;
  referenceCode: string;
  status: ReportStatus;
  description: string;
  contactEmail: string | null;
  occurredAt: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  channel: { id: string; code: string; name: string; currentStatus: string };
  incident: { id: string; status: string; summary: string; detectedAt: string } | null;
  reviewedBy: { email: string } | null;
};

type IncidentOption = { id: string; summary: string; status: string; detectedAt: string };

const staffStatusLabels: Record<ReportStatus, string> = {
  NEW: "NUEVO",
  REVIEWED: "REVISADO",
  LINKED: "VINCULADO",
  DISMISSED: "DESCARTADO",
};

export function ReportsPanel({ setNotice }: { setNotice: (message: string) => void }) {
  const [reports, setReports] = useState<FailureReport[]>([]);
  const [statusFilter, setStatusFilter] = useState("NEW");
  const [selected, setSelected] = useState<FailureReport | null>(null);
  const [incidents, setIncidents] = useState<IncidentOption[]>([]);
  const [incidentId, setIncidentId] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadReports = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (statusFilter) params.set("status", statusFilter);
      const data = await apiRequest<{ reports: FailureReport[] }>(`/api/reports?${params.toString()}`);
      setReports(data.reports);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudieron cargar los reportes");
    } finally {
      setLoading(false);
    }
  }, [setNotice, statusFilter]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  async function select(report: FailureReport) {
    setSelected(report);
    setIncidentId(report.incident?.id ?? "");
    setNote(report.reviewNote ?? "");
    try {
      const data = await apiRequest<{ incidents: IncidentOption[] }>(
        `/api/incidents?channelId=${report.channel.id}&limit=20`,
      );
      setIncidents(data.incidents);
    } catch {
      setIncidents([]);
    }
  }

  async function review(status: Exclude<ReportStatus, "NEW">) {
    if (!selected) return;
    setSaving(true);
    try {
      const { report } = await apiRequest<{ report: FailureReport }>(`/api/reports/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status,
          ...(status === "LINKED" ? { incidentId } : {}),
          ...(note.trim() ? { note } : {}),
        }),
      });
      setSelected(report);
      setNotice(`Reporte ${report.referenceCode}: ${staffStatusLabels[report.status]}.`);
      await loadReports();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo actualizar el reporte");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="incident-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">PORTAL PÚBLICO M4</p>
          <h2>Reportes de fallas</h2>
        </div>
        <a className="simulation-label" href="/estado" target="_blank" rel="noreferrer">
          <span /> Abrir portal público
        </a>
      </div>

      <form
        className="incident-filters notification-filters"
        onSubmit={(event) => {
          event.preventDefault();
          void loadReports();
        }}
      >
        <label>
          Estado
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="">Todos</option>
            {Object.entries(staffStatusLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <button className="toggle-button" type="submit" disabled={loading}>
          {loading ? "Cargando…" : "Filtrar"}
        </button>
      </form>

      <div className="incident-layout">
        <div className="incident-list" aria-live="polite">
          {reports.length === 0 && !loading && (
            <div className="empty-state">
              <h3>No hay reportes para este filtro</h3>
              <p>Los reportes llegan desde el formulario del portal público.</p>
            </div>
          )}
          {reports.map((report) => (
            <button
              className={`incident-list-item ${selected?.id === report.id ? "selected" : ""}`}
              key={report.id}
              onClick={() => void select(report)}
            >
              <span className={`notification-status report-${report.status.toLowerCase()}`}>
                {staffStatusLabels[report.status]}
              </span>
              <strong>{report.channel.name} · {report.referenceCode}</strong>
              <span>{report.description.slice(0, 90)}{report.description.length > 90 ? "…" : ""}</span>
              <time dateTime={report.createdAt}>{new Date(report.createdAt).toLocaleString("es-PE")}</time>
            </button>
          ))}
        </div>

        {selected ? (
          <article className="incident-detail">
            <div className="incident-detail-heading">
              <div>
                <p className="eyebrow">{selected.referenceCode}</p>
                <h3>Reporte sobre {selected.channel.name}</h3>
              </div>
              <span className={`notification-status report-${selected.status.toLowerCase()}`}>
                {staffStatusLabels[selected.status]}
              </span>
            </div>
            <dl className="incident-dates">
              <div><dt>Recibido</dt><dd>{new Date(selected.createdAt).toLocaleString("es-PE")}</dd></div>
              <div><dt>Ocurrió</dt><dd>{selected.occurredAt ? new Date(selected.occurredAt).toLocaleString("es-PE") : "No indicado"}</dd></div>
              <div><dt>Contacto</dt><dd>{selected.contactEmail ?? "No indicado"}</dd></div>
              <div><dt>Revisión</dt><dd>{selected.reviewedAt ? `${new Date(selected.reviewedAt).toLocaleString("es-PE")} · ${selected.reviewedBy?.email ?? ""}` : "Pendiente"}</dd></div>
            </dl>
            <div className="incident-evidence">
              <h4>Descripción del ciudadano</h4>
              <pre>{selected.description}</pre>
              {selected.incident && <p className="evidence-source">Vinculado a: {selected.incident.summary} ({selected.incident.status})</p>}
            </div>
            <div className="report-review">
              <label>
                Incidencia del mismo canal
                <select value={incidentId} onChange={(event) => setIncidentId(event.target.value)}>
                  <option value="">Sin vincular</option>
                  {incidents.map((incident) => (
                    <option key={incident.id} value={incident.id}>
                      {new Date(incident.detectedAt).toLocaleString("es-PE")} · {incident.summary} ({incident.status})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Nota de revisión (opcional)
                <input maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
              </label>
              <div className="report-actions">
                <button className="primary-button" disabled={saving || !incidentId} onClick={() => void review("LINKED")}>
                  Vincular a incidencia
                </button>
                <button className="toggle-button" disabled={saving} onClick={() => void review("REVIEWED")}>
                  Marcar revisado
                </button>
                <button className="toggle-button" disabled={saving} onClick={() => void review("DISMISSED")}>
                  Descartar
                </button>
              </div>
            </div>
          </article>
        ) : (
          <div className="incident-detail incident-detail-empty">
            <p>Selecciona un reporte para revisarlo y vincularlo a una incidencia.</p>
          </div>
        )}
      </div>
      <p className="scope-note">El correo de contacto solo es visible para ADMIN y OPERATOR. El ciudadano consulta el estado con su código de seguimiento.</p>
    </section>
  );
}
