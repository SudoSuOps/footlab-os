import { join } from "node:path";
import { homedir } from "node:os";
import { pilotControl } from "./pilot-control.mjs";
const socket = join(process.env.FLO_PILOT_HOME ?? join(homedir(), "flo-private"), "control.sock");
console.log(JSON.stringify(await pilotControl(socket, { action: "list" }), null, 2));
