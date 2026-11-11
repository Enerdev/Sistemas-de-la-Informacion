import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import { auditRouter } from "./audit/routes.js";
import { authRouter } from "./auth/routes.js";
import { channelsRouter } from "./channels/routes.js";
import { AppError } from "./errors/app-error.js";
import { exportsRouter } from "./exports/routes.js";
import { errorHandler } from "./http/error-handler.js";
import { incidentsRouter } from "./incidents/routes.js";
import { indicatorsRouter } from "./indicators/routes.js";
import { notificationsRouter } from "./notifications/routes.js";
import { paymentScheduleRouter } from "./payment-schedule/routes.js";
import { publicRouter } from "./public/routes.js";
import { failureReportsRouter } from "./reports/routes.js";
import { usersRouter } from "./users/routes.js";

export const app = express();

app.disable("x-powered-by");
// Detrás de un proxy (Render, Nginx) request.ip debe ser la IP del cliente para los límites por IP.
if (process.env.TRUST_PROXY) {
  app.set("trust proxy", Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
}

app.use((_request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  if (process.env.NODE_ENV === "production") {
    response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

// Montado antes del parser global: la importación CSV necesita un límite de cuerpo mayor.
app.use("/api/payment-schedule", paymentScheduleRouter);
app.use(express.json({ limit: "16kb" }));

app.use("/api/auth", authRouter);
app.use("/api/channels", channelsRouter);
app.use("/api/incidents", incidentsRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/reports", failureReportsRouter);
app.use("/api/indicators", indicatorsRouter);
app.use("/api/exports", exportsRouter);
app.use("/api/users", usersRouter);
app.use("/api/audit", auditRouter);
app.use("/api/public", publicRouter);

app.get("/api/health", (_request, response) => {
  response.status(200).json({
    service: "simona-bn-api",
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

// En producción la API también sirve la web compilada (un solo servicio); /estado y demás rutas
// del frontend devuelven index.html.
const webDist = fileURLToPath(new URL("../../web/dist", import.meta.url));
if (process.env.SERVE_WEB === "true" && existsSync(webDist)) {
  app.use(express.static(webDist, { index: false, maxAge: "1h" }));
  app.get(/^\/(?!api\/).*/, (_request, response) => {
    response.setHeader("Cache-Control", "no-cache");
    response.sendFile("index.html", { root: webDist });
  });
}

app.use((_request, _response, next) => {
  next(new AppError("Ruta no encontrada", 404));
});

app.use(errorHandler);
