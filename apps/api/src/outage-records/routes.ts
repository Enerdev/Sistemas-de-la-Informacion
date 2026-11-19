import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { asyncHandler } from "../http/async-handler.js";
import { requireAuth } from "../auth/middleware.js";

const router = Router();
router.use(requireAuth);

router.get(
  "/",
  asyncHandler(async (_request, response) => {
    const records = await prisma.publicOutageRecord.findMany({
      orderBy: [{ startDate: "desc" }, { code: "desc" }],
      take: 500,
    });
    response.status(200).json({
      data: records.map((record) => ({
        ...record,
        startDate: record.startDate.toISOString().slice(0, 10),
        endDate: record.endDate.toISOString().slice(0, 10),
      })),
    });
  }),
);

export { router as outageRecordsRouter };
