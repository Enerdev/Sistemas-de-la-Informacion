import { NotificationStatus } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { NotificationDispatcher, retryDelayMillis } from "./dispatcher.js";
import type { Mailer } from "./mailer.js";

const now = new Date("2026-11-10T15:00:00.000Z");

function pendingNotification(overrides: Partial<{ attempts: number; maxAttempts: number }> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000010",
    attempts: 0,
    maxAttempts: 3,
    recipientEmail: "jefatura-ti@simona.test",
    subject: "[SIMONA-BN] CAÍDO: App BN",
    body: "Mensaje de prueba",
    ...overrides,
  };
}

function repositoryMock(due: ReturnType<typeof pendingNotification>[], claimedCount = 1) {
  const notification = {
    findMany: vi.fn().mockResolvedValue(due),
    updateMany: vi.fn().mockResolvedValue({ count: claimedCount }),
    update: vi.fn().mockResolvedValue({}),
  };
  return { notification } as unknown as Pick<PrismaClient, "notification"> & { notification: typeof notification };
}

function mailerMock(send: Mailer["send"]): Mailer {
  return { driver: "json", send: vi.fn(send) };
}

describe("NotificationDispatcher", () => {
  it("marks a delivered notification as SENT with provider receipt", async () => {
    const database = repositoryMock([pendingNotification()]);
    const mailer = mailerMock(async () => ({ messageId: "<msg-1@simona.test>", previewUrl: "https://ethereal.email/message/abc" }));

    const delivered = await new NotificationDispatcher(mailer, database, () => now).dispatchDue();

    expect(delivered).toBe(1);
    expect(mailer.send).toHaveBeenCalledWith({
      to: "jefatura-ti@simona.test",
      subject: "[SIMONA-BN] CAÍDO: App BN",
      text: "Mensaje de prueba",
    });
    expect(database.notification.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: NotificationStatus.PENDING, attempts: 0 }),
      data: expect.objectContaining({ attempts: 1 }),
    }));
    expect(database.notification.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: NotificationStatus.SENT,
        sentAt: now,
        providerMessageId: "<msg-1@simona.test>",
        previewUrl: "https://ethereal.email/message/abc",
        lastError: null,
      }),
    }));
  });

  it("keeps a failed delivery pending and schedules a retry with backoff", async () => {
    const database = repositoryMock([pendingNotification()]);
    const mailer = mailerMock(async () => {
      throw new Error("Conexión SMTP rechazada");
    });

    const delivered = await new NotificationDispatcher(mailer, database, () => now).dispatchDue();

    expect(delivered).toBe(0);
    expect(database.notification.update).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        status: NotificationStatus.PENDING,
        lastError: "Conexión SMTP rechazada",
        nextAttemptAt: new Date(now.getTime() + retryDelayMillis(1)),
      },
    }));
  });

  it("marks the notification FAILED after the last allowed attempt", async () => {
    const database = repositoryMock([pendingNotification({ attempts: 2, maxAttempts: 3 })]);
    const mailer = mailerMock(async () => {
      throw new Error("Buzón inexistente");
    });

    await new NotificationDispatcher(mailer, database, () => now).dispatchDue();

    expect(database.notification.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: NotificationStatus.FAILED, lastError: "Buzón inexistente" }),
    }));
  });

  it("skips a notification already claimed by another dispatch", async () => {
    const database = repositoryMock([pendingNotification()], 0);
    const mailer = mailerMock(async () => ({ messageId: "x", previewUrl: null }));

    const delivered = await new NotificationDispatcher(mailer, database, () => now).dispatchDue();

    expect(delivered).toBe(0);
    expect(mailer.send).not.toHaveBeenCalled();
    expect(database.notification.update).not.toHaveBeenCalled();
  });

  it("doubles the retry delay on each attempt", () => {
    expect([1, 2, 3].map(retryDelayMillis)).toEqual([30_000, 60_000, 120_000]);
  });
});
