import express from "express";
import { authRouter } from "./auth/routes.js";
import { channelsRouter } from "./channels/routes.js";
import { AppError } from "./errors/app-error.js";
import { errorHandler } from "./http/error-handler.js";
import { incidentsRouter } from "./incidents/routes.js";

export const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));

app.use("/api/auth", authRouter);
app.use("/api/channels", channelsRouter);
app.use("/api/incidents", incidentsRouter);

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
