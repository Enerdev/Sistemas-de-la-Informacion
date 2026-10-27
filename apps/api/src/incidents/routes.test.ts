import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app.js";
import { incidentQuerySchema, incidentTransitionSchema } from "./routes.js";

describe("incident routes", () => {
  it("rejects malformed filter periods and comments", () => {
    expect(incidentQuerySchema.safeParse({
      from: "2026-10-15T10:00:00Z",
      to: "2026-10-14T10:00:00Z",
    }).success).toBe(false);
    expect(incidentQuerySchema.safeParse({ from: "not-a-date" }).success).toBe(false);
    expect(incidentTransitionSchema.safeParse({
      status: "IN_PROGRESS",
      comment: "x".repeat(501),
    }).success).toBe(false);
  });

  it("requires authentication before accessing incident records", async () => {
    const list = await request(app).get("/api/incidents");
    const details = await request(app).get("/api/incidents/00000000-0000-4000-8000-000000000000");
    const transition = await request(app)
      .patch("/api/incidents/00000000-0000-4000-8000-000000000000/status")
      .send({ status: "IN_PROGRESS" });

    expect(list.status).toBe(401);
    expect(details.status).toBe(401);
    expect(transition.status).toBe(401);
  });
});
