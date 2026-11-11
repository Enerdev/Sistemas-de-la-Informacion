import "dotenv/config";
import { UserRole, ChannelType } from "@prisma/client";
import { z } from "zod";
import { hashPassword } from "../src/auth/password.js";
import { prisma } from "../src/db/prisma.js";
import { loadConfig } from "../src/config/env.js";

const seedAdminPasswordSchema = z.string().min(12).max(128);

const channels = [
  {
    code: "APP_BN",
    name: "App BN",
    description: "Canal móvil simulado para el proyecto académico.",
    type: ChannelType.APP,
    simulatedTarget: "sim://app-bn",
  },
  {
    code: "BANCA_INTERNET",
    name: "Banca por internet",
    description: "Canal web simulado para el proyecto académico.",
    type: ChannelType.INTERNET_BANKING,
    simulatedTarget: "sim://banca-internet",
  },
  {
    code: "MULTIRED_VIRTUAL",
    name: "Multired Virtual",
    description: "Canal virtual simulado para el proyecto académico.",
    type: ChannelType.MULTIRED_VIRTUAL,
    simulatedTarget: "sim://multired-virtual",
  },
];

async function seed(): Promise<void> {
  const config = loadConfig();
  // En producción el seed solo puede crear el PRIMER administrador (arranque inicial del despliegue)
  // y lo obliga a cambiar la contraseña al entrar; nunca modifica cuentas existentes.
  const production = config.NODE_ENV === "production";
  const bootstrapAdmin = !production || (await prisma.user.count({ where: { role: UserRole.ADMIN } })) === 0;

  for (const channel of channels) {
    await prisma.channel.upsert({
      where: { code: channel.code },
      create: {
        ...channel,
        monitoringConfig: { create: {} },
      },
      update: {},
    });
  }

  // Destinatario ficticio de demostración (dominio .test reservado: nunca llega a una persona real).
  await prisma.notificationRecipient.upsert({
    where: { email: "jefatura-ti@simona.test" },
    create: { email: "jefatura-ti@simona.test", name: "Jefatura de TI (demo)" },
    update: {},
  });

  if (config.SEED_ADMIN_EMAIL && config.SEED_ADMIN_PASSWORD && bootstrapAdmin) {
    const passwordResult = seedAdminPasswordSchema.safeParse(config.SEED_ADMIN_PASSWORD);
    if (!passwordResult.success) {
      throw new Error("SEED_ADMIN_PASSWORD no cumple la política de longitud");
    }

    const email = config.SEED_ADMIN_EMAIL.toLowerCase();
    const passwordHash = await hashPassword(passwordResult.data);
    await prisma.user.upsert({
      where: { email },
      create: { email, passwordHash, role: UserRole.ADMIN, mustChangePassword: production },
      update: {},
    });
  }

  console.info("Seed completado: canales simulados y destinatario de demostración asegurados; no se mostraron credenciales.");
}

seed()
  .catch((error: unknown) => {
    console.error("No se pudo completar el seed. Verifica DATABASE_URL, permisos y migraciones.");
    console.error("Tipo de error:", error instanceof Error ? error.name : "UnknownError");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
