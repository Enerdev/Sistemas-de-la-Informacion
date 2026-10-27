import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChannelStatus, CheckResult, CheckSource, UserRole } from "@prisma/client";
import { app } from "../app.js";
import { hashPassword } from "../auth/password.js";
import { prisma } from "../db/prisma.js";
import { MonitoringService } from "../monitoring/service.js";

const enabled = Boolean(process.env.TEST_DATABASE_URL);
const suite = describe.skipIf(!enabled);
const suffix = randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
const adminEmail = `simona-admin-${suffix.toLowerCase()}@example.invalid`;
const operatorEmail = `simona-operator-${suffix.toLowerCase()}@example.invalid`;
const viewerEmail = `simona-viewer-${suffix.toLowerCase()}@example.invalid`;
const channelCode = `TEST_${suffix}`;
const incidentChannelCode = `INC_${suffix}`;
const concurrentChannelCode = `RACE_${suffix}`;
const testPassword = "Database-Test-Password-2026!";
let adminCookie = "";
let operatorCookie = "";
let viewerCookie = "";
let adminId: string | undefined;
let operatorId: string | undefined;
let viewerId: string | undefined;

suite("persistencia e integración PostgreSQL", () => {
  beforeAll(async () => {
    await prisma.$connect();
    const admin = await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash: await hashPassword(testPassword),
        role: UserRole.ADMIN,
      },
    });
    adminId = admin.id;

    const operator = await prisma.user.create({
      data: {
        email: operatorEmail,
        passwordHash: await hashPassword(testPassword),
        role: UserRole.OPERATOR,
      },
    });
    operatorId = operator.id;

    const adminLogin = await request(app).post("/api/auth/login").send({
      email: adminEmail,
      password: testPassword,
    });
    expect(adminLogin.status).toBe(200);
    const setCookieHeader = adminLogin.headers["set-cookie"];
    const setCookie = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    adminCookie = sessionCookie(adminLogin.headers["set-cookie"]);

    const operatorLogin = await request(app).post("/api/auth/login").send({
      email: operatorEmail,
      password: testPassword,
    });
    expect(operatorLogin.status).toBe(200);
    operatorCookie = sessionCookie(operatorLogin.headers["set-cookie"]);

    const registration = await request(app).post("/api/auth/register").send({
      email: viewerEmail,
      password: testPassword,
    });
    expect(registration.status).toBe(201);
    expect(registration.body.data.user.passwordHash).toBeUndefined();
    viewerId = registration.body.data.user.id as string;

    const viewerLogin = await request(app).post("/api/auth/login").send({
      email: viewerEmail,
      password: testPassword,
    });
    expect(viewerLogin.status).toBe(200);
    viewerCookie = sessionCookie(viewerLogin.headers["set-cookie"]);
  }, 30_000);

  afterAll(async () => {
    await prisma.incident.deleteMany({
      where: { channel: { code: { in: [channelCode, incidentChannelCode, concurrentChannelCode] } } },
    });
    await prisma.channel.deleteMany({ where: { code: channelCode } });
    await prisma.channel.deleteMany({
      where: { code: { in: [incidentChannelCode, concurrentChannelCode] } },
    });
    const userIds = [adminId, operatorId, viewerId].filter((id): id is string => Boolean(id));
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  function sessionCookie(header: string | string[] | undefined): string {
    const firstHeader = Array.isArray(header) ? header[0] : header;
    const cookie = firstHeader?.split(";")[0];
    if (!cookie) {
      throw new Error("La respuesta de inicio de sesión no incluyó una cookie de sesión");
    }
    return cookie;
  }

  it("hashes credentials, returns a session cookie, and authenticates /me", async () => {
    const sessions = await prisma.session.findMany({
      where: { userId: adminId },
      select: { tokenHash: true },
    });

    expect(adminCookie).toContain("simona_session=");
    expect(adminCookie).not.toContain(testPassword);
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.every((session) => session.tokenHash !== adminCookie.split("=")[1])).toBe(true);

    const me = await request(app).get("/api/auth/me").set("Cookie", adminCookie);
    expect(me.status).toBe(200);
    expect(me.body.data.user).toMatchObject({ id: adminId, email: adminEmail, role: "ADMIN" });
    expect(me.body.data.user.passwordHash).toBeUndefined();
  });

  it("rejects wrong passwords and denies channel writes to viewers", async () => {
    const wrongPassword = await request(app).post("/api/auth/login").send({
      email: adminEmail,
      password: "Another-Invalid-Password-2026!",
    });
    const write = await request(app)
      .post("/api/channels")
      .set("Cookie", viewerCookie)
      .send({ code: channelCode, name: "No autorizado", type: "APP", simulatedTarget: "sim://test" });
    const manualCheck = await request(app)
      .post(`/api/channels/${randomUUID()}/check`)
      .set("Cookie", viewerCookie);

    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.body.error.message).toBe("Correo o contraseña incorrectos");
    expect(write.status).toBe(403);
    expect(manualCheck.status).toBe(403);
  });

  it("persists and serves channel creation, lookup, update, and monitoring changes", async () => {
    const payload = {
      code: channelCode,
      name: "Canal de integración",
      description: "Servicio simulado para verificar persistencia.",
      type: "APP",
      simulatedTarget: "sim://integration-test",
    };

    const created = await request(app).post("/api/channels").set("Cookie", adminCookie).send(payload);
    expect(created.status).toBe(201);
    expect(created.body.data.channel.monitoringConfig.checkIntervalSeconds).toBe(60);
    const stored = await prisma.channel.findUnique({ where: { code: channelCode } });
    expect(stored?.simulatedTarget).toBe("sim://integration-test");

    const listed = await request(app).get("/api/channels").set("Cookie", adminCookie);
    expect(listed.body.data.channels.some((channel: { code: string }) => channel.code === channelCode)).toBe(true);

    const channelId = created.body.data.channel.id as string;
    const detail = await request(app).get(`/api/channels/${channelId}`).set("Cookie", adminCookie);
    expect(detail.status).toBe(200);

    const updated = await request(app)
      .patch(`/api/channels/${channelId}`)
      .set("Cookie", adminCookie)
      .send({ name: "Canal actualizado" });
    expect(updated.status).toBe(200);
    expect(updated.body.data.channel.name).toBe("Canal actualizado");

    const settings = await request(app)
      .patch(`/api/channels/${channelId}/monitoring/config`)
      .set("Cookie", adminCookie)
      .send({ latencyWarningMillis: 2400, failureThreshold: 4 });
    expect(settings.status).toBe(200);
    expect(settings.body.data.monitoringConfig).toMatchObject({
      latencyWarningMillis: 2400,
      failureThreshold: 4,
    });

    const toggled = await request(app)
      .patch(`/api/channels/${channelId}/monitoring`)
      .set("Cookie", adminCookie)
      .send({ monitoringEnabled: true });
    expect(toggled.status).toBe(200);
    expect(toggled.body.data.channel.monitoringEnabled).toBe(true);
    expect((await prisma.channel.findUnique({ where: { id: channelId } }))?.monitoringEnabled).toBe(true);
  });

  it("persists manual simulated checks and returns a paginated channel history", async () => {
    const created = await request(app).post("/api/channels").set("Cookie", adminCookie).send({
      code: channelCode,
      name: "Canal de monitoreo simulado",
      type: "APP",
      simulatedTarget: "sim://down",
    });
    expect(created.status).toBe(201);
    const channelId = created.body.data.channel.id as string;

    const firstCheck = await request(app)
      .post(`/api/channels/${channelId}/check`)
      .set("Cookie", adminCookie);
    const secondCheck = await request(app)
      .post(`/api/channels/${channelId}/check`)
      .set("Cookie", adminCookie);

    expect(firstCheck.status).toBe(201);
    expect(firstCheck.body.data.check).toMatchObject({
      source: "SIMULATED",
      result: "FAILURE",
      observedStatus: "DEGRADED",
    });
    expect(secondCheck.status).toBe(201);
    expect(secondCheck.body.data.check.observedStatus).toBe("DEGRADED");
    const thirdCheck = await request(app)
      .post(`/api/channels/${channelId}/check`)
      .set("Cookie", adminCookie);
    expect(thirdCheck.status).toBe(201);
    expect(thirdCheck.body.data.check.observedStatus).toBe("UNAVAILABLE");
    expect(await prisma.channelCheck.count({ where: { channelId } })).toBe(3);

    const history = await request(app)
      .get(`/api/channels/${channelId}/checks?limit=1`)
      .set("Cookie", adminCookie);
    expect(history.status).toBe(200);
    expect(history.body.data.checks).toHaveLength(1);
    expect(history.body.data.checks[0].source).toBe("SIMULATED");
    expect(history.body.data.nextCursor).toBeTruthy();
  });

  it("runs the persisted M1-to-M2 flow from operational status through audited closure", async () => {
    const created = await request(app).post("/api/channels").set("Cookie", adminCookie).send({
      code: incidentChannelCode,
      name: "Canal para ciclo M2",
      type: "APP",
      simulatedTarget: "sim://app-bn",
      monitoringConfig: { failureThreshold: 3, recoveryThreshold: 2 },
    });
    expect(created.status).toBe(201);
    const channelId = created.body.data.channel.id as string;

    const healthy = await request(app)
      .post(`/api/channels/${channelId}/check`)
      .set("Cookie", adminCookie);
    expect(healthy.status).toBe(201);
    expect(healthy.body.data.check).toMatchObject({
      source: "SIMULATED",
      result: "SUCCESS",
      observedStatus: "AVAILABLE",
    });
    expect(await prisma.channel.findUnique({
      where: { id: channelId },
      select: { currentStatus: true },
    })).toMatchObject({ currentStatus: ChannelStatus.AVAILABLE });

    const switchedToFailure = await request(app)
      .patch(`/api/channels/${channelId}`)
      .set("Cookie", adminCookie)
      .send({ simulatedTarget: "sim://down" });
    expect(switchedToFailure.status).toBe(200);

    const first = await request(app).post(`/api/channels/${channelId}/check`).set("Cookie", adminCookie);
    const second = await request(app).post(`/api/channels/${channelId}/check`).set("Cookie", adminCookie);
    expect(first.status).toBe(201);
    expect(first.body.data.check).toMatchObject({ result: "FAILURE", observedStatus: "DEGRADED" });
    expect(second.status).toBe(201);
    expect(second.body.data.check).toMatchObject({ result: "FAILURE", observedStatus: "DEGRADED" });
    expect(await prisma.incident.count({ where: { channelId } })).toBe(0);

    const third = await request(app).post(`/api/channels/${channelId}/check`).set("Cookie", adminCookie);
    expect(third.status).toBe(201);
    expect(third.body.data.check).toMatchObject({ result: "FAILURE", observedStatus: "UNAVAILABLE" });
    const initialIncident = await prisma.incident.findFirst({ where: { channelId } });
    expect(initialIncident).toMatchObject({
      status: "OPEN",
      severity: "HIGH",
      reason: expect.stringContaining("3 fallos consecutivos"),
      detectionCheckId: third.body.data.check.id,
    });
    expect(initialIncident?.evidence).toContain('"failureThreshold":3');
    expect(await prisma.incident.count({ where: { channelId } })).toBe(1);

    const duplicateFailure = await request(app).post(`/api/channels/${channelId}/check`).set("Cookie", adminCookie);
    expect(duplicateFailure.status).toBe(201);
    expect(await prisma.incident.count({ where: { channelId, status: "OPEN" } })).toBe(1);

    const detectedAt = new Date(third.body.data.check.checkedAt as string);
    const filtered = await request(app)
      .get(
        `/api/incidents?channelId=${channelId}&status=OPEN&severity=HIGH&from=${encodeURIComponent(detectedAt.toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}&limit=10`,
      )
      .set("Cookie", adminCookie);
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.incidents).toHaveLength(1);

    const detail = await request(app)
      .get(`/api/incidents/${initialIncident?.id}`)
      .set("Cookie", adminCookie);
    expect(detail.status).toBe(200);
    expect(detail.body.data.incident.events[0]).toMatchObject({
      kind: "OPENED",
      actorType: "SYSTEM",
      newStatus: "OPEN",
      checkId: third.body.data.check.id,
    });
    expect(detail.body.data.incident.detectionCheck.id).toBe(third.body.data.check.id);

    const invalidTransition = await request(app)
      .patch(`/api/incidents/${initialIncident?.id}/status`)
      .set("Cookie", adminCookie)
      .send({ status: "CLOSED" });
    expect(invalidTransition.status).toBe(409);

    const viewerTransition = await request(app)
      .patch(`/api/incidents/${initialIncident?.id}/status`)
      .set("Cookie", viewerCookie)
      .send({ status: "IN_PROGRESS" });
    expect(viewerTransition.status).toBe(403);

    const investigating = await request(app)
      .patch(`/api/incidents/${initialIncident?.id}/status`)
      .set("Cookie", operatorCookie)
      .send({ status: "IN_PROGRESS", comment: "Se inició investigación." });
    expect(investigating.status).toBe(200);

    const switchedToRecovery = await request(app)
      .patch(`/api/channels/${channelId}`)
      .set("Cookie", adminCookie)
      .send({ simulatedTarget: "sim://app-bn" });
    expect(switchedToRecovery.status).toBe(200);
    const firstRecovery = await request(app)
      .post(`/api/channels/${channelId}/check`)
      .set("Cookie", adminCookie);
    expect(firstRecovery.status).toBe(201);
    expect(firstRecovery.body.data.check.observedStatus).toBe("UNAVAILABLE");
    expect((await prisma.incident.findUnique({ where: { id: initialIncident!.id } }))?.recoveredAt)
      .toBeNull();
    const secondRecovery = await request(app)
      .post(`/api/channels/${channelId}/check`)
      .set("Cookie", adminCookie);
    expect(secondRecovery.status).toBe(201);
    expect(secondRecovery.body.data.check.observedStatus).toBe("AVAILABLE");

    const recovered = await prisma.incident.findUnique({ where: { id: initialIncident!.id } });
    expect(recovered?.recoveredAt).toBeInstanceOf(Date);
    expect(recovered?.status).toBe("IN_PROGRESS");
    expect(await prisma.channel.findUnique({ where: { id: channelId }, select: { currentStatus: true } }))
      .toMatchObject({ currentStatus: ChannelStatus.AVAILABLE });

    const resolved = await request(app)
      .patch(`/api/incidents/${initialIncident?.id}/status`)
      .set("Cookie", operatorCookie)
      .send({ status: "RESOLVED", comment: "Investigación completada." });
    expect(resolved.status).toBe(200);
    const closed = await request(app)
      .patch(`/api/incidents/${initialIncident?.id}/status`)
      .set("Cookie", adminCookie)
      .send({ status: "CLOSED", comment: "Cierre autorizado." });
    expect(closed.status).toBe(200);

    const closedDetail = await request(app)
      .get(`/api/incidents/${initialIncident?.id}`)
      .set("Cookie", adminCookie);
    expect(closedDetail.body.data.incident).toMatchObject({
      status: "CLOSED",
      recoveredAt: expect.any(String),
      resolvedAt: expect.any(String),
      closedAt: expect.any(String),
    });
    expect(closedDetail.body.data.incident.events.map((event: { kind: string }) => event.kind))
      .toEqual(["OPENED", "STATUS_CHANGED", "CHANNEL_RECOVERED", "STATUS_CHANGED", "STATUS_CHANGED"]);
    expect(await prisma.channelCheck.count({ where: { channelId } })).toBe(7);

    const finalChannel = await request(app)
      .get(`/api/channels/${channelId}`)
      .set("Cookie", adminCookie);
    expect(finalChannel.status).toBe(200);
    expect(finalChannel.body.data.channel.currentStatus).toBe("AVAILABLE");
    expect(finalChannel.body.data.channel.checks).toHaveLength(5);
    expect(finalChannel.body.data.channel.checks[0].observedStatus).toBe("AVAILABLE");

    await request(app)
      .patch(`/api/channels/${channelId}`)
      .set("Cookie", adminCookie)
      .send({ simulatedTarget: "sim://down" });
    await request(app).post(`/api/channels/${channelId}/check`).set("Cookie", adminCookie);
    await request(app).post(`/api/channels/${channelId}/check`).set("Cookie", adminCookie);
    await request(app).post(`/api/channels/${channelId}/check`).set("Cookie", adminCookie);

    const newEpisodeCount = await prisma.incident.count({ where: { channelId } });
    expect(newEpisodeCount).toBe(2);
    expect(await prisma.incident.count({ where: { channelId, status: "OPEN" } })).toBe(1);
  });

  it("serializes concurrent detections and keeps only one active incident", async () => {
    const created = await request(app).post("/api/channels").set("Cookie", adminCookie).send({
      code: concurrentChannelCode,
      name: "Canal para carrera M2",
      type: "APP",
      simulatedTarget: "sim://down",
      monitoringConfig: { failureThreshold: 1 },
    });
    expect(created.status).toBe(201);
    const channelId = created.body.data.channel.id as string;
    const verifier = {
      verify: async () => ({
        source: CheckSource.SIMULATED,
        result: CheckResult.FAILURE,
        responseTimeMs: null,
        httpStatusCode: null,
        detail: "Fallo simulado concurrente.",
      }),
    };
    const firstService = new MonitoringService(verifier);
    const secondService = new MonitoringService(verifier);

    const results = await Promise.allSettled([
      firstService.runManualCheck(channelId),
      secondService.runManualCheck(channelId),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    expect(await prisma.channelCheck.count({ where: { channelId } })).toBe(2);
    expect(await prisma.incident.count({ where: { channelId, status: { in: ["OPEN", "IN_PROGRESS"] } } }))
      .toBe(1);
  });

  it("rejects invalid simulated targets and reports missing channels", async () => {
    const invalid = await request(app)
      .post("/api/channels")
      .set("Cookie", adminCookie)
      .send({
        code: `${channelCode}_BAD`,
        name: "URL no permitida",
        type: "APP",
        simulatedTarget: "https://example.invalid",
      });
    const missing = await request(app)
      .get("/api/channels/00000000-0000-4000-8000-000000000000")
      .set("Cookie", adminCookie);

    expect(invalid.status).toBe(400);
    expect(missing.status).toBe(404);
  });

  it("invalidates a session on logout", async () => {
    const logout = await request(app).post("/api/auth/logout").set("Cookie", viewerCookie);
    const me = await request(app).get("/api/auth/me").set("Cookie", viewerCookie);

    expect(logout.status).toBe(204);
    expect(me.status).toBe(401);
  });
});
