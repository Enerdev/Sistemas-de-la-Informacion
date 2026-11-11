import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChannelStatus, CheckResult, CheckSource, UserRole } from "@prisma/client";
import { app } from "../app.js";
import { hashPassword } from "../auth/password.js";
import { prisma } from "../db/prisma.js";
import { MonitoringService } from "../monitoring/service.js";
import { SimulatedServiceVerifier } from "../monitoring/verifiers.js";
import { loadConfig } from "../config/env.js";
import { NotificationDispatcher } from "../notifications/dispatcher.js";
import { createMailer } from "../notifications/mailer.js";

const enabled = Boolean(process.env.TEST_DATABASE_URL);
const suite = describe.skipIf(!enabled);
const suffix = randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
const adminEmail = `simona-admin-${suffix.toLowerCase()}@example.invalid`;
const operatorEmail = `simona-operator-${suffix.toLowerCase()}@example.invalid`;
const viewerEmail = `simona-viewer-${suffix.toLowerCase()}@example.invalid`;
const channelCode = `TEST_${suffix}`;
const historyChannelCode = `HIST_${suffix}`;
const incidentChannelCode = `INC_${suffix}`;
const concurrentChannelCode = `RACE_${suffix}`;
const notificationChannelCode = `NOTIF_${suffix}`;
const reportChannelCode = `REPORT_${suffix}`;
const otherReportChannelCode = `REPORT2_${suffix}`;
const indicatorChannelCode = `KPI_${suffix}`;
const scheduleGroup = `PRUEBA_${suffix}`;
const managedEmail = `simona-m6-${suffix.toLowerCase()}@example.invalid`;
const deliveredRecipientEmail = `m3-ok-${suffix.toLowerCase()}@simona.test`;
const failingRecipientEmail = `m3-${suffix.toLowerCase()}@fallo.simona.test`;
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
    await prisma.failureReport.deleteMany({
      where: { channel: { code: { in: [reportChannelCode, otherReportChannelCode] } } },
    });
    await prisma.incident.deleteMany({
      where: {
        channel: {
          code: {
            in: [
              channelCode,
              historyChannelCode,
              incidentChannelCode,
              concurrentChannelCode,
              notificationChannelCode,
              reportChannelCode,
              otherReportChannelCode,
              indicatorChannelCode,
            ],
          },
        },
      },
    });
    await prisma.channel.deleteMany({ where: { code: { in: [channelCode, historyChannelCode] } } });
    await prisma.channel.deleteMany({
      where: {
        code: {
          in: [
            incidentChannelCode,
            concurrentChannelCode,
            notificationChannelCode,
            reportChannelCode,
            otherReportChannelCode,
            indicatorChannelCode,
          ],
        },
      },
    });
    await prisma.paymentDate.deleteMany({ where: { group: scheduleGroup } });
    await prisma.paymentScheduleImport.deleteMany({
      where: { importedById: { in: [adminId, operatorId].filter((id): id is string => Boolean(id)) } },
    });
    await prisma.notificationRecipient.deleteMany({
      where: { email: { in: [deliveredRecipientEmail, failingRecipientEmail] } },
    });
    await prisma.user.deleteMany({ where: { email: managedEmail } });
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
      code: historyChannelCode,
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
    expect(finalChannel.body.data.channel.checks).toHaveLength(1);
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

  it("notifies outage and recovery, records delivery and retries failed sends (M1→M2→M3)", async () => {
    const [delivered, failing] = await Promise.all([
      prisma.notificationRecipient.create({ data: { email: deliveredRecipientEmail, name: "TI prueba" } }),
      prisma.notificationRecipient.create({ data: { email: failingRecipientEmail, notifyRecovery: false } }),
    ]);
    try {
      const channel = await prisma.channel.create({
        data: {
          code: notificationChannelCode,
          name: "Canal de notificaciones",
          type: "APP",
          simulatedTarget: "sim://down",
          currentStatus: ChannelStatus.AVAILABLE,
          monitoringConfig: { create: {} },
        },
      });
      const monitoring = new MonitoringService(new SimulatedServiceVerifier());
      let clockOffsetMillis = 0;
      const dispatcher = new NotificationDispatcher(
        createMailer(loadConfig({ DATABASE_URL: process.env.DATABASE_URL })),
        prisma,
        () => new Date(Date.now() + clockOffsetMillis),
      );

      for (let index = 0; index < 3; index += 1) {
        await monitoring.runManualCheck(channel.id);
      }
      const incident = await prisma.incident.findFirstOrThrow({ where: { channelId: channel.id } });
      const queued = await prisma.notification.findMany({ where: { incidentId: incident.id } });
      expect(queued).toHaveLength(2);
      expect(queued.every((notification) => notification.kind === "CHANNEL_DOWN" && notification.status === "PENDING"))
        .toBe(true);
      expect(queued[0]?.subject).toBe("[SIMONA-BN] CAÍDO: Canal de notificaciones");

      expect(await dispatcher.dispatchDue()).toBe(1);
      const sent = await prisma.notification.findFirstOrThrow({ where: { incidentId: incident.id, recipientId: delivered.id } });
      expect(sent).toMatchObject({ status: "SENT", attempts: 1, lastError: null });
      expect(sent.sentAt!.getTime()).toBeGreaterThanOrEqual(sent.eventAt.getTime());

      const retrying = await prisma.notification.findFirstOrThrow({ where: { incidentId: incident.id, recipientId: failing.id } });
      expect(retrying).toMatchObject({ status: "PENDING", attempts: 1, lastError: expect.stringContaining("Rechazo SMTP simulado") });
      clockOffsetMillis = 30_000;
      await dispatcher.dispatchDue();
      clockOffsetMillis = 90_000;
      await dispatcher.dispatchDue();
      const failed = await prisma.notification.findUniqueOrThrow({ where: { id: retrying.id } });
      expect(failed).toMatchObject({ status: "FAILED", attempts: 3, sentAt: null });

      const listed = await request(app)
        .get(`/api/notifications?incidentId=${incident.id}&status=FAILED`)
        .set("Cookie", operatorCookie);
      expect(listed.status).toBe(200);
      expect(listed.body.data.notifications).toHaveLength(1);
      expect(listed.body.data.driver).toBe("json");
      const viewerList = await request(app).get("/api/notifications").set("Cookie", viewerCookie);
      expect(viewerList.status).toBe(403);
      const operatorRecipientWrite = await request(app)
        .post("/api/notifications/recipients")
        .set("Cookie", operatorCookie)
        .send({ email: `otro-${suffix.toLowerCase()}@simona.test` });
      expect(operatorRecipientWrite.status).toBe(403);
      const sentRetry = await request(app).post(`/api/notifications/${sent.id}/retry`).set("Cookie", operatorCookie);
      expect(sentRetry.status).toBe(409);

      const retried = await request(app).post(`/api/notifications/${failed.id}/retry`).set("Cookie", operatorCookie);
      expect(retried.status).toBe(202);
      expect(retried.body.data.notification.maxAttempts).toBe(4);
      for (let wait = 0; wait < 40; wait += 1) {
        const current = await prisma.notification.findUniqueOrThrow({ where: { id: failed.id } });
        if (current.attempts === 4 && current.status !== "PENDING") break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(await prisma.notification.findUniqueOrThrow({ where: { id: failed.id } }))
        .toMatchObject({ status: "FAILED", attempts: 4 });

      await prisma.channel.update({ where: { id: channel.id }, data: { simulatedTarget: "sim://app-bn" } });
      await monitoring.runManualCheck(channel.id);
      await monitoring.runManualCheck(channel.id);
      const recovery = await prisma.notification.findMany({
        where: { incidentId: incident.id, kind: "CHANNEL_RECOVERED" },
      });
      expect(recovery).toHaveLength(1);
      expect(recovery[0]).toMatchObject({ recipientId: delivered.id, status: "PENDING" });
      expect(recovery[0]?.body).toContain("no cierra la incidencia");
      clockOffsetMillis = 0;
      expect(await dispatcher.dispatchDue()).toBe(1);

      const staffDetail = await request(app).get(`/api/incidents/${incident.id}`).set("Cookie", adminCookie);
      expect(staffDetail.body.data.incident.notifications.map((n: { kind: string; status: string }) => `${n.kind}:${n.status}`).sort())
        .toEqual(["CHANNEL_DOWN:FAILED", "CHANNEL_DOWN:SENT", "CHANNEL_RECOVERED:SENT"]);
      const viewerDetail = await request(app).get(`/api/incidents/${incident.id}`).set("Cookie", viewerCookie);
      expect(viewerDetail.status).toBe(200);
      expect(viewerDetail.body.data.incident.notifications).toBeUndefined();
    } finally {
      await prisma.notificationRecipient.updateMany({
        where: { id: { in: [delivered.id, failing.id] } },
        data: { active: false },
      });
    }
  });

  it("serves the public portal and lets staff review citizen failure reports (M4)", async () => {
    const [channel, otherChannel] = await Promise.all([reportChannelCode, otherReportChannelCode].map((code) =>
      prisma.channel.create({
        data: {
          code,
          name: `Canal portal ${code}`,
          type: "INTERNET_BANKING",
          simulatedTarget: "sim://down",
          currentStatus: ChannelStatus.AVAILABLE,
          monitoringConfig: { create: {} },
        },
      })));
    const monitoring = new MonitoringService(new SimulatedServiceVerifier());
    for (let index = 0; index < 3; index += 1) {
      await monitoring.runManualCheck(channel!.id);
      await monitoring.runManualCheck(otherChannel!.id);
    }
    const incident = await prisma.incident.findFirstOrThrow({ where: { channelId: channel!.id } });
    const otherIncident = await prisma.incident.findFirstOrThrow({ where: { channelId: otherChannel!.id } });

    const status = await request(app).get("/api/public/status");
    expect(status.status).toBe(200);
    const publicChannel = status.body.data.channels.find((item: { code: string }) => item.code === reportChannelCode);
    expect(publicChannel).toMatchObject({ currentStatus: "UNAVAILABLE", lastCheckedAt: expect.any(String) });
    expect(publicChannel.simulatedTarget).toBeUndefined();
    expect(publicChannel.monitoringConfig).toBeUndefined();

    const publicIncidents = await request(app).get("/api/public/incidents");
    expect(publicIncidents.status).toBe(200);
    const publicIncident = publicIncidents.body.data.incidents.find((item: { id: string }) => item.id === incident.id);
    expect(publicIncident).toMatchObject({ status: "OPEN", channel: { code: reportChannelCode } });
    expect(publicIncident.evidence).toBeUndefined();
    expect(publicIncident.reason).toBeUndefined();

    const submitted = await request(app).post("/api/public/reports").send({
      channelId: channel!.id,
      description: "No puedo ingresar a la banca por internet desde esta mañana.",
      contactEmail: "Ciudadano@Correo.Test",
      occurredAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(submitted.status).toBe(201);
    const referenceCode = submitted.body.data.report.referenceCode as string;
    expect(referenceCode).toMatch(/^R-[A-Z2-9]{8}$/);
    const stored = await prisma.failureReport.findUniqueOrThrow({ where: { referenceCode } });
    expect(stored).toMatchObject({ status: "NEW", contactEmail: "ciudadano@correo.test", channelId: channel!.id });

    const missingChannel = await request(app).post("/api/public/reports").send({
      channelId: "00000000-0000-4000-8000-000000000000",
      description: "Reporte para un canal que no existe.",
    });
    expect(missingChannel.status).toBe(404);

    const lookup = await request(app).get(`/api/public/reports/${referenceCode.toLowerCase()}`);
    expect(lookup.status).toBe(200);
    expect(lookup.body.data.report).toMatchObject({ referenceCode, status: "NEW", incident: null });
    expect(lookup.body.data.report.contactEmail).toBeUndefined();
    expect(lookup.body.data.report.description).toBeUndefined();
    expect((await request(app).get("/api/public/reports/R-AAAAAAAA")).status).toBe(404);

    expect((await request(app).get("/api/reports").set("Cookie", viewerCookie)).status).toBe(403);
    const staffList = await request(app).get(`/api/reports?status=NEW&channelId=${channel!.id}`).set("Cookie", operatorCookie);
    expect(staffList.status).toBe(200);
    expect(staffList.body.data.reports).toHaveLength(1);
    expect(staffList.body.data.reports[0]).toMatchObject({ contactEmail: "ciudadano@correo.test" });

    const wrongChannel = await request(app)
      .patch(`/api/reports/${stored.id}`)
      .set("Cookie", operatorCookie)
      .send({ status: "LINKED", incidentId: otherIncident.id });
    expect(wrongChannel.status).toBe(409);
    const missingIncident = await request(app)
      .patch(`/api/reports/${stored.id}`)
      .set("Cookie", operatorCookie)
      .send({ status: "LINKED" });
    expect(missingIncident.status).toBe(400);

    const linked = await request(app)
      .patch(`/api/reports/${stored.id}`)
      .set("Cookie", operatorCookie)
      .send({ status: "LINKED", incidentId: incident.id, note: "Coincide con la caída detectada." });
    expect(linked.status).toBe(200);
    expect(linked.body.data.report).toMatchObject({
      status: "LINKED",
      incident: { id: incident.id },
      reviewNote: "Coincide con la caída detectada.",
      reviewedAt: expect.any(String),
      reviewedBy: { email: operatorEmail },
    });

    const followed = await request(app).get(`/api/public/reports/${referenceCode}`);
    expect(followed.body.data.report).toMatchObject({
      status: "LINKED",
      reviewedAt: expect.any(String),
      incident: { status: "OPEN", summary: "Canal no disponible" },
    });

    await expect(prisma.failureReport.update({
      where: { id: stored.id },
      data: { incidentId: null },
    })).rejects.toThrow();
  });

  it("imports the payment schedule and computes M5 indicators for a controlled period", async () => {
    const viewerImport = await request(app)
      .post("/api/payment-schedule/import")
      .set("Cookie", viewerCookie)
      .send({ fileName: "cronograma.csv", content: `fecha,grupo\n2025-03-02,${scheduleGroup}` });
    expect(viewerImport.status).toBe(403);

    const rejected = await request(app)
      .post("/api/payment-schedule/import")
      .set("Cookie", operatorCookie)
      .send({ fileName: "cronograma.csv", content: `fecha,grupo\n2025-03-02,${scheduleGroup}\n2025-02-30,${scheduleGroup}` });
    expect(rejected.status).toBe(422);
    expect(rejected.body.error.details).toEqual([{ field: "línea 3", message: expect.stringContaining("Fecha inválida") }]);
    expect(await prisma.paymentDate.count({ where: { group: scheduleGroup } })).toBe(0);

    const imported = await request(app)
      .post("/api/payment-schedule/import")
      .set("Cookie", operatorCookie)
      .send({
        fileName: "cronograma.csv",
        content: `fecha;grupo;descripcion\n02/03/2025;${scheduleGroup};Pago de prueba\n2025-03-20;${scheduleGroup};Fuera del periodo`,
      });
    expect(imported.status).toBe(201);
    expect(imported.body.data.import).toMatchObject({ rowCount: 2, createdCount: 2, updatedCount: 0 });
    const reimported = await request(app)
      .post("/api/payment-schedule/import")
      .set("Cookie", operatorCookie)
      .send({ fileName: "cronograma-v2.csv", content: `fecha,grupo,descripcion\n2025-03-02,${scheduleGroup},Pago corregido` });
    expect(reimported.body.data.import).toMatchObject({ rowCount: 1, createdCount: 0, updatedCount: 1 });
    expect(await prisma.paymentDate.findFirst({ where: { group: scheduleGroup, date: new Date("2025-03-02") } }))
      .toMatchObject({ description: "Pago corregido" });

    const channel = await prisma.channel.create({
      data: {
        code: indicatorChannelCode,
        name: "Canal de indicadores",
        type: "APP",
        simulatedTarget: "sim://app-bn",
        currentStatus: ChannelStatus.AVAILABLE,
        monitoringConfig: { create: {} },
        statusHistory: {
          create: [
            { previousStatus: "UNKNOWN", newStatus: "AVAILABLE", source: "CHECK", changedAt: new Date("2025-02-28T12:00:00.000Z") },
            { previousStatus: "AVAILABLE", newStatus: "UNAVAILABLE", source: "CHECK", changedAt: new Date("2025-03-02T10:00:00.000Z") },
            { previousStatus: "UNAVAILABLE", newStatus: "AVAILABLE", source: "CHECK", changedAt: new Date("2025-03-02T12:00:00.000Z") },
          ],
        },
      },
    });
    const incident = await prisma.incident.create({
      data: {
        channelId: channel.id,
        status: "RESOLVED",
        severity: "HIGH",
        summary: "Canal no disponible",
        reason: "Prueba de indicadores",
        evidence: "{}",
        startedAt: new Date("2025-03-02T09:58:00.000Z"),
        detectedAt: new Date("2025-03-02T10:00:00.000Z"),
        openedAt: new Date("2025-03-02T10:00:00.000Z"),
        recoveredAt: new Date("2025-03-02T12:00:00.000Z"),
        resolvedAt: new Date("2025-03-02T12:30:00.000Z"),
      },
    });
    await prisma.notification.create({
      data: {
        kind: "CHANNEL_DOWN",
        status: "SENT",
        channelId: channel.id,
        incidentId: incident.id,
        recipientEmail: "kpi@simona.test",
        subject: "Prueba",
        body: "Prueba",
        eventAt: new Date("2025-03-02T10:00:00.000Z"),
        attempts: 1,
        sentAt: new Date("2025-03-02T10:00:06.000Z"),
        createdAt: new Date("2025-03-02T10:00:00.000Z"),
      },
    });
    await expect(prisma.incident.update({ where: { id: incident.id }, data: { status: "CLOSED" } })).rejects.toThrow();
    await expect(prisma.incident.update({ where: { id: incident.id }, data: { resolvedAt: null } })).rejects.toThrow();

    const response = await request(app)
      .get("/api/indicators")
      .query({ from: "2025-03-01T05:00:00.000Z", to: "2025-03-03T05:00:00.000Z", target: "99" })
      .set("Cookie", viewerCookie);
    expect(response.status).toBe(200);
    const { summary, channels, exceptions, paymentDates } = response.body.data;
    const row = channels.find((item: { code: string }) => item.code === indicatorChannelCode);
    expect(row.availabilityPercent).toBeCloseTo((46 / 48) * 100, 6);
    expect(row.paymentDayAvailabilityPercent).toBeCloseTo((22 / 24) * 100, 6);
    expect(row).toMatchObject({
      incidents: 1,
      incidentsOnPaymentDays: 1,
      meanTimeToRestoreMs: 2 * 60 * 60 * 1000 + 2 * 60 * 1000,
      belowTarget: true,
      belowTargetOnPaymentDays: true,
      durations: { downMs: 2 * 60 * 60 * 1000 },
    });
    expect(exceptions.map((item: { code: string }) => item.code)).toContain(indicatorChannelCode);
    expect(summary).toMatchObject({
      meanTimeToDetectMs: 120_000,
      meanTimeToCommunicateMs: 6_000,
      meanTimeToResolveMs: 150 * 60 * 1000,
      incidents: 1,
      incidentsOnPaymentDays: 1,
      paymentDaysInPeriod: 1,
      notifications: { sent: 1, failed: 0, deliveryRatePercent: 100 },
    });
    expect(paymentDates).toEqual([{ date: "2025-03-02", group: scheduleGroup, description: "Pago corregido" }]);

    const period = { from: "2025-03-01T05:00:00.000Z", to: "2025-03-03T05:00:00.000Z" };
    const daily = await request(app)
      .get("/api/exports/availability.csv")
      .query({ ...period, target: "99", granularity: "day", channelId: channel.id })
      .set("Cookie", viewerCookie);
    expect(daily.status).toBe(200);
    expect(daily.headers["content-type"]).toContain("text/csv");
    expect(daily.headers["content-disposition"]).toBe(
      "attachment; filename=\"simona-disponibilidad-diaria-2025-03-01_2025-03-03.csv\"",
    );
    expect(daily.text.split("\r\n").filter(Boolean)).toEqual([
      "\uFEFFCanal,Código,Fecha,Día de pago,Disponibilidad (%),Operativo (min),Caído (min),Mantenimiento (min),Sin verificar (min),Bajo la meta",
      `Canal de indicadores,${indicatorChannelCode},2025-03-01,No,100,1440,0,0,0,No`,
      `Canal de indicadores,${indicatorChannelCode},2025-03-02,Sí,91.667,1320,120,0,0,Sí`,
    ]);

    const exceptionCsv = await request(app)
      .get("/api/exports/exceptions.csv")
      .query({ ...period, target: "99" })
      .set("Cookie", viewerCookie);
    expect(exceptionCsv.text).toContain(
      `Canal de indicadores,${indicatorChannelCode},2025-03-02,${scheduleGroup},91.667,99,-7.333,120`,
    );

    const incidentCsv = await request(app)
      .get("/api/exports/incidents.csv")
      .query({ ...period, channelId: channel.id })
      .set("Cookie", viewerCookie);
    const incidentLines = incidentCsv.text.split("\r\n").filter(Boolean);
    expect(incidentLines).toHaveLength(2);
    expect(incidentLines[1]).toBe(
      `${incident.id.slice(0, 8)},Canal de indicadores,Resuelta,Alta,2025-03-02 04:58:00,2025-03-02 05:00:00,2025-03-02 07:00:00,2025-03-02 07:30:00,,122,Sí,Canal no disponible,Prueba de indicadores,0,1`,
    );

    const pdf = await request(app)
      .get("/api/exports/exceptions.pdf")
      .query({ ...period, target: "99" })
      .set("Cookie", viewerCookie)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("manages users, enforces temporary passwords and keeps an immutable audit log (M6)", async () => {
    expect((await request(app).post("/api/users").set("Cookie", operatorCookie).send({ email: managedEmail, role: "VIEWER" })).status)
      .toBe(403);
    expect((await request(app).get("/api/audit").set("Cookie", viewerCookie)).status).toBe(403);

    const created = await request(app)
      .post("/api/users")
      .set("Cookie", adminCookie)
      .send({ email: managedEmail.toUpperCase(), role: "OPERATOR" });
    expect(created.status).toBe(201);
    expect(created.body.data.user).toMatchObject({ email: managedEmail, role: "OPERATOR", mustChangePassword: true, active: true });
    const temporaryPassword = created.body.data.temporaryPassword as string;
    const managedId = created.body.data.user.id as string;
    expect((await prisma.user.findUniqueOrThrow({ where: { id: managedId } })).passwordHash).not.toContain(temporaryPassword);

    const firstLogin = await request(app).post("/api/auth/login").send({ email: managedEmail, password: temporaryPassword });
    expect(firstLogin.status).toBe(200);
    expect(firstLogin.body.data.user.mustChangePassword).toBe(true);
    let managedCookie = sessionCookie(firstLogin.headers["set-cookie"]);
    const blocked = await request(app).get("/api/channels").set("Cookie", managedCookie);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.details).toEqual({ code: "PASSWORD_CHANGE_REQUIRED" });
    expect((await request(app).get("/api/auth/me").set("Cookie", managedCookie)).body.data.user.mustChangePassword).toBe(true);

    const wrongCurrent = await request(app)
      .post("/api/auth/change-password")
      .set("Cookie", managedCookie)
      .send({ currentPassword: "Incorrecta-123456", newPassword: "Nueva-Clave-M6-2026" });
    expect(wrongCurrent.status).toBe(400);
    const changed = await request(app)
      .post("/api/auth/change-password")
      .set("Cookie", managedCookie)
      .send({ currentPassword: temporaryPassword, newPassword: "Nueva-Clave-M6-2026" });
    expect(changed.status).toBe(204);
    expect((await request(app).get("/api/channels").set("Cookie", managedCookie)).status).toBe(200);
    expect((await request(app).post("/api/auth/login").send({ email: managedEmail, password: temporaryPassword })).status).toBe(401);

    const demoted = await request(app).patch(`/api/users/${managedId}`).set("Cookie", adminCookie).send({ role: "VIEWER" });
    expect(demoted.status).toBe(200);
    expect((await request(app)
      .post("/api/channels")
      .set("Cookie", managedCookie)
      .send({ code: `M6_${suffix}`, name: "No permitido", type: "APP", simulatedTarget: "sim://app-bn" })).status).toBe(403);

    expect((await request(app).patch(`/api/users/${adminId}`).set("Cookie", adminCookie).send({ active: false })).status).toBe(409);
    expect((await request(app).patch(`/api/users/${adminId}`).set("Cookie", adminCookie).send({ role: "VIEWER" })).status).toBe(409);

    const deactivated = await request(app).patch(`/api/users/${managedId}`).set("Cookie", adminCookie).send({ active: false });
    expect(deactivated.body.data.user.active).toBe(false);
    expect((await request(app).get("/api/auth/me").set("Cookie", managedCookie)).status).toBe(401);
    expect((await request(app).post("/api/auth/login").send({ email: managedEmail, password: "Nueva-Clave-M6-2026" })).status).toBe(403);

    await request(app).patch(`/api/users/${managedId}`).set("Cookie", adminCookie).send({ active: true });
    const reset = await request(app).post(`/api/users/${managedId}/reset-password`).set("Cookie", adminCookie);
    expect(reset.status).toBe(200);
    expect((await request(app).post("/api/auth/login").send({ email: managedEmail, password: "Nueva-Clave-M6-2026" })).status).toBe(401);
    const afterReset = await request(app).post("/api/auth/login").send({ email: managedEmail, password: reset.body.data.temporaryPassword });
    expect(afterReset.body.data.user.mustChangePassword).toBe(true);
    managedCookie = sessionCookie(afterReset.headers["set-cookie"]);
    expect((await request(app).get("/api/incidents").set("Cookie", managedCookie)).status).toBe(403);

    const trail = await request(app)
      .get("/api/audit")
      .query({ actor: managedEmail, limit: 100 })
      .set("Cookie", adminCookie);
    expect(trail.status).toBe(200);
    expect(trail.body.data.entries.map((entry: { action: string }) => entry.action)).toEqual(expect.arrayContaining([
      "auth.login",
      "auth.login_failed",
      "auth.login_blocked",
      "auth.password_change",
    ]));
    const adminActions = await prisma.auditLog.findMany({
      where: { entityId: managedId, actorEmail: adminEmail },
      orderBy: { createdAt: "asc" },
      select: { action: true, summary: true, ip: true },
    });
    expect(adminActions.map(({ action }) => action)).toEqual([
      "user.create",
      "user.update",
      "user.update",
      "user.update",
      "user.password_reset",
    ]);
    expect(adminActions[1]!.summary).toContain("rol OPERATOR → VIEWER");
    expect(adminActions[2]!.summary).toContain("desactivada");
    expect(adminActions[0]!.ip).toBeTruthy();
    expect(JSON.stringify(await prisma.auditLog.findMany({ where: { entityId: managedId } }))).not.toContain(temporaryPassword);

    const channelAudit = await prisma.auditLog.findFirst({ where: { action: "channel.create", summary: { contains: channelCode } } });
    expect(channelAudit).toMatchObject({ actorEmail: adminEmail, actorRole: "ADMIN" });

    await expect(prisma.auditLog.updateMany({ where: { entityId: managedId }, data: { summary: "alterado" } }))
      .rejects.toThrow(/solo inserción/);
    await expect(prisma.auditLog.deleteMany({ where: { entityId: managedId } })).rejects.toThrow(/solo inserción/);
  });

  it("reclassifies incident severity with an audited event", async () => {
    const channel = await prisma.channel.findUniqueOrThrow({ where: { code: indicatorChannelCode } });
    const incident = await prisma.incident.create({
      data: {
        channelId: channel.id,
        status: "IN_PROGRESS",
        severity: "HIGH",
        summary: "Canal no disponible",
        reason: "Prueba de severidad",
        evidence: "{}",
        detectedAt: new Date("2025-03-05T10:00:00.000Z"),
        openedAt: new Date("2025-03-05T10:00:00.000Z"),
      },
    });

    expect((await request(app).patch(`/api/incidents/${incident.id}/severity`).set("Cookie", viewerCookie).send({ severity: "LOW" })).status)
      .toBe(403);
    const changed = await request(app)
      .patch(`/api/incidents/${incident.id}/severity`)
      .set("Cookie", operatorCookie)
      .send({ severity: "CRITICAL", comment: "Afecta una fecha de pago." });
    expect(changed.status).toBe(200);
    expect(changed.body.data.incident.severity).toBe("CRITICAL");
    expect(await prisma.incidentEvent.findFirst({ where: { incidentId: incident.id, kind: "SEVERITY_CHANGED" } })).toMatchObject({
      actorId: operatorId,
      previousStatus: "IN_PROGRESS",
      newStatus: "IN_PROGRESS",
      note: "Severidad ALTA → CRÍTICA. Afecta una fecha de pago.",
    });
    expect(await prisma.auditLog.findFirst({ where: { action: "incident.severity_change", entityId: incident.id } }))
      .toMatchObject({ actorEmail: operatorEmail });
    expect((await request(app).patch(`/api/incidents/${incident.id}/severity`).set("Cookie", operatorCookie).send({ severity: "CRITICAL" })).status)
      .toBe(409);
    await prisma.incident.update({
      where: { id: incident.id },
      data: { status: "CLOSED", resolvedAt: new Date("2025-03-05T11:00:00.000Z"), closedAt: new Date("2025-03-05T12:00:00.000Z") },
    });
    expect((await request(app).patch(`/api/incidents/${incident.id}/severity`).set("Cookie", operatorCookie).send({ severity: "LOW" })).status)
      .toBe(409);
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
