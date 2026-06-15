import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Vite config for the Lemur Tap webapp (Telegram Mini App).
//
// Single entry point: the Vite dev server is the only origin exposed publicly.
// It serves the webapp AND proxies `/api/*` to the NestJS API on :3000, so the
// client talks to the API on the SAME origin (relative `/api/v1` paths). One
// ngrok tunnel on this port therefore covers both app and API.
//
// VITE_API_BASE defaults to '' (same origin via the proxy below). Set it only to
// point the client at a different API host (e.g. a standalone backend).
// Env is read from the monorepo root .env (cwd is apps/webapp when running dev).
export default defineConfig(({ mode }) => {
  const envDir = resolve(process.cwd(), '../..');
  const env = loadEnv(mode, envDir, '');
  // Empty => same origin: the client builds relative `/api/v1/...` URLs and the
  // proxy below forwards them to the API. The tunnel needs no separate API host.
  const apiBase = env.VITE_API_BASE || '';
  const apiTarget = env.API_PROXY_TARGET || 'http://localhost:3000';
  // Set by the dev:tunnel orchestrator so HMR's websocket reaches the page over
  // the https tunnel (wss on :443) instead of the local ws://host:5173.
  const tunnelHost = env.VITE_TUNNEL_HOST;

  return {
    plugins: [react()],
    envDir,
    define: {
      // Expose a stable build-time default; runtime still prefers import.meta.env.
      __API_BASE__: JSON.stringify(apiBase),
    },
    server: {
      host: true,
      port: 5173,
      // Hosts allowed to reach the dev server through a tunnel.
      // Static cloudflared tunnel (dev-tap.connect24.life) + Cloudflare quick
      // tunnels + ngrok (free, paid, and legacy domains).
      allowedHosts: [
        '.connect24.life',
        '.trycloudflare.com',
        '.ngrok-free.app',
        '.ngrok-free.dev',
        '.ngrok.app',
        '.ngrok.io',
      ],
      // Same-origin API: forward `/api/*` to the NestJS server (prefix /api/v1).
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
      // When tunneled, the page loads over https://<host>; point HMR at wss://<host>:443.
      hmr: tunnelHost
        ? { protocol: 'wss', host: tunnelHost, clientPort: 443 }
        : undefined,
    },
    build: {
      target: 'es2022',
      sourcemap: true,
    },
  };
});
