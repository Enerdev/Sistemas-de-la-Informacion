# Plan de Proyecto — SIMONA-BN

## Ficha académica

| Campo | Información |
|---|---|
| Institución | Universidad Nacional del Altiplano |
| Facultad | Ingeniería Mecánica Eléctrica, Electrónica y Sistemas |
| Escuela profesional | Ingeniería de Sistemas |
| Curso | Sistemas de Información (SIS309) |
| Semestre | 2026-II |
| Docente | Ing. Marga Isabel Ingaluque Arapa |
| Grupo | N.° 1 |
| Integrantes consignados en el plan fuente | Ramos Barrios, Gisela Rosaura; Zela Ccapa, Elvis; Coaguila Alave, José Enrique; Flores Flores, Emerson Aldair |
| Presentación inicial consignada en el plan fuente | 7 de septiembre de 2026; verificar el registro de entrega |
| Lugar y año | Puno, Perú — 2026 |
| Código de estudiante, firma y fecha de entrega | **Pendientes de completar y confirmar** |
| Corte de avance solicitado | Semana 9; confirmar su correspondencia con el calendario y el sílabo del curso |

Los datos académicos anteriores se transcriben del plan de proyecto existente en el repositorio. Deben confirmarse antes de entregar una versión oficial. Este documento no acredita aprobación institucional ni autorización del Banco de la Nación (BN).

## 1. Identificación y problema

**Nombre de trabajo:** Sistema de Monitoreo y Notificación de Disponibilidad de los Canales Digitales de Pago del Banco de la Nación (SIMONA-BN).

El proyecto estudia cómo apoyar la detección, el registro y la gestión de incidencias de disponibilidad en canales digitales asociados al pago y acreditación de remuneraciones y pensiones del sector público. El plan académico inicial plantea como problema de estudio la falta de información centralizada y oportuna sobre el estado de los canales y sus incidencias.

**Reserva de integridad:** la descripción del problema es una hipótesis de trabajo del plan inicial, no el resultado de entrevistas, encuestas u observación de procesos del BN. El grupo declara no tener acceso a los sistemas internos del Banco. La situación actual debe validarse con fuentes documentales verificables y, si se realizan, con instrumentos de campo registrados.

## 2. Justificación

- **Social, como motivación por validar:** la disponibilidad de servicios de pago puede ser relevante para trabajadores y pensionistas. El beneficio concreto de una herramienta de consulta debe comprobarse con usuarios, sin afirmar que el prototipo modifica la prestación bancaria.
- **Gestión de información:** el prototipo registra de manera persistente verificaciones, estados y eventos de incidencias en un modelo estructurado.
- **Académica y tecnológica:** el repositorio permite aplicar modelado de procesos, requisitos, persistencia, autenticación, monitoreo simulado y gestión auditable de incidencias.
- **Alcance de la evidencia:** el prototipo no mide disponibilidad real del BN ni demuestra reducción de reclamos, tiempos de atención o pérdidas. Esos resultados no se han medido.

## 3. Objetivos

### Objetivo general

Desarrollar y documentar un prototipo académico de sistema de información que permita configurar canales de demostración, registrar verificaciones de disponibilidad, clasificar su estado y gestionar incidencias resultantes, con el fin de explorar cómo la información estructurada puede apoyar el seguimiento operativo de servicios digitales.

El objetivo se formula con el alcance que realmente permite el repositorio. No supone integración, operación ni aprobación del BN.

### Objetivos específicos

1. Describir preliminarmente el proceso y sus actores, distinguiendo hechos respaldados de supuestos por validar.
2. Especificar necesidades y requisitos para un prototipo de monitoreo y gestión de incidencias.
3. Implementar autenticación por sesión, catálogo de canales de demostración, verificación manual/programada, clasificación de estados y trazabilidad del ciclo de incidentes.
4. Documentar modelo de datos, configuración, API, pruebas existentes y limitaciones.
5. Preparar escenarios reproducibles con destinos `sim://`, sin utilizar datos financieros ni endpoints reales no autorizados.
6. **Pendiente:** validar el análisis con usuarios/informantes y ejecutar y registrar las actividades de validación académica previstas por el curso.

## 4. Alcance

### Incluido en el prototipo actual

- Aplicación web interna de demostración y API REST.
- Registro y consulta autenticada de canales de prueba.
- Configuración de intervalos, timeout, umbral de latencia y umbrales de fallos/recuperación.
- Verificaciones manuales y programadas de destinos simulados.
- Clasificación de estados `UNKNOWN`, `AVAILABLE`, `DEGRADED`, `UNAVAILABLE` y `MAINTENANCE`.
- Persistencia de verificaciones, cambios de estado, incidencias y eventos de auditoría.
- Apertura automática de incidencia ante el umbral de fallos y seguimiento de recuperación técnica.
- Transiciones administrativas de incidencia según rol.
- Verificador HTTP opcional, restringido a HTTPS y autoridades explícitamente permitidas; no es necesario para la demostración.
- Migraciones PostgreSQL, seed de canales simulados y suite de pruebas automatizadas en el repositorio.

### Excluido del prototipo y no debe presentarse como implementado

- Integración con sistemas internos, core bancario, SIAF-SP u otra infraestructura del BN.
- Comprobación de disponibilidad de los canales reales del BN sin permiso expreso.
- Operaciones, transacciones, pagos o datos financieros de clientes.
- Despliegue productivo o autorización institucional.
- Aplicación móvil nativa.
- Portal público de estado, formulario público de reportes y suscripciones de usuarios.
- Envío de alertas o notificaciones por correo, SMS o WhatsApp.
- Tablero de KPI, reportes de disponibilidad y cruce con cronogramas de pago.
- Predicción con inteligencia artificial.
- Alta/edición de roles desde una interfaz administrativa; el rol inicial de registro es `VIEWER` y la cuenta `ADMIN` de demostración se provisiona mediante seed de desarrollo.

El alcance preliminar del documento académico fuente incluía algunos de esos módulos futuros. Este plan actualizado los separa de la implementación comprobable en [apps/](../apps).

## 5. Actores involucrados

Los actores institucionales son **propuestos para el análisis** y no implican participación ni entrevista realizada.

| Actor | Interés o necesidad propuesta | Situación en el prototipo |
|---|---|---|
| Trabajadores y pensionistas del sector público | Consultar disponibilidad y recibir información confiable | No existe portal público ni notificación al usuario |
| Atención al Cliente | Consultar un estado consistente para responder consultas | Actor previsto; no tiene rol/interfaz específico implementado |
| Operador de TI | Configurar canales, revisar verificaciones y gestionar incidencias | Representado parcialmente por el rol `OPERATOR` |
| Administrador del sistema | Usar una cuenta con permisos privilegiados y cerrar incidencias | Rol `ADMIN`; gestión de roles no disponible en UI/API |
| Jefatura de TI / Operaciones | Revisar tendencias e información para decisiones | Necesidad propuesta; KPI e informes aún no implementados |
| Unidades Ejecutoras (Tesorería/RR. HH.) | Consultar afectación a fechas de pago | Necesidad propuesta; no existe calendario de pagos |
| Equipo académico | Construir, documentar y demostrar el prototipo | Grupo consignado en la ficha académica; confirmar responsabilidades efectivas |
| Banco de la Nación | Organización objeto de estudio del plan | No se afirma participación, aprobación, patrocinio ni autorización |

## 6. Entregables

| Entregable | Estado de evidencia en el repositorio |
|---|---|
| Plan de proyecto inicial | Existen versiones Word/PDF; este Markdown lo actualiza y precisa |
| Informe de análisis | Documento generado en [`informe-analisis.md`](./informe-analisis.md); no acredita investigación de campo |
| Manual técnico | Documento generado en [`manual-tecnico.md`](./manual-tecnico.md) |
| Guion de demostración | Documento generado en [`guion-demostracion.md`](./guion-demostracion.md) |
| Prototipo de monitoreo e incidencias | Código en `apps/api` y `apps/web`; modo predeterminado simulado |
| Evidencias de entrevistas, encuestas y observación | **Pendientes; no se localizaron en el material revisado** |
| Actas de revisión, retrospectiva, aceptación del cliente o autorizaciones | **Pendientes; no se localizaron y no deben inferirse del código** |
| Informe de pruebas de entrega | Existe [`QA-REPORT.md`](../QA-REPORT.md), fechado 14/10/2026: reporta 38 pruebas aprobadas y 8 omitidas; completar las pruebas PostgreSQL y la verificación visual autenticada |

## 7. Cronograma

El plan académico fuente define hitos en semanas 3, 8, 13 y 17, y siete sprints. La tabla distingue el cronograma **previsto** de la evidencia que puede verificarse en el repositorio. No hay historial de commits que permita fechar la construcción por sprint; por ello, “presente en el repositorio” no significa “aceptado en esa semana”.

| Semana | Actividad/hito previsto | Evidencia o estado al corte solicitado |
|---:|---|---|
| 1 | Selección del tema y organización objeto de estudio | El plan inicial identifica al BN; validación institucional pendiente |
| 2 | Delimitación preliminar del proceso y problemática | Descripción consignada en el plan inicial; campo no acreditado |
| 3 | Plan de Proyecto | Existe plan inicial Word/PDF; aprobación/entrega docente por confirmar |
| 4 | Análisis de actores, proceso y necesidades | Trabajo de campo propuesto; evidencia de ejecución pendiente |
| 5 | Requisitos e historias iniciales; prototipo base | Código de autenticación y catálogo existe; fecha de entrega no acreditada |
| 6 | Modelo AS-IS; inicio de monitoreo | AS-IS del presente informe está marcado como hipótesis; módulo de monitoreo está en el código |
| 7 | Reglas de monitoreo y pruebas con simulación | Código y pruebas existen; el informe QA del 14/10/2026 reporta 38 aprobadas y 8 omitidas, incluidas las de persistencia PostgreSQL |
| 8 | Informe Técnico de Análisis | Hito previsto por el curso; entrega/aceptación no acreditada. Este documento es una versión documental actual |
| 9 | Inicio de diseño/TO-BE y ciclo de incidencias | El código ya contiene el flujo M1–M2; el repositorio no establece fecha de aceptación |
| 10 | Completar gestión de incidencias y demostración | Previsto en sprint S4; no constituye avance futuro ya cumplido |
| 11 | Diseño de salidas y portal público | Previsto; no implementado |
| 12 | Alertas/notificaciones y formulario público | Previsto; no implementado |
| 13 | Informe Técnico de Diseño | Hito por entregar; pendiente |
| 14 | Panel de indicadores e importación de calendario | Previsto; no implementado |
| 15 | Pruebas de avance con usuarios | Pendiente; no se reportan participantes ni resultados |
| 16 | Seguridad, auditoría, validación y ajustes | Auditoría de eventos y roles parciales sí están en código; evaluación integral pendiente |
| 17 | Prototipo final e informe final | Pendiente; no afirmar despliegue/validación final |

Las semanas 1–9 describen el corte solicitado. Las semanas 10–17 son proyección del plan de curso y no resultados.

## 8. Riesgos, supuestos y respuestas

Los riesgos y su priorización son cualitativos y preliminares, no resultados de una evaluación formal.

| Riesgo o supuesto | Consecuencia posible | Respuesta propuesta / estado |
|---|---|---|
| No se dispone de acceso al BN ni a sus sistemas | El proceso real puede diferir del modelo del grupo | Mantener el alcance simulado; confirmar hechos con documentos públicos o informantes autorizados |
| La descripción AS-IS inicial no ha sido contrastada con evidencia primaria disponible en el repositorio | Requisitos o actores podrían estar incompletos | Realizar entrevistas/encuestas solo si se autorizan; conservar instrumentos, fechas, consentimiento y resultados |
| Las verificaciones se basan en un simulador determinista | No predicen disponibilidad ni rendimiento de sistemas reales | Etiquetar toda salida de demostración como simulada |
| Error al configurar una URL HTTP | Riesgo de solicitudes a un destino no previsto | Mantener `MONITORING_DRIVER=simulated`; HTTP exige HTTPS y allowlist exacta |
| No hay coordinación del scheduler entre múltiples instancias | Podrían repetirse verificaciones si se despliega más de un proceso | Ejecutar una sola instancia de API con scheduler o diseñar coordinación distribuida antes de escalar |
| Falta de datos/evidencias del curso | Riesgo de presentar como realizado un trabajo pendiente | Registrar actividades y resultados; usar marcadores en los documentos |
| El alcance inicial incluía módulos superiores a los implementados | Confusión entre propuesta y resultado funcional | Mantener matriz de alcance y marcar portal, correo, KPI y calendario como no implementados |
| Supuesto: el curso acepta prototipo con datos simulados | Podrían existir requisitos docentes adicionales | Confirmar rúbrica, formato, citas y criterios de aceptación con la docente |

## 9. Supuestos de planificación

- El prototipo se ejecutará en entorno académico/local con PostgreSQL y datos de demostración.
- Las funciones se demostrarán con el verificador `simulated`.
- La universidad, curso, docente, composición del grupo y semanas indicadas en el plan inicial son datos de partida que deben confirmarse para la entrega.
- No se supone acceso, permiso ni aval del BN.
- Las actividades de investigación, pruebas con usuarios, evaluación de usabilidad y resultados cuantitativos permanecen pendientes hasta contar con evidencia.

## 10. Referencias internas de trabajo

- Plan de proyecto fuente: `Plan_de_Proyecto_SIMONA-BN.docx` y `Plan_de_Proyecto_SIMONA-BN(1).pdf` en la raíz.
- Alcance técnico vigente: [`README.md`](../README.md).
- Implementación: [`apps/api/`](../apps/api) y [`apps/web/`](../apps/web).
- Fechas/semanas y versión oficial: **confirmar con el sílabo y la docente antes de entregar**.
