import { performance } from "node:perf_hooks";
import { CheckResult, CheckSource } from "@prisma/client";
import type { AppConfig } from "../config/env.js";
import type { CheckObservation } from "./types.js";

export interface ServiceVerifier {
  verify(target: string, timeoutMillis: number): Promise<CheckObservation>;
}

export class SimulatedServiceVerifier implements ServiceVerifier {
  async verify(target: string, _timeoutMillis: number): Promise<CheckObservation> {
    if (!/^sim:\/\/[a-z0-9][a-z0-9/_-]*$/.test(target)) {
      return {
        source: CheckSource.SIMULATED,
        result: CheckResult.FAILURE,
        responseTimeMs: null,
        httpStatusCode: null,
        detail: "Fallo simulado: se esperaba un identificador sim://.",
      };
    }

    const scenario = target.slice("sim://".length).split("/")[0] ?? "";
    if (scenario === "down" || scenario.endsWith("-down")) {
      return {
        source: CheckSource.SIMULATED,
        result: CheckResult.FAILURE,
        responseTimeMs: null,
        httpStatusCode: null,
        detail: "Fallo simulado: el servicio está configurado como caído.",
      };
    }

    if (scenario === "timeout" || scenario.endsWith("-timeout")) {
      return {
        source: CheckSource.SIMULATED,
        result: CheckResult.TIMEOUT,
        responseTimeMs: null,
        httpStatusCode: null,
        detail: "Timeout simulado: el servicio excedió el tiempo configurado.",
      };
    }

    const slowScenario = /^(?:slow|degraded)(?:-(\d+))?$/.exec(scenario);
    const responseTimeMs = slowScenario
      ? Math.min(Number(slowScenario[1] ?? 2000), 60_000)
      : 25;

    return {
      source: CheckSource.SIMULATED,
      result: CheckResult.SUCCESS,
      responseTimeMs,
      httpStatusCode: null,
      detail: slowScenario ? "Servicio simulado: respuesta lenta." : null,
    };
  }
}

export class HttpEndpointVerifier implements ServiceVerifier {
  constructor(private readonly allowedHosts: string[]) {}

  async verify(target: string, timeoutMillis: number): Promise<CheckObservation> {
    const parsed = this.parseAuthorizedTarget(target);
    if (!parsed) {
      return {
        source: CheckSource.HTTP,
        result: CheckResult.FAILURE,
        responseTimeMs: null,
        httpStatusCode: null,
        detail: "Endpoint no autorizado: se requiere HTTPS y un host incluido en la lista permitida.",
      };
    }

    const startedAt = performance.now();
    try {
      const response = await fetch(parsed, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMillis),
      });
      const responseTimeMs = Math.max(0, Math.round(performance.now() - startedAt));
      const success = response.status >= 200 && response.status < 300;

      return {
        source: CheckSource.HTTP,
        result: success ? CheckResult.SUCCESS : CheckResult.FAILURE,
        responseTimeMs,
        httpStatusCode: response.status,
        detail: success ? null : `Endpoint HTTP respondió con estado ${response.status}.`,
      };
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      return {
        source: CheckSource.HTTP,
        result: timedOut ? CheckResult.TIMEOUT : CheckResult.FAILURE,
        responseTimeMs: Math.max(0, Math.round(performance.now() - startedAt)),
        httpStatusCode: null,
        detail: timedOut
          ? `Timeout HTTP después de ${timeoutMillis} ms.`
          : `Error de red HTTP: ${error instanceof Error ? error.name : "Error desconocido"}.`,
      };
    }
  }

  private parseAuthorizedTarget(target: string): URL | null {
    try {
      const parsed = new URL(target);
      const hostAllowed = this.allowedHosts.includes(parsed.host.toLowerCase());
      if (
        parsed.protocol !== "https:"
        || parsed.username
        || parsed.password
        || !hostAllowed
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }
}

export function createServiceVerifier(config: AppConfig): ServiceVerifier {
  return config.MONITORING_DRIVER === "http"
    ? new HttpEndpointVerifier(config.MONITORING_HTTP_ALLOWED_HOSTS)
    : new SimulatedServiceVerifier();
}
