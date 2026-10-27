# Informe de QA — Integración M1 y M2

**Fecha:** 14 de octubre de 2026  
**Alcance:** monitoreo de canales simulados, persistencia M1, apertura y ciclo de vida de incidencias M2. No se consultaron servicios del Banco de la Nación ni se realizaron transacciones reales.

## Resultado ejecutivo

| Estado | Resultado |
|---|---|
| **Aprobado** | 38 pruebas ejecutadas correctamente; lint, chequeo de tipos, compilación, validación del esquema Prisma y auditoría de dependencias. Los servidores de desarrollo respondieron a las comprobaciones HTTP. |
| **Fallido** | Ninguna prueba falló en la ejecución final. Durante la edición se detectó y corrigió un error de sintaxis en la nueva prueba de integración; una repetición posterior pasó. |
| **No verificado** | Ocho pruebas PostgreSQL, incluidas persistencia/concurrencia y el recorrido completo M1→M2. No hay `TEST_DATABASE_URL` ni rol local PostgreSQL utilizable en el entorno. El flujo visual autenticado tampoco pudo completarse sin la base de datos. |

## Requisitos probados

### Aprobado en las pruebas ejecutadas

- Clasificación M1, límites de latencia, umbrales de fallos consecutivos y recuperación.
- Adaptadores simulados, destinos lentos/caídos, restricciones del verificador HTTP y ejecución del scheduler.
- Apertura M2 al alcanzar el umbral, prevención de duplicados a nivel de lógica, evidencia y evento de auditoría mediante pruebas unitarias.
- Transiciones permitidas y rechazo de transiciones inválidas; autorización por rol; validación de filtros, periodos y comentarios.
- Respuesta centralizada ante inicialización fallida de Prisma.
- Configuración y dependencias: esquema Prisma válido y `npm audit` sin vulnerabilidades.
- Arranque de API y frontend; respuesta `200` de `/api/health` y del servidor Vite.

### No verificado por requerir PostgreSQL

Se añadió al conjunto DB-gated un recorrido persistente que comienza con un canal `AVAILABLE`, registra fallo tras fallo, abre una incidencia al tercer fallo, consulta evidencia, gestiona la incidencia como `OPERATOR`, verifica la recuperación al segundo éxito, mantiene independientes el estado técnico y el administrativo, resuelve/cierra con auditoría y crea un episodio nuevo tras la recuperación. También comprueba relaciones entre canal, verificaciones, incidencia y eventos.

Ese recorrido y las pruebas de persistencia/concurrencia **no se ejecutaron**. Vitest las omitió porque `TEST_DATABASE_URL` no está configurada. `pg_isready` indicó que hay un servidor escuchando, pero `psql -d postgres` falló porque no existe el rol local `emerson`; el acceso no interactivo como `postgres` requiere autenticación interactiva. No se configuró una URL ficticia para ejecutar pruebas que aparentaran persistir, no se aplicaron migraciones y no se modificó ni limpió ninguna base.

La interfaz construye por separado el estado del canal y el estado de la incidencia, pero no fue posible completar una sesión autenticada en el navegador sin una base inicializada. Solo se verificó que el servidor frontend respondiera `200`.

## Comandos ejecutados y resultados

| Comando/acción | Resultado |
|---|---|
| `npm test` | **38 aprobadas; 8 omitidas** por falta de `TEST_DATABASE_URL`. |
| `npm run lint` | **Aprobado**, sin errores. |
| `npm run typecheck` | **Aprobado** para API, pruebas y frontend. |
| `npm run build` | **Aprobado** para API y frontend. |
| `npm audit --audit-level=low` | **Aprobado**, 0 vulnerabilidades. |
| `DATABASE_URL='postgresql://qa:qa@127.0.0.1:5432/simona_bn_dev?schema=public' npm exec --workspace @simona-bn/api -- prisma validate --schema prisma/schema.prisma` | **Aprobado**; valida el esquema sin conectarse a PostgreSQL. |
| `DATABASE_URL='postgresql://qa:qa@127.0.0.1:5432/simona_bn_dev?schema=public' npm run dev:api` y `curl http://127.0.0.1:3001/api/health` | **Aprobado** para arranque HTTP: servicio `ok`, timestamp ISO. No prueba conexión a la base. |
| `npm run dev:web` y `curl -I http://localhost:5173/` | **Aprobado**: el comando documentado inició Vite y respondió `200 OK`. |
| `git diff --check` | **Aprobado**, sin errores de whitespace. |
| `psql -d postgres -Atc 'SELECT current_user'` | **Bloqueado**: el rol local `emerson` no existe. |

Los datos `qa:qa` de la URL de comprobación son marcadores temporales locales, no credenciales de base existentes. Se usaron únicamente para que la API validara configuración y atendiera `/api/health`; no se afirma que la conexión a PostgreSQL funcione.

## Cambios QA realizados

- Se amplió la prueba de integración DB-gated para cubrir el flujo M1→M2 completo, incluyendo rol `OPERATOR`, umbral de recuperación, historial, evidencia, auditoría y episodios posteriores.
- Se añadieron pruebas unitarias de apertura/no apertura, deduplicación y recuperación técnica.
- Se agregó ESLint, el script `npm run lint` y su configuración; se eliminó una importación sin uso detectada por el lint.
- Se actualizó el README con el comando de lint, la secuencia real de migraciones y la condición para considerar ejecutado el flujo persistente.

No se encontró ni corrigió un defecto funcional demostrado por las pruebas que sí pudieron ejecutarse. La prueba DB-gated ampliada es cobertura agregada, no evidencia de que el recorrido persistente haya pasado.

## Evidencia reproducible de la demostración

Con PostgreSQL local autorizado:

1. Para las pruebas, crea una base **dedicada** llamada `simona_bn_test`. Configura `DATABASE_URL` para esa base, aplica allí las migraciones con `npm run db:migrate:deploy` y configura `TEST_DATABASE_URL` a esa misma base local terminada en `_test`. No apuntes ninguna de estas variables a la base de desarrollo compartida.
2. Ejecuta `npm test` con `TEST_DATABASE_URL` configurada. La aceptación requiere que no aparezcan pruebas DB omitidas.
3. Para la demostración manual, crea una base de desarrollo separada y sigue la configuración de `README.md`. Aplica las migraciones y genera datos con `npm run db:migrate:deploy`, `npm run db:generate` y `npm run db:seed`. Para disponer de un administrador de desarrollo, define `SEED_ADMIN_EMAIL` y `SEED_ADMIN_PASSWORD` localmente antes del seed; no reutilices credenciales reales ni las guardes en Git.
4. Inicia API y web con `npm run dev:api` y `npm run dev:web`. Inicia sesión, elige un canal simulado `sim://app-bn`, habilita el monitoreo y ejecuta una comprobación: debe quedar `OPERATIVO`.
5. Para la demostración de caída, cambia el destino del canal mediante `PATCH /api/channels/:id` a `sim://down` (la pantalla actual no ofrece edición del destino), y ejecuta `POST /api/channels/:id/check` tres veces con rol `ADMIN` u `OPERATOR`. Las dos primeras deben quedar `DEGRADADO`; la tercera, `CAÍDO`, abre una incidencia.
6. Consulta `GET /api/incidents` y `GET /api/incidents/:id` para comprobar la evidencia y el evento de apertura. Cambia el estado a `IN_PROGRESS`; luego establece `sim://app-bn` y ejecuta dos comprobaciones. La primera conserva el estado `CAÍDO`; la segunda recupera el canal a `OPERATIVO` y registra `CHANNEL_RECOVERED`, sin resolver la incidencia.
7. Cambia la incidencia a `RESOLVED` y después a `CLOSED` (solo `ADMIN` puede cerrar). Consulta el detalle para verificar timestamps y auditoría. La comprobación debe mostrar el canal `OPERATIVO` independientemente de que la incidencia siga en investigación o ya esté cerrada.

## Limitaciones y siguiente verificación

- Hace falta una cuenta/rol local PostgreSQL autorizado para crear o utilizar `simona_bn_test`, aplicar allí las migraciones y correr las ocho pruebas omitidas. No apuntes `TEST_DATABASE_URL` a una base de desarrollo compartida ni productiva.
- La UI no permite editar el destino simulado de un canal; para cambiar entre `sim://down` y `sim://app-bn` durante la demostración se requiere la API autenticada.
- No hay pruebas automatizadas de componentes React en el proyecto; el panel no tuvo validación visual/interactiva autenticada en esta ejecución.
- La apertura y recuperación del scheduler están coordinadas dentro de una instancia; varias instancias requieren coordinación distribuida adicional, como documenta el README.
