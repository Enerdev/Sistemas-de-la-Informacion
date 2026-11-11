import { Router } from "express";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { recordAudit } from "../audit/audit.js";
import { loadConfig } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../http/async-handler.js";
import { createRateLimit } from "../http/rate-limit.js";
import { hashPassword, verifyPassword } from "./password.js";
import {
  clearSessionCookie,
  createSession,
  hashSessionToken,
  readSessionToken,
  setSessionCookie,
} from "./session.js";
import { getAuthenticatedUser, requireAuth } from "./middleware.js";

const emailSchema = z.string().trim().email().max(254).transform((email) => email.toLowerCase());
export const passwordSchema = z.string().min(12).max(128);

const credentialsSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
}).strict();

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
}).strict().refine(
  ({ currentPassword, newPassword }) => currentPassword !== newPassword,
  { message: "La nueva contraseña debe ser distinta de la actual", path: ["newPassword"] },
);

// Hash de referencia para gastar el mismo tiempo cuando el correo no existe (evita enumerar cuentas).
const dummyPasswordHash = hashPassword("simona-dummy-password-for-timing");

const loginRateLimit = createRateLimit({
  windowMillis: 15 * 60 * 1000,
  // Configurable para las pruebas automatizadas, que inician muchas sesiones desde la misma IP.
  max: Number(process.env.LOGIN_RATE_LIMIT_MAX) || 10,
  message: "Demasiados intentos de inicio de sesión. Intenta nuevamente en unos minutos.",
});

const router = Router();

router.post(
  "/register",
  asyncHandler(async (request, response) => {
    const input = credentialsSchema.parse(request.body);
    const passwordHash = await hashPassword(input.password);
    const user = await prisma.user.create({
      data: {
        email: input.email,
        passwordHash,
        role: UserRole.VIEWER,
      },
      select: { id: true, email: true, role: true, createdAt: true },
    });
    await recordAudit(request, {
      action: "auth.register",
      entityType: "user",
      entityId: user.id,
      summary: `Registro de cuenta ${user.email} con rol VIEWER`,
      actor: { id: user.id, email: user.email, role: user.role },
    });

    response.status(201).json({ data: { user } });
  }),
);

router.post(
  "/login",
  loginRateLimit,
  asyncHandler(async (request, response) => {
    const input = credentialsSchema.parse(request.body);
    const user = await prisma.user.findUnique({
      where: { email: input.email },
    });

    const passwordMatches = await verifyPassword(input.password, user?.passwordHash ?? await dummyPasswordHash);
    if (!user || !passwordMatches) {
      await recordAudit(request, {
        action: "auth.login_failed",
        entityType: "user",
        entityId: user?.id,
        summary: `Inicio de sesión fallido para ${input.email}`,
        actor: { email: input.email },
      });
      throw new AppError("Correo o contraseña incorrectos", 401);
    }
    if (!user.active) {
      await recordAudit(request, {
        action: "auth.login_blocked",
        entityType: "user",
        entityId: user.id,
        summary: `Inicio de sesión rechazado: la cuenta ${user.email} está desactivada`,
        actor: { id: user.id, email: user.email, role: user.role },
      });
      throw new AppError("La cuenta está desactivada. Contacta a un administrador.", 403);
    }

    const config = loadConfig();
    const token = await createSession(user.id, config.SESSION_TTL_HOURS);
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await recordAudit(request, {
      action: "auth.login",
      entityType: "user",
      entityId: user.id,
      summary: `Inicio de sesión de ${user.email}`,
      actor: { id: user.id, email: user.email, role: user.role },
    });
    setSessionCookie(
      response,
      token,
      config.SESSION_TTL_HOURS * 60 * 60,
      config.NODE_ENV === "production",
    );
    response.status(200).json({
      data: {
        user: { id: user.id, email: user.email, role: user.role, mustChangePassword: user.mustChangePassword },
      },
    });
  }),
);

router.post(
  "/logout",
  asyncHandler(async (request, response) => {
    const config = loadConfig();
    const token = readSessionToken(request.headers.cookie);
    if (token) {
      const session = await prisma.session.findUnique({
        where: { tokenHash: hashSessionToken(token) },
        select: { user: { select: { id: true, email: true, role: true } } },
      });
      await prisma.session.deleteMany({
        where: { tokenHash: hashSessionToken(token) },
      });
      if (session) {
        await recordAudit(request, {
          action: "auth.logout",
          entityType: "user",
          entityId: session.user.id,
          summary: `Cierre de sesión de ${session.user.email}`,
          actor: session.user,
        });
      }
    }

    clearSessionCookie(response, config.NODE_ENV === "production");
    response.status(204).end();
  }),
);

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (request, response) => {
    const auth = getAuthenticatedUser(request);
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { id: true, email: true, role: true, mustChangePassword: true, createdAt: true },
    });

    if (!user) {
      throw new AppError("Usuario no encontrado", 404);
    }

    response.status(200).json({ data: { user } });
  }),
);

router.post(
  "/change-password",
  requireAuth,
  asyncHandler(async (request, response) => {
    const input = changePasswordSchema.parse(request.body);
    const auth = getAuthenticatedUser(request);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });
    if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
      throw new AppError("La contraseña actual no es correcta", 400);
    }

    const currentToken = readSessionToken(request.headers.cookie);
    await prisma.$transaction(async (transaction) => {
      await transaction.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(input.newPassword), mustChangePassword: false },
      });
      // Se cierran las demás sesiones de la cuenta; la actual sigue activa.
      await transaction.session.deleteMany({
        where: {
          userId: user.id,
          ...(currentToken ? { NOT: { tokenHash: hashSessionToken(currentToken) } } : {}),
        },
      });
      await recordAudit(request, {
        action: "auth.password_change",
        entityType: "user",
        entityId: user.id,
        summary: `${user.email} cambió su contraseña`,
      }, transaction);
    });
    response.status(204).end();
  }),
);

export { router as authRouter };
