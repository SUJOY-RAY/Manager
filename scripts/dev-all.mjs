// Microservices orchestrator.
// `npm run dev` in the Manager starts the hub AND every game microservice,
// then opens both in the browser — so opening the management project opens
// the sub game(s) too.
//
// Ports (see services.json): hub 5000, space-shooter 5101, real-boxing 5102.

import { spawn } from "node:child_process";
import { exec } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const managerDir = path.resolve(here, "..");
const shooterDir = path.resolve(managerDir, "..", "Space Shooter");
const boxingDir = path.resolve(managerDir, "..", "real-boxing");

const HUB_URL = "http://localhost:5000";
const SHOOTER_URL = "http://localhost:5101";
const BOXING_URL = "http://localhost:5102";

function start(cmd, args, cwd, label) {
  const child = spawn(cmd, args, {
    cwd,
    shell: true,
    stdio: "inherit",
    env: process.env,
  });
  child.on("error", (err) => console.error(`[${label}] failed to start:`, err.message));
  return child;
}

function openBrowser(url) {
  const plat = process.platform;
  const cmd =
    plat === "win32" ? `start "" "${url}"` : plat === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) console.log(`Open manually: ${url}`);
  });
}

console.log("🕹️  Game Manager — starting microservices…");
console.log(`   hub           : ${managerDir} -> ${HUB_URL}`);
console.log(`   space-shooter : ${shooterDir} -> ${SHOOTER_URL}`);
console.log(`   real-boxing   : ${boxingDir} -> ${BOXING_URL}`);

const hub = start("npx", ["vite", "--port", "5000", "--strictPort"], managerDir, "hub");
const shooter = start(
  "npm",
  ["run", "dev", "--", "--port", "5101", "--strictPort"],
  shooterDir,
  "space-shooter"
);
const boxing = start(
  "npm",
  ["run", "dev", "--", "--port", "5102", "--strictPort"],
  boxingDir,
  "real-boxing"
);

setTimeout(() => {
  openBrowser(SHOOTER_URL);
  setTimeout(() => openBrowser(BOXING_URL), 400);
  setTimeout(() => openBrowser(HUB_URL), 800);
}, 2500);

function shutdown() {
  console.log("\nStopping microservices…");
  hub.kill("SIGINT");
  shooter.kill("SIGINT");
  boxing.kill("SIGINT");
  setTimeout(() => process.exit(0), 600);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
