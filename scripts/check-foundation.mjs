import { existsSync, readFileSync } from "node:fs";

const required = [
  "README.md",
  "PHILOSOPHY.md",
  "docs/architecture/SYSTEM_ARCHITECTURE.md",
  "docs/architecture/EDGE_APPLIANCE_SPEC.md",
  "docs/product/FLIGHT_SHEET_SPEC.md",
  "docs/safety/BOUNDARIES.md",
  "docs/pilot/PILOT_V1.md",
  "packages/domain/src/index.ts",
  "packages/flight-engine/src/index.ts",
  "packages/edge-contracts/src/index.ts"
];

for (const path of required) {
  if (!existsSync(path)) throw new Error(`Missing foundation file: ${path}`);
}

const readme = readFileSync("README.md", "utf8");
for (const phrase of ["Local-first", "Human-in-the-loop", "Manufacturing is in the loop"]) {
  if (!readme.includes(phrase)) throw new Error(`README missing doctrine: ${phrase}`);
}

console.log(`FootLabOS foundation check passed (${required.length} required files).`);
