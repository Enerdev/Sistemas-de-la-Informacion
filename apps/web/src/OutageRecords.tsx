import { useEffect, useState } from "react";
import { apiRequest } from "./api";

type OutageRecord = {
  id: string;
  code: string;
  kind: "FAILURE" | "MAINTENANCE";
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  channels: string;
  symptoms: string;
  paymentOverlap: "YES" | "NO" | "UNKNOWN";
  officialStatement: boolean | null;
  confidence: "OFFICIAL" | "PRESS_WITH_STATEMENT" | "PRESS" | "UNVERIFIED";
  note: string | null;
  sourceUrl: string;
};

const kindLabels: Record<OutageRecord["kind"], string> = { FAILURE: "Falla", MAINTENANCE: "Mantenimiento" };
const overlapLabels: Record<OutageRecord["paymentOverlap"], string> = { YES: "Sí", NO: "No", UNKNOWN: "No determinado" };
const confidenceLabels: Record<OutageRecord["confidence"], string> = {
  OFFICIAL: "Oficial (bn.com.pe)",
  PRESS_WITH_STATEMENT: "Prensa con comunicado",
  PRESS: "Prensa",
  UNVERIFIED: "No verificado",
};

function formatDay(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" });
}

function formatPeriod(record: OutageRecord): string {
  const days = record.startDate === record.endDate
    ? formatDay(record.startDate)
    : `${formatDay(record.startDate)} – ${formatDay(record.endDate)}`;
  return record.startTime ? `${days} · ${record.startTime}–${record.endTime ?? "?"}` : days;
}

/** Antecedentes reales de fuentes públicas; se muestran aparte porque SIMONA-BN no los midió. */
export function OutageRecordsSection({ setNotice }: { setNotice: (message: string) => void }) {
  const [records, setRecords] = useState<OutageRecord[] | null>(null);
  const [onlyFailures, setOnlyFailures] = useState(false);

  useEffect(() => {
    apiRequest<OutageRecord[]>("/api/outage-records")
      .then(setRecords)
      .catch((error: unknown) => setNotice(error instanceof Error ? error.message : "No se pudo cargar el registro de caídas"));
  }, [setNotice]);

  if (!records) return null;
  const failures = records.filter((record) => record.kind === "FAILURE");
  const visible = onlyFailures ? failures : records;

  return (
    <div className="recipient-section outage-records">
      <h3>Registro público de caídas del Banco de la Nación</h3>
      <p className="scope-note">
        Antecedentes <strong>reales</strong> tomados de comunicados del BN y de la prensa. SIMONA-BN no los midió:
        las fuentes no publican horas de inicio ni de fin, por eso no entran en la disponibilidad ni en los tiempos medios de arriba.
      </p>
      {records.length === 0 ? (
        <p className="scope-note">Aún no hay registros. Cárgalos con <code>npm run db:seed:outages</code>.</p>
      ) : (
        <>
          <p className="indicator-period">
            {failures.length} fallas no programadas, {failures.filter((record) => record.paymentOverlap === "YES").length} en fechas de pago
            {" · "}{records.length - failures.length} mantenimientos anunciados
          </p>
          <label className="outage-filter">
            <input type="checkbox" checked={onlyFailures} onChange={(event) => setOnlyFailures(event.target.checked)} />
            Mostrar solo fallas
          </label>
          <div className="indicator-table-wrap">
            <table className="indicator-table">
              <caption>Antecedentes de fuentes públicas</caption>
              <thead>
                <tr>
                  <th scope="col">Código</th>
                  <th scope="col">Fecha</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Canales</th>
                  <th scope="col">Síntomas</th>
                  <th scope="col">¿Día de pago?</th>
                  <th scope="col">Confirmación</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((record) => (
                  <tr key={record.id}>
                    <th scope="row">
                      {record.code}
                      <span><a className="text-link" href={record.sourceUrl} target="_blank" rel="noopener noreferrer">Fuente</a></span>
                    </th>
                    <td>{formatPeriod(record)}</td>
                    <td>{kindLabels[record.kind]}</td>
                    <td>{record.channels}</td>
                    <td>
                      {record.symptoms}
                      {record.note && <span className="indicator-muted outage-note">{record.note}</span>}
                    </td>
                    <td>
                      {record.paymentOverlap === "YES"
                        ? <span className="below-target"><span aria-hidden="true">⚠</span> Sí</span>
                        : overlapLabels[record.paymentOverlap]}
                    </td>
                    <td>
                      {record.confidence === "UNVERIFIED"
                        ? <span className="indicator-muted">{confidenceLabels[record.confidence]}</span>
                        : confidenceLabels[record.confidence]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
