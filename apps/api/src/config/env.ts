import "dotenv/config";
import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z
    .string()
    .url()
    .refine((value) => value.startsWith("postgresql://") || value.startsWith("postgres://"), {
      message: "DATABASE_URL debe usar el protocolo postgresql:// o postgres://",
    }),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(12),
  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PASSWORD: z.string().min(12).max(128).optional(),
  MONITORING_DRIVER: z.enum(["simulated", "http"]).default("simulated"),
  MONITORING_HTTP_ALLOWED_HOSTS: z.string().default(""),
});

export type AppConfig = Omit<z.infer<typeof environmentSchema>, "MONITORING_HTTP_ALLOWED_HOSTS"> & {
  MONITORING_HTTP_ALLOWED_HOSTS: string[];
};

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = environmentSchema.safeParse(environment);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "configuración"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Configuración de entorno inválida: ${details}`);
  }

  if (Boolean(result.data.SEED_ADMIN_EMAIL) !== Boolean(result.data.SEED_ADMIN_PASSWORD)) {
    throw new Error("SEED_ADMIN_EMAIL y SEED_ADMIN_PASSWORD deben configurarse juntos");
  }

  const allowedHosts = result.data.MONITORING_HTTP_ALLOWED_HOSTS
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);

  if (result.data.MONITORING_DRIVER === "http" && allowedHosts.length === 0) {
    throw new Error("MONITORING_HTTP_ALLOWED_HOSTS es obligatorio cuando MONITORING_DRIVER=http");
  }
  if (allowedHosts.some((host) => !isValidHttpAuthority(host))) {
    throw new Error("MONITORING_HTTP_ALLOWED_HOSTS solo acepta host o autoridad host:puerto, sin esquema ni ruta");
  }

  return {
    ...result.data,
    MONITORING_HTTP_ALLOWED_HOSTS: [...new Set(allowedHosts)],
  };
}

function isValidHttpAuthority(authority: string): boolean {
  try {
    const url = new URL(`https://${authority}`);
    return !url.username
      && !url.password
      && url.pathname === "/"
      && !url.search
      && !url.hash
      && url.host.toLowerCase() === authority;
  } catch {
    return false;
  }
}
