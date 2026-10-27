import { app } from "./app.js";
import { loadConfig } from "./config/env.js";
import { startMonitoringScheduler } from "./monitoring/runtime.js";

try {
  const config = loadConfig();
  app.listen(config.PORT, () => {
    console.info(`SIMONA-BN API escuchando en http://localhost:${config.PORT}`);
    startMonitoringScheduler();
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : "No se pudo iniciar la API");
  process.exitCode = 1;
}
