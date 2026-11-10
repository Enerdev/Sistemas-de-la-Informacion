import { NotificationStatus } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import type { Mailer } from "./mailer.js";

type NotificationRepository = Pick<PrismaClient, "notification">;

// Mientras se envía, la fila queda reservada para que otro barrido no la tome.
const claimLeaseMillis = 120_000;
const batchSize = 20;

export function retryDelayMillis(attempt: number): number {
  return 30_000 * 2 ** (attempt - 1);
}

function describeDeliveryError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Error desconocido al enviar";
  return message.slice(0, 500);
}

export class NotificationDispatcher {
  private running = false;
  private rerunRequested = false;

  constructor(
    private readonly mailer: Mailer,
    private readonly database: NotificationRepository = prisma,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get driver(): Mailer["driver"] {
    return this.mailer.driver;
  }

  async dispatchDue(): Promise<number> {
    if (this.running) {
      this.rerunRequested = true;
      return 0;
    }
    this.running = true;
    let delivered = 0;
    try {
      do {
        this.rerunRequested = false;
        delivered += await this.dispatchBatch();
      } while (this.rerunRequested);
    } finally {
      this.running = false;
    }
    return delivered;
  }

  private async dispatchBatch(): Promise<number> {
    const due = await this.database.notification.findMany({
      where: { status: NotificationStatus.PENDING, nextAttemptAt: { lte: this.now() } },
      orderBy: { nextAttemptAt: "asc" },
      take: batchSize,
      select: {
        id: true,
        attempts: true,
        maxAttempts: true,
        recipientEmail: true,
        subject: true,
        body: true,
      },
    });

    let delivered = 0;
    for (const notification of due) {
      const attempt = notification.attempts + 1;
      const claimed = await this.database.notification.updateMany({
        where: {
          id: notification.id,
          status: NotificationStatus.PENDING,
          attempts: notification.attempts,
        },
        data: {
          attempts: attempt,
          nextAttemptAt: new Date(this.now().getTime() + claimLeaseMillis),
        },
      });
      if (claimed.count !== 1) continue;

      try {
        const receipt = await this.mailer.send({
          to: notification.recipientEmail,
          subject: notification.subject,
          text: notification.body,
        });
        await this.database.notification.update({
          where: { id: notification.id },
          data: {
            status: NotificationStatus.SENT,
            sentAt: this.now(),
            providerMessageId: receipt.messageId.slice(0, 255) || null,
            previewUrl: receipt.previewUrl?.slice(0, 500) ?? null,
            lastError: null,
          },
        });
        delivered += 1;
      } catch (error) {
        const exhausted = attempt >= notification.maxAttempts;
        await this.database.notification.update({
          where: { id: notification.id },
          data: {
            status: exhausted ? NotificationStatus.FAILED : NotificationStatus.PENDING,
            lastError: describeDeliveryError(error),
            nextAttemptAt: exhausted
              ? this.now()
              : new Date(this.now().getTime() + retryDelayMillis(attempt)),
          },
        });
      }
    }
    return delivered;
  }
}
