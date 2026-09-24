import { createHash } from "node:crypto";

type JSONValue = string | number | boolean | null | JSONObject | JSONArray;
interface JSONObject { [key: string]: JSONValue; }
interface JSONArray extends Array<JSONValue> {}

/** Returns true only for null, strings, booleans, finite numbers */
function isScalar(v: unknown): boolean {
  if (v === null) return true;
  const t = typeof v;
  if (t === "string" || t === "boolean") return true;
  if (t === "number") return Number.isFinite(v as number);
  return false;
}

/** Returns true only for plain objects and arrays (no prototypes, no exotic classes) */
function isPlainContainer(v: unknown): boolean {
  if (Array.isArray(v)) return true;
  if (typeof v === "object" && v !== null) {
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
  }
  return false;
}

/**
 * Canonical serialization:
 * - recursively sorts plain-object keys
 * - preserves array order
 * - rejects NaN, Infinity, -Infinity, undefined, bigint, symbol, function
 * - rejects sparse arrays
 * - rejects cyclic structures
 * - rejects Date, Map, Set, class instances, non-plain objects
 */
export function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  const serialize = (v: unknown): string => {
    if (v === null) return "null";
    const t = typeof v;
    if (t === "string") return JSON.stringify(v);
    if (t === "boolean") return JSON.stringify(v);
    if (t === "number") {
      if (!Number.isFinite(v as number)) {
        throw new Error("Unsupported value for canonical serialization: non-finite number");
      }
      return JSON.stringify(v);
    }
    if (t === "undefined" || t === "bigint" || t === "symbol" || t === "function") {
      throw new TypeError("Unsupported value for canonical serialization");
    }
    if (t !== "object") {
      throw new TypeError("Unsupported value for canonical serialization");
    }

    // object at this point
    const obj = v as object;

    // reject cyclic
    if (seen.has(obj)) {
      throw new Error("Cyclic structure detected in canonical serialization");
    }

    if (Array.isArray(obj)) {
      // reject sparse arrays
      if (Object.keys(obj).length !== obj.length) {
        throw new Error("Sparse arrays are not supported in canonical serialization");
      }
      seen.add(obj);
      const parts = obj.map((item) => serialize(item));
      seen.delete(obj);
      return `[${parts.join(",")}]`;
    }

    // reject non-plain objects (Date, Map, Set, class instances, etc.)
    if (!isPlainContainer(obj)) {
      throw new TypeError("Unsupported value for canonical serialization: non-plain object");
    }

    seen.add(obj);
    const keys = Object.keys(obj).sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${serialize((obj as Record<string, unknown>)[k])}`);
    seen.delete(obj);
    return `{${parts.join(",")}}`;
  };

  return serialize(value);
}

/** Returns hex SHA-256 of the canonical serialization */
export function sha256Canonical(value: unknown): string {
  const canonical = stableStringify(value);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** Validate that a hex string is 64 lowercase characters */
export function isSha256Hex(s: string): boolean {
  return /^[0-9a-f]{64}$/.test(s);
}

/**
 * Compute the canonical hash of a dataset event.
 * Excludes only integrity.contentHash; retains integrity.algorithm and
 * integrity.previousEventHash. Does not mutate the supplied event.
 */
export function computeDatasetEventHash(event: unknown): string {
  if (typeof event !== "object" || event === null) {
    throw new TypeError("Dataset event must be a non-null object");
  }

  // shallow copy so we never mutate the caller's object
  const cloned: Record<string, unknown> = { ...(event as Record<string, unknown>) };

  const integrity = cloned["integrity"];
  if (typeof integrity === "object" && integrity !== null) {
    const integrityClone: Record<string, unknown> = { ...(integrity as Record<string, unknown>) };
    delete integrityClone["contentHash"];
    cloned["integrity"] = integrityClone;
  }

  return sha256Canonical(cloned);
}
