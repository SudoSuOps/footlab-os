import { execFileSync } from "node:child_process";
import { mkdirSync, chmodSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

process.umask(0o077);
const home = join(homedir(), "flo-private");
const python = resolve(process.argv[2] ?? join(home, "venv/bin/python"));
const status = JSON.parse(execFileSync("tailscale", ["status", "--json"], { encoding: "utf8", timeout: 10000 }));
if (status.BackendState !== "Running" || !status.Self?.DNSName) throw new Error("Connect defendable to Tailscale first");
const hostname = status.Self.DNSName.replace(/\.$/, "");
if (!/^[a-z0-9.-]+\.ts\.net$/.test(hostname)) throw new Error("Enable Tailscale MagicDNS first");
const origin = `https://${hostname}:8443`;
const serve = JSON.parse(execFileSync("tailscale", ["serve", "status", "--json"], { encoding: "utf8", timeout: 10000 }));
if (Object.keys(serve.Web ?? {}).some((host) => host.endsWith(":8443")))
  throw new Error("Tailscale port 8443 is already configured. Inspect it before assigning FLO");
const decoder = fileURLToPath(new URL("./pilot-image-check.py", import.meta.url));
execFileSync(python, [decoder, "--check"], { stdio: "ignore", timeout: 10000 });
mkdirSync(home, { recursive: true, mode: 0o700 });
chmodSync(home, 0o700);
const configPath = join(home, "config.json");
if (existsSync(configPath)) {
  const previous = JSON.parse(readFileSync(configPath, "utf8"));
  if (previous.origin !== origin || previous.python !== python) throw new Error("Existing pilot configuration differs; inspect before changing it");
} else writeFileSync(configPath, JSON.stringify({ origin, python }) + "\n", { flag: "wx", mode: 0o600 });
const keyPath = join(home, "vault.key");
if (!existsSync(keyPath)) {
  if (existsSync(join(home, "vault"))) throw new Error("Vault exists without its key; restore the original key");
  writeFileSync(keyPath, randomBytes(32), { flag: "wx", mode: 0o600 });
}
const units = join(homedir(), ".config/systemd/user");
mkdirSync(units, { recursive: true, mode: 0o700 });
const servicePath = join(units, "flo-private-pilot.service");
const server = fileURLToPath(new URL("./serve-private-pilot.mjs", import.meta.url));
if (/[\s%"\\]/.test(server + process.execPath)) throw new Error("Use a pilot checkout and Node path without spaces or systemd special characters");
const unit = `[Unit]\nDescription=FLO personal private capture pilot\n\n[Service]\nType=simple\nExecStart=${process.execPath} ${server}\nRestart=on-failure\nRestartSec=3\nUMask=0077\nNoNewPrivileges=true\n\n[Install]\nWantedBy=default.target\n`;
if (existsSync(servicePath) && readFileSync(servicePath, "utf8") !== unit) throw new Error("Existing user service differs; inspect before replacing it");
if (!existsSync(servicePath)) writeFileSync(servicePath, unit, { flag: "wx", mode: 0o600 });
console.log(`Pilot prepared for ${origin}. No SMS sent. Start the user service, then configure Tailscale Serve.`);
