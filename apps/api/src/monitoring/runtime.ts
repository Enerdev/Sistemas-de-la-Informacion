import { loadConfig } from "../config/env.js";
import { createServiceVerifier } from "./verifiers.js";
import { MonitoringService } from "./service.js";
import { createDefaultMonitoringScheduler } from "./scheduler.js";

let service: MonitoringService | undefined;
let scheduler: ReturnType<typeof createDefaultMonitoringScheduler> | undefined;

function getMonitoringService(): MonitoringService {
  if (!service) {
    const config = loadConfig();
    const monitoringService = new MonitoringService(createServiceVerifier(config));
    service = monitoringService;
    scheduler = createDefaultMonitoringScheduler(() => monitoringService.runDueChecks());
  }
  return service;
}

export function runManualMonitoringCheck(channelId: string) {
  return getMonitoringService().runManualCheck(channelId);
}

export function startMonitoringScheduler(): boolean {
  getMonitoringService();
  return scheduler!.start();
}

export function stopMonitoringScheduler(): void {
  scheduler?.stop();
}
