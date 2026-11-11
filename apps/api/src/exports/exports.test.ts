import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app.js";
import { csvCell, renderCsv } from "./csv.js";
import { renderPdf } from "./pdf.js";
import type { Report } from "./report.js";
import { exportQuerySchemas } from "./routes.js";

const report: Report = {
  title: "Reporte de prueba",
  fileName: "prueba",
  meta: [["Periodo", "2025-03-01 a 2025-03-03"]],
  summary: [["Filas", "2"]],
  columns: [
    { key: "channel", label: "Canal" },
    { key: "value", label: "Disponibilidad (%)", align: "right" },
  ],
  rows: [
    { channel: "App BN", value: 95.833 },
    { channel: "=HYPERLINK(\"http://x\")", value: null },
  ],
  notes: ["Datos simulados."],
};

describe("CSV export", () => {
  it("quotes separators and neutralizes spreadsheet formulas", () => {
    expect(csvCell("Pago, primer grupo")).toBe("\"Pago, primer grupo\"");
    expect(csvCell("dijo \"hola\"")).toBe("\"dijo \"\"hola\"\"\"");
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("-5 min")).toBe("'-5 min");
    expect(csvCell(-98.991)).toBe("-98.991");
    expect(csvCell(null)).toBe("");
  });

  it("writes a UTF-8 BOM, header and CRLF rows", () => {
    const text = renderCsv(report).toString("utf8");
    expect(text.startsWith("﻿Canal,Disponibilidad (%)\r\n")).toBe(true);
    expect(text).toContain("App BN,95.833\r\n");
    expect(text).toContain("\"'=HYPERLINK(\"\"http://x\"\")\",\r\n");
  });
});

describe("PDF export", () => {
  it("renders a valid PDF and paginates long tables without blank pages", async () => {
    const short = await renderPdf(report, new Date("2025-03-03T05:00:00.000Z"));
    expect(short.subarray(0, 5).toString()).toBe("%PDF-");
    expect(short.toString("latin1")).toMatch(/\/Type \/Pages\s*\/Count 1\b/);

    const long = await renderPdf(
      { ...report, rows: Array.from({ length: 150 }, (_, index) => ({ channel: `Canal ${index}`, value: index })) },
      new Date("2025-03-03T05:00:00.000Z"),
    );
    const pages = Number(/\/Type \/Pages\s*\/Count (\d+)/.exec(long.toString("latin1"))?.[1]);
    expect(pages).toBeGreaterThan(1);
    // Con el error del pie de página salían el doble de páginas (12).
    expect(pages).toBeLessThanOrEqual(8);
  });
});

describe("export routes", () => {
  it("validates periods and rejects parameters that do not belong to the report", () => {
    const period = { from: "2025-03-01T05:00:00.000Z", to: "2025-03-03T05:00:00.000Z" };
    expect(exportQuerySchemas.availability.parse(period)).toMatchObject({ target: 99, granularity: "channel" });
    expect(exportQuerySchemas.availability.safeParse({ ...period, granularity: "hour" }).success).toBe(false);
    expect(exportQuerySchemas.incidents.safeParse({ ...period, target: "99" }).success).toBe(false);
    expect(exportQuerySchemas.exceptions.safeParse({ from: period.to, to: period.from }).success).toBe(false);
    expect(exportQuerySchemas.exceptions.safeParse({ from: "2023-01-01T00:00:00.000Z", to: period.to }).success).toBe(false);
  });

  it("requires authentication", async () => {
    expect((await request(app).get("/api/exports/availability.csv")).status).toBe(401);
    expect((await request(app).get("/api/exports/incidents.pdf")).status).toBe(401);
  });
});
