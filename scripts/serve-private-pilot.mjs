import { createServer } from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, chmodSync, existsSync, lstatSync, unlinkSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { createCaptureDemo } from "./demo-capture-server.mjs";
import { pilotControl } from "./pilot-control.mjs";

process.umask(0o077);
const home = process.env.FLO_PILOT_HOME ?? join(homedir(), "flo-private");
const config = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
const origin = config.origin;
const keyPath = resolve(join(home, "vault.key"));
const vaultDir = resolve(join(home, "vault"));
const socketPath = join(home, "control.sock");
const python = config.python;
if (typeof python !== "string" || !python.startsWith("/")) throw new Error("Configure an absolute decoder Python path");
mkdirSync(home, { recursive: true, mode: 0o700 });
chmodSync(home, 0o700);
const decoder = fileURLToPath(new URL("./pilot-image-check.py", import.meta.url));
if (spawnSync(python, [decoder, "--check"], { stdio: "ignore", timeout: 10000 }).status !== 0)
  throw new Error("Install Pillow in the pilot Python environment first");
if (existsSync(socketPath)) {
  if (!lstatSync(socketPath).isSocket()) throw new Error("Control socket path is occupied");
  try { await pilotControl(socketPath, { action: "health" }); throw new Error("Pilot is already running"); }
  catch (error) { if (error.code !== "ECONNREFUSED") throw error; unlinkSync(socketPath); }
}
let decoders = 0;
function validateImage(bytes) {
  if (decoders >= 2) return Promise.reject(new Error("Decoder busy"));
  decoders++;
  return new Promise((resolveCheck, reject) => {
    const child = spawn(python, [decoder], { stdio: ["pipe", "ignore", "ignore"] });
    const timer = setTimeout(() => child.kill("SIGKILL"), 20000);
    child.stdin.on("error", () => {});
    child.on("error", reject);
    child.on("close", (code) => { clearTimeout(timer); decoders--; code === 0 ? resolveCheck() : reject(new Error("Invalid photo")); });
    child.stdin.end(bytes);
  });
}
const capture = createCaptureDemo({ vaultDir, keyPath, pilotOrigin: origin, validateImage });
capture.server.maxConnections = 8;
capture.server.setTimeout(30000);
const control = createServer({ allowHalfOpen: true }, (socket) => {
  let raw = "";
  socket.setTimeout(10000, () => socket.destroy());
  socket.on("error", () => {});
  socket.on("data", (chunk) => { raw += chunk; if (raw.length > 4096) socket.destroy(); });
  socket.on("end", () => {
    try {
      const command = JSON.parse(raw);
      let response;
      if (command.action === "health") response = { ok: true, origin, mode: "private-pilot" };
      else if (command.action === "issue") response = { token: capture.issueDemoLink(), origin };
      else if (command.action === "revoke" && /^[\w-]{43}$/.test(command.token)) { capture.revokeLink(command.token); response = { ok: true }; }
      else if (command.action === "delivery" && /^[\w-]{43}$/.test(command.token)) { capture.recordDelivery(command.token, command.delivery); response = { ok: true }; }
      else if (command.action === "list") response = { sessions: capture.listSessions() };
      else throw new Error("Unsupported command");
      socket.end(JSON.stringify(response));
    } catch { socket.end(JSON.stringify({ error: "Pilot command failed" })); }
  });
});
await new Promise((resolveReady, reject) => {
  capture.server.once("error", reject);
  capture.server.listen(4175, "127.0.0.1", resolveReady);
});
control.on("error", (error) => { console.error("Control service failed:", error.code); capture.server.close(); process.exitCode = 1; });
control.listen(socketPath, () => { chmodSync(socketPath, 0o600); console.log("FLO private pilot ready on 127.0.0.1:4175. No links or photos are logged."); });
function stop() { control.close(); capture.server.close(); setTimeout(() => process.exit(), 1500).unref(); }
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
