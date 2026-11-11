import { IncidentSeverity, IncidentStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { recordAudit } from "../audit/audit.js";
import { asyncHandler } from "../http/async-handler.js";
import { getAuthenticatedUser, requireAuth } from "../auth/middleware.js";
import { renderCsv } from "./csv.js";
import { renderPdf } from "./pdf.js";
import { buildAvailabilityReport, buildExceptionReport, buildIncidentReport } from "./reports.js";
import type { Report } from "./report.js";

const maximumPeriodMillis = 366 * 24 * 60 * 60 * 1000;

const periodSchema = z.object({
  from: z.string().datetime({ offset: true }).transform((value) => new Date(value)),
  to: z.string().datetime({ offset: true }).transform((value) => new Date(value)),
});

function validatePeriod({ from, to }: { from: Date; to: Date }, context: z.RefinementCtx) {
  if (from >= to) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "from debe ser anterior a to", path: ["from"] });
  } else if (to.getTime() - from.getTime() > maximumPeriodMillis) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "El periodo no puede superar un año", path: ["to"] });
  }
}

const targetSchema = z.coerce.number().min(50).max(100).default(99);

export const exportQuerySchemas = {
  availability: periodSchema.extend({
    target: targetSchema,
    channelId: z.string().uuid().optional(),
    granularity: z.enum(["channel", "day"]).default("channel"),
  }).strict().superRefine(validatePeriod),
  incidents: periodSchema.extend({
    channelId: z.string().uuid().optional(),
    status: z.nativeEnum(IncidentStatus).optional(),
    severity: z.nativeEnum(IncidentSeverity).optional(),
  }).strict().superRefine(validatePeriod),
  exceptions: periodSchema.extend({ target: targetSchema }).strict().superRefine(validatePeriod),
};

const paramsSchema = z.object({
  report: z.enum(["availability", "incidents", "exceptions"]),
  format: z.enum(["csv", "pdf"]),
});

const router = Router();
router.use(requireAuth);

router.get(
  "/:report.:format",
  asyncHandler(async (request, response) => {
    const { report: kind, format } = paramsSchema.parse(request.params);
    const context = { generatedAt: new Date(), generatedBy: getAuthenticatedUser(request).email };

    let report: Report;
    if (kind === "availability") {
      const query = exportQuerySchemas.availability.parse(request.query);
      report = await buildAvailabilityReport({ ...query, targetPercent: query.target }, context);
    } else if (kind === "incidents") {
      report = await buildIncidentReport(exportQuerySchemas.incidents.parse(request.query), context);
    } else {
      const query = exportQuerySchemas.exceptions.parse(request.query);
      report = await buildExceptionReport({ ...query, targetPercent: query.target }, context);
    }

    const body = format === "csv" ? renderCsv(report) : await renderPdf(report, context.generatedAt);
    await recordAudit(request, {
      action: "report.export",
      entityType: "report",
      entityId: `${kind}.${format}`,
      summary: `Descargó ${report.title} (${format.toUpperCase()}, ${report.rows.length} filas)`,
      details: { query: request.query as Record<string, string> },
    });
    response
      .status(200)
      .type(format === "csv" ? "text/csv; charset=utf-8" : "application/pdf")
      .setHeader("Content-Disposition", `attachment; filename="${report.fileName}.${format}"`)
      .setHeader("Cache-Control", "no-store")
      .send(body);
  }),
);

export { router as exportsRouter };
