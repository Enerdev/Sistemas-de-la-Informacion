# Manual Técnico — SIMONA-BN

## 1. Propósito y alcance técnico

Este manual describe el código presente en el repositorio para el prototipo académico. La aplicación usa datos de demostración y el verificador `simulated` por defecto. No es un sistema del Banco de la Nación, no accede a su infraestructura y no procesa pagos ni datos financieros.

## 2. Arquitectura

```mermaid
flowchart LR
    Browser[React + Vite] -->|/api; proxy de desarrollo| Express[Express / TypeScript]
    Express --> Auth[Autenticación y control de acceso]
    Express --> Channel[Catálogo de canales]
    Express --> Monitor[Servicio M1 + scheduler]
    Monitor --> Verifier[Verificador simulated por defecto]
    Verifier -. Alternativa restringida .-> HTTP[Verificador HTTPS allowlist]
    Monitor --> Incident[M2 ciclo de incidencias]
    Public[Portal público /estado] -->|/api/public| Express
    Incident --> Outbox[M3 cola de notificaciones]
    Outbox --> Mailer[Nodemailer: json, Ethereal o SMTP]
    Auth --> Prisma[Prisma Client]
    Channel --> Prisma
    Monitor --> Prisma
    Incident --> Prisma
    Outbox --> Prisma
    Prisma --> PG[(PostgreSQL)]
```

### Tecnologías

- Monorepo npm workspaces; Node.js 20.19+ recomendado (README: 22 LTS).
- API: Node.js, Express 4, TypeScript, Prisma 6, Zod, `node-cron`, Nodemailer 10.
- UI: React 19, TypeScript y Vite 6.
- Persistencia: PostgreSQL (README recomienda versión 16 o superior).
- Pruebas: Vitest, Supertest y pruebas de integración PostgreSQL opcionales.

### Estructura relevante

```text
apps/
  api/
    prisma/
      schema.prisma
      migrations/
      seed.ts
    src/
      app.ts
      server.ts
      auth/          sesiones, contraseña, middleware y endpoints
      channels/      rutas y validación del catálogo
      config/        validación de variables de entorno
      db/            cliente Prisma
      http/          errores y async handlers
      incidents/     consulta, reglas de ciclo de vida y auditoría
      monitoring/    clasificación, verificación, persistencia y scheduler
      integration/   pruebas PostgreSQL
  web/
    src/App.tsx      UI de autenticación, canales e incidencias
    src/styles.css
```

Las rutas de Express se montan en [`apps/api/src/app.ts`](../apps/api/src/app.ts). La aplicación web usa el proxy `/api` configurado en Vite durante el desarrollo.

## 3. Modelo de datos

El esquema completo y sus enums están en [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma).

| Entidad (tabla) | Propósito y relaciones principales |
|---|---|
| `User` (`users`) | Correo único, hash de contraseña y rol `ADMIN`, `OPERATOR` o `VIEWER` |
| `Session` (`sessions`) | Hash SHA-256 del token opaco, usuario, vencimiento |
| `Channel` (`channels`) | Catálogo, tipo, destino de demostración, estado y bandera de monitoreo |
| `MonitoringConfig` (`monitoring_configs`) | Intervalo, timeout, umbral de latencia, fallos y recuperación; única por canal |
| `ChannelCheck` (`channel_checks`) | Fuente, resultado, estado observado, latencia/código HTTP, detalle y hora |
| `Incident` (`incidents`) | Canal, verificación detectada, estado/severidad, motivo/evidencia y marcas de tiempo |
| `IncidentEvent` (`incident_events`) | Apertura, cambios administrativos y recuperación técnica; actor y verificación opcionales |
| `ChannelStatusHistory` (`channel_status_history`) | Historial de cambios de estado del canal y su origen |
| `NotificationRecipient` (`notification_recipients`) | Correo único, nombre, activo y suscripción a caídas/restablecimientos |
| `FailureReport` (`failure_reports`) | Reporte ciudadano: código de seguimiento único, canal, descripción, contacto y fecha opcionales, estado de revisión (`NEW`, `REVIEWED`, `LINKED`, `DISMISSED`), incidencia vinculada, revisor y nota |
| `PaymentScheduleImport` (`payment_schedule_imports`) | Registro de cada importación CSV: archivo, filas, creadas/actualizadas, usuario y fecha |
| `PaymentDate` (`payment_dates`) | Fecha de pago (`DATE`), grupo y descripción; única por fecha y grupo; enlazada a su última importación |
| `Notification` (`notifications`) | Evento (`CHANNEL_DOWN`/`CHANNEL_RECOVERED`), canal, incidencia, destinatario, mensaje, estado de envío, intentos, error, id del proveedor, vista previa y fechas |

Enums relevantes:

- Estado de canal: `UNKNOWN`, `AVAILABLE`, `DEGRADED`, `UNAVAILABLE`, `MAINTENANCE`.
- Resultado de verificación: `SUCCESS`, `DEGRADED`, `FAILURE`, `TIMEOUT`.
- Fuente: `SIMULATED` o `HTTP`.
- Estado de incidencia: `OPEN`, `ACKNOWLEDGED`, `IN_PROGRESS`, `RESOLVED`, `CLOSED`.
- Severidad: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`.

La migración inicial crea un índice único parcial que impide más de una incidencia activa (`OPEN`, `ACKNOWLEDGED`, `IN_PROGRESS`) por canal. Las migraciones M1 y M2 añaden metadatos de verificación y evidencia/recuperación de incidencias. La migración M3 crea destinatarios y notificaciones, con restricciones `CHECK` que impiden intentos negativos y un estado `SENT` sin fecha de envío. La migración M5 agrega `incidents.startedAt` (inicio real) y `CHECK` que impiden inicio posterior a la detección y estados `RESOLVED`/`CLOSED` sin sus fechas. La migración M4 crea los reportes ciudadanos con `CHECK` que exigen incidencia en `LINKED` y fecha de revisión fuera de `NEW`; la incidencia vinculada usa `ON DELETE RESTRICT`.

## 4. Instalación y configuración local

### Requisitos previos

- Node.js 20.19+ y npm.
- PostgreSQL local o de desarrollo con una base exclusiva para SIMONA-BN.
- No es requisito disponer de una cuenta ni integración del BN.

### Preparar entorno

Desde la raíz del repositorio:

```bash
npm install
cp .env.example apps/api/.env
```

Edite `apps/api/.env` con una conexión PostgreSQL local; no pegue credenciales en documentación, repositorio ni capturas. Ejemplo de formato (valores ficticios):

```dotenv
DATABASE_URL=postgresql://usuario:contraseña@localhost:5432/simona_bn?schema=public
```

Si el usuario de PostgreSQL tiene permiso, cree la base:

```bash
createdb simona_bn
```

Aplicar migraciones existentes y preparar Prisma:

```bash
npm run db:migrate:deploy
npm run db:generate
npm run db:seed
```

Para una modificación deliberada del esquema en desarrollo, use `npm run db:migrate -- --name nombre_descriptivo` y revise/guarde la nueva migración. En un clon limpio con migraciones existentes, `db:migrate:deploy` las aplica sin crear migraciones nuevas.

### Cuenta ADMIN de demostración

Opcionalmente, antes de ejecutar el seed, defina en `apps/api/.env` **ambas** variables privadas:

```dotenv
SEED_ADMIN_EMAIL=admin-demo@example.test
SEED_ADMIN_PASSWORD=<contraseña-local-de-12-o-más-caracteres>
```

Use una contraseña local distinta de cualquier credencial real. El seed crea una cuenta `ADMIN` solo cuando ambas variables están configuradas y no permite ese aprovisionamiento en producción. Sin ellas, el seed asegura solo los tres canales simulados. Las cuentas registradas desde la interfaz reciben `VIEWER`.

## 5. Variables de entorno

La referencia está en [`.env.example`](../.env.example); `apps/api/.env` es local y no debe subirse a Git.

| Variable | Requerida / valor predeterminado | Función |
|---|---|---|
| `NODE_ENV` | Opcional; `development` | `development`, `test` o `production`; cookie `Secure` se activa en producción |
| `PORT` | Opcional; `3001` | Puerto HTTP de la API |
| `DATABASE_URL` | Requerida | URL `postgresql://` o `postgres://` |
| `SESSION_TTL_HOURS` | Opcional; `12` | Duración de sesión, entre 1 y 168 horas |
| `SEED_ADMIN_EMAIL` | Opcional | Correo del administrador de desarrollo; debe configurarse junto con contraseña |
| `SEED_ADMIN_PASSWORD` | Opcional | Entre 12 y 128 caracteres |
| `MONITORING_DRIVER` | Opcional; `simulated` | `simulated` o `http` |
| `MONITORING_HTTP_ALLOWED_HOSTS` | Opcional; vacío | Lista separada por comas de autoridades exactas `host[:puerto]`; obligatoria para `http` |
| `NOTIFICATIONS_DRIVER` | Opcional; `json` | `json` (sin red), `ethereal` (buzón de prueba) o `smtp` |
| `NOTIFICATIONS_FROM` | Opcional; `SIMONA-BN <alertas@simona.test>` | Remitente de las alertas |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` | Requerido `SMTP_HOST` solo para `smtp`; puerto `587`, `false` | Servidor SMTP |
| `SMTP_USER`, `SMTP_PASS` | Opcionales, siempre juntos | Credenciales SMTP; con `ethereal` fijan una cuenta de prueba existente |
| `TEST_DATABASE_URL` | Solo pruebas PostgreSQL | Base local de pruebas cuyo nombre termina en `_test`; no es `DATABASE_URL` productiva |

El modo HTTP solo realiza GET HTTPS, rechaza credenciales en URL, no sigue redirecciones y exige coincidencia exacta con la allowlist. Cambiar `MONITORING_DRIVER` requiere reiniciar la API. Para la demostración, mantener `MONITORING_DRIVER=simulated`.

## 6. Migraciones y seed

Archivos versionados:

- `apps/api/prisma/migrations/20261014165500_initial_schema`
- `apps/api/prisma/migrations/20261014170500_m1_check_provenance`
- `apps/api/prisma/migrations/20261014172000_m2_incident_evidence_recovery`

Comandos desde la raíz:

| Comando | Efecto |
|---|---|
| `npm run db:migrate:deploy` | Aplica migraciones ya versionadas |
| `npm run db:migrate -- --name descripcion` | Flujo de desarrollo para cambios de esquema |
| `npm run db:generate` | Genera el cliente Prisma |
| `npm run db:seed` | Asegura `APP_BN`, `BANCA_INTERNET`, `MULTIRED_VIRTUAL`; opcionalmente crea ADMIN de desarrollo |

El seed es idempotente por código de canal/correo. No muestra credenciales. El monitoreo de los canales sembrados comienza deshabilitado.

## 7. Endpoints HTTP

Base URL de desarrollo: `http://localhost:3001`; el frontend usa `/api`. Salvo registro/login/logout/health, las rutas requieren cookie de sesión. Los cambios de canal/verificación requieren `ADMIN` o `OPERATOR`; ver incidencias requiere autenticación y sus cambios requieren `ADMIN`/`OPERATOR` con cierre exclusivo de `ADMIN`.

### Salud y autenticación

| Método | Ruta | Acceso | Función |
|---|---|---|---|
| `GET` | `/api/health` | Público | Salud del proceso HTTP y timestamp; no comprueba conexión a PostgreSQL |
| `POST` | `/api/auth/register` | Público | Registrar cuenta `VIEWER` |
| `POST` | `/api/auth/login` | Público | Crear sesión y devolver cookie |
| `POST` | `/api/auth/logout` | Público | Revocar token si existe y limpiar cookie |
| `GET` | `/api/auth/me` | Sesión | Consultar usuario autenticado |

### Canales

| Método | Ruta | Acceso | Función |
|---|---|---|---|
| `GET` | `/api/channels` | Sesión | Listar canales, configuración y última verificación |
| `GET` | `/api/channels/:id` | Sesión | Consultar detalle |
| `POST` | `/api/channels` | ADMIN/OPERATOR | Crear canal/configuración |
| `PATCH` | `/api/channels/:id` | ADMIN/OPERATOR | Actualizar datos de canal |
| `PATCH` | `/api/channels/:id/monitoring` | ADMIN/OPERATOR | Habilitar/deshabilitar scheduler |
| `PATCH` | `/api/channels/:id/monitoring/config` | ADMIN/OPERATOR | Actualizar umbrales |
| `PATCH` | `/api/channels/:id/status` | ADMIN/OPERATOR | Poner en `MAINTENANCE` o devolver a `UNKNOWN` |
| `POST` | `/api/channels/:id/check` | ADMIN/OPERATOR | Ejecutar verificación manual |
| `GET` | `/api/channels/:id/checks?limit=20&cursor=...` | Sesión | Consultar historial paginado (`limit` 1–100) |

Configuración admitida: intervalo 15–86.400 s; timeout 100–60.000 ms; umbral de latencia 1–60.000 ms; umbrales de fallos y recuperación 1–20. Las propiedades se validan estrictamente.

### Incidencias

| Método | Ruta | Acceso | Función |
|---|---|---|---|
| `GET` | `/api/incidents?channelId=&status=&severity=&from=&to=&limit=&cursor=` | Sesión | Filtrar/listar; límite 1–100, predeterminado 25 |
| `GET` | `/api/incidents/:id` | Sesión | Consultar incidente, evidencia, verificación y eventos |
| `PATCH` | `/api/incidents/:id/status` | ADMIN/OPERATOR | Cambiar estado con `{ "status": "...", "comment": "..." }`; cierre solo ADMIN |

Transiciones aceptadas: `OPEN → IN_PROGRESS`; `ACKNOWLEDGED → IN_PROGRESS`; `IN_PROGRESS → RESOLVED`; `RESOLVED → CLOSED`. Los cambios fuera de transición responden conflicto; `VIEWER` recibe denegación de permisos.

### Notificaciones (M3)

| Método | Ruta | Acceso | Función |
|---|---|---|---|
| `GET` | `/api/notifications?status=&kind=&channelId=&incidentId=&limit=&cursor=` | ADMIN/OPERATOR | Registro de envíos y transporte activo |
| `POST` | `/api/notifications/:id/retry` | ADMIN/OPERATOR | Reprograma una notificación `FAILED` (un intento adicional) |
| `GET` | `/api/notifications/recipients` | ADMIN/OPERATOR | Lista de destinatarios |
| `POST` | `/api/notifications/recipients` | ADMIN | Alta con `{ "email", "name"?, "notifyDown"?, "notifyRecovery"? }` |
| `PATCH` | `/api/notifications/recipients/:id` | ADMIN | Cambiar nombre, suscripciones o activar/desactivar |

Las notificaciones se insertan en la transacción de la verificación (outbox). El despachador las envía tras cada verificación manual y en cada barrido del scheduler (15 s); reserva cada fila antes de enviarla para evitar duplicados y reintenta a los 30 s y 60 s antes de marcarla `FAILED`.

### Portal público y reportes (M4)

| Método | Ruta | Acceso | Función |
|---|---|---|---|
| `GET` | `/api/public/status` | Público | Canales con estado y última verificación; sin destino ni configuración |
| `GET` | `/api/public/incidents` | Público | Incidencias activas y de los últimos 7 días (máx. 20), sin motivo ni evidencia |
| `POST` | `/api/public/reports` | Público; 5 por IP cada 15 min | Registrar reporte `{ channelId, description, occurredAt?, contactEmail?, website? }`; devuelve código `R-XXXXXXXX` |
| `GET` | `/api/public/reports/:referenceCode` | Público; 30 por IP cada 15 min | Seguimiento: estado, revisión e incidencia vinculada, sin datos de contacto |
| `GET` | `/api/reports?status=&channelId=&limit=&cursor=` | ADMIN/OPERATOR | Bandeja de reportes con contacto |
| `PATCH` | `/api/reports/:id` | ADMIN/OPERATOR | Revisar, descartar o vincular a una incidencia del mismo canal |

El límite por IP está en memoria (`apps/api/src/http/rate-limit.ts`): es válido para una instancia. En producción detrás de un proxy hay que configurar `trust proxy` en Express.

### Indicadores y cronograma (M5)

| Método | Ruta | Acceso | Función |
|---|---|---|---|
| `GET` | `/api/indicators?from=&to=&target=` | Sesión | Indicadores globales, por canal, reporte por excepción y fechas de pago del periodo (máx. un año; meta 50–100, predeterminada 99) |
| `GET` | `/api/payment-schedule?from=&to=` | Sesión | Fechas de pago (máx. 500) y últimas 5 importaciones |
| `POST` | `/api/payment-schedule/import` | ADMIN/OPERATOR | Importación atómica de CSV; `422` con el detalle por línea si hay errores |
| `DELETE` | `/api/payment-schedule/:id` | ADMIN | Eliminar una fecha |

El cálculo vive en [`apps/api/src/indicators/calculations.ts`](../apps/api/src/indicators/calculations.ts) (funciones puras con pruebas unitarias) y [`service.ts`](../apps/api/src/indicators/service.ts). Los días de pago se interpretan en hora de Lima (UTC−5, sin horario de verano). La ruta de importación se monta antes del parser JSON global para admitir hasta 256 KB.

### Reportes CSV/PDF

| Método | Ruta | Acceso | Función |
|---|---|---|---|
| `GET` | `/api/exports/availability.{csv,pdf}?from=&to=&target=&channelId=&granularity=` | Sesión | Disponibilidad por canal (`channel`) o por canal y día (`day`) |
| `GET` | `/api/exports/exceptions.{csv,pdf}?from=&to=&target=` | Sesión | Canal-día de pago bajo la meta |
| `GET` | `/api/exports/incidents.{csv,pdf}?from=&to=&channelId=&status=&severity=` | Sesión | Incidencias detectadas en el periodo (máx. 5000 filas) |

Cada reporte se arma una sola vez como estructura `Report` (título, metadatos, resumen, columnas, filas y notas) en [`apps/api/src/exports/reports.ts`](../apps/api/src/exports/reports.ts) y se convierte a CSV ([`csv.ts`](../apps/api/src/exports/csv.ts)) o PDF ([`pdf.ts`](../apps/api/src/exports/pdf.ts)), de modo que ambos formatos muestran los mismos datos. Los parámetros se validan estrictamente: un parámetro que no corresponde al reporte responde `400`.

## 8. Ejecución de la aplicación

Después de configurar PostgreSQL, migrar y ejecutar seed, abra dos terminales en la raíz:

```bash
npm run dev:api
```

```bash
npm run dev:web
```

- Web: <http://localhost:5173>
- Portal público: <http://localhost:5173/estado>
- API: <http://localhost:3001>
- Salud del proceso: <http://localhost:3001/api/health>

El endpoint de salud no demuestra que la base de datos esté conectada. Revise el log de la API y pruebe una operación que requiera persistencia.

## 9. Verificación y pruebas

Scripts del proyecto:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

Los archivos de test cubren validación, autenticación, clasificación, verificador, scheduler, transiciones y flujo de incidencias. La suite PostgreSQL de `apps/api/src/integration/database.integration.test.ts` se habilita solo con `TEST_DATABASE_URL` local y una base terminada en `_test` con migraciones aplicadas. Sin ella, las pruebas de persistencia se omiten; no se debe usar una base productiva.

### Resultado actualizado (10 de noviembre de 2026)

Con PostgreSQL local y `TEST_DATABASE_URL` configurada se ejecutan **86 pruebas sin omisiones**. Incluyen la descarga de reportes CSV/PDF con valores exactos, el escapado contra inyección de fórmulas y la paginación del PDF, el cálculo M5 sobre un periodo controlado (disponibilidad global y en fechas de pago, tiempos medios, entregas, excepción) y la importación CSV con rechazo atómico, el portal M4 (estado público sin datos internos, reporte ciudadano, seguimiento, revisión y vinculación con validación de canal) y el recorrido M1→M2→M3: caída simulada, apertura de incidencia, notificación enviada, rechazo simulado con reintentos hasta `FAILED`, reintento manual, recuperación y notificación de restablecimiento.

### Resultado de QA anterior

[`QA-REPORT.md`](../QA-REPORT.md), fechado 14 de octubre de 2026, reporta **38 pruebas aprobadas y 8 omitidas**, sin fallos en su ejecución final. También informa lint, `typecheck`, build, validación del esquema Prisma y auditoría de dependencias aprobados. Estos son resultados **reportados por ese documento**, no una repetición realizada durante la elaboración de este manual.

Las ocho pruebas que requieren PostgreSQL (`TEST_DATABASE_URL`) quedaron omitidas porque no había una URL de prueba y no se contaba con rol local utilizable. Por tanto, el recorrido persistente/concurrente M1→M2 y la sesión UI autenticada no se deben presentar como verificados. El informe QA registra además que API y Vite respondieron a comprobaciones HTTP; `/api/health` no confirma conexión a la base.

Ejemplo conceptual de preparación de la base de pruebas (reemplace con credenciales locales):

```bash
createdb simona_bn_test
DATABASE_URL='postgresql://usuario:contraseña@localhost:5432/simona_bn_test?schema=public' \
  npm run db:migrate --workspace @simona-bn/api -- --name init
TEST_DATABASE_URL='postgresql://usuario:contraseña@localhost:5432/simona_bn_test?schema=public' npm test
```

Para una nueva entrega, repita los comandos en el entorno destino y adjunte salidas fechadas. El reporte QA es evidencia de la ejecución del 14/10/2026, no garantía de que el entorno actual tenga el mismo estado.

## 10. Seguridad y límites operativos

- Nunca versionar `apps/api/.env`, contraseñas, tokens ni archivos de cookie de demostración.
- Las contraseñas usan `scrypt`; el sistema persiste el hash, no el texto claro. Los tokens de sesión son aleatorios y se persisten como SHA-256.
- La cookie es `HttpOnly`, `SameSite=Strict`, con vencimiento; en `production` se configura `Secure`. HTTPS debe estar resuelto por el despliegue productivo si existiera.
- El alta pública asigna `VIEWER`; no hay UI/API de gestión de roles. El seed de `ADMIN` está limitado a entorno no productivo.
- Las rutas de escritura verifican roles. Los cuerpos JSON están limitados a 16 KiB.
- Mantener el modo `simulated`. No configurar dominios del BN ni endpoints no autorizados en allowlist.
- La API/scheduler está diseñada para una instancia en la demostración. Varias instancias no comparten lock de scheduler.
- No hay evidencia de despliegue, backup automatizado, política de retención, auditoría de seguridad externa, pruebas de carga o SLA.

## 11. Referencias técnicas

- [`README.md`](../README.md), alcance, reglas y ejecución documentados en el repositorio.
- [`package.json`](../package.json), scripts y workspaces.
- [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma), modelo de datos.
- [`apps/api/src/app.ts`](../apps/api/src/app.ts), montaje de rutas y manejo HTTP.
- [`apps/api/src/monitoring/service.ts`](../apps/api/src/monitoring/service.ts), persistencia y evaluación M1.
- [`apps/api/src/incidents/lifecycle.ts`](../apps/api/src/incidents/lifecycle.ts), ciclo M2.
- [`apps/api/src/notifications/`](../apps/api/src/notifications/), cola, despachador y transportes M3.
- [`apps/api/src/indicators/`](../apps/api/src/indicators/) y [`apps/api/src/payment-schedule/`](../apps/api/src/payment-schedule/), indicadores e importación del cronograma M5.
- [`apps/api/src/exports/`](../apps/api/src/exports/), reportes CSV y PDF.
- [`apps/api/src/public/routes.ts`](../apps/api/src/public/routes.ts) y [`apps/api/src/reports/routes.ts`](../apps/api/src/reports/routes.ts), portal público y revisión de reportes M4.
- [`QA-REPORT.md`](../QA-REPORT.md), resultados reportados y límites de la ejecución QA del 14/10/2026.
