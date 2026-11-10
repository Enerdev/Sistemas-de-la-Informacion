import { loadConfig } from "../config/env.js";
import { NotificationDispatcher } from "./dispatcher.js";
import { createMailer } from "./mailer.js";

let dispatcher: NotificationDispatcher | undefined;

export function getNotificationDispatcher(): NotificationDispatcher {
  dispatcher ??= new NotificationDispatcher(createMailer(loadConfig()));
  return dispatcher;
}

export async function dispatchDueNotifications(): Promise<void> {
  try {
    await getNotificationDispatcher().dispatchDue();
  } catch (error) {
    console.error(
      "No se pudo procesar la cola de notificaciones:",
      error instanceof Error ? error.name : "UnknownError",
    );
  }
}

export function triggerNotificationDispatch(): void {
  void dispatchDueNotifications();
}
