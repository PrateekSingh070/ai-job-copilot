import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawnSync } from "node:child_process";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, "utf8");
  const out = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    out[key] = value;
  }
  return out;
}

function parseDatabaseUrl(databaseUrl) {
  try {
    const url = new URL(databaseUrl);
    return {
      host: url.hostname,
      port: Number(url.port || "5432"),
      protocol: url.protocol,
      database: url.pathname.replace(/^\//, "") || "(unknown)",
    };
  } catch {
    return null;
  }
}

function checkDocker() {
  const result = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    return {
      ok: false,
      message: "Docker engine not reachable. Start Docker Desktop if you use docker-compose for Postgres.",
    };
  }
  return { ok: true, message: `Docker server reachable (v${result.stdout.trim() || "unknown"}).` };
}

function checkTcp(host, port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish({ ok: true }));
    socket.once("timeout", () => finish({ ok: false, reason: "timeout" }));
    socket.once("error", (err) => finish({ ok: false, reason: err.code || err.message }));
    socket.connect(port, host);
  });
}

async function main() {
  const root = process.cwd();
  const rootEnv = loadEnvFile(path.join(root, ".env"));
  const serverEnv = loadEnvFile(path.join(root, "server", ".env"));
  // Prefer repo env files over inherited shell values to avoid stale session overrides.
  const mergedEnv = { ...process.env, ...rootEnv, ...serverEnv };

  const checks = [];
  const docker = checkDocker();
  checks.push({ name: "Docker", ...docker });

  const databaseUrl = mergedEnv.DATABASE_URL;
  if (!databaseUrl) {
    checks.push({
      name: "DATABASE_URL",
      ok: false,
      message: "DATABASE_URL is missing. Set it in .env before running E2E.",
    });
  } else {
    const parsed = parseDatabaseUrl(databaseUrl);
    if (!parsed) {
      checks.push({
        name: "DATABASE_URL",
        ok: false,
        message: "DATABASE_URL is not a valid URL.",
      });
    } else {
      const tcp = await checkTcp(parsed.host, parsed.port);
      checks.push({
        name: "Postgres TCP",
        ok: tcp.ok,
        message: tcp.ok
          ? `Postgres port reachable at ${parsed.host}:${parsed.port} (db: ${parsed.database}).`
          : `Cannot connect to ${parsed.host}:${parsed.port} (${tcp.reason}).`,
      });
      checks.push({
        name: "Postgres URL protocol",
        ok: parsed.protocol.startsWith("postgres"),
        message: `Protocol is ${parsed.protocol || "(none)"}.`,
      });
    }
  }

  const failed = checks.filter((item) => !item.ok);
  for (const check of checks) {
    const icon = check.ok ? "PASS" : "FAIL";
    // eslint-disable-next-line no-console
    console.log(`[${icon}] ${check.name}: ${check.message}`);
  }

  if (failed.length > 0) {
    // eslint-disable-next-line no-console
    console.log("\nE2E doctor found blockers. Resolve failures above, then run `npm run test:e2e`.");
    process.exitCode = 1;
    return;
  }
  // eslint-disable-next-line no-console
  console.log("\nE2E doctor checks passed. Safe to run `npm run test:e2e`.");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("E2E doctor crashed:", err);
  process.exitCode = 1;
});
