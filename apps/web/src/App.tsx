import { useCallback, useEffect, useState } from "react";

type User = {
  id: string;
  email: string;
  role: "ADMIN" | "OPERATOR" | "VIEWER";
};

type MonitoringConfig = {
  checkIntervalSeconds: number;
  timeoutMillis: number;
  latencyWarningMillis: number;
  failureThreshold: number;
  recoveryThreshold: number;
};

type Check = {
  id: string;
  source: "SIMULATED" | "HTTP";
  result: "SUCCESS" | "DEGRADED" | "FAILURE" | "TIMEOUT";
  observedStatus: "UNKNOWN" | "AVAILABLE" | "DEGRADED" | "UNAVAILABLE" | "MAINTENANCE";
  responseTimeMs: number | null;
  httpStatusCode: number | null;
  detail: string | null;
  checkedAt: string;
};

type IncidentStatus = "OPEN" | "ACKNOWLEDGED" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
type IncidentSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

type IncidentEvent = {
  id: string;
  kind: "OPENED" | "STATUS_CHANGED" | "CHANNEL_RECOVERED";
  actorType: "SYSTEM" | "USER";
  previousStatus: IncidentStatus | null;
  newStatus: IncidentStatus;
  note: string | null;
  createdAt: string;
  actor: { email: string; role: User["role"] } | null;
  check: Check | null;
};

type Incident = {
  id: string;
  channelId: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  summary: string;
  reason: string;
  evidence: string;
  detectedAt: string;
  openedAt: string;
  recoveredAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  channel: {
    id: string;
    code: string;
    name: string;
    currentStatus: Channel["currentStatus"];
  };
  detectionCheck: Check | null;
  events?: IncidentEvent[];
};

type Channel = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  type: "APP" | "INTERNET_BANKING" | "MULTIRED_VIRTUAL";
  simulatedTarget: string;
  currentStatus: "UNKNOWN" | "AVAILABLE" | "DEGRADED" | "UNAVAILABLE" | "MAINTENANCE";
  monitoringEnabled: boolean;
  monitoringConfig: MonitoringConfig | null;
  checks: Check[];
};

type PageState =
  | { kind: "loading" }
  | { kind: "login" }
  | { kind: "app"; user: User };

type FormMode = "login" | "register";
type MonitoringConfigInput = MonitoringConfig;

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const body = (await response.json()) as { data?: T; error?: { message?: string } };
  if (!response.ok) {
    throw new Error(body.error?.message ?? `La solicitud falló (${response.status})`);
  }
  if (!body.data) {
    throw new Error("La respuesta del servicio no tiene el formato esperado");
  }
  return body.data;
}

const statusLabels: Record<Channel["currentStatus"], string> = {
  UNKNOWN: "Sin verificar",
  AVAILABLE: "OPERATIVO",
  DEGRADED: "DEGRADADO",
  UNAVAILABLE: "CAÍDO",
  MAINTENANCE: "MANTENIMIENTO",
};

const typeLabels: Record<Channel["type"], string> = {
  APP: "Aplicación móvil",
  INTERNET_BANKING: "Banca por internet",
  MULTIRED_VIRTUAL: "Multired Virtual",
};

const resultLabels: Record<Check["result"], string> = {
  SUCCESS: "Correcta",
  DEGRADED: "Degradada",
  FAILURE: "Fallida",
  TIMEOUT: "Tiempo agotado",
};

const incidentStatusLabels: Record<IncidentStatus, string> = {
  OPEN: "ABIERTA",
  ACKNOWLEDGED: "RECONOCIDA",
  IN_PROGRESS: "EN INVESTIGACIÓN",
  RESOLVED: "RESUELTA",
  CLOSED: "CERRADA",
};

const incidentSeverityLabels: Record<IncidentSeverity, string> = {
  LOW: "BAJA",
  MEDIUM: "MEDIA",
  HIGH: "ALTA",
  CRITICAL: "CRÍTICA",
};

const intervalMilliseconds = 15_000;

function App() {
  const [page, setPage] = useState<PageState>({ kind: "loading" });
  const [channels, setChannels] = useState<Channel[]>([]);
  const [history, setHistory] = useState<Record<string, Check[]>>({});
  const [expandedHistory, setExpandedHistory] = useState<Record<string, boolean>>({});
  const [checkingChannel, setCheckingChannel] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"channels" | "incidents">("channels");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const loadChannels = useCallback(async () => {
    const result = await apiRequest<{ channels: Channel[] }>("/api/channels");
    setChannels(result.channels);
  }, []);

  useEffect(() => {
    let active = true;
    apiRequest<{ user: User }>("/api/auth/me")
      .then(({ user }) => {
        if (active) {
          setPage({ kind: "app", user });
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof Error && error.message === "Autenticación requerida") {
          setPage({ kind: "login" });
        } else {
          setNotice(error instanceof Error ? error.message : "No se pudo consultar la sesión");
          setPage({ kind: "login" });
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (page.kind !== "app") return;
    let active = true;
    apiRequest<{ channels: Channel[] }>("/api/channels")
      .then(({ channels: loadedChannels }) => {
        if (active) setChannels(loadedChannels);
      })
      .catch((error: unknown) => {
        if (active) setNotice(error instanceof Error ? error.message : "No se pudieron cargar los canales");
      });
    return () => {
      active = false;
    };
  }, [page]);

  useEffect(() => {
    if (page.kind !== "app") return;
    const timer = window.setInterval(() => {
      void loadChannels().catch((error: unknown) => {
        setNotice(error instanceof Error ? error.message : "No se pudo actualizar el panel");
      });
    }, intervalMilliseconds);

    return () => window.clearInterval(timer);
  }, [page.kind, loadChannels]);

  async function handleAuth(email: string, password: string, mode: FormMode) {
    setBusy(true);
    setNotice("");
    try {
      if (mode === "register") {
        await apiRequest<{ user: User }>("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
      }
      const { user } = await apiRequest<{ user: User }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setPage({ kind: "app", user });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo completar la solicitud");
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    setBusy(true);
    try {
      await apiRequest<void>("/api/auth/logout", { method: "POST" });
      setChannels([]);
      setPage({ kind: "login" });
      setNotice("Sesión cerrada.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo cerrar la sesión");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateChannel(input: {
    code: string;
    name: string;
    description: string;
    type: Channel["type"];
    simulatedTarget: string;
  }): Promise<boolean> {
    setBusy(true);
    setNotice("");
    try {
      await apiRequest<{ channel: Channel }>("/api/channels", {
        method: "POST",
        body: JSON.stringify({
          ...input,
          code: input.code.trim().toUpperCase(),
          description: input.description.trim() || undefined,
        }),
      });
      await loadChannels();
      setNotice("Canal registrado.");
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo registrar el canal");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleMonitoring(channel: Channel) {
    setBusy(true);
    setNotice("");
    try {
      await apiRequest<{ channel: Channel }>(`/api/channels/${channel.id}/monitoring`, {
        method: "PATCH",
        body: JSON.stringify({ monitoringEnabled: !channel.monitoringEnabled }),
      });
      await loadChannels();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo actualizar el canal");
    } finally {
      setBusy(false);
    }
  }

  async function handleManualCheck(channel: Channel) {
    setCheckingChannel(channel.id);
    setNotice("");
    try {
      const { check } = await apiRequest<{ check: Check }>(`/api/channels/${channel.id}/check`, {
        method: "POST",
      });
      await loadChannels();
      const source = check.source === "SIMULATED" ? "simulada" : "HTTP autorizada";
      const outcome = check.result === "SUCCESS" || check.result === "DEGRADED"
        ? "correcta"
        : "fallida";
      setNotice(`Verificación ${source} ${outcome}: ${statusLabels[check.observedStatus]}.`);
      if (expandedHistory[channel.id]) {
        await handleLoadHistory(channel.id);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo verificar el canal");
    } finally {
      setCheckingChannel(null);
    }
  }

  async function handleLoadHistory(channelId: string) {
    setExpandedHistory((current) => ({ ...current, [channelId]: true }));
    try {
      const { checks: loadedHistory } = await apiRequest<{ checks: Check[]; nextCursor: string | null }>(
        `/api/channels/${channelId}/checks?limit=10`,
      );
      setHistory((current) => ({ ...current, [channelId]: loadedHistory }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo cargar el historial");
    }
  }

  function toggleHistory(channelId: string) {
    if (expandedHistory[channelId]) {
      setExpandedHistory((current) => ({ ...current, [channelId]: false }));
      return;
    }
    void handleLoadHistory(channelId);
  }

  async function handleMaintenanceToggle(channel: Channel) {
    setBusy(true);
    setNotice("");
    try {
      const status = channel.currentStatus === "MAINTENANCE" ? "UNKNOWN" : "MAINTENANCE";
      await apiRequest<{ channel: Channel }>(`/api/channels/${channel.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await loadChannels();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo actualizar el estado");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveMonitoringConfig(channelId: string, input: MonitoringConfigInput) {
    setBusy(true);
    setNotice("");
    try {
      await apiRequest<{ monitoringConfig: MonitoringConfig }>(
        `/api/channels/${channelId}/monitoring/config`,
        { method: "PATCH", body: JSON.stringify(input) },
      );
      await loadChannels();
      setNotice("Umbrales de monitoreo actualizados.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudieron actualizar los umbrales");
    } finally {
      setBusy(false);
    }
  }

  if (page.kind === "loading") {
    return (
      <main className="auth-shell">
        <div className="loading-card" role="status">Cargando SIMONA-BN…</div>
      </main>
    );
  }

  if (page.kind === "login") {
    return (
      <AuthScreen
        busy={busy}
        notice={notice}
        onSubmit={handleAuth}
      />
    );
  }

  const canManage = page.user.role === "ADMIN" || page.user.role === "OPERATOR";
  return (
    <div className="dashboard-shell">
      <header className="topbar">
        <a className="brand" href="#inicio" aria-label="SIMONA-BN, inicio">
          <span className="brand-mark" aria-hidden="true">S</span>
          <span>SIMONA<span className="brand-accent">-BN</span></span>
        </a>
        <nav aria-label="Navegación principal">
          <button
            className={`nav-link nav-button ${activeTab === "channels" ? "active" : ""}`}
            onClick={() => setActiveTab("channels")}
          >
            Canales
          </button>
          <button
            className={`nav-link nav-button ${activeTab === "incidents" ? "active" : ""}`}
            onClick={() => setActiveTab("incidents")}
          >
            Incidencias
          </button>
          <a className="nav-link" href="#acerca">Acerca del proyecto</a>
        </nav>
        <div className="account-menu">
          <span className="role-tag">{page.user.role}</span>
          <span className="account-email">{page.user.email}</span>
          <button className="text-button" disabled={busy} onClick={handleLogout}>Salir</button>
        </div>
      </header>

      <main id="inicio">
        <section className="dashboard-hero">
          <div>
            <p className="eyebrow"><span className="eyebrow-line" /> ADMINISTRACIÓN SIMULADA</p>
            <h1>Canales digitales</h1>
            <p className="hero-description">
              M1 registra disponibilidad simulada. El modo HTTP solo consulta hosts HTTPS autorizados explícitamente.
            </p>
          </div>
          <div className="catalog-count">
            <strong>{channels.length.toString().padStart(2, "0")}</strong>
            <span>CANALES REGISTRADOS</span>
          </div>
        </section>

        {notice && <p className="notice" role="status">{notice}</p>}

        {activeTab === "channels" ? (
          <>
            {canManage && <ChannelForm busy={busy} onSubmit={handleCreateChannel} />}
            {!canManage && (
              <p className="permission-note">
                Tu cuenta puede consultar los canales. Se requiere rol ADMIN u OPERATOR para registrar canales o gestionar monitoreo.
              </p>
            )}
            <section className="channels-section" id="canales">
          <div className="section-heading">
            <div>
              <p className="eyebrow">CATÁLOGO</p>
              <h2>Servicios registrados</h2>
            </div>
            <span className="simulation-label"><span /> Datos simulados</span>
          </div>

          {channels.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon" aria-hidden="true">S</span>
              <h3>No hay canales registrados</h3>
              <p>Ejecuta el seed de demostración o registra el primer canal si tu rol lo permite.</p>
            </div>
          ) : (
            <div className="channel-grid">
              {channels.map((channel) => (
                <article className="channel-card" key={channel.id}>
                  <div className="channel-card-top">
                    <span className="channel-icon" aria-hidden="true">{channel.name.slice(0, 1)}</span>
                    <span className={`channel-status status-${channel.currentStatus.toLowerCase()}`}>
                      <span />{statusLabels[channel.currentStatus]}
                    </span>
                  </div>
                  <p className="channel-code">{channel.code}</p>
                  <h3>{channel.name}</h3>
                  <p className="channel-description">{channel.description || typeLabels[channel.type]}</p>
                  <div className="channel-meta">
                    <span>{typeLabels[channel.type]}</span>
                    <code>{channel.simulatedTarget}</code>
                  </div>
                  <div className="last-check">
                    <span>Última verificación</span>
                    {channel.checks[0] ? (
                      <strong>
                        {resultLabels[channel.checks[0].result]} ·{" "}
                        {new Date(channel.checks[0].checkedAt).toLocaleString("es-PE")}
                        {channel.checks[0].responseTimeMs !== null
                          ? ` · ${channel.checks[0].responseTimeMs} ms`
                          : ""}
                      </strong>
                    ) : <strong>Sin registros</strong>}
                    {channel.checks[0] && (
                      <span className="check-provenance">
                        {channel.checks[0].source === "SIMULATED" ? "Resultado simulado" : "Comprobación HTTP"}
                        {channel.checks[0].httpStatusCode !== null
                          ? ` · HTTP ${channel.checks[0].httpStatusCode}`
                          : ""}
                      </span>
                    )}
                  </div>
                  <div className="channel-card-footer">
                    <span className={channel.monitoringEnabled ? "monitoring-on" : "monitoring-off"}>
                      {channel.monitoringEnabled ? "Monitoreo habilitado" : "Monitoreo deshabilitado"}
                    </span>
                    {canManage && (
                      <div className="channel-actions">
                        <button
                          className="toggle-button"
                          disabled={busy}
                          onClick={() => void handleToggleMonitoring(channel)}
                          aria-label={`${channel.monitoringEnabled ? "Deshabilitar" : "Habilitar"} monitoreo de ${channel.name}`}
                        >
                          {channel.monitoringEnabled ? "Deshabilitar" : "Habilitar"}
                        </button>
                        <button
                          className="toggle-button"
                          disabled={busy || checkingChannel === channel.id || channel.currentStatus === "MAINTENANCE"}
                          onClick={() => void handleManualCheck(channel)}
                        >
                          {channel.currentStatus === "MAINTENANCE"
                            ? "En mantenimiento"
                            : checkingChannel === channel.id ? "Verificando…" : "Verificar ahora"}
                        </button>
                        <button
                          className="toggle-button"
                          disabled={busy}
                          onClick={() => void handleMaintenanceToggle(channel)}
                        >
                          {channel.currentStatus === "MAINTENANCE" ? "Reanudar" : "Mantenimiento"}
                        </button>
                      </div>
                    )}
                  </div>
                  {canManage && channel.monitoringConfig && (
                    <MonitoringConfigEditor
                      busy={busy}
                      config={channel.monitoringConfig}
                      onSave={(input) => handleSaveMonitoringConfig(channel.id, input)}
                    />
                  )}
                  <button
                    className="history-trigger"
                    onClick={() => toggleHistory(channel.id)}
                    aria-expanded={Boolean(expandedHistory[channel.id])}
                  >
                    {expandedHistory[channel.id] ? "Ocultar historial" : "Ver historial"}
                  </button>
                  {expandedHistory[channel.id] && (
                    <div className="check-history" aria-live="polite">
                      {!history[channel.id]?.length && <p>Este canal todavía no tiene verificaciones.</p>}
                      {history[channel.id]?.map((check) => (
                        <div className="history-row" key={check.id}>
                          <span className={`history-result result-${check.result.toLowerCase()}`}>
                            {resultLabels[check.result]}
                          </span>
                          <span>{statusLabels[check.observedStatus]}</span>
                          <span>{new Date(check.checkedAt).toLocaleString("es-PE")}</span>
                          <span>{check.responseTimeMs === null ? "—" : `${check.responseTimeMs} ms`}</span>
                          <span>{check.httpStatusCode === null ? "" : `HTTP ${check.httpStatusCode}`}</span>
                          <span>{check.source === "SIMULATED" ? "Simulación" : "HTTP/red"}</span>
                          {check.detail && <p>{check.detail}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
          <p className="scope-note">Las verificaciones manuales y el scheduler registran el resultado en PostgreSQL. Las tareas usan un intervalo mínimo de 15 segundos.</p>
            </section>
          </>
        ) : (
          <IncidentsPanel channels={channels} user={page.user} setNotice={setNotice} />
        )}

        <section className="about-section" id="acerca">
          <div className="about-mark" aria-hidden="true">S</div>
          <div>
            <p className="eyebrow">SIMONA-BN</p>
            <h2>Una base para observar y aprender.</h2>
            <p>Proyecto universitario. No se conecta con sistemas internos del Banco de la Nación y no procesa transacciones reales.</p>
          </div>
          <span className="version-label">MONITOREO M1 · 0.3.0</span>
        </section>
      </main>

      <footer>
        <span>SIMONA-BN <span className="footer-separator">·</span> Proyecto académico</span>
        <span>Servicios y datos simulados</span>
      </footer>
    </div>
  );
}

function AuthScreen({
  busy,
  notice,
  onSubmit,
}: {
  busy: boolean;
  notice: string;
  onSubmit: (email: string, password: string, mode: FormMode) => Promise<void>;
}) {
  const [mode, setMode] = useState<FormMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onSubmit(email, password, mode);
  }

  return (
    <main className="auth-shell">
      <a className="brand auth-brand" href="#inicio" aria-label="SIMONA-BN">
        <span className="brand-mark" aria-hidden="true">S</span>
        <span>SIMONA<span className="brand-accent">-BN</span></span>
      </a>
      <section className="auth-card">
        <p className="eyebrow"><span className="eyebrow-line" /> ENTORNO ACADÉMICO SIMULADO</p>
        <h1>{mode === "login" ? "Bienvenido." : "Crear cuenta."}</h1>
        <p className="auth-description">
          {mode === "login"
            ? "Inicia sesión para consultar el catálogo de canales."
            : "Las cuentas nuevas comienzan con permisos de solo lectura."}
        </p>
        {notice && <p className="notice" role="alert">{notice}</p>}
        <form className="auth-form" onSubmit={submit}>
          <label htmlFor="auth-email">Correo electrónico</label>
          <input
            id="auth-email"
            autoComplete="email"
            type="email"
            maxLength={254}
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <label htmlFor="auth-password">Contraseña</label>
          <input
            id="auth-password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            type="password"
            minLength={12}
            maxLength={128}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {mode === "register" && <p className="field-hint">Usa al menos 12 caracteres. La contraseña se almacena como hash seguro.</p>}
          <button className="primary-button auth-submit" disabled={busy} type="submit">
            {busy ? "Procesando…" : mode === "login" ? "Iniciar sesión" : "Crear cuenta"}
            {!busy && <span aria-hidden="true">→</span>}
          </button>
        </form>
        <div className="auth-switch">
          <span>{mode === "login" ? "¿Primera vez en el sistema?" : "¿Ya tienes una cuenta?"}</span>
          <button
            className="text-button"
            type="button"
            onClick={() => setMode(mode === "login" ? "register" : "login")}
          >
            {mode === "login" ? "Crear cuenta" : "Iniciar sesión"}
          </button>
        </div>
      </section>
      <p className="auth-footnote">SIMONA-BN no se conecta a sistemas reales ni realiza pagos.</p>
    </main>
  );
}

function ChannelForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (input: {
    code: string;
    name: string;
    description: string;
    type: Channel["type"];
    simulatedTarget: string;
  }) => Promise<boolean>;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<Channel["type"]>("APP");
  const [simulatedTarget, setSimulatedTarget] = useState("sim://");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const created = await onSubmit({ code, name, description, type, simulatedTarget });
    if (created) {
      setCode("");
      setName("");
      setDescription("");
      setSimulatedTarget("sim://");
    }
  }

  return (
    <section className="form-panel" aria-labelledby="channel-form-title">
      <div className="form-heading">
        <div>
          <p className="eyebrow">GESTIÓN DE CATÁLOGO</p>
          <h2 id="channel-form-title">Registrar un canal simulado</h2>
        </div>
        <span>Solo destinos <code>sim://</code></span>
      </div>
      <form className="channel-form" onSubmit={(event) => void submit(event)}>
        <label>
          Código
          <input
            required
            minLength={2}
            maxLength={40}
            pattern="[A-Za-z][A-Za-z0-9_-]{1,39}"
            placeholder="SERVICIO_DEMO"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </label>
        <label>
          Nombre
          <input required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Tipo
          <select value={type} onChange={(event) => setType(event.target.value as Channel["type"])}>
            <option value="APP">Aplicación</option>
            <option value="INTERNET_BANKING">Banca por internet</option>
            <option value="MULTIRED_VIRTUAL">Multired Virtual</option>
          </select>
        </label>
        <label>
          Identificador simulado
          <input
            required
            minLength={7}
            maxLength={200}
            pattern="sim://[a-z0-9][a-z0-9/_-]*"
            value={simulatedTarget}
            onChange={(event) => setSimulatedTarget(event.target.value)}
          />
        </label>
        <label className="form-description">
          Descripción <span>Opcional</span>
          <input maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
        <button className="primary-button form-submit" disabled={busy} type="submit">
          {busy ? "Guardando…" : "Registrar canal"} <span aria-hidden="true">+</span>
        </button>
      </form>
    </section>
  );
}

function MonitoringConfigEditor({
  busy,
  config,
  onSave,
}: {
  busy: boolean;
  config: MonitoringConfig;
  onSave: (input: MonitoringConfigInput) => Promise<void>;
}) {
  const [settings, setSettings] = useState(config);

  useEffect(() => setSettings(config), [config]);

  function setField(field: keyof MonitoringConfig, value: string) {
    setSettings((current) => ({ ...current, [field]: Number(value) }));
  }

  return (
    <details className="monitoring-settings">
      <summary>Configurar umbrales</summary>
      <form
        className="settings-form"
        onSubmit={(event) => {
          event.preventDefault();
          void onSave(settings);
        }}
      >
        <label>
          Intervalo (s)
          <input
            type="number"
            min={15}
            max={86400}
            value={settings.checkIntervalSeconds}
            onChange={(event) => setField("checkIntervalSeconds", event.target.value)}
          />
        </label>
        <label>
          Timeout (ms)
          <input
            type="number"
            min={100}
            max={60000}
            value={settings.timeoutMillis}
            onChange={(event) => setField("timeoutMillis", event.target.value)}
          />
        </label>
        <label>
          Umbral lento (ms)
          <input
            type="number"
            min={1}
            max={60000}
            value={settings.latencyWarningMillis}
            onChange={(event) => setField("latencyWarningMillis", event.target.value)}
          />
        </label>
        <label>
          Fallos consecutivos
          <input
            type="number"
            min={1}
            max={20}
            value={settings.failureThreshold}
            onChange={(event) => setField("failureThreshold", event.target.value)}
          />
        </label>
        <label>
          Éxitos para recuperar
          <input
            type="number"
            min={1}
            max={20}
            value={settings.recoveryThreshold}
            onChange={(event) => setField("recoveryThreshold", event.target.value)}
          />
        </label>
        <button className="toggle-button" disabled={busy} type="submit">Guardar</button>
      </form>
    </details>
  );
}

function IncidentsPanel({
  channels,
  user,
  setNotice,
}: {
  channels: Channel[];
  user: User;
  setNotice: (notice: string) => void;
}) {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selected, setSelected] = useState<Incident | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const [fromFilter, setFromFilter] = useState("");
  const [toFilter, setToFilter] = useState("");
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const canManage = user.role === "ADMIN" || user.role === "OPERATOR";

  const loadIncidents = useCallback(async () => {
    setLoading(true);
    setNotice("");
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (channelFilter) params.set("channelId", channelFilter);
      if (statusFilter) params.set("status", statusFilter);
      if (severityFilter) params.set("severity", severityFilter);
      if (fromFilter) params.set("from", new Date(fromFilter).toISOString());
      if (toFilter) params.set("to", new Date(toFilter).toISOString());
      const result = await apiRequest<{ incidents: Incident[]; nextCursor: string | null }>(
        `/api/incidents?${params.toString()}`,
      );
      setIncidents(result.incidents);
      if (selected && !result.incidents.some((incident) => incident.id === selected.id)) {
        setSelected(null);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudieron cargar las incidencias");
    } finally {
      setLoading(false);
    }
  }, [channelFilter, fromFilter, selected, setNotice, severityFilter, statusFilter, toFilter]);

  useEffect(() => {
    void loadIncidents();
  }, [loadIncidents]);

  async function openDetail(id: string) {
    try {
      const { incident } = await apiRequest<{ incident: Incident }>(`/api/incidents/${id}`);
      setSelected(incident);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo cargar el detalle");
    }
  }

  async function updateStatus(status: IncidentStatus) {
    if (!selected) return;
    setSaving(true);
    setNotice("");
    try {
      await apiRequest<{ incident: Incident }>(`/api/incidents/${selected.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status, comment: comment.trim() || undefined }),
      });
      setComment("");
      await loadIncidents();
      const { incident } = await apiRequest<{ incident: Incident }>(`/api/incidents/${selected.id}`);
      setSelected(incident);
      setNotice(`Incidencia actualizada: ${incidentStatusLabels[incident.status]}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo actualizar la incidencia");
    } finally {
      setSaving(false);
    }
  }

  const nextStatus = selected?.status === "OPEN" || selected?.status === "ACKNOWLEDGED"
    ? "IN_PROGRESS"
    : selected?.status === "IN_PROGRESS"
      ? "RESOLVED"
      : selected?.status === "RESOLVED" && user.role === "ADMIN"
        ? "CLOSED"
        : null;

  return (
    <section className="incident-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">GESTIÓN M2</p>
          <h2>Incidencias</h2>
        </div>
        <span className="simulation-label"><span /> Registro persistido</span>
      </div>

      <form
        className="incident-filters"
        onSubmit={(event) => {
          event.preventDefault();
          void loadIncidents();
        }}
      >
        <label>
          Canal
          <select value={channelFilter} onChange={(event) => setChannelFilter(event.target.value)}>
            <option value="">Todos</option>
            {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
          </select>
        </label>
        <label>
          Estado
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="">Todos</option>
            {Object.entries(incidentStatusLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label>
          Severidad
          <select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)}>
            <option value="">Todas</option>
            {Object.entries(incidentSeverityLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label>
          Desde
          <input type="datetime-local" value={fromFilter} onChange={(event) => setFromFilter(event.target.value)} />
        </label>
        <label>
          Hasta
          <input type="datetime-local" value={toFilter} onChange={(event) => setToFilter(event.target.value)} />
        </label>
        <button className="toggle-button" type="submit" disabled={loading}>
          {loading ? "Cargando…" : "Filtrar"}
        </button>
      </form>

      <div className="incident-layout">
        <div className="incident-list" aria-live="polite">
          {incidents.length === 0 && !loading && (
            <div className="empty-state">
              <h3>No hay incidencias para estos filtros</h3>
              <p>Las incidencias se abren al alcanzar el umbral de fallos consecutivos.</p>
            </div>
          )}
          {incidents.map((incident) => (
            <button
              className={`incident-list-item ${selected?.id === incident.id ? "selected" : ""}`}
              key={incident.id}
              onClick={() => void openDetail(incident.id)}
            >
              <span className={`incident-severity severity-${incident.severity.toLowerCase()}`}>
                {incidentSeverityLabels[incident.severity]}
              </span>
              <strong>{incident.summary}</strong>
              <span>{incident.channel.name} · {incidentStatusLabels[incident.status]}</span>
              <time dateTime={incident.detectedAt}>
                {new Date(incident.detectedAt).toLocaleString("es-PE")}
              </time>
            </button>
          ))}
        </div>

        {selected ? (
          <article className="incident-detail">
            <div className="incident-detail-heading">
              <div>
                <p className="eyebrow">{selected.channel.code}</p>
                <h3>{selected.summary}</h3>
              </div>
              <span className={`incident-severity severity-${selected.severity.toLowerCase()}`}>
                {incidentSeverityLabels[selected.severity]}
              </span>
            </div>
            <div className="incident-status-line">
              <span>{incidentStatusLabels[selected.status]}</span>
              <span>Canal: {statusLabels[selected.channel.currentStatus]}</span>
            </div>
            <dl className="incident-dates">
              <div><dt>Detectada</dt><dd>{new Date(selected.detectedAt).toLocaleString("es-PE")}</dd></div>
              <div><dt>Inicio</dt><dd>{new Date(selected.openedAt).toLocaleString("es-PE")}</dd></div>
              <div><dt>Recuperación técnica</dt><dd>{selected.recoveredAt ? new Date(selected.recoveredAt).toLocaleString("es-PE") : "Pendiente"}</dd></div>
              <div><dt>Resolución administrativa</dt><dd>{selected.resolvedAt ? new Date(selected.resolvedAt).toLocaleString("es-PE") : "Pendiente"}</dd></div>
              <div><dt>Cierre</dt><dd>{selected.closedAt ? new Date(selected.closedAt).toLocaleString("es-PE") : "Pendiente"}</dd></div>
            </dl>
            <div className="incident-evidence">
              <h4>Motivo</h4>
              <p>{selected.reason}</p>
              <h4>Evidencia de detección</h4>
              <pre>{selected.evidence}</pre>
              {selected.detectionCheck && (
                <p className="evidence-source">
                  Origen: {selected.detectionCheck.source === "SIMULATED" ? "fallo simulado" : "HTTP/red"}
                  {" · "}{resultLabels[selected.detectionCheck.result]}
                  {selected.detectionCheck.responseTimeMs !== null
                    ? ` · ${selected.detectionCheck.responseTimeMs} ms`
                    : ""}
                  {selected.detectionCheck.httpStatusCode !== null
                    ? ` · HTTP ${selected.detectionCheck.httpStatusCode}`
                    : ""}
                </p>
              )}
            </div>
            <div className="incident-timeline">
              <h4>Auditoría</h4>
              {selected.events?.map((event) => (
                <div className="incident-event" key={event.id}>
                  <span className="event-dot" />
                  <div>
                    <strong>
                      {event.kind === "CHANNEL_RECOVERED"
                        ? "Recuperación técnica"
                        : event.kind === "OPENED"
                          ? "Incidencia abierta automáticamente"
                          : `${event.previousStatus ? incidentStatusLabels[event.previousStatus] : "—"} → ${incidentStatusLabels[event.newStatus]}`}
                    </strong>
                    <p>{event.note || (event.actor?.email ?? "Sistema")}</p>
                    <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString("es-PE")}</time>
                  </div>
                </div>
              ))}
            </div>
            {canManage && nextStatus && (
              <form
                className="incident-action"
                onSubmit={(event) => {
                  event.preventDefault();
                  void updateStatus(nextStatus);
                }}
              >
                <label htmlFor="incident-comment">Comentario de auditoría (opcional)</label>
                <input
                  id="incident-comment"
                  maxLength={500}
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="Describe la acción realizada"
                />
                <button className="primary-button" disabled={saving} type="submit">
                  {saving ? "Actualizando…" : incidentStatusLabels[nextStatus]}
                </button>
              </form>
            )}
            {selected.status === "RESOLVED" && user.role !== "ADMIN" && (
              <p className="permission-note">Solo ADMIN puede cerrar una incidencia resuelta.</p>
            )}
          </article>
        ) : (
          <div className="incident-detail incident-detail-empty">
            <p>Selecciona una incidencia para consultar evidencia, recuperación y trazabilidad.</p>
          </div>
        )}
      </div>
      <p className="scope-note">
        La recuperación técnica se registra por separado; no resuelve ni cierra administrativamente la incidencia.
      </p>
    </section>
  );
}

export default App;
