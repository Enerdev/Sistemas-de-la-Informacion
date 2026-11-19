import "dotenv/config";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { recordAudit } from "../src/audit/audit.js";
import { prisma } from "../src/db/prisma.js";
import { parseOutageRecords } from "../src/outage-records/csv.js";

/**
 * Sincroniza el registro público de caídas del BN con docs/registro-caidas-bn.csv:
 * crea o actualiza cada código y elimina los que ya no están en el archivo.
 * No toca incidencias, verificaciones ni indicadores medidos.
 * Uso: npm run db:seed:outages [-- ruta/al/archivo.csv]
 */
const defaultFile = fileURLToPath(new URL("../../../docs/registro-caidas-bn.csv", import.meta.url));

async function main(): Promise<void> {
  const file = process.argv[2] ?? defaultFile;
  const { rows, errors } = parseOutageRecords(await readFile(file, "utf8"));
  if (errors.length > 0) {
    for (const { line, message } of errors) console.error(`Línea ${line}: ${message}`);
    throw new Error(`${basename(file)} tiene ${errors.length} error(es); no se cargó ningún registro`);
  }

  const { created, updated, removed } = await prisma.$transaction(async (transaction) => {
    const existing = new Set((await transaction.publicOutageRecord.findMany({ select: { code: true } })).map(({ code }) => code));
    for (const { line: _line, startDate, endDate, ...fields } of rows) {
      const data = {
        ...fields,
        startDate: new Date(`${startDate}T00:00:00.000Z`),
        endDate: new Date(`${endDate}T00:00:00.000Z`),
      };
      await transaction.publicOutageRecord.upsert({ where: { code: fields.code }, create: data, update: data });
    }
    const { count } = await transaction.publicOutageRecord.deleteMany({
      where: { code: { notIn: rows.map(({ code }) => code) } },
    });
    const createdCount = rows.filter(({ code }) => !existing.has(code)).length;
    return { created: createdCount, updated: rows.length - createdCount, removed: count };
  });

  const summary = `${rows.length} registros de ${basename(file)} (${created} nuevos, ${updated} actualizados, ${removed} eliminados)`;
  await recordAudit(null, {
    action: "system.outage_records_seed",
    entityType: "system",
    summary: `Se sincronizó el registro público de caídas del BN: ${summary}`,
    actor: { email: "script db:seed:outages" },
  });
  console.info(`Registro público de caídas cargado: ${summary}.`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "No se pudo cargar el registro de caídas");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
