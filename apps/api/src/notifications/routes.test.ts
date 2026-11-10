import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app.js";
import { createRecipientSchema, notificationQuerySchema, updateRecipientSchema } from "./routes.js";

describe("notification routes", () => {
  it("validates recipients and filters", () => {
    expect(createRecipientSchema.safeParse({ email: "no-es-correo" }).success).toBe(false);
    expect(createRecipientSchema.parse({ email: " TI@Simona.Test " })).toMatchObject({
      email: "ti@simona.test",
      notifyDown: true,
      notifyRecovery: true,
    });
    expect(updateRecipientSchema.safeParse({}).success).toBe(false);
    expect(notificationQuerySchema.safeParse({ status: "DELIVERED" }).success).toBe(false);
  });

  it("requires authentication for notifications and recipients", async () => {
    const list = await request(app).get("/api/notifications");
    const recipients = await request(app).get("/api/notifications/recipients");
    const retry = await request(app).post("/api/notifications/00000000-0000-4000-8000-000000000000/retry");

    expect(list.status).toBe(401);
    expect(recipients.status).toBe(401);
    expect(retry.status).toBe(401);
  });
});
