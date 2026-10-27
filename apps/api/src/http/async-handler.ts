import type { RequestHandler } from "express";

type AsyncHandler = (
  request: Parameters<RequestHandler>[0],
  response: Parameters<RequestHandler>[1],
  next: Parameters<RequestHandler>[2],
) => Promise<unknown>;

export function asyncHandler(handler: AsyncHandler): RequestHandler {
  return (request, response, next) => {
    void handler(request, response, next).catch(next);
  };
}
