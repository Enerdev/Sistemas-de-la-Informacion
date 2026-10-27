import cron from "node-cron";

export interface ScheduledJob {
  stop(): void;
}

export type Schedule = (
  expression: string,
  callback: () => void,
) => ScheduledJob;

export function createMonitoringScheduler(
  schedule: Schedule,
  sweep: () => Promise<void>,
  onError: (error: unknown) => void = (error) => {
    console.error(
      "Falló el ciclo programado de monitoreo:",
      error instanceof Error ? error.name : "UnknownError",
    );
  },
) {
  let task: ScheduledJob | undefined;
  let sweepRunning = false;

  return {
    start(): boolean {
      if (task) return false;
      task = schedule("*/15 * * * * *", () => {
        if (sweepRunning) return;
        sweepRunning = true;
        void sweep()
          .catch(onError)
          .finally(() => {
            sweepRunning = false;
          });
      });
      return true;
    },
    stop(): void {
      task?.stop();
      task = undefined;
    },
  };
}

export function createDefaultMonitoringScheduler(sweep: () => Promise<void>) {
  return createMonitoringScheduler(
    (expression, callback) => cron.schedule(expression, callback),
    sweep,
  );
}
