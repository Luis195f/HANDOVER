#!/usr/bin/env node
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const portIdx = args.indexOf("--port");
const port = portIdx >= 0 ? Number(args[portIdx + 1]) : Number(process.env.E2E_PORT ?? 19006);
const baseURL = `http://127.0.0.1:${port}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url) {
  const res = await fetch(url, { redirect: "follow" });
  const text = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, text };
}

function extractBundlePath(html) {
  // Busca el script típico de Expo: /index.ts.bundle?platform=web&dev=false...
  const m = html.match(/<script\s+src="([^"]*index\.ts\.bundle[^"]*)"/i);
  return m?.[1] || null;
}

async function waitForReady(timeoutMs = 150_000) {
  const startedAt = Date.now();
  let lastErr = "";

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const root = await fetchText(`${baseURL}/`);
      if (!root.ok) {
        lastErr = `GET / => ${root.status}`;
        await sleep(750);
        continue;
      }

      const bundlePath = extractBundlePath(root.text);
      if (!bundlePath) {
        // Aún no insertó el script (o algo raro en HTML)
        lastErr = `No bundle script found in HTML (len=${root.text.length})`;
        await sleep(750);
        continue;
      }

      const bundleUrl = bundlePath.startsWith("http") ? bundlePath : `${baseURL}${bundlePath}`;
      const bundle = await fetchText(bundleUrl);

      if (bundle.ok && bundle.text && bundle.text.length > 500) {
        // READY: Expo sirve HTML + bundle real
        console.log(`[e2e-webserver] READY ${baseURL}`);
        return;
      }

      lastErr = `GET bundle => ${bundle.status}, len=${bundle.text?.length ?? 0}`;
      await sleep(750);
    } catch (e) {
      lastErr = String(e?.message || e);
      await sleep(750);
    }
  }

  throw new Error(`[e2e-webserver] Timed out waiting for Expo web + bundle. Last: ${lastErr}`);
}

function startExpo() {
  // En monorepo, SIEMPRE es mejor targetear el workspace app:
  // Ajusta el filtro si tu app tiene otro nombre.
  //
  // Opción A (recomendada): si tu app se llama "handover-pro" en package.json:
  // const cmd = ["pnpm", ["--filter", "handover-pro", "web", "--", "--no-dev", "--minify", "--port", String(port), "--host", "127.0.0.1"]];
  //
  // Opción B: si el script web está en apps/mobile o apps/app:
  // cambia el --filter.

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
    "127.0.0.1",
  ];

  console.log(`[e2e-webserver] Starting Expo web on ${baseURL} (filter=${filterName})`);
  const child = spawn("pnpm", pnpmArgs, {
    stdio: "inherit",
    env: {
      ...process.env,
      EXPO_PUBLIC_E2E: "true",
      EXPO_NO_TELEMETRY: "1",
      CI: process.env.CI ? "1" : process.env.CI,
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

  // Si Expo muere antes de estar listo, cortamos aquí.
  child.on("exit", (code) => {
    if (code !== 0) {
      console.error(`[e2e-webserver] Expo process exited with code ${code}`);
      process.exit(code ?? 1);
    }
  });

  await waitForReady(170_000);

  // Mantén el proceso vivo mientras Playwright corre.
  // Playwright gestiona el lifecycle del webServer.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await sleep(10_000);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
