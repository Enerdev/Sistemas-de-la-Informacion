# Registro de caídas de los canales digitales del Banco de la Nación

Registro histórico armado a partir de comunicados oficiales del BN (bn.com.pe) y de notas de prensa peruana. Los datos están en [`registro-caidas-bn.csv`](registro-caidas-bn.csv). Corte: 19 de noviembre de 2026.

## Carga en SIMONA-BN

El CSV se carga en la tabla `public_outage_records` y se muestra en **Indicadores → Registro público de caídas del Banco de la Nación**. Va aparte de las incidencias porque SIMONA-BN no midió estos eventos: sin horas de inicio y fin, mezclarlos inventaría disponibilidad y tiempos medios.

Para agregar o corregir un evento, edita el CSV y ejecuta:

```bash
npm run db:seed:outages
```

El comando sincroniza la tabla con el archivo (crea, actualiza y elimina por `codigo`) y deja constancia en la bitácora. Si una línea tiene errores, no carga ninguna. En Render se ejecuta en cada arranque.

Valores permitidos: `tipo` = FALLA o MANTENIMIENTO · `coincide_con_pagos` = SI, NO o NO_DETERMINADO · `comunicado_oficial` = SI, NO o POR_CONFIRMAR · `confirmacion` = OFICIAL, PRENSA_CON_COMUNICADO, PRENSA o NO_VERIFICADO.

## Cómo leer el registro

- **Tipo:** *Falla no programada* (el canal se cayó sin aviso) o *Mantenimiento programado* (el BN avisó antes).
- **Confirmación:** qué tan seguro es el dato.
  - *Oficial*: leído directamente en bn.com.pe.
  - *Prensa con comunicado*: el medio cita un comunicado del BN y el texto de la nota fue revisado.
  - *Prensa, texto no verificado*: solo se vio el titular o la URL; la fecha sale de la URL y debe confirmarse antes de citarla.

## Resumen

| Código | Fecha | Tipo | Canales | Coincide con pagos | Confirmación |
|---|---|---|---|---|---|
| RC-0001 | 21/02/2025 | Falla | App BN, Banca por Internet | No determinado | Prensa, no verificado |
| RC-0002 | 01–05/09/2025 | Mantenimiento | Banca Empresarial | No | Oficial |
| RC-0003 | 20/10/2025 | Falla | App BN | **Sí** | Prensa con comunicado |
| RC-0004 | 08/11/2025, 00:00–06:00 | Mantenimiento | App BN, interoperabilidad Multired Virtual | No | Oficial |
| RC-0005 | 22 y 23/11/2025, 04:00–05:00 | Mantenimiento | Cajeros, Multired Virtual, App BN, Págalo.pe | No | Oficial |
| RC-0006 | 06/12/2025, 00:00–06:00 | Mantenimiento | App BN, interoperabilidad | No | Prensa |
| RC-0007 | 25/02/2026 | Falla | App BN | No determinado | Prensa, no verificado |
| RC-0008 | 25/05/2026 (~6 h) | Mantenimiento | App BN y plataformas | No determinado | Prensa, no verificado |
| RC-0009 | 18–19/11/2026 | Falla | App BN, Banca por Internet | **Sí** | Prensa con comunicado |

## Lo que muestra el registro

1. **Las dos fallas mejor documentadas cayeron en días de pago de sueldos** (20/10/2025 y 18/11/2026). Es el argumento central de SIMONA-BN: el riesgo se concentra en el cronograma de pagos, que el módulo M5 ya importa.
2. **Ninguna falla tiene hora de inicio ni de fin publicada.** El BN informa que hay un problema y luego que se resolvió, sin duración. Por eso no se puede calcular la disponibilidad real: es justamente el dato que SIMONA-BN generaría con sus verificaciones.
3. **La comunicación es confusa.** El 19/11/2026 el BN dijo que el problema estaba resuelto y poco después advirtió que podía continuar. Un portal de estado (M4) evita esa contradicción porque muestra el estado medido, no un anuncio.
4. **Los mantenimientos sí se avisan, con fecha y horario.** Se pueden cargar como ventanas de mantenimiento para que no cuenten como caídas.

## Pendientes antes de citarlo en el informe

- Confirmar RC-0001, RC-0007 y RC-0008 abriendo las notas o buscando el comunicado en bn.com.pe.
- Los planes del grupo dicen "17 al 20 de octubre de 2025"; la fuente revisada solo confirma el 20. Las fallas del 15 y 17 aparecen mencionadas en prensa, pero sin comunicado.
- Hay una nota sobre una caída de Págalo.pe un 25 de agosto sin año claro; no se incluyó.
- Las búsquedas devuelven muchas noticias del **Banco Nación de Argentina** (BNA+, Red Link) y del **Banco Nacional de Costa Rica**. No son el BN del Perú y se descartaron.

## Fuentes

- Comunicado Banca Empresarial, 01/09/2025: https://www.bn.com.pe/noticias/2025/01092025-banca-empresarial.asp
- Comunicado mantenimiento App, 07/11/2025: https://www.bn.com.pe/noticias/2025/07112025-comunicado-mantenimiento-app-banca-movil.asp
- Comunicado mantenimiento de canales, 21/11/2025: https://www.bn.com.pe/noticias/2025/21112025-comunicado-mantenimiento.asp
- La República, 18/11/2026: https://larepublica.pe/sociedad/2026/11/18/banco-de-la-nacion-fallas-en-aplicativo-movil-y-banca-por-internet-afectan-operaciones-virtuales-667674
- Caretas, 19/11/2026: https://caretas.pe/sociedad/banco-de-la-nacion-anuncia-falla-tecnica-en-sus-plataformas-digitales-que-se-sabe/
- Libero, 20/10/2025: https://libero.pe/tiempoextra/2025/10/20/app-del-banco-de-nacion-se-cayo-hoy-usuarios-presentan-problemas-cobrar-sueldo-entidad-se-pronuncia-1671820
- Libero, 05/12/2025: https://libero.pe/tiempoextra/2025/12/05/banco-de-nacion-anuncia-su-app-funcionara-6-de-diciembre-conoce-horario-motivo-251415
- Libero, 25/02/2026: https://libero.pe/tiempoextra/2026/02/25/app-del-banco-de-nacion-se-cayo-usuarios-presentan-quejas-constantes-fallas-de-plataforma-982200
- Libero, 25/05/2026: https://libero.pe/tiempoextra/2026/05/25/app-del-banco-de-nacion-funcionara-6-horas-usuarios-podran-utilizar-plataforma-2105925
- Infobae, 21/02/2025: https://www.infobae.com/peru/2025/02/21/banco-de-la-nacion-se-cae-app-bn-y-banca-por-internet-presentan-intermitencias-reporta-entidad-financiera/
