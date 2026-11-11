import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../http/async-handler.js";
import { requireAuth } from "../auth/middleware.js";
import { computeIndicators } from "./service.js";

const maximumPeriodMillis = 366 * 24 * 60 * 60 * 1000;

export const indicatorQuerySchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  target: z.coerce.number().min(50).max(100).default(99),
}).strict()
  .refine(({ from, to }) => Date.parse(from) < Date.parse(to), {
    message: "from debe ser anterior a to",
    path: ["from"],
  })
  .refine(({ from, to }) => Date.parse(to) - Date.parse(from) <= maximumPeriodMillis, {
    message: "El periodo no puede superar un año",
    path: ["to"],
  });

const router = Router();
router.use(requireAuth);

router.get(
  "/",
  asyncHandler(async (request, response) => {
    const query = indicatorQuerySchema.parse(request.query);
    const indicators = await computeIndicators({
      from: new Date(query.from),
      to: new Date(query.to),
      targetPercent: query.target,
    });
    response.status(200).json({ data: indicators });
  }),
);

export { router as indicatorsRouter };
