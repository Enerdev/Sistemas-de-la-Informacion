import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "./api";

type Role = "ADMIN" | "OPERATOR" | "VIEWER";

type ManagedUser = {
  id: string;
  email: string;
  role: Role;
  active: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

type AuditEntry = {
  id: string;
  actorEmail: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  ip: string | null;
  createdAt: string;
};

export const roleLabels: Record<Role, string> = {
  ADMIN: "Administrador",
  OPERATOR: "Personal de TI",
  VIEWER: "Consulta",
};

const roleDescriptions: Record<Role, string> = {
  ADMIN: "Todo, incluidos usuarios, roles, bitácora y cierre de incidencias",
  OPERATOR: "Canales, monitoreo, incidencias, alertas, reportes ciudadanos y cronograma",
  VIEWER: "Solo lectura de canales, incidencias e indicadores",
};

const actionGroups = [
  { value: "", label: "Todas" },
  { value: "auth.", label: "Sesiones" },
  { value: "user.", label: "Usuarios" },
  { value: "channel.", label: "Canales" },
  { value: "incident.", label: "Incidencias" },
  { value: "failure_report.", label: "Reportes ciudadanos" },
  { value: "recipient.", label: "Destinatarios" },
  { value: "notification.", label: "Notificaciones" },
  { value: "schedule.", label: "Cronograma" },
  { value: "report.", label: "Descargas" },
];

export function AdminPanel({ currentUserId, setNotice }: { currentUserId: string; setNotice: (message: string) => void }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("OPERATOR");
  const [credential, setCredential] = useState<{ email: string; password: string } | null>(null);

  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState("");
  const [actorFilter, setActorFilter] = useState("");
  const [loadingAudit, setLoadingAudit] = useState(false);

  const loadUsers = useCallback(async () => {
    try {
      setUsers((await apiRequest<{ users: ManagedUser[] }>("/api/users")).users);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudieron cargar los usuarios");
    }
  }, [setNotice]);

  const loadAudit = useCallback(async (cursor?: string) => {
    setLoadingAudit(true);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (actionFilter) params.set("action", actionFilter);
      if (actorFilter.trim()) params.set("actor", actorFilter.trim());
      if (cursor) params.set("cursor", cursor);
      const data = await apiRequest<{ entries: AuditEntry[]; nextCursor: string | null }>(`/api/audit?${params.toString()}`);
      setEntries((current) => (cursor ? [...current, ...data.entries] : data.entries));
      setNextCursor(data.nextCursor);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo cargar la bitácora");
    } finally {
      setLoadingAudit(false);
    }
  }, [actionFilter, actorFilter, setNotice]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    void loadAudit();
  }, [loadAudit]);

  async function createUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const data = await apiRequest<{ user: ManagedUser; temporaryPassword: string }>("/api/users", {
        method: "POST",
        body: JSON.stringify({ email, role }),
      });
      setCredential({ email: data.user.email, password: data.temporaryPassword });
      setEmail("");
      await Promise.all([loadUsers(), loadAudit()]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo crear el usuario");
    }
  }

  async function updateUser(user: ManagedUser, changes: Partial<Pick<ManagedUser, "role" | "active">>) {
    try {
      await apiRequest(`/api/users/${user.id}`, { method: "PATCH", body: JSON.stringify(changes) });
      await Promise.all([loadUsers(), loadAudit()]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo actualizar el usuario");
      await loadUsers();
    }
  }

  async function resetPassword(user: ManagedUser) {
    if (!window.confirm(`¿Restablecer la contraseña de ${user.email}? Se cerrarán sus sesiones.`)) return;
    try {
      const data = await apiRequest<{ temporaryPassword: string }>(`/api/users/${user.id}/reset-password`, { method: "POST" });
      setCredential({ email: user.email, password: data.temporaryPassword });
      await Promise.all([loadUsers(), loadAudit()]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo restablecer la contraseña");
    }
  }

  return (
    <section className="incident-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">SEGURIDAD M6</p>
          <h2>Administración</h2>
        </div>
        <span className="simulation-label"><span /> Solo ADMIN</span>
      </div>

      <div className="recipient-section admin-block">
        <h3>Usuarios y roles</h3>
        <ul className="role-legend">
          {(Object.keys(roleLabels) as Role[]).map((value) => (
            <li key={value}><strong>{roleLabels[value]}</strong> {roleDescriptions[value]}</li>
          ))}
          <li><strong>Público</strong> Sin cuenta: consulta el estado y reporta fallas en /estado</li>
        </ul>

        {credential && (
          <div className="temporary-credential" role="status">
            <p>
              Contraseña temporal de <strong>{credential.email}</strong> (se muestra una sola vez; entrégala por un canal seguro):
            </p>
            <code>{credential.password}</code>
            <p>Al iniciar sesión se le pedirá cambiarla.</p>
            <button className="toggle-button" onClick={() => setCredential(null)}>Ya la entregué, ocultar</button>
          </div>
        )}

        <form className="recipient-form" onSubmit={(event) => void createUser(event)}>
          <input
            type="email"
            required
            maxLength={254}
            placeholder="correo@dominio.test"
            aria-label="Correo del nuevo usuario"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <select aria-label="Rol del nuevo usuario" value={role} onChange={(event) => setRole(event.target.value as Role)}>
            {(Object.keys(roleLabels) as Role[]).map((value) => <option key={value} value={value}>{roleLabels[value]}</option>)}
          </select>
          <button className="primary-button" type="submit">Crear usuario</button>
        </form>

        <ul className="recipient-list">
          {users.map((user) => (
            <li key={user.id} className={user.active ? "" : "inactive"}>
              <div>
                <strong>{user.email}{user.id === currentUserId ? " (tú)" : ""}</strong>
                <span>
                  {user.active ? "Activa" : "Desactivada"}
                  {user.mustChangePassword ? " · contraseña temporal pendiente" : ""}
                  {" · último acceso "}{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString("es-PE") : "nunca"}
                </span>
              </div>
              <div className="recipient-flags">
                <select
                  aria-label={`Rol de ${user.email}`}
                  value={user.role}
                  disabled={user.id === currentUserId}
                  onChange={(event) => void updateUser(user, { role: event.target.value as Role })}
                >
                  {(Object.keys(roleLabels) as Role[]).map((value) => <option key={value} value={value}>{roleLabels[value]}</option>)}
                </select>
                <button className="toggle-button" disabled={user.id === currentUserId} onClick={() => void updateUser(user, { active: !user.active })}>
                  {user.active ? "Desactivar" : "Activar"}
                </button>
                <button className="toggle-button" disabled={user.id === currentUserId} onClick={() => void resetPassword(user)}>
                  Restablecer contraseña
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="recipient-section admin-block">
        <h3>Bitácora de auditoría</h3>
        <form
          className="incident-filters notification-filters"
          onSubmit={(event) => {
            event.preventDefault();
            void loadAudit();
          }}
        >
          <label>
            Tipo de acción
            <select value={actionFilter} onChange={(event) => setActionFilter(event.target.value)}>
              {actionGroups.map((group) => <option key={group.value} value={group.value}>{group.label}</option>)}
            </select>
          </label>
          <label>
            Usuario
            <input value={actorFilter} placeholder="correo" onChange={(event) => setActorFilter(event.target.value)} />
          </label>
          <button className="toggle-button" type="submit" disabled={loadingAudit}>Filtrar</button>
        </form>
        <div className="indicator-table-wrap">
          <table className="indicator-table audit-table">
            <thead>
              <tr>
                <th scope="col">Fecha</th>
                <th scope="col">Usuario</th>
                <th scope="col">Acción</th>
                <th scope="col">Detalle</th>
                <th scope="col">IP</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 && !loadingAudit && (
                <tr><td colSpan={5}>No hay registros para estos filtros.</td></tr>
              )}
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{new Date(entry.createdAt).toLocaleString("es-PE")}</td>
                  <td>{entry.actorEmail ?? "Sistema"}{entry.actorRole ? <span className="indicator-muted"> · {entry.actorRole}</span> : null}</td>
                  <td><code>{entry.action}</code></td>
                  <td>{entry.summary}</td>
                  <td className="indicator-muted">{entry.ip ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {nextCursor && (
          <button className="toggle-button audit-more" disabled={loadingAudit} onClick={() => void loadAudit(nextCursor)}>
            Cargar más
          </button>
        )}
        <p className="scope-note">La bitácora es de solo inserción: la base de datos rechaza cualquier modificación o borrado de sus registros.</p>
      </div>
    </section>
  );
}
