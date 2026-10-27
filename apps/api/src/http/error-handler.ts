import type { ErrorRequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { AppError } from "../errors/app-error.js";

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof AppError) {
    response.status(error.statusCode).json({
      error: {
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    });
    return;
  }

  if (error instanceof ZodError) {
    response.status(400).json({
      error: {
        message: "La solicitud contiene datos inválidos",
        details: error.issues.map(({ path, message }) => ({ field: path.join("."), message })),
      },
    });
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      response.status(409).json({ error: { message: "El recurso ya existe" } });
      return;
    }

    if (error.code === "P2025") {
      response.status(404).json({ error: { message: "Recurso no encontrado" } });
      return;
    }
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    response.status(503).json({
      error: { message: "La base de datos no está disponible" },
    });
    return;
  }

  if (error instanceof SyntaxError && "status" in error && error.status === 400) {
    response.status(400).json({ error: { message: "El cuerpo JSON no es válido" } });
    return;
  }

  console.error("Error no controlado en la API:", error instanceof Error ? error.name : "UnknownError");
  response.status(500).json({
    error: {
      message: "Error interno del servidor",
    },
  });
};
