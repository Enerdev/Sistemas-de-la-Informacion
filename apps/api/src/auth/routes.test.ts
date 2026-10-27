import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app.js";

describe("authentication input and access guards", () => {
  it("rejects invalid registration and login input before database access", async () => {
    const registration = await request(app).post("/api/auth/register").send({
      email: "not-an-email",
      password: "short",
    });
    const login = await request(app).post("/api/auth/login").send({});

    expect(registration.status).toBe(400);
    expect(registration.body.error.message).toBe("La solicitud contiene datos inválidos");
    expect(login.status).toBe(400);
  });

  it("requires a session before reading or changing channels", async () => {
    const listing = await request(app).get("/api/channels");
    const creation = await request(app).post("/api/channels").send({});

    expect(listing.status).toBe(401);
    expect(creation.status).toBe(401);
  });
});
