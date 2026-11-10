import { NotificationKind } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config/env.js";
import { createMailer, SimulatedDeliveryError } from "./mailer.js";
import { buildNotificationMessage, enqueueChannelNotifications } from "./outbox.js";

const eventAt = new Date("2026-11-10T15:00:00.000Z");
const channel = { code: "APP_BN", name: "App BN" };

function transactionMock(recipients: Array<{ id: string; email: string }>) {
  return {
    channel: { findUnique: vi.fn().mockResolvedValue(channel) },
    notificationRecipient: { findMany: vi.fn().mockResolvedValue(recipients) },
    notification: { createMany: vi.fn().mockResolvedValue({ count: recipients.length }) },
  } as unknown as Prisma.TransactionClient;
}

describe("notification messages", () => {
  it("describes an outage with channel, time, incident and simulation notice", () => {
    const message = buildNotificationMessage({
      kind: NotificationKind.CHANNEL_DOWN,
      channel,
      incidentId: "incident-1",
      eventAt,
      reason: "Canal CAÍDO tras 3 fallos consecutivos; política: 3.",
    });

    expect(message.subject).toBe("[SIMONA-BN] CAÍDO: App BN");
    expect(message.body).toContain("Caída del servicio");
    expect(message.body).toContain("10/11/26, 10:00:00");
    expect(message.body).toContain("Incidencia: incident-1");
    expect(message.body).toContain("servicios simulados");
  });

  it("reminds that technical recovery does not close the incident", () => {
    const message = buildNotificationMessage({
      kind: NotificationKind.CHANNEL_RECOVERED,
      channel,
      incidentId: "incident-1",
      eventAt,
      reason: "Recuperación técnica: el canal pasó de CAÍDO a AVAILABLE.",
    });

    expect(message.subject).toBe("[SIMONA-BN] RESTABLECIDO: App BN");
    expect(message.body).toContain("no cierra la incidencia");
  });
});

describe("enqueueChannelNotifications", () => {
  it("creates one pending notification per active recipient subscribed to the event", async () => {
    const transaction = transactionMock([
      { id: "r1", email: "jefatura-ti@simona.test" },
      { id: "r2", email: "soporte@simona.test" },
    ]);

    const count = await enqueueChannelNotifications(transaction, {
      kind: NotificationKind.CHANNEL_DOWN,
      channelId: "channel-1",
      incidentId: "incident-1",
      eventAt,
      reason: "Caída",
    });

    expect(count).toBe(2);
    expect(transaction.notificationRecipient.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { active: true, notifyDown: true },
    }));
    expect(transaction.notification.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ recipientId: "r1", recipientEmail: "jefatura-ti@simona.test", eventAt }),
        expect.objectContaining({ recipientId: "r2", recipientEmail: "soporte@simona.test", eventAt }),
      ],
    });
  });

  it("filters recovery subscribers and skips the insert without recipients", async () => {
    const transaction = transactionMock([]);

    const count = await enqueueChannelNotifications(transaction, {
      kind: NotificationKind.CHANNEL_RECOVERED,
      channelId: "channel-1",
      incidentId: "incident-1",
      eventAt,
      reason: "Recuperación",
    });

    expect(count).toBe(0);
    expect(transaction.notificationRecipient.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { active: true, notifyRecovery: true },
    }));
    expect(transaction.notification.createMany).not.toHaveBeenCalled();
  });
});

describe("createMailer", () => {
  const config = loadConfig({ DATABASE_URL: "postgresql://simona:local-only@localhost:5432/simona_bn" });

  it("builds the message offline with the JSON transport", async () => {
    const mailer = createMailer(config);
    const receipt = await mailer.send({ to: "jefatura-ti@simona.test", subject: "Prueba", text: "Hola" });

    expect(mailer.driver).toBe("json");
    expect(receipt.messageId).toMatch(/@/);
    expect(receipt.previewUrl).toBeNull();
  });

  it("rejects the reserved failure domain to demonstrate delivery errors", async () => {
    const mailer = createMailer(config);

    await expect(mailer.send({ to: "buzon@fallo.simona.test", subject: "Prueba", text: "Hola" }))
      .rejects.toBeInstanceOf(SimulatedDeliveryError);
  });
});
