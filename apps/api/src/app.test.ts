import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "./app.js";

describe("GET /api/health", () => {
  it("informa el estado del proceso y una marca de tiempo ISO", async () => {
    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body.service).toBe("simona-bn-api");
    expect(response.body.status).toBe("ok");
    expect(Date.parse(response.body.timestamp)).not.toBeNaN();
  });
});

describe("rutas no encontradas", () => {
  it("responde con un error centralizado", async () => {
    const response = await request(app).get("/api/not-found");

    expect(response.status).toBe(404);
    expect(response.body.error.message).toBe("Ruta no encontrada");
  });
});
