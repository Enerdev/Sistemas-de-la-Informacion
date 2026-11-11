import "dotenv/config";

// Las pruebas nunca envían correos por la red, sin importar la configuración local.
process.env.NOTIFICATIONS_DRIVER = "json";
process.env.LOGIN_RATE_LIMIT_MAX = "1000";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (testDatabaseUrl) {
  const parsedTestDatabaseUrl = new URL(testDatabaseUrl);
  const isLocal = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsedTestDatabaseUrl.hostname);
  const isTestDatabase = parsedTestDatabaseUrl.pathname.replace(/^\//, "").endsWith("_test");

  if (!isLocal || !isTestDatabase) {
    throw new Error("TEST_DATABASE_URL debe apuntar a una base local cuyo nombre termine en _test");
  }

  process.env.DATABASE_URL = testDatabaseUrl;
}
