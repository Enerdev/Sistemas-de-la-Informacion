import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { errorHandler } from "./error-handler.js";

describe("central error handler", () => {
  it("returns a service-unavailable response for database initialization failures", () => {
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    const response = { status, json };
    const error = new Prisma.PrismaClientInitializationError("Database unavailable", "6.12.0");

    errorHandler(error, {} as never, response as never, vi.fn());

    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith({
      error: { message: "La base de datos no está disponible" },
    });
  });
});
