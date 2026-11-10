import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type { AppConfig } from "../config/env.js";

export type OutgoingMessage = {
  to: string;
  subject: string;
  text: string;
};

export type DeliveryReceipt = {
  messageId: string;
  previewUrl: string | null;
};

export interface Mailer {
  readonly driver: AppConfig["NOTIFICATIONS_DRIVER"];
  send(message: OutgoingMessage): Promise<DeliveryReceipt>;
}

// Dominio reservado para demostrar errores y reintentos sin depender de un servidor real.
export const simulatedFailureDomain = "fallo.simona.test";

export class SimulatedDeliveryError extends Error {
  constructor(recipient: string) {
    super(`Rechazo SMTP simulado: el buzón ${recipient} no acepta mensajes (550).`);
    this.name = "SimulatedDeliveryError";
  }
}

function assertNotSimulatedFailure(recipient: string): void {
  if (recipient.toLowerCase().endsWith(`@${simulatedFailureDomain}`)) {
    throw new SimulatedDeliveryError(recipient);
  }
}

class NodemailerMailer implements Mailer {
  constructor(
    readonly driver: AppConfig["NOTIFICATIONS_DRIVER"],
    private readonly from: string,
    private readonly transporter: () => Promise<Transporter>,
  ) {}

  async send(message: OutgoingMessage): Promise<DeliveryReceipt> {
    if (this.driver !== "smtp") {
      assertNotSimulatedFailure(message.to);
    }
    const info = await (await this.transporter()).sendMail({ from: this.from, ...message });
    const previewUrl = this.driver === "ethereal" ? nodemailer.getTestMessageUrl(info) : false;
    return {
      messageId: String(info.messageId ?? ""),
      previewUrl: typeof previewUrl === "string" ? previewUrl : null,
    };
  }
}

export function createMailer(config: AppConfig): Mailer {
  if (config.NOTIFICATIONS_DRIVER === "json") {
    // Sin red: Nodemailer genera el mensaje completo, pero no lo envía a ningún servidor.
    const transporter = nodemailer.createTransport({ jsonTransport: true });
    return new NodemailerMailer("json", config.NOTIFICATIONS_FROM, async () => transporter);
  }

  if (config.NOTIFICATIONS_DRIVER === "ethereal") {
    let transporter: Promise<Transporter> | undefined;
    return new NodemailerMailer("ethereal", config.NOTIFICATIONS_FROM, () => {
      transporter ??= (
        config.SMTP_USER && config.SMTP_PASS
          ? Promise.resolve({ user: config.SMTP_USER, pass: config.SMTP_PASS })
          : nodemailer.createTestAccount()
      ).then((account) => nodemailer.createTransport({
        host: "smtp.ethereal.email",
        port: 587,
        secure: false,
        auth: { user: account.user, pass: account.pass },
      }));
      transporter.catch(() => {
        transporter = undefined;
      });
      return transporter;
    });
  }

  const transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    ...(config.SMTP_USER ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASS } } : {}),
  });
  return new NodemailerMailer("smtp", config.NOTIFICATIONS_FROM, async () => transporter);
}
