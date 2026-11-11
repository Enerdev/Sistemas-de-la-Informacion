# Despliegue en Render — SIMONA-BN

El repositorio incluye un *Blueprint* ([`render.yaml`](../render.yaml)) que crea en Render un servicio web (API + web compilada, un solo proceso) y una base PostgreSQL, ambos en el plan gratuito y con HTTPS automático. Es un despliegue de **demostración académica** con datos simulados.

## Arquitectura desplegada

```text
Navegador ──HTTPS──▶ Render (proxy TLS) ──▶ Node.js 22: Express
                                              ├─ /api/*      API REST
                                              ├─ /estado     portal público (React)
                                              └─ /           panel del personal (React)
                                            ──▶ PostgreSQL 16 (Render)
```

En producción la API sirve la web compilada (`SERVE_WEB=true`), agrega cabeceras de seguridad (HSTS, CSP, `X-Frame-Options`, `nosniff`), confía en el proxy de Render para obtener la IP real del cliente (`TRUST_PROXY=1`) y marca la cookie de sesión como `Secure`.

## Pasos (los hace una persona del grupo)

1. Asegúrate de que `main` está subido a GitHub (`git push origin main`).
2. Crea una cuenta en <https://render.com> e inicia sesión **con GitHub**. Autoriza a Render a leer el repositorio `Sistemas-de-la-Informacion`.
3. En el panel de Render: **New → Blueprint**. Elige el repositorio y la rama `main`. Render lee `render.yaml` y muestra la base `simona-bn-db` y el servicio `simona-bn`.
4. Render pide tres valores secretos (no se guardan en el repositorio):

   | Variable | Qué poner |
   |---|---|
   | `SEED_ADMIN_EMAIL` | correo del primer administrador, por ejemplo `admin@simona.test` |
   | `SEED_ADMIN_PASSWORD` | contraseña inicial de al menos 12 caracteres (se pedirá cambiarla al entrar) |
   | `SEED_DEMO_PASSWORD` | contraseña de al menos 12 caracteres para `operador.demo@simona.test` y `consulta.demo@simona.test` |

5. Pulsa **Apply**. La primera compilación tarda unos minutos. Al arrancar, [`scripts/render-start.sh`](../scripts/render-start.sh):
   1. aplica las migraciones (`prisma migrate deploy`);
   2. crea los canales base y, **solo si todavía no existe ningún ADMIN**, el primer administrador con cambio de contraseña obligatorio;
   3. carga los datos de demostración **solo si la base no tiene verificaciones** (primer arranque);
   4. inicia la API.
6. Abre la URL que muestra Render (por ejemplo `https://simona-bn.onrender.com`; si el nombre está ocupado, Render agrega un sufijo):
   - Portal público: `https://<tu-servicio>.onrender.com/estado`
   - Panel del personal: `https://<tu-servicio>.onrender.com/`
7. Inicia sesión con `SEED_ADMIN_EMAIL` y cambia la contraseña cuando te la pida.

Cada `git push` a `main` vuelve a compilar y desplegar (`autoDeploy`). Los reinicios no borran datos ni vuelven a cargar la demostración.

## Limitaciones del plan gratuito

| Limitación | Efecto | Qué hacer |
|---|---|---|
| El servicio se suspende tras 15 minutos sin visitas | La primera visita tarda alrededor de un minuto; mientras duerme no hay verificaciones programadas | Abrir la URL unos minutos antes de exponer |
| La base PostgreSQL gratuita vence a los 30 días | Se pierden los datos | Respaldar antes (ver abajo) y crear una nueva o pasar a plan pagado |
| Render bloquea el correo SMTP en servicios gratuitos (desde septiembre de 2025) | Con `NOTIFICATIONS_DRIVER=json` las alertas se generan, se registran y se miden, pero no salen como correo | Para correos reales en la exposición, usar la versión local con `NOTIFICATIONS_DRIVER=ethereal`; en producción haría falta un plan pagado o un proveedor de correo por API HTTPS (no implementado) |
| Una sola instancia | El monitor programado y los límites por IP viven en memoria | Suficiente para la demostración |

## Operación

**Recargar la demostración antes de exponer.** El plan gratuito no tiene consola; se hace desde tu computadora con la **External Database URL** (Render → `simona-bn-db` → Connect):

```bash
DATABASE_URL='<External Database URL>' SEED_ADMIN_EMAIL='<correo del ADMIN en Render>' SEED_DEMO_PASSWORD='<la misma de Render>' npm run db:seed:demo -- --reset
```

**Respaldo de la base de Render** (antes de que venza o de recargar la demo):

```bash
DATABASE_URL='<External Database URL>' npm run db:backup
```

```bash
npm run db:backup:verify
```

**Restaurar** en una base nueva: `npm run db:restore -- backups/<archivo>.dump '<External Database URL nueva>'`.

**Registros:** Render → `simona-bn` → Logs. `/api/health` indica que el proceso responde; no comprueba la base.

## Verificación previa realizada (11/11/2026)

Se simuló localmente el primer arranque con el mismo `npm start`, `NODE_ENV=production` y una base vacía: se aplicaron las 9 migraciones, se creó el primer ADMIN con `mustChangePassword`, se cargó la demostración, la web respondió en `/`, `/estado` y `/assets/*`, `/api/nada` devolvió 404 JSON, se enviaron las cabeceras de seguridad, la cookie fue `Secure` y `HttpOnly`, la bitácora registró la IP enviada por el proxy y un segundo arranque no recargó la demo ni modificó al ADMIN. El despliegue real en Render queda pendiente de que el grupo cree la cuenta y conecte el repositorio.
