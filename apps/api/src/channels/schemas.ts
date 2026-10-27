import { ChannelType } from "@prisma/client";
import { z } from "zod";

const codeSchema = z.string().trim().regex(/^[A-Z][A-Z0-9_-]{1,39}$/);
const nameSchema = z.string().trim().min(2).max(120);
const descriptionSchema = z.string().trim().max(500).optional();
const monitoringTargetSchema = z.string().trim().min(7).max(200).refine((target) => {
  if (/^sim:\/\/[a-z0-9][a-z0-9/_-]*$/.test(target)) {
    return true;
  }

  try {
    const url = new URL(target);
    const allowedHosts = process.env.MONITORING_HTTP_ALLOWED_HOSTS
      ?.split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean) ?? [];

    return process.env.MONITORING_DRIVER === "http"
      && url.protocol === "https:"
      && !url.username
      && !url.password
      && allowedHosts.includes(url.host.toLowerCase());
  } catch {
    return false;
  }
}, "Usa un destino sim:// o un endpoint HTTPS cuyo host esté explícitamente autorizado");

export const monitoringConfigSchema = z.object({
  checkIntervalSeconds: z.number().int().min(15).max(86400).default(60),
  timeoutMillis: z.number().int().min(100).max(60000).default(5000),
  latencyWarningMillis: z.number().int().min(1).max(60000).default(1500),
  failureThreshold: z.number().int().min(1).max(20).default(3),
  recoveryThreshold: z.number().int().min(1).max(20).default(2),
}).strict();

export const updateMonitoringConfigSchema = monitoringConfigSchema.partial().strict().refine(
  (value) => Object.keys(value).length > 0,
  { message: "Incluye al menos un umbral para actualizar" },
);

const channelFields = {
  code: codeSchema,
  name: nameSchema,
  description: descriptionSchema,
  type: z.nativeEnum(ChannelType),
  simulatedTarget: monitoringTargetSchema,
};

export const createChannelSchema = z.object({
  ...channelFields,
  monitoringConfig: monitoringConfigSchema.default({}),
}).strict();

export const updateChannelSchema = z.object({
  code: codeSchema.optional(),
  name: nameSchema.optional(),
  description: descriptionSchema,
  type: z.nativeEnum(ChannelType).optional(),
  simulatedTarget: monitoringTargetSchema.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "Incluye al menos un campo para actualizar",
});

export const monitoringToggleSchema = z.object({
  monitoringEnabled: z.boolean(),
}).strict();

export type CreateChannelInput = z.infer<typeof createChannelSchema>;
