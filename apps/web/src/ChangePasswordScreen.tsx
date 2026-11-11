import { useState } from "react";
import { apiRequest } from "./api";

export function ChangePasswordScreen({
  email,
  forced,
  onDone,
  onCancel,
}: {
  email: string;
  forced: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword !== confirmation) {
      setError("La confirmación no coincide con la nueva contraseña.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await apiRequest<void>("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      onDone();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo cambiar la contraseña");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow"><span className="eyebrow-line" /> {email}</p>
        <h1>Cambiar contraseña</h1>
        <p className="auth-description">
          {forced
            ? "Tu cuenta tiene una contraseña temporal asignada por un administrador. Define una nueva para continuar."
            : "Las demás sesiones abiertas de tu cuenta se cerrarán."}
        </p>
        {error && <p className="notice" role="alert">{error}</p>}
        <form className="auth-form" onSubmit={(event) => void submit(event)}>
          <label htmlFor="current-password">Contraseña actual{forced ? " (temporal)" : ""}</label>
          <input
            id="current-password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={128}
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
          <label htmlFor="new-password">Nueva contraseña</label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
          <label htmlFor="confirm-password">Repite la nueva contraseña</label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          <p className="field-hint">Usa al menos 12 caracteres y que sea distinta de la actual.</p>
          <button className="primary-button auth-submit" type="submit" disabled={saving}>
            {saving ? "Guardando…" : "Guardar contraseña"}
          </button>
        </form>
        <div className="auth-switch">
          <button className="text-button" type="button" onClick={onCancel}>
            {forced ? "Cerrar sesión" : "Volver al panel"}
          </button>
        </div>
      </section>
    </main>
  );
}
