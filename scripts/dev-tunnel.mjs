#!/usr/bin/env node
/**
 * dev:tunnel — single public entry point for app + API over one static
 * Cloudflare Tunnel (cloudflared).
 *
 * Flow:
 *   1. Run a named cloudflared tunnel against the webapp port (default 5173).
 *      The Vite dev server is the only thing exposed: it serves the app and
 *      proxies `/api/*` to the API, so one tunnel covers both (see
 *      apps/webapp/vite.config.ts). `--url http://localhost:<port>` is the
 *      tunnel's single ingress origin.
 *   2. The public URL is STATIC — the named tunnel's hostname (CF_TUNNEL_HOSTNAME)
 *      is bound to a CNAME once (`cloudflared tunnel route dns <name> <host>`),
 *      so it survives restarts. No URL discovery needed (unlike ngrok).
 *   3. Inject that URL as WEBAPP_URL (the bot opens it) + VITE_TUNNEL_HOST (HMR
 *      over wss), then start `pnpm dev` (api + webapp in parallel) as a child.
 *   4. Tear everything down together on Ctrl-C / exit.
 *
 * One-time setup (already done; here for reference):
 *   cloudflared tunnel login
 *   cloudflared tunnel create <CF_TUNNEL_NAME>
 *   cloudflared tunnel route dns <CF_TUNNEL_NAME> <CF_TUNNEL_HOSTNAME>
 *   → set https://<CF_TUNNEL_HOSTNAME> as the Mini App URL in BotFather.
 *
 * Config (root .env): CF_TUNNEL_NAME (named tunnel), CF_TUNNEL_HOSTNAME (the
 * routed hostname → stable public URL), WEBAPP_PORT (default 5173).
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
const TUNNEL_NAME = process.env.CF_TUNNEL_NAME?.trim() || 'lemur-dev';
const HOSTNAME = process.env.CF_TUNNEL_HOSTNAME?.trim();

if (!HOSTNAME) {
  console.error(
    '[dev:tunnel] CF_TUNNEL_HOSTNAME is not set in .env — cannot resolve the public URL.',
  );
  process.exit(1);
}

const publicUrl = `https://${HOSTNAME}`;

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

async function main() {
  // 1. Start the named cloudflared tunnel → webapp port.
  console.log(
    `[dev:tunnel] starting cloudflared tunnel "${TUNNEL_NAME}" → :${PORT} (${publicUrl})`,
  );
  const cloudflared = spawn(
    'cloudflared',
    ['tunnel', '--url', `http://localhost:${PORT}`, 'run', TUNNEL_NAME],
    { stdio: 'inherit' },
  );
  children.push(cloudflared);
  cloudflared.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(
        `[dev:tunnel] cloudflared exited (code ${code}). Is it installed and is "${TUNNEL_NAME}" created? Shutting down.`,
      );
      shutdown(1);
    }
  });

  console.log(`[dev:tunnel] public URL: ${publicUrl}`);
  console.log('[dev:tunnel] → must match the Mini App URL set in BotFather.');

  // 2. Start the app + API with the tunnel URL injected.
  const childEnv = {
    ...process.env,
    WEBAPP_URL: publicUrl, // bot opens this in the web_app button
    VITE_TUNNEL_HOST: HOSTNAME, // HMR over wss through the tunnel
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
