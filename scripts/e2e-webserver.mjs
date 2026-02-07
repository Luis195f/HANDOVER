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
  return { ok: res.ok, status: res.status, text, url: res.url };
}

function extractScriptSrcs(html) {
  // Extrae TODOS los <script src="..."> del HTML (no solo index.ts.bundle)
  const out = [];
  const re = /<script\s+[^>]*src="([^"]+)"[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    out.push(m[1]);
  }
  // Filtra cosas inútiles (si existieran)
  return out.filter((s) => typeof s === "string" && s.length > 0);
}

function toAbsolute(urlOrPath) {
  if (urlOrPath.startsWith("http://") || urlOrPath.startsWith("https://")) return urlOrPath;
  if (urlOrPath.startsWith("/")) return `${baseURL}${urlOrPath}`;
  // relativo
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

      // Si por algún motivo aún no aparecen scripts en el HTML, espera.
      if (!scriptSrcs.length) {
        lastErr = `No <script src="..."> found in HTML (len=${root.text.length})`;
        await sleep(800);
        continue;
      }

      // Probamos scripts en orden. Consideramos READY cuando al menos 1 devuelve 200 y “tiene cuerpo”.
      let anyOk = false;
      let bestInfo = "";

      for (const src of scriptSrcs) {
        const abs = toAbsolute(src);
        const r = await fetchText(abs);

        // Un bundle/minified JS real suele tener bastante más que 500 chars.
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

      lastErr = bestInfo || `Scripts found but none OK enough`;
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

  // Expo espera --host en {lan|tunnel|localhost}
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

  // Mantén vivo el proceso mientras Playwright corre
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await sleep(10_000);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
