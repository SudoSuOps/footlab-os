import { createConnection } from "node:net";
export function pilotControl(socketPath, command) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let response = "";
    socket.setTimeout(10000, () => socket.destroy(new Error("Pilot control timed out")));
    socket.on("error", reject);
    socket.on("connect", () => socket.end(JSON.stringify(command) + "\n"));
    socket.on("data", (chunk) => { response += chunk; if (response.length > 65536) socket.destroy(new Error("Invalid control response")); });
    socket.on("end", () => {
      try { const result = JSON.parse(response); if (result.error) throw new Error(result.error); resolve(result); }
      catch (error) { reject(error); }
    });
  });
}
