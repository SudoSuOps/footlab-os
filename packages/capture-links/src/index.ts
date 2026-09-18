import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Id, ISODateTime } from "../../domain/src/index";

export interface CaptureLinkRecord {
  requestId: Id;
  clientId: Id;
  tokenHash: string;
  issuedAt: ISODateTime;
  expiresAt: ISODateTime;
  startedAt?: ISODateTime;
  completedAt?: ISODateTime;
  revokedAt?: ISODateTime;
}

export interface IssuedCaptureLink {
  rawToken: string;
  record: CaptureLinkRecord;
}

export function hashCaptureToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export function issueCaptureLink(input: {
  requestId: Id;
  clientId: Id;
  issuedAt?: Date;
  ttlMinutes?: number;
}): IssuedCaptureLink {
  const issuedAt = input.issuedAt ?? new Date();
  const ttlMinutes = input.ttlMinutes ?? 24 * 60;
  const rawToken = randomBytes(32).toString("base64url");

  return {
    rawToken,
    record: {
      requestId: input.requestId,
      clientId: input.clientId,
      tokenHash: hashCaptureToken(rawToken),
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + ttlMinutes * 60_000).toISOString(),
    },
  };
}

export function tokenMatches(rawToken: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashCaptureToken(rawToken), "hex");
  const stored = Buffer.from(storedHash, "hex");

  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

export function captureLinkState(
  record: CaptureLinkRecord,
  now = new Date(),
): "valid" | "expired" | "completed" | "revoked" {
  if (record.revokedAt) return "revoked";
  if (record.completedAt) return "completed";
  if (new Date(record.expiresAt).getTime() <= now.getTime()) return "expired";
  return "valid";
}
