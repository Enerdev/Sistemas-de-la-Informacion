import { describe, expect, it } from "vitest";
import { parseCsv, parsePaymentSchedule } from "./csv.js";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, CRLF, BOM and semicolons", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","dijo ""hola"""\r\n')).toEqual([["a", "b"], ["x, y", 'dijo "hola"']]);
    expect(parseCsv("fecha;grupo\n15/11/2026;PENSIONES")).toEqual([["fecha", "grupo"], ["15/11/2026", "PENSIONES"]]);
  });
});

describe("parsePaymentSchedule", () => {
  it("accepts ISO and local dates, accented headers and an optional description", () => {
    const { rows, errors } = parsePaymentSchedule(
      "Fecha,Grupo,Descripción\n2026-11-15,remuneraciones,\"Pago, primer grupo\"\n20/11/2026,PENSIONES,\n\n",
    );

    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { line: 2, date: "2026-11-15", group: "REMUNERACIONES", description: "Pago, primer grupo" },
      { line: 3, date: "2026-11-20", group: "PENSIONES", description: null },
    ]);
  });

  it("reports every invalid line so the whole file can be rejected", () => {
    const { errors } = parsePaymentSchedule([
      "fecha,grupo,descripcion",
      "2026-02-30,PENSIONES,Fecha imposible",
      "mañana,PENSIONES,",
      "2026-11-15,,Sin grupo",
      "2026-11-16,PENSIONES,ok",
      "16/11/2026,pensiones,duplicada",
      "2026-11-17,PENSIONES,ok,columna extra",
    ].join("\n"));

    expect(errors.map(({ line }) => line)).toEqual([2, 3, 4, 6, 7]);
    expect(errors[0]!.message).toContain("Fecha inválida");
    expect(errors[3]!.message).toContain("línea 5");
  });

  it("requires the fecha and grupo headers and at least one row", () => {
    expect(parsePaymentSchedule("dia,tipo\n2026-11-15,X").errors[0]!.message).toContain("cabecera");
    expect(parsePaymentSchedule("fecha,grupo\n").errors[0]!.message).toContain("no contiene fechas");
  });
});
