import { createHash, randomBytes } from "node:crypto";
import { parse, serialize } from "cookie";
import type { Response } from "express";
import { prisma } from "../db/prisma.js";

export const SESSION_COOKIE = "simona_session";

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function readSessionToken(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }
  return parse(cookieHeader)[SESSION_COOKIE];
}

export function setSessionCookie(response: Response, token: string, maxAgeSeconds: number, secure: boolean): void {
  response.append(
    "Set-Cookie",
    serialize(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "strict",
      secure,
      path: "/",
      maxAge: maxAgeSeconds,
    }),
  );
}

export function clearSessionCookie(response: Response, secure: boolean): void {
  response.append(
    "Set-Cookie",
    serialize(SESSION_COOKIE, "", {
      httpOnly: true,
      sameSite: "strict",
      secure,
      path: "/",
      maxAge: 0,
    }),
  );
}

export async function createSession(userId: string, ttlHours: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);

  await prisma.session.deleteMany({ where: { expiresAt: { lte: now } } });
  await prisma.session.create({
    data: {
      tokenHash: hashSessionToken(token),
      userId,
      expiresAt,
    },
  });

  return token;
}
