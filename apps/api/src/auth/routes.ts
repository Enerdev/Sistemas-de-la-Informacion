import { Router } from "express";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { loadConfig } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../http/async-handler.js";
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
const passwordSchema = z.string().min(12).max(128);

const credentialsSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
}).strict();

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

    response.status(201).json({ data: { user } });
  }),
);

router.post(
  "/login",
  asyncHandler(async (request, response) => {
    const input = credentialsSchema.parse(request.body);
    const user = await prisma.user.findUnique({
      where: { email: input.email },
    });

    if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
      throw new AppError("Correo o contraseña incorrectos", 401);
    }

    const config = loadConfig();
    const token = await createSession(user.id, config.SESSION_TTL_HOURS);
    setSessionCookie(
      response,
      token,
      config.SESSION_TTL_HOURS * 60 * 60,
      config.NODE_ENV === "production",
    );
    response.status(200).json({
      data: {
        user: { id: user.id, email: user.email, role: user.role },
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
      await prisma.session.deleteMany({
        where: { tokenHash: hashSessionToken(token) },
      });
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
      select: { id: true, email: true, role: true, createdAt: true },
    });

    if (!user) {
      throw new AppError("Usuario no encontrado", 404);
    }

    response.status(200).json({ data: { user } });
  }),
);

export { router as authRouter };
