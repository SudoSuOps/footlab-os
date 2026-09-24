import type { ArtifactReference, ArtifactKind } from "./types.js";

const ARTIFACT_KINDS: readonly ArtifactKind[] = [
  "image",
  "observation",
  "design",
  "build",
  "fit",
  "other",
] as const;

const EXPECTED_FIELDS: readonly string[] = [
  "artifactId",
  "artifactKind",
  "relativeUri",
  "mediaType",
  "byteLength",
  "sha256",
  "createdAt",
] as const;

const ISO_UTC_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;

const SEGMENT_ALLOWED = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
// RFC 2045 token characters (alphanumerics plus !#$%&'*+-.^_`|~), used per
// segment of a strict type/subtype MIME value.
const MIME_TOKEN = /^[a-z0-9!#$&^`'()*+\-.~]+$/i;

function isPlainObject(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isKnownKind(value: unknown): value is ArtifactKind {
  return ARTIFACT_KINDS.includes(value as ArtifactKind);
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isValidUtcIso(value: string): boolean {
  if (!ISO_UTC_PATTERN.test(value)) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;

  const m = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/,
  );
  if (!m) return false;

  const [, yearStr, monthStr, dayStr, hourStr, minStr, secStr] = m;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const hour = Number(hourStr);
  const minute = Number(minStr);
  const second = Number(secStr);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth) return false;
  if (hour > 23) return false;
  if (minute > 59) return false;
  if (second > 59) return false;

  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day &&
    parsed.getUTCHours() === hour &&
    parsed.getUTCMinutes() === minute &&
    parsed.getUTCSeconds() === second;
}

export class ArtifactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactError";
  }
}

export function validateRelativeUri(uri: unknown): void {
  if (typeof uri !== "string" || uri.length === 0) {
    throw new ArtifactError("relativeUri must be a non-empty string");
  }

  if (uri.includes("\\")) {
    throw new ArtifactError("relativeUri must not contain backslashes");
  }
  if (uri.startsWith("/")) {
    throw new ArtifactError("relativeUri must not be an absolute POSIX path");
  }
  if (/^[A-Za-z]:/.test(uri)) {
    throw new ArtifactError("relativeUri must not be a Windows drive path");
  }
  if (uri.startsWith("\\\\")) {
    throw new ArtifactError("relativeUri must not be a UNC path");
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(uri)) {
    throw new ArtifactError("relativeUri must not contain a URI scheme");
  }

  const segments = uri.split("/");
  for (const segment of segments) {
    if (segment === "") {
      throw new ArtifactError("relativeUri must not have empty segments");
    }
    if (segment === "." || segment === "..") {
      throw new ArtifactError("relativeUri must not contain '.' or '..'");
    }
    if (!SEGMENT_ALLOWED.test(segment)) {
      throw new ArtifactError(
        `relativeUri segment contains unsafe characters: ${segment}`,
      );
    }
  }
}

function validateMediaType(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  if (/[\x00-\x1f\x7f\s]/.test(value)) return false;
  const slash = value.indexOf("/");
  if (slash === -1 || slash !== value.lastIndexOf("/")) return false;
  const type = value.slice(0, slash);
  const subtype = value.slice(slash + 1);
  if (!MIME_TOKEN.test(type) || !MIME_TOKEN.test(subtype)) return false;
  return true;
}

export function validateArtifactReference(value: unknown): ArtifactReference {
  if (!isPlainObject(value)) {
    throw new ArtifactError(
      "ArtifactReference must be a plain object, not array/Date/class instance",
    );
  }

  const record = value as Record<string, unknown>;

  const keys = Object.keys(record);
  if (keys.length !== EXPECTED_FIELDS.length) {
    throw new ArtifactError(
      `ArtifactReference must have exactly ${EXPECTED_FIELDS.length} fields`,
    );
  }
  for (const field of EXPECTED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) {
      throw new ArtifactError(`ArtifactReference is missing field: ${field}`);
    }
  }

  const artifactId = record.artifactId;
  const artifactKind = record.artifactKind;
  const relativeUri = record.relativeUri;
  const mediaType = record.mediaType;
  const byteLength = record.byteLength;
  const sha256 = record.sha256;
  const createdAt = record.createdAt;

  if (typeof artifactId !== "string" || artifactId.length === 0) {
    throw new ArtifactError("artifactId must be a non-empty string");
  }
  if (!isKnownKind(artifactKind)) {
    throw new ArtifactError(
      `artifactKind must be one of: ${ARTIFACT_KINDS.join(", ")}`,
    );
  }
  if (typeof relativeUri !== "string") {
    throw new ArtifactError("relativeUri must be a string");
  }
  validateRelativeUri(relativeUri);
  if (!validateMediaType(mediaType)) {
    throw new ArtifactError(
      "mediaType must be a non-empty syntactically valid MIME type (type/subtype)",
    );
  }
  if (!isSafeNonNegativeInteger(byteLength)) {
    throw new ArtifactError(
      "byteLength must be a non-negative Number.isSafeInteger value",
    );
  }
  if (typeof sha256 !== "string" || !SHA256_HEX.test(sha256)) {
    throw new ArtifactError(
      "sha256 must be exactly 64 lowercase hexadecimal characters",
    );
  }
  if (typeof createdAt !== "string" || !isValidUtcIso(createdAt)) {
    throw new ArtifactError(
      "createdAt must be a valid UTC ISO/RFC3339 timestamp ending in Z",
    );
  }

  return {
    artifactId,
    artifactKind,
    relativeUri,
    mediaType,
    byteLength,
    sha256,
    createdAt,
  };
}

export function ensureUniqueArtifactIds(
  refs: readonly ArtifactReference[],
): void {
  const seen = new Set<string>();
  for (const ref of refs) {
    if (seen.has(ref.artifactId)) {
      throw new ArtifactError(
        `duplicate artifactId within event: ${ref.artifactId}`,
      );
    }
    seen.add(ref.artifactId);
  }
}
