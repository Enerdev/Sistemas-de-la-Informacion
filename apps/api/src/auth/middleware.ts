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
          select: { id: true, email: true, role: true },
        },
      },
    });

    if (!session) {
      throw new AppError("Sesión inválida o vencida", 401);
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

export function getAuthenticatedUser(request: Request) {
  if (!request.auth) {
    throw new AppError("Autenticación requerida", 401);
  }
  return request.auth;
}
