# Guion de Demostración — SIMONA-BN

## 1. Propósito y advertencias

Demostrar, con datos **simulados**, el recorrido de catálogo → verificación → caída → apertura automática → seguimiento → recuperación técnica → resolución/cierre administrativo. La demostración no consulta sistemas del Banco de la Nación, no prueba disponibilidad real y no implica autorización institucional.

**Duración sugerida:** 8–12 minutos. Es una estimación para organizar la exposición, no una medición.

## 2. Preparación previa

1. Preparar PostgreSQL local y configurar `apps/api/.env` según el [manual técnico](./manual-tecnico.md).
2. Aplicar migraciones existentes, generar Prisma y ejecutar seed:

   ```bash
   npm run db:migrate:deploy
   npm run db:generate
   npm run db:seed
   ```

3. Si se necesita gestionar canales/incidencias, configurar en local `SEED_ADMIN_EMAIL` y `SEED_ADMIN_PASSWORD` con valores de demostración y volver a ejecutar seed. No usar credenciales reales ni mostrarlas en pantalla.
4. Mantener `MONITORING_DRIVER=simulated`.
5. Abrir terminales separadas:

   ```bash
   npm run dev:api
   ```

   ```bash
   npm run dev:web
   ```

6. Abrir <http://localhost:5173>. Comprobar opcionalmente <http://localhost:3001/api/health>; el endpoint indica salud del proceso, no de la base de datos.
7. En la exposición, indicar qué módulos existen y cuáles son propuestos/pendientes. No mostrar `.env`, tokens, contraseñas ni datos reales.

## 3. Recorrido de exposición

### Paso 1 — Inicio de sesión

- Presentar la pantalla y autenticarse con la cuenta `ADMIN` local creada mediante seed.
- Señalar el rol visible. Una cuenta autorregistrada recibe rol `VIEWER` y no puede registrar canales ni gestionar incidencias.
- Explicar que la sesión se implementa con cookie; no narrar que es un mecanismo de producción certificado.

**Resultado que se espera del código:** acceso al panel autenticado. Si falla, revisar configuración, seed y conexión local; no describir el fallo como una incidencia del BN.

### Paso 2 — Registro de canal de demostración

En la pestaña **Canales**, registrar un canal nuevo para evitar alterar el escenario existente:

| Campo | Valor de ejemplo |
|---|---|
| Código | `DEMO_PAGO_SEM9` |
| Nombre | `Canal de demostración semana 9` |
| Tipo | `APP` |
| Destino simulado | `sim://app-bn` |
| Descripción | `Servicio ficticio para presentación académica` |

El sistema permite un código único y crea configuración de monitoreo predeterminada. Etiquetar verbalmente el canal como ficticio y los datos como simulados.

### Paso 3 — Monitoreo inicial saludable

- Ejecutar **Verificar ahora** una vez.
- Esperar que el canal pase de `UNKNOWN` a `AVAILABLE` con observación `SUCCESS`, fuente `SIMULATED` y latencia simulada de 25 ms.
- Si se desea mostrar el scheduler, activarlo en uno de los canales seed saludables; el ciclo general revisa cada 15 s y respeta la configuración por canal. No esperar una ejecución inmediata si el intervalo aún no venció.
- Abrir el historial y señalar fecha, resultado y origen.

### Paso 4 — Provocar caída simulada y apertura automática

La interfaz actual no ofrece edición del destino del canal. Para conservar el mismo canal y mostrar recuperación, actualice el destino usando la API con la sesión del administrador. Obtenga primero el UUID del canal desde el listado (`GET /api/channels`) o la respuesta de creación.

Ejemplo local con `curl` (sustituir los marcadores; el archivo de cookies contiene una sesión y no debe compartirse):

```bash
curl -sS -c simona-demo.cookies \
  -H 'Content-Type: application/json' \
  -d '{"email":"<CORREO_ADMIN_LOCAL>","password":"<CONTRASENA_ADMIN_LOCAL>"}' \
  http://localhost:3001/api/auth/login
```

Cambiar el canal a un destino de fallo simulado:

```bash
curl -sS -b simona-demo.cookies \
  -X PATCH \
  -H 'Content-Type: application/json' \
  -d '{"simulatedTarget":"sim://down"}' \
  http://localhost:3001/api/channels/<UUID_DEL_CANAL>
```

- En el panel, pulsar **Verificar ahora** tres veces, una por una. No se requiere esperar al intervalo porque son verificaciones manuales.
- Mantener deshabilitado el scheduler para el canal de escenario durante esta secuencia, para que las verificaciones manuales sean reproducibles.
- Con umbral predeterminado 3, las dos primeras observaciones fallidas dejan el canal `DEGRADED`; la tercera lo cambia a `UNAVAILABLE`.
- Abrir la pestaña **Incidencias**. Mostrar la incidencia `OPEN`, severidad `HIGH`, el motivo, la evidencia y el evento automático `OPENED`.
- Explicar que los fallos continuos no duplican la incidencia activa.

**Resultado esperado:** patrón definido por la lógica y tests del repositorio, no resultado experimental de una caída real. Si se configuró un umbral distinto, respetar el valor mostrado.

### Paso 5 — Seguimiento administrativo

- Abrir el detalle de la incidencia.
- Agregar un comentario académico breve y cambiar `OPEN → IN_PROGRESS`.
- Explicar que un `VIEWER` no puede cambiar el estado, y que solamente `ADMIN` puede cerrar.
- Mostrar que la recuperación del servicio no resuelve automáticamente el caso administrativo.

### Paso 6 — Recuperación técnica

Cambiar el destino de nuevo a `sim://app-bn`:

```bash
curl -sS -b simona-demo.cookies \
  -X PATCH \
  -H 'Content-Type: application/json' \
  -d '{"simulatedTarget":"sim://app-bn"}' \
  http://localhost:3001/api/channels/<UUID_DEL_CANAL>
```

- Ejecutar **Verificar ahora** dos veces.
- La primera observación saludable todavía conserva `UNAVAILABLE`; al alcanzar los dos éxitos consecutivos configurados, el canal pasa a `AVAILABLE`.
- Volver a cargar el detalle. Mostrar `recoveredAt` y el evento `CHANNEL_RECOVERED`; la incidencia aún debe estar `IN_PROGRESS`.

### Paso 7 — Resolución y cierre

- Desde el detalle, cambiar `IN_PROGRESS → RESOLVED` y escribir un comentario que resuma la acción de demostración.
- Como la sesión es `ADMIN`, cambiar `RESOLVED → CLOSED`.
- Mostrar `resolvedAt`, `closedAt` y la secuencia de eventos. Confirmar que el canal queda `AVAILABLE`.
- Aclarar que “resuelto” y “cerrado” son estados administrativos y que “recuperación técnica” es un evento separado.

### Paso 8 — Cierre y límites

Concluir mencionando:

- Lo que sí se demostró: persistencia local, verificación `sim://`, umbrales de estado, apertura de incidente, auditoría y separación entre recuperación y cierre.
- Lo que no se demostró: estado real de los canales del BN, integración institucional, notificaciones, portal público, KPI, reportes ni pruebas con usuarios.
- Actividades pendientes: validación de AS-IS, investigación primaria documentada, rúbrica docente, resultados de pruebas ejecutadas y módulos fuera del prototipo.

Al terminar, cerrar sesión, detener los servidores en las terminales y retirar el archivo local `simona-demo.cookies`. No incorporarlo al repositorio.

## 4. Escenarios simulados disponibles

| Destino | Observación del verificador simulado |
|---|---|
| `sim://app-bn` | Éxito, latencia 25 ms |
| `sim://banca-internet` | Éxito, latencia 25 ms |
| `sim://multired-virtual` | Éxito, latencia 25 ms |
| `sim://down` | Fallo simulado |
| `sim://timeout` | Timeout simulado |
| `sim://slow-1500` | Respuesta simulada de 1.500 ms; estado degradado con valor predeterminado |
| `sim://degraded-2000` | Respuesta simulada de 2.000 ms |

Los destinos son etiquetas deterministas de demostración. Ninguno representa disponibilidad observada de una aplicación, sitio o canal real.

## 5. Plan de contingencia para la presentación

- **No aparece la cuenta ADMIN:** revisar variables locales del seed y ejecutarlo de nuevo; no registrar una cuenta de muestra y presentarla como ADMIN, porque el registro asigna `VIEWER`.
- **La base falla:** revisar `DATABASE_URL`, PostgreSQL, migraciones y logs. No afirmar que `/api/health` valida la base.
- **No abre la incidencia:** revisar el conteo de fallos previos del canal, su `failureThreshold`, que se use `sim://down` y que la tercera verificación haya terminado.
- **No recupera:** comprobar destino `sim://app-bn`, `recoveryThreshold` y dos verificaciones manuales exitosas.
- **El endpoint de actualización falla:** verificar UUID, sesión local no vencida y rol `ADMIN`/`OPERATOR`; no incluir el token en capturas.
- **Se decide no usar `curl`:** explicar el flujo y su limitación de UI; no fingir que la interfaz permite editar el destino. El cambio de estado de incidencias sí está disponible desde el panel.
