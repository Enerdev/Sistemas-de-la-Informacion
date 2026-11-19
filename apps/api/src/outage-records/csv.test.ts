import { readFileSync } from "node:fs";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app.js";
import { parseOutageRecords } from "./csv.js";

const header = "codigo,tipo,fecha_inicio,fecha_fin,hora_inicio,hora_fin,canales,sintomas,coincide_con_pagos,comunicado_oficial,confirmacion,observacion,fuente";

describe("parseOutageRecords", () => {
  it("maps the Spanish codes to the stored values", () => {
    const { rows, errors } = parseOutageRecords([
      header,
      'rc-0001,Falla,18/11/2026,2026-11-19,,,"App BN; Banca por Internet",No ingresa,Sí,por_confirmar,Prensa_con_comunicado,,https://example.test/nota',
      "RC-0002,MANTENIMIENTO,2025-11-08,2025-11-08,00:00,06:00,App BN,No disponible,NO,SI,OFICIAL,Programado,https://example.test/aviso",
    ].join("\n"));

    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({
      code: "RC-0001", kind: "FAILURE", startDate: "2026-11-18", endDate: "2026-11-19", startTime: null,
      channels: "App BN; Banca por Internet", paymentOverlap: "YES", officialStatement: null,
      confidence: "PRESS_WITH_STATEMENT", note: null,
    });
    expect(rows[1]).toMatchObject({ kind: "MAINTENANCE", startTime: "00:00", endTime: "06:00", officialStatement: true, confidence: "OFFICIAL" });
  });

  it("rejects invalid lines and duplicate codes", () => {
    const { rows, errors } = parseOutageRecords([
      header,
      "RC-0001,CORTE,2026-11-19,2026-11-18,25:00,,App BN,x,QUIZAS,SI,OFICIAL,,http://example.test",
      "RC-0002,FALLA,2026-11-18,2026-11-18,,,App BN,No ingresa,SI,SI,PRENSA,,https://example.test/a",
      "RC-0002,FALLA,2026-11-19,2026-11-19,,,App BN,No ingresa,SI,SI,PRENSA,,https://example.test/b",
    ].join("\n"));

    expect(rows.map(({ code }) => code)).toEqual(["RC-0002"]);
    const messages = errors.map(({ line, message }) => `${line}: ${message}`);
    expect(messages.filter((message) => message.startsWith("2:"))).toHaveLength(6);
    expect(messages).toContain("4: Duplica el código RC-0002 (línea 3)");
  });

  it("requires the header columns", () => {
    expect(parseOutageRecords("codigo,tipo\nRC-0001,FALLA").errors[0]!.message).toContain("fecha_inicio");
  });

  it("accepts the project's registro-caidas-bn.csv", () => {
    const text = readFileSync(new URL("../../../../docs/registro-caidas-bn.csv", import.meta.url), "utf8");
    const { rows, errors } = parseOutageRecords(text);
    expect(errors).toEqual([]);
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe("outage records route", () => {
  it("requires authentication", async () => {
    expect((await request(app).get("/api/outage-records")).status).toBe(401);
  });
});
