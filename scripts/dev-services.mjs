#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = resolve(rootDir, "services/api");
const condaCommand = process.platform === "win32" ? "conda.bat" : "conda";
const condaEnv = process.env.CONDA_ENV_NAME || "3.14.4";
const port = process.env.API_PORT || "8000";

function run(command, args) {
  return spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function getPortPids() {
  if (process.platform === "win32") return [];

  const result = run("lsof", ["-ti", `TCP:${port}`]);
  if (result.status !== 0 || !result.stdout.trim()) return [];

  return [...new Set(result.stdout.trim().split(/\s+/).map(Number))].filter(
    Number.isInteger,
  );
}

function getCommand(pid) {
  const result = run("ps", ["-p", String(pid), "-o", "command="]);
  return result.status === 0 ? result.stdout.trim() : "";
}

function isSameBackend(command) {
  return (
    command.includes("uvicorn") &&
    command.includes("app.main:app") &&
    command.includes("--port") &&
    command.includes(port)
  );
}

function pidIsRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (!pidIsRunning(pid)) return true;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }

  return !pidIsRunning(pid);
}

async function stopProcess(pid) {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }

  if (await waitForExit(pid, 3000)) return;

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Process already exited.
  }
}

async function freeBackendPort() {
  const pids = getPortPids();
  if (pids.length === 0) return;

  const holders = pids.map((pid) => ({ pid, command: getCommand(pid) }));
  const staleBackends = holders.filter(({ command }) => isSameBackend(command));
  const others = holders.filter(({ command }) => !isSameBackend(command));

  if (others.length > 0) {
    console.error(`[dev:services] port ${port} is already in use:`);
    for (const { pid, command } of others) {
      console.error(`  PID ${pid}: ${command || "(unknown command)"}`);
    }
    console.error("[dev:services] refusing to kill a non-project process");
    process.exit(1);
  }

  for (const { pid } of staleBackends) {
    console.log(`[dev:services] stopping stale backend on port ${port} (PID ${pid})`);
    await stopProcess(pid);
  }
}

function startBackend() {
  const child = spawn(
    condaCommand,
    [
      "run",
      "-n",
      condaEnv,
      "--no-capture-output",
      "uvicorn",
      "app.main:app",
      "--reload",
      "--port",
      port,
    ],
    {
      cwd: apiDir,
      env: process.env,
      stdio: "inherit",
    },
  );

  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));

  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
}

await freeBackendPort();
startBackend();
