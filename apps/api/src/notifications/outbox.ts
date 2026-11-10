import { NotificationKind } from "@prisma/client";
import type { Prisma } from "@prisma/client";

type Transaction = Prisma.TransactionClient;

const timeZone = "America/Lima";

export function formatEventTime(date: Date): string {
  return date.toLocaleString("es-PE", { timeZone, dateStyle: "short", timeStyle: "medium" });
}

export function buildNotificationMessage(input: {
  kind: NotificationKind;
  channel: { code: string; name: string };
  incidentId: string | null;
  eventAt: Date;
  reason: string;
}): { subject: string; body: string } {
  const down = input.kind === NotificationKind.CHANNEL_DOWN;
  const subject = `[SIMONA-BN] ${down ? "CAÍDO" : "RESTABLECIDO"}: ${input.channel.name}`;
  const lines = [
    down
      ? `Se detectó la caída del canal ${input.channel.name} (${input.channel.code}).`
      : `El canal ${input.channel.name} (${input.channel.code}) volvió a responder.`,
    "",
    `Evento: ${down ? "Caída del servicio" : "Restablecimiento del servicio"}`,
    `Fecha y hora (${timeZone}): ${formatEventTime(input.eventAt)}`,
    `Detalle: ${input.reason}`,
    ...(input.incidentId ? [`Incidencia: ${input.incidentId}`] : []),
    ...(down
      ? []
      : ["", "La recuperación técnica no cierra la incidencia: el equipo de TI debe resolverla y cerrarla en el panel."]),
    "",
    "Mensaje generado por SIMONA-BN, prototipo académico con canales y servicios simulados.",
    "No proviene del Banco de la Nación ni refleja el estado de sus sistemas reales.",
  ];
  return { subject, body: lines.join("\n") };
}

export async function enqueueChannelNotifications(
  transaction: Transaction,
  input: {
    kind: NotificationKind;
    channelId: string;
    incidentId: string | null;
    eventAt: Date;
    reason: string;
  },
): Promise<number> {
  const channel = await transaction.channel.findUnique({
    where: { id: input.channelId },
    select: { code: true, name: true },
  });
  if (!channel) return 0;

  const recipients = await transaction.notificationRecipient.findMany({
    where: {
      active: true,
      ...(input.kind === NotificationKind.CHANNEL_DOWN ? { notifyDown: true } : { notifyRecovery: true }),
    },
    select: { id: true, email: true },
  });
  if (recipients.length === 0) return 0;

  const message = buildNotificationMessage({ ...input, channel });
  const result = await transaction.notification.createMany({
    data: recipients.map((recipient) => ({
      kind: input.kind,
      channelId: input.channelId,
      incidentId: input.incidentId,
      recipientId: recipient.id,
      recipientEmail: recipient.email,
      subject: message.subject,
      body: message.body,
      eventAt: input.eventAt,
      nextAttemptAt: input.eventAt,
    })),
  });
  return result.count;
}
