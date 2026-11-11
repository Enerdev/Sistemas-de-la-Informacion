import "dotenv/config";
import { UserRole } from "@prisma/client";
import { recordAudit } from "../src/audit/audit.js";
import { hashPassword } from "../src/auth/password.js";
import { loadConfig } from "../src/config/env.js";
import { prisma } from "../src/db/prisma.js";
import { demoCheckIntervalMinutes, demoRecipients, demoSettings, generateDemoData } from "../src/demo/generate.js";

/**
 * Reemplaza los datos operativos (canales, verificaciones, historial, incidencias, notificaciones,
 * reportes ciudadanos y cronograma) por una demostración simulada de 6 semanas.
 * Conserva usuarios, sesiones y la bitácora de auditoría (que es de solo inserción).
 * Uso: npm run db:seed:demo -- --reset
 */
const batchSize = 2000;

async function insertInBatches<T>(rows: T[], insert: (batch: T[]) => Promise<unknown>) {
  for (let index = 0; index < rows.length; index += batchSize) {
    await insert(rows.slice(index, index + batchSize));
  }
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const config = loadConfig();
  if (!args.has("--reset")) {
    throw new Error("Este script borra los datos operativos. Ejecútalo con --reset para confirmar.");
  }
  if (config.NODE_ENV === "production" && !args.has("--allow-production")) {
    throw new Error("NODE_ENV=production: agrega --allow-production solo si esta base es una demostración.");
  }

  const admin = await prisma.user.findFirst({
    where: {
      role: UserRole.ADMIN,
      active: true,
      ...(config.SEED_ADMIN_EMAIL ? { email: config.SEED_ADMIN_EMAIL.toLowerCase() } : {}),
    },
    orderBy: { createdAt: "asc" },
  });
  if (!admin) {
    throw new Error("No hay un ADMIN activo. Ejecuta primero npm run db:seed con SEED_ADMIN_EMAIL y SEED_ADMIN_PASSWORD.");
  }

  // Cuentas de demostración opcionales, con la contraseña local SEED_DEMO_PASSWORD.
  let operatorId = admin.id;
  const demoPassword = process.env.SEED_DEMO_PASSWORD;
  if (demoPassword) {
    if (demoPassword.length < 12) throw new Error("SEED_DEMO_PASSWORD debe tener al menos 12 caracteres");
    const passwordHash = await hashPassword(demoPassword);
    for (const [email, role] of [["operador.demo@simona.test", UserRole.OPERATOR], ["consulta.demo@simona.test", UserRole.VIEWER]] as const) {
      const user = await prisma.user.upsert({
        where: { email },
        create: { email, role, passwordHash },
        update: { role, passwordHash, active: true, mustChangePassword: false },
      });
      if (role === UserRole.OPERATOR) operatorId = user.id;
    }
  }

  const data = generateDemoData(new Date(), { operatorId, adminId: admin.id });

  await prisma.$transaction([
    prisma.failureReport.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.incidentEvent.deleteMany(),
    prisma.incident.deleteMany(),
    prisma.channelCheck.deleteMany(),
    prisma.channelStatusHistory.deleteMany(),
    prisma.paymentDate.deleteMany(),
    prisma.paymentScheduleImport.deleteMany(),
    prisma.channel.deleteMany(),
    prisma.notificationRecipient.updateMany({
      where: { email: { notIn: demoRecipients.map(({ email }) => email) } },
      data: { active: false },
    }),
  ]);

  const recipientIds = new Map<string, string>();
  for (const recipient of data.recipients) {
    const { id: _generatedId, ...fields } = recipient;
    const stored = await prisma.notificationRecipient.upsert({
      where: { email: recipient.email },
      create: fields,
      update: { ...fields, active: true },
    });
    recipientIds.set(recipient.email, stored.id);
  }

  for (const channel of data.channels) {
    await prisma.channel.create({
      data: {
        id: channel.id,
        code: channel.code,
        name: channel.name,
        description: channel.description,
        type: channel.type,
        simulatedTarget: channel.simulatedTarget,
        currentStatus: channel.currentStatus,
        monitoringEnabled: true,
        createdAt: channel.createdAt,
        monitoringConfig: { create: { checkIntervalSeconds: demoCheckIntervalMinutes * 60, ...demoSettings } },
      },
    });
  }
  await insertInBatches(data.checks, (batch) => prisma.channelCheck.createMany({ data: batch }));
  await insertInBatches(data.history, (batch) => prisma.channelStatusHistory.createMany({ data: batch }));
  await prisma.incident.createMany({ data: data.incidents });
  await prisma.incidentEvent.createMany({ data: data.incidentEvents });
  await insertInBatches(
    data.notifications.map((notification) => ({ ...notification, recipientId: recipientIds.get(notification.recipientEmail)! })),
    (batch) => prisma.notification.createMany({ data: batch }),
  );
  await prisma.failureReport.createMany({ data: data.failureReports });
  const scheduleImport = await prisma.paymentScheduleImport.create({
    data: {
      fileName: "cronograma-demo-ficticio.csv",
      rowCount: data.paymentDates.length,
      createdCount: data.paymentDates.length,
      updatedCount: 0,
      importedById: admin.id,
      importedAt: data.period.start,
    },
  });
  await prisma.paymentDate.createMany({ data: data.paymentDates.map((row) => ({ ...row, importId: scheduleImport.id })) });

  const summary = `${data.checks.length} verificaciones, ${data.history.length} cambios de estado, ${data.incidents.length} incidencias, ${data.notifications.length} notificaciones, ${data.failureReports.length} reportes ciudadanos y ${data.paymentDates.length} fechas de pago`;
  await recordAudit(null, {
    action: "system.demo_seed",
    entityType: "system",
    summary: `Se reemplazaron los datos operativos por una demostración simulada: ${summary}`,
    actor: { email: "script db:seed:demo" },
  });

  console.info(`Demo cargada (${data.period.start.toISOString().slice(0, 10)} a ${data.period.end.toISOString().slice(0, 10)}): ${summary}.`);
  console.info(demoPassword
    ? "Cuentas demo: operador.demo@simona.test (OPERATOR) y consulta.demo@simona.test (VIEWER), con SEED_DEMO_PASSWORD."
    : "Sin SEED_DEMO_PASSWORD no se crearon cuentas demo; las acciones del personal se atribuyen al ADMIN.");
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "No se pudo cargar la demostración");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
