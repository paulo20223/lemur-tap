#!/usr/bin/env node
/**
 * dev:tunnel — single public entry point for app + API over one ngrok tunnel.
 *
 * Flow:
 *   1. Start ngrok against the webapp port (default 5173). The Vite dev server is
 *      the only thing exposed: it serves the app and proxies `/api/*` to the API,
 *      so one tunnel covers both (see apps/webapp/vite.config.ts).
 *   2. Read the public URL from ngrok's local API (127.0.0.1:4040) — works for
 *      both a reserved static domain (NGROK_DOMAIN) and an ephemeral one.
 *   3. Inject that URL as WEBAPP_URL (the bot opens it) + VITE_TUNNEL_HOST (HMR
 *      over wss), then start `pnpm dev` (api + webapp in parallel) as a child.
 *   4. Tear everything down together on Ctrl-C / exit.
 *
 * Config (root .env): NGROK_DOMAIN (optional reserved domain → stable URL),
 * WEBAPP_PORT (default 5173), NGROK_API (default http://127.0.0.1:4040).
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(import.meta.url), '../..');

// Load root .env into process.env (Node >=22). Best-effort.
try {
  process.loadEnvFile(resolve(rootDir, '.env'));
} catch {
  /* no .env — rely on the ambient environment */
}

const PORT = process.env.WEBAPP_PORT || '5173';
const NGROK_API = process.env.NGROK_API || 'http://127.0.0.1:4040';
const DOMAIN = process.env.NGROK_DOMAIN?.trim();

/** Children we spawn; killed together on shutdown. */
const children = [];
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  // Give children a moment to exit, then force-exit.
  setTimeout(() => process.exit(code), 500);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll ngrok's local API until an https public URL appears (or time out). */
async function waitForPublicUrl(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${NGROK_API}/api/tunnels`);
      if (res.ok) {
        const data = await res.json();
        const tunnel =
          data.tunnels?.find((t) => t.public_url?.startsWith('https://')) ??
          data.tunnels?.[0];
        if (tunnel?.public_url) return tunnel.public_url;
      }
    } catch {
      /* ngrok not up yet */
    }
    await sleep(400);
  }
  return null;
}

async function main() {
  // 1. Start ngrok on the webapp port.
  const ngrokArgs = ['http', PORT, '--log', 'stdout', '--log-format', 'logfmt'];
  if (DOMAIN) ngrokArgs.push('--url', DOMAIN);

  console.log(
    `[dev:tunnel] starting ngrok → :${PORT}${DOMAIN ? ` (domain ${DOMAIN})` : ' (ephemeral)'}`,
  );
  const ngrok = spawn('ngrok', ngrokArgs, { stdio: 'ignore' });
  children.push(ngrok);
  ngrok.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`[dev:tunnel] ngrok exited (code ${code}). Shutting down.`);
      shutdown(1);
    }
  });

  // 2. Resolve the public URL.
  const publicUrl = await waitForPublicUrl();
  if (!publicUrl) {
    console.error(
      `[dev:tunnel] could not read ngrok URL from ${NGROK_API}. Is ngrok authed? (ngrok config check)`,
    );
    shutdown(1);
    return;
  }
  const host = new URL(publicUrl).host;
  console.log(`[dev:tunnel] public URL: ${publicUrl}`);
  console.log('[dev:tunnel] → set this domain as the Mini App URL in BotFather.');

  // 3. Start the app + API with the tunnel URL injected.
  const childEnv = {
    ...process.env,
    WEBAPP_URL: publicUrl, // bot opens this in the web_app button
    VITE_TUNNEL_HOST: host, // HMR over wss through the tunnel
  };
  const dev = spawn('pnpm', ['dev'], {
    cwd: rootDir,
    env: childEnv,
    stdio: 'inherit',
  });
  children.push(dev);
  dev.on('exit', (code) => {
    if (!shuttingDown) shutdown(code ?? 0);
  });
}

main().catch((err) => {
  console.error('[dev:tunnel] fatal:', err);
  shutdown(1);
});
