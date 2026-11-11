export const maximumScheduleRows = 1000;

export type PaymentScheduleRow = {
  line: number;
  date: string;
  group: string;
  description: string | null;
};

export type CsvLineError = { line: number; message: string };

/** Lector CSV mínimo: comillas dobles, "" escapado, separador "," o ";" (Excel en español). */
export function parseCsv(text: string): string[][] {
  const content = text.replace(/^\uFEFF/, "");
  const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = firstLine.includes(";") && !firstLine.includes(",") ? ";" : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (quoted) {
      if (char === "\"" && content[index + 1] === "\"") {
        field += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === "\"" && field === "") {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && content[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function parseCalendarDate(value: string): string | null {
  const trimmed = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  const local = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  const [year, month, day] = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : local
      ? [Number(local[3]), Number(local[2]), Number(local[1])]
      : [NaN, NaN, NaN];
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

/** Valida el archivo completo; si hay errores, la importación se rechaza entera. */
export function parsePaymentSchedule(text: string): { rows: PaymentScheduleRow[]; errors: CsvLineError[] } {
  const errors: CsvLineError[] = [];
  const table = parseCsv(text);
  const header = (table[0] ?? []).map(normalizeHeader);
  const dateColumn = header.indexOf("fecha");
  const groupColumn = header.indexOf("grupo");
  const descriptionColumn = header.indexOf("descripcion");
  if (dateColumn === -1 || groupColumn === -1) {
    return {
      rows: [],
      errors: [{ line: 1, message: "La cabecera debe incluir las columnas fecha y grupo (descripcion es opcional)" }],
    };
  }

  const rows: PaymentScheduleRow[] = [];
  const seen = new Map<string, number>();
  table.slice(1).forEach((cells, index) => {
    const line = index + 2;
    if (cells.every((cell) => cell.trim() === "")) return;
    if (cells.length > header.length) {
      errors.push({ line, message: `Tiene ${cells.length} columnas; la cabecera define ${header.length}` });
      return;
    }

    const date = parseCalendarDate(cells[dateColumn] ?? "");
    const group = (cells[groupColumn] ?? "").trim().toUpperCase();
    const description = descriptionColumn === -1 ? "" : (cells[descriptionColumn] ?? "").trim();
    if (!date) {
      errors.push({ line, message: `Fecha inválida "${(cells[dateColumn] ?? "").trim()}": usa AAAA-MM-DD o DD/MM/AAAA` });
    }
    if (group.length < 2 || group.length > 60) {
      errors.push({ line, message: "El grupo es obligatorio y debe tener entre 2 y 60 caracteres" });
    }
    if (description.length > 200) {
      errors.push({ line, message: "La descripción admite hasta 200 caracteres" });
    }
    if (!date || group.length < 2 || group.length > 60 || description.length > 200) return;

    const key = `${date}|${group}`;
    const firstLine = seen.get(key);
    if (firstLine) {
      errors.push({ line, message: `Duplica la fecha ${date} del grupo ${group} (línea ${firstLine})` });
      return;
    }
    seen.set(key, line);
    rows.push({ line, date, group, description: description || null });
  });

  if (rows.length === 0 && errors.length === 0) {
    errors.push({ line: 2, message: "El archivo no contiene fechas de pago" });
  }
  if (rows.length > maximumScheduleRows) {
    errors.push({ line: maximumScheduleRows + 2, message: `Se admiten hasta ${maximumScheduleRows} filas por importación` });
  }
  return { rows, errors };
}
