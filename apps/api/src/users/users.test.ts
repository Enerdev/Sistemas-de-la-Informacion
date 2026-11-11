import { UserRole } from "@prisma/client";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app.js";
import { changePasswordSchema } from "../auth/routes.js";
import { assertUserChangeAllowed, createUserSchema, generateTemporaryPassword, updateUserSchema } from "./routes.js";

const admin = { id: "admin-1", role: UserRole.ADMIN, active: true };

describe("user administration rules", () => {
  it("prevents self-demotion, self-deactivation and losing the last active admin", () => {
    expect(() => assertUserChangeAllowed({ actorId: "admin-1", target: admin, next: { active: false }, activeAdminCount: 2 }))
      .toThrow("No puedes desactivar tu propia cuenta");
    expect(() => assertUserChangeAllowed({ actorId: "admin-1", target: admin, next: { role: UserRole.VIEWER }, activeAdminCount: 2 }))
      .toThrow("No puedes cambiar tu propio rol");
    expect(() => assertUserChangeAllowed({ actorId: "admin-2", target: admin, next: { role: UserRole.OPERATOR }, activeAdminCount: 1 }))
      .toThrow("Debe quedar al menos un ADMIN activo");
    expect(() => assertUserChangeAllowed({ actorId: "admin-2", target: admin, next: { active: false }, activeAdminCount: 2 }))
      .not.toThrow();
    expect(() => assertUserChangeAllowed({
      actorId: "admin-2",
      target: { id: "op-1", role: UserRole.OPERATOR, active: true },
      next: { role: UserRole.VIEWER },
      activeAdminCount: 1,
    })).not.toThrow();
  });

  it("validates inputs and generates strong temporary passwords", () => {
    expect(createUserSchema.parse({ email: " TI@Simona.Test ", role: "OPERATOR" })).toEqual({ email: "ti@simona.test", role: "OPERATOR" });
    expect(createUserSchema.safeParse({ email: "x@y.test", role: "ROOT" }).success).toBe(false);
    expect(createUserSchema.safeParse({ email: "x@y.test", role: "ADMIN", password: "elegida" }).success).toBe(false);
    expect(updateUserSchema.safeParse({}).success).toBe(false);
    expect(changePasswordSchema.safeParse({ currentPassword: "misma-clave-123", newPassword: "misma-clave-123" }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ currentPassword: "a", newPassword: "corta" }).success).toBe(false);

    const passwords = new Set(Array.from({ length: 20 }, generateTemporaryPassword));
    expect(passwords.size).toBe(20);
    for (const password of passwords) expect(password).toMatch(/^Tmp-[A-Za-z0-9_-]{16}$/);
  });

  it("keeps user, audit and password endpoints behind authentication", async () => {
    expect((await request(app).get("/api/users")).status).toBe(401);
    expect((await request(app).get("/api/audit")).status).toBe(401);
    expect((await request(app).post("/api/auth/change-password").send({})).status).toBe(401);
  });
});
