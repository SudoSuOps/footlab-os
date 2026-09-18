import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { extname, join } from "node:path";
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 4174);
const ROOT = process.cwd();
const CLIENT_DIR = join(ROOT, "apps/client-link");

const links = new Map();
const events = [];

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function secureMatch(token, storedHash) {
  const a = Buffer.from(hashToken(token), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

function issueDemoLink() {
  const rawToken = randomBytes(32).toString("base64url");
  const now = new Date();
  const record = {
    requestId: randomUUID(),
    clientId: "F-DEMO-001",
    tokenHash: hashToken(rawToken),
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
    status: "issued",
  };
  links.set(record.tokenHash, record);
  events.push(event(record.clientId, "capture_requested", { requestId: record.requestId }));
  return rawToken;
}

function event(clientId, type, payload = {}) {
  return {
    id: randomUUID(),
    clientId,
    occurredAt: new Date().toISOString(),
    type,
    actor: { type: "system", id: "demo-edge" },
    source: "demo-capture-server",
    payload,
  };
}

function resolve(token) {
  if (!token) return null;
  const hash = hashToken(token);
  const record = links.get(hash);
  if (!record || !secureMatch(token, record.tokenHash)) return null;
  return record;
}

function state(record) {
  if (record.revokedAt) return "revoked";
  if (record.completedAt) return "completed";
  if (Date.now() >= new Date(record.expiresAt).getTime()) return "expired";
  return "valid";
}

function json(res, code, payload) {
  res.writeHead(code, { "Content-Type":"application/json; charset=utf-8", "Cache-Control":"no-store" });
  res.end(JSON.stringify(payload));
}

async function body(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error("Request too large");
  }
  return raw ? JSON.parse(raw) : {};
}

function serveFile(res, path) {
  if (!existsSync(path)) return json(res, 404, { error:"Not found" });
  const type = {".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8"}[extname(path)] ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type":type, "Cache-Control":"no-store" });
  createReadStream(path).pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/client/app.js") return serveFile(res, join(CLIENT_DIR, "app.js"));
    if (req.method === "GET" && url.pathname === "/client/styles.css") return serveFile(res, join(CLIENT_DIR, "styles.css"));
    if (req.method === "GET" && url.pathname.startsWith("/s/")) {
      const token = url.pathname.slice(3);
      const record = resolve(token);
      if (record) events.push(event(record.clientId, "capture_link_opened", { requestId: record.requestId }));
      return serveFile(res, join(CLIENT_DIR, "index.html"));
    }

    const match = url.pathname.match(/^\/api\/capture\/([^/]+)(?:\/(start|complete))?$/);
    if (match) {
      const token = decodeURIComponent(match[1]);
      const action = match[2];
      const record = resolve(token);
      if (!record) return json(res, 404, { error:"Capture link not found" });

      const linkState = state(record);
      if (req.method === "GET" && !action) {
        return json(res, 200, { state:linkState, expiresAt:record.expiresAt });
      }

      if (linkState !== "valid") return json(res, 410, { error:`Capture link is ${linkState}` });

      if (req.method === "POST" && action === "start") {
        if (!record.startedAt) {
          record.startedAt = new Date().toISOString();
          events.push(event(record.clientId, "capture_started", { requestId:record.requestId }));
        }
        return json(res, 200, { ok:true });
      }

      if (req.method === "POST" && action === "complete") {
        if (!record.startedAt) return json(res, 409, { error:"Start the check-in before submitting" });
        const payload = await body(req);
        if (!Array.isArray(payload.captures) || payload.captures.length !== 4) {
          return json(res, 400, { error:"Four capture records are required" });
        }
        record.completedAt = new Date().toISOString();
        events.push(event(record.clientId, "capture_completed", {
          requestId:record.requestId,
          captureCount:payload.captures.length,
          checkIn:payload.checkIn ?? {},
          demoOnly: true,
        }));
        return json(res, 200, { ok:true });
      }
    }

    if (req.method === "GET" && url.pathname === "/api/demo/events") {
      return json(res, 200, { events });
    }

    return json(res, 404, { error:"Not found" });
  } catch (error) {
    console.error(error);
    return json(res, 500, { error:"Internal server error" });
  }
});

const token = issueDemoLink();
server.listen(PORT, () => {
  console.log("");
  console.log("FootLabOS capture demo");
  console.log("----------------------");
  console.log(`Open: http://localhost:${PORT}/s/${token}`);
  console.log(`Events: http://localhost:${PORT}/api/demo/events`);
  console.log("");
  console.log("For a phone on the same LAN, replace localhost with this machine's LAN IP.");
  console.log("Demo note: selected image bytes remain in the browser; only metadata is submitted.");
});
