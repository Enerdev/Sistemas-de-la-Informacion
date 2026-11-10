import { loadConfig } from "../config/env.js";
import { dispatchDueNotifications, triggerNotificationDispatch } from "../notifications/runtime.js";
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
    scheduler = createDefaultMonitoringScheduler(async () => {
      await monitoringService.runDueChecks();
      await dispatchDueNotifications();
    });
  }
  return service;
}

export async function runManualMonitoringCheck(channelId: string) {
  const check = await getMonitoringService().runManualCheck(channelId);
  triggerNotificationDispatch();
  return check;
}

export function startMonitoringScheduler(): boolean {
  getMonitoringService();
  return scheduler!.start();
}

export function stopMonitoringScheduler(): void {
  scheduler?.stop();
}
