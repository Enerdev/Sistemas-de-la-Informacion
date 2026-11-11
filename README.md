# SIMONA-BN

Monorepo inicial de SIMONA-BN, un proyecto universitario de monitoreo de disponibilidad con canales y servicios **simulados**. No se conecta a sistemas internos del Banco de la Nación, no hace pagos y no procesa transacciones reales.

La etapa actual incluye autenticación con sesiones persistidas, roles, catálogo, M1 (verificaciones periódicas/manuales persistidas), M2 (apertura automática y gestión auditable de incidencias) M3 (alertas por correo de caída y restablecimiento con registro de envíos y reintentos) M4 (portal público de estado con reporte ciudadano de fallas) y M5 (panel de indicadores con importación CSV del cronograma de pagos). Los reportes descargables PDF/CSV, la gestión de usuarios y el respaldo aún no están implementados.

## Requisitos

- Node.js 20.19+ (recomendado: Node.js 22 LTS) y npm.
- PostgreSQL 16+ para persistencia y demostración de la API.
- Git.

Comprueba herramientas y servidor:

```bash
node --version
npm --version
git --version
psql --version
pg_isready
```

`pg_isready` solo comprueba si PostgreSQL acepta conexiones; no confirma que exista la base, las credenciales o las tablas de SIMONA-BN.

## Instalación y configuración

Desde la raíz del proyecto:

```bash
npm install
cp .env.example apps/api/.env
```

Edita `apps/api/.env` para que `DATABASE_URL` use una base local creada para SIMONA-BN. La API y Prisma cargan la configuración desde esa ubicación cuando se ejecutan como workspace. La API valida que la URL sea PostgreSQL, pero no afirma conexión a la base al iniciar. Las variables `SEED_ADMIN_EMAIL` y `SEED_ADMIN_PASSWORD` son opcionales: define valores privados localmente para que el seed cree una cuenta ADMIN de desarrollo. El seed no permite aprovisionar un administrador mediante esas variables en producción. Nunca guardes `.env` en Git.

Si tu usuario de PostgreSQL puede crear bases:

```bash
createdb simona_bn
```

Si no, solicita al administrador de tu PostgreSQL una base de desarrollo y configura su URL con el formato `postgresql://usuario:contraseña@host:puerto/base?schema=public`.

## Migraciones y datos iniciales

Aplica la migración inicial a la base configurada:

```bash
npm run db:migrate -- --name init
```

Para aplicar migraciones ya revisadas en un entorno de despliegue:

```bash
npm run db:migrate:deploy
```

Genera el cliente Prisma y carga de forma idempotente los tres canales simulados:

```bash
npm run db:generate
npm run db:seed
```

El seed no imprime credenciales. Opcionalmente, si se definieron ambos valores privados de `SEED_ADMIN_EMAIL` y `SEED_ADMIN_PASSWORD` en `apps/api/.env` fuera de producción, crea un usuario administrador. Si no se configuran, solo inserta/asegura los canales. Nuevas cuentas registradas desde la interfaz tienen rol `VIEWER`; una persona `ADMIN` u `OPERATOR` es necesaria para escribir en el catálogo.

Las migraciones crean tablas de usuarios, sesiones, canales, configuración, verificaciones, incidencias, eventos de incidencia e historial de estado. La migración inicial incluye una restricción para impedir más de una incidencia activa por canal; la migración M1 añade procedencia (`SIMULATED`/`HTTP`) y código HTTP, y la migración M2 agrega evidencia, detección y recuperación técnica de incidencias.

## Ejecutar la aplicación

Abre terminales separadas desde la raíz:

```bash
npm run dev:api
```

```bash
npm run dev:web
```

- Web (personal): <http://localhost:5173>
- Portal público: <http://localhost:5173/estado>
- API: <http://localhost:3001>
- Salud del proceso: <http://localhost:3001/api/health>

La web usa el proxy de Vite para enviar `/api` a la API. `/api/health` informa la salud del proceso HTTP, no la conexión a PostgreSQL.

## Funcionalidad disponible

- Registro con correo y contraseña de al menos 12 caracteres; las contraseñas se almacenan como hash `scrypt` con sal aleatoria.
- Inicio/cierre de sesión mediante cookie `HttpOnly`, `SameSite=Strict`, con vencimiento y token opaco almacenado como hash en PostgreSQL.
- Roles `ADMIN`, `OPERATOR` y `VIEWER`; solo los dos primeros pueden registrar, editar o habilitar/deshabilitar monitoreo.
- API protegida para listar y consultar canales, registrar canales simulados, actualizarlos y habilitar/deshabilitar su monitoreo.
- Validación de solicitudes y respuestas de error consistentes.
- Verificaciones M1 con una interfaz de adaptador intercambiable: simulador determinista por defecto y cliente HTTP opcional.
- Scheduler `node-cron`, con un barrido cada 15 segundos y ejecución según intervalo de cada canal (inicial: 60 segundos). El scheduler evita inicios duplicados y barridos solapados dentro de un proceso. Varias instancias requieren lock/coordinación distribuida adicional.
- Verificación manual e historial paginado: `POST /api/channels/:id/check` y `GET /api/channels/:id/checks?limit=20`. Requieren rol `ADMIN` u `OPERATOR`.
- Configuración por canal: `PATCH /api/channels/:id/monitoring/config` admite intervalos, timeout, umbral de latencia y umbrales de caída/recuperación.
- Panel con estado actual, última comprobación, latencia, procedencia, historial y controles para mantenimiento.

### Simulación sin internet (modo predeterminado)

`MONITORING_DRIVER=simulated` no realiza solicitudes de red. Los destinos se interpretan de manera determinista:

- `sim://app-bn` (y otros destinos ordinarios): éxito simulado de 25 ms.
- `sim://down`: fallo simulado.
- `sim://timeout`: timeout simulado.
- `sim://slow-1500` o `sim://degraded-2000`: éxito con la latencia indicada.

### Clasificación y umbrales iniciales

Los estados persistidos usan estos nombres internos y etiquetas de interfaz:

| Estado de base de datos | Etiqueta |
|---|---|
| `AVAILABLE` | OPERATIVO |
| `DEGRADED` | DEGRADADO |
| `UNAVAILABLE` | CAÍDO |
| `MAINTENANCE` | MANTENIMIENTO |
| `UNKNOWN` | Sin verificar |

La configuración predeterminada por canal es: comprobación cada **60 s**, timeout **5.000 ms**, latencia degradada al llegar o superar **1.500 ms**, **3 fallos consecutivos** para marcar CAÍDO y **2 éxitos consecutivos** para recuperarse. Antes de alcanzar el umbral de fallos se muestra DEGRADADO. El estado MANTENIMIENTO se excluye del scheduler y se conserva mientras se verifica manualmente (la API rechaza esa comprobación); un operador puede entrar y salir de mantenimiento desde el panel.

El resultado de la observación (`SUCCESS`, `FAILURE`, `TIMEOUT`) se almacena separado del estado calculado. Cada fila guarda timestamp, latencia, código HTTP cuando exista, mensaje técnico breve y procedencia. Un fallo simulado se identifica como `SIMULATED` y su detalle dice “Fallo simulado”; un error de transporte es `HTTP` y se describe como error de red/timeout HTTP.

Para una demostración sin base real, una cuenta `ADMIN` de desarrollo y los canales seed, habilita monitoreo para un canal y usa destinos como `sim://app-bn`, `sim://slow-1500`, `sim://down` y `sim://timeout`. Una verificación manual puede ejecutarse también con el monitoreo programado deshabilitado. El seed deja el monitoreo deshabilitado inicialmente.

### Verificación HTTP opcional y restringida

Para autorizar explícitamente un endpoint de demostración, configura en `apps/api/.env`:

```dotenv
MONITORING_DRIVER=http
MONITORING_HTTP_ALLOWED_HOSTS=health.example.edu
```

El canal debe tener como destino una URL HTTPS cuyo host (o autoridad `host:puerto`) coincida exactamente con la lista permitida, por ejemplo `https://health.example.edu/health`. No se aceptan credenciales en URL ni redirecciones. Sin la allowlist, la aplicación no permite activar el modo HTTP. No agregues dominios del banco ni endpoints que no tengas autorización expresa para comprobar. La demostración principal no necesita esta configuración. Cambiar `MONITORING_DRIVER` requiere reiniciar la API.

## Gestión M2 de incidencias

La migración `20261014172000_m2_incident_evidence_recovery` amplía las incidencias existentes de forma aditiva: motivo, evidencia JSON, instante de detección, verificación que la detectó y recuperación técnica. Los eventos de auditoría pueden enlazarse a una verificación. No se borran incidentes ni historial anterior.

Al persistir cada verificación, M1 bloquea la fila del canal dentro de la transacción PostgreSQL, vuelve a leer estado y verificaciones recientes, y evalúa el umbral configurado. Al alcanzar fallos consecutivos, se abre una incidencia `OPEN` de severidad `HIGH`, con motivo, evidencia y evento `OPENED` del sistema. El índice único parcial de la migración inicial limita incidencias activas por canal como última barrera ante duplicados; la transacción serializa evaluaciones concurrentes.

Cuando el estado técnico del canal sale de `UNAVAILABLE`, M1 graba `recoveredAt` y un evento `CHANNEL_RECOVERED`; no cambia el estado administrativo de la incidencia. Así, el canal puede estar `AVAILABLE` mientras la incidencia permanece abierta/en investigación. Si llega otra caída luego de una recuperación registrada, se crea una **nueva incidencia/episodio**; los fallos repetidos del mismo episodio no duplican la activa. Si se cierra/resuelve antes de observar recuperación técnica, una caída continua no abre episodios nuevos.

Transiciones permitidas:

| Estado previo | Estado siguiente | Permiso |
|---|---|---|
| `OPEN` | `IN_PROGRESS` | `ADMIN` u `OPERATOR` |
| `ACKNOWLEDGED` (compatibilidad con datos previos) | `IN_PROGRESS` | `ADMIN` u `OPERATOR` |
| `IN_PROGRESS` | `RESOLVED` | `ADMIN` u `OPERATOR` |
| `RESOLVED` | `CLOSED` | Solo `ADMIN` |

Las otras transiciones responden `409`; un `VIEWER` no puede gestionar incidencias (`403`). Cada cambio escribe actor, estados, fecha y comentario opcional en `IncidentEvent`. Los endpoints autenticados son:

- `GET /api/incidents?channelId=<uuid>&status=OPEN&severity=HIGH&from=<ISO>&to=<ISO>&limit=25`
- `GET /api/incidents/:id` (incluye evidencia, verificación de detección y auditoría)
- `PATCH /api/incidents/:id/status` con `{ "status": "IN_PROGRESS", "comment": "..." }`

El panel React permite filtrar, revisar detalle y evidencia, separar recuperación técnica de resolución administrativa y aplicar transiciones permitidas por rol.

## Alertas y notificaciones M3

Cuando M1 abre una incidencia por caída, o registra la recuperación técnica de un canal que tenía una incidencia, se crea una notificación por cada destinatario activo suscrito a ese evento. Las notificaciones se guardan en la misma transacción que la verificación (patrón *outbox*), de modo que no se pierde ninguna alerta si el envío falla.

Flujo: **canal cae → incidencia → notificación `PENDIENTE` → envío con Nodemailer → `ENVIADA` o reintento**. Si el envío falla, se reintenta a los 30 s y a los 60 s; tras el tercer intento queda `FALLIDA` con el último error, y un ADMIN u OPERATOR puede reintentarla desde el panel. Cada fila guarda destinatario, asunto, cuerpo, instante del evento, intentos, error, identificador del mensaje, enlace de vista previa y hora de envío; con esto se mide el **tiempo de comunicación** (envío − detección).

Transportes (`NOTIFICATIONS_DRIVER` en `apps/api/.env`, requiere reiniciar la API):

| Valor | Uso |
|---|---|
| `json` (predeterminado) | Sin red: Nodemailer genera el correo completo, pero no sale del servidor. Usado por las pruebas. |
| `ethereal` | Buzón SMTP de prueba de [Ethereal](https://ethereal.email). Los correos no llegan a personas reales; el panel muestra el enlace **Ver correo**. Recomendado para la demostración. |
| `smtp` | Servidor SMTP real (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`). Usa solo cuentas autorizadas. |

Para demostrar errores y reintentos con `json` o `ethereal`, registra un destinatario con dominio `@fallo.simona.test`: su envío se rechaza de forma simulada. El seed crea el destinatario ficticio `jefatura-ti@simona.test`.

Endpoints (ADMIN u OPERATOR; la gestión de destinatarios es solo ADMIN):

- `GET /api/notifications?status=&kind=&channelId=&incidentId=&limit=&cursor=`
- `POST /api/notifications/:id/retry` (solo notificaciones `FAILED`)
- `GET /api/notifications/recipients`, `POST /api/notifications/recipients`, `PATCH /api/notifications/recipients/:id`

El detalle de una incidencia incluye sus notificaciones para ADMIN y OPERATOR; un `VIEWER` no ve destinatarios.

## Portal público M4

En `/estado` cualquier persona, sin iniciar sesión, puede:

- consultar el estado actual de cada canal y un resumen general (se actualiza cada 30 s);
- ver las incidencias activas y las de los últimos 7 días;
- **reportar una falla** con canal, descripción (10–1000 caracteres), fecha opcional y correo de contacto opcional;
- consultar el avance de su reporte con el código de seguimiento `R-XXXXXXXX`.

El portal no expone destinos simulados, configuración, evidencia técnica ni correos de contacto. El formulario se valida en el navegador y en la API: correo con formato válido, fecha que no esté en el futuro ni tenga más de 30 días, campos desconocidos rechazados y un campo trampa oculto contra bots. La API limita los envíos a 5 reportes cada 15 minutos por IP (responde `429`).

El personal (ADMIN u OPERATOR) revisa los reportes en la pestaña **Reportes**: puede marcarlos como revisados, descartarlos o **vincularlos a una incidencia del mismo canal**. La base de datos impide un reporte vinculado sin incidencia y una incidencia con reportes vinculados no puede borrarse.

Endpoints públicos (sin sesión): `GET /api/public/status`, `GET /api/public/incidents`, `POST /api/public/reports`, `GET /api/public/reports/:codigo`. Internos (ADMIN/OPERATOR): `GET /api/reports?status=&channelId=&limit=&cursor=`, `PATCH /api/reports/:id` con `{ "status": "REVIEWED" | "LINKED" | "DISMISSED", "incidentId"?, "note"? }`.

En un despliegue detrás de Nginx, la ruta `/estado` debe servir `index.html` (`try_files $uri /index.html;`) y Express debe confiar en el proxy (`trust proxy`) para que el límite por IP use la IP real.

## Panel de indicadores M5

La pestaña **Indicadores** (cualquier usuario con sesión) calcula, para un periodo y una meta de disponibilidad:

| Indicador | Fórmula |
|---|---|
| Disponibilidad por canal y global | tiempo operativo ÷ (operativo + caído) × 100 |
| Disponibilidad en fechas de pago | la misma fórmula, solo dentro de los días del cronograma (hora de Lima) |
| Tiempo medio de detección | Σ(detección − inicio real) ÷ incidencias |
| Tiempo medio de restablecimiento | Σ(recuperación técnica − inicio real) ÷ incidencias recuperadas |
| Tiempo medio de resolución | Σ(resolución administrativa − detección) ÷ incidencias resueltas |
| Tiempo de comunicación | primera alerta de caída enviada − detección |
| Incidencias en fechas de pago | incidencias cuyo inicio cae en un día de pago |
| Notificaciones entregadas | enviadas ÷ (enviadas + fallidas) × 100 |

El tiempo se reconstruye con el historial de estados de cada canal. DEGRADADO cuenta como operativo; MANTENIMIENTO y "Sin verificar" se excluyen del total. El **inicio real** de una incidencia es el primer fallo de la racha que llevó a detectarla; las incidencias creadas antes de M5 no lo tienen y usan la detección. El panel incluye el **reporte por excepción**: canales con disponibilidad inferior a la meta en fechas de pago.

### Cronograma de pagos (CSV)

ADMIN u OPERATOR importan un CSV con cabecera `fecha,grupo,descripcion` (fecha `AAAA-MM-DD` o `DD/MM/AAAA`, separador `,` o `;`, `descripcion` opcional). Hay un ejemplo **ficticio** en [`apps/web/public/ejemplos/cronograma-pagos-ejemplo.csv`](apps/web/public/ejemplos/cronograma-pagos-ejemplo.csv), que la app ofrece para descargar. Se validan cabecera, fechas reales, longitud de campos, columnas sobrantes y duplicados; **si una fila tiene errores, no se importa ninguna** y se informa la línea. Volver a importar una fecha del mismo grupo actualiza su descripción. Cada importación queda registrada con archivo, usuario y conteos; solo ADMIN puede eliminar fechas.

Endpoints: `GET /api/indicators?from=<ISO>&to=<ISO>&target=99` (periodo máximo de un año), `GET /api/payment-schedule?from=AAAA-MM-DD&to=AAAA-MM-DD`, `POST /api/payment-schedule/import` con `{ "fileName": "x.csv", "content": "..." }` (hasta 200 KB) y `DELETE /api/payment-schedule/:id`.

La migración M5 también agrega restricciones a las incidencias: el inicio no puede ser posterior a la detección, y una incidencia resuelta o cerrada debe tener fecha de resolución (y de cierre).

## Pruebas, tipos y compilaciones

```bash
npm test
npm run lint
npm run typecheck
npm run build
npm audit
```

Las pruebas que usan PostgreSQL se ejecutan solo si `TEST_DATABASE_URL` apunta a un servidor local y una base cuyo nombre termina en `_test`, con la migración aplicada. No reutilizan `DATABASE_URL` para evitar tocar por accidente una base de desarrollo compartida o productiva. Sin `TEST_DATABASE_URL`, Vitest reporta las pruebas de persistencia como omitidas; las unitarias y de validación siguen ejecutándose. Las pruebas de integración crean registros temporales con prefijos únicos y limpian únicamente esos registros.

Por ejemplo, con credenciales locales autorizadas:

```bash
createdb simona_bn_test
DATABASE_URL='postgresql://<usuario>:<contraseña>@localhost:5432/simona_bn_test?schema=public' \
  npm run db:migrate --workspace @simona-bn/api -- --name init
TEST_DATABASE_URL='postgresql://<usuario>:<contraseña>@localhost:5432/simona_bn_test?schema=public' npm test
```

Sustituye los marcadores por credenciales locales válidas. No uses la base de producción para pruebas. El conjunto incluye pruebas unitarias de límites de clasificación, escenarios simulados, allowlist HTTP, ejecución única del cron, transiciones y manejo del fallo de base. Las pruebas de persistencia M1/M2 (umbral, deduplicación, concurrencia, recuperación, historial, filtros y ciclo de vida) se habilitan con `TEST_DATABASE_URL`. El cron local no coordina varios procesos/instancias: en ese despliegue, una sola instancia debe ejecutar el scheduler o se debe añadir un mecanismo distribuido.

`npm run lint` ejecuta ESLint sobre el backend, frontend y pruebas. La integración PostgreSQL, incluido el flujo completo M1→M2, solo se considera ejecutada cuando el conjunto no reporta las pruebas como omitidas.

## Repositorio GitHub

Git está inicializado en la rama `main`. Si aún no creaste el repositorio remoto, crea uno vacío en GitHub (sin README, licencia ni `.gitignore`) y conéctalo:

```bash
git remote add origin https://github.com/<usuario>/<repositorio>.git
git add .
git commit -m "Implement SIMONA-BN persistence and channel catalog"
git push -u origin main
```

`gh` no es requisito para usar el proyecto y no está instalado en el entorno. Nunca incluyas contraseñas o tokens de GitHub en el remoto ni en el código.

## Estructura

```text
apps/
  api/       Express, TypeScript, Prisma, autenticación y catálogo
  web/       React, Vite y TypeScript
```
