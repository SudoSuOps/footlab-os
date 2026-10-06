import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  openSync,
  closeSync,
  fsyncSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { MAX_IMAGE_BYTES } from "./protocol.mjs";

// Personal development vault only. Single process; a deployed Edge supplies managed keys.
export function openLocalVault(root, { keyPath: externalKeyPath } = {}) {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const keyPath = externalKeyPath ?? join(root, "local.key");
  if (externalKeyPath && (!existsSync(keyPath) || (statSync(keyPath).mode & 0o077)))
    throw new Error("Pilot vault key must exist and be private (mode 600)");
  if (!externalKeyPath && !existsSync(keyPath))
    writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: "wx" });
  const key = readFileSync(keyPath);
  if (key.length !== 32) throw new Error("Invalid vault key");
  function seal(bytes) {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
  }
  function open(bytes) {
    const cipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
    cipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]);
  }
  function atomic(path, bytes) {
    const tmp = path + "." + randomUUID() + ".tmp";
    try {
      writeFileSync(tmp, seal(bytes), { mode: 0o600, flag: "wx" });
      const fd = openSync(tmp, "r");
      try { fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(tmp, path);
      const directory = openSync(root, "r");
      try { fsyncSync(directory); } finally { closeSync(directory); }
    } finally {
      if (existsSync(tmp)) unlinkSync(tmp);
    }
  }
  const statePath = join(root, "sessions.enc");
  return {
    load: () =>
      existsSync(statePath)
        ? JSON.parse(open(readFileSync(statePath)).toString("utf8"))
        : { links: [], events: [] },
    save: (value) => atomic(statePath, Buffer.from(JSON.stringify(value))),
    putImage(bytes) {
      if (!bytes.length || bytes.length > MAX_IMAGE_BYTES)
        throw new Error("Photo exceeds the 20 MB limit.");
      // Container screening, not a full decode/clinical quality gate. Edge must decode before review.
      let mimeType;
      if (
        bytes.length >= 33 &&
        bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
        bytes.subarray(12, 16).toString() === "IHDR" &&
        bytes.subarray(-8, -4).toString() === "IEND"
      )
        mimeType = "image/png";
      else if (
        bytes.length >= 4 &&
        bytes[0] === 255 &&
        bytes[1] === 216 &&
        bytes[2] === 255 &&
        bytes.at(-2) === 255 &&
        bytes.at(-1) === 217
      )
        mimeType = "image/jpeg";
      else
        throw new Error(
          "Use a JPEG or PNG photo. The file could not be recognized.",
        );
      const id = randomUUID(),
        sha256 = createHash("sha256").update(bytes).digest("hex");
      atomic(join(root, id + ".enc"), bytes);
      return {
        id,
        mimeType,
        size: bytes.length,
        sha256,
        receivedAt: new Date().toISOString(),
      };
    },
    readImage: (id) => open(readFileSync(join(root, id + ".enc"))),
    removeImage: (id) => {
      const path = join(root, id + ".enc");
      if (existsSync(path)) unlinkSync(path);
    },
  };
}
