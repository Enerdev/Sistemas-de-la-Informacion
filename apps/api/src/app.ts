import express from "express";
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

export const app = express();

app.disable("x-powered-by");
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
app.use("/api/public", publicRouter);

app.get("/api/health", (_request, response) => {
  response.status(200).json({
    service: "simona-bn-api",
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

app.use((_request, _response, next) => {
  next(new AppError("Ruta no encontrada", 404));
});

app.use(errorHandler);
