import { pathToFileURL, fileURLToPath } from "node:url";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { extname, join } from "node:path";
import { createServer } from "node:http";
import { openLocalVault } from "../packages/capture-links/src/local-vault.mjs";
import {
  PROTOCOL_ID,
  CAPTURE_STEPS,
  ALL_SLOTS,
  MAX_IMAGE_BYTES,
  validateCompletion,
} from "../packages/capture-links/src/protocol.mjs";

const CLIENT_DIR = fileURLToPath(
  new URL("../apps/client-link/", import.meta.url),
);
const hashToken = (token) => createHash("sha256").update(token).digest("hex");
const failure = (status, message) =>
  Object.assign(new Error(message), { status });
export function createCaptureDemo({
  vaultDir = join(process.cwd(), ".flo-local-vault"),
  keyPath,
  pilotOrigin,
  validateImage,
} = {}) {
  if (pilotOrigin && !/^https:\/\/[a-z0-9.-]+\.ts\.net(?::\d+)?$/.test(pilotOrigin))
    throw new Error("Private pilot requires an HTTPS Tailscale origin");
  if (pilotOrigin && !keyPath) throw new Error("Private pilot requires a separate vault key");
  const vault = openLocalVault(vaultDir, { keyPath }),
    saved = vault.load(),
    links = new Map(saved.links.map((r) => [r.tokenHash, r])),
    events = saved.events;
  const persist = () => vault.save({ links: [...links.values()], events });
  const state = (r) =>
    r.revokedAt
      ? "revoked"
      : r.completedAt
        ? "completed"
        : Date.now() >= Date.parse(r.expiresAt)
          ? "expired"
          : "valid";
  function event(record, type, payload = {}) {
    events.push({
      id: randomUUID(),
      clientId: record.clientId,
      occurredAt: new Date().toISOString(),
      type,
      source: pilotOrigin ? "private-personal-pilot" : "local-capture-prototype",
      payload,
    });
  }
  function issueDemoLink() {
    if (pilotOrigin && links.size >= 32) throw new Error("Pilot session limit reached; archive the vault before issuing more links");
    const token = randomBytes(32).toString("base64url"),
      now = new Date();
    const record = {
      requestId: randomUUID(),
      clientId: pilotOrigin ? "F-PERSONAL-001" : "F-DEMO-001",
      tokenHash: hashToken(token),
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 3600000).toISOString(),
      protocolId: PROTOCOL_ID,
      uploads: {},
    };
    links.set(record.tokenHash, record);
    event(record, "capture_requested");
    try { persist(); } catch (error) { links.delete(record.tokenHash); events.pop(); throw error; }
    return token;
  }
  function revokeLink(token) {
    const record = links.get(hashToken(token));
    if (!record || record.completedAt) throw new Error("Cannot revoke this link");
    const previous = record.revokedAt;
    record.revokedAt = new Date().toISOString();
    try { persist(); } catch (error) { record.revokedAt = previous; throw error; }
  }
  function recordDelivery(token, delivery) {
    const record = links.get(hashToken(token));
    if (!record || !/^SM[0-9a-f]{32}$/i.test(delivery.sid ?? "") || !["accepted", "queued", "sending", "sent", "delivered"].includes(delivery.status))
      throw new Error("Invalid delivery record");
    const previous = record.delivery;
    record.delivery = { sid: delivery.sid, status: delivery.status, recordedAt: new Date().toISOString() };
    try { persist(); } catch (error) { record.delivery = previous; throw error; }
  }
  function listSessions() {
    return [...links.values()].map((r) => ({ requestId: r.requestId, state: state(r), issuedAt: r.issuedAt, photoCount: Object.keys(r.uploads).length, receipt: r.receipt ?? null, delivery: r.delivery ?? null }));
  }
  function json(res, status, payload) {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(payload));
  }
  async function body(req, limit) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) throw failure(413, "Photo or request is too large.");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  async function jsonBody(req) {
    if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] ?? ""))
      throw failure(415, "JSON required");
    const bytes = await body(req, 16384);
    try {
      return JSON.parse(bytes.toString());
    } catch {
      throw failure(400, "Invalid JSON");
    }
  }
  function serveFile(res, path) {
    if (!existsSync(path)) return json(res, 404, { error: "Not found" });
    res.writeHead(200, {
      "Content-Type": {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
      }[extname(path)],
      "Cache-Control": "no-store",
    });
    createReadStream(path).pipe(res);
  }
  let requestWindow = Date.now(), requestCount = 0;
  const server = createServer(async (req, res) => {
    try {
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      );
      const url = new URL(req.url, "http://localhost");
      if (pilotOrigin) {
        if (Date.now() - requestWindow > 60000) { requestWindow = Date.now(); requestCount = 0; }
        if (++requestCount > 240) { res.setHeader("Retry-After", "60"); throw failure(429, "Please wait a minute before retrying"); }
        if (req.headers.host !== new URL(pilotOrigin).host && req.headers.host !== "127.0.0.1:4175")
          throw failure(403, "Unknown host");
        if (!["GET", "HEAD"].includes(req.method) && req.headers.origin !== pilotOrigin)
          throw failure(403, "Use your FLO link to make this request");
      }
      if (req.method === "GET" && url.pathname === "/healthz")
        return json(res, 200, { ok: true, protocolId: PROTOCOL_ID, mode: pilotOrigin ? "private-pilot" : "demo" });
      if (
        req.method === "GET" &&
        ["/client/app.js", "/client/styles.css"].includes(url.pathname)
      )
        return serveFile(res, join(CLIENT_DIR, url.pathname.split("/").at(-1)));
      if (req.method === "GET" && url.pathname === "/client/protocol.mjs")
        return serveFile(
          res,
          fileURLToPath(
            new URL(
              "../packages/capture-links/src/protocol.mjs",
              import.meta.url,
            ),
          ),
        );
      if (req.method === "GET" && /^\/c\/[^/]+$/.test(url.pathname))
        return serveFile(res, join(CLIENT_DIR, "index.html"));
      const match = url.pathname.match(
        /^\/api\/capture\/([^/]+)(?:\/(start|complete|photos)(?:\/([^/]+))?)?$/,
      );
      if (!match) return json(res, 404, { error: "Not found" });
      const [, token, action, slot] = match,
        record = links.get(hashToken(token));
      if (!record) return json(res, 404, { error: "Check-in link not found" });
      if (req.method === "GET" && !action)
        return json(res, 200, {
          state: state(record),
          expiresAt: record.expiresAt,
          protocolId: record.protocolId,
          steps: CAPTURE_STEPS,
          uploads: record.uploads,
          receipt: record.receipt ?? null,
          localPrototype: !pilotOrigin,
          privatePilot: Boolean(pilotOrigin),
        });
      if (req.method !== "GET" && req.headers["x-flo-request"] !== "1")
        throw failure(403, "FLO request header required");
      if (
        action === "complete" &&
        req.method === "POST" &&
        record.completedAt
      ) {
        const raw = await jsonBody(req);
        let completion;
        try {
          completion = validateCompletion(raw, record.uploads);
        } catch (error) {
          throw failure(400, error.message);
        }
        if (JSON.stringify(completion) !== record.completionKey)
          throw failure(409, "This check-in was already submitted.");
        return json(res, 200, { ok: true, receipt: record.receipt });
      }
      if (state(record) !== "valid")
        return json(res, 410, { error: `This check-in is ${state(record)}.` });
      // Browsers send Origin on mutations. A custom header also blocks simple cross-site forms.
      if (req.method === "POST" && action === "start") {
        await jsonBody(req);
        if (state(record) !== "valid")
          throw failure(410, "This check-in is no longer available.");
        if (!record.startedAt) {
          record.startedAt = new Date().toISOString();
          event(record, "capture_started");
          try {
            persist();
          } catch (error) {
            events.pop();
            delete record.startedAt;
            throw error;
          }
        }
        return json(res, 200, { ok: true });
      }
      if (!record.startedAt) throw failure(409, "Start your check-in first.");
      if (action === "photos" && ALL_SLOTS.includes(slot)) {
        if (req.method === "GET") {
          const photo = record.uploads[slot];
          if (!photo) throw failure(404, "Photo not found");
          res.writeHead(200, { "Content-Type": photo.mimeType });
          return res.end(vault.readImage(photo.id));
        }
        if (req.method === "PUT") {
          const bytes = await body(req, MAX_IMAGE_BYTES);
          if (validateImage) {
            try { await validateImage(bytes); }
            catch { throw failure(400, "Photo could not be decoded. Choose a JPEG or PNG and retry."); }
          }
          if (state(record) !== "valid")
            throw failure(410, "This check-in is no longer available.");
          let photo;
          try {
            photo = vault.putImage(bytes);
          } catch (error) {
            throw failure(400, error.message);
          }
          const previous = record.uploads[slot];
          record.uploads[slot] = photo;
          try {
            persist();
          } catch (error) {
            if (previous) record.uploads[slot] = previous;
            else delete record.uploads[slot];
            vault.removeImage(photo.id);
            throw error;
          }
          if (previous) vault.removeImage(previous.id);
          return json(res, 200, { ok: true, photo });
        }
        if (req.method === "DELETE") {
          const previous = record.uploads[slot];
          delete record.uploads[slot];
          try {
            persist();
          } catch (error) {
            if (previous) record.uploads[slot] = previous;
            throw error;
          }
          if (previous) vault.removeImage(previous.id);
          return json(res, 200, { ok: true });
        }
      }
      if (req.method === "POST" && action === "complete") {
        const raw = await jsonBody(req);
        let completion;
        try {
          completion = validateCompletion(raw, record.uploads);
        } catch (error) {
          throw failure(400, error.message);
        }
        if (record.completedAt) {
          if (JSON.stringify(completion) !== record.completionKey)
            throw failure(409, "This check-in was already submitted.");
          return json(res, 200, { ok: true, receipt: record.receipt });
        }
        if (state(record) !== "valid")
          throw failure(410, "This check-in is no longer available.");
        record.completedAt = new Date().toISOString();
        record.completionKey = JSON.stringify(completion);
        record.receipt = {
          requestId: record.requestId,
          receivedAt: record.completedAt,
          photoCount: completion.slots.length,
          protocolId: PROTOCOL_ID,
        };
        record.checkIn = completion.checkIn;
        event(record, "capture_completed", {
          ...record.receipt,
          localPrototype: !pilotOrigin,
          privatePilot: Boolean(pilotOrigin),
        });
        try {
          persist();
        } catch (error) {
          events.pop();
          delete record.completedAt;
          delete record.completionKey;
          delete record.receipt;
          delete record.checkIn;
          throw error;
        }
        return json(res, 200, { ok: true, receipt: record.receipt });
      }
      return json(res, 405, { error: "Method or photo slot not supported" });
    } catch (error) {
      return json(res, error.status ?? 500, {
        error: error.status
          ? error.message
          : "Could not save this check-in. Please retry.",
      });
    }
  });
  server.requestTimeout = 120000;
  server.headersTimeout = 15000;
  return { server, issueDemoLink, revokeLink, recordDelivery, listSessions, events };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { server, issueDemoLink } = createCaptureDemo({
    vaultDir:
      process.env.FLO_VAULT_DIR ?? join(process.cwd(), ".flo-local-vault"),
  });
  const token = issueDemoLink(),
    host = process.env.HOST ?? "127.0.0.1",
    port = Number(process.env.PORT ?? 4174);
  server.listen(port, host, () => {
    console.log(`FLO time: http://${host}:${port}/c/${token}`);
    console.log(
      "Personal local upload prototype. Synthetic test photos only; not connected to clinical review or live SMS.",
    );
  });
}
