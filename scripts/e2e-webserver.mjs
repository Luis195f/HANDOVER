#!/usr/bin/env node
import { spawn } from "node:child_process";

// This helper script wraps "pnpm --filter <app> web" to start Expo for web in CI.
// It blocks until the web server is actually ready to serve a compiled JS bundle.
// Without this check Playwright may begin before the bundle is built and
// hydration will fail, leaving #root empty. The script polls the root HTML
// for any <script src="..."></script> tag and then fetches the script to
// ensure it returns real JS. Only then does it signal readiness.

const args = process.argv.slice(2);
const portIdx = args.indexOf("--port");
const port = portIdx >= 0 ? Number(args[portIdx + 1]) : Number(process.env.E2E_PORT ?? 19006);
const baseURL = `http://127.0.0.1:${port}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url) {
  const res = await fetch(url, { redirect: "follow" });
  const text = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, text, url: res.url };
}

function extractScriptSrcs(html) {
  const out = [];
  const re = /<script\s+[^>]*src="([^"]+)"[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    out.push(m[1]);
  }
  return out.filter((s) => typeof s === "string" && s.length > 0);
}

function toAbsolute(urlOrPath) {
  if (urlOrPath.startsWith("http://") || urlOrPath.startsWith("https://")) return urlOrPath;
  if (urlOrPath.startsWith("/")) return `${baseURL}${urlOrPath}`;
  return `${baseURL}/${urlOrPath}`;
}

async function waitForReady(timeoutMs = 180_000) {
  const startedAt = Date.now();
  let lastErr = "";

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const root = await fetchText(`${baseURL}/`);
      if (!root.ok) {
        lastErr = `GET / => ${root.status}`;
        await sleep(800);
        continue;
      }

      const scriptSrcs = extractScriptSrcs(root.text);
      if (!scriptSrcs.length) {
        lastErr = `No <script src="..."> found in HTML (len=${root.text.length})`;
        await sleep(800);
        continue;
      }

      let anyOk = false;
      let bestInfo = "";
      for (const src of scriptSrcs) {
        const abs = toAbsolute(src);
        const r = await fetchText(abs);
        if (r.ok && r.text && r.text.length > 800) {
          anyOk = true;
          break;
        }
        bestInfo = `script ${abs} => ${r.status}, len=${r.text?.length ?? 0}`;
      }
      if (anyOk) {
        console.log(`[e2e-webserver] READY ${baseURL}`);
        return;
      }
      lastErr = bestInfo || "Scripts found but none OK enough";
      await sleep(800);
    } catch (e) {
      lastErr = String(e?.message || e);
      await sleep(800);
    }
  }
  throw new Error(`[e2e-webserver] Timed out waiting for Expo web + runnable script. Last: ${lastErr}`);
}

function startExpo() {
  const filterName = process.env.E2E_APP_FILTER || "handover-pro";
  const pnpmArgs = [
    "--filter",
    filterName,
    "web",
    "--",
    "--no-dev",
    "--minify",
    "--port",
    String(port),
    "--host",
    "localhost",
  ];

  console.log(`[e2e-webserver] Starting Expo web on ${baseURL} (filter=${filterName})`);
  const child = spawn("pnpm", pnpmArgs, {
    stdio: "inherit",
    env: {
      ...process.env,
      EXPO_PUBLIC_E2E: "true",
      EXPO_NO_TELEMETRY: "1",
      CI: process.env.CI ? "1" : process.env.CI,
      E2E_PORT: String(port),
    },
  });

  const shutdown = () => {
    if (!child.killed) child.kill("SIGTERM");
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("exit", shutdown);
  return child;
}

(async () => {
  const child = startExpo();
  child.on("exit", (code) => {
    if (code !== 0) {
      console.error(`[e2e-webserver] Expo process exited with code ${code}`);
      process.exit(code ?? 1);
    }
  });
  await waitForReady(180_000);
  // Keep the process alive while Playwright runs.
  while (true) {
    await sleep(10_000);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
