import type { Report, ReportCell } from "./report.js";

const formulaPrefixes = ["=", "+", "-", "@", "\t", "\r"];

/** Evita que Excel interprete texto como fórmula (inyección CSV) y aplica el escapado RFC 4180. */
export function csvCell(value: ReportCell): string {
  if (value === null) return "";
  let text = String(value);
  if (typeof value === "string" && formulaPrefixes.some((prefix) => text.startsWith(prefix))) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

/** CSV UTF-8 con BOM (para que Excel reconozca tildes), separador coma y punto decimal. */
export function renderCsv(report: Report): Buffer {
  const lines = [
    report.columns.map(({ label }) => csvCell(label)).join(","),
    ...report.rows.map((row) => report.columns.map(({ key }) => csvCell(row[key] ?? null)).join(",")),
  ];
  return Buffer.from(`\uFEFF${lines.join("\r\n")}\r\n`, "utf8");
}
