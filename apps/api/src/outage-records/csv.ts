import { OutageRecordKind, PaymentOverlap, SourceConfidence } from "@prisma/client";
import type { CsvLineError } from "../payment-schedule/csv.js";
import { normalizeHeader, parseCalendarDate, parseCsv } from "../payment-schedule/csv.js";

export const maximumOutageRows = 500;

export type OutageRecordRow = {
  line: number;
  code: string;
  kind: OutageRecordKind;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  channels: string;
  symptoms: string;
  paymentOverlap: PaymentOverlap;
  officialStatement: boolean | null;
  confidence: SourceConfidence;
  note: string | null;
  sourceUrl: string;
};

const requiredHeaders = [
  "codigo", "tipo", "fecha_inicio", "fecha_fin", "canales", "sintomas",
  "coincide_con_pagos", "comunicado_oficial", "confirmacion", "fuente",
] as const;

const kinds: Record<string, OutageRecordKind> = {
  FALLA: OutageRecordKind.FAILURE,
  MANTENIMIENTO: OutageRecordKind.MAINTENANCE,
};
const overlaps: Record<string, PaymentOverlap> = {
  SI: PaymentOverlap.YES,
  NO: PaymentOverlap.NO,
  NO_DETERMINADO: PaymentOverlap.UNKNOWN,
};
const statements: Record<string, boolean | null> = { SI: true, NO: false, POR_CONFIRMAR: null };
const confidences: Record<string, SourceConfidence> = {
  OFICIAL: SourceConfidence.OFFICIAL,
  PRENSA_CON_COMUNICADO: SourceConfidence.PRESS_WITH_STATEMENT,
  PRENSA: SourceConfidence.PRESS,
  NO_VERIFICADO: SourceConfidence.UNVERIFIED,
};

const codeValue = (value: string) => value.trim().toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function parseTime(value: string): string | null | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(trimmed) ? trimmed : undefined;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Valida el registro público de caídas (docs/registro-caidas-bn.csv).
 * Igual que el cronograma: si una línea tiene errores, no se carga ninguna.
 */
export function parseOutageRecords(text: string): { rows: OutageRecordRow[]; errors: CsvLineError[] } {
  const errors: CsvLineError[] = [];
  const table = parseCsv(text);
  const header = (table[0] ?? []).map(normalizeHeader);
  const missing = requiredHeaders.filter((name) => !header.includes(name));
  if (missing.length > 0) {
    return { rows: [], errors: [{ line: 1, message: `Faltan columnas en la cabecera: ${missing.join(", ")}` }] };
  }
  const column = (cells: string[], name: string) => {
    const index = header.indexOf(name);
    return index === -1 ? "" : (cells[index] ?? "").trim();
  };

  const rows: OutageRecordRow[] = [];
  const seen = new Map<string, number>();
  table.slice(1).forEach((cells, index) => {
    const line = index + 2;
    if (cells.every((cell) => cell.trim() === "")) return;
    if (cells.length > header.length) {
      errors.push({ line, message: `Tiene ${cells.length} columnas; la cabecera define ${header.length}` });
      return;
    }
    const lineErrors: string[] = [];

    const code = column(cells, "codigo").toUpperCase();
    if (!/^RC-\d{4}$/.test(code)) lineErrors.push(`Código inválido "${code}": usa RC-0001`);
    const kind = kinds[codeValue(column(cells, "tipo"))];
    if (!kind) lineErrors.push("El tipo debe ser FALLA o MANTENIMIENTO");
    const startDate = parseCalendarDate(column(cells, "fecha_inicio"));
    const endDate = parseCalendarDate(column(cells, "fecha_fin"));
    if (!startDate || !endDate) lineErrors.push("Fechas inválidas: usa AAAA-MM-DD o DD/MM/AAAA");
    else if (endDate < startDate) lineErrors.push("La fecha de fin es anterior a la de inicio");
    const startTime = parseTime(column(cells, "hora_inicio"));
    const endTime = parseTime(column(cells, "hora_fin"));
    if (startTime === undefined || endTime === undefined) lineErrors.push("Las horas deben tener el formato HH:mm");
    const channels = column(cells, "canales");
    if (channels.length < 2 || channels.length > 300) lineErrors.push("Canales: entre 2 y 300 caracteres");
    const symptoms = column(cells, "sintomas");
    if (symptoms.length < 2 || symptoms.length > 500) lineErrors.push("Síntomas: entre 2 y 500 caracteres");
    const paymentOverlap = overlaps[codeValue(column(cells, "coincide_con_pagos"))];
    if (!paymentOverlap) lineErrors.push("coincide_con_pagos debe ser SI, NO o NO_DETERMINADO");
    const statementKey = codeValue(column(cells, "comunicado_oficial"));
    if (!(statementKey in statements)) lineErrors.push("comunicado_oficial debe ser SI, NO o POR_CONFIRMAR");
    const confidence = confidences[codeValue(column(cells, "confirmacion"))];
    if (!confidence) lineErrors.push("confirmacion debe ser OFICIAL, PRENSA_CON_COMUNICADO, PRENSA o NO_VERIFICADO");
    const note = column(cells, "observacion");
    if (note.length > 500) lineErrors.push("La observación admite hasta 500 caracteres");
    const sourceUrl = column(cells, "fuente");
    if (!isHttpsUrl(sourceUrl) || sourceUrl.length > 500) lineErrors.push("La fuente debe ser una URL https de hasta 500 caracteres");

    const firstLine = seen.get(code);
    if (firstLine) lineErrors.push(`Duplica el código ${code} (línea ${firstLine})`);

    if (lineErrors.length > 0) {
      errors.push(...lineErrors.map((message) => ({ line, message })));
      return;
    }
    seen.set(code, line);
    rows.push({
      line,
      code,
      kind: kind!,
      startDate: startDate!,
      endDate: endDate!,
      startTime: startTime ?? null,
      endTime: endTime ?? null,
      channels,
      symptoms,
      paymentOverlap: paymentOverlap!,
      officialStatement: statements[statementKey]!,
      confidence: confidence!,
      note: note || null,
      sourceUrl,
    });
  });

  if (rows.length === 0 && errors.length === 0) {
    errors.push({ line: 2, message: "El archivo no contiene registros" });
  }
  if (rows.length > maximumOutageRows) {
    errors.push({ line: maximumOutageRows + 2, message: `Se admiten hasta ${maximumOutageRows} registros` });
  }
  return { rows, errors };
}
