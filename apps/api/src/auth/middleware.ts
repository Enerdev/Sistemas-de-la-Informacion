import type { Request, RequestHandler } from "express";
import { UserRole } from "@prisma/client";
import { AppError } from "../errors/app-error.js";
import { prisma } from "../db/prisma.js";
import { hashSessionToken, readSessionToken } from "./session.js";

export const requireAuth: RequestHandler = async (request, _response, next) => {
  try {
    const token = readSessionToken(request.headers.cookie);
    if (!token) {
      throw new AppError("Autenticación requerida", 401);
    }

    const session = await prisma.session.findFirst({
      where: {
        tokenHash: hashSessionToken(token),
        expiresAt: { gt: new Date() },
      },
      select: {
        user: {
          select: { id: true, email: true, role: true, active: true, mustChangePassword: true },
        },
      },
    });

    if (!session || !session.user.active) {
      throw new AppError("Sesión inválida o vencida", 401);
    }
    // Con contraseña temporal solo se permite consultar la sesión, cambiar la contraseña o salir.
    if (session.user.mustChangePassword && !request.originalUrl.startsWith("/api/auth/")) {
      throw new AppError("Debes cambiar tu contraseña temporal antes de continuar", 403, {
        code: "PASSWORD_CHANGE_REQUIRED",
      });
    }

    request.auth = {
      userId: session.user.id,
      email: session.user.email,
      role: session.user.role,
    };
    next();
  } catch (error) {
    next(error);
  }
};

export function requireChannelWritePermission(): RequestHandler {
  return (request, _response, next) => {
    if (request.auth?.role !== UserRole.ADMIN && request.auth?.role !== UserRole.OPERATOR) {
      next(new AppError("No tienes permiso para modificar canales", 403));
      return;
    }
    next();
  };
}

export function requireRole(roles: UserRole[], message: string): RequestHandler {
  return (request, _response, next) => {
    if (!request.auth || !roles.includes(request.auth.role)) {
      next(new AppError(message, 403));
      return;
    }
    next();
  };
}

export function getAuthenticatedUser(request: Request) {
  if (!request.auth) {
    throw new AppError("Autenticación requerida", 401);
  }
  return request.auth;
}
