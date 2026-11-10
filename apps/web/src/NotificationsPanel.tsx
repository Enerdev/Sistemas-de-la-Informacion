import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "./api";

export type NotificationKind = "CHANNEL_DOWN" | "CHANNEL_RECOVERED";
export type NotificationStatus = "PENDING" | "SENT" | "FAILED";
type NotificationDriver = "json" | "ethereal" | "smtp";

export type Notification = {
  id: string;
  kind: NotificationKind;
  status: NotificationStatus;
  recipientEmail: string;
  subject: string;
  body: string;
  eventAt: string;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  previewUrl: string | null;
  sentAt: string | null;
  createdAt: string;
  channel?: { id: string; code: string; name: string };
};

type Recipient = {
  id: string;
  email: string;
  name: string | null;
  active: boolean;
  notifyDown: boolean;
  notifyRecovery: boolean;
};

export const notificationKindLabels: Record<NotificationKind, string> = {
  CHANNEL_DOWN: "Caída",
  CHANNEL_RECOVERED: "Restablecimiento",
};

export const notificationStatusLabels: Record<NotificationStatus, string> = {
  PENDING: "PENDIENTE",
  SENT: "ENVIADA",
  FAILED: "FALLIDA",
};

const driverLabels: Record<NotificationDriver, string> = {
  json: "Transporte JSON local: el correo se genera, pero no sale del servidor",
  ethereal: "Ethereal: buzón SMTP de prueba, los correos no llegan a personas reales",
  smtp: "SMTP configurado",
};

export function NotificationStatusTag({ notification }: { notification: Notification }) {
  return (
    <span className={`notification-status notification-${notification.status.toLowerCase()}`}>
      {notificationStatusLabels[notification.status]}
    </span>
  );
}

export function NotificationDelivery({ notification }: { notification: Notification }) {
  return (
    <p className="notification-delivery">
      Intentos {notification.attempts}/{notification.maxAttempts}
      {notification.sentAt && ` · enviada ${new Date(notification.sentAt).toLocaleString("es-PE")}`}
      {notification.status === "PENDING" && notification.attempts > 0
        && ` · próximo intento ${new Date(notification.nextAttemptAt).toLocaleString("es-PE")}`}
      {notification.previewUrl && (
        <>
          {" · "}
          <a href={notification.previewUrl} target="_blank" rel="noreferrer">Ver correo</a>
        </>
      )}
      {notification.lastError && <span className="notification-error">{notification.lastError}</span>}
    </p>
  );
}

export function NotificationsPanel({
  isAdmin,
  setNotice,
}: {
  isAdmin: boolean;
  setNotice: (message: string) => void;
}) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [driver, setDriver] = useState<NotificationDriver | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [selected, setSelected] = useState<Notification | null>(null);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");

  const loadNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (statusFilter) params.set("status", statusFilter);
      if (kindFilter) params.set("kind", kindFilter);
      const data = await apiRequest<{ notifications: Notification[]; driver: NotificationDriver }>(
        `/api/notifications?${params.toString()}`,
      );
      setNotifications(data.notifications);
      setDriver(data.driver);
      setSelected((current) => data.notifications.find(({ id }) => id === current?.id) ?? current);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudieron cargar las notificaciones");
    } finally {
      setLoading(false);
    }
  }, [kindFilter, setNotice, statusFilter]);

  const loadRecipients = useCallback(async () => {
    try {
      const data = await apiRequest<{ recipients: Recipient[] }>("/api/notifications/recipients");
      setRecipients(data.recipients);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudieron cargar los destinatarios");
    }
  }, [setNotice]);

  useEffect(() => {
    void loadNotifications();
    const timer = window.setInterval(() => void loadNotifications(), 10_000);
    return () => window.clearInterval(timer);
  }, [loadNotifications]);

  useEffect(() => {
    void loadRecipients();
  }, [loadRecipients]);

  async function retry(notification: Notification) {
    try {
      await apiRequest(`/api/notifications/${notification.id}/retry`, { method: "POST" });
      setNotice("Reintento programado.");
      window.setTimeout(() => void loadNotifications(), 1_000);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo reintentar el envío");
    }
  }

  async function addRecipient(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await apiRequest("/api/notifications/recipients", {
        method: "POST",
        body: JSON.stringify({ email, ...(name.trim() ? { name } : {}) }),
      });
      setEmail("");
      setName("");
      setNotice("Destinatario registrado.");
      await loadRecipients();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo registrar el destinatario");
    }
  }

  async function updateRecipient(recipient: Recipient, changes: Partial<Recipient>) {
    try {
      await apiRequest(`/api/notifications/recipients/${recipient.id}`, {
        method: "PATCH",
        body: JSON.stringify(changes),
      });
      await loadRecipients();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo actualizar el destinatario");
    }
  }

  return (
    <section className="incident-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">ALERTAS M3</p>
          <h2>Notificaciones</h2>
        </div>
        <span className="simulation-label"><span /> {driver ? driverLabels[driver] : "Cargando…"}</span>
      </div>

      <form
        className="incident-filters notification-filters"
        onSubmit={(event) => {
          event.preventDefault();
          void loadNotifications();
        }}
      >
        <label>
          Estado del envío
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="">Todos</option>
            {Object.entries(notificationStatusLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label>
          Evento
          <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value)}>
            <option value="">Todos</option>
            {Object.entries(notificationKindLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <button className="toggle-button" type="submit" disabled={loading}>
          {loading ? "Cargando…" : "Filtrar"}
        </button>
      </form>

      <div className="incident-layout">
        <div className="incident-list" aria-live="polite">
          {notifications.length === 0 && !loading && (
            <div className="empty-state">
              <h3>No hay notificaciones para estos filtros</h3>
              <p>Se generan al abrirse una incidencia por caída y al registrarse la recuperación técnica.</p>
            </div>
          )}
          {notifications.map((notification) => (
            <button
              className={`incident-list-item ${selected?.id === notification.id ? "selected" : ""}`}
              key={notification.id}
              onClick={() => setSelected(notification)}
            >
              <NotificationStatusTag notification={notification} />
              <strong>{notificationKindLabels[notification.kind]} · {notification.channel?.name}</strong>
              <span>{notification.recipientEmail}</span>
              <time dateTime={notification.createdAt}>
                {new Date(notification.createdAt).toLocaleString("es-PE")}
              </time>
            </button>
          ))}
        </div>

        {selected ? (
          <article className="incident-detail">
            <div className="incident-detail-heading">
              <div>
                <p className="eyebrow">{selected.recipientEmail}</p>
                <h3>{selected.subject}</h3>
              </div>
              <NotificationStatusTag notification={selected} />
            </div>
            <dl className="incident-dates">
              <div><dt>Evento detectado</dt><dd>{new Date(selected.eventAt).toLocaleString("es-PE")}</dd></div>
              <div><dt>Encolada</dt><dd>{new Date(selected.createdAt).toLocaleString("es-PE")}</dd></div>
              <div><dt>Enviada</dt><dd>{selected.sentAt ? new Date(selected.sentAt).toLocaleString("es-PE") : "Pendiente"}</dd></div>
              <div>
                <dt>Tiempo de comunicación</dt>
                <dd>
                  {selected.sentAt
                    ? `${Math.max(0, Math.round((Date.parse(selected.sentAt) - Date.parse(selected.eventAt)) / 1000))} s`
                    : "Pendiente"}
                </dd>
              </div>
            </dl>
            <NotificationDelivery notification={selected} />
            <div className="incident-evidence">
              <h4>Mensaje</h4>
              <pre>{selected.body}</pre>
            </div>
            {selected.status === "FAILED" && (
              <button className="primary-button" onClick={() => void retry(selected)}>
                Reintentar envío
              </button>
            )}
          </article>
        ) : (
          <div className="incident-detail incident-detail-empty">
            <p>Selecciona una notificación para ver el mensaje, los intentos y los errores de envío.</p>
          </div>
        )}
      </div>

      <div className="recipient-section">
        <h3>Destinatarios</h3>
        <ul className="recipient-list">
          {recipients.map((recipient) => (
            <li key={recipient.id} className={recipient.active ? "" : "inactive"}>
              <div>
                <strong>{recipient.name ?? recipient.email}</strong>
                <span>{recipient.email}</span>
              </div>
              <div className="recipient-flags">
                <label>
                  <input
                    type="checkbox"
                    checked={recipient.notifyDown}
                    disabled={!isAdmin}
                    onChange={(event) => void updateRecipient(recipient, { notifyDown: event.target.checked })}
                  />
                  Caídas
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={recipient.notifyRecovery}
                    disabled={!isAdmin}
                    onChange={(event) => void updateRecipient(recipient, { notifyRecovery: event.target.checked })}
                  />
                  Restablecimientos
                </label>
                {isAdmin && (
                  <button
                    className="toggle-button"
                    onClick={() => void updateRecipient(recipient, { active: !recipient.active })}
                  >
                    {recipient.active ? "Desactivar" : "Activar"}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {isAdmin ? (
          <form className="recipient-form" onSubmit={(event) => void addRecipient(event)}>
            <input
              type="email"
              required
              maxLength={254}
              placeholder="correo@dominio.test"
              aria-label="Correo del destinatario"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <input
              maxLength={120}
              placeholder="Nombre (opcional)"
              aria-label="Nombre del destinatario"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <button className="primary-button" type="submit">Agregar destinatario</button>
          </form>
        ) : (
          <p className="permission-note">Solo ADMIN puede gestionar destinatarios.</p>
        )}
        <p className="scope-note">
          Para demostrar errores y reintentos, registra un correo con dominio @fallo.simona.test: el envío se rechaza de forma simulada.
        </p>
      </div>
    </section>
  );
}
