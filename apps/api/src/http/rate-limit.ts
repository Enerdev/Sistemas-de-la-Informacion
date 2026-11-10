import type { RequestHandler } from "express";
import { AppError } from "../errors/app-error.js";

// Límite en memoria por IP y ventana fija; suficiente para una sola instancia de la API.
export function createRateLimit(options: {
  windowMillis: number;
  max: number;
  message: string;
  now?: () => number;
}): RequestHandler {
  const now = options.now ?? Date.now;
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (request, response, next) => {
    const current = now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= current) hits.delete(key);
    }

    const key = request.ip ?? "desconocida";
    const entry = hits.get(key) ?? { count: 0, resetAt: current + options.windowMillis };
    entry.count += 1;
    hits.set(key, entry);

    if (entry.count > options.max) {
      response.setHeader("Retry-After", Math.ceil((entry.resetAt - current) / 1000).toString());
      next(new AppError(options.message, 429));
      return;
    }
    next();
  };
}
