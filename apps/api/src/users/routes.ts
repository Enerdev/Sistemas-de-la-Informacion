import { randomBytes } from "node:crypto";
import { UserRole } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { recordAudit } from "../audit/audit.js";
import { hashPassword } from "../auth/password.js";
import { getAuthenticatedUser, requireAuth, requireRole } from "../auth/middleware.js";
import { prisma } from "../db/prisma.js";
import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../http/async-handler.js";

export const createUserSchema = z.object({
  email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()),
  role: z.nativeEnum(UserRole),
}).strict();

export const updateUserSchema = z.object({
  role: z.nativeEnum(UserRole).optional(),
  active: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { message: "Indica el rol o el estado" });

const idSchema = z.string().uuid();

const userSelect = {
  id: true,
  email: true,
  role: true,
  active: true,
  mustChangePassword: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

/** Contraseña temporal de 20 caracteres; el usuario debe cambiarla al iniciar sesión. */
export function generateTemporaryPassword(): string {
  return `Tmp-${randomBytes(12).toString("base64url")}`;
}

/** Reglas que evitan que el sistema quede sin administradores activos. */
export function assertUserChangeAllowed(input: {
  actorId: string;
  target: { id: string; role: UserRole; active: boolean };
  next: { role?: UserRole; active?: boolean };
  activeAdminCount: number;
}): void {
  const isSelf = input.actorId === input.target.id;
  if (isSelf && input.next.active === false) {
    throw new AppError("No puedes desactivar tu propia cuenta", 409);
  }
  if (isSelf && input.next.role && input.next.role !== input.target.role) {
    throw new AppError("No puedes cambiar tu propio rol", 409);
  }
  const losesAdmin = input.target.role === UserRole.ADMIN && input.target.active
    && ((input.next.role !== undefined && input.next.role !== UserRole.ADMIN) || input.next.active === false);
  if (losesAdmin && input.activeAdminCount <= 1) {
    throw new AppError("Debe quedar al menos un ADMIN activo", 409);
  }
}

const router = Router();
router.use(requireAuth);
router.use(requireRole([UserRole.ADMIN], "Solo ADMIN puede gestionar usuarios"));

router.get(
  "/",
  asyncHandler(async (_request, response) => {
    const users = await prisma.user.findMany({
      select: userSelect,
      orderBy: [{ active: "desc" }, { role: "asc" }, { email: "asc" }],
    });
    response.status(200).json({ data: { users } });
  }),
);

router.post(
  "/",
  asyncHandler(async (request, response) => {
    const input = createUserSchema.parse(request.body);
    const temporaryPassword = generateTemporaryPassword();
    const user = await prisma.user.create({
      data: { ...input, passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true },
      select: userSelect,
    });
    await recordAudit(request, {
      action: "user.create",
      entityType: "user",
      entityId: user.id,
      summary: `Creó la cuenta ${user.email} con rol ${user.role}`,
      details: { email: user.email, role: user.role },
    });
    // La contraseña temporal solo se devuelve en esta respuesta; no se guarda en texto plano.
    response.status(201).json({ data: { user, temporaryPassword } });
  }),
);

router.patch(
  "/:id",
  asyncHandler(async (request, response) => {
    const id = idSchema.parse(request.params.id);
    const input = updateUserSchema.parse(request.body);
    const actor = getAuthenticatedUser(request);

    const user = await prisma.$transaction(async (transaction) => {
      // Serializa cambios concurrentes de administradores para no dejar el sistema sin ADMIN.
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"simona-user-admin-guard"}))`;
      const target = await transaction.user.findUnique({ where: { id }, select: { id: true, email: true, role: true, active: true } });
      if (!target) {
        throw new AppError("Usuario no encontrado", 404);
      }
      const activeAdminCount = await transaction.user.count({ where: { role: UserRole.ADMIN, active: true } });
      assertUserChangeAllowed({ actorId: actor.userId, target, next: input, activeAdminCount });

      const updated = await transaction.user.update({ where: { id }, data: input, select: userSelect });
      if (input.active === false) {
        await transaction.session.deleteMany({ where: { userId: id } });
      }
      const changes = [
        input.role !== undefined && input.role !== target.role ? `rol ${target.role} → ${input.role}` : null,
        input.active !== undefined && input.active !== target.active ? (input.active ? "reactivada" : "desactivada") : null,
      ].filter(Boolean);
      await recordAudit(request, {
        action: "user.update",
        entityType: "user",
        entityId: id,
        summary: `Actualizó la cuenta ${target.email}: ${changes.length ? changes.join(", ") : "sin cambios"}`,
        details: { before: { role: target.role, active: target.active }, after: { role: updated.role, active: updated.active } },
      }, transaction);
      return updated;
    });
    response.status(200).json({ data: { user } });
  }),
);

router.post(
  "/:id/reset-password",
  asyncHandler(async (request, response) => {
    const id = idSchema.parse(request.params.id);
    const target = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true } });
    if (!target) {
      throw new AppError("Usuario no encontrado", 404);
    }
    const temporaryPassword = generateTemporaryPassword();
    await prisma.$transaction(async (transaction) => {
      await transaction.user.update({
        where: { id },
        data: { passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true },
      });
      await transaction.session.deleteMany({ where: { userId: id } });
      await recordAudit(request, {
        action: "user.password_reset",
        entityType: "user",
        entityId: id,
        summary: `Restableció la contraseña de ${target.email} (temporal, debe cambiarla)`,
      }, transaction);
    });
    response.status(200).json({ data: { temporaryPassword } });
  }),
);

export { router as usersRouter };
